// Loom model smoke test — lib/loom.js is import-free, so plain node runs it.
import {
  newWeave, addNode, setActive, rewind, editNode, toggleBookmark,
  activePath, activeText, activeDepth, countNodes, childrenOf,
  treeLines, dedupeCandidates,
} from '../lib/loom.js';

const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) process.exitCode = 1;
};

const w = newWeave('the terminal hums.');
eq('root exists', countNodes(w), 1);
eq('depth 1', activeDepth(w), 1);

const a = addNode(w, 'a wire sparks.');   // child of root
const b = addNode(w, 'a wire sparks.');   // exact dup node is still added (dedup is for candidates)
eq('two children', childrenOf(w, 1).length, 2);

setActive(w, a);
const c = addNode(w, 'the spark becomes a glyph.'); // child of a — stays a strand until picked
eq('strand added, active unchanged', activeDepth(w), 2);
setActive(w, c); // picking it
eq('depth 3 on branch a', activeDepth(w), 3);
eq('activeText joins fragments', activeText(w), 'the terminal hums.\n\na wire sparks.\n\nthe spark becomes a glyph.');

// rewind one, take branch b
const target = rewind(w, 2);
eq('rewound to root', target.id, 1);
setActive(w, b);
eq('branch b depth', activeDepth(w), 2);

// edit + bookmark
setActive(w, c);
editNode(w, c, 'the spark becomes a WORD.');
eq('edited node', activeText(w).includes('a WORD.'), true);
toggleBookmark(w, c);
eq('bookmark flag', w.nodes[c].bookmark, true);

// tree render sanity
const t = treeLines(w);
console.log('--- tree ---\n' + t.join('\n'));
eq('tree has every node', t.length, countNodes(w));

// candidate dedup
eq('dedup', dedupeCandidates([' x ', '', 'x', 'y', null, 'y'], 4), ['x', 'y']);

console.log('done');
