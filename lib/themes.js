'use strict';
// Themes (Labs): what keeps coming back in someone's notes. Paragraphs of
// their recent notes (those with others like them in other notes first,
// when the local model has read the notes), numbered, go to Claude, which
// names the few things that come back in several notes — a claim, not a
// topic — with the paragraphs it comes back in, how it reads them (a
// suggestion, theirs to change) and what isn't checked yet. Nothing is
// written: the page offers a note made of it. Through the claude CLI the
// user signed in to (lib/judge.js's sessionQueue).
const { sessionQueue } = require('./judge');

const SYSTEM = [
  'You read someone\'s recent notes for them, looking for what keeps coming back. Each message gives paragraphs of their notes, numbered [1], [2] … with the note\'s name and date.',
  'Find at most three themes. A theme is one thing that comes back in at least three paragraphs from at least two different notes, written at different times or in different contexts: the same problem met again, the same wish, the same pattern in what happens. Not a topic they obviously write about on purpose (a project\'s name, a note series), and not paragraphs that only share words.',
  'For each theme, a block:',
  'title: the theme as a claim of at most ten words, in their words where possible (like "New users can\'t pick their first step", not "Onboarding")',
  'from: the numbers of the paragraphs it comes back in, like 2, 9, 14',
  'reading: at most 40 words: what these paragraphs together suggest that none says alone — offered as a reading they can correct',
  'open: at most 25 words: what is not checked yet, that would show whether the reading holds',
  'Blocks separated by a line "---".',
  'Rules:',
  '- In the language the message names at its end. No [numbers] in title, reading or open.',
  '- Only what the paragraphs say; never add facts.',
  '- Fewer, truer themes are better than many. When nothing truly comes back, reply only "none".',
  '- No preamble.',
].join('\n');

const ANSWER_IN = { ko: 'Answer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).', en: 'Answer in English.' };

// req: { found: [{ name, date, text }], lang } → the message.
function requestText({ found, lang = 'en' }) {
  return [found.map((f, i) => `[${i + 1}] from "${f.name}"${f.date ? ` (${f.date})` : ''}: ${f.text}`).join('\n'), ANSWER_IN[lang] || ANSWER_IN.en].join('\n\n');
}

// The reply → [{ title, from: [n], reading, open }]: a theme in at least
// three paragraphs of at least two notes (found: what was sent).
function parseReply(text, found) {
  const out = [];
  for (const block of String(text).split(/^\s*-{3,}\s*$/m)) {
    const get = (k) => (new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(block) || [])[1]?.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim() || '';
    const title = get('title').replace(/^["“]|["”]$/g, '').slice(0, 120);
    const from = [...new Set((/^\s*from\s*:\s*(.*)$/im.exec(block)?.[1].match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= found.length))];
    if (!title || from.length < 3 || new Set(from.map((n) => found[n - 1].path)).size < 2) continue;
    out.push({ title, from, reading: get('reading').slice(0, 400), open: get('open').slice(0, 300) });
    if (out.length >= 3) break;
  }
  return out;
}

// A theme note checked against what was written since: each new paragraph
// against the reading as it is now (not the title, not what was said of the
// cases before) — a case of what it says, one where it should hold and
// didn't, one it doesn't speak of, or not about it; and, when some go
// against it, a reading that might also explain them, as a hypothesis, with
// what would tell. The cases it came up in and the ones that didn't fit go
// as such: what they were is kept.
const CHECK_SYSTEM = [
  'Someone keeps a note on a theme in their own notes: a title, the reading they hold now, the cases it came up in, and cases that did not fit it so far. Each message gives the theme and new paragraphs from their notes, numbered [1], [2] … with the note\'s name and date.',
  'Judge each new paragraph against the reading as it is now — not against the title, and not by how earlier cases were filed. For each, one line, in order:',
  '[1] supports: <why>',
  'The word is one of:',
  '- supports: a case of what the reading says. When the reading says several things, <why> names which part.',
  '- counters: a case the reading covers, where it should hold, and it happened otherwise.',
  '- outside: a case the reading, as worded, doesn\'t speak of (it is about other people, other conditions). Not evidence for or against it — even when it fits a contrast the reading only implies: "those without X stall" says nothing of those with X, unless it says so in words.',
  '- none: not about it; it only shares words or a topic.',
  'Then, only when some paragraph counters it, two more lines:',
  'maybe: <a reading that might also explain the cases that go against it — a hypothesis, at most 40 words; it need not explain every case>',
  'check: <what would tell whether that hypothesis holds, at most 25 words>',
  'Rules:',
  '- <why> at most 20 words, in the language the message names at its end. No [numbers] in it.',
  '- Only what the paragraphs say; never add facts. When unsure, none.',
  '- A condition that explains a counter-case is not yet shown to hold: never word maybe as settled.',
  '- Only those lines.',
].join('\n');

