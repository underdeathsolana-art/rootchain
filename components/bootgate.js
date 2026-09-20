'use client';

import { useEffect, useRef, useState } from 'react';

export default function BootGate({ initialMode = 'register', onAuthed, onDismiss }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);
  const firstField = useRef(null);

  useEffect(() => {
    setMode(initialMode);
    setError('');
    setIssued(null);
  }, [initialMode]);

  useEffect(() => {
    if (firstField.current) firstField.current.focus();
  }, [mode, issued]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setCopied(false);

    if (mode === 'register') {
      if (username.trim().length < 2) {
        setError('Enter a username of at least 2 characters.');
        return;
      }
      setBusy(true);
      try {
        const res = await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'register', username }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error || 'Registration failed.');
          return;
        }
        setIssued({ username: data.username, code: data.code, existing: data.existing });
      } catch {
        setError('Could not reach the terminal service. Is the dev server running?');
      } finally {
        setBusy(false);
      }
      return;
    }

    const value = code.trim().toUpperCase();
    if (!value) {
      setError('Enter your access code.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', code: value }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Access code not recognised.');
        return;
      }
      onAuthed({ username: data.username, code: data.code });
    } catch {
      setError('Could not reach the terminal service. Is the dev server running?');
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="boot" role="dialog" aria-modal="true" aria-label="Secure access">
      <div className="boot__card">
        <div className="boot__head">
          <h2>Rootchain · Secure Access</h2>
          <p>Identify yourself to open the intelligence channel. Your access code lets you return later.</p>
        </div>

        <div className="boot__body">
          <div className="boot__modes" role="tablist" aria-label="Access method">
            <button
              type="button"
              role="tab"
              className="tab-pill"
              aria-selected={mode === 'register'}
              onClick={() => setMode('register')}
            >
              Register
            </button>
            <button
              type="button"
              role="tab"
              className="tab-pill"
              aria-selected={mode === 'login'}
              onClick={() => setMode('login')}
            >
              Log in
            </button>
          </div>

          {issued ? (
            <div className="issued">
              <span className="hint">Access code issued — keep it. It is your key back in.</span>
              <div className="code" aria-live="polite">
                {issued.code}
              </div>
              <div className="boot__foot">
                <button type="button" className="btn" onClick={copyCode}>
                  {copied ? 'Copied' : 'Copy code'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => onAuthed({ username: issued.username, code: issued.code })}
                >
                  Enter terminal
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              {mode === 'register' ? (
                <div className="field">
                  <label htmlFor="boot-username">Username</label>
                  <input
                    id="boot-username"
                    ref={firstField}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. rootrunner"
                    autoComplete="username"
                    maxLength={24}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'boot-error' : undefined}
                  />
                  <span className="hint">2–24 characters. A unique access code is generated for you.</span>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="boot-code">Access code</label>
                  <input
                    id="boot-code"
                    ref={firstField}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="RC-XXXX-XXXX"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'boot-error' : undefined}
                  />
                  <span className="hint">Format: RC-XXXX-XXXX</span>
                </div>
              )}

              {error ? (
                <p className="err" id="boot-error" role="alert" style={{ marginTop: '8px' }}>
                  {error}
                </p>
              ) : null}

              <div className="boot__foot" style={{ marginTop: '16px' }}>
                {onDismiss ? (
                  <button type="button" className="btn btn--ghost" onClick={onDismiss}>
                    Back to terminal
                  </button>
                ) : (
                  <span className="boot__status">rootchain · {mode === 'register' ? 'new session' : 'returning'}</span>
                )}
                <button type="submit" className="btn btn--primary" disabled={busy} aria-disabled={busy}>
                  {busy ? 'Working…' : mode === 'register' ? 'Generate code' : 'Open channel'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
