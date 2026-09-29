#!/usr/bin/env node
'use strict';
// Build a signed code package for in-app updates (see desktop/codepack.js).
//
//   node build/code-package.js --out <dir> [--key <pem file>] [--version x.y.z] [--min-shell n] [--root <dir>]
//
// The Ed25519 private key comes from --key or the MARGIN_UPDATE_KEY
// environment variable (PEM text) and must pair with the public key in
// desktop/boot.js (checked). Writes margin-code.json, margin-code.sig and
// margin-code.pack.gz to --out.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const codepack = require('../desktop/codepack');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const root = path.resolve(opt('root') || path.join(__dirname, '..'));
const out = path.resolve(opt('out') || 'code-dist');
const keyPem = opt('key') ? fs.readFileSync(opt('key'), 'utf8') : process.env.MARGIN_UPDATE_KEY;
if (!keyPem || !keyPem.trim()) { console.error('No signing key: pass --key <file> or set MARGIN_UPDATE_KEY.'); process.exit(2); }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = opt('version') || pkg.version;
const minShell = Number(opt('min-shell') || pkg.marginShell || 1);

// What the app runs, minus the launcher files that stay in the bundle.
const INCLUDE = ['package.json', 'server.js', 'lib', 'public', 'scripts', 'desktop', 'example-workspace'];
const SHELL_ONLY = new Set(['desktop/boot.js', 'desktop/codepack.js']);
const skip = (rel) => SHELL_ONLY.has(rel) || rel.split('/').some((p) => p === '.agent-notes' || p.startsWith('._') || p === '.DS_Store');

const files = [];
for (const entry of INCLUDE) {
  const abs = path.join(root, entry);
  if (!fs.existsSync(abs)) continue;
  if (fs.statSync(abs).isDirectory()) files.push(...codepack.listFiles(abs).map((f) => `${entry}/${f}`));
  else files.push(entry);
}
const list = files.filter((f) => !skip(f)).sort();

// The package's package.json carries the package's version.
const staged = new Map();
if (version !== pkg.version) staged.set('package.json', Buffer.from(JSON.stringify({ ...pkg, version }, null, 2) + '\n'));
const read = (rel) => staged.get(rel) || fs.readFileSync(path.join(root, ...rel.split('/')));

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'margin-code-'));
try {
  for (const rel of list) {
    const dest = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, read(rel));
  }
  const pack = codepack.pack(tmp, list);
  const manifest = {
    format: 1,
    name: 'margin-code',
    version,
    minShell,
    created: new Date().toISOString(),
    releaseUrl: `https://github.com/kpiljoong/margin/releases/tag/v${version}`,
    pack: { size: pack.length, sha256: codepack.sha256(pack) },
    files: Object.fromEntries(list.map((rel) => [rel, codepack.sha256(read(rel))])),
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 1) + '\n');
  const sig = crypto.sign(null, bytes, crypto.createPrivateKey(keyPem)).toString('base64');
  // Check the result the way the app will: with the key built into boot.js.
  const bootSrc = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'boot.js'), 'utf8');
  const pub = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(bootSrc)?.[0];
  try { codepack.verifyManifest(bytes, sig, `${pub}\n`); } catch {
    console.error('The signing key does not match the public key in desktop/boot.js. Installed apps would reject this package.');
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(3);
  }

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'margin-code.json'), bytes);
  fs.writeFileSync(path.join(out, 'margin-code.sig'), sig + '\n');
  fs.writeFileSync(path.join(out, 'margin-code.pack.gz'), pack);
  console.log(`margin-code ${version} (minShell ${minShell}): ${list.length} files, ${(pack.length / 1024).toFixed(0)} KB → ${out}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
