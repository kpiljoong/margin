// ```ink blocks: marks drawn on the picture right above them, written as
// lines a person (or an agent) can read and write. Coordinates are the
// picture's own pixels, from its top left.
//
//   ![Login](assets/login.png)
//
//   ```ink
//   box red: 280,120 200x80
//   arrow red: 410,220 -> 300,160
//   arrow blue: 100,300 -> 180,240 -> 300,260
//   text red: 420,230 The button is hidden
//   pen blue: 100,100 120,104 140,112
//   num red: 300,110 1
//   hide: 40,20 300x30
//   ```
//
// - pen: a line through the points · arrow: from → to, any bends between
//   (drawn round) · box: corner and
//   size · text: where it starts, then the words · num: a numbered dot, its
//   centre and number — item 1 of the numbered list in the picture's section
//   says what it is (linkCallouts) · hide: a part covered, corner and size
//   (gray unless a colour is given); covered on screen, in a copy, and in the
//   copy an agent gets (server.js masks the pictures it shares).
// - The colour is optional (red, the pen's), any of the flow colours.
// - Other apps show the picture and the lines as code; Margin draws them on
//   the picture. `#` or `//` starts a comment. Plain logic, tested without a
//   page (test/ink.test.mjs), but for inkSvg.

import { COLORS, colorKey } from './flow.js';

// Also in Korean: pen, arrow, box, text, number, hide.
const KINDS = { pen: 'pen', arrow: 'arrow', box: 'box', text: 'text', num: 'num', number: 'num', hide: 'hide', blur: 'hide', '\uAC00\uB9AC\uAE30': 'hide', '\uD39C': 'pen', '\uD654\uC0B4\uD45C': 'arrow', '\uC0C1\uC790': 'box', '\uAE00': 'text', '\uBC88\uD638': 'num' };
const LINE = /^(\S+?)(?:\s+([^\s:]+))?\s*:\s*(.*)$/;
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const POINT = new RegExp(`^${NUM},${NUM}$`);
const BOX = new RegExp(`^${NUM},${NUM}\\s+${NUM}\\s*[x×]\\s*${NUM}$`);
const TEXT = new RegExp(`^${NUM},${NUM}\\s+(.+)$`);
const LABEL = new RegExp(`^${NUM},${NUM}\\s+([\\p{L}\\p{N}]{1,3})$`, 'u');

export const INK_COLORS = Object.keys(COLORS);

// The marks: [{ kind, color, line, … }] (pts: [[x, y]] for a pen; from, to
// for an arrow; x, y, w, h for a box; x, y, text for text), and the lines
// that aren't marks (0-based).
export function parseInk(src) {
  const marks = [];
  const bad = [];
  String(src).replace(/\r\n?/g, '\n').split('\n').forEach((raw, line) => {
    const body = raw.trim();
    if (!body || body.startsWith('#') || body.startsWith('//')) return;
    const m = LINE.exec(body);
    const kind = m && KINDS[m[1].toLowerCase()];
    const color = m && (m[2] ? colorKey(m[2]) : kind === 'hide' ? 'gray' : 'red');
    if (!kind || !color) { bad.push(line); return; }
    const rest = m[3].trim();
    const n = (v) => Number(v);
    let mark = null;
    if (kind === 'pen') {
      const pts = rest.split(/\s+/).map((p) => POINT.exec(p)).filter(Boolean).map((p) => [n(p[1]), n(p[2])]);
      if (pts.length >= 2 && pts.length === rest.split(/\s+/).length) mark = { pts };
    } else if (kind === 'arrow') {
      const ps = rest.split(/\s*(?:->|→)\s*/).map((p) => POINT.exec(p));
      if (ps.length >= 2 && ps.every(Boolean)) {
        const at = ps.map((p) => [n(p[1]), n(p[2])]);
        mark = { from: at[0], to: at[at.length - 1], via: at.slice(1, -1) };
      }
    } else if (kind === 'box' || kind === 'hide') {
      const b = BOX.exec(rest);
      if (b) mark = { x: n(b[1]), y: n(b[2]), w: n(b[3]), h: n(b[4]) };
    } else if (kind === 'num') {
      const t = LABEL.exec(rest);
      if (t) mark = { x: n(t[1]), y: n(t[2]), text: t[3] };
    } else {
      const t = TEXT.exec(rest);
      if (t) mark = { x: n(t[1]), y: n(t[2]), text: t[3].trim() };
    }
    if (mark) marks.push({ kind, color, line, ...mark });
    else bad.push(line);
  });
  return { marks, bad };
}

