// Copying pictures (diagrams, drawings) to the system clipboard.

// blob: a Blob or a promise of one. Passing the promise straight to
// ClipboardItem keeps the user's click valid while the image is made.
export async function copyPng(blob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blob) })]);
}

// As an SVG image where the target understands it, and as text (the markup)
// for editors and apps that don't.
export async function copySvg(svg) {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
      'text/plain': new Blob([svg], { type: 'text/plain' }),
    })]);
  } catch {
    await navigator.clipboard.writeText(svg);
  }
}

// The SVG markup inside a data: URL (as made for diagram and drawing images).
export function svgFromDataUrl(url) {
  const m = /^data:image\/svg\+xml(;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  if (m[2]) return new TextDecoder().decode(Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)));
  return decodeURIComponent(m[3]);
}

// Rasterise an image (usually SVG) at `scale` (capped at 8192 px a side) onto
// `background` (a CSS colour; transparent if empty). Resolves to a PNG Blob.
export function imageToPng(src, { scale = 3, background = '' } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 800;
      const h = img.naturalHeight || 600;
      const k = Math.max(0.1, Math.min(scale, 8192 / Math.max(w, h)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      const ctx = canvas.getContext('2d');
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
}
