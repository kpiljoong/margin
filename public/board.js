// A board (working name): a quick drawing for a meeting or an explanation —
// boxes put down at once, words typed in them, joined by arrows that follow
// them. Kept as a JSON Canvas (*.board.canvas), as Obsidian writes them, so
// Obsidian opens it too; what Obsidian has no word for (a box's shape, its
// words' alignment, a dashed arrow) is kept in fields of its own, which it
// leaves alone.
//
//   Double-click the plane: a box, written in at once.
//   A selected box takes what is typed (its words go on at the end); Enter
//   or a double-click writes in it too.
//   A box's dots: drag to another box to join them, to the plane for a new
//   box joined to it; a click on a dot puts the next box that way.
//   Tab (writing or not): the next box, joined, to the right; ⇧Tab one under
//   it, from the same box. ⌘ (or ⌥) and an arrow: the next box that way.
//   Arrows go from box to box; ⇧ and an arrow moves the boxes.
//   ⌥R ⌥O ⌥D ⌥S ⌥T a shape, ⌥1–6 a colour (⌥0 none) — without ⌥ too when
//   no single box is selected. On an arrow: A its heads, L dashed, Enter its words.
//   ⌘G: a group around the selected boxes; ⌘⇧G: the group let go.
//   ▶ (⌥P): presented, from the selected box along the arrows.
//   ⌥⇧D: a box's words drawn as a diagram beside it (board-text.js: a line a
//   box, - -- for the ones under it, A -> B); pasted words like that: drawn.

import { textToDiagram, layoutDiagram } from './board-text.js';
export const EMPTY_BOARD = '{\n\t"nodes":[],\n\t"edges":[]\n}\n';

const SHAPES = [
  ['rect', 'Box', 'R', '▭'],
  ['ellipse', 'Ellipse', 'O', '◯'],
  ['diamond', 'Diamond', 'D', '◇'],
  ['sticky', 'Sticky note', 'S', '▤'],
  ['text', 'Words alone', 'T', 'T'],
];
const SHAPE_KEYS = Object.fromEntries(SHAPES.map(([id, , k]) => [k.toLowerCase(), id]));
const SHAPE_CODES = Object.fromEntries(SHAPES.map(([id, , k]) => [`Key${k}`, id]));
// JSON Canvas's six colours, as Obsidian shows them.
const COLORS = { 1: '#e5484d', 2: '#f08c2b', 3: '#d9a400', 4: '#2f9e5c', 5: '#1597b8', 6: '#8e5bd0' };
const STICKY = '#d9a400';
const SIZE = { rect: [170, 70], ellipse: [170, 80], diamond: [190, 100], sticky: [180, 140], text: [170, 40] };
const GAP = 80;
const SNAP = 6; // px on screen
const SIDES = ['top', 'right', 'bottom', 'left'];
const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const DIRS = { ArrowUp: 'top', ArrowRight: 'right', ArrowDown: 'bottom', ArrowLeft: 'left' };
const CLIP = 'application/x-margin-board';
// Words in a box: in the middle; alone or on a sticky note, from the left
// (as written). A box's own (align) when it says otherwise.
const ALIGNS = ['left', 'center', 'right'];
const alignDefault = (n) => (n.shape === 'text' || n.shape === 'sticky' ? 'left' : 'center');
const alignOf = (n) => (ALIGNS.includes(n.align) ? n.align : alignDefault(n));
// The words' room in a box (as the CSS has it): across, and from the top.
const PAD_X = { rect: 12, ellipse: 22, diamond: 34, sticky: 12, text: 12, group: 10 };
const FONT = 15;
const LINE = FONT * 1.35;

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const el = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids); return e; };
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
const round = (v) => Math.round(v);
const colorOf = (c) => (c == null || c === '' ? null : COLORS[c] || (/^#[0-9a-f]{3,8}$/i.test(c) ? c : null));
const shapeOf = (n) => (n.type === 'group' ? 'group' : n.type === 'text' ? (n.shape || 'rect') : 'rect');
const wordsOf = (n) => (n.type === 'text' ? n.text || '' : n.type === 'group' ? n.label || '' : n.type === 'file' ? (IMAGE.test(n.file || '') ? '' : `\u{1F4C4} ${String(n.file || '').split('/').pop()}`) : n.type === 'link' ? n.url || '' : '');
const isBox = (n) => n.type !== 'group';
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const isPicture = (n) => n.type === 'file' && IMAGE.test(n.file || '');
const inside = (x, g) => x.x >= g.x && x.y >= g.y && x.x + x.width <= g.x + g.width && x.y + x.height <= g.y + g.height;
// Reading order: rows from the top, each from the left.
const reading = (ns) => [...ns].sort((a, b) => (Math.round((a.y + a.height / 2) / 80) - Math.round((b.y + b.height / 2) / 80)) || (a.x - b.x));

export function parseBoard(text) {
  const d = text && text.trim() ? JSON.parse(text) : {};
  if (typeof d !== 'object' || Array.isArray(d)) throw new Error('Not a JSON Canvas');
  const nodes = (Array.isArray(d.nodes) ? d.nodes : []).filter((n) => n && typeof n.id === 'string').map((n) => ({
    ...n, x: Number(n.x) || 0, y: Number(n.y) || 0, width: Math.max(20, Number(n.width) || 170), height: Math.max(20, Number(n.height) || 60),
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(d.edges) ? d.edges : []).filter((e) => e && ids.has(e.fromNode) && ids.has(e.toNode));
  return { ...d, nodes, edges };
}

export function stringifyBoard(d) {
  return `${JSON.stringify(d, null, '\t')}\n`;
}

// The side of a facing b: across when the gap between them is wider than it
// is high (beside each other more than above).
function sidesFor(a, b) {
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  const across = Math.abs(dx) - (a.width + b.width) / 2;
  const down = Math.abs(dy) - (a.height + b.height) / 2;
  if (across >= down) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}
// An arrow's sides: facing each other; but the later of two arrows between
// the same boxes, the other way, goes round (under, or beside), not on it.
function edgeSides(d, ed, a, b) {
  // One that goes back (drawn from words: to a step before): round underneath.
  if (ed.round === true && b.x + b.width <= a.x) return ['bottom', 'bottom'];
  // One that skips steps (drawn from words): round over them.
  if (ed.round === 'over' && b.x >= a.x + a.width) return ['top', 'top'];
  const base = sidesFor(a, b);
  const i = d.edges.indexOf(ed);
  const back = d.edges.findIndex((x) => x.fromNode === ed.toNode && x.toNode === ed.fromNode);
  if (back < 0 || i < 0 || back > i) return base;
  return base[0] === 'left' || base[0] === 'right' ? ['bottom', 'bottom'] : ['right', 'right'];
}
const sidePoint = (n, side) => ({
  top: [n.x + n.width / 2, n.y], bottom: [n.x + n.width / 2, n.y + n.height],
  left: [n.x, n.y + n.height / 2], right: [n.x + n.width, n.y + n.height / 2],
})[side];

// The curve of an arrow: from a side, out along it, into the other.
function curve(p1, s1, p2, s2) {
  const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const o = Math.max(24, Math.min(140, dist * 0.4));
  const n1 = NORMAL[s1] || [0, 0];
  const n2 = NORMAL[s2] || [0, 0];
  const c1 = [p1[0] + n1[0] * o, p1[1] + n1[1] * o];
  const c2 = [p2[0] + n2[0] * o, p2[1] + n2[1] * o];
  return { p1, c1, c2, p2, d: `M${p1[0]},${p1[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}` };
}
const bez = (c, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * c.p1[i] + 3 * u * u * t * c.c1[i] + 3 * u * t * t * c.c2[i] + t * t * t * c.p2[i]);
};
function arrowHead(tip, from, size = 11) {
  let dx = tip[0] - from[0];
  let dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const bx = tip[0] - dx * size;
  const by = tip[1] - dy * size;
  const w = size * 0.5;
  return `M${tip[0]},${tip[1]} L${bx - dy * w},${by + dx * w} L${bx + dy * w},${by - dx * w} Z`;
}
const edgeOf = (d, ed) => {
  const a = d.nodes.find((n) => n.id === ed.fromNode);
  const b = d.nodes.find((n) => n.id === ed.toNode);
  if (!a || !b) return null;
  const [s1, s2] = edgeSides(d, ed, a, b);
  return curve(sidePoint(a, s1), s1, sidePoint(b, s2), s2);
};

// ---- the picture of a board (copied as an image, shown in a note)

// pal: the theme's colours ({ bg, bg2, fg, fgDim, accent, font }).
let measurer = null;
function wrap(text, font, max) {
  measurer ||= document.createElement('canvas').getContext('2d');
  measurer.font = font;
  const width = (s) => measurer.measureText(s).width;
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(?<=\s)/)) {
      if (width(line + word) <= max || !line) {
        if (!line && width(word) > max) {
          // One word longer than the box: broken where it must be.
          let part = '';
          for (const ch of word) { if (part && width(part + ch) > max) { out.push(part); part = ch; } else part += ch; }
          line = part;
        } else line += word;
      } else { out.push(line.trimEnd()); line = word; }
    }
    out.push(line.trimEnd());
  }
  return out;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function rgb(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) return m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
  return [128, 128, 128];
}
const mix = (a, b, t) => { const x = rgb(a); const y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(',')})`; };

// → { svg (text), width, height }; only the nodes ids names (and the arrows
// between them), else all.
export function boardSvg(d, pal, ids = null) {
  const nodes = d.nodes.filter((n) => !ids || ids.has(n.id));
  const keep = new Set(nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => keep.has(e.fromNode) && keep.has(e.toNode));
  if (!nodes.length) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', width: 1, height: 1 };
  let x1 = Math.min(...nodes.map((n) => n.x));
  let y1 = Math.min(...nodes.map((n) => n.y));
  let x2 = Math.max(...nodes.map((n) => n.x + n.width));
  let y2 = Math.max(...nodes.map((n) => n.y + n.height));
  const curves = new Map(edges.map((e) => [e, edgeOf(d, e)]));
  for (const c of curves.values()) for (const p of [c.c1, c.c2]) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  const PAD = 28;
  x1 -= PAD; y1 -= PAD; x2 += PAD; y2 += PAD;
  const width = Math.ceil(x2 - x1);
  const height = Math.ceil(y2 - y1);
  const font = `${FONT}px ${pal.font}`;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x1} ${y1} ${width} ${height}" font-family="${esc(pal.font)}">`,
    `<rect x="${x1}" y="${y1}" width="${width}" height="${height}" fill="${esc(pal.bg)}"/>`];
  const shapeSvg = (n) => {
    const shape = shapeOf(n);
    const c = colorOf(n.color);
    const stroke = shape === 'sticky' ? 'none' : c || pal.fgDim;
    const fill = shape === 'sticky' ? mix(c || STICKY, pal.bg, 0.34) : shape === 'group' ? mix(c || pal.fgDim, pal.bg, 0.06) : c ? mix(c, pal.bg, 0.16) : pal.bg2;
    const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="1.6"${shape === 'group' ? ' stroke-dasharray="6 4"' : ''}`;
    const { x, y, width: w, height: h } = n;
    if (shape === 'text') return '';
    if (shape === 'ellipse') return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 - 1}" ry="${h / 2 - 1}" ${attrs}/>`;
    if (shape === 'diamond') return `<polygon points="${x + w / 2},${y + 1} ${x + w - 1},${y + h / 2} ${x + w / 2},${y + h - 1} ${x + 1},${y + h / 2}" ${attrs}/>`;
    return `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="${shape === 'sticky' ? 3 : shape === 'group' ? 10 : 8}" ${attrs}/>`;
  };
  const wordsSvg = (n) => {
    const words = wordsOf(n);
    if (!words) return '';
    const shape = shapeOf(n);
    const pad = PAD_X[shape] ?? 12;
    if (shape === 'group') return `<text x="${n.x + 10}" y="${n.y + 6 + LINE * 0.78}" font-size="${FONT}" font-weight="600" fill="${pal.fgDim}">${esc(words)}</text>`;
    const lines = wrap(words, font, n.width - pad * 2);
    const al = n.type === 'text' ? alignOf(n) : 'center';
    const tx = al === 'left' ? n.x + pad : al === 'right' ? n.x + n.width - pad : n.x + n.width / 2;
    const anchor = al === 'left' ? 'start' : al === 'right' ? 'end' : 'middle';
    const top = shape === 'sticky' ? n.y + 12 : n.y + (n.height - lines.length * LINE) / 2;
    const fill = n.type === 'text' ? pal.fg : pal.fgDim;
    return `<text font-size="${FONT}" fill="${fill}" text-anchor="${anchor}">${lines.map((l, i) => `<tspan x="${tx}" y="${top + i * LINE + LINE * 0.74}">${esc(l) || ' '}</tspan>`).join('')}</text>`;
  };
  for (const n of nodes.filter((x) => x.type === 'group')) out.push(shapeSvg(n), wordsSvg(n));
  for (const e of edges) {
    const c = curves.get(e);
    const col = colorOf(e.color) || pal.fgDim;
    out.push(`<path d="${c.d}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round"${e.dash ? ' stroke-dasharray="7 6"' : ''}/>`);
    if ((e.toEnd ?? 'arrow') === 'arrow') out.push(`<path d="${arrowHead(c.p2, bez(c, 0.92))}" fill="${col}" stroke="${col}" stroke-linejoin="round"/>`);
    if (e.fromEnd === 'arrow') out.push(`<path d="${arrowHead(c.p1, bez(c, 0.08))}" fill="${col}" stroke="${col}" stroke-linejoin="round"/>`);
  }
  for (const n of nodes.filter(isBox)) out.push(shapeSvg(n), wordsSvg(n));
  for (const e of edges.filter((x) => x.label)) {
    const m = bez(curves.get(e), 0.5);
    measurer ||= document.createElement('canvas').getContext('2d');
    measurer.font = `13px ${pal.font}`;
    const w = measurer.measureText(e.label).width + 14;
    out.push(`<rect x="${m[0] - w / 2}" y="${m[1] - 11}" width="${w}" height="22" rx="4" fill="${esc(pal.bg)}"/>`,
      `<text x="${m[0]}" y="${m[1] + 4.5}" font-size="13" text-anchor="middle" fill="${esc(pal.fg)}">${esc(e.label)}</text>`);
  }
  out.push('</svg>');
  return { svg: out.join(''), width, height };
}

