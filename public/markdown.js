import { highlightCode } from './codehl.js';

// Small, dependency-free Markdown renderer. Everything from the source is
// HTML-escaped; only tags generated here reach the DOM. Remote images are
// never fetched (privacy): they render as a placeholder with the URL.

// Per-render options (set by renderMarkdown, read by inline()).
let imageFor = null;
let embedFor = null; // ![[target]] → HTML or null (then it renders as a link)
const TAG_RE = /(^|[\s(])#((?=[\p{L}\p{N}_/-]*[\p{L}_])[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const isBlockStart = (l) => FENCE_RE.test(l) || /^\s*\|/.test(l) || /^#{1,6}\s/.test(l) || HR_RE.test(l) || /^\s{0,3}>/.test(l) || LIST_RE.test(l);

function safeHref(url) {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u)) return { href: u, external: true };
  if (/^[a-z][\w+.-]*:/i.test(u)) return null; // javascript:, data:, file: …
  return { href: u, external: false };
}

function inline(src) {
  const codes = [];
  let s = src.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, c) => `\u0000${codes.push(c.trim()) - 1}\u0000`);
  s = esc(s);
  // Generated tags are stashed so emphasis rules never touch URLs/attributes.
  const tags = [];
  const stash = (html) => `\u0001${tags.push(html) - 1}\u0001`;
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => {
    // Local images render; remote ones are never fetched (privacy).
    const src = imageFor ? imageFor(url.replace(/&amp;/g, '&')) : null;
    return stash(src
      ? `<img src="${esc(src)}" alt="${alt}" loading="lazy">`
      : `<span class="img-ph" title="Remote image not loaded: ${url}">▣ ${alt || 'image'}</span>`);
  });
  if (embedFor) {
    s = s.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => {
      const html = embedFor(unesc(target.trim()), label ? unesc(label.trim()) : '');
      return html ? stash(html) : m;
    });
  }
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) =>
    stash(`<a href="#" class="internal" data-target="${target.trim()}">${label || target}</a>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;.*?&quot;)?\)/g, (_, text, url) => {
    const link = safeHref(url.replace(/&amp;/g, '&'));
    if (!link) return text;
    return stash(link.external
      ? `<a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer" class="external">${text}</a>`
      : `<a href="#" class="internal" data-href="${esc(link.href)}">${text}</a>`);
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, pre, url) =>
    pre + stash(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="external">${url}</a>`));
  s = s.replace(TAG_RE, (_, pre, tag) => `${pre}${stash(`<a href="#" class="tag" data-tag="${tag}">#${tag}</a>`)}`);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => tags[n]);
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[n])}</code>`);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

const markerKind = (mk) => (/\d/.test(mk) ? `ol${mk.slice(-1)}` : mk);

