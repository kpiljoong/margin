// Drawing on a picture in the canvas: a pen, an arrow, a box, words, and an
// eraser. Each mark finished is a line written in the picture's ```ink block
// (public/ink.js has the lines; the app writes them, one ⌘Z each).
//
// An arrow: a drag draws it from where it starts to where it ends. A click
// starts one point by point instead: each click a point on it, a
// double-click (or Enter, or a click on a box of a sketch) its end; Esc
// lets it go. A again, with the arrow on, changes its kind: straight
// (corners at the points), curved (through them), elbow (across and down).
//
// The tool bar shows when a picture is the one looked at, or a tool is on.
// Keys: D pen, A arrow (again: its kind), R box, T text, N numbered dot, H hide, E eraser,
// M a comment (kept beside the note, not drawn: the app has it), C colour,
// Esc: the tool off. With a tool on, a drag on a picture draws (beside it the
// canvas still pans); a click with T puts words there, with N the next
// number; with E a click on a mark takes it out.
//
// With no tool on, the marks of the picture looked at can be changed: a
// click picks one (its grips show), a drag moves it, a grip reshapes it (a
// box's corners, an arrow's ends and points; the dot in the middle of an
// arrow's part makes a new point, a point dragged straight goes); Delete takes
// the picked one out, Esc lets go. Each change rewrites its line, one ⌘Z.
//
// A double-click writes words: on words, they change (emptied, they go); in
// a box, its words (or new ones at its top left); elsewhere, new ones there.
//
// On a sketch, an arrow drawn to a box ends on the middle of the box's side
// nearest it (its anchors show), and a box moved or reshaped takes the
// arrow ends on its anchors along (public/ink.js: snapArrow, followBox).

import { INK, inkLine, simplify, markEl, movedMark, grips, reshapedMark, textSize, anchors, snapEnd, snapArrow, followBox, wordsIn, arrowMids, ARROW_STYLES } from './ink.js';

const SVG = 'http://www.w3.org/2000/svg';
export const TOOLS = [
  ['pen', '✎', 'Pen', 'D'],
  ['arrow', '↗', 'Arrow: drag, or click point by point (double-click ends)', 'A'],
  ['box', '▭', 'Box', 'R'],
  ['text', 'T', 'Words', 'T'],
  ['num', '\u2460', 'Numbered dot: click where it goes; item 1. of a numbered list in the section says what it is', 'N'],
  ['hide', '\u25A9', 'Hide a part: covered here, in a copy, and for an agent', 'H'],
  ['erase', '⌫', 'Eraser: click a mark', 'E'],
  ['note', '\u{1F4AC}', 'Comment: click where it goes (kept beside the note, as its other comments)', 'M'],
];
const KEYS = { d: 'pen', a: 'arrow', r: 'box', t: 'text', n: 'num', h: 'hide', e: 'erase', m: 'note' };

const isBoard = (fig) => fig?.dataset.board != null;

