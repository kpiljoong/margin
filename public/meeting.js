// Meetings (experimental): the rail, the wrap-up and the decision wall.
//
// What a meeting decides, leaves open and hands out is written in the note
// itself, as plain Markdown any app reads: the person's own line, where they
// wrote it (in its list, at its depth), with a tag at its end saying what it is.
//   - We ship on Friday #decision
//     - Do we need a beta? #question
//   - [ ] Draft the release notes @ann 📅 2026-10-09
//   - The store review may take a week #risk
//   - A first month free instead of a discount? #idea
//   - The offer range #next                         (for the next meeting)
// Callouts (> [!decision] …, > [!question] …, > [!warning] …, > [!idea] …),
// as earlier meetings were written, are read too.
// The rail (beside the note in meeting mode) gathers them as they are
// written, with the agenda's clock; the wall shows them after, in columns,
// and a card moved there is a change proposed to the note, settled in the
// red pen review. Nothing here writes a note by itself.
import { blocksOf } from './gather.js';

const CALL = /^\s*>\s*\[!(decision|decided|question|warning|risk|idea)\][+-]?\s*(.*)$/i;
const CALL_TYPE = /\[!(?:decision|decided|question|warning|risk|idea)\]/i;
// The callout each kind was written as (a risk as GitHub's and Obsidian's own).
const TYPE = { decision: 'decision', question: 'question', risk: 'warning', idea: 'idea' };
// The tag each kind is marked with now, at the end of the line.
const TAG = { decision: 'decision', question: 'question', risk: 'risk', idea: 'idea', next: 'next' };
const TAGGED = /(^|\s)#(decision|decided|question|risk|idea)\b/i;
const KIND_TAGS = /(^|\s+)#(?:decision|decided|question|risk|idea|next)\b/gi;
// A line's head: its indent, a quote's >, a list's mark.
const HEAD = /^\s*(?:>\s?)*(?:(?:[-*+]|\d+[.)])\s+)?/;
// "! ", "? ", "[] " typed before the words: the kind they were given.
const TYPED = /^(?:[!?]|\[\])\s+(?=\S)/;
const kindOf = (type) => (/^q/i.test(type) ? 'question' : /^(warning|risk)$/i.test(type) ? 'risk' : /^idea$/i.test(type) ? 'idea' : 'decision');
// "- The offer range #next": a topic for the next meeting.
const NEXT = /(^|\s)#next\b/i;
const nextWords = (l) => l.replace(/^\s*(?:[-*+]\s+)?/, '').replace(/(^|\s)#next\b/gi, ' ').replace(/\s+/g, ' ').trim();
const TASK = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const OWNER = /(^|[\s(])@([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u;
const OWNERS = /(^|[\s(])@([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/gu;
const DUE = /(?:\u{1F4C5}\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})/u;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// "## Status (5m)", "(10 min)", "(15\uBD84)": an agenda item and its minutes.
const BUDGET = /\s*\((\d+)\s*(?:m|min|mins|minutes|\uBD84)\)\s*$/i;

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
// The words of an item, without its owner and date.
// (When it was done, as Obsidian Tasks writes it — ✅ and the day — is not
// what it is: ticked, it is the same item.)
export const bodyOf = (text) => text.replace(OWNERS, '$1').replace(DUE, '').replace(/\s*\u2705\s*\d{4}-\d{2}-\d{2}/gu, '').replace(/\s+/g, ' ').trim();

function linesOf(text) {
  const out = [];
  let at = 0;
  for (const l of text.split('\n')) { out.push({ text: l, from: at, to: at + l.length }); at += l.length + 1; }
  return out;
}

// The decisions, questions, to-dos, risks, ideas and topics for next time
// of a note, in order (one of each
// wording: a wrap-up repeating a decision doesn't make it two).
export function meetingItems(text) {
  const seen = new Set();
  return everyItem(text).filter((it) => !seen.has(it.key) && seen.add(it.key));
}
// Each of them, as often as it is written.
function everyItem(text) {
  const out = [];
  let fence = false;
  let section = '';
  let level = 9;
  linesOf(text).forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l.text)) { fence = !fence; return; }
    if (fence) return;
    // An item's section: the agenda item it is under, or a heading as high.
    const hd = HEADING.exec(l.text);
    if (hd && BUDGET.test(hd[2])) level = hd[1].length;
    if (hd && hd[1].length <= level) section = hd[2].replace(BUDGET, '').trim();
    if (hd) return;
    let item = null;
    const c = CALL.exec(l.text);
    if (c) item = { kind: kindOf(c[1]), text: c[2].trim() };
    const t = !c && TASK.exec(l.text);
    if (t) item = { kind: 'todo', text: t[4].trim(), done: t[3] !== ' ' };
    const g = !c && !t && !/^\s*>\s*\[!/.test(l.text) && TAGGED.exec(l.text);
    if (g) item = { kind: kindOf(g[2]), text: tagWords(l.text) };
    if (!c && !t && !g && NEXT.test(l.text) && !/^\s*>/.test(l.text)) item = { kind: 'next', text: nextWords(l.text) };
    if (!item || !bodyOf(item.text)) return;
    const key = `${item.kind}:${norm(bodyOf(item.text))}`;
    out.push({ ...item, key, body: bodyOf(item.text), owner: OWNER.exec(item.text)?.[2], due: DUE.exec(item.text)?.[1], line: i, from: l.from, to: l.to, section });
  });
  return out;
}

// The agenda: headings with minutes, "## Status (5m)"; each to the next
// heading as high as it (or the next item).
export function agendaOf(text) {
  const lines = linesOf(text);
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l.text)) { fence = !fence; return; }
    const m = !fence && HEADING.exec(l.text);
    if (m) heads.push({ i, level: m[1].length, title: m[2], budget: BUDGET.exec(m[2]) });
  });
  const out = [];
  heads.forEach((hd, k) => {
    if (!hd.budget) return;
    const next = heads.slice(k + 1).find((x) => x.level <= hd.level || x.budget);
    const last = next ? next.i - 1 : lines.length - 1;
    out.push({ title: hd.title.replace(BUDGET, '').trim(), budget: Number(hd.budget[1]), level: hd.level, line: hd.i, from: lines[hd.i].from, end: lines[last].to, lastLine: last });
  });
  return out;
}
export const agendaAt = (agenda, pos) => agenda.findIndex((a) => pos >= a.from && pos <= a.end);

