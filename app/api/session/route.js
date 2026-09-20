import { NextResponse } from 'next/server';
import { findUserByCode, findUserByName, insertUser, generateCode } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/session
 *   { action: 'register', username } -> { ok, username, code, existing }
 *   { action: 'login',    code }     -> { ok, username, code }
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  if (body.action === 'register') {
    const name = String(body.username || '').trim().slice(0, 24);
    if (name.length < 2) {
      return NextResponse.json({ ok: false, error: 'Username must be at least 2 characters.' });
    }

    const existing = await findUserByName(name);
    if (existing) {
      return NextResponse.json({
        ok: true,
        username: existing.username,
        code: existing.code,
        createdAt: existing.createdAt,
        existing: true,
      });
    }

    const user = { username: name, code: generateCode(), createdAt: new Date().toISOString() };
    await insertUser(user);
    return NextResponse.json({
      ok: true,
      username: user.username,
      code: user.code,
      createdAt: user.createdAt,
      existing: false,
    });
  }

  if (body.action === 'login') {
    const user = await findUserByCode(body.code);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Access code not recognised.' });
    }
    return NextResponse.json({ ok: true, username: user.username, code: user.code, createdAt: user.createdAt });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
