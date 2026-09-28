export const dynamic = 'force-dynamic';

/**
 * ROOTIDE git relay — the browser's git client (isomorphic-git) cannot talk
 * to github.com directly (no CORS on git smart-HTTP), so it sends its
 * requests here and this route forwards them server-side. Strictly limited
 * to https://github.com/... so it can never be used as an open proxy.
 */
function allowedTarget(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com';
  } catch {
    return false;
  }
}

async function relay(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('u');
  if (!target || !allowedTarget(target)) {
    return new Response('Blocked — only https://github.com URLs can be relayed.', { status: 403 });
  }

  const method = req.method === 'POST' ? 'POST' : 'GET';
  const headers = {
    'User-Agent': 'rootchain-rootide/1.0',
    Accept: req.headers.get('accept') || '*/*',
  };
  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  let body;
  if (method === 'POST') body = await req.arrayBuffer();

  try {
    const res = await fetch(target, { method, headers, body, cache: 'no-store', redirect: 'follow' });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(`Relay failed: ${String(err.message || err).slice(0, 160)}`, { status: 502 });
  }
}

export async function GET(req) {
  return relay(req);
}

export async function POST(req) {
  return relay(req);
}
