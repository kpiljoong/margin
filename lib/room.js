'use strict';
// A meeting room (a meeting or a lecture): typed a line at a time into a note
// of its own, each line sorted at once (public/room.js, by rule, then the
// live margin). Two requests to Claude here, through the claude CLI they
// signed in to (lib/judge.js's sessionQueue):
//  - weave, now and then while it goes on: the one thing worth asking now
//    (what would have to be asked again later, or done wrong), where the
//    item being talked about stands (agreed so far, still at issue, next),
//    which lines go together, which disagree within the session, what the
//    notes before it recorded otherwise (not an error: maybe a change), which
//    later line changes an earlier one (a change, not a clash), and which
//    question a line answers;
//  - close, at its end: a short draft to read out before people leave —
//    decided (with its condition or reason when written), who does what,
//    what is still open and when to look again — and at most three questions
//    whose answer stands between it and being done.
// Only what was typed: never "the meeting didn't decide", only "not in the
// record". What comes back is checked here (numbers in range, a quote that
// is in its note); what fails is left out, never guessed.
const { sessionQueue } = require('./judge');

const WEAVE = [
  'You sit beside someone typing a meeting or a lecture into a note, a line at a time (S1, S2 …, each with what it was sorted as — a kind ending in "?" is only a guess from its words, not theirs — and the item of the agenda it is under). You only know the lines typed, not what was said.',
  'Each message gives the session so far, then notes from before it (N1, N2 …: earlier meetings, the folder\'s notes). Reply with blocks separated by a line "---", only those that apply:',
  'ask: the one question worth asking now, while the people are there — about a line whose meaning would otherwise make them write to each other later or do the wrong thing (a decision whose condition is unclear, a task said maybe ("could", "might") as if given, two lines that cannot both hold). At most 20 words, in the session\'s language, asked of the person, as "…?". None worth it: no ask block. Never ask for an owner or a date just because there is none.',
  'about: S<n> (the line it is about)',
  '',
  'stand: the agenda item now (the last lines\'): what it has come to — "agreed:" the latest choice and its condition (an earlier proposal replaced by a later one is not agreed), "open:" what is still at issue, "next:" the next step. One line each, at most 16 words, in the session\'s language; leave out what has none. Write it as:',
  'A lecture: agreed is what is clear so far, open what is not clear yet, next what to try or look up.',
  'stand: <the item>',
  'agreed: …',
  'open: …',
  'next: …',
  '',
  'link: S<a> S<b> (two lines about the same thing, not next to each other)',
  'why: at most 8 words',
  '',
  'changes: S<a> S<b> (a later line a plainly changes what an earlier line b said — put off, moved, replaced, called off: the plan is now a)',
  'why: at most 8 words',
  '',
  'clash: S<a> S<b> (two lines of this session that cannot both hold, where it is not clear the later one changes the earlier — ask about it rather than guess)',
  'why: at most 12 words',
  '',
  'answers: S<a> S<b> (line a answers or settles the question in line b)',
  '',
  'before: S<a> N<n> (a line says otherwise than a note before it — a change, maybe; say both)',
  'was: the note\'s words, as written there (at most 20 words)',
  'why: at most 12 words',
  '',
  'Rules: only what the lines and notes say; in the words of a block never a line\'s or note\'s number (S3, N2: they mean nothing to them); never a general risk or advice; an agreed is never a line someone only proposed or said maybe, and a choice changed later is the later one; at most 12 link, 6 changes, 4 clash, 6 answers and 4 before blocks; the why in the session\'s language; no preamble.',
].join('\n');

const CLOSE = [
  'Someone typed a meeting or a lecture into a note, a line at a time (S1, S2 …, with what each was sorted as — a kind ending in "?" is only a guess from its words; a kind without one they set themselves). It is ending; the people are still there. Write the draft they read out before leaving, from the lines only, in the session\'s language:',
  'decided: <what was decided, in their words> — <its condition or reason, only when a line gives it> [S<n>, …]',
  'who: <who> — <what> — <by when, only when written> [S<n>]  (a task with nobody named: "?" as who)',
  'open: <what is still open> — <when or on what to look again, only when written> [S<n>]',
  'check: <a question to ask before they leave> [S<n>]',
  'unsure: <anything else the lines leave unclear: a decision without its condition, a task said maybe, two lines that disagree> [S<n>]',
  'A line "<question> → <answer>" is a question asked at the end and its answer, given by the people there: it settles what it answers (the decision, who, by when) — use it, and never ask it again.',
  'Rules: one line each; in the words never a line\'s number (S3: it means nothing to them), only in the brackets at the end; a proposal later replaced is not decided, nor is one said maybe; who only for a task given — one said maybe ("could", "might", "가능할 듯") is not a task yet: a check or an unsure line; the most important first; a later line that changes an earlier one: only the later is decided; at most 12 decided, 12 who, 10 open, 10 unsure, and at most 3 check — the ones whose answer stands between the draft and doing it (the condition of a decision, a task said maybe, two lines that disagree), never for a missing date alone (what is unclear and not a check: an unsure line, so nothing is lost); nothing that is not in the lines (not in them: it is not in the record, not "they did not decide"); a lecture: decided is what it taught (its main points), who its assignments. No heading, no preamble.',
].join('\n');

