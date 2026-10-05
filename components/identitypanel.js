'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';

function shortAddr(a) {
  return a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '';
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
export default function IdentityPanel({ session, onClose }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  const [identity, setIdentity] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
            Privy is not configured on this deploy — set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.
          </p>
        ) : null}

        <div className="kv" style={{ display: 'grid', gap: '10px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <span>X (Twitter)</span>
            <b style={{ wordBreak: 'break-all' }}>
              {tw?.username ? `@${tw.username}` : ready && authenticated ? 'not linked to this Privy account' : 'not linked'}
            </b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <span>Wallets</span>
            <b style={{ wordBreak: 'break-all', textAlign: 'right' }}>
              {(identity?.wallets || []).length
                ? identity.wallets.map((w) => `${shortAddr(w.address)}${w.chainType ? ` · ${w.chainType}` : ''}${w.embedded ? ' · embedded' : ''}`).join('\n')
                : wallets.length
                  ? wallets.map((w) => shortAddr(w.address)).join(', ')
                  : 'none yet'}
            </b>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span>Privy session</span>
            <b>{!ready ? 'loading…' : authenticated ? `live (${user?.id || 'user'})` : 'not connected'}</b>
          </div>
        </div>

        {error ? (
          <p className="err" role="alert" style={{ margin: '0 0 10px' }}>
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
