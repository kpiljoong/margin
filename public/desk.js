// The desk (experimental): notes and cards laid out on a plane, to think
// with — moved, stacked into groups, linked, and given to the margin (a fast
// model, server.js → lib/desk.js) to sum up, question, sort, link or merge,
// or to talk about. Its file is a JSON Canvas (.canvas, as Obsidian writes
// them), so the same desk opens there. The text is always flat and facing
// you; the depth is for what is lifted, stacked or being thought about.
// What the margin writes stays beside the cards until it is kept (Tab).

import { meetingItems, moveItem, bodyOf } from './meeting.js';
import { IMAGE_FILE, rectFrom, regionsOf, threadOf, regionNote, cropParts } from './regions.js';
import { trailOf, trailText } from './trail.js';

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
const NOTE = /\.(md|markdown|txt)$/i;
const IMAGE = IMAGE_FILE;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// A picture's card: 400 wide at most, and as tall as the picture is then (and its title).
export function pictureSize(w, h) {
  if (!(w > 0 && h > 0)) return { width: 400, height: 300 };
  const width = Math.round(Math.min(400, Math.max(160, w)));
  return { width, height: Math.round(Math.min(720, Math.max(100, (width - 24) * h / w + 52))) };
}
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

// ---------------------------------------------------------------- a note on a desk

// A note laid out to think about (a meeting's, mostly): the note in the
// middle; its open questions and its to-dos not done as cards beside it, each
// knowing where it came from (from: the note, the line, what it was, when it
// was taken) so it can go back there, and say when the note has moved on;
// and the notes it links to. links: their paths, found already. → a desk.
export function noteDesk(file, text, links = [], at = '') {
  const items = meetingItems(text);
  const size = (s) => {
    // Its height, from its words: wide letters (Korean, Chinese, Japanese) take two.
    const w = [...s].reduce((sum, c) => sum + (c.codePointAt(0) > 0x2e80 ? 2 : 1), 0);
    return 74 + 21 * Math.max(1, Math.ceil(w / 40));
  };
  const card = (i) => ({ id: newId(), type: 'text', text: i.text, x: 0, y: 0, width: 320, height: size(i.text), from: { file, line: i.line, kind: i.kind, key: i.key, at } });
  const groups = [
    { name: 'Open questions', cards: items.filter((i) => i.kind === 'question').map(card) },
    { name: 'To do', cards: items.filter((i) => i.kind === 'todo' && !i.done).map(card) },
    { name: 'Linked notes', cards: links.map((p) => ({ id: newId(), type: 'file', file: p, x: 0, y: 0, width: 340, height: 260 })) },
  ].filter((g) => g.cards.length);
  const nodes = [];
  const cards = [];
  for (const g of groupLayout(groups, 540, 0)) {
    nodes.push({ id: newId(), type: 'group', label: g.name, ...g.box });
    const these = groups.find((x) => x.name === g.name).cards;
    for (const p of g.at) { const c = these.find((x) => x.id === p.id); cards.push({ ...c, x: p.x, y: p.y }); }
  }
  return { nodes: [...nodes, { id: newId(), type: 'file', file, x: 0, y: 0, width: 480, height: 680 }, ...cards], edges: [] };
}

