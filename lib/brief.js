'use strict';
// Brief (Labs): Claude as a secretary beside a meeting note (an editor
// beside a draft, a reviewer beside a plan), when asked or, if chosen, when
// the person pauses. The note's paragraphs numbered, the last meeting's note
// (a meeting's), paragraphs of other notes found near it, and what the rules
// already flagged (public/brief.js; not to be said again) go to Claude, which
// says only what rules can't see: what this meeting has to settle, what the
// record still lacks, what goes against what (in the note, or the note and
// another), a step that doesn't follow, and one question whose answer — the
// reason for a decision — would otherwise be lost. Through the claude CLI the
// user signed in to (lib/judge.js's sessionQueue).
const { sessionQueue } = require('./judge');
const { calendarOf } = require('./think');

const KINDS = {
  meeting: { cover: 4, gap: 3, conflict: 3, logic: 2, ask: 1 },
  writing: { point: 1, gap: 3, conflict: 2, logic: 2, ask: 1 },
  plan: { cover: 3, gap: 3, conflict: 3, logic: 2, ask: 1 },
};

const SAY = {
  meeting: [
    'You are a sharp secretary beside someone\'s meeting note, as they write it during or after the meeting. Each message gives the note with its paragraphs numbered P1, P2 …, today\'s date and calendar, possibly the last meeting\'s note (L), and paragraphs from their other notes numbered [1], [2] … with the note\'s name and date.',
    'Point out, each only when it truly matters:',
    '- cover (at most four): a headline, at most ten words, of what this meeting has to settle and hasn\'t yet — an agenda item still empty, what the last meeting left open, what changed in their other notes since (a date moved, a decision made elsewhere). Not what the note already settles.',
    '- gap (at most three): what the record of one item still lacks so that someone could act on it later: a discussion with no outcome, a decision with no next step, a to-do whose who or what is vague in its words.',
    '- conflict (at most three): two things that cannot both hold — in the note (two decisions, a date and a deadline, one person on two things at once), or the note and a numbered paragraph (decided otherwise before, another date, a premise the newer note no longer supports). Name both sides.',
    '- logic (at most two): a conclusion that doesn\'t follow from what is written, numbers that don\'t add up, a step that needs something that only comes later.',
    '- ask (at most one): a question about a decision in the note whose reason or condition isn\'t written and would be lost (why this and not the other; until when it holds). Short, answerable in a line.',
  ],
  writing: [
    'You are a sharp editor beside someone\'s draft (a blog post, an essay, an article), as they write it. Each message gives the draft with its paragraphs numbered P1, P2 …, today\'s date, and paragraphs from their other notes numbered [1], [2] … with the note\'s name and date.',
    'Point out, each only when it truly matters:',
    '- point (at most one): the one thing the draft says, in a sentence its reader would remember — or, when it says two things that pull apart, which two.',
    '- gap (at most three): what the reader will miss at a paragraph: a claim with no example or reason, a word they won\'t know, a step between two paragraphs, an ending that doesn\'t land. Say what exactly.',
    '- conflict (at most two): the draft against itself, or against a numbered paragraph of their own notes (they wrote otherwise, or saw otherwise). Name both sides.',
    '- logic (at most two): a conclusion that doesn\'t follow, a generalization from one case, numbers that don\'t add up.',
    '- ask (at most one): a question whose answer, from their own experience, would make the draft concrete (the case it happened, what it cost).',
  ],
  plan: [
    'You are a sharp reviewer beside someone\'s plan or proposal, as they write it. Each message gives the plan with its paragraphs numbered P1, P2 …, today\'s date and calendar, and paragraphs from their other notes numbered [1], [2] … with the note\'s name and date.',
    'Point out, each only when it truly matters:',
    '- cover (at most three): a headline, at most ten words, of what the plan still has to decide before it can start.',
    '- gap (at most three): what a step lacks to be done: who, by when, how it will be known to be done.',
    '- conflict (at most three): two things that cannot both hold — in the plan (dates, people, money), or the plan and a numbered paragraph: especially a premise the plan rests on that their newer notes no longer support. Name both sides.',
    '- logic (at most two): a step that needs something that only comes later, a conclusion that doesn\'t follow, numbers that don\'t add up.',
    '- ask (at most one): a question about a choice in the plan whose reason isn\'t written and would be lost.',
  ],
};

