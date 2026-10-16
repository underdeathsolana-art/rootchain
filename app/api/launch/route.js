import { NextResponse } from 'next/server';
import { findUserByCode } from '@/lib/store';
import { sanitizeConnector, callChatApi, callMcp } from '@/lib/connector';

/**
 * Rootchain Launchpad · server route.
 *
 * Three jobs — everything else is denied:
 *   POST /api/launch?rpc=1   authenticated, rate-limited JSON-RPC proxy for
 *                            the browser launch flow (whitelisted Solana
 *                            methods only; upstream = SOLANA_RPC_URL or the
 *                            public mainnet RPC)
 *   POST /api/launch (action=meta)    validate + pin token image and metadata
 *                            JSON to IPFS via Pinata (PINATA_JWT env). Image
 *                            bytes never touch our disk; the private key of
 *                            the mint never touches this server at all.
 *   POST /api/launch (action=coin)    proxy pump.fun coin data for the
 *                            post-launch panel (their API is CORS-locked).
 *
 * Auth matches every other rootchain API: username + access code in the
 * request (body for actions, headers for the RPC proxy), verified with
 * findUserByCode. Rate limits are in-memory best effort (per serverless
 * instance) and protect the paid/resource-heavy endpoints.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UPSTREAM_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const PINATA_JWT = process.env.PINATA_JWT || '';
const PINATA_GATEWAY = (process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/+$/, '');

const RPC_METHOD_ALLOWLIST = new Set([
  'getLatestBlockhash',
  'getAccountInfo',
  'getMultipleAccounts',
  'getSignatureStatuses',
  'getSignatureConfirmations',
  'getTransaction',
  'getSlot',
  'getEpochInfo',
  'getVersion',
  'getBlockHeight',
  'getBalance',
  'getFeeForMessage',
  'getPriorityFeeEstimate',
  'getMinimumBalanceForRentExemption',
  'sendTransaction', // signed transaction relay — cannot be forged server-side
]);

const RPC_BODY_LIMIT = 512 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// 4MB: Vercel caps request bodies at 4.5MB — keep our own limit under it so
// oversized images get OUR error, not an opaque edge 413.
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/* ------------------------------ rate limits ------------------------------ */
// best-effort sliding windows (Map per warm serverless instance)
const buckets = new Map();
function rateLimit(kind, key, limit, windowMs) {
  const now = Date.now();
  const id = kind + ':' + key;
  let arr = buckets.get(id) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(id, arr);
    return false;
  }
  arr.push(now);
  buckets.set(id, arr);
  if (buckets.size > 5000) buckets.clear(); // crude memory guard
  return true;
}

function clientKey(req) {
  const h = req.headers;
  return (
    h.get('x-forwarded-for') ||
    h.get('x-real-ip') ||
    (h.get('cf-connecting-ip') || 'local')
  );
}

/* --------------------------------- auth ---------------------------------- */

async function authOperator(username, code) {
  const u = String(username || '').trim();
  const c = String(code || '').trim();
  if (!u || !c) return null;
  try {
    const user = await findUserByCode(c);
    if (!user) return null;
    if (String(user.username).toLowerCase() !== u.toLowerCase()) return null;
    return user;
  } catch (_) {
    return null;
  }
}

const denied = (error, status = 403) => NextResponse.json({ ok: false, error }, { status });

/* ------------------------------- RPC proxy ------------------------------- */

async function handleRpcProxy(req) {
  if (!rateLimit('rpc', clientKey(req), 90, 60_000)) {
    return denied('RPC proxy is rate-limited — slow down.', 429);
  }

  const username = decodeURIComponent(req.headers.get('x-rc-user') || '');
  const code = decodeURIComponent(req.headers.get('x-rc-code') || '');
  if (!(await authOperator(username, code))) return denied('Unrecognised operator code.');

  let body;
  try {
    const raw = await req.text();
    if (raw.length > RPC_BODY_LIMIT) return denied('RPC payload too large.', 413);
    body = JSON.parse(raw);
  } catch (_) {
    return denied('malformed RPC request', 400);
  }
  if (!body || typeof body.method !== 'string' || !RPC_METHOD_ALLOWLIST.has(body.method)) {
    return denied('RPC method not allowed by the launch proxy.', 403);
  }

  try {
    const upstream = await fetch(UPSTREAM_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? 1,
        method: body.method,
        params: body.params ?? [],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return denied('upstream RPC unreachable — try again shortly', 502);
  }
}

/* ------------------------------ validation ------------------------------- */

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function normalizeTwitter(v) {
  const m = String(v || '').trim().match(/^(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,20})\/?$/i);
  return m ? `https://x.com/${m[1]}` : null;
}
function normalizeTelegram(v) {
  const m = String(v || '').trim().match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{2,64})\/?$/i);
  return m ? `https://t.me/${m[1]}` : null;
}
function normalizeWebsite(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(s) || s.length > 200) return null;
  return s;
}

