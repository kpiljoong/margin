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
    stateNote: '\uD604\uC7AC \uC0C1\uD0DC \uB178\uD2B8 \uB9CC\uB4E4\uAE30',
    writing: (s) => `\uB178\uD2B8\uB97C \uBAA8\uB450 \uC77D\uACE0 \uD604\uC7AC \uC0C1\uD0DC\uB97C \uC4F0\uB294 \uC911… ${s}\uCD08 (1\uBD84\uCBE4)`,
    notWritten: (e) => `\uC4F0\uC9C0 \uBABB\uD588\uC5B4\uC694: ${e}`,
    stateMade: (n) => `\uB178\uD2B8 ${n}\uAC1C\uB97C \uBAA8\uC544 \uD604\uC7AC \uC0C1\uD0DC \uB178\uD2B8\uB97C \uB9CC\uB4E4\uC5C8\uC5B4\uC694 — \uC815\uD55C \uAC83, \uC9C0\uAE08 \uAE30\uC900 \uACC4\uD68D, \uC544\uC9C1 \uC5F4\uB9B0 \uAC83(\uB178\uD2B8\uB07C\uB9AC \uB2E4\uB978 \uAC74 \uC591\uCABD \uB2E4), \uB2E4\uC74C \uD560 \uC77C. \uD56D\uBAA9\uB9C8\uB2E4 \uADFC\uAC70 \uB178\uD2B8\uAC00 \uB9C1\uD06C\uB3FC \uC788\uC5B4\uC694. \uC6D0\uB798 \uB178\uD2B8\uB4E4\uC740 \uADF8\uB300\uB85C\uC608\uC694.`,
    stateProposed: (n) => `\uB178\uD2B8 ${n}\uAC1C\uB85C \uD604\uC7AC \uC0C1\uD0DC\uB97C \uB2E4\uC2DC \uC37C\uC5B4\uC694. \uAE30\uC874 \uB178\uD2B8 \uC704\uC5D0 \uBE68\uAC04 \uD39C\uC73C\uB85C \uC81C\uC548\uD588\uC5B4\uC694. \uC6D0\uB798 \uB178\uD2B8\uB4E4\uC740 \uADF8\uB300\uB85C\uC608\uC694.`,
    stateSame: '\uD604\uC7AC \uC0C1\uD0DC \uB178\uD2B8\uAC00 \uC774\uBBF8 \uADF8\uB300\uB85C\uC608\uC694.',
    seeChanges: '\uBC14\uB010 \uBD80\uBD84 \uBCF4\uAE30',
    enough: '\uC624\uB298\uC740 \uC5EC\uAE30\uAE4C\uC9C0',
    rest: (n) => (n ? `\uB098\uBA38\uC9C0 ${n}\uAC00\uC9C0\uB294 \uB2E4\uC74C\uC5D0 \uC5EC\uCB64\uBCFC\uAC8C\uC694.` : '\uB2E4 \uC5EC\uCB64\uBD24\uC5B4\uC694.'),
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
    backTo: '\uC544\uAE4C \uC9C8\uBB38\uC73C\uB85C',
    thinking: '\uB178\uD2B8\uB97C \uBCF4\uBA70 \uC0DD\uAC01\uD558\uB294 \uC911…',
    notes: (n) => `\uC774 \uC8FC\uC81C\uC758 \uB178\uD2B8 ${n}\uAC1C`, links: '\uC5F0\uACB0', todosOpen: (n) => `\uD560 \uC77C ${n}`, decisionsIn: (n) => `\uACB0\uC815 ${n}`, nowAbout: '\uC9C0\uAE08 \uC9C8\uBB38\uACFC \uAD00\uB828',
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
    stateNote: 'Write where it stands',
    writing: (s) => `Reading all its notes and writing where it stands… ${s}s (about a minute)`,
    notWritten: (e) => `Not written: ${e}`,
    stateMade: (n) => `Written from its ${n} notes: one note of where it stands — decided, the plan as it stands, what is still open (where notes disagree, both sides), next — each point linked to its note. Its notes are as they were.`,
    stateProposed: (n) => `Written again from its ${n} notes: proposed over the one there, in its red pen review. Its notes are as they were.`,
    stateSame: 'The note of where it stands says so already.',
    seeChanges: 'What changes',
    enough: 'Enough for today',
    rest: (n) => (n ? `The other ${n} next time.` : 'All asked.'),
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
    backTo: 'Back to the question',
    thinking: 'Looking through the notes…',
    notes: (n) => `${n} notes of this topic`, links: 'Links', todosOpen: (n) => `${n} to do`, decisionsIn: (n) => `${n} decided`, nowAbout: 'About this question',
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
// A to-do as said: without its priority marks
// (and the links at its end: where it was written down, not what it says).
const todoText = (t) => String(t || '').replace(/\s*[\u23EB\u23EC\u{1F53A}\u{1F53C}\u{1F53D}]/gu, '').replace(/(?:\s*\[\[[^\]]*\]\])+\s*$/, '').trim();
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