// Where to write under the next agenda item: a paragraph of its own after
// its last line with words. → the edit { from, to, insert, caret }, or null
// at the last item.
export function nextAgendaEdit(text, pos) {
  const agenda = agendaOf(text);
  const k = agendaAt(agenda, pos);
  const next = agenda[k + 1] || (k < 0 ? agenda.find((a) => a.from > pos) : null);
  if (!next) return null;
  const lines = linesOf(text);
  let j = next.lastLine;
  while (j > next.line && !lines[j].text.trim()) j--;
  const at = lines[j].to;
  return { from: at, to: at, insert: '\n\n', caret: at + 2, title: next.title };
}

// A line's words, without its head and the tags that say what it is.
const tagWords = (l) => l.replace(HEAD, '').replace(KIND_TAGS, ' ').replace(/\s+/g, ' ').trim();

// What a line is marked as (a callout, a box, a tag): its kind, or null.
function markOf(line) {
  const c = CALL.exec(line);
  if (c) return kindOf(c[1]);
  if (TASK.test(line)) return 'todo';
  const g = TAGGED.exec(line);
  if (g) return kindOf(g[2]);
  return NEXT.test(line) ? 'next' : null;
}

// The line as `kind` (null: plain words again): its head and its words as
// they were, a tag at its end; a to-do a box in its list item. A callout
// becomes a plain line. → the line, or null when it has no words.
function lineAs(line, kind) {
  const c = CALL.exec(line);
  const t = !c && TASK.exec(line);
  let head = '';
  let words;
  if (c) words = c[2];
  else if (t) { head = `${t[1]}${t[2]} `; words = t[4]; }
  else { head = HEAD.exec(line)[0]; words = line.slice(head.length).replace(TYPED, ''); }
  words = words.replace(KIND_TAGS, '').trim();
  if (!words) return null;
  if (c && (kind === 'todo' || kind === 'next')) head = '- ';
  if (kind === 'todo') return /(?:[-*+]|\d+[.)])\s+$/.test(head) ? `${head}[ ] ${words}` : `${head}- [ ] ${words}`;
  return kind ? `${head}${words} #${TAG[kind]}` : `${head}${words}`;
}

// A line as a decision, a to-do, a question, a risk, an idea or a topic for
// next time — or, the kind it is already, plain words again. It stays where
// it is, in its list. → { from, to, insert, caret, kind } or null.
export function classifyLine(text, pos, kind) {
  const lines = linesOf(text);
  const i = lines.findIndex((l) => pos >= l.from && pos <= l.to);
  if (i < 0) return null;
  const l = lines[i];
  const was = markOf(l.text);
  const line = lineAs(l.text, was === kind ? null : kind);
  if (line == null) return null;
  return { from: l.from, to: l.to, insert: line, caret: l.from + line.length, kind: was === kind ? null : kind };
}

// A line kept from the live margin: marked as `kind`, its words as written
// (the margin's sentence stays in the margin); a to-do with its owner and
// date. A line marked already keeps its mark — one typed before it ("! …")
// is written as such. → the line.
export function markLine(line, kind, { owner = null, due = null } = {}) {
  const typed = typedKind(line);
  if (typed) return lineAs(line, typed) ?? line;
  if (markOf(line) || !(TAG[kind] || kind === 'todo')) return line;
  let out = lineAs(line, kind) ?? line;
  if (kind === 'todo' && owner && !out.includes(`@${owner}`)) out += ` @${owner}`;
  if (kind === 'todo' && due && !DUE.test(out)) out += ` \u{1F4C5} ${due}`;
  return out;
}

// A line typed in a meeting starting with "! ", "? " or "[] ": what it is.
export function typedKind(line) {
  const m = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?(!|\?|\[\])\s+\S/.exec(line);
  return m ? { '!': 'decision', '?': 'question', '[]': 'todo' }[m[1]] : null;
}

// A card moved on the wall: the note's text after it. to: { kind } — a
// decision, a question, a risk, an idea, next time, or a to-do of { owner }
// (null: nobody's) — or { done }.
// Every line with its words changes (a wrap-up repeats a decision).
export function moveItem(text, item, to) {
  const same = everyItem(text).filter((x) => x.key === item.key);
  if (!same.length) return text;
  return same.reverse().reduce((t, x) => moveOne(t, x, to), text);
}
function moveOne(text, item, to) {
  const l = text.slice(item.from, item.to);
  let line = l;
  if (to.done != null && item.kind === 'todo') {
    line = l.replace(/\[[ xX]\]/, to.done ? '[x]' : '[ ]');
    // When (Obsidian Tasks, as the assistant's to-do list writes them): at the end, after all that was there.
    if (to.done && to.on && !/\u2705/u.test(line)) line = `${line.replace(/\s+$/, '')} \u2705 ${to.on}`;
  }
  else if (item.kind === 'todo' && to.kind === 'todo') {
    if (to.owner === item.owner) return text;
    if (!to.owner) line = l.replace(OWNER, '$1').replace(/\s{2,}/g, ' ').replace(/\s+$/, '');
    else if (item.owner) line = l.replace(OWNER, `$1@${to.owner}`);
    else {
      const due = DUE.exec(l);
      line = due ? `${l.slice(0, due.index).replace(/\s+$/, '')} @${to.owner} ${l.slice(due.index)}` : `${l.replace(/\s+$/, '')} @${to.owner}`;
    }
  } else if (to.kind === 'todo' && CALL.test(l)) {
    line = `- [ ] ${item.body}${to.owner ? ` @${to.owner}` : ''}${item.due ? ` \u{1F4C5} ${item.due}` : ''}`;
  } else if (to.kind !== item.kind) {
    if (CALL.test(l) && TYPE[to.kind]) line = l.replace(CALL_TYPE, `[!${TYPE[to.kind]}]`);
    else {
      // In its place, in its list: the tag (or the box) changes.
      line = lineAs(l, to.kind);
      if (line == null) return text;
      if (to.kind === 'todo' && to.owner && !OWNER.test(line)) line += ` @${to.owner}`;
    }
  } else return text;
  return text.slice(0, item.from) + line + text.slice(item.to);
}

