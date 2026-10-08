// The local model itself (multilingual-e5-small, int8, on the CPU through
// ONNX Runtime's WebAssembly, one thread): loaded from where it was
// downloaded, it makes texts into vectors at length one. Used by the worker
// that keeps them (lib/embed-worker.mjs) and the helpers that read along
// (lib/embed-reader.mjs).
import fs from 'node:fs';
import path from 'node:path';

const MAX_TOKENS = 128;

export async function loadModel(modelDir) {
  const ort = await import('./vendor/embed/ort.wasm.mjs');
  const { Tokenizer } = await import('./vendor/embed/tokenizers.mjs');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary = fs.readFileSync(path.join(modelDir, 'ort-wasm-simd-threaded.wasm'));
  const session = await ort.InferenceSession.create(fs.readFileSync(path.join(modelDir, 'model_int8.onnx')));
  const tok = new Tokenizer(JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer_config.json'), 'utf8')));

  // prefix ("passage: " or "query: ") + each text → a Float32Array each.
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
  return { embed };
}
