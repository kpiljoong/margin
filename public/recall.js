// The margin remembers (rules only; nothing is sent anywhere): beside a line,
// what the other notes already say about it — the same to-do still open or
// ticked there, a question asked before or decided, a decision made before
// (in the same words or near them); beside a paragraph, the paragraphs of
// other notes that are about the same (paraIndex: no model, its words and
// their pieces, weighted by how rare they are). The server reads every
// note's to-do, decision and question lines and its text (server.js
// recallLines); this matches them.
//
// Plain logic (test/recall.test.mjs); app.js shows it in the margin.
import { meetingItems } from './meeting.js';
import { sameOf, dateOf, stemOf } from './trail.js';

// Korean particles at a word's end (a launch "\uCD9C\uC2DC\uB294" is "\uCD9C\uC2DC").
const PARTICLE = /(?:\uC73C\uB85C|\uC5D0\uC11C|\uC5D0\uAC8C|\uAE4C\uC9C0|\uBD80\uD130|\uD55C\uD14C|\uC774\uB791|\uD558\uACE0|\uC740|\uB294|\uC774|\uAC00|\uC744|\uB97C|\uC5D0|\uC758|\uB85C|\uC640|\uACFC|\uB3C4|\uB9CC|\uB791)$/;
const HANGUL = /[\uAC00-\uD7AF]/;
const STOP = new Set(('the a an to of and or in on for is are be we it this that with at by as do not will should can our us you i they ' +
  'was were has have had from but if so then than about into out up all any some no yes our let lets get got make made ' +
  '\uADF8\uB9AC\uACE0 \uADF8\uB798\uC11C \uD558\uC9C0\uB9CC \uC6B0\uB9AC \uC774\uBC88 \uB2E4\uC74C \uAD00\uB828 \uC9C4\uD589 \uD655\uC778 \uACB0\uC815 \uD558\uAE30\uB85C \uC9C8\uBB38 \uD574\uC57C \uD588\uC74C \uC788\uC74C \uC5C6\uC74C \uADF8\uB0E5 \uC815\uB3C4 \uC774\uAC70 \uADF8\uAC70').split(' '));

// The words of a line that say what it is about.
export function wordsOf(s) {
  const out = new Set();
  const t = String(s).toLowerCase().replace(/(^|\s)[#@]\S+/g, ' ').replace(/\[\[|\]\]/g, ' ');
  for (let w of t.match(/[\p{L}\p{N}]+/gu) || []) {
    if (HANGUL.test(w) && w.length > 2) w = w.replace(PARTICLE, '');
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w);
  }
  return out;
}

// One word for another: the same, or one the other's start ("launch" in "launches").
const alike = (a, b) => a === b || (Math.min(a.length, b.length) >= 2 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a)));

// How near a line's words are to an item's: the share of each that the
// other has, both at least `share`, two words at least.
export function nearness(mine, theirs, share = 0.5) {
  if (mine.size < 2 || theirs.size < 2) return 0;
  let both = 0;
  for (const w of theirs) for (const m of mine) if (alike(w, m)) { both++; break; }
  if (both < 2) return 0;
  const a = both / theirs.size;
  const b = both / mine.size;
  return a >= share && b >= share * 0.6 ? (a + b) / 2 : 0;
}

// notes: [{ path, head (its first words, for its date), text (or none), v
// (its version), created, project: [names], lines: [[line, text]] }]
// → { items: [{ path, name, date, estimated, line, raw, project, kind, done, text, same, words }],
//     paras: paraIndex(…) }. prev: the index before (a note's paragraphs
// are read again only when its v changed).
export function recallIndex(notes, prev = null) {
  const items = [];
  for (const n of notes || []) {
    const { date, estimated } = dateOf({ path: n.path, text: n.head ?? n.text?.slice(0, 1500) ?? '', created: n.created });
    const name = stemOf(n.path);
    for (const [line, raw] of n.lines || []) {
      for (const it of meetingItems(raw)) {
        if (!['todo', 'decision', 'question'].includes(it.kind)) continue;
        items.push({ path: n.path, name, date, estimated, line, raw: raw.trim(), kind: it.kind, done: !!it.done, text: it.body, same: sameOf(it.text), words: wordsOf(it.body), project: n.project || [] });
      }
    }
  }
  // A word in many of them (a project's name) says little about any one.
  const df = new Map();
  for (const it of items) for (const w of it.words) df.set(w, (df.get(w) || 0) + 1);
  if (items.length >= 20) {
    const common = new Set([...df].filter(([, k]) => k > items.length * 0.15).map(([w]) => w));
    for (const it of items) it.words = new Set([...it.words].filter((w) => !common.has(w)));
  }
  return { items, paras: paraIndex(notes, prev?.paras) };
}