function parseList(lines, i, offset) {
  const baseIndent = indentOf(lines[i]);
  const kind = markerKind(lines[i].match(LIST_RE)[2]);
  const ordered = /^\s*\d/.test(lines[i]);
  const start = ordered ? parseInt(lines[i].trim(), 10) : 1;
  const items = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && indentOf(next) >= baseIndent && (LIST_RE.test(next) || indentOf(next) > baseIndent)) { i++; continue; }
      break;
    }
    const ind = indentOf(line);
    const m = line.match(LIST_RE);
    // A different marker (numbered vs bullet, or -/*/+) starts a new list.
    if (m && ind === baseIndent && markerKind(m[2]) !== kind) break;
    if (m && ind === baseIndent) { items.push({ text: m[3], line: i + offset, children: [] }); i++; continue; }
    if (ind > baseIndent && items.length) {
      if (m) { const r = parseList(lines, i, offset); items[items.length - 1].children.push(r.html); i = r.next; continue; }
      items[items.length - 1].text += ` ${line.trim()}`; i++; continue;
    }
    if (!m && items.length && !isBlockStart(line)) { items[items.length - 1].text += ` ${line.trim()}`; i++; continue; }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((it) => {
    const task = it.text.match(/^\[([ xX])\]\s+(.*)$/);
    const content = task
      ? `<input type="checkbox" class="task" data-line="${it.line}"${task[1] !== ' ' ? ' checked' : ''}> <span>${inline(task[2])}</span>`
      : inline(it.text);
    return `<li${task ? ' class="task-item"' : ''} data-line="${it.line}">${content}${it.children.join('')}</li>`;
  }).join('');
  return { html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${body}</${tag}>`, next: i };
}

// `offset` maps lines back to the source so the preview can toggle task
// checkboxes and scroll-sync; `data-line` is 0-based.
export function renderMarkdown(src, opts = {}) {
  if (typeof opts === 'number') return renderBlocks(src, opts);
  const prev = [imageFor, embedFor];
  imageFor = opts.image || null;
  embedFor = opts.embed || null;
  try { return renderBlocks(src, 0); } finally { [imageFor, embedFor] = prev; }
}

function renderBlocks(src, offset) {
  // Strip a UTF-8 BOM (Notepad and other Windows tools add one) so the first
  // heading / front matter is still recognised.
  const lines = String(src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  if (offset === 0 && lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      out.push(`<pre class="frontmatter">${esc(lines.slice(1, end).join('\n'))}</pre>`);
      i = end + 1;
    }
  }
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }
    if ((m = line.match(FENCE_RE))) {
      const fence = m[1];
      const buf = [];
      const at = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      out.push(`<pre data-line="${at + offset}"${m[2] ? ` data-lang="${esc(m[2])}"` : ''}><code${m[2] ? ` class="lang-${esc(m[2])}"` : ''}>${highlightCode(buf.join('\n'), m[2])}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const n = m[1].length;
      out.push(`<h${n} id="${esc(slug(m[2]))}" data-line="${i + offset}">${inline(m[2])}</h${n}>`);
      i++; continue;
    }
    if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const at = i;
      const buf = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out.push(callout(buf, at + offset) || `<blockquote data-line="${at + offset}">${renderBlocks(buf.join('\n'), at + offset)}</blockquote>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      const r = parseList(lines, i, offset);
      out.push(r.html); i = r.next; continue;
    }
    if (line.includes('|') && TABLE_SEP_RE.test(lines[i + 1] || '')) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const at = i;
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (t, c, k) => `<${t}${aligns[k] ? ` class="al-${aligns[k]}"` : ''}>${inline(c)}</${t}>`;
      out.push(`<table data-line="${at + offset}"><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] || '', k)).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const at = i;
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
    out.push(`<p data-line="${at + offset}">${buf.map((l) => inline(l.trim()) + (/ {2,}$/.test(l) ? '<br>' : '')).join(' ')}</p>`);
  }
  return out.join('\n');
}

// A quote that starts with [!type] is a callout, as on GitHub and in Obsidian:
// "> [!warning] Title". + or - after it (Obsidian) makes it fold, open or shut.
// Types are grouped by colour; an unknown one is a note with its own name.
const CALLOUTS = {
  note: 'note', info: 'note', todo: 'note', abstract: 'note', summary: 'note', tldr: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
  important: 'important', question: 'important', help: 'important', faq: 'important', example: 'important',
  warning: 'warning', caution: 'warning', attention: 'warning',
  danger: 'danger', error: 'danger', bug: 'danger', failure: 'danger', fail: 'danger', missing: 'danger',
  quote: 'quote', cite: 'quote',
};
export const calloutKind = (type) => CALLOUTS[type.toLowerCase()] || 'note';

function callout(lines, line) {
  const m = lines[0].match(/^\s*\[!([\w-]+)\]([+-]?)\s*(.*)$/);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const title = m[3].trim() ? inline(m[3].trim()) : esc(type[0].toUpperCase() + type.slice(1));
  const body = renderBlocks(lines.slice(1).join('\n'), line + 1);
  const cls = `callout callout-${calloutKind(type)}`;
  if (m[2]) return `<details class="${cls}" data-line="${line}" data-callout="${esc(type)}"${m[2] === '+' ? ' open' : ''}><summary class="callout-title">${title}</summary>${body ? `<div class="callout-body">${body}</div>` : ''}</details>`;
  return `<div class="${cls}" data-line="${line}" data-callout="${esc(type)}"><div class="callout-title">${title}</div>${body ? `<div class="callout-body">${body}</div>` : ''}</div>`;
}

// Outline for the sidebar: [{level, text, line}]
export function outline(src) {
  const res = [];
  let inFence = false;
  String(src).replace(/^\uFEFF/, '').split('\n').forEach((l, i) => {
    l = l.replace(/\r$/, '');
    if (FENCE_RE.test(l)) inFence = !inFence;
    const m = !inFence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) res.push({ level: m[1].length, text: m[2], line: i });
  });
  return res;
}
