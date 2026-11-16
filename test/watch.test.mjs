// node --test (npm test): lib/watch.js — the workspace watched, a note
// written by another program seen after Margin saved it (atomically, a
// rename), folders made, moved in and gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { watchTree } = require('../lib/watch.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seen(events, rel, from, ms = 3000) {
  for (let t = 0; t < ms; t += 50) {
    if (events.slice(from).includes(rel)) return true;
    await sleep(50);
  }
  return false;
}

for (const perFolder of [true, false]) {
  test(`a note written after it was replaced by a rename is seen (${perFolder ? 'each folder' : 'recursive'})`, async (t) => {
    if (!perFolder && process.platform === 'linux') { t.skip('Node’s recursive watch on Linux misses it: lib/watch.js watches each folder there'); return; }
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-watch-test-')));
    fs.mkdirSync(path.join(root, 'sub'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'sub', 'a.md'), 'one\n');
    const events = [];
    const w = watchTree(root, { perFolder, skip: (n) => n === '.git', onEvent: (type, rel) => events.push(rel) });
    t.after(() => { w.close(); fs.rmSync(root, { recursive: true, force: true }); });
    await sleep(200);
    // Saved as Margin saves: a file beside it, renamed over it.
    const tmp = path.join(root, 'sub', 'a.md.1.2.tmp');
    fs.writeFileSync(tmp, 'two\n');
    fs.renameSync(tmp, path.join(root, 'sub', 'a.md'));
    await sleep(700);
    let from = events.length;
    fs.writeFileSync(path.join(root, 'sub', 'a.md'), 'from another program\n');
    assert.ok(await seen(events, 'sub/a.md', from), `seen: ${JSON.stringify(events.slice(from))}`);
    // A folder made, and a note in it.
    fs.mkdirSync(path.join(root, 'new'));
    await sleep(300);
    from = events.length;
    fs.writeFileSync(path.join(root, 'new', 'b.md'), 'b\n');
    assert.ok(await seen(events, 'new/b.md', from), `in a new folder: ${JSON.stringify(events.slice(from))}`);
    // Moved, then written in its new place.
    fs.renameSync(path.join(root, 'new'), path.join(root, 'moved'));
    await sleep(300);
    from = events.length;
    fs.writeFileSync(path.join(root, 'moved', 'b.md'), 'b again\n');
    assert.ok(await seen(events, 'moved/b.md', from), `in a moved folder: ${JSON.stringify(events.slice(from))}`);
    if (perFolder) {
      // Not looked into: .git; and the moved folder's old place let go.
      assert.equal(w.size, 3);
    }
  });
}
