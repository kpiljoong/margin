// Red pen on pictures: a change to a ```flow or ```ink block shown as the
// picture with the proposal drawn on it — boxes and arrows coming in ringed
// in red, ones going crossed out; marks coming in drawn, ones going faded —
// rather than as struck lines of code. Each of those is one of the run's
// hunks (data-mark), taken or left like any other.
//
// pictureHunks() finds the blocks whose changes all lie inside them (and a
// hunk that only adds one whole block); penPlaces() gives redpen.penSource
// the note with each such block as one placeholder paragraph, where the
// page then puts the picture (showPicture). Plain logic, tested without a
// page (test/penpic.test.mjs), but for showPicture.

import { parseFlow } from './flow.js';
import { parseInk, inkOn } from './ink.js';

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const PICTURE = /^(flow|ink)$/i;
// The line of a picture on its own (an ```ink block's picture).
const IMAGE_LINE = /^\s*(!\[[^\]]*\]\([^)]*\)|!\[\[[^\]]+\]\])\s*$/;
export const PLACE = '\uF8F0';

const closes = (line, mark) => { const t = line.trim(); return t.startsWith(mark[0].repeat(mark.length)) && !t.replace(/[`~]/g, ''); };

// The fenced blocks of some lines: [{ lang, start, end }] (fence lines).
function blocksOf(lines) {
  const out = [];
  let open = null;
  lines.forEach((l, i) => {
    if (open) { if (closes(l, open.mark)) { out.push({ lang: open.lang, start: open.start, end: i }); open = null; } return; }
    const m = OPEN.exec(l);
    if (m) open = { mark: m[1], lang: m[2].toLowerCase(), start: i };
  });
  return out;
}

const imageAbove = (lines, at) => {
  let i = at - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  return i >= 0 && IMAGE_LINE.test(lines[i]);
};

// The pictures the hunks change: [{ lang, start, end, hunks: [i], fresh,
// base, proposed, union }] in note order. start/end: the fence lines (a
// fresh block: the hunk's base lines, end excluded). base, proposed and
// union are the block's lines ({ text, hunk, change: 'del' | 'add' | null }):
// before, after every one of its hunks, and both (what goes, then what
// comes, at each change).
export function pictureHunks(base, hunks) {
  const lines = base.split('\n');
  const out = [];
  const taken = new Set();
  for (const b of blocksOf(lines)) {
    if (!PICTURE.test(b.lang) || (b.lang === 'ink' && !imageAbove(lines, b.start))) continue;
    const mine = [];
    let inside = true;
    hunks.forEach((hk, i) => {
      const touches = hk.baseStart === hk.baseEnd ? hk.baseStart > b.start && hk.baseStart <= b.end : hk.baseStart <= b.end && hk.baseEnd > b.start;
      if (!touches) return;
      mine.push(i);
      if (!(hk.baseStart > b.start && hk.baseEnd <= b.end)) inside = false;
    });
    if (!mine.length || !inside) continue;
    mine.forEach((i) => taken.add(i));
    out.push({ lang: b.lang, start: b.start, end: b.end, hunks: mine, fresh: false, ...versions(lines.slice(b.start + 1, b.end), b.start + 1, mine.map((i) => [i, hunks[i]])) });
  }
  // A hunk that only adds a whole block (and blank lines).
  hunks.forEach((hk, i) => {
    if (taken.has(i) || hk.removed.some((l) => l.trim())) return;
    const A = hk.added;
    const first = A.findIndex((l) => l.trim());
    let last = A.length - 1;
    while (last > first && !A[last].trim()) last--;
    const m = first >= 0 && OPEN.exec(A[first]);
    if (!m || !PICTURE.test(m[2]) || last <= first || !closes(A[last], m[1])) return;
    if (A.slice(first + 1, last).some((l) => closes(l, m[1]))) return;
    const lang = m[2].toLowerCase();
    if (lang === 'ink' && !imageAbove(lines, hk.baseStart)) return;
    const added = A.slice(first + 1, last).map((text) => ({ text, hunk: i, change: 'add' }));
    out.push({ lang, start: hk.baseStart, end: hk.baseEnd, hunks: [i], fresh: true, base: [], proposed: added, union: added });
  });
  return out.sort((a, b) => a.start - b.start);
}

// A block's lines before, after and both, its hunks [[i, hunk]] in base
// line numbers (the block's first line is `offset`).
function versions(block, offset, hunks) {
  const base = block.map((text) => ({ text, hunk: null, change: null }));
  const proposed = [];
  const union = [];
  let pos = 0;
  for (const [i, hk] of hunks) {
    const from = hk.baseStart - offset;
    for (; pos < from; pos++) { proposed.push(base[pos]); union.push(base[pos]); }
    for (; pos < hk.baseEnd - offset; pos++) { base[pos] = { ...base[pos], hunk: i, change: 'del' }; union.push(base[pos]); }
    for (const text of hk.added) { const l = { text, hunk: i, change: 'add' }; proposed.push(l); union.push(l); }
  }
  for (; pos < base.length; pos++) { proposed.push(base[pos]); union.push(base[pos]); }
  return { base, proposed, union };
}

// The note for penSource: each picture one placeholder paragraph (PLACE,
// its number, PLACE), its hunks there with no lines (picture: its number),
// the other hunks moved along. back: a line of the new note → of the note.
export function penPlaces(base, hunks, pics) {
  const lines = base.split('\n');
  const out = [];
  const back = [];
  const to = new Array(lines.length + 1);
  const at = new Map(); // hunk → its picture's number
  let pos = 0;
  pics.forEach((p, k) => {
    for (; pos < p.start; pos++) { to[pos] = out.length; back.push(pos); out.push(lines[pos]); }
    const place = out.length + 1;
    for (const l of ['', `${PLACE}${k}${PLACE}`, '']) { back.push(p.start); out.push(l); }
    const end = p.fresh ? p.end : p.end + 1;
    for (; pos < end; pos++) to[pos] = place;
    for (const i of p.hunks) at.set(i, { k, place });
  });
  for (; pos <= lines.length; pos++) { to[pos] = out.length; if (pos < lines.length) { back.push(pos); out.push(lines[pos]); } }
  const moved = hunks.map((hk, i) => {
    const p = at.get(i);
    if (p) return { ...hk, baseStart: p.place, baseEnd: p.place, picture: p.k };
    const s = to[hk.baseStart];
    return { ...hk, baseStart: s, baseEnd: s + (hk.baseEnd - hk.baseStart) };
  });
  return { base: out.join('\n'), hunks: moved, back };
}

const flowOf = (ls) => { try { return parseFlow(ls.map((l) => l.text).join('\n')); } catch { return { nodes: [], edges: [] }; } };

// A flow picture's changes, on the picture of both (union): boxes and
// arrows that come or go, each with its hunk. → { source, nodes: [{ id,
// text, change, hunk }], edges: [{ from, to, k, change, hunk, name }] }
// (ids of the union's boxes; k: the how-manieth arrow between the two).
export function flowChanges(pic) {
  const [was, now, all] = [flowOf(pic.base), flowOf(pic.proposed), flowOf(pic.union)];
  const text = (f, id) => f.nodes.find((n) => n.id === id)?.text;
  const key = (f, e) => [text(f, e.from), text(f, e.to), e.kind, e.label].join('\n');
  const hunkOf = (f, ls, n) => (n.lines || [n.line]).map((l) => ls[l]?.hunk).find((x) => x != null) ?? pic.hunks[0];
  const wasN = new Map(was.nodes.map((n) => [n.text, n]));
  const nowN = new Map(now.nodes.map((n) => [n.text, n]));
  const wasE = new Map(was.edges.map((e) => [key(was, e), e]));
  const nowE = new Map(now.edges.map((e) => [key(now, e), e]));
  const nodes = [];
  for (const n of all.nodes) {
    if (!wasN.has(n.text)) nodes.push({ id: n.id, text: n.text, change: 'add', hunk: hunkOf(now, pic.proposed, nowN.get(n.text)) });
    else if (!nowN.has(n.text)) nodes.push({ id: n.id, text: n.text, change: 'del', hunk: hunkOf(was, pic.base, wasN.get(n.text)) });
  }
  const edges = [];
  const seen = new Map();
  for (const e of all.edges) {
    const pair = `${e.from}>${e.to}`;
    const k = seen.get(pair) || 0;
    seen.set(pair, k + 1);
    const kk = key(all, e);
    const name = `${text(all, e.from)} → ${text(all, e.to)}`;
    if (!wasE.has(kk)) edges.push({ from: e.from, to: e.to, k, change: 'add', hunk: hunkOf(now, pic.proposed, nowE.get(kk)), name });
    else if (!nowE.has(kk)) edges.push({ from: e.from, to: e.to, k, change: 'del', hunk: hunkOf(was, pic.base, wasE.get(kk)), name });
  }
  return { source: pic.union.map((l) => l.text).join('\n'), nodes, edges };
}

// What a hunk does to a picture, in a few words: `+ Retry, Notify · − Fax ·
// arrows +2 −1`, or for marks `+ box, arrow, “words” · − pen`.
export function pictureSummary(pic, hunk) {
  const list = (xs) => xs.join(', ');
  const parts = [];
  if (pic.lang === 'flow') {
    const c = flowChanges(pic);
    const mine = (xs, change) => xs.filter((x) => x.hunk === hunk && x.change === change);
    const [na, nd, ea, ed] = [mine(c.nodes, 'add'), mine(c.nodes, 'del'), mine(c.edges, 'add'), mine(c.edges, 'del')];
    if (na.length) parts.push(`+ ${list(na.map((n) => n.text))}`);
    if (nd.length) parts.push(`− ${list(nd.map((n) => n.text))}`);
    if (ea.length || ed.length) parts.push(`arrows ${[ea.length ? `+${ea.length}` : '', ed.length ? `−${ed.length}` : ''].filter(Boolean).join(' ')}`);
    return parts.join(' · ') || 'the picture’s text';
  }
  const marks = parseInk(pic.union.map((l) => l.text).join('\n')).marks;
  const word = (m) => (m.kind === 'text' ? `“${m.text.length > 24 ? `${m.text.slice(0, 23)}…` : m.text}”` : m.kind);
  for (const change of ['add', 'del']) {
    const xs = marks.filter((m) => pic.union[m.line].hunk === hunk && pic.union[m.line].change === change);
    if (xs.length) parts.push(`${change === 'add' ? '+' : '−'} ${list(xs.map(word))}`);
  }
  return parts.join(' · ') || 'the marks’ text';
}

// ---- drawing (needs a page)

const SVG = 'http://www.w3.org/2000/svg';
const make = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

// The picture in place of its placeholder paragraph `p`. state(key) → 'y' |
// 'n' | 'open' for a hunk's mark key (h3); render(container) draws the
// diagrams in it; drawn() once the marks are on (to lay the margin out).
export function showPicture(p, pic, { state, render, drawn }) {
  const tag = (g, change, hunk) => {
    const key = `h${hunk}`;
    g.dataset.mark = key;
    g.classList.add(`pen-pic-${change}`, `pen-${state(key)}`);
  };
  if (pic.lang === 'ink') {
    const above = p.previousElementSibling; // the picture's paragraph
    p.remove();
    const made = above && inkOn(above, pic.union.map((l) => l.text).join('\n'));
    if (!made) return;
    made.fig.classList.add('pen-pic');
    made.drawn.then(() => {
      for (const g of made.fig.querySelectorAll('.ink-mark')) {
        const l = pic.union[Number(g.dataset.line)];
        if (l?.change) tag(g, l.change, l.hunk);
      }
      drawn?.();
    });
    return;
  }
  const c = flowChanges(pic);
  const pre = document.createElement('pre');
  pre.dataset.lang = 'flow';
  pre.dataset.source = c.source;
  pre.textContent = c.source;
  const box = document.createElement('div');
  box.className = 'pen-pic';
  box.append(pre);
  p.replaceWith(box);
  pre.addEventListener('diagram-shown', () => {
    const img = pre.querySelector(':scope > img');
    if (!img) return;
    const frame = document.createElement('span');
    frame.className = 'pen-pic-frame';
    img.replaceWith(frame);
    const svg = make('svg', { class: 'pen-overlay', viewBox: '0 0 1 1', preserveAspectRatio: 'none' });
    frame.append(img, svg);
    const at = new Map((pre.diagramNodes || []).map((n) => [n.id, n]));
    const pad = 0.006;
    for (const n of c.nodes) {
      const b = at.get(n.id);
      if (!b) continue;
      const g = make('g');
      const r = { x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2 };
      g.append(make('rect', { class: 'pen-veil', ...r }), make('rect', { class: 'pen-ring', ...r }));
      if (n.change === 'del') g.append(make('path', { class: 'pen-cross', d: `M${r.x},${r.y}L${r.x + r.width},${r.y + r.height}M${r.x + r.width},${r.y}L${r.x},${r.y + r.height}` }));
      g.append(make('rect', { class: 'pen-hit', ...r }));
      tag(g, n.change, n.hunk);
      svg.append(g);
    }
    const lines = pre.diagramEdges || [];
    for (const e of c.edges) {
      const same = lines.filter((x) => x.from === e.from && x.to === e.to);
      const line = same.find((x) => x.k === e.k) || same[Math.min(e.k, same.length - 1)];
      if (!line?.pts?.length) continue;
      const points = line.pts.map(([x, y]) => `${x},${y}`).join(' ');
      const g = make('g');
      g.append(make('polyline', { class: 'pen-veil', points }), make('polyline', { class: 'pen-ring', points }));
      if (e.change === 'del') {
        const [x, y] = line.pts[Math.floor(line.pts.length / 2)];
        const d = 0.012;
        g.append(make('path', { class: 'pen-cross', d: `M${x - d},${y - d}L${x + d},${y + d}M${x + d},${y - d}L${x - d},${y + d}` }));
      }
      g.append(make('polyline', { class: 'pen-hit', points }));
      tag(g, e.change, e.hunk);
      svg.append(g);
    }
    drawn?.();
  });
  render(box);
}
