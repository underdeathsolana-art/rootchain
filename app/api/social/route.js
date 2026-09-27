import { NextResponse } from 'next/server';
import {
  findUserByCode,
  appendSocialPost,
  listSocialPosts,
  listSocialProfiles,
  setSocialProfile,
  followOperator,
  unfollowOperator,
  listFollows,
  listOperators,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Rootchain Social — the operators' feed inside the terminal.
 *
 * GET  /api/social?username=&code=
 *        -> { ok, rev, authed, posts, profiles, follows, me }
 *      · posts     [ {seq, at, username, text, replyTo} ]
 *      · profiles  { lower: {username, bio, ascii} }
 *      · follows   { lower: { followers, following } }   — per-operator counts
 *      · me        { bio, ascii, following: [lower…] }   — null when unauthenticated
 *
 * POST /api/social { username, code, action, ... }
 *      · 'post'    { text }
 *      · 'reply'   { replyTo: <seq>, text }
 *      · 'profile' { bio? , ascii? }
 *      · 'follow'  { target: <username> }   · 'unfollow' { target }
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

  const [posts, profiles, edges] = await Promise.all([listSocialPosts(), listSocialProfiles(), listFollows()]);

  const follows = {};
  const bump = (name, field) => {
    const key = String(name).toLowerCase();
    follows[key] = follows[key] || { followers: 0, following: 0 };
    follows[key][field] += 1;
  };
  for (const e of edges) {
    bump(e.followee, 'followers');
    bump(e.follower, 'following');
  }

  const mine = me ? profiles[me.username.toLowerCase()] : null;
  return NextResponse.json({
    ok: true,
    rev: 3, // deploy marker — bumped when store behaviour changes
    authed: Boolean(me),
    posts,
    profiles,
    follows,
    followEdges: edges,
    me: me
      ? {
          bio: mine?.bio || '',
          ascii: mine?.ascii || '',
          following: edges.filter((e) => e.follower === me.username.toLowerCase()).map((e) => e.followee),
        }
      : null,
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

  if (body.action === 'follow' || body.action === 'unfollow') {
    const targetName = String(body.target || '').trim();
    const operators = await listOperators();
    const match = operators.map((o) => o.username).find((name) => name.toLowerCase() === targetName.toLowerCase());
    if (!match) {
      return NextResponse.json({ ok: false, error: 'No registered operator by that name.' }, { status: 404 });
    }
    const lower = match.toLowerCase();
    const result = body.action === 'follow'
      ? await followOperator(user.username.toLowerCase(), lower)
      : await unfollowOperator(user.username.toLowerCase(), lower);
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true, target: match, following: result.following });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
