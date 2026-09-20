// Lightweight server-side memory.
// Persisted to .data/memory.json so the agents remember the conversation across
// page reloads and restarts. The browser keeps a mirror in localStorage.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Prefer .data next to the app. On read-only hosts (e.g. Vercel serverless)
// fall back to the OS temp dir so the terminal keeps working — memory is
// then ephemeral per instance instead of persisted.
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

const FILE = path.join(DATA_DIR, 'memory.json');
const EMPTY = { summary: '', lastTopic: null, updatedAt: null, entries: [] };

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(EMPTY, null, 2));
}

export function readMemory() {
  try {
    ensure();
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

function write(memory) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(memory, null, 2));
}

export function appendMemory({ agent, text, topic }) {
  const memory = readMemory();
  if (!text) return memory;

  memory.entries.push({
    agent: agent === 'link' ? 'link' : 'root',
    text: String(text).slice(0, 600),
    topic: topic || memory.lastTopic || null,
    at: new Date().toISOString(),
  });

  if (memory.entries.length > 200) memory.entries = memory.entries.slice(-200);
  if (topic) memory.lastTopic = topic;
  memory.updatedAt = new Date().toISOString();

  write(memory);
  return memory;
}

export function setSummary(summary) {
  const memory = readMemory();
  memory.summary = String(summary || '').slice(0, 1200);
  memory.updatedAt = new Date().toISOString();
  write(memory);
  return memory;
}

export function clearMemory() {
  write({ ...EMPTY });
  return readMemory();
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