// An arrow's kinds, as the tool shows them.
export const ARROW_KINDS = { straight: ['↗', 'Straight'], curved: ['\u2934', 'Curved'], elbow: ['\u21B1', 'Elbow'] };

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
    this.tool = null; // 'pen' | 'arrow' | 'box' | 'text' | 'num' | 'hide' | 'erase' | 'note'
    this.color = 'red';
    this.draft = null; // the mark being drawn: { fig, kind, pts, el }
    this.path = null; // an arrow drawn point by point: { fig, scale, pts, cursor, el }
    this.arrowStyle = 'straight';
    this.edit = null; // a mark being moved or reshaped: { fig, mark, grip, from, next, el }
    this.sel = null; // the mark picked: { pic: its picture's line, line }
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
    this.paintArrow();
    this.dot = el('button', 'ink-tool ink-color');
    this.dot.type = 'button';
    this.dot.title = 'Colour (C)';
    this.dot.onclick = () => this.pickColor(this.dot.getBoundingClientRect());
    this.bar.append(this.dot);
    this.paintDot();
    // A picture drawn again (after a change): the mark picked, picked again.
    canvas.stage.addEventListener('inkdrawn', () => this.drawGrips());
  }

  // The bar: shown for a picture looked at, or while a tool is on.
  show(looking) {
    this.bar.hidden = !this.tool && !looking;
  }

  use(kind) {
    this.cancel();
    if (kind && this.sel) this.select(null);
    this.tool = kind;
    for (const [k, b] of this.buttons) b.classList.toggle('on', k === kind);
    const stage = this.c.stage;
    stage.classList.toggle('inking', !!kind);
    stage.classList.toggle('ink-erasing', kind === 'erase');
    if (kind) this.bar.hidden = false;
    else this.c.mark();
  }

  // The arrow tool's look: the kind it draws.
  paintArrow() {
    const b = this.buttons.get('arrow');
    const [icon, name] = ARROW_KINDS[this.arrowStyle];
    b.textContent = icon;
    b.title = `Arrow, ${name.toLowerCase()}: drag, or click point by point (double-click ends) (A; A again: the next kind)`;
  }

  // The arrow tool's next kind (straight, curved, elbow).
  nextArrow() {
    this.arrowStyle = ARROW_STYLES[(ARROW_STYLES.indexOf(this.arrowStyle) + 1) % ARROW_STYLES.length];
    this.paintArrow();
    this.c.h.onInkHint?.(`${ARROW_KINDS[this.arrowStyle][1]} arrows`);
    if (this.path) this.previewPath();
  }

  paintDot() {
    const [fill, line] = INK[this.color];
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
    if (this.path) {
      if (e.key === 'Escape') { this.cancel(); return true; }
      if (e.key === 'Enter') { this.endPath(); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.path.pts.length > 1) { this.path.pts.pop(); this.previewPath(); } else this.cancel();
        return true;
      }
    }
    if (e.key === 'Escape' && this.tool) { this.use(null); return true; }
    if (this.sel && !this.tool) {
      if (e.key === 'Escape') { this.select(null); return true; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const fig = this.picked();
        const { line } = this.sel;
        this.select(null);
        if (fig) this.c.h.onInk?.(fig, { remove: line });
        return true;
      }
    }
    if (!looking && !this.tool) return false;
    const kind = KEYS[e.key];
    if (kind === 'arrow' && this.tool === 'arrow') { this.nextArrow(); return true; }
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
    if (!this.tool && e.button === 0) return this.grab(e);
    if (!this.tool || e.button !== 0) return false;
    if (this.path) { e.preventDefault(); this.pathClick(e); this.pathDown = true; return true; }
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
    if (this.edit) { this.drag(e); return true; }
    if (this.path && !this.draft) {
      const hit = this.path.fig.isConnected && this.at(e, this.path.fig);
      if (hit) { this.path.cursor = hit.p; this.previewPath(); }
      return true;
    }
    const d = this.draft;
    if (!d) return false;
    const hit = this.at(e, d.fig);
    if (!hit || d.kind === 'text' || d.kind === 'num' || d.kind === 'note') return true;
    if (d.kind === 'pen') d.pts.push(hit.p); else d.pts[1] = hit.p;
    this.preview();
    return true;
  }

  up(e) {
    if (this.edit) return this.drop();
    if (this.pathDown) { this.pathDown = false; return true; }
    const d = this.draft;
    if (!d) return false;
    this.draft = null;
    d.el?.remove();
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
    // An arrow clicked, not dragged: drawn point by point from there.
    if (d.kind === 'arrow' && !moved) { this.path = { fig: d.fig, scale: d.scale, pts: [d.pts[0]], cursor: null, el: null }; return true; }
    if (d.kind === 'text') { if (!moved) this.words(d); return true; }
    if (d.kind === 'note') {
      // One comment, then the tool is put down.
      if (moved) return true;
      const [x, y] = d.pts[0].map(Math.round);
      this.use(null);
      this.c.h.onInkComment?.(d.fig, [x, y], this.spot(d.fig, x, y));
      return true;
    }
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
    this.path?.el?.remove();
    this.path = null;
    if (this.edit) {
      this.edit.el?.remove();
      this.edit.g?.classList.remove('ink-moving');
      const svg = this.edit.fig.querySelector(':scope > .ink-marks');
      for (const [line] of this.edit.follow || []) svg?.querySelector(`:scope > .ink-mark[data-line="${line}"]`)?.classList.remove('ink-moving');
      this.edit = null;
    }
  }

  // ---- changing a mark

  // A press on a mark (or a grip) of the picture looked at. → it's ours.
  grab(e) {
    const t = !this.c.presenting && e.target.closest?.('.ink-grip, .ink-mark');
    const fig = t?.closest('.ink-figure.ink-editable');
    const g = t?.closest('.ink-mark') || fig?.querySelector(`:scope > .ink-marks > .ink-mark[data-line="${t?.dataset.line}"]`);
    const mark = fig && fig.inkMarks?.find((m) => String(m.line) === (t.dataset.line ?? g?.dataset.line));
    const hit = mark && this.at(e, fig);
    if (!hit) {
      if (this.sel && !e.target.closest?.('.ink-bar')) this.select(null);
      return false;
    }
    const grip = t.classList.contains('ink-grip') ? { i: Number(t.dataset.i), mid: t.dataset.mid != null } : null;
    this.edit = { fig, g, mark, grip, from: hit.p, scale: hit.scale, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, next: null, el: null };
    return true;
  }

  drag(e) {
    const ed = this.edit;
    if (!ed.moved) {
      if (Math.hypot(e.clientX - ed.x, e.clientY - ed.y) < 4) return;
      ed.moved = true;
      try { this.c.stage.setPointerCapture(ed.id); } catch { /* a pointer no longer down */ }
      ed.g?.classList.add('ink-moving');
      this.c.stage.querySelectorAll('.ink-grips').forEach((x) => x.remove());
    }
    const hit = this.at(e, ed.fig);
    if (!hit) return;
    const [dx, dy] = [hit.p[0] - ed.from[0], hit.p[1] - ed.from[1]];
    const marks = ed.fig.inkMarks || [];
    let p = hit.p;
    let snap = null;
    // A sketch's arrow end dragged near a box: onto its anchor.
    if (isBoard(ed.fig) && ed.mark.kind === 'arrow' && ed.grip && !ed.grip.mid) {
      const last = grips(ed.mark).length - 1;
      if (ed.grip.i === 0 || ed.grip.i === last) {
        const other = snapEnd(ed.grip.i === 0 ? ed.mark.to : ed.mark.from, marks, 1);
        snap = snapEnd(p, marks, this.reach(ed.fig, ed.scale), other?.box);
        if (snap) p = snap.at;
      }
    }
    ed.next = ed.grip
      ? reshapedMark(ed.mark, ed.grip.i, p, { mid: ed.grip.mid, straight: 6 * ed.scale })
      : movedMark(ed.mark, dx, dy);
    const svg = ed.fig.querySelector(':scope > .ink-marks');
    const sw = this.width(svg);
    const make = this.maker();
    ed.el?.remove();
    const after = marks.map((m) => (m === ed.mark ? ed.next : m));
    ed.el = markEl(ed.next, sw, make, after);
    ed.el.classList.add('ink-draft');
    if (snap) this.anchorDots(ed.el, snap.box, snap.at, sw, make);
    // A sketch's box: the arrows on its anchors go with it.
    for (const [line] of ed.follow || []) svg.querySelector(`:scope > .ink-mark[data-line="${line}"]`)?.classList.remove('ink-moving');
    ed.follow = isBoard(ed.fig) && ed.mark.kind === 'box' ? followBox(marks, ed.mark, ed.next) : [];
    for (const [line, m] of ed.follow) {
      svg.querySelector(`:scope > .ink-mark[data-line="${line}"]`)?.classList.add('ink-moving');
      ed.el.append(markEl(m, sw, make, after));
    }
    svg.append(ed.el);
  }

  // How near a box an arrow's end snaps to it (picture pixels).
  reach(fig, scale) {
    const img = fig.querySelector(':scope > img');
    return Math.max(textSize(img.naturalWidth, img.naturalHeight) * 1.5, 24 * scale);
  }

  // A box's anchors, over the mark being drawn; the one taken, filled.
  anchorDots(g, box, at, sw, make) {
    for (const q of anchors(box)) {
      const on = q[0] === at[0] && q[1] === at[1];
      g.append(make('circle', { class: `ink-anchor${on ? ' on' : ''}`, cx: q[0], cy: q[1], r: sw * (on ? 2.4 : 1.8), 'stroke-width': sw * 0.7 }));
    }
  }

  // → whether it was a drag (a click goes on to pick: a dot's item, say).
  drop() {
    const ed = this.edit;
    this.cancel();
    if (!ed.moved) { this.select(ed.fig, ed.mark.line); return false; }
    this.sel = { pic: ed.fig.dataset.line, line: ed.mark.line };
    const at = (m) => inkLine(m);
    if (ed.next && at(ed.next) !== at(ed.mark)) {
      if (ed.follow?.length) this.c.h.onInk?.(ed.fig, { sets: [[ed.mark.line, ed.next], ...ed.follow] });
      else this.c.h.onInk?.(ed.fig, { set: [ed.mark.line, ed.next] });
    }
    else this.drawGrips();
    return true;
  }

  select(fig, line) {
    this.sel = fig ? { pic: fig.dataset.line, line } : null;
    this.drawGrips();
  }

  // The picture of the mark picked, while it is the one looked at.
  picked() {
    return this.sel && this.c.stage.querySelector(`.ink-figure.ink-editable[data-line="${this.sel.pic}"]`);
  }

  // The picked mark ringed, its grips on it (again after the picture is
  // drawn again). Another picture looked at lets it go; while its own is
  // being drawn again, it waits.
  drawGrips() {
    this.c.stage.querySelectorAll('.ink-grips').forEach((x) => x.remove());
    this.c.stage.querySelectorAll('.ink-mark.ink-picked').forEach((x) => x.classList.remove('ink-picked'));
    if (!this.sel) return;
    const looked = this.c.stage.querySelector('.ink-figure.ink-editable');
    if (looked && looked.dataset.line !== this.sel.pic) { this.sel = null; return; }
    const fig = this.picked();
    const svg = fig?.querySelector(':scope > .ink-marks');
    if (!svg) return;
    const mark = fig.inkMarks?.find((m) => m.line === this.sel.line);
    if (!mark) { this.sel = null; return; }
    svg.querySelector(`:scope > .ink-mark[data-line="${mark.line}"]`)?.classList.add('ink-picked');
    const sw = this.width(svg);
    const make = this.maker();
    const g = make('g', { class: 'ink-grips' });
    const pts = grips(mark);
    const dot = (p, i, mid) => {
      const c = make('circle', { class: 'ink-grip', cx: p[0], cy: p[1], r: sw * (mid ? 1.8 : 2.6), 'stroke-width': sw * 0.8, 'data-line': mark.line, 'data-i': i });
      if (mid) c.dataset.mid = '';
      g.append(c);
    };
    if (mark.kind === 'arrow') arrowMids(mark).forEach((p, i) => dot(p, i, true));
    pts.forEach((p, i) => dot(p, i, false));
    svg.append(g);
  }

  width(svg) {
    const vb = svg.viewBox.baseVal;
    return Math.max(2, Math.round(Math.max(vb.width, vb.height) / 320));
  }

  maker() {
    return (tag, attrs) => {
      const x = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, String(v));
      return x;
    };
  }

  markOf(d) {
    const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
    const color = this.color;
    if (d.kind === 'pen') return { kind: 'pen', color, pts: simplify(d.pts, 1.2 * d.scale).map(([x, y]) => [Math.round(x), Math.round(y)]) };
    if (d.kind === 'arrow') return this.arrowOf(d.fig, d.pts, d.scale);
    return { kind: d.kind === 'hide' ? 'hide' : 'box', color: d.kind === 'hide' ? 'gray' : color, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
  }

  // An arrow through the points, of the kind the tool draws (on a sketch,
  // its ends on the boxes near them).
  arrowOf(fig, pts, scale) {
    const r = ([x, y]) => [Math.round(x), Math.round(y)];
    const style = this.arrowStyle;
    const arrow = { kind: 'arrow', color: this.color, style, from: r(pts[0]), to: r(pts[pts.length - 1]), via: style === 'elbow' ? [] : pts.slice(1, -1).map(r) };
    return isBoard(fig) ? snapArrow(arrow, fig.inkMarks || [], this.reach(fig, scale)) : arrow;
  }

  // A click while an arrow is drawn point by point: a point; on (or next
  // to) the last one — a double-click — or on a box of a sketch, its end;
  // off the picture, the end at the last point.
  pathClick(e) {
    const P = this.path;
    const hit = P.fig.isConnected && this.at(e, P.fig);
    if (!hit) { this.endPath(); return; }
    const last = P.pts[P.pts.length - 1];
    if (Math.hypot(hit.p[0] - last[0], hit.p[1] - last[1]) < 6 * hit.scale) { this.endPath(); return; }
    P.pts.push(hit.p);
    const marks = P.fig.inkMarks || [];
    const reach = this.reach(P.fig, P.scale);
    const onBox = isBoard(P.fig) && snapEnd(hit.p, marks, reach, snapEnd(P.pts[0], marks, reach)?.box);
    if (onBox || this.arrowStyle === 'elbow') this.endPath();
    else { P.cursor = null; this.previewPath(); }
  }

  // The arrow drawn point by point, written.
  endPath() {
    const P = this.path;
    this.cancel();
    if (!P || P.pts.length < 2 || !P.fig.isConnected) return;
    this.c.h.onInk?.(P.fig, { add: inkLine(this.arrowOf(P.fig, P.pts, P.scale)) });
  }

  previewPath() {
    const P = this.path;
    const pts = P.cursor ? [...P.pts, P.cursor] : P.pts;
    P.el?.remove();
    P.el = null;
    if (pts.length < 2) return;
    P.el = this.draw(P.fig, this.arrowOf(P.fig, pts, P.scale));
  }

  // The mark so far, drawn over the picture.
  preview() {
    const d = this.draft;
    d.el?.remove();
    d.el = this.draw(d.fig, this.markOf(d));
  }

  // A mark not written yet, drawn over the picture (an arrow on a sketch:
  // the anchors of the boxes its ends went to). → its element.
  draw(fig, mark) {
    const svg = fig.querySelector(':scope > .ink-marks');
    if (!svg) return null;
    const sw = this.width(svg);
    const make = this.maker();
    const marks = fig.inkMarks || [];
    const g = markEl(mark, sw, make, marks);
    g.classList.add('ink-draft');
    if (mark.kind === 'arrow' && isBoard(fig)) {
      for (const p of [mark.from, mark.to]) {
        const s = snapEnd(p, marks, 0);
        if (s) this.anchorDots(g, s.box, s.at, sw, make);
      }
    }
    svg.append(g);
    return g;
  }

  // A double-click with no tool on (fig: the picture): words there.
  write(e, fig) {
    const hit = this.at(e, fig);
    if (!hit) return;
    const img = fig.querySelector(':scope > img');
    const size = textSize(img.naturalWidth, img.naturalHeight);
    const marks = fig.inkMarks || [];
    const g = e.target.closest?.('.ink-mark');
    const on = g && marks.find((m) => m.kind === 'text' && String(m.line) === g.dataset.line);
    const box = !on && marks.filter((m) => m.kind === 'box' && hit.p[0] >= m.x && hit.p[0] <= m.x + m.w && hit.p[1] >= m.y && hit.p[1] <= m.y + m.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const words = on || (box && wordsIn(marks, box, size)[0]);
    this.select(null);
    if (words) {
      this.c.typeOver(this.spot(fig, words.x, words.y, 70, size / 2), words.text, (text) => {
        if (text === words.text) return;
        this.c.h.onInk?.(fig, text ? { set: [words.line, { ...words, text }] } : { remove: words.line });
      }, 'Words (empty: none)');
      return;
    }
    const [x, y] = (box ? [box.x + size * 0.4, box.y + size * 0.4] : hit.p).map(Math.round);
    this.c.typeOver(this.spot(fig, x, y, 70, size / 2), '', (text) => {
      if (text) this.c.h.onInk?.(fig, { add: inkLine({ kind: 'text', color: this.color, x, y, text }) });
    }, box ? 'Words in the box' : 'Words on the picture');
  }

  // Where on the screen a point of a picture is, as it moves: () → a rect
  // (dx, dy from the point, w wide), or null once the picture is gone.
  spot(fig, x, y, dx = 0, dy = 0, w = 0) {
    const img = fig.querySelector(':scope > img');
    return () => {
      if (!img?.isConnected) return null;
      const r = img.getBoundingClientRect();
      const k = r.width / img.naturalWidth;
      return { left: r.left + x * k + dx, top: r.top + y * k + dy, width: w, height: 0 };
    };
  }

  // Words where the picture was clicked.
  words(d) {
    const [x, y] = d.pts[0];
    this.c.typeOver(this.spot(d.fig, x, y, 70, 16), '', (text) => {
      if (text) this.c.h.onInk?.(d.fig, { add: inkLine({ kind: 'text', color: this.color, x, y, text }) });
    }, 'Words on the picture');
  }
}
