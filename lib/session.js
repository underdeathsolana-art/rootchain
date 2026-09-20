// Access-code registration & login.
// Users are stored in .data/users.json; the browser mirrors the session in
// localStorage so returning visitors skip the boot screen.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Same read-only-host fallback as lib/memory.js: .data when writable,
// otherwise the OS temp dir (registrations become ephemeral per instance).
const DATA_DIR = resolveDataDir();

function resolveDataDir() {
  const primary = path.join(process.cwd(), '.data');
  try {
    fs.mkdirSync(primary, { recursive: true });
    fs.accessSync(primary, fs.constants.W_OK);
    return primary;
  } catch {
    const fallback = path.join(os.tmpdir(), 'rootchain-data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const FILE = path.join(DATA_DIR, 'users.json');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ users: [] }, null, 2));
}

function read() {
  try {
    ensure();
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function write(db) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

function block(len = 4) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function generateCode() {
  return `RC-${block()}-${block()}`;
}

export function register(username) {
  const name = String(username || '').trim().slice(0, 24);
  if (name.length < 2) {
    return { ok: false, error: 'Username must be at least 2 characters.' };
  }

  const db = read();
  const existing = db.users.find((u) => u.username.toLowerCase() === name.toLowerCase());

  if (existing) {
    return { ok: true, username: existing.username, code: existing.code, createdAt: existing.createdAt, existing: true };
  }

  const user = { username: name, code: generateCode(), createdAt: new Date().toISOString() };
  db.users.push(user);
  write(db);

  return { ok: true, username: user.username, code: user.code, createdAt: user.createdAt, existing: false };
}

export function login(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) return { ok: false, error: 'Enter your access code.' };

  const db = read();
  const user = db.users.find((u) => u.code === value);
  if (!user) return { ok: false, error: 'Access code not recognised.' };

  return { ok: true, username: user.username, code: user.code, createdAt: user.createdAt };
}
