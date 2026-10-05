// Solana contract-address scanner — evidence gathering + heuristic verdict.
//
// A scan pulls four kinds of evidence, all keyless:
//   · market  — DexScreener's most liquid Solana pool for the mint
//   · chain   — Solana public RPC: supply, top-20 token accounts, mint &
//               freeze authorities still set?
//   · github  — public repo search for the project's name / CA
//   · socials — whatever links DexScreener's token profile carries
// The heuristic folds that into a 0-100 score; with an AI connector linked
// the /api/scan 'judge' action replaces it with a model-written verdict.

import { parseMarketArg, fetchPairForToken } from './market';

const RPC = 'https://api.mainnet-beta.solana.com';

async function rpc(method, params) {
  // Public RPC rate-limits bursts — one retry after a breath covers most 429s.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.result !== undefined && json?.result !== null) return json.result;
      }
    } catch {
      /* retry */
    } finally {
      clearTimeout(timer);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}


async function onChain(ca) {
  // jsonParsed handles both classic and Token-2022 mints (pump.fun tokens
  // carry metadata extensions — raw layout parsing misreads them).
  const acct = await rpc('getAccountInfo', [ca, { encoding: 'jsonParsed' }]);
  const info = acct?.value?.data?.parsed?.info || null;
  const largest = await rpc('getTokenLargestAccounts', [ca]);

  const supplyRaw = BigInt(info?.supply || '0');
  const accounts = (largest?.value || []).map((a) => ({
    address: a.address,
    raw: a.amount,
    pct: supplyRaw > 0n ? (Number((BigInt(a.amount) * 10000n) / supplyRaw) / 100) : null,
  }));
  const top10 = accounts.slice(0, 10).reduce((s, a) => s + (a.pct || 0), 0);
  const top20 = accounts.slice(0, 20).reduce((s, a) => s + (a.pct || 0), 0);

  return {
    reachable: Boolean(info),
    standard: acct?.value?.data?.parsed?.type || null,
    supplyRaw: supplyRaw > 0n ? supplyRaw.toString() : null,
    decimals: info?.decimals ?? null,
    mintAuthority: info?.mintAuthority || null,
    freezeAuthority: info?.freezeAuthority || null,
    top10Pct: accounts.length ? Math.round(top10 * 100) / 100 : null,
    top20Pct: accounts.length ? Math.round(top20 * 100) / 100 : null,
    topAccounts: accounts.slice(0, 5).map((a) => ({ address: a.address, pct: a.pct })),
  };
}

/** GeckoTerminal token profile — socials, description, coingecko listing. */
async function geckoInfo(ca) {
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${ca}/info`, {
      headers: { accept: 'application/json', 'user-agent': 'rootchain-terminal/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const a = (await res.json())?.data?.attributes || null;
    if (!a) return null;
    return {
      websites: (a.websites || []).slice(0, 3),
      twitter: a.twitter_handle || null,
      telegram: a.telegram_handle || null,
      discord: a.discord_url || null,
      description: (a.description || '').slice(0, 200),
      coingeckoId: a.coingecko_coin_id || null,
    };
  } catch {
    return null;
  }
}

async function githubLook(name, ca) {
  const query = (name && name.length >= 3 && name !== ca ? name : ca).slice(0, 60);
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`,
      { headers: { accept: 'application/vnd.github+json', 'user-agent': 'rootchain-terminal/1.0' }, cache: 'no-store' },
    );
    if (!res.ok) return { ok: false, note: `github refused (${res.status})` };
    const data = await res.json();
    const needle = query.toLowerCase();
    const related = (data.items || [])
      .filter((r) => `${r.full_name} ${r.description || ''}`.toLowerCase().includes(needle) || r.description?.toLowerCase().includes(ca.toLowerCase()))
      .slice(0, 3)
      .map((r) => ({
        name: r.full_name,
        stars: r.stargazers_count,
        updated: (r.updated_at || '').slice(0, 10),
        desc: (r.description || '').slice(0, 90),
        url: r.html_url,
      }));
    return {
      ok: true,
      query,
      total: data.total_count || 0,
      related,
      note: related.length ? `${related.length} related repo(s)` : `no repo matching "${query}"`,
    };
  } catch {
    return { ok: false, note: 'github unreachable' };
  }
}

