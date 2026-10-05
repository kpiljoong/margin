import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXywh, rectFrom, relPath, linkTarget, regionsOf, threadOf, regionNote, xywh } from '../public/regions.js';

test('parseXywh: a part a link names, or null', () => {
  assert.deepEqual(parseXywh('assets/shot.png#xywh=120,80,300,140'), [120, 80, 300, 140]);
  assert.deepEqual(parseXywh('/api/raw?path=a.png&t=x#xywh=pixel:1,2,3,4'), [1, 2, 3, 4]);
  assert.equal(parseXywh('shot.png'), null);
  assert.equal(parseXywh('shot.png#xywh=1,2,0,4'), null);
  assert.equal(parseXywh('shot.png#xywh=percent:1,2,3,4'), null);
  assert.equal(xywh([1.4, 2.6, -3, 4]), '1,3,0,4');
});

test('rectFrom: corner to corner, either way, kept inside the picture; too small is nothing', () => {
  assert.deepEqual(rectFrom({ x: 50, y: 40 }, { x: 10, y: 10 }, 100, 100), [10, 10, 40, 30]);
  assert.deepEqual(rectFrom({ x: -20, y: 90 }, { x: 30, y: 300 }, 100, 100), [0, 90, 30, 10]);
  assert.equal(rectFrom({ x: 10, y: 10 }, { x: 13, y: 40 }, 100, 100), null);
});

test('relPath and linkTarget: from a note to a picture, escaped for a Markdown link', () => {
  assert.equal(relPath('trip/notes.md', 'trip/assets/shot.png'), 'assets/shot.png');
  assert.equal(relPath('trip/sub/a.md', 'trip/assets/shot.png'), '../assets/shot.png');
  assert.equal(relPath('a.md', 'pics/b.png'), 'pics/b.png');
  assert.equal(relPath('x/y/a.md', 'z.png'), '../../z.png');
  assert.equal(linkTarget('my pics/a (1).png'), 'my%20pics/a%20%281%29.png');
  assert.equal(decodeURI(linkTarget('\uc5ec\ud589/a.png')), '\uc5ec\ud589/a.png');
});

const mark = (id, rect, extra = {}) => ({ id, type: 'text', text: `about ${id}`, x: 0, y: 0, width: 10, height: 10, from: { file: 'p.png', kind: 'region', rect, ...extra } });

test('regionsOf and threadOf: the marks of a picture in reading order; what a mark became', () => {
  const nodes = [mark('b', [50, 10, 5, 5]), mark('a', [10, 10, 5, 5]), mark('c', [0, 90, 5, 5], { noted: 'n.md' }), { ...mark('x', [0, 0, 5, 5]), from: { file: 'q.png', kind: 'region', rect: [0, 0, 5, 5] } },
    { id: 'ans', type: 'text', text: 'yes', from: { file: 'p.png', kind: 'answer', of: 'c' } }];
  assert.deepEqual(regionsOf(nodes, 'p.png').map((n) => n.id), ['a', 'b', 'c']);
  const t = threadOf(nodes, nodes[2]);
  assert.deepEqual([t.answers.map((n) => n.id), t.note], [['ans'], 'n.md']);
});

test('regionNote: the part, what was written (a question as one), the answers, the source', () => {
  const md = regionNote({ notePath: 'trip/Budget check.md', image: 'trip/assets/shot 1.png', rect: [10, 20, 30, 40], text: 'Is the total right?\nIt looks low.', answers: ['It adds up to 410.', ' '], desk: 'trip/trip desk.canvas' });
  assert.equal(md, [
    '# Is the total right?',
    '',
    '![shot 1](assets/shot%201.png#xywh=10,20,30,40)',
    '',
    '> [!question] Is the total right?',
    '> It looks low.',
    '',
    'It adds up to 410.',
    '',
    'Source: [shot 1.png](assets/shot%201.png#xywh=10,20,30,40), marked on [trip desk](trip%20desk.canvas).',
    '',
  ].join('\n'));
  assert.match(regionNote({ notePath: 'n.md', image: 'p.png', rect: [1, 2, 3, 4], text: '' }), /^# p, marked\n\n!\[p\]\(p\.png#xywh=1,2,3,4\)\n\nSource: \[p\.png\]\(p\.png#xywh=1,2,3,4\)\.\n$/);
});
