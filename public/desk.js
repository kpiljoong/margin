// The desk (experimental): notes and cards laid out on a plane, to think
// with — moved, stacked into groups, linked, and given to the margin (a fast
// model, server.js → lib/desk.js) to sum up, question, sort, link or merge,
// or to talk about. Its file is a JSON Canvas (.canvas, as Obsidian writes
// them), so the same desk opens there. The text is always flat and facing
// you; the depth is for what is lifted, stacked or being thought about.
// What the margin writes stays beside the cards until it is kept (Tab).

// ---------------------------------------------------------------- the file

export const EMPTY_DESK = '{\n\t"nodes":[],\n\t"edges":[]\n}\n';

export function parseDesk(text) {
  const t = String(text || '').trim();
  const d = t ? JSON.parse(t) : {};
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Not a desk (.canvas) file');
  const nodes = Array.isArray(d.nodes) ? d.nodes.filter((n) => n && typeof n.id === 'string') : [];
  for (const n of nodes) for (const k of ['x', 'y', 'width', 'height']) n[k] = Number.isFinite(Number(n[k])) ? Math.round(Number(n[k])) : k === 'width' ? 250 : k === 'height' ? 60 : 0;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(d.edges) ? d.edges.filter((e) => e && ids.has(e.fromNode) && ids.has(e.toNode)) : [];
  return { ...d, nodes, edges };
}

// As Obsidian writes it: tabs, a line at the end.
export const stringifyDesk = (d) => `${JSON.stringify(d, null, '\t')}\n`;

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

export function boundsOf(nodes) {
  if (!nodes.length) return null;
  const x = Math.min(...nodes.map((n) => n.x));
  const y = Math.min(...nodes.map((n) => n.y));
  return { x, y, width: Math.max(...nodes.map((n) => n.x + n.width)) - x, height: Math.max(...nodes.map((n) => n.y + n.height)) - y };
}

const within = (n, g) => n !== g && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height;
// A group holds what lies inside it (as in JSON Canvas: by place).
export const childrenOf = (d, g) => d.nodes.filter((n) => within(n, g));
export const groupAt = (d, n) => d.nodes.filter((g) => g.type === 'group' && within(n, g)).sort((a, b) => a.width * a.height - b.width * b.height)[0] || null;

// A card's name: a note's file name, a group's label, a card's first words.
export function cardTitle(n) {
  if (n.type === 'file') return String(n.file || '').split('/').pop().replace(/\.[^.]+$/, '');
  if (n.type === 'group') return n.label || 'Group';
  if (n.type === 'link') return n.url || '';
  return String(n.text || '').split('\n').map((l) => l.replace(/^[#>\s*-]+/, '').trim()).find(Boolean)?.slice(0, 80) || '';
}

const PAD = 40;
const HEAD = 60; // room for a group's label

// Cards dropped on a card: a pile of them, each a little lower than the one
// before so the titles show, in a group — or onto the pile that card is in.
// → the desk, changed.
export const STEP = { x: 14, y: 56 };
// Zoomed out from FAR[0] to FAR[1], cards go from their text to their titles.
export const FAR = [0.6, 0.35];
export function stackOnto(d, ids, ontoId) {
  const onto = d.nodes.find((n) => n.id === ontoId);
  const moving = d.nodes.filter((n) => ids.includes(n.id) && n.id !== ontoId && n.type !== 'group');
  if (!onto || !moving.length) return d;
  const g0 = groupAt(d, onto);
  const inGroup = g0 ? childrenOf(d, g0).filter((n) => n.type !== 'group' && !ids.includes(n.id)) : [onto];
  const last = inGroup.reduce((a, n) => (n.y > a.y ? n : a), onto);
  const at = new Map(moving.map((m, i) => [m.id, { x: last.x + STEP.x * (i + 1), y: last.y + STEP.y * (i + 1) }]));
  // On top: last in the file, drawn last.
  const rest = d.nodes.filter((n) => !at.has(n.id)).map((n) => ({ ...n }));
  const top = moving.map((m) => ({ ...m, ...at.get(m.id) }));
  const all = [...inGroup.map((n) => rest.find((r) => r.id === n.id)), ...top];
  const b = boundsOf(all);
  const box = { x: b.x - PAD, y: b.y - HEAD, width: b.width + 2 * PAD, height: b.height + HEAD + PAD };
  if (g0) {
    const g = rest.find((n) => n.id === g0.id);
    const nx = Math.min(g.x, box.x);
    const ny = Math.min(g.y, box.y);
    Object.assign(g, { x: nx, y: ny, width: Math.max(g.x + g.width, box.x + box.width) - nx, height: Math.max(g.y + g.height, box.y + box.height) - ny });
    return { ...d, nodes: [...rest, ...top] };
  }
  // A new group goes first: groups are drawn under the cards.
  return { ...d, nodes: [{ id: newId(), type: 'group', label: 'Stack', ...box }, ...rest, ...top] };
}

// A group around the cards, where they are.
export function groupAround(d, ids, label = 'Group') {
  const ns = d.nodes.filter((n) => ids.includes(n.id));
  const b = boundsOf(ns);
  if (!b) return d;
  return { ...d, nodes: [{ id: newId(), type: 'group', label, x: b.x - PAD, y: b.y - HEAD, width: b.width + 2 * PAD, height: b.height + HEAD + PAD }, ...d.nodes] };
}

// Taken off the desk (not the notes): the cards, the edges to them.
export function removeCards(d, ids) {
  const gone = new Set(ids);
  return { ...d, nodes: d.nodes.filter((n) => !gone.has(n.id)), edges: d.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)) };
}

// ---------------------------------------------------------------- the margin's replies

// "Budget: 1, 4" a line → [{ name, cards: [index] }]; every card once, the
// ones it left out in "Other".
export function parseGroups(text, count) {
  const out = [];
  const used = new Set();
  for (const l of String(text).split('\n')) {
    const m = /^\s*(?:[-*\d.)\s]*)\**([^:*]{1,60}?)\**\s*:\s*((?:#?\d+[\s,]*(?:and\s*)?)+)\s*$/i.exec(l);
    if (!m) continue;
    const cards = (m[2].match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= count && !used.has(n - 1)).map((n) => n - 1);
    for (const c of cards) used.add(c);
    if (cards.length) out.push({ name: m[1].trim(), cards });
  }
  const rest = [...Array(count).keys()].filter((i) => !used.has(i));
  if (rest.length && out.length) out.push({ name: 'Other', cards: rest });
  return out;
}

// "#1-#3: same budget" a line → [{ a, b, label }] (indexes from 0).
export function parseLinks(text, count) {
  const out = [];
  for (const l of String(text).split('\n')) {
    const m = /#?(\d+)\s*(?:-|–|—|↔|<->|and)\s*#?(\d+)\s*:?\s*(.*)$/.exec(l);
    if (!m) continue;
    const [a, b] = [Number(m[1]) - 1, Number(m[2]) - 1];
    if (a === b || a < 0 || b < 0 || a >= count || b >= count || out.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) continue;
    out.push({ a, b, label: m[3].replace(/^[\s:–—-]+/, '').replace(/\*+/g, '').trim().slice(0, 60) });
  }
  return out;
}

// "? Who pays? (#1, #3)" lines → the questions.
export const parseQuestions = (text) => String(text).split('\n').map((l) => l.trim()).filter((l) => /^(?:[-*\d.)\s]*)\?\s*\S/.test(l)).map((l) => l.replace(/^(?:[-*\d.)\s]*)\?\s*/, ''));