// ---- paragraphs. A note's paragraphs: [{ line, last, raw (its first
// line), text }] — the lines between blank ones (or headings), a list's
// items each on its own; no front matter or code.
export function parasOf(text) {
  const lines = String(text).split('\n');
  const front = FRONT.exec(text);
  const out = [];
  let cur = null;
  let fence = false;
  const end = () => {
    if (cur) { cur.text = cur.text.replace(/\s+/g, ' ').trim(); if (cur.text) out.push(cur); }
    cur = null;
  };
  for (let i = front ? front[0].split('\n').length : 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(l)) { end(); fence = !fence; continue; }
    if (fence) continue;
    if (!l.trim() || /^\s{0,3}#{1,6}\s/.test(l) || /^\s*(?:[-*_]\s*){3,}$/.test(l)) { end(); continue; }
    if (/^\s?(?:[-*+]|\d+[.)])\s/.test(l)) end();
    if (!cur) cur = { line: i, last: i, raw: l.trim(), text: '' };
    cur.last = i;
    cur.text += ` ${l.replace(/^\s*(?:>\s?)*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s+)?/, '')}`;
  }
  end();
  return out;
}

// What a paragraph is about, as Margin compares it: its words (English
// ones without -s, -ed, -ing), and for Hangul their two-letter pieces too
// (\uB9B4\uB9AC\uC2A4 and \uB9B4\uB9AC\uC988 share \uB9B4\uB9AC), at half weight.
// A Hangul word without the ending of its verb (\uC774\uD0C8\uD55C\uB2E4 is \uC774\uD0C8).
const ENDING = /(?:\uD569\uB2C8\uB2E4|\uD588\uC2B5\uB2C8\uB2E4|\uD55C\uB2E4|\uD588\uB2E4|\uD558\uB2E4|\uD558\uACE0|\uD558\uB294|\uD558\uB2C8|\uD558\uC790|\uD574\uC57C|\uD588\uACE0|\uD574\uC11C|\uD558\uBA74|\uB41C\uB2E4|\uB418\uB294|\uB410\uB2E4|\uC774\uB2E4|\uC600\uB2E4|\uC788\uB2E4|\uC5C6\uB2E4|\uD588\uC74C|\uD568|\uB428)$/;
function featuresOf(text) {
  const f = new Map();
  for (let w of wordsOf(text)) {
    if (HANGUL.test(w)) {
      if (w.length > 3 || (w.length === 3 && ENDING.test(w) && w.replace(ENDING, '').length >= 2)) w = w.replace(ENDING, '') || w;
      f.set(`w${w}`, 1);
      for (let i = 0; i + 1 < w.length; i++) if (!f.has(`b${w.slice(i, i + 2)}`)) f.set(`b${w.slice(i, i + 2)}`, 0.7);
    } else f.set(`w${w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w}`, 1);
  }
  return f;
}
// How many words a paragraph needs to be compared (fewer say too little).
const PARA_WORDS = 4;
const words = (f) => { let n = 0; for (const k of f.keys()) if (k[0] === 'w') n++; return n; };
// A paragraph that says enough to be compared (the local model reads these too).
export const paraWorthy = (text) => words(featuresOf(text)) >= PARA_WORDS;

