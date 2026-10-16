'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusBar from '@/components/statusbar';
import AgentFeed from '@/components/agentfeed';
import SidePanels from '@/components/sidepanels';
import BootGate from '@/components/bootgate';
import ConnectorPanel from '@/components/connectorpanel';
import ContextEditor from '@/components/contexteditor';
import LiveTerminal from '@/components/liveterminal';
import SocialTerminal from '@/components/socialterminal';
import IdeTerminal from '@/components/ideterminal';
import MarketTerminal from '@/components/marketterminal';
import LoomTerminal from '@/components/loomterminal';
import IdentityPanel from '@/components/identitypanel';
import ScannerTerminal from '@/components/scannerminal';
import Launchpad from '@/components/launchpad';
import { userColor } from '@/lib/usercolor';
import { TOKEN_CA, asksForCa } from '@/lib/ca';
import { parseMarketArg, DEFAULT_PAIR } from '@/lib/market';
import { fmtPrice, maskCode } from '@/lib/format';

const SESSION_KEY = 'rootchain.session.v1';
const LOG_KEY = 'rootchain.log.v1';
const CONNECTOR_KEY = 'rootchain.connector.v1';
const AUTO_INTERVAL = 20000;
const RELAY_INTERVAL = 3000;
const ALERT_INTERVAL = 15000;

const AGENT_META = {
  root: { tag: 'Agent-01', name: 'Root' },
  link: { tag: 'Agent-02', name: 'Chain' },
};