// The groups laid out side by side from (x, y), each a column of its
// cards. groups: [{ name, cards: [node] }] → [{ name, box, at: [{ id, x, y }] }].
export function groupLayout(groups, x0, y0) {
  let x = x0;
  return groups.map((g) => {
    const w = Math.max(...g.cards.map((n) => n.width));
    let y = y0 + HEAD;
    const at = g.cards.map((n) => { const p = { id: n.id, x: x + PAD, y }; y += n.height + PAD / 2; return p; });
    const box = { x, y: y0, width: w + 2 * PAD, height: y - y0 + PAD / 2 };
    x += box.width + PAD;
    return { name: g.name, box, at };
  });
}

// The nearest card from one, in a direction (arrow keys).
export function nearest(nodes, from, dir) {
  const c = (n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
  const o = c(from);
  let best = null;
  let score = Infinity;
  for (const n of nodes) {
    if (n === from || n.type === 'group') continue;
    const p = c(n);
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const s = along + across * 2;
    if (s < score) { score = s; best = n; }
  }
  return best;
}

// An edge's path between two cards: from the sides that face each other.
export function edgePath(a, b, fromSide, toSide) {
  const side = (n, s) => (s === 'top' ? [n.x + n.width / 2, n.y] : s === 'bottom' ? [n.x + n.width / 2, n.y + n.height] : s === 'left' ? [n.x, n.y + n.height / 2] : [n.x + n.width, n.y + n.height / 2]);
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  const auto = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']);
  const fs = fromSide || auto[0];
  const ts = toSide || auto[1];
  const [x1, y1] = side(a, fs);
  const [x2, y2] = side(b, ts);
  const k = Math.max(40, Math.hypot(x2 - x1, y2 - y1) / 3);
  const pull = (s) => (s === 'top' ? [0, -k] : s === 'bottom' ? [0, k] : s === 'left' ? [-k, 0] : [k, 0]);
  const [p1, q1] = pull(fs);
  const [p2, q2] = pull(ts);
  const r = (v) => Math.round(v);
  return { d: `M${r(x1)},${r(y1)} C${r(x1 + p1)},${r(y1 + q1)} ${r(x2 + p2)},${r(y2 + q2)} ${r(x2)},${r(y2)}`, mid: [r((x1 + x2) / 2 + (p1 + p2) / 8), r((y1 + y2) / 2 + (q1 + q2) / 8)] };
}

// ---------------------------------------------------------------- the view

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}
function button(label, title, run, cls = '') {
  const b = el('button', `btn small ${cls}`.trim(), label);
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  return b;
}
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, cls) => { const e = document.createElementNS(SVG, tag); if (cls) e.setAttribute('class', cls); return e; };

const ACTIONS = [
  ['summary', 'Sum up', 's', 'What the cards say together, where they agree and where they don’t'],
  ['questions', 'Questions', 'q', 'What they leave open, or where they disagree'],
  ['group', 'Sort', 'o', 'Into groups by what they are about (shown first, Tab to take)'],
  ['links', 'Links', 'l', 'The cards that belong together (shown first, Tab to take)'],
  ['merge', 'Merge', 'm', 'One note of them all, to make into a new note'],
];

// opts: { text, path, render(md) → html, readNote(path) → Promise<text>,
// imageUrl(path), openNote(path), pickNote() → Promise<path>, makeNote(md)
// → Promise<path>, ask({ task, cards, question, talk }, onText) →
// Promise<{ said, end, withheld }>, onChange(text), toast(msg, kind), reduced }
export class Desk {
  constructor(opts) {
    this.opts = opts;
    this.d = parseDesk(opts.text);
    this.cam = { x: 80, y: 80, z: 1 };
    this.sel = new Set();
    this.els = new Map();
    this.html = new Map(); // a note's card: its rendered text
    this.ai = []; // what the margin wrote, not kept yet
    this.proposal = null; // { kind: 'group' | 'links', ... }
    this.undo = [];
    this.redo = [];
    this.talk = [];
    this.talkKey = newId();
    this.build();
    this.render();
    requestAnimationFrame(() => this.fit(false));
  }

