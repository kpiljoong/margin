// A review talked through: the assistant says where the topic stands, asks
// one thing at a time, and puts what you say back in a sentence to note
// (or not) — the desk (its cards, "This time", the ledger) kept behind it
// as the record, shown on asking. Nothing is decided or changed in a note
// but by a button pressed here, as on the desk.
import { thisTimeOf, decisionOf } from './desk.js';

// The language the talk speaks: the notes' (Korean when they are).
export const talkLang = (text) => (/[\uAC00-\uD7A3]/.test(String(text || '')) ? 'ko' : 'en');
const name = (p) => String(p || '').split('/').pop().replace(/\.md$/i, '');
// A link as its name ([[folder/note|shown]] → shown, or note).
const unlink = (t) => String(t || '').replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, p, a) => a || name(p));
const LABEL = {
  ko: { 'To decide': '\uC815\uD560 \uAC83', Missing: '\uBE60\uC9C4 \uAC83', 'Doesn’t agree': '\uB178\uD2B8\uB07C\uB9AC \uB2E4\uB978 \uAC83', 'A question': '\uC9C8\uBB38', 'To consider': '\uC0DD\uAC01\uD574 \uBCFC \uAC83', 'A date to look at': '\uB0A0\uC9DC \uD655\uC778', 'Your pick': '\uC774\uBC88\uC5D0 \uC815\uD558\uAE30\uB85C \uD55C \uAC83' },
  en: { 'Your pick': 'What you chose to settle' },
};
export const WORDS = {
  ko: {
    start: (t) => `${t} \uC815\uB9AC\uB97C \uC2DC\uC791\uD560\uAC8C\uC694.`,
    goal: (g, how) => (how === 'guessed' ? `\uBAA9\uD45C\uB294 “${g}”(\uC73C)\uB85C \uC9D0\uC791\uD588\uC5B4\uC694. \uB2E4\uB974\uBA74 \uB9D0\uC500\uD574 \uC8FC\uC138\uC694.` : `\uBAA9\uD45C: ${g}`),
    noGoal: '\uBAA9\uD45C\uAC00 \uC544\uC9C1 \uC5C6\uC5B4\uC694. \uC774\uBC88\uC5D0 \uBB34\uC5C7\uC744 \uB05D\uB0B4\uACE0 \uC2F6\uC740\uC9C0 \uB9D0\uC500\uD574 \uC8FC\uC138\uC694.',
    sofar: (d, l) => (d || l ? `\uC9C0\uAE08\uAE4C\uC9C0 \uC815\uD55C \uAC83 ${d}\uAC1C${l ? `, \uBBF8\uB8EC \uAC83 ${l}\uAC1C` : ''}\uC608\uC694.` : ''),
    focus: (f) => `\uC774\uBC88\uC5D0 \uC815\uD558\uAE30\uB85C \uD55C \uAC83: ${f.map((x) => `“${x.replace(/[.。]\s*$/, '')}”`).join(', ')}.`,
    asks: (n) => (n ? `\uC5EC\uCB64\uBCFC \uAC8C ${n}\uAC00\uC9C0 \uC788\uC5B4\uC694. \uD558\uB098\uC529 \uAC08\uAC8C\uC694. \uC0DD\uAC01\uB098\uB294 \uAC78 \uC5B8\uC81C\uB4E0 \uB9C9 \uC4F0\uC154\uB3C4 \uB3FC\uC694.` : '\uC5EC\uCB64\uBCFC \uAC74 \uC5C6\uC5B4\uC694. \uC0DD\uAC01\uB098\uB294 \uAC78 \uB9C9 \uC4F0\uC2DC\uBA74 \uC815\uB9AC\uD574 \uB4DC\uB9B4\uAC8C\uC694.'),
    of: (i, n) => `${i}/${n}`,
    todoQ: '\uC774 \uD560 \uC77C, \uB05D\uB0AC\uB098\uC694?',
    todoIs: (t) => `\uD560 \uC77C\uB85C \uBC1B\uC73C\uBA74: ${t}`,
    where: '\uB178\uD2B8\uC5D0\uC11C \uAD00\uB828 \uC788\uC5B4 \uBCF4\uC774\uB294 \uC904 (\uB204\uB974\uBA74 \uADF8 \uC904\uC774 \uC5F4\uB824\uC694):',
    skip: '\uAC74\uB108\uB6F0\uAE30', drop: '\uD544\uC694 \uC5C6\uC5B4\uC694', takeTodo: '\uD560 \uC77C\uB85C \uBC1B\uAE30', done: '\uB05D\uB0AC\uC5B4\uC694', notYet: '\uC544\uC9C1\uC774\uC5D0\uC694',
    sorting: '\uC815\uB9AC\uD558\uB294 \uC911…',
    notSorted: (e) => `\uC815\uB9AC\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694: ${e}. \uC4F0\uC2E0 \uAE00\uC740 \uAE30\uB85D\uC5D0 \uADF8\uB300\uB85C \uB0A8\uACA8 \uB480\uC5B4\uC694.`,
    nothing: '\uB530\uB85C \uC815\uB9AC\uD560 \uAC74 \uC5C6\uC5B4 \uBCF4\uC5EC\uC694. \uC4F0\uC2E0 \uAE00\uC740 \uAE30\uB85D\uC5D0 \uADF8\uB300\uB85C \uB0A8\uACA8 \uB480\uC5B4\uC694.',
    willNote: '\uC774\uB807\uAC8C \uC801\uC5B4\uB458\uAC8C\uC694.',
    note: '\uC801\uC5B4\uB450\uAE30', fix: '\uACE0\uCE60\uB798\uC694',
    answering: (q) => `“${q}”\uC5D0 \uB300\uD55C \uB2F5\uC73C\uB85C \uC774\uB807\uAC8C \uC801\uC5B4\uB458\uAC8C\uC694.`,
    settled: (q) => `“${q}” — \uC774\uAC78\uB85C \uC815\uB9AC\uB410\uB098\uC694?`,
    yesNext: '\uB124, \uB2E4\uC74C\uC73C\uB85C',
    tickedFail: (ts) => `\uD560 \uC77C ${ts.map((t) => `“${t}”`).join(', ')}\uC758 \uC644\uB8CC\uB294 \uC81C\uC548\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694. \uB178\uD2B8\uC5D0\uC11C \uADF8 \uC904\uC744 \uADF8\uB300\uB85C \uCC3E\uC9C0 \uBABB\uD588\uAC70\uB098(\uC9C0\uC6CC\uC84C\uAC70\uB098 \uBC14\uB01C) \uC81C\uC548\uC774 \uB418\uC9C0 \uC54A\uC558\uC5B4\uC694. \uAE30\uB85D \uBCF4\uAE30\uC5D0\uC11C \uD655\uC778\uD574 \uC8FC\uC138\uC694.`,
    tickedThere: (ts) => `\uD560 \uC77C ${ts.map((t) => `“${t}”`).join(', ')}\uC740(\uB294) \uB178\uD2B8\uC5D0 \uC774\uBBF8 \uC644\uB8CC\uB85C \uB418\uC5B4 \uC788\uC5B4\uC694.`,
    todosAdded: (k, there) => `\uD560 \uC77C ${k}\uAC1C\uB97C \uBAA9\uB85D\uC5D0 \uC81C\uC548\uD588\uC5B4\uC694${there ? ` (${there}\uAC1C\uB294 \uC774\uBBF8 \uC788\uC5B4\uC694)` : ''}. \uBE68\uAC04 \uD39C\uC5D0\uC11C \uBC1B\uC73C\uC2DC\uBA74 \uB3FC\uC694.`,
    todosNone: '\uC0C8\uB85C \uB123\uC744 \uD560 \uC77C\uC774 \uC5C6\uC5B4\uC694. \uBAA8\uB450 \uBAA9\uB85D\uC5D0 \uC788\uC5B4\uC694.',
    todosFail: '\uD560 \uC77C \uBAA9\uB85D\uC5D0 \uC81C\uC548\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694.',
    markedN: (k, f) => (k ? `\uB178\uD2B8 ${k}\uACF3\uC5D0 \uCDE8\uC18C \uD45C\uC2DC\uB97C \uC81C\uC548\uD588\uC5B4\uC694${f ? `. ${f}\uACF3\uC740 \uD558\uC9C0 \uBABB\uD588\uC5B4\uC694` : ''}.` : '\uCDE8\uC18C \uD45C\uC2DC\uB97C \uC81C\uC548\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694.'),
    missedN: (k) => `${k}\uC904\uC740 \uB178\uD2B8\uAC00 \uADF8\uC0C8 \uBC14\uB00C\uC5B4\uC11C \uBE7C \uB450\uC5C8\uC5B4\uC694.`,
    failedN: (fs) => `\uC81C\uC548\uD558\uC9C0 \uBABB\uD55C \uB178\uD2B8: ${fs.join(', ')}.`,
    staleN: '\uC9C0\uAE08 \uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uACB0\uC815\uC5D0\uC11C \uB098\uC628 \uBCC0\uACBD\uC740 \uC81C\uC548\uD558\uC9C0 \uC54A\uC558\uC5B4\uC694. \uBC18\uC601\uD560 \uACF3\uC744 \uB2E4\uC2DC \uCC3E\uC544 \uC8FC\uC138\uC694.',
    noted: '\uC801\uC5C8\uC5B4\uC694.',
    held: (n) => `${n}\uAC1C\uB294 \uADF8 \uACB0\uC815\uC774 \uADF8\uC0C8 \uBC14\uB00C\uC5B4\uC11C \uBABB \uC801\uC5C8\uC5B4\uC694. \uAE30\uB85D \uBCF4\uAE30\uC5D0\uC11C \uD655\uC778\uD574 \uC8FC\uC138\uC694.`,
    fixIt: '\uACE0\uCCD0\uC11C \uB2E4\uC2DC \uC368 \uC8FC\uC138\uC694.',
    kind: { decided: '\uC815\uD568', later: '\uB098\uC911\uC5D0', open: '\uC544\uC9C1 \uACE0\uBBFC \uC911', todo: '\uD560 \uC77C', done: '\uB05D\uB0A8', withdrawn: '\uCDE8\uC18C' },
    instead: '\uBC14\uAFC8', putOff: '\uBBF8\uB8F8', reopen: '\uB2E4\uC2DC \uACE0\uBBFC',
    ticks: (t) => ` — \uD560 \uC77C “${t}” \uC644\uB8CC\uB85C`,
    taken: '\uD560 \uC77C\uB85C \uBC1B\uC558\uC5B4\uC694.', dropped: '\uBE7C \uB458\uAC8C\uC694.', skipped: '\uB118\uC5B4\uAC08\uAC8C\uC694. \uB2E4\uC74C\uC5D0 \uC5F4\uBA74 \uB2E4\uC2DC \uC5EC\uCB64\uBCFC\uAC8C\uC694.',
    ticked: (ts) => `\uD560 \uC77C ${ts.map((t) => `“${t}”`).join(', ')}\uC744(\uB97C) \uC644\uB8CC\uB85C \uB178\uD2B8\uC5D0 \uC81C\uC548\uD588\uC5B4\uC694. \uB178\uD2B8\uC758 \uBE68\uAC04 \uD39C\uC5D0\uC11C \uBC1B\uC73C\uC2DC\uBA74 \uB3FC\uC694.`,
    allAsked: '\uC5EC\uCB64\uBCFC \uAC74 \uB2E4 \uD588\uC5B4\uC694.',
    decidedN: (n, out) => (n ? `\uC774\uBC88\uAE4C\uC9C0 \uC815\uD55C \uAC83 ${n}\uAC1C${out ? `, \uADF8\uC911 ${out}\uAC1C\uB294 \uC544\uC9C1 \uB178\uD2B8\uC5D0 \uC5C6\uC5B4\uC694` : ', \uBAA8\uB450 \uB178\uD2B8\uC5D0 \uC788\uC5B4\uC694'}.` : '\uC544\uC9C1 \uC815\uD55C \uAC74 \uC5C6\uC5B4\uC694.'),
    laterN: (n) => (n ? `\uBBF8\uB8EC \uAC83 ${n}\uAC1C.` : ''),
    todosN: (n) => (n ? `\uB2E4\uC74C \uD560 \uC77C ${n}\uAC1C.` : ''),
    stale: (n) => `\uB178\uD2B8\uC5D0 \uC81C\uC548\uD574 \uB454 \uAC83 \uC911 ${n}\uACF3\uC740 \uC9C0\uAE08\uC740 \uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uACB0\uC815\uC5D0\uC11C \uB098\uC628 \uBCC0\uACBD\uC774 \uC11E\uC5EC \uC788\uC5B4\uC694. \uBC1B\uAE30 \uC804\uC5D0 \uD655\uC778\uD574 \uC8FC\uC138\uC694.`,
    marked: (n) => `\uCDE8\uC18C\uD55C \uACB0\uC815\uC774 \uB178\uD2B8 ${n}\uACF3\uC5D0 \uC544\uC9C1 \uACB0\uC815\uC73C\uB85C \uC801\uD600 \uC788\uC5B4\uC694.`,
    findChanges: '\uB178\uD2B8\uC5D0 \uBC18\uC601\uD560 \uACF3 \uCC3E\uAE30', addTodos: '\uD560 \uC77C \uBAA9\uB85D\uC5D0 \uB123\uAE30', finish: '\uC815\uB9AC \uB9C8\uCE58\uAE30', markThem: '\uCDE8\uC18C \uD45C\uC2DC \uC81C\uC548\uD558\uAE30', look: '\uC0B4\uD3B4\uBCF4\uAE30',
    reading: (s) => `\uB178\uD2B8\uB97C \uC77D\uACE0 \uBC14\uAFC0 \uACF3\uC744 \uCC3E\uB294 \uC911… ${s}\uCD08 (\uBCF4\uD1B5 30\uCD08\uCBE4)`,
    notRead: (e) => `\uB178\uD2B8\uB97C \uC77D\uC9C0 \uBABB\uD588\uC5B4\uC694: ${e}`,
    noDecided: '\uC544\uC9C1 \uC815\uD55C \uAC8C \uC5C6\uC5B4\uC11C \uB178\uD2B8\uC5D0 \uBC18\uC601\uD560 \uAC74 \uC5C6\uC5B4\uC694.',
    noChanges: '\uB178\uD2B8\uC5D0\uC11C \uBC14\uAFC0 \uACF3\uC740 \uC5C6\uC5B4\uC694. \uBAA8\uB450 \uACB0\uC815\uACFC \uB9DE\uC544\uC694.',
    changes: (n, k, by) => `\uB178\uD2B8 ${n}\uACF3\uC5D0\uC11C ${k}\uC904\uC744 \uBC14\uAFB8\uBA74 \uB3FC\uC694: ${by}. \uACB0\uC815\uB9C8\uB2E4 \uAE30\uB85D \uC904\uB3C4 \uD558\uB098\uC529 \uB4E4\uC5B4\uAC00\uC694.`,
    lines: (f, k) => `${f} ${k}\uC904`,
    propose: '\uB178\uD2B8\uC5D0 \uC81C\uC548\uD558\uAE30', show: '\uBC14\uB00C\uB294 \uACF3 \uBCF4\uAE30',
    proposed: (n) => `\uB178\uD2B8 ${n}\uACF3\uC5D0 \uC81C\uC548\uD588\uC5B4\uC694. \uB178\uD2B8\uB9C8\uB2E4 \uBC1B\uC744\uC9C0 \uACE0\uB974\uC2DC\uBA74 \uB3FC\uC694.`,
    notProposed: '\uC81C\uC548\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694. \uAE30\uB85D \uBCF4\uAE30\uC758 \uC548\uB0B4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.',
    finished: '\uC815\uB9AC\uD588\uC5B4\uC694. \uB2E4\uC74C\uC5D0 \uC5F4\uBA74 \uC5EC\uAE30\uC11C \uC774\uC5B4\uAC08\uAC8C\uC694.',
    back: '← \uB300\uD654\uB85C \uB3CC\uC544\uAC00\uAE30',
    desk: '\uAE30\uB85D \uBCF4\uAE30', talk: '\uB300\uD654\uB85C',
    placeholder: '\uB9D0\uD558\uB4EF \uC368 \uC8FC\uC138\uC694 — \uC815\uD55C \uAC83, \uBBF8\uB8EC \uAC83, \uACE0\uBBFC \uC911\uC778 \uAC83, \uD560 \uC77C… (Enter, ⇧Enter \uC904\uBC14\uAFC8)',
  },
  en: {
    start: (t) => `Let’s go through ${t}.`,
    goal: (g, how) => (how === 'guessed' ? `I guessed the goal is “${g}” — tell me if not.` : `Goal: ${g}`),
    noGoal: 'There is no goal yet: what do you want done this time?',
    sofar: (d, l) => (d || l ? `So far ${d} decided${l ? `, ${l} put off` : ''}.` : ''),
    focus: (f) => `You chose to settle: ${f.map((x) => `“${x.replace(/[.。]\s*$/, '')}”`).join(', ')}.`,
    asks: (n) => (n ? `${n} thing${n === 1 ? '' : 's'} to ask, one at a time. Write whatever comes to mind, any time.` : 'Nothing to ask: write whatever comes to mind and I’ll sort it.'),
    of: (i, n) => `${i}/${n}`,
    todoQ: 'Is this to-do done?',
    todoIs: (t) => `As a to-do: ${t}`,
    where: 'Lines in the notes that look related (opens it there):',
    skip: 'Skip', drop: 'Not needed', takeTodo: 'Take the to-do', done: 'Done', notYet: 'Not yet',
    sorting: 'Sorting it…',
    notSorted: (e) => `Not sorted: ${e}. What you wrote is kept in the record as written.`,
    nothing: 'Nothing to sort in it; it is kept in the record as written.',
    willNote: 'I’ll note it so:',
    note: 'Note it', fix: 'Let me fix it',
    answering: (q) => `As your answer to “${q}”, I’ll note it so:`,
    settled: (q) => `“${q}” — settled by that?`,
    yesNext: 'Yes, next',
    tickedFail: (ts) => `Not proposed done: ${ts.map((t) => `“${t}”`).join(', ')} — not found in its note as it was (deleted or changed), or not proposed. Look at it in the record.`,
    tickedThere: (ts) => `${ts.map((t) => `“${t}”`).join(', ')}: done in the note already.`,
    todosAdded: (k, there) => `${k} to-do${k === 1 ? '' : 's'} proposed in your list${there ? ` (${there} there already)` : ''}: accept in the red pen review.`,
    todosNone: 'No new to-dos: all are in your list already.',
    todosFail: 'The to-dos were not proposed.',
    markedN: (k, f) => (k ? `Proposed struck out in ${k} note${k === 1 ? '' : 's'}${f ? `; ${f} not` : ''}.` : 'Not proposed.'),
    missedN: (k) => `${k} line${k === 1 ? '' : 's'} left out: the note changed since.`,
    failedN: (fs) => `Not proposed: ${fs.join(', ')}.`,
    staleN: 'Changes from a decision not decided now were not proposed: find them again.',
    noted: 'Noted.',
    held: (n) => `${n} not noted: the decision changed since. Look at it in the record.`,
    fixIt: 'Write it again as you mean it.',
    kind: { decided: 'Decided', later: 'Later', open: 'Still open', todo: 'To do', done: 'Done', withdrawn: 'Called off' },
    instead: 'Changed', putOff: 'Put off', reopen: 'Open again',
    ticks: (t) => ` — the to-do “${t}” done`,
    taken: 'Taken as a to-do.', dropped: 'Left out.', skipped: 'Moving on; I’ll ask again next time.',
    ticked: (ts) => `${ts.map((t) => `“${t}”`).join(', ')} proposed done in ${ts.length === 1 ? 'its note' : 'their notes'}: accept in the red pen review.`,
    allAsked: 'That’s all I had to ask.',
    decidedN: (n, out) => (n ? `${n} decided so far${out ? `, ${out} not in the notes yet` : ', all in the notes'}.` : 'Nothing decided yet.'),
    laterN: (n) => (n ? `${n} put off.` : ''),
    todosN: (n) => (n ? `${n} to-do${n === 1 ? '' : 's'} next.` : ''),
    stale: (n) => `${n} proposal${n === 1 ? '' : 's'} waiting in the notes mix in changes from a decision not decided now: look before accepting.`,
    marked: (n) => `A decision called off is still written as decided in ${n} note${n === 1 ? '' : 's'}.`,
    findChanges: 'Find what to change in the notes', addTodos: 'Add the to-dos', finish: 'Wrap up', markThem: 'Propose them struck out', look: 'Look',
    reading: (s) => `Reading the notes for what to change… ${s}s (about half a minute)`,
    notRead: (e) => `Not read: ${e}`,
    noDecided: 'Nothing decided yet, so nothing to carry into the notes.',
    noChanges: 'Nothing in the notes to change: they agree.',
    changes: (n, k, by) => `${k} line${k === 1 ? '' : 's'} to change in ${n} note${n === 1 ? '' : 's'}: ${by}. Each decision is recorded once too.`,
    lines: (f, k) => `${f} ${k}`,
    propose: 'Propose in the notes', show: 'Show the changes',
    proposed: (n) => `Proposed in ${n} note${n === 1 ? '' : 's'}: accept each in its red pen review.`,
    notProposed: 'Not proposed: see the record for why.',
    finished: 'Wrapped up. Next time we go on from here.',
    back: '← Back to the talk',
    desk: 'Show the record', talk: 'Talk it through',
    placeholder: 'Write as you’d say it — decided, later, still weighing, to do… (Enter; ⇧Enter: a new line)',
  },
};