// The picture as a PNG, twice as fine (drawn through an <img>: a data: URL,
// which the page's rules let in).
export async function svgPng(svgText, width, height, scale = 2) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('the picture could not be drawn'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * scale));
  c.height = Math.max(1, Math.round(height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
}
export const svgUrl = (svgText) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

export class Board {
  // imageUrl(path) → its address; addImages(files) → [{ path }] kept in
  // assets/; ask({ task, cards }) → { said, end } (the desk's margin): all
  // optional, as a board can be shown without them.
  constructor({ text, onChange = () => {}, toast = () => {}, palette = null, imageUrl = null, addImages = null, ask = null }) {
    this.opts = { imageUrl, addImages, ask };
    this.onChange = onChange;
    this.toast = toast;
    this.palette = palette;
    this.d = parseBoard(text);
    this.last = text;
    this.view = { x: 0, y: 0, k: 1 };
    this.sel = new Set(); // nodes
    this.selEdge = null;
    this.tool = 'rect';
    this.color = null; // for new boxes
    this.undo = [];
    this.redo = [];
    this.els = new Map(); // node id → element
    this.editing = null; // { id, el, isNew }: being written in
    this.armed = null; // { id, el }: the selected box, ready to take what is typed
    this.presenting = null;

    this.el = el('div', 'board');
    this.el.tabIndex = 0;
    this.world = el('div', 'board-world');
    this.groupsLayer = el('div', 'board-groups');
    this.edgeSvg = svg('svg', { class: 'board-edges' });
    this.labels = el('div', 'board-labels');
    this.nodesLayer = el('div', 'board-nodes');
    this.guides = svg('svg', { class: 'board-guides' });
    this.marquee = el('div', 'board-marquee');
    this.marquee.hidden = true;
    this.world.append(this.groupsLayer, this.edgeSvg, this.nodesLayer, this.labels, this.guides, this.marquee);
    this.hint = el('div', 'board-hint', 'Double-click to put a box down · drag a box’s dot to join it to another · Tab: the next box');
    this.help = el('div', 'board-help');
    this.help.hidden = true;
    this.caption = el('div', 'board-caption');
    this.caption.hidden = true;
    this.bar = this.toolbar();
    this.el.append(this.world, this.hint, this.bar, this.help, this.caption);

    this.onArmedInput = () => this.startTyping();
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', (e) => this.up(e));
    this.el.addEventListener('dblclick', (e) => this.dbl(e));
    this.el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('keyup', (e) => { if (e.key === ' ') { this.space = false; this.el.classList.remove('board-panning'); } });
    this.el.addEventListener('focus', () => this.arm());
    this.el.addEventListener('copy', (e) => this.copy(e));
    this.el.addEventListener('cut', (e) => { if (this.copy(e)) this.remove(); });
    this.el.addEventListener('paste', (e) => this.paste(e));
    this.el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
    this.el.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      this.addPictures(files, (e.clientX - r.left - this.view.x) / this.view.k, (e.clientY - r.top - this.view.y) / this.view.k);
    });
    this.render();
  }

  // ---- the file
  load(text) {
    if (text === this.last) return;
    try { this.d = parseBoard(text); } catch (e) { this.toast(`The board can’t be read: ${e.message}`, 'error'); return; }
    this.last = text;
    this.sel = new Set([...this.sel].filter((id) => this.node(id)));
    this.render();
  }

  sides() {
    for (const e of this.d.edges) {
      const a = this.node(e.fromNode);
      const b = this.node(e.toNode);
      if (a && b) [e.fromSide, e.toSide] = edgeSides(this.d, e, a, b);
    }
  }
  // A change: kept for ⌘Z, drawn, saved.
  commit() {
    this.sides();
    const text = stringifyBoard(this.d);
    if (text === this.last) { this.render(); return; }
    this.undo.push(this.last);
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
    this.last = text;
    this.render();
    this.onChange(text);
  }
  // Before a change made bit by bit (a drag, writing): the state to go back to.
  begin() { this.before = this.last; }
  end() {
    if (this.before == null) return;
    const was = this.before;
    this.before = null;
    this.sides();
    const text = stringifyBoard(this.d);
    if (text === was) { this.render(); return; }
    this.undo.push(was);
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
    this.last = text;
    this.render();
    this.onChange(text);
  }
  back(forward = false) {
    this.finishEdit();
    const from = forward ? this.redo : this.undo;
    const to = forward ? this.undo : this.redo;
    if (!from.length) return;
    to.push(this.last);
    this.last = from.pop();
    this.d = parseBoard(this.last);
    this.sel = new Set([...this.sel].filter((id) => this.node(id)));
    this.selEdge = null;
    this.render();
    this.onChange(this.last);
  }

  node(id) { return this.d.nodes.find((n) => n.id === id); }
  selected() { return this.d.nodes.filter((n) => this.sel.has(n.id)); }
  one() { return this.sel.size === 1 ? this.node([...this.sel][0]) : null; }

  // ---- the view
  toWorld(e) {
    const r = this.el.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.k, (e.clientY - r.top - this.view.y) / this.view.k];
  }
  setView(x, y, k) {
    this.view = { x, y, k: Math.max(0.15, Math.min(4, k)) };
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.k})`;
    this.el.style.setProperty('--board-k', String(this.view.k));
    this.el.style.backgroundSize = `${24 * this.view.k}px ${24 * this.view.k}px`;
    this.el.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
  }
  zoomAt(k, cx, cy) {
    const { x, y, k: k0 } = this.view;
    const nk = Math.max(0.15, Math.min(4, k));
    this.setView(cx - ((cx - x) / k0) * nk, cy - ((cy - y) / k0) * nk, nk);
  }
  // The rectangle (world) in the middle of the view, as large as it goes.
  look(x1, y1, x2, y2, { maxK = 1, pad = 60, top = 50, bottom = 20 } = {}) {
    const w = this.el.clientWidth || 800;
    const h = this.el.clientHeight || 600;
    const k = Math.min(maxK, (w - pad * 2) / Math.max(1, x2 - x1), (h - top - bottom - pad * 2) / Math.max(1, y2 - y1));
    this.setView(w / 2 - ((x1 + x2) / 2) * k, top + (h - top - bottom) / 2 - ((y1 + y2) / 2) * k, k);
  }
  fit() {
    this.viewSet = true;
    const ns = this.d.nodes;
    if (!ns.length) { this.setView((this.el.clientWidth || 800) / 2, (this.el.clientHeight || 600) / 2, 1); return; }
    this.look(Math.min(...ns.map((n) => n.x)), Math.min(...ns.map((n) => n.y)), Math.max(...ns.map((n) => n.x + n.width)), Math.max(...ns.map((n) => n.y + n.height)));
  }
  // The box in view: moved to, when it is not.
  reveal(n) {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const { x, y, k } = this.view;
    const sx = n.x * k + x;
    const sy = n.y * k + y;
    let nx = x;
    let ny = y;
    if (sx < 40) nx += 40 - sx; else if (sx + n.width * k > w - 40) nx -= sx + n.width * k - (w - 40);
    if (sy < 70) ny += 70 - sy; else if (sy + n.height * k > h - 40) ny -= sy + n.height * k - (h - 40);
    if (nx !== x || ny !== y) this.setView(nx, ny, k);
  }

  // ---- drawing it
  render() {
    if (!this.viewSet && this.el.isConnected && this.el.clientWidth) this.fit();
    if (!this.viewSet) this.setView(this.view.x, this.view.y, this.view.k);
    const seen = new Set();
    for (const n of this.d.nodes) {
      seen.add(n.id);
      let e = this.els.get(n.id);
      if (!e) { e = this.makeNode(n); this.els.set(n.id, e); }
      this.paintNode(n, e);
      const layer = n.type === 'group' ? this.groupsLayer : this.nodesLayer;
      if (e.parentNode !== layer) layer.append(e);
    }
    for (const [id, e] of this.els) if (!seen.has(id)) { e.remove(); this.els.delete(id); }
    this.drawEdges();
    this.hint.hidden = this.d.nodes.length > 0 || !!this.presenting;
    this.paintBar();
    this.arm();
  }

  makeNode(n) {
    const e = el('div', 'board-node');
    e.dataset.id = n.id;
    e.shape = svg('svg', { class: 'board-shape' });
    e.textEl = el('div', 'board-words');
    e.append(e.shape, e.textEl);
    for (const s of SIDES) {
      const dot = el('div', `board-dot board-dot-${s}`);
      dot.dataset.side = s;
      dot.title = 'Drag to another box to join them, or out for a new one; click for the next box this way';
      e.append(dot);
    }
    const grip = el('div', 'board-grip');
    grip.title = 'Drag to resize';
    e.append(grip);
    return e;
  }

  paintNode(n, e) {
    const shape = shapeOf(n);
    const cls = ['board-node', `board-${shape}`, `board-al-${n.type === 'text' ? alignOf(n) : 'center'}`];
    if (this.sel.has(n.id)) cls.push('board-sel');
    if (this.editing?.id === n.id) cls.push('board-editing');
    if (this.armed?.id === n.id) cls.push('board-armed');
    if (n.type !== 'text' && n.type !== 'group') cls.push(isPicture(n) ? 'board-picture' : 'board-other');
    if (this.asking === n.id) cls.push('board-busy');
    const c = colorOf(n.color);
    if (c) cls.push('board-colored');
    const p = this.presentClass(n);
    if (p) cls.push(p);
    e.className = cls.join(' ');
    e.style.left = `${n.x}px`;
    e.style.top = `${n.y}px`;
    e.style.width = `${n.width}px`;
    e.style.height = `${n.height}px`;
    if (c) e.style.setProperty('--board-c', c); else e.style.removeProperty('--board-c');
    // The outline, drawn to the box's size.
    const w = n.width;
    const h = n.height;
    e.shape.setAttribute('viewBox', `0 0 ${w} ${h}`);
    e.shape.setAttribute('width', w);
    e.shape.setAttribute('height', h);
    const key = `${shape}:${w}x${h}`;
    if (e.shapeKey !== key) {
      e.shapeKey = key;
      const q = 1;
      const out = shape === 'ellipse' ? svg('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2 - q, ry: h / 2 - q })
        : shape === 'diamond' ? svg('polygon', { points: `${w / 2},${q} ${w - q},${h / 2} ${w / 2},${h - q} ${q},${h / 2}` })
          : svg('rect', { x: q, y: q, width: w - 2 * q, height: h - 2 * q, rx: shape === 'sticky' ? 3 : shape === 'group' ? 10 : 8 });
      e.shape.replaceChildren(out);
    }
    if (isPicture(n) && this.opts.imageUrl) {
      if (!e.img) { e.img = el('img', 'board-img'); e.img.alt = ''; e.img.draggable = false; e.insertBefore(e.img, e.textEl); }
      const src = this.opts.imageUrl(n.file);
      if (e.img.getAttribute('src') !== src) e.img.src = src;
    }
    if (this.editing?.id !== n.id) {
      const words = wordsOf(n);
      if (e.textEl.textContent !== words) e.textEl.textContent = words;
    }
  }

  drawEdges(temp = null) {
    const parts = [];
    const labels = [];
    const all = temp ? [...this.d.edges, temp] : this.d.edges;
    for (const ed of all) {
      const a = ed.from || this.node(ed.fromNode);
      const b = ed.to || this.node(ed.toNode);
      if (!a || !b) continue;
      const [s1, s2] = ed.sides || edgeSides(this.d, ed, a, b);
      const c = curve(sidePoint(a, s1), s1, ed.point || sidePoint(b, s2), ed.point ? null : s2);
      const col = colorOf(ed.color);
      const pc = ed.id ? this.presentEdgeClass(ed) : '';
      const g = svg('g', { class: `board-edge${ed.id && ed.id === this.selEdge ? ' board-sel' : ''}${ed.dash ? ' board-dash' : ''}${ed.temp ? ' board-temp' : ''}${pc ? ` ${pc}` : ''}` });
      if (col) g.style.setProperty('--board-c', col);
      if (ed.id) g.dataset.id = ed.id;
      g.append(svg('path', { class: 'board-edge-hit', d: c.d }), svg('path', { class: 'board-edge-line', d: c.d }));
      if ((ed.toEnd ?? 'arrow') === 'arrow') g.append(svg('path', { class: 'board-edge-head', d: arrowHead(c.p2, bez(c, 0.92)) }));
      if (ed.fromEnd === 'arrow') g.append(svg('path', { class: 'board-edge-head', d: arrowHead(c.p1, bez(c, 0.08)) }));
      parts.push(g);
      if (ed.id && (ed.label || this.editingEdge === ed.id)) {
        const m = bez(c, 0.5);
        let lab = this.editingEdge === ed.id ? this.edgeInput : null;
        if (!lab) { lab = el('div', 'board-label'); lab.textContent = ed.label; }
        lab.dataset.id = ed.id;
        lab.classList.toggle('board-sel', ed.id === this.selEdge);
        for (const x of ['board-hot', 'board-seen', 'board-dim']) lab.classList.toggle(x, pc === x);
        lab.style.left = `${m[0]}px`;
        lab.style.top = `${m[1]}px`;
        labels.push(lab);
      }
    }
    this.edgeSvg.replaceChildren(...parts);
    this.labels.replaceChildren(...labels);
  }

  // ---- the bar
  toolbar() {
    const bar = el('div', 'board-bar');
    const button = (text, title, run, cls = '') => { const b = el('button', `board-tool${cls ? ` ${cls}` : ''}`, text); b.title = title; b.addEventListener('click', run); return b; };
    this.toolButtons = SHAPES.map(([id, name, k, icon]) => [id, button(icon, `${name} (⌥${k}) — for the next box; on the selected ones, their shape`, () => this.setShape(id))]);
    const sep = () => el('span', 'board-sep');
    this.swatches = [null, ...Object.keys(COLORS)].map((c) => {
      const b = el('button', 'board-swatch');
      if (c) b.style.setProperty('--board-c', COLORS[c]); else b.classList.add('board-swatch-none');
      b.title = c ? `Colour ${c} (⌥${c})` : 'No colour (⌥0)';
      b.addEventListener('click', () => this.setColor(c));
      return [c, b];
    });
    const group = button('⬚', 'A group around the selected boxes (⌘G); on a group: let it go (⌘⇧G)', () => this.toggleGroup());
    this.edgeTools = el('span', 'board-edge-tools');
    this.headsButton = button('→', 'Its heads: → ↔ — (A)', () => this.cycleHeads());
    this.edgeTools.append(sep(), this.headsButton, button('┄', 'Dashed or not (L)', () => this.toggleDash()));
    // Its words to the left, the middle, the right.
    this.nodeTools = el('span', 'board-edge-tools');
    this.alignButtons = ALIGNS.map((a) => {
      const b = el('button', 'board-tool board-align');
      const icon = svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16 });
      for (const [y, w] of [[3, 12], [7, 8], [11, 11]]) {
        const x = a === 'left' ? 2 : a === 'right' ? 14 - w : 8 - w / 2;
        icon.append(svg('line', { x1: x, y1: y + 0.5, x2: x + w, y2: y + 0.5 }));
      }
      b.append(icon);
      b.title = `Words ${a === 'center' ? 'in the middle' : `to the ${a}`} (⌥⇧${a === 'left' ? 'L' : a === 'right' ? 'R' : 'E'})`;
      b.addEventListener('click', () => this.setAlign(a));
      return [a, b];
    });
    this.nodeTools.append(sep(), ...this.alignButtons.map(([, b]) => b));
    this.drawTool = el('span', 'board-edge-tools');
    this.drawTool.append(button('\u21F6', 'Drawn as a diagram, beside it (\u2325\u21E7D): words written as a line a box, - or -- before the ones under it, A -> B for an arrow, at once; other words, or a picture, by Claude', () => this.drawWords()));
    bar.append(...this.toolButtons.map(([, b]) => b), group, sep(), ...this.swatches.map(([, b]) => b), this.nodeTools, this.drawTool, this.edgeTools, sep(),
      button('▶', 'Present: from the selected box (or the first), along the arrows — full screen (⌥P)', () => this.present()),
      button('⤢', 'All of it in view (⇧1)', () => this.fit()),
      button('?', 'Keys', () => this.toggleHelp()));
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('dblclick', (e) => e.stopPropagation());
    return bar;
  }
  paintBar() {
    const sel = this.selected().filter((n) => n.type === 'text');
    const shape = sel.length ? sel[0].shape || 'rect' : this.tool;
    for (const [id, b] of this.toolButtons) b.classList.toggle('board-on', id === shape);
    const color = sel.length ? sel[0].color ?? null : this.selEdge ? this.d.edges.find((e) => e.id === this.selEdge)?.color ?? null : this.color;
    for (const [c, b] of this.swatches) b.classList.toggle('board-on', (c ?? null) === (color ?? null));
    const ed = this.selEdge && this.d.edges.find((e) => e.id === this.selEdge);
    this.edgeTools.hidden = !ed;
    this.nodeTools.hidden = !sel.length;
    const one = this.one();
    this.drawTool.hidden = !one || !(one.type === 'text' || isPicture(one));
    const al = sel.length ? alignOf(sel[0]) : null;
    for (const [a, b] of this.alignButtons) b.classList.toggle('board-on', a === al);
    if (ed) this.headsButton.textContent = ed.fromEnd === 'arrow' ? '↔' : (ed.toEnd ?? 'arrow') === 'arrow' ? '→' : '—';
  }
  toggleHelp() {
    this.help.hidden = !this.help.hidden;
    if (!this.help.hidden && !this.help.childElementCount) {
      const rows = [
        ['Double-click', 'a box (on a box: write in it)'],
        ['Type', 'on the selected box: its words go on'],
        ['Enter · Esc', 'write in the box · done'],
        ['Drag a dot', 'to a box: join them · out: a new box, joined'],
        ['Click a dot', 'the next box that way'],
        ['Tab · ⇧Tab', 'the next box, joined · one under it, from the same box'],
        ['⌘ / ⌥ + arrow', 'the next box that way'],
        ['Arrows · ⇧ arrows', 'to the next box · move them'],
        ['⌥R O D S T', 'box, ellipse, diamond, sticky, words (no ⌥: none selected)'],
        ['⌥1–6 · ⌥0', 'a colour · none'],
        ['⌥⇧L E R', 'words to the left, the middle, the right'],
        ['⌘G · ⌘⇧G', 'a group around them · let it go'],
        ['⌥⇧D', 'drawn: a line a box, - -- under, A -> B; other words or a picture: by Claude'],
        ['Paste, drop', 'a picture on the board (in assets/)'],
        ['On an arrow', 'A heads · L dashed · Enter or double-click: its words'],
        ['⌥ drag · ⌘D', 'a copy'],
        ['⌥⇧C', 'copy as an image (the selected boxes, or all)'],
        ['⌥P', 'present, from the selected box along the arrows'],
        ['Space drag, wheel', 'move about · ⌘ wheel or pinch: zoom'],
        ['⇧1 · - =', 'all in view · zoom'],
      ];
      this.help.append(...rows.map(([k, v]) => el('div', 'board-help-row', el('kbd', '', k), el('span', '', v))));
    }
  }

  // ---- making things
  addNode(x, y, { shape = this.tool, text = '', color = this.color, size } = {}) {
    const [w, h] = size || SIZE[shape] || SIZE.rect;
    const n = { id: newId(), type: 'text', text, x: round(x - w / 2), y: round(y - h / 2), width: w, height: h };
    if (shape !== 'rect') n.shape = shape;
    if (color) n.color = color;
    this.d.nodes.push(n);
    return n;
  }
  link(a, b) {
    if (a.id === b.id || this.d.edges.some((e) => (e.fromNode === a.id && e.toNode === b.id))) return null;
    const ed = { id: newId(), fromNode: a.id, toNode: b.id };
    this.d.edges.push(ed);
    return ed;
  }
  overlaps(r, skip) {
    return this.d.nodes.some((n) => n !== skip && isBox(n) && r.x < n.x + n.width + 12 && r.x + r.width + 12 > n.x && r.y < n.y + n.height + 12 && r.y + r.height + 12 > n.y);
  }
  // The next box from a, toward side: as a is (shape, size, colour), out of
  // the way of the others.
  addFrom(a, side, { write = true } = {}) {
    this.finishEdit();
    this.begin();
    const shape = a.type === 'text' ? a.shape || 'rect' : this.tool;
    const w = a.type === 'text' ? a.width : SIZE[shape][0];
    const h = a.type === 'text' ? Math.min(a.height, Math.max(SIZE[shape][1], 70)) : SIZE[shape][1];
    const [nx, ny] = NORMAL[side];
    const r = {
      x: nx > 0 ? a.x + a.width + GAP : nx < 0 ? a.x - GAP - w : a.x + (a.width - w) / 2,
      y: ny > 0 ? a.y + a.height + GAP * 0.75 : ny < 0 ? a.y - GAP * 0.75 - h : a.y + (a.height - h) / 2,
      width: w, height: h,
    };
    // Beside: further down; above or below: further right.
    for (let i = 0; i < 40 && this.overlaps(r); i++) { if (nx) r.y += h + 30; else r.x += w + 30; }
    const n = this.addNode(r.x + w / 2, r.y + h / 2, { shape, color: a.type === 'text' ? a.color : this.color, size: [w, h] });
    if (a.align && a.type === 'text') n.align = a.align;
    this.link(a, n);
    this.sel = new Set([n.id]);
    this.selEdge = null;
    this.render();
    this.reveal(n);
    if (write) this.edit(n, true); else this.end();
    return n;
  }
  // Under this one, from the box it came from (or just under it).
  addSibling(n) {
    const from = this.d.edges.find((e) => e.toNode === n.id);
    const parent = from && this.node(from.fromNode);
    if (!parent) { this.addFrom(n, 'bottom'); return; }
    this.finishEdit();
    this.begin();
    const r = { x: n.x, y: n.y + n.height + 30, width: n.width, height: n.height };
    const [s1] = sidesFor(parent, n);
    for (let i = 0; i < 40 && this.overlaps(r); i++) { if (s1 === 'left' || s1 === 'right') r.y += n.height + 30; else r.x += n.width + 30; }
    if (s1 === 'top' || s1 === 'bottom') { r.x = n.x + n.width + 30; r.y = n.y; for (let i = 0; i < 40 && this.overlaps(r); i++) r.x += n.width + 30; }
    const m = this.addNode(r.x + r.width / 2, r.y + r.height / 2, { shape: n.shape || 'rect', color: n.color, size: [n.width, n.height] });
    if (n.align) m.align = n.align;
    this.link(parent, m);
    this.sel = new Set([m.id]);
    this.render();
    this.reveal(m);
    this.edit(m, true);
  }

  // Words as a diagram (board-text.js): beside the box they were written in
  // (it stays), or round (cx, cy) when pasted. Not one: false.
  diagram(text, { from = null, cx = 0, cy = 0 } = {}) {
    const g = textToDiagram(text);
    if (!g) return false;
    const font = `${FONT}px ${getComputedStyle(this.el).fontFamily || 'sans-serif'}`;
    const size = (n) => {
      const [w0, h0] = SIZE[n.shape] || SIZE.rect;
      const pad = (PAD_X[n.shape] || 12) * 2;
      const longest = Math.max(...wrap(n.text, font, 10000).map((l) => (measurer.measureText(l).width)));
      const w = Math.max(n.shape === 'diamond' ? w0 : 130, Math.min(260, Math.ceil(longest + pad + 4)));
      const lines = wrap(n.text, font, w - pad).length;
      const grow = n.shape === 'diamond' ? 2.0 : n.shape === 'ellipse' ? 1.45 : 1;
      return [w, Math.max(n.shape === 'rect' ? 56 : h0, Math.ceil((lines * LINE + 20) * grow))];
    };
    const pos = layoutDiagram(g, size, { gapX: 80, gapY: 26 });
    const W = Math.max(...pos.map((p) => p.x + p.width));
    const H = Math.max(...pos.map((p) => p.y + p.height));
    const at = from ? { x: from.x + from.width + 120, y: from.y } : { x: cx - W / 2, y: cy - H / 2 };
    // Out of the way of what is there.
    const box = (dx) => ({ x: at.x + dx, y: at.y, width: W, height: H });
    let dx = 0;
    for (let i = 0; i < 60 && this.overlaps(box(dx)); i++) dx += 80;
    at.x += dx;
    this.begin();
    const made = g.nodes.map((n, i) => {
      const m = { id: newId(), type: 'text', text: n.text, x: round(at.x + pos[i].x), y: round(at.y + pos[i].y), width: pos[i].width, height: pos[i].height };
      if (n.shape !== 'rect') m.shape = n.shape;
      this.d.nodes.push(m);
      return m;
    });
    for (const e of g.edges) {
      const ed = this.link(made[e.from], made[e.to]);
      if (!ed) continue;
      if (e.label) ed.label = e.label;
      if (e.both) ed.fromEnd = 'arrow';
      if (e.none) ed.toEnd = 'none';
      const [a, b] = [made[e.from], made[e.to]];
      if (b.x + b.width <= a.x) ed.round = true;
      else if (b.x >= a.x + a.width) {
        // A box in the way, between them: over the top.
        const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y + a.height, b.y + b.height)];
        if (made.some((m) => m !== a && m !== b && m.x >= a.x + a.width && m.x + m.width <= b.x && m.y < y2 && m.y + m.height > y1)) ed.round = 'over';
      }
    }
    this.sel = new Set(made.map((n) => n.id));
    this.selEdge = null;
    this.render();
    for (const n of made) { const t = this.els.get(n.id)?.textEl; if (t) this.grow(n, t); }
    this.end();
    const xs = made.flatMap((n) => [n.x, n.x + n.width]);
    const ys = made.flatMap((n) => [n.y, n.y + n.height]);
    const [x1, x2, y1, y2] = [Math.min(...xs, from ? from.x : Infinity), Math.max(...xs), Math.min(...ys, from ? from.y : Infinity), Math.max(...ys, from ? from.y + from.height : -Infinity)];
    this.look(x1, y1, x2, y2, { maxK: this.view.k });
    this.toast(`Drawn: ${made.length} boxes, ${g.edges.length} arrows${from ? ' — it stays as it is' : ''} (⌘Z to take it back)`);
    return true;
  }
  // The selected box's words, drawn (⌥⇧D).
  // Words written that way: at once. Other words, or a picture: by Claude.
  drawWords() {
    const ed = this.editing;
    if (ed) this.finishEdit();
    const n = this.one();
    if (!n || !(n.type === 'text' || isPicture(n))) { this.toast('Select a box with words, or a picture, to draw'); return; }
    if (n.type === 'text' && !n.text.trim()) { this.toast('Write in the box first: a line a box, - or -- before the ones under it, or A -> B -> C', 'error'); return; }
    if (n.type === 'text' && this.diagram(n.text, { from: n })) return;
    if (!this.opts.ask) { this.toast('Nothing to draw yet: a line a box, - or -- before the ones under it (one more each level), or A -> B -> C', 'error'); return; }
    this.askDiagram(n);
  }
  async askDiagram(n) {
    if (this.asking) { this.toast('Claude is still drawing the last one'); return; }
    this.asking = n.id;
    this.render();
    this.toast(isPicture(n) ? 'Claude is reading the picture\u2026' : 'Claude is drawing it\u2026');
    try {
      const card = isPicture(n) ? { key: n.id, file: n.file, picture: await this.pictureOf(n.file) } : { key: n.id, text: n.text };
      if (isPicture(n) && !card.picture) throw new Error('The picture could not be read');
      const r = await this.opts.ask({ task: 'diagram', cards: [card] });
      if (!r.end?.ok) throw new Error(r.end?.error || 'No answer');
      if (r.withheld?.length) throw new Error(`Not sent: ${r.withheld.join(', ')} (.agentnotesignore)`);
      const said = String(r.said || '').replace(/^```[^\n]*\n?|\n?```\s*$/g, '');
      const from = this.node(n.id);
      if (!from) return;
      if (this.editing) this.finishEdit();
      this.asking = null;
      if (!this.diagram(said, { from })) this.toast(`Claude\u2019s answer was not a diagram: ${said.slice(0, 140)}`, 'error');
    } catch (e) {
      if (e.message !== 'Not sent') this.toast(`Not drawn: ${e.message}`, 'error');
    } finally {
      this.asking = null;
      this.render();
    }
  }
  // A picture as the model reads it: 1568 px at most on its long side, JPEG.
  async pictureOf(file) {
    try {
      const img = new Image();
      img.src = this.opts.imageUrl(file);
      await img.decode();
      const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.88);
      return { media: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
    } catch { return null; }
  }
  // Pictures pasted or dropped: kept in assets/, put down at (x, y), 360 wide at most.
  async addPictures(files, x, y) {
    if (!this.opts.addImages) return;
    const got = await this.opts.addImages(files);
    if (!got.length) return;
    this.begin();
    const made = [];
    for (const { path } of got) {
      let w = 360;
      let h = 240;
      try {
        const img = new Image();
        img.src = this.opts.imageUrl(path);
        await img.decode();
        const k = Math.min(1, 360 / img.naturalWidth, 480 / img.naturalHeight);
        w = Math.max(40, Math.round(img.naturalWidth * k));
        h = Math.max(30, Math.round(img.naturalHeight * k));
      } catch { /* its size unknown: the default */ }
      const n = { id: newId(), type: 'file', file: path, x: round(x - w / 2), y: round(y - h / 2), width: w, height: h };
      for (let i = 0; i < 40 && this.overlaps(n); i++) n.x += 40;
      this.d.nodes.push(n);
      made.push(n);
      y += h + 30;
    }
    this.sel = new Set(made.map((n) => n.id));
    this.selEdge = null;
    this.end();
    this.reveal(made[made.length - 1]);
    this.toast(this.opts.ask ? 'A picture on the board \u2014 \u2325\u21E7D (or \u21F6) asks Claude to draw it as a diagram' : 'A picture on the board');
  }

  setShape(shape) {
    const sel = this.selected().filter((n) => n.type === 'text');
    if (!sel.length) { this.tool = shape; this.paintBar(); return; }
    for (const n of sel) {
      if (shape === 'rect') delete n.shape; else n.shape = shape;
      // The usual size of the new shape, unless it was made bigger.
      const [w0, h0] = SIZE[shape];
      n.height = Math.max(h0 * (shape === 'sticky' ? 1 : 0.5), n.height);
      if (shape === 'diamond') { n.width = Math.max(n.width, w0); n.height = Math.max(n.height, h0); }
      if (n.align === alignDefault(n)) delete n.align;
    }
    this.tool = shape;
    this.commit();
  }
  setColor(c) {
    const sel = this.selected();
    const ed = this.selEdge && this.d.edges.find((e) => e.id === this.selEdge);
    if (!sel.length && !ed) { this.color = c; this.paintBar(); return; }
    for (const x of [...sel, ...(ed ? [ed] : [])]) { if (c) x.color = c; else delete x.color; }
    this.commit();
  }
  setAlign(a) {
    const sel = this.selected().filter((n) => n.type === 'text');
    if (!sel.length) return;
    for (const n of sel) { if (a === alignDefault(n)) delete n.align; else n.align = a; }
    this.commit();
  }
  cycleHeads() {
    const ed = this.d.edges.find((e) => e.id === this.selEdge);
    if (!ed) return;
    const now = ed.fromEnd === 'arrow' ? 'both' : (ed.toEnd ?? 'arrow') === 'arrow' ? 'one' : 'none';
    if (now === 'one') { ed.fromEnd = 'arrow'; delete ed.toEnd; } else if (now === 'both') { delete ed.fromEnd; ed.toEnd = 'none'; } else { delete ed.fromEnd; delete ed.toEnd; }
    this.commit();
  }
  toggleDash() {
    const ed = this.d.edges.find((e) => e.id === this.selEdge);
    if (!ed) return;
    if (ed.dash) delete ed.dash; else ed.dash = true;
    this.commit();
  }
  // A group: around the selected boxes (or a frame to fill, in the middle);
  // with a group selected, the group let go (what was in it stays).
  toggleGroup(ungroup = null) {
    this.finishEdit();
    const groups = this.selected().filter((n) => n.type === 'group');
    if (ungroup ?? (groups.length && groups.length === this.sel.size)) {
      if (!groups.length) return;
      const gone = new Set(groups.map((g) => g.id));
      const kept = new Set(this.d.nodes.filter((x) => isBox(x) && groups.some((g) => inside(x, g))).map((x) => x.id));
      this.d.nodes = this.d.nodes.filter((n) => !gone.has(n.id));
      this.d.edges = this.d.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode));
      this.sel = kept;
      this.commit();
      return;
    }
    const boxes = this.selected().filter(isBox);
    this.begin();
    let g;
    if (boxes.length) {
      const x1 = Math.min(...boxes.map((n) => n.x)) - 30;
      const y1 = Math.min(...boxes.map((n) => n.y)) - 48;
      const x2 = Math.max(...boxes.map((n) => n.x + n.width)) + 30;
      const y2 = Math.max(...boxes.map((n) => n.y + n.height)) + 30;
      g = { id: newId(), type: 'group', label: '', x: round(x1), y: round(y1), width: round(x2 - x1), height: round(y2 - y1) };
    } else {
      const cx = (this.el.clientWidth / 2 - this.view.x) / this.view.k;
      const cy = (this.el.clientHeight / 2 - this.view.y) / this.view.k;
      g = { id: newId(), type: 'group', label: '', x: round(cx - 220), y: round(cy - 150), width: 440, height: 300 };
    }
    this.d.nodes.unshift(g);
    this.sel = new Set([g.id]);
    this.selEdge = null;
    this.render();
    this.edit(g, true);
  }
  remove() {
    if (this.selEdge) {
      this.d.edges = this.d.edges.filter((e) => e.id !== this.selEdge);
      this.selEdge = null;
      this.commit();
      return;
    }
    if (!this.sel.size) return;
    this.d.nodes = this.d.nodes.filter((n) => !this.sel.has(n.id));
    this.d.edges = this.d.edges.filter((e) => !this.sel.has(e.fromNode) && !this.sel.has(e.toNode));
    this.sel = new Set();
    this.commit();
  }
  duplicate(nodes, dx = 30, dy = 30) {
    const ids = new Map();
    const made = nodes.map((n) => { const m = { ...structuredClone(n), id: newId(), x: n.x + dx, y: n.y + dy }; ids.set(n.id, m.id); return m; });
    this.d.nodes.push(...made);
    for (const e of this.d.edges.filter((x) => ids.has(x.fromNode) && ids.has(x.toNode))) this.d.edges.push({ ...structuredClone(e), id: newId(), fromNode: ids.get(e.fromNode), toNode: ids.get(e.toNode) });
    this.sel = new Set(made.map((m) => m.id));
    return made;
  }

  // ---- the selected box, ready for what is typed
  // A single selected box's words are where the keys go (editable, the caret
  // hidden at their end), so the first key typed — a Korean syllable being
  // composed too — goes into it, and writing begins. The board's own keys
  // (Enter, Tab, arrows, Delete, ⌘ and ⌥ ones) are still the board's.
  hasFocus() {
    const a = document.activeElement;
    return !!a && (a === this.el || (this.armed && a === this.armed.el));
  }
  arm() {
    const n = this.one();
    const want = !!n && n.type === 'text' && !this.editing && !this.editingEdge && !this.presenting && !this.mode && this.hasFocus();
    if (this.armed && (!want || this.armed.id !== n.id)) this.disarm();
    if (!want) return;
    const e = this.els.get(n.id);
    if (!e) return;
    const t = e.textEl;
    if (!this.armed) {
      this.armed = { id: n.id, el: t };
      t.contentEditable = 'plaintext-only';
      t.spellcheck = false;
      t.addEventListener('beforeinput', this.onArmedInput);
      t.addEventListener('compositionstart', this.onArmedInput);
    }
    e.classList.add('board-armed');
    if (document.activeElement !== t) t.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(t);
    range.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }
  disarm() {
    const a = this.armed;
    if (!a) return;
    this.armed = null;
    a.el.removeEventListener('beforeinput', this.onArmedInput);
    a.el.removeEventListener('compositionstart', this.onArmedInput);
    this.els.get(a.id)?.classList.remove('board-armed');
    if (this.editing?.el === a.el) return;
    const had = document.activeElement === a.el;
    a.el.contentEditable = 'false';
    if (had) this.el.focus({ preventScroll: true });
  }
  // Something typed into the selected box: it is being written in now.
  startTyping() {
    const a = this.armed;
    if (!a) return;
    const n = this.node(a.id);
    if (!n) return;
    this.armed = null;
    a.el.removeEventListener('beforeinput', this.onArmedInput);
    a.el.removeEventListener('compositionstart', this.onArmedInput);
    const e = this.els.get(n.id);
    e?.classList.remove('board-armed');
    this.begin();
    this.editing = { id: n.id, el: a.el, isNew: false };
    e?.classList.add('board-editing');
    a.el.oninput = () => this.grow(n, a.el);
    a.el.onkeydown = (ev) => this.editKey(ev, n);
  }

  // ---- writing in a box
  edit(n, isNew = false) {
    if (n.type !== 'text' && n.type !== 'group') return;
    this.disarm();
    this.finishEdit();
    if (!isNew) this.begin();
    const e = this.els.get(n.id);
    if (!e) return;
    this.editing = { id: n.id, el: e.textEl, isNew };
    this.sel = new Set([n.id]);
    this.selEdge = null;
    e.classList.add('board-editing');
    this.paintBar();
    for (const x of this.els.values()) x.classList.toggle('board-sel', this.sel.has(x.dataset.id));
    const t = e.textEl;
    t.contentEditable = 'plaintext-only';
    t.spellcheck = false;
    t.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(t);
    if (!isNew) range.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    t.oninput = () => this.grow(n, t);
    t.onkeydown = (ev) => this.editKey(ev, n);
  }
  // A box keeps its width; its height follows the words.
  grow(n, t) {
    if (n.type === 'group') return;
    const pad = n.shape === 'diamond' ? 2.0 : n.shape === 'ellipse' ? 1.45 : 1;
    const need = Math.ceil((t.scrollHeight + 16) * pad);
    const min = (SIZE[n.shape || 'rect'] || SIZE.rect)[1];
    const h = Math.max(min, need);
    if (Math.abs(h - n.height) > 2) {
      n.height = h;
      this.paintNode(n, this.els.get(n.id)); // its words are left as they are while written
      this.drawEdges();
    }
  }
  editKey(ev, n) {
    if (ev.isComposing || ev.keyCode === 229) { ev.stopPropagation(); return; }
    if (ev.metaKey && !['z', 'Enter'].includes(ev.key)) return; // the app's own (⌘S, ⌘P…), and ⌘C ⌘V in the words
    ev.stopPropagation();
    if (ev.altKey && ev.shiftKey && ev.code === 'KeyD' && n.type === 'text') { ev.preventDefault(); this.drawWords(); return; }
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); this.finishEdit(); this.el.focus({ preventScroll: true }); return; }
    if (ev.key === 'Tab') {
      ev.preventDefault();
      this.finishEdit();
      const m = this.node(n.id);
      if (m && m.type === 'text') { if (ev.shiftKey) this.addSibling(m); else this.addFrom(m, 'right'); }
    }
  }
  finishEdit() {
    const ed = this.editing;
    if (!ed) { this.finishEdgeEdit(); return; }
    const had = document.activeElement === ed.el;
    this.editing = null;
    const n = this.node(ed.id);
    ed.el.contentEditable = 'false';
    ed.el.oninput = null;
    ed.el.onkeydown = null;
    const text = ed.el.innerText.replace(/\n+$/, '');
    if (n) {
      if (n.type === 'group') n.label = text; else n.text = text;
      // Words alone, left empty: not kept.
      if (!text && n.shape === 'text') {
        this.d.nodes = this.d.nodes.filter((x) => x !== n);
        this.d.edges = this.d.edges.filter((x) => x.fromNode !== n.id && x.toNode !== n.id);
        this.sel.delete(n.id);
      }
    }
    if (had) this.el.focus({ preventScroll: true });
    if (this.before == null) this.begin();
    this.end();
  }

  editEdge(ed) {
    this.disarm();
    this.finishEdit();
    this.begin();
    this.selEdge = ed.id;
    this.sel = new Set();
    const input = el('div', 'board-label board-label-edit');
    input.textContent = ed.label || '';
    input.contentEditable = 'plaintext-only';
    this.edgeInput = input;
    this.editingEdge = ed.id;
    this.render();
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    input.onkeydown = (ev) => {
      if (ev.isComposing || ev.keyCode === 229) { ev.stopPropagation(); return; }
      if (ev.metaKey) return;
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Escape' || ev.key === 'Tab') { ev.preventDefault(); this.finishEdgeEdit(); this.el.focus(); }
    };
    input.onpointerdown = (ev) => ev.stopPropagation();
  }
  finishEdgeEdit() {
    if (!this.editingEdge) return;
    const ed = this.d.edges.find((e) => e.id === this.editingEdge);
    const text = this.edgeInput.innerText.replace(/\n/g, ' ').trim();
    this.editingEdge = null;
    this.edgeInput = null;
    if (ed) { if (text) ed.label = text; else delete ed.label; }
    this.end();
  }

  // ---- the pointer
  hitNode(t) { const e = t?.closest?.('.board-node'); return e ? this.node(e.dataset.id) : null; }
  writing(t) { return (this.editing && this.editing.el.contains(t)) || (this.edgeInput && this.edgeInput.contains(t)); }
  down(e) {
    if (this.presenting) {
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      if (e.button === 0) { if (e.clientX - r.left < r.width / 3) this.stepBack(); else this.stepOn(); }
      return;
    }
    if (this.writing(e.target)) return;
    if (this.editing || this.editingEdge) this.finishEdit();
    e.preventDefault(); // no caret put down, no words selected: the board's own
    this.el.focus({ preventScroll: true });
    const at = this.toWorld(e);
    const t = e.target;
    this.downAt = { cx: e.clientX, cy: e.clientY, at };
    this.moved = false;
    if (e.button === 1 || this.space || (e.button === 0 && e.pointerType === 'touch' && !this.hitNode(t))) {
      this.mode = { kind: 'pan', x: this.view.x, y: this.view.y };
    } else if (e.button !== 0) {
      return;
    } else if (t.classList.contains('board-dot')) {
      const n = this.hitNode(t);
      this.mode = { kind: 'link', from: n, side: t.dataset.side };
    } else if (t.classList.contains('board-grip')) {
      const n = this.hitNode(t);
      this.begin();
      this.mode = { kind: 'resize', n, w: n.width, h: n.height };
    } else if (this.hitNode(t)) {
      const n = this.hitNode(t);
      if (e.shiftKey) { if (this.sel.has(n.id)) this.sel.delete(n.id); else this.sel.add(n.id); } else if (!this.sel.has(n.id)) this.sel = new Set([n.id]);
      this.selEdge = null;
      // A group moves with what is in it.
      const moving = new Set(this.sel);
      for (const g of this.selected().filter((x) => x.type === 'group')) {
        for (const x of this.d.nodes) if (isBox(x) && inside(x, g)) moving.add(x.id);
      }
      this.begin();
      this.mode = { kind: 'move', lead: n, alt: e.altKey, ids: moving, start: new Map([...moving].map((id) => { const x = this.node(id); return [id, [x.x, x.y]]; })) };
      this.render();
    } else if (t.closest?.('.board-edge') || t.classList.contains('board-label')) {
      const id = (t.closest('.board-edge') || t).dataset.id;
      // A second click soon on the same arrow: its words. (Not the browser's
      // double-click: the arrows are drawn again on the first, and a click on
      // something new is not a second one.)
      const again = this.edgeClick?.id === id && performance.now() - this.edgeClick.at < 450;
      this.edgeClick = again ? null : { id, at: performance.now() };
      this.selEdge = id;
      this.sel = new Set();
      this.mode = null;
      if (again) { const ed = this.d.edges.find((x) => x.id === id); if (ed) this.editEdge(ed); return; }
      this.render();
      return;
    } else {
      if (!e.shiftKey) { this.sel = new Set(); this.selEdge = null; this.render(); }
      this.mode = { kind: 'box', keep: new Set(this.sel) };
    }
    this.el.setPointerCapture(e.pointerId);
  }
  move(e) {
    const m = this.mode;
    if (!m) return;
    const dxs = e.clientX - this.downAt.cx;
    const dys = e.clientY - this.downAt.cy;
    if (!this.moved && Math.hypot(dxs, dys) < 4) return;
    this.moved = true;
    const at = this.toWorld(e);
    const dx = at[0] - this.downAt.at[0];
    const dy = at[1] - this.downAt.at[1];
    if (m.kind === 'pan') { this.setView(m.x + dxs, m.y + dys, this.view.k); return; }
    if (m.kind === 'move') {
      if (m.alt && !m.copied) {
        // ⌥ drag: the copies move; the boxes stay.
        m.copied = true;
        const nodes = [...m.ids].map((id) => this.node(id));
        const made = this.duplicate(nodes, 0, 0);
        m.ids = new Set(made.map((x) => x.id));
        m.start = new Map(made.map((x) => [x.id, [x.x, x.y]]));
        m.lead = made[nodes.indexOf(m.lead)] || made[0];
        this.render();
      }
      const [sx, sy] = this.snap(m, dx, dy);
      for (const id of m.ids) {
        const n = this.node(id);
        const [x0, y0] = m.start.get(id);
        n.x = round(x0 + dx + sx);
        n.y = round(y0 + dy + sy);
        const ne = this.els.get(id);
        if (ne) { ne.style.left = `${n.x}px`; ne.style.top = `${n.y}px`; }
      }
      this.drawEdges();
      return;
    }
    if (m.kind === 'resize') {
      m.n.width = Math.max(40, round(m.w + dx));
      m.n.height = Math.max(30, round(m.h + dy));
      this.paintNode(m.n, this.els.get(m.n.id));
      this.drawEdges();
      return;
    }
    if (m.kind === 'link') {
      const over = this.hitNode(document.elementFromPoint(e.clientX, e.clientY));
      for (const x of this.els.values()) x.classList.toggle('board-drop', !!over && x.dataset.id === over.id && over.id !== m.from.id);
      const temp = { temp: true, from: m.from };
      if (over && over.id !== m.from.id) { temp.to = over; } else { temp.point = at; temp.sides = [m.side, null]; temp.to = { x: at[0], y: at[1], width: 0, height: 0 }; }
      this.drawEdges(temp);
      return;
    }
    if (m.kind === 'box') {
      const [x0, y0] = this.downAt.at;
      const r = { x: Math.min(x0, at[0]), y: Math.min(y0, at[1]), w: Math.abs(at[0] - x0), h: Math.abs(at[1] - y0) };
      Object.assign(this.marquee.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      this.marquee.hidden = false;
      this.sel = new Set(m.keep);
      for (const n of this.d.nodes) if (n.x < r.x + r.w && n.x + n.width > r.x && n.y < r.y + r.h && n.y + n.height > r.y && isBox(n)) this.sel.add(n.id);
      for (const x of this.els.values()) x.classList.toggle('board-sel', this.sel.has(x.dataset.id));
    }
  }
  up(e) {
    const m = this.mode;
    this.mode = null;
    this.guides.replaceChildren();
    this.marquee.hidden = true;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (m && this.moved) this.draggedAt = performance.now();
    if (!m) return;
    if (m.kind === 'move' || m.kind === 'resize') { this.end(); return; }
    if (m.kind === 'box' || m.kind === 'pan') { this.render(); return; }
    if (m.kind === 'link') {
      for (const x of this.els.values()) x.classList.remove('board-drop');
      if (!this.moved) { this.addFrom(m.from, m.side); return; }
      const over = this.hitNode(document.elementFromPoint(e.clientX, e.clientY));
      if (over && over.id !== m.from.id) {
        this.begin();
        const ed = this.link(m.from, over);
        if (ed) { this.selEdge = null; this.sel = new Set([over.id]); }
        this.end();
        return;
      }
      if (over) { this.drawEdges(); return; }
      // Out on the plane: a new box there, joined, its near side at the pointer.
      this.begin();
      const at = this.toWorld(e);
      const a = m.from;
      const shape = a.type === 'text' ? a.shape || 'rect' : this.tool;
      const [w, h] = a.type === 'text' ? [a.width, Math.min(a.height, Math.max(SIZE[shape][1], 70))] : SIZE[shape];
      const probe = { x: at[0], y: at[1], width: 0, height: 0 };
      const [, s2] = sidesFor(a, probe);
      const [nx, ny] = NORMAL[s2];
      const n = this.addNode(at[0] - nx * w / 2, at[1] - ny * h / 2, { shape, color: a.type === 'text' ? a.color : this.color, size: [w, h] });
      this.link(a, n);
      this.sel = new Set([n.id]);
      this.render();
      this.edit(n, true);
    }
  }
  // Lined up with the others: the moving box's edges and middle to theirs.
  snap(m, dx, dy) {
    const lead = m.lead;
    const [x0, y0] = m.start.get(lead.id);
    const x = x0 + dx;
    const y = y0 + dy;
    const tol = SNAP / this.view.k;
    const xs = [x, x + lead.width / 2, x + lead.width];
    const ys = [y, y + lead.height / 2, y + lead.height];
    let bx = null;
    let by = null;
    for (const n of this.d.nodes) {
      if (m.ids.has(n.id) || !isBox(n)) continue;
      const nxs = [n.x, n.x + n.width / 2, n.x + n.width];
      const nys = [n.y, n.y + n.height / 2, n.y + n.height];
      for (const a of xs) for (const b of nxs) { const d = b - a; if (Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: b, n }; }
      for (const a of ys) for (const b of nys) { const d = b - a; if (Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: b, n }; }
    }
    const lines = [];
    const sy = by?.d || 0;
    const sx = bx?.d || 0;
    if (bx) { const y1 = Math.min(y + sy, bx.n.y) - 20; const y2 = Math.max(y + sy + lead.height, bx.n.y + bx.n.height) + 20; lines.push(svg('line', { x1: bx.at, y1, x2: bx.at, y2 })); }
    if (by) { const x1 = Math.min(x + sx, by.n.x) - 20; const x2 = Math.max(x + sx + lead.width, by.n.x + by.n.width) + 20; lines.push(svg('line', { x1, y1: by.at, x2, y2: by.at })); }
    this.guides.replaceChildren(...lines);
    return [sx, sy];
  }
  dbl(e) {
    if (this.presenting) return;
    // What is under the pointer, not the event's target: while the pointer
    // was held (a drag, a click) the board had it, and the double-click
    // comes to the board itself.
    const t = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    if (!this.el.contains(t) || this.writing(t) || t.closest?.('.board-bar, .board-help')) return;
    // The second click of a drag (moved, then let go): not a double-click on the plane.
    if (performance.now() - (this.draggedAt || 0) < 600) return;
    const n = this.hitNode(t);
    const at = this.toWorld(e);
    // A group: its name at the top; further in, a box in it.
    if (n && (n.type !== 'group' || at[1] < n.y + 40)) { this.edit(n); return; }
    const edg = t.closest?.('.board-edge') || (t.classList.contains('board-label') ? t : null);
    if (edg) { const ed = this.d.edges.find((x) => x.id === edg.dataset.id); if (ed) this.editEdge(ed); return; }
    this.begin();
    const m = this.addNode(at[0], at[1]);
    this.sel = new Set([m.id]);
    this.selEdge = null;
    this.render();
    this.edit(m, true);
  }
  wheel(e) {
    e.preventDefault();
    if (this.presenting) return;
    const r = this.el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      // A pinch sends small steps; a wheel notch (with ⌃ or ⌘) a large one: each zooms at most about 8%.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const step = Math.max(-0.08, Math.min(0.08, dy * 0.01));
      this.zoomAt(this.view.k * Math.exp(-step), e.clientX - r.left, e.clientY - r.top);
    } else {
      this.setView(this.view.x - e.deltaX, this.view.y - e.deltaY, this.view.k);
    }
  }

  // ---- the keys
  key(e) {
    const armed = !!this.armed && e.target === this.armed.el;
    if (e.target !== this.el && !armed) return;
    if (this.presenting) { this.presentKey(e); return; }
    // A syllable being composed: the box's.
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    const one = this.one();
    const edge = this.selEdge && this.d.edges.find((x) => x.id === this.selEdge);
    if (mod && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === 'z') { handled(); this.back(e.shiftKey); return; }
      if (lk === 'y') { handled(); this.back(true); return; }
      if (lk === 'a') { handled(); this.sel = new Set(this.d.nodes.filter(isBox).map((n) => n.id)); this.selEdge = null; this.render(); return; }
      if (lk === 'd') { handled(); const s = this.selected(); if (s.length) { this.begin(); this.duplicate(s); this.end(); } return; }
      if (lk === 'g') { handled(); this.toggleGroup(e.shiftKey); return; }
      if (DIRS[k] && one) { handled(); this.addFrom(one, DIRS[k]); return; }
      return; // ⌘C ⌘X ⌘V: copied, cut, pasted (below); the others are the app's
    }
    if (e.altKey && !mod) {
      // ⌥ and a key: the board's, by the key itself (⌥ makes other letters of them).
      const c = e.code;
      if (DIRS[k] && one) { handled(); this.addFrom(one, DIRS[k]); return; }
      if (e.shiftKey) {
        const a = { KeyL: 'left', KeyE: 'center', KeyR: 'right' }[c];
        if (a) { handled(); this.setAlign(a); return; }
        if (c === 'KeyD') { handled(); this.drawWords(); return; }
        return; // ⌥⇧C, copied as an image: the app's
      }
      if (SHAPE_CODES[c]) { handled(); this.setShape(SHAPE_CODES[c]); return; }
      if (/^Digit[0-6]$/.test(c)) { handled(); this.setColor(c === 'Digit0' ? null : c.slice(5)); return; }
      if (c === 'KeyP') { handled(); this.present(); return; }
      return;
    }
    if (k === 'Escape') { handled(); if (!this.help.hidden) this.help.hidden = true; else { this.sel = new Set(); this.selEdge = null; this.render(); } return; }
    if (k === 'Delete' || k === 'Backspace') { handled(); this.remove(); return; }
    if (k === 'Enter') { handled(); if (edge) this.editEdge(edge); else if (one) this.edit(one); return; }
    if (k === 'Tab') {
      handled();
      if (!one) { if (!this.d.nodes.length) this.dblAtCenter(); return; }
      if (one.type !== 'text') return;
      if (e.shiftKey) this.addSibling(one); else this.addFrom(one, 'right');
      return;
    }
    if (DIRS[k]) {
      handled();
      if (e.shiftKey) {
        const s = this.selected();
        if (!s.length) return;
        const [nx, ny] = NORMAL[DIRS[k]];
        this.begin();
        for (const n of s) { n.x += nx * 10; n.y += ny * 10; }
        this.end();
        return;
      }
      this.go(DIRS[k]);
      return;
    }
    // A key that writes: into the selected box.
    if (armed && k.length === 1) return;
    if (k === ' ') { handled(); this.space = true; this.el.classList.add('board-panning'); return; }
    if (e.shiftKey && (k === '!' || e.code === 'Digit1')) { handled(); this.fit(); return; }
    if (k === '=' || k === '+') { handled(); this.zoomAt(this.view.k * 1.2, this.el.clientWidth / 2, this.el.clientHeight / 2); return; }
    if (k === '-') { handled(); this.zoomAt(this.view.k / 1.2, this.el.clientWidth / 2, this.el.clientHeight / 2); return; }
    if (k === '?') { handled(); this.toggleHelp(); return; }
    if (/^[0-6]$/.test(k)) { handled(); this.setColor(k === '0' ? null : k); return; }
    if (edge && k.toLowerCase() === 'a') { handled(); this.cycleHeads(); return; }
    if (edge && k.toLowerCase() === 'l') { handled(); this.toggleDash(); return; }
    if (k.toLowerCase() === 'p' && !e.shiftKey) { handled(); this.present(); return; }
    if (e.shiftKey && this.sel.size) {
      const a = { L: 'left', C: 'center', E: 'center', R: 'right' }[k.toUpperCase()];
      if (a) { handled(); this.setAlign(a); return; }
    }
    if (SHAPE_KEYS[k.toLowerCase()] && !e.shiftKey) { handled(); this.setShape(SHAPE_KEYS[k.toLowerCase()]); }
  }
  dblAtCenter() {
    const [x, y] = [(this.el.clientWidth / 2 - this.view.x) / this.view.k, (this.el.clientHeight / 2 - this.view.y) / this.view.k];
    this.begin();
    const n = this.addNode(x, y);
    this.sel = new Set([n.id]);
    this.render();
    this.edit(n, true);
  }
  // To the nearest box that way (the selected one's, or the first).
  go(side) {
    const from = this.one();
    if (!from) {
      const first = reading(this.d.nodes.filter(isBox))[0];
      if (first) { this.sel = new Set([first.id]); this.selEdge = null; this.render(); this.reveal(first); }
      return;
    }
    const [nx, ny] = NORMAL[side];
    const cx = from.x + from.width / 2;
    const cy = from.y + from.height / 2;
    let best = null;
    for (const n of this.d.nodes) {
      if (n === from || !isBox(n)) continue;
      const dx = n.x + n.width / 2 - cx;
      const dy = n.y + n.height / 2 - cy;
      const along = dx * nx + dy * ny;
      if (along <= 0) continue;
      const across = Math.abs(dx * ny - dy * nx);
      const score = along + across * 2;
      if (!best || score < best.score) best = { n, score };
    }
    if (best) { this.sel = new Set([best.n.id]); this.selEdge = null; this.render(); this.reveal(best.n); }
  }

  // ---- copy, paste
  ours(e) { return e.target === this.el || (!!this.armed && this.armed.el.contains(e.target)); }
  copy(e) {
    if (this.editing || this.editingEdge || !this.ours(e)) return false;
    const nodes = this.selected();
    if (!nodes.length) return false;
    const ids = new Set(nodes.map((n) => n.id));
    const edges = this.d.edges.filter((x) => ids.has(x.fromNode) && ids.has(x.toNode));
    e.preventDefault();
    e.clipboardData.setData(CLIP, JSON.stringify({ nodes, edges }));
    e.clipboardData.setData('text/plain', nodes.map((n) => wordsOf(n)).filter(Boolean).join('\n\n'));
    return true;
  }
  paste(e) {
    if (this.editing || this.editingEdge || !this.ours(e)) return;
    const images = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (images.length && !e.clipboardData.getData(CLIP)) {
      e.preventDefault();
      this.addPictures(images, (this.el.clientWidth / 2 - this.view.x) / this.view.k, (this.el.clientHeight / 2 - this.view.y) / this.view.k);
      return;
    }
    const raw = e.clipboardData.getData(CLIP);
    const text = e.clipboardData.getData('text/plain');
    if (!raw && !text) return;
    e.preventDefault();
    this.begin();
    const cx = (this.el.clientWidth / 2 - this.view.x) / this.view.k;
    const cy = (this.el.clientHeight / 2 - this.view.y) / this.view.k;
    if (raw) {
      let got;
      try { got = JSON.parse(raw); } catch { this.before = null; return; }
      const nodes = (got.nodes || []).filter((n) => n && n.id);
      if (!nodes.length) { this.before = null; return; }
      const x1 = Math.min(...nodes.map((n) => n.x));
      const y1 = Math.min(...nodes.map((n) => n.y));
      const x2 = Math.max(...nodes.map((n) => n.x + n.width));
      const y2 = Math.max(...nodes.map((n) => n.y + n.height));
      const ids = new Map(nodes.map((n) => [n.id, newId()]));
      const dx = round(cx - (x1 + x2) / 2);
      const dy = round(cy - (y1 + y2) / 2);
      this.d.nodes.push(...nodes.map((n) => ({ ...n, id: ids.get(n.id), x: n.x + dx, y: n.y + dy })));
      for (const ed of got.edges || []) if (ids.has(ed.fromNode) && ids.has(ed.toNode)) this.d.edges.push({ ...ed, id: newId(), fromNode: ids.get(ed.fromNode), toNode: ids.get(ed.toNode) });
      this.sel = new Set(ids.values());
    } else if (this.diagram(text, { cx, cy })) {
      this.before = null; // its own change
      return;
    } else {
      // Words from elsewhere: a box each paragraph, one under another.
      const parts = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
      const made = parts.map((p, i) => this.addNode(cx, cy + i * (SIZE[this.tool][1] + 24), { text: p }));
      this.sel = new Set(made.map((n) => n.id));
      this.render();
      for (const n of made) { const t = this.els.get(n.id)?.textEl; if (t) this.grow(n, t); }
    }
    this.selEdge = null;
    this.end();
  }

  // ---- the picture
  // The selected boxes (with the arrows between them), or all of it.
  picture() {
    const pal = this.palette?.() || { bg: '#ffffff', bg2: '#f3f3f1', fg: '#24262b', fgDim: '#676b74', font: 'sans-serif' };
    const ids = this.sel.size ? new Set(this.sel) : null;
    // A group selected: what is in it too.
    if (ids) for (const g of this.selected().filter((n) => n.type === 'group')) for (const x of this.d.nodes) if (isBox(x) && inside(x, g)) ids.add(x.id);
    const made = boardSvg(this.d, pal, ids);
    return {
      selection: !!ids,
      count: ids ? ids.size : this.d.nodes.length,
      svg: async () => made.svg,
      png: () => svgPng(made.svg, made.width, made.height),
    };
  }

  // ---- presenting: from a box along its arrows, one box at a time
  // Where an arrow goes (its head's end; with heads at both ends or none, as drawn).
  outs(id) {
    const out = [];
    for (const e of this.d.edges) {
      const back = e.fromEnd === 'arrow' && (e.toEnd ?? 'arrow') === 'none';
      const from = back ? e.toNode : e.fromNode;
      const to = back ? e.fromNode : e.toNode;
      if (from !== id) continue;
      const n = this.node(to);
      if (n && isBox(n) && !out.includes(n)) out.push(n);
    }
    return reading(out);
  }
  roots() {
    const boxes = this.d.nodes.filter(isBox);
    const into = new Set();
    for (const n of boxes) for (const o of this.outs(n.id)) into.add(o.id);
    return reading(boxes.filter((n) => !into.has(n.id)));
  }
  present() {
    if (this.presenting) return;
    this.finishEdit();
    this.disarm();
    const boxes = this.d.nodes.filter(isBox);
    if (!boxes.length) { this.toast('Nothing on the board to present yet.'); return; }
    const start = this.one() && isBox(this.one()) ? this.one() : null;
    const first = start || this.roots()[0] || reading(boxes)[0];
    this.presenting = { fromSel: !!start, cur: first.id, visited: new Set([first.id]), stack: [], back: [], view: { ...this.view }, ended: false };
    this.sel = new Set();
    this.selEdge = null;
    this.help.hidden = true;
    this.el.classList.add('board-presenting');
    this.caption.hidden = false;
    this.onFull = () => {
      if (!this.presenting) return;
      if (document.fullscreenElement === this.el) { this.full = true; requestAnimationFrame(() => this.showStep()); } else if (this.full) this.endPresent();
    };
    this.onResize = () => { if (this.presenting) this.showStep(); };
    document.addEventListener('fullscreenchange', this.onFull);
    window.addEventListener('resize', this.onResize);
    this.full = false;
    this.el.requestFullscreen?.().catch(() => {});
    this.el.focus({ preventScroll: true });
    this.render();
    this.showStep();
  }
  endPresent() {
    const p = this.presenting;
    if (!p) return;
    this.presenting = null;
    document.removeEventListener('fullscreenchange', this.onFull);
    window.removeEventListener('resize', this.onResize);
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
    this.full = false;
    this.el.classList.remove('board-presenting');
    this.caption.hidden = true;
    this.sel = this.node(p.cur) ? new Set([p.cur]) : new Set();
    this.setView(p.view.x, p.view.y, p.view.k);
    this.el.focus({ preventScroll: true });
    this.render();
    const n = this.node(p.cur);
    if (n) this.reveal(n);
  }
  presentClass(n) {
    const p = this.presenting;
    if (!p) return '';
    if (n.type === 'group') return this.d.nodes.some((x) => x.id === p.cur && inside(x, n)) ? 'board-seen' : 'board-dim';
    if (n.id === p.cur) return 'board-now';
    if (!p.ended && this.outs(p.cur).some((x) => x.id === n.id)) return 'board-next';
    if (p.visited.has(n.id)) return 'board-seen';
    return 'board-dim';
  }
  presentEdgeClass(e) {
    const p = this.presenting;
    if (!p) return '';
    if ((e.fromNode === p.cur || e.toNode === p.cur) && !p.ended) return 'board-hot';
    if (p.visited.has(e.fromNode) && p.visited.has(e.toNode)) return 'board-seen';
    return 'board-dim';
  }
  // On: down the first arrow not taken yet (or the one chosen, 1–9); at an
  // end, back to a branch left behind; then (from the start) the boxes no
  // arrow led to.
  stepOn(choice = null) {
    const p = this.presenting;
    if (!p || p.ended) return;
    const outs = this.outs(p.cur).filter((n) => !p.visited.has(n.id));
    const was = { cur: p.cur, visited: new Set(p.visited), stack: [...p.stack] };
    let next = null;
    if (outs.length) {
      next = outs[choice != null && choice < outs.length ? choice : 0];
      for (const o of outs.filter((x) => x !== next).reverse()) p.stack.push(o.id);
    } else {
      while (p.stack.length && !next) { const id = p.stack.pop(); if (!p.visited.has(id)) next = this.node(id); }
      if (!next && !p.fromSel) {
        const boxes = this.d.nodes.filter(isBox);
        next = this.roots().find((n) => !p.visited.has(n.id)) || reading(boxes).find((n) => !p.visited.has(n.id)) || null;
      }
    }
    p.back.push(was);
    if (!next) { p.ended = true; this.showStep(); return; }
    p.cur = next.id;
    p.visited.add(next.id);
    this.showStep();
  }
  stepBack() {
    const p = this.presenting;
    if (!p) return;
    const was = p.back.pop();
    if (!was) return;
    Object.assign(p, was);
    p.ended = false;
    this.showStep();
  }
  showStep() {
    const p = this.presenting;
    if (!p) return;
    const cur = this.node(p.cur);
    if (!cur) { this.endPresent(); return; }
    this.render();
    // The box, and where it goes next, as large as they go.
    const near = p.ended ? [cur] : [cur, ...this.outs(cur.id)];
    const x1 = Math.min(...near.map((n) => n.x));
    const y1 = Math.min(...near.map((n) => n.y));
    const x2 = Math.max(...near.map((n) => n.x + n.width));
    const y2 = Math.max(...near.map((n) => n.y + n.height));
    this.look(x1, y1, x2, y2, { maxK: 1.8, pad: 80, top: 20, bottom: 70 });
    const total = this.d.nodes.filter(isBox).length;
    const first = (wordsOf(cur).split('\n')[0] || '…').slice(0, 80);
    const open = this.outs(cur.id).filter((n) => !p.visited.has(n.id));
    const parts = [el('b', '', first), el('span', 'board-caption-n', `${p.visited.size} / ${total}`)];
    if (p.ended) parts.push(el('span', 'board-caption-hint', 'The end · ← back · Esc'));
    else if (open.length > 1) parts.push(el('span', 'board-caption-hint', open.map((n, i) => `${i + 1} ${(wordsOf(n).split('\n')[0] || '…').slice(0, 24)}`).join(' · ')));
    else parts.push(el('span', 'board-caption-hint', 'Space → on · ← back · Esc'));
    this.caption.replaceChildren(...parts);
  }
  presentKey(e) {
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.metaKey || e.ctrlKey) return;
    if (k === 'Escape') { handled(); this.endPresent(); return; }
    if ([' ', 'ArrowRight', 'ArrowDown', 'Enter', 'PageDown'].includes(k)) { handled(); this.stepOn(); return; }
    if (['ArrowLeft', 'ArrowUp', 'Backspace', 'PageUp'].includes(k)) { handled(); this.stepBack(); return; }
    if (/^[1-9]$/.test(k)) { handled(); this.stepOn(Number(k) - 1); return; }
    if (k === 'Home') {
      handled();
      const p = this.presenting;
      while (p.back.length) Object.assign(p, p.back.pop());
      p.ended = false;
      this.showStep();
    }
  }
}
