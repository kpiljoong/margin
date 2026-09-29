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
// Pictures are the preview's own elements, drawn by public/diagrams.js; each
// diagram reports where its boxes are ('diagram-shown'), and a transparent
// layer of hit boxes goes over it.

import { similarNames } from './flow.js';

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
const RENAME_TIP = 'Click: select it in the note · Double-click: rename';

export class FigureCanvas {
  // onNode(pre, id) · onSection(section) · onFigure(fig) · canRename(pre) ·
  // onRename(pre, node, text) · onHover(pre, id) (null, null when it leaves) ·
  // onEscape() · here() → the ```flow box at the cursor { pre, id } ·
  // onStep(pre, id): put the cursor on a box, keeping the focus here ·
  // tour() → the steps to present (see present)
  constructor(handlers) {
    this.h = handlers;
    this.k = 1; this.x = 0; this.y = 0;
    this.fresh = true; // no camera position yet
    this.view = 'picture'; // or 'all'
    try { this.zoomFor = { picture: null, allRatio: null, ...JSON.parse(localStorage.getItem(ZOOM_KEY) || '{}') }; } catch { this.zoomFor = { picture: null, allRatio: null }; }
    this.sig = null; // what the camera was last moved to
    this.goal = null; // { section, fig, nodes: [{ pre, id }] }
    this.sections = [];
    this.animEnd = 0;
    this.links = null; // [[{ pre, id }, { pre, id }]]
    this.hover = null; // the box under the pointer: { pre, id }
    this.pin = null; // the box kept still while the pictures redraw (pinBox)
    // Following the flow with the keys: the box walked to, the steps taken
    // (to go back), and the ways offered at a branch.
    this.walkAt = null; // { pre, id }
    this.trail = []; // [{ from, to }]
    this.choice = null; // { list: [{ pre, id, label }], i, from, back }
    this.linksAll = localStorage.getItem(LINKS_KEY) === 'all';
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
    this.endWalk();
    this.endPresent();
    this.whenLoaded(this.world, () => { this.holdPin(); this.drawLinksSoon(); });
    this.empty.hidden = sections.length > 0;
    this.empty.textContent = sections.length ? '' : 'No pictures yet. Write a ```flow or ```mermaid block and it shows up here.';
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
    const sig = goal ? `${goal.section.key}|${goal.section.figures.indexOf(goal.fig)}|${goal.nodes.map((n) => n.id).join(',')}` : null;
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
    this.drawLinksSoon();
  }

  // ---- presenting