// Every note's paragraphs, ready to compare: { paras: [{ path, name, date,
// estimated, project, line, last, raw, text, vec }], post (feature → [[i,
// weight]]), idf }. A paragraph's vector: its features by how rare they are
// (idf), at length one.
export function paraIndex(notes, prev = null) {
  const byNote = new Map();
  const paras = [];
  for (const n of notes || []) {
    if (n.text == null) continue;
    const old = prev?.byNote?.get(n.path);
    let mine = old && old.v === n.v && n.v != null ? old.paras : null;
    if (!mine) {
      const { date, estimated } = dateOf({ path: n.path, text: n.text.slice(0, 1500), created: n.created });
      const name = stemOf(n.path);
      mine = parasOf(n.text).map((p) => ({ path: n.path, name, date, estimated, project: n.project || [], ...p, f: featuresOf(p.text) })).filter((p) => words(p.f) >= PARA_WORDS);
    }
    byNote.set(n.path, { v: n.v, paras: mine });
    paras.push(...mine);
  }
  const df = new Map();
  for (const p of paras) for (const k of p.f.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = paras.length;
  const idf = (k) => Math.log(1 + N / (df.get(k) || 1));
  // A feature in most paragraphs (a project's name) tells none apart: not looked up.
  const most = N >= 40 ? N * 0.25 : Infinity;
  const post = new Map();
  paras.forEach((p, i) => {
    p.vec = vecOf(p.f, idf);
    for (const [k, w] of p.vec) {
      if (df.get(k) > most) continue;
      if (!post.has(k)) post.set(k, []);
      post.get(k).push([i, w]);
    }
  });
  return { paras, post, idf, byNote };
}
function vecOf(f, idf) {
  const v = [...f].map(([k, w]) => [k, w * idf(k)]);
  const len = Math.hypot(...v.map(([, w]) => w)) || 1;
  return v.map(([k, w]) => [k, w / len]);
}

// The paragraphs of other notes nearest a text: [{ x, s (0..1), shared
// (words both have) }], best first, one a note, at most `top`.
export function nearParas(pi, path, text, top = 3) {
  if (!pi?.paras?.length) return [];
  const f = featuresOf(text);
  if (words(f) < PARA_WORDS) return [];
  const score = new Map();
  const shared = new Map();
  for (const [k, w] of vecOf(f, pi.idf)) {
    for (const [i, pw] of pi.post.get(k) || []) {
      score.set(i, (score.get(i) || 0) + w * pw);
      if (k[0] === 'w') shared.set(i, (shared.get(i) || 0) + 1);
    }
  }
  const best = new Map();
  for (const [i, s] of score) {
    const x = pi.paras[i];
    if (x.path === path || (shared.get(i) || 0) < 2) continue;
    if (!best.has(x.path) || best.get(x.path).s < s) best.set(x.path, { x, s, shared: shared.get(i) });
  }
  return [...best.values()].sort((a, b) => b.s - a.s).slice(0, top);
}

// A paragraph's first words, as it is quoted (and known by).
export function excerptOf(text, n = 80) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, cut.lastIndexOf(' ') > n / 2 ? cut.lastIndexOf(' ') : n)}\u2026`;
}

const newest = (a, b) => (b.date || '').localeCompare(a.date || '');
const FRONT = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---/;

// ---- what you told it: KNOWN.md, a note of plain lines, one an answer to
// one of its questions (written by the app, yours to read, change or delete):
//   - Same to-do: "Draft the notes" (W 09-03) = "Draft release notes" (1:1 Ann)
//   - Different to-dos: "…" (…) ≠ "…" (…)
//   - Replaces: "Ship on 11/3" (W 09-17) replaces "Ship on 10/20" (W 09-03)
//   - Both hold: "…" (…) and "…" (…)
//   - Not related: "…" (…) and "…" (…)
//   - No date: "…" (…)
// Each quoted text is compared as a to-do is (sameOf).
export const KNOWN_FILE = 'KNOWN.md';
const SEP = '\u0000';
const pairOf = (a, b) => (a < b ? `${a}${SEP}${b}` : `${b}${SEP}${a}`);
const KNOWN_LINE = /^\s*[-*]\s+(Same to-do|Different to-dos|Replaces|Both hold|Not related|No date)\s*:/i;
export function knownOf(md) {
  const k = { same: new Set(), different: new Set(), replaces: new Map(), holds: new Set(), unrelated: new Set(), noDate: new Set() };
  for (const l of String(md || '').split('\n')) {
    const m = KNOWN_LINE.exec(l);
    if (!m) continue;
    const q = [...l.matchAll(/"([^"]*)"/g)].map((x) => sameOf(x[1])).filter(Boolean);
    const what = m[1].toLowerCase();
    if (what === 'no date') { if (q[0]) k.noDate.add(q[0]); continue; }
    if (q.length < 2 || q[0] === q[1]) continue;
    if (what === 'replaces') { k.replaces.set(q[1], q[0]); continue; }
    ({ 'same to-do': k.same, 'different to-dos': k.different, 'both hold': k.holds, 'not related': k.unrelated })[what].add(pairOf(q[0], q[1]));
  }
  return k;
}
// The line an answer adds. a, b: { text, name }.
export function knownLine(answer, a, b) {
  const q = (x) => `"${String(x.text).replace(/"/g, "'").replace(/\s+/g, ' ').trim()}" (${String(x.name).replace(/[()"]/g, '')})`;
  return {
    same: () => `- Same to-do: ${q(a)} = ${q(b)}`,
    different: () => `- Different to-dos: ${q(a)} ≠ ${q(b)}`,
    replaces: () => `- Replaces: ${q(a)} replaces ${q(b)}`,
    holds: () => `- Both hold: ${q(a)} and ${q(b)}`,
    unrelated: () => `- Not related: ${q(a)} and ${q(b)}`,
    nodate: () => `- No date: ${q(a)}`,
  }[answer]?.() || null;
}
const NONE = knownOf('');
// Words told the same, as one: each to the first of them.
function sameAs(known) {
  const up = new Map();
  const find = (s) => { for (let i = 0; up.has(s) && i < 50; i++) s = up.get(s); return s; };
  for (const p of known.same) {
    const [a, b] = p.split(SEP).map(find);
    if (a !== b) up.set(a < b ? b : a, a < b ? a : b);
  }
  return find;
}

// What the other notes say about a note's lines: [{ line, kind, refs }], a
// line once (same: its words as compared, when it is an item). kind: 'open'
// (the same to-do open elsewhere), 'done' (ticked elsewhere), 'still' (ticked
// here, open elsewhere), 'asked' (the question asked before, not decided),
// 'decided' (a decision on the question, or on what a line is about),
// 'answers' (a decision here, a question open elsewhere), 'before' (a decision
// here, one made before on the same), 'replaces' (a decision here you said
// replaces that one). A decision you said another replaced gives way to it.
// refs: the items there, newest first. known: knownOf(KNOWN.md). cache: a Map
// kept while the index and known are. semantic: (text) → { n, list: [{ x
// (a paragraph of index.paras), s, z }] } or null — the local model's
// nearest paragraphs (app.js), used for paragraphs instead of the words.
// judge: (text, refs) → for each ref { rel, why }, { reading: true } (being
// read now: as found, marked reading) or undefined (not read
// yet) — what Claude says of them (app.js): the first JUDGED only, 'none'
// left out, the others with what it said.
export function recall(index, path, text, { cache = null, max = 40, known = NONE, semantic = null, judge = null } = {}) {
  const c = context(index, path, known, cache, semantic, judge);
  if (!c) return [];
  const { bySame, decisions, near, canon, latest } = c;
  const mine = new Map(meetingItems(text).map((it) => [it.line, it]));
  const out = [];
  for (const [i, l] of bodyLines(text)) {
    if (out.length >= max) break;
    const it = mine.get(i);
    const key = `${path}${SEP}${it ? `${it.kind}${it.done ? '+' : ''}` : ''}|${l}`;
    let r = cache?.get(key);
    if (r === undefined) {
      r = it ? ofItem(it) : ofLine(l);
      cache?.set(key, r);
    }
    if (r) out.push({ line: i, same: it ? sameOf(it.text) : null, ...r });
  }
  // A paragraph none of whose lines has a card: the other notes' paragraphs
  // about the same, the RELATED_MAX nearest.
  const taken = new Set(out.map((r) => r.line));
  const related = [];
  for (const p of parasOf(text)) {
    let free = true;
    for (let i = p.line; i <= p.last && free; i++) free = !taken.has(i);
    if (!free) continue;
    const refs = c.relatedTo(p.text);
    if (refs.length) related.push({ line: p.line, last: p.last, same: null, kind: 'related', refs, rank: refs[0].rank });
  }
  out.push(...related.sort((a, b) => b.rank - a.rank).slice(0, RELATED_MAX));
  return out.sort((a, b) => a.line - b.line);

  function ofItem(it) {
    if (!['todo', 'decision', 'question'].includes(it.kind)) return null;
    const me = sameOf(it.text);
    const same = (bySame.get(canon(me)) || []).sort(newest);
    const words = wordsOf(it.body);
    if (it.kind === 'todo') {
      const todos = same.filter((x) => x.kind === 'todo');
      if (it.done) { const open = todos.filter((x) => !x.done); return open.length ? { kind: 'still', refs: open } : null; }
      if (!todos.length) return null;
      return todos[0].done ? { kind: 'done', refs: todos.filter((x) => x.done) } : { kind: 'open', refs: todos.filter((x) => !x.done) };
    }
    if (it.kind === 'question') {
      const decided = same.filter((x) => x.kind === 'decision');
      const nearBy = latest(decided.length ? decided : near(words, decisions, 0.5, me));
      if (nearBy.length) return { kind: 'decided', refs: nearBy };
      const asked = same.filter((x) => x.kind === 'question');
      return asked.length ? { kind: 'asked', refs: asked } : null;
    }
    const mineReplaces = decisions.filter((x) => known.replaces.get(x.same) === me);
    if (mineReplaces.length) return { kind: 'replaces', refs: mineReplaces };
    const before = latest(near(words, decisions, 0.5, me).filter((x) => x.same !== me));
    if (before.length) return { kind: 'before', refs: before };
    const asked = same.filter((x) => x.kind === 'question');
    if (asked.length) return { kind: 'answers', refs: asked };
    const again = same.filter((x) => x.kind === 'decision');
    return again.length ? { kind: 'before', refs: again } : null;
  }

  // A line that isn't a to-do, a decision or a question: a decision made on
  // what it is about, if its words are near enough (a heading or a short
  // line says too little).
  function ofLine(l) {
    if (/^\s*#{1,6}\s/.test(l) || /^\s*(?:\*\*)?Previous meeting/i.test(l)) return null;
    const words = wordsOf(l);
    if (words.size < 3) return null;
    const found = latest(near(words, decisions, 0.6));
    return found.length ? { kind: 'decided', refs: found } : null;
  }
}

// The other notes' items, as recall and asks use them.
function context(index, path, known, cache = null, semantic = null, judge = null) {
  const others = (index?.items || []).filter((x) => x.path !== path);
  if (!others.length && !index?.paras?.paras?.length) return null;
  const canon = sameAs(known);
  const bySame = new Map();
  for (const x of others) { const k = canon(x.same); if (!bySame.has(k)) bySame.set(k, []); bySame.get(k).push(x); }
  const decisions = others.filter((x) => x.kind === 'decision');
  const bySameDecision = new Map(decisions.map((x) => [x.same, x]));
  // Not near: what you said is a different thing, or not related.
  const told = (a, b) => known.unrelated.has(pairOf(a, b)) || known.different.has(pairOf(a, b));
  const near = (words, pool, share, me = null) => pool
    .filter((x) => !me || !told(me, x.same))
    .map((x) => [x, nearness(words, x.words, share)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => x);
  // A decision replaced: the one that replaced it (as known), once each.
  const latest = (list) => {
    const out = [];
    for (let x of list) {
      for (let i = 0; i < 10 && x.kind === 'decision' && known.replaces.has(x.same); i++) {
        const next = bySameDecision.get(known.replaces.get(x.same));
        if (!next) break;
        x = { ...next, was: x.text };
      }
      if (!out.some((y) => y.path === x.path && y.line === x.line)) out.push(x);
    }
    return out;
  };
  // The paragraphs of other notes about what a text is (near enough to show,
  // or to ask about), but not those you said are not related: [{
  // …paragraph, s, rank }]. semantic: the local model's (none while it
  // hasn't answered), else by the words.
  const relatedTo = (t, ask = false) => {
    let found;
    if (semantic) {
      const r = semantic(t);
      if (!r) return [];
      const need = semanticNeed(r.n) + (ask ? 0.5 : 0);
      const close = SEMANTIC_CLOSE + (ask ? 0.01 : 0);
      found = r.list.filter((x) => x.z >= need || (x.s >= close && x.z >= 1.5)).map((x) => ({ ...x, rank: x.z }));
    } else {
      const k = `p${SEP}${path}${SEP}${t}`;
      let near = cache?.get(k);
      if (!near) { near = nearParas(index.paras, path, t, 4); cache?.set(k, near); }
      found = near.filter((x) => x.s >= (ask ? RELATED_ASK : RELATED_CARD)).map((x) => ({ ...x, rank: x.s }));
    }
    const me = sameOf(excerptOf(t));
    const refs = found.filter((r) => !told(me, sameOf(excerptOf(r.x.text)))).map((r) => ({ ...r.x, s: r.s, rank: r.rank }));
    if (!judge || !refs.length) return refs;
    const top = refs.slice(0, JUDGED);
    const said = judge(t, top) || [];
    return top.flatMap((r, i) => (said[i]?.rel === 'none' ? [] : said[i]?.reading ? [{ ...r, reading: true }] : said[i] ? [{ ...r, rel: said[i].rel, why: said[i].why }] : [r]));
  };
  return { others, bySame, decisions, near, canon, latest, told, relatedTo };
}
// How near a paragraph must be to show beside one (RELATED_CARD), and to
// ask about (RELATED_ASK); RELATED_MAX cards of them in a note at most.
const RELATED_CARD = 0.25;
const RELATED_ASK = 0.33;
const RELATED_MAX = 8;
// The local model's paragraphs (lib/embed-worker.mjs) come with z: how far
// above that paragraph's usual nearness to all n of them. The best of n
// unrelated ones is about sqrt(2 ln n) by chance: it takes half more than
// that, and 3.5 at least.
const JUDGED = 3;

// The paragraphs of other notes that may bear on a text, for the margin that
// thinks along (app.js): more than are shown as related — the model reads
// them and keeps what helps. [{ path, line }]; null while the local model
// hasn't answered.
export function nearFor(index, path, text, { semantic = null, cache = null, max = 5 } = {}) {
  if (!index?.paras) return [];
  if (semantic) {
    const r = semantic(text);
    return r ? r.list.filter((x) => x.z >= 1).slice(0, max).map(({ x }) => ({ path: x.path, line: x.line })) : null;
  }
  const k = `p${SEP}${path}${SEP}${text}`;
  let near = cache?.get(k);
  if (!near) { near = nearParas(index.paras, path, text, 4); cache?.set(k, near); }
  return near.filter((x) => x.s >= 0.12).slice(0, max).map(({ x }) => ({ path: x.path, line: x.line }));
}
export const semanticNeed = (n) => Math.max(3.5, Math.sqrt(2 * Math.log(Math.max(2, n))) + 0.5);
// Or as close as two ways of saying one thing (in a few notes all about the
// same, none stands out, but these do).
const SEMANTIC_CLOSE = 0.9;

// A note's lines that say something: [[line, text]] (no front matter, code
// or blank lines).
function bodyLines(text) {
  const lines = String(text).split('\n');
  const front = FRONT.exec(text);
  const out = [];
  let fence = false;
  for (let i = front ? front[0].split('\n').length : 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!fence && l.trim()) out.push([i, l]);
  }
  return out;
}

// A line that says something is to be done, with no day to it (not a to-do).
const MUST = /\uC57C\s?(?:\uD55C\uB2E4|\uD568|\uD574|\uD569\uB2C8\uB2E4|\uACA0|\uB3FC|\uB41C\uB2E4|\uD560\s?(?:\uAC83|\uC77C))|\uD558\uAE30\uB85C \uD588|\uD560 \uAC83|\b(?:need|needs|have|has) to\b|\bmust\b|\bfollow[ -]up\b/i;
const WHEN = /\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}\b|\d+\s*\uC6D4\s*\d+\s*\uC77C|\uAE4C\uC9C0|\uB0B4\uC77C|\uBAA8\uB808|\uC624\uB298|\uC774\uBC88 \uC8FC|\uB2E4\uC74C \uC8FC|\uC6D4\uC694\uC77C|\uD654\uC694\uC77C|\uC218\uC694\uC77C|\uBAA9\uC694\uC77C|\uAE08\uC694\uC77C|\uC8FC\uB9D0|\uC6D4\uB9D0|\b(?:by|until|before|on|tomorrow|today|tonight|next|this) (?:mon|tue|wed|thu|fri|sat|sun|week|month|tomorrow|end|eod)|\b(?:tomorrow|today|tonight|asap|eod)\b/i;
export const mustLine = (l) => MUST.test(l) && !WHEN.test(l) && !/^\s*(?:#|>|\||```|~~~)/.test(l) && l.length <= 300;

