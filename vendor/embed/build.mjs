// Builds lib/vendor/embed from the pinned packages in this folder: the
// runtime and the tokenizer of the margin's local model (lib/embed.js).
//
//   cd vendor/embed && npm ci --ignore-scripts && node build.mjs
//
// Output: the two files as published (ONNX Runtime Web's WebAssembly build,
// its loader bundled in; Tokenizers.js), third-party licenses, and
// VENDOR.json with the exact versions, a SHA-256 of every file and what is
// downloaded when the model is turned on (each checked against its SHA-256
// before use): the runtime's WebAssembly, the same version as the loader,
// and the model (multilingual-e5-small, int8) at a fixed revision.
// build/check-vendor.js verifies the folder against it.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../lib/vendor/embed');
const nm = path.join(here, 'node_modules');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(here, 'package-lock.json'), 'utf8'));

// Everything must be installed exactly as pinned.
for (const [name, version] of Object.entries(pkg.dependencies)) {
  const entry = lock.packages[`node_modules/${name}`];
  const installed = JSON.parse(fs.readFileSync(path.join(nm, name, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || entry?.version !== version || installed !== version) {
    throw new Error(`${name}: pinned ${version}, lock ${entry?.version}, installed ${installed}. Run npm ci.`);
  }
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ORT = pkg.dependencies['onnxruntime-web'];
const wasm = fs.readFileSync(path.join(nm, 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'));

// The model: intfloat/multilingual-e5-small (MIT), as ONNX by Xenova, int8.
const MODEL = 'Xenova/multilingual-e5-small';
const REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const hf = (file) => `https://huggingface.co/${MODEL}/resolve/${REVISION}/${file}`;
const downloads = [
  { file: 'ort-wasm-simd-threaded.wasm', url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist/ort-wasm-simd-threaded.wasm`, size: wasm.length, sha256: sha256(wasm) },
  { file: 'model_int8.onnx', url: hf('onnx/model_int8.onnx'), size: 118054593, sha256: '4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c' },
  { file: 'tokenizer.json', url: hf('tokenizer.json'), size: 17082730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
  { file: 'tokenizer_config.json', url: hf('tokenizer_config.json'), size: 443, sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' },
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = {};
const put = (name, data) => { fs.writeFileSync(path.join(out, name), data); files[name] = sha256(data); };
put('ort.wasm.mjs', fs.readFileSync(path.join(nm, 'onnxruntime-web/dist/ort.wasm.bundle.min.mjs')));
put('tokenizers.mjs', fs.readFileSync(path.join(nm, '@huggingface/tokenizers/dist/tokenizers.mjs')));

const MIT = (who) => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
put('THIRD-PARTY-LICENSES.txt', [
  `onnxruntime-web ${ORT} (ort.wasm.mjs, and ort-wasm-simd-threaded.wasm when downloaded)\n\n${MIT('Microsoft Corporation')}`,
  `@huggingface/tokenizers ${pkg.dependencies['@huggingface/tokenizers']} (tokenizers.mjs)\n\nApache License 2.0\n\n${fs.readFileSync(path.join(nm, '@huggingface/tokenizers/LICENSE'), 'utf8')}`,
  `multilingual-e5-small (downloaded when turned on: ${MODEL}@${REVISION}, from intfloat/multilingual-e5-small)\n\n${MIT('2023 intfloat')}`,
].join(`\n${'-'.repeat(78)}\n\n`));

const vendor = {
  name: 'embed',
  packages: Object.fromEntries(Object.entries(pkg.dependencies).map(([name, version]) => [name, { version, integrity: lock.packages[`node_modules/${name}`].integrity }])),
  // e5 reads a paragraph kept as a passage, one asked about as a query.
  model: { name: MODEL, revision: REVISION, dims: 384, passage: 'passage: ', query: 'query: ' },
  downloads,
  files,
};
fs.writeFileSync(path.join(out, 'VENDOR.json'), `${JSON.stringify(vendor, null, 1)}\n`);
console.log(`lib/vendor/embed: ${Object.keys(files).length} files; downloads ${(downloads.reduce((n, d) => n + d.size, 0) / 1e6).toFixed(0)} MB when turned on`);
