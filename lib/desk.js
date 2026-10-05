'use strict';
// The desk's margin (experimental): cards laid out on a desk (a .canvas file)
// are given to a fast model with a request — sum them up, ask what they leave
// open, sort them, find the ones that belong together, bring them into one
// note, or talk about them. What it writes is only shown on the desk, kept
// when the person takes it. Through the claude CLI the user signed in to,
// like the live margin (lib/live.js): a fresh session for each request
// (kept warm beforehand, so it answers at once), and one kept for a talk.
const { Session } = require('./live');

const SYSTEM = [
  'You help someone think with their notes, laid out as cards on a desk.',
  'Each message gives cards, numbered (#1, #2 …) with their title and text, and a request.',
  'A card may be a picture, or a note on a marked part of one: the pictures come with the message, numbered in the order the cards name them ([picture 1] …).',
  'Rules:',
  '- Write in the language of the cards: Korean cards get Korean, English cards English.',
  '- Use only what the cards say; never add facts. Name cards by their number (#2) when it helps.',
  '- No preamble and no closing words: only what the request asks for, in the form it asks.',
].join('\n');

const TASKS = {
  summary: 'Sum these cards up in three to five short sentences: what they say together, where they agree and where they do not.',
  questions: 'Ask the three to five questions these cards leave open, or where they disagree. One per line, each starting with "? ", ending with the cards it comes from, like (#1, #3).',
  group: 'Sort the cards into two to six groups by what they are about. One line per group: a name of two to four words, a colon, then the card numbers, like "Budget: 1, 4". Every card in exactly one group.',
  links: 'Find up to six pairs of cards that belong together: the same subject, one answers, contradicts or depends on the other. One line per pair: "#a-#b: " and a label of one to four words.',
  merge: 'Write one Markdown note that brings these cards together: a first line "# " and a title, then the content arranged by subject under ## headings. Keep every fact once (duplicates merged); where cards disagree, keep both and add a "> [!question]" line. Nothing that is not in the cards.',
  chat: 'Answer the question below from the cards, in a few sentences or a short list.',
  region: 'Each marked card is a note on a part of a picture: the part, then the whole picture, are given. Answer what the note asks, or check what it says, from what the pictures show; say plainly what they cannot tell. A few sentences or a short list, no heading.',
};

// The request: the cards (in a talk, only the ones it hasn't seen as they
// are now: seen maps a card's key to the text it was shown), then what is
// asked.
function requestText(task, cards, question, seen = new Map()) {
  const shown = cards.filter((c) => seen.get(c.key) !== c.text);
  const parts = [];
  let k = 0;
  const said = (c) => [c.text, ...(c.pictures || []).map((p) => `[picture ${++k}: ${p.what}]`)].filter(Boolean).join('\n');
  if (shown.length) parts.push(`Cards:\n${shown.map((c) => `#${c.n} ${c.title ? `"${c.title}"` : 'card'}:\n${said(c)}`).join('\n\n')}`);
  const names = cards.map((c) => `#${c.n}`).join(', ');
  if (task === 'chat') parts.push(`${cards.length ? `About cards ${names}. ` : ''}${TASKS.chat}\nQuestion: ${question}`);
  else parts.push(`Request (cards ${names}): ${TASKS[task]}`);
  return parts.join('\n\n');
}
// The pictures sent with it, in the order requestText names them.
function picturesOf(cards, seen = new Map()) {
  return cards.filter((c) => seen.get(c.key) !== c.text).flatMap((c) => c.pictures || []);
}

function deskMargin({ bin, env, warmMs }) {
  let spare = null;
  let talk = null; // { key, s, seen }
  const fresh = () => new Session(bin, env, warmMs, SYSTEM);
  const warm = () => { if (!spare || spare.dead) spare = fresh(); return { ready: !!spare.ready }; };
  const take = () => { const s = spare && !spare.dead ? spare : fresh(); spare = fresh(); return s; };
  const stop = () => { spare?.close(); talk?.s.close(); spare = talk = null; };

  // { task, cards: [{ n, key, title, text }], question, talk (its key) }
  // → streams through onText; onDone(info). → cancel().
  function ask(req, onText, onDone) {
    if (!Object.hasOwn(TASKS, req.task)) { onDone({ ok: false, error: 'Not a request the desk knows.' }); return () => {}; }
    let s;
    let seen;
    if (req.task === 'chat') {
      // A long talk starts again: what it carries is sent each turn.
      if (!talk || talk.key !== req.talk || talk.s.dead || talk.s.turns >= 12) { talk?.s.close(); talk = { key: req.talk, s: take(), seen: new Map(), nums: new Map() }; }
      ({ s, seen } = talk);
      // A card keeps its number for the whole talk.
      const { nums } = talk;
      for (const c of req.cards) { if (!nums.has(c.key)) nums.set(c.key, nums.size + 1); c.n = nums.get(c.key); }
    } else s = take();
    const text = requestText(req.task, req.cards, req.question || '', seen);
    const pictures = picturesOf(req.cards, seen);
    const content = pictures.length
      ? [...pictures.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.media, data: p.data } })), { type: 'text', text }]
      : text;
    if (seen) for (const c of req.cards) seen.set(c.key, c.text);
    const done = () => { if (req.task !== 'chat') s.close(); };
    const cancel = s.ask(content, onText, (info) => { done(); onDone(info); });
    return () => { cancel(); done(); };
  }

  return { warm, ask, stop };
}

module.exports = { deskMargin, requestText, picturesOf, TASKS, SYSTEM };
