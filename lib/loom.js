// Loom weave — the branching-text data model, terminal-native.
//
// Modelled on universal-weave's building blocks (nodes with activation,
// editing and bookmarking; a weave as a tree with an active node path),
// deliberately reduced to what a terminal needs: plain JSON, no CRDTs.
//
//   weave = { name, nextId, activeId, nodes: { id: { id, parent, text,
//                                                    bookmark, children[] } } }
//
// The active path is root → activeId; its fragments joined with a blank
// line are the text the AI continues. Every node keeps its children ordered
// so candidate numbering (1..k) is stable between renders.

export const LOOM = {
  NODE_TEXT_MAX: 4000,   // chars per fragment
  NODES_MAX: 400,        // nodes per weave
  WEAVE_JSON_MAX: 120_000, // persisted size cap
  WEAVES_KEEP: 20,       // saved weaves per operator
  CANDIDATES_DEFAULT: 4,
  CANDIDATES_MAX: 6,
};

export function newWeave(seedText) {
  const text = clampNodeText(seedText);
  return {
    name: null,
    nextId: 2,
    activeId: 1,
    nodes: {
      1: { id: 1, parent: null, text, bookmark: false, children: [] },
    },
  };
}

export function clampNodeText(text) {
  return String(text || '').replace(/\r\n/g, '\n').trim().slice(0, LOOM.NODE_TEXT_MAX);
}

export function rootId() {
  return 1;
}

export function node(w, id) {
  return w.nodes[id] || null;
}

export function childrenOf(w, id) {
  const n = node(w, id);
  return n ? n.children.map((cid) => w.nodes[cid]).filter(Boolean) : [];
}

/** Root → active, as node objects. */
export function activePath(w) {
  const out = [];
  let cur = node(w, w.activeId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    out.unshift(cur);
    cur = cur.parent != null ? node(w, cur.parent) : null;
  }
  return out;
}

/** The text the AI continues — active-path fragments joined by a blank line. */
export function activeText(w) {
  return activePath(w).map((n) => n.text).join('\n\n');
}

export function activeDepth(w) {
  return activePath(w).length;
}

export function countNodes(w) {
  return Object.keys(w.nodes).length;
}

/** Attach a fragment under `parentId` (default: active) and return its id. */
export function addNode(w, text, parentId = null) {
  const pid = parentId == null ? w.activeId : parentId;
  const parent = node(w, pid);
  if (!parent) return null;
  const id = w.nextId;
  w.nextId += 1;
  w.nodes[id] = { id, parent: pid, text: clampNodeText(text), bookmark: false, children: [] };
  parent.children.push(id);
  return id;
}

/** Activate a node (also works as "deactivate" — rewinding is just walking up). */
export function setActive(w, id) {
  if (node(w, id)) {
    w.activeId = id;
    return true;
  }
  return false;
}

/** Rewind the active path n steps toward the root. */
export function rewind(w, steps = 1) {
  const path = activePath(w);
  const target = path[Math.max(0, path.length - 1 - Math.max(1, steps))];
  if (target) {
    w.activeId = target.id;
    return target;
  }
  return null;
}

export function editNode(w, id, text) {
  const n = node(w, id);
  if (!n) return false;
  n.text = clampNodeText(text);
  return true;
}

export function toggleBookmark(w, id) {
  const n = node(w, id);
  if (!n) return false;
  n.bookmark = !n.bookmark;
  return n.bookmark;
}

/**
 * Deduplicate generated candidates — trim, drop empties and exact repeats
 * (universal-weave's dedup, applied where it matters: at generation time).
 */
export function dedupeCandidates(list, cap = LOOM.CANDIDATES_MAX) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const t = String(raw || '').replace(/\r\n/g, '\n').trim().slice(0, LOOM.NODE_TEXT_MAX);
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, cap);
}

function snippet(text, width = 44) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > width ? `${one.slice(0, width - 1)}…` : one;
}

/**
 * ASCII render of the whole tree — the loom's map. Children of the ACTIVE
 * node get [n] numbers so "pick 2" always matches what's on screen.
 *   » active node · * on the active path · § bookmarked
 */
export function treeLines(w) {
  const pathIds = new Set(activePath(w).map((n) => n.id));
  const actives = childrenOf(w, w.activeId);
  const lines = [];

  function walk(id, prefix, isLast) {
    const n = w.nodes[id];
    if (!n) return;
    const branch = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';
    let tag = id === w.activeId ? '»' : pathIds.has(id) ? '*' : ' ';
    const idx = actives.findIndex((c) => c.id === id);
    if (idx !== -1) tag = `${idx + 1}`;
    lines.push(`${prefix}${branch}${tag} ${snippet(n.text)}${n.bookmark ? ' §' : ''}`);
    const kids = childrenOf(w, id);
    kids.forEach((kid, i) => {
      walk(kid.id, prefix === '' ? '' : `${prefix}${isLast ? '   ' : '│  '}`, i === kids.length - 1);
    });
  }

  walk(rootId(), '', true);
  return lines;
}

/** One-line fragments of the active path, numbered — for `p` printing. */
export function pathLines(w) {
  return activePath(w).map((n, i) => `  ${String(i + 1).padStart(2)}. ${String(n.text).replace(/\s+/g, ' ').slice(0, 100)}`);
}
