// Meetings in space (experimental): the depth stage, the agenda tunnel and
// the decision orbit. CSS 3D and the DOM only — no WebGL, nothing loaded.
//
// Words are read flat. The editor never moves; the tunnel plays between two
// agenda items, over the editor, and is gone; a card in the orbit is a flat
// card put where the camera sees its place (moved and scaled, never turned),
// so its text stays sharp. With reduced motion, none of it: the rail and the
// wall are as they are.

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ------------------------------------------------------- the depth stage

// The agenda as an arc on the floor: 180° from the left over the top to the
// right, each item's share its minutes. → [{ d, len, mid }] (SVG paths).
export function gaugeArcs(agenda, { cx = 260, cy = 250, r = 210, gap = 2.5 } = {}) {
  const total = agenda.reduce((s, a) => s + a.budget, 0) || 1;
  let at = 180;
  return agenda.map((a) => {
    const span = (180 * a.budget) / total;
    const a0 = at + gap / 2;
    const a1 = Math.max(a0 + 0.5, at + span - gap / 2);
    at += span;
    const p = (d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return { d: `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`, len: r * rad(a1 - a0), mid: (a0 + a1) / 2 };
  });
}

// The gauge under the editor: the arc tilted onto the floor, and the item
// now with its clock, upright (to be read). → the element, with draw(agenda)
// and tick(cur, times).
export function stageGauge() {
  const plane = svg('svg', { viewBox: '0 -12 520 270', class: 'm-gauge-arc' });
  const title = el('div', 'm-gauge-title');
  const time = el('div', 'm-gauge-time');
  const read = el('div', 'm-gauge-read', title, time);
  const root = el('div', 'm-gauge', el('div', 'm-gauge-floor'), el('div', 'm-gauge-tilt', plane), read);
  let segs = [];
  let items = [];
  root.draw = (agenda) => {
    items = agenda;
    plane.replaceChildren();
    segs = gaugeArcs(agenda).map((a, k) => {
      const track = svg('path', { d: a.d, class: 'g-track' });
      const fill = svg('path', { d: a.d, class: 'g-fill', 'stroke-dasharray': `0 ${a.len + 1}` });
      const r = 238;
      const lx = 260 + r * Math.cos(rad(a.mid));
      const ly = 250 + r * Math.sin(rad(a.mid));
      const label = svg('text', { x: lx.toFixed(1), y: ly.toFixed(1), class: 'g-label', 'text-anchor': a.mid < 250 ? 'end' : a.mid > 290 ? 'start' : 'middle' });
      label.textContent = agenda[k].title;
      const g = svg('g', { class: 'g-seg' });
      g.append(track, fill, label);
      plane.append(g);
      return { g, fill, len: a.len };
    });
    root.classList.toggle('none', !agenda.length);
  };
  root.tick = (cur, times) => {
    segs.forEach((s, k) => {
      const ms = times[k] || 0;
      const of = items[k].budget * 60000;
      const over = ms > of;
      s.fill.setAttribute('stroke-dasharray', `${(Math.min(1, ms / of) * s.len).toFixed(1)} ${(s.len + 1).toFixed(1)}`);
      s.g.setAttribute('class', `g-seg${k === cur ? ' cur' : ''}${over ? ' over' : ''}${k < cur || (ms > 0 && k !== cur) ? ' done' : ''}`);
    });
    const a = items[cur];
    title.textContent = a ? a.title : items.length ? 'Between items' : '';
    time.textContent = a ? `${mmss(times[cur] || 0)} / ${a.budget}:00` : '';
    read.classList.toggle('over', !!a && (times[cur] || 0) > a.budget * 60000);
  };
  return root;
}

// The stage leans a little with the pointer (the editor doesn't).
export function parallax(stage) {
  let raf = 0;
  stage.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = stage.getBoundingClientRect();
      stage.style.setProperty('--px', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
      stage.style.setProperty('--py', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
    });
  });
}

// ------------------------------------------------------- the agenda tunnel