  // ---- the parts
  build() {
    this.grid = el('div', 'desk-grid', el('div', 'desk-grid-far'), el('div', 'desk-grid-near'));
    this.edges = svg('svg', 'desk-edges');
    const defs = svg('defs');
    const marker = svg('marker');
    marker.setAttribute('id', 'desk-arrow');
    for (const [k, v] of [['viewBox', '0 0 10 10'], ['refX', '9'], ['refY', '5'], ['markerWidth', '7'], ['markerHeight', '7'], ['orient', 'auto-start-reverse']]) marker.setAttribute(k, v);
    const tip = svg('path');
    tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    marker.append(tip);
    defs.append(marker);
    this.edges.append(defs);
    this.edgeG = svg('g');
    this.edges.append(this.edgeG);
    this.labels = el('div', 'desk-labels');
    this.world = el('div', 'desk-world', this.edges, this.labels);
    this.marquee = el('div', 'desk-marquee');
    this.marquee.hidden = true;
    this.dock = this.buildDock();
    this.hint = el('div', 'desk-hint', 'Double-click: a card · drag a note from the tree · drop a card on a card: a group · drop cards on the margin, or s q o l m · / talk · z all');
    this.el = el('div', 'desk', this.grid, this.world, this.marquee, this.dock, this.hint);
    this.el.tabIndex = 0;
    this.el.desk = this; // for tests
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.el.addEventListener('dblclick', (e) => this.dbl(e));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('keyup', (e) => { if (e.key === ' ') this.space = false; });
    // "#2" in what the margin wrote: that card, shown.
    this.el.addEventListener('click', (e) => {
      const t = e.target.closest?.('a.tag');
      const n = /^(\d+)/.exec(t?.dataset.tag || '');
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      const id = [...(this.nums || [])].find(([, v]) => v === Number(n[1]))?.[0];
      const card = id && this.d.nodes.find((x) => x.id === id);
      if (!card) return;
      this.sel = new Set([id]);
      this.paintSel();
      this.dockShow();
      this.show(card, true);
    }, true);
    this.el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-margin-path')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    this.el.addEventListener('drop', (e) => {
      const p = e.dataTransfer.getData('text/x-margin-path');
      if (!p) return;
      e.preventDefault();
      const w = this.toWorld(e.clientX, e.clientY);
      this.addFile(p, w.x - 200, w.y - 40);
    });
  }

  buildDock() {
    this.ctx = el('div', 'desk-ctx');
    this.actions = el('div', 'desk-actions', ...ACTIONS.map(([task, label, k, title]) => { const b = button(label, `${title} (${k}, or drop cards on it)`, () => this.act(task)); b.dataset.task = task; return b; }));
    this.log = el('div', 'desk-log');
    this.input = el('textarea', 'desk-input');
    this.input.rows = 2;
    this.input.placeholder = 'Ask about the cards… (Enter)';
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const q = this.input.value.trim(); if (q) { this.input.value = ''; this.chat(q); } }
      if (e.key === 'Escape') { e.preventDefault(); this.el.focus(); }
    });
    this.status = el('span', 'desk-status');
    const dock = el('div', 'desk-dock', el('div', 'desk-dock-head', el('b', null, 'Margin'), this.status), this.ctx, this.actions, this.log, this.input);
    dock.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pressed('dock'); });
    dock.addEventListener('wheel', (e) => e.stopPropagation());
    dock.addEventListener('dblclick', (e) => e.stopPropagation());
    return dock;
  }

  // ---- the plane
  // The width the panel takes at the right (and its gap).
  side() { return this.dock.offsetLeft > this.el.clientWidth / 2 ? this.dock.offsetWidth + 24 : 0; } // (none when it is below, in a narrow pane)
  toWorld(cx, cy) {
    const r = this.el.getBoundingClientRect();
    return { x: (cx - r.left - this.cam.x) / this.cam.z, y: (cy - r.top - this.cam.y) / this.cam.z };
  }
  camera() {
    const { x, y, z } = this.cam;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    // Two layers of dots, the far one slower: depth as you move.
    this.grid.style.setProperty('--gx', `${x}px`);
    this.grid.style.setProperty('--gy', `${y}px`);
    this.grid.style.setProperty('--gx2', `${x * 0.45}px`);
    this.grid.style.setProperty('--gy2', `${y * 0.45}px`);
    this.grid.style.setProperty('--gs', `${24 * z}px`);
    this.grid.style.setProperty('--gs2', `${48 * Math.max(0.5, z * 0.6)}px`);
    // Going away, little by little (0.6 to 0.35): the text of the cards fades,
    // and their titles grow to a size kept readable from afar.
    const f = Math.min(1, Math.max(0, (FAR[0] - z) / (FAR[0] - FAR[1])));
    this.el.classList.toggle('far', f > 0);
    this.el.classList.toggle('farthest', f >= 1);
    this.world.style.setProperty('--far', f.toFixed(3));
    this.world.style.setProperty('--iz', String(1 + (1 / z - 1) * f));
    // What the margin would be given ("in view") follows the camera.
    if (!this.dockQ) this.dockQ = requestAnimationFrame(() => { this.dockQ = 0; this.dockShow(); });
  }
  // The camera on these cards (all, without), not closer than 1:1.
  fit(animate = true, nodes = null) {
    const b = boundsOf(nodes || [...this.d.nodes, ...this.ai]);
    const r = this.el.getBoundingClientRect();
    if (!b || !r.width) { this.cam = { x: 80, y: 80, z: 1 }; this.camera(); return; }
    const w = r.width - this.side();
    const z = Math.max(0.15, Math.min(1, (w - 80) / b.width, (r.height - 120) / b.height));
    this.goTo({ x: (w - b.width * z) / 2 - b.x * z, y: (r.height - b.height * z) / 2 - b.y * z, z }, animate);
  }
  goTo(cam, animate = true) {
    this.zoomGoal = null;
    if (!animate || this.opts.reduced) { this.cam = cam; this.camera(); return; }
    const from = { ...this.cam };
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 260);
      const e = 1 - (1 - k) ** 3;
      this.cam = { x: from.x + (cam.x - from.x) * e, y: from.y + (cam.y - from.y) * e, z: from.z + (cam.z - from.z) * e };
      this.camera();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // A card brought into view; read: close enough to read it too.
  show(n, read = false) {
    const r = this.el.getBoundingClientRect();
    const { x, y } = this.cam;
    const z = read ? Math.max(this.cam.z, Math.min(0.9, (r.width - this.side() - 60) / n.width)) : this.cam.z;
    if (z !== this.cam.z) { this.goTo({ z, x: (r.width - this.side()) / 2 - (n.x + n.width / 2) * z, y: Math.min(r.height / 3, 80) - n.y * z }); return; }
    const sx = n.x * z + x;
    const sy = n.y * z + y;
    if (sx > 20 && sy > 20 && sx + n.width * z < r.width - this.side() && sy + Math.min(n.height, 300) * z < r.height - 20) return;
    this.goTo({ z, x: (r.width - this.side()) / 2 - (n.x + n.width / 2) * z, y: r.height / 3 - n.y * z });
  }
  wheel(e) {
    const body = e.target.closest?.('.desk-card.sel .desk-body');
    if (body && !e.ctrlKey && !e.metaKey && body.scrollHeight > body.clientHeight + 2) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = this.el.getBoundingClientRect();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1);
      // A pinch (ctrl, in small steps) follows the fingers. ⌘ and the wheel, or
      // ⌘ and two fingers, come in bigger, uneven steps: smaller ones, eased.
      const pinch = e.ctrlKey && !e.metaKey && Math.abs(dy) < 50;
      const f = Math.exp(-Math.max(-50, Math.min(50, dy)) * (pinch ? 0.01 : 0.004));
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, f, !pinch);
      return;
    }
    this.cam = { ...this.cam, x: this.cam.x - e.deltaX, y: this.cam.y - e.deltaY };
    this.camera();
  }
  // Zoom by f around a point of the desk (what is under it stays); eased: toward it over a few frames.
  zoomAt(px, py, f, eased = false) {
    const clamp = (z) => Math.max(0.1, Math.min(2.5, z));
    const at = (z) => {
      this.cam = { x: px - ((px - this.cam.x) * z) / this.cam.z, y: py - ((py - this.cam.y) * z) / this.cam.z, z };
      this.camera();
    };
    if (!eased || this.opts.reduced) { this.zoomGoal = null; at(clamp(this.cam.z * f)); return; }
    this.zoomGoal = clamp((this.zoomGoal ?? this.cam.z) * f);
    this.zoomAround = { px, py };
    if (this.zoomQ) return;
    const step = () => {
      this.zoomQ = 0;
      if (this.zoomGoal == null) return;
      ({ px, py } = this.zoomAround);
      const gap = Math.log(this.zoomGoal / this.cam.z);
      if (Math.abs(gap) < 0.002) { at(this.zoomGoal); this.zoomGoal = null; return; }
      at(this.cam.z * Math.exp(gap * 0.3));
      this.zoomQ = requestAnimationFrame(step);
    };
    this.zoomQ = requestAnimationFrame(step);
  }

  // ---- the cards
  render() {
    const keep = new Set();
    for (const n of this.d.nodes) {
      keep.add(n.id);
      let e = this.els.get(n.id);
      if (!e || e.kind !== n.type) { e?.remove(); e = this.card(n); this.els.set(n.id, e); }
      this.fill(e, n);
      this.world.append(e); // in the file's order: groups first, under
    }
    for (const a of this.ai) {
      keep.add(a.id);
      let e = this.els.get(a.id);
      if (!e) { e = this.aiCard(a); this.els.set(a.id, e); }
      e.show(a);
      this.world.append(e);
    }
    for (const [id, e] of this.els) if (!keep.has(id)) { e.remove(); this.els.delete(id); }
    this.drawEdges();
    this.camera();
    this.dockShow();
  }
  card(n) {
    const e = el('div', `desk-card t-${n.type}`);
    e.kind = n.type;
    e.dataset.id = n.id;
    e.head = el('div', 'desk-head');
    e.body = el('div', 'desk-body md');
    e.grip = el('div', 'desk-grip');
    e.num = el('span', 'desk-num');
    e.append(e.head, e.body, e.grip, e.num);
    return e;
  }
  fill(e, n) {
    e.style.left = `${n.x}px`;
    e.style.top = `${n.y}px`;
    e.style.width = `${n.width}px`;
    e.style.height = `${n.height}px`;
    e.classList.toggle('sel', this.sel.has(n.id));
    e.className = e.className.replace(/\bc-\S+/g, '').trim();
    if (/^[1-6]$/.test(String(n.color || ''))) e.classList.add(`c-${n.color}`);
    else if (/^#[0-9a-f]{3,8}$/i.test(String(n.color || ''))) { e.classList.add('c-hex'); e.style.setProperty('--card', n.color); }
    // The number the margin knows it by, from its last answer (it says "#2").
    e.num.textContent = this.nums?.has(n.id) ? `#${this.nums.get(n.id)}` : '';
    const title = cardTitle(n);
    if (n.type === 'group') { e.head.textContent = title; e.body.replaceChildren(); return; }
    if (n.type === 'file') {
      e.head.textContent = title;
      e.head.title = n.file;
      if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(n.file)) {
        if (e.src !== n.file) { const img = el('img'); img.src = this.opts.imageUrl(n.file); img.alt = title; e.body.replaceChildren(img); e.src = n.file; }
        return;
      }
      const html = this.html.get(n.file);
      if (html == null) {
        e.body.textContent = 'Loading…';
        e.src = null;
        this.html.set(n.file, '');
        // Its front matter left out, and a first heading that only repeats the card's title.
        this.opts.readNote(n.file).then((t) => { this.html.set(n.file, this.opts.render(t.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s*#\s+(.+)\r?\n/, (m, h) => (h.trim() === title ? '' : m)), n.file)); this.render(); },
          () => { this.html.set(n.file, '<p class="desk-missing">Not found</p>'); this.render(); });
      } else if (e.src !== html) { e.body.innerHTML = html; e.src = html; }
      return;
    }
    e.head.textContent = title; // shown only far away
    const text = n.type === 'link' ? n.url || '' : n.text || '';
    if (e.editing) return;
    if (e.src !== text) { e.body.innerHTML = n.type === 'link' ? '' : this.opts.render(text); if (n.type === 'link') e.body.textContent = text; e.src = text; }
  }
  drawEdges() {
    const by = new Map([...this.d.nodes, ...this.ai].map((n) => [n.id, n]));
    this.edgeG.replaceChildren();
    this.labels.replaceChildren();
    const draw = (from, to, label, cls, e = {}) => {
      if (!from || !to) return;
      const { d, mid } = edgePath(from, to, e.fromSide, e.toSide);
      const p = svg('path', cls);
      p.setAttribute('d', d);
      if (e.toEnd !== 'none') p.setAttribute('marker-end', 'url(#desk-arrow)');
      this.edgeG.append(p);
      if (label) { const l = el('div', `desk-edge-label${cls.endsWith('ghost') ? ' ghost' : ''}`, label); l.style.left = `${mid[0]}px`; l.style.top = `${mid[1]}px`; this.labels.append(l); }
    };
    for (const e of this.d.edges) draw(by.get(e.fromNode), by.get(e.toNode), e.label, 'desk-edge', e);
    if (this.proposal?.kind === 'links') for (const l of this.proposal.links) draw(by.get(l.from), by.get(l.to), l.label, 'desk-edge ghost', { toEnd: 'none' });
    let w = 4000;
    let h = 4000;
    let x0 = 0;
    let y0 = 0;
    const b = boundsOf([...by.values()]);
    if (b) { x0 = Math.min(0, b.x - 200); y0 = Math.min(0, b.y - 200); w = Math.max(w, b.x + b.width + 400 - x0); h = Math.max(h, b.y + b.height + 400 - y0); }
    this.edges.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
    this.edges.style.left = `${x0}px`;
    this.edges.style.top = `${y0}px`;
    this.edges.style.width = `${w}px`;
    this.edges.style.height = `${h}px`;
    // The groups the margin would make, where they would be.
    this.world.querySelectorAll('.desk-ghost').forEach((g) => g.remove());
    if (this.proposal?.kind === 'group') {
      for (const g of this.proposal.layout) {
        const f = el('div', 'desk-ghost', el('span', null, g.name));
        Object.assign(f.style, { left: `${g.box.x}px`, top: `${g.box.y}px`, width: `${g.box.width}px`, height: `${g.box.height}px` });
        this.world.prepend(f);
      }
    }
  }

  // Every change: kept for undo, written to the file.
  change(next) {
    this.undo.push(stringifyDesk(this.d));
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
    this.d = next;
    this.render();
    this.opts.onChange(stringifyDesk(this.d));
  }
  // The file changed outside (another app): read again, the view kept.
  load(text) {
    try { this.d = parseDesk(text); } catch { return; }
    this.html.clear();
    this.render();
  }
  refreshNote(path) { if (this.html.has(path)) { this.html.delete(path); this.render(); } }
  back(redo = false) {
    const from = redo ? this.redo : this.undo;
    if (!from.length) return;
    (redo ? this.undo : this.redo).push(stringifyDesk(this.d));
    this.d = parseDesk(from.pop());
    this.render();
    this.opts.onChange(stringifyDesk(this.d));
  }

  addFile(path, x, y) {
    const image = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(path);
    const n = { id: newId(), type: 'file', file: path, x: Math.round(x), y: Math.round(y), width: 400, height: image ? 300 : 400 };
    this.sel = new Set([n.id]);
    this.change({ ...this.d, nodes: [...this.d.nodes, n] });
    this.el.focus();
  }
  addText(x, y, edit = true) {
    const n = { id: newId(), type: 'text', text: '', x: Math.round(x), y: Math.round(y), width: 260, height: 140 };
    this.sel = new Set([n.id]);
    this.change({ ...this.d, nodes: [...this.d.nodes, n] });
    if (edit) this.edit(n.id);
  }
  edit(id) {
    const n = this.d.nodes.find((x) => x.id === id);
    const e = this.els.get(id);
    if (!n || n.type !== 'text' || !e) return;
    e.editing = true;
    e.classList.add('editing');
    const ta = el('textarea', 'desk-edit');
    ta.value = n.text || '';
    e.body.replaceChildren(ta);
    ta.focus();
    const done = () => {
      if (!e.editing) return;
      e.editing = false;
      e.classList.remove('editing');
      e.src = null;
      const text = ta.value;
      const cur = this.d.nodes.find((x) => x.id === id);
      if (cur && text !== (cur.text || '')) this.change({ ...this.d, nodes: this.d.nodes.map((x) => (x.id === id ? { ...x, text } : x)) });
      else this.render();
      this.el.focus();
    };
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); done(); }
    });
    ta.addEventListener('blur', done);
    ta.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  }

  // ---- the pointer
  hit(e) {
    const c = e.target.closest?.('.desk-card');
    return c ? c.dataset.id : null;
  }
  // What the last two presses were on: a double-click counts only when both
  // were on the same thing (the plane, or one card) — not a click on a
  // margin card's × and then one where it was.
  pressed(on) { this.presses = [this.presses?.[1], on]; }
  down(e) {
    if (e.button === 2) return;
    this.el.focus({ preventScroll: true });
    const id = this.hit(e);
    this.pressed(id ? (e.target.closest('button') ? 'button' : id) : 'plane');
    const ai = id && this.ai.find((a) => a.id === id);
    if (ai) return; // its own buttons
    const sx = e.clientX;
    const sy = e.clientY;
    if (!id || e.button === 1 || this.space) {
      if (e.button === 1 || this.space || e.altKey) return this.drag(e, (ev) => { this.cam = { ...this.cam, x: this.cam.x + ev.movementX, y: this.cam.y + ev.movementY }; this.camera(); });
      // A box drawn on the plane: what is in it is selected.
      const add = e.shiftKey ? new Set(this.sel) : new Set();
      const r = this.el.getBoundingClientRect();
      this.marquee.hidden = false;
      return this.drag(e, (ev) => {
        const [x1, x2] = [Math.min(sx, ev.clientX), Math.max(sx, ev.clientX)];
        const [y1, y2] = [Math.min(sy, ev.clientY), Math.max(sy, ev.clientY)];
        Object.assign(this.marquee.style, { left: `${x1 - r.left}px`, top: `${y1 - r.top}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
        const a = this.toWorld(x1, y1);
        const b = this.toWorld(x2, y2);
        this.sel = new Set(add);
        for (const n of this.d.nodes) if (n.type !== 'group' && n.x < b.x && n.x + n.width > a.x && n.y < b.y && n.y + n.height > a.y) this.sel.add(n.id);
        this.paintSel();
      }, () => { this.marquee.hidden = true; this.dockShow(); });
    }
    const n = this.d.nodes.find((x) => x.id === id);
    if (!n) return;
    if (e.target.classList.contains('desk-grip')) return this.resize(e, n);
    if (e.shiftKey || e.metaKey) { if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); this.paintSel(); this.dockShow(); return; }
    if (!this.sel.has(id)) { this.sel = new Set([id]); this.paintSel(); this.dockShow(); }
    // Moving: the selection, and what lies in a group that moves.
    const moving = new Map();
    for (const s of this.d.nodes.filter((x) => this.sel.has(x.id))) {
      moving.set(s.id, { x: s.x, y: s.y });
      if (s.type === 'group') for (const c of childrenOf(this.d, s)) moving.set(c.id, { x: c.x, y: c.y });
    }
    const z = this.cam.z;
    let moved = false;
    let target = null;
    let overDock = false;
    let overAct = null; // an action of the margin's, the cards dropped on it
    const ids = [...moving.keys()];
    const nodes = new Map(this.d.nodes.map((x) => [x.id, x]));
    this.drag(e, (ev) => {
      const dx = (ev.clientX - sx) / z;
      const dy = (ev.clientY - sy) / z;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      for (const [mid, p] of moving) {
        const m = nodes.get(mid);
        m.x = Math.round(p.x + dx);
        m.y = Math.round(p.y + dy);
        const me = this.els.get(mid);
        me.style.left = `${m.x}px`;
        me.style.top = `${m.y}px`;
        me.classList.add('lifted');
      }
      this.drawEdges();
      // What it would go onto: a card (a group), or the margin.
      const under = document.elementsFromPoint(ev.clientX, ev.clientY);
      overDock = under.includes(this.dock);
      const act = overDock ? under.find((u) => u.dataset?.task) : null;
      if (overAct !== act) { overAct?.classList.remove('hot'); act?.classList.add('hot'); overAct = act; }
      const card = !overDock && under.map((u) => u.closest?.('.desk-card')).find((c) => c && !moving.has(c.dataset.id) && c.kind !== 'group' && !c.classList.contains('t-ai'));
      if (target && target !== card) target.classList.remove('drop-on');
      target = card || null;
      target?.classList.add('drop-on');
      this.dock.classList.toggle('hot', overDock);
    }, () => {
      for (const mid of ids) this.els.get(mid)?.classList.remove('lifted');
      target?.classList.remove('drop-on');
      this.dock.classList.remove('hot');
      if (!moved) return;
      const now = { ...this.d, nodes: this.d.nodes.map((x) => ({ ...x })) };
      // Back to where they were, so the change (and undo) is one step.
      for (const [mid, p] of moving) Object.assign(nodes.get(mid), p);
      if (overDock) {
        // Given to the margin: back where they were, and selected; on an
        // action, that action.
        overAct?.classList.remove('hot');
        this.render();
        this.dock.classList.add('flash');
        setTimeout(() => this.dock.classList.remove('flash'), 600);
        this.dockShow();
        if (overAct) this.act(overAct.dataset.task);
        return;
      }
      if (target) this.change(stackOnto(now, [...this.sel], target.dataset.id));
      else this.change(now);
    });
  }
  resize(e, n) {
    const sx = e.clientX;
    const sy = e.clientY;
    const { width, height } = n;
    const z = this.cam.z;
    const card = this.els.get(n.id);
    let w = width;
    let h = height;
    this.drag(e, (ev) => {
      w = Math.max(120, Math.round(width + (ev.clientX - sx) / z));
      h = Math.max(50, Math.round(height + (ev.clientY - sy) / z));
      card.style.width = `${w}px`;
      card.style.height = `${h}px`;
    }, () => { if (w !== width || h !== height) this.change({ ...this.d, nodes: this.d.nodes.map((x) => (x.id === n.id ? { ...x, width: w, height: h } : x)) }); });
  }
  drag(e, move, up) {
    e.preventDefault();
    const target = this.el;
    try { target.setPointerCapture(e.pointerId); } catch { /* not a real pointer (a test) */ }
    const mv = (ev) => move(ev);
    const end = () => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); up?.(); };
    target.addEventListener('pointermove', mv);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
  paintSel() { for (const [id, e] of this.els) e.classList.toggle('sel', this.sel.has(id)); }
  dbl(e) {
    if (e.target.closest?.('.desk-dock')) return;
    const id = this.hit(e);
    const [a, b] = this.presses || [];
    if (a !== b || b !== (id || 'plane')) return;
    const n = id && this.d.nodes.find((x) => x.id === id);
    if (!id) { const w = this.toWorld(e.clientX, e.clientY); this.addText(w.x - 130, w.y - 30); return; }
    if (n?.type === 'text') this.edit(id);
    else if (n?.type === 'file') this.opts.openNote(n.file);
    else if (n?.type === 'group') this.rename(n);
  }
  rename(g) {
    const e = this.els.get(g.id);
    const input = el('input', 'desk-label-edit');
    input.value = g.label || '';
    e.head.replaceChildren(input);
    input.focus();
    input.select();
    const done = (save) => {
      if (!input.isConnected) return;
      input.remove();
      if (save && input.value.trim() !== (g.label || '')) this.change({ ...this.d, nodes: this.d.nodes.map((x) => (x.id === g.id ? { ...x, label: input.value.trim() } : x)) });
      else this.render();
      this.el.focus();
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  }

  // ---- the keys
  key(e) {
    if (e.target !== this.el) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const one = this.sel.size === 1 ? this.d.nodes.find((n) => this.sel.has(n.id)) : null;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ') { this.space = true; handled(); return; }
    if (mod && k.toLowerCase() === 'z') { handled(); this.back(e.shiftKey); return; }
    if (mod && k.toLowerCase() === 'a') { handled(); this.sel = new Set(this.d.nodes.filter((n) => n.type !== 'group').map((n) => n.id)); this.paintSel(); this.dockShow(); return; }
    if (mod || e.altKey) return;
    if (k === 'Tab') { handled(); if (this.proposal) this.take(); else this.keep(this.ai.at(-1)); return; }
    if (k === 'Escape') {
      handled();
      if (this.proposal) { this.proposal = null; this.render(); } else if (this.ai.length) this.drop(this.ai.at(-1)); else { this.sel.clear(); this.paintSel(); this.dockShow(); }
      return;
    }
    if (k === 'Backspace' || k === 'Delete') { if (this.sel.size) { handled(); const ids = [...this.sel]; this.sel.clear(); this.change(removeCards(this.d, ids)); } return; }
    if (k.startsWith('Arrow')) {
      handled();
      const dir = k.slice(5).toLowerCase();
      if (e.shiftKey && this.sel.size) {
        const [dx, dy] = { left: [-20, 0], right: [20, 0], up: [0, -20], down: [0, 20] }[dir];
        this.change({ ...this.d, nodes: this.d.nodes.map((n) => (this.sel.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) });
        return;
      }
      const cards = this.d.nodes.filter((n) => n.type !== 'group');
      const next = one ? nearest(cards, one, dir) : cards[0];
      if (next) { this.sel = new Set([next.id]); this.paintSel(); this.dockShow(); this.show(next); }
      return;
    }
    if (k === 'Enter' && one) { handled(); if (one.type === 'text') this.edit(one.id); else if (one.type === 'file') this.opts.openNote(one.file); else if (one.type === 'group') this.rename(one); return; }
    const center = () => { const r = this.el.getBoundingClientRect(); return this.toWorld(r.left + (r.width - this.side()) / 2, r.top + r.height / 2); };
    if (k === 'n') { handled(); const c = center(); this.addText(c.x - 130, c.y - 70); return; }
    if (k === 'f') { handled(); this.opts.pickNote().then((p) => { if (p) { const c = center(); this.addFile(p, c.x - 200, c.y - 200); } }); return; }
    if (k === 'g' && this.sel.size) { handled(); this.change(groupAround(this.d, [...this.sel])); return; }
    if (k === 'z') { handled(); this.fit(); return; }
    if (k === '=' || k === '+' || k === '-') { handled(); const r = this.el.getBoundingClientRect(); this.zoomAt((r.width - this.side()) / 2, r.height / 2, k === '-' ? 1 / 1.2 : 1.2, true); return; }
    if (k === '1') { handled(); const r = this.el.getBoundingClientRect(); const c = center(); this.goTo({ z: 1, x: (r.width - this.side()) / 2 - c.x, y: r.height / 2 - c.y }); return; }
    if (k === '/') { handled(); this.input.focus(); return; }
    const act = ACTIONS.find((a) => a[2] === k);
    if (act) { handled(); this.act(act[0]); }
  }

  // ---- the margin
  // The cards it is given: the selection (a group: what is in it), or,
  // with none, every card in view.
  context() {
    let ns = this.d.nodes.filter((n) => this.sel.has(n.id));
    ns = ns.flatMap((n) => (n.type === 'group' ? childrenOf(this.d, n).filter((c) => c.type !== 'group') : [n]));
    if (!ns.length) {
      const r = this.el.getBoundingClientRect();
      const a = this.toWorld(r.left, r.top);
      const b = this.toWorld(r.right - this.side(), r.bottom);
      ns = this.d.nodes.filter((n) => n.type !== 'group' && n.x < b.x && n.x + n.width > a.x && n.y < b.y && n.y + n.height > a.y);
    }
    const seen = new Set();
    return ns.filter((n) => (n.type === 'text' || n.type === 'file') && !seen.has(n.id) && seen.add(n.id)).slice(0, 40);
  }
  dockShow() {
    const ns = this.context();
    const chosen = this.sel.size > 0;
    this.ctx.textContent = ns.length ? `${ns.length} card${ns.length === 1 ? '' : 's'} ${chosen ? 'selected' : 'in view'}` : 'No cards: double-click to write one, or drag notes here from the tree';
    if (this.withheld?.length) this.ctx.append(el('div', 'desk-withheld', `withheld (private): ${this.withheld.join(', ')}`));
    for (const b of this.actions.children) b.disabled = !ns.length || !!this.busy;
  }
  cardsFor(ns) { return ns.map((n) => (n.type === 'file' ? { key: n.id, file: n.file } : { key: n.id, text: n.text || '' })); }
  // Where its cards go: to the right of the cards it was given, clear of
  // the cards there.
  spot(ns, width = 380, height = 240) {
    const b = boundsOf(ns) || { x: 0, y: 0, width: 0, height: 0 };
    const others = [...this.d.nodes.filter((n) => n.type !== 'group'), ...this.ai];
    const at = { x: b.x + b.width + 80, y: b.y };
    for (let i = 0; i < 50; i++) {
      const hit = others.find((n) => n.x < at.x + width + 20 && n.x + n.width + 20 > at.x && n.y < at.y + height && n.y + (this.els.get(n.id)?.offsetHeight || n.height) > at.y);
      if (!hit) break;
      at.x = hit.x + hit.width + 40;
    }
    return at;
  }
  async act(task) {
    if (this.busy) return;
    const ns = this.context();
    if (!ns.length) { this.opts.toast('No cards to give the margin: select some, or bring them into view.'); return; }
    if (task === 'group' && ns.length < 3) { this.opts.toast('Sorting needs three cards or more.'); return; }
    if (task === 'links' && ns.length < 2) { this.opts.toast('Links need two cards or more.'); return; }
    const wide = task === 'merge';
    const at = this.spot(ns, wide ? 520 : 380, wide ? 520 : task === 'questions' ? 560 : 240);
    const label = ACTIONS.find((a) => a[0] === task)[1];
    const card = (task === 'summary' || task === 'merge') ? this.addAi({ kind: task, x: at.x, y: at.y, width: wide ? 520 : 380, height: wide ? 520 : 200, text: '', title: label }) : null;
    this.busy = label;
    this.dockShow();
    this.status.textContent = `${label}…`;
    this.el.classList.add('thinking');
    for (const n of ns) this.els.get(n.id)?.classList.add('given');
    const t0 = performance.now();
    try {
      const r = await this.opts.ask({ task, cards: this.cardsFor(ns) }, (said) => { if (card) { card.text = said; card.state = 'stream'; this.els.get(card.id)?.show(card); } });
      this.withheld = r.withheld;
      this.nums = r.nums;
      this.render();
      if (!r.end?.ok) throw new Error(r.end?.error || 'No answer');
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      this.status.textContent = `${label} · ${secs}s`;
      if (card) { card.text = r.said.trim(); card.state = 'done'; this.els.get(card.id)?.show(card); this.show(card); }
      if (task === 'questions') {
        const qs = parseQuestions(r.said);
        if (!qs.length) throw new Error('No questions came back');
        // One under another, as tall as they came out.
        let y = at.y;
        const cards = qs.map((q) => {
          const c = this.addAi({ kind: 'question', x: at.x, y, width: 340, height: 60, text: `? ${q}`, state: 'done' }, false);
          y += (this.els.get(c.id)?.offsetHeight || 100) + 16;
          return c;
        });
        this.show(cards[0], true);
      }
      // The numbers it answers with are the cards the server sent (private ones left out).
      const sent = r.keys ? r.keys.map((k) => ns.find((n) => n.id === k)).filter(Boolean) : ns;
      if (task === 'group') this.propose(sent, { kind: 'group', groups: parseGroups(r.said, sent.length) });
      if (task === 'links') this.propose(sent, { kind: 'links', links: parseLinks(r.said, sent.length) });
    } catch (err) {
      if (card) { card.state = 'error'; card.text = err.message; this.els.get(card.id)?.show(card); }
      this.status.textContent = '';
      this.opts.toast(err.message, 'error');
    } finally {
      this.busy = null;
      this.el.classList.remove('thinking');
      for (const n of ns) this.els.get(n.id)?.classList.remove('given');
      this.dockShow();
    }
  }
  propose(ns, p) {
    if (p.kind === 'group') {
      if (!p.groups.length) throw new Error('The margin sent no groups back');
      const b = boundsOf(ns);
      const layout = groupLayout(p.groups.map((g) => ({ name: g.name, cards: g.cards.map((i) => ns[i]) })), b.x, b.y + b.height + 120);
      this.proposal = { kind: 'group', layout };
      this.say(`Sort into ${layout.length}: ${layout.map((g) => g.name).join(' · ')} — Tab takes it (cards move under their groups), Esc not.`);
      this.render();
      this.fit(true, [...ns, ...layout.map((g) => g.box)]);
    } else {
      if (!p.links.length) throw new Error('The margin found no cards that belong together');
      this.proposal = { kind: 'links', links: p.links.map((l) => ({ from: ns[l.a].id, to: ns[l.b].id, label: l.label })) };
      this.say(`${p.links.length} link${p.links.length === 1 ? '' : 's'}: ${p.links.map((l) => `${cardTitle(ns[l.a]).slice(0, 18)} ↔ ${cardTitle(ns[l.b]).slice(0, 18)}${l.label ? ` (${l.label})` : ''}`).join('; ')} — Tab takes them, Esc not.`);
      this.render();
    }
  }
  // Taking what the margin proposed: the groups made, the links drawn.
  take() {
    const p = this.proposal;
    this.proposal = null;
    if (p.kind === 'group') {
      const pos = new Map(p.layout.flatMap((g) => g.at.map((a) => [a.id, a])));
      const groups = p.layout.map((g) => ({ id: newId(), type: 'group', label: g.name, ...g.box }));
      this.change({ ...this.d, nodes: [...groups, ...this.d.nodes.map((n) => (pos.has(n.id) ? { ...n, x: pos.get(n.id).x, y: pos.get(n.id).y } : n))] });
      this.fit(true, groups);
    } else {
      this.change({ ...this.d, edges: [...this.d.edges, ...p.links.map((l) => ({ id: newId(), fromNode: l.from, toNode: l.to, toEnd: 'none', ...(l.label ? { label: l.label } : {}) }))] });
    }
  }
  addAi(a, show = true) {
    const card = { id: newId(), state: 'wait', ...a };
    this.ai.push(card);
    this.render();
    if (show) this.show(card, true);
    return card;
  }
  aiCard(a) {
    const head = el('div', 'desk-head');
    const body = el('div', 'desk-body md');
    const keep = button('Keep', 'Keep it as a card of the desk (Tab)', () => this.keep(a));
    const note = button('Make a note…', 'A new note of it, on the desk in its place', () => this.makeNote(a));
    const drop = button('×', 'Let it go (Esc)', () => this.drop(a), 'ghost');
    const foot = el('div', 'desk-ai-foot', keep, note, drop);
    const e = el('div', 'desk-card t-ai', head, body, foot);
    e.dataset.id = a.id;
    e.show = (x) => {
      e.className = `desk-card t-ai k-${x.kind} s-${x.state}`;
      Object.assign(e.style, { left: `${x.x}px`, top: `${x.y}px`, width: `${x.width}px`, minHeight: `${x.height}px` });
      head.textContent = x.kind === 'question' ? 'Question' : x.title || 'Margin';
      if (x.state === 'error') body.textContent = x.text;
      else if (e.src !== x.text) { body.innerHTML = this.opts.render(x.text || ''); e.src = x.text; }
      note.hidden = x.kind !== 'merge' || x.state !== 'done';
      keep.disabled = x.state !== 'done';
    };
    return e;
  }
  keep(a) {
    if (!a || a.state !== 'done') return;
    this.ai = this.ai.filter((x) => x !== a);
    const h = Math.round((this.els.get(a.id)?.offsetHeight || a.height));
    const n = { id: newId(), type: 'text', text: a.text, x: a.x, y: a.y, width: a.width, height: Math.max(60, h) };
    this.sel = new Set([n.id]);
    this.change({ ...this.d, nodes: [...this.d.nodes, n] });
  }
  drop(a) { if (!a) return; this.ai = this.ai.filter((x) => x !== a); this.render(); }
  async makeNote(a) {
    const path = await this.opts.makeNote(a.text);
    if (!path) return;
    this.ai = this.ai.filter((x) => x !== a);
    const n = { id: newId(), type: 'file', file: path, x: a.x, y: a.y, width: a.width, height: 520 };
    this.sel = new Set([n.id]);
    this.change({ ...this.d, nodes: [...this.d.nodes, n] });
  }
  say(text, cls = 'note') {
    const row = el('div', `desk-say ${cls}`, text);
    this.log.append(row);
    this.log.scrollTop = this.log.scrollHeight;
    return row;
  }
  // A talk about the cards: it remembers what was said (and the cards it
  // was shown) until the desk is closed.
  async chat(q) {
    if (this.busy) return;
    const ns = this.context();
    this.say(q, 'me');
    const row = this.say('…', 'margin');
    this.busy = 'Talk';
    this.dockShow();
    this.el.classList.add('thinking');
    try {
      const r = await this.opts.ask({ task: 'chat', cards: this.cardsFor(ns), question: q, talk: this.talkKey }, (said) => { row.innerHTML = this.opts.render(said); this.log.scrollTop = this.log.scrollHeight; });
      this.withheld = r.withheld;
      this.nums = r.nums;
      this.render();
      if (!r.end?.ok) throw new Error(r.end?.error || 'No answer');
      row.innerHTML = this.opts.render(r.said.trim());
      const put = button('On the desk', 'Put this answer on the desk, beside the cards (then Tab keeps it)', () => { const at = this.spot(ns); this.addAi({ kind: 'answer', title: q.slice(0, 60), x: at.x, y: at.y, width: 380, height: 160, text: r.said.trim(), state: 'done' }); put.remove(); });
      row.append(put);
    } catch (err) {
      row.textContent = err.message;
      row.classList.add('error');
    } finally {
      this.busy = null;
      this.el.classList.remove('thinking');
      this.dockShow();
    }
  }
}