// What the margin would ask about a note, nearest the cursor first (never
// the line or paragraph being written): [{ line, kind, key, a, b, … }].
// kind: 'same' (is this to-do that one, in other words?), 'replaces' (does
// this decision replace that one?), 'due' (by when? — an open to-do with
// someone on it and no date, or a line that says something must be done;
// prose: true), 'related' (is this paragraph about that one? last: its last
// line), 'project' (what is the note about? — the projects of the notes its
// lines and paragraphs meet). a: this line's { text, name }; b: the other
// item or paragraph.
export function asks(index, path, text, { known = NONE, cursor = -1, projects = null, cache = null, semantic = null, judge = null } = {}) {
  const c = context(index, path, known, cache, semantic, judge);
  if (!c) return [];
  const { bySame, others, near, canon } = c;
  const name = stemOf(path);
  const out = [];
  const met = new Map(); // project → notes met
  const items = meetingItems(text);
  for (const it of items) {
    if (it.line === cursor) continue;
    const me = sameOf(it.text);
    const a = { text: it.body, name };
    if (it.kind === 'todo' && !it.done) {
      const other = near(wordsOf(it.body), others.filter((x) => x.kind === 'todo' && canon(x.same) !== canon(me)), 0.5, me)[0];
      if (other && !known.same.has(pairOf(me, other.same))) out.push({ line: it.line, kind: 'same', key: `same${SEP}${pairOf(me, other.same)}`, a, b: other });
      else if (it.owner && !it.due && !known.noDate.has(me)) out.push({ line: it.line, kind: 'due', key: `due${SEP}${me}`, a, owner: it.owner });
    }
    if (it.kind === 'decision') {
      const pairs = (x) => known.replaces.get(x.same) === me || known.replaces.get(me) === x.same || known.holds.has(pairOf(me, x.same));
      const other = near(wordsOf(it.body), c.decisions, 0.5, me).filter((x) => x.same !== me && !pairs(x))[0];
      if (other) out.push({ line: it.line, kind: 'replaces', key: `replaces${SEP}${pairOf(me, other.same)}`, a, b: other });
    }
    for (const x of [...(bySame.get(canon(me)) || []), ...near(wordsOf(it.body), others, 0.5)]) {
      for (const p of x.project || []) { if (!met.has(p)) met.set(p, new Set()); met.get(p).add(x.path); }
    }
  }
  // Paragraphs: one about another note's, the note not linked to it yet;
  // a line that must be done, by no day.
  const lines = String(text).split('\n');
  const itemLines = new Set(items.map((it) => it.line));
  const links = new Set([...String(text).matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().toLowerCase()));
  let meets = 0;
  for (const p of parasOf(text)) {
    const writing = cursor >= p.line && cursor <= p.last;
    const best = c.relatedTo(p.text, true)[0];
    if (best) {
      meets++;
      for (const pr of best.project || []) { if (!met.has(pr)) met.set(pr, new Set()); met.get(pr).add(best.path); }
      if (!writing && !links.has(best.name.toLowerCase())) {
        const b = { ...best, text: excerptOf(best.text) };
        out.push({ line: p.line, last: p.last, kind: 'related', key: `related${SEP}${pairOf(sameOf(excerptOf(p.text)), sameOf(b.text))}`, a: { text: excerptOf(p.text), name }, b });
      }
    }
    for (let i = p.line; i <= p.last; i++) {
      const l = lines[i];
      if (i === cursor || itemLines.has(i) || !mustLine(l) || known.noDate.has(sameOf(l))) continue;
      out.push({ line: i, kind: 'due', prose: true, key: `due${SEP}${sameOf(l)}`, a: { text: l.trim(), name }, raw: l });
    }
  }
  // The note's project, when it names none and its lines meet notes that do.
  const fm = FRONT.exec(text)?.[0] || '';
  if (projects && items.length + meets >= 2 && !/^(projects?|tags)\s*:/im.test(fm) && met.size) {
    const pick = [...met].sort((x, y) => y[1].size - x[1].size).slice(0, 3).map(([p, ps]) => ({ name: p, notes: ps.size }));
    out.push({ line: 0, kind: 'project', key: `project${SEP}${path}`, a: { text: '', name }, pick });
  }
  return out.sort((x, y) => Math.abs(x.line - cursor) - Math.abs(y.line - cursor));
}