const RULES = [
  'Reply with one block per thing, blocks separated by a line "---":',
  'kind: one of the kinds above',
  'at: the paragraph of the note it is about, like P2 (P1 when the whole note)',
  'say: at most 30 words',
  'from: the numbers of the paragraphs it comes from, like 1, 3 (none: leave empty)',
  'Rules:',
  '- say in the language the message names at its end. No [numbers] or P-numbers in say: they go in at and from.',
  '- Facts, names and dates only from what is given; a date you name must be one written there. Weekdays only from the calendar.',
  '- The numbered paragraphs were found by likeness: use one only when it is about the same thing.',
  '- What the message lists under "Already noted" is shown already: never say it again.',
  '- Say only what they would thank you for: what they would otherwise get wrong, miss or lose. A note that already does its job needs nothing, or one thing. Never ask in general for more detail, more examples or more evidence, nor generic advice ("consider adding a summary", "make sure everyone agrees"). When nothing matters, reply only "kind: none".',
  '- No preamble, no praise.',
];

const systemOf = (mode) => [...SAY[mode], ...RULES].join('\n');
const ANSWER_IN = { ko: 'Answer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).', en: 'Answer in English.' };

// req: { mode, paras: [text], today, lang, last: { name, text } | null,
// noted: [text], found: [{ name, date, text }] } → the message.
function requestText({ mode = 'meeting', paras, today = '', lang = 'en', last = null, noted = [], found = [] }) {
  return [
    `Today: ${today || '(unknown)'}`,
    mode !== 'writing' && calendarOf(today) ? `Calendar: ${calendarOf(today)}` : null,
    `The ${mode === 'writing' ? 'draft' : mode === 'plan' ? 'plan' : 'meeting note'}:\n${paras.map((t, i) => `P${i + 1}. ${t}`).join('\n')}`,
    last ? `The last meeting's note (L), "${last.name}":\n${last.text}` : null,
    found.length ? `From their other notes:\n${found.map((f, i) => `[${i + 1}] from "${f.name}"${f.date ? ` (${f.date})` : ''}: ${f.text}`).join('\n')}` : 'From their other notes: (none found)',
    noted.length ? `Already noted (don't repeat):\n${noted.map((t) => `- ${t}`).join('\n')}` : null,
    ANSWER_IN[lang] || ANSWER_IN.en,
  ].filter(Boolean).join('\n\n');
}

// The reply → [{ kind, at (0-based), say, from: [n] }], each kind no more than it may be.
// [2], (P3), P3's and the Korean particle after one: they go in at and from.
const REFS = /\s*\(?(?:\[\d+(?:\s*,\s*\d+)*\]|\bP\d+\b)\)?(?:\uC5D0\uC11C\uB294|\uC5D0\uC11C|\uC5D0\uB294|\uC5D0\uB3C4|\uC5D0|\uC758|\uB3C4|\uC740|\uB294|\uC774|\uAC00|\uC640|\uACFC|\uCC98\uB7FC|'s)?/g;
function parseReply(text, mode = 'meeting', nParas = 1, nFound = 0) {
  const kinds = KINDS[mode] || KINDS.meeting;
  const items = [];
  const count = {};
  for (const block of String(text).split(/^\s*-{3,}\s*$/m)) {
    const get = (k) => (new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(block) || [])[1]?.trim() || '';
    const kind = get('kind').toLowerCase().replace(/[^a-z]/g, '');
    if (!kinds[kind] || (count[kind] || 0) >= kinds[kind]) continue;
    let say = get('say').replace(REFS, '').trim();
    // Quotes around the whole of it (not one at each end of two quotes).
    if (/^["“][^"“”]*["”]$/.test(say)) say = say.slice(1, -1).trim();
    say = say.slice(0, 400);
    if (!say) continue;
    const p = Number((/\d+/.exec(get('at')) || [])[0]);
    const from = [...new Set((get('from').match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= nFound))];
    count[kind] = (count[kind] || 0) + 1;
    items.push({ kind, at: p >= 1 && p <= nParas ? p - 1 : 0, say, from });
  }
  return items;
}

function briefMargin({ bin, env, opts = {}, warmMs }) {
  const qs = {};
  const q = (mode) => (qs[mode] ||= sessionQueue({ bin, env, opts, warmMs, system: systemOf(mode) }));
  const brief = (req) => q(req.mode).run(async (say) => {
    const r = await say(requestText(req));
    return r.ok ? { ok: true, items: parseReply(r.text, req.mode, req.paras.length, req.found.length) } : r;
  });
  return { brief, stop: () => Object.values(qs).forEach((x) => x.stop()) };
}

module.exports = { briefMargin, requestText, parseReply, systemOf, KINDS };
