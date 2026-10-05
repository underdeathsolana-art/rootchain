import { NextResponse } from 'next/server';
import {
  findUserByCode,
  getOperatorIdentity,
  appendShare,
  listShares,
  getShare,
  SHARE_LIMITS,
} from '@/lib/store';
import { LOOM, treeLines, activePath } from '@/lib/loom';
import { age } from '@/lib/format';

export const dynamic = 'force-dynamic';

const KIND_LABEL = { loom: 'LOOM', conversation: 'AGENT TALK', text: 'NOTE' };

function byline(share) {
  const id = share.identity;
  const via = id?.twitter?.username ? ` (@${id.twitter.username})` : '';
  return `${share.username}${via}`;
}

function renderShare(share) {
  const head = [
    `SHARE #${share.seq} — ${KIND_LABEL[share.kind] || share.kind}`,
    `  by ${byline(share)} · ${age(share.at)}`,
    share.title ? `  "${share.title}"` : null,
    '',
  ].filter((l) => l !== null);

  if (share.kind === 'loom' && share.payload?.nodes) {
    const w = share.payload;
    return [
      ...head,
      'ACTIVE PATH —',
      ...activePath(w).map((n) => `  ${n.text}`),
      '',
      'BRANCH TREE —',
      ...treeLines(w),
    ].join('\n');
  }

  if (share.kind === 'conversation' && Array.isArray(share.payload?.lines)) {
    return [...head, ...share.payload.lines.map((l) => `  ${l.tag}: ${l.text}`)].join('\n');
  }

  return [...head, String(share.payload?.text || '').slice(0, SHARE_LIMITS.TEXT_MAX)].join('\n');
}

/**
 * POST /api/shares { username, code, action, … }
 *   · share-loom  { title?, name?, weave }          → publish the rtc-loom
 *   · share-conv  { title?, lines: [{tag,text}] }   → publish an agent-talk snapshot
 *   · share-text  { text }                          → publish a plain note
 *   · list                                        → recent shares (text block)
 *   · open        { id }                            → full share, ready to print
 *     (open of a loom also returns `weave` so "pull" can load it)
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
  const action = String(body.action || 'list').toLowerCase();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }
  const owner = user.username.toLowerCase();

  try {
    if (action === 'share-loom') {
      const weave = body.weave;
      if (!weave || typeof weave !== 'object' || !weave.nodes || !weave.nodes['1']) {
        return NextResponse.json({ ok: false, error: 'That loom has no root — weave one first.' }, { status: 400 });
      }
      if (Object.keys(weave.nodes).length > LOOM.NODES_MAX || JSON.stringify(weave).length > LOOM.WEAVE_JSON_MAX) {
        return NextResponse.json({ ok: false, error: 'Loom too large to share — trim some branches.' }, { status: 400 });
      }
      const title = String(body.title || body.name || 'untitled loom').slice(0, SHARE_LIMITS.TITLE_MAX);
      const identity = await getOperatorIdentity(owner);
      const share = await appendShare(user, 'loom', title, weave, identity);
      return NextResponse.json({
        ok: true,
        text: `SHARED — loom #${share.seq} "${title}" is on the wire. Other operators read it with "share open ${share.seq}", or pull it into their loom.`,
      });
    }

    if (action === 'share-conv') {
      const lines = Array.isArray(body.lines)
        ? body.lines
            .filter((l) => l && typeof l.text === 'string' && l.text.trim())
            .slice(-SHARE_LIMITS.LINES_MAX)
            .map((l) => ({ tag: String(l.tag || 'AGENT').slice(0, 16), text: l.text.slice(0, 400) }))
        : [];
      if (!lines.length) {
        return NextResponse.json({ ok: false, error: 'Nothing to share — the agent channel is empty.' }, { status: 400 });
      }
      const title = String(body.title || `agent talk · ${lines.length} turns`).slice(0, SHARE_LIMITS.TITLE_MAX);
      const identity = await getOperatorIdentity(owner);
      const share = await appendShare(user, 'conversation', title, { lines }, identity);
      return NextResponse.json({
        ok: true,
        text: `SHARED — conversation #${share.seq} "${title}" is on the wire. Read it with "share open ${share.seq}".`,
      });
    }

    if (action === 'share-text') {
      const text = String(body.text || '').trim().slice(0, SHARE_LIMITS.TEXT_MAX);
      if (!text) {
        return NextResponse.json({ ok: false, error: 'Nothing to share — give the note some text.' }, { status: 400 });
      }
      const title = text.replace(/\s+/g, ' ').slice(0, 40);
      const identity = await getOperatorIdentity(owner);
      const share = await appendShare(user, 'text', title, { text }, identity);
      return NextResponse.json({
        ok: true,
        text: `SHARED — note #${share.seq} is on the wire. Read it with "share open ${share.seq}".`,
      });
    }

    if (action === 'open') {
      const share = await getShare(Number(body.id));
      if (!share) {
        return NextResponse.json({ ok: false, error: `No share #${body.id} — "shares" lists the wire.` }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        text: renderShare(share),
        kind: share.kind,
        weave: share.kind === 'loom' ? share.payload : undefined,
        title: share.title,
      });
    }

    // list
    const shares = await listShares(20);
    if (!shares.length) {
      return NextResponse.json({
        ok: true,
        text: 'THE WIRE — no shares yet. Publish with "share conv", "share text <note>" or "share" inside the rtc-loom.',
      });
    }
    const lines = ['THE WIRE — recent shares', ...shares.map((s) => {
      const via = s.identity?.twitter?.username ? ` (@${s.identity.twitter.username})` : '';
      return `  #${s.seq}. [${KIND_LABEL[s.kind] || s.kind}] "${s.title}" — ${s.username}${via} · ${age(s.at)}`;
    })];
    return NextResponse.json({ ok: true, text: lines.join('\n'), shares });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Wire failed — ${String(err.message || err).slice(0, 160)}` },
      { status: 500 },
    );
  }
}
