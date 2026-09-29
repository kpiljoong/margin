'use strict';
// Code packages for in-app updates. The shell (Electron + desktop/boot.js +
// this file) stays inside the app bundle; the app code — desktop/main.js,
// server.js, lib/, public/, … — can be replaced by a newer package that lives
// in the user data folder.
//
// A package is three files:
//   margin-code.json     manifest: version, minShell, SHA-256 of every file
//   margin-code.sig      Ed25519 signature of the manifest bytes (base64)
//   margin-code.pack.gz  the files, gzipped in a simple container
// An installed package is a folder app-<version>/ holding the files plus the
// manifest and signature, and it is verified again on every launch.
//
// Used by desktop/boot.js (from the bundle) and build/code-package.js (CI).
// Node built-ins only.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MANIFEST = '.margin-manifest.json';
const SIGNATURE = '.margin-manifest.sig';
const PACK_MAGIC = 'MARGINPK1\n';
const IGNORED = new Set(['.DS_Store', 'Thumbs.db']); // added by file browsers, never loaded

// 1.2.3 and 1.2.3-beta.1; a pre-release sorts before its release.
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || ''));
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Invalid version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return +p < +q ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Package paths are relative, forward-slashed and stay inside the package.
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 400) return false;
  if (rel.includes('\\') || rel.includes('\0') || rel.startsWith('/') || /^[a-z]:/i.test(rel)) return false;
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return false;
  return rel !== MANIFEST && rel !== SIGNATURE;
}

// Every regular file under root, as sorted relative paths. Symlinks are
// refused: a verified file must not be able to point somewhere else later.
function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(ent.name)) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) throw new Error(`Symbolic link in package: ${rel}`);
      if (ent.isDirectory()) walk(abs, rel);
      else if (ent.isFile()) out.push(rel);
      else throw new Error(`Unexpected file type in package: ${rel}`);
    }
  };
  walk(root, '');
  return out.sort();
}

function parseManifest(bytes) {
  const m = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!m || m.format !== 1 || m.name !== 'margin-code') throw new Error('Not a Margin code manifest');
  if (!parseVersion(m.version)) throw new Error('Manifest has an invalid version');
  if (!Number.isInteger(m.minShell) || m.minShell < 1) throw new Error('Manifest has an invalid minShell');
  if (!m.files || typeof m.files !== 'object') throw new Error('Manifest lists no files');
  for (const [rel, hash] of Object.entries(m.files)) {
    if (!safeRel(rel) || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Manifest has an invalid entry: ${rel}`);
  }
  if (!m.files['desktop/main.js'] || !m.files['server.js'] || !m.files['package.json']) throw new Error('Manifest is missing app entry points');
  return m;
}

// Throws unless `sig` (base64) is a valid signature of exactly these bytes.
function verifyManifest(bytes, sig, publicKeyPem) {
  const signature = Buffer.from(String(sig || '').trim(), 'base64');
  if (signature.length !== 64) throw new Error('Signature is malformed');
  if (!crypto.verify(null, Buffer.from(bytes), crypto.createPublicKey(publicKeyPem), signature)) {
    throw new Error('Signature does not match');
  }
  return parseManifest(bytes);
}

// An installed package folder: signed manifest, exactly the listed files, and
// every hash matching. Returns the manifest.
function verifyDir(dir, publicKeyPem) {
  const bytes = fs.readFileSync(path.join(dir, MANIFEST));
  const sig = fs.readFileSync(path.join(dir, SIGNATURE), 'utf8');
  const m = verifyManifest(bytes, sig, publicKeyPem);
  const expected = Object.keys(m.files).sort();
  const actual = listFiles(dir).filter((f) => f !== MANIFEST && f !== SIGNATURE);
  if (actual.length !== expected.length || actual.some((f, i) => f !== expected[i])) {
    const extra = actual.filter((f) => !m.files[f]);
    const missing = expected.filter((f) => !actual.includes(f));
    throw new Error(`Package files differ from the manifest${extra.length ? ` (unexpected: ${extra.slice(0, 3).join(', ')})` : ''}${missing.length ? ` (missing: ${missing.slice(0, 3).join(', ')})` : ''}`);
  }
  for (const rel of expected) {
    if (sha256(fs.readFileSync(path.join(dir, ...rel.split('/')))) !== m.files[rel]) throw new Error(`File was modified: ${rel}`);
  }
  return m;
}

// Container: magic, one JSON line [[path, size], …], then the file bytes.
function pack(root, files) {
  const bodies = files.map((rel) => fs.readFileSync(path.join(root, ...rel.split('/'))));
  const header = JSON.stringify(files.map((rel, i) => [rel, bodies[i].length]));
  return zlib.gzipSync(Buffer.concat([Buffer.from(PACK_MAGIC + header + '\n'), ...bodies]), { level: 9 });
}

function unpack(gz, dest, maxBytes = 200 * 1024 * 1024) {
  const buf = zlib.gunzipSync(gz, { maxOutputLength: maxBytes });
  if (buf.subarray(0, PACK_MAGIC.length).toString() !== PACK_MAGIC) throw new Error('Not a Margin code pack');
  const nl = buf.indexOf(10, PACK_MAGIC.length);
  if (nl < 0) throw new Error('Code pack header is damaged');
  const entries = JSON.parse(buf.subarray(PACK_MAGIC.length, nl).toString('utf8'));
  let pos = nl + 1;
  for (const [rel, size] of entries) {
    if (!safeRel(rel) || !Number.isInteger(size) || size < 0 || pos + size > buf.length) throw new Error(`Code pack entry is invalid: ${rel}`);
    const abs = path.join(dest, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf.subarray(pos, pos + size), { flag: 'wx' });
    pos += size;
  }
  if (pos !== buf.length) throw new Error('Code pack has trailing data');
  return entries.map(([rel]) => rel);
}

module.exports = { MANIFEST, SIGNATURE, compareVersions, parseVersion, sha256, safeRel, listFiles, parseManifest, verifyManifest, verifyDir, pack, unpack };
