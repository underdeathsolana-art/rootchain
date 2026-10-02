'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOOM,
  newWeave,
  addNode,
  setActive,
  rewind,
  editNode,
  toggleBookmark,
  activePath,
  activeText,
  activeDepth,
  countNodes,
  childrenOf,
  treeLines,
  rootId,
} from '@/lib/loom';

const HELP_LINES = [
  'RTC-LOOM COMMANDS — branching text, own AI optional',
  '  new <seed text> .... start an rtc-loom from a seed',
  '  w [k] .............. weave: grow k strands (default 4) — your AI when',
  '                       connected, the local engine when not',
  '  a <text> ........... add your own strand manually (always works)',
  '  1..6 ............... pick strand n — the path grows; the rest stay branches',
  '  back [n] ........... rewind the path n steps (default 1) and re-branch',
  '  p .................. print the full active text · t draws the tree in-text',
  '  e .................. edit the active node · b bookmarks it · go <id> jumps',
  '  save <name> · load <name> · ls · rm <name> — the database keeps every loom',
  '  clear · exit',
];

/**
 * RTC-LOOM — the branching text explorer, terminal-native. Inspired by Loom
 * and universal-weave's node/weave model (activation, editing, bookmarking,
 * deduplication), reduced to what a bash-style interface needs: the loom is
 * a tree of fragments, the active path is the story, and "w" grows k
 * candidate branches — from the operator's OWN linked AI when one is
 * attached ("connect", any OpenAI-compatible endpoint or MCP server), or
 * from the local engine when not, so the loom always runs. Every loom saves
 * to the database under the operator. The side panel renders the tree as a
 * live SVG graph — click any node to jump to it.
 */
const GRAPH = { W: 150, H: 34, GAP_X: 26, GAP_Y: 12 };

/**
 * The loom's live map: an SVG tree graph. Nodes sit by depth (columns) and
 * leaf order (rows), the active path lights up, pickable strands get a
 * dashed border plus their pick-number badge, and every node is clickable —
 * a click is "go <id>".
 */
