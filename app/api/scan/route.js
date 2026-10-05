import { NextResponse } from 'next/server';
import { findUserByCode } from '@/lib/store';
import { callChatApi, callMcp, sanitizeConnector } from '@/lib/connector';
import { gatherEvidence, heuristicVerdict } from '@/lib/scanner';

export const dynamic = 'force-dynamic';

const JUDGE_SYSTEM = [
  'You are the contract scanner of Rootchain Terminal. You receive JSON evidence about a Solana token:',
  'market data (dexscreener), on-chain state (supply, top holders, mint/freeze authorities), GitHub search',
  'results and socials. Judge how risky this contract is for a buyer. Be sceptical but fair — missing data',
  'is not proof of a scam. Output STRICTLY this format, nothing else:',
  'VERDICT: SAFE | CAUTION | DANGER',
  'SCORE: <integer 0-100>',
  'EVIDENCE:',
  '- <one short line per point, max 6 lines>',
  'SUMMARY: <one line, max 20 words>',
].join(' ');

function parseJudge(text) {
  const t = String(text || '');
  const verdict = (t.match(/VERDICT:\s*(SAFE|CAUTION|DANGER)/i) || [])[1]?.toUpperCase() || null;
  const score = Number((t.match(/SCORE:\s*(\d{1,3})/i) || [])[1]);
  const evidenceBlock = (t.split(/EVIDENCE:/i)[1] || '').split(/SUMMARY:/i)[0] || '';
  const evidence = evidenceBlock
    .split('\n')
    .map((l) => l.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const summary = (t.match(/SUMMARY:\s*(.+)/i) || [])[1]?.trim().slice(0, 140) || null;
  if (!verdict || !Number.isFinite(score)) return null;
  return { verdict, score: Math.max(0, Math.min(100, Math.round(score))), evidence, summary: summary || '' };
}

/**
 * POST /api/scan { username, code, action, ca?, evidence?, connector? }
 *   · scan  { ca } → gather all evidence + the keyless heuristic verdict
 *   · judge { evidence, connector } → the operator's own AI reads the
 *     evidence and writes the verdict (falls back with a clear refusal
 *     when no connector is linked — the heuristic already ran by then)
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
  const action = String(body.action || 'scan').toLowerCase();

  const user = await findUserByCode(code);
  if (!user || user.username.toLowerCase() !== username.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'Unrecognised operator code.' }, { status: 403 });
  }

  try {
    if (action === 'scan') {
      const ev = await gatherEvidence(String(body.ca || ''));
      if (ev.err) return NextResponse.json({ ok: false, error: ev.err }, { status: 400 });
      return NextResponse.json({ ok: true, evidence: ev, heuristic: heuristicVerdict(ev), rev: 1 });
    }

    if (action === 'judge') {
      const ev = body.evidence;
      if (!ev || !ev.ca) {
        return NextResponse.json({ ok: false, error: 'No evidence to judge — run a scan first.' }, { status: 400 });
      }
      const connector = sanitizeConnector(body.connector);
      if (!connector) {
        return NextResponse.json(
          { ok: false, error: 'No AI linked — the heuristic verdict stands. "connect" (any API key) enables the AI judge.' },
          { status: 400 },
        );
      }
      const prompt = `Judge this Solana token contract (evidence JSON):\n\n${JSON.stringify(ev).slice(0, 6000)}`;
      let raw;
      if (connector.type === 'mcp') {
        raw = (await callMcp(connector, { system: JUDGE_SYSTEM, prompt })).text;
      } else {
        raw = await callChatApi(
          connector,
          [
            { role: 'system', content: JUDGE_SYSTEM },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.4, maxTokens: 900 },
        );
      }
      const verdict = parseJudge(raw);
      if (!verdict) {
        return NextResponse.json(
          { ok: false, error: `The AI did not answer in verdict format — try again. (raw: ${raw.slice(0, 120)})` },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, verdict: { ...verdict, model: connector.model || connector.tool || connector.type }, rev: 1 });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Scanner failed — ${String(err.message || err).slice(0, 180)}` },
      { status: 500 },
    );
  }
}