// The wall's columns: decided, open, the risks, then a column for each
// owner (in the order they come up) and the to-dos nobody has, then the
// ideas and what is for next time (those three only when there are some).
export function wallOf(text) {
  const items = meetingItems(text);
  const owners = [];
  for (const it of items) if (it.kind === 'todo' && it.owner && !owners.includes(it.owner)) owners.push(it.owner);
  const some = (id, title, kind) => {
    const mine = items.filter((i) => i.kind === kind);
    return mine.length ? [{ id, title, kind, items: mine }] : [];
  };
  return [
    { id: 'decided', title: 'Decided', kind: 'decision', items: items.filter((i) => i.kind === 'decision') },
    { id: 'open', title: 'Open questions', kind: 'question', items: items.filter((i) => i.kind === 'question') },
    ...some('risks', 'Risks', 'risk'),
    ...owners.map((o) => ({ id: `@${o}`, title: `@${o}`, kind: 'todo', owner: o, items: items.filter((i) => i.kind === 'todo' && i.owner === o) })),
    { id: 'nobody', title: 'No owner', kind: 'todo', owner: null, items: items.filter((i) => i.kind === 'todo' && !i.owner) },
    ...some('ideas', 'Ideas', 'idea'),
    ...some('later', 'Next time', 'next'),
  ];
}

