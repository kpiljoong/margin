'use strict';
// The margin thinks along (Settings, off unless turned on): a paragraph just
// written goes to Claude with what comes before it in the note and
// the paragraphs of other notes that may bear on it. Its part is a quiet
// thinking partner's: to help with the next step of what is being written,
// mostly by bringing back what the notes already know — a to-do and by
// when, what is being reached for, what the notes said before or that goes
// against it, a question left open, a next step, a risk. At most two
// things, and nothing at all for most paragraphs. When the notes given
// don't have what is reached for, it names what to look for, the local
// model looks in the notes, and it answers from what was found. Through the
// claude CLI the user signed in to (lib/judge.js's sessionQueue); what it
// says is only shown in the margin.
const { sessionQueue } = require('./judge');

const KINDS = ['todo', 'recall', 'thinking', 'against', 'question', 'next', 'risk', 'other'];
const MAX_ITEMS = 2;

const SYSTEM = [
  'You are a quiet thinking partner in the margin of someone\'s notes. Each message gives the paragraph they just wrote (Paragraph:), what comes before it in the note (Before:), today\'s date, and paragraphs from their other notes that may bear on it, numbered [1], [2] … with the note\'s name.',
  'Your part: help them with the next step of what they are writing — mostly by bringing back what their own notes already know. You may:',
  '- todo: something to be done, even said in passing ("I should …", "need to …", "\uD574\uC57C\uACA0\uB2E4"). due: the date it is to be done by, from the Calendar, only when the paragraph or the notes say or imply one — never a guess. say: what is to be done, in a few words. from: only a paragraph the date comes from.',
  '- recall: what they are reaching for and don\'t remember or left open (a number, a name, a date, what was decided; "??", "TBD", "\uBB50\uC600\uB354\uB77C"): the answer, from a numbered paragraph. When none has it, reply only "kind: recall" and "search: " with a few words to look it up in their notes.',
  '- thinking: they are weighing or deciding something: what their notes said, found or decided about it before.',
  '- against: something in their notes that goes against what the paragraph says or plans (an earlier decision, a fact, a date).',
  '- question: a question their notes raise about it, or one that blocks what the paragraph plans — not a general question to reflect on.',
  '- next: a concrete next step the paragraph calls for.',
  '- risk: something that may go wrong, that the paragraph or the notes point to.',
  '- other: anything else that would truly help them now.',
  'The numbered paragraphs were found by likeness of words or meaning: many are not about the same thing. Use one only when it is about the same subject — the same plan, product, price, person or date — not when it only shares a word (a "launch" of the product is not the launch of a price plan; "release notes" are not a "sample note"). When the paragraph plans or states something, first look for a numbered paragraph that decided otherwise: that is worth saying most.',
  'Say at most two things, of different kinds — one strong thing is better than two; add a second only when it helps as much. Most paragraphs need nothing: then reply only "kind: none". Saying nothing is better than a remark anyone could make about any such paragraph ("consider your users", "what is the goal?", "set clear goals", "that sounds nice").',
  'Reply with one block per thing, blocks separated by a line "---":',
  'kind: one of the kinds above',
  'due: YYYY-MM-DD (todo, when known)',
  'say: at most 30 words',
  'from: the numbers of the paragraphs it comes from, like 1, 3',
  'Examples (the answers in the language asked):',
  'Paragraph: Let\'s ship the team plan this month. [1] "Launch": Launch is Oct 20 #decision [2] "Pricing": After the beta the personal plan is 9,900 won a month. The team plan is to be discussed again next quarter.',
  '→ kind: against / say: The pricing note put the team plan off to next quarter. / from: 2   ([1] is the product\'s launch, not the plan\'s: left out.)',
  'Paragraph: To launch on Oct 20 we must submit for store review this week. [1] "Weekly 09-10": Store review can take a week #risk [2] "Weekly (next)": Launch moves to Nov 3 #decision',
  '→ kind: against / say: The last meeting moved the launch to Nov 3. / from: 2 --- kind: todo / due: (this week\'s last day) / say: Submit for store review. / from:',
  'Paragraph: Had noodles for lunch near the office, good. [1] "Today": Shorten the tutorial and add a sample note.',
  '→ kind: none',
  'Paragraph: What should go in the sample note?? [1] "Onboarding": A sample note would make the empty screen less daunting. [2] "1:1": Release notes draft @ann',
  '→ kind: thinking / say: The onboarding idea was a sample note so the first screen isn\'t empty — show how to start writing. / from: 1   ([2] only shares the word "note".)',
  'Rules:',
  '- say in the language the message names at its end. No [numbers] in say (the notes are shown beside it): the numbers go in from.',
  '- Facts, numbers, names and dates only from the paragraphs given; dates come from Today and the Calendar. recall, thinking and against stand on a numbered paragraph; question, next and risk may come from the paragraph itself, but must be about it in particular.',
  '- Each message stands alone: use only what it gives.',
  '- No preamble, no praise, don\'t repeat the paragraph back, don\'t talk to the person about the note.',
].join('\n');

