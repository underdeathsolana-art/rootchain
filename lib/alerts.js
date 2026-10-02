// Price alerts + multi-token watchlist.
//
// Alerts are one-shot crossings: "alert rtc > 0.00002" arms, and the moment
// the live price crosses the target the alert fires once, is stamped FIRED
// and lands in the operator's terminal as a ⚡ line. There is no background
// worker — evaluation rides the terminal's own 15-second poll (GET
// /api/alerts), and every price comes from the same cached dexscreener/gecko
// feed the market view uses, so watching extra tokens adds no upstream calls
// inside a cache window. The watchlist is just a live price table the same
// poll keeps honest.

import { DEFAULT_PAIR, parseMarketArg, fetchPair, fetchPairForToken } from './market';
import { TOKEN_CA } from './ca';
import { getMarketWatch, saveMarketWatch } from './store';
import { fmtPrice, signedPct, age } from './format';

export const ALERTS = {
  MAX_ARMED: 8,     // unfired alerts per operator
  ROWS_KEEP: 12,    // armed + fired rows retained
  MAX_WATCH: 8,     // tokens on the watchlist (RTC is pinned on top)
  POLL_MS: 15000,   // the client's evaluation cadence
};

// 'rtc' / 'rootchain' resolve to the default pool; anything else must parse
// as a pool address, token CA or dexscreener/gecko link.
const ALIAS = { rtc: DEFAULT_PAIR, rootchain: DEFAULT_PAIR };

function newDoc(username) {
  return { username, nextId: 1, alerts: [], watch: [], updatedAt: new Date().toISOString() };
}

async function loadDoc(user) {
  return (await getMarketWatch(user.username.toLowerCase())) || newDoc(user.username);
}

/** Resolve any token spec an operator types into ca/symbol/pool/live price. */
async function resolveTokenSpec(tokenArg) {
  const raw = String(tokenArg || '').trim();
  const addr = raw ? ALIAS[raw.toLowerCase()] || parseMarketArg(raw) : DEFAULT_PAIR;
  if (raw && !addr) {
    return { err: 'could not read that — use "rtc", a CA, a pool address or a dexscreener link.' };
  }
  let pair = await fetchPair(addr);
  if (!pair) pair = await fetchPairForToken(addr);
  if (!pair || !pair.base?.address || !(pair.priceUsd > 0)) {
    return { err: `no live Solana price for "${raw.slice(0, 40) || 'that token'}" — try again in a moment.` };
  }
  return {
    spec: {
      ca: String(pair.base.address).toLowerCase(),
      symbol: pair.base.symbol || 'TOKEN',
      pairAddress: pair.pairAddress,
      price: pair.priceUsd,
      change24h: pair.priceChange?.h24 ?? null,
    },
  };
}

/** Live price for a stored alert/watch row, or null when the feed is quiet. */
async function priceOf({ ca, pairAddress }) {
  const pair = (await fetchPair(pairAddress)) || (await fetchPairForToken(ca));
  return pair?.priceUsd > 0 ? pair.priceUsd : null;
}

// ── alerts ──────────────────────────────────────────────────────────────────

export async function listAlerts(user) {
  const doc = await loadDoc(user);
  if (!doc.alerts.length) {
    return { ok: true, text: 'no alerts armed — "alert rtc > 0.00002" arms one. Checked live every 15 seconds.' };
  }

  const priced = await Promise.all(
    doc.alerts.map(async (a) => ({ ...a, now: a.firedAt ? null : await priceOf(a) })),
  );

  const lines = ['PRICE ALERTS — checked every 15 seconds'];
  for (const a of priced) {
    if (a.firedAt) {
      lines.push(`  ${a.id}. ${a.symbol} ${a.op} ${fmtPrice(a.target)} ... FIRED ${age(a.firedAt)} @ ${fmtPrice(a.triggeredPrice)}`);
    } else {
      lines.push(`  ${a.id}. ${a.symbol} ${a.op} ${fmtPrice(a.target)} ... armed (now ${a.now != null ? fmtPrice(a.now) : 'no feed'})`);
    }
  }
  lines.push('', 'arm: alert <rtc|ca> > <price> · remove: alert del <n> · wipe: alert clear');
  return { ok: true, text: lines.join('\n') };
}

