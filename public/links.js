// The link at a place in a line of Markdown, for ⌘/Ctrl-click in the editor:
// [[Note]] / [[Note#Section|label]] / ![[embed]], [text](url) / ![alt](img),
// and bare web addresses. Plain logic (test/links.test.mjs).
//
// → { kind: 'wiki', target } | { kind: 'md', target, image } | { kind: 'url', target } | null
export function linkAt(line, col) {
  const hit = (re, make) => {
    for (const m of line.matchAll(re)) if (col >= m.index && col <= m.index + m[0].length) return make(m);
    return null;
  };
  return hit(/!?\[\[([^\]\n]+)\]\]/g, (m) => ({ kind: 'wiki', target: m[1].split('|')[0].trim() }))
    || hit(/(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (m) => ({ kind: 'md', target: m[2], image: m[1] === '!' }))
    || hit(/<(https?:\/\/[^>\s]+)>|https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g, (m) => ({ kind: 'url', target: m[1] || m[0] }));
}
