// Paper trading desk — fake money, real prices.
//
// Every operator gets a paper wallet that starts at START_BALANCE USDC and
// trades against the same live dexscreener/gecko feed the market view uses
// (lib/market.js). Nothing on-chain is ever touched; the point is the game —
// "sim top" ranks operators by total equity, "sim reset" starts a wallet over.

import { DEFAULT_PAIR, parseMarketArg, fetchPair, fetchPairForToken } from './market';
import { getSimPortfolio, saveSimPortfolio, listSimPortfolios } from './store';

export const SIM = {
  START_BALANCE: 1000, // paper USDC every wallet starts (and resets) with
  MAX_POSITIONS: 12,   // distinct tokens one wallet may hold
  MIN_TRADE_USD: 1,    // smallest order the desk accepts
  HISTORY_KEEP: 8,     // recent orders remembered per wallet
  DUST_USD: 0.01,      // positions worth less than this are closed out
  COOLDOWN_MS: 1000,   // same wallet must wait between orders
  BOARD_SIZE: 10,      // rows shown on the leaderboard
  BOARD_SCAN: 50,      // wallets scanned to rank it
};

export const SIM_USAGE = [
  'PAPER DESK — fake money, real prices (nothing on-chain moves)',
  '  sim ............... show your wallet, positions & P&L',
  '  sim buy <usd|all> . buy that much of RTC — sim buy 100 <ca|link|pool> picks a token',
  '  sim sell <usd|all>  sell back to paper USDC — "all" closes the position',
  '  sim top ........... leaderboard — operators ranked by paper equity',
  '  sim reset ......... wipe the wallet and start at $1,000 again',
].join('\n');

