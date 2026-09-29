import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, eventKeys, unusable, effectiveKeys, conflicts, customOnly, keyLabel } from '../public/keys.js';

const DEFAULTS = JSON.parse(fs.readFileSync(new URL('../public/shortcuts.json', import.meta.url), 'utf8'));
const ev = (code, m = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...m });

test('keys are written one way', () => {
  assert.equal(normalize('shift+cmd+p', true), 'CmdOrCtrl+Shift+P');
  assert.equal(normalize('Control+Alt+N', true), 'Ctrl+Alt+N');
  assert.equal(normalize('Control+Alt+N', false), 'CmdOrCtrl+Alt+N');
  assert.equal(normalize('CmdOrCtrl+Shift+Return', true), 'CmdOrCtrl+Shift+Enter');
  assert.equal(normalize('alt+up', true), 'Alt+Up');
  assert.equal(normalize('f2', true), 'F2');
  assert.equal(normalize('', true), '');
  assert.equal(normalize('Hyper+K', true), null);
  assert.equal(normalize('CmdOrCtrl+Foo', true), null);
});

test('every default is a usable, distinct shortcut', () => {
  for (const mac of [true, false]) {
    const keys = effectiveKeys(DEFAULTS, {}, mac);
    for (const d of DEFAULTS) {
      assert.ok(keys[d.id], `${d.id} has keys`);
      assert.equal(unusable(keys[d.id], mac), null, `${d.id} ${keys[d.id]}`);
      assert.deepEqual(conflicts(DEFAULTS, keys, d.id, keys[d.id], mac), [], `${d.id} clashes`);
    }
    assert.equal(new Set(DEFAULTS.map((d) => d.id)).size, DEFAULTS.length);
  }
});

test('a key press is read by its place on the keyboard', () => {
  // With a Korean input source, e.key is a Hangul letter (U+3154) but e.code is still KeyP.
  assert.equal(eventKeys({ ...ev('KeyP', { metaKey: true, shiftKey: true }), key: '\u3154' }, true), 'CmdOrCtrl+Shift+P');
  assert.equal(eventKeys(ev('KeyN', { ctrlKey: true, altKey: true }), true), 'Ctrl+Alt+N');
  assert.equal(eventKeys(ev('KeyN', { ctrlKey: true, altKey: true }), false), 'CmdOrCtrl+Alt+N');
  assert.equal(eventKeys(ev('BracketLeft', { metaKey: true }), true), 'CmdOrCtrl+[');
  assert.equal(eventKeys(ev('ArrowDown', { altKey: true }), true), 'Alt+Down');
  assert.equal(eventKeys(ev('ShiftLeft', { shiftKey: true }), true), null);
  assert.equal(eventKeys(ev('KeyK', { metaKey: true }), false), null);
  // No code (a script's event): by the character.
  assert.equal(eventKeys({ ...ev('', { metaKey: true }), key: ',' }, true), 'CmdOrCtrl+,');
  assert.equal(eventKeys({ ...ev('', { altKey: true }), key: 'ArrowUp' }, true), 'Alt+Up');
});

test('what cannot be a shortcut', () => {
  assert.match(unusable('Shift+K', true), /Add/);
  assert.match(unusable('K', true), /Add/);
  assert.equal(unusable('F5', true), null);
  assert.match(unusable('CmdOrCtrl+C', true), /Copy/);
  assert.match(unusable('Ctrl+Z', false), /Undo/);
  assert.equal(unusable('CmdOrCtrl+H', false), null); // only the Mac hides with ⌘H
});

test('conflicts, and what is stored', () => {
  const keys = effectiveKeys(DEFAULTS, { delegate: 'CmdOrCtrl+J', runs: '' }, true);
  assert.equal(keys.delegate, 'CmdOrCtrl+J');
  assert.equal(keys.runs, '');
  assert.deepEqual(conflicts(DEFAULTS, keys, 'save', 'cmd+j', true), ['delegate']);
  // The find bar's keys only act while finding: no clash with the app's.
  assert.deepEqual(conflicts(DEFAULTS, keys, 'find-prev', 'CmdOrCtrl+Shift+G', true), []);
  assert.deepEqual(conflicts(DEFAULTS, keys, 'git', 'CmdOrCtrl+G', true), []);
  assert.deepEqual(conflicts(DEFAULTS, keys, 'bold', 'CmdOrCtrl+G', true), ['find-next']);
  assert.deepEqual(customOnly(DEFAULTS, { ...keys, save: 'CmdOrCtrl+S' }, true), { delegate: 'CmdOrCtrl+J', runs: '' });
  // A stored value that is not a shortcut falls back to the default.
  assert.equal(effectiveKeys(DEFAULTS, { save: 'nonsense+' }, true).save, 'CmdOrCtrl+S');
});

test('labels', () => {
  assert.equal(keyLabel('CmdOrCtrl+Shift+P', true), '⌘⇧P');
  assert.equal(keyLabel('Ctrl+Alt+N', true), '⌃⌥N');
  assert.equal(keyLabel('CmdOrCtrl+Alt+Down', true), '⌘⌥↓');
  assert.equal(keyLabel('CmdOrCtrl+Shift+Enter', false), 'Ctrl+Shift+Enter');
  assert.equal(keyLabel('Alt+Up', false), 'Alt+↑');
  assert.equal(keyLabel('', true), '');
});
