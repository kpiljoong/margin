// ```ink blocks: marks drawn on the picture right above them, written as
// lines a person (or an agent) can read and write. Coordinates are the
// picture's own pixels, from its top left.
//
//   ![Login](assets/login.png)
//
//   ```ink
//   box red: 280,120 200x80
//   arrow red: 410,220 -> 300,160
//   text red: 420,230 The button is hidden
//   pen blue: 100,100 120,104 140,112
//   ```
//
// - pen: a line through the points · arrow: from → to · box: corner and
//   size · text: where it starts, then the words.
// - The colour is optional (red, the pen's), any of the flow colours.
// - Other apps show the picture and the lines as code; Margin draws them on
//   the picture. `#` or `//` starts a comment. Plain logic, tested without a
//   page (test/ink.test.mjs), but for inkSvg.

import { COLORS, colorKey } from './flow.js';

// Also in Korean: pen, arrow, box, text.
const KINDS = { pen: 'pen', arrow: 'arrow', box: 'box', text: 'text', '\uD39C': 'pen', '\uD654\uC0B4\uD45C': 'arrow', '\uC0C1\uC790': 'box', '\uAE00': 'text' };
const LINE = /^(\S+?)(?:\s+([^\s:]+))?\s*:\s*(.*)$/;
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const POINT = new RegExp(`^${NUM},${NUM}$`);
const ARROW = new RegExp(`^${NUM},${NUM}\\s*(?:->|→)\\s*${NUM},${NUM}$`);
const BOX = new RegExp(`^${NUM},${NUM}\\s+${NUM}\\s*[x×]\\s*${NUM}$`);
const TEXT = new RegExp(`^${NUM},${NUM}\\s+(.+)$`);

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
    const color = m && (m[2] ? colorKey(m[2]) : 'red');
    if (!kind || !color) { bad.push(line); return; }
    const rest = m[3].trim();
    const n = (v) => Number(v);
    let mark = null;
    if (kind === 'pen') {
      const pts = rest.split(/\s+/).map((p) => POINT.exec(p)).filter(Boolean).map((p) => [n(p[1]), n(p[2])]);
      if (pts.length >= 2 && pts.length === rest.split(/\s+/).length) mark = { pts };
    } else if (kind === 'arrow') {
      const a = ARROW.exec(rest);
      if (a) mark = { from: [n(a[1]), n(a[2])], to: [n(a[3]), n(a[4])] };
    } else if (kind === 'box') {
      const b = BOX.exec(rest);
      if (b) mark = { x: n(b[1]), y: n(b[2]), w: n(b[3]), h: n(b[4]) };
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
  if (mark.kind === 'arrow') return `${head}${pt(mark.from)} -> ${pt(mark.to)}`;
  if (mark.kind === 'box') return `${head}${pt([mark.x, mark.y])} ${r(mark.w)}x${r(mark.h)}`;
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
  for (const m of marks) svg.append(markEl(m, sw, make));
  return svg;
}

export function markEl(m, sw, make) {
  const c = stroke(m.color);
  const g = make('g', { class: 'ink-mark', 'data-line': m.line ?? '' });
  const line = { fill: 'none', stroke: c, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (m.kind === 'pen') g.append(make('polyline', { ...line, points: m.pts.map(([x, y]) => `${x},${y}`).join(' ') }));
  else if (m.kind === 'box') g.append(make('rect', { ...line, x: m.x, y: m.y, width: Math.max(1, m.w), height: Math.max(1, m.h), rx: sw * 2 }));
  else if (m.kind === 'arrow') {
    const [x1, y1] = m.from;
    const [x2, y2] = m.to;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = sw * 5;
    const wing = (s) => `${x2 - head * Math.cos(a + s)},${y2 - head * Math.sin(a + s)}`;
    g.append(make('line', { ...line, x1, y1, x2, y2 }));
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

const soleImage = (p) => (p?.tagName === 'P' && p.children.length === 1 && p.firstElementChild.tagName === 'IMG' && !p.textContent.trim() ? p.firstElementChild : null);

function inkFigure(img, line, inkLine, source, drawn) {
  const fig = document.createElement('figure');
  fig.className = 'ink-figure';
  fig.dataset.line = line ?? '';
  fig.dataset.inkLine = inkLine ?? '';
  fig.dataset.source = source;
  img.removeAttribute('loading');
  img.draggable = false;
  fig.append(img);
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
}
