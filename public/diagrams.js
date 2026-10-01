// Mermaid diagrams in rendered Markdown. The library is bundled with the app
// (public/vendor/mermaid) and loaded only when a note contains a diagram, so
// nothing leaves the machine and notes without diagrams pay nothing.
//
// Mermaid runs in a hidden, sandboxed iframe (public/mermaid-frame.html, an
// opaque origin with its own CSP), not in this page: it never sees the app or
// its token, and it may style the elements it measures. Each diagram comes
// back as SVG text and is shown as an <img>: an image document can't run
// script or load resources.

import { parseFlow } from './flow.js';

const FRAME_URL = '/mermaid-frame.html';
const cache = new Map(); // theme key + source -> { url } | { error }
const lastByContainer = new WeakMap(); // container -> [url] shown while re-rendering
let themeKey = '';
let queue = Promise.resolve();
let seq = 0;

// The renderer frame, made on first use. Resolves once Mermaid has loaded.
let frame = null;
function renderer() {
  if (frame) return frame.ready;
  const el = document.createElement('iframe');
  el.className = 'mermaid-frame';
  el.setAttribute('sandbox', 'allow-scripts');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  el.src = FRAME_URL;
  const f = { el, pending: new Map() };
  frame = f;
  f.ready = new Promise((resolve, reject) => {
    const fail = () => { if (frame === f) frame = null; window.removeEventListener('message', listener); el.remove(); reject(new Error('Mermaid could not be loaded')); };
    const timer = setTimeout(fail, 20000);
    const listener = (e) => {
      if (e.source !== el.contentWindow || e.data?.margin !== 'mermaid') return;
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(timer); resolve(); return; }
      const p = f.pending.get(m.id);
      if (p) { f.pending.delete(m.id); p(m); }
    };
    window.addEventListener('message', listener);
  });
  document.body.append(el);
  return f.ready;
}

function renderInFrame(source, config) {
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { frame?.pending.delete(id); resolve({ error: 'The diagram took too long to draw' }); }, 20000);
    frame.pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    frame.el.contentWindow.postMessage({ type: 'render', id, source, config }, '*');
  });
}

function luminance(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = color;
  const hex = c.fillStyle; // normalised to #rrggbb
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return 0;
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// Follow the app theme: read its CSS variables into mermaid's "base" theme.
function currentTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(`--${k}`).trim();
  const vars = {
    darkMode: luminance(v('bg')) < 0.5,
    background: v('bg'),
    mainBkg: v('bg-3'),
    primaryColor: v('bg-3'),
    primaryTextColor: v('fg'),
    primaryBorderColor: v('accent'),
    secondaryColor: v('bg-2'),
    tertiaryColor: v('bg-2'),
    lineColor: v('fg-dim'),
    textColor: v('fg'),
    edgeLabelBackground: v('bg'),
    clusterBkg: v('bg-2'),
    noteBkgColor: v('bg-2'),
    noteTextColor: v('fg'),
    fontFamily: v('sans') || 'sans-serif',
    fontSize: '15px',
  };
  return { key: JSON.stringify(vars), vars };
}

