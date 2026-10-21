// Red pen: an agent's proposal drawn on the note itself, as an editor marks
// a proof — what goes struck through, what comes in written above a caret,
// the reasons in the margin with a line to their place. Only a way to look
// at the changes: each mark is one of the run's hunks, picked or not as in
// the diff, and applied the same way.
//
// penSource() writes the marks into the note's Markdown as private-use
// characters, so the note renders as it always does; decorate() turns them
// into elements afterwards. A start character and an id character open a
// mark, END closes it; marks never cross a line.

import { wordOps } from './track.js';

const DEL = '\uE000';
const END = '\uE001';
const INS = '\uE002';
const INSL = '\uE005';
const ANC = '\uE006';
const KINDS = { [DEL]: 'pen-del', [INS]: 'pen-ins', [INSL]: 'pen-insl', [ANC]: 'pen-anchor' };
const HUNK_ID = 0xE100;
const NOTE_ID = 0xE900;
const MARKS = /[\uE000-\uE00F\uE100-\uEFFF]/g;
const HAS_MARK = /[\uE000-\uE00F\uE100-\uEFFF]/;
const STARTS = /[\uE000-\uE00F]/;

const idChar = (key) => String.fromCharCode(key[0] === 'h' ? HUNK_ID + Number(key.slice(1)) : NOTE_ID + Number(key.slice(1)));
const keyOf = (ch) => { const n = ch.charCodeAt(0); return n >= NOTE_ID ? `n${n - NOTE_ID}` : `h${n - HUNK_ID}`; };