function newPortfolio(username) {
  const now = new Date().toISOString();
  return {
    username,
    balance: SIM.START_BALANCE,
    realized: 0,
    trades: 0,
    positions: {},
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ── formatting ──────────────────────────────────────────────────────────────

/** $1,234.56 for cash-scale numbers, compact above a million. */
export function fmtUsd(v) {
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const n = Math.abs(v);
  let s;
  if (n >= 1e9) s = `$${(n / 1e9).toFixed(2)}B`;
  else if (n >= 1e6) s = `$${(n / 1e6).toFixed(2)}M`;
  else if (n >= 1000) s = `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  else s = `$${n.toFixed(2)}`;
  return sign + s;
}

/** Signed P&L: +$1.20 / -$0.80. */
function signedUsd(v) {
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return '$0.00';
  return `${v > 0 ? '+' : '-'}${fmtUsd(Math.abs(v))}`;
}

/** Meme-token prices keep their zeros: 0.0000123 (no subscript tricks here). */
export function fmtPrice(p) {
  if (!Number.isFinite(p) || p === 0) return '0';
  if (p >= 1) return p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (p >= 0.01) return p.toFixed(4);
  const m = p.toFixed(14).match(/^0\.(0*)(\d{1,4})/);
  return m ? `0.${m[1]}${m[2]}` : p.toPrecision(4);
}

/** Token amounts compact down: 8.13M / 452.1k / 123.45. */
export function fmtAmount(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function signedPct(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function age(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── price plumbing ──────────────────────────────────────────────────────────

/** Resolve the traded token: default RTC, or any pool/CA/link an operator pastes. */
async function resolveToken(tokenArg) {
  const raw = String(tokenArg || '').trim();
  const addr = raw ? parseMarketArg(raw) : DEFAULT_PAIR;
  if (raw && !addr) {
    return { err: 'could not read that — paste a dexscreener link, a pool address or a token CA.' };
  }
  let pair = await fetchPair(addr);
  if (!pair) pair = await fetchPairForToken(addr);
  if (!pair || !pair.base?.address || !(pair.priceUsd > 0)) {
    return { err: `no live Solana price for "${raw.slice(0, 40) || 'that token'}" — try again in a moment.` };
  }
  return { pair };
}

/** Live value of every position, biggest first. A dead feed falls back to cost. */
async function pricePortfolio(pf) {
  const rows = await Promise.all(
    Object.values(pf.positions || {}).map(async (pos) => {
      const pair = (await fetchPair(pos.pairAddress)) || (await fetchPairForToken(pos.ca));
      const price = pair?.priceUsd > 0 ? pair.priceUsd : pos.avgPrice;
      const value = pos.tokens * price;
      const cost = pos.tokens * pos.avgPrice;
      return {
        ...pos,
        price,
        value,
        cost,
        pnl: value - cost,
        pnlPct: cost > 0 ? (value / cost - 1) * 100 : 0,
      };
    }),
  );
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

// ── actions ─────────────────────────────────────────────────────────────────

function parseUsdAmount(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (t === 'all' || t === 'max') return { all: true };
  const n = Number(t.replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return { bad: true };
  return { usd: n };
}

function recordOrder(pf, side, symbol, usd, price, tokens) {
  pf.history.push({ at: Date.now(), side, symbol, usd, price, tokens });
  if (pf.history.length > SIM.HISTORY_KEEP) pf.history = pf.history.slice(-SIM.HISTORY_KEEP);
  pf.trades += 1;
  pf.lastAt = Date.now();
  pf.updatedAt = new Date().toISOString();
}

async function loadWallet(user) {
  return (await getSimPortfolio(user.username.toLowerCase())) || newPortfolio(user.username);
}

export async function simPortfolio(user) {
  const pf = await loadWallet(user);
  const rows = await pricePortfolio(pf);
  const equity = pf.balance + rows.reduce((s, r) => s + r.value, 0);
  const ret = (equity / SIM.START_BALANCE - 1) * 100;

  const lines = [
    `PAPER DESK — ${user.username}`,
    `  CASH ........ ${fmtUsd(pf.balance)}`,
    `  EQUITY ...... ${fmtUsd(equity)}  (${signedPct(ret)} all-time)`,
    `  REALIZED .... ${signedUsd(pf.realized)} over ${pf.trades} order(s)`,
  ];

  if (rows.length) {
    lines.push('');
    for (const r of rows) {
      lines.push(`  ${r.symbol.padEnd(6)} ${fmtAmount(r.tokens)} tokens`);
      lines.push(`         avg ${fmtPrice(r.avgPrice)} · last ${fmtPrice(r.price)} · ${fmtUsd(r.cost)} → ${fmtUsd(r.value)}  (${signedPct(r.pnlPct)})`);
    }
  } else {
    lines.push('', '  no open positions — "sim buy 100" puts $100 of RTC on the desk.');
  }

  const recent = (pf.history || []).slice(-3);
  if (recent.length) {
    lines.push('', '  recent orders:');
    for (const h of recent) {
      lines.push(`  ${h.side.padEnd(4)} ${h.symbol.padEnd(6)} ${fmtUsd(h.usd)} @ ${fmtPrice(h.price)}  ·  ${age(h.at)}`);
    }
  }
  return { ok: true, text: lines.join('\n') };
}

export async function simBuy(user, amountArg, tokenArg) {
  const pf = await loadWallet(user);
  const parsed = parseUsdAmount(amountArg);
  if (parsed.bad) return { ok: false, error: 'usage: sim buy <usd|all> — e.g. "sim buy 100", "sim buy all".' };
  if (pf.lastAt && Date.now() - pf.lastAt < SIM.COOLDOWN_MS) {
    return { ok: false, error: 'one order at a time — the desk needs a second.' };
  }

  const spot = await resolveToken(tokenArg);
  if (spot.err) return { ok: false, error: spot.err };
  const { pair } = spot;
  const price = pair.priceUsd;
  const ca = String(pair.base.address).toLowerCase();
  const symbol = pair.base.symbol || 'TOKEN';

  if (!parsed.all && parsed.usd > pf.balance) {
    return { ok: false, error: `cash is ${fmtUsd(pf.balance)} — "sim buy all" goes all-in.` };
  }
  const usd = parsed.all ? pf.balance : parsed.usd;
  if (usd < SIM.MIN_TRADE_USD) {
    return { ok: false, error: `minimum order is $${SIM.MIN_TRADE_USD} — cash is ${fmtUsd(pf.balance)}.` };
  }

  const pos = pf.positions[ca];
  if (!pos && Object.keys(pf.positions).length >= SIM.MAX_POSITIONS) {
    return { ok: false, error: `position limit reached (${SIM.MAX_POSITIONS} tokens) — sell one first.` };
  }

  const tokens = usd / price;
  if (pos) {
    pos.avgPrice = (pos.avgPrice * pos.tokens + price * tokens) / (pos.tokens + tokens);
    pos.tokens += tokens;
  } else {
    pf.positions[ca] = { ca, symbol, pairAddress: pair.pairAddress, tokens, avgPrice: price, openedAt: Date.now() };
  }
  pf.balance -= usd;
  recordOrder(pf, 'BUY', symbol, usd, price, tokens);
  await saveSimPortfolio(user.username.toLowerCase(), pf);

  return {
    ok: true,
    text: [
      `FILLED — BUY ${fmtAmount(tokens)} ${symbol} @ ${fmtPrice(price)}`,
      `  spent ${fmtUsd(usd)} · cash left ${fmtUsd(pf.balance)}`,
      `  position now ${fmtAmount(pf.positions[ca].tokens)} ${symbol} @ avg ${fmtPrice(pf.positions[ca].avgPrice)}`,
    ].join('\n'),
  };
}

export async function simSell(user, amountArg, tokenArg) {
  const pf = await loadWallet(user);
  const parsed = parseUsdAmount(amountArg);
  if (parsed.bad) return { ok: false, error: 'usage: sim sell <usd|all> — e.g. "sim sell 50", "sim sell all".' };
  if (pf.lastAt && Date.now() - pf.lastAt < SIM.COOLDOWN_MS) {
    return { ok: false, error: 'one order at a time — the desk needs a second.' };
  }

  const spot = await resolveToken(tokenArg);
  if (spot.err) return { ok: false, error: spot.err };
  const { pair } = spot;
  const price = pair.priceUsd;
  const ca = String(pair.base.address).toLowerCase();
  const symbol = pair.base.symbol || 'TOKEN';

  const pos = pf.positions[ca];
  if (!pos) {
    const held = Object.values(pf.positions).map((p) => p.symbol);
    return {
      ok: false,
      error: held.length
        ? `no ${symbol} position — you hold ${held.join(', ')}.`
        : 'no open positions — "sim buy <usd>" starts one.',
    };
  }

  const value = pos.tokens * price;
  if (!parsed.all && parsed.usd < SIM.MIN_TRADE_USD) {
    return { ok: false, error: `minimum order is $${SIM.MIN_TRADE_USD} — the position is worth ${fmtUsd(value)}.` };
  }
  const capped = !parsed.all && parsed.usd > value;
  const usd = parsed.all ? value : Math.min(parsed.usd, value);
  const tokensSold = usd / price;
  const realized = (price - pos.avgPrice) * tokensSold;

  pos.tokens -= tokensSold;
  pf.balance += usd;
  pf.realized += realized;
  if (pos.tokens <= 0 || pos.tokens * price < SIM.DUST_USD) delete pf.positions[ca];
  recordOrder(pf, 'SELL', symbol, usd, price, tokensSold);
  await saveSimPortfolio(user.username.toLowerCase(), pf);

  const closed = !pf.positions[ca];
  return {
    ok: true,
    text: [
      `FILLED — SELL ${fmtAmount(tokensSold)} ${symbol} @ ${fmtPrice(price)}${capped ? '  (whole position)' : ''}`,
      `  received ${fmtUsd(usd)} · realized ${signedUsd(realized)}`,
      `  cash now ${fmtUsd(pf.balance)}${closed ? '' : ` · still holding ${fmtAmount(pos.tokens)} ${symbol}`}`,
    ].join('\n'),
  };
}

export async function simReset(user) {
  const pf = newPortfolio(user.username);
  await saveSimPortfolio(user.username.toLowerCase(), pf);
  return {
    ok: true,
    text: `PAPER WALLET RESET — fresh ${fmtUsd(SIM.START_BALANCE)} USDC, no positions, clean slate on the leaderboard.`,
  };
}

export async function simLeaderboard(meLower) {
  const pfs = await listSimPortfolios(SIM.BOARD_SCAN);
  if (!pfs.length) {
    return { ok: true, text: 'no wallets on the desk yet — "sim buy 100" opens the first one.' };
  }

  const ranked = [];
  for (const pf of pfs) {
    const rows = await pricePortfolio(pf);
    const equity = pf.balance + rows.reduce((s, r) => s + r.value, 0);
    ranked.push({ pf, equity, ret: (equity / SIM.START_BALANCE - 1) * 100 });
  }
  ranked.sort((a, b) => b.equity - a.equity);

  const lines = ['SIM LEADERBOARD — paper equity, real prices'];
  ranked.slice(0, SIM.BOARD_SIZE).forEach((r, i) => {
    const me = r.pf.username.toLowerCase() === meLower ? '  · you' : '';
    lines.push(
      `  ${String(i + 1).padStart(2)}. ${r.pf.username.padEnd(14)} ${fmtUsd(r.equity).padStart(10)}  ${signedPct(r.ret).padStart(8)}   ${Object.keys(r.pf.positions || {}).length} pos · ${r.pf.trades} trades${me}`,
    );
  });
  return { ok: true, text: lines.join('\n') };
}
