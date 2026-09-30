// Market view plumbing — shared by /api/market* routes and the dexview
// terminal. Pair stats come from Dexscreener's public endpoints, candles from
// GeckoTerminal's OHLCV API (both keyless). Everything is cached briefly so
// the terminal can poll without hammering anyone.

// RTC/SOL on pumpfun — the pool this terminal shows by default. Case matters:
// GeckoTerminal keys pools by the exact on-chain address casing.
export const DEFAULT_PAIR = 'BaUPKvMVsXahPq768StAZZrJ2aoKbw4LK6pmoPZUbcSG';

// tf label → [gecko timeframe, aggregate]
export const TIMEFRAMES = {
  '5m': ['minute', 5],
  '15m': ['minute', 15],
  '1h': ['hour', 1],
  '4h': ['hour', 4],
  '1d': ['day', 1],
};
export const DEFAULT_TF = '15m';

const DEX_TTL = 15_000; // pair stats move fast; 15s keeps the header honest
const OHLCV_TTL = 30_000;
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

/** Pair stats by pool address (Dexscreener keeps the canonical casing). */
export function fetchPair(pairAddress) {
  const key = `pair:${pairAddress}`;
  return cached(key, DEX_TTL, async () => {
    const data = await getJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
    const pair = normalizePair(data?.pairs?.[0] || data?.pair || null);
    // pumpfun pairs stopped reporting liquidity on Dexscreener — GeckoTerminal
    // still knows the pool's reserves, so we fill the gap from there.
    if (pair && !pair.liquidity) {
      const gecko = await cached(`gecko:${pair.pairAddress}`, 60_000, async () => {
        const pool = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pair.pairAddress}`);
        const reserve = Number(pool?.data?.attributes?.reserve_in_usd);
        return Number.isFinite(reserve) ? reserve : null;
      });
      if (gecko != null) pair.liquidity = gecko;
    }
    return pair;
  });
}

/** Resolve a token CA to its most liquid Solana pool. */
export function fetchPairForToken(ca) {
  const key = `token:${ca}`;
  return cached(key, 60_000, async () => {
    const list = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${ca}`);
    const solana = Array.isArray(list) ? list.filter((p) => p.chainId === 'solana') : [];
    if (!solana.length) return null;
    solana.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return normalizePair(solana[0]);
  });
}

/** OHLCV candles for a pool: [[ts, o, h, l, c, volume], …] oldest → newest. */
export function fetchCandles(pairAddress, tf = DEFAULT_TF, limit = 180) {
  const spec = TIMEFRAMES[tf] || TIMEFRAMES[DEFAULT_TF];
  const cap = Math.min(Math.max(10, Number(limit) || 180), 500);
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
    return Array.isArray(list) && list.length ? list : null;
  });
}