const r = (v) => Math.round(v);
const pt = ([x, y]) => `${r(x)},${r(y)}`;

// A mark as its line.
export function inkLine(mark) {
  const head = `${mark.kind} ${mark.color || 'red'}: `;
  if (mark.kind === 'pen') return head + mark.pts.map(pt).join(' ');
  if (mark.kind === 'arrow') return head + [mark.from, ...(mark.via || []), mark.to].map(pt).join(' -> ');
  if (mark.kind === 'box' || mark.kind === 'hide') return `${head}${pt([mark.x, mark.y])} ${r(mark.w)}x${r(mark.h)}`;
  return `${head}${pt([mark.x, mark.y])} ${String(mark.text).replace(/\s+/g, ' ').trim()}`;
}

// A drawn line, fewer points (Ramer–Douglas–Peucker, within eps).
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len : Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (d > far) { far = d; at = i; }
  }
  if (far <= eps) return [a, b];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

// A line through the points with its corners rounded (radius at most r,
// and at most half of either side, so a line drawn bending reads as a
// curve). → the SVG path.
export function bentPath(pts, r) {
  const f = (v) => Math.round(v * 10) / 10;
  const p = (q) => `${f(q[0])},${f(q[1])}`;
  let d = `M${p(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, c, b] = [pts[i - 1], pts[i], pts[i + 1]];
    const la = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const k = Math.min(r, la / 2, lb / 2);
    if (!la || !lb || !k) { d += ` L${p(c)}`; continue; }
    d += ` L${p([c[0] + (a[0] - c[0]) * k / la, c[1] + (a[1] - c[1]) * k / la])} Q${p(c)} ${p([c[0] + (b[0] - c[0]) * k / lb, c[1] + (b[1] - c[1]) * k / lb])}`;
  }
  return `${d} L${p(pts[pts.length - 1])}`;
}

// ---- changing a mark (the canvas: inkdraw.js)

// A mark moved by dx, dy.
export function movedMark(m, dx, dy) {
  const p = ([x, y]) => [x + dx, y + dy];
  if (m.kind === 'pen') return { ...m, pts: m.pts.map(p) };
  if (m.kind === 'arrow') return { ...m, from: p(m.from), to: p(m.to), via: (m.via || []).map(p) };
  return { ...m, x: m.x + dx, y: m.y + dy };
}

// The points that reshape a mark: a box's (or hidden part's) corners
// clockwise from the top left, an arrow's ends and bends; none for the rest.
export function grips(m) {
  if (m.kind === 'box' || m.kind === 'hide') return [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]];
  if (m.kind === 'arrow') return [m.from, ...(m.via || []), m.to];
  return [];
}

// The mark with grip i dragged to p: a box's opposite corner stays; an
// arrow's point moves, and a bend dragged (nearly) straight, within
// `straight`, goes. mid: a new bend in the middle of side i.
export function reshapedMark(m, i, [x, y], { mid = false, straight = 0 } = {}) {
  if (m.kind === 'arrow') {
    const pts = grips(m);
    if (mid) pts.splice(i + 1, 0, [x, y]); else pts[i] = [x, y];
    const off = (a, p, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / l : Math.hypot(p[0] - a[0], p[1] - a[1]); };
    for (let k = pts.length - 2; k > 0; k--) if (off(pts[k - 1], pts[k], pts[k + 1]) <= straight) pts.splice(k, 1);
    return { ...m, from: pts[0], to: pts[pts.length - 1], via: pts.slice(1, -1) };
  }
  if (m.kind !== 'box' && m.kind !== 'hide') return m;
  const o = grips(m)[(i + 2) % 4];
  return { ...m, x: Math.min(o[0], x), y: Math.min(o[1], y), w: Math.abs(x - o[0]), h: Math.abs(y - o[1]) };
}

// The block with line n made `mark`, its kind and colour words as they were.
export function setMark(src, n, mark) {
  const ls = String(src).split('\n');
  const head = /^\s*[^:]*:/.exec(ls[n] ?? '')?.[0];
  const line = inkLine(mark);
  ls[n] = head ? `${head} ${line.slice(line.indexOf(':') + 1).trim()}` : line;
  return ls.join('\n');
}

// A line added after the marks; a line taken out.
export function addMark(src, line) {
  const body = String(src).replace(/\s+$/, '');
  return body ? `${body}\n${line}` : line;
}
export function removeMark(src, lineNo) {
  const ls = String(src).split('\n');
  ls.splice(lineNo, 1);
  return ls.join('\n');
}

// ---- drawing (needs a page)

const SVG = 'http://www.w3.org/2000/svg';
const stroke = (color) => (COLORS[color] || COLORS.red)[1];

// The marks as SVG over a picture of w × h pixels: <svg class="ink-marks">,
// each mark a <g class="ink-mark" data-line>.
export function inkSvg(marks, w, h) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ink-marks');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const sw = Math.max(2, Math.round(Math.max(w, h) / 320));
  const make = (tag, attrs) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  // What is hidden first, under the rest.
  for (const m of [...marks.filter((x) => x.kind === 'hide'), ...marks.filter((x) => x.kind !== 'hide')]) svg.append(markEl(m, sw, make));
  return svg;
}

export function markEl(m, sw, make) {
  const c = stroke(m.color);
  const g = make('g', { class: 'ink-mark', 'data-line': m.line ?? '' });
  const line = { fill: 'none', stroke: c, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (m.kind === 'pen') g.append(make('polyline', { ...line, points: m.pts.map(([x, y]) => `${x},${y}`).join(' ') }));
  else if (m.kind === 'box') g.append(make('rect', { ...line, x: m.x, y: m.y, width: Math.max(1, m.w), height: Math.max(1, m.h), rx: sw * 2 }));
  else if (m.kind === 'hide') {
    g.dataset.hide = '';
    g.append(make('rect', { x: m.x, y: m.y, width: Math.max(1, m.w), height: Math.max(1, m.h), fill: c, stroke: 'none' }));
  } else if (m.kind === 'num') {
    const rr = sw * 7;
    g.dataset.num = m.text;
    g.append(make('circle', { cx: m.x, cy: m.y, r: rr, fill: c, stroke: '#fff', 'stroke-width': sw }));
    const t = make('text', { x: m.x, y: m.y, fill: '#fff', 'font-size': rr * (m.text.length > 1 ? 1 : 1.25), 'font-weight': 700, 'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    t.textContent = m.text;
    g.append(t);
  } else if (m.kind === 'arrow') {
    const pts = [m.from, ...(m.via || []), m.to];
    const [x1, y1] = pts[pts.length - 2];
    const [x2, y2] = m.to;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = sw * 5;
    const wing = (s) => `${x2 - head * Math.cos(a + s)},${y2 - head * Math.sin(a + s)}`;
    g.append(make('path', { ...line, d: bentPath(pts, sw * 20) }));
    g.append(make('polyline', { ...line, points: `${wing(0.5)} ${x2},${y2} ${wing(-0.5)}` }));
  } else {
    const size = sw * 9;
    const t = make('text', { x: m.x, y: m.y + size, fill: c, 'font-size': size, 'font-weight': 600, 'font-family': 'system-ui, sans-serif', stroke: '#fff', 'stroke-width': sw, 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
    t.textContent = m.text;
    g.append(t);
  }
  // A wide clear line to point at (to erase it).
  if (m.kind !== 'text') {
    const hit = g.firstChild.cloneNode();
    hit.setAttribute('class', 'ink-hit');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', sw * 6);
    if (m.kind === 'num' || m.kind === 'hide') hit.setAttribute('fill', 'transparent');
    g.append(hit);
  }
  return g;
}

// A picture with marks: the paragraph holding only a picture and the ```ink
// block right after it, made one <figure class="ink-figure">: the picture,
// its marks over it. data-line: the picture's line; data-ink-line: the
// block's ('' when there is none); data-source: the block's text.
// all: every picture on a line of its own is one (to draw on, on the canvas).
// → a promise, once the marks are drawn.
export function pairInk(root, { all = false } = {}) {
  const drawn = [];
  for (const pre of [...root.querySelectorAll('pre[data-lang="ink" i]')]) {
    const p = pre.previousElementSibling;
    const img = soleImage(p);
    if (!img) continue; // no picture above: the lines stay as code
    const fig = inkFigure(img, p.dataset.line, pre.dataset.line, pre.dataset.source ?? pre.textContent, drawn);
    p.remove();
    pre.replaceWith(fig);
  }
  if (all) {
    for (const p of [...root.querySelectorAll('p')]) {
      const img = soleImage(p);
      if (img && !p.closest('.ink-figure')) p.replaceWith(inkFigure(img, p.dataset.line, '', '', drawn));
    }
  }
  return Promise.all(drawn);
}

// A paragraph holding only a picture, made a figure with the marks of
// `source` in its place. → { fig, drawn: a promise, once the marks are on },
// or null when it isn't such a paragraph.
export function inkOn(p, source) {
  const img = soleImage(p);
  if (!img) return null;
  const drawn = [];
  const fig = inkFigure(img, p.dataset.line, '', source, drawn);
  p.replaceWith(fig);
  return { fig, drawn: Promise.all(drawn) };
}

const soleImage = (p) => (p?.tagName === 'P' && p.children.length === 1 && p.firstElementChild.tagName === 'IMG' && !p.textContent.trim() ? p.firstElementChild : null);

function inkFigure(img, line, inkLine, source, drawn) {
  const fig = document.createElement('figure');
  fig.className = 'ink-figure';
  fig.dataset.line = line ?? '';
  fig.dataset.inkLine = inkLine ?? '';
  fig.dataset.source = source;
  img.removeAttribute('loading');
  img.draggable = false;
  // Copied with the marks on (the app's click handler for .diagram-copy).
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'diagram-copy';
  copy.title = 'Copy with its marks (PNG)';
  copy.textContent = '\u29C9';
  fig.append(img, copy);
  drawn.push(img.decode().then(() => drawInk(fig), () => {}));
  return fig;
}

// The marks of a figure, drawn again (from its data-source).
export function drawInk(fig) {
  const img = fig.querySelector(':scope > img');
  if (!img?.naturalWidth) return;
  fig.querySelector(':scope > .ink-marks')?.remove();
  fig.inkMarks = parseInk(fig.dataset.source).marks;
  fig.append(inkSvg(fig.inkMarks, img.naturalWidth, img.naturalHeight));
  linkCallouts(fig);
  fig.dispatchEvent(new Event('inkdrawn', { bubbles: true }));
}

// A figure's numbered dots and the items of the numbered lists in its
// section (from the heading above it to the next one) with the same
// number, made a pair: li.dataset.callout = the number and li.calloutFig =
// the figure; fig.callouts: number → li. Nothing to do on the canvas, where
// the text isn't shown.
export function linkCallouts(fig) {
  fig.callouts = new Map();
  const nums = (fig.inkMarks || []).filter((m) => m.kind === 'num').map((m) => m.text);
  const root = fig.closest('.md');
  if (!nums.length || !root) return;
  const at = Number(fig.dataset.line);
  let from = -1;
  let to = Infinity;
  for (const hd of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const l = Number(hd.dataset.line);
    if (Number.isNaN(l)) continue;
    if (l <= at) from = Math.max(from, l); else to = Math.min(to, l);
  }
  for (const ol of root.querySelectorAll('ol')) {
    const l = Number(ol.querySelector(':scope > li')?.dataset.line);
    if (!(l > from && l < to)) continue;
    [...ol.children].forEach((li, i) => {
      const n = String((Number(ol.getAttribute('start')) || 1) + i);
      if (!nums.includes(n) || fig.callouts.has(n)) return;
      li.dataset.callout = n;
      li.calloutFig = fig;
      fig.callouts.set(n, li);
    });
  }
}
