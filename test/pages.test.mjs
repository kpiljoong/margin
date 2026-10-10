// node --test (npm test): a workspace's HTML pages, shown as pages from an
// origin of their own (another port, a key made at each start), sandboxed,
// read only — never the app's origin, never a note or a hidden file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (A request with its own Host header, which fetch won't send.)
const get = (url, { method = 'GET', host } = {}) => new Promise((done, fail) => {
  const u = new URL(url);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: host ? { host } : {} }, (res) => { let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => done({ status: res.statusCode, headers: res.headers, body })); });
  req.on('error', fail);
  req.end();
});

test('pages: an HTML page and what is beside it, from their own sandboxed origin; nothing else', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pages-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.mkdirSync(path.join(ws, 'talks', 'img'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'talks', 'slides.html'), '<!doctype html><title>S</title><script>document.title = "ran"</script><img src="img/a.png">');
  fs.writeFileSync(path.join(ws, 'talks', 'img', 'a.png'), 'png');
  fs.writeFileSync(path.join(ws, 'talks', 'notes.md'), '# private-ish\n');
  fs.writeFileSync(path.join(ws, 'talks', 'skip.html'), 'x');
  fs.writeFileSync(path.join(ws, '.agentnotesignore'), 'talks/skip.html\n');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open', '--agent', 'demo'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const info = await (await fetch(`http://127.0.0.1:${m[1]}/api/info`, { headers: { 'x-agent-notes-token': m[2] } })).json();
  assert.match(info.pages, /^http:\/\/127\.0\.0\.1:\d+\/k\/[0-9a-f]{36}\/$/);
  assert.ok(!info.pages.startsWith(`http://127.0.0.1:${m[1]}/`), 'not the app’s origin');
  const page = await get(`${info.pages}talks/slides.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.headers['content-security-policy'], /^sandbox allow-scripts [^;]*; default-src [^;]*; connect-src 'none'; form-action 'none'; base-uri [^;]*; frame-ancestors http:\/\/127\.0\.0\.1:\d+ http:\/\/localhost:\d+$/);
  assert.doesNotMatch(page.headers['content-security-policy'], /allow-same-origin/);
  assert.equal((await get(`${info.pages}talks/img/a.png`)).status, 200, 'what is beside it');
  assert.equal((await get(`${info.pages}talks/notes.md`)).status, 404, 'never a note');
  assert.equal((await get(`${info.pages}talks/skip.html`)).status, 404, 'never an ignored file');
  assert.equal((await get(`${info.pages}.agentnotesignore`)).status, 404);
  assert.equal((await get(`${info.pages}..%2F..%2Fetc%2Fhosts.html`)).status, 404);
  assert.equal((await get(info.pages.replace(/k\/[0-9a-f]+\//, 'k/0000/') + 'talks/slides.html')).status, 404, 'another key');
  assert.equal((await get(`${info.pages}talks/slides.html`, { host: 'evil.example' })).status, 403);
  assert.equal((await get(`${info.pages}talks/slides.html`, { method: 'POST' })).status, 405);
  // The app may frame them, and nothing else.
  const app = await fetch(`http://127.0.0.1:${m[1]}/?t=${m[2]}`);
  assert.match(app.headers.get('content-security-policy'), new RegExp(`frame-src ${info.pages.replace(/\/k\/.*$/, '').replace(/\./g, '\\.')}$`));
});
