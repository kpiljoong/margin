// Layers (experimental): one note in the review, and what is on it in
// layers — the proposal (the red pen), the lens (what the agent sees, its
// places joined by arcs in the gutter), forks (a paragraph's other ways,
// switched in its place) and my comments. Each layer has a chip that shows
// or hides it; j / k go through the marks of the layers shown, in the order
// of the note. A minimap at the side has a tick for each.
//
// The red pen page (app.js penPage) is the note: the layers' places are
// written in as margin notes of penSource (layerNotes) and found on it
// after; nothing of the proposal changes.

import { LENS_KINDS, arcPath } from './lens.js';

export const LAYERS = { pen: 'Proposal', lens: 'Lens', forks: 'Forks', mine: 'My comments' };
// The numbers the layers' places take among the margin notes (penSource):
// past the agent's own.
const FIRST = { lens: 1000, mine: 1400 };

// The places of the lens' findings and of my comments, as margin notes of
// penSource: { quote, comment: '', n, layer, ref } (ref: the finding's i, or
// the comment's number).
export function layerNotes({ lens = [], mine = [] }) {
  let n = FIRST.lens;
  return [
    ...lens.flatMap((f) => f.quotes.map((quote) => ({ quote, comment: '', n: n++, layer: 'lens', ref: f.i }))),
    ...mine.slice(0, 300).map((x, k) => ({ quote: x.quote, comment: '', n: FIRST.mine + k, layer: 'mine', ref: k })),
  ];
}

// Arcs nested: each one past the deepest of the shorter ones it overlaps,
// so short arcs stay inside and long ones go round them. spans: [[y1, y2]]
// → their levels (1 the innermost).
export function arcLevels(spans) {
  const order = spans.map((s, k) => k).sort((a, b) => (spans[a][1] - spans[a][0]) - (spans[b][1] - spans[b][0]));
  const level = new Array(spans.length).fill(1);
  order.forEach((a, k) => {
    for (const b of order.slice(0, k)) {
      if (spans[b][0] < spans[a][1] && spans[a][0] < spans[b][1]) level[a] = Math.max(level[a], level[b] + 1);
    }
  });
  return level;
}

// The lines of the marked text (penSource rows) that a paragraph of base,
// lines from to to (not included), takes: its own, and those of changes
// on it (one that only puts lines in counts at either edge).
export function regionRows(rows, hunks, from, to) {
  const on = (hk) => (hk.baseEnd === hk.baseStart ? hk.baseStart >= from && hk.baseStart <= to : hk.baseStart < to && hk.baseEnd > from);
  const out = new Set();
  rows.forEach((r, k) => { if (r.i >= 0 ? hunks[r.i] && on(hunks[r.i]) : r.line >= from && r.line < to) out.add(k); });
  return out;
}

// The ways of a fork, in order: the paragraph as it is ('o'), then each option.
export const forkWays = (fork) => ['o', ...fork.options.map((_, k) => String(k))];
export const inUse = (fork) => (fork.pick == null ? 'o' : String(fork.pick));
const wayTitle = (k) => (k === 'o' ? 'As it is' : `Option ${Number(k) + 1}`);

