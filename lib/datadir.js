// Shared writable data directory.
// Prefer .data next to the app; on read-only hosts (Vercel serverless) fall
// back to the OS temp dir so the terminal keeps working — storage is then
// ephemeral per instance instead of persisted.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = (() => {
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
})();

export default DATA_DIR;
