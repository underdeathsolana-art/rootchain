'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { userColor } from '@/lib/usercolor';
import { DEFAULT_PAIR, DEFAULT_TF, TIMEFRAMES } from '@/lib/market';

const PAIR_POLL = 15_000;
const CANDLE_POLL = 15_000;
const COMMENT_POLL = 4000;

const WINDOWS = ['m5', 'h1', 'h6', 'h24'];
const WINDOW_LABELS = { m5: 'M5', h1: 'H1', h6: 'H6', h24: 'H24' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SUB = '₀₁₂₃₄₅₆₇₈₉';

const HELP_LINES = [
  'MARKET COMMANDS',
  '  <text>             comment on the wall',
  '  reply <id> <text>  answer comment #id (alias: r)',
  '  help · refresh · clear · exit',
];

/** 0.000006408 → "0.0₅6408" — subscript-zero notation, dexscreener style. */
function fmtPrice(p) {
  if (!Number.isFinite(p) || p === 0) return '0';
  if (p >= 1) return p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (p >= 0.01) return p.toFixed(4);
  const m = p.toFixed(12).match(/^0\.(0*)(\d+)/);
  if (!m) return p.toPrecision(4);
  const sub = String(m[1].length).split('').map((d) => SUB[+d]).join('');
  return `0.0${sub}${m[2].slice(0, 4)}`;
}

function fmtUsd(v) {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}k`;
  return `$${v.toFixed(2)}`;
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtAge(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 120) return 'new';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function relTime(at) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtTick(ts, tf) {
  const d = new Date(ts * 1000);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (tf === '1d' || tf === '4h') return `${d.getDate()} ${MON[d.getMonth()]}`;
  return hhmm;
}

/**
 * Candlestick chart — hand-rolled SVG: candles + wicks, a volume histogram,
 * a dashed last-price line and a hover crosshair with an OHLCV readout.
 * No chart library, so it stays in the terminal's amber phosphor voice.
 */
function Candles({ candles, width, tf }) {
  const [hover, setHover] = useState(null);

  const H = 300;
  const VOL_H = 54;
  const AXIS_R = 60;
  const AXIS_B = 16;
  const PAD = 8;

  const view = useMemo(() => {
    if (!candles || candles.length < 2 || width < 80) return null;
    const n = candles.length;
    const plotW = Math.max(40, width - AXIS_R - PAD * 2);
    const priceH = H - VOL_H - AXIS_B - PAD * 2;
    let min = Infinity;
    let max = -Infinity;
    let maxV = 0;
    for (const c of candles) {
      if (c[2] > max) max = c[2];
      if (c[3] < min) min = c[3];
      if (c[5] > maxV) maxV = c[5];
    }
    if (!(max > min)) {
      const pad = Math.abs(max) * 0.05 || 1e-9;
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.06;
      min -= pad;
      max += pad;
    }
    const step = plotW / n;
    const x = (i) => PAD + i * step + step / 2;
    const y = (p) => PAD + ((max - p) / (max - min)) * priceH;
    return { n, plotW, priceH, min, max, maxV: maxV || 1, step, x, y };
  }, [candles, width]);

  if (!view) {
    return (
      <div className="mkt__chart mkt__chart--empty">
        collecting candles…
      </div>
    );
  }

  const { n, plotW, priceH, min, max, maxV, step, x, y } = view;
  const last = candles[n - 1];
  const lastUp = last[4] >= last[3];
  const lastY = y(last[4]);
  const bodyW = Math.max(1, Math.min(13, step * 0.62));
  const volBase = H - AXIS_B;
  const hc = hover != null && hover >= 0 && hover < n ? candles[hover] : null;

  const gridLines = [0.2, 0.4, 0.6, 0.8].map((f) => ({
    y: PAD + priceH * f,
    p: max - (max - min) * f,
  }));

  const ticks = [0.1, 0.35, 0.6, 0.85].map((f) => Math.floor(n * f));

  return (
    <div className="mkt__chart" style={{ position: 'relative' }}>
      {hc ? (
        <div className="mkt__ohlc">
          <span>{fmtTick(hc[0], tf)}</span>
          <span>O <b>{fmtPrice(hc[1])}</b></span>
          <span>H <b>{fmtPrice(hc[2])}</b></span>
          <span>L <b>{fmtPrice(hc[3])}</b></span>
          <span>C <b className={hc[4] >= hc[1] ? 'up' : 'down'}>{fmtPrice(hc[4])}</b></span>
          <span>VOL <b>{hc[5].toFixed(2)}</b></span>
        </div>
      ) : null}
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Candlestick chart, ${n} candles`}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - box.left - PAD) / step);
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD} x2={PAD + plotW} y1={g.y} y2={g.y} className="mkt-grid" />
            <text x={PAD + plotW + 6} y={g.y + 3.5} className="mkt-axis">{fmtPrice(g.p)}</text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" className="mkt-axis">{fmtTick(candles[i][0], tf)}</text>
        ))}

        {candles.map((c, i) => {
          const up = c[4] >= c[3];
          const cx = x(i);
          const yO = y(c[1]);
          const yC = y(c[4]);
          const vh = (c[5] / maxV) * (VOL_H - 8);
          return (
            <g key={c[0]} className={up ? 'up' : 'down'}>
              <line x1={cx} x2={cx} y1={y(c[2])} y2={y(c[3])} className="mkt-wick" />
              <rect
                x={cx - bodyW / 2}
                y={Math.min(yO, yC)}
                width={bodyW}
                height={Math.max(1, Math.abs(yC - yO))}
                className="mkt-body"
              />
              <rect x={cx - bodyW / 2} y={volBase - vh} width={bodyW} height={vh} className="mkt-vol" />
            </g>
          );
        })}

        <line
          x1={PAD}
          x2={PAD + plotW}
          y1={lastY}
          y2={lastY}
          className="mkt-last"
          strokeDasharray="4 4"
        />
        <rect x={PAD + plotW + 2} y={lastY - 9} width={AXIS_R - 4} height={18} className={`mkt-lasttag ${lastUp ? 'up' : 'down'}`} />
        <text x={PAD + plotW + 6} y={lastY + 4} className="mkt-lasttag-t">{fmtPrice(last[4])}</text>

        {hc ? (
          <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={volBase} className="mkt-cross" strokeDasharray="3 3" />
        ) : null}
        <line x1={PAD} x2={PAD + plotW} y1={volBase + 1} y2={volBase + 1} className="mkt-grid" />
      </svg>
    </div>
  );
}