const ANSWER_IN = { ko: 'Answer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).', en: 'Answer in English.' };

// The days after today by week, Monday first ("2026-10-09 (Fri)" → "this
// week: Sat 2026-10-10, Sun 2026-10-11; next week: Mon …"): the model counts
// days wrong without them.
function calendarOf(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(today || '');
  if (!m) return '';
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const weeks = new Date(t).getUTCDay() === 0 ? [[], []] : [[]];
  for (let n = 1; weeks.length < 4; n++) {
    const d = new Date(t + n * 86400000);
    weeks[weeks.length - 1].push(`${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.toISOString().slice(0, 10)}`);
    if (d.getUTCDay() === 0) weeks.push([]);
  }
  return weeks.slice(0, 3).map((w, i) => `${['this week', 'next week', 'the week after'][i]}: ${w.join(', ') || '(today is its last day)'}`).join('; ');
}
const listed = (found, from = 0) => found.slice(from).map((f, i) => `[${from + i + 1}] from "${f.name}": ${f.text}`).join('\n');

// req: { text, before, today, lang, found: [{ name, text }] } → the message.
function requestText({ text, before = '', today = '', lang = 'en', found = [] }) {
  return [
    `Today: ${today || '(unknown)'}`,
    calendarOf(today) ? `Calendar: ${calendarOf(today)}` : null,
    before.trim() ? `Before:\n${before.trim()}` : null,
    `Paragraph:\n${text}`,
    found.length ? `From their other notes:\n${listed(found)}` : 'From their other notes: (none found)',
    ANSWER_IN[lang] || ANSWER_IN.en,
  ].filter(Boolean).join('\n\n');
}
// What the search found, numbered after the others.
function foundText(query, found, from, lang = 'en') {
  return [
    `Looked up "${query}" in their notes:`,
    found.length > from ? listed(found, from) : '(nothing found)',
    'Now reply again for the paragraph, all of it, without search. When nothing found has what they reach for, leave recall out.',
    ANSWER_IN[lang] || ANSWER_IN.en,
  ].join('\n\n');
}

// One block → { kind, due, say, from } or { search }, or null (nothing).
function parseBlock(text, n) {
  const get = (k) => (new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(text) || [])[1]?.trim() || '';
  const kind = get('kind').toLowerCase().replace(/[^a-z]/g, '');
  if (!KINDS.includes(kind)) return null;
  const say = get('say').replace(/\s*\[\d+(?:\s*,\s*\d+)*\](?:\uC5D0\uC11C|\uC5D0\uB294|\uC5D0\uB3C4|\uC5D0|\uC758|\uB3C4|\uC740|\uB294|\uC774|\uAC00|\uC640|\uACFC|\uCC98\uB7FC)?/g, '').replace(/^["\u201C]|["\u201D]$/g, '').trim().slice(0, 400);
  if (kind === 'recall' && !say && get('search')) return { search: get('search').slice(0, 200) };
  if (!say) return null;
  const due = kind === 'todo' && /^\d{4}-\d{2}-\d{2}$/.test(get('due')) ? get('due') : '';
  return { kind, due, say, from: [...new Set((get('from').match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= n))] };
}
// The reply → { items: [{ kind, due, say, from: [n] }] (at most two, of
// different kinds), search: what to look up ('' none) }.
function parseReply(text, n = 0) {
  const items = [];
  let search = '';
  for (const block of String(text).split(/^\s*-{3,}\s*$/m)) {
    const b = parseBlock(block, n);
    if (b?.search) search ||= b.search;
    else if (b && !items.some((x) => x.kind === b.kind) && items.length < MAX_ITEMS) items.push(b);
  }
  return { items, search };
}

function thinkMargin({ bin, env, opts = {}, warmMs }) {
  const q = sessionQueue({ bin, env, opts, warmMs, system: SYSTEM });
  // search(query) → more paragraphs [{ name, text, … }] (none without the local model).
  const think = (req, search) => q.run(async (say) => {
    const found = [...req.found];
    let r = await say(requestText({ ...req, found }));
    if (!r.ok) return r;
    let out = parseReply(r.text, found.length);
    const searched = out.search;
    if (out.search) {
      const from = found.length;
      const seen = new Set(found.map((f) => `${f.path}\u0000${f.line}`));
      for (const f of (search ? await search(out.search) : [])) if (!seen.has(`${f.path}\u0000${f.line}`)) found.push(f);
      if (found.length > from) {
        r = await say(foundText(out.search, found, from, req.lang));
        if (!r.ok) return r;
        out = parseReply(r.text, found.length);
      }
    }
    return { ok: true, items: out.items, searched, found };
  });
  return { think, stop: q.stop };
}

module.exports = { thinkMargin, requestText, foundText, parseReply, calendarOf, SYSTEM, KINDS };