// "Previous meeting: [[Weekly 2026-10-05]]" near the top: that note's name.
export function previousOf(text) {
  for (const l of text.split('\n').slice(0, 20)) {
    const m = /^\s*(?:\*\*)?Previous meeting:?(?:\*\*)?:?\s*\[\[([^\]|#]+)/i.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

// The next meeting's note: the same name a week on when it has a date in
// it, else "… (next)".
export function nextMeetingPath(path) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const name = path.slice(dir.length).replace(/\.(md|markdown)$/i, '');
  const d = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (d) {
    const t = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + 7));
    return `${dir}${name.replace(d[0], t.toISOString().slice(0, 10))}.md`;
  }
  return `${dir}${name} (next).md`;
}

export const minutes = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// The task the wrap-up asks of the agent. times: [{ title, budget, ms }].
export function wrapTask(path, next, times) {
  const stem = path.split('/').pop().replace(/\.(md|markdown)$/i, '');
  const said = times.filter((t) => t.ms > 0).map((t) => `${t.title} ${Math.max(1, Math.round(t.ms / 60000))}m of ${t.budget}m`);
  return [
    `Wrap up this meeting (${path}) for after it:`,
    '1. At the end of the note, add a section "## Wrap-up": two or three sentences on what the meeting did; a line "**Time:** …" with each agenda item\'s minutes (below); "### To-dos by owner": every to-do of the note (`- [ ] …`), left where it is in the note, listed here under a line **@owner** for each owner (**No owner** last) as a plain list item without the box — its words and \u{1F4C5} date, crossed out (`~~…~~`) when done, then ` · [[#its section\'s heading]]`; "### Decisions", "### Open questions", "### Risks" and "### Ideas": each line of the note marked `#decision` / `#question` / `#risk` / `#idea` (or written as a `> [!decision]` / `> [!question]` / `> [!warning]` / `> [!idea]` callout) again, as a list item `- … #decision` (and so on) (a heading with none: leave it out). Leave the rest of the note as it is.',
    `2. Create the next meeting's note, ${next}: "# " and its name, a line "Previous meeting: [[${stem}]]", then the same agenda headings with their minutes; under each, the open questions raised there, carried over as list items ending in \`#question\`, and the lines marked \`#next\` there, as list items without the tag. Nothing else.`,
    said.length ? `Time on the agenda: ${said.join('; ')}.` : 'The agenda\'s clock was not kept: leave the time line out.',
    'Keep it plain Markdown: decisions, questions, risks and ideas as lines ending in their tag (#decision, #question, #risk, #idea), to-dos as `- [ ] what @owner \u{1F4C5} YYYY-MM-DD`.',
  ].join('\n');
}

// Fold (the live margin's quick wrap-up): the note with a "## Wrap-up" at
// the end — the summary, the time on each item, its to-dos by owner (each
// left where it was written, in its list; here only its words and a link to
// its section), its decisions, questions, risks and ideas again, then the
// link to the next meeting. A section an earlier fold left goes
// (to-dos an older fold moved into it go back into the note), as do the questions asked of the margin
// (?? …). Done here, not by an agent: what the margin
// wrote is already in the note. times: [{ title, budget, ms }]; settled:
// the keys of questions the meeting decided or answered (not open any more).
const WRAP = /^##\s+Wrap-up\s*$/i;
// A to-do as the wrap-up shows it: its words (its owner is the heading over
// it), crossed out when done, and a link to its section — not a to-do itself.
const todoRef = (t) => {
  const words = t.text.replace(OWNERS, '$1').replace(KIND_TAGS, ' ').replace(/\s+/g, ' ').trim();
  return `- ${t.done ? `~~${words}~~` : words}${t.head ? ` \u00b7 [[#${t.head.replace(/[[\]|#^]/g, '')}]]` : ''}`;
};
// The questions a fold asks about: the note's, an earlier fold's left out.
export function foldQuestions(text) {
  const w = text.split('\n').findIndex((l) => WRAP.test(l));
  const body = w < 0 ? text : text.split('\n').slice(0, w).join('\n');
  return meetingItems(body).filter((i) => i.kind === 'question');
}
export function foldNote(text, { path, next, summary = '', times = [], settled = [] }) {
  const stem = (p) => p.split('/').pop().replace(/\.(md|markdown)$/i, '');
  let lines = text.split('\n');
  const w = lines.findIndex((l) => WRAP.test(l));
  let old = [];
  if (w >= 0) {
    let e = lines.findIndex((l, i) => i > w && /^#{1,2}\s/.test(l));
    if (e < 0) e = lines.length;
    old = lines.slice(w + 1, e);
    lines = [...lines.slice(0, w), ...lines.slice(e)];
  }
  const todos = [];
  const body = [];
  let fence = false;
  let cut = false;
  let head = null;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const hd = !fence && HEADING.exec(l);
    if (hd) head = hd[2];
    const t = !fence && TASK.exec(l);
    if (t) todos.push({ text: t[4], done: t[3] !== ' ', head });
    // "?? …": asked of the live margin, not part of the minutes.
    if (!fence && /^\s*\?\?/.test(l)) { cut = true; continue; }
    if (cut && !l.trim() && !body.at(-1)?.trim()) continue;
    cut = false;
    body.push(l);
  }
  while (body.length && !body.at(-1).trim()) body.pop();
  // An older fold moved its to-dos into its section: back into the note.
  const moved = old.filter((l) => TASK.test(l)).map((l) => l.trim());
  if (moved.length) {
    body.push('', ...moved);
    for (const l of moved) { const t = TASK.exec(l); todos.push({ text: t[4], done: t[3] !== ' ', head: null }); }
  }
  const items = meetingItems(body.join('\n'));
  const out = [...body, '', '## Wrap-up', ''];
  if (summary.trim()) out.push(summary.trim(), '');
  const said = times.filter((t) => t.ms > 0).map((t) => `${t.title} ${Math.max(1, Math.round(t.ms / 60000))}m of ${t.budget}m`);
  if (said.length) out.push(`**Time:** ${said.join('; ')}`, '');
  if (todos.length) {
    out.push('### To-dos by owner', '');
    const owners = [];
    const ownerOf = (t) => OWNER.exec(t.text)?.[2] || '';
    for (const t of todos) { const o = ownerOf(t); if (!owners.includes(o)) owners.push(o); }
    owners.sort((a, b) => (a === '') - (b === ''));
    for (const o of owners) out.push(o ? `**@${o}**` : '**No owner**', '', ...todos.filter((t) => ownerOf(t) === o).map(todoRef), '');
  }
  const done = new Set(settled);
  for (const [head, kind] of [['Decisions', 'decision'], ['Open questions', 'question'], ['Risks', 'risk'], ['Ideas', 'idea']]) {
    const xs = items.filter((i) => i.kind === kind && !done.has(i.key));
    if (!xs.length) continue;
    out.push(`### ${head}`, '', ...xs.map((i) => `- ${i.text} #${TAG[kind]}`), '');
  }
  // Settled: plain lines, so they are no longer read as open.
  const gone = items.filter((i) => i.kind === 'question' && done.has(i.key));
  if (gone.length) out.push('### Settled', '', ...gone.map((i) => `- ${i.text}`), '');
  out.push(`Next meeting: [[${stem(next)}]]`, '');
  return out.join('\n');
}

// The next meeting's note: its name, the link back, the same agenda, and
// under each item the questions left open there and what was left for it
// (#next), not those settled; the rest of them at the end.
export function nextNote(text, { path, next, settled = [] }) {
  const stem = (p) => p.split('/').pop().replace(/\.(md|markdown)$/i, '');
  const agenda = agendaOf(text);
  const done = new Set(settled);
  const items = meetingItems(text).filter((i) => (i.kind === 'question' && !done.has(i.key)) || i.kind === 'next');
  const under = (xs) => xs.map((i) => (i.kind === 'question' ? `- ${i.text} #question` : `- ${i.text}`));
  const out = [`# ${stem(next)}`, '', `Previous meeting: [[${stem(path)}]]`, ''];
  const titles = new Set(agenda.map((a) => a.title));
  for (const a of agenda) {
    out.push(`${'#'.repeat(a.level || 2)} ${a.title} (${a.budget}m)`, '');
    const xs = items.filter((i) => i.section === a.title);
    if (xs.length) out.push(...under(xs), '');
  }
  const rest = items.filter((i) => !titles.has(i.section));
  if (rest.length) out.push(...(agenda.length ? ['## Carried over', ''] : []), ...under(rest), '');
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

// ---------------------------------------------------------------- views

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}
const btn = (text, run, cls = '') => {
  const b = el('button', `btn small ${cls}`.trim(), text);
  b.addEventListener('click', (e) => { e.stopPropagation(); run(e); });
  return b;
};
const KIND = { decision: 'Decided', question: 'Open', todo: 'To-do', risk: 'Risk', idea: 'Idea', next: 'Next time' };
// An owner's colour, the same on the rail, the wall and its picture.
const OWNER_COLORS = ['#e07a5f', '#5fa8d3', '#9b7fd4', '#e9b44c', '#4fb39a', '#d46a9f', '#7d93e8', '#a3b84f'];
export function ownerColor(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return OWNER_COLORS[h % OWNER_COLORS.length];
}
function avatar(name) {
  const a = el('span', 'm-avatar', (name || '?')[0].toUpperCase());
  a.style.setProperty('--own', ownerColor(name));
  a.title = `@${name}`;
  return a;
}
function chips(it) {
  return el('span', 'm-chips',
    it.owner ? el('span', 'm-owner', avatar(it.owner), `@${it.owner}`) : null,
    it.due ? el('span', 'm-due', `\u{1F4C5} ${it.due.slice(5)}`) : null);
}

// The rail: the agenda and its clock, then what the meeting decided, hands
// out and leaves open, as it is written. opts: { go(item), goLine(line),
// wrapUp(), wall(), hint }. → the element, with update(items, agenda, cur, times,
// from) — from: where on the screen a new item's line is, to fly from.
export function railPane(opts) {
  const agendaEl = el('div', 'mrail-agenda');
  const lanes = {};
  // A lane of one kind, or of a few (each card says which; empty, it hides).
  const lane = (kind, title, kinds = [kind]) => {
    const list = el('div', 'mrail-list');
    const n = el('span', 'mrail-n', '0');
    const sec = el('section', `mrail-lane m-${kind}`, el('div', 'mrail-head', el('span', 'mrail-dot'), title, n), list);
    lanes[kind] = { list, n, cards: new Map(), kinds, sec };
    return sec;
  };
  const root = el('aside', 'mrail',
    agendaEl,
    lane('decision', 'Decisions'), lane('todo', 'To-dos'), lane('question', 'Questions'),
    lane('more', 'Risks \u00B7 ideas \u00B7 next time', ['risk', 'idea', 'next']),
    el('div', 'mrail-foot', btn('Fold', () => opts.fold(), 'primary'), btn('Wrap up ▸', () => opts.wrapUp()), btn('Wall ▦', () => opts.wall())),
    el('div', 'mrail-hint', opts.hint || 'Start a line with ! (a decision), [] (a to-do) or ? (a question)'));
  let agendaRows = [];

  function drawAgenda(agenda, cur, times) {
    if (!agenda.length) { agendaEl.replaceChildren(el('div', 'mrail-noagenda', 'No agenda: headings with minutes, like ', el('code', '', '## Status (5m)'), ', are its items.')); agendaRows = []; return; }
    const total = agenda.reduce((s, a) => s + a.budget, 0);
    const bar = el('div', 'mrail-bar');
    const list = el('div', 'mrail-items');
    agendaRows = agenda.map((a, k) => {
      const seg = el('span', 'mrail-seg');
      seg.style.flexGrow = String(a.budget);
      const fill = el('span', 'mrail-fill');
      seg.append(fill);
      bar.append(seg);
      const time = el('span', 'mrail-time');
      const row = el('div', 'mrail-item', el('span', 'mrail-mark'), el('span', 'mrail-title', a.title), time);
      row.addEventListener('click', () => opts.goLine?.(a.line));
      list.append(row);
      return { seg, fill, row, time, a, k };
    });
    agendaEl.replaceChildren(el('div', 'mrail-head', el('span', 'mrail-dot'), 'Agenda', el('span', 'mrail-n', `${total}m`)), bar, list);
    tick(cur, times);
  }
  function tick(cur, times) {
    for (const r of agendaRows) {
      const ms = times[r.k] || 0;
      const over = ms > r.a.budget * 60000;
      r.fill.style.width = `${Math.min(100, (ms / (r.a.budget * 60000)) * 100)}%`;
      r.seg.classList.toggle('over', over);
      r.seg.classList.toggle('cur', r.k === cur);
      r.row.classList.toggle('cur', r.k === cur);
      r.row.classList.toggle('over', over);
      r.row.classList.toggle('done', r.k < cur || (ms > 0 && r.k !== cur));
      r.time.textContent = `${minutes(ms)} / ${r.a.budget}m`;
    }
  }

  function card(it, mixed) {
    const c = el('div', `mrail-card m-${it.kind}${it.done ? ' done' : ''}`, mixed ? el('span', 'm-kind', KIND[it.kind]) : null, el('span', 'm-text', it.body), chips(it));
    c.title = 'Go to the line';
    c.addEventListener('click', () => opts.go(it));
    return c;
  }
  function update(items, agenda, cur, times, from) {
    drawAgenda(agenda, cur, times);
    for (const [kind, ln] of Object.entries(lanes)) {
      const mine = items.filter((i) => ln.kinds.includes(i.kind));
      ln.n.textContent = String(mine.length);
      const next = new Map();
      const kids = mine.map((it) => {
        const id = `${it.key}|${it.owner || ''}|${it.due || ''}|${it.done ? 1 : 0}`;
        let c = ln.cards.get(id);
        if (!c) {
          c = card(it, ln.kinds.length > 1);
          if (from && from.line === it.line) c.dataset.fly = '1';
          else if (ln.cards.size || from) c.classList.add('m-new');
        }
        c.onclick = () => opts.go(it);
        next.set(id, c);
        return c;
      });
      ln.list.replaceChildren(...kids);
      if (ln.kinds.length > 1) ln.sec.hidden = !kids.length;
      else if (!kids.length) ln.list.append(el('div', 'mrail-empty', { decision: 'Nothing decided yet.', todo: 'Nothing handed out yet.', question: 'Nothing left open yet.' }[kind]));
      ln.cards = next;
    }
    // A new item flies from its line to its card.
    for (const c of root.querySelectorAll('[data-fly]')) {
      delete c.dataset.fly;
      fly(from, c);
    }
  }
  root.railUpdate = update;
  root.railTick = (cur, times) => tick(cur, times);
  return root;
}

function fly(from, card) {
  const to = card.getBoundingClientRect();
  if (!to.width || !from?.rect) { card.classList.add('m-new'); return; }
  const stage = !!card.closest('.m-stage');
  const ghost = el('div', `m-fly m-${card.className.match(/m-(decision|todo|question|risk|idea|next)\b/)?.[1] || 'todo'}${stage ? ' m-fly-stage' : ''}`, from.text);
  ghost.style.left = `${from.rect.left}px`;
  ghost.style.top = `${from.rect.top}px`;
  ghost.style.width = `${Math.min(from.rect.width, 520)}px`;
  document.body.append(ghost);
  card.classList.add('m-landing');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ghost.style.transform = `translate(${to.left - from.rect.left}px, ${to.top - from.rect.top}px) scale(${Math.max(0.5, to.width / Math.max(1, Math.min(from.rect.width, 520)))})`;
    ghost.style.opacity = '0.2';
    ghost.classList.add('away');
  }));
  setTimeout(() => { ghost.remove(); card.classList.remove('m-landing'); card.classList.add('m-landed'); }, stage ? 770 : 620);
}

// "Since last time": the previous meeting's to-dos, how many are done, and
// what it decided. opts: { name, items, open(item), close() }.
export function sinceCard(opts) {
  const todos = opts.items.filter((i) => i.kind === 'todo');
  const done = todos.filter((i) => i.done).length;
  const decided = opts.items.filter((i) => i.kind === 'decision');
  const open = opts.items.filter((i) => i.kind === 'question');
  const ring = el('span', 'since-ring', todos.length ? `${done}/${todos.length}` : '');
  ring.style.setProperty('--p', String(todos.length ? done / todos.length : 1));
  const owners = [];
  for (const t of todos) if (!owners.includes(t.owner || '')) owners.push(t.owner || '');
  const row = (it) => {
    const r = el('div', `since-item m-${it.kind}${it.done ? ' done' : ''}`, el('span', 'since-box', it.kind === 'todo' ? (it.done ? '✓' : '') : it.kind === 'decision' ? '✔' : '?'), el('span', 'm-text', it.body), it.due ? el('span', 'm-due', it.due.slice(5)) : null);
    r.addEventListener('click', () => opts.open(it));
    return r;
  };
  return el('div', 'since',
    el('div', 'since-head', ring,
      el('div', 'since-what', el('div', 'since-title', 'Since last time'), el('div', 'since-sub', `${opts.name} · ${done} of ${todos.length} to-do${todos.length === 1 ? '' : 's'} done${open.length ? ` · ${open.length} open question${open.length === 1 ? '' : 's'}` : ''}`)),
      btn('×', () => opts.close(), 'since-x')),
    el('div', 'since-cols',
      ...owners.map((o) => el('div', 'since-col', el('div', 'since-who', o ? avatar(o) : null, o ? `@${o}` : 'No owner'), ...todos.filter((t) => (t.owner || '') === o).map(row))),
      decided.length ? el('div', 'since-col', el('div', 'since-who', 'Decided'), ...decided.map(row)) : null));
}

// ---------------------------------------------------------------- the wall

// opts: { path, title, text, render(md) → html, propose(text) → Promise,
// copyPng(blobPromise) → Promise, close(), orbit(sceneOpts) → the decision
// orbit (stage.js; none: no orbit), orbiting: open in it }.
export function openWall(opts) {
  const original = opts.text;
  let text = original;
  let lit = null;
  const cols = el('div', 'wall-cols');
  const doc = el('div', 'wall-doc md');
  const threads = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  threads.setAttribute('class', 'wall-threads');
  const count = el('span', 'wall-count');
  const propose = btn('Propose to the note', () => send(), 'primary');
  const reset = btn('Reset', () => { text = original; draw(true); });
  const orbitBtn = opts.orbit ? btn('Orbit ◎', () => orbit(!scene)) : null;
  const badge = el('span', 'wall-badge', 'Decision wall · experimental');
  const root = el('div', 'wall',
    el('div', 'wall-head',
      el('div', 'wall-titles', badge, el('h1', 'wall-title', opts.title)),
      count, el('span', 'grow'), reset, propose, orbitBtn, btn('Copy PNG', () => copy()), btn('×', () => close(), 'wall-x')),
    el('div', 'wall-body', el('div', 'wall-note', el('div', 'wall-note-head', 'The note'), doc), cols),
    el('div', 'wall-hint', `Drag a card: a to-do to someone else, a question to Decided, a decision back to Open, a question to someone as a to-do · a click on ☐ checks it off · the changes come back to the note as a proposal to review · c copies the wall as a picture · ${opts.orbit ? 'o: the decision orbit · ' : ''}Esc closes`),
    threads);
  root.tabIndex = 0;

  let blocks = [];
  function drawDoc() {
    blocks = blocksOf(text).map((b) => {
      const e = el('div', 'wall-block');
      e.innerHTML = opts.render(b.text);
      e.dataset.line = String(b.line);
      e.dataset.last = String(b.line + b.text.split('\n').length - 1);
      return e;
    });
    doc.replaceChildren(...blocks);
  }
  const blockOf = (line) => blocks.find((b) => line >= Number(b.dataset.line) && line <= Number(b.dataset.last));

  function cardOf(it, col, k) {
    const box = it.kind === 'todo' ? el('button', `wall-check${it.done ? ' on' : ''}`, it.done ? '✓' : '') : null;
    if (box) {
      box.title = it.done ? 'Not done' : 'Done';
      box.addEventListener('pointerdown', (e) => e.stopPropagation());
      box.addEventListener('click', (e) => { e.stopPropagation(); change(it, { done: !it.done }); });
    }
    const c = el('div', `wall-card m-${it.kind}${it.done ? ' done' : ''}`,
      el('div', 'wall-card-top', box, el('span', 'wall-kind', KIND[it.kind]), it.section ? el('span', 'wall-sec', it.section) : null),
      el('div', 'wall-text', it.body),
      el('div', 'wall-card-foot', chips(it)));
    if (it.owner) c.style.setProperty('--own', ownerColor(it.owner));
    c.dataset.key = it.key;
    c.style.animationDelay = `${Math.min(k, 12) * 40 + col * 70}ms`;
    c.addEventListener('mouseenter', () => { lit = it; thread(); });
    c.addEventListener('mouseleave', () => { lit = null; thread(); });
    c.addEventListener('pointerdown', (e) => drag(e, it, c));
    return c;
  }

  // Cards slide to where they are now (FLIP), new ones rise in.
  function draw(first = false) {
    const before = new Map([...cols.querySelectorAll('.wall-card')].map((c) => [c.dataset.key, c.getBoundingClientRect()]));
    const columns = wallOf(text);
    cols.replaceChildren(...columns.map((col, ci) => {
      const head = el('div', 'wall-col-head', col.owner ? avatar(col.owner) : el('span', 'wall-dot'), el('span', 'wall-col-title', col.title), el('span', 'wall-n', String(col.items.length)));
      const c = el('div', `wall-col wall-${col.kind === 'todo' ? 'owner' : col.id}`, head,
        ...col.items.map((it, k) => cardOf(it, ci, k)),
        col.items.length ? null : el('div', 'wall-empty', 'Drop here'));
      if (col.owner) c.style.setProperty('--own', ownerColor(col.owner));
      c.dataset.col = col.id;
      c.wallCol = col;
      return c;
    }));
    if (first) root.classList.add('wall-in');
    else {
      for (const c of cols.querySelectorAll('.wall-card')) {
        c.style.animation = 'none';
        const was = before.get(c.dataset.key);
        if (!was) { c.classList.add('wall-arrived'); continue; }
        const now = c.getBoundingClientRect();
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (!dx && !dy) continue;
        c.style.transform = `translate(${dx}px, ${dy}px)`;
        c.style.transition = 'none';
        requestAnimationFrame(() => { c.style.transition = 'transform 420ms cubic-bezier(.2,.8,.2,1)'; c.style.transform = ''; });
      }
    }
    drawDoc();
    scene?.update(columns, agendaOf(text));
    const n = changes();
    count.textContent = n ? `${n} change${n === 1 ? '' : 's'} to propose` : wallSummary(columns);
    count.classList.toggle('changed', !!n);
    propose.disabled = !n;
    reset.hidden = !n;
    requestAnimationFrame(thread);
  }
  // The cards moved (none when the wall is as the note is again).
  let moves = 0;
  const changes = () => (text === original ? (moves = 0) : moves);

  function change(it, to) {
    const now = meetingItems(text).find((x) => x.key === it.key);
    if (!now) return;
    const next = moveItem(text, now, to);
    if (next === text) return;
    text = next;
    moves++;
    draw();
  }

  // A card's thread to its paragraph in the note.
  function thread() {
    const box = root.getBoundingClientRect();
    threads.setAttribute('width', String(box.width));
    threads.setAttribute('height', String(box.height));
    for (const b of blocks) b.classList.remove('lit');
    if (!lit) { threads.replaceChildren(); return; }
    const card = cols.querySelector(`.wall-card[data-key="${CSS.escape(lit.key)}"]`);
    const block = blockOf(lit.line);
    if (!card || !block) { threads.replaceChildren(); return; }
    block.classList.add('lit');
    const docBox = doc.getBoundingClientRect();
    const r = block.getBoundingClientRect();
    if (r.bottom < docBox.top || r.top > docBox.bottom) block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const c = card.getBoundingClientRect();
    const b = block.getBoundingClientRect();
    const x1 = c.left - box.left - 2;
    const y1 = c.top + Math.min(c.height / 2, 30) - box.top;
    const x2 = b.right - box.left + 6;
    const y2 = b.top + Math.min(b.height / 2, 14) - box.top;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const mx = (x1 + x2) / 2;
    p.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    p.setAttribute('class', `wall-thread m-${lit.kind}`);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(x2));
    dot.setAttribute('cy', String(y2));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', `wall-thread-dot m-${lit.kind}`);
    threads.replaceChildren(p, dot);
  }

  // Dragging a card to another column.
  function drag(e, it, card) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    let over = null;
    const accepts = (col) => col && !(col.kind === it.kind && (it.kind !== 'todo' || (col.owner ?? null) === (it.owner ?? null)));
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        const r = card.getBoundingClientRect();
        ghost = card.cloneNode(true);
        ghost.classList.add('wall-ghost');
        ghost.style.width = `${r.width}px`;
        ghost.style.left = `${r.left}px`;
        ghost.style.top = `${r.top}px`;
        ghost.dataset.dx = String(start.x - r.left);
        ghost.dataset.dy = String(start.y - r.top);
        document.body.append(ghost);
        card.classList.add('wall-lifted');
        root.classList.add('wall-dragging');
        for (const c of cols.children) c.classList.toggle('can-drop', accepts(c.wallCol));
        lit = null;
        thread();
      }
      ghost.style.left = `${ev.clientX - Number(ghost.dataset.dx)}px`;
      ghost.style.top = `${ev.clientY - Number(ghost.dataset.dy)}px`;
      const col = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.classList?.contains('wall-col'));
      over = col && accepts(col.wallCol) ? col : null;
      for (const c of cols.children) c.classList.toggle('drop-on', c === over);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!ghost) return;
      ghost.remove();
      card.classList.remove('wall-lifted');
      root.classList.remove('wall-dragging');
      for (const c of cols.children) c.classList.remove('can-drop', 'drop-on');
      if (over) {
        const col = over.wallCol;
        change(it, col.kind === 'todo' ? { kind: 'todo', owner: col.owner } : { kind: col.kind });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // The decision orbit: the same cards (and the same changes), in space.
  let scene = null;
  function orbit(on) {
    if (on === !!scene) return;
    if (on) {
      scene = opts.orbit({
        move: (it, to) => change(it, to),
        lineOf: (it) => text.split('\n')[it.line] ?? '',
        accepts: (it, t) => (t.kind === 'todo' ? !(it.kind === 'todo' && (it.owner ?? null) === (t.owner ?? null)) : it.kind !== t.kind),
        colorOf: ownerColor,
      });
      root.querySelector('.wall-body').after(scene);
      scene.update(wallOf(text), agendaOf(text));
      scene.start();
      lit = null;
      thread();
    } else {
      scene.destroy();
      scene = null;
      draw(true);
    }
    root.classList.toggle('wall-orbit', !!scene);
    orbitBtn.classList.toggle('wall-orbit-on', !!scene);
    orbitBtn.textContent = scene ? 'Wall ▦' : 'Orbit ◎';
    badge.textContent = scene ? 'Decision orbit · experimental' : 'Decision wall · experimental';
    root.focus({ preventScroll: true });
  }

  async function send() {
    if (text === original) return;
    propose.disabled = true;
    try { await opts.propose(text); close(); } catch { propose.disabled = false; }
  }
  async function copy() {
    const flash = el('div', 'wall-flash');
    root.append(flash);
    setTimeout(() => flash.remove(), 700);
    await opts.copyPng(scene ? scene.png(opts.title, wallSummary(wallOf(text))) : wallPng(opts.title, wallOf(text)));
  }
  function close() {
    if (!root.isConnected) return;
    scene?.destroy();
    ro.disconnect();
    root.remove();
    opts.close();
  }
  root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    e.stopPropagation();
    if (scene && e.key === 'Escape') { e.preventDefault(); orbit(false); } else if (e.key === 'Escape' || e.key === 'q') { e.preventDefault(); close(); } else if (e.key === 'c') { e.preventDefault(); copy(); } else if (e.key === 'o' && opts.orbit) { e.preventDefault(); orbit(!scene); } else if (scene?.key(e)) e.preventDefault();
  });
  doc.addEventListener('scroll', () => requestAnimationFrame(thread));
  cols.addEventListener('scroll', () => requestAnimationFrame(thread));
  const ro = new ResizeObserver(() => thread());
  ro.observe(root);
  root.closeWall = close;
  root.orbit = orbit;
  root.scene = () => scene;
  document.body.append(root);
  draw(true);
  root.focus({ preventScroll: true });
  if (opts.orbiting && opts.orbit) orbit(true);
  return root;
}

