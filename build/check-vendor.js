#!/usr/bin/env node
'use strict';
// Verify the vendored code is exactly what its build produced: the same
// files with the same SHA-256 (VENDOR.json), from the versions pinned in its
// vendor/<name> folder — the Excalidraw frame (public/vendor/excalidraw) and
// the margin model's runtime and tokenizer (lib/vendor/embed).
// Runs in CI before every build. Exits 1 on any difference.
//
//   node build/check-vendor.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
let failed = false;

function check(out, name) {
  const dir = path.join(root, out);
  const src = path.join(root, 'vendor', name);
  const problems = [];
  const vendor = JSON.parse(fs.readFileSync(path.join(dir, 'VENDOR.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(src, 'package-lock.json'), 'utf8'));

  // Pins: package.json (exact) = lockfile = what VENDOR.json says was bundled.
  for (const [pkgName, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const entry = lock.packages[`node_modules/${pkgName}`];
    if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${pkgName}: "${version}" is not an exact version`);
    if (entry?.version !== version) problems.push(`${pkgName}: package.json ${version}, lockfile ${entry?.version}`);
    const built = vendor.packages[pkgName];
    if (built && (built.version !== version || built.integrity !== entry?.integrity)) problems.push(`${pkgName}: built from ${built.version}, pinned ${version}`);
  }
  for (const pkgName of Object.keys(pkg.dependencies)) if (!vendor.packages[pkgName]) problems.push(`${pkgName}: missing from VENDOR.json`);

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

  // What is downloaded later is pinned too: https, a size and a SHA-256 each.
  for (const d of vendor.downloads || []) {
    if (!/^https:\/\//.test(d.url) || !(d.size > 0) || !/^[0-9a-f]{64}$/.test(d.sha256)) problems.push(`${d.file}: download not pinned (https, size, sha256)`);
  }

  if (problems.length) {
    console.error(`${out} does not match its build:\n  ${problems.join('\n  ')}\nRebuild with: cd vendor/${name} && npm ci --ignore-scripts && node build.mjs`);
    failed = true;
    return;
  }
  console.log(`${out} OK: ${Object.keys(vendor.files).length} files, ${Object.entries(vendor.packages).map(([n, p]) => `${n}@${p.version}`).join(', ')}`);
}

check('public/vendor/excalidraw', 'excalidraw');
check('lib/vendor/embed', 'embed');
if (failed) process.exit(1);