/** Everything the scanner (and the AI judge) looks at for one mint. */
export async function gatherEvidence(rawAddr) {
  const ca = parseMarketArg(rawAddr);
  if (!ca) return { err: 'could not read that — paste a Solana token CA.' };

  const pair = await fetchPairForToken(ca);
  const chain = await onChain(ca);
  const gh = await githubLook(pair?.base?.name, ca);
  const info = await geckoInfo(ca);

  return {
    at: Date.now(),
    ca,
    token: pair
      ? { name: pair.base.name, symbol: pair.base.symbol, priceUsd: pair.priceUsd, liquidity: pair.liquidity, marketCap: pair.marketCap, fdv: pair.fdv, volume24h: pair.volume?.h24 ?? null, txns24h: pair.txns?.h24 ?? null, change24h: pair.priceChange?.h24 ?? null, change1h: pair.priceChange?.h1 ?? null, poolCreatedAt: pair.pairCreatedAt, pairAddress: pair.pairAddress, dex: pair.dexId }
      : null,
    socials: info
      ? {
          websites: info.websites,
          twitter: info.twitter,
          telegram: info.telegram,
          coingecko: Boolean(info.coingeckoId),
          description: info.description,
        }
      : null,
    chain,
    github: gh,
  };
}

/**
 * Keyless verdict — pure rules over the evidence. The AI judge refines it
 * when a connector is linked; this always runs as the floor.
 */
export function heuristicVerdict(ev) {
  const reasons = [];
  let score = 50;
  const t = ev.token;
  const c = ev.chain;

  if (t) {
    const liq = t.liquidity || 0;
    if (liq >= 250_000) { score += 15; reasons.push(`liquidity ${fmtK(liq)} — deep`); }
    else if (liq >= 50_000) { score += 8; reasons.push(`liquidity ${fmtK(liq)} — adequate`); }
    else if (liq > 0) { score -= 15; reasons.push(`liquidity ${fmtK(liq)} — thin`); }
    else { score -= 20; reasons.push('no liquidity found — not on a DEX pool'); }

    if (t.volume24h >= 100_000) { score += 5; reasons.push(`24h volume ${fmtK(t.volume24h)}`); }
    if (t.change1h != null && t.change1h <= -70) { score -= 10; reasons.push(`1h move ${t.change1h}% — rug-like candle`); }

    const ageDays = t.poolCreatedAt ? (Date.now() - t.poolCreatedAt) / 86400000 : null;
    if (ageDays != null) {
      if (ageDays >= 30) { score += 10; reasons.push(`pool ${Math.floor(ageDays)}d old`); }
      else if (ageDays < 1) { score -= 15; reasons.push('pool under a day old'); }
      else reasons.push(`pool ${Math.floor(ageDays)}d old`);
    }
  } else {
    score -= 10;
    reasons.push('no DexScreener pool found');
  }

  if (c?.reachable) {
    if (c.freezeAuthority) { score -= 25; reasons.push('freeze authority STILL SET — holder funds can be frozen'); }
    else reasons.push('freeze authority revoked');
    if (c.mintAuthority) { score -= 10; reasons.push('mint authority still set — supply can grow'); }
    if (c.top10Pct != null) {
      if (c.top10Pct <= 25) { score += 10; reasons.push(`top-10 holders ${c.top10Pct}% — distributed`); }
      else if (c.top10Pct >= 70) { score -= 25; reasons.push(`top-10 holders ${c.top10Pct}% — heavily concentrated`); }
      else if (c.top10Pct >= 45) { score -= 12; reasons.push(`top-10 holders ${c.top10Pct}% — concentrated`); }
      else reasons.push(`top-10 holders ${c.top10Pct}%`);
    } else {
      reasons.push('top-holder concentration unavailable on public RPC');
    }
  } else {
    reasons.push('on-chain RPC unreachable — authority checks skipped');
  }

  if (ev.github?.ok) {
    if (ev.github.related?.length) { score += 8; reasons.push(`github: ${ev.github.note}`); }
    else reasons.push(`github: ${ev.github.note}`);
  }

  if (ev.socials) {
    const hasSite = ev.socials.websites?.length > 0;
    const hasX = Boolean(ev.socials.twitter);
    if (hasSite && hasX) { score += 8; reasons.push(`site + @${ev.socials.twitter} present`); }
    else if (hasX) { score += 3; reasons.push(`@${ev.socials.twitter} present, no website`); }
    else if (!hasSite) { score -= 8; reasons.push('no website / socials found'); }
    if (ev.socials.coingecko) { score += 5; reasons.push('listed on CoinGecko'); }
  } else {
    score -= 5;
    reasons.push('no token profile found');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict = score >= 70 ? 'SAFE' : score >= 40 ? 'CAUTION' : 'DANGER';
  return { score, verdict, reasons, summary: `rule-based read: ${verdict.toLowerCase()} at ${score}/100 — verify before aping.` };
}

function fmtK(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}
