import { NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { findUserByCode, getOperatorIdentity, saveOperatorIdentity } from '@/lib/store';

export const dynamic = 'force-dynamic';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const JWKS = createRemoteJWKSet(new URL('https://auth.privy.io/.well-known/jwks.json'));

/**
 * Operator identity — Privy-verified X (Twitter) handle and wallet addresses.
 *
 * GET  /api/identity?username=&code=  → the operator's saved identity
 * POST /api/identity { username, code, token, action?: 'clear' }
 *   · token is the client's Privy access token. It is verified against
 *     Privy's JWKS (iss privy.io, aud = app id), then the CLAIMED identity
 *     is never trusted — the linked accounts are read straight from
 *     Privy's REST API with the server-side app secret.
 *   -> { ok, identity }
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get('username') || '').slice(0, 24);
  const code = (searchParams.get('code') || '').toUpperCase();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }
  const identity = await getOperatorIdentity(user.username.toLowerCase());
  return NextResponse.json({ ok: true, identity, configured: Boolean(PRIVY_APP_ID && PRIVY_APP_SECRET) });
}

function pickUserId(payload) {
  return payload.userId || payload.sub || payload['https://privy.io/user_id'] || null;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const username = String(body.username || '').slice(0, 24);
  const code = String(body.code || '').toUpperCase();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }
  const owner = user.username.toLowerCase();

  if ((body.action || '').toLowerCase() === 'clear') {
    await saveOperatorIdentity(owner, { username: user.username, twitter: null, wallets: [], privyUserId: null, updatedAt: new Date().toISOString() });
    return NextResponse.json({ ok: true, identity: null });
  }

  const token = String(body.token || '');
  if (!token) {
    return NextResponse.json({ ok: false, error: 'No Privy session token — connect X or a wallet first.' }, { status: 400 });
  }
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
    return NextResponse.json(
      { ok: false, error: 'Identity layer not configured (missing Privy env vars on this deploy).' },
      { status: 503 },
    );
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: 'privy.io', audience: PRIVY_APP_ID });
    const userId = pickUserId(payload);
    if (!userId) return NextResponse.json({ ok: false, error: 'Privy token carries no user id.' }, { status: 401 });

    // Read the linked accounts from Privy itself — the client never supplies them.
    const auth = Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64');
    const res = await fetch(`https://api.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Basic ${auth}`, 'privy-app-id': PRIVY_APP_ID },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Privy API refused (${res.status}).` }, { status: 502 });
    }
    const privyUser = await res.json();
    const accounts = privyUser.linked_accounts || privyUser.linkedAccounts || [];

    const tw = accounts.find((a) => a.type === 'twitter_oauth' || a.type === 'twitter') || null;
    const twitter = tw
      ? {
          username: tw.username || tw.handle || null,
          name: tw.name || null,
          subject: tw.subject || tw.id || null,
        }
      : null;

    const wallets = accounts
      .filter((a) => a.type === 'wallet' && a.address)
      .slice(0, 4)
      .map((a) => ({
        address: a.address,
        chainType: a.chain_type || a.chainType || null,
        embedded: (a.wallet_client_type || a.walletClientType || '') === 'privy',
      }));

    const doc = {
      username: user.username,
      twitter,
      wallets,
      privyUserId: privyUser.id || userId,
      updatedAt: new Date().toISOString(),
    };
    await saveOperatorIdentity(owner, doc);
    return NextResponse.json({ ok: true, identity: doc });
  } catch (err) {
    const msg = String(err.message || err);
    if (/JWTExpired|exp/i.test(msg)) {
      return NextResponse.json({ ok: false, error: 'Privy session expired — reconnect X or the wallet.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: `Identity verification failed — ${msg.slice(0, 160)}` }, { status: 401 });
  }
}
