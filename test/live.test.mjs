// node --test (npm test): the live margin (public/live.js, lib/live.js) — a
// line's chip by rule, its date, the model's reply as it streams, and the
// line the note gets when the minutes are kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { wanted, ruleOf, dueOf, parseReply, keptLine, keepEdit, quantile } from '../public/live.js';

const require = createRequire(import.meta.url);
const server = require('../lib/live.js');
const MON = new Date(2026, 9, 12); // Monday, October 12, 2026

test('ruleOf: a chip at once, before any model', () => {
  assert.equal(ruleOf('-> go w/ 20th', MON).kind, 'decision');
  assert.equal(ruleOf('press kit?? bob unsure', MON).kind, 'question');
  assert.deepEqual(ruleOf('ann: survey thurs', MON), { kind: 'todo', fixed: false, owner: 'ann', due: '2026-10-15' });
  assert.deepEqual(ruleOf('- [ ] Draft the notes @bob', MON), { kind: 'todo', fixed: true, owner: 'bob', due: null });
  assert.equal(ruleOf('> [!question] A press kit?', MON).fixed, true);
  assert.equal(ruleOf('beta 40 ppl, 92% done', MON).kind, 'note');
  assert.equal(ruleOf('\uCD9C\uC2DC\uC77C 20\uC77C\uB85C \uACB0\uC815', MON).kind, 'decision');
  assert.equal(ruleOf('\uBBFC\uC218: \uBAA9\uC694\uC77C\uAE4C\uC9C0 \uC124\uBB38 \uBCF4\uB0B4\uAE30', MON).due, '2026-10-15');
});

test('dueOf: the next such weekday, tomorrow, a month/day', () => {
  assert.equal(dueOf('by friday', MON), '2026-10-16');
  assert.equal(dueOf('next mon', MON), '2026-10-19');
  assert.equal(dueOf('tomorrow', MON), '2026-10-13');
  assert.equal(dueOf('due 10/30', MON), '2026-10-30');
  assert.equal(dueOf('due 1/5', MON), '2027-01-05');
  assert.equal(dueOf('2026-11-02', MON), '2026-11-02');
  assert.equal(dueOf('this month', MON), null);
});

test('parseReply: the head once its bracket closes, then the sentence (both sides)', () => {
  for (const parse of [parseReply, server.parseReply]) {
    assert.deepEqual(parse('[to'), { head: false, sentence: '' });
    assert.deepEqual(parse('[todo @bob 2026-10-15] Bob drafts'), { head: true, kind: 'todo', owner: 'bob', due: '2026-10-15', sentence: 'Bob drafts' });
    assert.equal(parse('[decision] We launch on October 20.').sentence, 'We launch on October 20.');
    assert.equal(parse('[whatever] Hi').kind, null);
    assert.equal(parse('[todo @bob] Bob drafts the notes; [todo @mina] Mina reviews').sentence, 'Bob drafts the notes; Mina reviews');
    assert.equal(parse('[todo @bob] Bob drafts the notes,\n[todo @mina] Mina reviews').sentence, 'Bob drafts the notes, Mina reviews');
    assert.equal(parse('No head at all.').sentence, 'No head at all.');
  }
});

test('keptLine and keepEdit: the line as the meeting writes it, a callout apart', () => {
  assert.equal(keptLine({ kind: 'todo', sentence: 'Send the beta survey.', owner: 'ann', due: '2026-10-15' }), '- [ ] Send the beta survey. @ann \u{1F4C5} 2026-10-15');
  assert.equal(keptLine({ kind: 'decision', sentence: ' We  launch on the 20th. ' }), '> [!decision] We launch on the 20th.');
  assert.equal(keptLine({ kind: 'note', sentence: 'Beta is at 92%.' }), 'Beta is at 92%.');
  const text = '## Launch (5m)\n20th? mkt ok\n-> go w/ 20th\npress kit??\n';
  const e = keepEdit(text, 2, { kind: 'decision', sentence: 'We launch on October 20.' });
  const after = text.slice(0, e.from) + e.insert + text.slice(e.to);
  assert.equal(after, '## Launch (5m)\n20th? mkt ok\n\n> [!decision] We launch on October 20.\n\npress kit??\n');
  const t = keepEdit('a\n  ann: survey thurs\n', 1, { kind: 'todo', sentence: 'Send the survey', owner: 'ann' });
  assert.equal(t.insert, '  - [ ] Send the survey @ann');
});

test('keepEdit: the cursor after the kept line, not in its middle', () => {
  const D = { kind: 'decision', sentence: 'We launch on October 20.' };
  const apply = (text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to);
  const mark = (text, e) => { const a = apply(text, e); return a.slice(0, e.caret) + '|' + a.slice(e.caret); };
  // On the line itself, at its end: the end of the kept sentence.
  const one = '## Launch\nmkt ok\n-> go w/ 20th';
  assert.equal(mark(one, keepEdit(one, 2, D, one.length)), '## Launch\nmkt ok\n\n> [!decision] We launch on October 20.|');
  // On the empty line under it: a blank line between, then the cursor.
  const two = '## Launch\n-> go w/ 20th\n\n## Next';
  assert.equal(mark(two, keepEdit(two, 1, D, two.indexOf('\n\n') + 1)), '## Launch\n\n> [!decision] We launch on October 20.\n\n|\n## Next');
  // A to-do: the cursor at its end, the date included.
  const three = 'ann: survey thurs';
  const t = keepEdit(three, 0, { kind: 'todo', sentence: 'Send the survey', owner: 'ann', due: '2026-10-15' }, 5);
  assert.equal(mark(three, t), '- [ ] Send the survey @ann \u{1F4C5} 2026-10-15|');
  // Above the line: where it was.
  assert.equal(keepEdit(one, 2, D, 3).caret, 3);
});

test('wanted and quantile', () => {
  assert.equal(wanted('## Status (5m)'), false);
  assert.equal(wanted('Previous meeting: [[Weekly 2026-10-05]]'), false);
  assert.equal(wanted('   '), false);
  assert.equal(wanted('ok go'), true);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5.5);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
  assert.equal(quantile([], 0.5), null);
});