// What starts a line and has to stay first for Markdown to see it: list
// bullets, checkboxes, heading hashes, quote marks, a table's first pipe.
const PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s?|\|\s*)*/;
// Lines a mark would break: blank, fences, rules and table/heading underlines.
const structural = (l) => !l.trim() || /^\s*(```|~~~)/.test(l) || /^\s*[-*_=|:\s]+$/.test(l);
const split = (l) => { const p = PREFIX.exec(l)[0]; return [p, l.slice(p.length)]; };
export { wordOps };

// The note with the marks of `hunks` (the run's, against `base`) and of
// `comments` (the agent's margin notes on this note: { quote, comment,
// suggest, made, n } — n their number in the run).
// A hunk with `picture` (a number, public/penpic.js) is drawn on its picture:
// only its mark is made, no lines.
// → { text, marks: [{ key, kind: 'hunk' | 'note', i?, line, notes: [comment], picture? }], general: [comment],
// rows: [{ line, i }] } — marks in the order of the note; rows: for each line
// of text, the line of base it comes from (and its hunk, or -1).
export function penSource(base, hunks = [], comments = []) {
  const lines = base.split('\n');
  const starts = [];
  let at = 0;
  for (const l of lines) { starts.push(at); at += l.length + 1; }
  const lineAt = (pos) => { let lo = 0; let hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const hunkAt = (ln) => hunks.findIndex((hk) => ln >= hk.baseStart && ln < Math.max(hk.baseEnd, hk.baseStart + 1));

  // Each comment goes with the change it explains, or on the words it is about.
  const byHunk = new Map();
  const anchors = new Map();
  const notes = [];
  const general = [];
  for (const c of comments) {
    const pos = c.quote ? base.indexOf(c.quote) : -1;
    if (pos < 0) {
      const i = c.suggest ? hunks.findIndex((hk) => hk.added.join('\n').includes(c.suggest)) : -1;
      if (i >= 0) { if (!byHunk.has(i)) byHunk.set(i, []); byHunk.get(i).push(c); } else general.push(c);
      continue;
    }
    const ln = lineAt(pos);
    const i = hunkAt(ln);
    if (i >= 0) { if (!byHunk.has(i)) byHunk.set(i, []); byHunk.get(i).push(c); continue; }
    const line = lines[ln];
    let from = Math.max(pos - starts[ln], split(line)[0].length);
    let to = Math.min(pos - starts[ln] + c.quote.length, line.length);
    const list = anchors.get(ln) || [];
    if (structural(line) || to <= from) { general.push(c); continue; }
    // Words another note is on already: this one takes the rest of its
    // quote, or joins that note when nothing is left.
    let joined = null;
    for (const x of list.sort((p, q) => p.from - q.from)) {
      if (to <= x.from || x.to <= from) continue;
      if (from >= x.from && to <= x.to) { joined = x; break; }
      if (from < x.from) to = x.from; else from = x.to;
      if (to <= from || !/[\p{L}\p{N}]/u.test(line.slice(from, to))) { joined = x; break; }
    }
    if (joined) { joined.mark.notes.push(c); continue; }
    const mark = { key: `n${c.n}`, kind: 'note', line: ln, notes: [c] };
    mark.at = from;
    list.push({ from, to, key: mark.key, mark });
    anchors.set(ln, list);
    notes.push(mark);
  }

  const marks = [...notes];
  const out = [];
  const rows = [];
  const push = (s, line, i = -1) => { if (s != null) { out.push(s); rows.push({ line, i }); } };
  let pos = 0;
  const plain = (ln) => {
    const list = anchors.get(ln);
    if (!list) return lines[ln];
    let l = lines[ln];
    for (const a of [...list].sort((x, y) => y.from - x.from)) l = l.slice(0, a.from) + ANC + idChar(a.key) + l.slice(a.from, a.to) + END + l.slice(a.to);
    return l;
  };
  hunks.forEach((hk, i) => {
    for (; pos < hk.baseStart; pos++) push(plain(pos), pos);
    const key = `h${i}`;
    // A change drawn on its picture (public/penpic.js): only its mark here.
    if (hk.picture != null) { marks.push({ key, kind: 'hunk', i, line: hk.baseStart, notes: byHunk.get(i) || [], picture: hk.picture }); return; }
    pos = hk.baseEnd;
    const id = idChar(key);
    let seen = false;
    const wrap = (kind, s) => { if (s.trim()) seen = true; return s ? kind + id + s + END : ''; };
    const del = (l) => { if (structural(l)) return l.trim() ? null : l; const [p, rest] = split(l); return p + wrap(DEL, rest); };
    const ins = (l) => { if (structural(l)) return l; const [p, rest] = split(l); return p + wrap(INSL, rest); };
    const R = hk.removed;
    const A = hk.added;
    const pair = R.length === A.length && R.length <= 20;
    const made = [];
    const at = (k) => hk.baseStart + Math.max(0, Math.min(k, hk.baseEnd - hk.baseStart - 1));
    if (pair) {
      R.forEach((r, k) => {
        const a = A[k];
        const [pr, rr] = split(r);
        const [pa, ra] = split(a);
        if (structural(r) || structural(a) || pr !== pa) { made.push([del(r), at(k)], [ins(a), at(k)]); return; }
        made.push([pa + wordOps(rr, ra).map(([op, s]) => (op === '=' ? s : wrap(op === '-' ? DEL : INS, s))).join(''), at(k)]);
      });
    } else made.push(...R.map((r, k) => [del(r), at(k)]), ...A.map((a, k) => [ins(a), at(k)]));
    // Only spaces or empty lines changed: a pilcrow to show where.
    if (!seen) made.push([(A.join('\n').length >= R.join('\n').length ? INSL : DEL) + id + '¶' + END, at(0)]);
    for (const [s, line] of made) push(s, line, i);
    marks.push({ key, kind: 'hunk', i, line: hk.baseStart, notes: byHunk.get(i) || [] });
  });
  for (; pos < lines.length; pos++) push(plain(pos), pos);
  marks.sort((a, b) => a.line - b.line || (a.at ?? -1) - (b.at ?? -1));
  return { text: out.join('\n'), marks, general, rows };
}

// The rendered note: the marks as elements (span.pen-del / pen-ins /
// pen-insl / pen-anchor, data-mark = their key), none left in attributes.
export function decorate(root) {
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (HAS_MARK.test(a.value)) el.setAttribute(a.name, a.value.replace(MARKS, ''));
  }
  const doc = root.ownerDocument;
  const walk = doc.createTreeWalker(root, 4);
  const nodes = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (STARTS.test(n.data) || nodes.length) nodes.push(n);
  let open = null;
  for (const node of nodes) {
    const s = node.data;
    if (!open && !STARTS.test(s)) continue;
    const parts = [];
    let buf = '';
    const flush = () => {
      if (!buf) return;
      if (open) {
        const span = doc.createElement('span');
        span.className = open.cls;
        span.dataset.mark = open.key;
        span.textContent = buf;
        parts.push(span);
      } else parts.push(doc.createTextNode(buf));
      buf = '';
    };
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (KINDS[ch]) { flush(); open = { cls: KINDS[ch], key: keyOf(s[k + 1] || '\uE100') }; k++; }
      else if (ch === END) { flush(); open = null; }
      else buf += ch;
    }
    flush();
    node.replaceWith(...parts);
  }
  return root;
}

// The margin notes beside their marks: each at the height of its first
// mark, none over another, with a line from the mark to it. page holds
// .pen-doc, .pen-margin (the .pen-card[data-mark] in order, and the cards
// of other layers, .layer-card[data-mark], among them) and svg.pen-lines.
export function layoutMargin(page) {
  const doc = page.querySelector('.pen-doc');
  const margin = page.querySelector('.pen-margin');
  const svg = page.querySelector('svg.pen-lines');
  if (!doc || !margin || !svg || !page.isConnected) return;
  const box = page.getBoundingClientRect();
  if (!box.width) return;
  const ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  svg.setAttribute('width', box.width);
  svg.setAttribute('height', page.scrollHeight);
  const mx = margin.getBoundingClientRect().left - box.left;
  // Lines start past the end of the text, so they never read as a strike.
  const dx = doc.getBoundingClientRect().right - box.left + 6;
  // A card pushed this far below its mark (by the cards above) begins with
  // the words it is about; a press brings the two into view (revealMark).
  const far = Math.max(120, (scrollerOf(page)?.clientHeight || 600) / 3);
  // Each card as near its mark as the ones above it let it be; the one
  // brought to its mark (page._focus, revealMark) at it, the ones above
  // it stacked up from there.
  const list = [...margin.querySelectorAll('.pen-card, .layer-card')].filter((c) => !c.hidden).map((card) => {
    const mark = doc.querySelector(`[data-mark="${card.dataset.mark}"]`);
    return { card, mark, r: (mark?.getClientRects()[0]) || mark?.getBoundingClientRect() };
  });
  let next = 0;
  for (const it of list) {
    const want = it.r ? it.r.top - box.top - 6 : next;
    it.top = Math.max(want, next);
    quote(page, it.card, it.mark, !!it.r && it.top - want > far);
    it.want = want;
    it.h = it.card.offsetHeight;
    next = it.top + it.h + 8;
  }
  const f = page._focus == null ? -1 : list.findIndex((it) => it.card.dataset.mark === page._focus && it.r);
  // (Those may go up past the page's top, as the editor's margin lifts.)
  if (f >= 0) {
    list[f].top = list[f].want;
    for (let k = f - 1; k >= 0; k--) list[k].top = Math.min(list[k].want, list[k + 1].top - list[k].h - 8);
    for (let k = f + 1; k < list.length; k++) list[k].top = Math.max(list[k].want, list[k - 1].top + list[k - 1].h + 8);
    next = list.length ? list.at(-1).top + list.at(-1).h + 8 : 0;
  }
  for (const { card, r, top } of list) {
    card.style.top = `${top}px`;
    if (!r || !card.classList.contains('noted')) continue;
    const x1 = Math.min(dx, mx - 8);
    const y1 = r.top - box.top + r.height * 0.5;
    const y2 = top + 11;
    const line = doc.ownerDocument.createElementNS(ns, 'path');
    line.setAttribute('d', `M${x1},${y1} C${(x1 + mx) / 2},${y1} ${(x1 + mx) / 2},${y2} ${mx - 2},${y2}`);
    const dot = doc.ownerDocument.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x1);
    dot.setAttribute('cy', y1);
    dot.setAttribute('r', 2);
    // Each line knows its mark: the one in view, or pointed at, stands out.
    for (const el of [line, dot]) {
      el.dataset.mark = card.dataset.mark;
      if (card.classList.contains('kb-cur')) el.classList.add('pen-on');
      if (card.classList.contains('pen-pair')) el.classList.add('pen-pair');
    }
    svg.append(line, dot);
  }
  margin.style.minHeight = `${next}px`;
  markEdge(page);
}

// The box that scrolls the page: the review, or the note's pane.
function scrollerOf(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

// The words a card is about, at its top (on), or not.
function quote(page, card, mark, on) {
  let q = card.querySelector(':scope > .pen-src');
  if (!on) { q?.remove(); return; }
  // A note's own words; a change, the paragraph or line it is in.
  const key = card.dataset.mark;
  const words = mark.classList.contains('pen-anchor')
    ? [...page.querySelectorAll(`.pen-doc [data-mark="${key}"]`)].map((x) => x.textContent).join(' ')
    : (mark.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre') || mark).textContent;
  const text = words.replace(/\s+/g, ' ').trim() || '\u2026';
  if (!q) {
    q = page.ownerDocument.createElement('button');
    q.className = 'pen-src';
    q.title = 'Show the words it is about, with this card';
    q.addEventListener('click', (e) => { e.stopPropagation(); revealMark(page, key); });
    card.prepend(q);
  }
  if (q.dataset.src !== text) { q.dataset.src = text; q.textContent = `\u2191 ${text}`; }
}

// A mark and its card in view together, lit for a moment: a card too far
// below its mark for both to be seen is laid at it (layoutMargin).
export function revealMark(page, key) {
  const view = scrollerOf(page);
  const marks = [...page.querySelectorAll(`.pen-doc [data-mark="${key}"]`)];
  const card = page.querySelector(`.pen-margin [data-mark="${key}"]`);
  if (!view || !marks.length || !card) return;
  const gap = card.getBoundingClientRect().bottom - marks[0].getBoundingClientRect().top;
  if (page._focus !== key && gap + 48 > view.clientHeight) { page._focus = key; layoutMargin(page); }
  const vb = view.getBoundingClientRect();
  const mr = marks[0].getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const top = Math.min(mr.top, cr.top);
  const span = Math.max(mr.bottom, cr.bottom) - top;
  const ch = view.clientHeight;
  view.scrollTop += span + 48 <= ch ? top - vb.top - (ch - span) / 2 : mr.top - vb.top - 24;
  const lit = [...marks, card];
  for (const el of lit) { el.classList.remove('pen-found'); void el.offsetWidth; el.classList.add('pen-found'); }
  clearTimeout(page._foundTimer);
  page._foundTimer = setTimeout(() => { for (const el of lit) el.classList.remove('pen-found'); }, 1800);
}

// The card pointed at (or in view, kb-cur) whose mark is out of view: a
// mark at that edge, ↑ or ↓, that brings them together.
export function markEdge(page) {
  if (!page?.isConnected) return;
  const card = page.querySelector('.pen-margin .pen-pair[data-mark]') || page.querySelector('.pen-margin .kb-cur[data-mark]');
  const mark = card && page.querySelector(`.pen-doc [data-mark="${card.dataset.mark}"]`);
  const view = mark && scrollerOf(page);
  let e = page.querySelector(':scope > .pen-edge');
  let side = null;
  if (view) {
    const vb = view.getBoundingClientRect();
    const mr = mark.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    if (mr.bottom <= vb.top + 4 && cr.bottom > vb.top) side = 'up';
    else if (mr.top >= vb.bottom - 4 && cr.top < vb.bottom) side = 'down';
    else if (cr.top >= vb.bottom - 4 && mr.bottom > vb.top && mr.top < vb.bottom) side = 'down';
  }
  if (!side) { if (e) e.hidden = true; return; }
  if (!e) {
    e = page.ownerDocument.createElement('button');
    e.className = 'pen-edge';
    e.addEventListener('click', () => revealMark(page, e.dataset.mark));
    page.append(e);
  }
  const vb = view.getBoundingClientRect();
  const box = page.getBoundingClientRect();
  e.hidden = false;
  e.dataset.mark = card.dataset.mark;
  e.textContent = side === 'up' ? '\u2191' : '\u2193';
  e.title = side === 'up' ? 'The words it is about are above: show them' : 'Out of view below: show the words and the card together';
  e.style.left = `${page.querySelector('.pen-margin').offsetLeft - 24}px`;
  e.style.top = `${(side === 'up' ? Math.max(vb.top, box.top) - box.top + 6 : Math.min(vb.bottom, box.bottom) - box.top - 26)}px`;
}

// The marks at the edge follow every scroll (the review, the note's pane).
let edgeFrame = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('scroll', (ev) => {
    if (edgeFrame || !ev.target?.querySelectorAll) return;
    const t = ev.target;
    edgeFrame = requestAnimationFrame(() => { edgeFrame = 0; for (const b of t.querySelectorAll('.pen-body')) markEdge(b); });
  }, { capture: true, passive: true });
}

// Laid out again when the page or the note in it changes size (fonts and
// images arriving, the pane resized).
export function watchMargin(page) {
  const ro = new ResizeObserver(() => layoutMargin(page));
  ro.observe(page);
  ro.observe(page.querySelector('.pen-doc'));
  return ro;
}
