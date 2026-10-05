'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TOKEN_CA } from '@/lib/ca';

const HELP_LINES = [
  'SCANNER COMMANDS',
  '  <CA> · scan <CA> ... scan a Solana contract address',
  '  rtc ................ scan the terminal\'s pinned RTC token',
  '  deep ............... DEEP AI scan: news + X + dev-trust research,',
  '                       graded 0-20 points in five categories (needs AI)',
  '  share .............. compose an X post from the last verdict',
  '  help · clear · exit',
];

const VERDICT_KIND = { SAFE: 'ok', CAUTION: 'warn', DANGER: 'error' };

function fmtK(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

/**
 * The AI contract scanner — paste a Solana CA, watch the evidence gather
 * (dexscreener pool, on-chain holders/authorities via public RPC, GitHub,
 * socials), get the rule-based verdict, and — with an AI linked through
 * "connect" — the model's own verdict on top. Results share straight to X
 * with the terminal's sources footnote. Nothing here is financial advice.
 */
export default function ScannerTerminal({ session, connector, onExit }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState(null);
  const [verdict, setVerdict] = useState(null); // { score, verdict, reasons/evidence, summary, model? }

  const idRef = useRef(0);
  const bootedRef = useRef(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const evidenceRef = useRef(null);
  const verdictRef = useRef(null);

  useEffect(() => { evidenceRef.current = evidence; }, [evidence]);
  useEffect(() => { verdictRef.current = verdict; }, [verdict]);

  const out = useCallback((text, kind = 'sys') => {
    setLines((prev) => [...prev.slice(-199), { id: (idRef.current += 1), kind, text }]);
  }, []);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    out('ROOTCHAIN SCANNER // AI CONTRACT CHECK', 'head');
    out(connector
      ? `AI judge armed — ${connector.model || connector.tool || connector.type} (${connector.type === 'mcp' ? 'MCP' : 'API'})`
      : 'HEURISTIC MODE — rule-based verdict only. "connect" (any API key) arms the AI judge.', connector ? 'ok' : 'warn');
    out('paste a Solana CA to scan · "rtc" scans the pinned token · not financial advice');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  async function callScan(payload) {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: session.username, code: session.code, ...payload }),
    });
    return res.json();
  }

  function printEvidence(ev, h) {
    const t = ev.token;
    out(`TARGET — ${ev.ca}`);
    if (ev.official) {
      out(`★ OFFICIAL ${ev.official.project} PROJECT TOKEN — ${ev.official.note}`, 'ok');
      if (ev.official.github) out(`  source code: ${ev.official.github}`, 'ok');
    }    if (t) {
      out([
        'MARKET (dexscreener)',
        `  ${t.name} ($${t.symbol}) · ${t.dex} pool`,
        `  price ${t.priceUsd} · liq ${fmtK(t.liquidity)} · mcap ${t.marketCap ? fmtK(t.marketCap) : '—'}`,
        `  24h vol ${fmtK(t.volume24h)} · 24h ${t.change24h != null ? `${t.change24h}%` : '—'} · 1h ${t.change1h != null ? `${t.change1h}%` : '—'}`,
        `  pool age ${t.poolCreatedAt ? `${Math.max(0, Math.floor((Date.now() - t.poolCreatedAt) / 86400000))}d` : '—'}`,
      ].join('\n'));
    } else {
      out('MARKET — no dexscreener pool found', 'warn');
    }
    const c = ev.chain;
    if (c?.reachable) {
      out([
        'ON-CHAIN (solana rpc)',
        `  top-10 holders ${c.top10Pct}% · top-20 ${c.top20Pct}%`,
        `  mint authority ... ${c.mintAuthority ? 'STILL SET' : 'revoked'}`,
        `  freeze authority . ${c.freezeAuthority ? 'STILL SET' : 'revoked'}`,
      ].join('\n'), c.freezeAuthority || c.mintAuthority ? 'warn' : 'sys');
    } else {
      out('ON-CHAIN — rpc unreachable, holder/authority checks skipped', 'warn');
    }
    out(`GITHUB — ${ev.github?.ok ? ev.github.note : ev.github?.note || 'unreachable'}`);
    if (ev.socials) {
      const bits = [
        ev.socials.twitter ? `@${ev.socials.twitter}` : null,
        ev.socials.websites?.[0] || null,
        ev.socials.coingecko ? 'coingecko-listed' : null,
      ].filter(Boolean);
      out(`PROFILE — ${bits.length ? bits.join(' · ') : 'no website / socials found'}`, bits.length ? 'sys' : 'warn');
    }
    out(`HEURISTIC — ${h.verdict} ${h.score}/100`, VERDICT_KIND[h.verdict] || 'sys');
    h.reasons.forEach((r) => out(`  · ${r}`));
  }

  async function runScan(ca) {
    setBusy(true);
    setVerdict(null);
    try {
      out(`scanning ${ca} — market · on-chain · github…`);
      const data = await callScan({ action: 'scan', ca });
      if (!data.ok) {
        out(data.error, 'error');
        return;
      }
      setEvidence(data.evidence);
      evidenceRef.current = data.evidence;
      printEvidence(data.evidence, data.heuristic);
      setVerdict({ ...data.heuristic, heuristic: true });
      verdictRef.current = { ...data.heuristic, heuristic: true };

      if (connector) {
        out('AI judge reading the evidence…');
        const judged = await callScan({ action: 'judge', evidence: data.evidence, connector });
        if (judged.ok) {
          out(`AI VERDICT — ${judged.verdict.verdict} ${judged.verdict.score}/100 (${judged.verdict.model})`, VERDICT_KIND[judged.verdict.verdict] || 'sys');
          judged.verdict.evidence?.forEach((r) => out(`  · ${r}`));
          if (judged.verdict.summary) out(`  ${judged.verdict.summary}`);
          setVerdict({ ...judged.verdict, heuristic: false });
          verdictRef.current = { ...judged.verdict, heuristic: false };
        } else {
          out(judged.error, 'error');
        }
      }
      out('"share" posts the verdict to X · scan another CA any time');
    } catch {
      out('scanner unreachable — is the terminal service running?', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runDeep() {
    const ev = evidenceRef.current;
    if (!ev) {
      out('scan a CA first — "deep" researches the current target.', 'error');
      return;
    }
    if (!connector) {
      out('deep scan runs on your own AI — "exit" and "connect" (any API key) first. Web-capable models research X, news and the dev wallet.', 'error');
      return;
    }
    setBusy(true);
    try {
      out('deep scan — gathering fresh news + web signals…');
      const judged = await callScan({ action: 'deep', evidence: ev, connector });
      if (!judged.ok) {
        out(judged.error, 'error');
        return;
      }
      out(`WEB SIGNALS — news ${judged.webSignals.news} · reddit ${judged.webSignals.reddit} · hacker news ${judged.webSignals.hackerNews}`);
      if (judged.web?.news?.length) judged.web.news.slice(0, 3).forEach((n) => out(`  · ${n.title} (${n.date})`));
      out(`AI DEEP VERDICT — ${judged.verdict.verdict} ${judged.verdict.score}/100 (${judged.verdict.model})`, VERDICT_KIND[judged.verdict.verdict] || 'sys');
      out('  POINTS — ' + Object.entries(judged.verdict.categories)
        .map(([k, v]) => `${k} ${v.points}/20`)
        .join(' · '));
      for (const [cat, v] of Object.entries(judged.verdict.categories)) {
        out(`  ${cat.padEnd(11)} ${String(v.points).padStart(2)}/20 — ${v.note}`);
      }
      judged.verdict.evidence?.forEach((r) => out(`  · ${r}`));
      if (judged.verdict.summary) out(`  ${judged.verdict.summary}`);
      setVerdict({ ...judged.verdict, heuristic: false });
      verdictRef.current = { ...judged.verdict, heuristic: false };
      out('"share" posts the graded verdict to X');
    } catch {
      out('deep scan unreachable — is the terminal service running?', 'error');
    } finally {
      setBusy(false);
    }
  }

  function shareToX() {
    const v = verdictRef.current;
    const ev = evidenceRef.current;
    if (!v || !ev) {
      out('nothing to share yet — scan a CA first.', 'error');
      return;
    }
    const sym = ev.token?.symbol || 'token';
    const t = ev.token;
    const facts = t
      ? `liq ${fmtK(t.liquidity)} · top10 ${ev.chain?.top10Pct ?? '—'}% · freeze ${ev.chain?.freezeAuthority ? 'SET' : 'none'}`
      : 'no pool found';
    const judge = v.heuristic ? 'heuristic' : v.deep ? 'deep AI' : 'AI';
    const graded = v.categories
      ? `\n${Object.entries(v.categories).map(([k, c]) => `${k.toLowerCase()} ${c.points}/20`).join(' · ')}`
      : '';
    const official = ev.official ? `official ${ev.official.project} token\n` : '';
    const text = `$${sym} contract scan — ${v.verdict} ${v.score}/100 (${judge})\n${official}${facts}${graded}\n${v.summary || ''}\n\nsources : rtcterminal.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  async function onSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;
    out(`${session.username}@scanner:~$ ${value}`, 'cmd');

    const [word, ...rest] = value.split(/\s+/);
    const command = word.toLowerCase();

    if (command === 'exit' || command === 'quit') { onExit(); return; }
    if (command === 'help' || command === '?') { HELP_LINES.forEach((l) => out(l)); return; }
    if (command === 'clear') { setLines([]); return; }
    if (command === 'share' || command === 'x') { shareToX(); return; }
    if (command === 'deep' || command === 'research') { await runDeep(); return; }
    if (command === 'rtc') { await runScan(TOKEN_CA); return; }
    if (command === 'scan') {
      if (!rest[0]) { out('usage: scan <CA>', 'error'); return; }
      await runScan(rest[0]);
      return;
    }
    // bare address = scan
    await runScan(value);
  }

  const aiLabel = connector
    ? `${connector.model || connector.tool || connector.type} · ${connector.type === 'mcp' ? 'MCP' : 'API'}`
    : 'heuristic mode';
  const v = verdict;

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">Rootchain Scanner // AI Contract Check</h1>
        <div className="hdr__meta">
          <span className="hdr__user">
            USER <b>{session.username}</b>
          </span>
          <span className="kbview">{aiLabel}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit scanner
          </button>
        </div>
      </header>

      <div className="main live__main">
        <section className="feedwrap live__feedwrap" aria-label="Scanner channel">
          <div className="feedwrap__bar">
            <span>{busy ? 'scanning…' : v ? `${evidence?.token?.symbol || 'scan'} — ${v.verdict} ${v.score}/100${v.heuristic ? ' (heuristic)' : ' (AI)'}` : 'scanner idle'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {v && connector ? (
                <button type="button" className="btn btn--sm" onClick={runDeep} disabled={busy} title="deep AI research: news, X activity, dev trust — graded 0-20 per category">
                  Deep AI scan
                </button>
              ) : null}
              {v ? (
                <button type="button" className="btn btn--sm" onClick={shareToX} title="compose an X post from the verdict — sources: rtcterminal.com">
                  Share to 𝕏
                </button>
              ) : null}
              <span className="feedwrap__hint-sys">not financial advice</span>
            </span>
          </div>

          <div className="log" ref={scrollRef} role="log" aria-label="Scanner output">
            {lines.length === 0 ? (
              <div className="line line--sys">
                <span className="line__text">Paste a Solana CA to scan — try "rtc".</span>
              </div>
            ) : null}
            {lines.map((line) => (
              <div key={line.id} className={`line line--${line.kind}`}>
                <span className="line__text" style={{ whiteSpace: 'pre-wrap' }}>{line.text}</span>
              </div>
            ))}
            {busy ? (
              <div className="line line--sys">
                <span className="line__text">gathering evidence…</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panels" aria-label="Scanner aids">
          <section className="panel" data-panel="quick">
            <div className="panel__head">
              <span>Quick scan</span>
              <span>RTC</span>
            </div>
            <div className="panel__body">
              <button type="button" className="btn btn--sm" onClick={() => runScan(TOKEN_CA)} disabled={busy}>
                Scan pinned RTC
              </button>
              <p className="mem-empty" style={{ marginTop: '10px' }}>
                evidence: dexscreener pool · solana rpc holders &amp; authorities · github · socials
              </p>
            </div>
          </section>
          <section className="panel" data-panel="verdict">
            <div className="panel__head">
              <span>Verdict tiers</span>
            </div>
            <div className="panel__body">
              <ul className="filelist">
                <li>SAFE · 70-100 — structure checks out</li>
                <li>CAUTION · 40-69 — mixed signals</li>
                <li>DANGER · 0-39 — red flags dominant</li>
              </ul>
              <p className="mem-empty" style={{ marginTop: '10px' }}>
                verdicts are reads of public data — never financial advice.
              </p>
            </div>
          </section>
        </aside>
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="scanner-input">
          Scanner command
        </label>
        <span className="composer__prompt" aria-hidden="true">
          <b>{session.username}</b>@scanner:~$
        </span>
        <input
          id="scanner-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setInput('');
          }}
          placeholder="paste a Solana CA · rtc for the pinned token · share posts the verdict to X"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="composer__hint">
          Enter ⏎ scan · ESC clear
        </span>
      </form>
    </div>
  );
}
