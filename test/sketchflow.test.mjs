// node --test (npm test): a sketch read as a flow (public/sketchflow.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sketchToFlow } from '../public/sketchflow.js';
import { parseFlow } from '../public/flow.js';

const sketch = (...lines) => ['board: 1600x900', ...lines].join('\n');

test('boxes with words, arrows between them: a flow down the page', () => {
  const r = sketchToFlow(sketch(
    'box black: 600,40 300x120',
    'text black: 640,80 Order',
    'box black: 600,300 300x120',
    'text black: 640,340 Pay',
    'box black: 600,560 300x120',
    'text black: 640,600 Ship',
    'arrow black: 750,170 -> 750,290',
    'arrow black: 750,430 -> 750,550',
    'pen black: 10,10 20,20 30,10',
  ));
  assert.equal(r.text, 'Order -> Pay -> Ship');
  assert.deepEqual([r.steps, r.arrows, r.unnamed, r.left], [3, 2, 0, { pen: 1, num: 0, arrows: 0 }]);
});

test('across the page, a question with labelled ways, words on their own, a box without words', () => {
  const r = sketchToFlow(sketch(
    'box: 100,300 260x120',
    'text black: 130,340 Signed in?',
    'box: 600,100 260x120',
    'text black: 630,140 Dashboard',
    'box: 600,500 260x120',
    'arrow: 370,330 -> 590,170',
    'text black: 440,180 yes',
    'arrow: 370,390 -> 590,560',
    'text black: 470,520 no',
    'text black: 1100,580 \uB85C\uADF8\uC778 \uD654\uBA74',
    'arrow: 870,560 -> 1080,600',
    'arrow: 1300,800 -> 1500,850',
  ));
  assert.equal(r.text, ['direction: right', 'Signed in? -(yes)-> Dashboard', 'Signed in? -(no)-> Box 1 -> \uB85C\uADF8\uC778 \uD654\uBA74'].join('\n'));
  assert.deepEqual([r.steps, r.arrows, r.unnamed, r.left.arrows], [4, 3, 1, 1]);
  const f = parseFlow(r.text);
  assert.deepEqual(f.nodes.map((n) => n.text), ['Signed in?', 'Dashboard', 'Box 1', '\uB85C\uADF8\uC778 \uD654\uBA74']);
  assert.deepEqual(f.edges.map((e) => e.label), ['yes', 'no', '']);
});

test('names a flow can hold; the same words twice are two steps; nothing to read', () => {
  const r = sketchToFlow(sketch(
    'box: 100,100 400x100',
    'text: 120,120 A -> B: later',
    'box: 100,400 400x100',
    'text: 120,420 Check',
    'box: 100,700 400x100',
    'text: 120,720 Check',
    'arrow: 300,210 -> 300,390',
    'arrow: 300,510 -> 300,690',
  ));
  assert.equal(r.text, 'A B: later -> Check -> Check 2');
  assert.equal(sketchToFlow(sketch('pen: 1,1 5,5', 'arrow: 10,10 -> 50,50')), null);
});
