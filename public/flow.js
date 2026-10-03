// ```flow blocks: a small notation that reads like writing, drawn as a
// Mermaid flowchart (public/diagrams.js turns the result into a picture).
//
//   Login request -> Auth server -> Success?
//     yes -> Dashboard
//     no -> Login screen : shows the error
//
// - `->` connects steps, and a line can chain several. `..>` is dotted,
//   `<->` goes both ways, `--` is a plain line, `-(text)->` has a label.
// - The same text is the same step, wherever it is written.
// - An indented line continues from the last step of the line above it.
//   Under a question (a step ending in `?`) its first word is the answer,
//   written on the arrow.
// - ` : ` at the end adds a description under the line's last step.
// - `Name:` alone on a line groups the indented lines below it.
// - Shapes: `?` at the end is a decision, `(text)` rounded, `((text))` a
//   circle, `[(text)]` a database, `[text]` or plain text a box.
// - `!` at the end marks a step as a problem (drawn in red): `Waiting for approval !`.
//   It is not part of the name.
// - `direction: right` (or down, left, up) on its own line; down by default.
// - `color blue: Auth server, Payment` on its own line colours those steps
//   (red, orange, yellow, green, teal, blue, purple, gray).
// - `#` or `//` at the start of a line is a comment.

export const ARROWS = { '->': '-->', '-->': '-->', '→': '-->', '..>': '-.->', '<->': '<-->', '--': '---' };
export const ARROW_RE = /(\s*(?:<->|\.\.>|-\([^()]*\)->|-->|->|→|--)\s*)/;
const WRAP = { circle: 2, db: 2, round: 1, box: 1 };
// Also in Korean (down, right, left, up; and "direction" below).
export const DIRECTIONS = { down: 'TD', right: 'LR', left: 'RL', up: 'BT', '\uC544\uB798': 'TD', '\uC624\uB978\uCABD': 'LR', '\uC67C\uCABD': 'RL', '\uC704': 'BT' };

// The colours a step can have: fill, outline. The text stays dark on
// every fill, in a light or dark theme alike. Korean names too.
export const COLORS = {
  red: ['#fde2e1', '#e5484d'],
  orange: ['#fee6d2', '#f76b15'],
  yellow: ['#fdf1bf', '#c99a06'],
  green: ['#d9f3e1', '#30a46c'],
  teal: ['#d3f2ee', '#12a594'],
  blue: ['#dce8fe', '#3e63dd'],
  purple: ['#ece3fb', '#8e4ec6'],
  gray: ['#e8e9ec', '#8b8d98'],
};
const COLOR_ALIASES = { grey: 'gray', '\uBE68\uAC15': 'red', '\uC8FC\uD669': 'orange', '\uB178\uB791': 'yellow', '\uCD08\uB85D': 'green', '\uCCAD\uB85D': 'teal', '\uD30C\uB791': 'blue', '\uBCF4\uB77C': 'purple', '\uD68C\uC0C9': 'gray' };
export const colorKey = (word) => { const w = String(word || '').toLowerCase(); return COLORS[w] ? w : COLOR_ALIASES[w] || null; };
// "color blue: A, B" ("\uC0C9 \uD30C\uB791: …" too): keyword, colour, names.
export const COLOR_LINE = /^(color|colour|\uC0C9)\s+([^\s:]+)\s*:\s*(.*)$/i;
export const DIRECTION_LINE = /^(direction|\uBC29\uD5A5)\s*:\s*(\S+)$/i;

// The steps a colour line names, by the names known: a name may hold a
// comma, so the longest run of pieces that is a name wins. [names].
export function colorNames(list, known) {
  const key = (t) => t.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
  const byKey = new Map([...known].map((n) => [key(n), n]));
  const parts = list.split(',');
  const out = [];
  for (let i = 0; i < parts.length;) {
    let j = parts.length;
    for (; j > i; j--) {
      const name = byKey.get(key(parseStep(parts.slice(i, j).join(',')).text));
      if (name) { out.push(name); break; }
    }
    i = j > i ? j : i + 1;
  }
  return out;
}

const SHAPES = [
  [/^\(\((.+)\)\)$/, 'circle'],
  [/^\[\((.+)\)\]$/, 'db'],
  [/^\((.+)\)$/, 'round'],
  [/^\[(.+)\]$/, 'box'],
];

// A trailing "!" (a problem mark): its length, or 0.
const flagLength = (t) => { const m = /\s*!$/.exec(t); return m && m.index > 0 ? m[0].length : 0; };

