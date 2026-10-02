import { NextResponse } from 'next/server';
import { findUserByCode } from '@/lib/store';
import {
  SIM_USAGE,
  simPortfolio,
  simBuy,
  simSell,
  simReset,
  simLeaderboard,
} from '@/lib/sim';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sim { username, code, action, amount, token }
 *   The paper trading desk. The operator is resolved from the access code,
 *   so orders always land on the canonical registered wallet.
 *   · action: pos (default) | buy | sell | top | reset | help
 *   · amount: '<usd>' | 'all'        · token: pool | CA | link (default RTC)
 *   -> { ok, text } — text is a ready-to-print terminal block.
 */
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const username = String(body.username || '').slice(0, 24);
  const code = String(body.code || '').toUpperCase();
  const action = String(body.action || 'pos').toLowerCase();
  const amount = String(body.amount || '').slice(0, 16);
  const token = String(body.token || '').slice(0, 120);

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }

  try {
    let result;
    switch (action) {
      case 'buy':
        result = await simBuy(user, amount, token);
        break;
      case 'sell':
        result = await simSell(user, amount, token);
        break;
      case 'top':
        result = await simLeaderboard(user.username.toLowerCase());
        break;
      case 'reset':
        result = await simReset(user);
        break;
      case 'help':
        result = { ok: true, text: SIM_USAGE };
        break;
      case 'pos':
      default:
        result = await simPortfolio(user);
        break;
    }
    if (result.ok) return NextResponse.json({ ok: true, text: result.text, rev: 1 });
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, error: 'the desk jammed — try the order again.' }, { status: 500 });
  }
}