// Without the numbers lines were sent by ("(S3)", "(S1, S4)"): they mean nothing in a note.
const clean = (s, n) => String(s || '').replace(/\s*\((?:\s*[SN]\d+\s*[,;]?)+\)/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
// A bare "S3" or "N2" in what it wrote — the number of a line or a note,
// which means nothing to them: the line's words (or the note's name) instead,
// unless the lines themselves have it (an S3 bucket).
function unnumbered(out, items = [], notes = []) {
  const own = new Set(items.map((i) => i.text).join('\n').match(/\b[SN]\d{1,3}\b/g) || []);
  const short = (t) => { const w = clean(t, 400); return w.length > 28 ? `${w.slice(0, 26)}…` : w; };
  const name = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '');
  const fix = (t) => (typeof t !== 'string' ? t : t.replace(/\b([SN])(\d{1,3})\b/g, (m, k, d) => {
    if (own.has(m)) return m;
    const x = k === 'S' ? items[Number(d) - 1] : notes[Number(d) - 1];
    return x ? (k === 'S' ? `“${short(x.text)}”` : `[[${name(x.path)}]]`) : '';
  }).replace(/\s{2,}/g, ' ').trim());
  const walk = (v) => (Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ['s', 'n', 'a', 'b', 'from', 'note', 'key'].includes(k) ? x : walk(x)])) : fix(v));
  return walk(out);
}
const lineOf = (it) => `${it.kind || 'note'}${it.section ? ` (${clean(it.section, 80)})` : ''}: ${clean(it.text, 400)}`;

// req: { title, kind, items: [{ kind, text, section }], notes: [{ path, text }], today } → the message.
function weaveText({ title = '', kind = 'meeting', items = [], notes = [], today = '' }) {
  return [
    `Session: ${title || 'untitled'} (a ${kind === 'lecture' ? 'lecture' : 'meeting'})${today ? `\nToday: ${today}` : ''}`,
    `Lines:\n${items.map((it, i) => `S${i + 1} ${lineOf(it)}`).join('\n') || '(none)'}`,
    `Notes before it:\n${notes.map((n, i) => `N${i + 1} ${n.path}:\n${n.text}`).join('\n\n') || '(none)'}`,
  ].join('\n\n');
}

const blocksOf = (text) => String(text || '').split(/^\s*-{3,}\s*$/m).map((b) => {
  const get = (k) => (new RegExp(`^\\s*${k}\\s*:[ \\t]*(.*)$`, 'im').exec(b) || [])[1]?.trim() || '';
  get.text = b;
  return get;
});
const sOf = (s, n) => { const m = /^\s*S?(\d+)\b/i.exec(s || ''); const x = m ? Number(m[1]) : 0; return x >= 1 && x <= n ? x : 0; };
const pairOf = (s, n, other = 'S', max = n) => {
  const m = new RegExp(`^\\s*S?(\\d+)[\\s,]+${other}?(\\d+)\\b`, 'i').exec(s || '');
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 1 && a <= n && b >= 1 && b <= max && (other !== 'S' || a !== b) ? [a, b] : null;
};
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

