// The canvas view: a note's pictures on a surface beside the editor. Each
// picture (a ```flow / ```mermaid block, an embed) is a card; the cards of a
// section (heading) sit side by side in a frame titled with the heading, and
// the frames go down in note order. The note stays the source — the canvas
// only shows it.
//
// Two ways of looking, each remembering its own zoom (changed with the
// wheel, a pinch or − +):
//   · picture: the camera goes to the picture the cursor is on (target()),
//     and to the boxes of the line it is on;
//   · all: every picture; the camera stays while the cursor moves.
// Clicking a picture looks at it and puts the cursor on its line, clicking a
// box selects its text in the note, and a double-click on a box renames it
// (the app rewrites the note).
//
// Links: boxes of different ```flow pictures with the same name are the same
// thing, so a dashed line joins them (in note order). Linked boxes carry a
// dot; the lines show for the boxes of the cursor's line and the box under
// the pointer, or all of them ("Links"). Clicking a line goes to its other end.
//
// Drawing: a ```flow picture written in this note is drawn on as well, and
// each change is written in its text (the app does that, public/flowedit.js).
// A box under the pointer shows a + on the side the picture runs to: a
// click adds a box after it, a drag draws an arrow to another box (or, let
// go on nothing, to a new one). A click selects a box (the cursor goes to
// its text, the keys stay here): Tab adds a box after it, Enter renames,
// C colours, S shapes, Delete takes it out; N or a double-click on the picture adds a
// box on its own, and a right-click lists it all. A click on an arrow
// selects it: Delete takes it out, B makes it go both ways (or one again),
// R turns it round, D dots it, Enter puts words on it.
//
// Pictures are the preview's own elements, drawn by public/diagrams.js; each
// diagram reports where its boxes are ('diagram-shown'), and a transparent
// layer of hit boxes goes over it.

import { similarNames } from './flow.js';
import { store } from './store.js';
import { InkTools } from './inkdraw.js';

const el = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.filter((k) => k != null));
  return e;
};

const ZOOM_KEY = 'an.canvasZoom';
const LINKS_KEY = 'an.canvasLinks';
const SVG = 'http://www.w3.org/2000/svg';
const same = (a, b) => !!a && !!b && a.pre === b.pre && a.id === b.id;

