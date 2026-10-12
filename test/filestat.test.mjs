// node --test (npm test): a file whose path is answered as a folder's (a
// macOS share of an exFAT disk, on Windows) is still a file when its folder
// lists it as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { makeFileStat } = createRequire(import.meta.url)('../lib/filestat.js');

test('a file the share calls a folder: taken as its folder lists it, size from reading it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an-filestat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '01_\uC77C\uC815.md'), '# plan\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  const folder = fs.statSync(dir);
  let handle = true;
  const share = { ...fs, statSync: () => folder, fstatSync: (fd) => (handle ? fs.fstatSync(fd) : folder) };
  const fileStat = makeFileStat(share);
  const note = path.join(dir, '01_\uC77C\uC815.md');
  assert.equal(fileStat(note).isFile(), true);
  assert.equal(fileStat(note).size, 7);
  handle = false;
  const st = makeFileStat(share)(note);
  assert.equal(st.isFile(), true);
  assert.equal(st.isDirectory(), false);
  assert.equal(st.size, 7);
  assert.equal(typeof st.mtimeMs, 'number');
  // A real folder stays one.
  assert.equal(makeFileStat(share)(path.join(dir, 'sub')).isDirectory(), true);
  // Where the share is right, nothing changes.
  assert.equal(makeFileStat()(note).isFile(), true);
  assert.throws(() => makeFileStat()(path.join(dir, 'gone.md')), { code: 'ENOENT' });
});
