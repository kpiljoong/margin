'use strict';
// A review (Labs): a sitting with one topic of someone's recent notes —
// most of them quick memos their assistant (Sift) filed into the vault, and
// rarely read again. Two requests to Claude, through the claude CLI they
// signed in to (lib/judge.js's sessionQueue):
//  - topics: what they are dealing with now, as the vault's own folders
//    (its rules, 99-assistant/rules), each with its goal — written in a note,
//    a guess, or not known — and one question that would settle it;
//  - a session: for one topic, what stands between them and the goal, the
//    most important first with why, and which of its open to-dos may be done
//    already (the record lags behind what happened).
// What comes back is checked here (folders that exist, to-dos in the vault's
// format, numbers in range); what fails is left out or asked, never guessed.
const { sessionQueue } = require('./judge');

const TOPICS = [
  'You help someone whose assistant files their quick memos into an Obsidian vault (rules below). They rarely look at them again. Find what they are dealing with now, so that each can be reviewed in one sitting.',
  'Each message gives the vault\'s project and area folders, then their notes of the last weeks numbered [1], [2] … with path and date.',
  'Suggest at most seven topics, the ones most worth a review now (something to decide, prepare or finish). For each a block:',
  'title: at most eight words, in their words',
  'folder: the existing folder it belongs to (01-projects/x or 02-areas/x, as listed), or "new: 01-projects/<short lowercase english>" only when the notes clearly name a project with no folder yet, or "none"',
  'notes: the numbers of its notes',
  'goal: what this is for, as an outcome, at most 20 words',
  'goal from: the number of the note that states that goal in words; "guess" when you inferred it; "unknown" when the notes don\'t tell',
  'ask: one short question to them that would settle the goal (not when a note states it)',
  'Blocks separated by a line "---". Answer in Korean, folder names as they are. No preamble.',
  'Leave out notes that are only tests or empty.',
];

const SESSION = [
  'You are their assistant in a review of one topic of their notes. Each message gives the topic and its goal (stated in a note, a guess, or unknown), its notes N1, N2 …, older paragraphs [1], [2] … found by likeness, their open to-dos T1, T2 …, today\'s date, and the vault\'s rules.',
  'First, the to-dos: which of them are about this topic, and which of those may be done already — a later note says it happened, its date has passed with no word since, or two notes give it different states.',
  'mine: the T-numbers about this topic',
  'maybe done: the T-numbers that may be done already, each with a few words why, like: T2 (the booking is written as made in N3), T5 (due 10-01, nothing since)',
  'Then a line "---", and what stands between them and the goal, most important first: what matters most for the goal, blocks other things, and can be decided now. Each block:',
  'kind: decide | missing | conflict | ask | consider',
  '- decide: a choice to make now for the goal (name the options as written).',
  '- missing: something the goal needs that the notes don\'t have, that blocks a next step — not a general "add an owner or a date".',
  '- conflict: two things that cannot both hold. When it is unclear which is current, say both as written and ask which — never decide it.',
  '- ask: a question whose answer changes what they would do.',
  '- consider (at most one): only with a reason from the notes and what it would change.',
  'say: at most 35 words',
  'why: at most 12 words: why it comes before the rest',
  'from: N-numbers and [numbers]',
  'todo: when it leads to a to-do, one line in the vault\'s to-do format; else empty',
  'Blocks separated by a line "---".',
  'Rules:',
  '- One block per issue: a copy and a conflict about the same thing are one block (the decision first).',
  '- A plan, a draft or a suggestion is not a decision; something done is not open. Never assume a written date is a real deadline.',
  '- What the given notes don\'t say is "not in the notes found", never "not decided" or "not done".',
  '- When the goal is a guess or unknown, the first block is kind: ask, about the goal.',
  '- At most five blocks. When nothing matters, write only "kind: none" after the line.',
  'Facts, names and dates only from what is given. Older paragraphs: only when about the same thing. Answer in Korean. No preamble.',
];

