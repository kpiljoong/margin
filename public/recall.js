// The margin remembers (rules only; nothing is sent anywhere): beside a line,
// what the other notes already say about it — the same to-do still open or
// ticked there, a question asked before or decided, a decision made before
// (in the same words or near them). The server reads every note's to-do,
// decision and question lines (server.js recallLines); this matches them.
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

// notes: [{ path, head (its first words, for its date), created, project: [names], lines: [[line, text]] }]
// → { items: [{ path, name, date, estimated, line, raw, project, kind, done, text, same, words }] }
export function recallIndex(notes) {
  const items = [];
  for (const n of notes || []) {
    const { date, estimated } = dateOf({ path: n.path, text: n.head || '', created: n.created });
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
  return { items };
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
// kept while the index and known are.
export function recall(index, path, text, { cache = null, max = 40, known = NONE } = {}) {
  const c = context(index, path, known);
  if (!c) return [];
  const { bySame, decisions, near, canon, latest } = c;
  const mine = new Map(meetingItems(text).map((it) => [it.line, it]));
  const out = [];
  for (const [i, l] of bodyLines(text)) {
    if (out.length >= max) break;
    const it = mine.get(i);
    const key = `${it ? `${it.kind}${it.done ? '+' : ''}` : ''}|${l}`;
    let r = cache?.get(key);
    if (r === undefined) {
      r = it ? ofItem(it) : ofLine(l);
      cache?.set(key, r);
    }
    if (r) out.push({ line: i, same: it ? sameOf(it.text) : null, ...r });
  }
  return out;

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
function context(index, path, known) {
  const others = (index?.items || []).filter((x) => x.path !== path);
  if (!others.length) return null;
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
  return { others, bySame, decisions, near, canon, latest, told };
}

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

// What the margin would ask about a note, nearest the cursor first (never
// the line being written): [{ line, kind, key, a, b, … }]. kind: 'same' (is
// this to-do that one, in other words?), 'replaces' (does this decision
// replace that one?), 'due' (by when? — an open to-do with someone on it
// and no date), 'project' (what is the note about? — the projects of the
// notes its lines meet). a: this line's { text, name }; b: the other item.
export function asks(index, path, text, { known = NONE, cursor = -1, projects = null } = {}) {
  const c = context(index, path, known);
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
  // The note's project, when it names none and its lines meet notes that do.
  const fm = FRONT.exec(text)?.[0] || '';
  if (projects && items.length >= 2 && !/^(projects?|tags)\s*:/im.test(fm) && met.size) {
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
    case 'due': return `By when${q.owner ? ` (@${q.owner})` : ''}?`;
    case 'project': return 'What is this note about?';
    default: return '';
  }
}

// "By when?" answered: the to-do's line with the date at its end.
export function withDue(line, date) {
  return `${line.replace(/\s+$/, '')} \u{1F4C5} ${date}`;
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
    default: return { chip: '', says: '' };
  }
}
