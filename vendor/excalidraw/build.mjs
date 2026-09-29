// Builds public/vendor/excalidraw from the pinned packages in this folder.
//
//   cd vendor/excalidraw && npm ci --ignore-scripts && node build.mjs
//
// Output: frame.html (loads everything with Subresource Integrity), the
// bundle and its chunks, Excalidraw's fonts except the CJK "Xiaolai" family
// (text falls back to system fonts), third-party licenses, and VENDOR.json
// with the exact versions, the frame's Content-Security-Policy and a SHA-256
// of every file. build/check-vendor.js verifies the folder against it.

import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../public/vendor/excalidraw');
const nm = path.join(here, 'node_modules');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(here, 'package-lock.json'), 'utf8'));

// Everything must be installed exactly as pinned.
const pinned = { ...pkg.dependencies, ...pkg.devDependencies };
for (const [name, version] of Object.entries(pinned)) {
  const entry = lock.packages[`node_modules/${name}`];
  const installed = JSON.parse(fs.readFileSync(path.join(nm, name, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || entry?.version !== version || installed !== version) {
    throw new Error(`${name}: pinned ${version}, lock ${entry?.version}, installed ${installed}. Run npm ci.`);
  }
}

// The only changes to Excalidraw's code, applied to its published build and
// checked here so an upgrade can't silently drop them:
//  1. fonts never fall back to a CDN (esm.sh) — everything is local;
//  2. the CJK font "Xiaolai" isn't shipped, so don't try to load it
//     (text in those scripts uses the system's fonts).
const PATCHES = [
  [/return (\w+)\.push\(new URL\(\w+,\w+\.ASSETS_FALLBACK_URL\)\),\1\}/g, 'return $1}'],
  [/static createUrls\((\w+)\)\{if\(\1\.startsWith\("data"\)\)return\[\1\];if\(\1\.startsWith\((\w+)\)\)return\[\];/g,
    'static createUrls($1){if($1.startsWith("data"))return[$1];if($1.startsWith($2)||$1.includes("/Xiaolai/"))return[];'],
];
const applied = PATCHES.map(() => 0);
const patchExcalidraw = {
  name: 'margin-offline-fonts',
  setup(b) {
    b.onLoad({ filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/ }, (args) => {
      let code = fs.readFileSync(args.path, 'utf8');
      PATCHES.forEach(([re, to], i) => { code = code.replace(re, (...m) => { applied[i]++; return to.replace(/\$(\d)/g, (_, n) => m[n]); }); });
      return { contents: code, loader: 'js' };
    });
  },
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const result = await esbuild.build({
  entryPoints: { frame: path.join(here, 'src/frame.jsx') },
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'chrome120',
  jsx: 'automatic',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"' },
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
  plugins: [patchExcalidraw],
});
if (applied.some((n) => n !== 1)) throw new Error(`Excalidraw patches applied ${applied.join('/')} times (expected 1 each) — review PATCHES for this version.`);

// Fonts Excalidraw loads at runtime (relative to EXCALIDRAW_ASSET_PATH).
const fontSrc = path.join(nm, '@excalidraw/excalidraw/dist/prod/fonts');
for (const family of fs.readdirSync(fontSrc)) {
  if (family === 'Xiaolai') continue; // CJK: ~12 MB, system fonts are used instead
  fs.cpSync(path.join(fontSrc, family), path.join(out, 'fonts', family), { recursive: true });
}

// Licenses of every package that ended up in the bundle.
const bundled = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) bundled.add(m[1]);
}
const licenses = [...bundled].sort().map((name) => {
  const dir = path.join(nm, name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^(license|licence|copying)(\.|$)/i.test(f));
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `License: ${meta.license || 'see package'}`;
  return `${name}@${meta.version} (${meta.license || 'unknown'})\n\n${text}\n`;
});
fs.writeFileSync(path.join(out, 'THIRD-PARTY-LICENSES.txt'), `Bundled into Margin's Excalidraw frame (public/vendor/excalidraw).\n\n${licenses.join(`\n${'-'.repeat(72)}\n\n`)}`);

// frame.html: an import map pins the hash of every script chunk, so the
// browser refuses any file that differs from this build.
const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
const sri = (rel) => `sha384-${crypto.createHash('sha384').update(fs.readFileSync(path.join(out, rel))).digest('base64')}`;
const files = walk(out).sort();
const entryJs = files.find((f) => /^frame-[^/]+\.js$/.test(f));
const entryCss = files.find((f) => /^frame-[^/]+\.css$/.test(f));
const integrity = Object.fromEntries(files.filter((f) => f.endsWith('.js')).map((f) => [`./${f}`, sri(f)]));
const importMap = JSON.stringify({ imports: {}, integrity });
const importMapHash = `sha256-${crypto.createHash('sha256').update(importMap).digest('base64')}`;
fs.writeFileSync(path.join(out, 'frame.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Excalidraw</title>
<script type="importmap">${importMap}</script>
<link rel="stylesheet" href="./${entryCss}" integrity="${sri(entryCss)}" crossorigin="anonymous">
<script type="module" src="./${entryJs}" integrity="${sri(entryJs)}" crossorigin="anonymous"></script>
</head>
<body><div id="root"></div></body>
</html>
`);

// SELF is replaced by the server with the app's own origin.
const csp = [
  "default-src 'none'",
  `script-src SELF 'wasm-unsafe-eval' '${importMapHash}'`,
  "style-src SELF 'unsafe-inline'",
  'font-src SELF data:',
  'img-src SELF data: blob:',
  'connect-src SELF data: blob:',
  'worker-src SELF blob:',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'frame-ancestors SELF',
].join('; ');

const sha256 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(out, rel))).digest('hex');
const vendor = {
  name: 'excalidraw-frame',
  packages: Object.fromEntries(Object.keys(pkg.dependencies).map((n) => [n, { version: lock.packages[`node_modules/${n}`].version, integrity: lock.packages[`node_modules/${n}`].integrity }])),
  esbuild: lock.packages['node_modules/esbuild'].version,
  csp,
  files: Object.fromEntries(walk(out).sort().map((f) => [f, sha256(f)])),
};
fs.writeFileSync(path.join(out, 'VENDOR.json'), `${JSON.stringify(vendor, null, 1)}\n`);

const size = Object.keys(vendor.files).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log(`public/vendor/excalidraw: ${Object.keys(vendor.files).length} files, ${(size / 1024 / 1024).toFixed(1)} MB (${bundled.size} packages bundled)`);