const HELP_TEXT = [
  'AVAILABLE COMMANDS',
  '  help       list every command',
  '  ca         the token contract address — always the same one',
  '  status     terminal + module status',
  '  agents     show the latest Agent-01 / Agent-02 exchange',
  '             agents on | off | step  · control the live loop',
  '  connect    attach your own AI (MCP server / OpenAI-compatible)',
  '  identity   link X (Twitter) + create an embedded wallet (Privy)',
  '  shares     the wire — looms, agent talks & notes shared by operators',
  '             share conv [title] · share text <note> · share open <id>',
  '  disconnect detach your AI — Root & Chain return to the local engine',
  '  skill      edit skill.md — how the agents behave (language, style, focus)',
  '  readme     edit readme.md — background context for this terminal',
  '  context    show both context files and how they shape live AI turns',
  '  chat       relay to other operators: chat <message> · chat for presence',
  '  chat dm    open a private terminal: chat dm <operator> [message]',
  '  chat live  open the live operator terminal (roster + direct chat)',
  '  social     open Rootchain Social — posts, replies, bio & ASCII profile',
  '  dexview    open the DEX chart for the token — dexview <link|pool|CA>',
  '  scan       open the AI CONTRACT SCANNER — paste a Solana CA, get a',
  '             verdict (on-chain + github + market evidence, shareable to X)',
  '  launch     the token launchpad — launch a coin whose mint address ends',
  '             in *root · vanity keypair made + verified in your browser',
  '  sim        paper trading desk — fake money, real prices: sim buy 100',
  '             sim buy <usd|all> [ca] · sim sell <usd|all> · sim top · sim reset',
  '  alert      arm a price alert — alert rtc > 0.00002 fires when crossed',
  '             alert del <n> · alert clear · checked live every 15 seconds',
  '  watch      token watchlist — watch add <ca|link|pool> · watch del <n>',
  '  loom       open RTC-LOOM — branching text terminal on a live tree graph',
  '             own AI optional: connected = AI strands · offline = local',
  '             engine + manual strands · every loom saves to the database',
  '  stage      show the director note — rtc-loom "stage" points Root &',
  '             Chain at your woven path · unstage releases them',
  '  ide        open ROOTIDE — write & run prompts online on your own AI',
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
  '',
  'AGENT CHANNEL',
  '  Agent-01 "Root" reads structure and liquidity; Agent-02 "Chain" reads',
  '  cross-chain flow and market attention. They talk continuously, remember',
  '  what they discussed ("memory"), and take their subject matter from',
  '  content/topics/current — edit that folder and they move on.',
  '',
  'YOUR OWN AI',
  '  "connect" attaches an MCP server or any OpenAI-compatible endpoint and',
  '  puts Root & Chain on it; "disconnect" wipes the key from this browser.',
  '  Until then the local engine keeps the channel alive offline.',
  '  "skill" / "readme" edit the context files that shape every live turn.',
  '',
  'OPERATOR NETWORK',
  '  "chat" speaks over the live relay; "chat dm" opens a private line;',
  '  "chat live" is the full operator terminal with presence + colours.',
  '  "social" opens Rootchain Social — posts, threaded replies, bio,',
  '  ASCII profile art and a follow graph between operators.',
'  "dexview" opens the DEX chart for the token — live candles, pair',
'  stats and a comment wall where operators call the chart together.',
'',
'PAPER DESK',
'  "sim" opens the trading simulator — every operator gets $1,000 paper',
'  USDC and trades the same live prices the dex view sees. "sim top"',
'  ranks every operator by equity, "sim reset" starts a wallet over.',
'  Fake money only — nothing on-chain ever moves.',
'',
'LAUNCHPAD',
'  "launch" opens the pump.fun launchpad: mint a coin whose address ends',
'  in *root. The vanity keypair is generated and verified locally in your',
'  browser, your wallet signs the pump.fun create_v2 transaction, and the',
'  launch is verified on-chain before anything is called live.',
'',
'ALERTS & WATCHLIST',
'  "alert rtc > 0.00002" arms a one-shot alert — the terminal checks the',
'  live feed every 15 seconds and prints a ⚡ line the moment it crosses.',
'  "watch add <ca>" keeps live prices for any tokens you follow.',
'',
'RTC-LOOM',
'  "loom" opens the branching text explorer on a live tree graph: seed a',
'  text, "w" grows candidate strands, a number picks one — branch, rewind,',
'  edit and bookmark nodes. With an AI linked (any API key) strands come',
'  from your model; without one the local engine and "a <text>" manual',
'  strands keep it running, and every loom saves to the database.',
'  "stage" inside the loom directs the agent channel: Root & Chain weave',
'  their next exchanges around your active path (stored even without a',
'  key; connect one to maximise their conversation). universal-weave-',
'  inspired, terminal-native.',
  '',
  'ROOTIDE',
  '  "ide" opens an online prompt IDE on your own AI — prompt files,',
  '  "clone" pulls public GitHub repos into browser storage, and .py / .js',
  '  run in local Python + JavaScript runtimes, all client-side.',
  '',
  'CROSS-CHAIN MODULE',
  '  "bridge" routes Solana → BSC → Robinhood;',
  '  "status" reports the link, relay and memory at a glance.',
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
  const [caCopied, setCaCopied] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);
  const [connector, setConnector] = useState(null);
  const [contextFile, setContextFile] = useState(null); // null | 'skill' | 'readme'
  const [topics, setTopics] = useState({ active: null, current: [], scheduled: [], archive: [] });
  const [memory, setMemory] = useState({ summary: '', lastTopic: null, count: 0, recent: [] });
  const [relay, setRelay] = useState({ online: [], authed: false, operators: [], store: '' });
  const [liveMode, setLiveMode] = useState(false);
  const [liveChannel, setLiveChannel] = useState('relay');
  const [socialMode, setSocialMode] = useState(false);
  const [ideMode, setIdeMode] = useState(false);
  const [marketPair, setMarketPair] = useState(null); // null | pool address — dexview is open
  const [loomMode, setLoomMode] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [launchMode, setLaunchMode] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);
  const [identity, setIdentity] = useState(null); // Privy-verified links for the header chip
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
  const alertBusyRef = useRef(false);
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
        color: line.color || null,
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
    // force the next login to replay the full relay history
    relaySyncedRef.current = false;
    relayCursorRef.current = '';
    setRelay({ online: [], authed: false, operators: [], store: '' });
  }, []);

  // ── operator relay (live chat between registered users) ─────────────────
  const pushRelayLine = useCallback(
    (m, operators) => {
      const canon = (name) => {
        const hit = (operators || []).find(
          (o) => o.username.toLowerCase() === String(name).toLowerCase(),
        );
        return hit ? hit.username : name;
      };

      if (m.to) {
        const mine = m.username === session?.username;
        const other = mine ? canon(m.to) : canon(m.username);
        push({
          kind: 'dm',
          instant: true,
          color: userColor(mine ? m.to : m.username),
          tag: mine ? `[DM · you » ${other}]` : `[DM · ${other} » you]`,
          text: m.text,
        });
        return;
      }

      push({
        kind: 'net',
        instant: true,
        color: userColor(m.username),
        tag: `[RELAY] ${m.username}`,
        text: m.text,
      });
    },
    [push, session?.username],
  );

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

        // First poll after login: replay the full retained history so a
        // returning operator always sees every stored line (server caps it).
        if (!relaySyncedRef.current) {
          relaySyncedRef.current = true;
          relayCursorRef.current = data.lastCursor || '';
          for (const m of incoming) pushRelayLine(m, data.operators);
          return;
        }

        for (const m of incoming) pushRelayLine(m, data.operators);
        relayCursorRef.current = data.lastCursor || relayCursorRef.current;
      }
    } catch {
      /* keep previous */
    } finally {
      relayBusyRef.current = false;
    }
  }, [session, pushRelayLine]);

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

  // ── operator identity (Privy-verified) — feeds the header profile chip ───
  const refreshIdentity = useCallback(async () => {
    if (!session) return;
    try {
      const params = new URLSearchParams({ username: session.username, code: session.code });
      const res = await fetch(`/api/identity?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setIdentity(data.identity || null);
    } catch {
      /* keep previous */
    }
  }, [session]);

  useEffect(() => {
    refreshIdentity();
  }, [refreshIdentity]);

  // ── price alerts (evaluated server-side on this 15s poll) ────────────────
  const pollAlerts = useCallback(async () => {
    if (!session || alertBusyRef.current) return;
    alertBusyRef.current = true;
    try {
      const params = new URLSearchParams({ username: session.username, code: session.code });
      const res = await fetch(`/api/alerts?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) return;
      for (const f of data.fired || []) {
        push({
          kind: f.op === '>' ? 'ok' : 'warn',
          instant: true,
          text: `⚡ PRICE ALERT — ${f.symbol} crossed ${f.op === '>' ? 'ABOVE' : 'BELOW'} ${fmtPrice(f.target)} · now ${fmtPrice(f.price)}`,
        });
      }
    } catch {
      /* keep previous */
    } finally {
      alertBusyRef.current = false;
    }
  }, [session, push]);

  useEffect(() => {
    if (!session) return;
    pollAlerts();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        pollAlerts();
      }
    }, ALERT_INTERVAL);
    return () => clearInterval(id);
  }, [session, pollAlerts]);

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
            username: session?.username,
            code: session?.code,
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
    [push, refreshMemory, session],
  );

  // ── boot sequence + auto loop ───────────────────────────────────────────
  useEffect(() => {
    if (!session || bootedRef.current) return;
    bootedRef.current = true;

    push({ kind: 'head', text: 'ROOTCHAIN TERMINAL v1.0' });
    push({ kind: 'sys', text: `secure channel established · session ${maskCode(session.code)} (👁 header reveals it)` });
    push({ kind: 'sys', text: 'cross-chain module ready · memory active' });
    if (connectorRef.current) {
      push({
        kind: 'ok',
        text: `AI connector linked — Root & Chain are running on your own AI (${connectorRef.current.model || connectorRef.current.tool || connectorRef.current.type}).`,
        speed: 7,
      });
      push({
        kind: 'sys',
        text: 'shape how they talk — edit skill.md & readme.md with "skill" / "readme" ("context" previews both).',
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

  // Copy the pinned CA; the bar flashes COPIED, and a blocked clipboard
  // just leaves the address readable on screen.
  const copyCa = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_CA);
      setCaCopied(true);
      window.setTimeout(() => setCaCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the address stays on screen */
    }
  }, []);

  // Shared POST helper for the command desks (sim / alerts / watchlist) —
  // each returns a ready-to-print block, so the command cases stay thin.
  const postCommandDesk = useCallback(
    async (path, payload, okKind = 'sys', label = 'desk') => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: session?.username, code: session?.code, ...payload }),
        });
        const data = await res.json();
        if (data.ok) {
          push({ kind: okKind, text: data.text, speed: 4 });
          return true;
        }
        push({ kind: 'error', text: `${label} refused — ${data.error}` });
        return false;
      } catch {
        push({ kind: 'error', text: `${label} unreachable — is the terminal service running?` });
        return false;
      }
    },
    [push, session?.code, session?.username],
  );

  // Share the agent channel's recent turns to the wire — used by the
  // "share conv" command and the Share talk button under the feed.
  const shareAgentTalk = useCallback(async (title = '') => {
    if (!session) {
      push({ kind: 'error', text: 'register or log in first — shares belong to an operator.' });
      return;
    }
    const agentLines = linesRef.current
      .filter((l) => l.kind === 'agent' && l.full)
      .slice(-15)
      .map((l) => ({ tag: l.tag, text: l.full }));
    if (!agentLines.length) {
      push({ kind: 'error', text: 'no agent turns in the buffer yet — let Root & Chain talk first.' });
      return;
    }
    await postCommandDesk('/api/shares', { action: 'share-conv', title, lines: agentLines }, 'ok', 'wire');
  }, [postCommandDesk, push, session]);

  // Compose an X post from the agent channel's latest turns — opens the
  // tweet composer pre-filled, with the sources footnote.
  const shareTalkToX = useCallback(() => {
    const turns = linesRef.current.filter((l) => l.kind === 'agent' && l.full).slice(-2);
    if (!turns.length) {
      push({ kind: 'error', text: 'no agent turns yet — let Root & Chain talk first.' });
      return;
    }
    const body = turns
      .map((t) => `${t.tag}: ${String(t.full).replace(/\s+/g, ' ').slice(0, 100)}`)
      .join('\n');
    const text = `Rootchain agent talk\n${body}\n\nsources : rtcterminal.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }, [push]);

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

        case 'ca': {
          copyCa();
          push({
            kind: 'ok',
            text: [
              'TOKEN CONTRACT ADDRESS (SOLANA)',
              `  ${TOKEN_CA}`,
              '',
              'always this one, never another — it is pinned at the top of the page.',
            ].join('\n'),
            speed: 4,
          });
          break;
        }

        case 'status': {
          const t = topicsRef.current;
          let directorLine = null;
          if (session) {
            try {
              const res = await fetch('/api/loom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: session.username, code: session.code, action: 'note' }),
              });
              const data = await res.json();
              if (data.ok && data.note) {
                directorLine = `staged by ${data.note.username} via rtc-loom — "${String(data.note.text).replace(/\s+/g, ' ').slice(0, 50)}…" ("unstage" clears)`;
              }
            } catch {
              /* status stays silent on a desk hiccup */
            }
          }
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
              `  DIRECTOR .......... ${directorLine || 'no staged note — rtc-loom "stage" directs Root & Chain'}`,
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

        case 'disconnect': {
          if (!connector) {
            push({ kind: 'error', text: 'no AI linked — nothing to detach. "connect" attaches one.' });
            break;
          }
          connectorRef.current = null;
          setConnector(null);
          try {
            window.localStorage.removeItem(CONNECTOR_KEY);
          } catch {
            /* ignore */
          }
          setStatus((s) => ({ ...s, link: 'local', source: 'local', model: 'local', error: '' }));
          push({ kind: 'sys', text: 'AI connector detached — the key is wiped from this browser and Root & Chain return to the local engine.' });
          break;
        }

        case 'ide':
        case 'rootide': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — ROOTIDE files belong to an operator.' });
            break;
          }
          setIdeMode(true);
          push({ kind: 'sys', text: 'opening ROOTIDE…', instant: true });
          break;
        }

        case 'social': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the feed belongs to operators.' });
            break;
          }
          setSocialMode(true);
          push({ kind: 'sys', text: 'opening Rootchain Social…', instant: true });
          break;
        }

        case 'dexview':
        case 'market': {
          const arg = rest.join(' ');
          if (arg) {
            const addr = parseMarketArg(arg);
            if (!addr) {
              push({
                kind: 'error',
                text: 'could not read that — paste a dexscreener link, a pool address or a token CA.',
              });
              break;
            }
            setMarketPair(addr);
          } else {
            setMarketPair(DEFAULT_PAIR);
          }
          push({ kind: 'sys', text: 'opening the dex view…', instant: true });
          break;
        }

        case 'skill':
        case 'readme': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — context files belong to an operator.' });
            break;
          }
          if (!connector) {
            push({
              kind: 'warn',
              text: `no AI linked yet — ${command}.md takes effect once you attach one with "connect".`,
            });
          }
          setContextFile(command);
          push({ kind: 'sys', text: `opening ${command}.md editor…`, instant: true });
          break;
        }

        case 'context': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — context files belong to an operator.' });
            break;
          }
          try {
            const params = new URLSearchParams({ username: session.username, code: session.code });
            const res = await fetch(`/api/context?${params.toString()}`, { cache: 'no-store' });
            const data = await res.json();
            if (!data.ok) {
              push({ kind: 'error', text: `context store refused — ${data.error}` });
              break;
            }
            const summary = (s) =>
              s
                ? `${s.length} chars · ${(s.split('\n').find((l) => l.trim()) || '(no content)').slice(0, 60)}`
                : 'empty — edit with "skill" / "readme"';
            push({
              kind: 'sys',
              text: [
                'AGENT CONTEXT — shapes every live AI turn',
                `  readme.md ... ${summary(data.readme)}`,
                `  skill.md .... ${summary(data.skill)}`,
                `  updated ..... ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'never'}`,
                `  applies to .. ${status.link === 'live' ? 'LIVE AI turns (your connector is linked)' : 'live AI turns once you "connect" an AI'}`,
                '',
                'edit with "skill" or "readme" — skill.md overrides defaults (language, style).',
              ].join('\n'),
              speed: 4,
            });
          } catch {
            push({ kind: 'error', text: 'context store unreachable — is the terminal service running?' });
          }
          break;
        }

        case 'chat': {
          if ((rest[0] || '').toLowerCase() === 'live') {
            setLiveMode(true);
            push({ kind: 'sys', text: 'opening live relay terminal…', instant: true });
            break;
          }
          if ((rest[0] || '').toLowerCase() === 'dm') {
            const tail = rest.slice(1).join(' ').trim();
            if (!tail) {
              push({ kind: 'sys', text: 'usage: chat dm <operator> [message]', speed: 6 });
              break;
            }
            // greedy match against the roster, so names with spaces resolve
            const lower = tail.toLowerCase();
            const match = relay.operators
              .map((o) => o.username)
              .sort((a, b) => b.length - a.length)
              .find((n) => lower === n.toLowerCase() || lower.startsWith(`${n.toLowerCase()} `));
            if (!match) {
              push({ kind: 'error', text: `no operator matches "${tail.split(' ')[0]}" — try "chat" for the roster.` });
              break;
            }
            const messageText = tail.slice(match.length).trim();
            if (messageText) {
              try {
                const res = await fetch('/api/relay', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ username: session?.username, code: session?.code, dm: `${match} ${messageText}` }),
                });
                const data = await res.json();
                if (data.ok) {
                  relayCursorRef.current = data.cursor || relayCursorRef.current;
                  push({
                    kind: 'dm',
                    instant: true,
                    color: userColor(match),
                    tag: `[DM · you » ${match}]`,
                    text: data.message.text,
                  });
                } else {
                  const reason = String(data.error || 'try again.').replace(/\.+$/, '');
                  push({ kind: 'error', text: `relay refused — ${reason}.` });
                  break;
                }
              } catch {
                push({ kind: 'error', text: 'relay unreachable — is the terminal service running?' });
                break;
              }
            }
            setLiveChannel(`dm:${match.toLowerCase()}`);
            setLiveMode(true);
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
              push({
                kind: 'net',
                instant: true,
                color: userColor(session.username),
                tag: `[RELAY] ${session.username}`,
                text,
              });
            } else {
              const reason = String(data.error || 'try again.').replace(/\.+$/, '');
              const hint = /unrecognised operator code/i.test(reason)
                ? ' This access code predates the database switch — sign out and register again.'
                : '';
              push({ kind: 'error', text: `relay refused — ${reason}.${hint}` });
            }
          } catch {
            push({ kind: 'error', text: 'relay unreachable — is the terminal service running?' });
          }
          break;
        }

        case 'loom':
        case 'rtc-loom':
        case 'rtcloom': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — rtc-looms belong to an operator.' });
            break;
          }
          if (!connector) {
            push({
              kind: 'warn',
              text: 'RTC-LOOM runs without an AI — the offline engine provides strands and every loom saves to the database. "connect" (any API key) upgrades w to true AI continuations.',
            });
          }
          setLoomMode(true);
          push({ kind: 'sys', text: 'opening rtc-loom…', instant: true });
          break;
        }

        case 'stage': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the director note belongs to an operator.' });
            break;
          }
          try {
            const res = await fetch('/api/loom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: session.username, code: session.code, action: 'note' }),
            });
            const data = await res.json();
            if (!data.ok || !data.note) {
              push({
                kind: 'sys',
                text: 'no director note staged — open the rtc-loom ("loom"), weave a path, then "stage" it to direct Root & Chain.',
                speed: 5,
              });
              break;
            }
            push({
              kind: 'sys',
              text: [
                `DIRECTOR NOTE — set by ${data.note.username} via rtc-loom`,
                `  staged ${new Date(data.note.setAt).toLocaleString()} · shapes every live agent turn`,
                '',
                String(data.note.text).slice(0, 600),
                '',
                'clear it with "unstage".',
              ].join('\n'),
              speed: 4,
            });
          } catch {
            push({ kind: 'error', text: 'director desk unreachable — is the terminal service running?' });
          }
          break;
        }

        case 'unstage': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first.' });
            break;
          }
          try {
            const res = await fetch('/api/loom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: session.username, code: session.code, action: 'unstage' }),
            });
            const data = await res.json();
            push({ kind: data.ok ? 'ok' : 'error', text: data.ok ? data.text : `refused — ${data.error}` });
          } catch {
            push({ kind: 'error', text: 'director desk unreachable — is the terminal service running?' });
          }
          break;
        }

        case 'share': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — shares belong to an operator.' });
            break;
          }
          const s0 = (rest[0] || '').toLowerCase();
          const tail = value.slice(word.length).trim();
          if (s0 === 'conv' || s0 === 'conversation') {
            await shareAgentTalk(tail.slice(s0.length).trim());
          } else if (s0 === 'text' || s0 === 'note') {
            const text = tail.slice(s0.length).trim();
            if (!text) {
              push({ kind: 'error', text: 'usage: share text <note> — anything you want on the wire.' });
              break;
            }
            await postCommandDesk('/api/shares', { action: 'share-text', text }, 'ok', 'wire');
          } else if (s0 === 'open') {
            if (!rest[1]) {
              push({ kind: 'error', text: 'usage: share open <id> — "shares" lists the wire.' });
              break;
            }
            await postCommandDesk('/api/shares', { action: 'open', id: rest[1] }, 'sys', 'wire');
          } else {
            await postCommandDesk('/api/shares', { action: 'list' }, 'sys', 'wire');
          }
          break;
        }

        case 'shares':
        case 'wire': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first.' });
            break;
          }
          await postCommandDesk('/api/shares', { action: 'list' }, 'sys', 'wire');
          break;
        }

        case 'identity':
        case 'privy': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the identity link belongs to an operator.' });
            break;
          }
          setShowIdentity(true);
          push({ kind: 'sys', text: 'opening identity panel — X + wallet…', instant: true });
          break;
        }

        case 'scan':
        case 'scanner': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the scanner belongs to an operator.' });
            break;
          }
          setScanMode(true);
          push({ kind: 'sys', text: 'opening the AI contract scanner…', instant: true });
          break;
        }

        case 'launch':
        case 'launchpad':
        case 'pump': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the launchpad belongs to an operator.' });
            break;
          }
          setLaunchMode(true);
          push({ kind: 'sys', text: 'opening the launchpad — *root vanity mint…', instant: true });
          break;
        }

        case 'bridge':
          push({ kind: 'sys', text: BRIDGE_TEXT, speed: 4 });
          break;

        case 'sim': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the paper desk belongs to an operator.' });
            break;
          }
          const simSub = (rest[0] || 'pos').toLowerCase();
          if (!['pos', 'buy', 'sell', 'top', 'board', 'reset', 'help'].includes(simSub)) {
            push({ kind: 'error', text: `sim: unknown action "${rest[0]}" — try "sim help".` });
            break;
          }
          await postCommandDesk(
            '/api/sim',
            {
              action: simSub === 'board' ? 'top' : simSub,
              amount: rest[1] || '',
              token: rest.slice(2).join(' ').trim(),
            },
            ['buy', 'sell', 'reset'].includes(simSub) ? 'ok' : 'sys',
            'sim desk',
          );
          break;
        }

        case 'alert': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — alerts belong to an operator.' });
            break;
          }
          const a0 = (rest[0] || '').toLowerCase();
          let payload;
          if (!a0) {
            payload = { action: 'alerts' };
          } else if (a0 === 'del') {
            if (!rest[1]) {
              push({ kind: 'error', text: 'usage: alert del <n> — "alert" lists them with numbers.' });
              break;
            }
            payload = { action: 'alert-del', id: rest[1] };
          } else if (a0 === 'clear') {
            payload = { action: 'alert-clear' };
          } else {
            // "alert rtc > 0.00002" and "alert rtc >0.00002" both parse
            let op = rest[1] || '';
            let target = rest[2] || '';
            if (!target && /^(>=|<=|>|<)/.test(op)) {
              const m = op.match(/^(>=|<=|>|<)(.*)$/);
              op = m[1];
              target = m[2];
            }
            if (!['>', '<', '>=', '<='].includes(op) || !target) {
              push({ kind: 'error', text: 'usage: alert <rtc|ca> >|< <price> — e.g. "alert rtc > 0.00002".' });
              break;
            }
            payload = { action: 'alert-add', token: rest[0], op, target };
          }
          const kind = payload.action === 'alert-add' ? 'ok' : 'sys';
          await postCommandDesk('/api/alerts', payload, kind, 'alert desk');
          break;
        }

        case 'watch': {
          if (!session) {
            push({ kind: 'error', text: 'register or log in first — the watchlist belongs to an operator.' });
            break;
          }
          const w0 = (rest[0] || '').toLowerCase();
          let payload;
          if (!w0) {
            payload = { action: 'watch' };
          } else if (w0 === 'add') {
            const token = rest.slice(1).join(' ').trim();
            if (!token) {
              push({ kind: 'error', text: 'usage: watch add <ca|link|pool> — adds a token to the watchlist.' });
              break;
            }
            payload = { action: 'watch-add', token };
          } else if (w0 === 'del') {
            if (!rest[1]) {
              push({ kind: 'error', text: 'usage: watch del <n> — "watch" lists rows with numbers.' });
              break;
            }
            payload = { action: 'watch-del', id: rest[1] };
          } else if (w0 === 'clear') {
            payload = { action: 'watch-clear' };
          } else {
            push({ kind: 'error', text: `watch: unknown action "${rest[0]}" — add / del / clear.` });
            break;
          }
          await postCommandDesk('/api/alerts', payload, payload.action === 'watch-add' ? 'ok' : 'sys', 'watchlist');
          break;
        }

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
          // Any typed line that asks for the contract address gets the pinned
          // CA verbatim — the same string the header bar and "ca" print.
          if (asksForCa(trimmed)) {
            copyCa();
            push({ kind: 'ok', text: `CA — ${TOKEN_CA}`, speed: 4 });
            break;
          }
          push({ kind: 'error', text: `rootchain: command not found: ${word}. Type "help".` });
      }
    },
    [auto, copyCa, memory.count, memory.lastTopic, postCommandDesk, promptText, push, relay.online, relay.operators, relay.store, refreshMemory, refreshTopics, runAgentTurn, session, shareAgentTalk, status],
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
      { id: 'daemon', label: 'Daemon' },
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

  if (ideMode && session) {
    return (
      <IdeTerminal
        session={session}
        connector={connector}
        onExit={() => setIdeMode(false)}
      />
    );
  }

  if (socialMode && session) {
    return (
      <SocialTerminal
        session={session}
        relay={relay}
        onExit={() => setSocialMode(false)}
      />
    );
  }

  if (liveMode && session) {
    return (
      <LiveTerminal
        session={session}
        relay={relay}
        initialChannel={liveChannel}
        onExit={() => {
          setLiveMode(false);
          setLiveChannel('relay');
        }}
      />
    );
  }

  if (scanMode && session) {
    return (
      <ScannerTerminal
        session={session}
        connector={connector}
        onExit={() => setScanMode(false)}
      />
    );
  }

  if (loomMode && session) {
    return (
      <LoomTerminal
        session={session}
        connector={connector}
        onExit={() => setLoomMode(false)}
      />
    );
  }

  if (launchMode && session) {
    return <Launchpad session={session} onExit={() => setLaunchMode(false)} />;
  }

  // dexview is public — guests may watch the chart and read the wall
  if (marketPair) {
    return (
      <MarketTerminal
        session={session}
        initialPair={marketPair}
        onExit={() => setMarketPair(null)}
      />
    );
  }

  return (
    <div className="app crt">
      <header className="hdr">
        <div className="hdr__left">
          <h1 className="hdr__title">Rootchain Terminal v1.0 // Secure Access</h1>
          <a
            className="hdr__x"
            href="https://x.com/RTCterminal"
            target="_blank"
            rel="noopener noreferrer"
            title="@RTCterminal on X"
            aria-label="Rootchain Terminal on X"
          >
            𝕏
          </a>
        </div>
        <div className="hdr__meta">
          {session ? (
            <>
              <span className="hdr__user">
                USER <b>{session.username}</b>
              </span>
              <span className="kbview">{codeVisible ? session.code : maskCode(session.code)}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setCodeVisible((v) => !v)}
                aria-pressed={codeVisible}
                aria-label={codeVisible ? 'hide access code' : 'show access code'}
                title={codeVisible ? 'hide access code' : 'show access code'}
              >
                {codeVisible ? '🙈' : '👁'}
              </button>
              {identity && (identity.twitter || identity.wallets?.length) ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setShowIdentity(true)}
                  title={`X profile linked to ${session.username}${identity.twitter?.name ? ` — ${identity.twitter.name}` : ''}${identity.twitter?.username ? ` (@${identity.twitter.username})` : ''}${identity.wallets?.[0]?.address ? ` · wallet ${identity.wallets[0].address}` : ''} · click to manage`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {identity.twitter?.profilePictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={identity.twitter.profilePictureUrl.replace('_normal', '_mini')}
                      alt=""
                      width={16}
                      height={16}
                      style={{ borderRadius: '50%', verticalAlign: 'middle' }}
                    />
                  ) : null}
                  {identity.twitter?.username ? `@${identity.twitter.username}` : 'identity'}
                  {identity.wallets?.[0]?.address
                    ? ` · ${identity.wallets[0].address.slice(0, 4)}…${identity.wallets[0].address.slice(-4)}`
                    : ''}
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <span>NO SESSION</span>
          )}
        </div>
      </header>

      <button type="button" className="cabar" onClick={copyCa} title="copy the contract address">
        <span className="cabar__label">CA</span>
        <span className="cabar__addr">{TOKEN_CA}</span>
        <span className="cabar__hint">{caCopied ? 'COPIED ✓' : 'CLICK TO COPY'}</span>
      </button>

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
              {connector ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setShowConnector(true)}
                  title="manage / disconnect the linked AI"
                >
                  AI {connector.model || connector.tool || connector.type} · manage
                </button>
              ) : (
                <button type="button" className="btn btn--sm" onClick={() => setShowConnector(true)}>
                  Connect AI
                </button>
              )}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => shareAgentTalk()}
                title="share the last agent turns to the wire"
              >
                Share talk
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={shareTalkToX}
                title="compose an X post from the agent talk — sources: rtcterminal.com"
              >
                Share to 𝕏
              </button>
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

        <SidePanels
          topics={topics}
          memory={memory}
          relay={relay}
          me={session?.username}
          thinking={thinking}
          auto={auto}
          link={status.link}
        />
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

      {contextFile && session ? (
        <ContextEditor
          file={contextFile}
          session={session}
          onSaved={(file, { bytes }) => {
            setContextFile(null);
            push({
              kind: 'ok',
              text: `${file}.md saved (${bytes} chars) — the next live AI turn speaks with it.`,
              speed: 6,
            });
          }}
          onDismiss={() => setContextFile(null)}
        />
      ) : null}

      {showIdentity && session ? (
        <IdentityPanel
          session={session}
          onClose={() => setShowIdentity(false)}
          onLinked={() => refreshIdentity()}
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
            push({
              kind: 'sys',
              text: 'their behaviour is yours to set — edit skill.md & readme.md with "skill" / "readme".',
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
