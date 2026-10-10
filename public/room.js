// The meeting room: a meeting or a lecture, typed a line at a time in the
// middle, into a note of its own (server.js /api/room/start). The note is
// theirs: each line kept as typed, in order. What the margin makes of it is
// a layer beside it (.agent-notes/room/), never written in by itself:
//  - each line sorted at once by rule, then by the live margin (lib/live.js)
//    — a guess, shown in its lane, until they mark it ("! ", "? ", "[] ", or
//    its kind picked on its card: then it is in the note);
//  - now and then (lib/room.js weave): the one thing worth asking now, where
//    the item being talked about stands, which lines go together, which one
//    changes an earlier one, what the notes before said otherwise (a change,
//    maybe — shown, not an error), which answers a question; the links can be
//    kept, cut, or drawn by hand;
//  - at its end (close): a short draft to read out while the people are still
//    there — decided, who does what, still open — and at most three questions
//    first. What they accept goes into the note's "## Wrap-up"; the rest
//    stays, unsure, never dropped. Then, proposed only: the folder's notes
//    (as a review's changes, in their red pen reviews), the to-do list, the
//    next meeting's note.
import { markOf, lineAs, nextNote, nextMeetingPath, meetingItems } from './meeting.js';
import { ruleOf, parseReply, kindFor, weekAhead, memoryOf, projectMemory, snippetsFor, plainReply, dueOf, isoDay } from './live.js';
import { withChanges } from './desk.js';

// ---------------------------------------------------------------- the note

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const WRAP = /^##\s+Wrap-up\s*$/i;
const HEAD = /^\s*(?:>\s?)*(?:(?:[-*+]|\d+[.)])\s+)?/;
const BOX = /^\[([ xX])\]\s+/;
const KIND_TAGS = /(^|\s+)#(?:decision|decided|question|risk|idea|next)\b/gi;
const TYPED = /^(?:[!?]|\[\])\s+(?=\S)/;
export const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// A line's words: without its list mark, its box, and the tags saying what it is.
export const wordsOf = (line) => line.replace(HEAD, '').replace(BOX, '').replace(TYPED, '').replace(KIND_TAGS, ' ').replace(/\s+/g, ' ').trim();

// The lines of the session, in order: after its title (and the link to the
// meeting before), before its wrap-up; headings are the items they are
// under. → { entries: [{ key, i, line, words, mark, done, section }],
// sections: [title], end (the line to add after: the last of the body) }.
export function roomEntries(text) {
  const lines = String(text).split('\n');
  let i = 0;
  if (/^\uFEFF?---\s*$/.test(lines[0] || '')) { i = 1; while (i < lines.length && !/^---\s*$/.test(lines[i])) i++; i++; }
  const entries = [];
  const sections = [];
  const seen = new Map();
  let section = '';
  let fence = false;
  let titled = false;
  let end = Math.min(i, lines.length) - 1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (WRAP.test(l)) break;
    if (l.trim()) end = i;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const hd = HEADING.exec(l);
    if (hd) {
      if (hd[1].length === 1 && !titled) { titled = true; continue; }
      section = hd[2].trim();
      if (!sections.includes(section)) sections.push(section);
      continue;
    }
    if (!l.trim() || /^\s*(?:\*\*)?(?:Previous|Next) meeting\b/i.test(l) || /^\s*\?\?/.test(l)) continue;
    const words = wordsOf(l);
    if (!words || !/[\p{L}\p{N}]/u.test(words)) continue;
    const k0 = norm(words);
    const n = (seen.get(k0) || 0) + 1;
    seen.set(k0, n);
    const box = BOX.exec(l.replace(HEAD, ''));
    entries.push({ key: n > 1 ? `${k0}#${n}` : k0, i, line: l, words, mark: markOf(l), done: !!box && box[1] !== ' ', section });
  }
  return { entries, sections, end: Math.max(end, 0) };
}

// What is typed, as the note keeps it: "# Item" (or "## …") an item of the
// agenda; "! …", "? …", "[] …" marked as they said (a decision, a question, a
// to-do); anything else a list item as written. → a line, or null.
export function typedLine(input) {
  const t = String(input || '').replace(/\s+/g, ' ').trim();
  if (!t || /^\?\?/.test(t)) return null;
  const hd = /^#{1,3}\s+(.+)$/.exec(t);
  if (hd) return `## ${hd[1].trim()}`;
  const item = /^(?:[-*+]\s+)/.test(t) ? t.replace(/^[-*+]\s+/, '- ') : `- ${t}`;
  return TYPED.test(t) ? (lineAs(item, { '!': 'decision', '?': 'question' }[t[0]] || 'todo') ?? item) : item;
}