  // Full screen, one step at a time: [{ pre, id (null for a whole picture),
  // title, text, note, via, lines }] from h.tour(). Boxes not reached yet
  // are dimmed; the caption tells the step and the text that names it.
  // It starts from the box being walked, else the one at the cursor.
  present() {
    const prefer = new Map();
    const steps = this.h.tour?.(prefer) || [];
    if (!steps.length) { this.say('Nothing to present: write a ```flow block.'); return; }
    const at = this.walkAt || this.h.here?.();
    const first = Math.max(0, steps.findIndex((st) => st.pre === at?.pre && st.id === at?.id));
    this.presenting = { steps, i: -1, prefer };
    this.framed = null;
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
    // Reached so far: dim the rest.
    const reached = new Set(p.steps.slice(0, i + 1).map((x) => x));
    this.world.querySelectorAll('.node-hit').forEach((b) => b.classList.add('unseen'));
    for (const x of reached) {
      if (x.id) this.hit(x.pre, x.id)?.classList.remove('unseen');
      else x.pre.querySelectorAll(':scope > .node-layer > .node-hit').forEach((b) => b.classList.remove('unseen'));
    }
    this.clearChoice();
    this.walkAt = st.id ? { pre: st.pre, id: st.id } : null;
    this.trail = [];
    // The cursor follows, but the camera frames the picture (below).
    this.picking = true;
    try { if (st.id) this.h.onStep?.(st.pre, st.id); else this.h.onFigure?.(st.pre); } finally { this.picking = false; }
    if (st.id) this.hit(st.pre, st.id)?.classList.add('walk-at');
    const line = (cls, text) => (text ? el('div', cls, text) : null);
    this.caption.replaceChildren(...[
      el('div', 'cap-head', `${st.title}  ·  ${i + 1} / ${p.steps.length}`),
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
  // followed box by box instead.
  frame(st, force) {
    const card = this.cardOf(st.pre);
    if (!card) return;
    this.whenLoaded(card, () => {
      const s = this.stage.getBoundingClientRect();
      const cap = this.caption.hidden ? 0 : this.caption.offsetHeight + 36;
      const w = s.width - PAD * 2;
      const h = s.height - cap - PAD * 2;
      const c = this.bounds([card]);
      const fit = Math.min(2, w / c.w, h / c.h);
      const box = st.id && this.hit(st.pre, st.id);
      if (fit >= 0.5) {
        if (this.framed === card && !force) return;
        this.framed = card;
        this.moveTo(fit, s.width / 2 - (c.x + c.w / 2) * fit, PAD + (h - c.h * fit) / 2 - c.y * fit, true);
        return;
      }
      this.framed = null;
      const b = box ? this.bounds([box]) : c;
      const k = 0.8;
      this.moveTo(k, s.width / 2 - (b.x + b.w / 2) * k, PAD + h / 2 - (b.y + b.h / 2) * k, true);
    });
  }

  endPresent() {
    if (!this.presenting) return;
    this.presenting = null;
    this.el.classList.remove('presenting');
    this.world.querySelectorAll('.node-hit.unseen').forEach((b) => b.classList.remove('unseen'));
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
    try { localStorage.setItem(LINKS_KEY, this.linksAll ? 'all' : 'picture'); } catch { /* private mode */ }
    this.drawLinks();
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
      layer.append(b);
    }
    pre.append(layer);
  }

  // ---- camera

  apply() {
    this.world.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.k})`;
    this.zoomLabel.textContent = `${Math.round(this.k * 100)}%`;
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
    this.x = cx - (cx - this.x) * (next / this.k);
    this.y = cy - (cy - this.y) * (next / this.k);
    this.k = next;
    this.fresh = false;
    this.apply();
    if (this.view === 'all') this.zoomFor.allRatio = next / (this.fitAllK || next);
    else this.zoomFor.picture = next;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { try { localStorage.setItem(ZOOM_KEY, JSON.stringify(this.zoomFor)); } catch { /* private mode */ } }, 400);
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
    });
    stage.addEventListener('pointerleave', () => {
      this.setHover(null);
      this.world.querySelectorAll('.node-hit.linked').forEach((x) => x.classList.remove('linked'));
    });

    let press = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('input, button')) return;
      press = { px: e.clientX, py: e.clientY, moved: false, id: e.pointerId };
    });
    stage.addEventListener('pointermove', (e) => {
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
      this.x = press.x + dx;
      this.y = press.y + dy;
      this.fresh = false;
      this.apply();
    });
    const release = () => {
      this.dragged = !!press?.moved;
      press = null;
      stage.classList.remove('panning');
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    // The second click of a double-click is not another pick: the camera may
    // have moved since the first, so it could land on something else.
    stage.addEventListener('click', (e) => {
      if (this.dragged || e.detail > 1 || e.target.closest('input, button')) return;
      this.click(e.target);
    });
    stage.addEventListener('dblclick', (e) => {
      // The box of the first click, even if the camera moved since.
      const n = this.clicked;
      if (this.presenting) return;
      if (n && performance.now() - n.at < 800 && this.h.canRename?.(n.pre)) {
        setTimeout(() => { const b = this.hit(n.pre, n.id); if (b) this.rename(n.pre, b); }, Math.max(0, this.animEnd - performance.now()) + 20);
      } else if (!e.target.closest('.canvas-section')) this.toggleAll();
    });
    // Leaving full screen (Esc there is the browser's) ends the presentation.
    document.addEventListener('fullscreenchange', () => {
      if (!this.presenting) return;
      if (document.fullscreenElement !== this.el) this.endPresent();
      else setTimeout(() => this.showStep(this.presenting?.i ?? 0, true), 50); // the view grew
    });
    stage.addEventListener('keydown', (e) => {
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
      if (p && (show || ['Home', 'End', 'Escape'].includes(e.key))) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') this.endPresent();
        else this.showStep(e.key === 'Home' ? 0 : e.key === 'End' ? p.steps.length - 1 : p.i + show);
        return;
      }
      if (!p && e.key === 'p') { e.preventDefault(); this.present(); return; }
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
      // Go on from the box clicked (or the picture's first step).
      const steps = this.presenting.steps;
      const i = fig ? steps.findIndex((st) => st.pre === fig && (!b || st.id === b.dataset.id || !st.id)) : -1;
      if (i >= 0) this.showStep(i);
      return;
    }
    if (!fig) {
      // The frame's title: the cursor goes to the heading, the camera stays.
      this.picking = true;
      try { this.h.onSection?.(section); } finally { this.picking = false; }
      return;
    }
    const looking = this.view === 'picture' && this.goal?.fig === fig;
    const pick = () => (b ? this.h.onNode?.(fig, b.dataset.id) : this.h.onFigure?.(fig));
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

  // An input over the box; Enter renames it in the note, Esc or leaving cancels.
  rename(pre, box) {
    this.editing?.remove();
    const node = pre.flowNodes?.find((n) => n.id === box.dataset.id);
    if (!node) return;
    const s = this.stage.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const input = el('input', 'canvas-rename');
    input.value = node.text;
    input.style.left = `${r.left - s.left}px`;
    input.style.top = `${r.top - s.top + r.height / 2 - 16}px`;
    input.style.width = `${Math.max(140, r.width)}px`;
    let done = false;
    const finish = (commit, refocus = true) => {
      if (done) return;
      done = true;
      input.remove();
      if (this.editing === handle) this.editing = null;
      const text = input.value.trim();
      if (commit && text && text !== node.text) this.h.onRename?.(pre, node, text);
      else if (refocus) this.stage.focus({ preventScroll: true });
    };
    const handle = { remove: () => finish(false, false) };
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
