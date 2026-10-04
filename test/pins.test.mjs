// node --test (npm test): which picture a comment on a drawing is on
// (public/pins.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedFigure, pinLabel } from '../public/pins.js';

const figs = [
  { start: 4, end: 7, on: 'flow', boxes: ['Order', 'Pay'] },
  { start: 10, end: 13, on: 'picture' },
  { start: 16, end: 20, on: 'sketch' },
  { start: 24, end: 27, on: 'flow', boxes: ['Pay', 'Ship'] },
];

test('the picture whose lines hold the comment’s words, of its kind', () => {
  assert.equal(pinnedFigure({ on: 'flow', box: 'Pay' }, figs, 5), 0);
  assert.equal(pinnedFigure({ on: 'flow', box: 'Pay' }, figs, 25), 3);
  assert.equal(pinnedFigure({ on: 'picture', x: 1, y: 2 }, figs, 10), 1);
  assert.equal(pinnedFigure({ on: 'sketch', x: 1, y: 2 }, figs, 17), 2);
  // Words in another kind of picture, or in none.
  assert.equal(pinnedFigure({ on: 'sketch', x: 1, y: 2 }, figs, 11), -1);
  assert.equal(pinnedFigure({ on: 'picture', x: 1, y: 2 }, figs, 2), -1);
  // Gone from the text: the line it was written on.
  assert.equal(pinnedFigure({ on: 'sketch', x: 1, y: 2 }, figs, null, 18), 2);
  assert.equal(pinnedFigure({ on: 'picture', x: 1, y: 2 }, figs, null, 30), -1);
  assert.equal(pinnedFigure(undefined, figs, 5), -1);
});

test('a box’s comment stays with the nearest picture holding the box', () => {
  // Its name said in the text: the nearest flow with that box.
  assert.equal(pinnedFigure({ on: 'flow', box: 'Pay' }, figs, 22, 22), 3);
  assert.equal(pinnedFigure({ on: 'flow', box: 'Order' }, figs, 22, 22), 0);
  assert.equal(pinnedFigure({ on: 'flow', box: 'Gone' }, figs, 5, 5), -1);
});

test('what it is on, in words', () => {
  assert.equal(pinLabel({ on: 'flow', box: 'Pay' }), 'on the box “Pay”');
  assert.equal(pinLabel({ on: 'sketch', x: 1, y: 2 }), 'on the sketch');
  assert.equal(pinLabel(null), '');
});
