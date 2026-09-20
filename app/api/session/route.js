import { NextResponse } from 'next/server';
import { register, login } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * POST /api/session
 *   { action: 'register', username } -> { ok, username, code, existing }
 *   { action: 'login',    code }     -> { ok, username, code }
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  if (body.action === 'register') {
    return NextResponse.json(register(body.username));
  }

  if (body.action === 'login') {
    return NextResponse.json(login(body.code));
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
