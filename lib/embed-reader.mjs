// A helper of the local model's worker (lib/embed-worker.mjs), there while
// a folder has many paragraphs to read: its own copy of the model, reading
// the batches it is given.
//
// Messages in:  { id, prefix, texts }
// Messages out: { type: 'ready' } · { id, vecs: [Float32Array] } · { id, error }
import { parentPort, workerData } from 'node:worker_threads';
import { loadModel } from './embed-model.mjs';

const { embed } = await loadModel(workerData.modelDir);
parentPort.on('message', async ({ id, prefix, texts }) => {
  try {
    const vecs = await embed(prefix, texts);
    parentPort.postMessage({ id, vecs }, vecs.map((v) => v.buffer));
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
parentPort.postMessage({ type: 'ready' });
