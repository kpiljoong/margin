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
// click picks one (its grips show), a drag moves it (a box on a sketch with
// the words in it), a grip reshapes it (a box's corners, an arrow's ends and
// points; the dot in the middle of an arrow's part makes a new point, a
// point dragged straight goes); Delete takes the picked one out, Esc lets
// go. Each change rewrites its line, one ⌘Z.
//
// Several at once: Shift and a click picks one more (or one less), Shift and
// a drag picks the marks inside the band. A drag on one of them moves them
// all (on a sketch, arrows on a box moved go along); Delete takes them out;
// ⌘C / ⌘X copy (cut) their lines, and ⌘V puts marks' lines on the picture
// looked at, a little aside, picked.
//
// A double-click writes words: on words, they change (emptied, they go); in
// a box, its words (or new ones at its top left); elsewhere, new ones there.
//
// On a sketch, an arrow drawn to a box ends on the middle of the box's side
// nearest it (with the arrow tool on, the anchors of the box a press would
// take show before it), and a box moved or reshaped takes the arrow ends on
// its anchors along (public/ink.js: snapArrow, followBoxes).
//
// An elbow arrow finds its own way round the boxes; the dot in the middle of
// each of its parts moves that part across, and the way is then its own
// (its corners written; "Route it again" lets it find its way anew).