export function parseStep(raw) {
  let text = raw.trim().replace(/\s+/g, ' ');
  const flag = flagLength(text) > 0;
  if (flag) text = text.slice(0, text.length - flagLength(text));
  for (const [re, shape] of SHAPES) {
    const m = re.exec(text);
    if (m) return { text: m[1].trim(), shape, flag };
  }
  return { text, shape: text.endsWith('?') ? 'decision' : null, flag };
}

// Mermaid label text, quoted: its own entity codes keep quotes and angle brackets literal.
const esc = (s) => s.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
const quote = (s) => `"${esc(s)}"`;

export function flowToMermaid(src) {
  return parseFlow(src).mermaid;
}

// Where a step is written: its text (without the shape marks) on line `line`
// of the block, from column `start` to `end`.
function spotOf(piece, at) {
  const lead = piece.length - piece.trimStart().length;
  let trimmed = piece.trim();
  trimmed = trimmed.slice(0, trimmed.length - flagLength(trimmed));
  const { shape } = parseStep(trimmed);
  const wrap = WRAP[shape] || 0;
  const inner = trimmed.slice(wrap, trimmed.length - wrap);
  const start = at + lead + wrap + (inner.length - inner.trimStart().length);
  return { start, end: start + inner.trim().length };
}

// The Mermaid source, each step with the block lines it appears on
// (0-based), where its text is written, its note, problem mark and shape:
// { id, text, lines, spots, note, flag, shape }, and
// the arrows between steps: { from, to, kind, label } (ids, Mermaid kind).
export function parseFlow(src) {
  const nodes = new Map(); // text -> { id, text, shape, note, group, lines, spots }
  const groups = []; // { id, title, parent }
  const edges = []; // { from, to, kind, label }
  const notes = []; // { node, note, edge } — edge: the arrow its line drew into it
  const colors = []; // { color, list } — read once every step is known
  let direction = 'TD';
  const stack = []; // { indent, last, group }

  const node = (raw, group, lineNo, at) => {
    const { text, shape, flag } = parseStep(raw);
    if (!text) return null;
    let n = nodes.get(text);
    if (!n) nodes.set(text, (n = { id: `n${nodes.size + 1}`, text, shape: null, note: '', group, lines: [], spots: [], flag: false }));
    if (flag) n.flag = true;
    if (shape && (!n.shape || shape !== 'decision')) n.shape = shape;
    if (!n.lines.includes(lineNo)) n.lines.push(lineNo);
    n.spots.push({ line: lineNo, ...spotOf(raw, at) });
    return n;
  };

  const srcLines = String(src).replace(/\r\n?/g, '\n').split('\n');
  for (const [lineNo, rawLine] of srcLines.entries()) {
    const line = rawLine.replace(/\t/g, '  ');
    const body = line.trim();
    if (!body || body.startsWith('#') || body.startsWith('//')) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1] || null;
    const group = parent?.group ?? null;

    const dir = DIRECTION_LINE.exec(body);
    if (dir && DIRECTIONS[dir[2].toLowerCase()]) { direction = DIRECTIONS[dir[2].toLowerCase()]; continue; }
    const paint = COLOR_LINE.exec(body);
    if (paint && colorKey(paint[2])) { colors.push({ color: colorKey(paint[2]), list: paint[3] }); continue; }

    const header = /^([^:]+?)\s*:$/.exec(body);
    if (header && !ARROW_RE.test(header[1])) {
      const g = { id: `g${groups.length + 1}`, title: header[1].trim(), parent: group };
      groups.push(g);
      stack.push({ indent, last: null, group: g });
      continue;
    }

    // "… : note" — a description under the line's last step.
    let text = body;
    let note = '';
    const nm = /^(.*\S)\s+:\s+(.+)$/.exec(body);
    if (nm) { text = nm[1]; note = nm[2].trim(); }

    // Pieces keep their spaces, so each step's column in the line is known.
    const pieces = text.split(ARROW_RE);
    let at = rawLine.length - rawLine.trimStart().length;
    const steps = [];
    pieces.forEach((piece, i) => { if (i % 2 === 0) steps.push({ piece, at }); at += piece.length; });
    const arrows = pieces.filter((_, i) => i % 2 === 1).map((a) => {
      a = a.trim();
      const labelled = /^-\(([^()]*)\)->$/.exec(a);
      return labelled ? { kind: '-->', label: labelled[1].trim() } : { kind: ARROWS[a], label: '' };
    });
    let prev = parent?.last || null;
    let into = null;
    // Under a question, "yes -> …" puts the answer on the arrow from it
    // ("yes -(retry)-> …": both, "yes: retry").
    let first = { kind: '-->', label: '' };
    if (prev?.shape === 'decision' && steps.length > 1) {
      const arrow = arrows.shift();
      const answer = steps.shift().piece.trim();
      first = { ...arrow, label: arrow.label ? `${answer}: ${arrow.label}` : answer };
    }
    steps.forEach(({ piece, at: col }, i) => {
      const n = node(piece, group, lineNo, col);
      const arrow = i === 0 ? first : arrows.shift();
      if (!n) return;
      // Writing the step above again ("Screen -> …" under "Screen") just continues from it.
      into = null;
      if (prev && prev !== n) edges.push((into = { from: prev, to: n, kind: arrow.kind, label: arrow.label }));
      prev = n;
    });
    if (note && prev) { notes.push({ node: prev, note, edge: into }); if (!prev.lines.includes(lineNo)) prev.lines.push(lineNo); }
    stack.push({ indent, last: prev, group });
  }

  // A step's note is under its box — unless lines give it different notes
  // ("… -> Result : kept", "… -> Result : updated"): then each tells what its arrow
  // does, and goes on that arrow.
  for (const n of nodes.values()) {
    const mine = notes.filter((x) => x.node === n);
    if (new Set(mine.map((x) => x.note)).size < 2) { n.note = mine[0]?.note || ''; continue; }
    const kept = [];
    for (const x of mine) {
      if (x.edge) x.edge.label = x.edge.label ? `${x.edge.label}: ${x.note}` : x.note;
      else if (!kept.includes(x.note)) kept.push(x.note);
    }
    n.note = kept.join(' / ');
  }

  if (!nodes.size) throw new Error('Nothing to draw yet — write steps like: Start -> Check -> End');
  // A later line wins.
  for (const c of colors) for (const name of colorNames(c.list, nodes.keys())) nodes.get(name).color = c.color;

  const label = (n) => `"${esc(n.text)}${n.note ? `<br>${esc(n.note)}` : ''}"`;
  const decl = (n) => {
    const l = label(n);
    const shaped = { decision: `{${l}}`, round: `(${l})`, circle: `((${l}))`, db: `[(${l})]` }[n.shape] || `[${l}]`;
    return `${n.id}${shaped}`;
  };
  const out = [`flowchart ${direction}`];
  const emit = (group, pad) => {
    for (const n of nodes.values()) if (n.group === group) out.push(`${pad}${decl(n)}`);
    for (const g of groups) {
      if (g.parent !== group) continue;
      out.push(`${pad}subgraph ${g.id}[${quote(g.title)}]`);
      emit(g, `${pad}  `);
      out.push(`${pad}end`);
    }
  };
  emit(null, '  ');
  for (const e of edges) out.push(`  ${e.from.id} ${e.kind}${e.label ? `|${quote(e.label)}|` : ''} ${e.to.id}`);
  // Colours first, so a problem's red outline wins.
  for (const [color, [fill, stroke]] of Object.entries(COLORS)) {
    const ids = [...nodes.values()].filter((n) => n.color === color).map((n) => n.id);
    if (ids.length) out.push(`  classDef c-${color} fill:${fill},stroke:${stroke},color:#1c2024`, `  class ${ids.join(',')} c-${color}`);
  }
  const flagged = [...nodes.values()].filter((n) => n.flag).map((n) => n.id);
  if (flagged.length) out.push('  classDef problem stroke:#e5484d,stroke-width:3px', `  class ${flagged.join(',')} problem`);
  return {
    mermaid: out.join('\n'),
    direction,
    nodes: [...nodes.values()].map(({ id, text, lines, spots, note, flag, shape, color }) => ({ id, text, lines, spots, note, flag, shape, color: color || null })),
    edges: edges.map((e) => ({ from: e.from.id, to: e.to.id, kind: e.kind, label: e.label })),
  };
}

