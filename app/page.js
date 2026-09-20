'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusBar from '@/components/statusbar';
import AgentFeed from '@/components/agentfeed';
import SidePanels from '@/components/sidepanels';
import BootGate from '@/components/bootgate';
import ConnectorPanel from '@/components/connectorpanel';
import LiveTerminal from '@/components/liveterminal';

const SESSION_KEY = 'rootchain.session.v1';
const LOG_KEY = 'rootchain.log.v1';
const CONNECTOR_KEY = 'rootchain.connector.v1';
const AUTO_INTERVAL = 20000;
const RELAY_INTERVAL = 3000;

const AGENT_META = {
  root: { tag: 'Agent-01', name: 'Root' },
  link: { tag: 'Agent-02', name: 'Chain' },
};

const HELP_TEXT = [
  'AVAILABLE COMMANDS',
  '  help       list every command',
  '  status     terminal + module status',
  '  agents     show the latest Agent-01 / Agent-02 exchange',
  '             agents on | off | step  · control the live loop',
  '  connect    attach your own AI (MCP server / OpenAI-compatible)',
  '  chat       relay to other operators: chat <message> · chat for presence',
  '  chat live  open the live operator terminal (roster + direct chat)',
  '  topic      show the active topic from content/topics/current',
  '  bridge     cross-chain route: Solana → BSC → Robinhood',
  '  register   open the access-code registration panel',
  '  login      open the access-code login panel',
  '  clear      wipe the terminal buffer',
  '  about      what Rootchain is',
  '  memory     summarise what the agents remember',
].join('\n');

const ABOUT_TEXT = [
  'ROOTCHAIN — a cross-chain intelligence terminal.',
  'Two agents share one channel: Agent-01 "Root" reads structure and liquidity,',
  'Agent-02 "Chain" reads cross-chain flow and market attention. They talk',
  'continuously, remember what they discussed, and take their subject matter',
  'from content/topics/current — edit that folder and they move on.',
].join('\n');

const BRIDGE_TEXT = [
  'CROSS-CHAIN MODULE',
  '  SOL   Solana            impulse layer — where attention starts',
  '   →',
  '  BSC   BNB Smart Chain   recycling + liquidity hand-off',
  '   →',
  '  EQ    Robinhood rail    where settled flow wants to land',
  '',
  'Router: Solana → BSC → Robinhood. No live feed attached to this build.',
].join('\n');

// Condense the API route's fallback reason into one terminal-friendly line,
// so a degraded AI link always explains itself instead of leaving the user guessing.
function describeApiError(err) {
  const raw = String(err || '');
  if (!raw) return '';
  if (/abort/i.test(raw)) return 'the request timed out.';
  if (/fetch failed/i.test(raw) || /ECONNREFUSED/i.test(raw)) {
    return 'endpoint unreachable — check the URL and that the service is running.';
  }
  if (raw.includes('MCP_NO_CHAT_TOOL')) {
    return 'the MCP server exposes no chat-like tool. Pin one manually in the connector panel.';
  }
  return raw.slice(0, 160);
}

