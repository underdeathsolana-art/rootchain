import { NextResponse } from 'next/server';
import { DEFAULT_PAIR, parseMarketArg, fetchPair, fetchPairForToken } from '@/lib/market';

export const dynamic = 'force-dynamic';

/**
 * Market view — pair stats for the dexview terminal.
 *
 * GET /api/market?pair=<pool address | token CA | dexscreener URL>
 *      · empty pair → the terminal's default pool (RTC/SOL)
 *      · a pool address is tried first; if nothing answers we treat the
 *        argument as a token CA and resolve its most liquid Solana pool
 *   -> { ok, rev, pair: { pairAddress, url, dexId, base, quote, priceUsd,
 *                          priceNative, liquidity, marketCap, fdv, volume,
 *                          txns, priceChange, pairCreatedAt } }
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('pair') || '';
  const addr = parseMarketArg(raw) || DEFAULT_PAIR;

  let pair = await fetchPair(addr);
  if (!pair) pair = await fetchPairForToken(addr);

  if (!pair) {
    return NextResponse.json(
      { ok: false, error: `No Solana pool found for "${raw.slice(0, 60)}". Paste a dexscreener link, a pool address or a token CA.` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, rev: 1, pair });
}
