import { NextResponse } from 'next/server';
import { sanitizeConnector, testConnector } from '@/lib/connector';

export const dynamic = 'force-dynamic';

/**
 * POST /api/connector
 *   { action: 'test', connector } -> { ok, detail, tools?, picked? } | { ok:false, error }
 * Probes a user-supplied AI connector. Credentials pass through memory only.
 */
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  if (body.action !== 'test') {
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  const connector = sanitizeConnector(body.connector);
  if (!connector) {
    return NextResponse.json({
      ok: false,
      error: 'Enter a valid http(s) URL' + (body.connector?.type === 'openai' ? ' and a model name.' : '.'),
    });
  }

  try {
    const result = await testConnector(connector);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err.message || err).slice(0, 300) });
  }
}
