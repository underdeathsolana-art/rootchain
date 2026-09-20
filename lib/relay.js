// Operator relay — a light live-chat bus between registered users.
// File-backed message log + presence (last-seen pings); clients poll GET.
// Identifiers are resolved from access codes server-side, so nobody can
// post under another operator's name.

import fs from 'node:fs';
import path from 'node:path';
import DATA_DIR from './datadir';

const FILE = path.join(DATA_DIR, 'relay.json');
const EMPTY = { nextId: 1, messages: [], presence: {} };

const MAX_MESSAGES = 200;
const ONLINE_WINDOW_MS = 45000;
const SEND_COOLDOWN_MS = 1200;

function read() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

function write(db) {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export function appendMessage(user, text) {
  const db = read();
  const now = Date.now();
  const last = db.messages[db.messages.length - 1];

  if (last && last.username === user.username && now - last.at < SEND_COOLDOWN_MS) {
    return { ok: false, error: 'Slow down — one line at a time.' };
  }

  const msg = { id: db.nextId++, at: now, username: user.username, text };
  db.messages.push(msg);
  if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
  db.presence[user.username] = now;
  write(db);
  return { ok: true, message: msg };
}

export function pingPresence(username) {
  const db = read();
  db.presence[username] = Date.now();
  write(db);
}

export function relayState(sinceId = 0) {
  const db = read();
  const now = Date.now();
  const messages = db.messages.filter((m) => m.id > sinceId);
  const online = Object.entries(db.presence)
    .filter(([, t]) => now - t < ONLINE_WINDOW_MS)
    .map(([name]) => name)
    .sort();
  const all = db.messages;
  return {
    messages,
    online,
    lastId: all.length ? all[all.length - 1].id : 0,
  };
}
