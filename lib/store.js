// Data layer — one API, two backends.
//
//   · MongoDB  — used when MONGODB_URI is set (Vercel + the MongoDB
//     integration). Durable across instances: users, relay messages,
//     presence and agent memory all live in the "rootchain" database.
//   · Files    — local-dev fallback under .data/ (see lib/datadir.js),
//     keeping the terminal fully functional with zero setup.
//
// Collections:
//   users          { username, code, createdAt }
//   relay_messages { _id, at, username, text }
//   presence       { _id: username, at }          (TTL index, ~2 min)
//   memory         { _id: 'memory', summary, lastTopic, updatedAt, entries[] }
//   dm_topics      { _id: 'a|b', userA, userB, topic, setBy, updatedAt }
//   agent_context  { _id: username, skill, readme, updatedAt }
//   social_posts   { _id: seq, at, username, text, replyTo }
//   social_profiles{ _id: username, username, bio, ascii, updatedAt }
//   social_follows { _id: 'follower|followee', follower, followee, at }
//   dex_comments   { _id: seq, at, username, text, pair, replyTo }
//   ide_files      { _id: 'owner|name', owner, name, content, updatedAt }
//   sim_portfolios { _id: usernameLower, username, balance, realized, trades,
//                    positions: { ca: { ca, symbol, pairAddress, tokens,
//                    avgPrice, openedAt } }, history[], lastAt }
//   market_watch   { _id: usernameLower, username, nextId, alerts[], watch[] }
//   counters       { _id: 'social_post' | 'dex_comment', seq }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import DATA_DIR from './datadir';

const MONGODB_DB = process.env.MONGODB_DB || 'rootchain';

// ── backend selection ───────────────────────────────────────────────────────

let dbPromise = null;

function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!dbPromise) {
    dbPromise = new MongoClient(uri)
      .connect()
      .then(async (client) => {
        const db = client.db(MONGODB_DB);
        // Presence self-cleans; online window is enforced query-side (45s).
        await db.collection('presence').createIndex({ at: 1 }, { expireAfterSeconds: 120 });
        return db;
      })
      .catch((err) => {
        dbPromise = null; // allow a later request to retry the handshake
        throw err;
      });
  }
  return dbPromise;
}

export async function storeMode() {
  return process.env.MONGODB_URI ? 'mongodb' : 'file';
}

// ── shared constants ────────────────────────────────────────────────────────

export const RELAY_LIMITS = {
  MAX_MESSAGES: 200,      // history returned / retained
  ONLINE_WINDOW_MS: 45000,
  SEND_COOLDOWN_MS: 1200,
};

// ── users ───────────────────────────────────────────────────────────────────

const USERS_FILE = path.join(DATA_DIR, 'users.json');

function readUsersFile() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || [];
  } catch {
    return [];
  }
}

export async function findUserByCode(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) return null;

  const db = await getDb();
  if (db) {
    const doc = await db.collection('users').findOne({ code: value });
    return doc || null;
  }
  return readUsersFile().find((u) => u.code === value) || null;
}

export async function findUserByName(name) {
  const value = String(name || '').trim().toLowerCase();
  if (!value) return null;

  const db = await getDb();
  if (db) {
    const doc = await db.collection('users').findOne({ username: value });
    if (doc) return doc;
    // usernames are stored with their original casing — fall back to a scan
    const all = await db.collection('users').find({}, { projection: { username: 1 } }).toArray();
    return all.find((u) => u.username.toLowerCase() === value) || null;
  }
  return readUsersFile().find((u) => u.username.toLowerCase() === value) || null;
}

