// Brief (Labs): the margin as a secretary. What kind of note this is (a
// meeting, a piece of writing, a plan), and by rules alone — nothing is sent
// — what it has to cover (the agenda, and what the last meeting left: its
// open questions, its "#next" lines, its to-dos not done), whether that has
// been covered yet, and what still needs settling: to-dos with nobody or no
// date, dates already past or on a weekend, the same to-do with two dates
// (here, or here and in another note), no decision, no next step, no
// summary. app.js shows it: a headline pinned at the top of the margin, and
// a card beside each line it is about. Claude, when asked (lib/brief.js),
// adds what rules can't see: what goes against what, a step that doesn't
// follow, the reason a decision was made.
//
// Plain logic (test/brief.test.mjs).
import { meetingItems, agendaOf, previousOf } from './meeting.js';
import { wordsOf, nearness } from './recall.js';

const MEETING_NAME = /\b(meeting|minutes|standup|stand-up|sync|1:1|1-1|one-on-one|1on1|retro|retrospective|kickoff|kick-off|weekly|all-hands|review)\b|\uD68C\uC758|\uBBF8\uD305|\uD68C\uC758\uB85D|\uC8FC\uAC04|\uC2F1\uD06C|\uC2A4\uD0E0\uB4DC\uC5C5|\uD68C\uACE0|\uD0A5\uC624\uD504|\uBA74\uB2F4/i;
const MEETING_LINE = /^\s*(?:\*\*)?(attendees|participants|present|agenda|\uCC38\uC11D\uC790?|\uCC38\uC5EC\uC790|\uC548\uAC74|\uC544\uC820\uB2E4)(?:\*\*)?\s*:?/im;
const WRITING_NAME = /\b(blog|post|draft|essay|article|newsletter|op-ed)\b|\uBE14\uB85C\uADF8|\uCD08\uC548|\uC5D0\uC138\uC774|\uC6D0\uACE0|\uAE30\uACE0|\uCE7C\uB7FC|\uAE00\uAC10/i;
const PLAN_NAME = /\b(plan|proposal|roadmap|strategy|rfc|spec|prd|design doc)\b|\uACC4\uD68D|\uAE30\uD68D|\uC81C\uC548|\uB85C\uB4DC\uB9F5|\uC804\uB7B5|\uC124\uACC4/i;
const FRONT = /^---\n([\s\S]*?)\n---\n?/;
const DUE = /(?:\u{1F4C5}\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})/u;
const DATE_IN = /(\d{4})-(\d{2})-(\d{2})/;
// Headings that hold the meeting's frame, not a topic of it.
const FRAME = /^(attendees|participants|present|agenda|notes?|action items?|actions|to-?dos?|next steps?|decisions?|summary|tl;?dr|wrap-?up|open questions?|questions|risks?|ideas?|links?|\uCC38\uC11D\uC790?|\uC548\uAC74|\uC544\uC820\uB2E4|\uBA54\uBAA8|\uB178\uD2B8|\uD560 ?\uC77C|\uC561\uC158 ?\uC544\uC774\uD15C|\uB2E4\uC74C ?\uB2E8\uACC4|\uACB0\uC815( ?\uC0AC\uD56D)?|\uC694\uC57D|\uC815\uB9AC|\uC9C8\uBB38|\uB9AC\uC2A4\uD06C|\uC544\uC774\uB514\uC5B4|\uB9C1\uD06C)(?![\p{L}\p{N}])/iu;
const SUMMARY = /^#{1,6}\s+(summary|tl;?dr|wrap-?up|recap|\uC694\uC57D|\uC815\uB9AC|\uACB0\uB860)(?![\p{L}\p{N}])/imu;
const NEXT_HEAD = /^#{1,6}\s+(next steps?|action items?|actions|to-?dos?|follow-?ups?|\uB2E4\uC74C ?\uB2E8\uACC4|\uC561\uC158 ?\uC544\uC774\uD15C|\uD560 ?\uC77C|\uD6C4\uC18D)(?![\p{L}\p{N}])/imu;
const PLACEHOLDER = /\b(TODO|TBD|TK|FIXME|XXX)\b|\?\?\?|\[citation needed\]|\(link\)|\(\uB9C1\uD06C\)|\uCD94\uAC00 \uC608\uC815/;

