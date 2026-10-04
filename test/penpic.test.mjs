// node --test (npm test): the red pen on pictures, public/penpic.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hunksOf } from '../public/track.js';
import { penSource } from '../public/redpen.js';
import { pictureHunks, penPlaces, flowChanges, pictureSummary, PLACE } from '../public/penpic.js';

const BASE = [
  '# Pay', '',                                   // 0-1
  'Some text.', '',                              // 2-3
  '```flow', 'Order -> Pay -> Done', 'Pay -> Fax', '```', '', // 4-8
  '![Login](assets/login.png)', '',              // 9-10
  '```ink', 'box red: 10,10 50x20', '```', '',    // 11-14
  'End.',                                        // 15
].join('\n');

test('changes inside a flow or an ink block are drawn on the picture; the rest stays text', () => {
  const work = BASE.replace('Pay -> Fax', 'Pay -> Retry').replace('box red: 10,10 50x20', 'box red: 10,10 50x20\ntext red: 70,10 Too small').replace('Some text.', 'Some new text.');
  const hunks = hunksOf(BASE, work);
  const pics = pictureHunks(BASE, hunks);
  assert.deepEqual(pics.map((p) => [p.lang, p.start, p.end, p.fresh]), [['flow', 4, 7, false], ['ink', 11, 13, false]]);
  const flow = flowChanges(pics[0]);
  assert.deepEqual(flow.nodes.map((n) => [n.text, n.change]), [['Fax', 'del'], ['Retry', 'add']]);
  assert.deepEqual(flow.edges.map((e) => [e.name, e.change]), [['Pay → Fax', 'del'], ['Pay → Retry', 'add']]);
  assert.equal(pictureSummary(pics[0], pics[0].hunks[0]), '+ Retry · − Fax · arrows +1 −1');
  assert.equal(pictureSummary(pics[1], pics[1].hunks[0]), '+ “Too small”');

  // The note for the red pen: a placeholder each, the text change still marked.
  const placed = penPlaces(BASE, hunks, pics);
  const { text, marks } = penSource(placed.base, placed.hunks);
  assert.ok(text.includes(`${PLACE}0${PLACE}`) && text.includes(`${PLACE}1${PLACE}`));
  assert.ok(!text.includes('```flow') && !text.includes('Retry'), 'no code of the pictures');
  assert.ok(text.includes('![Login](assets/login.png)'), 'the picture the marks are on');
  assert.deepEqual(marks.map((m) => m.picture ?? null), [null, 0, 1]);
  assert.equal(placed.back[placed.base.split('\n').indexOf('End.')], 15);
});

test('a hunk adding a whole flow is one picture, all of it new; a block also changed at its fence stays text', () => {
  const work = BASE.replace('End.', 'End.\n\n```flow\nA -> B\n```');
  const pics = pictureHunks(BASE, hunksOf(BASE, work));
  assert.deepEqual(pics.map((p) => [p.lang, p.fresh]), [['flow', true]]);
  assert.deepEqual(flowChanges(pics[0]).nodes.map((n) => n.change), ['add', 'add']);
  const fence = BASE.replace('```flow\nOrder', '```mermaid\nOrder');
  assert.deepEqual(pictureHunks(BASE, hunksOf(BASE, fence)), []);
});

test('a sketch (an ```ink board, no picture above) is a picture too; plain ink lines alone stay text', () => {
  const base = ['# Meeting', '', '```ink', 'board: 1600x900', 'pen blue: 10,10 40,40', '```', '', '```ink', 'box: 1,1 2x2', '```', ''].join('\n');
  const work = base.replace('pen blue: 10,10 40,40', 'pen blue: 10,10 40,40\ntext red: 50,50 Owner?').replace('box: 1,1 2x2', 'box: 1,1 3x3');
  const pics = pictureHunks(base, hunksOf(base, work));
  assert.deepEqual(pics.map((p) => [p.lang, p.start, p.end, p.fresh]), [['ink', 2, 5, false]]);
  assert.equal(pictureSummary(pics[0], pics[0].hunks[0]), '+ “Owner?”');
  const fresh = pictureHunks(base, hunksOf(base, `${base}\n\`\`\`ink\nboard: 800x600\npen: 1,1 2,2\n\`\`\`\n`));
  assert.deepEqual(fresh.map((p) => [p.lang, p.fresh]), [['ink', true]]);
});
