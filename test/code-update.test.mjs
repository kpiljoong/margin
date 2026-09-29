// node --test (npm test): in-app code updates end to end — desktop/codepack.js
// and the launcher, desktop/boot.js, the way an installed app runs them:
// install a signed package, start it on the next launch, set it aside when it
// is tampered with or fails to start. Runs on every OS in CI (paths, renames).
//
// boot.js is loaded from a copy whose public key is swapped for a throwaway
// one, with a stand-in for Electron's `app`; nothing else is changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codepack = require(path.join(ROOT, 'desktop', 'codepack.js'));

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' });

// Real paths: require's cache is keyed by them (/var is /private/var on macOS).
const tmpDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-update-test-')));

// A package of `files` ({ rel: text }) as CI builds it (build/code-package.js).
function makePackage(version, files, { minShell = 1, key = privateKey } = {}) {
  const src = tmpDir();
  const all = { 'package.json': JSON.stringify({ name: 'margin', version }), 'server.js': '', ...files };
  for (const [rel, text] of Object.entries(all)) {
    const abs = path.join(src, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  const list = codepack.listFiles(src);
  const pack = codepack.pack(src, list);
  const manifest = {
    format: 1, name: 'margin-code', version, minShell,
    pack: { size: pack.length, sha256: codepack.sha256(pack) },
    files: Object.fromEntries(list.map((rel) => [rel, codepack.sha256(fs.readFileSync(path.join(src, ...rel.split('/'))))])),
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  fs.rmSync(src, { recursive: true, force: true });
  return { bytes, sig: crypto.sign(null, bytes, key).toString('base64'), pack };
}

// An installed app: the bundle (boot.js with our key, codepack.js, a
// package.json and a main.js that says which code ran) and a user data folder.
function makeApp(bundledVersion = '1.0.0', shell = 1) {
  const dir = tmpDir();
  const bundle = path.join(dir, 'bundle');
  fs.mkdirSync(path.join(bundle, 'desktop'), { recursive: true });
  const boot = fs.readFileSync(path.join(ROOT, 'desktop', 'boot.js'), 'utf8')
    // A Windows checkout has CRLF line ends.
    .replace(/const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----\r?\n`;/, `const PUBLIC_KEY = ${JSON.stringify(PUBLIC)};`);
  assert.ok(boot.includes(JSON.stringify(PUBLIC)), 'the public key in boot.js was swapped');
  fs.writeFileSync(path.join(bundle, 'desktop', 'boot.js'), boot);
  fs.copyFileSync(path.join(ROOT, 'desktop', 'codepack.js'), path.join(bundle, 'desktop', 'codepack.js'));
  fs.writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({ version: bundledVersion, marginShell: shell }));
  fs.writeFileSync(path.join(bundle, 'desktop', 'main.js'), 'global.ranCode = "bundle";');
  return { dir, bundle, userData: path.join(dir, 'user-data') };
}

// One launch: load boot.js as Electron would, with a stand-in `app`.
function launch(appDir) {
  const events = { relaunched: false, exited: null };
  const app = {
    isPackaged: true,
    getPath: () => appDir.userData,
    setPath() {},
    relaunch() { events.relaunched = true; },
    exit(code) { events.exited = code; },
  };
  const load = Module._load;
  Module._load = function (request, ...rest) { return request === 'electron' ? { app } : load.call(this, request, ...rest); };
  for (const k of Object.keys(require.cache)) if (k.startsWith(appDir.dir)) delete require.cache[k];
  delete global.ranCode;
  delete global.marginBoot;
  try {
    require(path.join(appDir.bundle, 'desktop', 'boot.js'));
  } finally {
    Module._load = load;
  }
  return { boot: global.marginBoot, ran: global.ranCode, ...events };
}

const cleanup = (a) => fs.rmSync(a.dir, { recursive: true, force: true });

test('versions compare numerically, and a pre-release comes before its release', () => {
  assert.equal(codepack.compareVersions('0.5.10', '0.5.9'), 1);
  assert.equal(codepack.compareVersions('0.5.9', '0.5.10'), -1);
  assert.equal(codepack.compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(codepack.compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(codepack.compareVersions('1.0.0', '1.0.0'), 0);
  assert.throws(() => codepack.compareVersions('1.0', '1.0.0'));
});

test('package paths stay inside the package', () => {
  for (const bad of ['../x', 'a/../b', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', './a', '', codepack.MANIFEST]) assert.equal(codepack.safeRel(bad), false, bad);
  assert.equal(codepack.safeRel('public/app.js'), true);
});

test('a signed package installs, and runs from the next launch', (t) => {
  const a = makeApp('1.0.0');
  t.after(() => cleanup(a));
  const first = launch(a);
  assert.equal(first.ran, 'bundle');
  assert.equal(first.boot.activeVersion, '1.0.0');
  first.boot.markHealthy();

  const p = makePackage('1.0.1', { 'desktop/main.js': 'global.ranCode = "1.0.1";', 'public/app.js': 'x' });
  assert.deepEqual(first.boot.install(p.bytes, p.sig, p.pack), { version: '1.0.1' });
  assert.ok(fs.existsSync(path.join(a.userData, 'app-1.0.1', 'public', 'app.js')));
  assert.ok(!fs.readdirSync(a.userData).some((n) => n.includes('.partial-')), 'no half-installed folder is left');

  const second = launch(a);
  assert.equal(second.ran, '1.0.1');
  assert.equal(second.boot.source, 'update');
  second.boot.markHealthy();
  assert.equal(launch(a).ran, '1.0.1', 'it keeps running');
});

test('only a newer package, signed with our key, that fits this app, installs', (t) => {
  const a = makeApp('1.0.0');
  t.after(() => cleanup(a));
  const { boot } = launch(a);
  const main = { 'desktop/main.js': 'global.ranCode = "new";' };
  const same = makePackage('1.0.0', main);
  assert.throws(() => boot.install(same.bytes, same.sig, same.pack), /not newer/);
  const other = makePackage('1.0.1', main, { key: crypto.generateKeyPairSync('ed25519').privateKey });
  assert.throws(() => boot.install(other.bytes, other.sig, other.pack), /Signature does not match/);
  const newShell = makePackage('1.0.1', main, { minShell: 2 });
  assert.throws(() => boot.install(newShell.bytes, newShell.sig, newShell.pack), /new app download/);
  const ok = makePackage('1.0.1', main);
  const swapped = makePackage('1.0.1', { 'desktop/main.js': 'global.ranCode = "evil";' });
  assert.throws(() => boot.install(ok.bytes, ok.sig, swapped.pack), /does not match its manifest/);
  assert.equal(launch(a).ran, 'bundle', 'nothing was installed');
});

test('an installed package that was changed on disk is set aside', (t) => {
  const a = makeApp('1.0.0');
  t.after(() => cleanup(a));
  const p = makePackage('1.0.1', { 'desktop/main.js': 'global.ranCode = "1.0.1";', 'public/app.js': 'x' });
  launch(a).boot.install(p.bytes, p.sig, p.pack);
  fs.writeFileSync(path.join(a.userData, 'app-1.0.1', 'public', 'app.js'), 'changed');
  const r = launch(a);
  assert.equal(r.ran, 'bundle');
  assert.match(r.boot.setAsideReason('1.0.1'), /verification failed: File was modified: public\/app.js/);
  assert.equal(r.boot.rolledBack().version, '1.0.1');
});

test('a package that fails to load is set aside and the app starts again', (t) => {
  const a = makeApp('1.0.0');
  t.after(() => cleanup(a));
  const p = makePackage('1.0.1', { 'desktop/main.js': 'throw new Error("broken build");' });
  launch(a).boot.install(p.bytes, p.sig, p.pack);
  const r = launch(a);
  assert.equal(r.relaunched, true);
  assert.equal(r.exited, 0);
  assert.match(r.boot.setAsideReason('1.0.1'), /failed to load: broken build/);
  assert.equal(launch(a).ran, 'bundle');
});

test('a package that never comes up twice is set aside; the one before it runs', (t) => {
  const a = makeApp('1.0.0');
  t.after(() => cleanup(a));
  const good = makePackage('1.0.1', { 'desktop/main.js': 'global.ranCode = "1.0.1";' });
  launch(a).boot.install(good.bytes, good.sig, good.pack);
  const r1 = launch(a);
  r1.boot.markHealthy();
  const hangs = makePackage('1.0.2', { 'desktop/main.js': 'global.ranCode = "1.0.2";' });
  r1.boot.install(hangs.bytes, hangs.sig, hangs.pack);
  assert.equal(launch(a).ran, '1.0.2'); // no markHealthy: the window never came up
  assert.equal(launch(a).ran, '1.0.2');
  const r = launch(a);
  assert.equal(r.ran, '1.0.1', 'back to the code that worked');
  assert.match(r.boot.setAsideReason('1.0.2'), /did not start successfully twice/);
});

test('a newer app makes older code updates obsolete, and they are cleaned up', (t) => {
  const a = makeApp('1.0.0');
  t.after(() => cleanup(a));
  const p = makePackage('1.0.1', { 'desktop/main.js': 'global.ranCode = "1.0.1";' });
  launch(a).boot.install(p.bytes, p.sig, p.pack);
  fs.writeFileSync(path.join(a.bundle, 'package.json'), JSON.stringify({ version: '1.1.0', marginShell: 1 }));
  const r = launch(a);
  assert.equal(r.ran, 'bundle');
  r.boot.markHealthy();
  assert.ok(!fs.existsSync(path.join(a.userData, 'app-1.0.1')));
});

test('the real app code packs and unpacks to the same bytes', (t) => {
  const dest = tmpDir();
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));
  const files = ['package.json', 'server.js', ...['lib', 'public', 'desktop'].flatMap((d) => codepack.listFiles(path.join(ROOT, d)).map((f) => `${d}/${f}`))];
  const unpacked = codepack.unpack(codepack.pack(ROOT, files), dest);
  assert.deepEqual(unpacked, files);
  for (const rel of files) assert.equal(codepack.sha256(fs.readFileSync(path.join(dest, ...rel.split('/')))), codepack.sha256(fs.readFileSync(path.join(ROOT, ...rel.split('/')))), rel);
});
