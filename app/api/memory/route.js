import { NextResponse } from 'next/server';
import { readMemory, appendMemory, setMemorySummary, clearMemory } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** GET /api/memory — recent turns + summary + counters. */
export async function GET() {
  const memory = await readMemory();
  return NextResponse.json({
    summary: memory.summary,
    lastTopic: memory.lastTopic,
    updatedAt: memory.updatedAt,
    count: memory.entries.length,
    recent: memory.entries.slice(-8).map((e) => ({ agent: e.agent, text: e.text, at: e.at })),
  });
}

/** POST /api/memory — { type:'turn'|'summary'|'clear', ... } */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  if (body.type === 'summary') {
    const memory = await setMemorySummary(body.summary);
    return NextResponse.json({ ok: true, count: memory.entries.length, summary: memory.summary });
  }

  if (body.type === 'clear') {
    const memory = await clearMemory();
    return NextResponse.json({ ok: true, count: memory.entries.length, cleared: true });
  }

  const memory = await appendMemory({ agent: body.agent, text: body.text, topic: body.topic });
  return NextResponse.json({ ok: true, count: memory.entries.length, updatedAt: memory.updatedAt });
}
