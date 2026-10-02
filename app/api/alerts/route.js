import { NextResponse } from 'next/server';
import { findUserByCode } from '@/lib/store';
import {
  listAlerts,
  addAlert,
  delAlert,
  clearAlerts,
  listWatch,
  addWatch,
  delWatch,
  clearWatch,
  evaluateAlerts,
} from '@/lib/alerts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/alerts?username=&code=
 *   The 15-second poll: evaluate every armed alert against the live feed,
 *   stamp+persist the ones that crossed and return them exactly once.
 *   -> { ok, fired: [ { symbol, op, target, price, at } ] }
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get('username') || '').slice(0, 24);
  const code = (searchParams.get('code') || '').toUpperCase();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }

  try {
    const { fired } = await evaluateAlerts(user);
    return NextResponse.json({ ok: true, fired, rev: 1 });
  } catch {
    return NextResponse.json({ ok: false, error: 'alert desk unreachable.' }, { status: 500 });
  }
}

/**
 * POST /api/alerts { username, code, action, token?, op?, target?, id? }
 *   · action: alerts | alert-add | alert-del | alert-clear
 *             watch | watch-add | watch-del | watch-clear
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
  const action = String(body.action || '').toLowerCase();
  const token = String(body.token || '').slice(0, 120);
  const op = String(body.op || '').slice(0, 2);
  const target = String(body.target || '').slice(0, 24);
  const id = String(body.id || '').slice(0, 8);

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }

  try {
    let result;
    switch (action) {
      case 'alert-add':
        result = await addAlert(user, token, op, target);
        break;
      case 'alert-del':
        result = await delAlert(user, id);
        break;
      case 'alert-clear':
        result = await clearAlerts(user);
        break;
      case 'watch':
        result = await listWatch(user);
        break;
      case 'watch-add':
        result = await addWatch(user, token);
        break;
      case 'watch-del':
        result = await delWatch(user, id);
        break;
      case 'watch-clear':
        result = await clearWatch(user);
        break;
      case 'alerts':
      default:
        result = await listAlerts(user);
        break;
    }
    if (result.ok) return NextResponse.json({ ok: true, text: result.text, rev: 1 });
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, error: 'the alert desk jammed — try again.' }, { status: 500 });
  }
}
