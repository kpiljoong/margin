// node --test (npm test): how far a change reaches into your own words
// (lib/tiers.js) — a label for the review, decided by rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hunkTier, tiersOf, agentLines, ticked } = require('../lib/tiers.js');
const hunk = (removed, added) => ({ removed, added, baseStart: 0, baseEnd: removed.length, newStart: 0 });

test('one hunk: added, blank, ticked, an agent\'s, rewritten, deleted, locked', () => {
  assert.deepEqual(hunkTier(hunk([], ['new line'])), { tier: 1, why: 'added' });
  assert.deepEqual(hunkTier(hunk(['', '  '], ['new line'])), { tier: 1, why: 'blank' });
  assert.deepEqual(hunkTier(hunk(['- [ ] call Mina', '1. [ ] book'], ['- [x] call Mina', '1. [X] book'])), { tier: 1, why: 'ticked' });
  assert.deepEqual(hunkTier(hunk(['- [ ] call Mina'], ['- [x] call Mina later'])), { tier: 2, why: 'rewritten' }, 'ticked and changed is not only ticked');
  assert.deepEqual(hunkTier(hunk(['- [x] done'], ['- [ ] done'])), { tier: 2, why: 'rewritten' }, 'unticking takes something away');
  const agent = agentLines([{ lines: ['  The agent wrote this. '] }, { lines: ['And this.'] }]);
  assert.deepEqual(hunkTier(hunk(['The agent wrote this.', '', 'And this.'], ['Better.']), { agent }), { tier: 1, why: 'agent' });
  assert.deepEqual(hunkTier(hunk(['The agent wrote this.', 'I wrote this.'], ['Better.']), { agent }), { tier: 2, why: 'rewritten' });
  assert.deepEqual(hunkTier(hunk(['I wrote this.'], ['I wrote that.'])), { tier: 2, why: 'rewritten' });
  assert.deepEqual(hunkTier(hunk(['I wrote this.'], [''])), { tier: 2, why: 'deleted' });
  assert.deepEqual(hunkTier(hunk([], ['new']), { locked: true }), { tier: 3, why: 'locked' });
  assert.equal(ticked('* [ ] a', '* [x] a'), true);
  assert.equal(ticked('[ ] a', '[x] a'), false, 'only in a list');
});

test('a change: its highest tier, each hunk, and the counts', () => {
  assert.deepEqual(tiersOf({ status: 'added', hunks: null }), { tier: 0, why: 'new', hunks: [], counts: [1, 0, 0, 0] });
  assert.equal(tiersOf({ status: 'deleted' }).tier, 2);
  assert.equal(tiersOf({ status: 'modified', binary: true }).why, 'whole');
  const t = tiersOf({ status: 'modified', hunks: [hunk([], ['a']), hunk(['mine'], ['theirs']), hunk(['- [ ] x'], ['- [x] x'])], locked: [2] });
  assert.equal(t.tier, 3);
  assert.deepEqual(t.hunks.map((x) => x.tier), [1, 2, 3]);
  assert.deepEqual(t.counts, [0, 1, 1, 1]);
  assert.equal(tiersOf({ status: 'modified', hunks: [hunk([], ['a'])] }).tier, 1);
});
