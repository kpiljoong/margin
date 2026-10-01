import test from 'node:test';
import assert from 'node:assert/strict';
import { linkAt } from '../public/links.js';

test('a [[link]] is found from anywhere on it, with its section, without its label', () => {
  const line = 'See [[Plan#Next steps|the plan]] today';
  assert.deepEqual(linkAt(line, 4), { kind: 'wiki', target: 'Plan#Next steps' });
  assert.deepEqual(linkAt(line, 20), { kind: 'wiki', target: 'Plan#Next steps' });
  assert.deepEqual(linkAt(line, 32), { kind: 'wiki', target: 'Plan#Next steps' });
  assert.equal(linkAt(line, 2), null);
  assert.equal(linkAt(line, 34), null);
  assert.deepEqual(linkAt('![[sketch.excalidraw]]', 3), { kind: 'wiki', target: 'sketch.excalidraw' });
});

test('Markdown links and images, and bare addresses', () => {
  assert.deepEqual(linkAt('a [doc](../x/my%20note.md#part) b', 5), { kind: 'md', target: '../x/my%20note.md#part', image: false });
  assert.deepEqual(linkAt('![alt](assets/a.png "t")', 1), { kind: 'md', target: 'assets/a.png', image: true });
  assert.deepEqual(linkAt('go to https://example.com/a?b=1. ok', 10), { kind: 'url', target: 'https://example.com/a?b=1' });
  assert.deepEqual(linkAt('<https://x.org/y>', 3), { kind: 'url', target: 'https://x.org/y' });
  assert.deepEqual(linkAt('[site](https://x.org)', 2), { kind: 'md', target: 'https://x.org', image: false });
});