const NS = 'http://www.w3.org/2000/svg';
const GUTTER = 44;
const KIND_COLOR = { gap: '--warn', conflict: '--bad', open: '--accent', decided: '--ok', link: '--fg-dim' };
const short = (q, n = 60) => { const s = q.replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}
function svgEl(tag, cls, attrs) {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function button(cls, text, title, fn) {
  const b = el('button', cls, text);
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
}

// page: the red pen page of the note (penPage, with layerNotes among its
// margin notes). opts: { path, base, hunks (the note's, as in penPage),
// pen (redpen.js), render(markdown) → html, lens: [{ i, kind, quotes,
// note }], forks: [{ n, quote, options, pick }], mine: [{ quote, text }],
// off: Set of layers hidden, hidden: Set of lens kinds hidden, shown: { n
// → way in view } (all three kept by the caller), picks: Set of findings
// picked, pick(card): it becomes the current one, fix(i) | null, take(n,
// pick) | null, compare(n) }.
// → the page, with page.layerSelect(card), page.layerLayout(),
// page.forkStep(n, ±1), page.forkShown(n).
export function layerPage(page, opts) {
  const { pen } = opts;
  const body = page.querySelector('.pen-body');
  const doc = page.querySelector('.pen-doc');
  const margin = page.querySelector('.pen-margin');
  const { marks, rows } = page.penInfo;
  page.classList.add('layered');
  body.classList.add('layered-body');

  const markOf = new Map();
  for (const m of marks) for (const x of m.notes) if (x.layer) markOf.set(x.n, m);
  const spans = (m) => (m ? [...doc.querySelectorAll(`[data-mark="${m.key}"]`)] : []);
  const notes = layerNotes(opts);
  const marksOf = (layer, ref) => [...new Set(notes.filter((x) => x.layer === layer && x.ref === ref).map((x) => markOf.get(x.n)).filter(Boolean))];
  // A card among the margin's, by the line it is on.
  const place = (card) => margin.insertBefore(card, [...margin.children].find((x) => Number(x.dataset.line) > Number(card.dataset.line)) || null);
  const card = (cls, hunk, line, mark, ...kids) => {
    const c = el('div', `layer-card kb-item ${cls}`, ...kids);
    Object.assign(c.dataset, { path: opts.path, hunk, line: line + 1 });
    if (mark) c.dataset.mark = mark;
    return c;
  };

  // ---- the lens: its places tinted by kind, joined in the gutter.
  const lens = opts.lens.map((f) => {
    const ms = marksOf('lens', f.i);
    return { ...f, marks: ms, line: ms.length ? Math.min(...ms.map((m) => m.line)) : 0 };
  }).sort((a, b) => a.line - b.line || a.i - b.i);
  const owners = new Map();
  for (const f of lens) {
    for (const m of f.marks) {
      if (!owners.has(m.key)) owners.set(m.key, []);
      owners.get(m.key).push(f);
      // Words, not a change of the proposal: the lens colours them.
      if (m.kind !== 'note') continue;
      for (const s of spans(m)) {
        if (!s.dataset.k) { s.dataset.k = f.kind; s.classList.add('lens-q', `lens-k-${f.kind}`); }
        else if (s.dataset.k !== f.kind && !s.classList.contains('lens-multi')) {
          // Words of two findings: striped with both.
          s.classList.add('lens-multi');
          s.style.setProperty('--lk2', `var(${KIND_COLOR[f.kind] || '--fg-dim'})`);
        }
      }
    }
  }
  const lensCards = new Map();
  for (const f of lens) {
    const quotes = el('div', 'lens-quotes', f.quotes.map((q, k) => {
      const m = markOf.get(notes.find((x) => x.layer === 'lens' && x.ref === f.i && x.quote === q)?.n);
      return button(`lens-quote${m ? '' : ' gone'}`, `“${short(q)}”`, m ? 'Show it on the note' : 'Not found on the note as it is shown', () => {
        opts.pick(lensCards.get(f.i));
        spans(m)[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }));
    const c = card(`lens-card lens-k-${f.kind}${opts.picks.has(f.i) ? ' lens-pick' : ''}`, `L${f.i}`, f.line, f.marks[0]?.key,
      el('div', 'lens-card-head', el('span', `lens-kind lens-k-${f.kind}`, LENS_KINDS[f.kind] || f.kind),
        opts.fix && button('btn small', 'Fix…', 'Ask for a fix of this, as a red pen proposal (f)', () => opts.fix(f.i))),
      el('div', 'lens-note', f.note), quotes);
    c.dataset.lens = f.i;
    c.addEventListener('mouseenter', () => { hover = f.i; drawLens(); });
    c.addEventListener('mouseleave', () => { hover = null; drawLens(); });
    lensCards.set(f.i, c);
    place(c);
  }

  // ---- my comments (written in the space, for the agent).
  const mine = opts.mine.map((x, k) => ({ ...x, k, marks: marksOf('mine', k) }));
  for (const x of mine) {
    for (const m of x.marks) if (m.kind === 'note') for (const s of spans(m)) s.classList.add('mine-q');
    const c = card('mine-card', `M${x.k}`, x.marks[0]?.line ?? 0, x.marks[0]?.key, el('span', 'mine-who', 'You'), el('span', 'mine-text', x.text));
    c.dataset.mine = x.k;
    place(c);
  }

  // ---- forks: a paragraph's other ways, switched in its place.
  const forks = [];
  for (const f of opts.forks) {
    const at = opts.base.indexOf(f.quote);
    const from = at < 0 ? -1 : opts.base.slice(0, at).split('\n').length - 1;
    const want = at < 0 ? new Set() : regionRows(rows, opts.hunks, from, from + f.quote.split('\n').length);
    const top = [];
    for (const x of doc.querySelectorAll('[data-line]')) {
      if (!want.has(Number(x.dataset.line))) continue;
      let b = x;
      while (b.parentElement && b.parentElement !== doc) b = b.parentElement;
      if (b.parentElement === doc && !top.includes(b)) top.push(b);
    }
    const F = { ...f, from, blocks: top, swap: null, ways: forkWays(f) };
    F.label = el('span', 'fork-tab-label');
    F.tab = el('div', 'fork-tab',
      button('fork-step', '◀', 'The way before (←)', () => { opts.pick(F.card); step(F, -1); }),
      F.label,
      button('fork-step', '▶', 'The next way (→)', () => { opts.pick(F.card); step(F, 1); }));
    F.tab.dataset.mark = `F${f.n}`;
    F.tab.addEventListener('click', () => opts.pick(F.card));
    if (top[0]) { top[0].before(F.tab); for (const b of top) b.classList.add('fork-region'); }
    F.head = el('span', 'fork-card-count');
    F.why = el('div', 'fork-why');
    F.acts = el('div', 'fork-acts');
    F.card = card('fork-card', `F${f.n}`, Math.max(0, from), top[0] ? `F${f.n}` : null,
      el('div', 'fork-card-head', el('span', 'fork-kind', 'Other ways'), F.head), F.why, F.acts);
    F.card.dataset.fork = f.n;
    place(F.card);
    forks.push(F);
  }
  const fork = (n) => forks.find((F) => F.n === n);
  function fade(nodes) {
    for (const x of nodes) {
      x.classList.remove('fork-fade');
      void x.offsetWidth;
      x.classList.add('fork-fade');
      x.addEventListener('animationend', () => x.classList.remove('fork-fade'), { once: true });
    }
  }
  // Way k of the fork in its place in the note: the one in use as the
  // red pen shows it, another as it would read.
  function show(F, k, animate = true) {
    if (!F.ways.includes(k)) k = inUse(F);
    const was = F.shown;
    F.shown = k;
    opts.shown[F.n] = k;
    const using = k === inUse(F);
    if (F.blocks.length && (was !== k || !animate)) {
      if (using && F.swap) { F.swap.replaceWith(...F.blocks); F.swap = null; if (animate) fade(F.blocks); }
      else if (!using) {
        const box = el('div', 'fork-swap');
        box.innerHTML = opts.render(k === 'o' ? F.quote : F.options[Number(k)].text);
        if (F.swap) F.swap.replaceWith(box);
        else { F.blocks[0].before(box); for (const b of F.blocks) b.remove(); }
        F.swap = box;
        if (animate) fade([box]);
      }
    }
    const i = F.ways.indexOf(k);
    const state = using ? (F.pick == null ? 'in the note' : 'taken') : 'preview';
    F.label.textContent = `${i + 1}/${F.ways.length} · ${wayTitle(k)} · ${state}`;
    F.tab.classList.toggle('previewing', !using);
    F.head.textContent = `${wayTitle(k)} · ${i + 1} of ${F.ways.length}`;
    F.why.textContent = k === 'o' ? 'The paragraph as the note has it.' : F.options[Number(k)].why || '';
    F.acts.replaceChildren(...[
      el('span', 'fork-state', state),
      opts.take && !using ? button('btn small', k === 'o' ? 'Keep it' : 'Take', k === 'o' ? 'Back to the paragraph as it is (Enter)' : 'Put this one in the proposal (Enter)', () => opts.take(F.n, k === 'o' ? null : Number(k))) : null,
      button('btn small', 'Compare', 'All the ways side by side (=)', () => opts.compare(F.n))].filter(Boolean));
    layout();
  }
  function step(F, dir) {
    const i = F.ways.indexOf(F.shown);
    show(F, F.ways[(i + dir + F.ways.length) % F.ways.length]);
  }

  // ---- the chips: a layer shown or hidden.
  const counts = { pen: margin.querySelectorAll('.pen-card').length, lens: lens.length, forks: forks.length, mine: mine.length };
  const kinds = {};
  for (const f of lens) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  const bar = el('div', 'layer-bar', el('span', 'layer-badge', 'Layers · experimental'),
    Object.keys(LAYERS).filter((k) => counts[k]).map((k) => {
      const b = button(`layer-chip layer-${k}`, `${LAYERS[k]} ${counts[k]}`, `Show or hide ${LAYERS[k].toLowerCase()} on the note`, () => { if (!opts.off.delete(k)) opts.off.add(k); apply(); });
      b.dataset.layer = k;
      return b;
    }),
    lens.length ? el('span', 'layer-kinds', Object.keys(LENS_KINDS).filter((k) => kinds[k]).map((k) => {
      const b = button(`lens-chip lens-k-${k}`, `${LENS_KINDS[k]} ${kinds[k]}`, 'Show or hide these', () => { if (!opts.hidden.delete(k)) opts.hidden.add(k); apply(); });
      b.dataset.kind = k;
      return b;
    })) : null);
  page.prepend(bar);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'lens-arcs');
  body.prepend(svg);
  let lit = null;
  let hover = null;
  const lensOn = (f) => !opts.off.has('lens') && !opts.hidden.has(f.kind);

  function apply() {
    for (const b of bar.querySelectorAll('.layer-chip')) b.classList.toggle('off', opts.off.has(b.dataset.layer));
    for (const b of bar.querySelectorAll('.lens-chip')) b.classList.toggle('off', opts.hidden.has(b.dataset.kind));
    for (const k of Object.keys(LAYERS)) page.classList.toggle(`layer-off-${k}`, opts.off.has(k));
    for (const k of Object.keys(LENS_KINDS)) page.classList.toggle(`lens-hide-${k}`, opts.hidden.has(k));
    // Hidden, a card is no stop for j / k.
    const set = (c, on) => { c.hidden = !on; c.classList.toggle('kb-item', on); };
    for (const c of margin.querySelectorAll('.pen-card')) set(c, !opts.off.has('pen'));
    for (const f of lens) set(lensCards.get(f.i), lensOn(f));
    for (const c of margin.querySelectorAll('.mine-card')) set(c, !opts.off.has('mine'));
    for (const F of forks) {
      set(F.card, !opts.off.has('forks'));
      // Off, the note is as the proposal has it.
      show(F, opts.off.has('forks') ? inUse(F) : opts.shown[F.n] ?? inUse(F), false);
    }
    layout();
  }

  function drawLens() {
    svg.replaceChildren();
    const box = body.getBoundingClientRect();
    if (!box.width || opts.off.has('lens')) return;
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', body.scrollHeight);
    const yOf = (s) => { const r = s.getClientRects()[0] || s.getBoundingClientRect(); return r.top - box.top + r.height / 2; };
    // A place in view: the mark's own words, or (a change hidden with the
    // proposal) those of another change on its line.
    const seen = (m) => spans(m).find((s) => s.isConnected && s.getClientRects().length);
    const at = (m) => seen(m) || marks.filter((x) => x.kind === 'hunk' && x.line === m.line).map(seen).find(Boolean);
    const list = lens.filter(lensOn).map((f) => ({ f, ys: [...new Set(f.marks.map(at).filter(Boolean))].map(yOf).sort((a, b) => a - b) }));
    const segs = list.flatMap(({ f, ys }) => ys.slice(1).map((y, j) => ({ f, y1: ys[j], y2: y })));
    const levels = arcLevels(segs.map((s) => [s.y1, s.y2]));
    const x = GUTTER - 6;
    const on = (f) => (lit === f.i || hover === f.i ? ' lens-on' : '');
    segs.forEach((s, k) => {
      const d = arcPath(x, s.y1, s.y2, Math.min(GUTTER - 6, 4 + levels[k] * 7));
      svg.append(svgEl('path', `lens-arc lens-k-${s.f.kind}${on(s.f)}`, { d }));
      const hit = svgEl('path', 'lens-hit', { d });
      hit.addEventListener('click', () => opts.pick(lensCards.get(s.f.i)));
      svg.append(hit);
    });
    for (const { f, ys } of list) for (const y of ys) svg.append(svgEl('circle', `lens-dot lens-k-${f.kind}${on(f)}`, { cx: x, cy: y, r: 3 }));
    // The finding in view (or under the pointer): a line from each of its
    // places to its card.
    const dx = doc.getBoundingClientRect().right - box.left + 6;
    const mx = margin.getBoundingClientRect().left - box.left;
    const my = margin.getBoundingClientRect().top - box.top;
    for (const { f, ys } of list) {
      if (lit !== f.i && hover !== f.i) continue;
      const c = lensCards.get(f.i);
      const y2 = my + (parseFloat(c.style.top) || 0) + 10;
      for (const y of ys) svg.append(svgEl('path', `lens-tie lens-k-${f.kind}`, { d: `M${dx},${y} C${(dx + mx) / 2},${y} ${(dx + mx) / 2},${y2} ${mx - 2},${y2}` }));
    }
  }
  function layout() {
    if (!page.isConnected) return;
    pen.layoutMargin(body);
    drawLens();
  }

  function select(cur) {
    const here = cur && page.contains(cur);
    lit = here && cur.dataset.lens != null ? Number(cur.dataset.lens) : null;
    page.classList.toggle('lens-focus', lit != null);
    // Words of more than one finding take the colour of the one lit.
    for (const s of doc.querySelectorAll('.lens-q')) {
      const f = lit != null && owners.get(s.dataset.mark)?.find((x) => x.i === lit);
      s.classList.toggle('lens-on', !!f);
      for (const k of Object.keys(LENS_KINDS)) s.classList.toggle(`lens-k-${k}`, (f ? f.kind : s.dataset.k) === k);
    }
    const m = here && cur.dataset.mine != null ? mine[Number(cur.dataset.mine)] : null;
    for (const s of doc.querySelectorAll('.mine-q.mine-on')) s.classList.remove('mine-on');
    for (const mk of m?.marks || []) for (const s of spans(mk)) s.classList.add('mine-on');
    for (const F of forks) F.tab.classList.toggle('on', here && cur === F.card);
    layout();
  }

  // A place on the note picks what is on it (the next one, when it is already).
  doc.addEventListener('click', (e) => {
    const s = e.target.closest('.lens-q, .mine-q');
    if (!s) return;
    const on = [
      ...(owners.get(s.dataset.mark) || []).filter(lensOn).map((f) => lensCards.get(f.i)),
      ...(opts.off.has('mine') ? [] : mine.filter((x) => x.marks.some((m) => m.key === s.dataset.mark)).map((x) => margin.querySelector(`.mine-card[data-mine="${x.k}"]`))),
    ];
    if (!on.length) return;
    const at = on.findIndex((c) => c.classList.contains('kb-cur'));
    opts.pick(on[(at + 1) % on.length]);
  });

  page.layerSelect = select;
  page.layerLayout = layout;
  page.forkStep = (n, dir) => { const F = fork(n); if (F) step(F, dir); };
  page.forkShown = (n) => fork(n)?.shown;
  const ro = new ResizeObserver(() => layout());
  ro.observe(body);
  ro.observe(doc);
  for (const F of forks) F.shown = inUse(F);
  apply();
  return page;
}

// The minimap: a tick at the side of the review for each mark of the
// layers shown — proposal, lens, forks, comments — where it is in the
// whole; a click goes there. The part in view is shaded.
export function minimap(wrap, pick) {
  const view = el('div', 'mm-view');
  const bar = el('div', 'mm-bar', view);
  const mm = el('div', 'minimap', bar);
  wrap.prepend(mm);
  const kind = (it) => (it.classList.contains('pen-card') ? `mm-pen${it.classList.contains('pen-y') ? ' mm-y' : it.classList.contains('pen-n') ? ' mm-n' : ''}`
    : it.classList.contains('lens-card') ? `mm-lens ${[...it.classList].find((c) => c.startsWith('lens-k-')) || ''}`
      : it.classList.contains('fork-card') ? 'mm-fork' : it.classList.contains('mine-card') ? 'mm-mine' : 'mm-other');
  function scrolled() {
    const total = wrap.scrollHeight;
    view.style.top = `${(wrap.scrollTop / total) * 100}%`;
    view.style.height = `${(wrap.clientHeight / total) * 100}%`;
  }
  function draw() {
    const items = [...wrap.querySelectorAll('.kb-item')].filter((it) => it.offsetParent);
    const total = wrap.scrollHeight;
    const marked = items.some((it) => it.matches('.pen-card, .layer-card'));
    mm.hidden = !marked || total <= wrap.clientHeight * 1.15;
    if (mm.hidden) return;
    bar.style.height = `${wrap.clientHeight}px`;
    const top = wrap.getBoundingClientRect().top - wrap.scrollTop;
    bar.replaceChildren(view, ...items.map((it) => {
      // A margin card is where its mark is on the note.
      const page = it.closest('.pen-page');
      const at = (it.dataset.mark && page?.querySelector(`.pen-doc [data-mark="${CSS.escape(it.dataset.mark)}"]`)) || it;
      const y = at.getBoundingClientRect().top - top;
      const t = el('button', `mm-tick ${kind(it)}${it.classList.contains('kb-cur') ? ' mm-cur' : ''}`);
      t.style.top = `${Math.max(0, Math.min(100, (y / total) * 100))}%`;
      t.tabIndex = -1;
      t.title = it.querySelector('.lens-note, .pen-note, .mine-text, .fork-card-count')?.textContent || '';
      t.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });
      return t;
    }));
    scrolled();
  }
  wrap.addEventListener('scroll', scrolled, { passive: true });
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  for (const c of wrap.querySelectorAll('.file-card')) ro.observe(c);
  mm.redraw = draw;
  requestAnimationFrame(draw);
  return mm;
}
