// node --test (npm test): what narrowing shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionRange, linesRange } from '../public/narrow.js';

const note = '# Plan\n\nintro\n\n## Monday\n\n- ship\n\n```\n# not a heading\n```\n\n### Detail\n\nmore\n\n## Tuesday\n\n- docs\n';

test('the section under the heading the caret is in, to the next as high', () => {
  const at = (s) => note.indexOf(s);
  const [a, b] = sectionRange(note, at('ship'));
  assert.equal(note.slice(a, b), '## Monday\n\n- ship\n\n```\n# not a heading\n```\n\n### Detail\n\nmore\n');
  const [c, d] = sectionRange(note, at('more'));
  assert.equal(note.slice(c, d), '### Detail\n\nmore\n');
  const [e, f] = sectionRange(note, at('docs'));
  assert.equal(note.slice(e, f), '## Tuesday\n\n- docs\n');
  assert.deepEqual(sectionRange(note, 0), [0, note.length]);
  assert.equal(sectionRange('no heading\n# Later', 3), null);
});

test('a selection: its whole lines', () => {
  const t = 'one\ntwo\nthree\nfour';
  assert.equal(t.slice(...linesRange(t, 5, 10)), 'two\nthree');
  assert.equal(t.slice(...linesRange(t, 4, 8)), 'two'); // ends at the start of "three"
  assert.equal(t.slice(...linesRange(t, 15, 15)), 'four');
});
