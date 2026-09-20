import { NextResponse } from 'next/server';
import {
  relayState,
  appendRelayMessage,
  pingPresence,
  findUserByCode,
  listOperators,
  storeMode,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relay?since=<cursor>&username=&code=
 *   Poll for new relay messages; a valid username+code also pings presence.
 *   -> { ok, authed, messages, online, lastCursor, operators, store }
 *      operators: every registered user with an online flag — usernames only.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const since = (searchParams.get('since') || '').slice(0, 40);
  const username = (searchParams.get('username') || '').slice(0, 24);
  const code = (searchParams.get('code') || '').toUpperCase();

  let me = null;
  if (username && code) {
    const user = await findUserByCode(code);
    if (user && user.username.toLowerCase() === username.toLowerCase()) me = user;
  }

  const [state, operators] = await Promise.all([
    me ? pingPresence(me.username).then(() => relayState(since)) : relayState(since),
    listOperators(),
  ]);

  const onlineSet = new Set(state.online);
  return NextResponse.json({
    ok: true,
    authed: Boolean(me),
    ...state,
    operators: operators.map((o) => ({ ...o, online: onlineSet.has(o.username) })),
    store: await storeMode(),
  });
}

/**
 * POST /api/relay { username, code, text }
 *   Speak on the relay. The operator is resolved from the access code, so a
 *   message always carries the canonical registered username.
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  const user = await findUserByCode(String(body.code || '').toUpperCase());
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

  const result = await appendRelayMessage(user, text);
  if (!result.ok) return NextResponse.json(result, { status: 429 });
  return NextResponse.json(result);
}
