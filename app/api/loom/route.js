import { NextResponse } from 'next/server';
import { findUserByCode } from '@/lib/store';
import { callChatApi, callMcp, sanitizeConnector } from '@/lib/connector';
import { listLoomWeaves, readLoomWeave, saveLoomWeave, deleteLoomWeave } from '@/lib/store';
import { LOOM, dedupeCandidates } from '@/lib/loom';

export const dynamic = 'force-dynamic';

// The loom's continuation engine: one fragment per call, no preamble —
// candidates differ only through sampling temperature.
const LOOM_SYSTEM = [
  'You are the continuation engine of a loom — a terminal for weaving branching text.',
  'Continue the given text with exactly one fragment: one to three sentences (under 60 words)',
  'that flow naturally from it and take it somewhere interesting — advance the scene, twist',
  'it, or deepen it. Output only the continuation text itself: no preamble, no quoting,',
  'no commentary.',
].join(' ');

/**
 * POST /api/loom { username, code, action, … }
 *   · weave    { pathText, k, connector } → k deduped candidate continuations,
 *               generated on the operator's OWN linked AI (type "connect").
 *   · save     { name, weave } → persist under the operator
 *   · load     { name } → { weave }
 *   · ls       → saved weave names
 *   · rm       { name }
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

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }
  const owner = user.username.toLowerCase();

  try {
    if (action === 'weave') {
      const pathText = String(body.pathText || '').slice(0, 8000).trim();
      if (!pathText) {
        return NextResponse.json({ ok: false, error: 'Nothing to weave — the active path is empty.' }, { status: 400 });
      }
      const k = Math.min(Math.max(1, Number(body.k) || LOOM.CANDIDATES_DEFAULT), LOOM.CANDIDATES_MAX);
      const connector = sanitizeConnector(body.connector);
      if (!connector) {
        return NextResponse.json(
          { ok: false, error: 'No AI linked — the loom weaves on your own key. Type "connect" in the main terminal first.' },
          { status: 400 },
        );
      }

      const messages = [
        { role: 'system', content: LOOM_SYSTEM },
        { role: 'user', content: `Continue this text:\n\n${pathText}` },
      ];

      let attempts;
      let mcpTool = '';
      if (connector.type === 'mcp') {
        attempts = [];
        for (let i = 0; i < k; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const out = await callMcp(connector, { system: LOOM_SYSTEM, prompt: `Continue this text:\n\n${pathText}` });
          mcpTool = out.tool;
          attempts.push(out.text);
        }
      } else {
        attempts = await Promise.allSettled(
          Array.from({ length: k }, () =>
            callChatApi(connector, messages, { temperature: 1.0, maxTokens: 900 }),
          ),
        );
        attempts = attempts.map((r) => (r.status === 'fulfilled' ? r.value : null));
      }

      const candidates = dedupeCandidates(attempts.filter(Boolean), k);
      if (!candidates.length) {
        return NextResponse.json({ ok: false, error: 'The AI returned nothing usable — try weaving again.' }, { status: 502 });
      }
      return NextResponse.json({
        ok: true,
        candidates,
        model: connector.model || mcpTool || connector.type,
        rev: 1,
      });
    }

    if (action === 'save') {
      const name = String(body.name || '').trim().slice(0, 40).replace(/[|/\\]/g, '-');
      const weave = body.weave;
      if (!name || name.length < 2) {
        return NextResponse.json({ ok: false, error: 'Name the weave — "save <name>" (2-40 chars).' }, { status: 400 });
      }
      if (!weave || typeof weave !== 'object' || !weave.nodes || !weave.nodes['1']) {
        return NextResponse.json({ ok: false, error: 'That weave has no root — "new <seed>" starts one.' }, { status: 400 });
      }
      if (Object.keys(weave.nodes).length > LOOM.NODES_MAX) {
        return NextResponse.json({ ok: false, error: `Weave too large (${LOOM.NODES_MAX} nodes max).` }, { status: 400 });
      }
      if (JSON.stringify(weave).length > LOOM.WEAVE_JSON_MAX) {
        return NextResponse.json({ ok: false, error: 'Weave too heavy to store — trim some branches.' }, { status: 400 });
      }
      await saveLoomWeave(owner, name, weave, user.username);
      return NextResponse.json({ ok: true, text: `weave "${name}" saved (${Object.keys(weave.nodes).length} nodes).` });
    }

    if (action === 'load') {
      const name = String(body.name || '').trim().slice(0, 40);
      const doc = await readLoomWeave(owner, name);
      if (!doc) {
        return NextResponse.json({ ok: false, error: `No saved weave "${name}" — "ls" lists yours.` }, { status: 404 });
      }
      return NextResponse.json({ ok: true, weave: { ...doc.weave, name } });
    }

    if (action === 'ls') {
      const weaves = await listLoomWeaves(owner);
      return NextResponse.json({ ok: true, weaves });
    }

    if (action === 'rm') {
      const name = String(body.name || '').trim().slice(0, 40);
      await deleteLoomWeave(owner, name);
      return NextResponse.json({ ok: true, text: `weave "${name}" deleted.` });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Loom failed — ${String(err.message || err).slice(0, 240)}` },
      { status: 500 },
    );
  }
}