/* ------------------------------ metadata pin ----------------------------- */

async function pinataFetch(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${PINATA_JWT}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text.slice(0, 180) || res.status;
    throw new Error(String(msg));
  }
  return json;
}

async function handleMeta(req) {
  if (!rateLimit('meta', clientKey(req), 4, 60 * 60_000)) {
    return denied('metadata upload quota reached — try again in an hour.', 429);
  }
  if (!PINATA_JWT) {
    return denied(
      'metadata pinning is not configured on this server (PINATA_JWT missing) — set it to enable launches.',
      503
    );
  }

  let form;
  try {
    form = await req.formData();
  } catch (_) {
    return denied('expected multipart form data', 400);
  }

  const user = await authOperator(form.get('username'), form.get('code'));
  if (!user) return denied('Unrecognised operator code.');

  const name = String(form.get('name') || '').trim();
  const symbolRaw = String(form.get('symbol') || '').trim();
  const description = String(form.get('description') || '').trim();
  const website = normalizeWebsite(form.get('website'));
  const twitter = normalizeTwitter(form.get('twitter'));
  const telegram = normalizeTelegram(form.get('telegram'));
  const image = form.get('image');

  if (!name || name.length > 32) return denied('token name must be 1–32 characters.', 400);
  if (!/^[A-Za-z0-9]{1,13}$/.test(symbolRaw)) return denied('ticker must be 1–13 letters/numbers.', 400);
  if (description.length > 500) return denied('description too long (500 max).', 400);
  if (form.get('website') && website === null) return denied('website URL looks invalid.', 400);
  if (form.get('twitter') && twitter === null) return denied('X/Twitter URL looks invalid.', 400);
  if (form.get('telegram') && telegram === null) return denied('Telegram URL looks invalid.', 400);
  if (!image || typeof image === 'string') return denied('token image is required.', 400);
  if (!IMAGE_TYPES.has(image.type)) return denied('image must be png, jpeg, gif or webp.', 400);
  if (image.size > IMAGE_MAX_BYTES) return denied('image too large — 4MB max.', 400);

  const symbol = symbolRaw.toUpperCase();

  // 1) pin the image
  let imageHash;
  try {
    const up = new FormData();
    up.append('file', image, `launch-${Date.now()}.${image.type.split('/')[1]}`);
    const pinned = await pinataFetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      body: up,
    });
    imageHash = pinned && pinned.IpfsHash;
  } catch (e) {
    return denied('image pinning failed: ' + (e && e.message ? e.message : String(e)), 502);
  }
  if (!imageHash) return denied('image pinning failed — no hash returned.', 502);

  // 2) pin the metadata JSON (the classic pump.fun metadata shape)
  const meta = {
    name,
    symbol,
    description,
    image: `ipfs://${imageHash}`,
    showName: true,
    ...(website ? { website, external_url: website } : {}),
    ...(twitter ? { twitter } : {}),
    ...(telegram ? { telegram } : {}),
  };
  if (`ipfs://${imageHash}`.length > 200) return denied('internal metadata error.', 500);

  let metaHash;
  try {
    const pinned = await pinataFetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinataContent: meta, pinataOptions: { cidVersion: 0 } }),
    });
    metaHash = pinned && pinned.IpfsHash;
  } catch (e) {
    return denied('metadata pinning failed: ' + (e && e.message ? e.message : String(e)), 502);
  }
  if (!metaHash) return denied('metadata pinning failed — no hash returned.', 502);

  const uri = `ipfs://${metaHash}`;
  return NextResponse.json({
    ok: true,
    uri,
    imageUri: `ipfs://${imageHash}`,
    gateway: `${PINATA_GATEWAY}/ipfs/${metaHash}`,
    imageGateway: `${PINATA_GATEWAY}/ipfs/${imageHash}`,
    by: String(user.username),
  });
}

/* -------------------------------- coin get ------------------------------- */

async function handleCoin(req, body) {
  if (!rateLimit('coin', clientKey(req), 30, 60_000)) return denied('coin lookup rate-limited.', 429);
  if (!(await authOperator(body.username, body.code))) return denied('Unrecognised operator code.');
  const mint = String(body.mint || '');
  if (!MINT_RE.test(mint)) return denied('invalid mint address.', 400);
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (_) {
    return denied('coin listing API unreachable', 502);
  }
}