// req: { theme: { title, reading, scenes: [{ text, name }], unfit: [{ text,
// name }] }, found, lang } → the message.
function checkText({ theme, found, lang = 'en' }) {
  const cases = (list) => list.map((s) => `- ${s.text} (from "${s.name}")`).join('\n') || '(none)';
  return [
    `The title: ${theme.title}`,
    `The reading now: ${theme.reading || '(none)'}`,
    `Cases it came up in:\n${cases(theme.scenes)}`,
    `Cases that did not fit so far:\n${cases(theme.unfit || [])}`,
    `New paragraphs:\n${found.map((f, i) => `[${i + 1}] from "${f.name}"${f.date ? ` (${f.date})` : ''}: ${f.text}`).join('\n')}`,
    ANSWER_IN[lang] || ANSWER_IN.en,
  ].join('\n\n');
}

// → { verdicts: [{ n, verdict, why }], maybe: { reading, check } | null }.
function parseCheck(text, n) {
  const verdicts = [];
  for (const l of String(text).split('\n')) {
    const m = /^\s*\[?(\d+)\]?\s*[:.)-]?\s*(supports|counters|outside|none)\b\s*:?\s*(.*)$/i.exec(l);
    if (!m || +m[1] < 1 || +m[1] > n || verdicts.some((v) => v.n === +m[1])) continue;
    verdicts.push({ n: +m[1], verdict: m[2].toLowerCase(), why: m[3].replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim().slice(0, 300) });
  }
  const line = (k) => (new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, 'im').exec(text) || [])[1]?.trim().slice(0, 500) || '';
  const reading = line('maybe');
  return { verdicts, maybe: reading && verdicts.some((v) => v.verdict === 'counters') ? { reading, check: line('check') } : null };
}

function themesMargin({ bin, env, opts = {}, warmMs }) {
  const q = sessionQueue({ bin, env, opts, warmMs, system: SYSTEM });
  const find = (req) => q.run(async (say) => {
    const r = await say(requestText(req));
    return r.ok ? { ok: true, themes: parseReply(r.text, req.found) } : r;
  });
  const c = sessionQueue({ bin, env, opts, warmMs, system: CHECK_SYSTEM });
  const check = (req) => c.run(async (say) => {
    const r = await say(checkText(req));
    return r.ok ? { ok: true, ...parseCheck(r.text, req.found.length) } : r;
  });
  return { find, check, stop: () => { q.stop(); c.stop(); } };
}

// A theme as a note: its title, the reading (marked as one), where it came
// up (each paragraph quoted, linked to its note), and what isn't checked.
function themeNote(theme, scenes, made = '') {
  return [
    ...(made ? ['---', `theme: ${made}`, '---'] : []),
    `# ${theme.title}`, '',
    `> [!note] Margin's reading — a suggestion; change it or delete it`,
    `> ${theme.reading}`, '',
    '## Where it came up', '',
    ...scenes.map((s) => `- ${s.text.replace(/\s+/g, ' ').trim()} — [[${s.name}]]${s.date && !s.name.includes(s.date) ? ` (${s.date})` : ''}`), '',
    '## Not checked yet', '',
    `- ${theme.open || '…'}`, '',
  ].join('\n');
}

module.exports = { themesMargin, requestText, parseReply, themeNote, checkText, parseCheck, SYSTEM, CHECK_SYSTEM };
