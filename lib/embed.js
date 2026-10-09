'use strict';
// The margin's local model (Settings → The margin understands): a small
// multilingual model that reads every paragraph as a vector, so a paragraph
// meets the ones about the same thing in other words or another language.
// It runs in a worker thread (lib/embed-worker.mjs, with helpers while it
// has much to read: lib/embed-reader.mjs) on this device; your
// notes are never sent. Turning it on downloads it once (149 MB: the model
// at a fixed revision from Hugging Face, and ONNX Runtime's WebAssembly from
// jsDelivr, the version shipped in lib/vendor/embed), each file checked
// against the SHA-256 in lib/vendor/embed/VENDOR.json before it is used.
// It is kept for every folder in the app's data (models/), the vectors of a
// folder's paragraphs in its .agent-notes/embed/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const VENDOR = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor', 'embed', 'VENDOR.json'), 'utf8'));
const MODEL_ID = 'multilingual-e5-small-int8';

// Where the app keeps its data (Electron's userData for "Margin").
function appDataDir() {
  if (process.env.AGENT_NOTES_USER_DATA) return path.resolve(process.env.AGENT_NOTES_USER_DATA);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Margin');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Margin');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Margin');
}

function createEmbed({ dataDir, modelsDir = process.env.MARGIN_MODELS_DIR || path.join(appDataDir(), 'models') }) {
  const dir = path.join(modelsDir, MODEL_ID);
  const size = VENDOR.downloads.reduce((n, d) => n + d.size, 0);
  const st = { on: false, state: 'off', got: 0, done: 0, total: 0, error: '' };
  let worker = null;
  let ready = false;
  let seen = new Map(); // path → v, as the worker has it
  let downloading = null;
  let asked = 0;
  const waiting = new Map();

  // Present when each file is there at its size (checked in full when downloaded).
  const present = () => VENDOR.downloads.every((d) => { try { return fs.statSync(path.join(dir, d.file)).size === d.size; } catch { return false; } });

  function status() {
    let state = st.state;
    if (downloading) state = 'downloading';
    else if (!present()) state = 'missing';
    else if (!st.on) state = 'off';
    return { state, on: st.on, size, got: st.got, done: st.done, total: st.total, error: st.error, model: VENDOR.model.name };
  }

  async function download() {
    if (downloading) return downloading;
    st.error = '';
    st.got = 0;
    downloading = (async () => {
      fs.mkdirSync(dir, { recursive: true });
      for (const d of VENDOR.downloads) {
        const file = path.join(dir, d.file);
        try { if (fs.statSync(file).size === d.size) { st.got += d.size; continue; } } catch { /* to get */ }
        // Not reached: which host, and why (a proxy, a certificate, a name not found), as the network said.
        const res = await fetch(d.url, { redirect: 'follow' }).catch((e) => {
          const c = e.cause || {};
          throw new Error(`${d.file}: could not reach ${new URL(d.url).host} (${[c.code, c.message].filter(Boolean).join(': ') || e.message})`);
        });
        if (!res.ok || !res.body) throw new Error(`${d.file}: HTTP ${res.status}`);
        const hash = crypto.createHash('sha256');
        const part = `${file}.part`;
        const out = fs.createWriteStream(part);
        let n = 0;
        try {
          for await (const chunk of res.body) {
            n += chunk.length;
            st.got += chunk.length;
            if (n > d.size) throw new Error(`${d.file}: larger than expected`);
            hash.update(chunk);
            if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          }
          await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
        } catch (e) {
          out.destroy();
          fs.rmSync(part, { force: true });
          throw e;
        }
        if (n !== d.size || hash.digest('hex') !== d.sha256) {
          fs.rmSync(part, { force: true });
          throw new Error(`${d.file}: not the file expected (its checksum differs); nothing was kept`);
        }
        fs.renameSync(part, file);
      }
    })().catch((e) => { st.error = e.message; }).finally(() => {
      downloading = null;
      if (st.on && !st.error) start();
    });
    return downloading;
  }

  function remove() {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
    try { fs.rmSync(path.join(dataDir, `${MODEL_ID}.bin`), { force: true }); } catch { /* none */ }
  }

  function start() {
    if (worker || !present()) return;
    st.state = 'loading';
    st.error = '';
    ready = false;
    seen = new Map();
    worker = new Worker(path.join(__dirname, 'embed-worker.mjs'), {
      workerData: { modelDir: dir, cacheFile: path.join(dataDir, `${MODEL_ID}.bin`), passage: VENDOR.model.passage, query: VENDOR.model.query, dims: VENDOR.model.dims },
    });
    worker.on('message', (m) => {
      if (m.type === 'ready') { ready = true; st.state = 'indexing'; pending?.(); }
      else if (m.type === 'progress') { st.done = m.done; st.total = m.total; st.state = m.done >= m.total ? 'ready' : 'indexing'; }
      else if (m.type === 'near') { waiting.get(m.id)?.(m); waiting.delete(m.id); }
      else if (m.type === 'error') { st.error = m.message; }
    });
    worker.on('error', (e) => { st.error = e.message; });
    worker.on('exit', () => {
      worker = null;
      ready = false;
      if (st.state !== 'off') st.state = 'error';
      for (const [, done] of waiting) done(null);
      waiting.clear();
    });
  }
  function stop() {
    st.state = 'off';
    if (worker) worker.terminate();
    worker = null;
    ready = false;
  }
  function setOn(on) {
    st.on = !!on;
    if (st.on) start();
    else stop();
    return status();
  }

  // The notes as they are: those changed (or new) since last time go to the worker.
  let pending = null;
  let latest = [];
  function sync(notes) {
    latest = notes;
    if (!worker) return;
    if (!ready) { pending = () => { pending = null; sync(latest); }; return; }
    const now = new Map(notes.map((n) => [n.path, n.v]));
    const changed = notes.filter((n) => seen.get(n.path) !== n.v);
    const drop = [...seen.keys()].filter((p) => !now.has(p));
    if (!changed.length && !drop.length) return;
    seen = now;
    worker.postMessage({ type: 'sync', notes: changed.map(({ path: p, v, text }) => ({ path: p, v, text })), drop });
  }

  // The paragraphs of other notes nearest each text (null when it can't say
  // yet); only: the notes it may find them in (the others aren't measured).
  function near(p, texts, only = null) {
    if (!worker || !ready) return Promise.resolve(null);
    const id = ++asked;
    return new Promise((done) => {
      const timer = setTimeout(() => { waiting.delete(id); done(null); }, 30000);
      waiting.set(id, (m) => { clearTimeout(timer); done(m); });
      worker.postMessage({ type: 'near', id, path: p, texts, ...(only ? { only } : {}) });
    });
  }

  return { status, download, remove, setOn, sync, near, stop };
}

module.exports = { createEmbed, appDataDir, MODEL_ID };