// Where a note says what a question is about: its line with the most of
// its words (a Korean word found by most of its pairs of letters too, so an
// ending doesn't hide it — and counted once), at least two of them, a rarer
// word counting more; none in its front matter, a heading or a short line.
// → [{ line (from 0), text }] (at most k).
export function evidence(text, about, k = 1) {
  const wordsOf = (t) => [...new Set((String(t).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2))];
  const pairs = (w) => Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2));
  const q = wordsOf(about);
  const lines = String(text).split('\n');
  const front = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  const cands = lines.map((l, i) => ({ line: i, text: l.trim() })).filter((c) => c.line > front && c.text.length >= 8 && !/^(#|```|---)/.test(c.text)).map((c) => {
    const ws = new Set(wordsOf(c.text));
    const ps = new Set([...ws].flatMap(pairs));
    const has = q.filter((w) => ws.has(w) || (/[\uAC00-\uD7A3]/.test(w) && w.length > 2 && pairs(w).filter((p) => ps.has(p)).length * 2 >= w.length - 1));
    return { ...c, has };
  });
  // A word in fewer lines tells more (a name, a place) than one in many.
  const df = new Map();
  for (const c of cands) for (const w of c.has) df.set(w, (df.get(w) || 0) + 1);
  return cands.filter((c) => c.has.length >= 2).map((c) => ({ ...c, n: c.has.reduce((sum, w) => sum + Math.log(1 + cands.length / df.get(w)), 0) }))
    .sort((a, b) => b.n - a.n || a.line - b.line).slice(0, k).map(({ line, text: t }) => ({ line, text: t }));
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
export function closingText({ decisions = [], later = 0, todos = [], waiting = [], withdrawals = [], early = false }, lang = 'en') {
  const W = WORDS[lang] || WORDS.en;
  return [
    early ? '' : W.allAsked,
    [W.decidedN(decisions.length, decisions.filter((d) => !d.inNote).length), W.laterN(later), W.todosN(todos.length)].filter(Boolean).join(' '),
    waiting.length ? W.stale(waiting.length) : '',
    withdrawals.length ? W.marked(new Set(withdrawals.map((w) => w.note)).size) : '',
  ].filter(Boolean).join('\n\n');
}