export async function addAlert(user, tokenArg, opArg, targetArg) {
  const op = String(opArg || '').includes('<') ? '<' : String(opArg || '').includes('>') ? '>' : null;
  const target = Number(String(targetArg || '').replace(/[$,]/g, ''));
  if (!op || !(target > 0)) {
    return { ok: false, error: 'usage: alert <rtc|ca> >|< <price> — e.g. "alert rtc > 0.00002".' };
  }

  const { spec, err } = await resolveTokenSpec(tokenArg);
  if (err) return { ok: false, error: err };

  if ((op === '>' && spec.price >= target) || (op === '<' && spec.price <= target)) {
    return {
      ok: false,
      error: `${spec.symbol} already trades at ${fmtPrice(spec.price)} — pick a target ${op === '>' ? 'above' : 'below'} that.`,
    };
  }

  const doc = await loadDoc(user);
  const dup = doc.alerts.find((a) => !a.firedAt && a.ca === spec.ca && a.op === op && a.target === target);
  if (dup) return { ok: false, error: 'that exact alert is already armed.' };
  if (doc.alerts.filter((a) => !a.firedAt).length >= ALERTS.MAX_ARMED) {
    return { ok: false, error: `armed-alert limit reached (${ALERTS.MAX_ARMED}) — "alert del <n>" frees a slot.` };
  }

  doc.alerts.push({
    id: doc.nextId,
    ca: spec.ca,
    symbol: spec.symbol,
    pairAddress: spec.pairAddress,
    op,
    target,
    createdAt: Date.now(),
    firedAt: null,
    triggeredPrice: null,
  });
  doc.nextId += 1;
  // drop oldest fired rows first, then oldest armed, when the list outgrows
  while (doc.alerts.length > ALERTS.ROWS_KEEP) {
    const idx = doc.alerts.findIndex((a) => a.firedAt) !== -1
      ? doc.alerts.findIndex((a) => a.firedAt)
      : 0;
    doc.alerts.splice(idx, 1);
  }
  doc.updatedAt = new Date().toISOString();
  await saveMarketWatch(user.username.toLowerCase(), doc);

  return {
    ok: true,
    text: `ARMED — ${spec.symbol} ${op === '>' ? 'above' : 'below'} ${fmtPrice(target)} · now ${fmtPrice(spec.price)} · the ⚡ line lands here the moment it crosses.`,
  };
}

export async function delAlert(user, idArg) {
  const id = Number(idArg);
  const doc = await loadDoc(user);
  const idx = doc.alerts.findIndex((a) => a.id === id);
  if (!Number.isInteger(id) || idx === -1) {
    return { ok: false, error: `no alert #${idArg} — "alert" lists them with numbers.` };
  }
  const [gone] = doc.alerts.splice(idx, 1);
  doc.updatedAt = new Date().toISOString();
  await saveMarketWatch(user.username.toLowerCase(), doc);
  return { ok: true, text: `alert #${gone.id} (${gone.symbol} ${gone.op} ${fmtPrice(gone.target)}) removed.` };
}

export async function clearAlerts(user) {
  const doc = await loadDoc(user);
  doc.alerts = [];
  doc.updatedAt = new Date().toISOString();
  await saveMarketWatch(user.username.toLowerCase(), doc);
  return { ok: true, text: 'all alerts cleared — the desk is quiet.' };
}

/**
 * Evaluate every armed alert against the live feed. Fired alerts are stamped
 * and persisted here, then returned exactly once — the next poll stays silent
 * until something else crosses. Called by GET /api/alerts.
 */
