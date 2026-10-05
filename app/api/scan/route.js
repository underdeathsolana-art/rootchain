import { NextResponse } from 'next/server';
import { findUserByCode } from '@/lib/store';
import { callChatApi, callMcp, sanitizeConnector } from '@/lib/connector';
import { gatherEvidence, heuristicVerdict, deepEvidence } from '@/lib/scanner';

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

const DEEP_SYSTEM = [
  'You are the DEEP scanner of Rootchain Terminal. You receive base evidence (market, on-chain including the',
  'dev/update-authority wallet, github, socials) plus fresh web signals (google news, reddit, hacker news) about',
  'a Solana token. Research deeply, then grade FIVE categories, each scored 0-20 points:',
  'MARKET (liquidity/volume/age), ONCHAIN (authorities/dev renounce/holders), X_ACTIVITY (the twitter handle —',
  'if you have web or search tools, USE THEM: look up the handle, mentions, engagement, pump patterns),',
  'NEWS (coverage found or none), DEV_TRUST (is the dev wallet a known serial deployer/rugger? search the CA and',
  'dev wallet on rugcheck-style analysers if you can browse; otherwise judge from the evidence).',
  'Missing data is not proof of a scam — say "not found" instead of inventing.',
  'Output STRICTLY this format, nothing else:',
  'VERDICT: SAFE | CAUTION | DANGER',
  'SCORE: <integer 0-100, the five category scores summed>',
  'MARKET: <max 12 words> <0-20>/20',
  'ONCHAIN: <max 12 words> <0-20>/20',
  'X_ACTIVITY: <max 12 words> <0-20>/20',
  'NEWS: <max 12 words> <0-20>/20',
  'DEV_TRUST: <max 12 words> <0-20>/20',
  'EVIDENCE:',
  '- <max 6 short lines, cite what you actually found>',
  'SUMMARY: <one line, max 22 words>',
].join(' ');

const CATEGORIES = ['MARKET', 'ONCHAIN', 'X_ACTIVITY', 'NEWS', 'DEV_TRUST'];

function parseDeep(text) {
  const t = String(text || '');
  const verdict = (t.match(/VERDICT:\s*(SAFE|CAUTION|DANGER)/i) || [])[1]?.toUpperCase() || null;
  const score = Number((t.match(/SCORE:\s*(\d{1,3})/i) || [])[1]);
  const categories = {};
  for (const cat of CATEGORIES) {
    const m = t.match(new RegExp(`${cat}:\\s*(.+?)\\s*(\\d{1,2})\\s*\\/\\s*20`, 'i'));
    if (m) categories[cat] = { note: m[1].trim().slice(0, 90), points: Math.min(20, Number(m[2])) };
  }
  const evidenceBlock = (t.split(/EVIDENCE:/i)[1] || '').split(/SUMMARY:/i)[0] || '';
  const evidence = evidenceBlock
    .split('\n')
    .map((l) => l.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const summary = (t.match(/SUMMARY:\s*(.+)/i) || [])[1]?.trim().slice(0, 160) || null;
  if (!verdict || !Number.isFinite(score) || Object.keys(categories).length < 3) return null;
  return { verdict, score: Math.max(0, Math.min(100, Math.round(score))), categories, evidence, summary: summary || '' };
}

/**
 * POST /api/scan { username, code, action, ca?, evidence?, connector? }
 *   · scan  { ca } → gather all evidence + the keyless heuristic verdict
 *   · judge { evidence, connector } → quick AI verdict over the evidence
 *   · deep  { evidence, connector } → the operator's AI researches the token
 *     (X handle, news, dev wallet) with fresh web signals gathered here and
 *     grades five categories 0-20 points each
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

    if (action === 'deep') {
      const ev = body.evidence;
      if (!ev || !ev.ca) {
        return NextResponse.json({ ok: false, error: 'No evidence to judge — run a scan first.' }, { status: 400 });
      }
      const connector = sanitizeConnector(body.connector);
      if (!connector) {
        return NextResponse.json(
          { ok: false, error: 'Deep scan runs on your own AI — "connect" (any API key) first. Web-capable models research X, news and the dev wallet; others grade from the gathered evidence.' },
          { status: 400 },
        );
      }

      const web = await deepEvidence(ev);
      const handle = ev.socials?.twitter || null;
      const prompt = [
        ev.official
          ? `IMPORTANT PROVENANCE: this CA is a REGISTERED OFFICIAL project token — ${ev.official.note}${ev.official.github ? ` Source code: ${ev.official.github}.` : ''} Weigh this declared provenance in DEV_TRUST and the overall verdict.`
          : null,
        `Deep-scan this Solana token. Base evidence JSON:\n\n${JSON.stringify(ev).slice(0, 5000)}`,
        `\n\nFresh web signals (google news / reddit / hacker news, gathered just now):\n${JSON.stringify(web).slice(0, 2500)}`,
        handle ? `\nThe token's X handle is @${handle} — research its activity if you can browse.` : '\nNo X handle found on the token profile.',
        ev.chain?.devWallet ? `Dev (metadata authority) wallet: ${ev.chain.devWallet} — check scam history if you can browse.` : 'Metadata authority appears renounced.',
      ].filter(Boolean).join('\n');

      let raw;
      if (connector.type === 'mcp') {
        raw = (await callMcp(connector, { system: DEEP_SYSTEM, prompt })).text;
      } else {
        raw = await callChatApi(
          connector,
          [
            { role: 'system', content: DEEP_SYSTEM },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.4, maxTokens: 1400 },
        );
      }
      const verdict = parseDeep(raw);
      if (!verdict) {
        return NextResponse.json(
          { ok: false, error: `The AI did not answer in deep-scan format — try again. (raw: ${raw.slice(0, 120)})` },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        verdict: { ...verdict, deep: true, model: connector.model || connector.tool || connector.type },
        webSignals: { news: web.news.length, reddit: web.reddit.length, hackerNews: web.hackerNews.length },
        web,
        rev: 1,
      });
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
      const prompt = [
        ev.official
          ? `IMPORTANT PROVENANCE: this CA is a REGISTERED OFFICIAL project token — ${ev.official.note}${ev.official.github ? ` Source code: ${ev.official.github}.` : ''} Weigh this declared provenance in DEV_TRUST and the overall verdict.`
          : null,
        `Judge this Solana token contract (evidence JSON):\n\n${JSON.stringify(ev).slice(0, 6000)}`,
      ].filter(Boolean).join('\n\n');
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
