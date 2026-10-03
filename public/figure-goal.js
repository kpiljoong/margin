// What the editor cursor points at among a note's pictures, for the canvas
// (public/canvas.js). Plain logic over the note's text, so it can be tested
// without a page (test/figure-goal.test.mjs).
//
// A section is { line, figures } — `line` is where its heading is (0 for the
// top of the note) and `figures` its pictures in order. info(figure) tells
// about a picture: { line, source, flowNodes, diagramNodes } — the line of
// its opening fence (or of the embed), the block's text (null for an embed),
// and its boxes: from parseFlow for ```flow, { id } for other diagrams;
// inkMarks: a picture's ```ink marks (parseInk), when it has them.

// Does a line of text name this box? As a whole word — though a Korean word
// may go on with a particle (as in "screen-to"), so only a name ending in a Latin
// letter or digit must end there.
export function mentionRe(name, flags = 'iu') {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}${/[A-Za-z0-9]$/.test(name) ? '(?![\\p{L}\\p{N}])' : ''}`, flags);
}
export const mentions = (line, name) => name.length >= 2 && mentionRe(name).test(line);

// Where the note's text (not its code blocks or front matter) names a box:
// [[start, end]] offsets.
export function mentionRanges(v, name) {
  if (name.length < 2) return [];
  const re = mentionRe(name, 'giu');
  const out = [];
  let fence = null;
  let front = v.startsWith('---\n');
  let o = 0;
  v.split('\n').forEach((line, i) => {
    const t = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (front) { if (i > 0 && t === '---') front = false; }
    else if (fence) { if (f && t.startsWith(fence)) fence = null; }
    else if (f) fence = f[1];
    else for (const m of line.matchAll(re)) out.push([o + m.index, o + m.index + m[0].length]);
    o += line.length + 1;
  });
  return out;
}

const lineAt = (v, at) => v.slice(0, at).split('\n').length - 1;

// The picture the cursor is on, and maybe some of its boxes:
// { section, fig, nodes: [{ pre: fig, id }] }, or null.
// - In a diagram block: that picture, and the boxes its line writes.
// - On its fences: that picture.
// - On a numbered list item: the picture with that number's dot (an ink
//   `num` mark), and in `marks` the dot's line in its block.
// - On a line of text: the picture holding the ```flow boxes it names,
//   otherwise the section's next picture (or its last one).
// - A section without pictures (an intro above its subsections) looks at
//   the next section that has some, or else the one before.
export function goalAt(sections, v, at, info) {
  if (!sections?.length) return null;
  const cur = lineAt(v, at);
  let here = 0;
  sections.forEach((s, i) => { if (s.line <= cur) here = i; });
  const section = sections.slice(here).find((s) => s.figures.length) || sections.slice(0, here).reverse().find((s) => s.figures.length);
  if (!section) return null;
  const from = v.lastIndexOf('\n', at - 1) + 1;
  const to = v.indexOf('\n', at);
  const text = v.slice(from, to < 0 ? v.length : to);
  const nodes = [];
  for (const fig of section.figures) {
    const f = info(fig);
    if (f.source == null) continue;
    const lines = f.source.replace(/\n$/, '').split('\n').length;
    if (cur < f.line || cur > f.line + lines + 1) continue; // the fences count too
    const i = cur - f.line - 1;
    if (i < 0 || i >= lines) return { section, fig, nodes };
    if (f.flowNodes) { for (const n of f.flowNodes) if (n.lines.includes(i)) nodes.push({ pre: fig, id: n.id }); }
    else {
      const words = new Set(text.match(/[\p{L}\p{N}_]+/gu) || []);
      for (const n of f.diagramNodes || []) if (words.has(n.id)) nodes.push({ pre: fig, id: n.id });
    }
    return { section, fig, nodes };
  }
  if (/^\s*\d{1,9}[.)]\s/.test(text)) {
    const item = numberedItems(v, sections[here].line, sections[here + 1]?.line ?? Infinity).find((x) => x.line === cur);
    for (const fig of item ? section.figures : []) {
      const m = (info(fig).inkMarks || []).find((k) => k.kind === 'num' && k.text === item.n);
      if (m) return { section, fig, nodes: [], marks: [m.line] };
    }
  }
  for (const fig of section.figures) for (const n of info(fig).flowNodes || []) if (mentions(text, n.text)) nodes.push({ pre: fig, id: n.id });
  const fig = nodes[0]?.pre || section.figures.find((f) => info(f).line > cur) || section.figures[section.figures.length - 1];
  return { section, fig, nodes: nodes.filter((n) => n.pre === fig) };
}

