'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';

function shortAddr(a) {
  return a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '';
}

/** A wallet address rendered as a click-to-copy chip (full address copies). */
function CopyWallet({ address, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      style={{ wordBreak: 'break-all', maxWidth: '100%' }}
      title={`copy ${address}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — the title still shows the address */
        }
      }}
    >
      {copied ? 'COPIED ✓' : `${shortAddr(address)}${label ? ` · ${label}` : ''} ⧉`}
    </button>
  );
}

/**
 * Identity panel — links an operator's terminal account to their X (Twitter)
 * and an embedded wallet through Privy. The flow: "connect" opens Privy's
 * modal (X / external wallet / email); logging in without a wallet
 * auto-creates embedded Solana + Ethereum wallets. Once authenticated, the
 * Privy access token goes to /api/identity, which verifies it server-side
 * and reads the linked accounts straight from Privy's API — the browser
 * never supplies the values it wants saved.
 */
export default function IdentityPanel({ session, onClose, onLinked }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  const [identity, setIdentity] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ascii, setAscii] = useState(null);
  const [asciiBusy, setAsciiBusy] = useState(false);
  const [savedAscii, setSavedAscii] = useState(false);
  const syncedRef = useRef('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ username: session.username, code: session.code });
      const res = await fetch(`/api/identity?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setIdentity(data.identity);
        setConfigured(data.configured !== false);
      }
    } catch {
      /* keep previous */
    }
  }, [session.code, session.username]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-sync once on mount when a Privy session already exists — picks up
  // avatar/name changes from re-links without waiting for a re-login.
  useEffect(() => {
    if (ready && authenticated) sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated]);

  // Push the Privy session to the terminal whenever the account or wallets change.
  const sync = useCallback(async () => {
    if (!authenticated || busy) return;
    setBusy(true);
    setError('');
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, token }),
      });
      const data = await res.json();
      if (data.ok) {
        setIdentity(data.identity);
        if (onLinked) onLinked(data.identity);
      } else if (/expired/i.test(String(data.error))) {
        // A stale Privy token is normal after the tab slept — retry quietly,
        // never surface a "reconnect" scare to the operator.
        try {
          const fresh = await getAccessToken();
          if (fresh) {
            const retry = await fetch('/api/identity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: session.username, code: session.code, token: fresh }),
            });
            const data2 = await retry.json();
            if (data2.ok) {
              setIdentity(data2.identity);
              if (onLinked) onLinked(data2.identity);
            }
          }
        } catch {
          /* silent */
        }
      } else {
        setError(data.error || 'sync refused.');
      }
    } catch {
      setError('identity desk unreachable.');
    } finally {
      setBusy(false);
    }
  }, [authenticated, busy, getAccessToken, session.code, session.username]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    const sig = `${user?.id || ''}:${wallets.length}`;
    if (syncedRef.current === sig) return;
    syncedRef.current = sig;
    sync();
  }, [ready, authenticated, user, wallets.length, sync]);

  const tw = identity?.twitter || user?.twitter
    ? (identity?.twitter || { username: user?.twitter?.username || user?.twitter?.name || '' })
    : null;

  async function onCreateWallet() {
    setBusy(true);
    setError('');
    try {
      await createWallet();
      syncedRef.current = '';
    } catch (err) {
      setError(String(err?.message || err).slice(0, 160));
    } finally {
      setBusy(false);
    }
  }

  async function onMakeAscii() {
    setAsciiBusy(true);
    setError('');
    setSavedAscii(false);
    try {
      const res = await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'ascii' }),
      });
      const data = await res.json();
      if (data.ok) setAscii(data.ascii);
      else setError(data.error);
    } catch {
      setError('avatar desk unreachable.');
    } finally {
      setAsciiBusy(false);
    }
  }

  async function onSaveAscii() {
    if (!ascii) return;
    setAsciiBusy(true);
    try {
      const res = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'profile', ascii }),
      });
      const data = await res.json();
      setSavedAscii(Boolean(data.ok));
      if (!data.ok) setError(data.error || 'save refused.');
    } catch {
      setError('social desk unreachable.');
    } finally {
      setAsciiBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Operator identity"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="boot__card" style={{ width: 'min(640px, 92vw)', padding: '18px' }}>
        <div className="boot__head">
          <h2 style={{ margin: 0, fontSize: 'inherit' }}>OPERATOR IDENTITY — X + WALLET</h2>
          <p style={{ margin: '4px 0 12px' }}>
            Link your X (Twitter) and create an embedded wallet. Verified by Privy; stored on your operator.
          </p>
        </div>

        {!configured ? (
          <p className="err" role="alert">
            Privy is not configured on this deploy — add NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET in
            Vercel (Settings → Environment Variables), then Redeploy. Local dev already works.
          </p>
        ) : null}

        <div style={{ display: 'grid', gap: '10px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span style={{ flexShrink: 0 }}>X (Twitter)</span>
            <b style={{ flex: 1, minWidth: 0, textAlign: 'right', overflowWrap: 'break-word' }}>
              {!configured
                ? 'not configured'
                : tw?.username
                  ? `@${tw.username}`
                  : ready && authenticated
                    ? 'not linked to this Privy account'
                    : 'not linked'}
            </b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ flexShrink: 0 }}>Wallets</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              {!configured ? (
                <b style={{ textAlign: 'right' }}>not configured</b>
              ) : (identity?.wallets || []).length ? (
                identity.wallets.map((w) => (
                  <CopyWallet
                    key={w.address}
                    address={w.address}
                    label={`${w.chainType || ''}${w.embedded ? ' · embedded' : ''}`.trim() || null}
                  />
                ))
              ) : wallets.length ? (
                wallets.map((w) => <CopyWallet key={w.address} address={w.address} />)
              ) : (
                <b style={{ textAlign: 'right' }}>none yet</b>
              )}
            </div>
          </div>
        </div>

        {identity?.twitter?.username ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--sm" onClick={onMakeAscii} disabled={asciiBusy}>
                {asciiBusy && !ascii ? 'Rendering…' : 'ASCII from X avatar'}
              </button>
              {ascii ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={onSaveAscii} disabled={asciiBusy}>
                  {savedAscii ? 'Saved ✓' : 'Save as profile ASCII'}
                </button>
              ) : null}
            </div>
            {ascii ? (
              <pre
                className="ascii"
                style={{ margin: '10px 0 0', fontSize: '10px', lineHeight: 1.15, overflowX: 'auto' }}
              >
                {ascii}
              </pre>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="err" role="alert" style={{ margin: '12px 0 10px' }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {ready && !authenticated ? (
            <button type="button" className="btn btn--primary" onClick={() => login()} disabled={!configured}>
              Connect X / wallet
            </button>
          ) : null}
          {ready && authenticated ? (
            <>
              {!(identity?.wallets || []).length && !wallets.length ? (
                <button type="button" className="btn btn--primary" onClick={onCreateWallet} disabled={busy}>
                  {busy ? 'Creating…' : 'Create wallet'}
                </button>
              ) : null}
              {busy ? <span className="hint">syncing…</span> : null}
              <button
                type="button"
                className="btn btn--ghost"
                onClick={async () => {
                  await logout();
                  syncedRef.current = '';
                }}
              >
                Log out Privy
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
