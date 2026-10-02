// Terminal number formatting — shared by the sim desk, price alerts and the
// watchlist. Deliberately import-free so the client bundle can use it too
// (lib/sim.js pulls the data layer, which must never reach the browser).

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
export function signedUsd(v) {
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

export function signedPct(v) {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function age(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Mask an access code for display: RC-ABCD-EFGH → RC-••••-••••. */
export function maskCode(code) {
  const s = String(code || '');
  const m = s.match(/^(RC-)(.*)$/i);
  const body = (m ? m[2] : s).replace(/[A-Za-z0-9]/g, '•');
  return m ? `${m[1].toUpperCase()}${body}` : body;
}