async function renderOne(source, config) {
  const r = await renderInFrame(source, config);
  if (r.svg) return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`, nodes: Array.isArray(r.nodes) ? r.nodes : [] };
  return { error: String(r.error || '').split('\n').filter(Boolean).slice(0, 3).join('\n') || 'Invalid diagram' };
}

// Pictures drawn before are kept on disk (IndexedDB) too, so after a restart a
// note full of diagrams shows at once instead of being drawn one by one. Only
// pictures, not errors; the oldest go once there are more than DISK_MAX.
const DISK_VERSION = 1; // bump when the pictures would come out differently
const DISK_MAX = 600;
let disk = null;
function openDisk() {
  if (disk) return disk;
  disk = new Promise((resolve) => {
    try {
      const r = indexedDB.open('margin-diagrams', DISK_VERSION);
      r.onupgradeneeded = () => {
        for (const name of [...r.result.objectStoreNames]) r.result.deleteObjectStore(name);
        r.result.createObjectStore('pictures');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return disk;
}
async function diskGet(keys) {
  const db = await openDisk();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const st = db.transaction('pictures').objectStore('pictures');
      const out = [];
      keys.forEach((k, i) => { const r = st.get(k); r.onsuccess = () => { out[i] = r.result; }; });
      st.transaction.oncomplete = () => resolve(out);
      st.transaction.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}
let pruned = false;
async function diskPut(key, result) {
  const db = await openDisk();
  if (!db || !result.url) return;
  try {
    const st = db.transaction('pictures', 'readwrite').objectStore('pictures');
    st.put({ url: result.url, nodes: result.nodes, t: Date.now() }, key);
    if (pruned) return;
    pruned = true;
    // Once a session: drop the oldest beyond DISK_MAX.
    st.transaction.oncomplete = () => {
      const all = [];
      const tx = db.transaction('pictures', 'readwrite');
      tx.objectStore('pictures').openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (c) { all.push([c.key, c.value?.t || 0]); c.continue(); return; }
        if (all.length <= DISK_MAX) return;
        all.sort((a, b) => a[1] - b[1]);
        for (const [k] of all.slice(0, all.length - DISK_MAX)) tx.objectStore('pictures').delete(k);
      };
    };
  } catch { /* storage unavailable: drawn again next time */ }
}

function remember(ck, result) {
  cache.set(ck, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
}

// The ones on screen first, then outwards.
function byDistance(todo) {
  const vh = window.innerHeight;
  const dist = (pre) => { const r = pre.getBoundingClientRect(); return r.bottom < 0 ? -r.bottom : r.top > vh ? r.top - vh : 0; };
  return todo.map((t) => [t, dist(t.pre)]).sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

function show(pre, result, source) {
  pre.classList.remove('diagram-pending');
  pre.querySelector('.diagram-error')?.remove();
  if (result.error) {
    pre.classList.remove('diagram');
    pre.replaceChildren(Object.assign(document.createElement('code'), { textContent: source }));
    pre.append(Object.assign(document.createElement('div'), { className: 'diagram-error', textContent: `Diagram error: ${result.error}` }));
    return;
  }
  const img = Object.assign(document.createElement('img'), { src: result.url, alt: 'Mermaid diagram', title: 'Mermaid diagram — right-click to copy as an image' });
  img.draggable = false;
  pre.classList.add('diagram');
  // Copy as image (handled by the app, which also offers it on right-click).
  const copy = Object.assign(document.createElement('button'), { className: 'diagram-copy', type: 'button', title: 'Copy as image (PNG)', textContent: '⧉' });
  pre.replaceChildren(img, copy);
  // Where its boxes are (fractions of the picture), for the canvas view.
  pre.diagramNodes = result.nodes || [];
  pre.dispatchEvent(new CustomEvent('diagram-shown', { bubbles: true }));
}

// Replace ```mermaid blocks inside `container` with rendered diagrams.
// Cached diagrams appear synchronously, so re-rendering the preview while
// typing elsewhere does not flicker. Resolves when every diagram is done.
export function renderDiagrams(container) {
  const blocks = [...container.querySelectorAll('pre[data-lang="mermaid" i], pre[data-lang="flow" i]')];
  if (!blocks.length) return Promise.resolve();
  const theme = currentTheme();
  themeKey = theme.key;
  const previous = lastByContainer.get(container) || [];
  const shown = [];
  const todo = [];
  blocks.forEach((pre, i) => {
    // Remember the source: once rendered, the block holds the picture instead.
    const raw = pre.dataset.source ?? (pre.dataset.source = pre.textContent);
    // ```flow blocks are a simpler notation for flowcharts (public/flow.js).
    let source = raw;
    if (/^flow$/i.test(pre.dataset.lang)) {
      try {
        const flow = parseFlow(raw);
        source = flow.mermaid;
        pre.flowNodes = flow.nodes; // which lines wrote each box
        pre.flowEdges = flow.edges; // for following the flow on the canvas
      } catch (e) { show(pre, { error: e.message }, raw); return; }
    }
    const hit = cache.get(themeKey + '\n' + source);
    if (hit) { show(pre, hit, raw); shown[i] = hit.url; return; }
    // While a changed diagram re-renders, keep showing the last picture.
    if (previous[i]) {
      pre.classList.add('diagram', 'diagram-pending');
      pre.replaceChildren(Object.assign(document.createElement('img'), { src: previous[i], alt: 'Mermaid diagram (updating)' }));
      shown[i] = previous[i];
    }
    todo.push({ pre, source, raw, i });
  });
  lastByContainer.set(container, shown);
  if (!todo.length) return Promise.resolve();
  const key = themeKey;
  const ordered = todo.length > 1 ? byDistance(todo) : todo;
  const job = queue.then(async () => {
    // Drawn in an earlier session?
    const kept = await diskGet(ordered.map(({ source }) => key + '\n' + source));
    const left = [];
    ordered.forEach((t, n) => {
      const hit = kept[n];
      if (!hit?.url) { left.push(t); return; }
      const result = { url: hit.url, nodes: Array.isArray(hit.nodes) ? hit.nodes : [] };
      remember(key + '\n' + t.source, result);
      show(t.pre, result, t.raw);
      shown[t.i] = result.url;
    });
    if (!left.length) return;
    await renderer();
    const config = mermaidConfig(theme.vars);
    for (const { pre, source, raw, i } of left) {
      const ck = key + '\n' + source;
      let result = cache.get(ck);
      if (!result) {
        // Skip work for previews that were re-rendered in the meantime.
        if (pre.isConnected === false && container.isConnected) continue;
        result = await renderOne(source, config);
        remember(ck, result);
        diskPut(ck, result);
      }
      show(pre, result, raw);
      if (result.url) shown[i] = result.url;
    }
  }).catch((err) => {
    for (const { pre } of todo) {
      pre.classList.remove('diagram-pending');
      if (!pre.querySelector('.diagram-error')) pre.append(Object.assign(document.createElement('div'), { className: 'diagram-error', textContent: String(err.message || err) }));
    }
  });
  queue = job;
  return job;
}

function mermaidConfig(vars) {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: vars,
    fontFamily: vars.fontFamily,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  };
}
