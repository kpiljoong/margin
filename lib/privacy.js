'use strict';
// Decides which notes may be copied into an agent's staging area.
// Two mechanisms, both plain-text and user-owned:
//   1. `.agentnotesignore` at the workspace root (gitignore-like globs)
//   2. front matter in the note itself: `private: true` or `agent: never`
const fs = require('fs');
const path = require('path');

function globToRegex(line) {
  let p = line.trim();
  if (!p || p.startsWith('#')) return null;
  if (p.endsWith('/')) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A pattern that matches a directory also excludes everything below it.
  return new RegExp((anchored ? '^' : '(?:^|/)') + re + '(?:/|$)');
}

function loadIgnore(root) {
  let patterns = [];
  try {
    patterns = fs.readFileSync(path.join(root, '.agentnotesignore'), 'utf8')
      .split(/\r?\n/).map(globToRegex).filter(Boolean);
  } catch { /* no ignore file */ }
  return (relPath) => patterns.some((r) => r.test(relPath));
}

function isPrivateNote(absPath) {
  let head = '';
  try {
    const fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('utf8');
  } catch { return false; }
  // Tolerate a UTF-8 BOM, or a BOM-prefixed private note would be shared.
  const fm = head.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  return /^\s*private\s*:\s*(true|yes)\s*$/im.test(fm[1]) ||
         /^\s*agent\s*:\s*(false|no|never)\s*$/im.test(fm[1]);
}

module.exports = { loadIgnore, isPrivateNote, globToRegex };
