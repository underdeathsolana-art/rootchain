'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { userColor } from '@/lib/usercolor';

const RELAY_INTERVAL = 3000;

/** Resolve a canonical roster name from a stored (lowercase) DM target. */
function displayName(name, operators) {
  const hit = (operators || []).find((o) => o.username.toLowerCase() === String(name).toLowerCase());
  return hit ? hit.username : name;
}

/** Split text into segments, highlighting @mentions of known operators. */
function mentionSegments(text, operators, me) {
  const names = (operators || [])
    .map((o) => o.username)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!names.length || !text.includes('@')) {
    return [{ text, mention: false }];
  }

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`@(${escaped})`, 'gi');
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), mention: false });
    const isMe = me && m[1].toLowerCase() === me.toLowerCase();
    out.push({ text: m[0], mention: true, me: Boolean(isMe) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

function lineMentionsMe(text, operators, me) {
  if (!me || !text.includes('@')) return false;
  return mentionSegments(text, operators, me).some((s) => s.mention && s.me);
}

/**
 * Live relay terminal — a second, dedicated terminal for operator-to-operator
 * chat. Typing here speaks directly on the relay; the roster lists every
 * registered user with live presence. Each operator keeps a stable colour,
 * @mentions light up, and `dm <name> <message>` speaks privately.
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
  const operatorsRef = useRef(relay?.operators || []);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    operatorsRef.current = operators;
  }, [operators]);

  const push = useCallback((line) => {
    setLines((prev) => [
      ...prev.slice(-199),
      {
        id: (idRef.current += 1),
        kind: line.kind || 'net',
        tag: line.tag || null,
        me: Boolean(line.me),
        mentioned: Boolean(line.mentioned),
        color: line.color || null,
        segments: line.segments || null,
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

  const pushMessage = useCallback((m) => {
    const ops = operatorsRef.current;
    const isDM = Boolean(m.to);
    const mine = m.username === session.username;

    if (isDM) {
      const target = mine ? displayName(m.to, ops) : displayName(m.username, ops);
      push({
        kind: 'dm',
        me: mine,
        color: userColor(mine ? m.to : m.username),
        tag: mine ? `[DM · you » ${target}]` : `[DM · ${target} » you]`,
        text: m.text,
      });
      return;
    }

    const mentioned = lineMentionsMe(m.text, ops, session.username);
    push({
      kind: 'net',
      me: mine,
      mentioned,
      color: userColor(m.username),
      tag: `[RELAY] ${m.username}`,
      segments: mentionSegments(m.text, ops, session.username),
      text: m.text,
    });
  }, [push, session.username]);

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

      // First poll after opening: replay the full retained history (the
      // server already caps it), so re-login always shows every line.
      if (!syncedRef.current) {
        syncedRef.current = true;
        cursorRef.current = data.lastCursor || '';
        for (const m of incoming) pushMessage(m);
        return;
      }

      for (const m of incoming) pushMessage(m);
      cursorRef.current = data.lastCursor || cursorRef.current;
    } catch {
      /* keep previous */
    } finally {
      busyRef.current = false;
    }
  }, [session, pushMessage]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    push({ kind: 'head', text: 'ROOTCHAIN RELAY // LIVE TERMINAL' });
    push({
      kind: 'sys',
      text: `operators: ${relay?.operators?.length ?? 0} registered · ${relay?.online?.length ?? 0} online`,
    });
    push({
      kind: 'sys',
      text: 'type to talk · @name mentions · dm <name> <message> · "who" roster · "exit" to return',
    });
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

  const sendToRelay = useCallback(
    async (payload) => {
      try {
        const res = await fetch('/api/relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: session.username, code: session.code, ...payload }),
        });
        const data = await res.json();
        if (data.ok) {
          cursorRef.current = data.cursor || cursorRef.current;
          return { ok: true, data };
        }
        const reason = String(data.error || 'try again.').replace(/\.+$/, '');
        const hint = /unrecognised operator code/i.test(reason)
          ? ' This access code predates the database switch — exit, sign out and register again.'
          : '';
        push({ kind: 'error', text: `relay refused — ${reason}.${hint}` });
        return { ok: false };
      } catch {
        push({ kind: 'error', text: 'relay unreachable — is the terminal service running?' });
        return { ok: false };
      }
    },
    [push, session.code, session.username],
  );

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
      push({ kind: 'sys', text: `OPERATORS — ${operators.length} registered · ${online.length} online` });
      for (const op of operators) {
        push({
          kind: 'sys',
          text: `  ${online.includes(op.username) ? '●' : '○'} ${op.username}${op.username === session.username ? ' · you' : ''}`,
        });
      }
      return;
    }

    if (word === 'clear') {
      setLines([]);
      return;
    }

    if (word === 'dm') {
      const tail = value.slice(2).trim();
      const res = await sendToRelay({ dm: tail });
      if (res.ok) {
        const target = res.data.toName || '?';
        push({
          kind: 'dm',
          me: true,
          color: userColor(target),
          tag: `[DM · you » ${target}]`,
          text: res.data.message.text,
        });
      }
      return;
    }

    const res = await sendToRelay({ text: value });
    if (res.ok) {
      const mentioned = lineMentionsMe(value, operatorsRef.current, session.username);
      push({
        kind: 'net',
        me: true,
        mentioned,
        color: userColor(session.username),
        tag: `[RELAY] ${session.username}`,
        segments: mentionSegments(value, operatorsRef.current, session.username),
        text: value,
      });
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

            {lines.map((line) => {
              const style = line.color ? { borderLeftColor: line.color } : undefined;
              const tagStyle = line.color ? { color: line.color } : undefined;
              const textStyle = line.color ? { color: line.color } : undefined;
              return (
                <div
                  key={line.id}
                  className={`line line--${line.kind}${line.me ? ' line--me' : ''}${line.mentioned ? ' line--mention' : ''}`}
                  style={style}
                >
                  {line.tag ? (
                    <span className="line__tag" style={tagStyle} aria-hidden="true">
                      {line.tag}
                    </span>
                  ) : null}
                  {line.segments ? (
                    <span className="line__text" style={textStyle}>
                      {line.segments.map((seg, i) =>
                        seg.mention ? (
                          <span
                            key={i}
                            className={`mention${seg.me ? ' mention--me' : ''}`}
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        ),
                      )}
                    </span>
                  ) : (
                    <span className="line__text" style={textStyle}>{line.text}</span>
                  )}
                </div>
              );
            })}
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
                        <span style={{ color: userColor(op.username) }}>
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
                ● online · ○ offline
                <br />
                dm &lt;name&gt; &lt;message&gt; — private line
              </p>
            </div>
          </section>
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {lines.length
          ? `${lines[lines.length - 1].tag ? `${lines[lines.length - 1].tag}: ` : ''}${lines[lines.length - 1].text}`
          : ''}
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
          placeholder="talk · @name mention · dm <name> <message>"
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