export default function Page() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true); // reading localStorage
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [auto, setAuto] = useState(true);
  const [thinking, setThinking] = useState(null);
  const [mobileView, setMobileView] = useState('feed');
  const [authMode, setAuthMode] = useState(null); // null | 'register' | 'login'
  const [showConnector, setShowConnector] = useState(false);
  const [connector, setConnector] = useState(null);
  const [topics, setTopics] = useState({ active: null, current: [], scheduled: [], archive: [] });
  const [memory, setMemory] = useState({ summary: '', lastTopic: null, count: 0, recent: [] });
  const [relay, setRelay] = useState({ online: [], authed: false, operators: [], store: '' });
  const [liveMode, setLiveMode] = useState(false);
  const [status, setStatus] = useState({ link: 'local', source: 'local', memory: false, model: 'local', error: '' });

  const idRef = useRef(0);
  const linesRef = useRef([]);
  const topicsRef = useRef(topics);
  const memoryRef = useRef('');
  const connectorRef = useRef(null);
  const busyRef = useRef(false);
  const nextSpeakerRef = useRef('root');
  const bootedRef = useRef(false);
  const linkWarnedRef = useRef(false);
  const relayCursorRef = useRef('');
  const relayBusyRef = useRef(false);
  const relaySyncedRef = useRef(false);
  const reduceRef = useRef(false);
  const inputRef = useRef(null);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  useEffect(() => {
    reduceRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // ── line queue + typewriter ─────────────────────────────────────────────
  const push = useCallback((line) => {
    const text = String(line.text ?? '');
    const instant = line.instant ?? reduceRef.current;
    setLines((prev) => [
      ...prev,
      {
        id: nextId(),
        kind: line.kind || 'sys',
        agent: line.agent || null,
        tag: line.tag || null,
        full: text,
        shown: instant ? text.length : 0,
        done: instant,
        speed: line.speed || 14,
      },
    ]);
  }, []);

  useEffect(() => {
    const idx = lines.findIndex((l) => !l.done);
    if (idx === -1) return;
    const current = lines[idx];
    const total = current.full.length;

    if (current.shown >= total) {
      setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, done: true } : l)));
      return;
    }

    const step = Math.max(1, Math.round(total / 26));
    const timer = setTimeout(() => {
      setLines((prev) =>
        prev.map((l, i) => (i === idx ? { ...l, shown: Math.min(total, l.shown + step) } : l)),
      );
    }, current.speed);

    return () => clearTimeout(timer);
  }, [lines]);

  // ── data loaders ────────────────────────────────────────────────────────
  const refreshTopics = useCallback(async () => {
    try {
      const res = await fetch('/api/topics', { cache: 'no-store' });
      const data = await res.json();
      setTopics(data);
      topicsRef.current = data;
    } catch {
      /* keep previous */
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/memory', { cache: 'no-store' });
      const data = await res.json();
      setMemory(data);
      setStatus((s) => ({ ...s, memory: data.count > 0 || Boolean(data.summary) }));
      memoryRef.current = [
        data.summary ? `Summary: ${data.summary}` : '',
        data.lastTopic ? `Last topic: ${data.lastTopic}` : '',
        (data.recent || [])
          .slice(-5)
          .map((e) => `${e.agent === 'link' ? 'Agent-02 Chain' : 'Agent-01 Root'}: ${e.text}`)
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n');
    } catch {
      /* keep previous */
    }
  }, []);

  // ── session bootstrap ───────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.username && parsed?.code) setSession(parsed);
      }
      const conn = window.localStorage.getItem(CONNECTOR_KEY);
      if (conn) {
        const parsed = JSON.parse(conn);
        if (parsed?.url) {
          connectorRef.current = parsed;
          setConnector(parsed);
          setStatus((s) => ({ ...s, link: 'live', source: parsed.type, model: parsed.model || parsed.tool || 'custom' }));
        }
      }
    } catch {
      /* ignore */
    }
    setBooting(false);
  }, []);

  useEffect(() => {
    if (booting) return;
    refreshTopics();
    refreshMemory();
  }, [booting, refreshTopics, refreshMemory]);

  useEffect(() => {
    if (session && inputRef.current) inputRef.current.focus();
  }, [session]);

  const signIn = useCallback(
    (next) => {
      setSession(next);
      setAuthMode(null);
      try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const signOut = useCallback(() => {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
    setLines([]);
    bootedRef.current = false;
  }, []);

  // ── operator relay (live chat between registered users) ─────────────────
  const pollRelay = useCallback(async () => {
    if (!session || relayBusyRef.current) return;
    relayBusyRef.current = true;
    try {
      const params = new URLSearchParams({ since: relayCursorRef.current });
      params.set('username', session.username);
      params.set('code', session.code);
      const res = await fetch(`/api/relay?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setRelay({
          online: data.online || [],
          authed: Boolean(data.authed),
          operators: data.operators || [],
          store: data.store || '',
        });
        const incoming = data.messages || [];

        // First poll after login: sync silently and surface only the tail of
        // the history, so the feed is never flooded with old relay lines.
        if (!relaySyncedRef.current) {
          relaySyncedRef.current = true;
          relayCursorRef.current = data.lastCursor || '';
          if (incoming.length > 5) {
            push({
              kind: 'sys',
              text: `relay synced — showing the last 5 of ${incoming.length} recent line(s).`,
              instant: true,
            });
          }
          for (const m of incoming.slice(-5)) {
            push({ kind: 'net', tag: `[RELAY] ${m.username}`, text: m.text, instant: true });
          }
        } else {
          for (const m of incoming) {
            push({ kind: 'net', tag: `[RELAY] ${m.username}`, text: m.text, instant: true });
          }
          relayCursorRef.current = data.lastCursor || relayCursorRef.current;
        }
      }
    } catch {
      /* keep previous */
    } finally {
      relayBusyRef.current = false;
    }
  }, [session, push]);

  useEffect(() => {
    if (!session) return;
    pollRelay();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        pollRelay();
      }
    }, RELAY_INTERVAL);
    return () => clearInterval(id);
  }, [session, pollRelay]);

  // ── agent turn ──────────────────────────────────────────────────────────
  const runAgentTurn = useCallback(
    async (forced) => {
      if (busyRef.current) return;
      busyRef.current = true;

      const agentId = forced || nextSpeakerRef.current;
      nextSpeakerRef.current = agentId === 'root' ? 'link' : 'root';
      setThinking(agentId);

      const meta = AGENT_META[agentId];
      const transcript = linesRef.current
        .filter((l) => l.kind === 'agent' && l.done)
        .slice(-10)
        .map((l) => `${l.tag}: ${l.full}`)
        .join('\n');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: agentId,
            transcript,
            memory: memoryRef.current,
            topicFile: topicsRef.current?.active?.file,
            connector: connectorRef.current,
          }),
        });
        const data = await res.json();

        setStatus((s) => ({
          ...s,
          link: data.mode === 'live' ? 'live' : 'local',
          source: data.source || s.source,
          model: data.mode === 'live' ? data.model || 'custom' : 'local',
          error: data.mode === 'live' ? '' : data.error || '',
        }));

        if (data.mode !== 'live' && data.error && !linkWarnedRef.current) {
          linkWarnedRef.current = true;
          push({
            kind: 'warn',
            text: `AI LINK DOWN — ${describeApiError(data.error)} The local engine keeps the channel warm.`,
            speed: 6,
          });
        }
        push({
          kind: 'agent',
          agent: agentId,
          tag: `${meta.tag} ${meta.name}`,
          text: data.reply,
        });

        fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'turn',
            agent: agentId,
            text: data.reply,
            topic: topicsRef.current?.active?.title,
          }),
        })
          .then(() => refreshMemory())
          .catch(() => {});
      } catch {
        push({ kind: 'error', text: 'TRANSMISSION ERROR — the agent could not be reached.' });
      } finally {
        busyRef.current = false;
        setThinking(null);
      }
    },
    [push, refreshMemory],
  );

  // ── boot sequence + auto loop ───────────────────────────────────────────
  useEffect(() => {
    if (!session || bootedRef.current) return;
    bootedRef.current = true;

    push({ kind: 'head', text: 'ROOTCHAIN TERMINAL v1.0' });
    push({ kind: 'sys', text: `secure channel established · session ${session.code}` });
    push({ kind: 'sys', text: 'cross-chain module ready · memory active' });
    if (connectorRef.current) {
      push({
        kind: 'ok',
        text: `AI connector linked — Root & Chain are running on your own AI (${connectorRef.current.model || connectorRef.current.tool || connectorRef.current.type}).`,
        speed: 7,
      });
    } else {
      push({
        kind: 'sys',
        text: 'LOCAL ENGINE — Root & Chain interact offline. Agent intelligence and memory fully form once you link your own AI: type "connect" to attach the MCP connector.',
        speed: 6,
      });
    }
    push({ kind: 'sys', text: 'type "help" to list commands', speed: 8 });
    push({
      kind: 'sys',
      text: 'relay channel standing by — "chat <message>" speaks to other operators.',
      speed: 7,
    });

    const t = setTimeout(() => {
      runAgentTurn('root');
    }, 900);
    return () => clearTimeout(t);
  }, [session, push, runAgentTurn]);

  useEffect(() => {
    if (!session || !auto) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        runAgentTurn();
      }
    }, AUTO_INTERVAL);
    return () => clearInterval(id);
  }, [session, auto, runAgentTurn]);

  // mirror the visible conversation into localStorage for instant continuity
  useEffect(() => {
    if (!session) return;
    try {
      const keep = lines
        .filter((l) => l.kind === 'agent' && l.done)
        .slice(-20)
        .map((l) => ({ agent: l.agent, tag: l.tag, full: l.full }));
      window.localStorage.setItem(LOG_KEY, JSON.stringify(keep));
    } catch {
      /* ignore */
    }
  }, [lines, session]);

  // ── commands ────────────────────────────────────────────────────────────
  const promptText = session ? `${session.username}@rootchain:~$` : 'rootchain:~$';

  const runCommand = useCallback(
    async (raw) => {
      const entered = raw;
      push({ kind: 'cmd', text: `${promptText} ${entered}`, instant: true });

      const trimmed = entered.trim();
      if (!trimmed) return;

      const [word, ...rest] = trimmed.split(/\s+/);
      const command = word.toLowerCase();

      switch (command) {
        case 'help':
          push({ kind: 'sys', text: HELP_TEXT, speed: 4 });
          break;

        case 'status': {
          const t = topicsRef.current;
          const linkLabel = status.link === 'live'
            ? status.source === 'mcp' ? 'MCP LIVE' : 'API LIVE'
            : 'LOCAL ENGINE';
          push({
            kind: 'sys',
            text: [
              'TERMINAL STATUS',
              `  SYSTEM ............ ONLINE`,
              `  AI LINK ........... ${linkLabel} (${status.model || 'local'})`,
              status.error
                ? `  LAST ERROR ........ ${describeApiError(status.error)}`
                : null,
              `  CROSS-CHAIN ....... READY`,
              `  MEMORY ............ ${status.memory ? 'ACTIVE' : 'STANDBY'} · ${memory.count} turn(s)`,
              `  RELAY ............. ${relay.online.length} online · ${relay.operators.length} registered · ${relay.store === 'mongodb' ? 'MONGODB' : relay.store ? 'FILE' : '—'}`,
              `  SESSION ........... ${session?.username} · ${session?.code}`,
              `  ACTIVE TOPIC ...... ${t.active ? t.active.title : 'none loaded'}`,
              `  AUTO LOOP ......... ${auto ? 'on' : 'off'}`,
            ]
              .filter(Boolean)
              .join('\n'),
            speed: 4,
          });
          break;
        }

        case 'agents': {
          const arg = (rest[0] || '').toLowerCase();
          if (arg === 'on') {
            setAuto(true);
            push({ kind: 'ok', text: 'auto loop engaged — agents will keep talking.' });
          } else if (arg === 'off') {
            setAuto(false);
            push({ kind: 'ok', text: 'auto loop paused. Use "agents step" to nudge a turn.' });
          } else if (arg === 'step') {
            push({ kind: 'sys', text: 'nudging one turn…' });
            await runAgentTurn();
          } else {
            const recent = linesRef.current.filter((l) => l.kind === 'agent').slice(-6);
            if (!recent.length) {
              push({
                kind: 'sys',
                text: 'No exchange logged yet. Use "agents step" to start one.',
                speed: 6,
              });
            } else {
              push({
                kind: 'sys',
                text: recent.map((l) => `${l.tag}: ${l.full}`).join('\n\n'),
                speed: 3,
              });
            }
          }
          break;
        }

        case 'topic': {
          await refreshTopics();
          const t = topicsRef.current;
          if (!t.active) {
            push({
              kind: 'warn',
              text: 'No topic loaded. Add a .md or .txt file to content/topics/current/ and refresh.',
            });
          } else {
            push({
              kind: 'sys',
              text: [
                `ACTIVE TOPIC — ${t.active.title}`,
                `  source: content/topics/current/${t.active.file}`,
                '',
                t.active.body,
              ].join('\n'),
              speed: 3,
            });
          }
          break;
        }

        case 'connect':
          setShowConnector(true);
          push({ kind: 'sys', text: 'opening MCP connector…' });
          break;

        case 'chat': {
          if ((rest[0] || '').toLowerCase() === 'live') {
            setLiveMode(true);
            push({ kind: 'sys', text: 'opening live relay terminal…', instant: true });
            break;
          }
          const text = rest.join(' ').trim();
          if (!text) {
            push({
              kind: 'sys',
              text: [
                'RELAY CHANNEL',
                `  operators online ... ${relay.online.length ? relay.online.join(', ') : 'just you'}`,
                '  usage ............ chat <message>',
                '  relay lines arrive live from every connected terminal.',
              ].join('\n'),
              speed: 4,
            });
            break;
          }
          try {
            const res = await fetch('/api/relay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: session?.username, code: session?.code, text }),
            });
            const data = await res.json();
            if (data.ok) {
              relayCursorRef.current = data.cursor || relayCursorRef.current;
              push({ kind: 'net', tag: `[RELAY] ${session.username}`, text, instant: true });
            } else {
              push({ kind: 'error', text: `relay refused — ${data.error || 'try again.'}` });
            }
          } catch {
            push({ kind: 'error', text: 'relay unreachable — is the terminal service running?' });
          }
          break;
        }

        case 'bridge':
          push({ kind: 'sys', text: BRIDGE_TEXT, speed: 4 });
          break;

        case 'register':
          setAuthMode('register');
          push({ kind: 'sys', text: 'opening registration panel…' });
          break;

        case 'login':
          setAuthMode('login');
          push({ kind: 'sys', text: 'opening login panel…' });
          break;

        case 'clear':
          setLines([]);
          return;

        case 'about':
          push({ kind: 'sys', text: ABOUT_TEXT, speed: 4 });
          break;

        case 'memory': {
          await refreshMemory();
          push({
            kind: 'sys',
            text: [
              'MEMORY BANK',
              `  summary ... ${memoryRef.current ? 'yes' : 'not set'}`,
              `  turns ..... ${memory.count}`,
              `  last topic  ${memory.lastTopic || '—'}`,
              '',
              memoryRef.current || 'Nothing committed yet.',
            ].join('\n'),
            speed: 3,
          });
          break;
        }

        default:
          push({ kind: 'error', text: `rootchain: command not found: ${word}. Type "help".` });
      }
    },
    [auto, memory.count, memory.lastTopic, promptText, push, relay.online, relay.operators, relay.store, refreshMemory, refreshTopics, runAgentTurn, session, status],
  );

  function onSubmit(event) {
    event.preventDefault();
    const value = input;
    setInput('');
    runCommand(value);
  }

  // Announce each completed turn once, instead of letting the typewriter spam a
  // live region character by character.
  const announced = useMemo(() => {
    const last = [...lines]
      .reverse()
      .find((l) => l.done && (l.kind === 'agent' || l.kind === 'error' || l.kind === 'head'));
    if (!last) return '';
    return `${last.tag ? `${last.tag}: ` : ''}${last.full}`;
  }, [lines]);

  const viewTabs = useMemo(
    () => [
      { id: 'feed', label: 'Channel' },
      { id: 'relay', label: 'Relay' },
      { id: 'topics', label: 'Topics' },
      { id: 'memory', label: 'Memory' },
      { id: 'bridge', label: 'Bridge' },
    ],
    [],
  );

  if (booting) {
    return (
      <div className="app crt" aria-busy="true">
        <div className="boot">
          <div className="boot__card">
            <div className="boot__head">
              <h2>Rootchain</h2>
              <p>Restoring secure channel…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (liveMode && session) {
    return <LiveTerminal session={session} relay={relay} onExit={() => setLiveMode(false)} />;
  }

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">Rootchain Terminal v1.0 // Secure Access</h1>
        <div className="hdr__meta">
          {session ? (
            <>
              <span className="hdr__user">
                USER <b>{session.username}</b>
              </span>
              <span className="kbview">{session.code}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <span>NO SESSION</span>
          )}
        </div>
      </header>

      <StatusBar status={{ ...status, memory: status.memory }} />

      <div className="tabs" role="tablist" aria-label="Terminal views">
        {viewTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mobileView === tab.id}
            onClick={() => setMobileView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="main" data-view={mobileView}>
        <section className="feedwrap" aria-label="Agent channel">
          <div className="feedwrap__bar">
            <span>
              {thinking
                ? `${AGENT_META[thinking].tag} ${AGENT_META[thinking].name} is composing…`
                : `Agent channel — ${auto ? 'live loop' : 'paused'}`}
            </span>
            <span className="feedwrap__actions">
              {!connector ? (
                <button type="button" className="btn btn--sm" onClick={() => setShowConnector(true)}>
                  Connect AI
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => runAgentTurn()}
                disabled={Boolean(thinking)}
                aria-disabled={Boolean(thinking)}
              >
                Step
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setAuto((v) => !v)}
                aria-pressed={auto}
              >
                {auto ? 'Pause' : 'Resume'}
              </button>
            </span>
          </div>

          <AgentFeed lines={lines} />
        </section>

        <SidePanels topics={topics} memory={memory} relay={relay} me={session?.username} />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announced}
      </p>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="rootchain-input">
          Terminal command
        </label>
        <span className="composer__prompt" aria-hidden="true">
          {session ? (
            <>
              <b>{session.username}</b>@rootchain:~$
            </>
          ) : (
            'rootchain:~$'
          )}
        </span>
        <input
          id="rootchain-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setInput('');
          }}
          placeholder={session ? 'type a command — try "help"' : 'register to begin'}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="rootchain-hint"
          disabled={!session}
        />
        <span className="composer__hint" id="rootchain-hint">
          Enter ⏎ to run
        </span>
      </form>

      {!session && !authMode ? (
        <BootGate
          initialMode="register"
          onAuthed={signIn}
        />
      ) : null}

      {authMode ? (
        <BootGate
          initialMode={authMode}
          onAuthed={signIn}
          onDismiss={() => setAuthMode(null)}
        />
      ) : null}

      {showConnector ? (
        <ConnectorPanel
          current={connector}
          onConnect={(next) => {
            connectorRef.current = next;
            setConnector(next);
            linkWarnedRef.current = false;
            setShowConnector(false);
            try {
              window.localStorage.setItem(CONNECTOR_KEY, JSON.stringify(next));
            } catch {
              /* ignore */
            }
            setStatus((s) => ({ ...s, link: 'live', source: next.type, model: next.model || next.tool || 'custom', error: '' }));
            push({
              kind: 'ok',
              text: `MCP CONNECTOR LINKED — Root & Chain now run on your own AI (${next.model || next.tool || next.type}). Intelligence and memory formation engaged.`,
              speed: 6,
            });
            setTimeout(() => runAgentTurn(), 500);
          }}
          onDisconnect={() => {
            connectorRef.current = null;
            setConnector(null);
            setShowConnector(false);
            try {
              window.localStorage.removeItem(CONNECTOR_KEY);
            } catch {
              /* ignore */
            }
            setStatus((s) => ({ ...s, link: 'local', source: 'local', model: 'local', error: '' }));
            push({ kind: 'sys', text: 'AI connector detached — Root & Chain return to the local engine.' });
          }}
          onDismiss={() => setShowConnector(false)}
        />
      ) : null}
    </div>
  );
}