const nameOf = (path) => String(path).split('/').pop().replace(/\.(md|markdown)$/i, '');
const titleOf = (text) => (/^#\s+(.+)$/m.exec(text) || [])[1] || '';
const frontOf = (text) => (FRONT.exec(text) || [])[1] || '';

// 'meeting' | 'writing' | 'plan' | null, by its name, title, front matter
// and what it holds.
export function modeOf(path, text) {
  const front = frontOf(text);
  const typed = /^(?:type|kind|category|tags)\s*:\s*(.*)$/im.exec(front)?.[1] || '';
  const said = `${nameOf(path)}\n${titleOf(text)}\n${typed}`;
  const items = meetingItems(text);
  const tagged = items.filter((it) => ['decision', 'question', 'next'].includes(it.kind)).length;
  if (MEETING_NAME.test(said) || MEETING_LINE.test(text) || previousOf(text) || agendaOf(text).length || tagged >= 2) return 'meeting';
  if (WRITING_NAME.test(said) || /(^|\/)(blog|posts?|drafts?|writing|\uAE00)\//i.test(path)) return 'writing';
  if (PLAN_NAME.test(said)) return 'plan';
  return null;
}

// A date in a note's name ("Weekly 2026-10-05"), or none.
export const dateOfName = (path) => (DATE_IN.exec(nameOf(path)) || [])[0] || null;

const lineStarts = (text) => {
  const s = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) s.push(i + 1);
  return s;
};
const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const contentLines = (text) => text.replace(FRONT, '').split('\n').filter((l) => l.trim() && !/^\s*#/.test(l)).length;

// What the meeting covers: its agenda (headings with minutes; else its
// topic headings), each covered when something is written under it.
function topicsOf(text) {
  const lines = text.split('\n');
  const agenda = agendaOf(text);
  if (agenda.length) {
    return agenda.map((a) => ({ text: a.title, line: a.line, from: 'agenda', done: lines.slice(a.line + 1, a.lastLine + 1).some((l) => l.trim() && !/^\s*#/.test(l)) }));
  }
  const out = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{2,3})\s+(.*?)\s*#*\s*$/.exec(l);
    if (!m || FRAME.test(m[2])) return;
    let j = i + 1;
    let done = false;
    for (; j < lines.length && !new RegExp(`^#{1,${m[1].length}}\\s`).test(lines[j]); j++) if (lines[j].trim() && !/^\s*#/.test(lines[j])) done = true;
    out.push({ text: m[2], line: i, from: 'topic', done });
  });
  return out;
}

// Is it written about in this text? Its words, near enough those of a line.
function mentioned(body, text) {
  const mine = wordsOf(body);
  if (mine.size < 2) return text.toLowerCase().includes(body.toLowerCase());
  return text.split('\n').some((l) => l.trim() && nearness(mine, wordsOf(l), 0.5) > 0);
}

// What the last meeting left for this one: its open questions, its "#next"
// lines and its to-dos not done — each covered once this note speaks of it
// (a to-do: once it is here, ticked or with words about it).
export function carriedOver(prevText, text) {
  if (!prevText) return [];
  const prev = meetingItems(prevText);
  const decided = prev.filter((it) => it.kind === 'decision');
  const here = meetingItems(text);
  return prev.filter((it) => (it.kind === 'question' && !decided.some((d) => nearness(wordsOf(it.body), wordsOf(d.body), 0.5) > 0))
    || it.kind === 'next' || (it.kind === 'todo' && !it.done))
    .map((it) => {
      const same = here.find((x) => x.kind === it.kind && nearness(wordsOf(it.body), wordsOf(x.body), 0.5) > 0);
      return { text: it.body, from: 'last', kind: it.kind, owner: it.owner || null, due: it.due || null, done: it.kind === 'todo' ? !!same?.done || (!same && mentioned(it.body, text)) : !!same || mentioned(it.body, text) };
    });
}

// The meeting's brief. opts: { path, today ('YYYY-MM-DD'), prev: the last
// meeting's text, others: [{ path, name, line, raw, done }] to-dos of other
// notes (recall.js's index items) }. → { mode, cover: [{ text, line, from,
// done, kind }], flags: [{ kind: 'gap' | 'conflict', line, say, refs?, key }],
// needs: [what the note as a whole still needs] }.
export function meetingBrief(text, { path = '', today = '', prev = '', others = [] } = {}) {
  const items = meetingItems(text);
  const todos = items.filter((it) => it.kind === 'todo');
  const dated = dateOfName(path) || today;
  const flags = [];
  const usesOwners = todos.some((t) => t.owner) || MEETING_LINE.test(text);
  for (const t of todos) {
    if (t.done) continue;
    if (usesOwners && !t.owner) flags.push({ kind: 'gap', line: t.line, say: 'Who does it? No one is on this to-do.', key: `owner|${t.body}` });
    if (!t.due) flags.push({ kind: 'gap', line: t.line, say: 'By when? This to-do has no date.', key: `due|${t.body}` });
    else {
      if (dated && t.due < dated) flags.push({ kind: 'conflict', line: t.line, say: `Its date, ${t.due}, is before the meeting (${dated}).`, key: `past|${t.body}` });
      else if (today && t.due < today) flags.push({ kind: 'conflict', line: t.line, say: `Its date, ${t.due}, has passed and it isn't ticked.`, key: `past|${t.body}` });
      const wd = weekday(t.due);
      if (wd === 0 || wd === 6) flags.push({ kind: 'conflict', line: t.line, say: `${t.due} is a ${wd ? 'Saturday' : 'Sunday'}.`, key: `weekend|${t.body}` });
    }
  }
  // The same to-do twice with two dates: here, or here and in another note.
  todos.forEach((a, i) => {
    if (!a.due || a.done) return;
    const twin = todos.slice(i + 1).find((b) => b.due && b.due !== a.due && !b.done && nearness(wordsOf(a.body), wordsOf(b.body), 0.6) > 0);
    if (twin) flags.push({ kind: 'conflict', line: twin.line, say: `The same to-do is due ${a.due} a few lines up, ${twin.due} here.`, key: `twice|${twin.body}` });
    const there = others.find((o) => !o.done && o.path !== path && DUE.exec(o.raw)?.[1] && DUE.exec(o.raw)[1] !== a.due && nearness(wordsOf(a.body), o.words || wordsOf(o.text || o.raw), 0.6) > 0);
    if (there) flags.push({ kind: 'conflict', line: a.line, say: `In ${there.name} the same to-do is due ${DUE.exec(there.raw)[1]}.`, refs: [{ path: there.path, line: there.line, name: there.name, raw: there.raw }], key: `elsewhere|${a.body}` });
  });
  // What the note as a whole still needs, once there is enough of it.
  const n = contentLines(text);
  const needs = [];
  if (n >= 5 && !items.some((it) => it.kind === 'decision')) needs.push({ key: 'decision', say: 'No decision written down' });
  if (n >= 5 && !todos.length && !NEXT_HEAD.test(text)) needs.push({ key: 'next', say: 'No next step or to-do' });
  if (n >= 12 && !SUMMARY.test(text)) needs.push({ key: 'summary', say: 'No summary' });
  const open = items.filter((it) => it.kind === 'question' && !items.some((d) => d.kind === 'decision' && d.line > it.line && d.section === it.section));
  if (open.length) needs.push({ key: 'open', say: `${open.length} open question${open.length > 1 ? 's' : ''}: decide, or carry to next time (#next)` });
  return { mode: 'meeting', cover: [...topicsOf(text), ...carriedOver(prev, text)], flags, needs };
}

// A piece of writing: its outline (sections with nothing under them yet),
// its placeholders, a paragraph too long to read in a breath.
export function writingBrief(text) {
  const lines = text.split('\n');
  const flags = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    if (PLACEHOLDER.test(l)) flags.push({ kind: 'gap', line: i, say: 'Still to write: a placeholder.', key: `ph|${l.trim()}` });
    const words = l.trim().split(/\s+/).length;
    if (!/^\s*[#>|-]/.test(l) && (words > 180 || l.length > 1100)) flags.push({ kind: 'gap', line: i, say: `A long paragraph (${words} words): one point each reads easier.`, key: `long|${l.slice(0, 60)}` });
  });
  const cover = topicsOf(text).map((t) => ({ ...t, from: 'outline' }));
  const needs = [];
  if (!titleOf(text)) needs.push({ key: 'title', say: 'No title' });
  const n = contentLines(text);
  if (n >= 6 && cover.length && cover.some((c) => !c.done)) needs.push({ key: 'empty', say: `${cover.filter((c) => !c.done).length} section${cover.filter((c) => !c.done).length > 1 ? 's' : ''} with nothing yet` });
  return { mode: 'writing', cover, flags, needs };
}

// A plan: its to-dos' dates, as a meeting's; its sections as its outline.
export function planBrief(text, opts = {}) {
  const m = meetingBrief(text, opts);
  return { mode: 'plan', cover: topicsOf(text).map((t) => ({ ...t, from: 'outline' })), flags: m.flags.filter((f) => f.kind === 'conflict' || /^due\|/.test(f.key)), needs: [] };
}

export function briefOf(mode, text, opts = {}) {
  if (mode === 'meeting') return meetingBrief(text, opts);
  if (mode === 'writing') return writingBrief(text);
  if (mode === 'plan') return planBrief(text, opts);
  return null;
}

// The character offset a line starts at (for the margin).
export const lineFrom = (text, line) => { const s = lineStarts(text); return s[Math.max(0, Math.min(line, s.length - 1))]; };