import { INK, inkLine, parseInk, simplify, markEl, movedMark, grips, reshapedMark, textSize, anchors, snapEnd, snapArrow, followBoxes, wordsIn, arrowMids, markBounds, elbowPoints, movedPart, ARROW_STYLES } from './ink.js';

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
    this.sel = null; // the marks picked: { pic: their picture's line, lines }
    this.band = null; // Shift and a drag: { fig, from, to, moved, line, el }
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
        const { lines } = this.sel;
        this.select(null);
        if (fig) this.c.h.onInk?.(fig, lines.length > 1 ? { removes: lines } : { remove: lines[0] });
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
    this.hover?.remove();
    this.draft = { fig: hit.fig, kind: this.tool, scale: hit.scale, pts: [hit.p], x: e.clientX, y: e.clientY, el: null };
    try { this.c.stage.setPointerCapture(e.pointerId); } catch { /* a pointer no longer down */ }
    return true;
  }

  move(e) {
    if (this.band) { this.stretch(e); return true; }
    if (this.edit) { this.drag(e); return true; }
    if (this.path && !this.draft) {
      const hit = this.path.fig.isConnected && this.at(e, this.path.fig);
      if (hit) { this.path.cursor = hit.p; this.previewPath(); }
      return true;
    }
    const d = this.draft;
    if (!d) { this.hoverAnchor(e); return false; }
    const hit = this.at(e, d.fig);
    if (!hit || d.kind === 'text' || d.kind === 'num' || d.kind === 'note') return true;
    if (d.kind === 'pen') d.pts.push(hit.p); else d.pts[1] = hit.p;
    this.preview();
    return true;
  }

  up(e) {
    if (this.band) return this.endBand();
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
    this.hover?.remove();
    this.hover = null;
    this.draft?.el?.remove();
    this.draft = null;
    this.path?.el?.remove();
    this.path = null;
    this.band?.el?.remove();
    this.band = null;
    if (this.edit) {
      this.edit.el?.remove();
      this.edit.g?.classList.remove('ink-moving');
      const svg = this.edit.fig.querySelector(':scope > .ink-marks');
      for (const line of [...(this.edit.follow || []).map(([l]) => l), ...(this.edit.group || []).map((m) => m.line)]) svg?.querySelector(`:scope > .ink-mark[data-line="${line}"]`)?.classList.remove('ink-moving');
      this.edit = null;
    }
  }

  // ---- changing a mark

  // A press on a mark (or a grip) of the picture looked at. → it's ours.
  grab(e) {
    // Shift: a band to pick marks with, or a mark more (or less).
    const on = !this.c.presenting && e.shiftKey && !e.target.closest?.('.ink-grip') && e.target.closest?.('.ink-figure.ink-editable');
    const start = on && this.at(e, on);
    if (start) {
      const g = e.target.closest('.ink-mark');
      this.band = { fig: on, from: start.p, to: start.p, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, line: g && g.dataset.line !== '' ? Number(g.dataset.line) : null, el: null };
      e.preventDefault();
      return true;
    }
    const t = !this.c.presenting && e.target.closest?.('.ink-grip, .ink-mark');
    const fig = t?.closest('.ink-figure.ink-editable');
    const g = t?.closest('.ink-mark') || fig?.querySelector(`:scope > .ink-marks > .ink-mark[data-line="${t?.dataset.line}"]`);
    const mark = fig && fig.inkMarks?.find((m) => String(m.line) === (t.dataset.line ?? g?.dataset.line));
    const hit = mark && this.at(e, fig);
    if (!hit) {
      if (this.sel && !e.target.closest?.('.ink-bar')) this.select(null);
      return false;
    }
    const grip = t.classList.contains('ink-grip') ? { i: Number(t.dataset.i), mid: t.dataset.mid != null, part: t.dataset.part != null ? Number(t.dataset.part) : null } : null;
    // One of several picked: they all go.
    const sel = this.sel?.pic === fig.dataset.line ? this.sel.lines : [];
    let group = !grip && sel.length > 1 && sel.includes(mark.line) ? fig.inkMarks.filter((m) => sel.includes(m.line)) : null;
    const keep = (group || [mark]).map((m) => m.line); // picked after
    // On a sketch, a box moved takes its words along.
    if (!grip && isBoard(fig)) {
      const img = fig.querySelector(':scope > img');
      const size = textSize(img.naturalWidth, img.naturalHeight);
      const moving = group || [mark];
      const words = [...new Set(moving.filter((m) => m.kind === 'box').flatMap((b) => wordsIn(fig.inkMarks, b, size)))].filter((w) => !moving.includes(w));
      if (words.length) group = [...moving, ...words];
    }
    // An elbow arrow's part: moved across from where it goes now.
    const gap = this.width(fig.querySelector(':scope > .ink-marks')) * 8;
    const route = grip?.part != null ? elbowPoints(mark, fig.inkMarks || [], gap) : null;
    this.edit = { fig, g, mark, grip, group, keep, route, gap, from: hit.p, scale: hit.scale, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, next: null, el: null };
    return true;
  }

  // The band stretched to the pointer.
  stretch(e) {
    const b = this.band;
    if (!b.moved) {
      if (Math.hypot(e.clientX - b.x, e.clientY - b.y) < 4) return;
      b.moved = true;
      try { this.c.stage.setPointerCapture(b.id); } catch { /* a pointer no longer down */ }
    }
    const hit = this.at(e, b.fig);
    const svg = b.fig.querySelector(':scope > .ink-marks');
    if (!hit || !svg) return;
    b.to = hit.p;
    const r = this.bandRect(b);
    b.el?.remove();
    b.el = this.maker()('rect', { class: 'ink-band', x: r.x, y: r.y, width: r.w, height: r.h, 'stroke-width': this.width(svg) * 0.6 });
    svg.append(b.el);
  }

  bandRect(b) {
    return { x: Math.min(b.from[0], b.to[0]), y: Math.min(b.from[1], b.to[1]), w: Math.abs(b.to[0] - b.from[0]), h: Math.abs(b.to[1] - b.from[1]) };
  }

  // The band let go: the marks wholly in it picked too (a click: the mark
  // under it picked, or let go).
  endBand() {
    const b = this.band;
    this.cancel();
    if (!b.fig.isConnected) return true;
    const had = this.sel?.pic === b.fig.dataset.line ? this.sel.lines : [];
    let lines;
    if (!b.moved) {
      if (b.line == null) return true;
      lines = had.includes(b.line) ? had.filter((l) => l !== b.line) : [...had, b.line];
    } else {
      const r = this.bandRect(b);
      const img = b.fig.querySelector(':scope > img');
      const inside = (b.fig.inkMarks || []).filter((m) => {
        const q = markBounds(m, img.naturalWidth, img.naturalHeight);
        return q.x >= r.x && q.y >= r.y && q.x + q.w <= r.x + r.w && q.y + q.h <= r.y + r.h;
      });
      lines = [...new Set([...had, ...inside.map((m) => m.line)])];
    }
    this.select(lines.length ? b.fig : null, lines);
    return true;
  }

  drag(e) {
    const ed = this.edit;
    if (!ed.moved) {
      if (Math.hypot(e.clientX - ed.x, e.clientY - ed.y) < 4) return;
      ed.moved = true;
      try { this.c.stage.setPointerCapture(ed.id); } catch { /* a pointer no longer down */ }
      ed.g?.classList.add('ink-moving');
      const svg = ed.fig.querySelector(':scope > .ink-marks');
      for (const m of ed.group || []) svg?.querySelector(`:scope > .ink-mark[data-line="${m.line}"]`)?.classList.add('ink-moving');
      this.c.stage.querySelectorAll('.ink-grips').forEach((x) => x.remove());
    }
    const hit = this.at(e, ed.fig);
    if (!hit) return;
    const [dx, dy] = [hit.p[0] - ed.from[0], hit.p[1] - ed.from[1]];
    const marks = ed.fig.inkMarks || [];
    let p = hit.p;
    let snap = null;
    // A sketch's arrow end dragged near a box: onto its anchor.
    if (isBoard(ed.fig) && ed.mark.kind === 'arrow' && ed.grip && !ed.grip.mid && ed.grip.part == null) {
      const last = grips(ed.mark).length - 1;
      if (ed.grip.i === 0 || ed.grip.i === last) {
        const other = snapEnd(ed.grip.i === 0 ? ed.mark.to : ed.mark.from, marks, 1);
        snap = snapEnd(p, marks, this.reach(ed.fig, ed.scale), other?.box);
        if (snap) p = snap.at;
      }
    }
    const olds = ed.group || [ed.mark];
    if (ed.group) ed.nexts = ed.group.map((m) => movedMark(m, dx, dy));
    else {
      const part = ed.grip?.part;
      if (part != null) {
        const [u, v] = [ed.route[part], ed.route[part + 1]];
        const way = movedPart(ed.route, part, [(u[0] + v[0]) / 2 + dx, (u[1] + v[1]) / 2 + dy], ed.gap);
        ed.next = { ...ed.mark, via: way.slice(1, -1) };
      } else {
        ed.next = ed.grip
          ? reshapedMark(ed.mark, ed.grip.i, p, { mid: ed.grip.mid, straight: 6 * ed.scale })
          : movedMark(ed.mark, dx, dy);
      }
      ed.nexts = [ed.next];
    }
    const svg = ed.fig.querySelector(':scope > .ink-marks');
    const sw = this.width(svg);
    const make = this.maker();
    ed.el?.remove();
    const after = marks.map((m) => ed.nexts[olds.indexOf(m)] || m);
    ed.el = make('g', { class: 'ink-draft' });
    for (const m of ed.nexts) ed.el.append(markEl(m, sw, make, after));
    if (snap) this.anchorDots(ed.el, snap.box, snap.at, sw, make);
    // A sketch's boxes: the arrows on their anchors go with them.
    for (const [line] of ed.follow || []) svg.querySelector(`:scope > .ink-mark[data-line="${line}"]`)?.classList.remove('ink-moving');
    const boxes = olds.map((m, i) => [m, ed.nexts[i]]).filter(([m]) => m.kind === 'box');
    ed.follow = isBoard(ed.fig) && boxes.length ? followBoxes(marks, boxes, olds.map((m) => m.line)) : [];
    for (const [line, m] of ed.follow) {
      svg.querySelector(`:scope > .ink-mark[data-line="${line}"]`)?.classList.add('ink-moving');
      ed.el.append(markEl(m, sw, make, after));
    }
    svg.append(ed.el);
  }

  // With the arrow tool on, over a sketch: the box an arrow pressed here
  // would start on (or a click end on), ringed, its anchors shown and the
  // one it takes filled.
  hoverAnchor(e) {
    this.hover?.remove();
    this.hover = null;
    if (this.tool !== 'arrow') return;
    const fig = e.target.closest?.('.ink-figure');
    const hit = fig && isBoard(fig) && this.at(e, fig);
    const s = hit && snapEnd(hit.p, fig.inkMarks || [], this.reach(fig, hit.scale));
    const svg = s && fig.querySelector(':scope > .ink-marks');
    if (!svg) return;
    const sw = this.width(svg);
    const make = this.maker();
    const b = s.box;
    const pad = sw * 1.5;
    this.hover = make('g', { class: 'ink-hover' });
    this.hover.append(make('rect', { class: 'ink-target', x: b.x - pad, y: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, rx: sw * 3, 'stroke-width': sw * 0.8 }));
    this.anchorDots(this.hover, b, s.at, sw, make);
    svg.append(this.hover);
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
    const olds = ed.group || [ed.mark];
    this.sel = { pic: ed.fig.dataset.line, lines: ed.keep };
    const nexts = ed.nexts || [];
    if (nexts.some((m, i) => inkLine(m) !== inkLine(olds[i]))) {
      if (nexts.length > 1 || ed.follow?.length) this.c.h.onInk?.(ed.fig, { sets: [...olds.map((m, i) => [m.line, nexts[i]]), ...ed.follow] });
      else this.c.h.onInk?.(ed.fig, { set: [ed.mark.line, nexts[0]] });
    }
    else this.drawGrips();
    return true;
  }

  // lines: a mark's line, or several.
  select(fig, lines) {
    this.sel = fig && lines != null ? { pic: fig.dataset.line, lines: [].concat(lines) } : null;
    this.drawGrips();
  }

  // ⌘C (cut: ⌘X): the marks picked, as their lines. → whether it did.
  copy(e, cut = false) {
    const fig = this.picked();
    const src = fig?.dataset.source.split('\n') || [];
    const lines = (this.sel?.lines || []).filter((l) => src[l] != null).sort((a, b) => a - b);
    if (!lines.length || !e.clipboardData) return false;
    e.clipboardData.setData('text/plain', lines.map((l) => src[l].trim()).join('\n'));
    e.preventDefault();
    if (cut) {
      this.select(null);
      this.c.h.onInk?.(fig, lines.length > 1 ? { removes: lines } : { remove: lines[0] });
    }
    return true;
  }

  // ⌘V of marks' lines (copied from a picture, or written): on the picture
  // looked at, a little aside, picked. → whether they were marks.
  paste(text) {
    const fig = !this.c.presenting && this.c.stage.querySelector('.ink-figure.ink-editable');
    const img = fig?.querySelector(':scope > img');
    if (!img?.naturalWidth) return false;
    const { marks, bad } = parseInk(text);
    if (!marks.length || bad.length) return false;
    const d = Math.round(Math.max(img.naturalWidth, img.naturalHeight) / 80);
    const lines = marks.map((m) => inkLine(movedMark(m, d, d)));
    const body = fig.dataset.inkLine === '' ? '' : (fig.dataset.source || '').replace(/\s+$/, '');
    const first = body ? body.split('\n').length : 0;
    this.cancel();
    this.c.h.onInk?.(fig, { add: lines.join('\n') });
    // Picked once the picture is drawn again with them.
    this.sel = { pic: fig.dataset.line, lines: lines.map((_, i) => first + i), soon: true };
    return true;
  }

  // The picture of the mark picked, while it is the one looked at.
  picked() {
    return this.sel && this.c.stage.querySelector(`.ink-figure.ink-editable[data-line="${this.sel.pic}"]`);
  }

  // The picked mark ringed, its grips on it (several: ringed, a frame
  // round them), again after the picture is drawn again. Another picture
  // looked at lets them go; while its own is being drawn again, they wait.
  drawGrips() {
    this.c.stage.querySelectorAll('.ink-grips').forEach((x) => x.remove());
    this.c.stage.querySelectorAll('.ink-mark.ink-picked').forEach((x) => x.classList.remove('ink-picked'));
    if (!this.sel) return;
    const looked = this.c.stage.querySelector('.ink-figure.ink-editable');
    if (looked && looked.dataset.line !== this.sel.pic) { this.sel = null; return; }
    const fig = this.picked();
    const svg = fig?.querySelector(':scope > .ink-marks');
    if (!svg) return;
    const picked = (fig.inkMarks || []).filter((m) => this.sel.lines.includes(m.line));
    if (!picked.length) { if (!this.sel.soon) this.sel = null; return; }
    this.sel = { pic: this.sel.pic, lines: picked.map((m) => m.line) };
    for (const m of picked) svg.querySelector(`:scope > .ink-mark[data-line="${m.line}"]`)?.classList.add('ink-picked');
    const sw = this.width(svg);
    const make = this.maker();
    const g = make('g', { class: 'ink-grips' });
    if (picked.length > 1) {
      const img = fig.querySelector(':scope > img');
      const bs = picked.map((m) => markBounds(m, img.naturalWidth, img.naturalHeight));
      const [x, y] = [Math.min(...bs.map((b) => b.x)), Math.min(...bs.map((b) => b.y))];
      const pad = sw * 3;
      g.append(make('rect', { class: 'ink-selbox', x: x - pad, y: y - pad, width: Math.max(...bs.map((b) => b.x + b.w)) - x + pad * 2, height: Math.max(...bs.map((b) => b.y + b.h)) - y + pad * 2, 'stroke-width': sw * 0.6, 'stroke-dasharray': `${sw * 3} ${sw * 2}` }));
      svg.append(g);
      return;
    }
    const mark = picked[0];
    const pts = grips(mark);
    const dot = (p, i, mid) => {
      const c = make('circle', { class: 'ink-grip', cx: p[0], cy: p[1], r: sw * (mid ? 1.8 : 2.6), 'stroke-width': sw * 0.8, 'data-line': mark.line, 'data-i': i });
      if (mid) c.dataset.mid = '';
      g.append(c);
    };
    if (mark.style === 'elbow') {
      // Its ends, and a dot in the middle of each part (long enough) to move it across.
      const way = elbowPoints(mark, fig.inkMarks || [], sw * 8);
      way.slice(1).forEach((q, k) => {
        const u = way[k];
        if (Math.abs(q[0] - u[0]) + Math.abs(q[1] - u[1]) < sw * 6) return;
        const c = make('circle', { class: `ink-grip ink-part ${u[1] === q[1] ? 'across' : 'down'}`, cx: (u[0] + q[0]) / 2, cy: (u[1] + q[1]) / 2, r: sw * 1.8, 'stroke-width': sw * 0.8, 'data-line': mark.line, 'data-part': k });
        g.append(c);
      });
      dot(pts[0], 0, false);
      dot(pts[pts.length - 1], pts.length - 1, false);
      svg.append(g);
      return;
    }
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