// A topic laid out for a review (Labs; server.js /api/lab/review/desk): its
// goal (and the question that would settle it) and "This time" — theirs to
// write: the goal in their words, what to settle now; the next review of it
// reads them (thisTimeOf) and puts what they chose first — the to-dos whose
// state a note puts in doubt, or whose day has passed — each a card that
// knows its line, so x marks it done there (with the day, as the
// assistant's list writes them), proposed in the red pen review — and its
// notes. What the margin says of it goes beside them, in the margin (not
// kept until kept: Tab), most important first. → { desk, margin: [card] }.
const GOAL_STATE = { stated: 'in a note', theirs: 'yours', guessed: 'a guess', unknown: 'not known' };
const THIS_TIME = '**This time**';
const STREAM_W = 380; // a review's column of what was jotted
const STREAM_IN = 24;
const THIS_TIME_SAYS = 'where this review stands \u00B7 yours to edit; what you jot and take comes here, and the next review starts from it';
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
// Its parts, headed "**Decided**" (or, as first written, "Decided:").
const HEADS = /^\s*(?:\*\*)?(To settle now|Decided|Later)(?:\*\*)?:?\s*$/i;
const headOf = (label) => (l) => (HEADS.exec(l) || [])[1]?.toLowerCase() === label.toLowerCase();
export function thisTimeText({ goal = '', focus = [], decided = [], later = [] } = {}) {
  const list = (xs) => (xs.length ? xs.map((f) => `- ${f}`) : ['- ']);
  return [`${THIS_TIME} \u2014 ${THIS_TIME_SAYS}`, '', `Goal: ${goal}`, '', '**To settle now**', ...list(focus), '', '**Decided**', ...list(decided), '', '**Later**', ...list(later)].join('\n');
}
// "This time" as they wrote it on a desk: { goal, focus: [at most three],
// decided: [what they wrote as decided], later: [what they put off] } (a
// decision's note, when it says: " → [[note]]" at its end).
export function thisTimeOf(desk) {
  const n = (desk?.nodes || []).find((x) => x.type === 'text' && String(x.text || '').startsWith(THIS_TIME));
  if (!n) return { goal: '', focus: [], decided: [], later: [] };
  const lines = n.text.split('\n');
  const goal = (/^\s*Goal:\s*(.*)$/i.exec(lines.find((l) => /^\s*Goal:/i.test(l)) || '') || [])[1]?.trim() || '';
  const under = (head) => {
    const at = lines.findIndex(head);
    if (at < 0) return [];
    const out = [];
    for (const l of lines.slice(at + 1)) {
      if (HEADS.test(l)) break;
      const w = l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
      if (w.length > 1) out.push(w.slice(0, 300));
    }
    return out;
  };
  return { goal: goal.slice(0, 300), focus: under(headOf('To settle now')).slice(0, 3), decided: under(headOf('Decided')).slice(0, 12), later: under(headOf('Later')).slice(0, 12) };
}
// A decision as written under Decided → { words, note } (note: the path of
// the note it goes in, from " → [[note]]", or '').
export function decisionOf(line) {
  const m = /^(.*?)\s*\u2192\s*\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]\s*$/.exec(String(line));
  return m ? { words: m[1].trim(), note: /\.md$/i.test(m[2]) ? m[2].trim() : `${m[2].trim()}.md` } : { words: String(line).trim(), note: '' };
}
// "This time" with one thing jotted put in it (kind: 'decided', 'later' or
// 'open' — to settle), in their words (and a decision's note: " → [[note]]");
// what it settles (settles: those words, under "To settle now") taken out
// of them — as they would have written it.
const SECTION = { decided: 'Decided', later: 'Later', open: 'To settle now' };
export function addToThisTime(text, { kind, words, note = '', settles = '' }) {
  // As written now: what it is for said, its parts headed in bold, a line between them.
  let lines = [];
  for (const l of String(text || thisTimeText()).split('\n')) {
    const h = HEADS.exec(l);
    if (!h && /^\s*Goal:/i.test(l)) { lines.push(l, ''); continue; }
    if (!h) { if (l.trim() || lines.at(-1)?.trim()) lines.push(l); continue; }
    if (lines.at(-1)?.trim()) lines.push('');
    lines.push(`**${Object.values(SECTION).find((x) => x.toLowerCase() === h[1].toLowerCase())}**`);
  }
  if (lines[0].startsWith(THIS_TIME)) lines[0] = `${THIS_TIME} \u2014 ${THIS_TIME_SAYS}`;
  const item = (l) => { const w = l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim(); return w.length > 1; };
  const range = (head) => {
    const at = lines.findIndex(headOf(head));
    if (at < 0) return null;
    let end = at + 1;
    while (end < lines.length && !HEADS.test(lines[end])) end++;
    return [at, end];
  };
  const r = settles && range(SECTION.open);
  if (r) {
    const at = lines.slice(r[0] + 1, r[1]).findIndex((l) => item(l) && norm(l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')) === norm(settles));
    if (at >= 0) lines.splice(r[0] + 1 + at, 1);
  }
  const head = SECTION[kind] || SECTION.open;
  if (!range(head)) { while (lines.length && !lines.at(-1).trim()) lines.pop(); lines.push('', `**${head}**`); }
  const [at, end] = range(head);
  const line = `- ${String(words).trim()}${note ? ` \u2192 [[${note.replace(/\.md$/i, '')}]]` : ''}`;
  const blank = lines.slice(at + 1, end).findIndex((l) => /^\s*[-*]?\s*$/.test(l) && l.trim());
  if (blank >= 0) lines[at + 1 + blank] = line;
  else {
    let last = end;
    while (last > at + 1 && !lines[last - 1].trim()) last--;
    lines.splice(last, 0, line);
  }
  return lines.join('\n');
}

// The end of a review (w): what came of it, from the desk as it is now, the
// notes as they are now and what was done on it (ledger: [{ type, title,
// text, file, card, at }]) — never from what was only suggested or proposed:
// a to-do is changed in its note when it is done there now, a question when
// it is a decision there now; one no longer found as it was is said so, to be
// looked at — not taken as done. The next to-dos: those of the cards taken
// that are on the desk now, as they read now (one taken back, or deleted,
// is not). → { text, todos: [line] (as the assistant's list writes them),
// decisions: [{ words, note, inNote }] }.
export function wrapUp({ desk, ledger = [], notes = new Map(), now = '' }) {
  const mine = thisTimeOf(desk);
  const goalCard = (desk?.nodes || []).find((x) => x.type === 'text' && /^\*\*[^*]+\*\*\n\nGoal \(/.test(String(x.text || '')));
  const g = /\nGoal \(([^)]*)\): ([^\n]*)/.exec(goalCard?.text || '');
  const goal = mine.goal ? `${mine.goal} (yours)` : g ? `${g[2]} (${g[1]})` : '';
  const name = (f) => `[[${String(f).replace(/\.md$/i, '')}]]`;
  const changed = [];
  const waiting = [];
  const unsure = [];
  for (const n of (desk?.nodes || []).filter((x) => x.from?.kind === 'todo' || x.from?.kind === 'question')) {
    const text = notes.get(n.from.file);
    const what = `- ${String(n.text || '').split('\n')[0]} \u2014 ${name(n.from.file)}`;
    const acted = n.from.sent || n.from.to;
    if (typeof text !== 'string' || !text) { if (acted) unsure.push(`${what} (its note could not be read)`); continue; }
    const items = meetingItems(text);
    const it = items.find((i) => i.key === n.from.key);
    const done = n.from.kind === 'todo' ? !!it?.done : items.some((i) => i.key === n.from.key.replace(/^question:/, 'decision:'));
    if (done) changed.push(what);
    else if (!it) { if (acted) unsure.push(`${what} (not found in its note as it was: look at it)`); } else if (n.from.sent) waiting.push(`${what} (proposed, in the red pen review)`);
    else if (n.from.to) waiting.push(`${what} (marked here, not proposed yet)`);
  }
  const onDesk = new Map((desk?.nodes || []).map((n) => [n.id, n]));
  const taken = ledger.filter((e) => e.type === 'taken');
  const kept = taken.filter((e) => e.card && onDesk.has(e.card)).map((e) => ({ ...e, text: String(onDesk.get(e.card).text || '') }));
  const let_ = ledger.filter((e) => e.type === 'let go');
  const todos = [...new Set(kept.flatMap((e) => [...e.text.matchAll(/To-do: `(- \[ \] [^`]+)`/g)].map((m) => m[1])))];
  const open = mine.focus.filter((f) => ![...mine.decided, ...mine.later].some((d) => d.toLowerCase().includes(f.toLowerCase().slice(0, 12))));
  // A decision with its note: in it now (a line of those words marked #decision), or not yet.
  // A decision is in the notes when one of them has it as a line marked #decision.
  const decisions = mine.decided.map((l) => {
    const d = decisionOf(l);
    const has = (text) => typeof text === 'string' && text.split('\n').some((x) => /#decision\b/i.test(x) && norm(x.replace(/#decision\b/gi, '').replace(/^\s*[-*]\s*/, '')) === norm(d.words));
    const where = [d.note, ...notes.keys()].filter(Boolean).find((f) => has(notes.get(f)));
    return { ...d, note: where || d.note, inNote: !!where };
  });
  const section = (title, lines, none) => [`**${title}**`, ...(lines.length ? lines : [none])];
  const text = [
    `**Wrap-up**${now ? ` \u00B7 ${now}` : ''}`, '',
    `Goal: ${goal || '\u2014'}`, '',
    ...section('Decided', decisions.map((d) => `- ${d.words}${d.inNote ? ` \u2014 in ${name(d.note)}` : ' (not in the notes yet)'}`), '- (nothing written under Decided)'), '',
    ...(mine.later.length ? [...section('Later', mine.later.map((d) => `- ${d}`), ''), ''] : []),
    ...section('Next', [...todos, ...open.map((f) => `- Still to settle: ${f}`)], '- (none written)'), '',
    ...section('Changed in the notes', changed, '- (nothing yet)'),
    ...(waiting.length ? ['', ...section('Not in the notes yet', waiting, '')] : []),
    ...(unsure.length ? ['', ...section('Changed in its note since \u2014 not confirmed', unsure, '')] : []), '',
    `**From the margin**: ${kept.length} taken and on the desk${taken.length > kept.length ? ` (${taken.length - kept.length} taken back or deleted)` : ''}, ${let_.length} let go`,
    ...kept.map((e) => { const t = e.text.split('\n')[0]; return `- ${e.title || 'A card'}: ${t.length > 70 ? `${t.slice(0, 70)}\u2026` : t}`; }),
  ].join('\n');
  return { text, todos, decisions };
}
// A line as it was and as it would read, as one: what goes struck out, what
// comes marked (==…==), what stays as it is — a long stretch of it cut
// (…) — its own marks (**, ~~, ==) left out, as shown on a card.
export function inlineDiff(was, now) {
  const plain = (t) => t.replace(/\*\*|~~|==|`/g, '').replace(/(^|\s)\*(?=\S)|(?<=\S)\*(\s|$)/g, '$1$2');
  const tok = (t) => plain(t).split(/(\s+|[\u00B7,.:;!?()[\]|/\u2192])/).filter(Boolean);
  // A line struck out whole: so.
  const struck = /^~~([\s\S]+)~~$/.exec(now.trim());
  if (struck && plain(struck[1]).trim() === plain(was).trim()) return `~~${plain(was).trim()}~~`;
  // What it strikes out (~~…~~) shows as gone.
  const a = tok(was.trim());
  const b = tok(now.trim().replace(/~~(?=\S)[\s\S]*?\S~~/g, '').replace(/\s{2,}/g, ' '));
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let x = a.length - 1; x >= 0; x--) for (let y = b.length - 1; y >= 0; y--) L[x][y] = a[x] === b[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
  const ops = []; // [kind, text]: '=' the same, '-' gone, '+' come
  const push = (k, t) => { if (ops.at(-1)?.[0] === k) ops.at(-1)[1] += t; else ops.push([k, t]); };
  let x = 0;
  let y = 0;
  while (x < a.length || y < b.length) {
    if (x < a.length && y < b.length && a[x] === b[y]) { push('=', a[x]); x++; y++; } else if (x < a.length && (y >= b.length || L[x + 1][y] >= L[x][y + 1])) { push('-', a[x]); x++; } else { push('+', b[y]); y++; }
  }
  // Changes with only a space or a mark between them: one stretch gone, one come.
  const hunks = [];
  for (let k = 0; k < ops.length; k++) {
    const [kind, t] = ops[k];
    const between = kind === '=' && /^[\s,]*$/.test(t) && hunks.at(-1)?.change && ops.slice(k + 1).some((o) => o[0] !== '=') && ops[k + 1]?.[0] !== '=';
    if (kind === '=' && !between) { hunks.push({ same: t }); continue; }
    if (!hunks.at(-1)?.change) hunks.push({ change: true, gone: '', come: '' });
    const h = hunks.at(-1);
    if (kind !== '+') h.gone += t;
    if (kind !== '-') h.come += t;
  }
  const keep = 24;
  return hunks.map((h, i) => {
    if (h.change) {
      const t = h.gone.trim() ? h.gone : h.come;
      return /^\s*/.exec(t)[0] + [h.gone.trim() ? `~~${h.gone.trim()}~~` : '', h.come.trim() ? `==${h.come.trim()}==` : ''].filter(Boolean).join(' ') + /\s*$/.exec(t)[0];
    }
    const t = h.same;
    if (t.length <= keep * 2) return t;
    if (i === 0) return `\u2026${t.slice(-keep)}`;
    if (i === hunks.length - 1) return `${t.slice(0, keep)}\u2026`;
    return `${t.slice(0, keep)} \u2026 ${t.slice(-keep)}`;
  }).join('');
}
// What they decided, carried into the notes (server.js /api/lab/review/changes):
// a card that shows, note by note, each line as it would read (what goes
// struck out, what comes marked), and each decision recorded. → its text.
export function changesText({ decided = [], changes = [] }) {
  const name = (f) => `[[${String(f).replace(/\.md$/i, '')}]]`;
  const legend = decided.map((d, i) => `- D${i + 1} ${d}`);
  const files = [...new Set(changes.map((c) => c.file))];
  const show = (t) => t.replace(/\*\*|~~|==|`/g, '');
  return [
    `**Changes to the notes** \u2014 ${changes.length} in ${files.length} note${files.length === 1 ? '' : 's'}`, '',
    ...legend, '',
    ...(files.length ? files.flatMap((f) => [`**${name(f)}**`, ...changes.filter((c) => c.file === f).sort((a, b) => (a.line || a.after) - (b.line || b.after))
      .map((c) => (c.add ? `- ${c.for} \u00B7 added after line ${c.after}: ==${show(c.add.replace(/^- (?:\[ \] )?/, c.todo ? 'To-do: ' : ''))}==` : `- ${c.for} \u00B7 line ${c.line}: ${inlineDiff(c.was, c.now)}`)), '']) : ['Nothing in the notes goes against it.', '']),
    files.length ? '_Nothing is changed yet: \u201CPropose in the notes\u201D puts each note\u2019s in its red pen review, to accept or not._' : '',
  ].join('\n').trim();
}
// A note's text with its changes made: a line changed where it is as it
// was (at its number, or found once elsewhere: the note may have moved on),
// a decision added after its line (bottom first, so the numbers hold), not
// again when the note has it. → { text, made: n, missed: n }.
export function withChanges(text, changes) {
  const lines = String(text).split('\n');
  let made = 0;
  let missed = 0;
  const at = (c) => {
    if (norm(lines[c.line - 1] ?? '') === norm(c.was)) return c.line - 1;
    const all = lines.map((l, i) => (norm(l) === norm(c.was) ? i : -1)).filter((i) => i >= 0);
    return all.length === 1 ? all[0] : -1;
  };
  for (const c of changes.filter((x) => !x.add)) { const i = at(c); if (i < 0) missed++; else { lines[i] = c.now; made++; } }
  // Added after the line they were put after, found again by its words (bottom first; two after one line, in their order).
  const adds = changes.map((c, i) => ({ c, i })).filter((x) => x.c.add).map((x) => ({ ...x, at: x.c.anchor == null ? Math.min(x.c.after, lines.length) : at({ line: x.c.after, was: x.c.anchor }) + 1 }));
  for (const { c, at: i } of adds.sort((p, q) => q.at - p.at || q.i - p.i)) {
    if (lines.some((l) => norm(l) === norm(c.add))) continue;
    if (i <= 0) { missed++; continue; }
    lines.splice(i, 0, c.add);
    made++;
  }
  return { text: lines.join('\n'), made, missed };
}
export function reviewDesk({ title, goal = '', goalState = 'guessed', goalFrom = '', ask = '', thisTime = {}, todos = [], notes = [], items = [], at = '' }) {
  const size = (s) => {
    const w = [...s].reduce((sum, c) => sum + (c.codePointAt(0) > 0x2e80 ? 2 : 1), 0);
    return 74 + 21 * Math.max(1, Math.ceil(w / 40));
  };
  const goalText = [`**${title}**`, '', `Goal (${GOAL_STATE[goalState] || GOAL_STATE.guessed}): ${goal || '\u2014'}${goalFrom ? ` \u2014 [[${goalFrom.replace(/\.md$/i, '')}]]` : ''}`, ...(ask ? ['', `? ${ask}`] : [])].join('\n');
  const mine = thisTimeText(thisTime);
  const groups = [
    { name: 'The goal', cards: [{ id: newId(), type: 'text', text: goalText, x: 0, y: 0, width: 360, height: size(goalText) + 40 }, { id: newId(), type: 'text', text: mine, x: 0, y: 0, width: 360, height: size(mine) + 60 }] },
    { name: 'Check the state (x: done)', cards: todos.map((t) => {
      const text = t.why ? `${t.text}\n\n_${t.why}_` : t.text;
      return { id: newId(), type: 'text', text, x: 0, y: 0, width: 340, height: size(text), from: { file: t.file, line: t.line, kind: 'todo', key: t.key, at, ...(t.tasks ? { tasks: true } : {}) } };
    }) },
    { name: 'Its notes', cards: notes.slice(0, 16).map((p) => ({ id: newId(), type: 'file', file: p, x: 0, y: 0, width: 340, height: 260 })) },
  ].filter((g) => g.cards.length);
  const nodes = [];
  const cards = [];
  // The margin's column before its notes (what to look at first, seen first).
  const laid = groupLayout(groups, 0, 0);
  const notesAt = laid.find((g) => g.name === 'Its notes');
  const shift = notesAt && items.length ? 380 + 2 * PAD : 0;
  let right = 0;
  for (const g of laid) {
    const dx = g === notesAt ? shift : 0;
    nodes.push({ id: newId(), type: 'group', label: g.name, ...g.box, x: g.box.x + dx });
    if (g !== notesAt) right = Math.max(right, g.box.x + g.box.width);
    const these = groups.find((x) => x.name === g.name).cards;
    for (const p of g.at) { const c = these.find((x) => x.id === p.id); cards.push({ ...c, x: p.x + dx, y: p.y }); }
  }
  const KIND = { decide: 'To decide', missing: 'Missing', conflict: 'Doesn\u2019t agree', ask: 'A question', consider: 'To consider', date: 'A date to look at' };
  let y = HEAD;
  const margin = items.map((x, i) => {
    const text = [x.say, x.why ? `\n_${i < 3 ? 'First' : 'Then'}: ${x.why}_` : '', x.from?.length ? `\nFrom: ${x.from.map((p) => `[[${p.replace(/\.md$/i, '')}]]`).join(', ')}` : '', x.todo ? `\nTo-do: \`${x.todo}\`` : ''].filter(Boolean).join('\n');
    const card = { id: newId(), kind: 'review', title: `${x.focus ? 'Your pick \u00B7 ' : ''}${KIND[x.kind] || 'Margin'}`, text, x: right + PAD, y, width: 380, height: size(text) + 30, ...(x.focus && thisTime.focus?.[x.focus - 1] ? { pick: thisTime.focus[x.focus - 1] } : {}) };
    y += card.height + PAD / 2;
    return card;
  });
  return { desk: { nodes: [...nodes, ...cards], edges: [] }, margin };
}

// The notes a note links to ([[…]], not ![[…]] nor in code), once each, as written.
export function linksOf(text) {
  const out = [];
  let fence = false;
  for (const l of String(text).split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    for (const m of l.replace(/`[^`]*`/g, '').matchAll(/(!?)\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const t = m[2].trim();
      if (!m[1] && t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

// What the cards taken from a note ask of it (from.to: { done } — a to-do
// ticked — or { decided: words } — a question decided, in those words, or
// as it was asked with none), made on its text now → the text to propose
// (in the red pen review; the note itself is not touched here).
export function toNote(text, cards) {
  let t = text;
  for (const c of cards) {
    const to = c.from?.to;
    const it = to && meetingItems(t).find((i) => i.key === c.from.key);
    if (!it) continue;
    if (to.done && it.kind === 'todo') t = moveItem(t, it, { done: true, on: to.on });
    else if (to.decided != null && it.kind === 'question') {
      t = moveItem(t, it, { kind: 'decision' });
      const words = String(to.decided).trim();
      if (words) t = t.split('\n').map((l) => { const m = /^(\s*>\s*\[!decision\][+-]?\s*)(.*)$/i.exec(l); return m && norm(bodyOf(m[2])) === norm(it.body) ? m[1] + words : l; }).join('\n');
    }
  }
  return t;
}

// A card taken from a note (from), and the note now: what it is there.
// → { state: 'open' | 'done' (a to-do ticked) | 'gone' (settled, or
// changed), line: where it is now (or was) }
export function fromState(from, text) {
  const it = meetingItems(text).find((i) => i.key === from.key);
  if (!it) return { state: 'gone', line: from.line };
  return { state: from.kind === 'todo' && it.done ? 'done' : 'open', line: it.line };
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
// The margin's cards as kept beside the desk: done ones, what shows them.
export const marginCards = (ai) => ai.filter((a) => a.state === 'done' && String(a.text || '').trim()).slice(-200)
  .map(({ id, kind, batch, of, title, text, x, y, width, height, paths, jot, decisions, changes, at, pick }) => ({ id, kind, ...(batch ? { batch } : {}), ...(of ? { of } : {}), ...(title ? { title } : {}), text, x, y, width, height, ...(paths?.length ? { paths } : {}), ...(jot ? { jot } : {}), ...(decisions?.length ? { decisions } : {}), ...(changes?.length ? { changes } : {}), ...(at ? { at } : {}), ...(pick ? { pick } : {}) }));
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, cls) => { const e = document.createElementNS(SVG, tag); if (cls) e.setAttribute('class', cls); return e; };

const ACTIONS = [
  ['summary', 'Sum up', 's', 'What the cards say together, where they agree and where they don’t'],
  ['questions', 'Questions', 'q', 'What they leave open, or where they disagree'],
  ['trail', 'Over time', 't', 'The meetings before and after them, in order: each to-do (when it came, how often it came back, when it was ticked), the questions that came back, what was decided when; by rules, nothing sent'],
  ['group', 'Sort', 'o', 'Into groups by what they are about (shown first, Tab to take)'],
  ['links', 'Links', 'l', 'The cards that belong together (shown first, Tab to take)'],
  ['merge', 'Merge', 'm', 'One note of them all, to make into a new note'],
];

// opts: { text, path, render(md) → html, readNote(path) → Promise<text>,
// imageUrl(path), addImages(files) → Promise<[{ path, file }]>, openNote(path,
// line), pickNote() → Promise<path>, makeNote(md)
// → Promise<path>, ask({ task, cards, question, talk }, onText) →
// Promise<{ said, end, withheld }>, privateOf(paths) → Promise<{ path: why }>,
// onChange(text), toast(msg, kind), reduced, dockMin, onDock(min),
// loadMargin() → Promise<[card]>, saveMargin([card]),
// trail(paths) → Promise<{ notes, more }> (server.js deskTrail) }
export class Desk {
  constructor(opts) {
    this.opts = opts;
    this.d = parseDesk(opts.text);
    this.cam = { x: 80, y: 80, z: 1 };
    this.sel = new Set();
    this.els = new Map();
    this.html = new Map(); // a note's card: its rendered text
    this.notes = new Map(); // a note cards were taken from: its text now
    this.priv = new Map(); // a note's card: why it is private ('' if not)
    this.ai = []; // what the margin wrote, not kept yet (kept beside the desk, see saveMargin)
    this.proposal = null; // { kind: 'group' | 'links' | 'row', ... }
    this.undo = [];
    this.redo = [];
    this.taken = []; // { at: the undo step, cards: what the margin wrote, taken in it }
    this.retaken = [];
    this.talk = [];
    this.talkKey = newId();
    this.build();
    this.render();
    requestAnimationFrame(() => this.fit(false));
    this.loadMargin();
  }

  // What the margin wrote and was not kept yet stays beside the desk (not in
  // its file: .agent-notes/desk/), so closing it loses nothing; it comes back
  // as it was, dashed, still to be kept or let go.
  async loadMargin() {
    if (!this.opts.loadMargin) return;
    let cards;
    try { cards = await this.opts.loadMargin(); } catch { return; } // not read: nothing written over it either
    const had = new Set(this.ai.map((a) => a.id));
    const back = (Array.isArray(cards) ? cards : []).filter((a) => a && a.id && !had.has(a.id)).map((a) => ({ ...a, state: 'done' }));
    this.ai = [...back, ...this.ai];
    this.marginRead = true;
    this.savedMargin = JSON.stringify(marginCards(back));
    // A review's desk opens on its goal and what the margin says, near enough to read.
    if (this.opts.review && back.length) this.reviewView(back);
    if (back.length) {
      this.render();
      this.say(`${back.length} of the margin\u2019s cards from before, not kept yet: Tab keeps the newest, \u21E7Tab all that came with it, Esc lets it go.`);
    }
  }
  reviewView(margin) {
    const ns = [...this.d.nodes.filter((n) => n.type === 'group' && n.label !== 'Its notes'), ...margin.filter((a) => !a.jot)];
    const b = boundsOf(ns);
    const r = this.el.getBoundingClientRect();
    if (!b || !r.width) return;
    const z = Math.max(0.62, Math.min(1, (r.width - this.side() - 80) / b.width));
    this.goTo({ x: 40 - b.x * z, y: 40 - b.y * z, z }, false);
  }
  saveMargin() {
    if (!this.marginRead || !this.opts.saveMargin) return;
    const now = JSON.stringify(marginCards(this.ai));
    if (now === this.savedMargin) return;
    this.savedMargin = now;
    clearTimeout(this.marginTimer);
    this.marginTimer = setTimeout(() => this.opts.saveMargin(JSON.parse(now)), 300);
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
    this.hint = el('div', 'desk-hint', 'Double-click: a card · Space: read one · drag a note from the tree, or a picture (or paste one) · drop a card on a card: a group · drop cards on the margin, or s q t o l m · / talk · z all');
    this.el = el('div', 'desk', this.grid, this.world, this.marquee, this.dock, this.hint, this.opts.review && this.opts.jot ? this.buildJot() : null);
    this.el.tabIndex = 0;
    this.el.desk = this; // for tests
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.el.addEventListener('dblclick', (e) => this.dbl(e));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('keyup', (e) => {
      if (e.key !== ' ') return;
      this.space = false;
      // Space pressed and let go, the desk not moved: read the card.
      const tap = this.spaceTap && performance.now() - this.spaceTap < 400;
      this.spaceTap = 0;
      if (tap && e.target === this.el) this.focusOn(this.focusFirst());
    });
    // "#2" in what the margin wrote: that card, shown.
    this.el.addEventListener('click', (e) => {
      const t = e.target.closest?.('a.tag');
      const n = /^(\d+)/.exec(t?.dataset.tag || '');
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      const id = [...(this.nums || [])].find(([, v]) => v === Number(n[1]))?.[0];
      const card = id && this.d.nodes.find((x) => x.id === id);
      if (!card) {
        // Over time's facts (its card), or a meeting not on the desk (its note).
        const ai = id?.startsWith('trail:') && this.ai.find((a) => a.id === id.slice(6));
        if (ai) this.show(ai, true); else if (id && NOTE.test(id)) this.opts.openNote(id);
        return;
      }
      this.sel = new Set([id]);
      this.paintSel();
      this.dockShow();
      this.show(card, true);
    }, true);
    this.el.addEventListener('dragover', (e) => { const t = [...e.dataTransfer.types]; if (t.includes('text/x-margin-path') || t.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    this.el.addEventListener('drop', (e) => {
      const p = e.dataTransfer.getData('text/x-margin-path');
      const w = this.toWorld(e.clientX, e.clientY);
      if (p) { e.preventDefault(); this.addFile(p, w.x - 200, w.y - 40); return; }
      // Pictures from outside (the Finder, a browser).
      if (!e.dataTransfer.files?.length) return;
      e.preventDefault();
      this.addPictures([...e.dataTransfer.files], w);
    });
    // A picture pasted (a screenshot): where the pointer is, or in the middle.
    this.el.addEventListener('pointermove', (e) => { this.pointerAt = { x: e.clientX, y: e.clientY }; });
    this.el.addEventListener('paste', (e) => {
      if (e.target !== this.el) return; // writing in a card
      const files = [...(e.clipboardData?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const at = this.pointerAt && this.pointerAt.x > r.left && this.pointerAt.x < r.right - this.side() && this.pointerAt.y > r.top && this.pointerAt.y < r.bottom ? this.pointerAt : { x: r.left + (r.width - this.side()) / 2, y: r.top + r.height / 2 };
      this.addPictures(files, this.toWorld(at.x, at.y));
    });
  }

  buildDock() {
    this.ctx = el('div', 'desk-ctx');
    this.actions = el('div', 'desk-actions', ...ACTIONS.map(([task, label, k, title]) => { const b = button(label, `${title} (${k}, or drop cards on it)`, () => this.act(task)); b.dataset.task = task; return b; }));
    // A review's desk: what came of it, from what was done here and the notes now (by rules; nothing sent).
    if (this.opts.review && this.opts.changes) this.actions.append(button('Into the notes', 'What you decided, carried into every line of its notes that no longer agrees, shown first; nothing changes until you propose it (c)', () => this.changesPlan()));
    if (this.opts.review) this.actions.append(button('Wrap up', 'What came of this review: decided, changed in the notes, taken from the margin, next \u2014 from what was done here and the notes as they are now; nothing sent (w)', () => this.wrapUp()));
    this.asksEl = el('div', 'desk-asks'); // shown folded too
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
    const fold = button('–', 'Fold the panel to its buttons (or open it again)', () => this.foldDock(!dock.classList.contains('min')), 'desk-fold');
    const dock = el('div', 'desk-dock', el('div', 'desk-dock-head', el('b', null, 'Margin'), this.status, fold), this.ctx, this.actions, this.asksEl, this.log, this.input);
    this.foldBtn = fold;
    dock.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pressed('dock'); });
    dock.addEventListener('wheel', (e) => e.stopPropagation());
    dock.addEventListener('dblclick', (e) => e.stopPropagation());
    if (this.opts.dockMin) { dock.classList.add('min'); fold.textContent = '+'; }
    return dock;
  }
  // A review's desk: a line at the bottom to write what is so now, as it
  // comes ("Napa: later", "dinner at X"); Enter puts it on the desk as
  // written, and the margin sorts it (jot).
  buildJot() {
    this.jotInput = el('textarea');
    this.jotInput.rows = 1;
    this.jotInput.placeholder = 'Jot what is so now \u2014 decided, later, still weighing, to do\u2026 (Enter; \u21E7Enter: a new line)';
    this.jotInput.addEventListener('input', () => { this.jotInput.style.height = 'auto'; this.jotInput.style.height = `${this.jotInput.scrollHeight}px`; });
    this.jotInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = this.jotInput.value.trim(); if (t) { this.jotInput.value = ''; this.jotInput.style.height = 'auto'; this.jot(t); } }
      if (e.key === 'Escape') { e.preventDefault(); this.el.focus(); }
    });
    this.jotStatus = el('div', 'desk-jot-status');
    const box = el('div', 'desk-jot-box', this.jotInput, this.jotStatus);
    const wrap = el('div', 'desk-jot', box);
    for (const t of ['pointerdown', 'wheel', 'dblclick']) box.addEventListener(t, (e) => e.stopPropagation(), t === 'wheel' ? { passive: true } : undefined);
    return wrap;
  }
  foldDock(min) {
    this.dock.classList.toggle('min', min);
    this.foldBtn.textContent = min ? '+' : '–';
    this.opts.onDock?.(min);
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
    if (!f && this.fitLater) this.fitStream();
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
    // In the file's order (groups first, under), moved only when out of it:
    // a card moved loses the focus of what is being written in it.
    let prev = this.labels;
    const put = (e) => { if (prev.nextSibling !== e) prev.after(e); prev = e; };
    for (const n of this.d.nodes) {
      keep.add(n.id);
      let e = this.els.get(n.id);
      if (!e || e.kind !== n.type) { e?.remove(); e = this.card(n); this.els.set(n.id, e); }
      this.fill(e, n);
      put(e);
    }
    for (const a of this.ai) {
      keep.add(a.id);
      let e = this.els.get(a.id);
      if (!e) { e = this.aiCard(a); this.els.set(a.id, e); }
      e.show(a);
      put(e);
    }
    for (const [id, e] of this.els) if (!keep.has(id)) { e.remove(); this.els.delete(id); }
    this.saveMargin();
    // Which notes on it are private: shown, but never sent.
    const ask = [...new Set(this.d.nodes.filter((n) => n.type === 'file' && !this.priv.has(n.file)).map((n) => n.file))];
    if (ask.length && this.opts.privateOf) {
      for (const p of ask) this.priv.set(p, '');
      this.opts.privateOf(ask).then((m) => { let any = false; for (const [p, why] of Object.entries(m || {})) if (why) { this.priv.set(p, why); any = true; } if (any) this.render(); }, () => {});
    }
    this.drawEdges();
    this.camera();
    this.dockShow();
    if (this.fitLater && this.el.isConnected) this.fitStream();
  }
  card(n) {
    const e = el('div', `desk-card t-${n.type}`);
    e.kind = n.type;
    e.dataset.id = n.id;
    e.head = el('div', 'desk-head');
    e.body = el('div', 'desk-body md');
    e.grip = el('div', 'desk-grip');
    e.num = el('span', 'desk-num');
    e.from = el('div', 'desk-from');
    e.from.hidden = true;
    e.from.addEventListener('pointerdown', (ev) => { if (ev.target.closest('a, button, input')) ev.stopPropagation(); });
    e.from.addEventListener('dblclick', (ev) => ev.stopPropagation());
    e.from.addEventListener('click', (ev) => {
      const n = this.d.nodes.find((x) => x.id === e.dataset.id);
      const a = ev.target.closest('a, button');
      if (!a || !n) return;
      ev.preventDefault();
      if (a.dataset.act) this.fromAct(n, a.dataset.act); else this.goFrom(n);
    });
    e.priv = el('span', 'desk-private');
    e.priv.hidden = true;
    e.append(e.head, e.body, e.from, e.grip, e.num, e.priv);
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
    e.priv.hidden = !(n.type === 'file' && this.priv.get(n.file));
    e.priv.textContent = e.priv.hidden ? '' : 'private · not sent';
    e.priv.title = e.priv.hidden ? '' : `Shown here; never sent to the margin (${this.priv.get(n.file)})`;
    this.fillFrom(e, n);
    if (n.type === 'file') {
      e.head.textContent = title;
      e.head.title = n.file;
      if (IMAGE.test(n.file)) {
        if (e.src !== n.file) {
          const img = el('img');
          img.src = this.opts.imageUrl(n.file);
          img.alt = title;
          img.draggable = false;
          img.addEventListener('load', () => { this.placeMarks(e, n.file); this.drawEdges(); });
          e.marks = el('div', 'desk-marks');
          e.body.replaceChildren(img, e.marks);
          e.src = n.file;
        }
        this.placeMarks(e, n.file);
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
    // A mark's line: from its part of the picture to its card.
    for (const m of this.d.nodes) {
      const f = m.from;
      if (f?.kind !== 'region' || !Array.isArray(f.rect)) continue;
      const pic = this.d.nodes.find((x) => x.type === 'file' && x.file === f.file);
      const pe = pic && this.els.get(pic.id);
      const img = pe?.body.querySelector('img');
      if (!img?.naturalWidth) continue;
      const [x, y, w, h] = f.rect;
      const ax = pic.x + pe.body.offsetLeft + img.offsetLeft + ((x + w) / img.naturalWidth) * img.offsetWidth;
      const ay = pic.y + pe.body.offsetTop + img.offsetTop + ((y + h / 2) / img.naturalHeight) * img.offsetHeight;
      const bx = m.x > ax ? m.x : m.x + m.width;
      const by2 = m.y + 18;
      const p = svg('path', `desk-edge mark${this.spotId === m.id ? ' spot' : ''}`);
      p.setAttribute('d', `M${ax},${ay} C${(ax + bx) / 2},${ay} ${(ax + bx) / 2},${by2} ${bx},${by2}`);
      this.edgeG.append(p);
    }
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
    if (this.proposal?.kind === 'group' || this.proposal?.kind === 'row') {
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
    if (this.undo.length > 100) { this.undo.shift(); this.taken = this.taken.map((t) => ({ ...t, at: t.at - 1 })).filter((t) => t.at > 0); }
    this.redo = [];
    this.retaken = [];
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
  refreshNote(path) {
    if (!this.html.has(path) && !this.notes.has(path)) return;
    this.html.delete(path);
    this.notes.delete(path);
    this.render();
  }
  // A card taken from a note: where from, and whether the note has moved on.
  fillFrom(e, n) {
    const f = n.type === 'text' && n.from && typeof n.from.file === 'string' ? n.from : null;
    e.from.hidden = !f;
    e.classList.toggle('stale', false);
    e.classList.toggle('t-mark', f?.kind === 'region');
    if (!f) return;
    if (f.kind === 'region' || f.kind === 'answer') { this.fillMark(e, n, f); return; }
    const text = this.notes.get(f.file);
    if (text === undefined) {
      this.notes.set(f.file, null);
      this.opts.readNote(f.file).then((t) => { this.notes.set(f.file, t); this.render(); }, () => { this.notes.set(f.file, ''); this.render(); });
    }
    const now = typeof text === 'string' && text ? fromState(f, text) : null;
    const was = { question: 'Question', todo: 'To do' }[f.kind] || 'From';
    const said = !now ? '' : now.state === 'done' ? 'done in the note' : now.state === 'gone' ? 'no longer open in the note' : '';
    // What it will ask of the note (to: shown, and sent with the others by
    // the panel's Propose), or what it can: a question decided, a to-do done.
    const to = f.to;
    const asks = to?.done ? '\u2192 done' : to && to.decided != null ? `\u2192 decided${String(to.decided).trim() ? `: \u201c${to.decided}\u201d` : ''}` : '';
    const key = `${was}|${f.file}|${said}|${f.at}|${asks}|${f.sent || ''}`;
    if (e.from.key !== key && !e.from.querySelector('input')) {
      const link = el('a', null, `${f.file.split('/').pop().replace(/\.(md|markdown)$/i, '')} \u2197`);
      link.href = '#';
      link.title = `Open ${f.file} there${f.at ? ` — this card is as it was written on ${f.at}` : ''}`;
      const act = (label, name, title) => { const b = el('button', 'desk-from-act', label); b.dataset.act = name; b.title = title; return b; };
      const can = said ? null
        : asks ? [el('span', 'desk-from-asks', asks), act('\u00d7', 'undo', 'Not this (nothing is sent)')]
          : f.kind === 'question' ? act('Decided\u2026', 'decide', 'Mark it decided (d): proposed to the note with the others, in the red pen review')
            : f.kind === 'todo' ? act('Done', 'done', 'Mark it done (x): proposed to the note with the others, in the red pen review') : null;
      e.from.replaceChildren(...[el('span', null, `${was} · `), link, said && el('span', 'desk-from-state', said), !said && !asks && f.sent && el('span', 'desk-from-sent', 'proposed'), can].flat().filter(Boolean));
      e.from.key = key;
    }
    e.classList.toggle('stale', !!said);
    e.classList.toggle('asks', !!asks && !said);
  }
  // A card's ask of its note: set (to), or taken back.
  fromAct(n, act) {
    if (!n?.from) return;
    if (act === 'ask') { this.act('region', [n]); return; }
    if (act === 'note') { this.noteMark(n); return; }
    if (act === 'noted') { if (n.from.noted) this.opts.openNote(n.from.noted); return; }
    const set = (to) => this.change({ ...this.d, nodes: this.d.nodes.map((x) => (x.id === n.id ? { ...x, from: { ...x.from, to } } : x)) });
    if (act === 'undo') { set(undefined); this.event('unmarked', { file: n.from.file, text: String(n.text || '').split('\n')[0] }); return; }
    // A to-do of a list kept as Obsidian Tasks writes it: with the day it was done.
    if (act === 'done' && n.from.kind === 'todo') { set({ done: true, ...(n.from.tasks ? { on: today() } : {}) }); this.event('marked done', { file: n.from.file, text: String(n.text || '').split('\n')[0] }); return; }
    if (act !== 'decide' || n.from.kind !== 'question') return;
    // In what words: typed in the card (none: as it was asked).
    const e = this.els.get(n.id);
    const input = el('input', 'desk-from-input');
    input.placeholder = 'Decided: in what words? (Enter; empty: as asked)';
    e.from.replaceChildren(input);
    input.focus();
    let open = true; // (removing it blurs it: once)
    const done = (save) => {
      if (!open) return;
      open = false;
      input.remove();
      e.from.key = null;
      if (save) set({ decided: input.value.trim() }); else this.render();
      this.el.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.isComposing) done(true); if (ev.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(false));
  }
  // ---- marks on a picture: a part of it, and what is written about it
  // (a card of its own beside the picture). Asked about (a), made a note
  // of (with the part and where it came from), gone through (j k).
  placeMarks(e, file) {
    const img = e.body.querySelector('img');
    if (!img?.naturalWidth || !e.marks) return;
    Object.assign(e.marks.style, { left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${img.offsetWidth}px`, height: `${img.offsetHeight}px` });
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const marks = regionsOf(this.d.nodes, file);
    const key = `${W}x${H}|${this.spotId || ''}|${marks.map((m) => `${m.id}:${m.from.rect.join(',')}:${(m.text || '').slice(0, 60)}`).join('|')}`;
    if (e.marks.key === key) return;
    e.marks.key = key;
    e.marks.replaceChildren(...marks.map((m, i) => {
      const [x, y, w, h] = m.from.rect;
      const b = el('div', `desk-mark${this.sel.has(m.id) ? ' sel' : ''}${this.spotId === m.id ? ' spot' : ''}`, el('span', null, String(i + 1)));
      Object.assign(b.style, { left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` });
      b.dataset.mark = m.id;
      b.title = (m.text || '').split('\n')[0] || 'A marked part (nothing written yet)';
      return b;
    }));
  }
  fillMark(e, n, f) {
    const pic = f.file.split('/').pop();
    const key = `${f.kind}|${f.file}|${f.noted || ''}|${f.rect}`;
    if (e.from.key === key) return;
    e.from.key = key;
    const link = el('a', null, `${pic} \u2197`);
    link.href = '#';
    link.title = `The part of ${f.file} it is about (j / k: the other marks)`;
    const act = (label, name, title) => { const b = el('button', 'desk-from-act', label); b.dataset.act = name; b.title = title; return b; };
    const noted = f.noted ? el('a', 'desk-from-noted', `in ${f.noted.split('/').pop().replace(/\.md$/i, '')} \u2197`) : null;
    if (noted) { noted.href = '#'; noted.dataset.act = 'noted'; noted.title = `The note made of it: ${f.noted}`; }
    e.from.replaceChildren(...[el('span', null, `${f.kind === 'region' ? 'Marked' : 'Answer'} \u00b7 `), link, noted && el('span', null, ' \u00b7 '), noted,
      f.kind === 'region' && act('Ask', 'ask', 'Ask the margin about this part of the picture (a): its answer comes beside it'),
      f.kind === 'region' && act('Note\u2026', 'note', 'A new note of it: the part of the picture, what is written here, the answers kept, and where it came from')].filter(Boolean));
  }
  markMode(id) {
    this.marking = id;
    this.el.classList.toggle('marking', !!id);
    for (const [cid, e] of this.els) e.classList.toggle('marking', cid === id);
    if (id) this.opts.toast('Drag over the picture to mark a part of it (Esc: not now). \u2325 and a drag marks at any time.');
  }
  markDown(e, n) {
    const card = this.els.get(n.id);
    const img = card?.body.querySelector('img');
    if (!img?.naturalWidth) return;
    e.stopPropagation();
    this.sel = new Set([n.id]);
    this.paintSel();
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const ir = img.getBoundingClientRect();
    const at = (ev) => ({ x: ((ev.clientX - ir.left) / ir.width) * W, y: ((ev.clientY - ir.top) / ir.height) * H });
    const a = at(e);
    let b = a;
    const box = el('div', 'desk-mark drawing');
    card.marks.append(box);
    this.drag(e, (ev) => {
      b = at(ev);
      const r = rectFrom(a, b, W, H, 0);
      if (r) Object.assign(box.style, { left: `${(r[0] / W) * 100}%`, top: `${(r[1] / H) * 100}%`, width: `${(r[2] / W) * 100}%`, height: `${(r[3] / H) * 100}%` });
    }, () => {
      box.remove();
      this.markMode(null);
      const rect = rectFrom(a, b, W, H, Math.max(4, Math.min(W, H) / 100));
      if (rect) this.addMark(n, rect, (img.offsetTop + card.body.offsetTop + (rect[1] / H) * img.offsetHeight));
    });
  }
  // The mark's card: beside the picture, level with the part, clear of the others there.
  addMark(n, rect, dy = 40) {
    const m = { id: newId(), type: 'text', text: '', x: Math.round(n.x + n.width + 60), y: Math.round(n.y + dy - 20), width: 280, height: 110, from: { file: n.file, kind: 'region', rect, at: today() } };
    const others = this.d.nodes.filter((x) => x.type !== 'group');
    for (let i = 0; i < 40; i++) {
      const hit = others.find((x) => x.x < m.x + m.width + 10 && x.x + x.width + 10 > m.x && x.y < m.y + m.height + 10 && x.y + x.height + 10 > m.y);
      if (!hit) break;
      m.y = hit.y + hit.height + 16;
    }
    this.sel = new Set([m.id]);
    this.change({ ...this.d, nodes: [...this.d.nodes, m] });
    this.edit(m.id);
  }
  // One mark in the light: its picture, it, its answers and its note; the
  // rest of the desk dim. j k: the next; Esc (or a click on the plane): all.
  spotMark(m) {
    const f = m.from;
    const pic = this.d.nodes.find((x) => x.type === 'file' && x.file === f.file);
    const { answers, note } = threadOf(this.d.nodes, m);
    const lit = [pic, m, ...answers, ...(note ? this.d.nodes.filter((x) => x.type === 'file' && x.file === note) : [])].filter(Boolean);
    this.spotId = m.id;
    this.el.classList.add('spotting');
    const ids = new Set(lit.map((x) => x.id));
    for (const [id, e] of this.els) e.classList.toggle('lit', ids.has(id));
    this.sel = new Set([m.id]);
    this.paintSel();
    this.dockShow();
    this.render();
    this.fit(true, lit);
  }
  unspot() {
    this.spotId = null;
    this.el.classList.remove('spotting');
    for (const e of this.els.values()) e.classList.remove('lit');
    this.render();
  }
  // A note of the mark: made where you say, its card beside the mark (an
  // arrow from it), and the mark knows it (noted).
  async noteMark(n) {
    const f = n.from;
    const { answers } = threadOf(this.d.nodes, n);
    const path = await this.opts.makeNote((notePath) => regionNote({ notePath, image: f.file, rect: f.rect, text: n.text, answers: answers.map((a) => a.text), desk: this.opts.path }));
    if (!path) return;
    const at = this.spot([n, ...answers], 400, 420);
    const c = { id: newId(), type: 'file', file: path, x: at.x, y: at.y, width: 400, height: 420 };
    this.sel = new Set([c.id]);
    this.change({
      ...this.d,
      nodes: [...this.d.nodes.map((x) => (x.id === n.id ? { ...x, from: { ...x.from, noted: path } } : x)), c],
      edges: [...this.d.edges, { id: newId(), fromNode: n.id, toNode: c.id }],
    });
  }
  // A mark read large: what it became, one layer on another — the part of
  // the picture, what was written, the answers kept, the note made — the
  // latest in front, the earlier ones behind it (their names showing);
  // ↑ ↓ bring an earlier one forward, or a later one back.
  layersOf(n) {
    const f = n.from;
    const { answers, note } = threadOf(this.d.nodes, n);
    const part = el('img');
    part.src = `${this.opts.imageUrl(f.file)}#xywh=${f.rect.join(',')}`;
    part.alt = f.file;
    const md = (t) => { const d = el('div', 'md'); d.innerHTML = this.opts.render(t); return d; };
    const steps = [
      ['Marked', f.at, part],
      ['Written', null, md(n.text || '*Nothing written yet: Enter writes in it.*')],
      ...answers.map((a) => ['Answer kept', a.from?.at, md(a.text || '')]),
    ];
    if (note) { const a = el('a', null, `${note.split('/').pop().replace(/\.md$/i, '')} \u2197`); a.href = '#'; a.addEventListener('click', (ev) => { ev.preventDefault(); this.opts.openNote(note); }); steps.push(['Noted', null, el('div', null, 'Made a note: ', a)]); }
    const box = el('div', 'desk-layers');
    const layers = steps.map(([name, at, content], i) => el('div', 'desk-layer', el('div', 'desk-layer-name', `${i + 1} \u00b7 ${name}${at ? ` \u00b7 ${at}` : ''}`), content));
    box.append(...layers);
    cropParts(box);
    let front = layers.length - 1;
    const show = () => layers.forEach((l, i) => {
      l.classList.toggle('ahead', i > front);
      l.classList.toggle('front', i === front);
      l.style.setProperty('--d', String(Math.max(0, front - i)));
    });
    show();
    box.style.setProperty('--n', String(layers.length - 1));
    this.layers = { go: (d) => { front = Math.max(0, Math.min(layers.length - 1, front + d)); show(); } };
    return box;
  }
  // The asks of the cards from one note, proposed to it in one red pen review.
  async sendToNote(file) {
    const cards = this.d.nodes.filter((n) => n.from?.file === file && n.from.to);
    if (!cards.length) return;
    let ok;
    try { ok = await this.opts.proposeNote(file, (text) => toNote(text, cards)); } catch { return; } // (said already)
    if (ok === false) return;
    this.event('proposed', { file, text: `${cards.length} card${cards.length === 1 ? '' : 's'}` });
    const ids = new Set(cards.map((c) => c.id));
    this.change({ ...this.d, nodes: this.d.nodes.map((n) => (ids.has(n.id) ? { ...n, from: { ...n.from, to: undefined, sent: true } } : n)) });
  }
  goFrom(n) {
    const f = n?.from;
    if (!f) return;
    if (f.kind === 'region' || f.kind === 'answer') { const m = f.kind === 'region' ? n : this.d.nodes.find((x) => x.id === f.of); if (m) this.spotMark(m); return; }
    const text = this.notes.get(f.file);
    // (Lines counted from 0 here, from 1 in the editor.)
    this.opts.openNote(f.file, (typeof text === 'string' && text ? fromState(f, text).line : f.line) + 1);
  }
  back(redo = false) {
    const from = redo ? this.redo : this.undo;
    if (!from.length) return;
    // Cards taken from the margin in that step: back to it, or taken again.
    const mine = redo ? this.retaken : this.taken;
    const step = mine.at(-1)?.at === from.length ? mine.pop() : null;
    (redo ? this.undo : this.redo).push(stringifyDesk(this.d));
    if (step) {
      const gone = new Set(step.cards.map((a) => a.id));
      if (redo) this.ai = this.ai.filter((a) => !gone.has(a.id)); else this.ai = [...this.ai.filter((a) => !gone.has(a.id)), ...step.cards];
      (redo ? this.taken : this.retaken).push({ at: (redo ? this.undo : this.redo).length, cards: step.cards });
    }
    this.d = parseDesk(from.pop());
    this.render();
    this.opts.onChange(stringifyDesk(this.d));
  }

  addFile(path, x, y) {
    const n = { id: newId(), type: 'file', file: path, x: Math.round(x), y: Math.round(y), width: 400, height: 400 };
    if (!IMAGE.test(path)) { this.put([n]); return; }
    // A picture: its card as tall as the picture is.
    const img = new Image();
    img.onload = () => this.put([{ ...n, ...pictureSize(img.naturalWidth, img.naturalHeight) }]);
    img.onerror = () => this.put([{ ...n, height: 300 }]);
    img.src = this.opts.imageUrl(path);
  }
  // Pictures from outside: saved beside the desk (app.js addImages), then
  // their cards, a little apart, from `at` on — one step to undo.
  async addPictures(files, at) {
    const pics = files.filter((f) => /^image\//.test(f.type));
    if (!pics.length) { this.opts.toast('Only pictures can be dropped here; a note, from the tree.', 'error'); return; }
    if (!this.opts.addImages) return;
    const saved = await this.opts.addImages(pics);
    const nodes = await Promise.all(saved.map(async ({ path, file }, i) => {
      let size = { width: 400, height: 300 };
      try { const b = await createImageBitmap(file); size = pictureSize(b.width, b.height); b.close(); } catch { /* not one the browser reads: the default size */ }
      return { id: newId(), type: 'file', file: path, x: Math.round(at.x - size.width / 2 + i * 40), y: Math.round(at.y - 30 + i * 40), ...size };
    }));
    if (nodes.length) this.put(nodes);
  }
  put(nodes) {
    this.sel = new Set(nodes.map((n) => n.id));
    this.change({ ...this.d, nodes: [...this.d.nodes, ...nodes] });
    this.paintSel();
    this.dockShow();
    this.el.focus({ preventScroll: true });
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
      if (!id && this.spotId) this.unspot();
      if (this.space) this.spaceTap = 0; // a move, not a tap
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
    // On a picture: a part marked (r, or ⌥ and a drag), or a mark chosen.
    if (n.type === 'file' && IMAGE.test(n.file) && e.target.closest('.desk-body') && (this.marking === n.id || e.altKey)) return this.markDown(e, n);
    const mk = e.target.closest('.desk-mark');
    const m = mk && this.d.nodes.find((x) => x.id === mk.dataset.mark);
    if (m) { e.stopPropagation(); this.spotMark(m); return; }
    if (this.spotId && !this.els.get(id)?.classList.contains('lit')) this.unspot();
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
  paintSel() {
    for (const [id, e] of this.els) e.classList.toggle('sel', this.sel.has(id));
    for (const b of this.world.querySelectorAll('.desk-mark[data-mark]')) b.classList.toggle('sel', this.sel.has(b.dataset.mark));
  }
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
    let open = true; // (removing it blurs it: once)
    const done = (save) => {
      if (!open) return;
      open = false;
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
    if (this.focused) { this.focusKey(e, handled); return; }
    if (k === ' ') { handled(); if (!e.repeat) { this.space = true; this.spaceTap = performance.now(); } return; }
    if (mod && k.toLowerCase() === 'z') { handled(); this.back(e.shiftKey); return; }
    if (mod && k.toLowerCase() === 'a') { handled(); this.sel = new Set(this.d.nodes.filter((n) => n.type !== 'group').map((n) => n.id)); this.paintSel(); this.dockShow(); return; }
    if (mod || e.altKey) return;
    if (k === 'Tab') { handled(); if (this.proposal) this.take(); else if (e.shiftKey) this.keepAll(this.ai.at(-1)); else this.keep(this.ai.at(-1)); return; }
    if (k === 'Escape') {
      handled();
      if (this.marking) { this.markMode(null); return; }
      if (this.spotId) { this.unspot(); return; }
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
    if ((k === 'd' || k === 'x') && one?.from?.kind === (k === 'd' ? 'question' : 'todo')) { handled(); this.fromAct(one, k === 'd' ? 'decide' : 'done'); return; }
    if (k === 'r' && one?.type === 'file' && IMAGE.test(one.file)) { handled(); this.markMode(this.marking === one.id ? null : one.id); return; }
    if (k === 'a' && one?.from?.kind === 'region') { handled(); this.act('region', [one]); return; }
    if ((k === 'j' || k === 'k') && one) {
      const file = one.type === 'file' ? one.file : (one.from?.kind === 'region' || one.from?.kind === 'answer') ? one.from.file : null;
      const marks = file ? regionsOf(this.d.nodes, file) : [];
      if (marks.length) {
        handled();
        const mark = one.from?.kind === 'answer' ? marks.find((m) => m.id === one.from.of) : one;
        const i = marks.indexOf(mark);
        this.spotMark(marks[i < 0 ? (k === 'j' ? 0 : marks.length - 1) : (i + (k === 'j' ? 1 : -1) + marks.length) % marks.length]);
        return;
      }
    }
    if (k === 'g' && this.sel.size) { handled(); this.change(groupAround(this.d, [...this.sel])); return; }
    if (k === 'z') { handled(); this.fit(); return; }
    if (k === '=' || k === '+' || k === '-') { handled(); const r = this.el.getBoundingClientRect(); this.zoomAt((r.width - this.side()) / 2, r.height / 2, k === '-' ? 1 / 1.2 : 1.2, true); return; }
    if (k === '1') { handled(); const r = this.el.getBoundingClientRect(); const c = center(); this.goTo({ z: 1, x: (r.width - this.side()) / 2 - c.x, y: r.height / 2 - c.y }); return; }
    if (k === '/') { handled(); if (this.dock.classList.contains('min')) this.foldDock(false); this.input.focus(); return; }
    if (k === 'w' && this.opts.review) { handled(); this.wrapUp(); return; }
    if (k === 'i' && this.jotInput) { handled(); this.jotInput.focus(); return; }
    if (k === 'c' && this.opts.review && this.opts.changes) { handled(); this.changesPlan(); return; }
    const act = ACTIONS.find((a) => a[2] === k);
    if (act) { handled(); this.act(act[0]); }
  }

  // ---- reading one card (Space): large, in the middle of the desk; ← →
  // the one before or after it in its group (or among the cards in none),
  // in reading order, so where it goes is known.
  ring(n) {
    const g = groupAt(this.d, n);
    const pool = this.d.nodes.filter((c) => c.type !== 'group' && groupAt(this.d, c) === g);
    const top = Math.min(...pool.map((c) => c.y));
    return pool.sort((a, b) => Math.floor((a.y - top) / 50) - Math.floor((b.y - top) / 50) || a.x - b.x);
  }
  // The card to read: the one selected (a group: its first), or the one
  // nearest the middle of the view.
  focusFirst() {
    const one = this.sel.size === 1 ? this.d.nodes.find((n) => this.sel.has(n.id)) : null;
    if (one && one.type !== 'group') return one;
    if (one) { const first = childrenOf(this.d, one).find((c) => c.type !== 'group'); return first ? this.ring(first)[0] : null; }
    const r = this.el.getBoundingClientRect();
    const m = this.toWorld(r.left + (r.width - this.side()) / 2, r.top + r.height / 2);
    const d = (n) => Math.hypot(n.x + n.width / 2 - m.x, n.y + n.height / 2 - m.y);
    return this.d.nodes.filter((n) => n.type !== 'group').sort((a, b) => d(a) - d(b))[0] || null;
  }
  focusOn(n) {
    if (!n) return;
    this.layers = null;
    const ring = this.ring(n);
    const g = groupAt(this.d, n);
    this.focused = n;
    this.sel = new Set([n.id]);
    this.paintSel();
    this.dockShow();
    const body = el('div', 'desk-focus-body md');
    if (n.type === 'file' && /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(n.file)) { const img = el('img'); img.src = this.opts.imageUrl(n.file); img.alt = cardTitle(n); body.append(img); } else if (n.type === 'file') {
      const html = this.html.get(n.file);
      if (html) body.innerHTML = html;
      else { body.textContent = 'Loading…'; this.opts.readNote(n.file).then((t) => { if (this.focused === n) body.innerHTML = this.opts.render(t.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), n.file); }, () => { body.textContent = 'Not found'; }); }
    } else if (n.type === 'link') body.textContent = n.url || '';
    else if (n.from?.kind === 'region' && Array.isArray(n.from.rect)) body.append(this.layersOf(n));
    else body.innerHTML = this.opts.render(n.text || '');
    const from = this.els.get(n.id)?.from;
    const where = `${g ? `${g.label || 'Group'} · ` : ''}${ring.indexOf(n) + 1} / ${ring.length}`;
    const head = el('div', 'desk-focus-head', el('b', null, n.type === 'text' ? '' : cardTitle(n)), el('span', 'desk-focus-where', where));
    const note = n.type === 'file' && NOTE.test(n.file);
    const foot = el('div', 'desk-focus-foot', `${this.layers ? '\u2191 \u2193 back and forth through what it became · ' : ''}${ring.length > 1 ? '← → the next · ' : ''}${n.type === 'text' || note ? 'Enter writes in it · ' : ''}${n.type === 'file' ? 'o opens it beside · ' : ''}Esc or Space back`);
    const card = el('div', `desk-focus-card t-${n.type}`, head, body, from && !from.hidden ? from.cloneNode(true) : null, foot);
    // Its footer, as on the card: the link back, and what it can do (the desk shown again first).
    card.querySelector('.desk-from')?.addEventListener('click', (ev) => {
      const a = ev.target.closest('a, button');
      if (!a) return;
      ev.preventDefault();
      if (a.dataset.act === 'decide') return; // its words are written on the card itself
      this.focusOff();
      if (a.dataset.act) this.fromAct(n, a.dataset.act); else this.goFrom(n);
    });
    if (!this.focusEl) {
      this.focusEl = el('div', 'desk-focus');
      this.focusEl.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); if (ev.target === this.focusEl) this.focusOff(); });
      this.focusEl.addEventListener('wheel', (ev) => ev.stopPropagation());
      this.focusEl.addEventListener('dblclick', (ev) => ev.stopPropagation());
      this.el.append(this.focusEl);
    }
    this.focusEl.replaceChildren(card);
    this.el.classList.add('focusing');
    this.el.focus({ preventScroll: true });
    this.show(n); // behind it, the desk goes there too
  }
  focusOff() {
    this.focusDone?.();
    this.focusEl?.remove();
    this.focusEl = null;
    this.focused = null;
    this.el.classList.remove('focusing');
    this.el.focus({ preventScroll: true });
  }
  focusKey(e, handled) {
    const n = this.focused;
    const k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    handled();
    if (k === 'Escape' || k === ' ') { this.focusOff(); return; }
    if (this.layers && (k === 'ArrowUp' || k === 'ArrowDown')) { this.layers.go(k === 'ArrowUp' ? -1 : 1); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      const ring = this.ring(n);
      const i = ring.indexOf(n) + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1);
      if (i >= 0 && i < ring.length) this.focusOn(ring[i]);
      return;
    }
    if (k === 'Enter') { this.focusEdit(); return; }
    if (k === 'o' && n.type === 'file') { this.focusOff(); this.opts.openNote(n.file); }
  }
  // Writing in the card read large: a card of your own, into the desk; a
  // note, into the note (app.js noteEdit: through its tab when it is open,
  // else saved as a tab is — never over a newer one on disk).
  async focusEdit() {
    const n = this.focused;
    if (!n || this.focusEl?.querySelector('textarea')) return;
    let text;
    let save;
    if (n.type === 'text') {
      text = n.text || '';
      save = async (t) => this.change({ ...this.d, nodes: this.d.nodes.map((x) => (x.id === n.id ? { ...x, text: t } : x)) });
    } else if (n.type === 'file' && NOTE.test(n.file) && this.opts.noteEdit) {
      try { ({ text, save } = await this.opts.noteEdit(n.file)); } catch (err) { this.opts.toast(err.message, 'error'); return; }
    } else return;
    if (this.focused !== n) return;
    const ta = el('textarea', 'desk-focus-edit');
    ta.value = text;
    ta.spellcheck = false;
    this.focusEl.querySelector('.desk-focus-body').replaceChildren(ta);
    this.focusEl.querySelector('.desk-focus-foot').textContent = n.type === 'text' ? 'Esc or \u2318Enter: done' : 'Saved as you write \u00b7 Esc or \u2318Enter: done';
    ta.focus();
    let last = text;
    let timer = 0;
    let saving = Promise.resolve();
    let failed = 0; // not saved: the words stay here until Esc twice
    const flush = () => {
      clearTimeout(timer);
      if (ta.value === last) return saving;
      const t = ta.value;
      last = t;
      saving = saving.then(() => save(t)).catch((err) => {
        failed = 1;
        this.opts.toast(err.message, 'error');
        const foot = this.focusEl?.querySelector('.desk-focus-foot');
        if (foot) foot.textContent = 'Not saved \u2014 copy what you wrote \u00b7 Esc again: leave it';
      });
      return saving;
    };
    // A note is saved as you write (as autosave does); a card of your own when you are done (one undo step).
    if (n.type === 'file') ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(flush, 800); });
    const done = async () => {
      this.focusDone = null;
      await flush();
      if (n.type === 'file') this.refreshNote(n.file);
    };
    this.focusDone = done;
    ta.addEventListener('keydown', async (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) {
        ev.preventDefault();
        await flush();
        if (failed === 1) { failed = 2; return; }
        await done();
        const now = this.d.nodes.find((x) => x.id === n.id);
        if (now && this.focused === n) this.focusOn(now);
      }
    });
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
    // What the cards ask of their notes: one proposal for each note.
    const asks = new Map();
    for (const n of this.d.nodes) if (n.from?.to && typeof n.from.file === 'string') asks.set(n.from.file, (asks.get(n.from.file) || 0) + 1);
    this.asksEl.replaceChildren();
    for (const [file, count] of asks) {
      const name = file.split('/').pop().replace(/\.(md|markdown)$/i, '');
      this.asksEl.append(el('div', null, button(`Propose to ${name} (${count})`, `The ${count === 1 ? 'change' : `${count} changes`} the cards ask of ${file}, in its red pen review: nothing changes until you accept it there`, () => this.sendToNote(file), 'primary')));
    }
    for (const b of this.actions.children) b.disabled = !ns.length || !!this.busy;
  }
  // The cards as the margin is given them: a picture's card with the
  // picture, a mark with its part and the whole (the server sends them only
  // when the picture may be sent).
  async cardsFor(ns) {
    let room = 8;
    return Promise.all(ns.map(async (n) => {
      if (n.type === 'file') {
        const picture = IMAGE.test(n.file) && room-- > 0 ? await this.picture(n.file) : null;
        return { key: n.id, file: n.file, ...(picture ? { picture } : {}) };
      }
      const c = { key: n.id, text: n.text || '' };
      const f = n.from;
      if (f?.kind === 'region' && Array.isArray(f.rect) && (room -= 2) >= 0) {
        const [picture, whole] = await Promise.all([this.picture(f.file, f.rect), this.picture(f.file)]);
        if (picture) Object.assign(c, { region: { file: f.file, rect: f.rect }, picture, ...(whole ? { whole } : {}) });
      }
      return c;
    }));
  }
  // A picture (or a part of one) as the model reads it: 1568 px at most on
  // its long side, PNG (a part, for its letters) or JPEG.
  async picture(file, rect = null) {
    try {
      const img = new Image();
      img.src = this.opts.imageUrl(file);
      await img.decode();
      const [x, y, w, h] = rect || [0, 0, img.naturalWidth, img.naturalHeight];
      const k = Math.min(1, 1568 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
      const url = rect ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
      return { media: url.slice(5, url.indexOf(';')), data: url.slice(url.indexOf(',') + 1) };
    } catch { return null; }
  }
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
  async act(task, given = null) {
    if (this.busy) return;
    const ns = given || this.context();
    if (task === 'trail') { await this.trail(ns); return; }
    if (task === 'region' && !String(ns[0]?.text || '').trim()) { this.opts.toast('Write in the mark first what to ask, or what it says (Enter).'); this.edit(ns[0].id); return; }
    if (!ns.length) { this.opts.toast('No cards to give the margin: select some, or bring them into view.'); return; }
    if (task === 'group' && ns.length < 3) { this.opts.toast('Sorting needs three cards or more.'); return; }
    if (task === 'links' && ns.length < 2) { this.opts.toast('Links need two cards or more.'); return; }
    const wide = task === 'merge';
    const at = this.spot(ns, wide ? 520 : 380, wide ? 520 : task === 'questions' ? 560 : 240);
    const label = ACTIONS.find((a) => a[0] === task)?.[1] || 'Ask';
    const card = task === 'region' ? this.addAi({ kind: 'answer', of: ns[0].id, x: at.x, y: at.y, width: 380, height: 160, text: '', title: 'About the part' })
      : (task === 'summary' || task === 'merge') ? this.addAi({ kind: task, x: at.x, y: at.y, width: wide ? 520 : 380, height: wide ? 520 : 200, text: '', title: label }) : null;
    this.busy = label;
    this.dockShow();
    this.status.textContent = `${label}…`;
    this.el.classList.add('thinking');
    for (const n of ns) this.els.get(n.id)?.classList.add('given');
    const t0 = performance.now();
    try {
      const r = await this.opts.ask({ task, cards: await this.cardsFor(ns) }, (said) => { if (card) { card.text = said; card.state = 'stream'; this.els.get(card.id)?.show(card); } });
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
        const batch = newId();
        const cards = qs.map((q) => {
          const c = this.addAi({ kind: 'question', batch, x: at.x, y, width: 340, height: 60, text: `? ${q}`, state: 'done' }, false);
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
      this.saveMargin();
    }
  }
  // Over time (trail.js): the meetings the notes among them are in, in
  // order, and what became of what they wrote — read from the notes and
  // their kept versions by rules; nothing is sent. A card of it, and the
  // meetings in a row, to take (Tab).
  async trail(ns) {
    const files = [...new Set(ns.flatMap((n) => (n.type === 'file' && NOTE.test(n.file) ? [n.file] : NOTE.test(n.from?.file || '') ? [n.from.file] : [])))];
    if (!files.length || !this.opts.trail) { this.opts.toast('Over time starts from a meeting\u2019s note on the desk: select it, or bring it into view.'); return; }
    this.busy = 'Over time';
    this.dockShow();
    this.status.textContent = 'Over time\u2026';
    try {
      const r = await this.opts.trail(files);
      // Private notes stay out of it: the card may be kept, and sent later.
      let notes = (r.notes || []).filter((x) => !x.private);
      const hidden = (r.notes || []).length - notes.length;
      // The cards in view (none selected): only the notes in a series, when some are.
      const linked = new Set(notes.flatMap((x) => (x.prev ? [x.path, x.prev] : [])));
      if (!this.sel.size && linked.size) notes = notes.filter((x) => linked.has(x.path));
      if (!notes.length) throw new Error('Nothing to follow: the notes are private.');
      const t = trailOf(notes);
      const n = t.meetings.length;
      const at = this.spot(ns, 440, 320);
      const card = this.addAi({ kind: 'trail', title: `Over time \u00B7 ${n} meeting${n === 1 ? '' : 's'}`, x: at.x, y: at.y, width: 440, height: 200, text: trailText(t), state: 'done', paths: t.meetings.map((m) => m.path) }, false);
      this.status.textContent = `Over time \u00B7 ${n}`;
      if (r.more) this.say(`Only ${(r.notes || []).length} meetings of the chain were read.`);
      if (hidden) this.say(`${hidden} private note${hidden === 1 ? '' : 's'} left out.`);
      if (n > 1) this.proposeRow(t.meetings); else this.show(card, true);
    } catch (err) {
      this.status.textContent = '';
      this.opts.toast(err.message, 'error');
    } finally {
      this.busy = null;
      this.dockShow();
      this.saveMargin();
    }
  }
  // The meetings in a row below the cards, in order, each in a group named
  // by its place and date (≈ when it is estimated), an arrow to the next;
  // a note not on the desk yet comes onto it.
  // What the rules can't tell (Over time's card, "Read into it"): the same
  // to-dos written differently, what goes against what, what holds now, what
  // to raise first — the margin reads the card's facts, worked out again
  // without the private ones, and the meetings, oldest first, each titled
  // with its date (as many of the newest as the request has room for).
  async readTrail(a) {
    if (this.busy || !a?.paths?.length || !this.opts.trail) return;
    this.busy = 'Read into it';
    this.dockShow();
    this.status.textContent = 'Read into it\u2026';
    this.el.classList.add('thinking');
    const at = this.spot([a], 440, 360);
    const card = this.addAi({ kind: 'summary', title: 'Over time \u00B7 what it means', x: at.x, y: at.y, width: 440, height: 240, text: '' });
    const t0 = performance.now();
    try {
      const r = await this.opts.trail(a.paths);
      const notes = (r.notes || []).filter((n) => !n.private);
      if (!notes.length) throw new Error('Nothing to read: the meetings are private.');
      const t = trailOf(notes);
      const on = (p) => this.d.nodes.find((n) => n.type === 'file' && n.file === p);
      const facts = trailText(t, { max: 15 });
      // The server sends a card's first 6000 characters, 40000 in all.
      let room = 38000 - Math.min(6000, facts.length);
      const size = new Map(notes.map((n) => [n.path, Math.min(6000, n.text.length)]));
      const sent = [...t.meetings].reverse().filter((m) => (room -= size.get(m.path)) >= 0).reverse();
      const cards = [{ key: `trail:${a.id}`, text: facts },
        ...sent.map((m) => ({ key: on(m.path)?.id || m.path, file: m.path, when: m.date ? `${m.estimated ? '\u2248' : ''}${m.date}` : 'no date' }))];
      if (sent.length < t.meetings.length) this.say(`The ${sent.length} newest meetings were read (the card\u2019s facts are from all ${t.meetings.length}).`);
      const res = await this.opts.ask({ task: 'trail', cards }, (said) => { card.text = said; card.state = 'stream'; this.els.get(card.id)?.show(card); });
      this.withheld = res.withheld;
      this.nums = res.nums;
      if (!res.end?.ok) throw new Error(res.end?.error || 'No answer');
      card.text = res.said.trim();
      card.state = 'done';
      this.render();
      this.show(card);
      this.status.textContent = `Read into it \u00B7 ${((performance.now() - t0) / 1000).toFixed(1)}s`;
    } catch (err) {
      card.state = 'error';
      card.text = err.message;
      this.els.get(card.id)?.show(card);
      this.status.textContent = '';
      this.opts.toast(err.message, 'error');
    } finally {
      this.busy = null;
      this.el.classList.remove('thinking');
      this.dockShow();
      this.saveMargin();
    }
  }
  proposeRow(ms) {
    const cards = this.d.nodes.filter((n) => n.type !== 'group');
    const b = boundsOf([...cards, ...this.ai.map((a) => ({ ...a, height: this.els.get(a.id)?.offsetHeight || a.height }))]) || { x: 0, y: 0, width: 0, height: 0 };
    const y = cards.length || this.ai.length ? b.y + b.height + 160 : 0;
    let x = b.x;
    const layout = ms.map((m, i) => {
      const n = this.d.nodes.find((c) => c.type === 'file' && c.file === m.path);
      const width = n?.width || 420;
      const height = n?.height || 560;
      const box = { x, y, width: width + PAD * 2, height: height + HEAD + PAD };
      x += box.width + 60;
      const date = m.date ? `${m.estimated ? '\u2248' : ''}${m.date}` : 'no date';
      return { name: `${i + 1} \u00B7 ${date}`, path: m.path, id: n?.id || null, box, at: { x: box.x + PAD, y: box.y + HEAD }, width, height };
    });
    this.proposal = { kind: 'row', layout };
    const added = layout.filter((g) => !g.id).length;
    const day = (m) => `${m.estimated ? '\u2248' : ''}${m.date || '?'}`;
    this.say(`${ms.length} meetings, ${day(ms[0])} \u2192 ${day(ms.at(-1))}${added ? ` (${added} not on the desk yet)` : ''}: Tab lays them out in order, below, Esc not. Then Tab keeps the card.`);
    this.render();
    this.fit(true, [...cards, ...layout.map((g) => g.box)]);
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
    } else if (p.kind === 'row') {
      // A card taken off the desk since: brought back.
      for (const g of p.layout) if (g.id && !this.d.nodes.some((n) => n.id === g.id)) g.id = null;
      const groups = p.layout.map((g) => ({ id: newId(), type: 'group', label: g.name, ...g.box }));
      const added = p.layout.filter((g) => !g.id).map((g) => ({ id: newId(), type: 'file', file: g.path, ...g.at, width: g.width, height: g.height }));
      const pos = new Map(p.layout.filter((g) => g.id).map((g) => [g.id, g.at]));
      const ids = p.layout.map((g) => g.id || added.find((a) => a.file === g.path).id);
      const has = (a, b) => this.d.edges.some((e) => e.fromNode === a && e.toNode === b);
      const edges = ids.slice(1).map((id, i) => [ids[i], id]).filter(([a, b]) => !has(a, b)).map(([a, b]) => ({ id: newId(), fromNode: a, fromSide: 'right', toNode: b, toSide: 'left' }));
      this.change({ ...this.d, nodes: [...groups, ...this.d.nodes.map((n) => (pos.has(n.id) ? { ...n, ...pos.get(n.id) } : n)), ...added], edges: [...this.d.edges, ...edges] });
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
    const all = button('Keep all', 'Keep all that came with it as cards of the desk (\u21E7Tab)', () => this.keepAll(a));
    const note = button('Make a note…', 'A new note of it, on the desk in its place', () => this.makeNote(a));
    const read = button('Read into it', 'What the rules can\u2019t tell: the same to-dos written differently, what goes against what, what holds now, what to raise first. The meetings (not private ones) go to the margin', () => this.readTrail(a));
    const drop = button('×', 'Let it go (Esc)', () => this.drop(a), 'ghost');
    const todos = button('Add the to-dos\u2026', 'Its next to-dos at the end of the assistant\u2019s list, proposed in the red pen review (those there already are left out)', () => this.addTodos(a));
    const decided = button('Carry the decisions into the notes\u2026', 'Every line of its notes that no longer agrees with what you decided, and each decision recorded once: shown first, note by note (its notes and decisions go to Claude); nothing changes until you propose it', () => this.changesPlan());
    const propose = button('Propose in the notes', 'Each note\u2019s changes in its red pen review, to accept or not', () => this.proposeChanges(a));
    const foot = el('div', 'desk-ai-foot', keep, all, note, read, todos, decided, propose, drop);
    const e = el('div', 'desk-card t-ai', head, body, foot);
    e.dataset.id = a.id;
    e.show = (x) => {
      e.className = `desk-card t-ai k-${x.kind} s-${x.state}`;
      Object.assign(e.style, { left: `${x.x}px`, top: `${x.y}px`, width: `${x.width}px`, minHeight: `${x.height}px` });
      head.textContent = x.kind === 'question' ? 'Question' : x.title || 'Margin';
      if (x.state === 'error') body.textContent = x.text;
      else if (e.src !== x.text) { body.innerHTML = this.opts.render(x.text || ''); e.src = x.text; }
      note.hidden = x.kind !== 'merge' || x.state !== 'done';
      read.hidden = x.kind !== 'trail' || x.state !== 'done' || !x.paths?.length;
      todos.hidden = !(x.kind === 'review' && x.title === 'Wrap-up' && this.opts.todoFile && /^- \[ \] /m.test(x.text || ''));
      decided.hidden = !(x.kind === 'review' && x.title === 'Wrap-up' && x.decisions?.length && this.opts.changes);
      propose.hidden = !(x.kind === 'review' && x.changes?.length);
      keep.disabled = x.state !== 'done';
      // What was jotted, sorted: taken into "This time" (a to-do, kept as a card).
      keep.textContent = x.jot?.ticks && x.jot.kind === 'done' ? 'Mark it done' : x.jot && x.jot.kind !== 'todo' ? 'Into This time' : 'Keep';
      keep.title = x.jot && x.jot.kind !== 'todo' ? 'Put it in \u201CThis time\u201D, under its part (Tab)' : 'Keep it as a card of the desk (Tab)';
      const n = this.batchOf(x).length;
      all.hidden = n < 2;
      all.textContent = x.jot ? `Take all ${n}` : `Keep all ${n}`;
    };
    return e;
  }
  // What came of one request, together (the questions): done and not kept.
  batchOf(a) { return a?.batch ? this.ai.filter((x) => x.batch === a.batch && x.state === 'done') : a?.state === 'done' ? [a] : []; }
  keep(a) { this.keepCards(a && a.state === 'done' ? [a] : []); }
  keepAll(a) { this.keepCards(this.batchOf(a)); }
  // Cards of the desk made of them, in one step (one ⌘Z).
  keepCards(list) {
    if (!list.length) return;
    const gone = new Set(list);
    this.ai = this.ai.filter((x) => !gone.has(x));
    const nodes = [];
    const edges = [];
    // What was jotted, sorted: a decision, one put off, one still open goes
    // in "This time" (in their words; a decision with its note), not a card.
    let mine = this.d.nodes.find((x) => x.type === 'text' && String(x.text || '').startsWith(THIS_TIME));
    const was = mine?.text;
    let mineText = was;
    let all = this.d.nodes;
    const settled = []; // the margin's cards it settles
    for (const a of list) {
      // Done, and the to-do it does known: that to-do marked done (its card, or one made for it), proposed with the others.
      const t = a.jot?.kind === 'done' || a.jot?.kind === 'decided' ? a.jot.ticks : null;
      // A decision that settles a to-do: in "This time" too.
      if (t && a.jot.kind === 'decided') mineText = addToThisTime(mineText, { kind: 'decided', words: a.jot.say, note: a.jot.about, settles: a.jot.settles });
      // One taken on this desk: ticked on its card (and so not next any more).
      if (t?.card) {
        all = all.map((n) => (n.id === t.card ? { ...n, text: String(n.text).split(`To-do: \`- [ ] ${t.text}\``).join(`To-do: \`- [x] ${t.text}\``) } : n));
        this.event('marked done', { text: t.text, card: t.card });
        continue;
      }
      // Put off: in "This time" under Later; a to-do of this desk it puts off, not next any more.
      const off = a.jot?.kind === 'later' && a.jot.ticks?.card ? a.jot.ticks : null;
      if (off) all = all.map((n) => (n.id === off.card ? { ...n, text: String(n.text).split(`To-do: \`- [ ] ${off.text}\``).join(`To-do, later: \`${off.text}\``) } : n));
      if (t) {
        const to = { done: true, ...(t.tasks ? { on: today() } : {}) };
        const there = all.find((n) => n.from?.kind === 'todo' && n.from.file === t.file && n.from.key === t.key);
        if (there) all = all.map((n) => (n === there ? { ...n, from: { ...n.from, to } } : n));
        else nodes.push({ id: newId(), type: 'text', text: t.text, x: a.x, y: a.y, width: a.width, height: 120, jotOf: a.jot.of, from: { file: t.file, line: t.line, kind: 'todo', key: t.key, at: today(), ...(t.tasks ? { tasks: true } : {}), to } });
        this.event('marked done', { file: t.file, text: t.text });
        continue;
      }
      // What it settles of what they chose: the margin's card about that, gone with it.
      if (a.jot?.settles) {
        const these = this.ai.filter((x) => x.pick && norm(x.pick) === norm(a.jot.settles));
        if (these.length) { this.ai = this.ai.filter((x) => !these.includes(x)); settled.push(...these); }
      }
      if (a.jot && a.jot.kind !== 'todo') {
        mineText = addToThisTime(mineText, { kind: a.jot.kind === 'done' ? 'decided' : a.jot.kind, words: a.jot.say, note: a.jot.kind === 'decided' ? a.jot.about : '', settles: a.jot.settles });
        this.event('noted', { title: a.title, text: a.jot.say, ...(a.jot.about ? { file: a.jot.about } : {}) });
        continue;
      }
      const h = Math.round((this.els.get(a.id)?.offsetHeight || a.height));
      const n = { id: newId(), type: 'text', text: a.text, x: a.x, y: a.y, width: a.width, height: Math.max(60, h), ...(a.jot?.of ? { jotOf: a.jot.of } : {}), ...(a.kind === 'review' && !a.jot && (a.title === 'Wrap-up' || a.changes) ? { jotted: a.at || Date.now() } : {}) };
      // An answer about a marked part: it stays its answer (and an arrow from the mark says so).
      const m = a.of && this.d.nodes.find((x) => x.id === a.of && x.from?.kind === 'region');
      if (m) { n.from = { file: m.from.file, kind: 'answer', rect: m.from.rect, of: m.id, at: today() }; edges.push({ id: newId(), fromNode: m.id, toNode: n.id }); }
      // Taken: which card it became (the wrap-up reads that card as it is then).
      if (a.kind === 'review' && a.title !== 'Wrap-up') this.event('taken', { title: a.title, text: a.text, card: n.id });
      nodes.push(n);
    }
    if (mineText != null && mineText !== was) {
      const h = Math.max(mine?.height || 0, 74 + 21 * mineText.split('\n').length);
      if (mine) all = all.map((n) => (n === mine ? { ...n, text: mineText, height: h } : n));
      else { const at = this.spot(this.d.nodes.filter((n) => n.type !== 'group'), 360, h); mine = { id: newId(), type: 'text', text: mineText, x: at.x, y: at.y, width: 360, height: h }; all = [...all, mine]; }
      if (!nodes.length) nodes.push(all.find((n) => n.id === mine.id));
    }
    this.sel = new Set(nodes.map((n) => n.id));
    this.change({ ...this.d, nodes: this.streamed([...all, ...nodes.filter((n) => !all.includes(n))]), edges: [...this.d.edges, ...edges] });
    // ⌘Z gives them back to the margin (⇧⌘Z takes them again).
    this.taken.push({ at: this.undo.length, cards: [...list, ...settled] });
    this.fitStream();
    if (this.jotStatus && list.some((a) => a.jot)) this.jotStatus.textContent = '';
    if (mineText != null && mineText !== was) this.say('Put in \u201CThis time\u201D (\u2318Z gives it back to the margin).');
  }
  drop(a) {
    if (!a) return;
    if (a.kind === 'review' && a.title !== 'Wrap-up') this.event('let go', { title: a.title, text: a.text });
    this.ai = this.ai.filter((x) => x !== a);
    if (this.opts.review) this.streamNow(); else this.render();
  }
  // ---- a review's desk, kept in order: under its goal, one column — what
  // was jotted (the newest first), each with what it was sorted into (to
  // take, or taken), and the wrap-ups and changes made — and the margin's
  // cards one under another; closed up when one goes.
  streamed(nodes) {
    if (!this.opts.review) return nodes;
    // What was sorted of a jot no longer on the desk (taken back, deleted) goes with it.
    this.ai = this.ai.filter((a) => !a.jot?.of || nodes.some((n) => n.id === a.jot.of));
    this.reflowed(nodes);
    const g = nodes.find((n) => n.type === 'group' && n.label === 'The goal');
    const top = nodes.filter((n) => n.type === 'text' && (String(n.text).startsWith(THIS_TIME) || /^\*\*[^*]+\*\*\n\nGoal \(/.test(String(n.text))));
    const x0 = g ? g.x + 40 : 0;
    // Its group as tall as its cards (This time grows).
    const bottom = Math.max(0, ...top.map((n) => n.y + this.tall(n)));
    if (g && bottom + 16 > g.y + g.height) nodes = nodes.map((n) => (n === g ? { ...n, height: bottom + 16 - g.y } : n));
    let y = Math.max(g ? g.y + g.height : 0, bottom) + 48;
    const isJot = (n) => n.type === 'text' && (n.jotted || /^\*\*Jotted\*\* \u00B7/.test(String(n.text)));
    const heads = [...nodes.filter(isJot).map((n, i) => ({ n, at: n.jotted || i })), ...this.ai.filter((a) => a.kind === 'review' && !a.jot && (a.title === 'Wrap-up' || a.changes)).map((a) => ({ n: a, at: a.at || 0 }))].sort((p, q) => q.at - p.at);
    const pos = new Map();
    for (const { n } of heads) {
      pos.set(n.id, { x: x0, y });
      y += this.tall(n) + 12;
      if (!isJot(n)) { y += 20; continue; }
      for (const c of [...nodes.filter((k) => k.jotOf === n.id), ...this.ai.filter((a) => a.jot?.of === n.id)]) { pos.set(c.id, { x: x0 + STREAM_IN, y }); y += this.tall(c) + 10; }
      y += 20;
    }
    for (const a of this.ai) if (pos.has(a.id)) Object.assign(a, pos.get(a.id));
    return nodes.map((n) => (pos.has(n.id) && (n.x !== pos.get(n.id).x || n.y !== pos.get(n.id).y) ? { ...n, ...pos.get(n.id) } : n));
  }
  // The margin's cards (what the review said), one under another from where the first is.
  reflowed(nodes) {
    const col = this.ai.filter((a) => a.kind === 'review' && !a.jot && a.title !== 'Wrap-up' && !a.changes).sort((p, q) => p.y - q.y);
    if (col.length) {
      const x = Math.min(...col.map((a) => a.x));
      let y = Math.min(...col.map((a) => a.y));
      for (const a of col) { a.x = x; a.y = y; y += this.tall(a) + 12; }
    }
    return nodes;
  }
  // How tall a card is drawn (not far away: its title is drawn larger there).
  tall(n) { return Math.max(n.height || 0, this.el.classList.contains('far') ? 0 : this.els.get(n.id)?.offsetHeight || 0); }
  streamNow() {
    const next = this.streamed(this.d.nodes);
    if (next.some((n, i) => n !== this.d.nodes[i])) this.change({ ...this.d, nodes: next }); else this.render();
    this.fitStream();
  }
  // Its cards (This time, what was jotted) as tall as what they say, once
  // drawn — not a step of their own to take back.
  fitStream() {
    if (!this.opts.review) return;
    cancelAnimationFrame(this.fitting);
    this.fitting = requestAnimationFrame(() => {
      if (this.el.classList.contains('far') || !this.el.isConnected) { this.fitLater = true; return; } // (measured when near, and shown, again)
      this.fitLater = false;
      const ours = (n) => n.type === 'text' && (String(n.text).startsWith(THIS_TIME) || n.jotted || n.jotOf || /^\*\*Jotted\*\* \u00B7/.test(String(n.text)));
      let changed = false;
      const nodes = this.d.nodes.map((n) => {
        const e = ours(n) && this.els.get(n.id);
        if (!e) return n;
        const was = e.style.height;
        e.style.height = 'auto';
        const drawn = Math.ceil(e.offsetHeight);
        e.style.height = was;
        const h = Math.max(60, drawn);
        if (!drawn || Math.abs(h - n.height) < 4) return n;
        changed = true;
        return { ...n, height: h };
      });
      // Placed again, as drawn now (a card first drawn may measure otherwise).
      const where = () => this.ai.map((a) => `${a.x},${a.y}`).join(' ');
      const before = where();
      const next = this.streamed(nodes);
      changed ||= next.some((n, i) => n !== nodes[i]);
      if (!changed && where() === before) return;
      if (changed) { this.d = { ...this.d, nodes: next }; this.opts.onChange(stringifyDesk(this.d)); }
      this.render();
    });
  }
  // What was done on a review's desk, for its wrap-up (opts.onEvent: kept beside it).
  event(type, info) { if (this.opts.review) this.opts.onEvent?.(type, info); }
  async wrapUp() {
    const files = [...new Set([...this.d.nodes.filter((n) => n.from?.file && (n.from.kind === 'todo' || n.from.kind === 'question')).map((n) => n.from.file), ...thisTimeOf(this.d).decided.map((l) => decisionOf(l).note).filter(Boolean), ...this.d.nodes.filter((n) => n.type === 'file' && /\.md$/i.test(n.file)).map((n) => n.file)])];
    const notes = new Map();
    for (const f of files) { try { notes.set(f, await this.opts.readNote(f)); } catch { notes.set(f, ''); } }
    let ledger = [];
    try { ledger = (await this.opts.ledger?.()) || []; } catch { /* none kept */ }
    const d = new Date();
    const { text, decisions } = wrapUp({ desk: this.d, ledger, notes, now: `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` });
    // One wrap-up: the one not kept before, replaced.
    this.ai = this.ai.filter((a) => !(a.kind === 'review' && a.title === 'Wrap-up'));
    const card = this.addAi({ kind: 'review', title: 'Wrap-up', x: 0, y: 0, width: 460, height: 420, text, state: 'done', at: Date.now(), decisions: decisions.filter((x) => !x.inNote).map(({ words }) => ({ words })) }, false);
    this.streamNow();
    this.show(card, true);
    this.event('wrap-up', { text: '' });
  }
  // A wrap-up's next to-dos, at the end of the assistant's list (as it adds
  // its own): proposed in the red pen review; one there already is left out.
  async addTodos(a) {
    const file = this.opts.todoFile;
    const lines = [...String(a.text || '').matchAll(/^(- \[ \] .+)$/gm)].map((m) => m[1].trim());
    if (!file || !lines.length) return;
    let added = [];
    try {
      const ok = await this.opts.proposeNote(file, (text) => {
        const have = new Set(text.split('\n').map(norm));
        added = lines.filter((l) => !have.has(norm(l)));
        return added.length ? `${text.replace(/\s*$/, '')}\n${added.join('\n')}\n` : text;
      });
      if (ok !== false && added.length) this.event('to-dos proposed', { file, text: added.join('\n') });
    } catch { /* said already */ }
  }
  // What they decided, carried into the notes: a card showing each line to
  // change, note by note, and each decision recorded (nothing changed yet).
  async changesPlan() {
    if (this.planning) return;
    this.planning = true;
    if (this.dock.classList.contains('min')) this.foldDock(false);
    const wait = this.say('Reading the notes for what your decisions change\u2026');
    const t0 = Date.now();
    const tick = setInterval(() => { wait.textContent = `Reading the notes for what your decisions change\u2026 ${Math.round((Date.now() - t0) / 1000)}s (about half a minute)`; }, 1000);
    try {
      const r = await this.opts.changes();
      wait.remove();
      if (!r.decided?.length) { this.say('Nothing decided yet: jot what you decided (i), or write it under Decided in \u201CThis time\u201D.'); return; }
      this.ai = this.ai.filter((x) => !(x.kind === 'review' && x.changes));
      const card = this.addAi({ kind: 'review', title: 'Changes to the notes', x: 0, y: 0, width: 520, height: 300, text: changesText(r), state: 'done', at: Date.now(), changes: r.changes }, false);
      this.streamNow();
      this.show(card, true);
    } catch (e) { wait.textContent = `Not read: ${e.message}`; wait.classList.add('error'); } finally { clearInterval(tick); this.planning = false; }
  }
  // Each note's changes in its red pen review (the note as it is now: a line
  // no longer as it was is left, and said).
  async proposeChanges(a) {
    const by = new Map();
    for (const c of a.changes || []) by.set(c.file, [...(by.get(c.file) || []), c]);
    const done = [];
    let missed = 0;
    const failed = [];
    for (const [file, cs] of by) {
      let r = { made: 0, missed: 0 };
      try {
        const id = await this.opts.proposeNote(file, (text) => { r = withChanges(text, cs); return r.text; }, { open: false });
        missed += r.missed;
        if (id && r.made) { done.push({ file, id }); this.event('changes proposed', { file, text: cs.map((c) => c.add || `${c.was} \u2192 ${c.now}`).join('\n').slice(0, 4000) }); }
      } catch (e) { failed.push(`${file.split('/').pop().replace(/\.md$/i, '')}: ${e.message}`); }
    }
    // Their reviews, waiting: one by one from here (none opened by itself).
    const row = this.say(`Proposed in ${done.length} note${done.length === 1 ? '' : 's'}, each waiting in its red pen review${missed ? `; ${missed} line${missed === 1 ? ' was' : 's were'} no longer as read, left` : ''}${failed.length ? `; not proposed \u2014 ${failed.join('; ')}` : ''}.`);
    if (this.opts.openReview) for (const d of done) row.append(button(d.file.split('/').pop().replace(/\.md$/i, ''), `Its red pen review: ${d.file}`, () => this.opts.openReview(d.id), 'desk-review-link'));
    if (done.length) { this.foldDock(false); this.dockShow(); }
  }
  // What they jotted (Enter, at the bottom): on the desk as written, and
  // sorted by the margin — each thing a card beside it: decided, later,
  // still open (Tab puts it in "This time"), to do (Tab keeps it, its
  // to-do for the wrap-up) — or let go (Esc).
  async jot(text) {
    const d = new Date();
    // As written, a line a line (a list when more than one).
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const raw = `**Jotted** \u00B7 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}\n\n${lines.length > 1 ? lines.map((l) => (/^[-*] /.test(l) ? l : `- ${l}`)).join('\n') : text}`;
    const card = { id: newId(), type: 'text', text: raw, x: 0, y: 0, width: STREAM_W, height: 74 + 21 * raw.split('\n').length, jotted: Date.now() };
    this.change({ ...this.d, nodes: this.streamed([...this.d.nodes, card]) });
    this.fitStream();
    this.show(card);
    this.event('jotted', { text, card: card.id });
    this.jotStatus.textContent = 'Sorting what you jotted\u2026';
    let r;
    try { r = await this.opts.jot(text); } catch (e) { this.jotStatus.textContent = `Not sorted: ${e.message} \u2014 it is on the desk as you wrote it.`; return; }
    const items = r?.items || [];
    if (!items.length) { this.jotStatus.textContent = 'Nothing to sort in it \u2014 it is on the desk as you wrote it.'; return; }
    const TITLE = { decided: 'Decided', later: 'Later', open: 'Still open', todo: 'To do', done: 'Done' };
    const batch = newId();
    for (const it of items) {
      const body = [it.say, it.about ? `\nAbout: [[${it.about.replace(/\.md$/i, '')}]]` : '', it.settles ? `\nSettles: ${it.settles}` : '', it.todo ? `\nTo-do: \`${it.todo}\`` : '', it.ticks ? `\n${it.kind === 'later' ? 'Puts off' : 'Ticks off'}: ${it.ticks.text}${it.ticks.file ? ` \u2014 [[${it.ticks.file.replace(/\.md$/i, '')}]]` : ' (on this desk)'}` : ''].filter(Boolean).join('\n');
      this.addAi({ kind: 'review', batch, title: `Jotted \u00B7 ${TITLE[it.kind] || 'Margin'}`, text: body, jot: { kind: it.kind, say: it.say, about: it.about || '', settles: it.settles || '', of: card.id, ...(it.ticks ? { ticks: it.ticks } : {}) }, x: 0, y: 0, width: STREAM_W - STREAM_IN, height: 74 + 21 * body.split('\n').length, state: 'done' }, false);
    }
    this.streamNow();
    this.jotStatus.textContent = `${items.length} sorted, under it: Tab takes the newest, \u21E7Tab all ${items.length}, Esc lets one go.`;
  }
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
      const r = await this.opts.ask({ task: 'chat', cards: await this.cardsFor(ns), question: q, talk: this.talkKey }, (said) => { row.innerHTML = this.opts.render(said); this.log.scrollTop = this.log.scrollHeight; });
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