export async function insertUser(user) {
  const db = await getDb();
  if (db) {
    await db.collection('users').insertOne(user);
    return;
  }
  const users = readUsersFile();
  users.push(user);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

/** All registered operators (usernames only — access codes never leave). */
export async function listOperators() {
  const db = await getDb();
  if (db) {
    const docs = await db
      .collection('users')
      .find({}, { projection: { username: 1, createdAt: 1 } })
      .sort({ username: 1 })
      .limit(200)
      .toArray();
    return docs.map((d) => ({ username: d.username, createdAt: d.createdAt }));
  }
  return readUsersFile()
    .map((u) => ({ username: u.username, createdAt: u.createdAt }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

// ── relay (operator live chat) ─────────────────────────────────────────────

const RELAY_FILE = path.join(DATA_DIR, 'relay.json');

function readRelayFile() {
  try {
    return JSON.parse(fs.readFileSync(RELAY_FILE, 'utf8'));
  } catch {
    return { nextId: 1, messages: [], presence: {} };
  }
}

function writeRelayFile(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RELAY_FILE, JSON.stringify(db, null, 2));
}

function validObjectId(s) {
  return typeof s === 'string' && /^[0-9a-f]{24}$/.test(s);
}

export async function appendRelayMessage(user, text, to = null) {
  const now = Date.now();
  const { SEND_COOLDOWN_MS } = RELAY_LIMITS;
  const target = to ? String(to).toLowerCase() : null;

  const db = await getDb();
  if (db) {
    const last = await db
      .collection('relay_messages')
      .find({ username: user.username })
      .sort({ _id: -1 })
      .limit(1)
      .toArray();
    if (last.length && now - last[0].at < SEND_COOLDOWN_MS) {
      return { ok: false, error: 'Slow down — one line at a time.' };
    }
    const doc = { at: now, username: user.username, text, to: target };
    const inserted = await db.collection('relay_messages').insertOne(doc);
    await db
      .collection('presence')
      .updateOne({ _id: user.username }, { $set: { at: now } }, { upsert: true });
    return {
      ok: true,
      message: { id: inserted.insertedId.toHexString(), at: now, username: user.username, text, to: target },
      cursor: inserted.insertedId.toHexString(),
    };
  }

  const file = readRelayFile();
  const last = file.messages[file.messages.length - 1];
  if (last && last.username === user.username && now - last.at < SEND_COOLDOWN_MS) {
    return { ok: false, error: 'Slow down — one line at a time.' };
  }
  const msg = { id: file.nextId++, at: now, username: user.username, text, to: target };
  file.messages.push(msg);
  if (file.messages.length > RELAY_LIMITS.MAX_MESSAGES) {
    file.messages = file.messages.slice(-RELAY_LIMITS.MAX_MESSAGES);
  }
  file.presence[user.username] = now;
  writeRelayFile(file);
  return { ok: true, message: msg, cursor: String(msg.id) };
}

export async function pingPresence(username) {
  const now = Date.now();
  const db = await getDb();
  if (db) {
    await db
      .collection('presence')
      .updateOne({ _id: username }, { $set: { at: now } }, { upsert: true });
    return;
  }
  const file = readRelayFile();
  file.presence[username] = now;
  writeRelayFile(file);
}

/**
 * Everything a relay client needs: messages after `sinceCursor`, who is
 * online, and the newest cursor. Cursors are opaque strings (ObjectId hex
 * on Mongo, numeric id on files) and monotonic within a backend.
 *
 * `me` (lowercase username or null) scopes direct messages: a DM is visible
 * only to its sender and its recipient; everyone else sees public lines.
 */
export async function relayState(sinceCursor = '', me = null) {
  const { ONLINE_WINDOW_MS, MAX_MESSAGES } = RELAY_LIMITS;
  const now = Date.now();

  const visible = (m) => !m.to || m.to === me || (me && m.username.toLowerCase() === me);

  const db = await getDb();
  if (db) {
    const scope = me
      ? { $or: [{ to: null }, { to: me }, { username: me, to: { $ne: null } }] }
      : { to: null };
    const query = validObjectId(sinceCursor)
      ? { _id: { $gt: new ObjectId(sinceCursor) }, ...scope }
      : scope;
    const docs = await db
      .collection('relay_messages')
      .find(query)
      .sort({ _id: 1 })
      .limit(MAX_MESSAGES)
      .toArray();
    const presence = await db
      .collection('presence')
      .find({ at: { $gte: now - ONLINE_WINDOW_MS } })
      .toArray();
    return {
      messages: docs.map((d) => ({
        id: d._id.toHexString(),
        at: d.at,
        username: d.username,
        text: d.text,
        to: d.to || null,
      })),
      online: presence.map((p) => p._id).sort(),
      lastCursor: docs.length ? docs[docs.length - 1]._id.toHexString() : '',
    };
  }

  const file = readRelayFile();
  const since = Number(sinceCursor) || 0;
  const messages = file.messages
    .filter((m) => m.id > since && visible(m))
    .slice(-MAX_MESSAGES)
    .map((m) => ({ ...m, id: String(m.id), to: m.to || null }));
  const online = Object.entries(file.presence || {})
    .filter(([, t]) => now - t < ONLINE_WINDOW_MS)
    .map(([name]) => name)
    .sort();
  return {
    messages,
    online,
    lastCursor: file.messages.length ? String(file.messages[file.messages.length - 1].id) : '',
  };
}

// ── agent memory ───────────────────────────────────────────────────────────

const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');
const MEMORY_EMPTY = { summary: '', lastTopic: null, updatedAt: null, entries: [] };

function readMemoryFile() {
  try {
    return { ...MEMORY_EMPTY, ...JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) };
  } catch {
    return { ...MEMORY_EMPTY };
  }
}

function writeMemoryFile(memory) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

export async function readMemory() {
  const db = await getDb();
  if (db) {
    const doc = await db.collection('memory').findOne({ _id: 'memory' });
    return doc ? { ...MEMORY_EMPTY, ...doc } : { ...MEMORY_EMPTY };
  }
  return readMemoryFile();
}

export async function appendMemory({ agent, text, topic }) {
  if (!text) return readMemory();
  const now = new Date().toISOString();
  const entry = {
    agent: agent === 'link' ? 'link' : 'root',
    text: String(text).slice(0, 600),
    topic: topic || null,
    at: now,
  };

  const db = await getDb();
  if (db) {
    const update = {
      $push: { entries: { $each: [entry], $slice: -200 } },
      $set: { updatedAt: now },
    };
    if (topic) update.$set.lastTopic = topic;
    const doc = await db
      .collection('memory')
      .findOneAndUpdate({ _id: 'memory' }, update, { upsert: true, returnDocument: 'after' });
    return { ...MEMORY_EMPTY, ...doc };
  }

  const memory = readMemoryFile();
  memory.entries.push(entry);
  if (memory.entries.length > 200) memory.entries = memory.entries.slice(-200);
  if (topic) memory.lastTopic = topic;
  memory.updatedAt = now;
  writeMemoryFile(memory);
  return memory;
}

export async function setMemorySummary(summary) {
  const now = new Date().toISOString();
  const value = String(summary || '').slice(0, 1200);

  const db = await getDb();
  if (db) {
    const doc = await db
      .collection('memory')
      .findOneAndUpdate(
        { _id: 'memory' },
        { $set: { summary: value, updatedAt: now } },
        { upsert: true, returnDocument: 'after' },
      );
    return { ...MEMORY_EMPTY, ...doc };
  }

  const memory = readMemoryFile();
  memory.summary = value;
  memory.updatedAt = now;
  writeMemoryFile(memory);
  return memory;
}

export async function clearMemory() {
  const db = await getDb();
  if (db) {
    await db.collection('memory').deleteOne({ _id: 'memory' });
    return { ...MEMORY_EMPTY };
  }
  writeMemoryFile({ ...MEMORY_EMPTY });
  return { ...MEMORY_EMPTY };
}

/** Human-readable digest used to prime the agents on what they already know. */
export function memoryDigest(memory, n = 6) {
  const recent = (memory.entries || []).slice(-n).map((e) => {
    const who = e.agent === 'link' ? 'Agent-02 Chain' : 'Agent-01 Root';
    return `${who}: ${e.text}`;
  });

  return [
    memory.summary ? `Summary: ${memory.summary}` : '',
    memory.lastTopic ? `Last topic: ${memory.lastTopic}` : '',
    recent.length ? `Recent turns:\n${recent.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2200);
}

// ── dex view comments (per-pair threads under the market terminal) ────────

const DEX_FILE = path.join(DATA_DIR, 'dex_comments.json');
const DEX_EMPTY = { nextSeq: 1, comments: [] };

export const DEX_LIMITS = {
  TEXT_MAX: 500,  // chars per comment / reply
  KEEP: 300,      // comments retained per pair
};

function readDexFile() {
  try {
    return { ...DEX_EMPTY, ...JSON.parse(fs.readFileSync(DEX_FILE, 'utf8')) };
  } catch {
    return { ...DEX_EMPTY };
  }
}

/**
 * Append a comment (or a reply — replies attach to the ROOT comment of a
 * thread, exactly like the social feed) to a pair's wall. `pair` is keyed
 * lowercase so casing never splits one pool into two walls.
 */
export async function appendDexComment(user, pair, text, replyTo = null) {
  const value = String(text || '').replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').trim().slice(0, DEX_LIMITS.TEXT_MAX);
  if (!value) return { ok: false, error: 'Empty transmission.' };
  const pairKey = String(pair || '').toLowerCase();
  if (!pairKey) return { ok: false, error: 'Missing pair.' };

  const db = await getDb();
  const data = db ? null : readDexFile();
  let parent = null;

  if (replyTo != null) {
    const target = Number(replyTo);
    if (!Number.isInteger(target) || target < 1) return { ok: false, error: 'Reply id must be a comment number.' };
    parent = db
      ? await db.collection('dex_comments').findOne({ _id: target, pair: pairKey })
      : data.comments.find((c) => c.seq === target && c.pair === pairKey) || null;
    if (!parent) return { ok: false, error: `No comment #${target} on this wall — "refresh" and try again.` };
  }

  let seq;
  if (db) {
    const counter = await db
      .collection('counters')
      .findOneAndUpdate({ _id: 'dex_comment' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    seq = typeof counter?.seq === 'number' ? counter.seq : counter?.value?.seq;
    if (!Number.isInteger(seq)) throw new Error('counter read failed');
  } else {
    seq = data.nextSeq;
    data.nextSeq += 1;
  }

  const doc = {
    seq,
    at: Date.now(),
    username: user.username,
    text: value,
    pair: pairKey,
    replyTo: parent ? (parent.replyTo || parent.seq) : null,
  };

  if (db) {
    await db.collection('dex_comments').insertOne({ _id: seq, ...doc });
  } else {
    data.comments.push(doc);
    if (data.comments.length > DEX_LIMITS.KEEP * 4) data.comments = data.comments.slice(-DEX_LIMITS.KEEP * 4);
    writeDexFile(data);
  }
  return { ok: true, comment: doc };
}

/** One pair's wall, oldest → newest (the client threads replies itself). */
export async function listDexComments(pair) {
  const pairKey = String(pair || '').toLowerCase();
  if (!pairKey) return [];

  const db = await getDb();
  let raw;
  if (db) {
    raw = await db.collection('dex_comments').find({ pair: pairKey }).sort({ _id: -1 }).limit(DEX_LIMITS.KEEP).toArray();
    raw.reverse();
  } else {
    raw = readDexFile().comments.filter((c) => c.pair === pairKey).slice(-DEX_LIMITS.KEEP);
  }
  return raw.map((c) => ({ seq: c.seq ?? c._id, at: c.at, username: c.username, text: c.text, replyTo: c.replyTo || null }));
}

function writeDexFile(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEX_FILE, JSON.stringify(data, null, 2));
}

// ── DM channel topics ──────────────────────────────────────────────────────

const TOPICS_FILE = path.join(DATA_DIR, 'dm_topics.json');

function pairKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');
}

function readTopicsFile() {
  try {
    return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Every DM topic involving `me`, keyed by the peer's lowercase username. */
export async function getDmTopics(meLower) {
  if (!meLower) return {};

  const db = await getDb();
  if (db) {
    const docs = await db
      .collection('dm_topics')
      .find({ $or: [{ userA: meLower }, { userB: meLower }] })
      .toArray();
    const out = {};
    for (const d of docs) {
      const peer = d.userA === meLower ? d.userB : d.userA;
      out[peer] = { topic: d.topic, setBy: d.setBy, updatedAt: d.updatedAt };
    }
    return out;
  }

  const file = readTopicsFile();
  const out = {};
  for (const [key, val] of Object.entries(file)) {
    const [a, b] = key.split('|');
    if (a === meLower || b === meLower) {
      const peer = a === meLower ? b : a;
      out[peer] = { topic: val.topic, setBy: val.setBy, updatedAt: val.updatedAt };
    }
  }
  return out;
}

/** Create or replace the conversation topic of a private channel. */
export async function setDmTopic(meLower, peerLower, topic, setBy) {
  const key = pairKey(meLower, peerLower);
  const doc = {
    userA: key.split('|')[0],
    userB: key.split('|')[1],
    topic: String(topic || '').slice(0, 200),
    setBy,
    updatedAt: new Date().toISOString(),
  };

  const db = await getDb();
  if (db) {
    await db.collection('dm_topics').updateOne({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  const file = readTopicsFile();
  file[key] = doc;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOPICS_FILE, JSON.stringify(file, null, 2));
  return doc;
}

// ── agent context (per-operator skill.md / readme.md) ──────────────────────

const CONTEXT_FILE = path.join(DATA_DIR, 'agent_context.json');
const CONTEXT_EMPTY = { skill: '', readme: '', updatedAt: null };
const CONTEXT_MAX = 4000; // chars per file — keeps prompts bounded

function readContextFile() {
  try {
    return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function clampContext(value) {
  return String(value || '').replace(/\r\n/g, '\n').trimEnd().slice(0, CONTEXT_MAX);
}

/**
 * One operator's agent-context pair. `skill` feeds the behaviour block of the
 * system prompt, `readme` the background block — both optional, both private
 * to the user who wrote them.
 */
export async function readAgentContext(usernameLower) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) return { ...CONTEXT_EMPTY };

  const db = await getDb();
  if (db) {
    const doc = await db.collection('agent_context').findOne({ _id: key });
    return doc ? { skill: doc.skill || '', readme: doc.readme || '', updatedAt: doc.updatedAt || null } : { ...CONTEXT_EMPTY };
  }

  const file = readContextFile();
  const doc = file[key];
  return doc ? { skill: doc.skill || '', readme: doc.readme || '', updatedAt: doc.updatedAt || null } : { ...CONTEXT_EMPTY };
}

/** Create or replace one file of the pair ('skill' | 'readme'). */
export async function setAgentContext(usernameLower, file, content) {
  const key = String(usernameLower || '').toLowerCase();
  const field = file === 'readme' ? 'readme' : 'skill';
  if (!key) throw new Error('Missing operator.');
  const value = clampContext(content);
  const now = new Date().toISOString();

  const db = await getDb();
  if (db) {
    const doc = await db
      .collection('agent_context')
      .findOneAndUpdate(
        { _id: key },
        { $set: { [field]: value, updatedAt: now } },
        { upsert: true, returnDocument: 'after' },
      );
    return { skill: doc?.skill || '', readme: doc?.readme || '', updatedAt: doc?.updatedAt || now };
  }

  const store = readContextFile();
  const doc = store[key] || { ...CONTEXT_EMPTY };
  doc[field] = value;
  doc.updatedAt = now;
  store[key] = doc;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(store, null, 2));
  return doc;
}

// ── social feed (posts, replies, operator profiles) ────────────────────────

const SOCIAL_FILE = path.join(DATA_DIR, 'social.json');
const SOCIAL_EMPTY = { nextSeq: 1, posts: [], profiles: {} };

export const SOCIAL_LIMITS = {
  POST_MAX: 500,   // chars per post / reply
  BIO_MAX: 280,    // chars per bio
  ASCII_MAX: 400,  // chars of profile ASCII art
  KEEP: 200,       // posts retained / returned
};

function readSocialFile() {
  try {
    return { ...SOCIAL_EMPTY, ...JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf8')) };
  } catch {
    return { ...SOCIAL_EMPTY };
  }
}

function writeSocialFile(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SOCIAL_FILE, JSON.stringify(data, null, 2));
}

/** One operator's social profile: canonical name, bio, ASCII art. */
export async function readSocialProfile(usernameLower) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) return null;

  const db = await getDb();
  if (db) {
    return await db.collection('social_profiles').findOne({ _id: key }) || null;
  }
  return readSocialFile().profiles[key] || null;
}

/**
 * Merge-update a profile — only the provided fields change. `bio` is
 * flattened to one line; `ascii` keeps its line breaks.
 */
export async function setSocialProfile(usernameLower, { username, bio, ascii }) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) throw new Error('Missing operator.');
  const now = new Date().toISOString();
  const $set = { username, updatedAt: now };
  if (bio !== undefined) $set.bio = String(bio).replace(/[\r\n]+/g, ' ').trim().slice(0, SOCIAL_LIMITS.BIO_MAX);
  if (ascii !== undefined) $set.ascii = String(ascii).replace(/\r\n/g, '\n').trimEnd().slice(0, SOCIAL_LIMITS.ASCII_MAX);

  const db = await getDb();
  if (db) {
    // No $setOnInsert: pairing it with $set on the same field makes MongoDB
    // reject the upsert ("would create a conflict"), which 500s the very
    // first save of a profile. Missing fields simply read back as ''.
    await db.collection('social_profiles').updateOne({ _id: key }, { $set }, { upsert: true });
    return await db.collection('social_profiles').findOne({ _id: key });
  }

  const data = readSocialFile();
  const doc = data.profiles[key] || { username, bio: '', ascii: '', updatedAt: null };
  Object.assign(doc, $set);
  data.profiles[key] = doc;
  writeSocialFile(data);
  return doc;
}

/** Every profile (small docs) — the client renders bio + art from these. */
export async function listSocialProfiles() {
  const db = await getDb();
  if (db) {
    const docs = await db.collection('social_profiles').find({}).limit(500).toArray();
    return Object.fromEntries(docs.map((d) => [d._id, { username: d.username, bio: d.bio || '', ascii: d.ascii || '' }]));
  }
  const { profiles } = readSocialFile();
  return Object.fromEntries(
    Object.entries(profiles).map(([k, d]) => [k, { username: d.username, bio: d.bio || '', ascii: d.ascii || '' }]),
  );
}

async function nextSeq(db, data) {
  if (db) {
    const counter = await db
      .collection('counters')
      .findOneAndUpdate({ _id: 'social_post' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    // driver ≥4 returns the document; older shapes wrapped it in { value }
    const seq = typeof counter?.seq === 'number' ? counter.seq : counter?.value?.seq;
    if (!Number.isInteger(seq)) throw new Error('counter read failed');
    return seq;
  }
  const seq = data.nextSeq;
  data.nextSeq += 1;
  return seq;
}

/**
 * Append a post, or a reply to one. Replies always attach to the ROOT post of
 * a thread (replying to a reply joins the same thread), so the feed stays
 * two-level and readable in a terminal.
 */
export async function appendSocialPost(user, text, replyTo = null) {
  const value = String(text || '').replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ').trim().slice(0, SOCIAL_LIMITS.POST_MAX);
  if (!value) return { ok: false, error: 'Empty transmission.' };

  const db = await getDb();
  const data = db ? null : readSocialFile();
  let parent = null;

  if (replyTo != null) {
    const target = Number(replyTo);
    if (!Number.isInteger(target) || target < 1) return { ok: false, error: 'Reply id must be a post number.' };
    parent = db
      ? await db.collection('social_posts').findOne({ _id: target })
      : data.posts.find((p) => p.seq === target) || null;
    if (!parent) return { ok: false, error: `No post #${target} — "refresh" and try again.` };
  }

  const seq = await nextSeq(db, data);
  const post = {
    seq,
    at: Date.now(),
    username: user.username,
    text: value,
    replyTo: parent ? (parent.replyTo || parent.seq) : null,
  };

  if (db) {
    await db.collection('social_posts').insertOne({ _id: seq, ...post });
  } else {
    data.posts.push(post);
    if (data.posts.length > SOCIAL_LIMITS.KEEP) data.posts = data.posts.slice(-SOCIAL_LIMITS.KEEP);
    writeSocialFile(data);
  }
  return { ok: true, post };
}

/** Oldest-to-newest posts (capped), plus the highest seq for the client. */
export async function listSocialPosts() {
  const db = await getDb();
  let raw;
  if (db) {
    raw = await db.collection('social_posts').find({}).sort({ _id: -1 }).limit(SOCIAL_LIMITS.KEEP).toArray();
    raw.reverse();
  } else {
    raw = readSocialFile().posts.slice(-SOCIAL_LIMITS.KEEP);
  }
  return raw.map((p) => ({ seq: p.seq ?? p._id, at: p.at, username: p.username, text: p.text, replyTo: p.replyTo || null }));
}

// ── social graph (follow / following) ──────────────────────────────────────

function followKey(meLower, targetLower) {
  return `${meLower}|${targetLower}`;
}

/** Follow a registered operator. Self-follows are rejected; repeats no-op. */
export async function followOperator(meLower, targetLower) {
  const me = String(meLower || '').toLowerCase();
  const target = String(targetLower || '').toLowerCase();
  if (!me || !target) return { ok: false, error: 'Missing operator.' };
  if (me === target) return { ok: false, error: 'You already follow yourself by default.' };

  const now = Date.now();
  const doc = { follower: me, followee: target, at: now };

  const db = await getDb();
  if (db) {
    await db.collection('social_follows').updateOne({ _id: followKey(me, target) }, { $set: doc }, { upsert: true });
    return { ok: true, following: true };
  }

  const data = readSocialFile();
  data.follows = data.follows || {};
  data.follows[followKey(me, target)] = doc;
  writeSocialFile(data);
  return { ok: true, following: true };
}

export async function unfollowOperator(meLower, targetLower) {
  const me = String(meLower || '').toLowerCase();
  const target = String(targetLower || '').toLowerCase();
  if (!me || !target) return { ok: false, error: 'Missing operator.' };

  const db = await getDb();
  if (db) {
    await db.collection('social_follows').deleteOne({ _id: followKey(me, target) });
    return { ok: true, following: false };
  }

  const data = readSocialFile();
  if (data.follows) {
    delete data.follows[followKey(me, target)];
    writeSocialFile(data);
  }
  return { ok: true, following: false };
}

/**
 * The whole graph, small: every edge { follower, followee }. The client turns
 * this into per-operator counts and the caller's following set.
 */
export async function listFollows() {
  const db = await getDb();
  if (db) {
    const docs = await db.collection('social_follows').find({}).limit(2000).toArray();
    return docs.map((d) => ({ follower: d.follower, followee: d.followee }));
  }
  const data = readSocialFile();
  return Object.values(data.follows || {}).map((d) => ({ follower: d.follower, followee: d.followee }));
}

// ── ROOTIDE prompt files ───────────────────────────────────────────────────

const IDE_FILE = path.join(DATA_DIR, 'ide_files.json');

export const IDE_LIMITS = {
  NAME_MAX: 40,
  CONTENT_MAX: 8000, // chars per prompt file
  FILES_MAX: 20,     // per operator
};

function readIdeFileStore() {
  try {
    return JSON.parse(fs.readFileSync(IDE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function ideKey(ownerLower, name) {
  return `${ownerLower}|${name}`;
}

/** An operator's prompt files — names, sizes, timestamps (no contents). */
export async function listIdeFiles(ownerLower) {
  const owner = String(ownerLower || '').toLowerCase();
  if (!owner) return [];

  const db = await getDb();
  if (db) {
    const docs = await db
      .collection('ide_files')
      .find({ owner }, { projection: { name: 1, content: 1, updatedAt: 1 } })
      .sort({ name: 1 })
      .limit(IDE_LIMITS.FILES_MAX)
      .toArray();
    return docs.map((d) => ({ name: d.name, size: (d.content || '').length, updatedAt: d.updatedAt }));
  }

  const store = readIdeFileStore();
  return Object.values(store)
    .filter((d) => d.owner === owner)
    .map((d) => ({ name: d.name, size: d.content.length, updatedAt: d.updatedAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One prompt file with its content, or null. */
export async function readIdeFile(ownerLower, name) {
  const owner = String(ownerLower || '').toLowerCase();
  if (!owner || !name) return null;

  const db = await getDb();
  if (db) {
    return (await db.collection('ide_files').findOne({ _id: ideKey(owner, name) })) || null;
  }
  return readIdeFileStore()[ideKey(owner, name)] || null;
}

/** Create or replace one prompt file. Enforces the per-operator file cap. */
export async function saveIdeFile(ownerLower, name, content) {
  const owner = String(ownerLower || '').toLowerCase();
  if (!owner) throw new Error('Missing operator.');
  const value = String(content || '').replace(/\r\n/g, '\n').trimEnd().slice(0, IDE_LIMITS.CONTENT_MAX);
  const now = new Date().toISOString();
  const doc = { owner, name, content: value, updatedAt: now };

  const db = await getDb();
  if (db) {
    const existing = await db.collection('ide_files').countDocuments({ owner });
    const replacing = await db.collection('ide_files').countDocuments({ _id: ideKey(owner, name) });
    if (!replacing && existing >= IDE_LIMITS.FILES_MAX) {
      return { ok: false, error: `File limit reached (${IDE_LIMITS.FILES_MAX}) — delete one first.` };
    }
    await db.collection('ide_files').updateOne({ _id: ideKey(owner, name) }, { $set: doc }, { upsert: true });
    return { ok: true, file: { name, size: value.length, updatedAt: now } };
  }

  const store = readIdeFileStore();
  const key = ideKey(owner, name);
  if (!store[key] && Object.values(store).filter((d) => d.owner === owner).length >= IDE_LIMITS.FILES_MAX) {
    return { ok: false, error: `File limit reached (${IDE_LIMITS.FILES_MAX}) — delete one first.` };
  }
  store[key] = doc;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(IDE_FILE, JSON.stringify(store, null, 2));
  return { ok: true, file: { name, size: value.length, updatedAt: now } };
}

export async function deleteIdeFile(ownerLower, name) {
  const owner = String(ownerLower || '').toLowerCase();
  if (!owner || !name) return;

  const db = await getDb();
  if (db) {
    await db.collection('ide_files').deleteOne({ _id: ideKey(owner, name) });
    return;
  }
  const store = readIdeFileStore();
  delete store[ideKey(owner, name)];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(IDE_FILE, JSON.stringify(store, null, 2));
}

// ── paper trading wallets (the sim desk) ────────────────────────────────────

const SIM_FILE = path.join(DATA_DIR, 'sim_portfolios.json');

function readSimFile() {
  try {
    return JSON.parse(fs.readFileSync(SIM_FILE, 'utf8'));
  } catch {
    return { portfolios: {} };
  }
}

/** One operator's paper wallet, or null before their first order. */
export async function getSimPortfolio(usernameLower) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) return null;

  const db = await getDb();
  if (db) return (await db.collection('sim_portfolios').findOne({ _id: key })) || null;
  return readSimFile().portfolios[key] || null;
}

/** Create or replace a wallet — $set only, no $setOnInsert (upsert conflict). */
export async function saveSimPortfolio(usernameLower, doc) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) throw new Error('Missing operator.');

  const db = await getDb();
  if (db) {
    await db.collection('sim_portfolios').updateOne({ _id: key }, { $set: doc }, { upsert: true });
    return;
  }
  const data = readSimFile();
  data.portfolios[key] = doc;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SIM_FILE, JSON.stringify(data, null, 2));
}

/** Every wallet, most recently traded first — the leaderboard scan pool. */
export async function listSimPortfolios(limit = 50) {
  const db = await getDb();
  if (db) {
    const docs = await db
      .collection('sim_portfolios')
      .find({})
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
    return docs;
  }
  return Object.values(readSimFile().portfolios)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);
}

// ── price alerts & watchlist ────────────────────────────────────────────────

const WATCH_FILE = path.join(DATA_DIR, 'market_watch.json');

function readWatchFile() {
  try {
    return JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** One operator's alerts + watchlist doc, or null before they arm anything. */
export async function getMarketWatch(usernameLower) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) return null;

  const db = await getDb();
  if (db) return (await db.collection('market_watch').findOne({ _id: key })) || null;
  return readWatchFile()[key] || null;
}

/** Create or replace an operator's alerts + watchlist — $set only. */
export async function saveMarketWatch(usernameLower, doc) {
  const key = String(usernameLower || '').toLowerCase();
  if (!key) throw new Error('Missing operator.');

  const db = await getDb();
  if (db) {
    await db.collection('market_watch').updateOne({ _id: key }, { $set: doc }, { upsert: true });
    return;
  }
  const store = readWatchFile();
  store[key] = doc;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WATCH_FILE, JSON.stringify(store, null, 2));
}

// ── access codes ────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode() {
  const bytes = crypto.randomBytes(8);
  const block = (from) =>
    Array.from(bytes.slice(from, from + 4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `RC-${block(0)}-${block(4)}`;
}