// The ```flow box the cursor is on, for following the flow: the one whose
// text the caret is in, else the first on its line, else one the line
// names, else the picture's first. { pre, id } or null.
export function boxAt(goal, v, at, info) {
  const fig = goal?.fig;
  const f = fig && info(fig);
  if (!f?.flowNodes?.length) return null;
  const i = lineAt(v, at) - f.line - 1;
  const col = at - (v.lastIndexOf('\n', at - 1) + 1);
  const onLine = f.flowNodes.flatMap((n) => n.spots.filter((sp) => sp.line === i).map((sp) => ({ n, sp }))).sort((a, b) => a.sp.start - b.sp.start);
  const n = (onLine.find(({ sp }) => sp.start <= col && col <= sp.end) || onLine[0])?.n;
  return { pre: fig, id: n?.id || goal.nodes[0]?.id || f.flowNodes[0].id };
}

// What the note says a box is, for its caption when presenting: list items
// between lines `from` and `to` (`to` excluded) that start with its name and
// a colon — `- PR: a change asked for` — and the lines indented under them.
// Written on purpose, unlike a sentence that only happens to name the box.
// The name is compared without case, spaces or a closing ? or ! ("Review?" is
// "Review"). Returns the lines to show, markup taken out.
export function definitionLines(v, name, from, to) {
  const key = defKey(name);
  if (!key) return [];
  const lines = v.split('\n');
  const out = [];
  let fence = null;
  let front = v.startsWith('---\n');
  let under = -1; // the indent of the item being read, or -1
  for (let i = 0; i < lines.length && i < to; i++) {
    const line = lines[i];
    const t = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (front) { if (i > 0 && t === '---') front = false; continue; }
    if (fence) { if (f && t.startsWith(fence)) fence = null; continue; }
    if (f) { fence = f[1]; under = -1; continue; }
    if (i < from) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (under >= 0 && t && indent > under) { out.push(plain(t.replace(/^([-*+]|\d+[.)])\s+/, '· '))); continue; }
    under = -1;
    const m = /^([-*+]|\d+[.)])\s+(?:\*\*|__)?([^:]+?)(?:\*\*|__)?\s*:\s*(.*)$/.exec(t);
    if (m && defKey(m[2]) === key) {
      under = indent;
      if (m[3].trim()) out.push(plain(m[3].trim()));
    }
  }
  return out;
}

// A frame's caption when presenting: the first lines of text of a section,
// lines `from` to `to` (`to` excluded) — not its heading, blocks, pictures
// or tables — markup taken out, at most `max`.
export function leadLines(v, from, to, max = 4) {
  const lines = v.split('\n');
  const out = [];
  let fence = null;
  let front = v.startsWith('---\n');
  for (let i = 0; i < lines.length && i < to && out.length < max; i++) {
    const t = lines[i].trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (front) { if (i > 0 && t === '---') front = false; continue; }
    if (fence) { if (f && t.startsWith(fence)) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (i < from || !t || /^(#{1,6}\s|\||!\[|<)/.test(t)) continue;
    const text = plain(t.replace(/^>\s*(\[![^\]]*\]\s*)?/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '· ').replace(/[*_]{1,2}(\S[^*_]*?)[*_]{1,2}/g, '$1'));
    if (text.trim()) out.push(text.length > 160 ? `${text.slice(0, 159)}…` : text);
  }
  return out;
}

// The items of numbered lists between lines `from` and `to` (`to`
// excluded), numbered as they read — from the first item's number on, as
// Markdown does — for the numbered dots on pictures (an ink `num` mark is
// item n): [{ n: '2', line, text }], markup taken out.
export function numberedItems(v, from, to) {
  const lines = v.split('\n');
  const out = [];
  const next = new Map(); // a list's indent → its next number
  let fence = null;
  let front = v.startsWith('---\n');
  for (let i = 0; i < lines.length && i < to; i++) {
    const line = lines[i];
    const t = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (front) { if (i > 0 && t === '---') front = false; continue; }
    if (fence) { if (f && t.startsWith(fence)) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (!t) continue;
    const indent = line.match(/^\s*/)[0].length;
    const m = /^(\d{1,9})[.)]\s+(.*)$/.exec(t);
    // A line less indented than a list's items ends it, and other text as
    // indented too.
    for (const k of [...next.keys()]) if (k > indent || (k === indent && !m)) next.delete(k);
    if (!m) continue;
    const n = next.get(indent) ?? Number(m[1]);
    next.set(indent, n + 1);
    if (i >= from) out.push({ n: String(n), line: i, text: plain(m[2]).trim() });
  }
  return out;
}

const defKey = (name) => name.toLowerCase().replace(/[?!]+\s*$/, '').replace(/[\s\-_.·]+/g, '');
// Inline markup out: **bold**, `code`, [[link]], [text](url).
const plain = (s) => s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '');