function TreeGraph({ weave, onGo }) {
  const { nodes } = weave;
  const activeKids = childrenOf(weave, weave.activeId).map((n) => n.id);
  const pathIds = new Set(activePath(weave).map((n) => n.id));

  const COL = GRAPH.W + GRAPH.GAP_X;
  const ROW = GRAPH.H + GRAPH.GAP_Y;

  const depthMemo = new Map();
  const depthOf = (id) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    let d = 0;
    let cur = nodes[id];
    const guard = new Set();
    while (cur && cur.parent != null && nodes[cur.parent] && !guard.has(cur.id)) {
      guard.add(cur.id);
      d += 1;
      cur = nodes[cur.parent];
    }
    depthMemo.set(id, d);
    return d;
  };

  const pos = new Map();
  let leafY = 0;
  let maxDepth = 0;
  const place = (id, seen) => {
    if (seen.has(id)) return pos.get(id)?.y ?? 0; // cycle guard for hand-tampered weaves
    seen.add(id);
    const n = nodes[id];
    const kids = (n.children || []).filter((c) => nodes[c]);
    let y;
    if (!kids.length) {
      y = leafY;
      leafY += ROW;
    } else {
      const ys = kids.map((kid) => place(kid, seen));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    maxDepth = Math.max(maxDepth, depthOf(id));
    pos.set(id, { x: depthOf(id) * COL, y });
    return y;
  };
  place(1, new Set());

  const edges = [];
  for (const n of Object.values(nodes)) {
    if (n.parent == null || !nodes[n.parent]) continue;
    const p = pos.get(n.parent);
    const c = pos.get(n.id);
    if (!p || !c) continue;
    const x1 = p.x + GRAPH.W;
    const y1 = p.y + GRAPH.H / 2;
    const x2 = c.x;
    const y2 = c.y + GRAPH.H / 2;
    const bend = GRAPH.GAP_X + 14;
    edges.push({
      key: `e${n.id}`,
      d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      onPath: pathIds.has(n.id),
    });
  }

  const svgW = (maxDepth + 1) * COL + 16;
  const svgH = Math.max(leafY, ROW) + 12;

  return (
    <div style={{ overflow: 'auto', maxHeight: '52vh', minHeight: 60 }}>
      <svg width={svgW} height={svgH} role="img" aria-label="rtc-loom branch graph" style={{ display: 'block' }}>
        <g transform="translate(8,6)">
          {edges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={e.onPath ? 1.6 : 1}
              opacity={e.onPath ? 0.85 : 0.25}
            />
          ))}
          {Object.values(nodes).map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const isActive = n.id === weave.activeId;
            const onPath = pathIds.has(n.id);
            const candIdx = activeKids.indexOf(n.id);
            const isCand = candIdx !== -1;
            const fill = isActive
              ? 'rgba(134,239,172,.24)'
              : onPath
                ? 'rgba(134,239,172,.10)'
                : 'rgba(255,255,255,.04)';
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: 'pointer' }}
                onClick={() => onGo(n.id)}
              >
                <title>{`${n.id}: ${String(n.text).slice(0, 220)}`}</title>
                <rect
                  width={GRAPH.W}
                  height={GRAPH.H}
                  rx={6}
                  fill={fill}
                  stroke="currentColor"
                  strokeWidth={isActive ? 2 : 1}
                  strokeDasharray={isCand ? '5 3' : undefined}
                  opacity={isActive || onPath || isCand ? 1 : 0.62}
                />
                <text x={9} y={GRAPH.H / 2 + 4} fontSize={10} fill="currentColor" style={{ pointerEvents: 'none' }}>
                  {`${String(n.text).replace(/\s+/g, ' ').slice(0, 21)}${n.text.replace(/\s+/g, ' ').length > 21 ? '…' : ''}${n.bookmark ? ' §' : ''}`}
                </text>
                {isCand ? (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle cx={GRAPH.W - 13} cy={13} r={8.5} fill="rgba(0,0,0,.7)" stroke="currentColor" />
                    <text x={GRAPH.W - 13} y={16.5} fontSize={9.5} textAnchor="middle" fill="currentColor">
                      {candIdx + 1}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default function LoomTerminal({ session, connector, onExit }) {
  const [weave, setWeave] = useState(null);
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState([]);
  const [editor, setEditor] = useState(null); // { text } while editing the active node

  const idRef = useRef(0);
  const bootedRef = useRef(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const weaveRef = useRef(null);

  useEffect(() => {
    weaveRef.current = weave;
  }, [weave]);

  const out = useCallback((text, kind = 'sys') => {
    setLines((prev) => [...prev.slice(-299), { id: (idRef.current += 1), kind, text }]);
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/loom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: session.username, code: session.code, action: 'ls' }),
      });
      const data = await res.json();
      if (data.ok) setSaved(data.weaves || []);
    } catch {
      /* keep previous */
    }
  }, [session.code, session.username]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    out('ROOTCHAIN RTC-LOOM // BRANCH TERMINAL', 'head');
    if (connector) {
      out(`weaving on your AI — ${connector.model || connector.tool || connector.type} (${connector.type === 'mcp' ? 'MCP' : 'API'})`);
    } else {
      out('LOCAL MODE — "w" pulls strands from the offline engine and every loom saves to the database. "connect" (any API key) upgrades w to true AI continuations.', 'warn');
    }
    out('"new <seed>" starts · "w" grows strands · a number picks one · "a <text>" adds your own');
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  /** Mutate a clone, then swap it in — lib/loom ops mutate in place. */
  function mutateWeave(fn) {
    const next = structuredClone(weaveRef.current);
    const result = fn(next);
    setWeave(next);
    weaveRef.current = next;
    return result;
  }

  async function callLoom(payload) {
    const res = await fetch('/api/loom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: session.username, code: session.code, ...payload }),
    });
    return res.json();
  }

  async function doWeave(k) {
    if (!weaveRef.current) {
      out('no rtc-loom yet — "new <seed text>" starts one.', 'error');
      return;
    }
    setBusy(true);
    try {
      const data = await callLoom({
        action: 'weave',
        pathText: activeText(weaveRef.current).slice(-6000),
        k,
        connector,
      });
      if (!data.ok) {
        out(data.error || 'weave failed.', 'error');
        return;
      }
      if (data.local) {
        out(`─ ${data.candidates.length} strand(s) from the ${data.model} (offline — "connect" an AI for true continuations) ─`, 'warn');
      } else {
        out(`─ ${data.candidates.length} strand(s) from ${data.model} ─`);
      }
      mutateWeave((w) => data.candidates.map((c) => addNode(w, c)));
      data.candidates.forEach((c, i) => {
        out(`[${i + 1}] ${c.replace(/\s+/g, ' ')}`, 'ok');
      });
      out('pick a number to grow the path — or "w" for more strands.');
    } catch {
      out('rtc-loom unreachable — is the terminal service running?', 'error');
    } finally {
      setBusy(false);
    }
  }

  function pick(n) {
    const kids = childrenOf(weaveRef.current, weaveRef.current.activeId);
    const chosen = kids[n - 1];
    if (!chosen) {
      out(kids.length ? `only ${kids.length} strand(s) open — pick 1..${kids.length}, or "w" more.` : 'no strands yet — "w" weaves some.', 'error');
      return;
    }
    mutateWeave((w) => setActive(w, chosen.id));
    out(`+ ${chosen.text.replace(/\s+/g, ' ')}`, 'ok');
    out(`depth ${activeDepth(weaveRef.current)} · "${chosen.text.replace(/\s+/g, ' ').slice(0, 60)}" is now the tip — "w" continues from here.`);
  }

  async function onSubmit(event) {
    event.preventDefault();
    const value = input.trim();
    setInput('');
    if (!value) return;
    out(`${session.username}@rtc-loom:~$ ${value}`, 'cmd');

    const [word, ...rest] = value.split(/\s+/);
    const command = word.toLowerCase();
    const tail = value.slice(word.length).trim();

    if (command === 'exit' || command === 'quit') {
      onExit();
      return;
    }
    if (command === 'help' || command === '?') {
      HELP_LINES.forEach((l) => out(l));
      return;
    }
    if (command === 'clear') {
      setLines([]);
      return;
    }
    if (command === 'new') {
      if (!tail) {
        out('usage: new <seed text> — the opening of the rtc-loom.', 'error');
        return;
      }
      const w = newWeave(tail);
      setWeave(w);
      weaveRef.current = w;
      out(`rtc-loom started — 1 node, depth 1. "w" grows the first strands${connector ? '' : ' (offline engine)'}.`, 'ok');
      return;
    }
    if (command === 'a' || command === 'add') {
      if (!weaveRef.current) {
        out('no rtc-loom yet — "new <seed text>" starts one.', 'error');
        return;
      }
      if (!tail) {
        out('usage: a <text> — adds your own strand under the active node.', 'error');
        return;
      }
      mutateWeave((w) => addNode(w, tail));
      const n = childrenOf(weaveRef.current, weaveRef.current.activeId).length;
      out(`+ your strand added as [${n}] — "pick ${n}" (or click it in the graph) walks it.`, 'ok');
      return;
    }
    if (command === 'w' || command === 'r' || command === 'weave') {
      const k = Math.min(Math.max(1, Number(rest[0]) || LOOM.CANDIDATES_DEFAULT), LOOM.CANDIDATES_MAX);
      await doWeave(k);
      return;
    }
    if (/^[1-9]$/.test(command)) {
      if (!weaveRef.current) {
        out('no rtc-loom yet — "new <seed text>" starts one.', 'error');
        return;
      }
      pick(Number(command));
      return;
    }
    if (command === 'back' || command === 'rewind') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      const steps = Math.max(1, Number(rest[0]) || 1);
      const target = mutateWeave((w) => rewind(w, steps));
      if (!target) {
        out('already at the seed.', 'error');
        return;
      }
      out(`rewound to depth ${activeDepth(weaveRef.current)} — "${target.text.replace(/\s+/g, ' ').slice(0, 60)}". other branches are one "go <id>" away ("t" draws them).`);
      return;
    }
    if (command === 'p' || command === 'print') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      const parts = activePath(weaveRef.current).map((n) => n.text);
      out(['ACTIVE PATH — full text', ...parts.map((t) => `  ${t}`)].join('\n\n'));
      return;
    }
    if (command === 't' || command === 'tree') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      out(['BRANCH TREE — » active · * on path · § bookmarked · 1..n open strands', ...treeLines(weaveRef.current)].join('\n'));
      return;
    }
    if (command === 'e' || command === 'edit') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      setEditor({ text: weaveRef.current.nodes[weaveRef.current.activeId].text });
      return;
    }
    if (command === 'b' || command === 'bookmark') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      const on = mutateWeave((w) => toggleBookmark(w, w.activeId));
      out(on ? 'node bookmarked § — it survives in the tree map.' : 'bookmark removed.', 'ok');
      return;
    }
    if (command === 'go') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      const id = Number(rest[0]);
      if (!mutateWeave((w) => setActive(w, id))) {
        out(`no node #${rest[0]} — "t" lists ids in the tree panel.`, 'error');
        return;
      }
      out(`jumped to node ${id} — depth ${activeDepth(weaveRef.current)}.`);
      return;
    }
    if (command === 'save') {
      if (!weaveRef.current) {
        out('no rtc-loom yet.', 'error');
        return;
      }
      if (!tail) {
        out('usage: save <name>', 'error');
        return;
      }
      const data = await callLoom({ action: 'save', name: tail, weave: weaveRef.current });
      if (data.ok) {
        mutateWeave((w) => {
          w.name = tail;
          return true;
        });
        out(data.text, 'ok');
        refreshSaved();
      } else {
        out(data.error, 'error');
      }
      return;
    }
    if (command === 'load') {
      if (!tail) {
        out('usage: load <name> — "ls" lists saved weaves.', 'error');
        return;
      }
      const data = await callLoom({ action: 'load', name: tail });
      if (!data.ok) {
        out(data.error, 'error');
        return;
      }
      setWeave(data.weave);
      weaveRef.current = data.weave;
      out(`rtc-loom "${tail}" loaded — ${countNodes(data.weave)} nodes, depth ${activeDepth(data.weave)} on the active path.`, 'ok');
      return;
    }
    if (command === 'ls') {
      await refreshSaved();
      if (!saved.length && weaveRef.current === null) out('no saved rtc-looms yet — "new <seed>" then "save <name>".');
      else out(['SAVED RTC-LOOMS', ...saved.map((s) => `  ${s.name} · ${s.nodes} nodes`)].join('\n'));
      return;
    }
    if (command === 'rm') {
      if (!tail) {
        out('usage: rm <name>', 'error');
        return;
      }
      const data = await callLoom({ action: 'rm', name: tail });
      if (data.ok) {
        out(data.text, 'ok');
        refreshSaved();
      } else {
        out(data.error, 'error');
      }
      return;
    }

    out(`rtc-loom: command not found: ${word}. Type "help".`, 'error');
  }

  const modelLabel = connector
    ? `${connector.model || connector.tool || connector.type} · ${connector.type === 'mcp' ? 'MCP' : 'API'}`
    : 'local engine · offline';
  const stats = weave
    ? `${countNodes(weave)} nodes · depth ${activeDepth(weave)} · ${childrenOf(weave, weave.activeId).length} open strand(s)`
    : 'no loom';

  return (
    <div className="app crt">
      <header className="hdr">
        <h1 className="hdr__title">Rootchain RTC-LOOM // Branch Terminal</h1>
        <div className="hdr__meta">
          <span className="hdr__user">
            USER <b>{session.username}</b>
          </span>
          <span className="kbview">{modelLabel}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
            Exit loom
          </button>
        </div>
      </header>

      <div className="main live__main">
        <section className="feedwrap live__feedwrap" aria-label="Loom channel">
          <div className="feedwrap__bar">
            <span>{busy ? 'weaving strands…' : `rtc-loom — ${stats}`}</span>
            <span className="feedwrap__hint-sys">{weave?.name ? `saved as "${weave.name}"` : 'unsaved'}</span>
          </div>

          <div className="log" ref={scrollRef} role="log" aria-label="Loom output">
            {lines.length === 0 ? (
              <div className="line line--sys">
                <span className="line__text">The rtc-loom awaits a seed — type "new &lt;seed text&gt;".</span>
              </div>
            ) : null}
            {lines.map((line) => (
              <div key={line.id} className={`line line--${line.kind}`}>
                <span className="line__text" style={{ whiteSpace: 'pre-wrap' }}>
                  {line.text}
                </span>
              </div>
            ))}
            {busy ? (
              <div className="line line--sys">
                <span className="line__text">{connector ? 'asking your AI for continuations…' : 'pulling strands from the local engine…'}</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panels" aria-label="Loom graph">
          <section className="panel" data-panel="loom">
            <div className="panel__head">
              <span>Branch graph</span>
              <span>{weave ? `${countNodes(weave)}n` : '—'}</span>
            </div>
            <div className="panel__body">
              {weave ? (
                <TreeGraph
                  weave={weave}
                  onGo={(id) => {
                    mutateWeave((w) => setActive(w, id));
                    out(`jumped to node ${id} — depth ${activeDepth(weaveRef.current)}.`);
                  }}
                />
              ) : (
                <p className="mem-empty">No loom yet — "new &lt;seed&gt;" plants one.</p>
              )}
              <p className="mem-empty" style={{ marginTop: '10px' }}>
                » active · lit path · § bookmark · dashed+number = pickable strands · click a node to jump
              </p>
            </div>
          </section>

          <section className="panel" data-panel="saved">
            <div className="panel__head">
              <span>Saved rtc-looms</span>
              <span>{saved.length}</span>
            </div>
            <div className="panel__body">
              {saved.length ? (
                <ul className="filelist">
                  {saved.map((s) => (
                    <li
                      key={s.name}
                      style={{ cursor: 'pointer' }}
                      title={`load "${s.name}" (${s.nodes} nodes)`}
                      onClick={() => {
                        callLoom({ action: 'load', name: s.name }).then((data) => {
                          if (data.ok) {
                            setWeave(data.weave);
                            weaveRef.current = data.weave;
                            out(`rtc-loom "${s.name}" loaded — ${countNodes(data.weave)} nodes.`, 'ok');
                          } else {
                            out(data.error, 'error');
                          }
                        });
                      }}
                    >
                      {s.name} · {s.nodes}n
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mem-empty">Nothing saved yet — "save &lt;name&gt;".</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="loom-input">
          Loom command
        </label>
        <span className="composer__prompt" aria-hidden="true">
          <b>{session.username}</b>@rtc-loom:~$
        </span>
        <input
          id="loom-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setInput('');
          }}
          placeholder={connector ? 'new <seed> · w weaves on your AI · a <text> adds your own · help' : 'local mode — new <seed> · w pulls offline strands · a <text> adds your own · help'}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="loom-hint"
        />
        <span className="composer__hint" id="loom-hint">
          Enter ⏎ run · ESC clear
        </span>
      </form>

      {editor ? (
        <div
          role="dialog"
          aria-label="Edit active node"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditor(null);
          }}
        >
          <div
            className="boot__card"
            style={{ width: 'min(680px, 92vw)', padding: '16px' }}
          >
            <div className="boot__head">
              <h2 style={{ margin: 0, fontSize: 'inherit' }}>EDIT ACTIVE NODE</h2>
              <p style={{ margin: '4px 0 10px' }}>rewrite this fragment — branches below keep their text</p>
            </div>
            <textarea
              value={editor.text}
              onChange={(e) => setEditor({ text: e.target.value })}
              rows={10}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,.4)',
                color: 'inherit',
                border: '1px solid currentColor',
                borderRadius: 4,
                padding: '10px',
                fontFamily: 'inherit',
                fontSize: '13px',
                resize: 'vertical',
              }}
              spellCheck={false}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  mutateWeave((w) => editNode(w, w.activeId, editor.text));
                  setEditor(null);
                  out('active node rewritten.', 'ok');
                }}
              >
                Save node
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