// Text that can stand as a step: one line, no arrows, no " : " note, no
// trailing ":" (a group), no comment mark at the start.
export function isStepText(text) {
  const t = text.trim();
  return !!t && !/\n/.test(t) && !ARROW_RE.test(t) && !/\s:\s|:$/.test(t) && !/^(#|\/\/)/.test(t);
}

// Every ```flow block of a Markdown note: { line, source } (line of the
// opening fence, 0-based).
export function flowBlocks(md) {
  const out = [];
  const lines = String(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i]);
    if (!open) continue;
    let j = i + 1;
    while (j < lines.length && !(lines[j].trimStart().startsWith(open[1]) && !lines[j].trim().slice(open[1].length).trim())) j++;
    if (open[2].toLowerCase() === 'flow') out.push({ line: i, source: lines.slice(i + 1, j).join('\n') });
    i = j;
  }
  return out;
}

// The note with each ```flow block written as a ```mermaid block, for places
// that show Mermaid but don't know this notation (GitHub, GitLab, …).
// A block that can't be drawn stays as it is. { md, converted, failed }.
export function flowsAsMermaid(md) {
  const lines = String(md).split('\n');
  const out = [];
  let converted = 0;
  let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^( {0,3})(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i]);
    if (!open) { out.push(lines[i]); continue; }
    let j = i + 1;
    while (j < lines.length && !(lines[j].trimStart().startsWith(open[2]) && !lines[j].trim().slice(open[2].length).trim())) j++;
    const block = lines.slice(i, Math.min(j + 1, lines.length));
    if (open[3].toLowerCase() === 'flow') {
      try {
        const code = flowToMermaid(lines.slice(i + 1, j).join('\n'));
        out.push(`${open[1]}${open[2]}mermaid`, ...code.split('\n').map((l) => open[1] + l), `${open[1]}${open[2]}`);
        converted++;
        i = j;
        continue;
      } catch { failed++; }
    }
    out.push(...block);
    i = j;
  }
  return { md: out.join('\n'), converted, failed };
}

