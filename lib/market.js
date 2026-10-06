// Market view plumbing — shared by /api/market* routes and the dexview
// terminal. Pair stats come from Dexscreener's public endpoints with
// GeckoTerminal as a full fallback (Dexscreener delists quiet pumpfun pools;
// Gecko keeps them), candles from GeckoTerminal's OHLCV API (both keyless).
// Everything is cached briefly so the terminal can poll without hammering anyone.

// RTC/SOL on pumpfun — the pool this terminal shows by default. Case matters:
// GeckoTerminal keys pools by the exact on-chain address casing.
export const DEFAULT_PAIR = 'BaUPKvMVsXahPq768StAZZrJ2aoKbw4LK6pmoPZUbcSG';

// tf label → [gecko timeframe, aggregate] — ordered oldest→finest like dex charts
// ('second' exists but is paid-plan only on GeckoTerminal)
export const TIMEFRAMES = {
  '1m': ['minute', 1],
  '5m': ['minute', 5],
  '15m': ['minute', 15],
  '1h': ['hour', 1],
  '4h': ['hour', 4],
  '1d': ['day', 1],
};
export const DEFAULT_TF = '1m';

const DEX_TTL = 15_000; // pair stats move fast; 15s keeps the header honest
const OHLCV_TTL = 15_000; // matches the terminal's candle poll — live feel, still ~4 upstream calls/min per timeframe
const cache = new Map(); // key → { at, value }

function cached(key, ttl, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = produce();
  // settle before caching so a failed upstream call retries on the next poll
  value.then(() => cache.set(key, { at: Date.now(), value })).catch(() => {});
  return value;
}

/**
 * Accept anything an operator might paste — a dexscreener/geckoterminal URL,
 * a bare pool address, or a token CA — and reduce it to a base58 address.
 * Returns '' when nothing address-shaped is in there.
 */
