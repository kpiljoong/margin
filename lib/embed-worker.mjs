// The margin's local model, in a worker thread of the server (lib/embed.js):
// every note's paragraphs as vectors (multilingual-e5-small, int8, on the
// CPU through ONNX Runtime's WebAssembly; nothing is sent anywhere), kept
// in the workspace's .agent-notes/embed/ so a paragraph is read once; and,
// for the paragraphs of the note being written, the nearest of the others.
//
// Messages in:  { type: 'sync', notes: [{ path, v, text }], drop: [path] }
//               { type: 'near', id, path, texts }
// Messages out: { type: 'ready' } · { type: 'progress', done, total }
//               { type: 'near', id, results: [[{ path, line, s, z }]], n }
//               { type: 'error', message }
import { parentPort, workerData } from 'node:worker_threads';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { modelDir, cacheFile, passage, query, dims } = workerData;
const MAX_TOKENS = 128;
const BATCH = 8;

let ort;
let tok;
let session;
let parasOf;
let paraWorthy;
try {
  ort = await import('./vendor/embed/ort.wasm.mjs');
  const { Tokenizer } = await import('./vendor/embed/tokenizers.mjs');
  ({ parasOf, paraWorthy } = await import('../public/recall.js'));
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = fs.readFileSync(path.join(modelDir, 'ort-wasm-simd-threaded.wasm'));
  session = await ort.InferenceSession.create(fs.readFileSync(path.join(modelDir, 'model_int8.onnx')));
  tok = new Tokenizer(JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer_config.json'), 'utf8')));
} catch (e) {
  parentPort.postMessage({ type: 'error', message: `The model didn't load: ${e.message}` });
  throw e;
}

// ---- vectors, by what they were made from (sha1 of the text read, as a
// passage — a paragraph kept — or a query — one asked about), kept
// as int8 (records of 20 + dims bytes) and used as Float32 at length one.
const keyOf = (prefix, text) => crypto.createHash('sha1').update(prefix + text).digest();
const vecs = new Map(); // key hex → Float32Array
const unpack = (q) => { const v = new Float32Array(dims); let n = 0; for (let i = 0; i < dims; i++) { v[i] = q[i] / 127; n += v[i] * v[i]; } n = Math.sqrt(n) || 1; for (let i = 0; i < dims; i++) v[i] /= n; return v; };
try {
  const b = fs.readFileSync(cacheFile);
  const rec = 20 + dims;
  for (let o = 0; o + rec <= b.length; o += rec) vecs.set(b.toString('hex', o, o + 20), unpack(new Int8Array(b.buffer, b.byteOffset + o + 20, dims)));
} catch { /* none yet */ }
let dirty = false;
let saving = null;
// Written a while after it changed, at once when every note is read (and
// only what is still in a note, or asked lately).
function save(now = false) {
  dirty = true;
  if (now) clearTimeout(saving);
  else if (saving) return;
  saving = setTimeout(() => {
    saving = null;
    if (!dirty) return;
    dirty = false;
    const keep = new Set([...recent.keys()]);
    for (const n of notes.values()) for (const p of n.paras) keep.add(p.key);
    const rec = 20 + dims;
    const out = Buffer.alloc(keep.size * rec);
    let o = 0;
    for (const k of keep) {
      const v = vecs.get(k);
      if (!v) continue;
      out.write(k, o, 'hex');
      for (let i = 0; i < dims; i++) out.writeInt8(Math.max(-127, Math.min(127, Math.round(v[i] * 127))), o + 20 + i);
      o += rec;
    }
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(`${cacheFile}.tmp`, out.subarray(0, o));
      fs.renameSync(`${cacheFile}.tmp`, cacheFile);
    } catch { /* tried again at the next change */ }
  }, now ? 0 : 10000);
}

async function embed(prefix, texts) {
  const enc = texts.map((s) => {
    const ids = tok.encode(prefix + s, { add_special_tokens: true }).ids;
    return ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), ids[ids.length - 1]] : ids;
  });
  const L = Math.max(...enc.map((e) => e.length));
  const ids = new BigInt64Array(texts.length * L);
  const mask = new BigInt64Array(texts.length * L);
  enc.forEach((e, i) => e.forEach((t, j) => { ids[i * L + j] = BigInt(t); mask[i * L + j] = 1n; }));
  const shape = [texts.length, L];
  const feeds = { input_ids: new ort.Tensor('int64', ids, shape), attention_mask: new ort.Tensor('int64', mask, shape) };
  if (session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(texts.length * L), shape);
  const out = (await session.run(feeds))[session.outputNames[0]];
  const D = out.dims[2];
  // The mean of its tokens, at length one.
  return enc.map((e, i) => {
    const v = new Float32Array(D);
    for (let j = 0; j < e.length; j++) for (let d = 0; d < D; d++) v[d] += out.data[(i * L + j) * D + d];
    let n = 0;
    for (let d = 0; d < D; d++) n += v[d] * v[d];
    n = Math.sqrt(n) || 1;
    for (let d = 0; d < D; d++) v[d] /= n;
    return v;
  });
}

