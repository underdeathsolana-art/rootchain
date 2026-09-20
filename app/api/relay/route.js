import { NextResponse } from 'next/server';
import { relayState, appendMessage, pingPresence } from '@/lib/relay';
import { findUserByCode } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relay?since=<id>&username=&code=
 *   Poll for new relay messages; a valid username+code also pings presence.
 *   -> { ok, messages, online, lastId, authed }
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const since = Number(searchParams.get('since') || 0) || 0;
  const username = (searchParams.get('username') || '').slice(0, 24);
  const code = (searchParams.get('code') || '').toUpperCase();

  let me = null;
  if (username && code) {
    const user = findUserByCode(code);
    if (user && user.username.toLowerCase() === username.toLowerCase()) me = user;
  }
  if (me) pingPresence(me.username);

  return NextResponse.json({ ok: true, authed: Boolean(me), ...relayState(since) });
}

/**
 * POST /api/relay { username, code, text }
 *   Speak on the relay. The operator is resolved from the access code, so a
 *   message always carries the canonical registered username.
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  const user = findUserByCode(String(body.code || '').toUpperCase());
  if (
    !user ||
    user.username.toLowerCase() !== String(body.username || '').trim().toLowerCase()
  ) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 401 });
  }

  const text = String(body.text || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .trim()
    .slice(0, 280);
  if (!text) {
    return NextResponse.json({ ok: false, error: 'Empty transmission.' }, { status: 400 });
  }

  const result = appendMessage(user, text);
  if (!result.ok) return NextResponse.json(result, { status: 429 });
  return NextResponse.json(result);
}
