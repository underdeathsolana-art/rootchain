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

// ── access codes ────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode() {
  const bytes = crypto.randomBytes(8);
  const block = (from) =>
    Array.from(bytes.slice(from, from + 4), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `RC-${block(0)}-${block(4)}`;
}
