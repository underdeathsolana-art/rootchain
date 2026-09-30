import { NextResponse } from 'next/server';
import { TIMEFRAMES, fetchCandles } from '@/lib/market';

export const dynamic = 'force-dynamic';

/**
 * Market view — OHLCV candles, proxied from GeckoTerminal.
 *
 * GET /api/market/ohlcv?pair=<pool>&tf=5m|15m|1h|4h|1d&limit=
 *   -> { ok, tf, candles: [[ts, o, h, l, c, volume], …] oldest → newest }
 *
 * GeckoTerminal keys pools by exact address casing; fetchCandles normalises
 * through Dexscreener first, so callers can pass whatever casing they hold.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const pair = (searchParams.get('pair') || '').trim();
  const tf = searchParams.get('tf') || '';
  const limit = searchParams.get('limit') || '';

  if (!pair) return NextResponse.json({ ok: false, error: 'Missing pair.' }, { status: 400 });
  if (tf && !TIMEFRAMES[tf]) {
    return NextResponse.json({ ok: false, error: `Unknown timeframe "${tf}" — use one of ${Object.keys(TIMEFRAMES).join(', ')}.` }, { status: 400 });
  }

  const candles = await fetchCandles(pair, tf || undefined, limit || undefined);
  if (!candles) {
    return NextResponse.json({ ok: false, error: 'No candles for this pool yet — GeckoTerminal has not indexed it.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, tf: tf || '15m', candles });
}