// What a question says (English, as the app).
export function askText(q) {
  const when = (x) => `${x.name}${x.date ? `, ${x.estimated ? '≈' : ''}${x.date.slice(5)}` : ''}`;
  switch (q.kind) {
    case 'same': return `The same to-do as “${q.b.text}” (${when(q.b)})?`;
    case 'replaces': return `Does this replace “${q.b.text}” (${when(q.b)})?`;
    case 'due': return q.prose ? 'To be done by when?' : `By when${q.owner ? ` (@${q.owner})` : ''}?`;
    case 'related': return `About the same as \u201C${q.b.text}\u201D (${when(q.b)})?`;
    case 'project': return 'What is this note about?';
    default: return '';
  }
}

// "By when?" answered: the to-do's line with the date at its end.
export function withDue(line, date) {
  return `${line.replace(/\s+$/, '')} \u{1F4C5} ${date}`;
}
// "About the same?" answered yes: a link to that note at the paragraph's end.
export function withLink(line, name) {
  return `${line.replace(/\s+$/, '')} [[${name}]]`;
}
// "What is it about?" answered: the note with "project:" in its front matter.
export function withProject(text, project) {
  const fm = FRONT.exec(text);
  if (fm) {
    const end = fm[0].lastIndexOf('\n---');
    return `${text.slice(0, end)}\nproject: ${project}${text.slice(end)}`;
  }
  return `---\nproject: ${project}\n---\n${text}`;
}

// What a card says: { chip, says } (English, as the app).
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
export function recallText(r) {
  const n = new Set(r.refs.map((x) => x.path)).size;
  const first = r.refs[0];
  switch (r.kind) {
    case 'open': return { chip: 'Open elsewhere', says: `The same to-do is open in ${plural(n, 'other note')}.` };
    case 'done': return { chip: 'Done already', says: `Ticked in ${first.name}.` };
    case 'still': return { chip: 'Still open', says: `Not ticked in ${plural(n, 'other note')}.` };
    case 'asked': return { chip: 'Asked before', says: `Asked in ${plural(n, 'other note')}, not decided.` };
    case 'decided': return { chip: 'Decided', says: first.same === r.same ? `Marked decided in ${first.name}.` : first.was ? `${first.text} (it replaced \u201C${first.was}\u201D)` : first.text };
    case 'answers': return { chip: 'Answers', says: `The question open in ${first.name}.` };
    case 'before': return { chip: 'Decided before', says: first.text };
    case 'replaces': return { chip: 'Replaces', says: first.text };
    case 'related': return { chip: n > 1 ? `Related \u00B7 ${n} notes` : 'Related', says: excerptOf(first.text, 160) };
    default: return { chip: '', says: '' };
  }
}