/** Buy/sell pressure bar — green buys vs red sells, like the dex panels. */
function Gauge({ label, buys, sells }) {
  const total = buys + sells;
  const pct = total ? (buys / total) * 100 : 50;
  return (
    <div className="gauge">
      <div className="gauge__head">
        <span>{label}</span>
        <span>
          <b className="up">{buys}</b> / <b className="down">{sells}</b>
        </span>
      </div>
      <div className="gauge__bar" role="img" aria-label={`${label}: ${buys} buys, ${sells} sells`}>
        <span className="gauge__buys" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Rootchain Market — the dexview terminal. One pair at a time: live stats and
 * candles from the public DEX APIs, plus a comment wall where operators talk
 * about the chart. Anyone can watch; commenting needs an operator session.
 */
export default function MarketTerminal({ session, initialPair, onExit }) {
  const [pair, setPair] = useState(null);
  const [pairError, setPairError] = useState('');
  const [tf, setTf] = useState(DEFAULT_TF);
  const [candles, setCandles] = useState(null);
  const [comments, setComments] = useState([]);
  const [sysLines, setSysLines] = useState([]);
  const [input, setInput] = useState('');
  const [width, setWidth] = useState(0);

  const idRef = useRef(0);
  const busyRef = useRef(false);
  const bootedRef = useRef(false);
  const havePairRef = useRef(false);
  const chartRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const pairAddr = pair?.pairAddress || initialPair || DEFAULT_PAIR;

  const sys = useCallback((text, kind = 'sys') => {
    setSysLines((prev) => [...prev.slice(-13), { id: (idRef.current += 1), kind, text }]);
  }, []);

  const loadPair = useCallback(async (addr) => {
    try {
      const res = await fetch(`/api/market?pair=${encodeURIComponent(addr)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        havePairRef.current = true;
        setPair(data.pair);
        setPairError('');
      } else if (havePairRef.current) {
        // transient upstream hiccup (rate limit, blip) — hold the last quote
        // instead of flashing the whole terminal to an error screen.
        sys('pair feed hiccup — holding last quote.', 'error');
      } else {
        setPairError(data.error || 'pair unreachable.');
      }
    } catch {
      if (havePairRef.current) sys('market feed hiccup — holding last quote.', 'error');
      else setPairError('market feed unreachable — is the terminal service running?');
    }
  }, [sys]);

  const loadCandles = useCallback(async (addr, useTf) => {
    try {
      const res = await fetch(
        `/api/market/ohlcv?pair=${encodeURIComponent(addr)}&tf=${useTf}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (data.ok && data.candles?.length) setCandles(data.candles);
    } catch {
      /* keep previous candles */
    }
  }, []);

  const pollComments = useCallback(async (addr) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await fetch(`/api/market/comments?pair=${encodeURIComponent(addr)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setComments(data.comments || []);
    } catch {
      /* keep previous */
    } finally {
      busyRef.current = false;
    }
  }, []);

  // first paint: resolve the pair, then its candles + wall
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    sys('ROOTCHAIN MARKET // DEX VIEW', 'head');
    sys('candles: geckoterminal · stats: dexscreener + gecko fallback · "help" lists wall commands');
    (async () => {
      await loadPair(initialPair || DEFAULT_PAIR);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // whenever the resolved pair address settles (or changes), pull its chart + wall
  useEffect(() => {
    if (!pair) return;
    loadCandles(pair.pairAddress, tf);
    pollComments(pair.pairAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair?.pairAddress]);

  useEffect(() => {
    if (!pair) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadPair(pair.pairAddress);
      }
    }, PAIR_POLL);
    return () => clearInterval(id);
  }, [pair?.pairAddress, loadPair]);

  useEffect(() => {
    if (!pair) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadCandles(pair.pairAddress, tf);
      }
    }, CANDLE_POLL);
    return () => clearInterval(id);
  }, [pair?.pairAddress, tf, loadCandles]);

  useEffect(() => {
    if (!pair) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        pollComments(pair.pairAddress);
      }
    }, COMMENT_POLL);
    return () => clearInterval(id);
  }, [pair?.pairAddress, pollComments]);

  // timeframe switches re-pull candles immediately
  useEffect(() => {
    if (pair) loadCandles(pair.pairAddress, tf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  // measure the chart box so the SVG tracks its container
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [sysLines]);

  async function post(payload) {
    try {
      const res = await fetch('/api/market/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, pair: pairAddr, ...payload }),
      });
      const data = await res.json();
      if (data.ok) return { ok: true, data };
      const hint = /unrecognised operator code/i.test(String(data.error)) ? ' — sign out and register again.' : '';
      sys(`${data.error || 'refused.'}${hint}`, 'error');
      return { ok: false };
    } catch {
      sys('wall unreachable — is the terminal service running?', 'error');
      return { ok: false };
    }
  }

  async function on_submit(e) {
    e.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;

    if (value === 'help') { sys(HELP_LINES.join('\n')); return; }
    if (value === 'exit') { onExit(); return; }
    if (value === 'refresh') {
      await Promise.all([loadPair(pairAddr), loadCandles(pairAddr, tf), pollComments(pairAddr)]);
      sys('refreshed.', 'ok');
      return;
    }
    if (value === 'clear') { setSysLines([]); return; }

    const reply = value.match(/^(?:reply|r)\s+#?(\d+)\s+([\s\S]+)/i);
    if (reply) {
      const res = await post({ action: 'reply', replyTo: Number(reply[1]), text: reply[2] });
      if (res.ok) {
        sys(`reply #${res.data.comment.seq} posted to thread #${res.data.comment.replyTo}.`, 'ok');
        await pollComments(pairAddr);
      }
      return;
    }

    const res = await post({ action: 'comment', text: value });
    if (res.ok) {
      sys(`comment #${res.data.comment.seq} posted.`, 'ok');
      await pollComments(pairAddr);
    }
  }

  const parents = comments.filter((c) => !c.replyTo).sort((a, b) => b.seq - a.seq);
  const repliesOf = (seq) => comments.filter((c) => c.replyTo === seq).sort((a, b) => a.seq - b.seq);

  const base = pair?.base;
  const quote = pair?.quote;
  const symbol = base && quote ? `${base.symbol}/${quote.symbol}` : '…/…';
  const changes = pair ? WINDOWS.map((w) => [WINDOW_LABELS[w], pair.priceChange?.[w]]) : [];

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">Rootchain Market // {symbol}</h1>
        <div className="hdr__meta">
          {session ? (
            <span className="hdr__user">USER <b>{session.username}</b></span>
          ) : (
            <span className="hdr__user">GUEST — watching</span>
          )}
          <span className="kbview">{comments.length} comment(s)</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit market
          </button>
        </div>
      </header>

      {pairError ? (
        <div className="mkt">
          <section className="feedwrap" aria-label="Market error">
            <div className="feedwrap__bar"><span>market view</span></div>
            <div className="log">
              <div className="line line--error"><span className="line__text">{pairError}</span></div>
              <div className="line line--sys"><span className="line__text">try: dexview https://dexscreener.com/solana/&lt;pool&gt; · or plain "dexview" for the terminal&apos;s own token.</span></div>
            </div>
          </section>
        </div>
      ) : (
        <div className="mkt">
          <section className="feedwrap mkt__left" aria-label="Pair chart and stats">
            <div className="mkt__head">
              <div className="mkt__title">
                <span className="mkt__pair">{symbol}</span>
                {pair ? <span className="mkt__dex">{pair.dexId}</span> : null}
                {pair ? (
                  <a
                    className="mkt__link"
                    href={pair.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {pair.source || 'dexscreener'} ↗
                  </a>
                ) : null}
              </div>
              <div className="mkt__priceline">
                {pair ? (
                  <>
                    <span className="mkt__price">${fmtPrice(pair.priceUsd)}</span>
                    <span className="mkt__native">{fmtPrice(pair.priceNative)} {quote?.symbol}</span>
                    {changes.map(([label, pct]) => (
                      <span key={label} className={`chip ${pct > 0 ? 'chip--up' : pct < 0 ? 'chip--down' : ''}`}>
                        {label} {fmtPct(pct)}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="mkt__price">loading…</span>
                )}
              </div>
            </div>

            <div className="mkt__tf" role="tablist" aria-label="Candle timeframe">
              {Object.keys(TIMEFRAMES).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tf === key}
                  className={`mkt__tfbtn ${tf === key ? 'is-on' : ''}`}
                  onClick={() => setTf(key)}
                >
                  {key}
                </button>
              ))}
              <span className="mkt__tfsrc">candles: gecko · stats: dexscreener/gecko</span>
            </div>

            <div className="mkt__chartbox" ref={chartRef}>
              <Candles candles={candles} width={width} tf={tf} />
            </div>

            <div className="mkt__stats">
              {pair ? (
                <>
                  <div className="stat"><span>MKT CAP</span><b>{fmtUsd(pair.marketCap)}</b></div>
                  <div className="stat"><span>FDV</span><b>{fmtUsd(pair.fdv)}</b></div>
                  <div className="stat"><span>LIQUIDITY</span><b>{fmtUsd(pair.liquidity)}</b></div>
                  <div className="stat"><span>VOL M5</span><b>{fmtUsd(pair.volume?.m5)}</b></div>
                  <div className="stat"><span>VOL H1</span><b>{fmtUsd(pair.volume?.h1)}</b></div>
                  <div className="stat"><span>VOL H6</span><b>{fmtUsd(pair.volume?.h6)}</b></div>
                  <div className="stat"><span>VOL H24</span><b>{fmtUsd(pair.volume?.h24)}</b></div>
                  <div className="stat"><span>PAIR AGE</span><b>{fmtAge(pair.pairCreatedAt)}</b></div>
                  <div className="stat stat--wide"><span>POOL</span><b>{pair.pairAddress}</b></div>
                  <div className="stat stat--wide"><span>BASE</span><b>{base?.symbol} · {base?.name}</b></div>
                </>
              ) : null}
            </div>

            <div className="mkt__gauges">
              {['m5', 'h1', 'h24'].map((w) => (
                <Gauge
                  key={w}
                  label={WINDOW_LABELS[w]}
                  buys={pair?.txns?.[w]?.buys ?? 0}
                  sells={pair?.txns?.[w]?.sells ?? 0}
                />
              ))}
            </div>
          </section>

          <section className="feedwrap mkt__right" aria-label="Pair comments">
            <div className="feedwrap__bar">
              <span>pair wall — comments &amp; replies</span>
              <span className="feedwrap__hint-sys">
                {sysLines.length ? `last: ${sysLines[sysLines.length - 1].text.slice(0, 48)}` : 'watching…'}
              </span>
            </div>

            <div className="log" ref={scrollRef} role="log" aria-label="Market wall output">
              {sysLines.map((line) => (
                <div key={line.id} className={`line line--${line.kind === 'head' ? 'head' : line.kind === 'ok' ? 'ok' : line.kind === 'error' ? 'error' : 'sys'}`}>
                  <span className="line__text">{line.text}</span>
                </div>
              ))}

              {sysLines.length && parents.length ? <div className="social-divider">── wall ──</div> : null}

              {parents.length === 0 ? (
                <div className="line line--sys">
                  <span className="line__text">The wall is empty — be the first to call the chart.</span>
                </div>
              ) : (
                parents.map((c) => (
                  <div key={c.seq} className="line line--sys social-thread">
                    <span className="line__text">
                      <span className="line__meta">#{c.seq} </span>
                      <b style={{ color: userColor(c.username) }}>{c.username}</b>
                      <span className="line__meta"> · {relTime(c.at)}</span>
                      {'  '}
                      {c.text}
                    </span>
                    {repliesOf(c.seq).map((r) => (
                      <span key={r.seq} className="line line--reply line__text" style={{ display: 'block' }}>
                        <span className="line__meta">#{r.seq} </span>
                        <b style={{ color: userColor(r.username) }}>{r.username}</b>
                        <span className="line__meta"> · {relTime(r.at)}</span>
                        {'  '}
                        {r.text}
                      </span>
                    ))}
                  </div>
                ))
              )}
            </div>

            {session ? (
              <form className="composer" onSubmit={on_submit}>
                <label className="sr-only" htmlFor="market-input">Market input</label>
                <span className="composer__prompt" aria-hidden="true">
                  <b>{session.username}</b>@market:~$
                </span>
                <input
                  id="market-input"
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      if (input) setInput('');
                      else onExit();
                    }
                  }}
                  placeholder="comment on the wall · reply <id> <text> · help"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="market-hint"
                />
                <span className="composer__hint" id="market-hint">
                  Enter ⏎ post · ESC exit
                </span>
              </form>
            ) : (
              <div className="composer">
                <span className="composer__prompt">guest</span>
                <span className="composer__hint">
                  register on the main terminal to join the wall
                </span>
              </div>
            )}
          </section>
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {sysLines.length ? sysLines[sysLines.length - 1].text : ''}
      </p>
    </div>
  );
}
