// Words written as a diagram, for a board: plain logic (no DOM), tested in
// test/board-text.test.mjs.
//
//   Plan              a box (a line without a mark: at the top)
//   - Goals           one under it: a mark (- * + \u2022 or 1.), one more each level
//   -- Revenue        (--, ---; spaces or a tab before the mark count too)
//   Plan -> Build -> Ship    arrows: -> \u2192 => (<- \u2190 back, <-> \u2194 both, " -- " none)
//   Build -> QA: if bugs     ": words" after the last box of a step: the arrow's words
//   (Start)  {Approved?}  <Approved?>  [Box]   an ellipse, a diamond, a box
//
// The same words are the same box. Not a diagram (no arrow, nothing under
// anything): null.

const ARROW = /\s*(<-+>|<=+>|\u2194|-+>|=+>|\u2192|\u21D2|<-+|\u2190|\s--+\s)\s*/;
const MARK = /^([-*+\u2022\u2014\u2013]+|\d+[.)])(?!>)\s*/;

function cleanName(raw) {
  let s = raw.trim();
  let shape = null;
  const wrapped = /^([([{<])(.*)([)\]}>])$/.exec(s);
  if (wrapped && '([{<'.indexOf(wrapped[1]) === ')]}>'.indexOf(wrapped[3])) {
    shape = { '(': 'ellipse', '[': 'rect', '{': 'diamond', '<': 'diamond' }[wrapped[1]];
    s = wrapped[2].trim();
  }
  return { text: s, shape };
}

// The depth of a line (0: no mark, at the left) and its words.
function depthOf(line) {
  const lead = /^[ \t]*/.exec(line)[0];
  const indent = [...lead].reduce((a, c) => a + (c === '\t' ? 2 : 1), 0) >> 1;
  const rest = line.slice(lead.length);
  const m = MARK.exec(rest);
  if (!m || !rest.slice(m[0].length).trim()) return { depth: indent, words: rest };
  const marks = /^\d/.test(m[1]) ? 1 : [...m[1]].reduce((a, c) => a + (c === '\u2014' ? 2 : 1), 0);
  return { depth: indent + marks, words: rest.slice(m[0].length) };
}

export function textToDiagram(text) {
  const nodes = [];
  const byName = new Map();
  const edges = [];
  const named = (raw) => {
    const { text: t, shape } = cleanName(raw);
    if (!t) return null;
    let n = byName.get(t);
    if (!n) { n = { key: nodes.length, text: t, shape: shape || 'rect' }; nodes.push(n); byName.set(t, n); } else if (shape) n.shape = shape;
    return n;
  };
  const join = (a, b, how = 'to', label = '') => {
    if (!a || !b || a === b) return;
    const [from, to] = how === 'back' ? [b, a] : [a, b];
    if (edges.some((e) => e.from === from.key && e.to === to.key)) return;
    const e = { from: from.key, to: to.key };
    if (label) e.label = label;
    if (how === 'both') e.both = true;
    if (how === 'none') e.none = true;
    edges.push(e);
  };
  const stack = []; // [depth, node]
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || /^[\s\-*_=]+$/.test(line)) continue;
    const { depth, words } = depthOf(line);
    const parts = words.split(ARROW);
    // parts: name, arrow, name, arrow, name\u2026
    let first = null;
    let last = null;
    for (let i = 0; i < parts.length; i += 2) {
      let raw = parts[i];
      let label = '';
      if (i > 0) {
        const c = /^(.*?)\s*:\s+(.+)$/.exec(raw);
        if (c && i === parts.length - 1) { raw = c[1]; label = c[2].trim(); }
      }
      const n = named(raw);
      if (!n) continue;
      if (i > 0 && last) {
        const a = parts[i - 1].trim();
        const how = /^(<-+>|<=+>|\u2194)$/.test(a) ? 'both' : /^(<-+|\u2190)$/.test(a) ? 'back' : /^--+$/.test(a) ? 'none' : 'to';
        join(last, n, how, label);
      }
      first ||= n;
      last = n;
    }
    if (!first) continue;
    while (stack.length && stack[stack.length - 1][0] >= depth) stack.pop();
    if (stack.length) join(stack[stack.length - 1][1], first);
    stack.push([depth, last]);
  }
  return edges.length ? { nodes, edges } : null;
}

// Where they go, left to right: a column for each step along the arrows, the
// ones under a box beside each other below it, it in the middle of them.
// size(n) \u2192 [width, height]. \u2192 [{ x, y, width, height }] by key, from 0, 0.
export function layoutDiagram(g, size, { gapX = 90, gapY = 30 } = {}) {
  const N = g.nodes.length;
  const dims = g.nodes.map((n) => size(n));
  const outs = Array.from({ length: N }, () => []);
  for (const e of g.edges) outs[e.from].push(e.to);
  // The arrows that go back round (a loop) don't make columns.
  const state = new Array(N).fill(0);
  const ahead = Array.from({ length: N }, () => []);
  const visit = (v) => {
    state[v] = 1;
    for (const w of outs[v]) {
      if (state[w] === 1) continue;
      ahead[v].push(w);
      if (!state[w]) visit(w);
    }
    state[v] = 2;
  };
  const incoming = new Array(N).fill(0);
  for (const e of g.edges) incoming[e.to]++;
  for (let v = 0; v < N; v++) if (!state[v] && !incoming[v]) visit(v);
  for (let v = 0; v < N; v++) if (!state[v]) visit(v);
  // Columns: the longest way in.
  const col = new Array(N).fill(0);
  for (let pass = 0; pass < N; pass++) {
    let moved = false;
    for (let v = 0; v < N; v++) for (const w of ahead[v]) if (col[w] < col[v] + 1) { col[w] = col[v] + 1; moved = true; }
    if (!moved) break;
  }
  // Each box under the box it comes from (the nearest column before it).
  const parent = new Array(N).fill(-1);
  for (let v = 0; v < N; v++) {
    for (const w of ahead[v]) {
      const p = parent[w];
      if (p === -1 || col[v] > col[p]) parent[w] = v;
    }
  }
  const kids = Array.from({ length: N }, () => []);
  for (let v = 0; v < N; v++) for (const w of ahead[v]) if (parent[w] === v && !kids[v].includes(w)) kids[v].push(w);
  const widths = [];
  for (let v = 0; v < N; v++) widths[col[v]] = Math.max(widths[col[v]] || 0, dims[v][0]);
  const colX = [];
  for (let c = 0, x = 0; c < widths.length; c++) { colX[c] = x; x += (widths[c] || 0) + gapX; }
  const y = new Array(N).fill(0);
  const shift = (v, dy) => { y[v] += dy; for (const w of kids[v]) shift(w, dy); };
  let cursor = 0;
  const place = (v) => {
    const top = cursor;
    const h = dims[v][1];
    if (!kids[v].length) { y[v] = cursor; cursor += h + gapY; return; }
    for (const w of kids[v]) place(w);
    const a = kids[v][0];
    const b = kids[v][kids[v].length - 1];
    y[v] = (y[a] + dims[a][1] / 2 + y[b] + dims[b][1] / 2) / 2 - h / 2;
    if (y[v] < top) shift(v, top - y[v]);
    cursor = Math.max(cursor, y[v] + h + gapY);
  };
  for (let v = 0; v < N; v++) if (parent[v] === -1) { place(v); cursor += gapY; }
  return g.nodes.map((n, v) => ({
    x: Math.round(colX[col[v]] + (widths[col[v]] - dims[v][0]) / 2),
    y: Math.round(y[v]),
    width: dims[v][0],
    height: dims[v][1],
  }));
}