// A curve from box a to box b (world coordinates). Between pictures of one
// section (side by side) it leaves from the sides that face each other;
// between sections it bows out past the right edge of both pictures
// (`outer`), rather than across them.
function linkPath(a, b, outer = null) {
  if (outer != null) {
    const x1 = a.x + a.w; const y1 = a.y + a.h / 2;
    const x2 = b.x + b.w; const y2 = b.y + b.h / 2;
    const c = outer + 48;
    return `M${x1},${y1} C${c},${y1} ${c},${y2} ${x2},${y2}`;
  }
  const ax = a.x + a.w / 2; const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2; const by = b.y + b.h / 2;
  if (Math.abs(bx - ax) > Math.abs(by - ay)) {
    const d = Math.sign(bx - ax) || 1;
    const x1 = ax + (d * a.w) / 2; const x2 = bx - (d * b.w) / 2;
    const c = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${ay} C${x1 + d * c},${ay} ${x2 - d * c},${by} ${x2},${by}`;
  }
  const d = Math.sign(by - ay) || 1;
  const y1 = ay + (d * a.h) / 2; const y2 = by - (d * b.h) / 2;
  const c = Math.max(40, Math.abs(y2 - y1) / 2);
  return `M${ax},${y1} C${ax},${y1 + d * c} ${bx},${y2 - d * c} ${bx},${y2}`;
}
const PAD = 40;
const SETTLE = 800; // ms after the pictures last changed before the camera catches up
// The keys that change the selection's picture (see editKey).
const EDIT_KEYS = new Set(['Tab', 'Enter', 'F2', 'Delete', 'Backspace', 'c', 'n', 's', 'b', 'r', 'd']);
const RENAME_TIP = 'Click: select it in the note · Double-click: rename';

export class FigureCanvas {
  // onNode(pre, id) · onSection(section) · onFigure(fig) · canRename(pre) ·
  // onRename(pre, node, text) · onHover(pre, id) (null, null when it leaves) ·
  // onEscape() · here() → the ```flow box at the cursor { pre, id } ·
  // onStep(pre, id): put the cursor on a box, keeping the focus here ·
  // tour() → the steps to present (see present) ·
  // drawing: canEdit(pre) · onAddAfter(pre, id) · onAddBox(pre) ·
  // onConnect(pre, from, to) · onDelete(pre, id) · onColorMenu(pre, id, at) ·
  // onBoxMenu(e, pre, id) · onCardMenu(e, pre) · onNewFlow() · onUndo(redo) ·
  // onArrow(pre, { from, to }, what, arg): what is delete, both, reverse,
  // dotted, label (arg: the words) or menu (arg: the event) ·
  // onArrowStep(pre, from, to): put the cursor on an arrow · onShapeMenu(pre, id, at) ·
  // pictures: onInk(fig, { add: line } | { remove: lineNo }) · onInkColor(at, color, pick)
  // · onInkHover(fig, num) (null, null when it leaves) · onInkDot(fig, num): a numbered dot clicked
  // · onPastePictures(files) (⌘V of a picture here)
  constructor(handlers) {
    this.h = handlers;
    this.k = 1; this.x = 0; this.y = 0;
    this.fresh = true; // no camera position yet
    this.view = 'picture'; // or 'all'
    try { this.zoomFor = { picture: null, allRatio: null, ...JSON.parse(store.getItem(ZOOM_KEY) || '{}') }; } catch { this.zoomFor = { picture: null, allRatio: null }; }
    this.sig = null; // what the camera was last moved to
    this.goal = null; // { section, fig, nodes: [{ pre, id }] }
    this.sections = [];
    this.animEnd = 0;
    this.links = null; // [[{ pre, id }, { pre, id }]]
    this.hover = null; // the box under the pointer: { pre, id }
    this.pin = null; // the box kept still while the pictures redraw (pinBox)
    this.pending = null; // a box to select (and rename) once its picture is drawn again
    this.keep = null; // the box selected before the pictures were made again
    this.edgeAt = null; // the arrow selected: { pre, from, to } (box ids)
    this.edgeSoon = null; // an arrow to select once its picture is drawn again
    // A change written, its picture not drawn again yet: keys for the
    // selection wait for it ({ line, until }, the keys).
    this.busy = null;
    this.queued = [];
    // Following the flow with the keys: the box walked to, the steps taken
    // (to go back), and the ways offered at a branch.
    this.walkAt = null; // { pre, id }
    this.trail = []; // [{ from, to }]
    this.choice = null; // { list: [{ pre, id, label }], i, from, back }
    this.linksAll = store.getItem(LINKS_KEY) === 'all';
    this.linkLayer = document.createElementNS(SVG, 'svg');
    this.linkLayer.setAttribute('class', 'canvas-links');
    this.linkLayer.setAttribute('width', '1');
    this.linkLayer.setAttribute('height', '1');

    this.world = el('div', 'md canvas-world');
    this.stage = el('div', 'canvas-stage', this.world);
    this.stage.tabIndex = 0;
    this.zoomLabel = el('span', 'viewer-zoom');
    const button = (label, tip, run) => {
      const b = el('button', 'icon-btn', label);
      b.type = 'button';
      b.title = tip;
      b.onclick = () => { run(); this.stage.focus({ preventScroll: true }); };
      return b;
    };
    this.allButton = button('All', 'See every picture, or back to the one the cursor is on (0)', () => this.toggleAll());
    this.linkButton = button('Links', 'Show every link between boxes of the same name, or only those of the box you are on (L)', () => this.toggleLinks());
    this.linkButton.classList.toggle('on', this.linksAll);
    this.exportButton = button('⤓', 'Copy or save the whole canvas as one image', () => this.h.onExport?.(this.exportButton));
    this.presentButton = button('▶', 'Present from the box you are on, one box at a time (P) · Home: from the start', () => this.present());
    this.caption = el('div', 'canvas-caption');
    this.caption.hidden = true;
    this.wire = document.createElementNS(SVG, 'svg');
    this.wire.setAttribute('class', 'canvas-wire'); // shown while dragging (.on)
    this.wireLine = document.createElementNS(SVG, 'path');
    this.wire.append(this.wireLine);
    this.empty = el('div', 'canvas-empty');
    this.note = el('div', 'canvas-note');
    this.note.hidden = true;
    this.el = el('div', 'canvas-pane',
      el('div', 'canvas-bar',
        this.presentButton,
        this.exportButton,
        this.linkButton,
        this.allButton,
        button('−', 'Zoom out (−)', () => this.zoomBy(1 / 1.25)),
        this.zoomLabel,
        button('+', 'Zoom in (+)', () => this.zoomBy(1.25))),
      this.stage, this.empty, this.note, this.caption);
    this.stage.append(this.wire);
    this.ink = new InkTools(this);
    this.ink.bar.addEventListener('click', () => this.stage.focus({ preventScroll: true }));
    this.el.append(this.ink.bar);
    if (this.h.onNewFlow) this.el.querySelector('.canvas-bar').prepend(button('+ Flow', 'Add a ```flow picture to the note, below the cursor, and draw on it', () => this.h.onNewFlow()));
    this.apply();
    this.bind();
  }

  // sections: [{ key, title, line, figures: [Element] }] in note order, only
  // those with pictures.
  setCards(sections) {
    this.pinBox();
    this.redrawnAt = performance.now();
    this.sections = sections;
    this.editing?.remove();
    // Links are drawn over the pictures (app.css), always.
    this.world.replaceChildren(this.linkLayer, ...sections.map((s) => {
      s.el = el('div', 'canvas-section',
        el('div', 'canvas-section-title', s.title),
        el('div', 'canvas-row', ...s.figures.map((f) => el('div', 'canvas-card', f))));
      s.el.dataset.key = s.key;
      return s.el;
    }));
    this.links = null;
    this.hover = null;
    // The box selected stays so when its picture comes again.
    const sel = this.walkAt && !this.choice ? this.whereIs(this.walkAt) : null;
    if (sel) this.keep = { ...sel, until: performance.now() + 5000 };
    const ed = this.edgeAt && this.namesOf(this.edgeAt);
    if (ed && !this.edgeSoon) this.edgeSoon = { ...ed, until: performance.now() + 5000 };
    this.edgeAt = null;
    this.endWalk();
    this.endPresent();
    this.whenLoaded(this.world, () => { this.holdPin(); this.drawLinksSoon(); });
    this.empty.hidden = sections.length > 0;
    this.empty.replaceChildren();
    if (!sections.length) {
      this.empty.append(el('div', null, 'No pictures yet. Write a ```flow or ```mermaid block and it shows up here — or draw one:'));
      if (this.h.onNewFlow) {
        const b = el('button', 'btn primary', 'New flow');
        b.type = 'button';
        b.onclick = () => this.h.onNewFlow();
        this.empty.append(b);
      }
    }
  }

  // A box by what outlasts its elements: the picture's line in the note and
  // the box's text.
  whereIs(b) {
    const name = this.textOf(b);
    return name ? { line: b.pre.dataset.line, name } : null;
  }

  // Once the picture at `line` is drawn again, select its box `name` (and
  // open its name for typing).
  selectSoon(line, name, rename = false) {
    this.pending = { line: String(line), name, rename, until: performance.now() + 5000 };
  }

  // An arrow by its picture's line and its boxes' names.
  namesOf(a) {
    const name = (id) => a.pre.flowNodes?.find((n) => n.id === id)?.text;
    const from = name(a.from);
    const to = name(a.to);
    return from && to ? { line: a.pre.dataset.line, from, to } : null;
  }

  // A change to the picture at `line` was written: until it is drawn again,
  // the keys for the selection wait (they would act on the old one).
  changed(line) {
    this.busy = { line: String(line), until: performance.now() + 3000 };
  }

  // What is selected, by names: { line, name } or { line, edge: [from, to] }.
  selectionNames() {
    if (this.edgeAt) { const n = this.namesOf(this.edgeAt); return n && { line: n.line, edge: [n.from, n.to] }; }
    const w = this.walkAt && this.whereIs(this.walkAt);
    return w ? { line: w.line, name: w.name } : null;
  }

  // Once the picture at `line` is drawn again, select its arrow from → to
  // (box names).
  selectEdgeSoon(line, from, to) {
    this.edgeSoon = { line: String(line), from, to, until: performance.now() + 5000 };
  }

  // A picture came: the box (or arrow) to select in it, if any.
  takeSelection(pre) {
    const want = this.edgeSoon;
    if (want && want.line === pre.dataset.line) {
      this.edgeSoon = null;
      const id = (t) => pre.flowNodes?.find((n) => n.text === t)?.id;
      const [a, b] = [id(want.from), id(want.to)];
      const e = performance.now() < want.until && a && b && (pre.flowEdges || []).find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
      if (e) {
        this.pending = null;
        this.keep = null;
        this.selectEdge(pre, e.from, e.to);
        return;
      }
    }
    for (const want of [this.pending, this.keep]) {
      if (!want || want.line !== pre.dataset.line) continue;
      if (performance.now() > want.until) { if (want === this.pending) this.pending = null; else this.keep = null; continue; }
      const n = pre.flowNodes?.find((x) => x.text === want.name);
      if (!n) continue;
      const asked = want === this.pending;
      if (asked) this.pending = null;
      this.keep = null;
      this.walkAt = { pre, id: n.id };
      this.trail = [];
      // Asked for (after a change, an undo): the cursor goes to it too, so
      // it stays the one selected. Kept while typing: the cursor stays.
      if (asked) this.h.onStep?.(pre, n.id);
      this.mark();
      if (want.rename) {
        this.whenLoaded(pre, () => setTimeout(() => {
          const b = this.hit(pre, n.id);
          if (b?.isConnected) this.rename(pre, b);
        }, Math.max(0, this.animEnd - performance.now()) + 20));
      }
      return;
    }
  }

  cardOf(fig) { return fig?.closest('.canvas-card') || null; }

  // ---- keeping still

  // A box is known by its picture (section, place in it) and its text (a
  // Mermaid box by its id), which outlast the elements.
  boxName(pre, id) {
    const text = pre.flowNodes?.find((f) => f.id === id)?.text;
    return text != null ? `t:${text}` : `i:${id}`;
  }

  figureAt(key, i) { return this.sections.find((s) => s.key === key)?.figures[i] || null; }

  // Before the pictures are made again: of the boxes in view, pick the one
  // nearest the boxes at the cursor (else the middle of the view), and note
  // where it is on screen. Adding a step or renaming one lays the picture
  // out again; holdPin() then moves the camera so that box stays put, and
  // the change happens around it instead of the whole picture sliding.
  pinBox() {
    this.pin = null;
    if (this.fresh || this.presenting || performance.now() < this.animEnd) return;
    const s = this.stage.getBoundingClientRect();
    if (!s.width || !s.height) return;
    const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    const at = this.world.querySelectorAll('.node-hit.on, .node-hit.walk-at');
    let p = { x: s.left + s.width / 2, y: s.top + s.height / 2 };
    if (at.length) { const b = this.bounds([...at]); p = { x: s.left + this.x + (b.x + b.w / 2) * this.k, y: s.top + this.y + (b.y + b.h / 2) * this.k }; }
    let best = null;
    for (const sec of this.sections) {
      sec.figures.forEach((pre, i) => {
        for (const hit of pre.querySelectorAll(':scope > .node-layer > .node-hit')) {
          const r = hit.getBoundingClientRect();
          if (r.right < s.left || r.left > s.right || r.bottom < s.top || r.top > s.bottom) continue;
          const c = mid(r);
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (!best || d < best.d) best = { d, key: sec.key, i, name: this.boxName(pre, hit.dataset.id), x: r.left, y: r.top };
        }
      });
    }
    if (best) this.pin = best;
  }

  // Put the pinned box back where it was on screen (as each picture comes).
  holdPin() {
    const pin = this.pin;
    if (!pin || this.presenting) return;
    const pre = this.figureAt(pin.key, pin.i);
    const hit = pre && [...pre.querySelectorAll(':scope > .node-layer > .node-hit')].find((b) => this.boxName(pre, b.dataset.id) === pin.name);
    if (!hit) return;
    const r = hit.getBoundingClientRect();
    const dx = r.left - pin.x;
    const dy = r.top - pin.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    this.x -= dx;
    this.y -= dy;
    this.apply();
  }

  // The layout in world units, for a picture of the whole canvas:
  // { w, h, sections: [{ title, x, y, w, h, cards: [{ x, y, w, h, images: [{ src, x, y, w, h }] }] }] }.
  layout() {
    const o = this.world.getBoundingClientRect();
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: (r.left - o.left) / this.k, y: (r.top - o.top) / this.k, w: r.width / this.k, h: r.height / this.k }; };
    const sections = this.sections.map((s) => ({
      title: s.title, ...box(s.el),
      cards: [...s.el.querySelectorAll('.canvas-card')].map((c) => ({
        ...box(c),
        images: [...c.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth).map((i) => ({ src: i.src, ...box(i) })),
      })),
    }));
    return { w: Math.max(0, ...sections.map((s) => s.x + s.w)), h: Math.max(0, ...sections.map((s) => s.y + s.h)), sections };
  }

  // What the cursor is on: a picture, and maybe some of its boxes. The camera
  // moves only when that changes, so typing on a line keeps it still.
  target(goal) {
    // Still in the same picture (typing adds, renames and drops the boxes at
    // the cursor): the camera stays while they can be seen.
    const place = (g) => (g ? `${g.section.key}|${g.section.figures.indexOf(g.fig)}` : null);
    const samePicture = !!goal && place(goal) === place(this.goal);
    this.goal = goal;
    this.mark();
    const sig = goal ? `${goal.section.key}|${goal.section.figures.indexOf(goal.fig)}|${goal.nodes.map((n) => n.id).join(',')}|${(goal.marks || []).join(',')}` : null;
    if (sig === this.sig && !this.fresh) return;
    this.sig = sig;
    // Picked on the canvas itself, in the picture being looked at: moving
    // would pull the box from under the pointer.
    if (this.picking) return;
    if (this.fresh) {
      if (goal) this.view = 'picture';
      this.whenLoaded(this.world, () => (goal && this.view === 'picture' ? this.refocus(false) : this.fitAll(false)));
      return;
    }
    if (!goal || this.view !== 'picture') return;
    if (samePicture && !goal.nodes.length) return;
    // While typing, the boxes come and go at each key: follow them once
    // typing stops, not at every step.
    if (samePicture && this.typing()) { this.settleSoon(); return; }
    this.refocus(true, samePicture);
  }

  typing() { return performance.now() - (this.redrawnAt || 0) < SETTLE; }

  // Once typing stops, bring the boxes at the cursor into view if they are not.
  settleSoon() {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.typing()) { this.settleSoon(); return; }
      if (this.goal && this.view === 'picture' && !this.presenting) this.refocus(true, true);
    }, SETTLE);
  }

  // Look at the target: its boxes centred, or the picture (its top left if
  // it is larger than the view), at the remembered picture zoom.
  // onlyIfHidden: leave the camera alone while the target is in view.
  refocus(animate = true, onlyIfHidden = false) {
    if (!this.goal) return;
    const wasPicture = this.view === 'picture';
    this.setView('picture');
    const want = this.sig;
    const card0 = this.cardOf(this.goal.fig);
    if (!card0) return;
    this.whenLoaded(card0, () => {
      // The same target may have been set again meanwhile (a second click).
      const goal = this.goal;
      const card = this.cardOf(goal?.fig);
      if (this.sig !== want || !card || this.view !== 'picture') return;
      const hits = goal.nodes.map((n) => this.hit(n.pre, n.id)).filter(Boolean);
      // A picture with no boxes at the cursor counts as seen while part of it is.
      if (onlyIfHidden && (hits.length ? this.inView(hits) : this.overlapsView(card))) return;
      const s = this.stage.getBoundingClientRect();
      if (!s.width || !s.height) return;
      const c = this.bounds([card]);
      const k = this.zoomFor.picture ?? Math.max(0.2, Math.min(1, this.fitK(c, s)));
      const b = hits.length ? this.bounds(hits) : c;
      // Already at this zoom: move only as far as needed. A picture should be
      // inside the view (something larger just has to fill it); boxes of a
      // picture too large for that, in the middle (a fifth of margin a side).
      if (wasPicture && Math.abs(this.k - k) < 0.005 * k) {
        const into = (pos, len, lo, hi) => (pos < lo ? lo - pos : pos + len > hi ? hi - (pos + len) : 0);
        const shift = (pos, len, view) => {
          const edge = PAD / 2;
          const m = hits.length ? view * 0.2 : edge;
          if (len <= view - m * 2) return into(pos, len, m, view - m);
          if (len <= view - edge * 2) return into(pos, len, edge, view - edge);
          // Larger than the view: fine while it fills it, else pull the near edge in.
          return pos > edge ? edge - pos : pos + len < view - edge ? view - edge - (pos + len) : 0;
        };
        // Boxes of a picture that fits: show the whole picture instead.
        const onAxis = (pos, len, cpos, clen, view) => (hits.length && clen <= view - PAD
          ? into(cpos, clen, PAD / 2, view - PAD / 2)
          : shift(pos, len, view));
        const dx = onAxis(this.x + b.x * k, b.w * k, this.x + c.x * k, c.w * k, s.width);
        const dy = onAxis(this.y + b.y * k, b.h * k, this.y + c.y * k, c.h * k, s.height);
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) this.moveTo(k, this.x + dx, this.y + dy, animate);
        return;
      }
      let x = s.width / 2 - (b.x + b.w / 2) * k;
      let y = s.height / 2 - (b.y + b.h / 2) * k;
      if (!hits.length) {
        if (c.w * k > s.width - PAD * 2) x = PAD - c.x * k;
        if (c.h * k > s.height - PAD * 2) y = PAD - c.y * k;
      }
      this.moveTo(k, x, y, animate);
    });
  }

  fitK(b, s) { return Math.min((s.width - PAD * 2) / Math.max(1, b.w), (s.height - PAD * 2) / Math.max(1, b.h)); }

  fitAll(animate) {
    this.setView('all');
    const s = this.stage.getBoundingClientRect();
    if (!this.sections.length || !s.width || !s.height) return;
    const b = this.bounds(this.sections.map((x) => x.el));
    // "All" remembers its zoom relative to fitting, so it suits any note.
    this.fitAllK = Math.max(0.05, Math.min(1, this.fitK(b, s)));
    const k = Math.max(0.05, Math.min(8, this.fitAllK * (this.zoomFor.allRatio ?? 1)));
    this.moveTo(k, s.width / 2 - (b.x + b.w / 2) * k, Math.max(PAD - b.y * k, s.height / 2 - (b.y + b.h / 2) * k), animate);
  }

  toggleAll() {
    if (this.view === 'all' && this.goal) this.refocus(true);
    else this.fitAll(true);
  }

  setView(v) {
    this.view = v;
    this.allButton.classList.toggle('on', v === 'all');
  }

  // ---- highlight

  hit(pre, id) {
    return [...pre.querySelectorAll(':scope > .node-layer > .node-hit')].find((b) => b.dataset.id === id) || null;
  }

  mark() {
    const goal = this.goal;
    for (const s of this.sections) s.el?.classList.toggle('current', s === goal?.section);
    this.world.querySelectorAll('.canvas-card.current').forEach((c) => c.classList.remove('current'));
    this.cardOf(goal?.fig)?.classList.add('current');
    this.world.querySelectorAll('.node-hit.on').forEach((b) => b.classList.remove('on'));
    // The cursor moved off the box walked to: the walk is over. While
    // walking, only that box is marked, not the rest of its line.
    this.world.querySelectorAll('.node-hit.walk-at').forEach((b) => b.classList.remove('walk-at'));
    if (this.walkAt && !(goal?.nodes || []).some((n) => same(n, this.walkAt))) this.endWalk();
    if (this.walkAt) this.hit(this.walkAt.pre, this.walkAt.id)?.classList.add('walk-at');
    else for (const n of goal?.nodes || []) this.hit(n.pre, n.id)?.classList.add('on');
    this.markEdge();
    // A numbered list item at the cursor: its dot on the picture.
    this.world.querySelectorAll('.ink-mark.ink-at').forEach((g) => g.classList.remove('ink-at'));
    for (const l of goal?.marks || []) goal.fig.querySelector(`:scope > .ink-marks > .ink-mark[data-line="${l}"]`)?.classList.add('ink-at');
    this.ink?.show(!!goal?.fig?.matches?.('.ink-figure'));
    // The marks of the picture looked at can be picked, moved and reshaped.
    this.world.querySelectorAll('.ink-figure.ink-editable').forEach((f) => f.classList.remove('ink-editable'));
    if (goal?.fig?.matches?.('.ink-figure') && !this.presenting) goal.fig.classList.add('ink-editable');
    this.ink?.drawGrips();
    this.drawLinksSoon();
  }

  markEdge() {
    this.world.querySelectorAll('.edge.on').forEach((g) => g.classList.remove('on'));
    const a = this.edgeAt;
    if (!a) return;
    if (!a.pre.isConnected) { this.edgeAt = null; return; }
    this.edgeEl(a)?.classList.add('on');
  }

  edgeEl(a) {
    return [...a.pre.querySelectorAll(':scope > .node-layer .edge')].find((g) => g.dataset.from === a.from && g.dataset.to === a.to) || null;
  }

  // Select an arrow: the keys act on it (Delete, B, R, D, Enter).
  selectEdge(pre, from, to) {
    this.endWalk();
    this.pending = null;
    this.keep = null;
    this.edgeAt = { pre, from, to };
    this.mark();
  }

  // ---- presenting

  // Full screen, one step at a time: [{ pre, id (null for a whole picture),
  // frame (a section, seen whole), marks (ink lines shown with it), title,
  // text, note, via, lines }] from h.tour(). Boxes not reached yet are
  // dimmed and marks hidden; the caption tells the step and the text that
  // names it. ] and [ go frame to frame.
  // It starts from the box being walked, else the one at the cursor.
  present() {
    const prefer = new Map();
    const steps = this.h.tour?.(prefer) || [];
    if (!steps.length) { this.say('Nothing to present: write a ```flow block.'); return; }
    const at = this.walkAt || this.h.here?.();
    const first = Math.max(0, steps.findIndex((st) => st.pre === at?.pre && st.id === at?.id));
    if (this.ink.tool) this.ink.use(null);
    this.presenting = { steps, i: -1, prefer };
    this.framed = null;
    this.userCam = false;
    this.el.classList.add('presenting');
    this.setView('picture');
    // Not awaited: without a user gesture the promise may never settle, and
    // the pane covers the window anyway (app.css).
    if (this.el.requestFullscreen && !document.fullscreenElement) this.el.requestFullscreen().catch(() => {});
    this.stage.focus({ preventScroll: true });
    // Unless a key already moved it (a frame can come late).
    const p = this.presenting;
    requestAnimationFrame(() => { if (this.presenting === p && p.i < 0) this.showStep(first); });
  }

  showStep(i, frameAgain = false) {
    const p = this.presenting;
    if (!p) return;
    i = Math.max(0, Math.min(p.steps.length - 1, i));
    p.i = i;
    const st = p.steps[i];
    // Reached so far: dim the rest (a frame: all of it, the marks to come
    // aside).
    const reached = p.steps.slice(0, i + 1);
    this.world.querySelectorAll('.node-hit').forEach((b) => b.classList.add('unseen'));
    const shown = new Map(); // ink figure → the lines of its marks shown
    for (const x of reached) {
      if (x.marks) shown.set(x.pre, new Set([...(shown.get(x.pre) || []), ...x.marks]));
      if (x.id) this.hit(x.pre, x.id)?.classList.remove('unseen');
      else if (x.pre) x.pre.querySelectorAll(':scope > .node-layer > .node-hit').forEach((b) => b.classList.remove('unseen'));
    }
    if (st.frame) st.frame.el.querySelectorAll('.node-hit').forEach((b) => b.classList.remove('unseen'));
    for (const fig of new Set(p.steps.filter((x) => x.marks).map((x) => x.pre))) {
      for (const m of fig.querySelectorAll('.ink-mark')) m.classList.toggle('unseen', !shown.get(fig)?.has(Number(m.dataset.line)));
    }
    this.clearChoice();
    this.walkAt = st.id ? { pre: st.pre, id: st.id } : null;
    this.trail = [];
    // The cursor follows, but the camera frames the picture (below).
    this.picking = true;
    try {
      if (st.frame) this.h.onSection?.(st.frame);
      else if (st.id) this.h.onStep?.(st.pre, st.id);
      else this.h.onFigure?.(st.pre);
    } finally { this.picking = false; }
    if (st.id) this.hit(st.pre, st.id)?.classList.add('walk-at');
    const line = (cls, text) => (text ? el('div', cls, text) : null);
    this.caption.replaceChildren(...[
      el('div', st.frame ? 'cap-head cap-frame' : 'cap-head', `${st.title}  ·  ${i + 1} / ${p.steps.length}`),
      line('cap-via', st.via),
      line('cap-text', st.text),
      line('cap-note', st.note),
      line('cap-after', st.after),
      ...st.lines.slice(0, 6).map((l) => line('cap-line', l)),
      this.choiceLine(st, p.steps[i + 1]),
    ].filter(Boolean));
    this.caption.hidden = false;
    this.frame(st, frameAgain);
  }

  // The ways out of a step with several, numbered: Space takes the one
  // marked (the next step), a number or a click the one you want.
  choiceLine(st, next) {
    if (!st.choices) return null;
    const p = this.presenting;
    const row = el('div', 'cap-choices');
    st.choices.forEach((c, k) => {
      const j = p.steps.findIndex((x) => x.pre === st.pre && x.from === st.id && x.id === c.to);
      const cls = next && next.pre === st.pre && next.from === st.id && next.id === c.to ? ' next' : j >= 0 && j < p.i ? ' done' : '';
      const b = el('button', `cap-choice${cls}`, `${k + 1}  ${c.label ? `${c.label} → ` : ''}${c.text}`);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // the keys stay with the canvas
      b.addEventListener('click', (e) => { e.stopPropagation(); this.pickBranch(k); });
      row.append(b);
    });
    return row;
  }

  // Presenting, at a step with several ways out: go on along way k now; the
  // ones not taken yet still follow, after it.
  pickBranch(k) {
    const p = this.presenting;
    const st = p?.steps[p.i];
    const c = st?.choices?.[k];
    if (!c) return;
    const reach = (steps) => steps.findIndex((x) => x.pre === st.pre && x.from === st.id && x.id === c.to);
    const was = reach(p.steps);
    if (was >= 0 && was < p.i) { this.showStep(was); return; } // taken before: go back there
    const taken = st.choices.filter((o) => { const j = p.steps.findIndex((x) => x.pre === st.pre && x.from === st.id && x.id === o.to); return j >= 0 && j < p.i; }).map((o) => o.to);
    const mine = { ...(p.prefer.get(st.pre) || {}) };
    mine[st.id] = [...taken, c.to, ...st.choices.map((o) => o.to).filter((to) => to !== c.to && !taken.includes(to))];
    p.prefer.set(st.pre, mine);
    p.steps = this.h.tour?.(p.prefer) || p.steps;
    const to = reach(p.steps);
    this.showStep(to >= 0 ? to : p.i + 1);
  }

  // Presenting: the picture as large as fits above the caption, centred —
  // moved only when the picture changes. One too large to read that way is
  // followed box by box instead. Once the presenter zooms or pans in a
  // picture (userCam), that zoom stays and the camera only glides as far as
  // needed to keep each step's box in view; a new picture is framed afresh.
  frame(st, force) {
    const card = st.frame ? st.frame.el : this.cardOf(st.pre);
    if (!card?.isConnected) return;
    this.whenLoaded(card, () => {
      const s = this.stage.getBoundingClientRect();
      const cap = this.caption.hidden ? 0 : this.caption.offsetHeight + 36;
      const w = s.width - PAD * 2;
      const h = s.height - cap - PAD * 2;
      const c = this.bounds([card]);
      const fit = Math.min(2, w / c.w, h / c.h);
      const marks = st.marks && [...st.pre.querySelectorAll('.ink-mark')].filter((m) => st.marks.includes(Number(m.dataset.line)));
      const box = st.id ? this.hit(st.pre, st.id) : null;
      const b = box ? this.bounds([box]) : marks?.length ? this.bounds(marks) : c;
      const same = this.framed === card && !force;
      if (same && this.userCam) { this.reveal(b, s.width, s.height - cap); return; }
      this.userCam = false;
      this.framed = card;
      // A frame is seen whole, however small.
      if (fit >= 0.5 || st.frame) {
        if (same) return;
        this.moveTo(fit, s.width / 2 - (c.x + c.w / 2) * fit, PAD + (h - c.h * fit) / 2 - c.y * fit, true);
        return;
      }
      const k = 0.8;
      this.moveTo(k, s.width / 2 - (b.x + b.w / 2) * k, PAD + h / 2 - (b.y + b.h / 2) * k, true);
    });
  }

  // Pan, at the current zoom, just enough that b (world units) is inside a
  // w × h view with a margin; centred on an axis where it can't fit.
  reveal(b, w, h) {
    const m = Math.min(PAD * 2, w * 0.1, h * 0.1);
    const along = (pos, size, at, view) => {
      const from = pos * this.k + at;
      const to = from + size * this.k;
      if (to - from > view - 2 * m) return at + (view / 2 - (from + to) / 2);
      if (from < m) return at + (m - from);
      if (to > view - m) return at - (to - (view - m));
      return at;
    };
    const x = along(b.x, b.w, this.x, w);
    const y = along(b.y, b.h, this.y, h);
    if (x !== this.x || y !== this.y) this.moveTo(this.k, x, y, true);
  }

  endPresent() {
    if (!this.presenting) return;
    this.presenting = null;
    this.el.classList.remove('presenting');
    this.world.querySelectorAll('.node-hit.unseen, .ink-mark.unseen').forEach((b) => b.classList.remove('unseen'));
    this.caption.hidden = true;
    if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
    this.stage.focus({ preventScroll: true });
  }

  // ---- following the flow

  // → next step, ← the step before (back along the way taken, if any).
  step(back = false) {
    if (this.choice) { if (this.choice.back === back) this.choose(this.choice.i); else this.clearChoice(); return; }
    const at = this.h.here?.();
    if (!at) { this.say('Put the cursor on a box of a ```flow picture, or click one.'); return; }
    if (!same(this.trail[this.trail.length - 1]?.to, at)) this.trail = [];
    if (back && this.trail.length) { this.go(this.trail.pop().from); return; }
    const list = this.ways(at, back);
    if (!list.length) {
      const other = this.namesake(at);
      this.go(at);
      this.say(back ? 'This is where the flow starts.' : `This is where the flow ends.${other ? ' G goes to the same box in another picture.' : ''}`);
      return;
    }
    if (list.length === 1) { this.go(list[0], back ? null : at); return; }
    this.walkAt = at;
    this.hit(at.pre, at.id)?.classList.add('walk-at');
    this.choice = { list, i: 0, from: at, back };
    this.showChoice();
  }

  // The boxes one arrow away: after this one, or before it.
  ways(at, back) {
    const out = [];
    for (const e of at.pre.flowEdges || []) {
      const both = e.kind === '<-->' || e.kind === '---';
      let id = null;
      if ((back ? e.to : e.from) === at.id) id = back ? e.from : e.to;
      else if (both && (back ? e.from : e.to) === at.id) id = back ? e.to : e.from;
      if (id && id !== at.id && !out.some((w) => w.id === id)) out.push({ pre: at.pre, id, label: e.label });
    }
    return out;
  }

  // The next box of the same name in another picture (note order, round).
  namesake(at) {
    const name = this.textOf(at)?.toLowerCase();
    const all = [];
    for (const s of this.sections) for (const pre of s.figures) for (const n of pre.flowNodes || []) if (n.text.toLowerCase() === name) all.push({ pre, id: n.id });
    if (all.length < 2) return null;
    const i = all.findIndex((b) => same(b, at));
    return all[(i + 1) % all.length];
  }

  jump() {
    const at = this.h.here?.();
    const to = at && this.namesake(at);
    if (!to) { this.say(at ? 'No other picture has this box.' : 'Put the cursor on a box of a ```flow picture, or click one.'); return; }
    this.go(to, at);
  }

  go(to, from = null) {
    this.clearChoice();
    this.pending = null;
    this.keep = null;
    if (from) this.trail.push({ from, to });
    if (this.trail.length > 200) this.trail.shift();
    this.walkAt = to;
    this.say('');
    this.h.onStep?.(to.pre, to.id);
    this.hit(to.pre, to.id)?.classList.add('walk-at');
  }

  showChoice() {
    const c = this.choice;
    c.list.forEach((w, i) => {
      const b = this.hit(w.pre, w.id);
      if (!b) return;
      b.classList.add('walk-choice');
      b.classList.toggle('picked', i === c.i);
      b.dataset.n = String(i + 1);
    });
    const ways = c.list.map((w, i) => `${i + 1} ${w.label ? `${w.label} → ` : ''}${this.textOf(w)}`).join(' · ');
    this.say(`${c.back ? 'Came from' : 'Goes to'}: ${ways}  (number or Tab, then Enter)`);
  }

  choose(i) {
    const c = this.choice;
    const w = c?.list[i];
    if (w) this.go(w, c.back ? null : c.from);
  }

  clearChoice() {
    if (!this.choice) return;
    this.choice = null;
    this.world.querySelectorAll('.node-hit.walk-choice').forEach((b) => { b.classList.remove('walk-choice', 'picked'); delete b.dataset.n; });
    this.say('');
  }

  endWalk() {
    this.walkAt = null;
    this.trail = [];
    this.clearChoice();
  }

  textOf(b) { return b?.pre.flowNodes?.find((n) => n.id === b.id)?.text ?? ''; }

  say(text) {
    this.note.textContent = text;
    this.note.hidden = !text;
  }

  // ---- links

  // Boxes of ```flow pictures named alike, joined in note order.
  computeLinks() {
    const byName = new Map();
    for (const s of this.sections) {
      for (const pre of s.figures) {
        for (const n of pre.flowNodes || []) {
          const key = n.text.toLowerCase();
          if (!byName.has(key)) byName.set(key, []);
          byName.get(key).push({ pre, id: n.id });
        }
      }
    }
    this.links = [];
    for (const list of byName.values()) for (let i = 1; i < list.length; i++) this.links.push([list[i - 1], list[i]]);
    // Names written two ways ("Auth server", "AuthServer") draw as two boxes: say so.
    const texts = this.sections.flatMap((s) => s.figures.flatMap((pre) => (pre.flowNodes || []).map((n) => n.text)));
    this.similar = similarNames(texts);
  }

  drawLinksSoon() {
    if (this.linkQueued) return;
    this.linkQueued = true;
    requestAnimationFrame(() => { this.linkQueued = false; this.drawLinks(); });
  }

  drawLinks() {
    if (!this.links) this.computeLinks();
    const svg = this.linkLayer;
    svg.replaceChildren();
    this.world.querySelectorAll('.node-hit.shared, .node-hit.far').forEach((b) => b.classList.remove('shared', 'far'));
    for (const ends of this.links) for (const e of ends) this.hit(e.pre, e.id)?.classList.add('shared');
    for (const s of this.sections) {
      for (const pre of s.figures) {
        for (const n of pre.flowNodes || []) {
          const b = this.hit(pre, n.id);
          const others = this.similar.get(n.text);
          if (!b) continue;
          b.classList.toggle('similar', !!others);
          b.title = others ? `Also written as ${others.map((o) => `“${o}”`).join(', ')} — that draws as another box` : RENAME_TIP;
        }
      }
    }
    const hot = (e) => same(e, this.hover) || !!this.goal?.nodes.some((n) => same(e, n));
    const shown = this.links.filter(([a, b]) => this.linksAll || hot(a) || hot(b));
    for (const [a, b] of shown) {
      const ha = this.hit(a.pre, a.id);
      const hb = this.hit(b.pre, b.id);
      if (!ha || !hb) continue;
      const sa = ha.closest('.canvas-section');
      const outer = sa === hb.closest('.canvas-section') ? null
        : Math.max(...[ha, hb].map((x) => { const r = this.bounds([x.closest('.canvas-card')]); return r.x + r.w; }));
      const d = linkPath(this.bounds([ha]), this.bounds([hb]), outer);
      const line = document.createElementNS(SVG, 'path');
      line.setAttribute('d', d);
      line.setAttribute('class', `canvas-link${hot(a) || hot(b) ? ' hot' : ''}`);
      // The other end of a line from the box in focus.
      if (hot(a) !== hot(b)) (hot(a) ? hb : ha).classList.add('far');
      const grip = document.createElementNS(SVG, 'path');
      grip.setAttribute('d', d);
      grip.setAttribute('class', 'canvas-link-hit');
      grip.link = [a, b];
      svg.append(line, grip);
    }
  }

  toggleLinks() {
    this.linksAll = !this.linksAll;
    this.linkButton.classList.toggle('on', this.linksAll);
    try { store.setItem(LINKS_KEY, this.linksAll ? 'all' : 'picture'); } catch { /* private mode */ }
    this.drawLinks();
  }

  hoverDot(dot) {
    if ((dot || null) === (this.dot || null)) return;
    this.dot = dot;
    this.h.onInkHover?.(dot?.closest('.ink-figure') || null, dot?.dataset.num ?? null);
  }

  setHover(next) {
    if (same(next, this.hover) || (!next && !this.hover)) return;
    this.hover = next;
    this.drawLinks();
    this.h.onHover?.(next?.pre || null, next?.id || null);
  }

  // A diagram finished drawing: lay its hit boxes over it.
  layer(pre) {
    pre.querySelector(':scope > .node-layer')?.remove();
    const nodes = pre.diagramNodes || [];
    if (!nodes.length) return;
    const layer = el('div', 'node-layer');
    const edit = !!pre.flowNodes && !!this.h.canEdit?.(pre);
    const side = { LR: 'right', RL: 'left', BT: 'up' }[pre.flowDirection] || 'down';
    // The arrows' lines, under the boxes: click one to select it.
    if (edit && pre.diagramEdges?.length) {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'edge-layer');
      svg.setAttribute('viewBox', '0 0 1 1');
      svg.setAttribute('preserveAspectRatio', 'none');
      for (const e of pre.diagramEdges) {
        const g = document.createElementNS(SVG, 'g');
        g.setAttribute('class', 'edge');
        g.dataset.from = e.from;
        g.dataset.to = e.to;
        const title = document.createElementNS(SVG, 'title');
        title.textContent = 'Click: select the arrow · Delete, B both ways, R reverse, D dotted, Enter words · Right-click: more';
        g.append(title);
        for (const cls of ['edge-line', 'edge-hit']) {
          const line = document.createElementNS(SVG, 'polyline');
          line.setAttribute('class', cls);
          line.setAttribute('points', e.pts.map(([x, y]) => `${x},${y}`).join(' '));
          line.setAttribute('vector-effect', 'non-scaling-stroke');
          g.append(line);
        }
        svg.append(g);
      }
      layer.append(svg);
    }
    for (const n of nodes) {
      const b = el('div', 'node-hit');
      b.dataset.id = n.id;
      b.style.left = `${n.x * 100}%`;
      b.style.top = `${n.y * 100}%`;
      b.style.width = `${n.w * 100}%`;
      b.style.height = `${n.h * 100}%`;
      if (this.h.canRename?.(pre)) b.title = RENAME_TIP;
      // Round and diamond boxes: marks and dimming follow the outline.
      const shape = pre.flowNodes?.find((f) => f.id === n.id)?.shape;
      if (shape) b.classList.add(`shape-${shape}`);
      if (edit) {
        const plus = el('div', `box-handle to-${side}`, '+');
        plus.title = 'Click: a new box after this one · Drag: an arrow to another box';
        b.append(plus);
      }
      layer.append(b);
    }
    pre.append(layer);
    if (this.edgeAt?.pre === pre) this.markEdge();
  }

  // ---- camera

  apply() {
    this.world.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`;
    // The + handles keep their size on screen.
    this.world.style.setProperty('--inv', String(1 / this.k));
    this.zoomLabel.textContent = `${Math.round(this.k * 100)}%`;
    this.editing?.place?.();
  }

  // Run once the pictures inside `root` have their sizes.
  whenLoaded(root, run) {
    const imgs = [...root.querySelectorAll('img')].filter((i) => !i.complete);
    if (!imgs.length) { requestAnimationFrame(run); return; }
    Promise.all(imgs.map((i) => i.decode().catch(() => {}))).then(() => requestAnimationFrame(run));
  }

  // Elements' union in world coordinates.
  bounds(els) {
    const s = this.stage.getBoundingClientRect();
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    for (const e of els) {
      const r = e.getBoundingClientRect();
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    return { x: (x1 - s.left - this.x) / this.k, y: (y1 - s.top - this.y) / this.k, w: (x2 - x1) / this.k, h: (y2 - y1) / this.k };
  }

  inView(els) {
    const s = this.stage.getBoundingClientRect();
    return els.every((e) => { const r = e.getBoundingClientRect(); return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom; });
  }

  overlapsView(e) {
    const s = this.stage.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    return r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom;
  }

  moveTo(k, x, y, animate) {
    cancelAnimationFrame(this.anim);
    this.pin = null;
    this.fresh = false;
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      Object.assign(this, { k, x, y });
      this.apply();
      return;
    }
    const from = { k: this.k, x: this.x, y: this.y };
    const t0 = performance.now();
    this.animEnd = t0 + 240;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 240);
      const e = 1 - (1 - p) ** 3;
      this.k = from.k + (k - from.k) * e;
      this.x = from.x + (x - from.x) * e;
      this.y = from.y + (y - from.y) * e;
      this.apply();
      if (p < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  // Zoom keeping the stage point (cx, cy) where it is; remembered for the
  // current way of looking.
  zoomAt(next, cx, cy) {
    cancelAnimationFrame(this.anim);
    next = Math.max(0.05, Math.min(8, next));
    this.pin = null;
    this.userCam = true;
    this.x = cx - (cx - this.x) * (next / this.k);
    this.y = cy - (cy - this.y) * (next / this.k);
    this.k = next;
    this.fresh = false;
    this.apply();
    if (this.view === 'all') this.zoomFor.allRatio = next / (this.fitAllK || next);
    else this.zoomFor.picture = next;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { store.setItem(ZOOM_KEY, JSON.stringify(this.zoomFor)); } catch { /* private mode */ } }, 400);
  }

  zoomBy(f) {
    const r = this.stage.getBoundingClientRect();
    this.zoomAt(this.k * f, r.width / 2, r.height / 2);
  }

  // ---- input

  bind() {
    const stage = this.stage;
    this.world.addEventListener('diagram-shown', (e) => {
      this.layer(e.target);
      this.whenLoaded(e.target, () => this.holdPin());
      this.links = null;
      this.mark();
      this.takeSelection(e.target);
      if (this.busy?.line === e.target.dataset.line) {
        this.busy = null;
        const k = this.queued.shift();
        if (k) {
          const rest = this.queued;
          this.queued = [];
          this.editKey(k);
          // The rest wait for the next drawing (or go, if nothing changed).
          if (this.busy) this.queued = rest; else for (const r of rest) this.editKey(r);
        }
      }
      // A picture being looked at changed size: keep its target in view.
      if (this.view === 'picture' && this.goal?.fig === e.target && !this.fresh) {
        if (this.typing()) this.settleSoon();
        else this.refocus(true, true);
      }
    });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.editing?.remove();
      // h.wheelPans() (Labs): the wheel or two fingers move, a pinch or
      // ⌘/Ctrl + wheel zooms. Otherwise the wheel zooms.
      if (this.h.wheelPans?.() && !e.ctrlKey && !e.metaKey) {
        cancelAnimationFrame(this.anim);
        const line = e.deltaMode === 1 ? 16 : 1;
        this.pin = null;
        this.userCam = true;
        this.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * line;
        this.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * line;
        this.fresh = false;
        this.apply();
        return;
      }
      const r = stage.getBoundingClientRect();
      this.zoomAt(this.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // The box (or link) under the pointer.
    stage.addEventListener('pointerover', (e) => {
      if (press?.moved) return;
      const b = e.target.closest?.('.node-hit');
      this.setHover(b ? { pre: b.closest('pre'), id: b.dataset.id } : null);
      this.world.querySelectorAll('.node-hit.linked').forEach((x) => x.classList.remove('linked'));
      const link = e.target.closest?.('.canvas-link-hit')?.link;
      for (const end of link || []) this.hit(end.pre, end.id)?.classList.add('linked');
      this.hoverDot(e.target.closest?.('.ink-mark[data-num]'));
    });
    stage.addEventListener('pointerleave', () => {
      this.setHover(null);
      this.hoverDot(null);
      this.world.querySelectorAll('.node-hit.linked').forEach((x) => x.classList.remove('linked'));
    });

    let press = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('input, button')) return;
      this.dragged = false;
      if (this.ink.down(e)) { press = null; return; }
      const plus = e.target.closest('.box-handle');
      if (plus) { this.startWire(e, plus); return; }
      press = { px: e.clientX, py: e.clientY, moved: false, id: e.pointerId };
    });
    stage.addEventListener('pointermove', (e) => {
      if (this.ink.move(e)) return;
      if (this.wiring) { this.moveWire(e); return; }
      if (!press) return;
      const dx = e.clientX - press.px;
      const dy = e.clientY - press.py;
      if (!press.moved && Math.hypot(dx, dy) < 4) return;
      if (!press.moved) {
        // A drag takes over from a camera move (a click lets it finish).
        cancelAnimationFrame(this.anim);
        Object.assign(press, { moved: true, x: this.x, y: this.y });
        stage.setPointerCapture(press.id);
        stage.classList.add('panning');
        this.editing?.remove();
      }
      this.pin = null;
      this.userCam = true;
      this.x = press.x + dx;
      this.y = press.y + dy;
      this.fresh = false;
      this.apply();
    });
    const release = (e) => {
      // A mark drawn: the click it ends in is not a pick.
      if (e.type === 'pointercancel') this.ink.cancel();
      else if (this.ink.up(e)) { this.dragged = true; return; }
      if (this.wiring) { this.endWire(e.type === 'pointerup'); return; }
      this.dragged = !!press?.moved;
      press = null;
      stage.classList.remove('panning');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    // The second click of a double-click is not another pick: the camera may
    // have moved since the first, so it could land on something else.
    stage.addEventListener('click', (e) => {
      if (this.dragged || e.detail > 1 || e.target.closest('input, button, .box-handle')) return;
      this.click(e.target);
    });
    stage.addEventListener('dblclick', (e) => {
      // The box of the first click, even if the camera moved since.
      const n = this.clicked;
      if (this.presenting) return;
      if (e.target.closest('.box-handle')) return;
      if (n && performance.now() - n.at < 800 && this.h.canRename?.(n.pre)) {
        setTimeout(() => { const b = this.hit(n.pre, n.id); if (b) this.rename(n.pre, b); }, Math.max(0, this.animEnd - performance.now()) + 20);
        return;
      }
      if (!e.target.closest('.canvas-section')) { this.toggleAll(); return; }
      // Beside the boxes of a picture you can draw on: a new box.
      const fig = this.figureOf(e.target);
      if (fig?.flowNodes && !e.target.closest('.node-hit') && this.h.canEdit?.(fig)) this.h.onAddBox?.(fig);
    });
    stage.addEventListener('contextmenu', (e) => {
      if (this.presenting || e.target.closest('input')) return;
      const fig = this.figureOf(e.target);
      if (!fig) return;
      const b = e.target.closest('.node-hit');
      const edge = e.target.closest('.edge');
      if (edge && !b) {
        this.selectEdge(fig, edge.dataset.from, edge.dataset.to);
        this.h.onArrow?.(fig, this.edgeAt, 'menu', e);
      } else if (b && fig.flowNodes) {
        this.select(fig, b.dataset.id);
        this.h.onBoxMenu?.(e, fig, b.dataset.id);
      } else this.h.onCardMenu?.(e, fig);
    });
    // Leaving full screen (Esc there is the browser's) ends the presentation.
    document.addEventListener('fullscreenchange', () => {
      if (!this.presenting) return;
      if (document.fullscreenElement !== this.el) this.endPresent();
      else setTimeout(() => this.showStep(this.presenting?.i ?? 0, true), 50); // the view grew
    });
    // ⌘V of a picture: into the note, to draw on.
    stage.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length || !this.h.onPastePictures) return;
      e.preventDefault();
      this.h.onPastePictures(files);
    });
    stage.addEventListener('keydown', (e) => {
      if (this.wiring && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endWire(false); return; }
      // ⌘Z / ⌘⇧Z (Ctrl+Z, Ctrl+Y): the note's undo, drawing included.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[zy]$/i.test(e.key) && this.h.onUndo) {
        e.preventDefault();
        e.stopPropagation();
        this.h.onUndo(e.key.toLowerCase() === 'y' || e.shiftKey);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input')) return;
      const p = this.presenting;
      const show = p && {
        ' ': 1, ArrowRight: 1, ArrowDown: 1, PageDown: 1, Enter: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1,
      }[e.key];
      if (p && /^[1-9]$/.test(e.key) && p.steps[p.i]?.choices) {
        e.preventDefault();
        e.stopPropagation();
        this.pickBranch(Number(e.key) - 1);
        return;
      }
      // ] [: the next frame, the one before (or the start of this one).
      if (p && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        e.stopPropagation();
        const frames = p.steps.map((x, j) => (x.frame ? j : -1)).filter((j) => j >= 0);
        const to = e.key === ']' ? frames.find((j) => j > p.i) : frames.filter((j) => j < p.i).pop();
        this.showStep(to ?? (e.key === ']' ? p.steps.length - 1 : 0));
        return;
      }
      if (p && (show || ['Home', 'End', 'Escape'].includes(e.key))) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') this.endPresent();
        else this.showStep(e.key === 'Home' ? 0 : e.key === 'End' ? p.steps.length - 1 : p.i + show);
        return;
      }
      if (!p && e.key === 'p') { e.preventDefault(); this.present(); return; }
      // A picture looked at (no box or arrow selected): its drawing keys.
      const picture = !!this.goal?.fig?.matches?.('.ink-figure') && !this.walkAt && !this.edgeAt;
      if (!p && !e.shiftKey && this.ink.key(e, picture)) { e.preventDefault(); e.stopPropagation(); return; }
      const c = this.choice;
      const pick = c && {
        Tab: () => { c.i = (c.i + (e.shiftKey ? c.list.length - 1 : 1)) % c.list.length; this.showChoice(); },
        Enter: () => this.choose(c.i),
        Escape: () => this.clearChoice(),
      }[e.key];
      const n = c && /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
      const walk = pick || (n >= 0 && n < c.list.length ? () => this.choose(n) : null) || {
        ArrowRight: () => this.step(), ArrowDown: () => this.step(), ArrowLeft: () => this.step(true), ArrowUp: () => this.step(true), g: () => this.jump(),
      }[e.key];
      if (walk) { e.preventDefault(); e.stopPropagation(); walk(); return; }
      if (this.busy && performance.now() > this.busy.until) { this.busy = null; this.queued = []; }
      if (this.busy && (EDIT_KEYS.has(e.key) || (this.pending?.rename && e.key.length === 1))) {
        e.preventDefault();
        e.stopPropagation();
        // A box about to be named: the letters were for its name, not keys.
        if (!this.pending?.rename) this.queued.push({ key: e.key, shiftKey: e.shiftKey });
        return;
      }
      if (this.editKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
      const act = {
        Escape: () => this.h.onEscape?.(), '+': () => this.zoomBy(1.25), '=': () => this.zoomBy(1.25), '-': () => this.zoomBy(1 / 1.25),
        0: () => this.toggleAll(), l: () => this.toggleLinks(), 1: () => { const r = stage.getBoundingClientRect(); this.zoomAt(1, r.width / 2, r.height / 2); },
      }[e.key];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    });
  }

  click(target) {
    this.clicked = null;
    // A link: go to its end away from the picture being looked at.
    const link = target.closest('.canvas-link-hit')?.link;
    if (link) {
      const [a, b] = link;
      const to = a.pre === this.goal?.fig ? b : b.pre === this.goal?.fig ? a : b;
      this.setView('picture');
      (this.h.onStep || this.h.onNode)?.(to.pre, to.id);
      return;
    }
    const section = this.sections.find((s) => s.el.contains(target));
    if (!section) return;
    const card = target.closest('.canvas-card');
    const fig = card && section.figures.find((f) => card.contains(f));
    const b = target.closest('.node-hit');
    if (b && fig) this.clicked = { pre: fig, id: b.dataset.id, at: performance.now() };
    if (this.presenting) {
      // Go on from the box clicked (or the picture's first step, or the
      // frame's).
      const steps = this.presenting.steps;
      let i = fig ? steps.findIndex((st) => st.pre === fig && (!b || st.id === b.dataset.id || !st.id)) : -1;
      if (i < 0) i = steps.findIndex((st) => st.frame === section);
      if (i >= 0) this.showStep(i);
      return;
    }
    if (!fig) {
      // The frame's title: the cursor goes to the heading, the camera stays.
      this.picking = true;
      try { this.h.onSection?.(section); } finally { this.picking = false; }
      return;
    }
    const edge = target.closest('.edge');
    if (edge && fig) {
      this.selectEdge(fig, edge.dataset.from, edge.dataset.to);
      this.h.onArrowStep?.(fig, edge.dataset.from, edge.dataset.to);
      return;
    }
    const looking = this.view === 'picture' && this.goal?.fig === fig;
    // A box clicked is the one selected (the keys act on it), over one a
    // change was going to select.
    this.endWalk();
    this.pending = null;
    this.keep = null;
    this.edgeAt = null;
    this.edgeSoon = null;
    if (b && fig.flowNodes) this.walkAt = { pre: fig, id: b.dataset.id };
    const dot = !this.ink?.tool && target.closest('.ink-mark[data-num]');
    const pick = () => (dot ? this.h.onInkDot?.(fig, dot.dataset.num) : b ? this.h.onNode?.(fig, b.dataset.id) : this.h.onFigure?.(fig));
    if (looking) {
      this.picking = true;
      try { pick(); } finally { this.picking = false; }
      return;
    }
    // Another picture (or seen from "all"): look at it.
    this.setView('picture');
    const before = this.sig;
    pick();
    if (this.sig === before) this.refocus(true);
  }

  // ---- drawing

  // The picture an element is in (a figure of a section), or null.
  figureOf(target) {
    const card = target.closest?.('.canvas-card');
    if (!card) return null;
    for (const s of this.sections) { const f = s.figures.find((x) => card.contains(x)); if (f) return f; }
    return null;
  }

  // Select a box: marked here, the cursor on its text, the keys kept here.
  select(pre, id) {
    this.endWalk();
    this.pending = null;
    this.keep = null;
    this.edgeAt = null;
    this.walkAt = { pre, id };
    this.h.onStep?.(pre, id);
    this.mark();
  }

  // Keys for the box selected (Tab, Enter/F2, Delete, C, S) and for a picture
  // (N). → whether the key was one of them.
  editKey(e) {
    const ed = this.edgeAt;
    if (ed && !e.shiftKey) {
      const what = { Delete: 'delete', Backspace: 'delete', b: 'both', r: 'reverse', d: 'dotted', Enter: 'label', F2: 'label', Escape: 'unselect' }[e.key];
      if (what === 'unselect') { this.edgeAt = null; this.mark(); return true; }
      if (what === 'label') { this.labelEdge(ed); return true; }
      if (what) { this.h.onArrow?.(ed.pre, ed, what); return true; }
    }
    const at = this.walkAt;
    const fig = at?.pre || this.goal?.fig;
    const need = () => { this.say('Click a box first (or walk to one with the arrow keys).'); };
    const run = {
      Tab: () => (at ? this.h.onAddAfter?.(at.pre, at.id) : need()),
      Enter: () => (at ? this.renameBox(at) : need()),
      F2: () => (at ? this.renameBox(at) : need()),
      Delete: () => (at ? this.h.onDelete?.(at.pre, at.id) : need()),
      Backspace: () => (at ? this.h.onDelete?.(at.pre, at.id) : need()),
      c: () => {
        if (!at) { need(); return; }
        const r = this.hit(at.pre, at.id)?.getBoundingClientRect();
        this.h.onColorMenu?.(at.pre, at.id, r ? { x: r.left, y: r.bottom + 6 } : null);
      },
      s: () => {
        if (!at) { need(); return; }
        const r = this.hit(at.pre, at.id)?.getBoundingClientRect();
        this.h.onShapeMenu?.(at.pre, at.id, r ? { x: r.left, y: r.bottom + 6 } : null);
      },
      n: () => (fig?.flowNodes ? this.h.onAddBox?.(fig) : this.say('Look at a ```flow picture first.')),
    }[e.key];
    if (!run || e.shiftKey || (e.key === 'Tab' && !at)) return false;
    run();
    return true;
  }

  renameBox(at) {
    if (!this.h.canRename?.(at.pre)) return;
    const b = this.hit(at.pre, at.id);
    if (b) this.rename(at.pre, b);
  }

  // Dragging from a box's +: a line follows the pointer; let go on another
  // box of the picture to draw an arrow to it, on nothing for a new box.
  startWire(e, plus) {
    const hit = plus.closest('.node-hit');
    const pre = hit?.closest('pre');
    if (!pre) return;
    e.preventDefault();
    const s = this.stage.getBoundingClientRect();
    const r = plus.getBoundingClientRect();
    this.wiring = { pre, from: hit.dataset.id, x0: r.left + r.width / 2 - s.left, y0: r.top + r.height / 2 - s.top, px: e.clientX, py: e.clientY, moved: false, to: null };
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* a pointer no longer down */ }
    this.editing?.remove();
  }

  moveWire(e) {
    const w = this.wiring;
    if (!w.moved && Math.hypot(e.clientX - w.px, e.clientY - w.py) < 4) return;
    w.moved = true;
    this.stage.classList.add('wiring');
    const s = this.stage.getBoundingClientRect();
    const x = e.clientX - s.left;
    const y = e.clientY - s.top;
    this.wire.classList.add('on');
    this.wireLine.setAttribute('d', `M${w.x0},${w.y0} L${x},${y}`);
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains('node-hit'));
    const to = under && under.closest('pre') === w.pre && under.dataset.id !== w.from ? under : null;
    if (to !== w.to) { w.to?.classList.remove('wire-to'); to?.classList.add('wire-to'); w.to = to; }
    w.other = !to && under ? under : null; // a box of another picture
  }

  endWire(commit) {
    const w = this.wiring;
    this.wiring = null;
    this.wire.classList.remove('on');
    this.stage.classList.remove('wiring');
    w.to?.classList.remove('wire-to');
    this.dragged = w.moved;
    if (!commit) return;
    if (!w.moved || (!w.to && !w.other)) { this.h.onAddAfter?.(w.pre, w.from); return; }
    if (w.to) { this.h.onConnect?.(w.pre, w.from, w.to.dataset.id); return; }
    this.say('An arrow joins boxes of one picture. Boxes of the same name in two pictures are linked already.');
  }

  // An input over the box; Enter renames it in the note, Esc or leaving cancels.
  rename(pre, box) {
    const node = pre.flowNodes?.find((n) => n.id === box.dataset.id);
    if (!node) return;
    this.typeOver(() => (box.isConnected ? box.getBoundingClientRect() : null), node.text, (text) => {
      if (text && text !== node.text) this.h.onRename?.(pre, node, text);
    });
  }

  // The words on an arrow, typed over its middle.
  labelEdge(a) {
    const e = (a.pre.flowEdges || []).find((x) => x.from === a.from && x.to === a.to);
    const line = a.pre.diagramEdges?.find((x) => x.from === a.from && x.to === a.to);
    if (!e || !line) return;
    const [x, y] = line.pts[Math.floor(line.pts.length / 2)];
    const at = () => {
      const layer = a.pre.querySelector(':scope > .node-layer');
      if (!layer?.isConnected) return null;
      const r = layer.getBoundingClientRect();
      return { left: r.left + x * r.width, top: r.top + y * r.height, width: 0, height: 0 };
    };
    this.typeOver(at, e.label, (text) => { if (text !== e.label) this.h.onArrow?.(a.pre, a, 'label', text); }, 'Words on the arrow');
  }

  // An input over a spot (rect() → where, or null once it is gone); Enter
  // gives its text to give, Esc or leaving cancels.
  typeOver(rect, value, give, placeholder = '') {
    this.editing?.remove();
    const input = el('input', 'canvas-rename');
    input.value = value;
    input.placeholder = placeholder;
    // Over it, wherever the camera goes meanwhile.
    const place = () => {
      const r = rect();
      if (!r) return;
      const s = this.stage.getBoundingClientRect();
      const w = Math.max(140, r.width);
      input.style.left = `${r.left - s.left + r.width / 2 - w / 2}px`;
      input.style.top = `${r.top - s.top + r.height / 2 - 16}px`;
      input.style.width = `${w}px`;
    };
    place();
    let done = false;
    const finish = (commit, refocus = true) => {
      if (done) return;
      done = true;
      input.remove();
      if (this.editing === handle) this.editing = null;
      if (commit) give(input.value.trim());
      if (refocus) this.stage.focus({ preventScroll: true });
    };
    const handle = { remove: () => finish(false, false), place };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false, false));
    this.stage.append(input);
    this.editing = handle;
    input.focus();
    input.select();
  }
}