export function parseMarketArg(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const url = text.match(/(?:dexscreener\.com|geckoterminal\.com)\/[a-z]+\/([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  if (url) return url[1];
  const bare = text.match(/^([1-9A-HJ-NP-Za-km-z]{32,44})$/);
  return bare ? bare[1] : '';
}

function normalizePair(p) {
  if (!p) return null;
  return {
    pairAddress: p.pairAddress,
    url: p.url,
    dexId: p.dexId,
    chainId: p.chainId,
    base: p.baseToken,
    quote: p.quoteToken,
    priceNative: Number(p.priceNative),
    priceUsd: Number(p.priceUsd),
    liquidity: p.liquidity?.usd ?? 0,
    marketCap: p.marketCap ?? null,
    fdv: p.fdv ?? null,
    volume: p.volume || {},
    txns: p.txns || {},
    priceChange: p.priceChange || {},
    pairCreatedAt: p.pairCreatedAt ?? null,
    info: p.info || null, // websites + socials from dexscreener token profiles
    source: 'dexscreener',
  };
}

/**
 * Map a GeckoTerminal pool record (+ its included tokens) into the same pair
 * shape normalizePair produces. Dexscreener silently drops pumpfun pools it no
 * longer indexes — Gecko keeps them, so it backs the whole feed up.
 */
function pairFromGecko(pool, included = []) {
  if (!pool?.attributes) return null;
  const a = pool.attributes;
  const byRel = (rel) => {
    const id = pool.relationships?.[rel]?.data?.id || '';
    const meta = included.find((t) => t?.id === id && t.type === 'token')?.attributes || {};
    const addr = id.startsWith('solana_') ? id.slice('solana_'.length) : a.address;
    return { address: addr, name: meta.name || addr, symbol: meta.symbol || '?' };
  };
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const mapWindows = (obj) => Object.fromEntries(
    Object.entries(obj || {}).map(([k, v]) => [k, typeof v === 'object' ? { buys: v?.buys ?? 0, sells: v?.sells ?? 0 } : Number(v)]),
  );
  const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
  return {
    pairAddress: a.address,
    url: `https://www.geckoterminal.com/solana/pools/${a.address}`,
    dexId: pool.relationships?.dex?.data?.id || 'geckoterminal',
    chainId: 'solana',
    base: byRel('base_token'),
    quote: byRel('quote_token'),
    priceNative: Number(a.base_token_price_quote_token),
    priceUsd: Number(a.base_token_price_usd),
    liquidity: Number(a.reserve_in_usd) || 0,
    marketCap: num(a.market_cap_usd),
    fdv: num(a.fdv_usd),
    volume: mapWindows(a.volume_usd),
    txns: mapWindows(a.transactions),
    priceChange: mapWindows(a.price_change_percentage),
    pairCreatedAt: Number.isFinite(created) ? created : null,
    info: null,
    source: 'geckoterminal',
  };
}

async function getJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'rootchain-terminal/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Gecko's reserve_in_usd for a pool — the liquidity fallback for pumpfun pairs. */
function geckoReserve(pairAddress) {
  return cached(`gecko:${pairAddress}`, 60_000, async () => {
    const pool = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}`);
    const reserve = Number(pool?.data?.attributes?.reserve_in_usd);
    return Number.isFinite(reserve) ? reserve : null;
  });
}

/** Full pair record straight from GeckoTerminal (pool detail + token profiles). */
export function fetchGeckoPair(pairAddress) {
  return cached(`geckopair:${pairAddress}`, DEX_TTL, async () => {
    const data = await getJson(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}?include=base_token,quote_token`,
    );
    return pairFromGecko(data?.data, data?.included || []);
  });
}

/** Pair stats by pool address (Dexscreener keeps the canonical casing). */
export function fetchPair(pairAddress) {
  const key = `pair:${pairAddress}`;
  return cached(key, DEX_TTL, async () => {
    const data = await getJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
    const pair = normalizePair(data?.pairs?.[0] || data?.pair || null);
    // pumpfun pairs stopped reporting liquidity on Dexscreener — GeckoTerminal
    // still knows the pool's reserves, so we fill the gap from there.
    if (pair && !pair.liquidity) {
      const gecko = await geckoReserve(pair.pairAddress);
      if (gecko != null) pair.liquidity = gecko;
    }
    // Dexscreener also stops returning some pumpfun pools outright — fall
    // back to Gecko's own pool record so the terminal keeps its feed.
    return pair || (await fetchGeckoPair(pairAddress));
  });
}

/** Resolve a token CA to its most liquid Solana pool. */
export function fetchPairForToken(ca) {
  const key = `token:${ca}`;
  return cached(key, 60_000, async () => {
    const list = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${ca}`);
    const solana = Array.isArray(list) ? list.filter((p) => p.chainId === 'solana') : [];
    if (solana.length) {
      solana.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const pair = normalizePair(solana[0]);
      // pumpfun pairs report no liquidity on Dexscreener — fill from Gecko,
      // exactly like the pool-address path does, so CA lookups stay honest.
      if (pair && !pair.liquidity) {
        const gecko = await geckoReserve(pair.pairAddress);
        if (gecko != null) pair.liquidity = gecko;
      }
      if (pair) return pair;
    }
    // Same fallback as the pool path: Dexscreener delists quiet pumpfun
    // tokens entirely, but Gecko still maps the CA to its pools.
    const geo = await getJson(
      `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${ca}/pools?include=base_token,quote_token`,
    );
    const pools = (geo?.data || []).filter((p) => p?.attributes?.address);
    pools.sort((a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0));
    return pools.length ? pairFromGecko(pools[0], geo.included || []) : null;
  });
}

/** OHLCV candles for a pool: [[ts, o, h, l, c, volume], …] oldest → newest. */
export function fetchCandles(pairAddress, tf = DEFAULT_TF, limit = 240) {
  const spec = TIMEFRAMES[tf] || TIMEFRAMES[DEFAULT_TF];
  const cap = Math.min(Math.max(10, Number(limit) || 240), 500);
  const key = `ohlcv:${pairAddress}:${tf}:${cap}`;
  return cached(key, OHLCV_TTL, async () => {
    // GeckoTerminal 404s on lowercased addresses — Dexscreener's casing is canonical.
    const addr = pairAddress === pairAddress.toLowerCase()
      ? (await fetchPair(pairAddress))?.pairAddress || pairAddress
      : pairAddress;
    const data = await getJson(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${addr}/ohlcv/${spec[0]}?aggregate=${spec[1]}&limit=${cap}`,
    );
    // Gecko nests the payload: { data: { attributes: { ohlcv_list: [...] } } }
    const list = data?.data?.attributes?.ohlcv_list || data?.attributes?.ohlcv_list;
    // Gecko ships newest→oldest; a chart reads oldest→newest.
    return Array.isArray(list) && list.length ? list.slice().sort((a, b) => a[0] - b[0]) : null;
  });
}
