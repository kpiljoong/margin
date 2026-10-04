// node --test (npm test): reviewing a run that writes LEADER.md, RECIPES.md
// or MACROS.md — the lines it brings that can't be read, and what it does to
// the keys (public/commandcheck.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCommandNotes } from '../public/commandcheck.js';

const tree = [
  { key: 'n', label: 'narrow', items: [{ key: 'n', label: 'Narrow', cmd: 'Narrow to this section' }, { key: 'w', label: 'Widen', cmd: 'Widen: show the whole note' }] },
  { key: 'k', label: 'Keyboard shortcuts…' },
];
const known = (n) => ['save', 'widen: show the whole note', 'narrow to this section', 'keyboard shortcuts'].includes(n.toLowerCase().replace(/…$/, ''));

test('what a run brings to the keys: new ones, one replaced, a group renamed, one taken away', () => {
  const before = { 'LEADER.md': '- `o j` Save\n' };
  const after = {
    'LEADER.md': '- `o j` Save\n- `n` +view\n- `n SPC` Widen: show the whole note\n- `n w` Save\n- `k` off\n- `o t` Macro: Quote\n',
    'MACROS.md': '## Quote\n```macro\ntype "> "\nrun Save\n```\n',
  };
  const r = checkCommandNotes({ after, before, tree, known });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.keys, [
    { keys: ['n'], line: 2, what: '+view', rename: 'narrow' },
    { keys: ['n', 'SPC'], line: 3, what: 'Widen: show the whole note' },
    { keys: ['n', 'w'], line: 4, what: 'Save', was: 'Widen: show the whole note' },
    { keys: ['k'], line: 5, off: true, was: 'Keyboard shortcuts…' },
    { keys: ['o', 't'], line: 6, what: 'Macro: Quote' },
  ]);
});

test('lines that can’t be read, and names that run nothing — only the run’s own', () => {
  const before = { 'LEADER.md': '- `z` Nothing at all\n' };
  const after = {
    'LEADER.md': '- `z` Nothing at all\n- `o q` Macro: Missing\n- `o r` Recipe: Mine\n- `o s` Recipe: Summarize\n',
    'RECIPES.md': '## Mine\nscope: everywhere\n\nDo it.\n',
    'MACROS.md': '## Two\n```macro\nmove down\nrun Fly\nrun Macro: Two\n```\n## Bad\n```macro\njump\n```\n',
  };
  const r = checkCommandNotes({ after, before, tree, known });
  assert.deepEqual(r.problems.map((p) => [p.file, p.line]), [['LEADER.md', 2], ['MACROS.md', 4], ['MACROS.md', 9], ['RECIPES.md', 2]]);
  assert.match(r.problems[0].msg, /Macro: Missing/);
  assert.match(r.problems[1].msg, /“Two” runs “Fly”/);
  assert.ok(!r.problems.some((p) => /Nothing at all/.test(p.msg)), 'a problem there before is not the run’s');
});
