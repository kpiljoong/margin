// node --test (npm test): keyboard macros kept as a note (public/macrotext.js)
// — MACROS.md read into macro.js steps, and recorded steps written back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStep, stepLine, parseMacros, macroSection, withMacro, MACROS_STARTER } from '../public/macrotext.js';

test('each kind of step, read and written back the same', () => {
  const lines = [
    'type "- [ ] "', 'type "a\\nb \\"c\\""', 'backspace', 'backspace 3', 'delete', 'delete 2', 'erase', 'edit 1 2 "x"',
    'move line-start', 'select word-right', 'move start', 'select all', 'delete-to line-end',
    'find "TODO"', 'find "a.b" case regex 2 at-end', 'replace-all "old" "new" regex',
    'copy', 'cut', 'paste', 'paste "x"', 'undo', 'redo',
    'key Ctrl-k', 'key Cmd-Shift-b', 'key Enter', 'key Alt-s "ß"', 'key Ctrl-SPC', 'key Shift-5 "%"',
    'run Save', 'run Macro: Make it a task',
  ];
  for (const l of lines) assert.equal(stepLine(parseStep(l)), l, l);
  assert.deepEqual(parseStep('type "\uD55C\uAE00"'), { t: 'edit', before: 0, after: 0, text: '\uD55C\uAE00', sel: false });
  assert.deepEqual(parseStep('select word-left'), { t: 'move', how: 'wordLeft', extend: true });
  assert.deepEqual(parseStep('find "x" 3 at-start'), { t: 'find', spec: { query: 'x', caseSensitive: false, regex: false }, k: 3, collapse: 'start' });
  assert.deepEqual(parseStep('key Ctrl-Alt-f'), { t: 'key', key: 'f', code: 'KeyF', shiftKey: false, altKey: true, metaKey: false, ctrlKey: true });
  assert.deepEqual(parseStep('run   Close tab '), { t: 'cmd', label: 'Close tab' });
  assert.deepEqual(parseStep('step {"t":"undo"}'), { t: 'undo' });
});

test('what was recorded comes out as lines (a key that types something else says so)', () => {
  const rec = [
    { t: 'edit', before: 0, after: 0, text: 'hi', sel: true },
    { t: 'key', key: 'å', code: 'KeyA', shiftKey: false, altKey: true, metaKey: false, ctrlKey: false },
    { t: 'key', key: 'Tab', code: 'Tab', shiftKey: true, altKey: false, metaKey: false, ctrlKey: false },
    { t: 'cmd', label: 'Save', run: () => {} },
    { t: 'odd', n: 1 },
  ];
  assert.deepEqual(rec.map(stepLine), ['type "hi"', 'key Alt-a "å"', 'key Shift-Tab', 'run Save', 'step {"t":"odd","n":1}']);
  const back = rec.slice(0, 3).map(stepLine).map(parseStep);
  assert.deepEqual(back.slice(1), rec.slice(1, 3));
});

test('steps that can’t be read say why', () => {
  const bad = {
    'jump 3': /not a step/, 'type hi': /quotes/, 'type "hi': /quotes/, 'move sideways': /not where a caret goes/,
    'backspace x': /not a number/, 'delete-to start': /word-left/, 'find "x" twice': /not one of/, 'key Hyper-k': /not Cmd/,
    'key Minus': /say what/, 'run': /run what/, 'step {"t":"cmd"}': /use run/, 'copy now': /nothing follows/,
  };
  for (const [l, re] of Object.entries(bad)) assert.throws(() => parseStep(l), re, l);
});

test('MACROS.md: each ## with a ```macro block is a macro; the others are said', () => {
  const text = [
    '# Macros', 'About them.', '',
    '## Task', 'Makes a task.', 'Of the line.', '', '```macro', 'move line-start', '# a remark', '', 'type "- [ ] "', '```', '',
    '## No block', 'Nothing here.', '',
    '## Broken', '```macro', 'move line-start', 'fly away', '```',
    '## Other blocks', '```js', '## not a heading', '```', '```macro', 'undo', '```', '```macro', 'redo', '```',
    '## Empty', '~~~macro', '// only a remark', '~~~',
  ].join('\n');
  const { macros, errors } = parseMacros(text);
  assert.deepEqual(macros.map((m) => [m.name, m.steps.map(stepLine), m.doc, m.line]), [
    ['Task', ['move line-start', 'type "- [ ] "'], 'Makes a task. Of the line.', 4],
    ['Other blocks', ['undo'], '', 23],
  ]);
  assert.deepEqual(errors.map((e) => e.line), [15, 21, 33]);
  assert.match(errors[0].msg, /“No block” has no ```macro block/);
  assert.match(errors[1].msg, /“Broken”: .*fly/);
  assert.match(errors[2].msg, /no steps/);
  assert.deepEqual(parseMacros(MACROS_STARTER).errors, []);
  assert.equal(parseMacros(MACROS_STARTER).macros[0].name, 'Make it a task');
});

test('saving one: added at the end, or in place of the one of the same name', () => {
  const steps = [{ t: 'move', how: 'lineStart', extend: false }, { t: 'edit', before: 0, after: 0, text: '> ', sel: false }];
  assert.equal(macroSection('Quote', steps), '## Quote\n\n```macro\nmove line-start\ntype "> "\n```\n');
  const fresh = withMacro('', 'Quote', steps);
  assert.ok(fresh.startsWith('# Macros'));
  assert.deepEqual(parseMacros(fresh).macros.map((m) => m.name), ['Make it a task', 'Quote']);
  const two = withMacro('# Macros\n\n## A\n```macro\nundo\n```\n\n## B\n```macro\nredo\n```\n', 'a', steps, 'Quotes the line.');
  const m = parseMacros(two).macros;
  assert.deepEqual(m.map((x) => [x.name, x.steps.length, x.doc]), [['a', 2, 'Quotes the line.'], ['B', 1, '']]);
  assert.ok(!/\n{3,}/.test(two));
  const added = withMacro('# Macros\n\n## A\n```macro\nundo\n```', 'C', steps);
  assert.deepEqual(parseMacros(added).macros.map((x) => x.name), ['A', 'C']);
});
