// Beside a note (experimental): what Margin keeps next to a note, never in
// it — the paragraphs you locked, the drawer of scraps you set aside for
// it, and where its paragraphs came from (server.js originOf).
//
// Locked: an agent's change to a locked paragraph is never applied — the
// server leaves it out of the proposal and out of applying, whatever the
// agent did. The lock is the paragraph as written: change it yourself and
// it is free again.
//
// Origin: the note's paragraphs, each with a thread to where it came from —
// a run of the agent (the lines it put in, applied), a note it was
// gathered from, the drawer — or to the notes it was gathered into.
// Only a way to look; nothing in it changes the note.
import { blocksOf } from './gather.js';
import { paragraphAt } from './forks.js';

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// The paragraph to lock (or unlock) at the cursor: the selection if there
// is one, else the paragraph there; on: it is locked already.
export function lockAt(text, start, end, locks) {
  for (const q of locks) {
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
      if (start >= i && end <= i + q.length) return { quote: q, on: true };
    }
  }
  const quote = start < end ? text.slice(start, end).replace(/^\s*\n|\n\s*$/g, '') : paragraphAt(text, start);
  return { quote: quote.trim() ? quote : '', on: false };
}

// Where the locked paragraphs are in the text: [from, to] of each found.
export function lockSpans(text, locks) {
  const out = [];
  for (const q of locks) {
    const i = q ? text.indexOf(q) : -1;
    if (i >= 0) out.push([i, i + q.length]);
  }
  return out;
}

// A scrap put in the note at pos: a paragraph of its own, after the line
// the cursor is on. → the edit { from, to, insert }, where the scrap
// starts (at) and the text after it.
export function placeScrap(text, pos, scrap) {
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  const from = text.slice(0, end).replace(/\s+$/, '').length;
  const to = end + /^\s*/.exec(text.slice(end))[0].length;
  const body = scrap.replace(/^\s+|\s+$/g, '');
  const insert = `${from ? '\n\n' : ''}${body}\n${to < text.length ? '\n' : ''}`;
  return { from, to, insert, at: from + (from ? 2 : 0), text: text.slice(0, from) + insert + text.slice(to) };
}

// Each block of the note and where it came from, as far as Margin knows.
// origin: server.js originOf → { runs: [{ id, task, lines }], gathered:
// [{ from, text }], drawer: [{ from, text }], usedIn: [{ into, text }],
// locks }. A block is a run's when most of its lines are lines the run put
// in (the latest such run); all: every line still as it put it.
export function originMarks(text, origin) {
  const runSets = origin.runs.map((r) => new Set(r.lines.map((l) => l.trim())));
  return blocksOf(text).map((b) => {
    const lines = b.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const t = norm(b.text);
    const marks = [];
    for (let k = origin.runs.length - 1; k >= 0; k--) {
      const n = lines.filter((l) => runSets[k].has(l)).length;
      if (n && n * 2 >= lines.length) { marks.push({ kind: 'agent', key: `agent:${origin.runs[k].id}`, run: origin.runs[k], all: n === lines.length }); break; }
    }
    const from = origin.gathered.find((p) => norm(p.text) === t);
    if (from) marks.push({ kind: 'from', key: `from:${from.from}`, from: from.from, at: from.at });
    const scrap = !from && t.length >= 12 && origin.drawer.find((s) => norm(s.text).includes(t));
    if (scrap) marks.push({ kind: 'drawer', key: `drawer:${scrap.from}`, from: scrap.from });
    for (const u of origin.usedIn) {
      if (norm(u.text) === t && !marks.some((m) => m.kind === 'used' && m.into === u.into)) marks.push({ kind: 'used', key: `used:${u.into}`, into: u.into, at: u.at });
    }
    const lock = origin.locks.find((q) => norm(q) && (norm(q).includes(t) || t.includes(norm(q))));
    if (lock) marks.push({ kind: 'locked', key: 'locked', quote: lock });
    return { ...b, marks };
  });
}