export async function evaluateAlerts(user) {
  const doc = await getMarketWatch(user.username.toLowerCase());
  const armed = (doc?.alerts || []).filter((a) => !a.firedAt);
  if (!armed.length) return { fired: [] };

  const fired = [];
  await Promise.all(
    armed.map(async (a) => {
      const price = await priceOf(a);
      if (price == null) return;
      if ((a.op === '>' && price >= a.target) || (a.op === '<' && price <= a.target)) {
        a.firedAt = Date.now();
        a.triggeredPrice = price;
        fired.push({ symbol: a.symbol, op: a.op, target: a.target, price, at: a.firedAt });
      }
    }),
  );

  if (fired.length) {
    doc.updatedAt = new Date().toISOString();
    await saveMarketWatch(user.username.toLowerCase(), doc);
  }
  return { fired };
}

// ── watchlist ───────────────────────────────────────────────────────────────

export async function listWatch(user) {
  const doc = await loadDoc(user);
  const rows = await Promise.all(
    doc.watch.map(async (w, i) => ({ ...w, n: i + 1, ...(await liveOf(w)) })),
  );

  const lines = ['WATCHLIST — live prices'];
  const pinned = await liveOf({ ca: TOKEN_CA.toLowerCase(), pairAddress: DEFAULT_PAIR });
  lines.push(
    `  *  ${String(pinned.symbol || 'RTC').padEnd(6)} ${fmtPrice(pinned.price)}  ${pinned.change != null ? signedPct(pinned.change) : '—'} 24h   · pinned`,
  );
  for (const r of rows) {
    lines.push(`  ${String(r.n).padStart(2)}. ${r.symbol.padEnd(6)} ${fmtPrice(r.price)}  ${r.change != null ? signedPct(r.change) : '—'} 24h`);
  }
  if (!rows.length) lines.push('', 'add tokens with "watch add <ca|link|pool>" — up to 8, RTC is always pinned on top.');
  return { ok: true, text: lines.join('\n') };
}

async function liveOf(w) {
  const pair = (await fetchPair(w.pairAddress)) || (await fetchPairForToken(w.ca));
  return {
    symbol: w.symbol,
    price: pair?.priceUsd > 0 ? pair.priceUsd : null,
    change: pair?.priceChange?.h24 ?? null,
  };
}

export async function addWatch(user, tokenArg) {
  const { spec, err } = await resolveTokenSpec(tokenArg);
  if (err) return { ok: false, error: err };
  if (spec.ca === TOKEN_CA.toLowerCase()) {
    return { ok: false, error: 'RTC is pinned — always shown on the watchlist.' };
  }

  const doc = await loadDoc(user);
  if (doc.watch.some((w) => w.ca === spec.ca)) {
    return { ok: false, error: `${spec.symbol} is already on your watchlist.` };
  }
  if (doc.watch.length >= ALERTS.MAX_WATCH) {
    return { ok: false, error: `watchlist full (${ALERTS.MAX_WATCH}) — "watch del <n>" frees a slot.` };
  }

  doc.watch.push({ ca: spec.ca, symbol: spec.symbol, pairAddress: spec.pairAddress, addedAt: Date.now() });
  doc.updatedAt = new Date().toISOString();
  await saveMarketWatch(user.username.toLowerCase(), doc);
  return {
    ok: true,
    text: `WATCHING — ${spec.symbol} at ${fmtPrice(spec.price)} joins the list. "watch" shows every price live.`,
  };
}

export async function delWatch(user, nArg) {
  const n = Number(nArg);
  const doc = await loadDoc(user);
  if (!Number.isInteger(n) || n < 1 || n > doc.watch.length) {
    return { ok: false, error: `no watch row #${nArg} — "watch" lists them with numbers.` };
  }
  const [gone] = doc.watch.splice(n - 1, 1);
  doc.updatedAt = new Date().toISOString();
  await saveMarketWatch(user.username.toLowerCase(), doc);
  return { ok: true, text: `${gone.symbol} removed from the watchlist.` };
}

export async function clearWatch(user) {
  const doc = await loadDoc(user);
  doc.watch = [];
  doc.updatedAt = new Date().toISOString();
  await saveMarketWatch(user.username.toLowerCase(), doc);
  return { ok: true, text: 'watchlist cleared — only pinned RTC remains.' };
}
