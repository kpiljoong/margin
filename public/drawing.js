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
const svgCache = new Map(); // `${dark}|${hash}` -> { url, frames }
const lastByPath = new Map(); // `${dark}|${path}` -> data URL
let chain = Promise.resolve();
const svgUrl = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

// One render in the hidden frame, after those asked for before it.
function renderOne(msg) {
  if (!renderer) renderer = new DrawingFrame({ mode: 'render' }, null, { hidden: true });
  const job = chain.then(() => renderer.request({ type: 'render', ...msg }));
  chain = job.catch(() => {});
  return job;
}

// → { url, frames }: frames [{ id, name, x, y, w, h }] are where the
// drawing's frames are in the picture, as fractions of its size.
function pictureFor(text, format, dark, key) {
  if (svgCache.has(key)) return Promise.resolve(svgCache.get(key));
  return renderOne({ text, format, dark }).then((r) => {
    const frames = (r.frames || []).map((f) => ({ id: f.id, name: f.name, x: f.x / r.width, y: f.y / r.height, w: f.w / r.width, h: f.h / r.height }));
    const pic = { url: svgUrl(r.svg), frames };
    if (svgCache.size > 100) svgCache.delete(svgCache.keys().next().value);
    svgCache.set(key, pic);
    return pic;
  });
}
const svgFor = (text, format, dark, key) => pictureFor(text, format, dark, key).then((p) => p.url);

// A drawing as pages to present: each frame alone (in presenting order,
// see framesOf in the frame), or the whole drawing when it has none.
// → [{ name, url, whole? }]
export async function drawingSlides(text, format, dark) {
  const whole = await renderOne({ text, format, dark });
  if (!whole.frames?.length) return [{ name: '', url: svgUrl(whole.svg), whole: true }];
  const slides = [];
  for (const f of whole.frames) {
    const r = await renderOne({ text, format, dark, frame: f.id });
    slides.push({ name: f.name, url: svgUrl(r.svg) });
  }
  return slides;
}

// A drawing file as an SVG data URL in its own (light) colours — what copying
// from the drawing itself gives, whatever the app's theme.
export async function drawingImageUrl(path, { readFile }) {
  const f = await readFile(path);
  return svgFor(f.content, drawingFormat(path), false, `false|${f.hash}`);
}

export const cachedEmbed = (path, dark) => lastByPath.get(`${dark}|${path}`) || null;
export function forgetEmbed(path) { lastByPath.delete(`true|${path}`); lastByPath.delete(`false|${path}`); framesByPath.delete(path); }
// The frames of an embedded drawing as last shown (see pictureFor), for
// presenting it a frame at a time.
const framesByPath = new Map();
export const embedFrames = (path) => framesByPath.get(path) || [];

// Fill every .drawing-embed[data-path] in `root` that has no image yet.
// readFile(path) → { content, hash }.
export async function renderDrawingEmbeds(root, { readFile, dark }) {
  for (const el of [...root.querySelectorAll('.drawing-embed[data-path]:not(.ready)')]) {
    const p = el.dataset.path;
    try {
      const f = await readFile(p);
      const { url, frames } = await pictureFor(f.content, drawingFormat(p), dark, `${dark}|${f.hash}`);
      lastByPath.set(`${dark}|${p}`, url);
      framesByPath.set(p, frames);
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
