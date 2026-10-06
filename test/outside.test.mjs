// node --test (npm test): changes from outside kept on disk (lib/outside.js)
// — the ones waiting for review survive a restart, and notes changed, made
// or deleted while Margin was closed are found when it opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { OutsideStore, Seen, changedWhileAway } = require('../lib/outside.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-outside-test-')));

test('the changes waiting for review are written through and read back, oldest first', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = new OutsideStore(dir);
  a.set('b.md', { before: 'two\n', since: 2, at: 2 });
  a.set('a.md', { before: null, since: 1, at: 5 });
  a.set('c.md', { before: 'three\n', since: 3, at: 3 });
  a.delete('c.md');
  const b = new OutsideStore(dir);
  assert.deepEqual([...b.keys()], ['a.md', 'b.md']);
  assert.deepEqual(b.get('a.md'), { before: null, since: 1, at: 5 });
  assert.equal(b.get('b.md').before, 'two\n');
  b.clear();
  assert.equal(new OutsideStore(dir).size, 0);
});

test('what was seen of each note: changed, made and deleted while away; nothing the first time', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const st = (size, mtimeMs) => ({ size, mtimeMs });
  const s = new Seen(dir);
  assert.equal(s.fresh, true);
  s.record('a.md', 'one\n', st(4, 10));
  s.record('b.md', 'same\n', st(5, 10));
  s.record('c.md', 'same\n', st(5, 11));
  s.save();
  assert.equal(fs.existsSync(path.join(dir, 'index.json')), false, 'not written half way the first time');
  assert.deepEqual(changedWhileAway(s, new Map([['x.md', st(1, 1)]]), () => 'x'), [], 'the first time, nothing can be said');
  s.save(true);

  const again = new Seen(dir);
  assert.equal(again.fresh, false);
  assert.equal(again.text('a.md'), 'one\n');
  assert.equal(again.refs.get(again.entry('b.md').hash), 2, 'one text kept once for two notes');
  const now = { 'a.md': 'one, changed\n', 'b.md': 'same\n', 'n.md': 'new\n' };
  const files = new Map([['a.md', st(13, 20)], ['b.md', st(5, 30)], ['n.md', st(4, 20)]]);
  const away = changedWhileAway(again, files, (rel) => now[rel]);
  assert.deepEqual(away.map((c) => [c.rel, c.before, c.now]), [
    ['a.md', 'one\n', 'one, changed\n'],
    ['n.md', null, 'new\n'],
    ['c.md', 'same\n', null],
  ], 'b.md was touched but is the same');

  again.record('a.md', 'one, changed\n', st(13, 20));
  const old = path.join(dir, 'blobs');
  const blobs = () => fs.readdirSync(old, { recursive: true }).filter((n) => n.endsWith('.gz')).length;
  assert.equal(blobs(), 2, 'the old text of a.md is let go');
  again.forget('b.md');
  again.forget('c.md');
  assert.equal(blobs(), 1, 'and a text no note has any more');
});

async function startServer(ws) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const api = async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}${p}`, { method, headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status });
    return data;
  };
  const stop = () => new Promise((r) => { proc.once('exit', r); proc.kill(); });
  // Up, and done looking at what changed while it was closed.
  for (let i = 0; i < 50 && !fs.existsSync(path.join(ws, '.agent-notes', 'seen', 'index.json')); i++) await sleep(100);
  await sleep(300);
  return { api, stop };
}
const outsideOf = async (api) => (await api('GET', '/api/outside')).changes.map((c) => `${c.status} ${c.path}`).sort();

test('the server: notes changed while it was closed are changes from outside; they stay until looked at', async (t) => {
  const ws = tmp();
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ws, 'a.md'), 'one\n');
  fs.writeFileSync(path.join(ws, 'gone.md'), 'bye\n');
  fs.mkdirSync(path.join(ws, 'sub'));
  fs.writeFileSync(path.join(ws, 'sub', 'mine.md'), 'mine\n');

  let s = await startServer(ws);
  assert.deepEqual(await outsideOf(s.api), [], 'the first time, nothing');
  const f = await s.api('GET', '/api/file?path=sub%2Fmine.md');
  await s.api('PUT', '/api/file', { path: 'sub/mine.md', content: 'mine, saved here\n', baseHash: f.hash });
  await sleep(300);
  await s.stop();

  // While it is closed.
  fs.writeFileSync(path.join(ws, 'a.md'), 'one, from another program\n');
  fs.rmSync(path.join(ws, 'gone.md'));
  fs.writeFileSync(path.join(ws, 'new.md'), 'made while closed\n');

  s = await startServer(ws);
  let list = [];
  for (let i = 0; i < 80 && (list = await outsideOf(s.api)).length < 3; i++) await sleep(100);
  assert.deepEqual(list, ['added new.md', 'deleted gone.md', 'modified a.md'], 'a save of its own is not one');
  const d = await s.api('GET', '/api/outside/diff?path=a.md');
  assert.equal(d.base, 'one\n');
  await s.stop();

  s = await startServer(ws);
  assert.deepEqual(await outsideOf(s.api), list, 'still there after a restart');
  await s.api('POST', '/api/outside/seen', { paths: ['a.md', 'gone.md', 'new.md'] });
  await s.stop();

  s = await startServer(ws);
  const left = await outsideOf(s.api);
  await s.stop();
  assert.deepEqual(left, [], 'looked at: gone for good');
});
