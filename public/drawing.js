// Excalidraw drawings (.excalidraw, and Obsidian's .excalidraw.md read-only).
//
// The editor is a vendored bundle (public/vendor/excalidraw, built by
// vendor/excalidraw/build.mjs) that runs in a sandboxed iframe: an opaque
// origin with scripts only — no access to this page, the session token or
// the notes API, no popups, downloads or navigation, and a Content-Security-
// Policy that allows no network beyond the app's own files. It is loaded only
// when a drawing is opened or embedded. Files are read and written here and
// passed to the frame as text over postMessage.
//
// Iframes reload when moved in the DOM, so each drawing's frame lives in a
// fixed layer and is positioned over its tab's slot (see placeFrames()).

const FRAME_URL = '/vendor/excalidraw/frame.html';

export const isDrawing = (p) => /\.excalidraw(\.md)?$/i.test(p || '');
export const drawingFormat = (p) => (/\.md$/i.test(p) ? 'obsidian' : 'excalidraw');

let layer = null;
function frameLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'drawing-layer';
    document.body.append(layer);
  }
  return layer;
}

let seq = 0;

export class DrawingFrame {
  // init: the first message (mode, text, format, …); onMessage(msg) gets the rest.
  constructor(init, onMessage, { hidden = false } = {}) {
    this.init = init;
    this.onMessage = onMessage;
    this.pending = new Map();
    this.ready = false;
    this.queue = [];
    const f = document.createElement('iframe');
    f.className = `drawing-frame${hidden ? ' offscreen' : ''}`;
    f.setAttribute('sandbox', 'allow-scripts');
    // Excalidraw's own "Copy to clipboard as PNG/SVG" and element copy: writing only.
    f.setAttribute('allow', 'clipboard-write');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('title', 'Excalidraw drawing');
    f.src = FRAME_URL;
    if (!hidden) f.style.display = 'none';
    this.el = f;
    this.listener = (e) => this.receive(e);
    window.addEventListener('message', this.listener);
    frameLayer().append(f);
  }

  receive(e) {
    if (e.source !== this.el.contentWindow || e.data?.margin !== 'excalidraw') return;
    const m = e.data;
    if (m.type === 'ready') {
      this.post({ type: 'init', ...this.init });
      return;
    }
    if (m.type === 'loaded') {
      this.ready = true;
      for (const q of this.queue.splice(0)) this.post(q);
    }
    if (m.id != null && this.pending.has(m.id)) {
      const { resolve, reject, timer } = this.pending.get(m.id);
      clearTimeout(timer);
      this.pending.delete(m.id);
      if (m.type === 'error') reject(new Error(m.message)); else resolve(m);
      return;
    }
    this.onMessage?.(m);
  }

  post(msg) {
    if (!this.ready && msg.type !== 'init') { this.queue.push(msg); return; }
    this.el.contentWindow?.postMessage(msg, '*'); // the frame's origin is opaque
  }

  request(msg, ms = 20000) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The drawing did not answer')); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ ...msg, id });
    });
  }

  // Show over `slot` (an element in the page), or hide when slot is null.
  place(slot) {
    const s = this.el.style;
    if (!slot || !slot.isConnected) { s.display = 'none'; return; }
    const r = slot.getBoundingClientRect();
    if (!r.width || !r.height) { s.display = 'none'; return; }
    Object.assign(s, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }

  destroy() {
    window.removeEventListener('message', this.listener);
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('Closed')); }
    this.pending.clear();
    this.el.remove();
  }
}

// ---------------------------------------------------------------- embeds

// One hidden frame renders ![[drawing.excalidraw]] embeds to SVG images.
// Images are cached per file content, and the last one per path is kept so
// re-rendering a note while typing shows it at once.
let renderer = null;
const svgCache = new Map(); // `${dark}|${hash}` -> data URL
const lastByPath = new Map(); // `${dark}|${path}` -> data URL
let chain = Promise.resolve();

function svgFor(text, format, dark, key) {
  if (svgCache.has(key)) return Promise.resolve(svgCache.get(key));
  if (!renderer) renderer = new DrawingFrame({ mode: 'render' }, null, { hidden: true });
  const job = chain.then(async () => {
    const r = await renderer.request({ type: 'render', text, format, dark });
    const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(r.svg)))}`;
    if (svgCache.size > 100) svgCache.delete(svgCache.keys().next().value);
    svgCache.set(key, url);
    return url;
  });
  chain = job.catch(() => {});
  return job;
}

// A drawing file as an SVG data URL in its own (light) colours — what copying
// from the drawing itself gives, whatever the app's theme.
export async function drawingImageUrl(path, { readFile }) {
  const f = await readFile(path);
  return svgFor(f.content, drawingFormat(path), false, `false|${f.hash}`);
}

export const cachedEmbed = (path, dark) => lastByPath.get(`${dark}|${path}`) || null;
export function forgetEmbed(path) { lastByPath.delete(`true|${path}`); lastByPath.delete(`false|${path}`); }

// Fill every .drawing-embed[data-path] in `root` that has no image yet.
// readFile(path) → { content, hash }.
export async function renderDrawingEmbeds(root, { readFile, dark }) {
  for (const el of [...root.querySelectorAll('.drawing-embed[data-path]:not(.ready)')]) {
    const p = el.dataset.path;
    try {
      const f = await readFile(p);
      const url = await svgFor(f.content, drawingFormat(p), dark, `${dark}|${f.hash}`);
      lastByPath.set(`${dark}|${p}`, url);
      if (!el.isConnected) continue;
      const img = document.createElement('img');
      img.src = url;
      img.alt = el.dataset.label || p;
      el.replaceChildren(img);
      el.classList.add('ready');
    } catch (e) {
      if (el.isConnected) { el.textContent = `▣ ${p}: ${e.message}`; el.classList.add('error'); }
    }
  }
}