// → { ask: { text, s } | null, stand: { item, agreed, open, next } | null,
// links: [{ a, b, kind: link|changes|clash|answers, why }], before: [{ s, n, was, why }] }
// (a, b, s: line numbers from 1; n: the note's). A "was" not in its note is
// left out (a note's words, quoted, or nothing).
function parseWeave(text, { n = 0, notes = [] } = {}) {
  const out = { ask: null, stand: null, links: [], before: [] };
  const seen = new Set();
  const count = { link: 0, changes: 0, clash: 0, answers: 0 };
  const MAX = { link: 12, changes: 6, clash: 4, answers: 6 };
  for (const g of blocksOf(text)) {
    if (g('ask') && !out.ask) {
      const q = clean(g('ask'), 200);
      const s = sOf(g('about'), n);
      if (q && !/^none\b/i.test(q)) out.ask = { text: q, s: s || null };
    }
    if (/^\s*stand\s*:/im.test(g.text) && !out.stand) {
      const st = { item: clean(g('stand'), 120), agreed: clean(g('agreed'), 200), open: clean(g('open'), 200), next: clean(g('next'), 200) };
      if (st.agreed || st.open || st.next) out.stand = st;
    }
    for (const kind of ['link', 'changes', 'clash', 'answers']) {
      const p = pairOf(g(kind), n);
      if (!p || count[kind] >= MAX[kind]) continue;
      const key = `${Math.min(...p)}:${Math.max(...p)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count[kind]++;
      out.links.push({ a: p[0], b: p[1], kind, why: clean(g('why'), 120) });
    }
    const b = pairOf(g('before'), n, 'N', notes.length);
    if (b && out.before.length < 4) {
      const note = notes[b[1] - 1].text.replace(/\s+/g, ' ').toLowerCase();
      const was = clean(g('was'), 240).replace(/^["“]|["”]$/g, '');
      // Its words in the note: most of them there.
      const w = words(was);
      if (w.length && w.filter((x) => note.includes(x)).length * 3 >= w.length * 2) out.before.push({ s: b[0], n: b[1], was, why: clean(g('why'), 120) });
    }
  }
  return out;
}

// req: { title, kind, items, today } → the message.
function closeText({ title = '', kind = 'meeting', items = [], today = '' }) {
  return [
    `Session: ${title || 'untitled'} (a ${kind === 'lecture' ? 'lecture' : 'meeting'})${today ? `\nToday: ${today}` : ''}`,
    `Lines:\n${items.map((it, i) => `S${i + 1} ${lineOf(it)}`).join('\n') || '(none)'}`,
  ].join('\n\n');
}

// → { decided: [{ text, from: [n] }], who: [{ who, text, from }], open, check, unsure: [...] }
// (check: the three to ask first; unsure: the rest left unclear, kept, never dropped)
// (from: line numbers; a line with none of them in range keeps none).
function parseClose(text, { n = 0 } = {}) {
  const out = { decided: [], who: [], open: [], check: [], unsure: [] };
  const MAX = { decided: 12, who: 12, open: 10, check: 3, unsure: 10 };
  for (const raw of String(text || '').split('\n')) {
    const m = /^\s*[-*]?\s*(decided|who|open|check|unsure)\s*:\s*(.+)$/i.exec(raw);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (out[k].length >= MAX[k]) continue;
    let body = m[2].trim();
    const from = [];
    body = body.replace(/\s*\[((?:\s*S?\d+\s*,?)+)\]\s*$/i, (_, ns) => { for (const x of ns.match(/\d+/g) || []) { const v = Number(x); if (v >= 1 && v <= n && !from.includes(v)) from.push(v); } return ''; }).trim();
    if (!body) continue;
    if (k === 'who') {
      const [who, ...rest] = body.split(/\s+[—–-]\s+/);
      const what = rest.join(' — ').trim();
      if (!what) continue;
      out.who.push({ who: clean(who, 60).replace(/^@/, ''), text: clean(what, 300), from });
    } else out[k].push({ text: clean(body, 300), from });
  }
  return out;
}

function roomMargin({ bin, env, opts = {}, warmMs }) {
  const w = sessionQueue({ bin, env, opts, warmMs, system: WEAVE });
  const c = sessionQueue({ bin, env, opts, warmMs, system: CLOSE });
  const weave = (req) => w.run(async (say) => {
    const r = await say(weaveText(req));
    return r.ok ? { ok: true, ...unnumbered(parseWeave(r.text, { n: req.items.length, notes: req.notes }), req.items, req.notes) } : r;
  });
  const close = (req) => c.run(async (say) => {
    const r = await say(closeText(req));
    return r.ok ? { ok: true, ...unnumbered(parseClose(r.text, { n: req.items.length }), req.items) } : r;
  });
  return { weave, close, stop: () => { w.stop(); c.stop(); } };
}

module.exports = { roomMargin, unnumbered, weaveText, parseWeave, closeText, parseClose, WEAVE, CLOSE };
