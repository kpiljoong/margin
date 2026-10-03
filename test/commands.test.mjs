import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzy, rankCommands, used } from '../public/commands.js';

const cmds = [
  { name: 'New note' },
  { name: 'Editor: format table', ctx: ['file'] },
  { name: 'Review: Apply the picked changes', ctx: ['review'] },
  { name: 'Theme: choose…' },
  { name: 'Recipe: Tidy' },
];
const names = (r) => r.map((x) => x.cmd.name);

test('fuzzy: letters in order, word starts count more', () => {
  assert.equal(fuzzy('xyz', 'New note'), null);
  assert.ok(fuzzy('nn', 'New note').score > fuzzy('ee', 'New note').score);
  assert.deepEqual(fuzzy('ft', 'Editor: format table').idx, [8, 13]);
});

test('without a query: the buffer’s commands first, then recent ones, then the rest in order', () => {
  const r = rankCommands(cmds, '', { recent: ['Recipe: Tidy', 'Theme: choose…'], context: 'review' });
  assert.deepEqual(names(r), ['Review: Apply the picked changes', 'Recipe: Tidy', 'Theme: choose…', 'New note', 'Editor: format table']);
});

test('with a query: by match, lifted for recent use and for the buffer in view', () => {
  const plain = rankCommands(cmds, 'e', {});
  assert.ok(plain.length >= 4);
  const lifted = rankCommands(cmds, 'e', { recent: ['Theme: choose…'] });
  assert.equal(lifted[0].cmd.name, 'Theme: choose…');
  const here = rankCommands(cmds, 'e', { context: 'file' });
  assert.equal(here[0].cmd.name, 'Editor: format table');
  assert.deepEqual(names(rankCommands(cmds, 'tidy')), ['Recipe: Tidy']);
});

test('used: most recent first, once, at most max', () => {
  assert.deepEqual(used(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(used(['a', 'b'], 'c', 2), ['c', 'a']);
});
