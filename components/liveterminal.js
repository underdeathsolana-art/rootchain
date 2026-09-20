'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const RELAY_INTERVAL = 3000;

/**
 * Live relay terminal — a second, dedicated terminal for operator-to-operator
 * chat. Typing here speaks directly on the relay (no command prefix); the
 * roster lists every registered user with live presence.
 */
export default function LiveTerminal({ session, relay, onExit }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [online, setOnline] = useState(relay?.online || []);
  const [operators, setOperators] = useState(relay?.operators || []);
  const [storage, setStorage] = useState(relay?.store || '');

  const idRef = useRef(0);
  const cursorRef = useRef('');
  const syncedRef = useRef(false);
  const busyRef = useRef(false);
  const bootedRef = useRef(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const push = useCallback((line) => {
    setLines((prev) => [
      ...prev.slice(-199),
      {
        id: (idRef.current += 1),
        kind: line.kind || 'net',
        tag: line.tag || null,
        me: Boolean(line.me),
        text: String(line.text ?? ''),
      },
    ]);
  }, []);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const poll = useCallback(async () => {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    try {
      const params = new URLSearchParams({ since: cursorRef.current });
      params.set('username', session.username);
      params.set('code', session.code);
      const res = await fetch(`/api/relay?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) return;

      setOnline(data.online || []);
      setOperators(data.operators || []);
      if (data.store) setStorage(data.store);

      const incoming = data.messages || [];

      // First poll after opening: sync silently, surface only the tail.
      if (!syncedRef.current) {
        syncedRef.current = true;
        cursorRef.current = data.lastCursor || '';
        for (const m of incoming.slice(-5)) {
          push({
            tag: `[RELAY] ${m.username}`,
            text: m.text,
            me: m.username === session.username,
          });
        }
        return;
      }

      for (const m of incoming) {
        push({
          tag: `[RELAY] ${m.username}`,
          text: m.text,
          me: m.username === session.username,
        });
      }
      cursorRef.current = data.lastCursor || cursorRef.current;
    } catch {
      /* keep previous */
    } finally {
      busyRef.current = false;
    }
  }, [session, push]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    push({ kind: 'head', text: 'ROOTCHAIN RELAY // LIVE TERMINAL', me: false });
    push({
      kind: 'sys',
      text: `operators: ${relay?.operators?.length ?? 0} registered · ${relay?.online?.length ?? 0} online`,
      me: false,
    });
    push({ kind: 'sys', text: 'type to talk · "who" for the roster · "exit" to return', me: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        poll();
      }
    }, RELAY_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  async function onSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;

    const word = value.split(/\s+/)[0].toLowerCase();
    if (word === 'exit' || word === 'quit' || word === 'back') {
      onExit();
      return;
    }

    if (word === 'who') {
      push({ kind: 'sys', text: `OPERATORS — ${operators.length} registered · ${online.length} online`, me: false });
      for (const op of operators) {
        push({
          kind: 'sys',
          text: `  ${online.includes(op.username) ? '●' : '○'} ${op.username}${op.username === session.username ? ' · you' : ''}`,
          me: false,
        });
      }
      return;
    }

    if (word === 'clear') {
      setLines([]);
      return;
    }

    try {
      const res = await fetch('/api/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, text: value }),
      });
      const data = await res.json();
      if (data.ok) {
        cursorRef.current = data.cursor || cursorRef.current;
        push({ tag: `[RELAY] ${session.username}`, text: value, me: true });
      } else {
        push({ kind: 'error', text: `relay refused — ${data.error || 'try again.'}`, me: false });
      }
    } catch {
      push({ kind: 'error', text: 'relay unreachable — is the terminal service running?', me: false });
    }
  }

  const storageLabel = storage === 'mongodb' ? 'MONGODB' : storage === 'file' ? 'FILE' : '—';

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">Rootchain Relay // Live Terminal</h1>
        <div className="hdr__meta">
          <span className="hdr__user">
            USER <b>{session.username}</b>
          </span>
          <span className="kbview">
            {online.length} online · {operators.length} registered · {storageLabel}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit relay
          </button>
        </div>
      </header>

      <div className="main live__main">
        <section className="feedwrap" aria-label="Relay channel">
          <div className="feedwrap__bar">
            <span>operator relay — live channel</span>
            <span className="feedwrap__hint-sys">storage: {storageLabel}</span>
          </div>

          <div className="log" ref={scrollRef} role="log" aria-label="Relay output">
            {lines.length === 0 ? (
              <div className="line line--sys">
                <span className="line__text">Waiting for the first operator transmission…</span>
              </div>
            ) : null}

            {lines.map((line) => (
              <div
                key={line.id}
                className={`line line--${line.kind}${line.me ? ' line--me' : ''}`}
              >
                {line.tag ? (
                  <span className="line__tag" aria-hidden="true">
                    {line.tag}
                  </span>
                ) : null}
                <span className="line__text">{line.text}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="panels" aria-label="Registered operators">
          <section className="panel" data-panel="relay">
            <div className="panel__head">
              <span>Operators / registered</span>
              <span>
                {online.length}/{operators.length}
              </span>
            </div>
            <div className="panel__body">
              {operators.length ? (
                <ul className="filelist">
                  {operators.map((op) => {
                    const isOnline = online.includes(op.username);
                    return (
                      <li key={op.username} className={isOnline ? 'active' : ''}>
                        <span>
                          {isOnline ? '●' : '○'} {op.username}
                          {op.username === session.username ? ' · you' : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mem-empty">No registered operators yet.</p>
              )}
              <p className="mem-empty" style={{ marginTop: '10px' }}>
                ● online now · ○ offline
              </p>
            </div>
          </section>
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {lines.length ? `${lines[lines.length - 1].tag ? `${lines[lines.length - 1].tag}: ` : ''}${lines[lines.length - 1].text}` : ''}
      </p>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="relay-input">
          Relay message
        </label>
        <span className="composer__prompt" aria-hidden="true">
          <b>{session.username}</b>@relay:~$
        </span>
        <input
          id="relay-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (input) setInput('');
              else onExit();
            }
          }}
          placeholder="type to talk to every connected operator"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="relay-hint"
        />
        <span className="composer__hint" id="relay-hint">
          Enter ⏎ send · ESC exit
        </span>
      </form>
    </div>
  );
}