// ---- the notes: path → { v, paras: [{ line, key }] }; what is still to be read.
const notes = new Map();
const todo = new Map(); // key → text, the newest notes' first
const recent = new Map(); // texts asked about lately: key → time
function sync({ notes: list = [], drop = [] }) {
  for (const p of drop) notes.delete(p);
  for (const n of list) {
    const paras = parasOf(n.text).filter((p) => paraWorthy(p.text)).map((p) => {
      const t = p.text.slice(0, 2000);
      const key = keyOf(passage, t).toString('hex');
      if (!vecs.has(key)) todo.set(key, t);
      return { line: p.line, key };
    });
    notes.set(n.path, { v: n.v, paras });
  }
  progress();
  pump();
}
let total = 0;
function progress() {
  let all = 0;
  for (const n of notes.values()) all += n.paras.length;
  total = all;
  parentPort.postMessage({ type: 'progress', done: Math.max(0, all - todo.size), total: all });
}

// Questions first; the notes in batches between them.
const asked = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (asked.length || todo.size) {
      if (asked.length) { await answer(asked.shift()); continue; }
      const batch = [...todo].slice(0, BATCH);
      const vs = await embed(passage, batch.map(([, t]) => t));
      batch.forEach(([k], i) => { vecs.set(k, vs[i]); todo.delete(k); });
      save(!todo.size);
      progress();
      await new Promise((r) => setImmediate(r));
    }
  } catch (e) {
    parentPort.postMessage({ type: 'error', message: e.message });
  } finally {
    busy = false;
  }
}

// The paragraphs of other notes nearest each text: the best of each note,
// the 6 best, with s (cosine) and z (how far above that text's usual
// nearness to all of them: from their median, in robust standard deviations
// — 1.4826 × the median distance from it — so a few notes about the same
// thing don't hide each other).
async function answer({ id, path: here, texts }) {
  const keys = texts.map((t) => keyOf(query, t.slice(0, 2000)).toString('hex'));
  const missing = [...new Set(keys.filter((k) => !vecs.has(k)))];
  for (let i = 0; i < missing.length; i += BATCH) {
    const part = missing.slice(i, i + BATCH);
    const vs = await embed(query, part.map((k) => texts[keys.indexOf(k)].slice(0, 2000)));
    part.forEach((k, j) => vecs.set(k, vs[j]));
  }
  const now = Date.now();
  for (const k of keys) recent.set(k, now);
  if (recent.size > 2000) for (const [k] of [...recent].sort((a, b) => a[1] - b[1]).slice(0, recent.size - 2000)) recent.delete(k);
  if (missing.length) save();
  const pool = [];
  for (const [p, n] of notes) if (p !== here) for (const x of n.paras) { const v = vecs.get(x.key); if (v) pool.push([p, x.line, v]); }
  const results = keys.map((k) => {
    const q = vecs.get(k);
    if (!q || pool.length < 2) return [];
    const s = new Float32Array(pool.length);
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i][2];
      let d = 0;
      for (let j = 0; j < dims; j++) d += q[j] * v[j];
      s[i] = d;
    }
    const mean = Float32Array.from(s).sort()[pool.length >> 1];
    const sd = Math.max(1e-4, 1.4826 * s.map((d) => Math.abs(d - mean)).sort()[pool.length >> 1]);
    const best = new Map();
    for (let i = 0; i < pool.length; i++) if (!best.has(pool[i][0]) || s[best.get(pool[i][0])] < s[i]) best.set(pool[i][0], i);
    return [...best.values()].sort((a, b) => s[b] - s[a]).slice(0, 6)
      .map((i) => ({ path: pool[i][0], line: pool[i][1], s: Math.round(s[i] * 1000) / 1000, z: Math.round(((s[i] - mean) / sd) * 100) / 100 }));
  });
  parentPort.postMessage({ type: 'near', id, results, n: pool.length });
}

parentPort.on('message', (m) => {
  if (m.type === 'sync') sync(m);
  else if (m.type === 'near') { asked.push(m); pump(); }
});
parentPort.postMessage({ type: 'ready' });