const withRules = (lines, rules) => [...lines, ...(rules ? ['', 'The vault\'s rules:', rules] : [])].join('\n');
const blocksOf = (text) => String(text || '').split(/^\s*-{3,}\s*$/m).map((b) => (k) => (new RegExp(`^\\s*${k}\\s*:[ \\t]*(.*)$`, 'im').exec(b) || [])[1]?.trim() || '');
const nums = (s, max) => [...new Set((String(s).match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= max))];

// req: { folders: [path], notes: [{ path, date, text }], today } → the message.
function topicsText({ folders, notes, today = '' }) {
  return [
    `Folders:\n${folders.join('\n')}`,
    `Notes:\n${notes.map((n, i) => `[${i + 1}] ${n.path} (${n.date}${n.copies ? `, ${n.copies + 1} copies` : ''}):\n${n.text.slice(0, 1500)}`).join('\n\n')}`,
    `Today: ${today || '(unknown)'}`,
  ].join('\n\n');
}

// → [{ title, folder, isNew, notes: [n], goal, goalState, goalFrom, ask }]:
// a folder that is not one of theirs (nor a new project's, as the rules
// name them) is none; a goal "from" a note not among its own is a guess.
function parseTopics(text, nNotes, folders) {
  const have = new Set(folders);
  const out = [];
  for (const get of blocksOf(text)) {
    const title = get('title').replace(/^["“]|["”]$/g, '').slice(0, 120);
    const notes = nums(get('notes'), nNotes);
    if (!title || !notes.length) continue;
    let folder = get('folder').replace(/`/g, '').replace(/\/$/, '');
    let isNew = false;
    const m = /^new:\s*(01-projects\/[a-z0-9][a-z0-9-]*)$/i.exec(folder);
    if (m) { folder = m[1].toLowerCase(); isNew = !have.has(folder); } else if (!have.has(folder)) folder = '';
    const from = get('goal from');
    const n = Number((/^\s*\[?(\d+)\]?\s*$/.exec(from) || [])[1]);
    const goal = get('goal').slice(0, 300);
    const goalState = !goal || /unknown/i.test(from) ? 'unknown' : n && notes.includes(n) ? 'stated' : 'guessed';
    out.push({ title, folder, isNew, notes, goal, goalState, goalFrom: goalState === 'stated' ? n : null, ask: goalState === 'stated' ? '' : get('ask').slice(0, 300) });
    if (out.length >= 7) break;
  }
  return out;
}

// req: { topic: { title, goal, goalState }, notes: [{ path, date, text }],
// older: [{ path, text }], todos: [text], today } → the message.
function sessionText({ topic, notes, older = [], todos = [], today = '' }) {
  const state = { stated: 'stated in a note', guessed: 'a guess', unknown: 'unknown' }[topic.goalState] || 'a guess';
  return [
    `Today: ${today || '(unknown)'}`,
    `Topic: ${topic.title}`,
    `Goal (${state}): ${topic.goal || '(none)'}`,
    `Notes:\n${notes.map((n, i) => `N${i + 1} ${n.path} (${n.date}):\n${n.text.slice(0, 3000)}`).join('\n\n')}`,
    `Older paragraphs:\n${older.map((o, i) => `[${i + 1}] from ${o.path}: ${o.text}`).join('\n') || '(none found)'}`,
    `Open to-dos:\n${todos.map((t, i) => `T${i + 1} ${t}`).join('\n') || '(none)'}`,
  ].join('\n\n');
}

// A to-do line as the vault's rules write it (99-assistant/rules/todo-format):
// "- [ ] what to do [📅 YYYY-MM-DD] [⏫|🔽] [#tags]", a real date, a project
// tag only of a project folder, a day only one written in what was given
// (dates: none, any) — else without it. → the line, or '' (it can't be trusted).
const RELATIVE = /\b(?:tomorrow|today|next (?:week|month)|this (?:week|friday|monday))\b|\uB0B4\uC77C|\uBAA8\uB808|\uB2E4\uC74C\s?\uC8FC|\uC774\uBC88\s?\uC8FC|\uC624\uB298/i;
function todoLine(line, projects, dates = null) {
  const l = String(line || '').replace(/^`|`$/g, '').trim();
  const m = /^- \[ \] (\S.*)$/.exec(l);
  if (!m || RELATIVE.test(m[1]) || /📅(?!\s\d{4}-\d{2}-\d{2}\b)/u.test(m[1])) return '';
  const bad = [...m[1].matchAll(/#project\/([\w-]+)/g)].some((x) => !projects.has(x[1]));
  const out = bad ? l.replace(/\s*#project\/[\w-]+/g, '') : l;
  return dates ? out.replace(/\s*\u{1F4C5}\s(\d{4}-\d{2}-\d{2})\b/gu, (all, d) => (dates.has(d) ? all : '')) : out;
}

// → { mine: [t], maybe: [{ t, why }], items: [{ kind, say, why, notes: [n],
// older: [n], todo }] }: at most five, a consider once.
const KINDS = new Set(['decide', 'missing', 'conflict', 'ask', 'consider']);
function parseSession(text, { nNotes = 0, nOlder = 0, nTodos = 0, projects = new Set(), dates = null } = {}) {
  const [head, ...rest] = String(text || '').split(/^\s*-{3,}\s*$/m);
  const get = (k) => (new RegExp(`^\\s*${k}\\s*:[ \\t]*(.*)$`, 'im').exec(head) || [])[1]?.trim() || '';
  const mine = nums(get('mine').replace(/\bT/g, ''), nTodos);
  const maybe = [];
  for (const m of get('maybe done').matchAll(/T?(\d+)\s*(?:\(([^)]*)\))?/g)) {
    const t = Number(m[1]);
    if (t >= 1 && t <= nTodos && !maybe.some((x) => x.t === t)) maybe.push({ t, why: (m[2] || '').trim().slice(0, 200) });
  }
  const items = [];
  for (const g of blocksOf(rest.join('\n---\n'))) {
    const kind = g('kind').toLowerCase().replace(/[^a-z]/g, '');
    const say = g('say').slice(0, 400);
    if (!KINDS.has(kind) || !say || (kind === 'consider' && items.some((x) => x.kind === 'consider'))) continue;
    const from = g('from');
    items.push({ kind, say, why: g('why').slice(0, 160), notes: nums((from.match(/N\d+/gi) || []).join(' '), nNotes), older: nums((from.match(/\[\d+\]/g) || []).join(' '), nOlder), todo: todoLine(g('todo'), projects, dates) });
    if (items.length >= 5) break;
  }
  return { mine, maybe: maybe.filter((x) => !mine.length || mine.includes(x.t)), items };
}

function reviewMargin({ bin, env, opts = {}, warmMs, rules = '' }) {
  const t = sessionQueue({ bin, env, opts, warmMs, system: withRules(TOPICS, rules) });
  const s = sessionQueue({ bin, env, opts, warmMs, system: withRules(SESSION, rules) });
  const topics = (req) => t.run(async (say) => {
    const r = await say(topicsText(req));
    return r.ok ? { ok: true, topics: parseTopics(r.text, req.notes.length, req.folders) } : r;
  });
  const session = (req) => s.run(async (say) => {
    const r = await say(sessionText(req));
    // The days written in what was sent: a to-do's day is one of them.
    const dates = new Set([...req.notes.map((n) => n.text), ...req.older.map((o) => o.text), ...req.todos].join('\n').match(/\d{4}-\d{2}-\d{2}/g) || []);
    return r.ok ? { ok: true, ...parseSession(r.text, { nNotes: req.notes.length, nOlder: req.older.length, nTodos: req.todos.length, projects: req.projects, dates }) } : r;
  });
  return { topics, session, stop: () => { t.stop(); s.stop(); } };
}

module.exports = { reviewMargin, topicsText, parseTopics, sessionText, parseSession, todoLine, TOPICS, SESSION };