// The note with lines added at the end of the session (before its wrap-up;
// a heading with a blank line before and after).
export function addLines(text, add) {
  const lines = String(text).replace(/\n+$/, '').split('\n');
  const { end } = roomEntries(text);
  const before = lines.slice(0, end + 1);
  const after = lines.slice(end + 1);
  while (after.length && !after[0].trim()) after.shift();
  const out = [];
  const item = (l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l);
  for (const l of add) {
    const prev = out.length ? out.at(-1) : before.at(-1) ?? '';
    // A blank line before a heading, after one, and between a list and other words.
    if (prev.trim() && (/^#{1,6}\s/.test(l) || /^#{1,6}\s/.test(prev) || !item(prev) || !item(l))) out.push('');
    out.push(l);
  }
  return `${[...before, ...out, ...(after.length ? ['', ...after] : [])].join('\n')}\n`;
}
// An entry marked as kind (null: plain words again), in its place.
export function markEntry(text, entry, kind) {
  const lines = String(text).split('\n');
  const i = findLine(lines, entry);
  if (i < 0) return text;
  const line = lineAs(lines[i], kind);
  if (line == null) return text;
  lines[i] = line;
  return lines.join('\n');
}
// Its words written again (its mark and box kept).
export function editEntry(text, entry, words) {
  const lines = String(text).split('\n');
  const i = findLine(lines, entry);
  const w = String(words || '').replace(/\s+/g, ' ').trim();
  if (i < 0 || !w) return text;
  const head = HEAD.exec(lines[i])[0] || '- ';
  const box = BOX.exec(lines[i].slice(HEAD.exec(lines[i])[0].length));
  let line = `${head}${box ? box[0] : ''}${w}`;
  const mark = markOf(lines[i]);
  if (mark && mark !== 'todo') line = lineAs(line, mark) ?? line;
  lines[i] = line;
  return lines.join('\n');
}
export function dropEntry(text, entry) {
  const lines = String(text).split('\n');
  const i = findLine(lines, entry);
  if (i < 0) return text;
  lines.splice(i, 1);
  return lines.join('\n');
}
// Where the entry is now: at its line if it is still there, else the one line with its words.
function findLine(lines, entry) {
  if (lines[entry.i] === entry.line) return entry.i;
  const all = lines.map((l, i) => (l === entry.line ? i : -1)).filter((i) => i >= 0);
  return all.length ? all[0] : -1;
}

// What the close reads: the whole session when it fits; a long one, its
// plain notes left out from the oldest first (what was decided, given to
// someone, asked or marked stays, however early), then the oldest of the rest.
export function closeItems(entries, { budget = 60000, max = 400 } = {}) {
  const size = (xs) => xs.reduce((n, e) => n + e.words.length + 24, 0);
  let keep = [...entries];
  for (let i = 0; i < keep.length && (size(keep) > budget || keep.length > max);) {
    if (keep[i].kind === 'note' && keep.length - i > 20) keep.splice(i, 1); else i++;
  }
  while (keep.length > 1 && (size(keep) > budget || keep.length > max)) keep.shift();
  return keep;
}
// The session as the draft was made from: a draft from other lines is old.
export const sigOf = (entries) => entries.map((e) => `${e.key}\u0001${e.mark || ''}`).join('\u0002');
// A date the margin's sentence adds that the words don't have ("on the 18th"
// for "Friday"): the sentence is not shown — their words are what counts.
const DATEY = /\d{4}-\d{2}-\d{2}|\d{1,2}\s*\uC6D4\s*\d{1,2}\s*\uC77C|\d{1,2}\uC77C|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\b|\d{1,2}\/\d{1,2}/gi;
export function addsDate(sentence, words) {
  const said = String(words).toLowerCase().replace(/\s+/g, '');
  return (String(sentence).match(DATEY) || []).some((d) => !said.includes(d.toLowerCase().replace(/\s+/g, '')));
}

// The lanes, and which kinds go in each.
export const LANES = ['note', 'decision', 'todo', 'question', 'other'];
export const laneOf = (kind) => (LANES.includes(kind) ? kind : ['risk', 'idea', 'next'].includes(kind) ? 'other' : 'note');

// The draft accepted, as the note's "## Wrap-up" (in its place when there is
// one): what was decided (#decision; a lecture's points plain), the to-dos
// (a box, @who, its day), what is open (#question), and what is not sure —
// with a line saying what it is: a draft from the end of the session.
export function wrapSection(draft, { lang = 'en', kind = 'meeting', at = '', next = '' } = {}) {
  const W = WORDS[lang] || WORDS.en;
  const lecture = kind !== 'meeting';
  const out = ['## Wrap-up', '', `> ${W.wrapNote(at)}`, ''];
  const join = (x) => [x.text, x.cond].filter(Boolean).join(' — ');
  const decided = (draft.decided || []).filter((x) => x.text.trim());
  if (decided.length) out.push(`### ${lecture ? W.h.points : W.h.decided}`, '', ...decided.map((x) => `- ${join(x)}${lecture ? '' : ' #decision'}`), '');
  const who = (draft.who || []).filter((x) => x.text.trim());
  if (who.length) {
    out.push(`### ${lecture ? W.h.tasks : W.h.todos}`, '');
    for (const x of who) {
      const owner = x.who && x.who !== '?' ? ` @${x.who.replace(/\s+/g, '')}` : '';
      const due = x.due || null;
      out.push(`- [ ] ${x.text.replace(/\s+—\s+$/, '')}${owner}${due ? ` \u{1F4C5} ${due}` : ''}`);
    }
    out.push('');
  }
  const open = (draft.open || []).filter((x) => x.text.trim());
  if (open.length) out.push(`### ${W.h.open}`, '', ...open.map((x) => `- ${join(x)} #question`), '');
  const unsure = (draft.unsure || []).filter((x) => x.text.trim());
  if (unsure.length) out.push(`### ${W.h.unsure}`, '', ...unsure.map((x) => `- ${x.text}`), '');
  if (next) out.push(`Next meeting: [[${next.split('/').pop().replace(/\.md$/i, '')}]]`, '');
  return out.join('\n').replace(/\n+$/, '\n');
}
// The note with its wrap-up (the one there replaced).
export function withWrap(text, section) {
  const lines = String(text).replace(/\n+$/, '').split('\n');
  const w = lines.findIndex((l) => WRAP.test(l));
  const body = w < 0 ? lines : lines.slice(0, w);
  let rest = [];
  if (w >= 0) { const e = lines.findIndex((l, i) => i > w && /^#{1,2}\s/.test(l)); if (e > 0) rest = lines.slice(e); }
  while (body.length && !body.at(-1).trim()) body.pop();
  return `${[...body, '', section.replace(/\n+$/, ''), ...(rest.length ? ['', ...rest] : [])].join('\n')}\n`;
}

// A draft's to-do, split: "what — by when" (the day as the vault writes it).
export function whoDue(x, today = new Date()) {
  const parts = String(x.text).split(/\s+—\s+/);
  if (parts.length > 1) {
    const due = dueOf(parts.at(-1), today);
    if (due) return { ...x, text: parts.slice(0, -1).join(' — '), due };
  }
  return { ...x, due: x.due || null };
}
// The draft's decided and open lines: "what — its condition".
export function splitCond(x) {
  const parts = String(x.text).split(/\s+—\s+/);
  return parts.length > 1 ? { ...x, text: parts[0], cond: parts.slice(1).join(' — ') } : { ...x, cond: x.cond || '' };
}

// The to-dos, as the assistant's list writes them (a project folder's tag),
// those not in it already. → lines.
export function todoLines(who, { list = '', folder = '' } = {}) {
  const have = new Set(String(list).split('\n').map((l) => norm(wordsOf(l).replace(/\u{1F4C5}\s*\d{4}-\d{2}-\d{2}/u, '').replace(/#project\/\S+/, ''))));
  const proj = /^01-projects\/([^/]+)/.exec(folder)?.[1];
  return who.filter((x) => x.text.trim() && !have.has(norm(x.text))).map((x) => `- [ ] ${x.text}${x.due ? ` \u{1F4C5} ${x.due}` : ''}${proj ? ` #project/${proj}` : ''}`);
}
export function withTodos(text, lines) {
  if (!lines.length) return text;
  const t = String(text).replace(/\n+$/, '');
  return `${t}${t ? '\n' : ''}${lines.join('\n')}\n`;
}

// What the margin said (lines numbered from 1, as sent) on the entries'
// keys; a link they cut is not offered again, one there already not twice.
export function wovenLinks(r, keys, { have = [], cut = [] } = {}) {
  const pair = (a, b) => [a, b].sort().join('\u0000');
  const gone = new Set(cut);
  const there = new Set(have.map((l) => pair(l.a, l.b)));
  const out = [];
  for (const l of r.links || []) {
    const a = keys[l.a - 1];
    const b = keys[l.b - 1];
    if (!a || !b || a === b || gone.has(pair(a, b)) || there.has(pair(a, b))) continue;
    there.add(pair(a, b));
    out.push({ a, b, kind: l.kind, why: l.why || '', by: 'agent' });
  }
  return out;
}

// ---------------------------------------------------------------- words

export const roomLang = (text) => (/[\uAC00-\uD7A3]/.test(String(text || '')) ? 'ko' : 'en');
export const WORDS = {
  ko: {
    lane: { note: '\uB0B4\uC6A9', decision: '\uC815\uD55C \uAC83', todo: '\uD560 \uC77C', question: '\uC9C8\uBB38', other: '\uC704\uD5D8·\uC544\uC774\uB514\uC5B4·\uB2E4\uC74C\uC5D0' },
    laneLecture: { note: '\uB0B4\uC6A9', decision: '\uD575\uC2EC', todo: '\uACFC\uC81C', question: '\uC9C8\uBB38', other: '\uCC38\uACE0·\uC544\uC774\uB514\uC5B4' },
    kind: { note: '\uB0B4\uC6A9', decision: '\uACB0\uC815', todo: '\uD560 \uC77C', question: '\uC9C8\uBB38', risk: '\uC704\uD5D8', idea: '\uC544\uC774\uB514\uC5B4', next: '\uB2E4\uC74C\uC5D0' },
    meeting: '\uD68C\uC758', lecture: '\uAC15\uC758',
    notetaking: '\uAE30\uB85D',
    laneNotes: { note: '\uB0B4\uC6A9', decision: '\uD575\uC2EC', todo: '\uD560 \uC77C', question: '\uCC3E\uC544\uBCFC \uAC83', other: '\uC544\uC774\uB514\uC5B4·\uCC38\uACE0' },
    placeholder: '\uD55C \uC904\uC529 \uC4F0\uACE0 Enter — ! \uC815\uD568 · ? \uC9C8\uBB38 · [] \uD560 \uC77C · # \uB2E4\uC74C \uC548\uAC74 · ?? \uBB3C\uC5B4\uBCF4\uAE30 · >> \uB300\uD654',
    keepLine: '+ \uC801\uAE30:',
    restart: '\uB300\uD654\uB294 \uC571\uC744 \uC644\uC804\uD788 \uC885\uB8CC\uD588\uB2E4\uAC00 \uB2E4\uC2DC \uC5F4\uC5B4\uC57C \uC4F8 \uC218 \uC788\uC5B4\uC694(\uC9C0\uAE08 \uB5A0 \uC788\uB294 \uC11C\uBC84\uAC00 \uB300\uD654 \uAE30\uB2A5 \uC774\uC804 \uBC84\uC804\uC774\uC5D0\uC694).',
    guess: '\uCD94\uC815 — \uB20C\uB7EC\uC11C \uC815\uD558\uAE30',
    maybe: (k) => `${k} \uD6C4\uBCF4`, moreOn: '\uB20C\uB7EC\uC11C \uC815\uB9AC \uBB38\uC7A5·\uC9C0\uB09C \uAE30\uB85D \uBCF4\uAE30',
    stale: '\uCD08\uC548 \uB4A4\uB85C \uBA54\uBAA8\uAC00 \uBC14\uB00C\uC5B4\uC11C \uC9C0\uAE08 \uBA54\uBAA8\uB85C \uB2E4\uC2DC \uC37C\uC5B4\uC694.',
    withAnswers: (n) => `\uB2F5 ${n}\uAC1C \uB123\uACE0 \uCD08\uC548 \uB2E4\uC2DC \uC4F0\uAE30`, answersFirst: '\uB2F5\uC774 \uACB0\uC815·\uB2F4\uB2F9·\uAE30\uD55C\uC744 \uBC14\uAFB8\uB294\uC9C0 \uCD08\uC548\uC5D0 \uBA3C\uC800 \uBC18\uC601\uD574 \uBCF4\uC5EC \uB4DC\uB824\uC694.',
    mine: '\uC9C1\uC811 \uC815\uD568',
    now: '\uC9C0\uAE08',
    agreed: '\uD569\uC758 \uD6C4\uBCF4', open: '\uB0A8\uC740 \uC7C1\uC810', next: '\uB2E4\uC74C',
    standLecture: { agreed: '\uC815\uB9AC\uB41C \uAC83', open: '\uC544\uC9C1 \uBAA8\uB974\uB294 \uAC83', next: '\uD574 \uBCFC \uAC83' },
    standHint: '\uBAA8\uB378\uC774 \uCD94\uC815\uD55C \uAC83 — \uB20C\uB7EC\uC11C \uACE0\uCE60 \uC218 \uC788\uC5B4\uC694',
    ask: '\uC9C0\uAE08 \uBB3C\uC5B4\uBCFC \uAC83',
    asked: '\uB2F5 \uC801\uAE30', later: '\uB098\uC911\uC5D0', notIt: '\uC544\uB2C8\uC5D0\uC694',
    weaving: '\uD750\uB984\uC744 \uC77D\uB294 \uC911…',
    woven: (n) => `\uC5F0\uACB0 ${n}`,
    weave: '\uC5F0\uACB0 \uCC3E\uAE30',
    doc: '\uB178\uD2B8 \uBCF4\uAE30',
    space: '\uACF5\uAC04', flat: '\uD3C9\uBA74',
    close: '\uB9C8\uBB34\uB9AC',
    clock: (m) => `${m}\uBD84`,
    before: (n) => `\uC9C0\uB09C \uAE30\uB85D(${n})`,
    changed: '\uB4A4\uC5D0\uC11C \uBC14\uB01C',
    answered: '\uB2F5 \uB098\uC634',
    cut: '\uB04A\uAE30', keep: '\uB9DE\uC544\uC694', mineLink: '\uC9C1\uC811 \uC774\uC74C',
    link: { link: '\uAD00\uB828', changes: '\uBC14\uB01C', clash: '\uB9DE\uC9C0 \uC54A\uC74C — \uD655\uC778 \uD544\uC694', answers: '\uB2F5' },
    edit: '\uACE0\uCE58\uAE30', drop: '\uBE7C\uAE30', openLine: '\uB178\uD2B8\uC5D0\uC11C \uBCF4\uAE30',
    sortFail: (e) => `\uBD84\uB958\uB294 \uADDC\uCE59\uC73C\uB85C\uB9CC \uD588\uC5B4\uC694: ${e}`,
    weaveFail: (e) => `\uD750\uB984\uC744 \uC77D\uC9C0 \uBABB\uD588\uC5B4\uC694: ${e}`,
    answer: '\uB2F5', keepAnswer: '\uB178\uD2B8\uC5D0 \uC801\uAE30', thinking: '\uCC3E\uB294 \uC911…',
    undo: '\uB418\uB3CC\uB9BC',
    // The close.
    closing: (s) => `\uAE30\uB85D\uC744 \uC77D\uACE0 \uB9C8\uBB34\uB9AC \uCD08\uC548\uC744 \uC4F0\uB294 \uC911… ${s}\uCD08`,
    closeFail: (e) => `\uCD08\uC548\uC744 \uC4F0\uC9C0 \uBABB\uD588\uC5B4\uC694: ${e}`,
    closeTitle: '\uB9C8\uBB34\uB9AC — \uC0AC\uB78C\uB4E4\uC774 \uC788\uC744 \uB54C \uD568\uAED8 \uD655\uC778\uD574\uC694',
    closeNote: '\uC785\uB825\uD55C \uBA54\uBAA8\uB9CC \uBCF4\uACE0 \uC4F4 \uCD08\uC548\uC774\uC5D0\uC694. "\uAE30\uB85D\uC5D0 \uC5C6\uC74C"\uC740 \uD68C\uC758\uC5D0\uC11C \uC548 \uD588\uB2E4\uB294 \uB73B\uC774 \uC544\uB2C8\uC5D0\uC694. \uACE0\uCE60 \uAC74 \uACE0\uCE58\uACE0, \uC544\uB2CC \uC904\uC740 \uBE7C \uC8FC\uC138\uC694.',
    checks: '\uBA3C\uC800 \uD655\uC778\uD560 \uAC83',
    checkAnswer: '\uB2F5\uC744 \uC4F0\uBA74 \uB178\uD2B8\uC5D0 \uADF8\uB300\uB85C \uB0A8\uC544\uC694',
    h: { decided: '\uC815\uD55C \uAC83', points: '\uD575\uC2EC', todos: '\uD560 \uC77C', tasks: '\uACFC\uC81C', open: '\uC544\uC9C1 \uC5F4\uB9B0 \uAC83', unsure: '\uD655\uC778 \uC548 \uB41C \uAC83' },
    whoNone: '\uB2F4\uB2F9?',
    nothing: '\uC5C6\uC74C',
    more: (n) => `${n}\uAC1C \uB354 \uBCF4\uAE30`,
    each: (n) => `\uC904\uB9C8\uB2E4 \uBCF4\uAE30 (${n})`,
    accept: '\uC774\uB300\uB85C \uB178\uD2B8\uC5D0 \uB123\uAE30',
    cancel: '\uB2EB\uAE30',
    again: '\uCD08\uC548 \uB2E4\uC2DC \uC4F0\uAE30',
    wrapNote: (at) => `\uB9C8\uBB34\uB9AC \uCD08\uC548${at ? ` (${at})` : ''} — \uB05D\uB0A0 \uB54C \uD568\uAED8 \uD655\uC778\uD55C \uAC83. \uC704 \uC904\uB4E4\uC740 \uC785\uB825\uD55C \uADF8\uB300\uB85C\uC608\uC694.`,
    wrapped: '\uB178\uD2B8 \uB05D Wrap-up\uC5D0 \uB123\uC5C8\uC5B4\uC694. \uC774\uC81C \uD560 \uC218 \uC788\uB294 \uAC83:',
    findChanges: '\uC774 \uD3F4\uB354 \uB178\uD2B8\uC5D0 \uBC18\uC601\uD560 \uACF3 \uCC3E\uAE30',
    reading: (s) => `\uD3F4\uB354 \uB178\uD2B8\uB97C \uC77D\uB294 \uC911… ${s}\uCD08`,
    changes: (n, k) => `\uB178\uD2B8 ${n}\uACF3\uC5D0\uC11C ${k}\uC904`,
    noChanges: '\uD3F4\uB354 \uB178\uD2B8\uC5D0\uC11C \uBC14\uAFC0 \uACF3\uC740 \uC5C6\uC5B4\uC694.',
    noDecided: '\uC815\uD55C \uAC83\uC774 \uC5C6\uC5B4\uC11C \uBC18\uC601\uD560 \uAC74 \uC5C6\uC5B4\uC694.',
    propose: '\uB178\uD2B8\uC5D0 \uC81C\uC548\uD558\uAE30 (\uBE68\uAC04 \uD39C)',
    proposed: '\uC81C\uC548\uD588\uC5B4\uC694 — \uB178\uD2B8\uB97C \uB20C\uB7EC \uBE68\uAC04 \uD39C\uC5D0\uC11C \uBC1B\uC73C\uC138\uC694:',
    addTodos: '\uD560 \uC77C \uBAA9\uB85D\uC5D0 \uB123\uAE30',
    todosAdded: '\uD560 \uC77C \uBAA9\uB85D\uC5D0 \uC81C\uC548\uD588\uC5B4\uC694:',
    todosNone: '\uC0C8\uB85C \uB123\uC744 \uD560 \uC77C\uC774 \uC5C6\uC5B4\uC694.',
    nextNote: '\uB2E4\uC74C \uD68C\uC758 \uB178\uD2B8 \uB9CC\uB4E4\uAE30',
    nextMade: '\uB2E4\uC74C \uD68C\uC758 \uB178\uD2B8\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694(\uC5F4\uB9B0 \uC9C8\uBB38 \uC774\uC5B4\uBC1B\uC74C).',
    failed: (e) => `\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694: ${e}`,
    started: (p) => (p ? `\uC9C0\uB09C \uD68C\uC758 [[${p}]]\uB97C \uC774\uC5B4\uBC1B\uC558\uC5B4\uC694.` : ''),
    empty: '\uAC00\uC6B4\uB370 \uC544\uB798\uC5D0 \uD55C \uC904\uC529 \uC4F0\uC138\uC694. \uC4F0\uB294 \uB300\uB85C \uB178\uD2B8\uC5D0 \uB0A8\uACE0, \uC885\uB958\uBCC4\uB85C \uC790\uB9AC\uB97C \uC7A1\uC544\uC694.',
    lastTime: '\uC9C0\uB09C\uBC88 \uC5F4\uB9B0 \uAC83',
    bring: '\uC774\uBC88\uC5D0 \uB2E4\uB8E8\uAE30',
  },
  en: {
    lane: { note: 'Notes', decision: 'Decided', todo: 'To do', question: 'Questions', other: 'Risks · ideas · later' },
    laneLecture: { note: 'Notes', decision: 'Key points', todo: 'Assignments', question: 'Questions', other: 'Asides · ideas' },
    kind: { note: 'Note', decision: 'Decision', todo: 'To-do', question: 'Question', risk: 'Risk', idea: 'Idea', next: 'Later' },
    meeting: 'Meeting', lecture: 'Lecture',
    notetaking: 'Notes',
    laneNotes: { note: 'Notes', decision: 'Key points', todo: 'To do', question: 'To find out', other: 'Ideas · asides' },
    placeholder: 'A line at a time, Enter — ! decided · ? question · [] to-do · # next item · ?? ask · >> talk',
    keepLine: '+ Note:',
    restart: 'Talking needs the app quit and opened again (the server running now is from before it).',
    guess: 'A guess — press to set it',
    maybe: (k) => `${k}?`, moreOn: 'Press for the margin’s sentence and what was recorded before',
    stale: 'The notes changed since the draft: written again from them.',
    withAnswers: (n) => `Put in ${n} answer${n === 1 ? '' : 's'} and write the draft again`, answersFirst: 'What the answers change (decided, who, by when) is shown in the draft first.',
    mine: 'Set by you',
    now: 'Now',
    agreed: 'Agreed so far', open: 'At issue', next: 'Next',
    standLecture: { agreed: 'Clear so far', open: 'Not clear yet', next: 'To try' },
    standHint: 'The margin’s reading — press to correct it',
    ask: 'Worth asking now',
    asked: 'Write the answer', later: 'Later', notIt: 'Not that',
    weaving: 'Reading the flow…',
    woven: (n) => `${n} link${n === 1 ? '' : 's'}`,
    weave: 'Find links',
    doc: 'The note',
    space: 'Space', flat: 'Flat',
    close: 'Wrap up',
    clock: (m) => `${m} min`,
    before: (n) => `Before (${n})`,
    changed: 'Changed later',
    answered: 'Answered',
    cut: 'Cut', keep: 'Right', mineLink: 'Drawn by you',
    link: { link: 'Related', changes: 'Changed', clash: 'Doesn’t fit — ask', answers: 'Answers' },
    edit: 'Edit', drop: 'Remove', openLine: 'Show in the note',
    sortFail: (e) => `Sorted by rule only: ${e}`,
    weaveFail: (e) => `Could not read the flow: ${e}`,
    answer: 'Answer', keepAnswer: 'Put in the note', thinking: 'Looking…',
    undo: 'Undone',
    closing: (s) => `Reading the record and writing the draft… ${s}s`,
    closeFail: (e) => `No draft: ${e}`,
    closeTitle: 'Wrap up — check it together while everyone is here',
    closeNote: 'A draft from what was typed only: “not in the record” is not “not decided”. Correct what is wrong, remove what is not so.',
    checks: 'Ask first',
    checkAnswer: 'An answer is kept in the note as written',
    h: { decided: 'Decided', points: 'Key points', todos: 'To-dos', tasks: 'Assignments', open: 'Still open', unsure: 'Not confirmed' },
    whoNone: 'who?',
    nothing: 'None',
    more: (n) => `${n} more`,
    each: (n) => `Line by line (${n})`,
    accept: 'Put it in the note',
    cancel: 'Close',
    again: 'Write the draft again',
    wrapNote: (at) => `The draft at the end${at ? ` (${at})` : ''} — what was checked together. The lines above are as typed.`,
    wrapped: 'In the note’s Wrap-up. Now:',
    findChanges: 'Find where the folder’s notes change',
    reading: (s) => `Reading the folder’s notes… ${s}s`,
    changes: (n, k) => `${k} line${k === 1 ? '' : 's'} in ${n} note${n === 1 ? '' : 's'}`,
    noChanges: 'Nothing in the folder’s notes goes against it.',
    noDecided: 'Nothing decided: nothing to carry into the notes.',
    propose: 'Propose in the notes (red pen)',
    proposed: 'Proposed — press a note to accept it in its red pen review:',
    addTodos: 'Add to the to-do list',
    todosAdded: 'Proposed in the to-do list:',
    todosNone: 'No new to-dos.',
    nextNote: 'Make the next meeting’s note',
    nextMade: 'The next meeting’s note is made (its open questions carried over).',
    failed: (e) => `Not done: ${e}`,
    started: (p) => (p ? `Carrying on from [[${p}]].` : ''),
    empty: 'Write a line at a time below. Each is kept in the note as typed, and takes its place by kind.',
    lastTime: 'Open from last time',
    bring: 'Take it up now',
  },
};

// ---------------------------------------------------------------- the view

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}
function button(label, run, cls = 'btn small', title = '') {
  const b = el('button', cls, label);
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); run(e); });
  return b;
}
const SVG = 'http://www.w3.org/2000/svg';
const pairKey = (a, b) => [a, b].sort().join('\u0000');
const nameOf = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '');

export class Room {
  // opts: { path, doc() → { text, save(text) }, context() → { notes, layer },
  // saveLayer(layer), line(body, signal, onText) → { said, end },
  // weave(items), close(items), changes(decided), proposeNote(path, make, o),
  // openReview(id), openNote(path, line), writeNote(path, text), exists(path),
  // todoFile, reduced, appKey(e), toast(msg) }
  constructor(opts) {
    this.opts = opts;
    this.text = '';
    this.entries = [];
    this.sections = [];
    this.layer = {};
    this.notes = [];
    this.cards = new Map();
    this.undo = [];
    this.queue = [];
    this.sorting = null;
    this.since = 0;
    this.status = '';
    this.flat = (typeof localStorage !== 'undefined' && localStorage.getItem('an.roomFlat') === '1');
    this.el = el('div', 'room');
    this.el.tabIndex = -1;
    this.build();
    this.load();
  }

  get lang() { return this.langNow || 'en'; }
  get W() { return WORDS[this.lang]; }
  get kind() {
    const t = /^type:[ \t]*["']?(lecture|note-taking|meeting)["']?[ \t]*$/im.exec(this.text.split('\n---')[0] || '')?.[1];
    return t || (['lecture', 'note-taking'].includes(this.layer.kind) ? this.layer.kind : 'meeting');
  }
  // A lecture's or their own notes: points, not decisions.
  get plain() { return this.kind !== 'meeting'; }
  get kindName() { return this.W[this.kind === 'note-taking' ? 'notetaking' : this.kind]; }

  build() {
    this.head = el('div', 'room-head');
    this.nowBar = el('div', 'room-now');
    this.stage = el('div', 'room-stage');
    this.lanesEl = el('div', 'room-lanes');
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('room-lines');
    this.stage.append(this.lanesEl, this.svg);
    this.carryBar = el('div', 'room-carry');
    this.askBar = el('div', 'room-ask');
    this.answersEl = el('div', 'room-answers');
    this.input = el('textarea', 'room-input');
    this.input.rows = 1;
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', (e) => this.keys(e));
    this.input.addEventListener('input', () => { this.input.style.height = 'auto'; this.input.style.height = `${Math.min(140, this.input.scrollHeight)}px`; });
    this.foot = el('div', 'room-foot', this.askBar, this.answersEl, el('div', 'room-type', this.input));
    this.overlay = el('div', 'room-overlay');
    this.overlay.hidden = true;
    this.pop = el('div', 'room-pop');
    this.pop.hidden = true;
    this.el.append(this.head, this.nowBar, this.carryBar, this.stage, this.foot, this.overlay, this.pop);
    this.el.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && e.target !== this.input) { e.preventDefault(); this.undoLast(); return; }
      if (e.target !== this.input && this.opts.appKey && (e.metaKey || e.ctrlKey) && !/^[zyxcva]$/i.test(e.key)) this.opts.appKey(e);
    });
    this.el.addEventListener('pointerdown', (e) => { if (!this.pop.contains(e.target)) this.pop.hidden = true; });
    this.stage.addEventListener('scroll', () => this.drawSoon(), { passive: true });
    this.stage.addEventListener('pointermove', (e) => this.tilt(e));
    this.resize = new ResizeObserver(() => { this.layout(); this.drawSoon(); });
    this.resize.observe(this.stage);
    this.clock = setInterval(() => this.renderHead(), 30000);
  }

  destroy() {
    clearInterval(this.clock);
    clearTimeout(this.weaveTimer);
    clearTimeout(this.saveTimer);
    this.sorting?.ctl.abort();
    this.resize?.disconnect();
    this.dead = true;
  }

  async load() {
    try {
      const d = await this.opts.doc();
      this.text = d.text;
    } catch (e) { this.text = ''; this.opts.toast?.(e.message, 'error'); }
    try {
      const c = await this.opts.context();
      this.notes = c.notes || [];
      this.layer = c.layer || {};
    } catch (e) { this.notes = []; this.status = this.W.weaveFail(e.message); }
    this.layer.startedAt ||= new Date().toISOString();
    this.layer.sorted ||= {};
    this.layer.links ||= [];
    this.layer.cut ||= [];
    this.layer.asks ||= [];
    this.layer.answers ||= [];
    this.parse();
    this.render();
    if (this.layer.closing && !this.layer.closed) this.showClose();
    requestAnimationFrame(() => this.input.focus());
  }
  // The note changed (here, in its tab, on disk): read again.
  async refresh() {
    if (this.dead || this.writing) return;
    try { const d = await this.opts.doc(); if (d.text === this.text) return; this.text = d.text; } catch { return; }
    this.parse();
    this.render();
  }

  parse() {
    const r = roomEntries(this.text);
    this.entries = r.entries;
    this.sections = r.sections;
    this.langNow = roomLang(`${this.text}\n${this.notes.map((n) => n.text.slice(0, 400)).join('\n')}`) === 'ko' || roomLang(this.text) === 'ko' ? 'ko' : 'en';
    const today = new Date();
    for (const e of this.entries) {
      const s = this.layer.sorted[e.key];
      const rule = ruleOf(e.line, today);
      e.rule = rule;
      e.kind = e.mark || s?.kind || (rule.kind === 'answer' ? 'note' : rule.kind);
      e.guess = !e.mark;
      e.sentence = s?.sentence || '';
      e.remark = s?.remark || '';
      e.owner = s?.owner || rule.owner || null;
      // A day only as their words give it (by rule), never the margin's reckoning.
      e.due = rule.due || null;
    }
    const w = this.layer.weave || {};
    this.changedKeys = new Set(this.layer.links.filter((l) => l.kind === 'changes').map((l) => l.b));
    this.answeredKeys = new Set(this.layer.links.filter((l) => l.kind === 'answers').map((l) => l.b));
    this.before = new Map((w.before || []).map((b) => [b.key, b]));
  }

  // One change to the note: through its tab or on disk (never over a newer one), kept for ⌘Z.
  // fresh: the lines it adds fly in from the input (→ their keys).
  async write(make, { fresh = false } = {}) {
    const had = new Set(this.entries.map((x) => x.key));
    const run = async () => {
      this.writing = true;
      try {
        const d = await this.opts.doc();
        const next = make(d.text);
        if (next === d.text) { this.text = d.text; return false; }
        await d.save(next);
        this.undo.push(d.text);
        if (this.undo.length > 50) this.undo.shift();
        this.text = next;
        return true;
      } catch (e) { this.opts.toast?.(e.message, 'error'); return false; } finally { this.writing = false; }
    };
    this.chain = (this.chain || Promise.resolve()).then(run, run);
    const ok = await this.chain;
    this.parse();
    const made = this.entries.filter((x) => !had.has(x.key)).map((x) => x.key);
    if (fresh) this.fresh = new Set(made);
    this.render();
    return fresh ? made : ok;
  }
  async undoLast() {
    const was = this.undo.pop();
    if (was == null) return;
    const d = await this.opts.doc();
    await d.save(was);
    this.text = was;
    this.parse();
    this.render();
    this.opts.toast?.(this.W.undo);
  }
  saveLayer() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.opts.saveLayer({ ...this.layer, kind: this.kind }), 600);
  }

  // ------------------------------------------------------------ typing

  keys(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); return; }
    if (e.key === 'ArrowUp' && !this.input.value) {
      const last = [...this.entries].reverse().find((x) => x);
      if (last) { e.preventDefault(); this.editCard(last); }
      return;
    }
    if (e.key === 'Escape') { this.input.blur(); this.el.focus(); }
  }
  async submit() {
    const raw = this.input.value;
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    this.input.value = '';
    this.input.style.height = 'auto';
    const asks = lines.filter((l) => /^\?\?/.test(l));
    // ">> …": talking with it, not a line of the note.
    const talk = lines.filter((l) => /^>>/.test(l)).map((l) => l.replace(/^>>\s*/, '')).filter(Boolean);
    const add = lines.filter((l) => !/^>>/.test(l)).map(typedLine).filter(Boolean);
    if (talk.length) this.talkTo(talk.join('\n'));
    if (this.answerTo) { this.dismissAsk('asked'); this.answerTo = null; }
    for (const q of asks) this.askMargin(q);
    if (!add.length) return;
    const made = await this.write((t) => addLines(t, add), { fresh: true });
    for (const k of made) { const x = this.entries.find((y) => y.key === k); if (x) this.sortLater(x); }
    this.since += made.length;
    this.weaveSoon();
  }

  // ------------------------------------------------------------ sorting (the live margin)

  sortLater(entry) {
    this.queue.push(entry.key);
    this.pump();
  }
  async pump() {
    if (this.sorting || !this.queue.length || this.dead) return;
    const key = this.queue.shift();
    const e = this.entries.find((x) => x.key === key);
    if (!e) { this.pump(); return; }
    const ctl = new AbortController();
    this.sorting = { key, ctl };
    try {
      const { end } = await this.opts.line({ ...this.lineBody(e), line: e.words }, ctl.signal, (said) => {
        const r = parseReply(said);
        if (!r.head || r.talk || !r.sentence) return;
        const s = this.layer.sorted[key] || {};
        if (r.kind) s.kind = kindFor(e.line, r.kind) === 'answer' ? 'note' : kindFor(e.line, r.kind);
        s.sentence = r.sentence;
        s.remark = r.remark || '';
        if (r.owner) s.owner = r.owner;
        if ((s.kind || e.kind) === 'todo') s.due = dueOf(e.words) || null;
        this.layer.sorted[key] = s;
      });
      if (!end.ok) this.status = this.W.sortFail(end.error || '');
      else if (this.status.startsWith(this.W.sortFail('').slice(0, 6))) this.status = '';
    } catch (err) { if (!ctl.signal.aborted) this.status = this.W.sortFail(err.message); }
    this.sorting = null;
    this.saveLayer();
    this.parse();
    this.render();
    this.pump();
  }
  lineBody(e) {
    const prev = this.notes.find((n) => n.previous);
    const others = this.notes.filter((n) => !n.previous).map((n) => ({ name: nameOf(n.path), text: n.text, items: meetingItems(n.text) }));
    const folder = this.opts.path.includes('/') ? this.opts.path.slice(0, this.opts.path.lastIndexOf('/')) : '';
    const memory = [prev ? memoryOf(nameOf(prev.path), meetingItems(prev.text)) : '', others.length ? projectMemory(`folder ${folder || '(top)'}`, others) : ''].filter(Boolean).join('\n\n');
    return { path: this.opts.path, title: /^#\s+(.+)$/m.exec(this.text)?.[1] || nameOf(this.opts.path), agenda: this.sections, item: e?.section || '', today: weekAhead(), memory, under: '' };
  }
  // "?? …": asked of the margin — answered from the session and the notes before it; not in the note unless kept.
  async askMargin(q) {
    const a = { q: q.replace(/^\?\?\s*/, ''), a: '', at: Date.now(), busy: true };
    this.layer.answers.push(a);
    this.layer.answers = this.layer.answers.slice(-12);
    this.renderAnswers();
    try {
      const notes = this.notes.map((n) => ({ name: nameOf(n.path), text: n.text }));
      const { end } = await this.opts.line({ ...this.lineBody(null), line: q, task: 'explain', note: this.text.slice(0, 16000), found: snippetsFor(q, notes) }, undefined, (said) => { a.a = plainReply(said); this.renderAnswers(); });
      if (!end.ok && !a.a) a.a = this.W.failed(end.error || '');
    } catch (err) { a.a = this.W.failed(err.message); }
    a.busy = false;
    this.saveLayer();
    this.renderAnswers();
  }

  // Talking with it: what they say, answered from the session, the folder's notes and their other notes;
  // what is worth keeping offered as lines, put in the note only by a press.
  async talkTo(text) {
    const a = { q: text, a: '', at: Date.now(), busy: true, talk: true, notes: [], refs: {} };
    const history = (this.layer.answers || []).filter((x) => x.talk && x.a && !x.busy).slice(-6).map((x) => ({ me: x.q, ai: x.a }));
    this.layer.answers.push(a);
    this.layer.answers = this.layer.answers.slice(-16);
    this.renderAnswers();
    try {
      const items = this.entries.slice(-200).map((x) => ({ kind: x.guess ? `${x.kind}?` : x.kind, text: x.words, section: x.section }));
      const r = await this.opts.talk(text, history, items);
      Object.assign(a, { a: r.reply, notes: r.notes || [], refs: r.refs || {} });
    // (A server older than the page — the app not started again since an update — has no talk yet.)
    } catch (err) { a.a = err.status === 404 ? this.W.restart : this.W.failed(err.message); }
    a.busy = false;
    this.saveLayer();
    this.renderAnswers();
  }
  // Its words, with [[a note]] a link to it.
  linked(text, refs = {}) {
    const out = [];
    let at = 0;
    for (const m of String(text).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)) {
      out.push(text.slice(at, m.index));
      const p = refs[m[1].trim()] || refs[nameOf(m[1].trim())];
      if (p) { const b = el('a', 'room-ref', m[2] || nameOf(m[1])); b.href = '#'; b.addEventListener('click', (e) => { e.preventDefault(); this.opts.openNote(p); }); out.push(b); } else out.push(m[2] || nameOf(m[1]));
      at = m.index + m[0].length;
    }
    out.push(text.slice(at));
    return out;
  }

  // ------------------------------------------------------------ weaving

  weaveSoon(now = false) {
    clearTimeout(this.weaveTimer);
    if (this.dead) return;
    const go = () => this.weaveNow();
    if (now || this.since >= 3) { go(); return; }
    if (this.since > 0) this.weaveTimer = setTimeout(go, 15000);
  }
  async weaveNow() {
    if (this.weaving) { this.weaveAgain = true; return; }
    const items = this.entries.slice(-80);
    if (items.length < 2) return;
    this.weaving = true;
    this.since = 0;
    this.renderHead();
    try {
      const r = await this.opts.weave(items.map((x) => ({ kind: x.guess ? `${x.kind}?` : x.kind, text: x.words, section: x.section })));
      const keys = items.map((x) => x.key);
      // The margin's links again (those kept, or drawn by hand, stay).
      const mine = this.layer.links.filter((l) => l.by === 'me' || l.kept);
      this.layer.links = [...mine, ...wovenLinks(r, keys, { have: mine, cut: this.layer.cut })];
      const stand = r.stand && !(this.layer.weave?.stand?.by === 'me' && this.layer.weave.stand.item === r.stand.item) ? r.stand : this.layer.weave?.stand || null;
      const asked = new Set(this.layer.asks.map((a) => norm(a.text)));
      let ask = r.ask && !asked.has(norm(r.ask.text)) ? { text: r.ask.text, key: r.ask.s ? keys[r.ask.s - 1] : null } : null;
      // About an item they have moved on from (another item since, or many lines on): not asked now — kept for the close.
      const now = this.entries.at(-1);
      const at = ask?.key ? this.entries.findIndex((x) => x.key === ask.key) : -1;
      if (ask && at >= 0 && (this.entries[at].section !== now?.section || this.entries.length - 1 - at > 8)) {
        this.layer.asks.push({ text: ask.text, key: ask.key, how: 'late', at: Date.now() });
        ask = null;
      }
      this.layer.weave = { at: Date.now(), stand, ask, before: (r.before || []).map((b) => ({ key: keys[b.s - 1], note: b.note, was: b.was, why: b.why })).filter((b) => b.key) };
      this.status = '';
      this.saveLayer();
    } catch (e) { this.status = this.W.weaveFail(e.message); }
    this.weaving = false;
    this.parse();
    this.render();
    if (this.weaveAgain) { this.weaveAgain = false; this.weaveSoon(true); }
  }
  dismissAsk(how) {
    const a = this.layer.weave?.ask;
    if (!a) return;
    this.layer.asks.push({ text: a.text, key: a.key, how, at: Date.now() });
    this.layer.weave.ask = null;
    this.saveLayer();
    this.renderAsk();
  }

  // ------------------------------------------------------------ drawing

  render() {
    if (this.dead) return;
    this.renderHead();
    this.renderNow();
    this.renderLanes();
    this.renderCarry();
    this.renderAsk();
    this.renderAnswers();
    this.input.placeholder = this.W.placeholder;
    this.drawSoon();
  }
  renderHead() {
    const W = this.W;
    const title = /^#\s+(.+)$/m.exec(this.text)?.[1] || nameOf(this.opts.path);
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(this.layer.startedAt || Date.now())) / 60000));
    const links = this.layer.links?.length || 0;
    const space = !this.flatNow();
    this.head.replaceChildren(
      el('span', 'room-kind', this.kindName),
      el('span', 'room-title', title),
      el('span', 'room-clock', W.clock(mins)),
      el('span', 'room-status', this.weaving ? W.weaving : this.status || (links ? W.woven(links) : '')),
      el('span', 'room-gap'),
      button(W.weave, () => this.weaveSoon(true), 'btn small ghost'),
      button(space ? W.flat : W.space, () => { this.flat = space; try { localStorage.setItem('an.roomFlat', space ? '1' : ''); } catch { /* none */ } this.render(); }, 'btn small ghost'),
      button(W.doc, () => this.opts.openNote(this.opts.path), 'btn small ghost'),
      button(W.close, () => this.showClose(), 'btn small primary'),
    );
  }
  // Where the item being talked about stands (the margin's reading, theirs to correct).
  renderNow() {
    const W = this.W;
    const st = this.layer.weave?.stand;
    this.nowBar.hidden = !st;
    if (!st) { this.nowBar.replaceChildren(); return; }
    const part = (k, label) => {
      const v = el('span', 'room-now-v', st[k] || '—');
      v.contentEditable = 'true';
      v.spellcheck = false;
      v.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); v.blur(); } e.stopPropagation(); });
      v.addEventListener('blur', () => {
        const t = v.textContent.replace(/\s+/g, ' ').trim();
        if (t === (st[k] || '—')) return;
        st[k] = t === '—' ? '' : t;
        st.by = 'me';
        this.saveLayer();
      });
      return el('span', `room-now-p ${k}`, el('b', '', label), v);
    };
    this.nowBar.title = W.standHint;
    const L = this.plain ? W.standLecture : W;
    this.nowBar.replaceChildren(el('span', 'room-now-item', `${W.now}${st.item ? ` · ${st.item}` : ''}`), part('agreed', L.agreed), part('open', L.open), part('next', L.next), ...(st.by === 'me' ? [el('span', 'room-now-mine', '✎')] : []));
  }
  // What the meeting before left open (its questions, to-dos not done, what it left for this one): taken up here by a press, as a line of this one.
  renderCarry() {
    const W = this.W;
    const prev = this.notes.find((n) => n.previous);
    const have = new Set(this.entries.map((e) => norm(e.words)));
    const brought = new Set(this.layer.brought || []);
    const open = prev ? meetingItems(prev.text).filter((i) => (i.kind === 'question' || i.kind === 'next' || (i.kind === 'todo' && !i.done)) && !have.has(norm(i.body)) && !brought.has(i.key)).slice(0, 8) : [];
    this.carryBar.hidden = !open.length;
    this.carryBar.replaceChildren(...(open.length ? [el('b', '', `${W.lastTime} · ${nameOf(prev.path)}`), ...open.map((i) => button(`${W.kind[i.kind] || ''} · ${i.body}`, async () => {
      this.layer.brought = [...(this.layer.brought || []), i.key];
      this.saveLayer();
      const made = await this.write((t) => addLines(t, [typedLine(i.kind === 'question' ? `? ${i.body}` : i.kind === 'todo' ? `[] ${i.text}` : i.body)]), { fresh: true });
      for (const k of made) { const x = this.entries.find((y) => y.key === k); if (x) this.sortLater(x); }
    }, 'btn small ghost room-carry-i', W.bring))] : []));
  }
  renderAsk() {
    const W = this.W;
    const a = this.layer.weave?.ask;
    this.askBar.hidden = !a;
    if (!a) { this.askBar.replaceChildren(); return; }
    const q = el('span', 'room-ask-q', a.text);
    if (a.key) q.addEventListener('click', () => this.light(a.key, true));
    this.askBar.replaceChildren(el('b', '', W.ask), q,
      button(W.asked, () => { this.answerTo = a; this.input.focus(); }, 'btn small ghost'),
      button(W.later, () => this.dismissAsk('later'), 'btn small ghost'),
      button('×', () => this.dismissAsk('no'), 'icon-btn', W.notIt));
  }
  renderAnswers() {
    const W = this.W;
    const xs = (this.layer.answers || []).filter((a) => !a.gone).slice(-4);
    const keep = async (a, line) => { a.kept = [...(a.kept || []), line]; this.saveLayer(); this.renderAnswers(); const made = await this.write((t) => addLines(t, [typedLine(line)].filter(Boolean)), { fresh: true }); for (const k of made) { const x = this.entries.find((y) => y.key === k); if (x) this.sortLater(x); } };
    this.answersEl.replaceChildren(...xs.map((a) => el('div', `room-answer${a.talk ? ' room-talk' : ''}`,
      el('div', 'room-answer-q', `${a.talk ? '»' : '??'} ${a.q}`),
      el('div', 'room-answer-a', ...(a.busy && !a.a ? [W.thinking] : this.linked(a.a, a.refs))),
      el('div', 'room-answer-do',
        // What it offers to keep: each a line of the note, on a press.
        ...(a.notes || []).filter((l) => !(a.kept || []).includes(l)).map((l) => button(`${W.keepLine} ${l}`, () => keep(a, l), 'btn small ghost room-keep')),
        !a.talk && a.a && !a.busy ? button(W.keepAnswer, async () => { a.gone = true; this.saveLayer(); await this.write((t) => addLines(t, [`- ${a.q} → ${a.a}`])); }, 'btn small ghost') : null,
        el('span', 'room-gap'),
        button('×', () => { a.gone = true; this.saveLayer(); this.renderAnswers(); }, 'icon-btn')))));
    if (xs.length) this.answersEl.scrollTop = this.answersEl.scrollHeight;
  }
  flatNow() { return this.flat || this.opts.reduced || this.stage.clientWidth < 760; }

  renderLanes() {
    const W = this.W;
    const names = this.kind === 'lecture' ? W.laneLecture : this.kind === 'note-taking' ? W.laneNotes : W.lane;
    this.el.classList.toggle('in-space', !this.flatNow());
    this.el.classList.toggle('room-blank', !this.entries.length);
    if (!this.lanes) {
      this.lanes = new Map(LANES.map((k) => {
        const list = el('div', 'room-lane-list');
        const lane = el('div', `room-lane lane-${k}`, el('div', 'room-lane-head'), list);
        return [k, { lane, list }];
      }));
      this.emptyEl = el('div', 'room-empty');
      this.lanesEl.append(...[...this.lanes.values()].map((x) => x.lane), this.emptyEl);
    }
    this.emptyEl.textContent = W.empty;
    const by = new Map(LANES.map((k) => [k, []]));
    for (const e of this.entries) by.get(laneOf(e.kind)).push(e);
    const old = new Map([...this.cards].map(([k, c]) => [k, c.getBoundingClientRect()]));
    const live = new Set();
    for (const k of LANES) {
      const { lane, list } = this.lanes.get(k);
      const xs = by.get(k);
      lane.querySelector('.room-lane-head').replaceChildren(el('span', '', names[k]), el('span', 'room-lane-n', xs.length ? String(xs.length) : ''));
      lane.classList.toggle('none', !xs.length);
      const els = xs.map((e, n) => {
        live.add(e.key);
        const c = this.card(e);
        c.style.setProperty('--age', String(Math.min(12, xs.length - 1 - n)));
        return c;
      });
      // In order, the newest at the bottom (by the input).
      els.forEach((c, n) => { if (list.children[n] !== c) list.insertBefore(c, list.children[n] || null); });
      while (list.children.length > els.length) list.lastChild.remove();
      list.scrollTop = list.scrollHeight;
    }
    for (const k of [...this.cards.keys()]) if (!live.has(k)) { this.cards.get(k).remove(); this.cards.delete(k); }
    this.animate(old);
  }
  // Each card from where it was (a new one from the input), to where it is now.
  animate(old) {
    if (this.opts.reduced) { this.fresh = null; return; }
    const from = this.input.getBoundingClientRect();
    for (const [k, c] of this.cards) {
      const now = c.getBoundingClientRect();
      const was = old.get(k);
      const isNew = this.fresh?.has(k);
      if (!was && !isNew) continue;
      const src = isNew ? { left: from.left + from.width / 2 - now.width / 2, top: from.top } : was;
      const dx = src.left - now.left;
      const dy = src.top - now.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      c.animate([{ translate: `${dx}px ${dy}px`, scale: isNew ? 0.92 : 1, opacity: isNew ? 0.4 : 1 }, { translate: '0 0', scale: 1, opacity: 1 }], { duration: isNew ? 520 : 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    this.fresh = null;
    const t0 = performance.now();
    const step = () => { this.draw(); if (performance.now() - t0 < 600) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  card(e) {
    const W = this.W;
    let c = this.cards.get(e.key);
    if (!c) {
      c = el('div', 'room-card');
      c.dataset.key = e.key;
      c.addEventListener('pointerenter', () => this.light(c.dataset.key));
      c.addEventListener('pointerleave', () => this.light(null));
      // Pressed: what the margin said of it, and what was recorded before, open (or closed again).
      c.addEventListener('click', (ev) => {
        if (ev.target.closest('button, .room-handle, textarea')) return;
        c.classList.toggle('open');
        const x = this.entries.find((y) => y.key === c.dataset.key);
        if (x) this.card(x);
        this.drawSoon();
      });
      c.addEventListener('dblclick', () => { const x = this.entries.find((y) => y.key === c.dataset.key); if (x) this.editCard(x); });
      this.cards.set(e.key, c);
    }
    if (c.classList.contains('editing')) return c;
    const open = c.classList.contains('open');
    c.className = `room-card${open ? ' open' : ''} kind-${e.kind}${e.guess ? ' guess' : ''}${this.changedKeys.has(e.key) ? ' changed' : ''}${this.answeredKeys.has(e.key) ? ' answered' : ''}${e.done ? ' done' : ''}`;
    const chip = button(e.guess && e.kind !== 'note' ? W.maybe(W.kind[e.kind] || e.kind) : W.kind[e.kind] || e.kind, (ev) => this.kindMenu(e, ev.currentTarget), 'room-chip', e.guess ? W.guess : W.mine);
    const b = this.before.get(e.key);
    const was = b ? el('div', 'room-before', el('b', '', W.before(nameOf(b.note))), ` ${b.was}`, b.why ? ` — ${b.why}` : '') : null;
    was?.addEventListener('click', () => this.opts.openNote(b.note));
    const handle = el('span', 'room-handle', '◦');
    handle.title = W.mineLink;
    handle.addEventListener('pointerdown', (ev) => this.dragLink(e, ev));
    c.replaceChildren(...[
      el('div', 'room-card-top', chip, e.section ? el('span', 'room-sec', e.section) : null, e.owner ? el('span', 'room-who', `@${e.owner}`) : null, e.due ? el('span', 'room-due', e.due) : null,
        this.changedKeys.has(e.key) ? el('span', 'room-flag', W.changed) : null, this.answeredKeys.has(e.key) ? el('span', 'room-flag ok', W.answered) : null,
        el('span', 'room-gap'), button('✎', () => this.editCard(e), 'icon-btn', W.edit), button('×', () => this.write((t) => dropEntry(t, e)), 'icon-btn', W.drop), handle),
      el('div', 'room-words', e.words),
      ...(c.classList.contains('open') ? [
        e.sentence && norm(e.sentence) !== norm(e.words) && !addsDate(e.sentence, e.words) ? el('div', 'room-sentence', e.sentence) : null,
        e.remark && !was && !addsDate(e.remark, e.words) ? el('div', 'room-before', e.remark) : null,
        was,
      ] : [(e.remark || was) ? el('div', 'room-more', W.moreOn) : null]),
    ].filter(Boolean));
    return c;
  }
  kindMenu(e, at) {
    const W = this.W;
    const r = at.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    this.pop.replaceChildren(...['note', 'decision', 'todo', 'question', 'risk', 'idea', 'next'].map((k) => button(W.kind[k], () => {
      this.pop.hidden = true;
      // Marked by them: in the note. A note: plain words again.
      this.write((t) => markEntry(t, e, k === 'note' ? null : k));
    }, `btn small${k === e.kind ? ' on' : ''}`)));
    Object.assign(this.pop.style, { left: `${r.left - host.left}px`, top: `${r.bottom - host.top + 4}px` });
    this.pop.hidden = false;
  }
  editCard(e) {
    const c = this.cards.get(e.key);
    if (!c) return;
    const box = el('textarea', 'room-edit');
    box.value = e.words;
    c.classList.add('editing');
    c.replaceChildren(box);
    box.focus();
    box.select();
    const done = async (keep) => {
      if (!c.classList.contains('editing')) return;
      c.classList.remove('editing');
      const w = box.value.replace(/\s+/g, ' ').trim();
      if (keep && w && w !== e.words) {
        const old = e.key;
        await this.write((t) => editEntry(t, e, w));
        const now = this.entries.find((x) => x.i === e.i)?.key;
        if (now && now !== old) this.rekey(old, now);
      } else this.render();
      this.input.focus();
    };
    box.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.isComposing) return; if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(true); } if (ev.key === 'Escape') done(false); });
    box.addEventListener('blur', () => done(true));
  }
  // An entry's words changed: what the layer knew of it goes with it.
  rekey(a, b) {
    if (this.layer.sorted[a]) { this.layer.sorted[b] = this.layer.sorted[a]; delete this.layer.sorted[a]; }
    for (const l of this.layer.links) { if (l.a === a) l.a = b; if (l.b === a) l.b = b; }
    this.saveLayer();
    this.parse();
    this.render();
  }

  // A card and those linked to it lit; the rest dimmed.
  light(key, scroll = false) {
    this.lit = key;
    const near = new Set(key ? [key] : []);
    if (key) for (const l of this.layer.links) { if (l.a === key) near.add(l.b); if (l.b === key) near.add(l.a); }
    this.el.classList.toggle('lit', !!key);
    for (const [k, c] of this.cards) c.classList.toggle('near', near.has(k));
    if (scroll && key) this.cards.get(key)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    this.draw();
  }
  layout() { if (this.lanes) { this.el.classList.toggle('in-space', !this.flatNow()); this.renderHead(); } }
  // The pointer tilts the space a little.
  tilt(e) {
    if (this.flatNow()) return;
    const r = this.stage.getBoundingClientRect();
    this.stage.style.perspectiveOrigin = `${50 + ((e.clientX - r.left) / r.width - 0.5) * 16}% ${40 + ((e.clientY - r.top) / r.height - 0.5) * 12}%`;
    this.drawSoon();
  }
  drawSoon() {
    if (this.drawing) return;
    this.drawing = true;
    requestAnimationFrame(() => { this.drawing = false; this.draw(); });
  }
  // The links, between where the cards are seen.
  draw() {
    if (this.dead) return;
    const s = this.stage.getBoundingClientRect();
    this.svg.setAttribute('width', String(s.width));
    this.svg.setAttribute('height', String(s.height));
    const out = [];
    const at = (k) => { const c = this.cards.get(k); if (!c || !c.isConnected) return null; const r = c.getBoundingClientRect(); return r.width ? r : null; };
    for (const l of this.layer.links || []) {
      const a = at(l.a);
      const b = at(l.b);
      if (!a || !b) continue;
      const ax = a.left + a.width / 2 - s.left; const ay = a.top + a.height / 2 - s.top;
      const bx = b.left + b.width / 2 - s.left; const by = b.top + b.height / 2 - s.top;
      const side = ax < bx ? 1 : -1;
      const x1 = ax + (side * a.width) / 2; const x2 = bx - (side * b.width) / 2;
      const same = Math.abs(ax - bx) < 4;
      const d = same ? `M${a.right - s.left} ${ay} C${a.right - s.left + 46} ${ay}, ${b.right - s.left + 46} ${by}, ${b.right - s.left} ${by}` : `M${x1} ${ay} C${(x1 + x2) / 2} ${ay}, ${(x1 + x2) / 2} ${by}, ${x2} ${by}`;
      const lit = this.lit && (l.a === this.lit || l.b === this.lit);
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `room-line ${l.kind} ${l.by === 'me' || l.kept ? 'kept' : 'offered'}${lit ? ' lit' : ''}`);
      const hit = document.createElementNS(SVG, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'room-hit');
      hit.addEventListener('click', (ev) => this.linkMenu(l, ev));
      const t = document.createElementNS(SVG, 'title');
      t.textContent = `${this.W.link[l.kind] || ''}${l.why ? ` — ${l.why}` : ''}`;
      hit.append(t);
      out.push(path, hit);
    }
    if (this.dragLine) out.push(this.dragLine);
    this.svg.replaceChildren(...out);
  }
  linkMenu(l, ev) {
    const W = this.W;
    const host = this.el.getBoundingClientRect();
    this.pop.replaceChildren(...[
      el('div', 'room-pop-why', `${W.link[l.kind] || ''}${l.why ? ` — ${l.why}` : ''}${l.by === 'me' ? ` (${W.mineLink})` : ''}`),
      l.by !== 'me' && !l.kept ? button(W.keep, () => { l.kept = true; this.pop.hidden = true; this.saveLayer(); this.draw(); }) : null,
      button(W.cut, () => {
        this.layer.links = this.layer.links.filter((x) => x !== l);
        this.layer.cut.push(pairKey(l.a, l.b));
        this.pop.hidden = true;
        this.saveLayer();
        this.parse();
        this.render();
      }),
    ].filter(Boolean));
    Object.assign(this.pop.style, { left: `${ev.clientX - host.left}px`, top: `${ev.clientY - host.top + 8}px` });
    this.pop.hidden = false;
  }
  // A link drawn by hand: from a card's handle to another card.
  dragLink(e, ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const s = this.stage.getBoundingClientRect();
    const a = this.cards.get(e.key).getBoundingClientRect();
    const x0 = a.right - s.left; const y0 = a.top + a.height / 2 - s.top;
    const line = document.createElementNS(SVG, 'path');
    line.setAttribute('class', 'room-line link kept dragging');
    this.dragLine = line;
    const move = (m) => { line.setAttribute('d', `M${x0} ${y0} L${m.clientX - s.left} ${m.clientY - s.top}`); this.draw(); };
    const up = (u) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.dragLine = null;
      const to = document.elementFromPoint(u.clientX, u.clientY)?.closest?.('.room-card');
      const b = to?.dataset.key;
      if (b && b !== e.key && !this.layer.links.some((l) => pairKey(l.a, l.b) === pairKey(e.key, b))) {
        this.layer.links.push({ a: e.key, b, kind: 'link', why: '', by: 'me' });
        this.layer.cut = this.layer.cut.filter((p) => p !== pairKey(e.key, b));
        this.saveLayer();
      }
      this.draw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ------------------------------------------------------------ the close

  async showClose(again = false) {
    const W = this.W;
    this.overlay.hidden = false;
    this.layer.closing = true;
    this.saveLayer();
    const panel = el('div', 'room-close');
    this.overlay.replaceChildren(panel);
    const head = el('div', 'room-close-head', el('b', '', W.closeTitle), el('span', 'room-gap'), button(W.cancel, () => { this.overlay.hidden = true; this.layer.closing = false; this.saveLayer(); this.input.focus(); }, 'btn small ghost'));
    panel.append(head);
    const sig = sigOf(this.entries);
    let draft = !again && this.layer.draft;
    // Lines added or changed since it was written: written again, from them.
    const stale = draft && draft.sig !== sig;
    if (stale) draft = null;
    if (!draft) {
      const wait = el('div', 'room-wait', W.closing(0));
      panel.append(wait);
      const t0 = Date.now();
      const tick = setInterval(() => { wait.textContent = W.closing(Math.round((Date.now() - t0) / 1000)); }, 1000);
      if (stale) panel.append(el('p', 'room-close-note', W.stale));
      const items = closeItems(this.entries);
      try {
        const r = await this.opts.close(items.map((x) => ({ kind: x.guess ? `${x.kind}?` : x.kind, text: x.words, section: x.section })));
        const keyOf = (xs) => (xs || []).map((n) => items[n - 1]?.key).filter(Boolean);
        // Asks put off while it went on: not sure yet, kept.
        const later = this.layer.asks.filter((a) => a.how === 'later' || a.how === 'late').map((a) => ({ text: a.text, from: a.key ? [a.key] : [] }));
        draft = {
          decided: r.decided.map((x) => splitCond({ text: x.text, from: keyOf(x.from) })),
          who: r.who.map((x) => whoDue({ who: x.who, text: x.text, from: keyOf(x.from) })),
          open: r.open.map((x) => splitCond({ text: x.text, from: keyOf(x.from) })),
          check: r.check.map((x) => ({ text: x.text, from: keyOf(x.from), answer: '' })),
          unsure: [...r.unsure.map((x) => ({ text: x.text, from: keyOf(x.from) })), ...later].filter((x, i, xs) => xs.findIndex((y) => norm(y.text) === norm(x.text)) === i),
          sig,
        };
        this.layer.draft = draft;
        this.saveLayer();
      } catch (e) {
        clearInterval(tick);
        wait.replaceWith(el('div', 'room-wait bad', W.closeFail(e.message)), button(W.again, () => this.showClose(true)));
        return;
      }
      clearInterval(tick);
      wait.remove();
    }
    this.renderDraft(panel, draft);
  }
  renderDraft(panel, draft) {
    const W = this.W;
    const lecture = this.plain;
    const body = el('div', 'room-close-body');
    panel.querySelector('.room-close-body')?.remove();
    panel.querySelector('.room-close-foot')?.remove();
    body.append(el('p', 'room-close-note', W.closeNote));
    const field = (x, k, cls = '') => {
      const v = el('span', `room-draft-v ${cls}`, x[k] || '');
      v.contentEditable = 'true';
      v.spellcheck = false;
      v.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); v.blur(); } });
      v.addEventListener('input', () => { x[k] = v.textContent.replace(/\s+/g, ' ').trim(); this.saveLayer(); });
      return v;
    };
    const row = (list, x, ...kids) => {
      const r = el('div', 'room-draft-row', ...kids, button('×', () => { list.splice(list.indexOf(x), 1); this.saveLayer(); r.remove(); }, 'icon-btn', W.drop));
      if (x.from?.length) {
        r.addEventListener('pointerenter', () => { for (const k of x.from) this.cards.get(k)?.classList.add('near'); this.el.classList.add('lit'); });
        r.addEventListener('pointerleave', () => this.light(null));
      }
      return r;
    };
    // At most three questions first; an answer is a line of the note, as typed.
    if (draft.check.length) {
      const box = el('div', 'room-checks', el('h4', '', W.checks));
      for (const x of draft.check) {
        const ans = el('input', 'room-check-a');
        ans.placeholder = W.checkAnswer;
        ans.value = x.answer || '';
        ans.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) ans.blur(); });
        ans.addEventListener('change', () => { x.answer = ans.value.trim(); this.saveLayer(); });
        box.append(el('div', 'room-check', el('div', 'room-check-q', x.text), ans));
      }
      body.append(box);
    }
    const section = (title, list, make, folded = false) => {
      const sec = el('div', 'room-draft-sec', el('h4', '', title));
      const rows = list.map((x) => make(x));
      if (!rows.length) sec.append(el('div', 'room-draft-none', W.nothing));
      const show = folded ? 4 : 99;
      sec.append(...rows.slice(0, show));
      if (rows.length > show) {
        const more = button(W.more(rows.length - show), () => { more.replaceWith(...rows.slice(show)); }, 'btn small ghost');
        sec.append(more);
      }
      body.append(sec);
    };
    section(lecture ? W.h.points : W.h.decided, draft.decided, (x) => row(draft.decided, x, field(x, 'text'), el('span', 'room-draft-sep', '—'), field(x, 'cond', 'cond')));
    section(lecture ? W.h.tasks : W.h.todos, draft.who, (x) => row(draft.who, x, field(x, 'who', `who${x.who === '?' ? ' none' : ''}`), field(x, 'text'), field(x, 'due', 'due')));
    section(W.h.open, draft.open, (x) => row(draft.open, x, field(x, 'text'), el('span', 'room-draft-sep', '—'), field(x, 'cond', 'cond')));
    section(W.h.unsure, draft.unsure, (x) => row(draft.unsure, x, field(x, 'text')), true);
    // Line by line, if they want: each line's kind, set by them.
    const each = el('details', 'room-each', el('summary', '', W.each(this.entries.length)));
    each.addEventListener('toggle', () => {
      if (!each.open || each.querySelector('.room-each-row')) return;
      for (const e of this.entries) {
        const kinds = ['note', 'decision', 'todo', 'question', 'risk', 'idea', 'next'].map((k) => button(W.kind[k], async (ev) => {
          await this.write((t) => markEntry(t, e, k === 'note' ? null : k));
          for (const b of ev.currentTarget.parentElement.children) b.classList.remove('on');
          ev.currentTarget.classList.add('on');
        }, `btn small${k === e.kind && !e.guess ? ' on' : ''}${k === e.kind && e.guess ? ' guess' : ''}`));
        each.append(el('div', 'room-each-row', el('span', 'room-each-w', e.words), el('span', 'room-each-k', ...kinds)));
      }
    });
    body.append(each);
    // Answers given: into the note as lines, and the draft written again from them (once, for all) — to read before accepting.
    const answers = () => draft.check.filter((x) => x.answer);
    const hint = el('span', 'room-close-hint');
    const go = button(W.accept, async () => {
      if (!answers().length) { this.accept(panel, draft); return; }
      go.disabled = true;
      await this.write((t) => addLines(t, answers().map((x) => `- ${x.text} → ${x.answer}`)));
      this.showClose(true);
    }, 'btn primary');
    const label = () => { const n = answers().length; go.textContent = n ? W.withAnswers(n) : W.accept; hint.textContent = n ? W.answersFirst : ''; };
    body.addEventListener('change', label);
    label();
    const foot = el('div', 'room-close-foot',
      button(W.again, () => this.showClose(true), 'btn small ghost'),
      el('span', 'room-gap'), hint, go);
    panel.append(body, foot);
  }
  // What they accepted: its wrap-up (the answers went in, and the draft was written again from them, before).
  async accept(panel, draft) {
    // A question not answered: not sure yet, kept.
    const unsure = [...draft.unsure, ...draft.check.filter((x) => !x.answer).map((x) => ({ text: x.text, from: x.from }))];
    const next = this.kind === 'meeting' ? nextMeetingPath(this.opts.path) : '';
    const at = `${isoDay(new Date())} ${new Date().toTimeString().slice(0, 5)}`;
    const section = wrapSection({ ...draft, unsure }, { lang: this.lang, kind: this.kind, at, next: next && (await this.opts.exists(next)) ? next : '' });
    await this.write((t) => withWrap(t, section));
    this.layer.closed = true;
    this.layer.closing = false;
    this.layer.accepted = { at, decided: draft.decided.map((x) => [x.text, x.cond].filter(Boolean).join(' — ')), who: draft.who };
    this.saveLayer();
    this.afterClose(panel);
  }
  // Then, only proposed: the folder's notes, the to-do list, the next meeting's note.
  afterClose(panel) {
    const W = this.W;
    const acc = this.layer.accepted || { decided: [], who: [] };
    const body = el('div', 'room-close-body', el('p', 'room-close-note', W.wrapped));
    panel.querySelector('.room-close-body')?.remove();
    panel.querySelector('.room-close-foot')?.remove();
    const out = el('div', 'room-after');
    const say = (...kids) => out.append(el('div', 'room-after-line', ...kids));
    const find = button(W.findChanges, async () => {
      find.disabled = true;
      if (!acc.decided.length) { say(W.noDecided); return; }
      const t0 = Date.now();
      const wait = el('div', 'room-wait', W.reading(0));
      out.append(wait);
      const tick = setInterval(() => { wait.textContent = W.reading(Math.round((Date.now() - t0) / 1000)); }, 1000);
      try {
        const r = await this.opts.changes(acc.decided);
        clearInterval(tick);
        wait.remove();
        const files = [...new Set(r.changes.map((c) => c.file))];
        if (!files.length) { say(W.noChanges); return; }
        say(W.changes(files.length, r.changes.length), ...files.map((f) => el('span', 'room-file', nameOf(f))));
        const go = button(W.propose, async () => {
          go.disabled = true;
          const why = `${this.kindName} “${nameOf(this.opts.path)}”`;
          const ids = [];
          for (const f of files) {
            const cs = r.changes.filter((c) => c.file === f);
            try { const id = await this.opts.proposeNote(f, (text) => withChanges(text, cs).text, { open: false, why }); if (id) ids.push([f, id]); } catch (e) { say(W.failed(`${nameOf(f)}: ${e.message}`)); }
          }
          if (ids.length) say(W.proposed, ...ids.map(([f, id]) => button(nameOf(f), () => this.opts.openReview(id), 'btn small')));
        }, 'btn small primary');
        say(go);
      } catch (e) { clearInterval(tick); wait.remove(); say(W.failed(e.message)); find.disabled = false; }
    }, 'btn small');
    const todos = this.opts.todoFile && acc.who.length ? button(W.addTodos, async () => {
      todos.disabled = true;
      const folder = this.opts.path.includes('/') ? this.opts.path.slice(0, this.opts.path.lastIndexOf('/')) : '';
      let lines = [];
      try {
        const id = await this.opts.proposeNote(this.opts.todoFile, (text) => { lines = todoLines(acc.who, { list: text, folder }); return withTodos(text, lines); }, { open: false, why: `${this.kindName} “${nameOf(this.opts.path)}”` });
        if (id) say(W.todosAdded, button(nameOf(this.opts.todoFile), () => this.opts.openReview(id), 'btn small')); else say(W.todosNone);
      } catch (e) { say(W.failed(e.message)); }
    }, 'btn small') : null;
    const nextBtn = this.kind === 'meeting' ? button(W.nextNote, async () => {
      nextBtn.disabled = true;
      const next = nextMeetingPath(this.opts.path);
      try {
        if (!(await this.opts.exists(next))) {
          const made = nextNote(this.text, { path: this.opts.path, next });
          const fm = `---\ntype: meeting\ndate: ${/(\d{4}-\d{2}-\d{2})/.exec(nameOf(next))?.[1] || isoDay(new Date())}\n---\n`;
          await this.opts.writeNote(next, fm + made);
          await this.write((t) => (/^Next meeting:/m.test(t) ? t : t.replace(/\n*$/, `\n\nNext meeting: [[${nameOf(next)}]]\n`)));
        }
        say(W.nextMade, button(nameOf(next), () => this.opts.openNote(next), 'btn small'));
      } catch (e) { say(W.failed(e.message)); }
    }, 'btn small') : null;
    body.append(el('div', 'room-after-do', find, todos, nextBtn), out);
    const foot = el('div', 'room-close-foot', button(W.again, () => { this.layer.closed = false; this.showClose(true); }, 'btn small ghost'), el('span', 'room-gap'), button(W.cancel, () => { this.overlay.hidden = true; this.input.focus(); }, 'btn small'));
    panel.append(body, foot);
  }
}