// From one agenda item to the next: the camera goes down a corridor of
// gates, one an item, what each decided and handed out on its walls. Over
// the editor's place, about a second and a half, then gone. → a Promise.
// opts: { agenda, from, to, times, items }.
export function agendaTunnel(rect, opts) {
  if (reduced() || !opts.agenda.length) return Promise.resolve();
  const GAP = 900;
  const W = rect.width;
  const H = rect.height;
  const n = opts.agenda.length;
  const world = el('div', 'm-tunnel-world');
  const L = (n + 1) * GAP + 800;
  const floor = el('div', 'm-tunnel-plane m-tunnel-floor');
  Object.assign(floor.style, { width: `${W * 1.3}px`, height: `${L}px`, left: `${-W * 0.15}px`, top: `${H * 0.8}px` });
  const wallL = el('div', 'm-tunnel-plane m-tunnel-wall left');
  const wallR = el('div', 'm-tunnel-plane m-tunnel-wall right');
  for (const w of [wallL, wallR]) Object.assign(w.style, { width: `${L}px`, height: `${H * 1.2}px`, top: `${-H * 0.1}px` });
  wallL.style.left = `${W * 0.03}px`;
  wallR.style.left = `${W * 0.97 - L}px`;
  world.append(floor, wallL, wallR);
  const gw = Math.min(W * 0.66, 900);
  const gh = Math.min(H * 0.5, 420);
  const gates = opts.agenda.map((a, k) => {
    const ms = opts.times[k] || 0;
    const g = el('div', `m-gate${k === opts.to ? ' next' : ''}${k !== opts.to && k !== opts.from ? ' quiet' : ''}${k < opts.to ? ' done' : ''}${ms > a.budget * 60000 ? ' over' : ''}`,
      el('div', 'm-gate-n', `${k + 1} / ${n}`),
      el('div', 'm-gate-title', a.title),
      el('div', 'm-gate-time', ms ? `${mmss(ms)} of ${a.budget}:00` : `${a.budget}:00`));
    Object.assign(g.style, { width: `${gw}px`, height: `${gh}px`, left: `${(W - gw) / 2}px`, top: `${(H - gh) / 2 - H * 0.04}px`, transform: `translateZ(${-k * GAP}px)` });
    world.append(g);
    // What this item came to, on the walls on the way to the next.
    const mine = opts.items.filter((it) => it.section === a.title).slice(0, 8);
    mine.forEach((it, j) => {
      const side = j % 2 ? 1 : -1;
      const z = -(k * GAP + 180 + (j >> 1) * 150);
      const c = el('div', `m-tunnel-chip m-${it.kind}`, it.body);
      Object.assign(c.style, { left: `${W / 2 + side * W * 0.36 - 120}px`, top: `${H * 0.34 + (j % 4) * 46}px`, transform: `translateZ(${z}px) rotateY(${-side * 58}deg)` });
      world.append(c);
    });
    return g;
  });
  const root = el('div', 'm-tunnel', world);
  Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${W}px`, height: `${H}px` });
  document.body.append(root);
  const at = (k) => k * GAP - 300;
  const from = at(Math.max(0, opts.from));
  const to = at(opts.to);
  const place = (t) => {
    world.style.transform = `translateZ(${t.toFixed(1)}px)`;
    gates.forEach((g, k) => {
      const z = -k * GAP + t;
      const near = z > -300 ? clamp(1 - (z + 300) / 420, 0, 1) : 1;
      const far = clamp(1 + (z + 2.4 * GAP) / GAP, 0.15, 1);
      g.style.opacity = (near * far).toFixed(3);
    });
  };
  place(from);
  return new Promise((resolve) => {
    requestAnimationFrame(() => root.classList.add('on'));
    const start = performance.now() + 220;
    const dur = 1050;
    const step = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      place(from + (to - from) * ease(t));
      if (t < 1) { requestAnimationFrame(step); return; }
      setTimeout(() => {
        root.classList.remove('on');
        setTimeout(() => { root.remove(); resolve(); }, 280);
      }, 260);
    };
    requestAnimationFrame(step);
  });
}

// ------------------------------------------------------- the decision orbit

// Where the camera is: turned (yaw) round the middle, tilted (pitch) over
// the floor, so far back (dist); persp: the CSS perspective; lift: the floor
// lower on the screen.
export const ORBIT_CAMERA = { yaw: 0, pitch: 58, dist: 480, persp: 1200, lift: 30 };

// A point of the orbit's world (x, y on the floor, z up) on the screen, as
// CSS draws the floor with orbitTransform(cam). → { x, y, s, depth }.
export function project(cam, w, h, [x, y, z]) {
  const cy = Math.cos(rad(cam.yaw));
  const sy = Math.sin(rad(cam.yaw));
  const X = x * cy - y * sy;
  const Y = x * sy + y * cy;
  const cp = Math.cos(rad(cam.pitch));
  const sp = Math.sin(rad(cam.pitch));
  const Y2 = Y * cp - z * sp;
  const Z = Y * sp + z * cp - cam.dist;
  const s = cam.persp / Math.max(1, cam.persp - Z);
  return { x: w / 2 + X * s, y: h / 2 + (Y2 + cam.lift) * s, s, depth: Z };
}
export const orbitTransform = (cam) => `translateY(${cam.lift}px) translateZ(${-cam.dist}px) rotateX(${cam.pitch}deg) rotateZ(${cam.yaw}deg)`;

export const ORBIT = { floor: 600, hub: 150, pillars: 330, ring: 480, step: 104 };
export const ORBIT_MAX = { decision: 14, question: 18, todo: 8, pillars: 8 };

// Where each thing is: agenda items are sectors of the floor (the first in
// front); decisions float high round the middle, in their item's sector;
// open questions go round the outer ring; each owner is a pillar, their
// to-dos up it. columns: as wallOf(). → { sectors, nodes, pillars, more }.
export function orbitLayout(columns, agenda) {
  const titles = agenda.length ? agenda.map((a) => a.title) : [''];
  const n = titles.length;
  const step = 360 / n;
  const mid = (k) => 90 + step * k;
  const sectors = titles.map((t, k) => ({ title: t, angle: mid(k), from: mid(k) - step / 2, to: mid(k) + step / 2 }));
  const sectorOf = (it, j) => { const k = titles.indexOf(it.section); return k >= 0 ? k : j % n; };
  const nodes = [];
  const more = [];
  const spread = (list, k, j) => {
    const mine = list.filter((x, i) => sectorOf(x, i) === k);
    const i = mine.indexOf(list[j]);
    return mine.length > 1 ? (i / (mine.length - 1) - 0.5) * step * 0.62 : 0;
  };
  const col = (id) => columns.find((c) => c.id === id) || { items: [] };
  const decided = col('decided').items.slice(0, ORBIT_MAX.decision);
  decided.forEach((it, j) => {
    const k = sectorOf(it, j);
    const a = mid(k) + spread(decided, k, j);
    const r = ORBIT.hub + (j % 2) * 60;
    nodes.push({ key: it.key, item: it, kind: 'decision', a, r, z: 250 + (j % 3) * 46 });
  });
  if (col('decided').items.length > ORBIT_MAX.decision) more.push({ kind: 'decision', n: col('decided').items.length - ORBIT_MAX.decision });
  const open = col('open').items.slice(0, ORBIT_MAX.question);
  open.forEach((it, j) => {
    const k = sectorOf(it, j);
    nodes.push({ key: it.key, item: it, kind: 'question', a: mid(k) + spread(open, k, j), r: ORBIT.ring, z: 64 + (j % 2) * 54, orbit: true });
  });
  if (col('open').items.length > ORBIT_MAX.question) more.push({ kind: 'question', n: col('open').items.length - ORBIT_MAX.question });
  const owners = columns.filter((c) => c.kind === 'todo' && (c.owner || c.items.length)).slice(0, ORBIT_MAX.pillars);
  const P = owners.length;
  const pillars = owners.map((c, p) => {
    const a = mid(0) + 180 / Math.max(1, P) + (360 * p) / Math.max(1, P);
    const shown = c.items.slice(0, ORBIT_MAX.todo);
    shown.forEach((it, j) => nodes.push({ key: it.key, item: it, kind: 'todo', a, r: ORBIT.pillars, z: 64 + j * ORBIT.step, owner: c.owner ?? null }));
    const top = 64 + Math.max(1, shown.length) * ORBIT.step;
    return { id: c.id, owner: c.owner ?? null, title: c.title, a, r: ORBIT.pillars, top, n: c.items.length, more: c.items.length - shown.length };
  });
  return { sectors, nodes, pillars, more };
}
export const polar = (a, r) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))];

// The orbit view. opts: { move(item, to), lineOf(item) → the line as
// written, accepts(item, target) }. → the element, with update(columns,
// agenda), png(title, summary) → Blob promise, key(e) → handled, fly(k),
// destroy().
export function orbitScene(opts) {
  const cam = { ...ORBIT_CAMERA, yaw: -70, pitch: 74, dist: 1500 };
  let goal = null;
  let spin = 0;
  let phase = 0;
  let layout = { sectors: [], nodes: [], pillars: [], more: [] };
  let cards = new Map();
  let heads = [];
  let hover = null;
  let hot = null;
  let born = performance.now();
  let alive = true;
  let size = { w: 1, h: 1 };
  const floor = el('div', 'orb-floor');
  const lines = svg('svg', { class: 'orb-lines' });
  const layer = el('div', 'orb-layer');
  const plate = el('div', 'orb-plate');
  const hub = el('div', 'orb-zone orb-hub', el('span', 'orb-zone-dot'), 'Decided');
  const ring = el('div', 'orb-zone orb-ring', el('span', 'orb-zone-dot'), 'Open questions');
  const help = el('div', 'orb-help', 'drag the floor: turn · pinch or + −: nearer · 1 2 3: an agenda item · 0: all · throw a card to a pillar, the middle or the ring');
  const root = el('div', 'orb', floor, lines, layer, plate, help);
  layer.append(hub, ring);
  root.tabIndex = -1;

  const F = ORBIT.floor;
  Object.assign(floor.style, { width: `${2 * F}px`, height: `${2 * F}px`, marginLeft: `${-F}px`, marginTop: `${-F}px` });

  function update(columns, agenda) {
    layout = orbitLayout(columns, agenda);
    const step = 360 / Math.max(1, layout.sectors.length);
    floor.style.setProperty('--from', `${(layout.sectors[0]?.from ?? 0) + 90}deg`);
    floor.style.setProperty('--step', `${step}deg`);
    floor.replaceChildren(...layout.sectors.map((s, k) => {
      const [x, y] = polar(s.angle, F * 0.92);
      const l = el('div', 'orb-sector', el('span', 'orb-sector-n', String(k + 1)), s.title || 'The meeting');
      l.style.transform = `translate(${(x + F).toFixed(1)}px, ${(y + F).toFixed(1)}px) translate(-50%, -50%) rotate(${s.angle - 90}deg)`;
      return l;
    }), el('div', 'orb-floor-hub'), el('div', 'orb-floor-ring'));
    const next = new Map();
    for (const nd of layout.nodes) {
      let c = cards.get(nd.key);
      if (!c) {
        c = el('div', `orb-card m-${nd.kind}`);
        c.dataset.key = nd.key;
        c.addEventListener('pointerdown', (e) => pick(e, c));
        c.addEventListener('pointerenter', () => { hover = c; });
        c.addEventListener('pointerleave', () => { if (hover === c) hover = null; });
        if (cards.size) c.classList.add('orb-arrived');
        layer.append(c);
      }
      const it = nd.item;
      c.className = `orb-card m-${nd.kind}${it.done ? ' done' : ''}${c.classList.contains('orb-arrived') ? ' orb-arrived' : ''}`;
      c.replaceChildren(...[
        el('div', 'orb-card-kind', it.done ? 'Done' : { decision: 'Decided', question: 'Open', todo: 'To-do' }[nd.kind], it.section ? el('span', 'orb-card-sec', it.section) : null),
        el('div', 'orb-card-text', it.body),
        it.due ? el('div', 'orb-card-due', `\u{1F4C5} ${it.due.slice(5)}`) : null].filter(Boolean));
      if (nd.owner) c.style.setProperty('--own', opts.colorOf(nd.owner)); else c.style.removeProperty('--own');
      c.node = nd;
      c.wh = null;
      next.set(nd.key, c);
    }
    for (const [k, c] of cards) if (!next.has(k)) c.remove();
    cards = next;
    for (const h of heads) { h.remove(); h.line.remove(); h.foot.remove(); }
    heads = layout.pillars.map((p) => {
      const h = el('div', 'orb-head', p.owner ? el('span', 'orb-avatar', p.owner[0].toUpperCase()) : el('span', 'orb-avatar none', '∅'), el('span', 'orb-head-name', p.title), p.more > 0 ? el('span', 'orb-more', `+${p.more}`) : null);
      if (p.owner) h.style.setProperty('--own', opts.colorOf(p.owner));
      h.pillar = p;
      h.line = svg('path', { class: 'orb-pillar' });
      h.foot = svg('ellipse', { class: 'orb-foot' });
      if (p.owner) h.line.style.stroke = h.foot.style.stroke = opts.colorOf(p.owner);
      lines.insertBefore(h.foot, ringLine);
      lines.insertBefore(h.line, ringLine);
      layer.append(h);
      return h;
    });
    ring.lastChild.textContent = layout.more.find((m) => m.kind === 'question') ? `Open questions (+${layout.more.find((m) => m.kind === 'question').n})` : 'Open questions';
    hub.lastChild.textContent = layout.more.find((m) => m.kind === 'decision') ? `Decided (+${layout.more.find((m) => m.kind === 'decision').n})` : 'Decided';
  }

  // Each frame: the camera on its way, the questions going round, every card
  // where the camera sees it.
  let raf = 0;
  let last = performance.now();
  const frames = [];
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(64, now - last);
    last = now;
    frames.push(dt);
    if (frames.length > 120) frames.shift();
    if (goal) {
      const t = clamp((now - goal.start) / goal.ms, 0, 1);
      const e = ease(t);
      for (const k of ['yaw', 'pitch', 'dist']) cam[k] = goal.from[k] + (goal.to[k] - goal.from[k]) * e;
      if (t >= 1) goal = null;
    } else if (Math.abs(spin) > 0.01) {
      cam.yaw += spin * dt;
      spin *= 0.94;
    }
    if (!reduced()) phase += dt * 0.004;
    moving(!!goal || Math.abs(spin) > 0.01 || turning);
    draw(now);
    raf = requestAnimationFrame(frame);
  }
  // While the camera moves, each card is a layer of its own (cheap to move,
  // a little soft); when it stops, they are drawn again, sharp.
  let turning = false;
  let still = 0;
  function moving(on) {
    if (on) { clearTimeout(still); still = 0; root.classList.add('orb-moving'); } else if (!still && root.classList.contains('orb-moving')) still = setTimeout(() => { root.classList.remove('orb-moving'); still = 0; }, 150);
  }
  const at = (nd, extra = 0) => {
    const a = nd.a + (nd.orbit ? phase : 0) + extra;
    const [x, y] = polar(a, nd.r);
    return [x, y, nd.z];
  };
  // Only what changed is written: a frame with many cards stays cheap.
  const put = (e, k, v) => { if (e.style[k] !== v) e.style[k] = v; };
  const attrs = (e, a) => { for (const k in a) { const v = String(a[k]); if (e.getAttribute(k) !== v) e.setAttribute(k, v); } };
  const ringLine = svg('polyline', { class: 'orb-orbit' });
  const beam = svg('path', { class: 'orb-beam' });
  const spot = svg('ellipse', { class: 'orb-spot' });
  lines.append(ringLine, beam, spot);
  let plateOf = null;
  function draw(now) {
    floor.style.transform = orbitTransform(cam);
    const P = (p) => project(cam, size.w, size.h, p);
    let i = 0;
    for (const c of cards.values()) {
      const nd = c.node;
      const [x, y, z] = at(nd);
      const up = ease(clamp((now - born - i++ * 45) / 700, 0, 1));
      const p = P([x, y, z * up]);
      c.wh ||= [c.offsetWidth, c.offsetHeight];
      const s = clamp(p.s, 0.25, 2.2);
      put(c, 'transform', `translate(${(p.x - c.wh[0] / 2).toFixed(1)}px, ${(p.y - c.wh[1]).toFixed(1)}px) scale(${s.toFixed(3)})`);
      put(c, 'zIndex', String(Math.round(5000 + p.depth)));
      put(c, 'opacity', (up * clamp(0.45 + (s - 0.45) * 0.9, 0.35, 1)).toFixed(2));
      c.screen = p;
      c.base = P([x, y, 0]);
    }
    for (const h of heads) {
      const pl = h.pillar;
      const [x, y] = polar(pl.a, pl.r);
      const p = P([x, y, pl.top + 26]);
      h.wh ||= [h.offsetWidth, h.offsetHeight];
      const s = clamp(p.s, 0.3, 2);
      put(h, 'transform', `translate(${(p.x - h.wh[0] / 2).toFixed(1)}px, ${(p.y - h.wh[1]).toFixed(1)}px) scale(${s.toFixed(3)})`);
      put(h, 'zIndex', String(Math.round(5000 + p.depth)));
      h.classList.toggle('hot', hot?.pillar === pl);
      // Its pillar, down to its foot on the floor.
      const a = P([x, y, 0]);
      const b = P([x, y, pl.top]);
      attrs(h.line, { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}`, class: `orb-pillar${hot?.pillar === pl ? ' hot' : ''}` });
      attrs(h.foot, { cx: a.x.toFixed(1), cy: a.y.toFixed(1), rx: (16 * a.s).toFixed(1), ry: (6 * a.s).toFixed(1) });
    }
    const ph = P([0, 0, 330]);
    put(hub, 'transform', `translate(${ph.x.toFixed(1)}px, ${ph.y.toFixed(1)}px) translate(-50%, -100%) scale(${clamp(ph.s, 0.4, 1.6).toFixed(3)})`);
    hub.classList.toggle('hot', hot?.kind === 'decision');
    const front = Math.round(((90 - cam.yaw) % 360 + 360) % 360);
    const pr = P([...polar(front + 38, ORBIT.ring), 0]);
    put(ring, 'transform', `translate(${pr.x.toFixed(1)}px, ${(pr.y + 8).toFixed(1)}px) translate(-50%, 0) scale(${clamp(pr.s, 0.4, 1.6).toFixed(3)})`);
    ring.classList.toggle('hot', hot?.kind === 'question');
    const pts = [];
    for (let k = 0; k <= 72; k++) { const p = P([...polar(k * 5 + phase, ORBIT.ring), 60]); pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`); }
    attrs(ringLine, { points: pts.join(' '), class: `orb-orbit${hot?.kind === 'question' ? ' hot' : ''}` });
    // A card's beam down to its place on the floor, and its line.
    const lit = hover && !drag ? hover : null;
    beam.style.display = spot.style.display = lit?.screen ? '' : 'none';
    if (lit?.screen) {
      const a = lit.base;
      const b = lit.screen;
      attrs(beam, { d: `M${b.x.toFixed(1)},${b.y.toFixed(1)} L${a.x.toFixed(1)},${a.y.toFixed(1)}`, class: `orb-beam m-${lit.node.kind}` });
      attrs(spot, { cx: a.x.toFixed(1), cy: a.y.toFixed(1), rx: (22 * a.s).toFixed(1), ry: (8 * a.s).toFixed(1), class: `orb-spot m-${lit.node.kind}` });
      if (plateOf !== lit) plate.replaceChildren(el('span', 'orb-plate-sec', lit.node.item.section || 'The note'), el('span', 'orb-plate-line', opts.lineOf(lit.node.item)));
      put(plate, 'transform', `translate(${a.x.toFixed(1)}px, ${(a.y + 12).toFixed(1)}px) translate(-50%, 0)`);
    }
    plateOf = lit;
    plate.classList.toggle('on', !!lit?.screen);
  }
  const resized = new ResizeObserver(() => {
    const r = root.getBoundingClientRect();
    size = { w: r.width, h: r.height };
    lines.setAttribute('width', String(size.w));
    lines.setAttribute('height', String(size.h));
  });
  resized.observe(root);

  // The camera: to an agenda item (k), or round the whole (null).
  function fly(k, ms = 900) {
    const to = k == null || !layout.sectors[k]
      ? { ...ORBIT_CAMERA, yaw: Math.round(cam.yaw / 360) * 360 }
      : { yaw: nearestYaw(90 - layout.sectors[k].angle), pitch: 50, dist: 120 };
    goal = { from: { ...cam }, to, start: performance.now(), ms };
    spin = 0;
  }
  const nearestYaw = (y) => y + 360 * Math.round((cam.yaw - y) / 360);
  function turn(dy, dp = 0, dd = 0, ms = 380) {
    const base = goal ? goal.to : cam;
    goal = { from: { ...cam }, to: { yaw: base.yaw + dy, pitch: clamp(base.pitch + dp, 30, 76), dist: clamp(base.dist + dd, -150, 1500) }, start: performance.now(), ms };
  }

  // Dragging the floor turns it; a pinch (or a wheel) brings it nearer.
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.orb-card')) return;
    goal = null;
    let lx = e.clientX;
    let ly = e.clientY;
    let lt = performance.now();
    root.setPointerCapture?.(e.pointerId);
    turning = true;
    const move = (ev) => {
      const now = performance.now();
      const dx = ev.clientX - lx;
      cam.yaw += dx * 0.35;
      cam.pitch = clamp(cam.pitch - (ev.clientY - ly) * 0.18, 30, 76);
      spin = (dx * 0.35) / Math.max(8, now - lt);
      lx = ev.clientX; ly = ev.clientY; lt = now;
    };
    const up = () => { turning = false; root.removeEventListener('pointermove', move); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    goal = null;
    moving(true);
    if (e.ctrlKey) cam.dist = clamp(cam.dist + e.deltaY * 6, -150, 1500);
    else { cam.yaw += e.deltaX * 0.25; cam.dist = clamp(cam.dist + e.deltaY * 1.5, -150, 1500); }
  }, { passive: false });

  // A card picked up and thrown: to a pillar (that person's to-do), the
  // middle (decided) or the ring (open) — the wall's change, proposed.
  let drag = null;
  const targets = () => [
    { kind: 'decision', title: 'Decided', at: () => [hub.getBoundingClientRect()] },
    { kind: 'question', title: 'Open questions', ring: true },
    ...heads.map((h) => ({ kind: 'todo', owner: h.pillar.owner, pillar: h.pillar, head: h })),
  ];
  function distTo(t, x, y) {
    const r = root.getBoundingClientRect();
    const px = x - r.left;
    const py = y - r.top;
    const seg = (a, b) => {
      const vx = b.x - a.x; const vy = b.y - a.y;
      const u = clamp(((px - a.x) * vx + (py - a.y) * vy) / Math.max(1, vx * vx + vy * vy), 0, 1);
      return Math.hypot(px - (a.x + vx * u), py - (a.y + vy * u));
    };
    const P = (p) => project(cam, size.w, size.h, p);
    if (t.kind === 'decision') { const p = P([0, 0, 300]); return { d: Math.hypot(px - p.x, py - p.y), p }; }
    if (t.ring) {
      let best = { d: Infinity };
      for (let k = 0; k < 72; k++) { const p = P([...polar(k * 5, ORBIT.ring), 60]); const d = Math.hypot(px - p.x, py - p.y); if (d < best.d) best = { d, p }; }
      return best;
    }
    const [x0, y0] = polar(t.pillar.a, t.pillar.r);
    const a = P([x0, y0, 0]);
    const b = P([x0, y0, t.pillar.top + 30]);
    return { d: seg(a, b), p: P([x0, y0, Math.min(t.pillar.top, 64 + ORBIT.step * 0.5)]) };
  }
  function nearest(it, x, y, reach) {
    let best = null;
    for (const t of targets()) {
      if (!opts.accepts(it, t)) continue;
      const m = distTo(t, x, y);
      // Near the middle is the middle: a pillar at the back can pass behind it.
      if (t.kind === 'decision' && m.d < 60) return { ...m, t };
      if (m.d < reach && (!best || m.d < best.d)) best = { ...m, t };
    }
    return best;
  }
  function pick(e, card) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const it = card.node.item;
    const start = { x: e.clientX, y: e.clientY };
    const trail = [];
    let ghost = null;
    const move = (ev) => {
      trail.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
      if (trail.length > 6) trail.shift();
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        const r = card.getBoundingClientRect();
        ghost = card.cloneNode(true);
        ghost.className = `${card.className} orb-ghost`;
        Object.assign(ghost.style, { transform: 'none', width: `${card.offsetWidth}px`, left: `${r.left}px`, top: `${r.top}px`, zIndex: '' });
        ghost.dataset.dx = String(start.x - r.left);
        ghost.dataset.dy = String(start.y - r.top);
        if (card.style.getPropertyValue('--own')) ghost.style.setProperty('--own', card.style.getPropertyValue('--own'));
        document.body.append(ghost);
        card.classList.add('orb-lifted');
        root.classList.add('orb-dragging');
        drag = { it, card };
      }
      ghost.style.left = `${ev.clientX - Number(ghost.dataset.dx)}px`;
      ghost.style.top = `${ev.clientY - Number(ghost.dataset.dy)}px`;
      hot = nearest(it, ev.clientX, ev.clientY, 120)?.t || null;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return;
      // Thrown: where it was going, a quarter of a second on.
      let x = ev.clientX;
      let y = ev.clientY;
      let target = nearest(it, x, y, 120);
      const a = trail[0];
      const b = trail[trail.length - 1];
      if (!target && a && b && b.t > a.t) {
        const v = Math.hypot(b.x - a.x, b.y - a.y) / (b.t - a.t);
        if (v > 0.6) { x += ((b.x - a.x) / (b.t - a.t)) * 260; y += ((b.y - a.y) / (b.t - a.t)) * 260; target = nearest(it, x, y, 200); }
      }
      hot = null;
      root.classList.remove('orb-dragging');
      const r = root.getBoundingClientRect();
      const land = target ? { x: r.left + target.p.x, y: r.top + target.p.y, s: target.p.s } : null;
      const g = ghost;
      g.classList.add('orb-flying');
      const gr = g.getBoundingClientRect();
      const tx = land ? land.x - gr.width / 2 : card.getBoundingClientRect().left;
      const ty = land ? land.y - gr.height / 2 : card.getBoundingClientRect().top;
      requestAnimationFrame(() => {
        g.style.left = `${tx}px`;
        g.style.top = `${ty}px`;
        g.style.transform = `scale(${land ? clamp(land.s * 0.7, 0.3, 1) : 1})`;
        g.style.opacity = land ? '0.2' : '1';
      });
      setTimeout(() => {
        g.remove();
        card.classList.remove('orb-lifted');
        drag = null;
        if (target) opts.move(it, target.t.kind === 'todo' ? { kind: 'todo', owner: target.t.owner } : { kind: target.t.kind });
      }, 440);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  root.key = (e) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') { turn(k === 'ArrowLeft' ? -24 : 24); return true; }
    if (k === 'ArrowUp' || k === 'ArrowDown') { turn(0, k === 'ArrowUp' ? 8 : -8); return true; }
    if (k === '+' || k === '=') { turn(0, 0, -160); return true; }
    if (k === '-' || k === '_') { turn(0, 0, 160); return true; }
    if (k === '0') { fly(null); return true; }
    if (/^[1-9]$/.test(k) && layout.sectors[Number(k) - 1]) { fly(Number(k) - 1); return true; }
    return false;
  };
  root.update = update;
  root.fly = fly;
  root.camera = () => ({ ...cam });
  root.frameTimes = () => [...frames];
  root.png = (title, summary) => orbitPng(title, summary, cam, size, layout, phase, opts.colorOf);
  root.start = () => {
    born = performance.now();
    goal = { from: { ...cam }, to: { ...ORBIT_CAMERA }, start: performance.now() + 100, ms: 1500 };
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  root.destroy = () => { alive = false; cancelAnimationFrame(raf); resized.disconnect(); clearTimeout(still); root.remove(); };
  return root;
}

// The orbit as a picture, as the camera sees it now: drawn again (the floor,
// the pillars, the cards, far to near), so it is sharp. → a PNG Blob promise.
export function orbitPng(title, summary, cam, size, layout, phase, colorOf) {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const C = { bg: v('--bg', '#1b1d23'), card: v('--bg-2', '#21242b'), fg: v('--fg', '#d7dae0'), dim: v('--fg-dim', '#8b919e'), line: v('--accent', '#7aa2f7'), decision: v('--ok', '#9ece6a'), question: v('--accent-2', '#bb9af7'), todo: v('--accent', '#7aa2f7') };
  const font = '-apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const W = Math.round(size.w);
  const H = Math.round(size.h);
  const k = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * k;
  canvas.height = H * k;
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);
  const g = ctx.createRadialGradient(W / 2, H * 0.6, 50, W / 2, H * 0.6, Math.max(W, H));
  g.addColorStop(0, '#1d2433');
  g.addColorStop(1, C.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const P = (p) => project(cam, W, H, p);
  const circle = (r, z = 0) => { ctx.beginPath(); for (let a = 0; a <= 360; a += 4) { const p = P([...polar(a, r), z]); if (a) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); } };
  ctx.lineWidth = 1;
  for (const [r, a] of [[ORBIT.floor, 0.35], [ORBIT.ring, 0.5], [ORBIT.pillars, 0.25], [190, 0.45]]) { circle(r); ctx.strokeStyle = `rgba(122,162,247,${a})`; ctx.stroke(); }
  for (const s of layout.sectors) {
    const a = P([...polar(s.from, 60), 0]);
    const b = P([...polar(s.from, ORBIT.floor), 0]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = 'rgba(122,162,247,.3)'; ctx.stroke();
    const l = P([...polar(s.angle, ORBIT.floor * 0.92), 0]);
    ctx.fillStyle = C.dim; ctx.font = `600 ${Math.round(14 * l.s)}px ${font}`; ctx.textAlign = 'center';
    ctx.fillText(s.title, l.x, l.y);
  }
  ctx.textAlign = 'left';
  const things = [];
  for (const p of layout.pillars) {
    const [x, y] = polar(p.a, p.r);
    const a = P([x, y, 0]);
    const b = P([x, y, p.top]);
    things.push({ depth: -Infinity, draw: () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = p.owner ? colorOf(p.owner) : C.dim; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; } });
    const h = P([x, y, p.top + 26]);
    things.push({ depth: h.depth, draw: () => {
      ctx.fillStyle = p.owner ? colorOf(p.owner) : C.dim;
      ctx.beginPath(); ctx.arc(h.x, h.y - 14 * h.s, 13 * h.s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.fg; ctx.font = `700 ${Math.round(14 * h.s)}px ${font}`; ctx.textAlign = 'center';
      ctx.fillText(p.title, h.x, h.y + 12 * h.s); ctx.textAlign = 'left';
    } });
  }
  const wrap = (s, width) => {
    const out = []; let line = '';
    for (const w of s.split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line);
    return out.slice(0, 3);
  };
  for (const nd of layout.nodes) {
    const a = nd.a + (nd.orbit ? phase : 0);
    const [x, y] = polar(a, nd.r);
    const p = P([x, y, nd.z]);
    things.push({ depth: p.depth, draw: () => {
      const s = clamp(p.s, 0.25, 2.2);
      const w = 210 * s;
      ctx.font = `${Math.round(14 * s)}px ${font}`;
      const ls = wrap(nd.item.body, w - 24 * s);
      const hh = (34 + ls.length * 19) * s;
      const tint = nd.kind === 'todo' && nd.owner ? colorOf(nd.owner) : C[nd.kind];
      ctx.globalAlpha = clamp(0.45 + (s - 0.45) * 0.9, 0.35, 1);
      ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y - hh, w, hh, 8 * s); ctx.fillStyle = C.card; ctx.fill();
      ctx.strokeStyle = tint; ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = tint; ctx.font = `700 ${Math.round(10 * s)}px ${font}`;
      ctx.fillText((nd.item.done ? 'DONE' : { decision: 'DECIDED', question: 'OPEN', todo: 'TO-DO' }[nd.kind]), p.x - w / 2 + 12 * s, p.y - hh + 16 * s);
      ctx.fillStyle = nd.item.done ? C.dim : C.fg; ctx.font = `${Math.round(14 * s)}px ${font}`;
      ls.forEach((l, i) => ctx.fillText(l, p.x - w / 2 + 12 * s, p.y - hh + (34 + i * 19) * s));
      ctx.globalAlpha = 1;
    } });
  }
  things.sort((a, b) => a.depth - b.depth).forEach((t) => t.draw());
  ctx.fillStyle = C.dim; ctx.font = `600 12px ${font}`; ctx.fillText('DECISION ORBIT', 32, 36);
  ctx.fillStyle = C.fg; ctx.font = `700 24px ${font}`; ctx.fillText(title, 32, 66);
  ctx.fillStyle = C.dim; ctx.font = `13px ${font}`; ctx.fillText(summary, 32, 88);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
}
