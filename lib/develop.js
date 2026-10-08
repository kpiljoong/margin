'use strict';
// Develop this note (a command: only when asked): the note, its paragraphs
// numbered, and paragraphs of other notes found near them go to Claude, which
// helps the thought grow — beside the note, never in it: the claim said
// sharper, a question or two that would make it concrete, the notes that
// back it, one that goes against it, a next step, and the paragraphs of
// other notes that belong with this one (to link here). Through the claude
// CLI the user signed in to (lib/judge.js's sessionQueue).
const { sessionQueue } = require('./judge');

// Each kind and how many of it at most.
const KINDS = { sharper: 1, question: 2, ground: 2, against: 1, next: 1, gather: 1 };

const SYSTEM = [
  'You help someone develop a note they are writing: an idea, a plan, a claim, a draft. Each message gives the note with its paragraphs numbered P1, P2 …, today\'s date, and paragraphs from their other notes numbered [1], [2] … with the note\'s name (marked "linked" when the note already links to it).',
  'Your part is a sharp, honest thinking partner\'s, beside the note: help the thought get clearer and go further, mostly with what their own notes already hold. Say, each only when it truly helps:',
  '- sharper (at most one): the note\'s main claim or aim said more precisely, in one sentence they could put at the top.',
  '- question (at most two): a question that would make this note concrete or decide something it leaves open — about this note in particular, never one anyone could ask of any note ("what is your goal?", "who is the audience?").',
  '- ground (at most two): what a numbered paragraph of theirs shows that backs or informs the note — their own experience counts most.',
  '- against (at most one): a numbered paragraph, or a tension within the note itself, that goes against what it claims.',
  '- next (at most one): the one concrete next step that would move this note forward.',
  '- gather (at most one): the numbered paragraphs, not linked, that belong with this note — the same idea or its pieces, written elsewhere — and in say, what they add.',
  'The numbered paragraphs were found by likeness of words or meaning: use one only when it is about the same subject, not when it only shares a word.',
  'Reply with one block per thing, blocks separated by a line "---":',
  'kind: one of the kinds above',
  'at: the paragraph of the note it is about, like P2 (P1 when the whole note)',
  'say: at most 35 words',
  'from: the numbers of the paragraphs it comes from, like 1, 3',
  'Rules:',
  '- say in the language the message names at its end. No [numbers] in say: they go in from.',
  '- Facts, names and dates only from the note and the paragraphs given.',
  '- Fewer, stronger things are better than many; nothing is better than a generic remark. When nothing helps, reply only "kind: none".',
  '- No preamble, no praise, don\'t repeat the note back.',
].join('\n');

const ANSWER_IN = { ko: 'Answer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).', en: 'Answer in English.' };

// req: { paras: [text], today, lang, found: [{ name, text, linked }] } → the message.
function requestText({ paras, today = '', lang = 'en', found = [] }) {
  return [
    `Today: ${today || '(unknown)'}`,
    `The note:\n${paras.map((t, i) => `P${i + 1}. ${t}`).join('\n')}`,
    found.length ? `From their other notes:\n${found.map((f, i) => `[${i + 1}] from "${f.name}"${f.linked ? ' (linked)' : ''}: ${f.text}`).join('\n')}` : 'From their other notes: (none found)',
    ANSWER_IN[lang] || ANSWER_IN.en,
  ].join('\n\n');
}

// The reply → [{ kind, at (0-based paragraph), say, from: [n] }], each kind
// no more than it may be.
function parseReply(text, nParas = 1, nFound = 0) {
  const items = [];
  const count = {};
  for (const block of String(text).split(/^\s*-{3,}\s*$/m)) {
    const get = (k) => (new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, 'im').exec(block) || [])[1]?.trim() || '';
    const kind = get('kind').toLowerCase().replace(/[^a-z]/g, '');
    if (!KINDS[kind] || (count[kind] || 0) >= KINDS[kind]) continue;
    const say = get('say').replace(/\s*\[\d+(?:\s*,\s*\d+)*\](?:\uC5D0\uC11C|\uC5D0\uB294|\uC5D0\uB3C4|\uC5D0|\uC758|\uB3C4|\uC740|\uB294|\uC774|\uAC00|\uC640|\uACFC|\uCC98\uB7FC)?/g, '').replace(/^["“]|["”]$/g, '').trim().slice(0, 500);
    if (!say) continue;
    const p = Number((/\d+/.exec(get('at')) || [])[0]);
    const from = [...new Set((get('from').match(/\d+/g) || []).map(Number).filter((x) => x >= 1 && x <= nFound))];
    if (kind === 'gather' && !from.length) continue;
    count[kind] = (count[kind] || 0) + 1;
    items.push({ kind, at: p >= 1 && p <= nParas ? p - 1 : 0, say, from });
  }
  return items;
}

function developMargin({ bin, env, opts = {}, warmMs }) {
  const q = sessionQueue({ bin, env, opts, warmMs, system: SYSTEM });
  const develop = (req) => q.run(async (say) => {
    const r = await say(requestText(req));
    return r.ok ? { ok: true, items: parseReply(r.text, req.paras.length, req.found.length) } : r;
  });
  return { develop, stop: q.stop };
}

module.exports = { developMargin, requestText, parseReply, SYSTEM, KINDS };
