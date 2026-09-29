// Margin's Excalidraw frame. It runs in a sandboxed iframe with an opaque
// origin: no access to the app, its token or the notes API. Everything goes
// through postMessage with the parent window, which reads and writes files.
//
// parent → frame  init {mode: 'edit'|'render', text, format, name, theme, view, readonly}
//                 load {text}            replace the scene (external change)
//                 theme {theme} · view {view}
//                 flush {id}             reply flushed {id, text|null} right away
//                 export {id, format: 'png'|'svg'}   selection (or all) → exported {id, blob|svg}
//                 render {id, text, format, dark}   (render mode) → svg {id, svg} | error {id, message}
// frame → parent  ready · loaded · change {text} · error {message} · link {url} · key {combo} · focus

import './asset-path.js';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, CaptureUpdateAction, restore, serializeAsJSON, exportToSvg, exportToBlob, getCommonBounds } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './frame.css';
import LZString from 'lz-string';

const post = (msg) => window.parent.postMessage({ margin: 'excalidraw', ...msg }, '*');

// .excalidraw is JSON; .excalidraw.md (Obsidian) keeps it in a fenced block,
// usually LZ-string compressed.
function parseScene(text, format) {
  let data;
  if (format === 'obsidian') {
    const packed = /```compressed-json[^\n]*\n([\s\S]*?)```/.exec(text);
    const plain = /```json[^\n]*\n([\s\S]*?)```/.exec(text);
    if (packed) {
      const json = LZString.decompressFromBase64(packed[1].replace(/\s+/g, ''));
      if (!json) throw new Error('The drawing data in this note is damaged.');
      data = JSON.parse(json);
    } else if (plain) data = JSON.parse(plain[1]);
    else throw new Error('No Excalidraw drawing found in this note.');
  } else {
    data = text.trim() ? JSON.parse(text) : { type: 'excalidraw', elements: [] };
  }
  if (!data || (data.type && data.type !== 'excalidraw')) throw new Error('This is not an Excalidraw drawing.');
  return restore(data, null, null);
}

// Shortcuts that belong to the app, not the drawing.
const FORWARD = new Set(['s', 'p', 'shift+p', 'w', ',', '\\', 'alt+\\', 'shift+f', 'shift+a', 'shift+enter']);
// Clicks here don't reach the app; tell it which pane is in use.
window.addEventListener('pointerdown', () => post({ type: 'focus' }), true);

window.addEventListener('keydown', (e) => {
  // ⇧⌥C: copy as PNG. The clipboard is written by the app (this frame has no access).
  if (e.shiftKey && e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyC') {
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'key', combo: 'copy-png' });
    return;
  }
  if (!(e.metaKey || e.ctrlKey)) return;
  const combo = `${e.shiftKey ? 'shift+' : ''}${e.altKey ? 'alt+' : ''}${e.key.toLowerCase()}`;
  if (!FORWARD.has(combo)) return;
  e.preventDefault();
  e.stopPropagation();
  post({ type: 'key', combo });
}, true);

