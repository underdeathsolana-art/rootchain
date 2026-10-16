'use client';

/**
 * Rootchain Launchpad · `launch` command.
 *
 * A pump.fun coin launcher that fits the amber-CRT terminal: full-screen
 * mode component like social/scan/loom. The vanity mint (`…root` suffix)
 * keypair is generated and verified entirely in this browser, partial-signs
 * the create_v2 transaction, and the connected wallet (Phantom / Solflare)
 * approves the final signature. No private key ever reaches the server;
 * no success state is shown without an on-chain verification.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './launchpad.css';
import {
  LIMITS,
  LINKS,
  buildCreateTransaction,
  connectWallet,
  detectWallets,
  estimateLaunchFees,
  lamportsToSol,
  makeLaunchConnection,
  signSendConfirm,
  verifyLaunch,
} from '@/lib/launch/pumpfun';
import {
  VANITY_SUFFIX,
  defaultWorkerCount,
  expectedAttempts,
  searchVanityMint,
} from '@/lib/launch/vanity';

function shortAddr(a, head = 6, tail = 6) {
  return a && a.length > head + tail + 3 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

function fmtInt(n) {
  try {
    return Number(n).toLocaleString('en-US');
  } catch (_) {
    return String(n);
  }
}

function fmtDuration(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtSol(lamports) {
  return `${lamportsToSol(lamports).toFixed(6)} SOL`;
}

export default function Launchpad({ session, onExit }) {
  /* ------------------------------ session -------------------------------- */
  const opUser = session?.username ?? session?.user ?? '';
  const opCode = session?.code ?? '';

  /* -------------------------------- form --------------------------------- */
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [image, setImage] = useState(null); // File
  const [imageUrl, setImageUrl] = useState(null); // object URL preview

  /* ------------------------------- wallets -------------------------------- */
  const [detected, setDetected] = useState({ phantom: null, solflare: null });
  const [wallet, setWallet] = useState(null); // { name, publicKeyBase58, signTransaction, ... }
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletErr, setWalletErr] = useState('');

  /* -------------------------------- vanity -------------------------------- */
  const [workers, setWorkers] = useState(defaultWorkerCount());
  const [vanity, setVanity] = useState({ phase: 'idle', attempts: 0, ratePerSec: 0, elapsedMs: 0, chance: 0 });
  const [vanityErr, setVanityErr] = useState('');
  const mintRef = useRef(null); // Keypair — lives in memory only, never logged/stored
  const searchRef = useRef(null);
  const launchedRef = useRef(false); // one coin per mint — block re-launch of the same keypair

  /* ------------------------------ launch flow ----------------------------- */
  const [fees, setFees] = useState(null);
  const [stage, setStage] = useState('idle');
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null); // { signature, mint, feeLamports, slot }
  const [launchErr, setLaunchErr] = useState('');
  const [coinInfo, setCoinInfo] = useState(null);
  const [copied, setCopied] = useState('');

  const busy = stage !== 'idle' && stage !== 'done';

  const push = useCallback((tag, text, kind = '') => {
    setLog((l) => [...l, { tag, text, kind }]);
  }, []);

  /* ------------------------------ lifecycle ------------------------------- */
  useEffect(() => {
    setDetected(detectWallets());
    const t = setTimeout(() => setDetected(detectWallets()), 1200); // extensions inject late
    return () => {
      clearTimeout(t);
      if (searchRef.current) searchRef.current.cancel();
      mintRef.current = null; // wipe the mint keypair on exit
    };
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  /* ------------------------------ validation ------------------------------ */
  const badName = name.length > 0 && (name.trim().length < 1 || name.length > LIMITS.nameMax);
  const badSymbol = symbol.length > 0 && !/^[A-Za-z0-9]{1,13}$/.test(symbol.trim());
  const badDescription = description.length > LIMITS.descriptionMax;
  const badWebsite = website.length > 0 && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(website.trim());
  const badTwitter =
    twitter.length > 0 && !/^(https?:\/\/)?(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]{1,20}\/?$/i.test(twitter.trim());
  const badTelegram = telegram.length > 0 && !/^(https?:\/\/)?t\.me\/[A-Za-z0-9_]{2,64}\/?$/i.test(telegram.trim());
  const badImage =
    !!image &&
    (!LIMITS.imageTypes.includes(image.type) || image.size > LIMITS.imageMaxBytes);

  const formValid =
    name.trim().length >= 1 &&
    name.length <= LIMITS.nameMax &&
    /^[A-Za-z0-9]{1,13}$/.test(symbol.trim()) &&
    description.length <= LIMITS.descriptionMax &&
    !badWebsite &&
    !badTwitter &&
    !badTelegram &&
    !!image &&
    !badImage;

  /* -------------------------------- wallet -------------------------------- */
  const connect = useCallback(
    async (kind) => {
      const provider = kind === 'phantom' ? detected.phantom : detected.solflare;
      setWalletErr('');
      setWalletBusy(true);
      try {
        const w = await connectWallet(provider, kind === 'phantom' ? 'Phantom' : 'Solflare');
        setWallet(w);
        push('wallet', `${w.name} connected · ${shortAddr(w.publicKeyBase58, 8, 6)}`, 'ok');
        try {
          const connection = makeLaunchConnection({ username: opUser, code: opCode });
          const f = await estimateLaunchFees(connection);
          setFees(f);
        } catch (e) {
          push('fees', 'fee estimate unavailable — defaults will be used', 'warn');
        }
      } catch (e) {
        const msg = String((e && e.message) || e);
        setWalletErr(/reject|cancel|denied/i.test(msg) ? 'connection request was rejected' : msg);
      } finally {
        setWalletBusy(false);
      }
    },
    [detected, opUser, opCode, push]
  );

  const disconnect = useCallback(() => {
    try {
      if (wallet && wallet.provider && wallet.provider.disconnect) wallet.provider.disconnect();
    } catch (_) {}
    setWallet(null);
    push('wallet', 'wallet disconnected');
  }, [wallet, push]);

  /* -------------------------------- vanity -------------------------------- */
  const startSearch = useCallback(() => {
    if (vanity.phase === 'searching') return;
    setVanityErr('');
    setVanity({ phase: 'searching', attempts: 0, ratePerSec: 0, elapsedMs: 0, chance: 0 });
    push(
      'mint',
      `grinding keypairs for the *${VANITY_SUFFIX} suffix with ${workers} worker${workers > 1 ? 's' : ''} — this is probabilistic and can take a while…`
    );
    const handle = searchVanityMint({
      suffix: VANITY_SUFFIX,
      workerCount: workers,
      onProgress: (p) => setVanity((v) => ({ ...v, ...p, phase: 'searching' })),
    });
    searchRef.current = handle;
    handle.promise
      .then((res) => {
        mintRef.current = res.mintKeypair;
        setVanity({
          phase: 'found',
          address: res.address,
          attempts: res.attempts,
          elapsedMs: res.elapsedMs,
          ratePerSec: 0,
          chance: 1,
        });
        push(
          'mint',
          `vanity mint VERIFIED: ${res.address} (ends in "${VANITY_SUFFIX}" — re-derived and checked on this page)`,
          'ok'
        );
      })
      .catch((err) => {
        if (!err || !err.cancelled) {
          setVanityErr(err && err.message ? err.message : String(err));
          push('mint', String((err && err.message) || err), 'error');
        } else {
          push('mint', 'vanity search stopped');
        }
        setVanity({ phase: 'idle', attempts: 0, ratePerSec: 0, elapsedMs: 0, chance: 0 });
      })
      .finally(() => {
        searchRef.current = null;
      });
  }, [vanity.phase, workers, push]);

  const stopSearch = useCallback(() => {
    if (searchRef.current) searchRef.current.cancel();
  }, []);

  const discardMint = useCallback(() => {
    mintRef.current = null;
    setVanity({ phase: 'idle', attempts: 0, ratePerSec: 0, elapsedMs: 0, chance: 0 });
    push('mint', 'mint keypair discarded from memory — generate a new one before launching');
  }, [push]);

  const downloadKeypair = useCallback(() => {
    const kp = mintRef.current;
    if (!kp) return;
    const address = kp.publicKey.toBase58();
    const seedB64 = btoa(String.fromCharCode.apply(null, kp.secretKey.slice(0, 32)));
    const blob = new Blob([JSON.stringify({ address, seedB64 }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${address}-mint-keypair.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, []);

  /* -------------------------------- copy ---------------------------------- */
  const copy = useCallback(async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 1400);
    } catch (_) {}
  }, []);

  /* ------------------------------ launch flow ----------------------------- */
  const canLaunch = !!wallet && vanity.phase === 'found' && formValid && !busy && !launchedRef.current;

  const onLaunch = useCallback(async () => {
    if (!canLaunch) return;
    setLaunchErr('');
    setCoinInfo(null);
    const mintAddress = mintRef.current.publicKey.toBase58();
    const startedAt = Date.now();

    try {
      // 1) pin metadata (image + json) through our server route
      setStage('meta');
      push('meta', 'uploading image + metadata to ipfs via the rootchain relay…');
      const fd = new FormData();
      fd.append('username', opUser);
      fd.append('code', opCode);
      fd.append('name', name.trim());
      fd.append('symbol', symbol.trim().toUpperCase());
      fd.append('description', description.trim());
      fd.append('website', website.trim());
      fd.append('twitter', twitter.trim());
      fd.append('telegram', telegram.trim());
      fd.append('image', image);
      const metaRes = await fetch('/api/launch', { method: 'POST', body: fd });
      const meta = await metaRes.json().catch(() => ({}));
      if (!metaRes.ok || !meta.ok || !meta.uri) {
        throw new Error(meta.error || `metadata upload failed (${metaRes.status})`);
      }
      push('meta', `metadata pinned · ${meta.uri}`, 'ok');

      // 2) build the create_v2 transaction with the vanity mint
      setStage('build');
      const connection = makeLaunchConnection({ username: opUser, code: opCode });
      const payer = wallet.publicKeyBase58;
      const { transaction, blockhash, lastValidBlockHeight } = await buildCreateTransaction({
        connection,
        payer,
        creator: payer,
        mintKeypair: mintRef.current,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        uri: meta.uri,
        priorityMicroLamports: fees ? fees.priorityMicroLamports : undefined,
      });
      push('build', `create_v2 built · mint ${shortAddr(mintAddress, 10, 8)}…root · fees ≈ ${fees ? fmtSol(fees.totalLamports) : '—'}`);

      // 3) wallet signs (explicit user approval inside Phantom/Solflare)
      setStage('sign');
      push('sign', `approve the transaction in ${wallet.name} — check the mint ends in "${VANITY_SUFFIX}"`, 'warn');
      const { signature } = await signSendConfirm({
        wallet,
        connection,
        transaction,
        blockhash,
        lastValidBlockHeight,
        onStage: setStage,
      });
      push('send', `transaction sent · ${signature}`, 'ok');

      // 4) verify ON-CHAIN before claiming anything
      setStage('verify');
      const verify = await verifyLaunch(connection, signature, mintAddress);
      if (!verify.ok) throw new Error(verify.reason);
      push(
        'verify',
        `on-chain VERIFIED · pump program ${verify.invokedPump ? 'invoked' : 'present'} · mint owned by token-2022 · fee ${fmtSol(verify.feeLamports)} · slot ${verify.slot}`,
        'ok'
      );

      // 5) pump.fun coin data — best effort, purely informational
      fetch('/api/launch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'coin', username: opUser, code: opCode, mint: mintAddress }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d && !d.error && typeof d === 'object') setCoinInfo(d);
        })
        .catch(() => {});

      setResult({
        signature,
        mint: mintAddress,
        feeLamports: verify.feeLamports,
        slot: verify.slot,
        elapsedMs: Date.now() - startedAt,
      });
      launchedRef.current = true;
      setStage('done');
      push('launch', `LIVE — ${name.trim()} (${symbol.trim().toUpperCase()}) launched on-chain in ${fmtDuration((Date.now() - startedAt) / 1000)}`, 'ok');
    } catch (e) {
      const msg = String((e && e.message) || e);
      setLaunchErr(/user rejected|user denied/i.test(msg) ? 'you rejected the transaction in the wallet' : msg);
      push('error', msg, 'error');
      setStage('idle');
    }
  }, [canLaunch, opUser, opCode, name, symbol, description, website, twitter, telegram, image, wallet, fees, push]);

  const resetLaunch = useCallback(() => {
    // one coin per mint: forget the used keypair, force a fresh vanity search
    launchedRef.current = false;
    mintRef.current = null;
    setVanity({ phase: 'idle', attempts: 0, ratePerSec: 0, elapsedMs: 0, chance: 0 });
    setStage('idle');
    setLaunchErr('');
  }, []);

  /* -------------------------------- render -------------------------------- */
  const eta = vanity.ratePerSec > 0 ? expectedAttempts(VANITY_SUFFIX) / vanity.ratePerSec : null;
  const expAttempts = expectedAttempts(VANITY_SUFFIX);

  const launchBlockReason = !wallet
    ? 'connect a wallet first'
    : vanity.phase !== 'found'
      ? 'generate a *root mint first'
      : !formValid
        ? 'complete the token form'
        : '';

  const disabledReason = useMemo(() => {
    if (!name && !symbol && !image) return 'fill in the token form';
    return null;
  }, [name, symbol, image]);

  return (
    <div className="launch">
      <header className="lp-hdr">
        <div className="lp-hdr__left">
          <h1 className="lp-hdr__title">Launchpad</h1>
          <span className="lp-hdr__sub">solana mainnet</span>
          <span className="lp-suffix">
            suffix <b>*{VANITY_SUFFIX}</b>
          </span>
        </div>
        <button className="lp-exit" onClick={onExit} type="button">
          [ exit ]
        </button>
      </header>

      <div className="lp-body">
        {/* ------------------------- left: token form ------------------------- */}
        <section className="lp-panel">
          <div className="lp-panel__head">
            <span>Token</span>
            <span>metadata pinned to ipfs</span>
          </div>
          <div className="lp-panel__body">
            <div className="lp-row2">
              <div className="lp-field">
                <label className="lp-field__label" htmlFor="lp-name">
                  name <span className={`lp-field__count${name.length > LIMITS.nameMax ? ' lp-field__count--over' : ''}`}>{name.length}/{LIMITS.nameMax}</span>
                </label>
                <input
                  id="lp-name"
                  className={`lp-input${badName ? ' lp-input--bad' : ''}`}
                  value={name}
                  maxLength={64}
                  placeholder="rootchain root"
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </div>
              <div className="lp-field">
                <label className="lp-field__label" htmlFor="lp-symbol">
                  ticker <span className={`lp-field__count${symbol.length > LIMITS.symbolMax ? ' lp-field__count--over' : ''}`}>{symbol.length}/{LIMITS.symbolMax}</span>
                </label>
                <input
                  id="lp-symbol"
                  className={`lp-input${badSymbol ? ' lp-input--bad' : ''}`}
                  value={symbol}
                  maxLength={16}
                  placeholder="ROOT"
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-field__label" htmlFor="lp-desc">
                description <span className={`lp-field__count${description.length > LIMITS.descriptionMax ? ' lp-field__count--over' : description.length > LIMITS.descriptionMax - 50 ? ' lp-field__count--near' : ''}`}>{description.length}/{LIMITS.descriptionMax}</span>
              </label>
              <textarea
                id="lp-desc"
                className={`lp-textarea${badDescription ? ' lp-textarea--bad' : ''}`}
                value={description}
                maxLength={LIMITS.descriptionMax + 50}
                placeholder="a few lines about the token…"
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="lp-field">
              <span className="lp-field__label">token image (required)</span>
              <label className="lp-drop" htmlFor="lp-image">
                <span className="lp-drop__thumb" style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}>
                  {imageUrl ? '' : 'IMG'}
                </span>
                <span className="lp-drop__meta">
                  <span className={`lp-drop__file${badImage ? ' lp-drop__file--bad' : ''}`}>
                    {image ? image.name : 'click to select a file'}
                  </span>
                  <span className="lp-drop__hint">
                    png · jpeg · gif · webp — 5MB max{image ? ` · ${(image.size / 1024).toFixed(0)}KB` : ''}
                  </span>
                </span>
                <input
                  id="lp-image"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  style={{ display: 'none' }}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (imageUrl) URL.revokeObjectURL(imageUrl);
                    setImage(f || null);
                    setImageUrl(f ? URL.createObjectURL(f) : null);
                  }}
                />
              </label>
            </div>

            <div className="lp-row2">
              <div className="lp-field">
                <label className="lp-field__label" htmlFor="lp-web">website</label>
                <input id="lp-web" className={`lp-input${badWebsite ? ' lp-input--bad' : ''}`} value={website} placeholder="https://rtcterminal.com" onChange={(e) => setWebsite(e.target.value)} disabled={busy} />
              </div>
              <div className="lp-field">
                <label className="lp-field__label" htmlFor="lp-x">x / twitter</label>
                <input id="lp-x" className={`lp-input${badTwitter ? ' lp-input--bad' : ''}`} value={twitter} placeholder="https://x.com/RTCterminal" onChange={(e) => setTwitter(e.target.value)} disabled={busy} />
              </div>
            </div>
            <div className="lp-field">
              <label className="lp-field__label" htmlFor="lp-tg">telegram</label>
              <input id="lp-tg" className={`lp-input${badTelegram ? ' lp-input--bad' : ''}`} value={telegram} placeholder="https://t.me/…" onChange={(e) => setTelegram(e.target.value)} disabled={busy} />
            </div>

            {disabledReason ? <p className="lp-note">{disabledReason}</p> : null}
          </div>
        </section>

        {/* ------------------------- right: ops column ------------------------ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          {/* wallet */}
          <section className="lp-panel">
            <div className="lp-panel__head">
              <span>Wallet</span>
              <span>signs the launch</span>
            </div>
            <div className="lp-panel__body">
              <div className="lp-walletrow">
                <button
                  type="button"
                  className={`lp-chip${wallet && wallet.name === 'Phantom' ? ' lp-chip--on' : !detected.phantom ? ' lp-chip--off' : ''}`}
                  onClick={() => (wallet && wallet.name === 'Phantom' ? null : connect('phantom'))}
                  disabled={walletBusy || !!wallet || !detected.phantom}
                >
                  <span className="lp-dot" /> phantom {detected.phantom ? '' : '· not found'}
                </button>
                <button
                  type="button"
                  className={`lp-chip${wallet && wallet.name === 'Solflare' ? ' lp-chip--on' : !detected.solflare ? ' lp-chip--off' : ''}`}
                  onClick={() => (wallet && wallet.name === 'Solflare' ? null : connect('solflare'))}
                  disabled={walletBusy || !!wallet || !detected.solflare}
                >
                  <span className="lp-dot" /> solflare {detected.solflare ? '' : '· not found'}
                </button>
                {wallet ? (
                  <>
                    <span className="lp-addr">{shortAddr(wallet.publicKeyBase58, 8, 6)}</span>
                    <button type="button" className="lp-chip" onClick={disconnect} disabled={walletBusy}>
                      disconnect
                    </button>
                  </>
                ) : null}
              </div>
              {!detected.phantom && !detected.solflare ? (
                <p className="lp-note">
                  no solana wallet detected — install{' '}
                  <a className="lp-link" href="https://phantom.app/" target="_blank" rel="noreferrer noopener">phantom</a>{' '}
                  or <a className="lp-link" href="https://solflare.com/" target="_blank" rel="noreferrer noopener">solflare</a>
                </p>
              ) : null}
              {walletErr ? <p className="lp-err">{walletErr}</p> : null}
              <p className="lp-note">
                the wallet only signs the launch transaction after you approve it. rootchain never sees seed
                phrases or private keys, and never moves funds on its own.
              </p>
            </div>
          </section>

          {/* vanity mint */}
          <section className="lp-panel">
            <div className="lp-panel__head">
              <span>Vanity mint</span>
              <span>ends in *{VANITY_SUFFIX}</span>
            </div>
            <div className="lp-panel__body">
              {vanity.phase === 'found' ? (
                <div className="lp-mint">
                  <span className="lp-mint__note">verified mint address (re-derived on this page):</span>
                  <span className="lp-mint__addr">
                    {vanity.address.slice(0, -VANITY_SUFFIX.length)}
                    <span className="lp-tail">{VANITY_SUFFIX}</span>
                  </span>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button type="button" className={`lp-copy${copied === 'mint' ? ' lp-copy--done' : ''}`} onClick={() => copy(vanity.address, 'mint')}>
                      {copied === 'mint' ? 'copied ✓' : 'copy address'}
                    </button>
                    <button type="button" className="lp-copy" onClick={downloadKeypair}>
                      backup keypair
                    </button>
                    <button type="button" className="lp-copy" onClick={discardMint} disabled={busy}>
                      discard
                    </button>
                  </div>
                  <span className="lp-mint__note">
                    found after {fmtInt(vanity.attempts)} attempts in {fmtDuration(vanity.elapsedMs / 1000)} · the
                    keypair lives only in this tab&apos;s memory
                  </span>
                </div>
              ) : vanity.phase === 'searching' ? (
                <div className="lp-vanity">
                  <div className="lp-vanity__stats">
                    <span>
                      <div className="lp-vanity__k">attempts</div>
                      <div className="lp-vanity__v">{fmtInt(vanity.attempts)}</div>
                    </span>
                    <span>
                      <div className="lp-vanity__k">rate</div>
                      <div className="lp-vanity__v">{fmtInt(vanity.ratePerSec)} k/s</div>
                    </span>
                    <span>
                      <div className="lp-vanity__k">expected · {fmtInt(expAttempts)}</div>
                      <div className="lp-vanity__v--warn lp-vanity__v">eta ≈ {fmtDuration(eta)}</div>
                    </span>
                    <span>
                      <div className="lp-vanity__k">hit chance so far</div>
                      <div className="lp-vanity__v">{(vanity.chance * 100).toFixed(2)}%</div>
                    </span>
                  </div>
                  <div
                    className="lp-bar"
                    title={`progress toward the statistical expectation (${fmtInt(expAttempts)} attempts) — a hit can happen at any moment`}
                  >
                    <div
                      className="lp-bar__fill"
                      style={{ width: `${Math.min(100, (vanity.attempts / expAttempts) * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <p className="lp-note">
                    grinding off the main thread — the bar tracks attempts vs the statistical expectation
                    ({fmtInt(expAttempts)}), not a guaranteed finish. keep this tab open.
                  </p>
                  <button type="button" className="lp-btn lp-btn--stop" onClick={stopSearch}>
                    stop search
                  </button>
                </div>
              ) : (
                <div className="lp-vanity">
                  <p className="lp-note">
                    generate a fresh solana mint whose address ends exactly in <b>*{VANITY_SUFFIX}</b> (case-sensitive,
                    part of the address itself). the current <b>create_v2</b> launch flow accepts a
                    caller-supplied mint keypair, so the suffix is real — but finding it is probabilistic: expect
                    roughly <b>{fmtInt(expAttempts)}</b> keypairs on average, typically minutes at full speed.
                  </p>
                  <div className="lp-workers" aria-label="worker count">
                    {[1, 2, 4, 6].map((n) => (
                      <button key={n} type="button" aria-pressed={workers === n} onClick={() => setWorkers(n)}>
                        {n} worker{n > 1 ? 's' : ''}
                      </button>
                    ))}
                  </div>
                  {vanityErr ? <p className="lp-err">{vanityErr}</p> : null}
                  <button type="button" className="lp-btn" onClick={startSearch}>
                    generate *{VANITY_SUFFIX} mint
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* fees + preview + launch */}
          <section className="lp-panel">
            <div className="lp-panel__head">
              <span>Preview &amp; fees</span>
              <span>estimate — exact fee shown after launch</span>
            </div>
            <div className="lp-panel__body">
              {(name || symbol || imageUrl) && (
                <div className="lp-preview">
                  {imageUrl ? (
                    <img className="lp-preview__img" src={imageUrl} alt="token preview" />
                  ) : (
                    <span className="lp-drop__thumb" style={{ width: 56, height: 56 }}>IMG</span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="lp-preview__name">{name.trim() || 'unnamed token'}</div>
                    <div className="lp-preview__sym">${symbol.trim() || 'TICKER'}</div>
                    <div className="lp-preview__meta">
                      bonding curve · solana mainnet{website.trim() ? ` · ${website.trim()}` : ''}
                    </div>
                  </div>
                </div>
              )}

              <div className="lp-fees">
                <div className="lp-fees__row">
                  <span>transaction fee (2 signatures)</span>
                  <span>{fees ? fmtSol(fees.baseLamports) : '0.000010 SOL'}</span>
                </div>
                <div className="lp-fees__row">
                  <span>mint rent (token-2022 + metadata)</span>
                  <span>{fees ? fmtSol(fees.rentLamports) : '≈0.002 SOL'}</span>
                </div>
                <div className="lp-fees__row">
                  <span>priority fee ({fees ? `${fmtInt(fees.priorityMicroLamports)} µL/CU × 400k CU` : 'default'})</span>
                  <span>{fees ? fmtSol(fees.priorityLamports) : '≈0.00005 SOL'}</span>
                </div>
                <div className="lp-fees__row lp-fees__row--total">
                  <span>estimated total</span>
                  <span>{fees ? fmtSol(fees.totalLamports) : '≈0.0021 SOL'}</span>
                </div>
              </div>
              <p className="lp-note">
                estimate only — the exact fee and rent come from the confirmed transaction. the wallet pays everything;
                rootchain charges nothing.
              </p>

              {stage === 'done' && result ? (
                <div className="lp-success">
                  <span className="lp-success__title">▲ launched &amp; verified on-chain</span>
                  <div className="lp-mint" style={{ border: 0, background: 'transparent', padding: 0 }}>
                    <span className="lp-mint__note">verified mint (actual, on-chain):</span>
                    <span className="lp-mint__addr">
                      {result.mint.slice(0, -VANITY_SUFFIX.length)}
                      <span className="lp-tail">{VANITY_SUFFIX}</span>
                    </span>
                    <div className="lp-links">
                      <button type="button" className={`lp-copy${copied === 'result' ? ' lp-copy--done' : ''}`} onClick={() => copy(result.mint, 'result')}>
                        {copied === 'result' ? 'copied ✓' : 'copy mint'}
                      </button>
                      <a className="lp-link" href={LINKS.pumpCoin(result.mint)} target="_blank" rel="noreferrer noopener">coin ↗</a>
                      <a className="lp-link" href={LINKS.solscanToken(result.mint)} target="_blank" rel="noreferrer noopener">solscan ↗</a>
                      <a className="lp-link" href={LINKS.solscanTx(result.signature)} target="_blank" rel="noreferrer noopener">tx ↗</a>
                    </div>
                    <span className="lp-mint__note">
                      actual network cost {fmtSol(result.feeLamports)} (fees) + rent · slot {fmtInt(result.slot)}
                      {coinInfo ? ` · listing live` : ''}
                    </span>
                  </div>
                  <button type="button" className="lp-btn lp-btn--ghost" onClick={resetLaunch}>
                    ready another launch (new *{VANITY_SUFFIX} mint required)
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="lp-btn lp-btn--big" onClick={onLaunch} disabled={!canLaunch}>
                    {busy ? (
                      <>
                        <span className="lp-spin" /> {stage}…
                      </>
                    ) : (
                      <>▲ launch token</>
                    )}
                  </button>
                  {!busy && launchBlockReason ? (
                    <p className="lp-note">launch locked: {launchBlockReason}.</p>
                  ) : null}
                  {launchErr ? <p className="lp-err">{launchErr}</p> : null}
                </>
              )}
            </div>
          </section>

          {/* log */}
          <section className="lp-panel">
            <div className="lp-panel__head">
              <span>Launch log</span>
              <span>{log.length} lines</span>
            </div>
            <div className="lp-panel__body">
              <div className="lp-log" role="log">
                {log.length === 0 ? (
                  <div className="line">
                    <span className="line__tag">sys</span>
                    <span className="line__text">launchpad ready — connect a wallet and generate a *{VANITY_SUFFIX} mint to begin.</span>
                  </div>
                ) : (
                  log.map((l, i) => (
                    <div key={i} className={`line line--${l.kind || 'cmd'}`}>
                      <span className="line__tag">{l.tag}</span>
                      <span className="line__text">{l.text}</span>
                    </div>
                  ))
                )}
                {busy ? (
                  <div className="line">
                    <span className="line__tag">sys</span>
                    <span className="line__text">
                      {stage === 'sign' ? 'waiting for wallet approval' : `working: ${stage}`}
                      <span className="caret" />
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="lp-note">
                one coin per mint — after a launch, generate a fresh *{VANITY_SUFFIX} mint for the next one. metadata
                upload requires <b>PINATA_JWT</b> on the server; signing requires your wallet.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