function wallSummary(columns) {
  const n = (id) => columns.find((c) => c.id === id)?.items.length || 0;
  const todos = columns.filter((c) => c.kind === 'todo').reduce((s, c) => s + c.items.length, 0);
  const people = columns.filter((c) => c.owner && c.items.length).length;
  return `${n('decided')} decided · ${n('open')} open${n('risks') ? ` · ${n('risks')} risk${n('risks') === 1 ? '' : 's'}` : ''} · ${todos} to-do${todos === 1 ? '' : 's'} for ${people} ${people === 1 ? 'person' : 'people'}`;
}

// The wall as a picture: drawn, not photographed, so it is sharp and the
// same everywhere. → a PNG Blob.
export function wallPng(title, columns) {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const C = { bg: v('--bg', '#1b1d23'), card: v('--bg-2', '#23262e'), fg: v('--fg', '#e6e6e6'), dim: v('--fg-dim', '#9aa0aa'), border: v('--border', '#30343d'), decision: v('--ok', '#9ece6a'), question: v('--accent-2', '#bb9af7'), todo: v('--accent', '#7aa2f7'), risk: v('--warn', '#e0af68'), idea: v('--teal', '#73daca'), next: v('--fg-dim', '#9aa0aa') };
  const font = '-apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const shown = columns.filter((c) => c.items.length || c.id === 'decided' || c.id === 'open');
  const W = 300;
  const GAP = 18;
  const PAD = 40;
  const k = 2;
  const probe = document.createElement('canvas').getContext('2d');
  const wrapText = (ctx, s, width) => {
    const words = s.split(/\s+/);
    const out = [];
    let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > width && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out.slice(0, 5);
  };
  probe.font = `15px ${font}`;
  const cardH = (it) => 46 + wrapText(probe, it.body, W - 36).length * 21 + (it.owner || it.due ? 22 : 0);
  const colH = shown.map((c) => 44 + c.items.reduce((s, it) => s + cardH(it) + 10, 0));
  const width = PAD * 2 + shown.length * W + (shown.length - 1) * GAP;
  const height = PAD + 70 + Math.max(120, ...colH) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = width * k;
  canvas.height = height * k;
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  const round = (x, y, w, hh, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, hh, r); };
  ctx.fillStyle = C.dim;
  ctx.font = `600 12px ${font}`;
  ctx.fillText('DECISION WALL', PAD, PAD + 4);
  ctx.fillStyle = C.fg;
  ctx.font = `700 26px ${font}`;
  ctx.fillText(title, PAD, PAD + 38);
  ctx.fillStyle = C.dim;
  ctx.font = `13px ${font}`;
  ctx.textAlign = 'right';
  ctx.fillText(wallSummary(columns), width - PAD, PAD + 38);
  ctx.textAlign = 'left';
  shown.forEach((col, ci) => {
    const x = PAD + ci * (W + GAP);
    let y = PAD + 70;
    const color = col.owner ? ownerColor(col.owner) : col.kind !== 'todo' ? C[col.kind] : C.dim;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 9, y + 12, col.owner ? 11 : 5, 0, Math.PI * 2);
    ctx.fill();
    if (col.owner) { ctx.fillStyle = '#fff'; ctx.font = `700 12px ${font}`; ctx.textAlign = 'center'; ctx.fillText(col.owner[0].toUpperCase(), x + 9, y + 16); ctx.textAlign = 'left'; }
    ctx.fillStyle = C.fg;
    ctx.font = `700 15px ${font}`;
    ctx.fillText(col.title, x + 28, y + 17);
    const tw = ctx.measureText(col.title).width;
    ctx.fillStyle = C.dim;
    ctx.font = `13px ${font}`;
    ctx.fillText(String(col.items.length), x + 28 + tw + 8, y + 17);
    y += 44;
    for (const it of col.items) {
      const hh = cardH(it);
      const tint = it.kind !== 'todo' ? C[it.kind] : it.owner ? ownerColor(it.owner) : C.todo;
      round(x, y, W, hh, 10);
      ctx.fillStyle = C.card;
      ctx.fill();
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.stroke();
      round(x, y, 4, hh, 2);
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.fillStyle = tint;
      ctx.font = `700 11px ${font}`;
      ctx.fillText((it.done ? 'DONE' : KIND[it.kind]).toUpperCase(), x + 18, y + 22);
      ctx.fillStyle = it.done ? C.dim : C.fg;
      ctx.font = `15px ${font}`;
      let ty = y + 44;
      for (const l of wrapText(ctx, it.body, W - 36)) { ctx.fillText(l, x + 18, ty); ty += 21; }
      if (it.owner || it.due) {
        ctx.fillStyle = C.dim;
        ctx.font = `12px ${font}`;
        ctx.fillText([it.owner && `@${it.owner}`, it.due && `due ${it.due}`].filter(Boolean).join('  ·  '), x + 18, ty + 2);
      }
      y += hh + 10;
    }
  });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
}
