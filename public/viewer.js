// A diagram or drawing enlarged over the app: it opens fitted to the window;
// the wheel (or a pinch) zooms at the pointer, dragging pans, a double-click
// switches between fitted and 100%; + − 0 1 on the keyboard; Esc closes.

let current = null;

const el = (tag, cls, ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.filter((k) => k != null));
  return e;
};

// src: an image URL. actions: [{ label, title, run }] shown in the bar.
export function openViewer({ src, title = '', actions = [] }) {
  current?.close();
  const img = el('img', 'viewer-img');
  img.alt = title;
  img.draggable = false;
  const stage = el('div', 'viewer-stage', img);
  const zoomLabel = el('span', 'viewer-zoom');
  const button = (label, tip, run) => {
    const b = el('button', 'icon-btn', label);
    b.type = 'button';
    b.title = tip;
    b.onclick = run;
    return b;
  };
  const bar = el('div', 'viewer-bar',
    el('span', 'viewer-title', title),
    button('−', 'Zoom out (−)', () => zoomBy(1 / 1.25)),
    zoomLabel,
    button('+', 'Zoom in (+)', () => zoomBy(1.25)),
    button('Fit', 'Fit to the window (0)', fit),
    button('100%', 'Actual size (1)', () => zoomTo(1)),
    ...actions.map((a) => button(a.label, a.title || a.label, a.run)),
    button('×', 'Close (Esc)', close));
  const root = el('div', 'viewer', bar, stage);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title || 'Picture');
  root.tabIndex = -1;

  let k = 1; let x = 0; let y = 0; let fitted = true;
  const size = () => [img.naturalWidth || 800, img.naturalHeight || 600];
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    zoomLabel.textContent = `${Math.round(k * 100)}%`;
  };
  function fit() {
    const r = stage.getBoundingClientRect();
    const [w, h] = size();
    k = Math.max(0.05, Math.min(2, (r.width - 48) / w, (r.height - 48) / h));
    x = (r.width - w * k) / 2;
    y = (r.height - h * k) / 2;
    fitted = true;
    apply();
  }
  // Zoom keeping the point (cx, cy) of the stage where it is.
  function zoomAt(next, cx, cy) {
    next = Math.max(0.05, Math.min(16, next));
    x = cx - (cx - x) * (next / k);
    y = cy - (cy - y) * (next / k);
    k = next;
    fitted = false;
    apply();
  }
  const middle = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
  function zoomBy(f) { zoomAt(k * f, ...middle()); }
  function zoomTo(v) { zoomAt(v, ...middle()); }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { px: e.clientX, py: e.clientY, x, y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    x = drag.x + e.clientX - drag.px;
    y = drag.y + e.clientY - drag.py;
    fitted = false;
    apply();
  });
  const endDrag = () => { drag = null; stage.classList.remove('panning'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    if (fitted) zoomAt(1, e.clientX - r.left, e.clientY - r.top); else fit();
  });

  const keys = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const act = { Escape: close, '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(1 / 1.25), 0: fit, 1: () => zoomTo(1) }[e.key];
    if (!act || e.target.closest?.('input, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };
  const resized = () => { if (fitted) fit(); };
  const before = document.activeElement;
  function close() {
    root.remove();
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('resize', resized);
    if (current?.root === root) current = null;
    before?.focus?.({ preventScroll: true });
  }

  window.addEventListener('keydown', keys, true);
  window.addEventListener('resize', resized);
  document.body.append(root);
  img.onload = () => {
    const [w, h] = size();
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    fit();
  };
  img.src = src;
  root.focus();
  current = { root, close };
  return current;
}

export const viewerOpen = () => !!current;
