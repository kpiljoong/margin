#!/usr/bin/env node
'use strict';
// Verify the vendored Excalidraw frame (public/vendor/excalidraw) is exactly
// what vendor/excalidraw/build.mjs produced: the same files with the same
// SHA-256 (VENDOR.json), from the versions pinned in vendor/excalidraw.
// Runs in CI before every build. Exits 1 on any difference.
//
//   node build/check-vendor.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'public/vendor/excalidraw');
const src = path.join(root, 'vendor/excalidraw');
const problems = [];

const vendor = JSON.parse(fs.readFileSync(path.join(dir, 'VENDOR.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(src, 'package-lock.json'), 'utf8'));

// Pins: package.json (exact) = lockfile = what VENDOR.json says was bundled.
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const entry = lock.packages[`node_modules/${name}`];
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${name}: "${version}" is not an exact version`);
  if (entry?.version !== version) problems.push(`${name}: package.json ${version}, lockfile ${entry?.version}`);
  const built = vendor.packages[name];
  if (built && (built.version !== version || built.integrity !== entry?.integrity)) problems.push(`${name}: built from ${built.version}, pinned ${version}`);
}
for (const name of Object.keys(pkg.dependencies)) if (!vendor.packages[name]) problems.push(`${name}: missing from VENDOR.json`);

// Files: exactly the listed set, byte for byte (VENDOR.json itself excepted).
const walk = (d, prefix = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (e.isSymbolicLink()) { problems.push(`${prefix}${e.name}: symbolic link`); return []; }
  return e.isDirectory() ? walk(path.join(d, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`];
});
const present = new Set(walk(dir).filter((f) => f !== 'VENDOR.json'));
for (const [file, hash] of Object.entries(vendor.files)) {
  if (!present.delete(file)) { problems.push(`${file}: missing`); continue; }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex');
  if (actual !== hash) problems.push(`${file}: content differs (line endings changed?)`);
}
for (const file of present) problems.push(`${file}: not part of the build`);

if (problems.length) {
  console.error(`public/vendor/excalidraw does not match its build:\n  ${problems.join('\n  ')}\nRebuild with: cd vendor/excalidraw && npm ci --ignore-scripts && node build.mjs`);
  process.exit(1);
}
console.log(`public/vendor/excalidraw OK: ${Object.keys(vendor.files).length} files, ${Object.entries(vendor.packages).map(([n, p]) => `${n}@${p.version}`).join(', ')}`);
