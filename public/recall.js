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

// notes: [{ path, head (its first words, for its date), created, lines: [[line, text]] }]
// → { items: [{ path, name, date, estimated, line, raw, kind, done, text, same, words }] }
export function recallIndex(notes) {
  const items = [];
  for (const n of notes || []) {
    const { date, estimated } = dateOf({ path: n.path, text: n.head || '', created: n.created });
    const name = stemOf(n.path);
    for (const [line, raw] of n.lines || []) {
      for (const it of meetingItems(raw)) {
        if (!['todo', 'decision', 'question'].includes(it.kind)) continue;
        items.push({ path: n.path, name, date, estimated, line, raw: raw.trim(), kind: it.kind, done: !!it.done, text: it.body, same: sameOf(it.text), words: wordsOf(it.body) });
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

// What the other notes say about a note's lines: [{ line, kind, refs }], a
// line once (same: its words as compared, when it is an item). kind: 'open' (the same to-do open elsewhere), 'done' (ticked
// elsewhere), 'still' (ticked here, open elsewhere), 'asked' (the question
// asked before, not decided), 'decided' (a decision on the question, or on
// what a line is about), 'answers' (a decision here, a question open
// elsewhere), 'before' (a decision here, one made before on the same).
// refs: the items there, newest first. cache: a Map kept while the index is.
export function recall(index, path, text, { cache = null, max = 40 } = {}) {
  const others = (index?.items || []).filter((x) => x.path !== path);
  if (!others.length) return [];
  const bySame = new Map();
  for (const x of others) { if (!bySame.has(x.same)) bySame.set(x.same, []); bySame.get(x.same).push(x); }
  const decisions = others.filter((x) => x.kind === 'decision');
  const near = (words, pool, share) => pool.map((x) => [x, nearness(words, x.words, share)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => x);
  const mine = new Map(meetingItems(text).map((it) => [it.line, it]));
  const lines = String(text).split('\n');
  const front = FRONT.exec(text);
  const skip = front ? front[0].split('\n').length : 0;
  const out = [];
  let fence = false;
  for (let i = skip; i < lines.length && out.length < max; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence || !l.trim()) continue;
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
    const same = (bySame.get(sameOf(it.text)) || []).sort(newest);
    const words = wordsOf(it.body);
    if (it.kind === 'todo') {
      const todos = same.filter((x) => x.kind === 'todo');
      if (it.done) { const open = todos.filter((x) => !x.done); return open.length ? { kind: 'still', refs: open } : null; }
      if (!todos.length) return null;
      return todos[0].done ? { kind: 'done', refs: todos.filter((x) => x.done) } : { kind: 'open', refs: todos.filter((x) => !x.done) };
    }
    if (it.kind === 'question') {
      const decided = same.filter((x) => x.kind === 'decision');
      const nearBy = decided.length ? decided : near(words, decisions, 0.5);
      if (nearBy.length) return { kind: 'decided', refs: nearBy };
      const asked = same.filter((x) => x.kind === 'question');
      return asked.length ? { kind: 'asked', refs: asked } : null;
    }
    const before = near(words, decisions, 0.5).filter((x) => x.same !== sameOf(it.text));
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
    const found = near(words, decisions, 0.6);
    return found.length ? { kind: 'decided', refs: found } : null;
  }
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
    case 'decided': return { chip: 'Decided', says: first.same === r.same ? `Marked decided in ${first.name}.` : first.text };
    case 'answers': return { chip: 'Answers', says: `The question open in ${first.name}.` };
    case 'before': return { chip: 'Decided before', says: first.text };
    default: return { chip: '', says: '' };
  }
}
