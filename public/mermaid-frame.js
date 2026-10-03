// Draws Mermaid diagrams for public/diagrams.js. This page runs in a hidden,
// sandboxed iframe with an opaque origin: no access to the app, its token or
// the notes API. Its own Content-Security-Policy (server.js) lets Mermaid
// style the elements it measures, which the app's page does not allow.
//
// parent → frame  render {id, source, config}
// frame → parent  ready · done {id, svg, nodes, edges} | {id, error}
//
// nodes: where each flowchart box sits in the picture, as fractions of its
// width and height: [{id, x, y, w, h}] (id as written in the source).
// edges: each arrow's line, points as the same fractions:
// [{from, to, k, pts: [[x, y], …]}] (k: the k-th arrow between those two).

let configured = '';

// Give the SVG a real size so an <img> of it keeps the diagram's proportions.
function sized(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return svg;
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    root.setAttribute('width', String(Math.ceil(vb[2])));
    root.setAttribute('height', String(Math.ceil(vb[3])));
    root.style.removeProperty('max-width');
  }
  return new XMLSerializer().serializeToString(root);
}

// Lay the finished SVG out here for a moment and measure its boxes.
function measure(svgText) {
  const box = document.createElement('div');
  box.innerHTML = svgText;
  document.body.append(box);
  try {
    const svg = box.querySelector('svg');
    const r = svg?.getBoundingClientRect();
    if (!r?.width || !r.height) return { nodes: [], edges: [] };
    const out = [];
    for (const g of svg.querySelectorAll('g.node')) {
      const id = g.dataset.id || /flowchart-(.+)-\d+$/.exec(g.id)?.[1];
      if (!id) continue;
      const b = g.getBoundingClientRect();
      out.push({ id, x: (b.left - r.left) / r.width, y: (b.top - r.top) / r.height, w: b.width / r.width, h: b.height / r.height });
    }
    const edges = [];
    const round = (v) => Math.round(v * 10000) / 10000;
    for (const p of svg.querySelectorAll('path[data-edge="true"]')) {
      const m = /^L[_-](.+?)[_-](.+?)[_-](\d+)$/.exec(p.dataset.id || '');
      const ctm = p.getCTM();
      if (!m || !ctm) continue;
      const len = p.getTotalLength();
      const n = Math.max(2, Math.min(40, Math.ceil(len / 12)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const q = p.getPointAtLength((len * i) / n).matrixTransform(ctm);
        pts.push([round(q.x / r.width), round(q.y / r.height)]);
      }
      edges.push({ from: m[1], to: m[2], k: Number(m[3]), pts });
    }
    return { nodes: out, edges };
  } finally { box.remove(); }
}

window.addEventListener('message', async (e) => {
  if (e.source !== window.parent) return;
  const m = e.data || {};
  if (m.type !== 'render') return;
  const reply = (r) => window.parent.postMessage({ margin: 'mermaid', type: 'done', id: m.id, ...r }, '*');
  const id = `m${m.id}`;
  try {
    const key = JSON.stringify(m.config);
    if (key !== configured) {
      window.mermaid.initialize(m.config);
      document.body.style.fontFamily = m.config.fontFamily || 'sans-serif';
      configured = key;
    }
    const { svg } = await window.mermaid.render(id, String(m.source));
    const out = sized(svg);
    let found = { nodes: [], edges: [] };
    try { found = measure(out); } catch { /* the picture still works without them */ }
    reply({ svg: out, ...found });
  } catch (err) {
    reply({ error: String(err?.message || err) });
  } finally {
    // Mermaid leaves its measuring node behind when a diagram fails.
    document.getElementById(`d${id}`)?.remove();
  }
});

window.parent.postMessage({ margin: 'mermaid', type: 'ready' }, '*');
