'use strict';
// The margin reads them with Claude (Settings, off unless turned on): a
// paragraph and the few paragraphs of other notes found near it (by the
// local model, or by their words) go to a fast model, which says how each
// is related to it in a line — or that it isn't, and the margin drops it.
// Through the claude CLI the user signed in to, like the live margin
// (lib/live.js): one session at a time, a request after another, closed
// when it has had enough turns or waited a while. Only those paragraphs
// are sent; the server reads the other notes' (never a private one, nor
// one .agentnotesignore names) and keeps the answers by what was asked.
const { Session } = require('./live');

const RELATIONS = ['same', 'answers', 'against', 'adds', 'none'];
const MAX_TURNS = 8;
const IDLE_MS = 90000;

const SYSTEM = [
  'You read someone\'s notes for them. Each message gives paragraphs of the note they are writing, numbered (1, 2 …), each with paragraphs from their other notes lettered under it (a, b, c), found because they seem to be about the same thing.',
  'For each lettered paragraph, say how it relates to the numbered one above it. One line each, in the order given:',
  '1a same: <why>',
  'The relation is one word:',
  '- same: about the same thing (the same subject, problem, plan or person\'s view of it)',
  '- answers: it answers, settles or decides what the other asks or leaves open',
  '- against: it goes against the other, or changes what the other decided',
  '- adds: it adds to the other: a detail, a reason, a next step, a result',
  '- none: not really about the same thing; they only share words or a broad topic',
  'Rules:',
  '- <why> is at most 14 words, in the language the message names at its end: what the lettered paragraph says that matters to the numbered one. No quotes, no note names.',
  '- After none, nothing.',
  '- Use only what the paragraphs say; never add facts.',
  '- Only those lines: no preamble, no closing words.',
].join('\n');

const ANSWER_IN = { ko: 'Answer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).', en: 'Answer in English.' };
const LETTERS = 'abc';

// items: [{ text, refs: [{ name, text }] }] → the message.
function requestText(items, lang = 'en') {
  const parts = items.map((it, i) => [`${i + 1}. ${it.text}`, ...it.refs.map((r, j) => `  ${i + 1}${LETTERS[j]}) from "${r.name}": ${r.text}`)].join('\n'));
  parts.push(ANSWER_IN[lang] || ANSWER_IN.en);
  return parts.join('\n\n');
}

// The reply → [[{ rel, why } | undefined per ref] per item].
function parseReply(text, items) {
  const out = items.map((it) => it.refs.map(() => undefined));
  for (const l of String(text).split('\n')) {
    const m = /^\s*(\d+)\s*([a-c])\)?\s*[:.-]?\s*(same|answers|against|adds|none)\b\s*:?\s*(.*)$/i.exec(l);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    const j = LETTERS.indexOf(m[2].toLowerCase());
    if (!out[i] || j < 0 || j >= out[i].length) continue;
    const rel = m[3].toLowerCase();
    out[i][j] = { rel, why: rel === 'none' ? '' : m[4].replace(/^["\u201C]|["\u201D]$/g, '').trim().slice(0, 200) };
  }
  return out;
}

// One session for one kind of request (its system prompt), the requests
// one after another — run(fn): fn(say) has it to itself, for a turn or a
// few (say(text) → { ok, text } | { ok: false, error }); closed when it
// has had enough turns, or waited a while.
function sessionQueue({ bin, env, opts = {}, warmMs, system }) {
  let s = null;
  let idle = null;
  let queue = Promise.resolve();
  const close = () => { clearTimeout(idle); s?.close(); s = null; };
  function run(fn) {
    const p = queue.then(async () => {
      clearTimeout(idle);
      if (!s || s.dead || s.turns >= MAX_TURNS) { s?.close(); s = new Session(bin, env, warmMs, system, opts); }
      const x = s;
      const say = (text) => new Promise((done) => {
        let said = '';
        x.ask(text, (t) => { said += t; }, (info) => done(info.ok ? { ok: true, text: said, cost: info.cost } : { ok: false, error: info.error }));
      });
      try { return await fn(say); } finally {
        idle = setTimeout(close, IDLE_MS);
        idle.unref?.();
      }
    });
    queue = p.catch(() => {});
    return p;
  }
  return { run, stop: close };
}

function judgeMargin({ bin, env, opts = {}, warmMs }) {
  const q = sessionQueue({ bin, env, opts, warmMs, system: SYSTEM });
  const ask = (items, lang) => q.run(async (say) => {
    const r = await say(requestText(items, lang));
    return r.ok ? { ok: true, verdicts: parseReply(r.text, items), cost: r.cost } : r;
  });
  return { ask, stop: q.stop };
}

module.exports = { judgeMargin, sessionQueue, requestText, parseReply, RELATIONS, SYSTEM };
