import { NextResponse } from 'next/server';
import { readTopics } from '@/lib/topics';

export const dynamic = 'force-dynamic';

/**
 * GET /api/topics
 * Reads content/topics/{current,scheduled,archive} from disk on every call.
 * Returns the active topic body plus lightweight file lists per bucket.
 */
export async function GET() {
  const topics = readTopics();

  return NextResponse.json({
    active: topics.active
      ? { file: topics.active.file, title: topics.active.title, body: topics.active.body }
      : null,
    current: topics.current.map((t) => ({ file: t.file, title: t.title })),
    scheduled: topics.scheduled.map((t) => ({ file: t.file, title: t.title })),
    archive: topics.archive.map((t) => ({ file: t.file, title: t.title })),
  });
}
