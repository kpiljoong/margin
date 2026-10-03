// node --test (npm test): a task about pictures sees the pictures its notes
// show (copied in, their sizes and the ```ink notation in the prompt); other
// tasks don't. lib/pictures.js finds them and reads their sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { picturesIn, pictureSize, hiddenIn } = createRequire(import.meta.url)('../lib/pictures.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A PNG's first bytes: signature, then the IHDR chunk with width and height.
const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

test('the pictures a note shows, and their sizes', () => {
  const text = '![a](../assets/a.png) ![b](b%20c.png) ![r](https://x.org/r.png) ![up](../../out.png) ![[shot.jpg]] ![d](d.md) ![e](/top/e.svg?x=1)';
  assert.deepEqual(picturesIn(text, 'sub/n.md', ['img/shot.jpg']), ['assets/a.png', 'sub/b c.png', 'img/shot.jpg', 'top/e.svg']);
  assert.deepEqual(pictureSize(png(1280, 800)), [1280, 800]);
  assert.deepEqual(pictureSize(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="300">')), [400, 300]);
  assert.deepEqual(pictureSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"></svg>')), [640, 480]);
  const gif = Buffer.alloc(24); gif.write('GIF89a'); gif.writeUInt16LE(30, 6); gif.writeUInt16LE(20, 8);
  assert.deepEqual(pictureSize(gif), [30, 20]);
  // JPEG: SOI, an APP0 segment, then SOF0 with height and width.
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(pictureSize(jpg), [640, 480]);
  assert.equal(pictureSize(Buffer.from('not a picture at all, just words')), null);
});

test('the parts of pictures a note hides', () => {
  const text = [
    '![Card](assets/card.png)', '', '```ink', 'box red: 1,2 3x4', 'hide: 10,20 300x40', '\uAC00\uB9AC\uAE30 gray: 5,5 10\u00D710', '```', '',
    'Words ![inline](assets/inline.png)', '```ink', 'hide: 1,1 2x2', '```',
    '![[shot.png]]', '~~~ink', 'blur blue: 0,0 8x9', '~~~',
    '![Bare](assets/bare.png)', '', 'hide: 1,1 2x2',
  ].join('\n');
  assert.deepEqual(Object.fromEntries(hiddenIn(text, 'n.md', ['img/shot.png'])), {
    'assets/card.png': [[10, 20, 300, 40], [5, 5, 10, 10]],
    'img/shot.png': [[0, 0, 8, 9]],
  });
});

test('a task about pictures shares the ones its note shows; another task does not', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pics-test-')));
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pics-agent-'));
  t.after(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(tools, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(ws, 'assets'));
  fs.writeFileSync(path.join(ws, 'assets', 'shot.png'), png(1280, 800));
  fs.writeFileSync(path.join(ws, 'assets', 'other.png'), png(10, 10));
  fs.writeFileSync(path.join(ws, 'a.md'), '# A\n\n![Shot](assets/shot.png)\n');
  fs.writeFileSync(path.join(ws, 'assets', 'card.png'), png(400, 300));
  fs.writeFileSync(path.join(ws, 'b.md'), '# B\n\n![Card](assets/card.png)\n\n```ink\nhide: 10,20 100x30\n```\n');
  // An agent that writes down its prompt and what it can see.
  const agent = path.join(tools, 'agent.js');
  fs.writeFileSync(agent, "const fs = require('fs'); fs.writeFileSync('prompt.txt', process.env.AGENT_NOTES_PROMPT + '\\n---\\n' + fs.readdirSync('.', { recursive: true }).map((f) => f.split(require('path').sep).join('/')).sort().join('\\n'));\n");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open', '--agent', `"${process.execPath}" "${agent}"`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
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
  const prompt = async (task, more = {}) => {
    let run = await api('POST', '/api/runs', { task, scope: 'file', focus: 'a.md', ...more });
    for (let i = 0; i < 100 && run.status === 'running'; i++) { await sleep(100); run = await api('GET', `/api/runs/${run.id}`); }
    return { run, text: run.changes.find((c) => c.path === 'prompt.txt')?.lines.join('\n') || '' };
  };

  assert.deepEqual((await api('GET', '/api/scope?scope=file&focus=a.md&task=Tidy')).pictures, []);
  assert.deepEqual((await api('GET', `/api/scope?scope=file&focus=a.md&task=${encodeURIComponent('\uC2A4\uD06C\uB9B0\uC0F7\uC5D0 \uD45C\uC2DC\uD574\uC918')}`)).pictures, ['assets/shot.png']);

  const pics = await prompt('Mark the problem on the screenshot');
  assert.deepEqual(pics.run.pictures, ['assets/shot.png']);
  assert.match(pics.text, /The ```ink notation/);
  assert.match(pics.text, /assets\/shot\.png \(1280×800\)/);
  assert.match(pics.text, /---\n[^]*assets\/shot\.png/);
  assert.doesNotMatch(pics.text, /other\.png/);
  // The picture came in unchanged: no change to review but the agent's own file.
  assert.deepEqual(pics.run.changes.map((c) => c.path), ['prompt.txt']);

  const plain = await prompt('Tidy');
  assert.deepEqual(plain.run.pictures, []);
  assert.doesNotMatch(plain.text, /```ink notation|shot\.png/);

  // A picture with hidden parts goes only as the copy the app covered them in.
  assert.deepEqual((await api('GET', '/api/scope?scope=file&focus=b.md&task=picture')).hidden, { 'assets/card.png': [[10, 20, 100, 30]] });
  const bare = await prompt('Mark up the picture', { focus: 'b.md' });
  assert.deepEqual(bare.run.pictures, []);
  assert.deepEqual(bare.run.excluded.map((x) => x.path), ['assets/card.png']);
  assert.doesNotMatch(bare.text, /card\.png/);
  const wrong = await prompt('Mark up the picture', { focus: 'b.md', masked: { 'assets/card.png': png(40, 30).toString('base64') } });
  assert.deepEqual(wrong.run.pictures, []);
  const covered = Buffer.concat([png(400, 300), Buffer.from('covered')]);
  const ok = await prompt('Mark up the picture', { focus: 'b.md', masked: { 'assets/card.png': covered.toString('base64') } });
  assert.deepEqual(ok.run.pictures, ['assets/card.png']);
  assert.match(ok.text, /covered in gray/);
  for (const sub of ['base', 'work']) assert.ok(fs.readFileSync(path.join(ws, '.agent-notes', 'runs', ok.run.id, sub, 'assets', 'card.png')).equals(covered));
  assert.ok(fs.readFileSync(path.join(ws, 'assets', 'card.png')).equals(png(400, 300)), 'the picture itself is untouched');
});
