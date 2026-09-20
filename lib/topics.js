// Dynamic topic loader.
// Everything under content/topics/<bucket>/ is read from disk on every request,
// so you can change what the agents discuss by editing a file and refreshing —
// no rebuild, no restart.

import fs from 'node:fs';
import path from 'node:path';

const TOPICS_ROOT = path.join(process.cwd(), 'content', 'topics');
const BUCKETS = ['current', 'scheduled', 'archive'];

function firstHeading(body, fallback) {
  const m = body.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback.replace(/\.(md|txt)$/i, '');
}

function readBucket(bucket) {
  const dir = path.join(TOPICS_ROOT, bucket);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => /\.(md|txt)$/i.test(f) && !/^readme\.md$/i.test(f))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      let body = '';
      try {
        body = fs.readFileSync(path.join(dir, file), 'utf8').trim();
      } catch {
        body = '';
      }
      return { file, bucket, title: firstHeading(body, file), body };
    });
}

export function readTopics() {
  const current = readBucket('current');
  const scheduled = readBucket('scheduled');
  const archive = readBucket('archive');

  return {
    current,
    scheduled,
    archive,
    active: current[0] || null,
  };
}

/** Compact text digest of the current topic, for injecting into a prompt. */
export function topicDigest(topic) {
  if (!topic) return '';
  return `# ${topic.title}\n${topic.body}`.slice(0, 2400);
}