const nameOf = (p) => p.split('/').pop().replace(/\.(md|markdown|mdx|txt)$/i, '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

// The places a block's marks lead to, as chips: one for each run, note and
// the lock, with how many blocks.
export function originSources(blocks) {
  const by = new Map();
  for (const b of blocks) {
    for (const m of b.marks) {
      const s = by.get(m.key) || { key: m.key, kind: m.kind, mark: m, n: 0 };
      s.n++;
      by.set(m.key, s);
    }
  }
  const order = ['agent', 'from', 'drawer', 'used', 'locked'];
  return [...by.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export function sourceLabel(m) {
  if (m.kind === 'agent') return `Agent · ${m.run.recipe || m.run.task.split('\n')[0].slice(0, 40)}`;
  if (m.kind === 'from') return `From ${nameOf(m.from)}`;
  if (m.kind === 'drawer') return `Drawer · ${nameOf(m.from)}`;
  if (m.kind === 'used') return `Gathered into ${nameOf(m.into)}`;
  return 'Locked';
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}
const btn = (text, run, primary = false) => {
  const b = el('button', `btn small${primary ? ' primary' : ''}`, text);
  b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  return b;
};
const SVG = 'http://www.w3.org/2000/svg';

// opts: { path, text, origin, render(markdown) → html, openRun(id),
// openAt(path, text), lock(quote) → Promise, unlock(quote) → Promise,
// close() }.
export function openOrigin(opts) {
  let blocks = originMarks(opts.text, opts.origin);
  let cur = Math.max(0, blocks.findIndex((b) => b.marks.length));
  let lit = null;

  const chips = el('div', 'origin-chips');
  const doc = el('div', 'origin-doc md');
  const side = el('div', 'origin-side');
  const threads = document.createElementNS(SVG, 'svg');
  threads.setAttribute('class', 'origin-threads');
  const page = el('div', 'origin-page', doc, side, threads);
  // The threads from a chip run over the head, so not in the page (which
  // scrolls, and would cut them).
  const leads = document.createElementNS(SVG, 'svg');
  leads.setAttribute('class', 'origin-threads origin-leads');
  const hint = el('div', 'origin-hint', 'j k a paragraph · J K one with an origin · Enter goes there · l locks / unlocks · Esc closes');
  const root = el('div', 'origin',
    el('div', 'origin-head', el('span', 'origin-badge', 'Origin · experimental'), el('span', 'origin-path', opts.path), chips),
    page, hint, leads);
  root.tabIndex = 0;

  function draw() {
    const sources = originSources(blocks);
    chips.replaceChildren(...(sources.length ? sources.map((s) => {
      const c = el('button', `origin-chip o-${s.kind}${lit === s.key ? ' on' : ''}`, sourceLabel(s.mark), el('span', 'origin-n', String(s.n)));
      c.dataset.key = s.key;
      c.addEventListener('mouseenter', () => light(s.key));
      c.addEventListener('mouseleave', () => light(null));
      c.addEventListener('click', () => { const k = blocks.findIndex((b, i) => i > cur && b.marks.some((m) => m.key === s.key)); go(k >= 0 ? k : blocks.findIndex((b) => b.marks.some((m) => m.key === s.key))); });
      return c;
    }) : [el('span', 'origin-none', 'Nothing here came from elsewhere, as far as Margin knows: it is all yours.')]));
    doc.replaceChildren(...blocks.map((b, i) => {
      const body = el('div', 'origin-body');
      body.innerHTML = opts.render(b.text);
      const bars = el('div', 'origin-bars', b.marks.map((m) => el('span', `origin-bar o-${m.kind}`)));
      const block = el('div', `origin-block${i === cur ? ' cur' : ''}${b.marks.length ? ' has' : ''}`, bars, body);
      block.dataset.i = i;
      block.addEventListener('click', () => go(i));
      return block;
    }));
    card();
    requestAnimationFrame(thread);
  }

  function card() {
    const b = blocks[cur];
    if (!b) { side.replaceChildren(); return; }
    const rows = b.marks.map((m) => {
      if (m.kind === 'agent') {
        return el('div', 'origin-card o-agent',
          el('div', 'origin-what', m.all ? 'Written by the agent' : 'Written by the agent, changed since'),
          el('div', 'origin-said', `“${m.run.task.split('\n')[0].slice(0, 160)}”`),
          m.run.round > 1 ? el('div', 'origin-when', `last asked: “${m.run.last.split('\n')[0].slice(0, 100)}” · round ${m.run.round}`) : null,
          el('div', 'origin-when', `${m.run.agent || 'Agent'} · applied ${day(m.run.at)}`),
          btn('Open the run', () => opts.openRun(m.run.id)));
      }
      if (m.kind === 'from') return el('div', 'origin-card o-from', el('div', 'origin-what', `Gathered from ${nameOf(m.from)}`), el('div', 'origin-when', m.from), btn('Open it there', () => opts.openAt(m.from, b.text)));
      if (m.kind === 'drawer') return el('div', 'origin-card o-drawer', el('div', 'origin-what', `From the drawer, set aside from ${nameOf(m.from)}`), el('div', 'origin-when', m.from), btn('Open it there', () => opts.openAt(m.from, b.text)));
      if (m.kind === 'used') return el('div', 'origin-card o-used', el('div', 'origin-what', `Gathered into ${nameOf(m.into)}`), el('div', 'origin-when', `${m.into} · ${day(m.at)}`), btn('Open it there', () => opts.openAt(m.into, b.text)));
      return el('div', 'origin-card o-locked', el('div', 'origin-what', 'Locked'), el('div', 'origin-when', 'An agent’s change to it is never applied.'), btn('Unlock', () => toggleLock()));
    });
    if (!b.marks.some((m) => m.kind !== 'locked')) rows.unshift(el('div', 'origin-card o-yours', el('div', 'origin-what', 'Yours'), el('div', 'origin-when', 'Written here, as far as Margin knows.')));
    if (!b.marks.some((m) => m.kind === 'locked')) rows.push(btn('Lock it', () => toggleLock()));
    side.replaceChildren(...rows);
  }

  // Threads: from the paragraph in view to its card, and from a chip
  // pointed at to each paragraph of its.
  function thread() {
    if (!root.isConnected) return;
    const box = page.getBoundingClientRect();
    threads.setAttribute('width', String(page.scrollWidth));
    threads.setAttribute('height', String(Math.max(page.scrollHeight, box.height)));
    const paths = [];
    const curve = (x1, y1, x2, y2, cls) => {
      const p = document.createElementNS(SVG, 'path');
      const mx = (x1 + x2) / 2;
      p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      p.setAttribute('class', `origin-thread ${cls}`);
      paths.push(p);
    };
    const at = (r) => ({ x: r.left - box.left + page.scrollLeft, y: r.top - box.top + page.scrollTop });
    const block = doc.children[cur];
    const first = side.firstElementChild;
    if (block && first && blocks[cur].marks.length) {
      const b = at(block.getBoundingClientRect());
      const c = at(first.getBoundingClientRect());
      const kind = blocks[cur].marks[0].kind;
      curve(b.x + block.offsetWidth + 4, b.y + Math.min(block.offsetHeight / 2, 40), c.x - 4, c.y + 18, `o-${kind}`);
    }
    threads.replaceChildren(...paths);
    const all = root.getBoundingClientRect();
    leads.setAttribute('width', String(all.width));
    leads.setAttribute('height', String(all.height));
    const lead = [];
    const chip = lit && chips.querySelector(`[data-key="${CSS.escape(lit)}"]`);
    if (chip) {
      const r = chip.getBoundingClientRect();
      const x1 = r.left + r.width / 2 - all.left;
      const y1 = r.bottom - all.top;
      blocks.forEach((b, i) => {
        const m = b.marks.find((x) => x.key === lit);
        const e = doc.children[i];
        if (!m || !e) return;
        const q = e.getBoundingClientRect();
        const y = q.top + Math.min(q.height / 2, 14);
        if (y < box.top || y > box.bottom) return;
        const x2 = q.left - all.left - 2;
        const y2 = y - all.top;
        const p = document.createElementNS(SVG, 'path');
        p.setAttribute('d', `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2 - 40},${y2} ${x2},${y2}`);
        p.setAttribute('class', `origin-thread o-${m.kind} lit`);
        lead.push(p);
      });
    }
    leads.replaceChildren(...lead);
  }

  function light(key) {
    lit = key;
    root.classList.toggle('lighting', !!key);
    [...doc.children].forEach((e, i) => e.classList.toggle('lit', !!key && blocks[i].marks.some((m) => m.key === key)));
    for (const c of chips.children) c.classList.toggle('on', c.dataset?.key === key);
    thread();
  }

  function go(i) {
    if (i < 0 || i >= blocks.length) return;
    cur = i;
    [...doc.children].forEach((e, k) => e.classList.toggle('cur', k === i));
    card();
    const e = doc.children[i];
    if (e) {
      const top = e.offsetTop;
      if (top < page.scrollTop + 40 || top + Math.min(e.offsetHeight, 120) > page.scrollTop + page.clientHeight - 40) page.scrollTo({ top: Math.max(0, top - page.clientHeight / 3), behavior: 'smooth' });
    }
    requestAnimationFrame(thread);
  }
  const step = (by, marked) => {
    for (let i = cur + by; i >= 0 && i < blocks.length; i += by) if (!marked || blocks[i].marks.length) { go(i); return; }
  };

  async function toggleLock() {
    const b = blocks[cur];
    const m = b?.marks.find((x) => x.kind === 'locked');
    if (m) await opts.unlock(m.quote);
    else if (b) await opts.lock(b.text);
    else return;
    const locks = m ? opts.origin.locks.filter((q) => q !== m.quote) : [...opts.origin.locks, b.text];
    opts.origin = { ...opts.origin, locks };
    blocks = originMarks(opts.text, opts.origin);
    draw();
    root.focus({ preventScroll: true });
  }
  function act() {
    const m = blocks[cur]?.marks.find((x) => x.kind !== 'locked');
    if (!m) return;
    if (m.kind === 'agent') opts.openRun(m.run.id);
    else opts.openAt(m.kind === 'used' ? m.into : m.from, blocks[cur].text);
  }
  function close() { if (!root.isConnected) return; ro.disconnect(); root.remove(); opts.close(); }

  root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const keys = {
      j: () => step(1), ArrowDown: () => step(1), k: () => step(-1), ArrowUp: () => step(-1),
      J: () => step(1, true), K: () => step(-1, true), Enter: act, l: toggleLock, Escape: close, q: close,
    }[e.key];
    e.stopPropagation();
    if (!keys) return;
    e.preventDefault();
    keys();
  });
  page.addEventListener('scroll', () => requestAnimationFrame(thread));
  const ro = new ResizeObserver(() => thread());
  ro.observe(page);
  root.closeOrigin = close;
  document.body.append(root);
  draw();
  if (blocks[cur]) requestAnimationFrame(() => go(cur));
  root.focus({ preventScroll: true });
  return root;
}

// The drawer of a note: scraps set aside for it, beside the editor.
// opts: { path, scraps (kept by the caller), render(markdown) → html,
// save() (after a change to scraps), insert(text), openAt(path, text),
// selection() → { text, from, line } | null, close() }.
export function drawerPane(opts) {
  const list = el('div', 'drawer-list');
  const count = el('span', 'drawer-count');
  const add = btn('+ Selection', () => {
    const s = opts.selection();
    if (!s) { flash('Select some words in the note first'); return; }
    keep(s);
  });
  add.title = 'Set the selected words aside here (or drag them in)';
  const shut = el('button', 'icon-btn', '×');
  shut.title = 'Close the drawer';
  shut.addEventListener('click', () => opts.close());
  const tip = el('div', 'drawer-tip');
  const pane = el('aside', 'drawer', el('div', 'drawer-head', el('span', 'drawer-badge', 'Drawer'), count, el('span', 'grow'), add, shut), list, tip);

  let tipTimer = null;
  function flash(text) {
    tip.textContent = text;
    tip.classList.add('on');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('on'), 1800);
  }
  function keep(s) {
    opts.scraps.push({ text: s.text, from: s.from || undefined, line: Number.isInteger(s.line) ? s.line : undefined, at: new Date().toISOString().slice(0, 16) });
    opts.save();
    draw(opts.scraps.length - 1);
  }
  function draw(fresh = -1) {
    count.textContent = opts.scraps.length ? String(opts.scraps.length) : '';
    list.replaceChildren(...(opts.scraps.length ? opts.scraps.map((s, k) => {
      const body = el('div', 'drawer-body md');
      body.innerHTML = opts.render(s.text);
      const from = s.from && s.from !== opts.path ? el('button', 'drawer-from', `from ${nameOf(s.from)}`) : null;
      from?.addEventListener('click', () => opts.openAt(s.from, s.text));
      if (from) from.title = `Open ${s.from} there`;
      const put = btn('Insert', () => opts.insert(s.text));
      put.title = 'Put it in the note after the line the cursor is on (or drag it there)';
      const out = el('button', 'icon-btn drawer-out', '×');
      out.title = 'Take it out of the drawer';
      out.addEventListener('click', () => { opts.scraps.splice(k, 1); opts.save(); draw(); });
      const card = el('div', `drawer-scrap${k === fresh ? ' fresh' : ''}`, el('div', 'drawer-scrap-head', from, el('span', 'grow'), put, out), body);
      card.draggable = true;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', s.text);
        e.dataTransfer.effectAllowed = 'copy';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      return card;
    }) : [el('div', 'drawer-empty', 'Drag words from the note here (or + Selection), a tab, or text from elsewhere: kept for this note, not in it. Drag a scrap into the note to use it.')]));
    if (fresh >= 0) list.children[fresh]?.scrollIntoView({ block: 'nearest' });
  }
  pane.addEventListener('dragover', (e) => {
    const types = [...e.dataTransfer.types];
    if (!types.includes('text/plain') && !types.includes('text/uri-list') && !types.includes('text/x-agent-notes-tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    pane.classList.add('over');
  });
  pane.addEventListener('dragleave', (e) => { if (!pane.contains(e.relatedTarget)) pane.classList.remove('over'); });
  pane.addEventListener('drop', (e) => {
    pane.classList.remove('over');
    if ([...pane.querySelectorAll('.drawer-scrap.dragging')].length) return; // its own scrap
    e.preventDefault();
    e.stopPropagation();
    const tabPath = opts.tabPath?.(e.dataTransfer.getData('text/x-agent-notes-tab'));
    if (tabPath) { keep({ text: `[[${nameOf(tabPath)}]]` }); return; }
    let from = null;
    try { from = JSON.parse(e.dataTransfer.getData('text/x-margin-from') || 'null'); } catch { /* elsewhere */ }
    const uri = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'));
    const text = e.dataTransfer.getData('text/plain') || uri || '';
    if (!text.trim()) return;
    keep({ text: uri && text.trim() === uri.trim() ? `<${uri.trim()}>` : text, from: from?.path, line: from?.line });
  });
  draw();
  pane.drawerRedraw = draw;
  return pane;
}