// Why a to-do's state is asked (as the desk wrote it), said in the talk's language.
export function todoWhy(text, lang = 'en') {
  const t = unlink(String(text || '').replace(/^_|_$/g, ''));
  if (lang !== 'ko') return t;
  let m;
  if ((m = /^A note says it was done or booked: (.*)$/.exec(t))) return `${m[1]}\uC5D0 \uC774\uBBF8 \uD588\uAC70\uB098 \uC608\uC57D\uD588\uB2E4\uACE0 \uC801\uD600 \uC788\uC5B4\uC694.`;
  if ((m = /^Another note gives it another state: (.*)$/.exec(t))) return `${m[1]}\uC5D0\uB294 \uC0C1\uD0DC\uAC00 \uB2E4\uB974\uAC8C \uC801\uD600 \uC788\uC5B4\uC694.`;
  if ((m = /^Its day \((.*)\) has passed: is it done\?$/.exec(t))) return `\uB0A0\uC9DC(${m[1]})\uAC00 \uC9C0\uB0AC\uC5B4\uC694.`;
  return t;
}
// A to-do as said: without its priority marks.
const todoText = (t) => String(t || '').replace(/\s*[\u23EB\u23EC\u{1F53A}\u{1F53C}\u{1F53D}]/gu, '').trim();
// A margin card as a question: { label, say, why, todo }.
export function questionOf(a, lang = 'en') {
  const lines = String(a.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const say = lines.filter((l) => !/^_(?:First|Then): /.test(l) && !/^From: /.test(l) && !/^To-do: `/.test(l)).join('\n');
  const why = (/^_(?:First|Then): (.*)_$/.exec(lines.find((l) => /^_(?:First|Then): /.test(l)) || '') || [])[1] || '';
  const todo = (/^To-do: `(.*)`$/.exec(lines.find((l) => /^To-do: `/.test(l)) || '') || [])[1] || '';
  const t = String(a.title || '');
  const pick = /^Your pick/.test(t);
  const kind = t.replace(/^Your pick · /, '');
  const L = LABEL[lang] || {};
  const from = [...((lines.find((l) => /^From: /.test(l)) || '').matchAll(/\[\[([^\]|#]+)/g))].map((m) => (/\.md$/i.test(m[1]) ? m[1] : `${m[1]}.md`));
  return { label: pick ? (L['Your pick'] || 'Your pick') : (L[kind] || kind), say, why, todo, from };
}

// Where a note says what a question is about: its line sharing the most
// words with it (a Korean word by its pairs of letters too, so endings
// don't hide it), at least three; none in its front matter, a heading or
// a short line. → [{ line (from 0), text }] (at most k).
export function evidence(text, about, k = 1) {
  const words = (t) => {
    const out = new Set();
    for (const w of String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
      if (w.length >= 2) out.add(w);
      if (/[\uac00-\ud7a3]/.test(w) && w.length > 2) for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
    }
    return out;
  };
  const q = words(about);
  const lines = String(text).split('\n');
  const front = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  const cands = lines.map((l, i) => ({ line: i, text: l.trim() })).filter((c) => c.line > front && c.text.length >= 8 && !/^(#|```|---)/.test(c.text)).map((c) => ({ ...c, w: words(c.text) }));
  // A word in fewer lines tells more (a name, a place) than one in many.
  const df = new Map();
  for (const c of cands) for (const w of c.w) if (q.has(w)) df.set(w, (df.get(w) || 0) + 1);
  const hits = [];
  for (const c of cands) {
    const shared = [...c.w].filter((w) => q.has(w));
    if (shared.length >= 3) hits.push({ line: c.line, text: c.text, n: shared.reduce((sum, w) => sum + Math.log(1 + cands.length / df.get(w)), 0) });
  }
  return hits.sort((a, b) => b.n - a.n || a.line - b.line).slice(0, k).map(({ line, text: t }) => ({ line, text: t }));
}

// What a jot was sorted into, a line each, as said back.
export function sortedLines(items, lang = 'en') {
  const W = WORDS[lang] || WORDS.en;
  return items.map((it) => {
    const j = it.jot || it;
    if (j.replaces) {
      const old = decisionOf(j.replaces).words;
      if (j.kind === 'withdrawn') return `${W.kind.withdrawn}: ${old}`;
      if (j.kind === 'later') return `${W.putOff}: ${old}`;
      if (j.kind === 'open') return `${W.reopen}: ${old}`;
      return `${W.instead}: ${old} → ${j.say}`;
    }
    const todo = j.kind === 'todo' ? (it.text || '').match(/To-do: `- \[ \] ([^`]+)`/)?.[1] : '';
    const about = j.kind === 'decided' && j.about ? ` (${name(j.about)})` : '';
    const ticks = j.ticks && (j.kind === 'done' || j.kind === 'decided') ? W.ticks(todoText(j.ticks.text)) : '';
    return `${W.kind[j.kind] || j.kind}: ${todo || j.say}${about}${ticks}`;
  });
}

// What the talk opens with: the topic, its goal, where it stands, how many to ask.
export function openingText({ title, goal, goalState, mine, n }, lang = 'en') {
  const W = WORDS[lang] || WORDS.en;
  const g = mine.goal || goal;
  return [
    W.start(title),
    g ? W.goal(g, mine.goal ? 'theirs' : goalState) : W.noGoal,
    [W.sofar(mine.decided.length, mine.later.length), mine.focus.length ? W.focus(mine.focus) : ''].filter(Boolean).join(' '),
    W.asks(n),
  ].filter(Boolean).join('\n\n');
}

// Where it stands at the end, said.
export function closingText({ decisions = [], later = 0, todos = [], waiting = [], withdrawals = [] }, lang = 'en') {
  const W = WORDS[lang] || WORDS.en;
  return [
    W.allAsked,
    [W.decidedN(decisions.length, decisions.filter((d) => !d.inNote).length), W.laterN(later), W.todosN(todos.length)].filter(Boolean).join(' '),
    waiting.length ? W.stale(waiting.length) : '',
    withdrawals.length ? W.marked(new Set(withdrawals.map((w) => w.note)).size) : '',
  ].filter(Boolean).join('\n\n');
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}
function btn(label, run, cls = '') {
  const b = el('button', `btn small ${cls}`.trim(), label);
  b.addEventListener('click', (e) => { e.stopPropagation(); run(b); });
  return b;
}

export class Talk {
  constructor(desk) {
    this.desk = desk;
    this.passed = new Set(); // asked and gone past this time (skipped, not yet)
    this.current = null;
    this.busy = false;
    const all = desk.d.nodes.filter((n) => n.type === 'text').map((n) => n.text).join('\n');
    this.lang = talkLang(all);
    this.W = WORDS[this.lang];
    this.log = el('div', 'talk-log');
    this.input = el('textarea', 'talk-input');
    this.input.rows = 2;
    this.input.placeholder = this.W.placeholder;
    this.input.addEventListener('input', () => { this.input.style.height = 'auto'; this.input.style.height = `${Math.min(this.input.scrollHeight, 200)}px`; });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const t = this.input.value.trim(); if (t && !this.busy) { this.input.value = ''; this.input.style.height = 'auto'; this.said(t); } }
    });
    const head = el('div', 'talk-head', el('b', null, this.title()), btn(this.W.desk, () => this.desk.showTalk(false), 'ghost'));
    this.el = el('div', 'talk', head, el('div', 'talk-body', this.log), el('div', 'talk-foot', this.input));
    // On the desk (the record): the way back, always in sight.
    this.back = btn(this.W.back, () => this.desk.showTalk(true), 'desk-to-talk');
    this.el.tabIndex = -1; // (a click in it stays in it: text to select, not the desk's focus)
    // Its keys are its own (the desk's are not pressed through it).
    for (const t of ['keydown', 'pointerdown', 'wheel', 'dblclick', 'paste']) this.el.addEventListener(t, (e) => e.stopPropagation(), t === 'wheel' ? { passive: true } : undefined);
  }
  title() {
    const g = this.desk.d.nodes.find((x) => x.type === 'text' && /^\*\*[^*]+\*\*\n\nGoal \(/.test(String(x.text || '')));
    return (/^\*\*([^*]+)\*\*/.exec(g?.text || '') || [])[1] || '';
  }
  // What is left to ask: the margin's cards in order, then the to-dos whose state is in doubt.
  queue() {
    const d = this.desk;
    const cards = d.ai.filter((a) => a.kind === 'review' && a.state === 'done' && !a.jot && !a.changes && a.title !== 'Wrap-up').sort((p, q) => p.y - q.y).map((a) => ({ id: a.id, a }));
    const todos = d.d.nodes.filter((n) => n.from?.kind === 'todo' && !n.from.to && !n.from.sent).sort((p, q) => p.y - q.y).map((n) => ({ id: n.id, n }));
    return [...cards, ...todos].filter((x) => !this.passed.has(x.id));
  }
  start() {
    if (this.started) return;
    this.started = true;
    const g = this.desk.d.nodes.find((x) => x.type === 'text' && /^\*\*[^*]+\*\*\n\nGoal \(/.test(String(x.text || '')));
    const m = /\nGoal \(([^)]*)\): ([^\n]*)/.exec(g?.text || '');
    const state = { 'a guess': 'guessed', 'not known': 'unknown' }[m?.[1]] || 'stated';
    const goal = m && m[2] !== '—' ? m[2].replace(/\s*— \[\[[^\]]+\]\]$/, '') : '';
    this.total = this.queue().length;
    this.say(openingText({ title: this.title(), goal, goalState: state, mine: thisTimeOf(this.desk.d), n: this.total }, this.lang));
    this.next();
  }
  focus() { this.input.focus({ preventScroll: true }); }
  // ---- what is said
  say(md, cls = 'ai') {
    const row = el('div', `talk-say ${cls}`);
    // Said as plain text (what the notes say is shown as written): a paragraph
    // a block, "- " lines a list, a block in _…_ a quieter line.
    if (cls === 'me') row.textContent = md;
    else {
      for (const block of String(md).split(/\n{2,}/)) {
        const lines = block.split('\n');
        if (lines.every((l) => /^- /.test(l))) row.append(el('ul', null, lines.map((l) => el('li', null, unlink(l.slice(2))))));
        else if (/^_[\s\S]*_$/.test(block)) row.append(el('p', 'talk-dim', unlink(block.slice(1, -1))));
        else row.append(el('p', null, unlink(block)));
      }
    }
    this.log.append(row);
    this.scroll();
    return row;
  }
  acts(row, ...buttons) { const a = el('div', 'talk-acts', ...buttons); row.append(a); this.scroll(); return a; }
  scroll() { requestAnimationFrame(() => { this.log.parentElement.scrollTop = this.log.parentElement.scrollHeight; }); }
  done(acts) { if (acts) for (const b of acts.querySelectorAll('button')) b.disabled = true; }
  // ---- one thing asked
  // What a question asks, in a line (sent with what they write, said back).
  askOf(q) {
    if (!q) return '';
    if (q.a) return questionOf(q.a, this.lang).say;
    return `${todoText(String(q.n.text || '').split('\n\n')[0])} — ${this.W.todoQ}`;
  }
  next() {
    const q = this.queue()[0];
    this.current = q || null;
    if (!q) { this.closing(); return; }
    const W = this.W;
    const i = this.total - this.queue().length + 1;
    if (q.a) {
      const x = questionOf(q.a, this.lang);
      const row = this.say([`_${W.of(Math.max(1, i), Math.max(this.total, i))} · ${x.label}_`, '', x.say, ...(x.why ? ['', `_${x.why}_`] : []), ...(x.todo ? ['', `_${W.todoIs(x.todo.replace(/^- \[ \] /, ''))}_`] : [])].join('\n'), 'ai ask');
      const acts = this.acts(row,
        x.todo ? btn(W.takeTodo, () => { this.done(acts); this.desk.keep(q.a); this.say(W.taken); this.next(); }) : null,
        btn(W.skip, () => { this.done(acts); this.passed.add(q.id); this.say(W.skipped); this.next(); }, 'ghost'),
        btn(W.drop, () => { this.done(acts); this.desk.drop(q.a); this.say(W.dropped); this.next(); }, 'ghost'));
      this.asking = acts;
      this.showFrom(row, x.from, [x.say, x.why].join(' '));
    } else {
      const n = q.n;
      const text = String(n.text || '').split('\n\n');
      const row = this.say([`_${W.of(Math.max(1, i), Math.max(this.total, i))} · ${W.todoQ}_`, '', todoText(text[0]), ...(text[1] ? ['', `_${todoWhy(text[1], this.lang)}_`] : [])].join('\n'), 'ai ask');
      const acts = this.acts(row,
        btn(W.done, async () => {
          this.done(acts);
          this.desk.fromAct(n, 'done');
          await this.propose([n.id]);
          this.next();
        }),
        btn(W.notYet, () => { this.done(acts); this.passed.add(q.id); this.next(); }, 'ghost'));
      this.asking = acts;
      // Its own note, and the one the desk says differs.
      const files = [n.from.file, ...[...String(text[1] || '').matchAll(/\[\[([^\]|#]+)/g)].map((m) => `${m[1]}.md`)];
      this.showFrom(row, [...new Set(files)], text[0]);
    }
    this.focus();
  }
  // Under a question: the line of each of its notes most about it, each to open there.
  async showFrom(row, files, about) {
    const got = [];
    for (const f of files.slice(0, 3)) {
      let t;
      try { t = await this.desk.opts.readNote(f); } catch { continue; }
      const [e] = evidence(t, about);
      if (e) got.push({ f, ...e });
    }
    if (!got.length || !row.isConnected) return;
    const quote = (t) => { const x = unlink(t).replace(/^(?:[-*+]\s+(?:\[.\]\s+)?|>\s*|\d+[.)]\s+)/, ''); return x.length > 140 ? `${x.slice(0, 140)}…` : x; };
    const box = el('div', 'talk-from', el('p', 'talk-dim', this.W.where), ...got.map((g) => {
      const b = el('button', 'talk-quote', el('b', null, name(g.f)), ` “${quote(g.text)}”`);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.desk.opts.openNote(g.f, g.line + 1); });
      return b;
    }));
    row.insertBefore(box, row.querySelector('.talk-acts'));
    this.scroll();
  }
  // To-dos marked done here (these cards only), proposed in their notes, and said as it went.
  async propose(ids) {
    const W = this.W;
    const cards = this.desk.d.nodes.filter((n) => ids.includes(n.id) && n.from?.to);
    const said = { ok: [], there: [], not: [] };
    for (const f of new Set(cards.map((n) => n.from.file))) {
      const these = cards.filter((n) => n.from.file === f);
      const r = await this.desk.sendToNote(f, { open: false }, these.map((n) => n.id));
      // As the note has each now: proposed, done there already, or not (not found as it was, or not proposed).
      for (const n of these) said[r.id && r.made.includes(n.id) ? 'ok' : r.there.includes(n.id) ? 'there' : 'not'].push(todoText(String(n.text || '').split('\n')[0]));
    }
    if (said.ok.length) this.say(W.ticked(said.ok));
    if (said.there.length) this.say(W.tickedThere(said.there));
    if (said.not.length) this.say(W.tickedFail(said.not));
  }
  // ---- what they say: sorted, said back, noted when they say so
  async said(text) {
    const W = this.W;
    this.say(text, 'me');
    const asked = this.current;
    this.done(this.asking);
    // What was said back before and not noted: no longer to note (written again since).
    this.done(this.pending);
    this.busy = true;
    const wait = this.say(W.sorting, 'ai wait');
    let r;
    try { r = await this.desk.jot(text, { asked: this.askOf(asked) }); } catch (e) { r = { error: e.message }; } finally { this.busy = false; wait.remove(); }
    if (r?.error) { this.say(W.notSorted(r.error)); this.again(asked); return; }
    const cards = r?.cards || [];
    if (!cards.length) { this.say(W.nothing); this.again(asked); return; }
    const short = (t) => (t.length > 50 ? `${t.slice(0, 50)}…` : t);
    const row = this.say([asked ? W.answering(short(this.askOf(asked))) : W.willNote, '', ...sortedLines(cards, this.lang).map((l) => `- ${l}`)].join('\n'));
    const acts = this.acts(row,
      btn(W.note, async () => {
        this.done(acts);
        const left = cards.filter((c) => this.desk.ai.includes(c));
        // The to-dos this marks done (not one marked before, on the desk).
        const before = new Set(this.desk.d.nodes.filter((n) => n.from?.to).map((n) => n.id));
        this.desk.keepCards(left);
        const held = left.filter((c) => this.desk.ai.includes(c)).length;
        this.say(held ? `${W.noted} ${W.held(held)}` : W.noted);
        await this.propose(this.desk.d.nodes.filter((n) => n.from?.kind === 'todo' && n.from.to && !n.from.sent && !before.has(n.id)).map((n) => n.id));
        if (this.current !== asked) return; // (asked on since)
        // Still asked (what they wrote may be about something else): settled, they say.
        if (asked && this.queue().some((x) => x.id === asked.id)) {
          const ask = this.say(W.settled(short(this.askOf(asked))));
          const yes = this.acts(ask,
            btn(W.yesNext, () => { this.done(yes); if (asked.a) this.desk.answered(asked.a); else this.passed.add(asked.id); this.next(); }),
            btn(W.notYet, () => { this.done(yes); this.again(asked); }, 'ghost'));
          this.asking = yes;
          return;
        }
        this.next();
      }),
      btn(W.fix, () => {
        this.done(acts);
        this.desk.unjot(r);
        this.input.value = text;
        this.say(W.fixIt);
        this.again(asked);
      }, 'ghost'));
    this.pending = acts;
    this.focus();
  }
  // The same thing still asked (its buttons again); nothing asked: the end said again, as it is now.
  again(asked) {
    if (!asked) { if (this.closed) this.closing(); else this.focus(); return; }
    this.passed.delete(asked.id);
    this.total = Math.max(this.total, this.queue().length);
    this.next();
  }
  // ---- the end: where it stands, and what to do with it
  async closing() {
    const W = this.W;
    this.closed = true;
    this.done(this.ending); // (the one said before: as it was then)
    const r = await this.desk.wrapData();
    const mine = thisTimeOf(this.desk.d);
    const row = this.say(closingText({ ...r, later: mine.later.length }, this.lang));
    const out = r.decisions.filter((d) => !d.inNote).length;
    const acts = this.acts(row,
      out && this.desk.opts.changes ? btn(W.findChanges, async (b) => { b.disabled = true; if (!(await this.changes())) b.disabled = false; }) : null,
      r.todos.length && this.desk.opts.todoFile ? btn(W.addTodos, async (b) => {
        b.disabled = true;
        const t = await this.desk.addTodos({ text: r.todos.join('\n') });
        this.say(t.ok === null ? W.todosFail : t.added.length ? W.todosAdded(t.added.length, t.there) : W.todosNone);
        if (t.ok === null) b.disabled = false;
      }) : null,
      r.withdrawals.length ? btn(W.markThem, async (b) => {
        b.disabled = true;
        const m = await this.desk.markWithdrawn({ withdrawals: r.withdrawals });
        if (m.done.length) this.reviews(m.done, W.markedN(m.done.length, m.failed.length)); else { this.say(W.markedN(0)); b.disabled = false; }
      }) : null,
      r.waiting.length && this.desk.opts.openReview ? btn(W.look, () => this.reviews(r.waiting.map((w) => ({ file: w.file, id: w.id })))) : null,
      btn(W.finish, async () => { this.done(acts); await this.desk.wrapUp(); this.say(W.finished); }, 'ghost'));
    this.ending = acts;
  }
  // The changes their decisions make in the notes, said; proposed when they say so. → whether it was read.
  async changes() {
    const W = this.W;
    const wait = this.say(W.reading(0), 'ai wait');
    const t0 = Date.now();
    const tick = setInterval(() => { wait.textContent = W.reading(Math.round((Date.now() - t0) / 1000)); }, 1000);
    let r;
    try { r = await this.desk.changesPlan(); } finally { clearInterval(tick); wait.remove(); }
    if (r?.error) { this.say(W.notRead(r.error)); return false; }
    if (!r?.card) { this.say(W.noDecided); return true; }
    const cs = r.card.changes.filter((c) => !c.add || c.todo);
    if (!r.card.changes.length) { this.say(W.noChanges); return true; }
    const by = new Map();
    for (const c of cs) by.set(c.file, (by.get(c.file) || 0) + 1);
    const files = new Set(r.card.changes.map((c) => c.file));
    const row = this.say(W.changes(files.size, cs.length, [...by].sort((p, q) => q[1] - p[1]).map(([f, k]) => W.lines(name(f), k)).join(', ')));
    this.acts(row,
      btn(W.propose, async (b) => {
        b.disabled = true;
        const p = await this.desk.proposeChanges(r.card);
        const rest = [p?.missed ? W.missedN(p.missed) : '', p?.failed?.length ? W.failedN(p.failed.map((f) => f.split(':')[0])) : '', p?.stale?.length ? W.staleN : ''].filter(Boolean).join(' ');
        if (!p?.done?.length) { this.say(rest || W.notProposed); b.disabled = false; return; }
        this.reviews(p.done, [W.proposed(p.done.length), rest].filter(Boolean).join(' '));
      }),
      btn(W.show, () => { this.desk.showTalk(false); this.desk.show(r.card, true); }, 'ghost'));
    return true;
  }
  // Red pen reviews, each to open.
  reviews(list, said = '') {
    const row = this.say(said || '→');
    if (this.desk.opts.openReview) this.acts(row, ...list.map((d) => btn(name(d.file), () => this.desk.opts.openReview(d.id), 'ghost')));
  }
}
