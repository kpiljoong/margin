// Drawing on a picture in the canvas: a pen, an arrow, a box, words, and an
// eraser. Each mark finished is a line written in the picture's ```ink block
// (public/ink.js has the lines; the app writes them, one ⌘Z each).
//
// The tool bar shows when a picture is the one looked at, or a tool is on.
// Keys: D pen, A arrow, R box, T text, N numbered dot, E eraser, C colour,
// Esc: the tool off. With a tool on, a drag on a picture draws (beside it the
// canvas still pans); a click with T puts words there, with N the next
// number; with E a click on a mark takes it out.

import { COLORS } from './flow.js';
import { inkLine, simplify, markEl } from './ink.js';

const SVG = 'http://www.w3.org/2000/svg';
export const TOOLS = [
  ['pen', '✎', 'Pen', 'D'],
  ['arrow', '↗', 'Arrow', 'A'],
  ['box', '▭', 'Box', 'R'],
  ['text', 'T', 'Words', 'T'],
  ['num', '\u2460', 'Numbered dot: click where it goes; item 1. of a numbered list in the section says what it is', 'N'],
  ['erase', '⌫', 'Eraser: click a mark', 'E'],
];
const KEYS = { d: 'pen', a: 'arrow', r: 'box', t: 'text', n: 'num', e: 'erase' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export class InkTools {
  // canvas: the FigureCanvas; its handlers give onInk(fig, change, words?) and
  // onInkColor(at, color, pick).
  constructor(canvas) {
    this.c = canvas;
    this.tool = null; // 'pen' | 'arrow' | 'box' | 'text' | 'num' | 'erase'
    this.color = 'red';
    this.draft = null; // the mark being drawn: { fig, kind, pts, el }
    this.bar = el('div', 'ink-bar');
    this.bar.hidden = true;
    this.buttons = new Map();
    for (const [kind, icon, label, key] of TOOLS) {
      const b = el('button', 'ink-tool', icon);
      b.type = 'button';
      b.title = `${label} (${key})`;
      b.onclick = () => this.use(this.tool === kind ? null : kind);
      this.buttons.set(kind, b);
      this.bar.append(b);
    }
    this.dot = el('button', 'ink-tool ink-color');
    this.dot.type = 'button';
    this.dot.title = 'Colour (C)';
    this.dot.onclick = () => this.pickColor(this.dot.getBoundingClientRect());
    this.bar.append(this.dot);
    this.paintDot();
  }

  // The bar: shown for a picture looked at, or while a tool is on.
  show(looking) {
    this.bar.hidden = !this.tool && !looking;
  }

  use(kind) {
    this.cancel();
    this.tool = kind;
    for (const [k, b] of this.buttons) b.classList.toggle('on', k === kind);
    const stage = this.c.stage;
    stage.classList.toggle('inking', !!kind);
    stage.classList.toggle('ink-erasing', kind === 'erase');
    if (kind) this.bar.hidden = false;
    else this.c.mark();
  }

  paintDot() {
    const [fill, line] = COLORS[this.color];
    this.dot.style.background = line;
    this.dot.style.borderColor = fill;
  }

  pickColor(r) {
    this.c.h.onInkColor?.({ x: r.left, y: r.bottom + 6 }, this.color, (color) => {
      this.color = color;
      this.paintDot();
      if (!this.tool) this.use('pen');
    });
  }

  // A key, while a picture is looked at (or a tool is on). → used it.
  key(e, looking) {
    if (e.key === 'Escape' && this.tool) { this.use(null); return true; }
    if (!looking && !this.tool) return false;
    const kind = KEYS[e.key];
    if (kind) { this.use(this.tool === kind ? null : kind); return true; }
    if (e.key === 'c') { this.pickColor(this.bar.getBoundingClientRect()); return true; }
    return false;
  }

  // The picture under a pointer event, and where on it (its pixels).
  at(e, fig = e.target.closest?.('.ink-figure')) {
    const img = fig?.querySelector(':scope > img');
    if (!img?.naturalWidth) return null;
    const r = img.getBoundingClientRect();
    const scale = img.naturalWidth / r.width;
    return { fig, scale, p: [(e.clientX - r.left) * scale, (e.clientY - r.top) * (img.naturalHeight / r.height)] };
  }

  // → whether the pointer is the pen's now.
  down(e) {
    if (!this.tool || e.button !== 0) return false;
    const hit = this.at(e);
    if (!hit) return false;
    e.preventDefault();
    if (this.tool === 'erase') {
      const m = e.target.closest('.ink-mark');
      if (m && m.dataset.line !== '') this.c.h.onInk?.(hit.fig, { remove: Number(m.dataset.line) });
      return true;
    }
    this.draft = { fig: hit.fig, kind: this.tool, scale: hit.scale, pts: [hit.p], x: e.clientX, y: e.clientY, el: null };
    try { this.c.stage.setPointerCapture(e.pointerId); } catch { /* a pointer no longer down */ }
    return true;
  }

  move(e) {
    const d = this.draft;
    if (!d) return false;
    const hit = this.at(e, d.fig);
    if (!hit || d.kind === 'text' || d.kind === 'num') return true;
    if (d.kind === 'pen') d.pts.push(hit.p); else d.pts[1] = hit.p;
    this.preview();
    return true;
  }

  up(e) {
    const d = this.draft;
    if (!d) return false;
    this.draft = null;
    d.el?.remove();
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    if (d.kind === 'text') { if (!moved) this.words(d); return true; }
    if (d.kind === 'num') {
      // The next number on this picture.
      const n = Math.max(0, ...(d.fig.inkMarks || []).filter((m) => m.kind === 'num' && /^\d+$/.test(m.text)).map((m) => Number(m.text))) + 1;
      if (!moved) this.c.h.onInk?.(d.fig, { add: inkLine({ kind: 'num', color: this.color, x: Math.round(d.pts[0][0]), y: Math.round(d.pts[0][1]), text: String(n) }) });
      return true;
    }
    if (!moved || d.pts.length < 2) return true;
    const mark = this.markOf(d);
    if (mark) this.c.h.onInk?.(d.fig, { add: inkLine(mark) });
    return true;
  }

  cancel() {
    this.draft?.el?.remove();
    this.draft = null;
  }

  markOf(d) {
    const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
    const color = this.color;
    if (d.kind === 'pen') return { kind: 'pen', color, pts: simplify(d.pts, 1.2 * d.scale).map(([x, y]) => [Math.round(x), Math.round(y)]) };
    if (d.kind === 'arrow') return { kind: 'arrow', color, from: a, to: b };
    return { kind: 'box', color, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  }

  // The mark so far, drawn over the picture.
  preview() {
    const d = this.draft;
    const svg = d.fig.querySelector(':scope > .ink-marks');
    if (!svg) return;
    d.el?.remove();
    const vb = svg.viewBox.baseVal;
    const sw = Math.max(2, Math.round(Math.max(vb.width, vb.height) / 320));
    const make = (tag, attrs) => {
      const x = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, String(v));
      return x;
    };
    d.el = markEl(this.markOf(d), sw, make);
    d.el.classList.add('ink-draft');
    svg.append(d.el);
  }

  // Words where the picture was clicked.
  words(d) {
    const [x, y] = d.pts[0];
    const img = d.fig.querySelector(':scope > img');
    const rect = () => {
      if (!img.isConnected) return null;
      const r = img.getBoundingClientRect();
      const k = r.width / img.naturalWidth;
      return { left: r.left + x * k + 70, top: r.top + y * k + 16, width: 0, height: 0 };
    };
    this.c.typeOver(rect, '', (text) => {
      if (text) this.c.h.onInk?.(d.fig, { add: inkLine({ kind: 'text', color: this.color, x, y, text }) });
    }, 'Words on the picture');
  }
}
