// node --test (npm test): your own leader keys (LEADER.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLeaderKeys, applyLeaderKeys, LEADER_STARTER } from '../public/leaderkeys.js';

const TREE = [
  { key: 'f', label: 'files', items: [{ key: 'f', label: 'Find a file…', run: () => 'ff' }, { key: 'n', label: 'New note…', run: () => 'fn' }] },
  { key: 'k', label: 'Keyboard shortcuts…', run: () => 'k' },
];
const COMMANDS = { 'open today’s journal note': { run: () => 'journal' }, 'recipe: summarize': { label: 'Summarize', run: () => 'sum' } };
const resolve = (name) => COMMANDS[name.toLowerCase()] || null;

test('rules from the note: binds, groups, keys taken away; bad lines say why', () => {
  const { rules, errors } = parseLeaderKeys([
    '# Leader keys', 'Some text with `o j` inline is not a rule.',
    '- `o` +mine', '- `o j` Open today’s journal note — my journal', '* `k` off', '- `SPC` off',
    '- `ab` Something', '- `x`', '```', '- `z` off', '```', '- `A` Recipe: Summarize',
  ].join('\n'));
  assert.deepEqual(rules.map((r) => [r.keys.join(' '), r.kind, r.name || r.label || '', r.line]), [
    ['o', 'group', 'mine', 3], ['o j', 'bind', 'Open today’s journal note', 4], ['k', 'off', '', 5], ['SPC', 'off', '', 6], ['A', 'bind', 'Recipe: Summarize', 12],
  ]);
  assert.deepEqual(errors.map((e) => e.line), [7, 8]);
  assert.match(errors[0].msg, /“ab” is not a key/);
});

test('applied to the menu: added, changed, taken away; the default left as it was', () => {
  const { rules } = parseLeaderKeys('- `o` +mine\n- `o j` Open today’s journal note\n- `k` off\n- `f n` Recipe: Summarize\n- `q q` Open today’s journal note');
  const { tree, errors } = applyLeaderKeys(TREE, rules, resolve);
  assert.deepEqual(errors, []);
  assert.deepEqual(tree.map((x) => x.key), ['f', 'o', 'q']);
  const o = tree.find((x) => x.key === 'o');
  assert.equal(o.label, 'mine');
  assert.equal(o.items[0].run(), 'journal');
  assert.equal(o.items[0].custom, 2);
  assert.equal(o.items[0].label, 'Open today’s journal note');
  const fn = tree[0].items.find((x) => x.key === 'n');
  assert.equal(fn.run(), 'sum');
  assert.equal(fn.cmd, 'Recipe: Summarize');
  // A group made on the way is named by its key.
  assert.equal(tree.find((x) => x.key === 'q').label, 'q');
  assert.equal(TREE.length, 2);
  assert.equal(TREE[0].items[1].run(), 'fn');
});

test('rules that can’t be followed are left out with a warning', () => {
  const { rules } = parseLeaderKeys('- `z` No such command\n- `k x` Open today’s journal note\n- `y` off\n- `f f` +finding');
  const { tree, errors } = applyLeaderKeys(TREE, rules, resolve);
  assert.deepEqual(errors.map((e) => e.line), [1, 2, 3]);
  assert.match(errors[1].msg, /`k` runs a command/);
  assert.equal(tree.find((x) => x.key === 'k').run(), 'k');
  // A command turned into a group.
  assert.deepEqual(tree[0].items[0].items, []);
});

test('the starter note is followed without warnings', () => {
  const { rules, errors } = parseLeaderKeys(LEADER_STARTER);
  assert.deepEqual(errors, []);
  assert.deepEqual(rules.map((r) => r.keys.join(' ')), ['o', 'o j', 'o t']);
});