function Editor({ init, bus }) {
  const [theme, setTheme] = useState(init.theme);
  const [view, setView] = useState(!!(init.view || init.readonly));
  const apiRef = useRef(null);
  const s = useRef({ touched: false, timer: null, dirty: false, scene: null }).current;

  // Only edits made here count as changes: opening a drawing never rewrites it.
  useEffect(() => {
    const touch = () => { s.touched = true; };
    for (const ev of ['pointerdown', 'keydown', 'paste', 'drop', 'wheel']) window.addEventListener(ev, touch, true);
    return () => { for (const ev of ['pointerdown', 'keydown', 'paste', 'drop', 'wheel']) window.removeEventListener(ev, touch, true); };
  }, []);

  // Show the whole drawing (with a margin, never enlarged past 100%) when it
  // opens and whenever the frame is resized — until the user zooms, scrolls or
  // draws. Frames of background tabs start hidden (0×0) and fit once shown.
  useEffect(() => {
    // After Excalidraw has taken the new size (its own resize handler).
    s.fit = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      const api = apiRef.current;
      if (s.touched || !window.innerWidth || !api) return;
      const elements = api.getSceneElements();
      if (!elements.length) return;
      // scrollToContent rounds the zoom down to 10% steps; fit exactly instead.
      const [x1, y1, x2, y2] = getCommonBounds(elements);
      const top = 64; // the toolbar floats over the top of the canvas
      const w = window.innerWidth;
      const h = window.innerHeight - top;
      const zoom = Math.max(0.1, Math.min(1, 0.9 * Math.min(w / Math.max(1, x2 - x1), h / Math.max(1, y2 - y1))));
      api.updateScene({
        appState: { zoom: { value: zoom }, scrollX: w / 2 / zoom - (x1 + x2) / 2, scrollY: (top + h / 2) / zoom - (y1 + y2) / 2 },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }));
    window.addEventListener('resize', s.fit);
    s.fit(); // the API usually arrives before this effect runs
    return () => window.removeEventListener('resize', s.fit);
  }, []);

  const serialize = () => {
    const { elements, appState, files } = s.scene;
    // Excalidraw reads the export source before asset-path.js runs (chunks are
    // evaluated first), so set it here rather than record the local port.
    const data = JSON.parse(serializeAsJSON(elements, appState, files, 'local'));
    data.source = window.EXCALIDRAW_EXPORT_SOURCE;
    return JSON.stringify(data, null, 2);
  };
  const flush = () => {
    clearTimeout(s.timer);
    if (!s.dirty) return null;
    s.dirty = false;
    return serialize();
  };

  useEffect(() => {
    bus.onMessage = (m) => {
      const api = apiRef.current;
      if (m.type === 'theme') setTheme(m.theme);
      else if (m.type === 'view') setView(!!m.view || !!init.readonly);
      else if (m.type === 'flush') post({ type: 'flushed', id: m.id, text: flush() });
      else if (m.type === 'export' && api) {
        exportSelection(api, m.format).then((r) => post({ type: 'exported', id: m.id, ...r }), (e) => post({ type: 'error', id: m.id, message: e.message }));
      }
      else if (m.type === 'load' && api) {
        try {
          const { elements, appState, files } = parseScene(m.text, init.format);
          clearTimeout(s.timer);
          s.dirty = false;
          s.touched = false;
          s.key = undefined;
          api.addFiles(Object.values(files || {}));
          api.updateScene({ elements, appState: { viewBackgroundColor: appState.viewBackgroundColor }, captureUpdate: CaptureUpdateAction.NEVER });
          api.history.clear();
        } catch (e) { post({ type: 'error', message: e.message }); }
      }
    };
  }, []);

  const onChange = (elements, appState, files) => {
    s.scene = { elements, appState, files };
    if (init.readonly) return;
    const key = `${elements.reduce((n, el) => n + el.version, 0)}|${elements.length}|${Object.keys(files).length}|${appState.viewBackgroundColor}|${appState.gridModeEnabled}`;
    // Until the user does something, changes are Excalidraw settling in (fonts, migrations).
    if (!s.touched || s.key === undefined) { s.key = key; return; }
    if (key === s.key) return;
    s.key = key;
    s.dirty = true;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { const text = flush(); if (text) post({ type: 'change', text }); }, 250);
  };

  return (
    <Excalidraw
      excalidrawAPI={(api) => { apiRef.current = api; s.fit?.(); }}
      initialData={{ ...init.scene, scrollToContent: true }}
      onChange={onChange}
      theme={theme}
      viewModeEnabled={view}
      name={init.name}
      langCode="en"
      aiEnabled={false}
      validateEmbeddable={false}
      handleKeyboardGlobally
      autoFocus
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: null } }}
      onLinkOpen={(el, ev) => { ev.preventDefault(); post({ type: 'link', url: el.link }); }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.DefaultItems.Help />
      </MainMenu>
    </Excalidraw>
  );
}

// The selected elements (or everything) as a PNG blob (2× scale) or SVG text,
// in the drawing's own colours.
async function exportSelection(api, format) {
  const all = api.getSceneElements();
  const appState = api.getAppState();
  const picked = all.filter((el) => appState.selectedElementIds[el.id]);
  const elements = picked.length ? picked : all;
  if (!elements.length) throw new Error('The drawing is empty.');
  const opts = { elements, files: api.getFiles(), exportPadding: 16, appState: { ...appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false } };
  if (format === 'svg') return { svg: new XMLSerializer().serializeToString(await exportToSvg(opts)), count: elements.length, selection: !!picked.length };
  const blob = await exportToBlob({ ...opts, mimeType: 'image/png', getDimensions: (w, h) => { const scale = Math.max(1, Math.min(2, 8192 / Math.max(w, h))); return { width: w * scale, height: h * scale, scale }; } });
  return { blob, count: elements.length, selection: !!picked.length };
}

async function render(m) {
  const { elements, appState, files } = parseScene(m.text, m.format);
  const svg = await exportToSvg({
    elements: elements.filter((el) => !el.isDeleted),
    appState: { ...appState, exportBackground: true, exportWithDarkMode: !!m.dark, exportEmbedScene: false },
    files,
    exportPadding: 16,
  });
  return new XMLSerializer().serializeToString(svg);
}

const bus = { onMessage: null };
let started = false;
window.addEventListener('message', async (e) => {
  if (e.source !== window.parent) return;
  const m = e.data || {};
  if (m.type === 'init' && !started) {
    started = true;
    if (m.mode === 'render') { post({ type: 'loaded' }); return; }
    let scene;
    try { scene = parseScene(m.text, m.format); } catch (err) { post({ type: 'error', message: err.message, fatal: true }); return; }
    createRoot(document.getElementById('root')).render(<Editor init={{ ...m, scene }} bus={bus} />);
    post({ type: 'loaded' });
    return;
  }
  if (m.type === 'render') {
    try { post({ type: 'svg', id: m.id, svg: await render(m) }); } catch (err) { post({ type: 'error', id: m.id, message: err.message }); }
    return;
  }
  bus.onMessage?.(m);
});

post({ type: 'ready' });
