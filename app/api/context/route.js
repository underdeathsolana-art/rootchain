import { NextResponse } from 'next/server';
import { findUserByCode, readAgentContext, setAgentContext } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Per-operator agent context — the skill.md / readme.md pair that shapes how
 * Root & Chain talk once the operator links their own AI.
 *
 * GET  /api/context?username=&code=        -> { ok, authed, skill, readme, updatedAt }
 * POST /api/context { username, code, file: 'skill'|'readme', content }
 *                                         -> { ok, file, bytes, updatedAt }
 * The operator is resolved from the access code, exactly like the relay.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const username = (searchParams.get('username') || '').slice(0, 40);
  const code = (searchParams.get('code') || '').toUpperCase();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 401 });
  }

  const context = await readAgentContext(user.username.toLowerCase());
  return NextResponse.json({ ok: true, authed: true, ...context });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const user = await findUserByCode(String(body.code || '').toUpperCase());
  if (
    !user ||
    user.username.toLowerCase() !== String(body.username || '').trim().toLowerCase()
  ) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 401 });
  }

  const file = body.file === 'readme' ? 'readme' : body.file === 'skill' ? 'skill' : null;
  if (!file) {
    return NextResponse.json({ ok: false, error: "file must be 'skill' or 'readme'." }, { status: 400 });
  }
  if (typeof body.content !== 'string') {
    return NextResponse.json({ ok: false, error: 'content must be a string.' }, { status: 400 });
  }

  const context = await setAgentContext(user.username.toLowerCase(), file, body.content);
  return NextResponse.json({
    ok: true,
    file,
    bytes: context[file].length,
    updatedAt: context.updatedAt,
  });
}
