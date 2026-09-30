import { NextResponse } from 'next/server';
import { findUserByCode, appendDexComment, listDexComments } from '@/lib/store';
import { DEFAULT_PAIR, parseMarketArg } from '@/lib/market';

export const dynamic = 'force-dynamic';

/**
 * Market view — the comment wall under a pair chart. Anyone can read;
 * posting and replying belong to registered operators, exactly like the
 * social feed, and threads stay two-level (a reply to a reply joins the
 * same root) so the wall reads cleanly in a terminal.
 *
 * GET  /api/market/comments?pair=<pool>      -> { ok, comments: [...] }
 * POST /api/market/comments { username, code, action, pair, ... }
 *      · 'comment' { text }
 *      · 'reply'   { replyTo: <seq>, text }
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const pair = parseMarketArg(searchParams.get('pair')) || DEFAULT_PAIR;
  const comments = await listDexComments(pair);
  return NextResponse.json({ ok: true, comments });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const user = await findUserByCode(String(body.code || '').toUpperCase());
  if (
    !user ||
    user.username.toLowerCase() !== String(body.username || '').trim().toLowerCase()
  ) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 401 });
  }
  if (body.action !== 'comment' && body.action !== 'reply') {
    return NextResponse.json({ ok: false, error: 'Unknown action — use comment or reply.' }, { status: 400 });
  }

  const pair = parseMarketArg(body.pair) || DEFAULT_PAIR;
  const result = await appendDexComment(user, pair, body.text, body.action === 'reply' ? body.replyTo : null);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, comment: result.comment });
}
