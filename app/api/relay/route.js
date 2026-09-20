import { NextResponse } from 'next/server';
import {
  relayState,
  appendRelayMessage,
  pingPresence,
  findUserByCode,
  listOperators,
  storeMode,
  getDmTopics,
  setDmTopic,
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

  const [state, operators, topics] = await Promise.all([
    me
      ? pingPresence(me.username).then(() => relayState(since, me.username.toLowerCase()))
      : relayState(since, null),
    listOperators(),
    me ? getDmTopics(me.username.toLowerCase()) : Promise.resolve({}),
  ]);

  const onlineSet = new Set(state.online);
  return NextResponse.json({
    ok: true,
    authed: Boolean(me),
    ...state,
    operators: operators.map((o) => ({ ...o, online: onlineSet.has(o.username) })),
    topics,
    store: await storeMode(),
  });
}

/**
 * POST /api/relay { username, code, text | dm | topic, peer? }
 *   Speak on the relay. The operator is resolved from the access code, so a
 *   message always carries the canonical registered username.
 *   · `dm`   — "<name> <message>": direct message, target matched greedily
 *              against registered usernames (names with spaces work)
 *   · `topic` + `peer` — set the conversation topic of the private channel
 *              with that operator
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

  let text;
  let to = null;
  let toName = null;

  if (body.topic != null) {
    const peerName = String(body.peer || '').trim();
    const operators = await listOperators();
    const match = operators
      .map((o) => o.username)
      .find((name) => name.toLowerCase() === peerName.toLowerCase());
    if (!match) {
      return NextResponse.json({ ok: false, error: 'No registered operator by that name.' }, { status: 404 });
    }
    const topic = String(body.topic || '')
      .replace(/[\u0000-\u001f]+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!topic) {
      return NextResponse.json({ ok: false, error: 'Empty topic.' }, { status: 400 });
    }
    const doc = await setDmTopic(user.username.toLowerCase(), match.toLowerCase(), topic, user.username);
    return NextResponse.json({ ok: true, peer: match, topic: doc.topic, setBy: doc.setBy });
  }

  if (body.dm != null) {
    const tail = String(body.dm || '')
      .replace(/[\u0000-\u001f]+/g, ' ')
      .trim();
    if (!tail) {
      return NextResponse.json({ ok: false, error: 'Usage: dm <operator> <message>' }, { status: 400 });
    }

    const operators = await listOperators();
    const lower = tail.toLowerCase();
    const match = operators
      .map((o) => o.username)
      .sort((a, b) => b.length - a.length)
    // the target must be followed by a space + message (or be the whole tail)
      .find((name) => lower === name.toLowerCase() || lower.startsWith(`${name.toLowerCase()} `));

    if (!match) {
      return NextResponse.json(
        { ok: false, error: 'No registered operator by that name.' },
        { status: 404 },
      );
    }
    if (match.toLowerCase() === user.username.toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: 'You are already talking to yourself.' },
        { status: 400 },
      );
    }

    toName = match;
    to = match.toLowerCase();
    text = tail.slice(match.length).trim();
    if (!text) {
      return NextResponse.json(
        { ok: false, error: `Write a message for ${match}: dm ${match} <message>` },
        { status: 400 },
      );
    }
  } else {
    text = String(body.text || '');
  }

  text = text.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 280);
  if (!text) {
    return NextResponse.json({ ok: false, error: 'Empty transmission.' }, { status: 400 });
  }

  const result = await appendRelayMessage(user, text, to);
  if (!result.ok) return NextResponse.json(result, { status: 429 });
  return NextResponse.json({ ...result, toName });
}