// A note in a few words, from what it says itself: its title (front matter,
// its "# " heading, else its name), its summary (front matter's summary or
// description, else its first paragraph of prose, else its first list
// items), its open to-dos and #decision lines, and the notes it links to.
export function noteGist(text, file) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  const field = (k) => (fm ? (new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(fm[1]) || [])[1]?.replace(/^["']|["']$/g, '').trim() : '') || '';
  if (fm) t = t.slice(fm[0].length);
  const lines = t.split('\n');
  const title = (field('title') || (lines.find((l) => /^# \S/.test(l)) || '').slice(2).trim()).replace(/~~|\*\*|__|`/g, '').trim() || name(file);
  const clean = (l) => unlink(l).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/^\s*(?:→|->|=>)\s*/, '').replace(/^(?:[-*+]\s+(?:\[.\]\s+)?|>\s*(?:\[![^\]]*\]\s*)?|\d+[.)]\s+)/, '').replace(/[*_`]/g, '').replace(/\s*(?:#[\w/\uAC00-\uD7A3-]+|[📅⏳🛫✅➕🔺⏫🔼🔽⏬]\s*\d{4}-\d{2}-\d{2}|[📅⏳🛫✅➕🔺⏫🔼🔽⏬])/gu, '').trim();
  let gist = field('summary') || field('description');
  if (!gist) {
    const prose = t.split(/\n{2,}/).map((b) => b.trim()).find((b) => b && !/^(?:#|[-*+]\s|\d+[.)]\s|>|\||```|!\[)/.test(b));
    gist = prose ? clean(prose.split('\n').join(' ')) : lines.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)).slice(0, 3).map(clean).filter(Boolean).join(' · ');
  }
  gist = gist.length > 160 ? `${gist.slice(0, 160)}…` : gist;
  const todos = lines.filter((l) => /^\s*[-*+]\s+\[ \]\s/.test(l)).length;
  const decisions = lines.filter((l) => /(?:^|\s)#decision\b/.test(l)).length;
  const links = [...new Set([...t.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()))];
  return { file, title, gist, todos, decisions, links };
}

// The notes around the talk, in depth: linked notes kept together on one
// side (the biggest group first, each side about as full), down the side in
// a column that staggers, further back the further down the row; a note the
// question is about comes forward. Each placed so that, seen through the
// perspective (d, from o), it shows where it is meant to: its x, y and z.
export function spaceLayout({ w, h, ids, links = [], now = new Set(), column = 680, cardW = 220, cardH = 64, nowH = 170, d = 1000, o = null }) {
  const at = new Map(ids.map((id, i) => [id, i]));
  const up = ids.map((_, i) => i);
  const root = (i) => (up[i] === i ? i : (up[i] = root(up[i])));
  for (const [a, b] of links) if (at.has(a) && at.has(b)) up[root(at.get(a))] = root(at.get(b));
  const groups = new Map();
  ids.forEach((id, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); });
  const sides = [[], []];
  for (const g of [...groups.values()].sort((x, y) => y.length - x.length)) (sides[0].length <= sides[1].length ? sides[0] : sides[1]).push(...g);
  const origin = o || { x: w / 2, y: h * 0.4 };
  const room = Math.max(0, (w - column) / 2 - 24);
  const out = new Map();
  sides.forEach((list, side) => {
    const rest = list.filter((id) => !now.has(id));
    const front = list.filter((id) => now.has(id));
    const put = (id, z, sy, i) => {
      const k = (d - z) / d;
      // As wide as it shows (bigger in front, smaller back there).
      const pw = cardW / k;
      const lean = (i % 2) * Math.min(60, Math.max(0, room - pw));
      // Where it shows (its middle), then where it goes for that.
      const sx = side === 0 ? Math.max(12, 24 + lean) + pw / 2 : Math.min(w - 12, w - 24 - lean) - pw / 2;
      out.set(id, { x: origin.x + (sx - origin.x) * k - cardW / 2, y: origin.y + (sy - origin.y) * k - cardH / 2, z, side });
    };
    // Back there, down the side; those asked about in front, in its middle, one under another.
    const step = rest.length > 1 ? Math.max(0, h - 40 - cardH) / (rest.length - 1) : 0;
    rest.forEach((id, i) => put(id, -120 - (i % 3) * 130, 20 + cardH / 2 + (rest.length > 1 ? i * step : (h - cardH) / 2 - 20), i));
    const tall = Math.min(nowH, (h - 40) / Math.max(1, front.length));
    front.forEach((id, i) => put(id, 60, (h - tall * front.length) / 2 + tall * (i + 0.5) - (nowH - cardH) / 2, 0));
  });
  return out;
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
    this.history = []; // what was said, talking freely: [{ me, ai }]
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
    // Beside the talk: the topic's notes, each in a few words, how they link, and which ones the question is about.
    this.side = el('aside', 'talk-side');
    this.el = el('div', 'talk', head, el('div', 'talk-mid', el('div', 'talk-main', el('div', 'talk-body', this.log), el('div', 'talk-foot', this.input)), this.side));
    // On the desk (the record): the way back, always in sight.
    this.back = btn(this.W.back, () => this.desk.showTalk(true), 'desk-to-talk');
    this.el.tabIndex = -1; // (a click in it stays in it: text to select, not the desk's focus)
    // Its keys are its own (the desk's are not pressed through it).
    for (const t of ['keydown', 'pointerdown', 'wheel', 'dblclick', 'paste']) this.el.addEventListener(t, (e) => e.stopPropagation(), t === 'wheel' ? { passive: true } : undefined);
    // (But the app's: ⌘P, ⌘, and the like — not the text's own ⌘Z, ⌘C, ⌘V, ⌘X, ⌘A.)
    this.el.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && !/^[zyxcva]$/i.test(e.key)) this.desk.opts.appKey?.(e); });
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
    this.notesSide();
    this.say(openingText({ title: this.title(), goal, goalState: state, mine: thisTimeOf(this.desk.d), n: this.total }, this.lang));
    this.next();
  }
  focus() { this.input.focus({ preventScroll: true }); }
  // ---- what is said
  // refs ({ name: path }): its [[links]] to those notes, each to open (the others as words).
  say(md, cls = 'ai', refs = null) {
    const row = el('div', `talk-say ${cls}`);
    // Said as plain text (what the notes say is shown as written): a paragraph
    // a block, "- " lines a list, a block in _…_ a quieter line.
    const words = (t) => (refs ? this.linked(t, refs) : unlink(t));
    if (cls === 'me') row.textContent = md;
    else {
      for (const block of String(md).split(/\n{2,}/)) {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*(?:[-*]|\d+[.)]) /.test(l))) row.append(el('ul', null, lines.map((l) => el('li', null, words(l.replace(/^\s*(?:[-*]|\d+[.)]) /, ''))))));
        else if (/^_[\s\S]*_$/.test(block)) row.append(el('p', 'talk-dim', words(block.slice(1, -1))));
        else row.append(el('p', null, words(refs ? block.replace(/\*\*([^*]+)\*\*/g, '$1') : block)));
      }
    }
    this.log.append(row);
    this.scroll();
    return row;
  }
  linked(t, refs) {
    const out = [];
    let at = 0;
    for (const m of String(t).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g)) {
      out.push(t.slice(at, m.index));
      const p = refs[m[1].trim()] || refs[name(m[1])];
      if (p) {
        const b = el('button', 'talk-ref', m[2] || name(m[1]));
        b.title = p;
        b.addEventListener('click', (e) => { e.stopPropagation(); this.desk.opts.openNote(p); this.about([p], true); });
        out.push(b);
      } else out.push(m[2] || name(m[1]));
      at = m.index + m[0].length;
    }
    out.push(t.slice(at));
    return out;
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
  next(brief = false) {
    this.done(this.asking); // (what was asked before: no longer)
    const q = this.queue()[0];
    this.current = (!this.early && q) || null;
    // (Enough for today: the rest asked next time, not now.)
    if (!this.current) { this.closing(this.early); return; }
    const W = this.W;
    const i = this.total - this.queue().length + 1;
    if (q.a) {
      const x = questionOf(q.a, this.lang);
      const row = this.say([`_${brief ? `${W.backTo} · ` : ''}${W.of(Math.max(1, i), Math.max(this.total, i))} · ${x.label}_`, '', x.say, ...(x.why && !brief ? ['', `_${x.why}_`] : []), ...(x.todo && !brief ? ['', `_${W.todoIs(x.todo.replace(/^- \[ \] /, ''))}_`] : [])].join('\n'), 'ai ask');
      const acts = this.acts(row,
        x.todo ? btn(W.takeTodo, () => { this.done(acts); this.desk.keep(q.a); this.say(W.taken); this.next(); }) : null,
        btn(W.skip, () => { this.done(acts); this.passed.add(q.id); this.say(W.skipped); this.next(); }, 'ghost'),
        btn(W.drop, () => { this.done(acts); this.desk.drop(q.a); this.say(W.dropped); this.next(); }, 'ghost'),
        this.enough(() => acts));
      this.asking = acts;
      this.about(x.from);
      if (!brief) this.showFrom(row, x.from, [x.say, x.why].join(' '));
    } else {
      const n = q.n;
      const text = String(n.text || '').split('\n\n');
      const row = this.say([`_${brief ? `${W.backTo} · ` : ''}${W.of(Math.max(1, i), Math.max(this.total, i))} · ${W.todoQ}_`, '', todoText(text[0]), ...(text[1] && !brief ? ['', `_${todoWhy(text[1], this.lang)}_`] : [])].join('\n'), 'ai ask');
      const acts = this.acts(row,
        btn(W.done, async () => {
          this.done(acts);
          this.desk.fromAct(n, 'done');
          // (Not asked on meanwhile, back from the record.)
          this.busy = true;
          try { await this.propose([n.id]); } finally { this.busy = false; }
          this.next();
        }),
        btn(W.notYet, () => { this.done(acts); this.passed.add(q.id); this.next(); }, 'ghost'),
        this.enough(() => acts));
      this.asking = acts;
      // Its own note, and the one the desk says differs.
      const files = [n.from.file, ...[...String(text[1] || '').matchAll(/\[\[([^\]|#]+)/g)].map((m) => `${m[1]}.md`)];
      this.about(files);
      if (!brief) this.showFrom(row, [...new Set(files)], text[0]);
    }
    this.focus();
  }
  // The topic's notes (the desk's), each read once: a card with its title, its
  // gist, its to-dos and decisions, and the other notes of the topic it links
  // to or is linked from (a click shows that one).
  // (Again when one of them changes or goes: each card kept, as it says now; one gone, gone.)
  async notesSide() {
    const files = [...new Set(this.desk.d.nodes.filter((n) => n.type === 'file' && /\.md$/i.test(n.file || '')).map((n) => n.file))];
    const W = this.W;
    const gists = [];
    for (const f of files) { try { gists.push(noteGist(await this.desk.opts.readNote(f), f)); } catch { /* gone: not shown */ } }
    const key = (x) => String(x).replace(/\.md$/i, '').toLowerCase();
    const of = (l) => gists.find((g) => key(g.file) === key(l) || key(name(g.file)) === key(name(l)));
    const out = new Map(gists.map((g) => [g.file, new Set(g.links.map(of).filter((o) => o && o !== g).map((o) => o.file))]));
    for (const [f, to] of out) for (const o of to) out.get(o).add(f);
    this.byFile ||= new Map();
    for (const [f, c] of this.byFile) if (!out.has(f)) { c.remove(); this.byFile.delete(f); }
    this.cards = new Map();
    const list = gists.map((g) => {
      const meta = [g.todos ? W.todosOpen(g.todos) : '', g.decisions ? W.decisionsIn(g.decisions) : ''].filter(Boolean).join(' · ');
      const linked = [...out.get(g.file)].map((f) => {
        const c = el('button', 'talk-link', name(f));
        c.addEventListener('click', (e) => { e.stopPropagation(); this.about([f], true); });
        return c;
      });
      const title = el('button', 'talk-note-title', g.title);
      title.addEventListener('click', (e) => { e.stopPropagation(); this.desk.opts.openNote(g.file); });
      let card = this.byFile.get(g.file);
      if (!card) { card = el('div', 'talk-note'); card.dataset.file = g.file; card.title = g.file; this.byFile.set(g.file, card); }
      card.replaceChildren(title,
        g.gist ? el('p', 'talk-note-gist', g.gist) : '',
        meta ? el('p', 'talk-note-meta', meta) : '',
        linked.length ? el('div', 'talk-note-links', el('span', 'talk-note-meta', `${W.links}: `), linked) : '');
      this.cards.set(key(g.file), card);
      this.cards.set(key(name(g.file)), card);
      return card;
    });
    this.order = list;
    this.links = [...out].flatMap(([f, to]) => [...to].filter((t) => f < t).map((t) => [f, t]));
    this.nowHead ||= el('p', 'talk-side-head', W.nowAbout);
    this.allHead ||= el('p', 'talk-side-head');
    this.allHead.textContent = W.notes(gists.length);
    this.el.classList.toggle('with-side', gists.length > 0);
    if (!gists.length) { this.side.replaceChildren(); this.lines?.replaceChildren(); return; }
    this.lit = new Set([...(this.lit || [])].filter((c) => list.includes(c)));
    if (this.aboutNow) this.about(this.aboutNow); else this.layout();
    if (this.sideOnce) return;
    this.sideOnce = true;
    new ResizeObserver(() => this.layout()).observe(this.el);
    // In space: the room leans a little with the pointer.
    this.el.addEventListener('pointermove', (e) => {
      if (!this.inSpace) return;
      const r = this.stage.getBoundingClientRect();
      this.stage.style.perspectiveOrigin = `${50 - ((e.clientX - r.left) / r.width - 0.5) * 16}% ${40 - ((e.clientY - r.top) / r.height - 0.5) * 12}%`;
      this.drawLinks(500);
    });
  }
  // A note changed or gone (the app says so): the cards beside the talk again, in a moment.
  noteChanged(path) {
    if (!this.order || !this.desk.d.nodes.some((n) => n.type === 'file' && n.file === path)) return;
    clearTimeout(this.sideSoon);
    this.sideSoon = setTimeout(() => this.notesSide(), 300);
  }
  // Beside the talk (flat, in a column) or around it in depth (Labs, a wide
  // window, motion not reduced), as the question has it.
  layout() {
    if (!this.order) return;
    const lit = this.lit;
    const space = !!this.desk.opts.space?.() && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) && this.el.clientWidth >= 1180;
    const was = this.inSpace;
    this.inSpace = space;
    this.el.classList.toggle('in-space', space);
    for (const c of this.order) c.classList.toggle('now', lit.has(c));
    if (!space) {
      for (const c of this.order) { c.style.transform = ''; c.style.transitionDelay = ''; c.style.zIndex = ''; }
      const now = this.order.filter((c) => lit.has(c));
      this.side.replaceChildren(...(now.length ? [this.nowHead, ...now] : []), this.allHead, ...this.order.filter((c) => !lit.has(c)));
      this.side.scrollTo({ top: 0 });
      return;
    }
    if (!this.stage) {
      this.lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.lines.classList.add('talk-lines');
      this.stage = el('div', 'talk-stage', this.lines);
      this.el.querySelector('.talk-mid').prepend(this.stage);
    }
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!w || !h) return;
    const pos = spaceLayout({ w, h, ids: this.order.map((c) => c.dataset.file), links: this.links, now: new Set(this.order.filter((c) => lit.has(c)).map((c) => c.dataset.file)), column: this.el.querySelector('.talk-main').clientWidth });
    this.order.forEach((c, i) => {
      const p = pos.get(c.dataset.file);
      const place = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, ${p.z}px)`;
      c.style.zIndex = String(1000 + p.z); // (the nearer over the further)
      if (!was || c.parentElement !== this.stage) {
        // Coming in from far back, one after another.
        c.style.transitionDelay = '0ms';
        c.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, -1400px)`;
        c.classList.add('far');
        this.stage.append(c);
        requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transitionDelay = `${i * 45}ms`; c.classList.remove('far'); c.style.transform = place; }));
      } else { c.style.transitionDelay = '0ms'; c.style.transform = place; }
    });
    this.drawLinks(1400);
  }
  // The links between notes, drawn where the notes show now (for a while, as they move).
  drawLinks(ms) {
    this.linksTill = Math.max(this.linksTill || 0, performance.now() + ms);
    if (this.drawing) return;
    this.drawing = true;
    const step = () => {
      if (!this.inSpace || !this.stage?.isConnected) { this.drawing = false; return; }
      const r = this.stage.getBoundingClientRect();
      const mid = new Map(this.order.map((c) => { const b = c.getBoundingClientRect(); return [c.dataset.file, { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2, c }]; }));
      const NS = 'http://www.w3.org/2000/svg';
      this.lines.replaceChildren(...this.links.map(([a, b]) => {
        const p = mid.get(a);
        const q = mid.get(b);
        const l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', p.x.toFixed(1)); l.setAttribute('y1', p.y.toFixed(1)); l.setAttribute('x2', q.x.toFixed(1)); l.setAttribute('y2', q.y.toFixed(1));
        if (p.c.classList.contains('now') || q.c.classList.contains('now')) l.classList.add('now');
        return l;
      }));
      if (performance.now() < this.linksTill) requestAnimationFrame(step); else this.drawing = false;
    };
    requestAnimationFrame(step);
  }
  // What was noted, flying to the note it is about (where it shows), which answers with a glow.
  fly(from, files) {
    if (!this.cards || !from?.isConnected) return;
    const f = from.getBoundingClientRect();
    files.forEach((file, i) => {
      const card = this.cards.get(String(file).replace(/\.md$/i, '').toLowerCase()) || this.cards.get(name(file).toLowerCase());
      if (!card?.isConnected || !card.offsetParent) return;
      const t = card.getBoundingClientRect();
      const dot = el('div', 'talk-fly');
      document.body.append(dot);
      const run = dot.animate([
        { transform: `translate(${f.left + 40}px, ${f.top + f.height / 2}px) scale(1)`, opacity: 1 },
        { transform: `translate(${(f.left + t.left) / 2}px, ${Math.min(f.top, t.top) - 60}px) scale(1.3)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${t.left + t.width / 2}px, ${t.top + t.height / 2}px) scale(.6)`, opacity: 0.2 },
      ], { duration: 800, delay: i * 120, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
      run.onfinish = () => { dot.remove(); card.classList.remove('shown'); void card.offsetWidth; card.classList.add('shown'); };
    });
  }
  // The notes a question (or a link pressed) is about: lit, the first in sight.
  about(files, pressed = false) {
    if (!pressed) this.aboutNow = files;
    if (!this.cards) return;
    const lit = new Set((files || []).map((f) => this.cards.get(String(f).replace(/\.md$/i, '').toLowerCase()) || this.cards.get(name(f).toLowerCase())).filter(Boolean));
    // A link pressed: that note shown where it is, for a moment.
    if (pressed) {
      for (const c of lit) { if (!this.inSpace) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); c.classList.remove('shown'); void c.offsetWidth; c.classList.add('shown'); }
      return;
    }
    // (Flat: those first, under their own heading; in space: those come forward.)
    this.lit = lit;
    this.layout();
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
    const quote = (t) => { const x = unlink(t).replace(/\*\*|__/g, '').replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' · ').replace(/^(?:[-*+]\s+(?:\[.\]\s+)?|>\s*|\d+[.)]\s+)/, ''); return x.length > 140 ? `${x.slice(0, 140)}…` : x; };
    const box = el('div', 'talk-from', el('p', 'talk-dim', this.W.where), ...got.map((g) => {
      const b = el('button', 'talk-quote', el('b', null, name(g.f)), ` “${quote(g.text)}”`);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.desk.opts.openNote(g.f, g.line + 1); });
      return b;
    }));
    row.insertBefore(box, row.querySelector('.talk-acts'));
    this.scroll();
  }
  // Enough for today: the rest asked next time; where it stands said now.
  enough(acts) {
    return btn(this.W.enough, () => { this.done(acts()); this.done(this.pending); this.early = true; this.current = null; this.say(this.W.rest(this.queue().length)); this.closing(true); }, 'ghost talk-enough');
  }
  // Back from the record (where a card may have been taken or let go): what it asked, if it is still there.
  resume() {
    if (!this.started || this.busy || this.closed) return;
    if (this.current && !this.queue().some((x) => x.id === this.current.id)) { this.done(this.asking); this.next(); }
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
    // Talking freely (Labs): what is asked stays asked (its buttons too) while you talk.
    const free = !!this.desk.opts.free?.();
    if (!free) this.done(this.asking);
    // What was said back before and not noted: no longer to note (written again since).
    this.done(this.pending);
    this.busy = true;
    const wait = this.say(free ? W.thinking : W.sorting, 'ai wait');
    let r;
    try { r = await this.desk.jot(text, { asked: this.askOf(asked), ...(free ? { free: true, history: this.history.slice(-6) } : {}) }); } catch (e) { r = { error: e.message }; } finally { this.busy = false; wait.remove(); }
    if (r?.error) { this.say(W.notSorted(r.error)); if (free) this.focus(); else this.again(asked); return; }
    if (free) {
      if (r.reply) { this.say(r.reply, 'ai', r.refs || {}); this.history.push({ me: text, ai: r.reply }); }
      if (!r.cards?.length) { this.focus(); return; }
    }
    // What they asked: answered from what is written (and where), nothing noted.
    for (const x of r?.replies || []) {
      const row = this.say(x.say);
      if (x.about) this.about([x.about], true);
      if (x.about) row.append(el('p', 'talk-dim', `— ${name(x.about)}`));
    }
    const cards = r?.cards || [];
    if (!cards.length) { if (!r?.replies?.length) this.say(W.nothing); this.again(asked, !!r?.replies?.length); return; }
    if (free) this.done(this.asking);
    const short = (t) => (t.length > 50 ? `${t.slice(0, 50)}…` : t);
    // Said as its answer only when it is one (what they wrote may be about something else).
    const answering = asked && cards.some((c) => c.jot?.answers);
    const row = this.say([answering ? W.answering(short(this.askOf(asked))) : W.willNote, '', ...sortedLines(cards, this.lang).map((l) => `- ${l}`)].join('\n'));
    const acts = this.acts(row,
      btn(W.note, async () => {
        this.done(acts);
        const left = cards.filter((c) => this.desk.ai.includes(c));
        // The to-dos this marks done (not one marked before, on the desk).
        const before = new Set(this.desk.d.nodes.filter((n) => n.from?.to).map((n) => n.id));
        this.desk.keepCards(left);
        this.fly(row, left.filter((c) => !this.desk.ai.includes(c) && c.jot?.about).map((c) => c.jot.about));
        const held = left.filter((c) => this.desk.ai.includes(c)).length;
        this.say(held ? `${W.noted} ${W.held(held)}` : W.noted);
        await this.propose(this.desk.d.nodes.filter((n) => n.from?.kind === 'todo' && n.from.to && !n.from.sent && !before.has(n.id)).map((n) => n.id));
        if (this.current !== asked) return; // (asked on since)
        // Not about what was asked: asked again (more briefly).
        if (asked && !answering && this.queue().some((x) => x.id === asked.id)) { this.again(asked, true); return; }
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
  // (brief: what it asked, without its why and its lines again.)
  again(asked, brief = false) {
    if (!asked || this.early) { if (this.closed) this.closing(this.early); else this.focus(); return; }
    this.passed.delete(asked.id);
    this.total = Math.max(this.total, this.queue().length);
    this.next(brief && this.queue()[0]?.id === asked.id);
  }
  // ---- the end: where it stands, and what to do with it
  async closing(early = false) {
    const W = this.W;
    this.closed = true;
    this.done(this.ending); // (the one said before: as it was then)
    const r = await this.desk.wrapData();
    const mine = thisTimeOf(this.desk.d);
    const row = this.say(closingText({ ...r, later: mine.later.length, early }, this.lang));
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
      this.desk.opts.state ? btn(W.stateNote, async (b) => { b.disabled = true; if (!(await this.stateNote())) b.disabled = false; }) : null,
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
  // Where the topic stands, from all its notes at once: a note of it beside
  // them (made when there is none; one there already: the new one proposed
  // over it, in its red pen review). Its notes are not changed. → whether it was written.
  async stateNote() {
    const W = this.W;
    const wait = this.say(W.writing(0), 'ai wait');
    const t0 = Date.now();
    const tick = setInterval(() => { wait.textContent = W.writing(Math.round((Date.now() - t0) / 1000)); }, 1000);
    let r;
    try { r = await this.desk.opts.state(); } catch (e) { r = { error: e.message }; } finally { clearInterval(tick); wait.remove(); }
    if (r?.error) { this.say(W.notWritten(r.error)); return false; }
    const open = (p) => btn(name(p), () => this.desk.opts.openNote(p, 1), 'ghost');
    try {
      if (!r.exists) {
        const p = await this.desk.opts.writeNote(r.file, r.text);
        const row = this.say(W.stateMade(r.read));
        this.acts(row, open(p));
        this.desk.event('noted', { title: 'Where it stands', text: '', file: p });
        return true;
      }
      const id = await this.desk.opts.proposeNote(r.file, () => r.text, { open: false });
      if (id === false) { this.say(W.stateSame); return true; }
      const row = this.say(W.stateProposed(r.read));
      this.acts(row, open(r.file), ...(this.desk.opts.openReview && id && id !== true ? [btn(W.seeChanges, () => this.desk.opts.openReview(id), 'ghost')] : []));
      return true;
    } catch (e) { this.say(W.notWritten(e.message)); return false; }
  }
  // Red pen reviews, each to open.
  reviews(list, said = '') {
    const row = this.say(said || '→');
    if (this.desk.opts.openReview) this.acts(row, ...list.map((d) => btn(name(d.file), () => this.desk.opts.openReview(d.id), 'ghost')));
  }
}
