// Stable per-operator colour — hashed from the username so everyone keeps
// the same channel tint across sessions and terminals.
const PALETTE = [
  '#ffb000', // amber
  '#7fd7c9', // teal
  '#9be89b', // green
  '#ff9ec4', // rose
  '#a6b8ff', // periwinkle
  '#ffd166', // gold
  '#8fd3ff', // sky
  '#d7a8ff', // lilac
];

export function userColor(name) {
  // djb2 — spreads names across the palette better than a plain sum
  let h = 5381;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 33) + s.codePointAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
