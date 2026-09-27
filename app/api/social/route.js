import { NextResponse } from 'next/server';
import {
  findUserByCode,
  appendSocialPost,
  listSocialPosts,
  listSocialProfiles,
  setSocialProfile,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Rootchain Social — the operators' feed inside the terminal.
 *
 * GET  /api/social?username=&code=
 *        -> { ok, authed, posts: [ {seq, at, username, text, replyTo} ],
 *             profiles: { lower: {username, bio, ascii} },
 *             me: {bio, ascii} | null }
 *      Reading the feed works unauthenticated; `me` and posting need a
 *      valid username+code pair.
 *
 * POST /api/social { username, code, action, ... }
 *      · action 'post'    { text }
 *      · action 'reply'   { replyTo: <seq>, text }
 *      · action 'profile' { bio? , ascii? }  — merge-update, either optional
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get('username') || '').slice(0, 40);
  const code = (searchParams.get('code') || '').toUpperCase();

  let me = null;
  if (username && code) {
    const user = await findUserByCode(code);
    if (user && user.username.toLowerCase() === username.toLowerCase()) me = user;
  }

  const [posts, profiles] = await Promise.all([listSocialPosts(), listSocialProfiles()]);
  const mine = me ? profiles[me.username.toLowerCase()] : null;

  return NextResponse.json({
    ok: true,
    authed: Boolean(me),
    posts,
    profiles,
    me: mine ? { bio: mine.bio, ascii: mine.ascii } : null,
  });
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

  if (body.action === 'post' || body.action === 'reply') {
    const result = await appendSocialPost(user, body.text, body.action === 'reply' ? body.replyTo : null);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true, post: result.post });
  }

  if (body.action === 'profile') {
    const update = {};
    if (typeof body.bio === 'string') update.bio = body.bio;
    if (typeof body.ascii === 'string') update.ascii = body.ascii;
    if (!Object.keys(update).length) {
      return NextResponse.json({ ok: false, error: 'Nothing to update — send bio and/or ascii.' }, { status: 400 });
    }
    const doc = await setSocialProfile(user.username.toLowerCase(), { username: user.username, ...update });
    return NextResponse.json({
      ok: true,
      profile: { bio: doc.bio || '', ascii: doc.ascii || '' },
    });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
