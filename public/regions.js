// Marks on a picture: a part of it — x, y, width, height in the picture's
// own pixels — and what someone wrote about it. On a desk a mark is a card
// of its own (from: { file, kind: 'region', rect }); in a note it is a plain
// Markdown link with a media fragment (W3C Media Fragments), so the note
// stays readable anywhere: `![shot](assets/shot.png#xywh=120,80,300,140)` —
// Obsidian shows the whole picture, Margin the part.

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

export const xywh = (rect) => rect.map((v) => Math.max(0, Math.round(v))).join(',');

// The part a link names (#xywh=x,y,w,h, or #xywh=pixel:…), or null.
export function parseXywh(url) {
  const m = /#xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)$/.exec(String(url || ''));
  if (!m) return null;
  const r = m.slice(1).map(Number);
  return r[2] > 0 && r[3] > 0 ? r : null;
}

// A rectangle drawn from one corner to the other, in the picture's pixels,
// kept inside it; null when too small to mean anything.
export function rectFrom(a, b, w, h, min = 6) {
  const x0 = Math.max(0, Math.min(w, Math.min(a.x, b.x)));
  const y0 = Math.max(0, Math.min(h, Math.min(a.y, b.y)));
  const x1 = Math.max(0, Math.min(w, Math.max(a.x, b.x)));
  const y1 = Math.max(0, Math.min(h, Math.max(a.y, b.y)));
  if (x1 - x0 < min || y1 - y0 < min) return null;
  return [x0, y0, x1 - x0, y1 - y0].map(Math.round);
}

// The way from a note at `from` to the file at `to` (both from the
// workspace's root): "assets/shot.png", "../pics/shot.png".
export function relPath(from, to) {
  const a = String(from).split('/').slice(0, -1);
  const b = String(to).split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

// A link target: what a Markdown link needs escaped (spaces, brackets), the
// letters themselves kept.
export const linkTarget = (p) => encodeURI(p).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// The marks of one picture on a desk, top to bottom, left to right.
export function regionsOf(nodes, file) {
  return nodes.filter((n) => n.type === 'text' && n.from?.kind === 'region' && n.from.file === file && Array.isArray(n.from.rect))
    .sort((a, b) => a.from.rect[1] - b.from.rect[1] || a.from.rect[0] - b.from.rect[0]);
}

// What a mark became, in order: what it says, the answers kept for it, the
// note made of it — the history of one thought, from the picture on.
export function threadOf(nodes, mark) {
  const answers = nodes.filter((n) => n.from?.kind === 'answer' && n.from.of === mark.id);
  return { mark, answers, note: mark.from?.noted || null };
}

const stem = (p) => String(p).split('/').pop().replace(/\.[^.]+$/, '');

// The note made of a mark: the part of the picture, what was written about
// it, the answers kept, and where it came from.
export function regionNote({ notePath, image, rect, text, answers = [], desk }) {
  const said = String(text || '').trim();
  const first = said.split('\n')[0].replace(/^[#>\s-]+/, '').trim();
  const title = first ? first.slice(0, 70) : `${stem(image)}, marked`;
  const at = `${linkTarget(relPath(notePath, image))}#xywh=${xywh(rect)}`;
  const lines = [`# ${title}`, '', `![${stem(image)}](${at})`, ''];
  if (said) {
    const body = said.split('\n');
    lines.push(...(/\?\s*$/.test(body[0]) ? [`> [!question] ${body[0]}`, ...body.slice(1).map((l) => `> ${l}`)] : body.map((l) => `> ${l}`)), '');
  }
  for (const a of answers) { const t = String(a || '').trim(); if (t) lines.push(t, ''); }
  lines.push(`Source: [${image.split('/').pop()}](${at})${desk ? `, marked on [${stem(desk)}](${linkTarget(relPath(notePath, desk))})` : ''}.`);
  return `${lines.join('\n')}\n`;
}

// Pictures in rendered Markdown whose link names a part (#xywh=): only that
// part shown (CSS object-view-box; where it isn't known, the whole picture).
export function cropParts(root) {
  for (const img of root.querySelectorAll('img')) {
    const r = parseXywh(img.getAttribute('src'));
    if (!r) continue;
    img.style.objectViewBox = `xywh(${r[0]}px ${r[1]}px ${r[2]}px ${r[3]}px)`;
    img.classList.add('part');
    img.title ||= `Part of the picture (${r.join(', ')}); the link opens it all, the part marked`;
  }
}
