import test from 'node:test';
import assert from 'node:assert/strict';
import { expandRange } from '../public/expand.js';

// Expand from the caret (| in the text) until the whole note, step by step.
function steps(marked) {
  const at = marked.indexOf('|');
  const text = marked.replace('|', '');
  const out = [];
  let r = [at, at];
  for (let n = 0; n < 30; n++) {
    r = expandRange(text, r[0], r[1]);
    if (!r) break;
    out.push(text.slice(r[0], r[1]));
  }
  return out;
}

test('a word, its marks, the sentence, the line, the paragraph, the note', () => {
  const s = steps('Intro.\n\nFirst one. A **bo|ld** word here. Last.\nNext line.\n');
  assert.deepEqual(s.slice(0, 6), ['bold', '**bold**', 'A **bold** word here.', 'First one. A **bold** word here. Last.', 'First one. A **bold** word here. Last.\nNext line.', 'Intro.\n\nFirst one. A **bold** word here. Last.\nNext line.\n']);
});

test('brackets and links, inside then with them', () => {
  const s = steps('See [[No|tes#Part]] now');
  assert.deepEqual(s.slice(0, 5), ['Notes', 'Notes#Part', '[Notes#Part]', '[[Notes#Part]]', 'See [[Notes#Part]] now']);
  const t = steps('a (b `c|d` e) f');
  assert.deepEqual(t.slice(0, 5), ['cd', '`cd`', 'b `cd` e', '(b `cd` e)', 'a (b `cd` e) f']);
});

test('a list item: its text, the line, with what is under it, the whole list', () => {
  const text = '# H\n\n- one\n- tw|o\n  - sub\n- three\n';
  assert.deepEqual(steps(text), ['two', '- two', '- two\n  - sub', '- one\n- two\n  - sub\n- three', '# H\n\n- one\n- two\n  - sub\n- three', text.replace('|', '')]);
});

test('sections: the text under the heading, with the heading, the section around it', () => {
  const text = '# Top\n\nintro\n\n## A\n\nalpha |text\n\n## B\n\nbeta\n';
  const s = steps(text);
  assert.ok(s.includes('alpha text'));
  assert.ok(s.includes('## A\n\nalpha text'));
  assert.ok(s.includes('intro\n\n## A\n\nalpha text\n\n## B\n\nbeta'));
  assert.ok(s.includes('# Top\n\nintro\n\n## A\n\nalpha text\n\n## B\n\nbeta'));
  const i = s.indexOf('## A\n\nalpha text');
  assert.ok(i > s.indexOf('alpha text') && i < s.indexOf('# Top\n\nintro\n\n## A\n\nalpha text\n\n## B\n\nbeta'));
});

test('a code block: its code, then with the fences; a heading inside is not one', () => {
  const s = steps('x\n\n```js\n# not a heading\nlet |a = 1;\n```\n\ny\n');
  assert.ok(s.includes('# not a heading\nlet a = 1;'));
  assert.ok(s.includes('```js\n# not a heading\nlet a = 1;\n```'));
});

test('Korean words, and every step is larger than the one before', () => {
  const s = steps('회의 메모: 결정|사항 정리. 다음 주.');
  assert.equal(s[0], '결정사항');
  for (let i = 1; i < s.length; i++) assert.ok(s[i].length > s[i - 1].length);
});
