'use strict';
// The margin thinks along (Settings, off unless turned on): a paragraph just
// written goes to a fast model with what comes before it in the note and
// the paragraphs of other notes that may bear on it, and it says something
// only when that helps — a to-do (and by when), a thought on what is being
// weighed (from those notes), or what is being reached for (found in them;
// when they don't have it, it names what to look for, the local model looks
// in the notes, and it answers from what was found). Through the claude CLI
// the user signed in to (lib/judge.js's sessionQueue); what it says is
// only shown in the margin.
const { sessionQueue } = require('./judge');

const KINDS = ['todo', 'thinking', 'recall', 'none'];

const SYSTEM = [
  'You think along with someone writing a note, in its margin. Each message gives the paragraph they just wrote (Paragraph:), what comes before it in the note (Before:), today\'s date, and paragraphs from their other notes that may bear on it, numbered [1], [2] … with the note\'s name.',
  'Decide what the paragraph does, and say something only when it helps:',
  '- todo: it says something is to be done, by them or someone, even in passing ("I should …", "need to …", "… by Friday", "\uD574\uC57C\uACA0\uB2E4"). due: the date it is to be done by, when the paragraph or the others say or imply one. say: what is to be done, in a few words. from: only a paragraph the date comes from.',
  '- thinking: they are weighing something, unsure, or about to decide. say: one or two short sentences from their own notes — what they decided or found before, what goes against it, a point the numbered paragraphs raise that this one does not weigh. Only from the numbered paragraphs; none of your own opinions.',
  '- recall: they are reaching for something they don\'t remember or left open (a number, a name, a date, what was decided; "??", "TBD", "\uBB50\uC600\uB354\uB77C"). When a numbered paragraph has it, say: the answer. When none has it, reply only "kind: recall" and "search: " with a few words to look it up in their notes.',
  '- none: anything else, or nothing useful to add from the numbered paragraphs. Most paragraphs are none.',
  'Reply with these lines only:',
  'kind: todo | thinking | recall | none',
  'due: YYYY-MM-DD (todo, when known)',
  'say: at most 30 words',
  'from: the numbers of the paragraphs it comes from, like 1, 3',
  'Rules:',
  '- say in the language the message names at its end. No [numbers] in say (the notes are shown beside it): the numbers go in from.',
  '- Never add facts, numbers, names or dates the paragraphs don\'t give; dates come from Today. When the numbered paragraphs don\'t support a thought or an answer, kind: none.',
  '- No preamble, no praise, don\'t repeat the paragraph back, don\'t talk to the person about the note.',
].join('\n');

const ANSWER_IN = { ko: 'Answer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).', en: 'Answer in English.' };

const listed = (found, from = 0) => found.slice(from).map((f, i) => `[${from + i + 1}] from "${f.name}": ${f.text}`).join('\n');

// req: { text, before, today, lang, found: [{ name, text }] } → the message.
function requestText({ text, before = '', today = '', lang = 'en', found = [] }) {
  return [
    `Today: ${today || '(unknown)'}`,
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
    'Now reply for the paragraph, without search. When nothing found has it, kind: none.',
    ANSWER_IN[lang] || ANSWER_IN.en,
  ].join('\n\n');
}

// The reply → { kind, due, say, from: [n], search }.
function parseReply(text, n = 0) {
  const get = (k) => (new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(text) || [])[1]?.trim() || '';
  let kind = get('kind').toLowerCase().replace(/[^a-z]/g, '');
  if (!KINDS.includes(kind)) kind = 'none';
  const due = /^\d{4}-\d{2}-\d{2}$/.test(get('due')) ? get('due') : '';
  const say = get('say').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').replace(/^["\u201C]|["\u201D]$/g, '').trim().slice(0, 400);
  const from = [...new Set((get('from').match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= n))];
  const search = kind === 'recall' && !say ? get('search').slice(0, 200) : '';
  if (search) return { kind, due: '', say: '', from: [], search };
  if (kind !== 'none' && !say) kind = 'none';
  return kind === 'none' ? { kind, due: '', say: '', from: [], search: '' } : { kind, due: kind === 'todo' ? due : '', say, from, search: '' };
}

function thinkMargin({ bin, env, opts = {}, warmMs }) {
  const q = sessionQueue({ bin, env, opts, warmMs, system: SYSTEM });
  // search(query) → more paragraphs [{ name, text, … }] (none without the local model).
  const think = (req, search) => q.run(async (say) => {
    const found = [...req.found];
    let r = await say(requestText({ ...req, found }));
    if (!r.ok) return r;
    let out = parseReply(r.text, found.length);
    if (out.search) {
      const from = found.length;
      const seen = new Set(found.map((f) => `${f.path}\u0000${f.line}`));
      for (const f of (search ? await search(out.search) : [])) if (!seen.has(`${f.path}\u0000${f.line}`)) found.push(f);
      if (found.length === from) return { ok: true, kind: 'none', due: '', say: '', from: [], found, searched: out.search };
      r = await say(foundText(out.search, found, from, req.lang));
      if (!r.ok) return r;
      const searched = out.search;
      out = parseReply(r.text, found.length);
      if (out.search) out = { kind: 'none', due: '', say: '', from: [] };
      out.searched = searched;
    }
    return { ok: true, ...out, found };
  });
  return { think, stop: q.stop };
}

module.exports = { thinkMargin, requestText, foundText, parseReply, SYSTEM, KINDS };
