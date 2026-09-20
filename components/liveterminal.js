'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { userColor } from '@/lib/usercolor';

const RELAY_INTERVAL = 3000;

/** Resolve a canonical roster name from a stored (lowercase) key. */
function displayName(name, operators) {
  const hit = (operators || []).find(
    (o) => o.username.toLowerCase() === String(name).toLowerCase(),
  );
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
 * Live relay terminal — a second, dedicated terminal for operator chat.
 * Channels: the public relay plus one private terminal per operator you DM
 * (`dm <name>` opens it, the channel bar switches between them). Every
 * private channel carries a settable conversation topic (`topic <text>`),
 * stored server-side so both sides see it.
 */
export default function LiveTerminal({ session, relay, initialChannel, onExit }) {
  const [channels, setChannels] = useState({
    relay: { lines: [], unread: 0 },
  });
  const [active, setActive] = useState(initialChannel || 'relay');
  const [topics, setTopics] = useState({});
  const [input, setInput] = useState('');
  const [online, setOnline] = useState(relay?.online || []);
  const [operators, setOperators] = useState(relay?.operators || []);
  const [storage, setStorage] = useState(relay?.store || '');

  const idRef = useRef(0);
  const cursorRef = useRef('');
  const syncedRef = useRef(false);
  const busyRef = useRef(false);
  const bootedRef = useRef(false);
  const activeRef = useRef(active);
  const operatorsRef = useRef(relay?.operators || []);
  const channelsRef = useRef(channels);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    operatorsRef.current = operators;
  }, [operators]);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [active]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channels, active]);

  const pushToChannel = useCallback((channelId, line) => {
    setChannels((prev) => {
      const ch = prev[channelId] || { lines: [], unread: 0 };
      const unread = ch.unread + (line.unread ? 1 : 0);
      return {
        ...prev,
        [channelId]: {
          ...ch,
          unread,
          lines: [...ch.lines.slice(-199), { id: (idRef.current += 1), ...line }],
        },
      };
    });
  }, []);

  const ensureChannel = useCallback((channelId) => {
    setChannels((prev) => (prev[channelId] ? prev : { ...prev, [channelId]: { lines: [], unread: 0 } }));
  }, []);

  const bootChannel = useCallback(
    (channelId, peerName) => {
      pushToChannel(channelId, { kind: 'head', text: `PRIVATE TERMINAL · you » ${peerName}` });
      pushToChannel(channelId, { kind: 'sys', text: 'type to talk privately · "topic <text>" sets the conversation topic · "relay" goes back' });
    },
    [pushToChannel],
  );

  const pushMessage = useCallback(
    (m) => {
      const ops = operatorsRef.current;
      const meLower = session.username.toLowerCase();
      const mine = m.username === session.username;

      if (m.to) {
        // Direct message → the private terminal of that peer.
        const peerLower = mine ? m.to : m.username.toLowerCase();
        const channelId = `dm:${peerLower}`;
        const peerName = displayName(mine ? m.to : m.username, ops);
        if (!channelsRef.current[channelId]) {
          ensureChannel(channelId);
          bootChannel(channelId, peerName);
        }
        pushToChannel(channelId, {
          kind: 'dm',
          me: mine,
          unread: !mine && activeRef.current !== channelId,
          color: userColor(peerLower),
          tag: mine ? `[DM · you » ${peerName}]` : `[DM · ${peerName} » you]`,
          text: m.text,
        });
        if (!mine && activeRef.current === 'relay') {
          pushToChannel('relay', {
            kind: 'sys',
            text: `private line from ${peerName} — "go ${peerName}" to open their terminal`,
          });
        }
        return;
      }

      const mentioned = lineMentionsMe(m.text, ops, session.username);
      pushToChannel('relay', {
        kind: 'net',
        me: mine,
        mentioned,
        color: userColor(m.username),
        tag: `[RELAY] ${m.username}`,
        segments: mentionSegments(m.text, ops, session.username),
        text: m.text,
      });
    },
    [bootChannel, ensureChannel, pushToChannel, session.username],
  );

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
      if (data.topics) setTopics(data.topics);

      const incoming = data.messages || [];

      // First poll: replay the full retained history (server caps it).
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
    if (initialChannel && initialChannel !== 'relay') {
      const peerName = displayName(initialChannel.slice(3), relay?.operators);
      ensureChannel(initialChannel);
      bootChannel(initialChannel, peerName);
    }
    pushToChannel('relay', { kind: 'head', text: 'ROOTCHAIN RELAY // LIVE TERMINAL' });
    pushToChannel('relay', {
      kind: 'sys',
      text: `operators: ${relay?.operators?.length ?? 0} registered · ${relay?.online?.length ?? 0} online`,
    });
    pushToChannel('relay', {
      kind: 'sys',
      text: 'type to talk · @name mentions · dm <name> opens a private terminal · "exit" to return',
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
        pushToChannel(activeRef.current, { kind: 'error', text: `relay refused — ${reason}.${hint}` });
        return { ok: false };
      } catch {
        pushToChannel(activeRef.current, { kind: 'error', text: 'relay unreachable — is the terminal service running?' });
        return { ok: false };
      }
    },
    [pushToChannel, session.code, session.username],
  );

  function switchTo(channelId) {
    setActive(channelId);
    setChannels((prev) => ({ ...prev, [channelId]: { ...prev[channelId], unread: 0 } }));
  }

  /** Greedy-match an operator name at the start of `tail` (names may contain spaces). */
  function resolveOperator(tail) {
    const lower = tail.toLowerCase();
    const match = operators
      .map((o) => o.username)
      .sort((a, b) => b.length - a.length)
      .find((name) => lower === name.toLowerCase() || lower.startsWith(`${name.toLowerCase()} `));
    if (!match) return { name: null, rest: tail };
    return { name: match, rest: tail.slice(match.length).trim() };
  }

  async function onSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;

    const word = value.split(/\s+/)[0].toLowerCase();

    if (word === 'exit' || word === 'quit') {
      onExit();
      return;
    }

    if (word === 'relay' || word === 'back') {
      switchTo('relay');
      return;
    }

    if (word === 'who') {
      pushToChannel(active, { kind: 'sys', text: `OPERATORS — ${operators.length} registered · ${online.length} online` });
      for (const op of operators) {
        pushToChannel(active, {
          kind: 'sys',
          text: `  ${online.includes(op.username) ? '●' : '○'} ${op.username}${op.username === session.username ? ' · you' : ''}`,
        });
      }
      return;
    }

    if (word === 'clear') {
      setChannels((prev) => ({ ...prev, [active]: { ...prev[active], lines: [] } }));
      return;
    }

    if (word === 'go' || word === 'dm') {
      const tail = value.slice(word.length).trim();
      const { name, rest } = resolveOperator(tail);
      if (!name) {
        pushToChannel(active, { kind: 'error', text: `no operator matches "${tail.split(' ')[0]}" — try "who".` });
        return;
      }
      const channelId = `dm:${name.toLowerCase()}`;
      if (!channels[channel]) {
        ensureChannel(channelId);
        bootChannel(channelId, name);
      }
      if (rest) {
        const res = await sendToRelay({ dm: `${name} ${rest}` });
        if (res.ok) {
          pushToChannel(channelId, {
            kind: 'dm',
            me: true,
            color: userColor(name),
            tag: `[DM · you » ${name}]`,
            text: res.data.message.text,
          });
        }
      }
      switchTo(channelId);
      return;
    }

    if (word === 'topic') {
      if (!active.startsWith('dm:')) {
        pushToChannel(active, { kind: 'error', text: 'topics belong to private terminals — open one with "dm <name>" first.' });
        return;
      }
      const text = value.slice(5).trim();
      const peer = displayName(active.slice(3), operators);
      if (!text) {
        pushToChannel(active, { kind: 'sys', text: topics[active.slice(3)] ? `TOPIC — ${topics[active.slice(3)].topic} (set by ${topics[active.slice(3)].setBy})` : 'no topic set — "topic <text>" creates one.' });
        return;
      }
      const res = await sendToRelay({ topic: text, peer });
      if (res.ok) {
        setTopics((prev) => ({ ...prev, [active.slice(3)]: { topic: res.data.topic, setBy: res.data.setBy } }));
        pushToChannel(active, { kind: 'ok', text: `topic set — ${res.data.topic}` });
      }
      return;
    }

    // Default: speaking. In a private terminal the line goes straight to
    // that operator; on the relay it is public.
    if (active.startsWith('dm:')) {
      const peer = displayName(active.slice(3), operators);
      const res = await sendToRelay({ dm: `${peer} ${value}` });
      if (res.ok) {
        pushToChannel(active, {
          kind: 'dm',
          me: true,
          color: userColor(peer),
          tag: `[DM · you » ${peer}]`,
          text: res.data.message.text,
        });
      }
      return;
    }

    const res = await sendToRelay({ text: value });
    if (res.ok) {
      pushToChannel('relay', {
        kind: 'net',
        me: true,
        color: userColor(session.username),
        tag: `[RELAY] ${session.username}`,
        segments: mentionSegments(value, operators, session.username),
        text: value,
      });
    }
  }

  const storageLabel = storage === 'mongodb' ? 'MONGODB' : storage === 'file' ? 'FILE' : '—';
  const activeIsDm = active.startsWith('dm:');
  const activePeer = activeIsDm ? displayName(active.slice(3), operators) : null;
  const activeTopic = activeIsDm ? topics[active.slice(3)] : null;
  const peerOnline = activeIsDm && online.includes(activePeer);
  const channelList = Object.keys(channels);

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">
          {activeIsDm ? `Rootchain Private // you » ${activePeer}` : 'Rootchain Relay // Live Terminal'}
        </h1>
        <div className="hdr__meta">
          <span className="hdr__user">
            USER <b>{session.username}</b>
          </span>
          <span className="kbview">
            {activeIsDm
              ? `${activePeer} · ${peerOnline ? 'online' : 'offline'}`
              : `${online.length} online · ${operators.length} registered`}
            {' · '}
            {storageLabel}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit relay
          </button>
        </div>
      </header>

      <div className="chanbar" role="tablist" aria-label="Chat channels">
        <button
          type="button"
          role="tab"
          aria-selected={active === 'relay'}
          onClick={() => switchTo('relay')}
        >
          # relay
        </button>
        {channelList
          .filter((c) => c.startsWith('dm:'))
          .map((c) => {
            const name = displayName(c.slice(3), operators);
            const unread = channels[c].unread;
            return (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={active === c}
                style={{ color: userColor(name) }}
                onClick={() => switchTo(c)}
              >
                @ {name}
                {unread > 0 ? <span className="chanbar__badge">{unread}</span> : null}
              </button>
            );
          })}
      </div>

      <div className="main live__main">
        <section className="feedwrap live__feedwrap" aria-label="Relay channel">
          <div className="feedwrap__bar">
            <span>
              {activeIsDm ? `private channel — you & ${activePeer}` : 'operator relay — live channel'}
            </span>
            <span className="feedwrap__hint-sys">storage: {storageLabel}</span>
          </div>

          {activeIsDm ? (
            <div className="topicbar" title="set with: topic <text>">
              TOPIC · {activeTopic ? `${activeTopic.topic} — set by ${activeTopic.setBy}` : 'none set — "topic <text>" creates one'}
            </div>
          ) : null}

          <div className="log" ref={scrollRef} role="log" aria-label="Relay output">
            {(channels[active]?.lines || []).length === 0 ? (
              <div className="line line--sys">
                <span className="line__text">Waiting for the first transmission…</span>
              </div>
            ) : null}

            {(channels[active]?.lines || []).map((line) => {
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
                          <span key={i} className={`mention${seg.me ? ' mention--me' : ''}`}>
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
                      <li
                        key={op.username}
                        className={isOnline ? 'active' : ''}
                        style={{ cursor: 'pointer' }}
                        title={`open private terminal with ${op.username}`}
                        onClick={() => {
                          if (op.username === session.username) return;
                          const channelId = `dm:${op.username.toLowerCase()}`;
                          if (!channelsRef.current[channelId]) {
                            ensureChannel(channelId);
                            bootChannel(channelId, op.username);
                          }
                          switchTo(channelId);
                        }}
                      >
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
                ● online · ○ offline — click a name for a private terminal
              </p>
            </div>
          </section>
        </aside>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {(() => {
          const ls = channels[active]?.lines || [];
          const last = ls[ls.length - 1];
          return last ? `${last.tag ? `${last.tag}: ` : ''}${last.text}` : '';
        })()}
      </p>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="relay-input">
          Relay message
        </label>
        <span className="composer__prompt" aria-hidden="true">
          <b>{session.username}</b>@{activeIsDm ? activePeer : 'relay'}:~$
        </span>
        <input
          id="relay-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (input) setInput('');
              else if (active !== 'relay') switchTo('relay');
              else onExit();
            }
          }}
          placeholder={
            activeIsDm
              ? `private line to ${activePeer} · "topic <text>" sets the topic`
              : 'talk · @name mention · dm <name> opens a private terminal'
          }
          autoComplete="off"
          spellCheck={false}
          aria-describedby="relay-hint"
        />
        <span className="composer__hint" id="relay-hint">
          Enter ⏎ send · ESC back/exit
        </span>
      </form>
    </div>
  );
}
