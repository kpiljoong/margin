// node --test (npm test): leader-key menu keys (public/leader.js) go by the
// place on the keyboard, so they work in any input source (한글 too).
import test from 'node:test';
import assert from 'node:assert/strict';
import { menuKey } from '../public/leader.js';

test('menu keys come from event.code, not the character typed', () => {
  assert.equal(menuKey({ code: 'KeyF', key: 'ㄹ' }), 'f');
  assert.equal(menuKey({ code: 'KeyG', key: 'G', shiftKey: true }), 'G');
  assert.equal(menuKey({ code: 'Digit3', key: '3' }), '3');
  assert.equal(menuKey({ code: 'Space', key: ' ' }), 'SPC');
  assert.equal(menuKey({ code: 'Comma', key: ',' }), ',');
  assert.equal(menuKey({ code: 'BracketLeft', key: '[' }), '[');
  assert.equal(menuKey({ code: 'Enter', key: 'Enter' }), null);
  assert.equal(menuKey({ key: 'f' }), null);
});