/* --------------------------- AI co-pilot actions ------------------------- */

const GEN_SYSTEM =
  'You are a meme-coin copywriter for a Solana launchpad. Reply with ONLY minified JSON, no markdown fences, no commentary: {"name": string max 32 chars, "symbol": string 2-13 chars uppercase A-Z and digits only, "description": string max 500 chars}. Be punchy and original. No financial promises, no returns claims, no existing trademarks or famous names.';
const REVIEW_SYSTEM =
  'You review a Solana token launch configuration. Reply with ONLY minified JSON, no markdown fences, no commentary: {"verdict": "READY" | "CAUTION" | "NOT_READY", "notes": array of at most 4 short strings, each max 120 chars}. Judge name/ticker fit, description clarity, spam or scam signals, and missing optional links.';

/** Pull the first JSON object out of a model reply (tolerates fences/preamble). */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function runConnector(cfg, system, prompt, { temperature, maxTokens }) {
  if (cfg.type === 'mcp') {
    const { text } = await callMcp(cfg, { system, prompt });
    return text;
  }
  return callChatApi(cfg, [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ], { temperature, maxTokens });
}

function connectorLabel(cfg) {
  return cfg.type === 'mcp' ? cfg.tool || 'mcp tool' : cfg.model || 'model';
}

async function handleAi(req, body, action) {
  if (!rateLimit('ai', clientKey(req), 15, 60_000)) return denied('co-pilot rate-limited — slow down.', 429);
  if (!(await authOperator(body.username, body.code))) return denied('Unrecognised operator code.');

  const cfg = sanitizeConnector(body.connector);
  if (!cfg) return denied('no usable AI connector — run "connect" in the terminal first.', 400);

  try {
    let reply;
    if (action === 'ai-gen') {
      const idea = String(body.idea || '').trim().slice(0, 500);
      if (!idea) return denied('describe the token idea first.', 400);
      reply = await runConnector(cfg, GEN_SYSTEM, `Token idea: ${idea}`, { temperature: 0.9, maxTokens: 900 });
    } else {
      const t = body.token || {};
      const cfgText = JSON.stringify({
        name: String(t.name || '').slice(0, 60),
        symbol: String(t.symbol || '').slice(0, 20),
        description: String(t.description || '').slice(0, 500),
        website: String(t.website || '').slice(0, 120),
        twitter: String(t.twitter || '').slice(0, 120),
        telegram: String(t.telegram || '').slice(0, 120),
      });
      reply = await runConnector(cfg, REVIEW_SYSTEM, `Launch configuration: ${cfgText}`, { temperature: 0.3, maxTokens: 768 });
    }

    const parsed = extractJson(reply);
    if (!parsed) return denied('the AI reply was not valid JSON — try again.', 502);

    if (action === 'ai-gen') {
      const name = String(parsed.name || '').trim().slice(0, 32);
      const symbol = String(parsed.symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 13);
      const description = String(parsed.description || '').trim().slice(0, 500);
      if (!name || symbol.length < 2 || !description) {
        return denied('the AI draft was incomplete — try again with a clearer idea.', 502);
      }
      return NextResponse.json({ ok: true, draft: { name, symbol, description }, model: connectorLabel(cfg) });
    }

    const verdict = ['READY', 'CAUTION', 'NOT_READY'].includes(parsed.verdict) ? parsed.verdict : 'CAUTION';
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.slice(0, 4).map((n) => String(n).slice(0, 120)).filter(Boolean)
      : [];
    return NextResponse.json({ ok: true, review: { verdict, notes }, model: connectorLabel(cfg) });
  } catch (e) {
    const msg = String((e && e.message) || e);
    return denied(`co-pilot call failed — ${msg.slice(0, 160)}`, 502);
  }
}

/* --------------------------------- router -------------------------------- */

export async function POST(req) {
  if (req.nextUrl.searchParams.get('rpc') === '1') {
    return handleRpcProxy(req);
  }

  let body = {};
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      return handleMeta(req);
    }
    body = await req.json();
  } catch (_) {
    body = {};
  }

  switch (body.action) {
    case 'coin':
      return handleCoin(req, body);
    case 'ai-gen':
      return handleAi(req, body, 'ai-gen');
    case 'ai-review':
      return handleAi(req, body, 'ai-review');
    default:
      return denied('unknown launch action', 400);
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'rootchain-launchpad', rev: 1 });
}