// Is the caret in a ```flow block, and is its line half written — ending in
// an arrow, a "-(" label, or " :" before a note? { partial } or null.
const PARTIAL = /(?:-|->|-->|→|--|\.\.?>?|<-?>?|-\([^()]*\)?-?|\s:)$/;
export function flowLineAt(md, at) {
  const v = String(md);
  const line = v.slice(0, at).split('\n').length - 1;
  const block = flowBlocks(v).find((b) => line > b.line && line <= b.line + b.source.split('\n').length);
  if (!block) return null;
  const from = v.lastIndexOf('\n', at - 1) + 1;
  const to = v.indexOf('\n', at);
  const text = v.slice(from, to < 0 ? v.length : to).trimEnd();
  return { partial: !!text.trim() && PARTIAL.test(text) };
}

// The steps written in a note's ```flow blocks, in order, each once.
export function flowStepNames(md) {
  const names = new Set();
  for (const b of flowBlocks(md)) {
    try { for (const n of parseFlow(b.source).nodes) names.add(n.text); } catch { /* nothing drawn yet */ }
  }
  return [...names];
}

// Names that differ only in case, spaces or dashes ("Auth server", "AuthServer")
// are probably one step written two ways — but they draw as two.
export const nameKey = (text) => text.toLowerCase().replace(/[\s\-_.·]+/g, '');
export function similarNames(names) {
  const byKey = new Map();
  for (const n of new Set(names)) {
    const k = nameKey(n);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(n);
  }
  const out = new Map(); // name -> the other ways it is written
  for (const list of byKey.values()) if (list.length > 1) for (const n of list) out.set(n, list.filter((x) => x !== n));
  return out;
}

// The order to present a flow in: from each start (a step nothing leads
// to), along the arrows depth first in the order they were written — so a
// question's first answer is followed to its end before the next one.
// Steps: { id, from, label } — the step and the arrow it was reached by.
// Besides each step once, the tour says where it turns:
// - { id, back: true, label } before another way out of a step with several:
//   back at that step, next along the arrow `label`;
// - { id, from, label, join: 'join' | 'loop' } for an arrow to a step shown
//   already: joining another way, or back to one on the way here.
// `prefer` = { stepId: [ids] } takes those arrows out of a step first (a
// branch picked while presenting).
export function flowTour({ nodes, edges }, prefer = {}) {
  const into = new Set(edges.map((e) => e.to));
  const outOf = (id) => {
    const out = edges.filter((e) => e.from === id);
    const order = prefer[id] || [];
    const rank = (e) => (order.includes(e.to) ? order.indexOf(e.to) : order.length);
    return out.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
  };
  const seen = new Set();
  const onWay = new Set();
  const tour = [];
  const visit = (id, from, label) => {
    seen.add(id);
    onWay.add(id);
    tour.push({ id, from, label });
    outOf(id).forEach((e, k) => {
      if (k > 0) tour.push({ id, back: true, label: e.label });
      if (seen.has(e.to)) tour.push({ id: e.to, from: id, label: e.label, join: onWay.has(e.to) ? 'loop' : 'join' });
      else visit(e.to, id, e.label);
    });
    onWay.delete(id);
  };
  for (const n of nodes) if (!into.has(n.id) && !seen.has(n.id)) visit(n.id, null, '');
  for (const n of nodes) if (!seen.has(n.id)) visit(n.id, null, ''); // loops with no start
  return tour;
}
