#!/usr/bin/env node
'use strict';
// Margin — local-only server. Serves the UI and a small JSON API over a
// single workspace folder of plain Markdown files. No dependencies, no network
// calls: it binds to 127.0.0.1 and every API call needs a per-launch token.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { buildHunks, applyHunks, mergeHunks } = require('./lib/diff');
const { loadIgnore, isPrivateNote } = require('./lib/privacy');
const { parseAgentLog } = require('./lib/agentlog');
const { picturesIn, pictureSize, hiddenIn } = require('./lib/pictures');
const { lockRanges, lockedHunks, drawerText, drawerScraps, addedLines } = require('./lib/beside');
const { liveMargin, projectOf, testLine } = require('./lib/live');
const { deskMargin, textLang } = require('./lib/desk');
const { OutsideStore, Seen, changedWhileAway } = require('./lib/outside');
const { tiersOf, agentLines } = require('./lib/tiers');
const { createEmbed } = require('./lib/embed');
const { judgeMargin } = require('./lib/judge');
const { thinkMargin } = require('./lib/think');
const { developMargin } = require('./lib/develop');
const { briefMargin } = require('./lib/brief');

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const VERSION = require('./package.json').version;

// ---------------------------------------------------------------- options

function usage() {
  console.log(`Usage: node server.js [workspace-dir] [options]

Options:
  --agent <cmd>   Shell command to run as an agent (or "demo" for the built-in
                  offline demo agent). Repeat to offer several; the first is the
                  default. Also: $AGENT_NOTES_AGENT, or $AGENT_NOTES_AGENTS as a
                  JSON list of {"name","command"} (used by the desktop app).
  --default-agent <name>  Which of several agents is preselected.
  --port <n>      Port on 127.0.0.1 (default 4321, falls forward if busy)
  --no-open       Do not open the browser automatically

The agent command runs inside a staged copy of the files you choose, receives
the prompt on stdin and in $AGENT_NOTES_PROMPT, and never touches your notes
directly: you review and accept its changes hunk by hunk.`);
}

const opts = { port: 4321, agents: [], defaultAgent: '', open: true, workspace: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
  else if (a === '--agent') { const v = argv[++i]; if (v) opts.agents.push({ command: v }); }
  else if (a === '--default-agent') opts.defaultAgent = argv[++i] || '';
  else if (a === '--no-open') opts.open = false;
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else if (!a.startsWith('-')) opts.workspace = a;
  else { console.error(`Unknown option: ${a}\n`); usage(); process.exit(1); }
}

const ROOT = fs.realpathSync(path.resolve(opts.workspace || process.cwd()));
if (!fs.statSync(ROOT).isDirectory()) { console.error(`Not a directory: ${ROOT}`); process.exit(1); }

const DATA_DIR = path.join(ROOT, '.agent-notes');
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const TOKEN = crypto.randomBytes(24).toString('hex');
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

// Agent profiles. Commands only ever come from the command line or the
// environment (i.e. the user or the desktop shell), never from the web UI.
if (process.env.AGENT_NOTES_AGENT) opts.agents.push({ command: process.env.AGENT_NOTES_AGENT });
try {
  const list = JSON.parse(process.env.AGENT_NOTES_AGENTS || '[]');
  if (Array.isArray(list)) for (const a of list) if (a && typeof a.command === 'string' && a.command.trim()) opts.agents.push(a);
} catch { console.error('Ignoring invalid $AGENT_NOTES_AGENTS'); }
// CLI agents we know how to steer: the model can be switched per task (only to
// a model from this list, so the web UI never writes into a shell command) and
// sign-in can be checked before running.
const AGENT_KINDS = {
  claude: {
    models: [['haiku', 'Haiku — cheapest'], ['sonnet', 'Sonnet'], ['opus', 'Opus — strongest']],
    flag: /(\s)--model(?:\s+|=)(\S+)/, head: /^(\S*claude)(?=\s|$)/, arg: (m) => `--model ${m}`,
    status: ['auth', 'status'], login: 'claude auth login',
  },
  codex: {
    models: [['gpt-6-luna', 'GPT-6 Luna — fast'], ['gpt-6-sol', 'GPT-6 Sol']],
    flag: /(\s)(?:-m|--model)(?:\s+|=)(\S+)/, head: /^(\S*codex\s+exec)(?=\s|$)/, arg: (m) => `-m ${m}`,
    status: ['login', 'status'], login: 'codex login',
  },
};
const agentKind = (command) => {
  const bin = path.basename(String(command).trim().split(/\s+/)[0] || '').replace(/\.(cmd|exe)$/i, '');
  return AGENT_KINDS[bin] ? bin : '';
};
const AGENTS = opts.agents.map((a, i) => {
  const command = a.command.trim();
  const builtin = command === 'demo';
  const label = String(a.name || (builtin ? 'Demo (built-in, offline)' : command.split(/\s+/)[0])).slice(0, 60);
  const kind = builtin ? '' : agentKind(command);
  return {
    id: `a${i}`, label, builtin, kind,
    model: kind ? (AGENT_KINDS[kind].flag.exec(command)?.[2] || '') : '',
    command: builtin ? `"${process.execPath}" "${path.join(APP_DIR, 'scripts', 'demo-agent.js')}"` : command,
  };
});
const AGENT = AGENTS.find((a) => a.label === opts.defaultAgent) || AGENTS[0] || null;
const agentById = (id) => AGENTS.find((a) => a.id === id) || AGENT;

// The agent's command, with its model swapped for one of the known models.
function agentCommand(agent, model) {
  const kind = AGENT_KINDS[agent.kind];
  if (!model || !kind || model === agent.model) return agent.command;
  if (!kind.models.some(([id]) => id === model)) throw httpError(400, `Unknown model for ${agent.label}: ${model}`);
  if (kind.flag.test(agent.command)) return agent.command.replace(kind.flag, (_, sp) => `${sp}${kind.arg(model)}`);
  if (kind.head.test(agent.command)) return agent.command.replace(kind.head, (h) => `${h} ${kind.arg(model)}`);
  throw httpError(400, `Can't choose a model for ${agent.label}; edit its command instead`);
}

// Sign-in check for known CLIs (e.g. `claude auth status`), cached briefly.
const agentStatusCache = new Map();
function agentStatus(agent, fresh) {
  const kind = AGENT_KINDS[agent.kind];
  if (!kind) return Promise.resolve({ ok: null });
  const hit = agentStatusCache.get(agent.id);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.result;
  const bin = agent.command.trim().split(/\s+/)[0];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = new Promise((resolve) => {
    execFile(bin, kind.status, { timeout: 15000, env, windowsHide: true, shell: process.platform === 'win32' }, (err) => {
      if (!err) resolve({ ok: true });
      else if (err.code === 'ENOENT') resolve({ ok: false, message: `“${bin}” was not found on your PATH.` });
      else if (err.killed) resolve({ ok: null, message: 'Sign-in check timed out.' });
      else resolve({ ok: false, message: 'Not signed in (or the sign-in expired).', login: kind.login });
    });
  });
  agentStatusCache.set(agent.id, { at: Date.now(), result });
  return result;
}

const SKIP_NAMES = new Set(['.git', 'node_modules', '.agent-notes', '.DS_Store', '.obsidian', '.trash']);
const NOTE_EXT = new Set(['.md', '.markdown', '.mdx', '.txt']);
const TEXT_EXT = new Set([...NOTE_EXT, '.json', '.yaml', '.yml', '.toml', '.csv', '.org', '.rst',
  '.html', '.css', '.js', '.ts', '.py', '.sh', '.canvas', '.agentnotesignore', '.gitignore']);
const MAX_OPEN_BYTES = 2 * 1024 * 1024;
// Excalidraw drawings carry their images inline, so they may be larger.
const MAX_DRAWING_BYTES = 32 * 1024 * 1024;
const isDrawing = (rel) => /\.excalidraw(\.md)?$/i.test(rel);

// ---------------------------------------------------------------- helpers

function httpError(status, message, data) {
  const e = new Error(message);
  e.status = status;
  e.data = data;
  return e;
}

const extOf = (p) => (path.extname(p) || path.basename(p)).toLowerCase();
const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
const relOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const isInside = (base, abs) => abs === base || abs.startsWith(base + path.sep);

function resolveInside(base, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) throw httpError(400, 'Invalid path');
  const abs = path.resolve(base, relPath);
  if (!isInside(base, abs) || abs === base) throw httpError(400, 'Path escapes workspace');
  return abs;
}

// Resolves a user-supplied path inside the workspace, refusing reserved dirs
// and symlinks that point outside of it.
function workspacePath(relPath) {
  const abs = resolveInside(ROOT, relPath);
  if (relOf(abs).split('/').some((part) => SKIP_NAMES.has(part))) throw httpError(403, 'Path is reserved');
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  if (!isInside(ROOT, fs.realpathSync(probe))) throw httpError(403, 'Path resolves outside workspace');
  return abs;
}

function writeFileAtomic(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
  wroteNote(abs, data);
}

function walk(base, limit = 20000) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(base, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (SKIP_NAMES.has(e.name) || e.isSymbolicLink()) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) {
        out.push(rel);
        if (out.length >= limit) return out.sort();
      }
    }
  }
  return out.sort();
}

function readText(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

function ensureDataDir() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  // Runs hold copies of notes; keep them out of any git history by default.
  const gi = path.join(DATA_DIR, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

// ---------------------------------------------------------------- files & search

function listTree() {
  return workspaceFiles().map((p) => ({ path: p, note: NOTE_EXT.has(extOf(p)) }));
}

function emptyDirs() {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < 2000) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || SKIP_NAMES.has(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      stack.push(rel);
      try { if (!fs.readdirSync(path.join(ROOT, rel)).some((n) => !SKIP_NAMES.has(n))) out.push(rel); } catch { /* skip */ }
    }
  }
  return out;
}

function getFile(relPath) {
  const abs = workspacePath(relPath);
  let st;
  try { st = fs.statSync(abs); } catch { throw httpError(404, 'File not found'); }
  if (!st.isFile()) throw httpError(400, 'Not a file');
  if (st.size > (isDrawing(relPath) ? MAX_DRAWING_BYTES : MAX_OPEN_BYTES)) throw httpError(413, 'File is too large to open here');
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw httpError(415, 'Binary files are not editable');
  return { path: relOf(abs), content: buf.toString('utf8'), hash: hashOf(buf), mtime: st.mtimeMs };
}

function statFile(relPath) {
  const abs = workspacePath(relPath);
  try { return { path: relPath, hash: hashOf(fs.readFileSync(abs)), exists: true }; }
  catch { return { path: relPath, exists: false }; }
}

function saveFile({ path: relPath, content, baseHash, force, reason }) {
  if (typeof content !== 'string') throw httpError(400, 'content must be a string');
  const abs = workspacePath(relPath);
  const old = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  if (!force && old) {
    const current = hashOf(old);
    if (baseHash && current !== baseHash) {
      throw httpError(409, 'File changed on disk since you opened it', { currentHash: current });
    }
  }
  if (old && !old.includes(0) && old.toString('utf8') !== content) keepVersion(relOf(abs), old.toString('utf8'), reason === 'restore' ? 'restore' : 'save');
  writeFileAtomic(abs, content);
  return { path: relOf(abs), hash: hashOf(Buffer.from(content, 'utf8')) };
}

// content: the new note's text (from a template); a title heading otherwise.
function createFile({ path: relPath, content, gathered }) {
  if (!NOTE_EXT.has(extOf(relPath || ''))) relPath = `${relPath}.md`;
  const abs = workspacePath(relPath);
  if (fs.existsSync(abs)) throw httpError(409, 'A file with that name already exists');
  const title = path.basename(relPath).replace(/\.[^.]+$/, '');
  writeFileAtomic(abs, typeof content === 'string' ? content : `# ${title}\n\n`);
  treeCache = null; // in the tree at once, not when the watcher tells
  keepGathered(relOf(abs), gathered);
  return getFile(relOf(abs));
}

function search(q) {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return { results: [] };
  const results = [];
  let hits = 0;
  for (const rel of workspaceFiles()) {
    if (hits >= 500) break;
    const nameHit = rel.toLowerCase().includes(query);
    const matches = [];
    if (TEXT_EXT.has(extOf(rel))) {
      const c = cachedText(rel);
      if (c && c.lower.includes(query)) {
        const lines = c.text.split('\n');
        for (let i = 0; i < lines.length && matches.length < 50; i++) {
          if (lines[i].toLowerCase().includes(query)) matches.push({ line: i + 1, text: lines[i].slice(0, 240) });
        }
      }
    }
    if (nameHit || matches.length) {
      results.push({ path: rel, nameHit, matches });
      hits += Math.max(1, matches.length);
    }
  }
  return { results, truncated: hits >= 500 };
}

// ---------------------------------------------------------------- caches & live events
// The watcher keeps the tree cache fresh and pushes changes to open windows
// (SSE), so the UI never polls. Text is cached by mtime/size for fast search.

let watching = false;
let treeCache = null;
const textCache = new Map();
const clients = new Set();

function workspaceFiles() {
  if (watching && treeCache) return treeCache;
  const files = walk(ROOT);
  if (watching) treeCache = files;
  return files;
}

function cachedText(rel) {
  const abs = path.join(ROOT, rel);
  let st;
  try { st = fs.statSync(abs); } catch { textCache.delete(rel); return null; }
  if (!st.isFile() || st.size > MAX_OPEN_BYTES) return null;
  const hit = textCache.get(rel);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const text = readText(abs);
  if (text == null) return null;
  if (textCache.size > 20000) textCache.clear();
  const entry = { mtimeMs: st.mtimeMs, size: st.size, created: Math.round(st.birthtimeMs || st.mtimeMs), text, lower: text.toLowerCase() };
  textCache.set(rel, entry);
  return entry;
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function openEventStream(req, res) {
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
  res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ watching })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}

const OWN_TMP_RE = /\.\d+\.\d+\.tmp$/;

function startWatcher() {
  let pending = new Set();
  let structural = false;
  let timer = null;
  const flush = () => {
    if (structural) treeCache = null;
    for (const p of pending) {
      // Changed by another program: keep the text it replaced.
      const was = textCache.get(p);
      textCache.delete(p);
      if (!NOTE_EXT.has(extOf(p))) continue;
      const abs = path.join(ROOT, p);
      let now = null;
      let st = null;
      try { st = fs.statSync(abs); if (st.isFile()) now = readText(abs); } catch { /* gone */ }
      sawNote(p, now, st);
      if (isOurs(p)) continue;
      if (!was) {
        // A note that was not there: made just now (not merely unread).
        if (now != null && st.birthtimeMs && Date.now() - st.birthtimeMs < 30_000 && !isTemplatePath(p)) changedOutside(p, null, now);
      } else if (now == null) {
        if (!st) changedOutside(p, was.text, null); // deleted (or moved away)
      } else if (now !== was.text) { keepVersion(p, was.text, 'outside'); changedOutside(p, was.text, now); }
      cachedText(p); // so the next change is seen too
    }
    broadcast('fs', { paths: [...pending], structural });
    pending = new Set();
    structural = false;
  };
  try {
    const watcher = fs.watch(ROOT, { recursive: true }, (type, filename) => {
      if (!filename) structural = true;
      else {
        const rel = String(filename).split(path.sep).join('/');
        if (rel.split('/').some((part) => SKIP_NAMES.has(part))) return;
        if (type === 'rename') structural = true;
        if (!OWN_TMP_RE.test(rel)) pending.add(rel);
      }
      clearTimeout(timer);
      timer = setTimeout(flush, 120);
    });
    watcher.on('error', () => { watching = false; treeCache = null; });
    watching = true;
  } catch { watching = false; }
}

// Front matter `tags:` plus inline #tags (outside code), counted per note.
const TAG_RE = /(^|[\s(])#((?=[\p{L}\p{N}_/-]*[\p{L}_])[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

function noteTags(text) {
  const found = new Set();
  const fm = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  let body = text;
  if (fm) {
    const lines = fm[1].split(/\r?\n/);
    const i = lines.findIndex((l) => /^tags\s*:/.test(l));
    if (i !== -1) {
      let v = lines[i].replace(/^tags\s*:\s*/, '').trim();
      if (v.startsWith('[')) v = v.slice(1, -1);
      if (v) v.split(',').forEach((t) => found.add(t.trim()));
      else for (const l of lines.slice(i + 1)) { const m = l.match(/^\s*-\s*(.+)$/); if (!m) break; found.add(m[1].trim()); }
    }
    body = text.slice(fm[0].length);
  }
  body = body.replace(/(```|~~~)[\s\S]*?\1/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of body.matchAll(TAG_RE)) found.add(m[2]);
  return [...found].map((t) => t.replace(/^#/, '').replace(/^["']|["']$/g, '')).filter(Boolean);
}

// Notes in templates/ are patterns for new notes (public/templates.js): their
// tags and headings aren't the workspace's.
const isTemplatePath = (rel) => /^templates\//i.test(rel);

function listTags() {
  const counts = new Map();
  for (const rel of workspaceFiles()) {
    if (!NOTE_EXT.has(extOf(rel)) || isTemplatePath(rel)) continue;
    const c = cachedText(rel);
    if (c) for (const t of noteTags(c.text)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return { tags: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) };
}

// Every task (- [ ] …) in the workspace, for the Tasks view (an agenda, as
// in org-mode or Obsidian Tasks). A date after 📅 or due: is when it is due.
// Lines count from 1.
const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const DUE_RE = /(?:📅\s*|\bdue:\s*)(\d{4}-\d{2}-\d{2})/u;
function noteTasks(c) {
  if (!c.tasks) {
    c.tasks = [];
    let fence = null;
    c.text.replace(/^\uFEFF/, '').split('\n').forEach((l, i) => {
      l = l.replace(/\r$/, '');
      const f = l.match(/^\s{0,3}(```+|~~~+)/);
      if (f && (!fence || f[1].startsWith(fence))) { fence = fence ? null : f[1]; return; }
      const m = !fence && TASK_RE.exec(l);
      if (m && m[2].trim()) c.tasks.push({ line: i + 1, done: m[1] !== ' ', text: m[2].trim(), due: DUE_RE.exec(m[2])?.[1] || null });
    });
  }
  return c.tasks;
}

function listTasks() {
  const tasks = [];
  for (const rel of workspaceFiles()) {
    if (!NOTE_EXT.has(extOf(rel)) || isTemplatePath(rel)) continue;
    const c = cachedText(rel);
    if (c) for (const t of noteTasks(c)) tasks.push({ path: rel, ...t });
    if (tasks.length > 5000) break;
  }
  return { tasks };
}

// The margin remembers (public/recall.js): every note's to-do, decision and
// question lines (0-based), its text (for its paragraphs and date; the
// newest notes first, RECALL_TEXT in all) and its project; and what you told
// it when it asked (KNOWN.md, a note of yours). Shown beside another note's
// lines; nothing is sent anywhere. sig: all of it as it is now — asked with
// the one it has, the app gets { same: true } when nothing changed.
const RECALL_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+\S|^\s*>\s*\[!(?:decision|decided|question)\][+-]?\s+\S|(?:^|\s)#(?:decision|decided|question)\b/i;
const RECALL_MAX = 20000;
const RECALL_NOTE = 20000;
const RECALL_TEXT = 3000000;
function noteRecall(c) {
  if (!c.recall) {
    c.recall = [];
    let fence = null;
    c.text.replace(/^\uFEFF/, '').split('\n').forEach((l, i) => {
      l = l.replace(/\r$/, '');
      const f = l.match(/^\s{0,3}(```+|~~~+)/);
      if (f && (!fence || f[1].startsWith(fence))) { fence = fence ? null : f[1]; return; }
      if (!fence && l.length < 2000 && RECALL_LINE.test(l)) c.recall.push([i, l]);
    });
  }
  return c.recall;
}

const KNOWN_FILE = 'KNOWN.md';
function recallLines(sig = '') {
  const found = [];
  for (const rel of workspaceFiles()) {
    if (!NOTE_EXT.has(extOf(rel)) || isTemplatePath(rel) || rel === KNOWN_FILE) continue;
    const c = cachedText(rel);
    if (c) found.push([rel, c]);
  }
  const known = cachedText(KNOWN_FILE);
  const now = crypto.createHash('sha1').update(found.map(([rel, c]) => `${rel}\0${c.mtimeMs}\0${c.size}`).join('\n')).update(`\n${known ? known.mtimeMs : ''}`).digest('hex');
  if (sig && sig === now) return { sig: now, same: true };
  found.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
  const notes = [];
  let count = 0;
  let chars = 0;
  for (const [rel, c] of found) {
    const lines = count > RECALL_MAX ? [] : noteRecall(c);
    const text = chars < RECALL_TEXT ? c.text.replace(/^\uFEFF/, '').slice(0, RECALL_NOTE) : null;
    if (!lines.length && text == null) continue;
    notes.push({ path: rel, v: `${c.mtimeMs}:${c.size}`, head: text == null ? c.text.slice(0, 1500) : undefined, text, created: c.created, project: projectOf(c.text.slice(0, 1500)).project, lines });
    count += lines.length;
    chars += text ? text.length : 0;
  }
  const read = notes.filter((n) => n.text != null);
  embedNotes = { notes: read.length, left: found.length - read.length };
  embed.sync(read);
  return { sig: now, notes, known: known?.text || '' };
}

// The margin's local model (lib/embed.js): on when the app says so, the
// notes it reads as recallLines gives them (the newest, up to RECALL_TEXT
// characters: how many, and how many older ones are left out).
const embed = createEmbed({ dataDir: path.join(DATA_DIR, 'embed') });
let embedNotes = { notes: 0, left: 0 };
const embedStatus = (s = embed.status()) => ({ ...s, ...embedNotes });
function embedOn({ on }) {
  embed.setOn(!!on);
  if (on) recallLines();
  return embedStatus();
}
async function embedNear({ path: rel, texts }) {
  if (typeof rel !== 'string' || !Array.isArray(texts) || texts.length > 200 || !texts.every((t) => typeof t === 'string' && t.length <= 20000)) throw httpError(400, 'path, texts');
  const r = await embed.near(rel, texts);
  return r ? { results: r.results, n: r.n } : { results: null };
}

// The margin reads them with Claude (Settings; lib/judge.js): paragraphs of
// the note being written, and the paragraphs of other notes found near each
// ({ path, line }: read here, never of a private note or one
// .agentnotesignore names — those are not judged). → for each ref, { rel,
// why } or null. Answers are kept by what was sent (.agent-notes/judged.json).
let judge = null;
let judgedCache = null;
let recallEsm = null;
const JUDGED_FILE = path.join(DATA_DIR, 'judged.json');
const JUDGED_MAX = 3000;
// What may be sent of a note's paragraphs (Settings → … with Claude): the
// note (not private, not one .agentnotesignore names) and a reader of the
// other notes' paragraphs ({ path, line } → { path, line, name, raw, text }
// or null: not a note, the note itself, private, ignored, no such paragraph).
async function recallSending(b, what) {
  setLiveOpts(b);
  const agent = liveAgent();
  if (!agent) throw httpError(400, `${what} needs the Claude Code agent (Settings → Agents).`);
  const abs = workspacePath(b.path);
  const ignored = loadIgnore(ROOT);
  if (!NOTE_EXT.has(extOf(abs))) throw httpError(400, 'Only notes.');
  if (ignored(relOf(abs)) || (fs.existsSync(abs) && isPrivateNote(abs))) throw httpError(403, 'This note is private: its paragraphs are not sent.');
  recallEsm ||= await import(require('url').pathToFileURL(path.join(__dirname, 'public', 'recall.js')).href);
  const paras = new Map();
  const read = (r) => {
    let a;
    try { a = workspacePath(r.path); } catch { return null; }
    const f = relOf(a);
    if (!NOTE_EXT.has(extOf(a)) || ignored(f) || f === relOf(abs) || isPrivateNote(a)) return null;
    if (!paras.has(f)) { const c = cachedText(f); paras.set(f, c ? recallEsm.parasOf(c.text) : []); }
    const p = paras.get(f).find((x) => x.line === r.line);
    return p ? { path: f, line: p.line, name: path.basename(f).replace(/\.[^.]+$/, ''), raw: p.raw, text: p.text.slice(0, 800) } : null;
  };
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return { agent, env, read };
}
const validRefs = (refs, max) => Array.isArray(refs) && refs.length <= max && refs.every((r) => r && typeof r.path === 'string' && Number.isInteger(r.line) && r.line >= 0);
async function recallJudge(b) {
  const { path: rel, items, lang } = b;
  if (typeof rel !== 'string' || !Array.isArray(items) || items.length > 8
    || !items.every((it) => it && typeof it.text === 'string' && it.text.length <= 20000 && validRefs(it.refs, 3))) throw httpError(400, 'path, items: [{ text, refs: [{ path, line }] }]');
  const { agent, env, read: refText } = await recallSending(b, 'Reading the margin with Claude');
  judgedCache ||= new Map(Object.entries(readJson(JUDGED_FILE, {})));
  const want = lang === 'ko' || lang === 'en' ? lang : textLang(items.map((it) => it.text)) || 'en';
  const asked = items.map((it) => {
    const refs = it.refs.map(refText);
    const sent = refs.filter(Boolean);
    const text = it.text.replace(/\s+/g, ' ').trim().slice(0, 1500);
    return { text, refs, sent, key: crypto.createHash('sha1').update(JSON.stringify([want, text, sent.map((x) => [x.name, x.text])])).digest('hex') };
  });
  const todo = asked.filter((a) => a.sent.length && !judgedCache.has(a.key));
  if (todo.length) {
    judge ||= judgeMargin({ bin: liveBin(agent), env, opts: liveOpts });
    const r = await judge.ask(todo.map((a) => ({ text: a.text, refs: a.sent })), want);
    if (!r.ok) throw httpError(502, r.error || 'Claude did not answer.');
    todo.forEach((a, i) => { if (r.verdicts[i].every(Boolean)) judgedCache.set(a.key, r.verdicts[i]); });
    while (judgedCache.size > JUDGED_MAX) judgedCache.delete(judgedCache.keys().next().value);
    ensureDataDir();
    writeFileAtomic(JUDGED_FILE, JSON.stringify(Object.fromEntries(judgedCache)));
    todo.forEach((a, i) => { a.got = r.verdicts[i]; });
  }
  return {
    results: asked.map((a) => {
      const got = a.got || judgedCache.get(a.key) || [];
      let k = 0;
      return a.refs.map((x) => (x ? got[k++] || null : null));
    }),
  };
}

// The margin thinks along (Settings; lib/think.js): a paragraph of the note
// being written, what comes before it, and the paragraphs of other notes the
// page found near it ({ path, line }, read here as for recallJudge); when
// the model asks to look something up, the local model looks (if it is on).
// Its own model (Settings: Sonnet unless Haiku is chosen; it isn't waited
// on, and the better one tells a subject from a shared word), through the
// live margin's agent. → { items: [{ kind, due, say, refs: [{ path, line,
// name, raw }] }] } (none: nothing to say). Kept by what was sent
// (.agent-notes/thought.json).
let thinker = null;
let thinkerModel = '';
let thoughtCache = null;
const THOUGHT_FILE = path.join(DATA_DIR, 'thought.json');
const THOUGHT_MAX = 2000;
async function recallThink(b) {
  const { path: rel, text, before = '', refs = [], today = '', lang } = b;
  if (typeof rel !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 20000 || typeof before !== 'string' || before.length > 20000
    || !validRefs(refs, 6) || typeof today !== 'string' || today.length > 40) throw httpError(400, 'path, text, before, refs: [{ path, line }], today');
  const { agent, env, read } = await recallSending(b, 'Thinking along');
  const model = ['haiku', 'sonnet', 'opus'].includes(b.thinkModel) ? b.thinkModel : 'sonnet';
  thoughtCache ||= new Map(Object.entries(readJson(THOUGHT_FILE, {})));
  const found = refs.map(read).filter(Boolean);
  const para = text.replace(/\s+/g, ' ').trim().slice(0, 1500);
  const want = lang === 'ko' || lang === 'en' ? lang : textLang([para]) || 'en';
  const req = { text: para, before: before.slice(-1500), today, lang: want, found };
  const key = crypto.createHash('sha1').update(JSON.stringify(['v2', model, want, today.slice(0, 10), para, req.before, found.map((f) => [f.path, f.line, f.text])])).digest('hex');
  if (thoughtCache.has(key)) return thoughtCache.get(key);
  if (thinkerModel !== model) { thinker?.stop(); thinker = null; }
  thinkerModel = model;
  thinker ||= thinkMargin({ bin: liveBin(agent), env, opts: { ...liveOpts, model, effort: '' } });
  // What the model asks to look up: the paragraphs the local model finds
  // well above the rest (none while it is off or still reading).
  const search = async (query) => {
    const r = await embed.near(relOf(workspacePath(rel)), [query]);
    return (r?.results?.[0] || []).filter((x) => x.z >= 2).map(read).filter(Boolean);
  };
  const r = await thinker.think(req, search);
  if (!r.ok) throw httpError(502, r.error || 'Claude did not answer.');
  const out = { items: r.items.map((x) => ({ kind: x.kind, due: x.due, say: x.say, refs: x.from.map((n) => r.found[n - 1]).filter(Boolean).map(({ path: p, line, name, raw }) => ({ path: p, line, name, raw })) })) };
  thoughtCache.set(key, out);
  while (thoughtCache.size > THOUGHT_MAX) thoughtCache.delete(thoughtCache.keys().next().value);
  ensureDataDir();
  writeFileAtomic(THOUGHT_FILE, JSON.stringify(Object.fromEntries(thoughtCache)));
  return out;
}

// Develop this note (a command; lib/develop.js): the note's paragraphs and
// the paragraphs of other notes the page found near them ({ path, line },
// read here as for recallJudge, never a private or ignored note), to the
// thinks-along model. → { items: [{ kind, line (of the paragraph it is
// about), say, refs: [{ path, line, name, raw }] }] }. Kept by what was sent
// (.agent-notes/developed.json).
let developer = null;
let developerModel = '';
let developedCache = null;
const DEVELOPED_FILE = path.join(DATA_DIR, 'developed.json');
const DEVELOPED_MAX = 300;
async function recallDevelop(b) {
  const { path: rel, text, refs = [], today = '', lang, followUp } = b;
  if (followUp != null) return recallFollowUp(b);
  if (typeof rel !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 200000
    || !validRefs(refs, 12) || typeof today !== 'string' || today.length > 40) throw httpError(400, 'path, text, refs: [{ path, line }], today');
  const { agent, env, read } = await recallSending(b, 'Developing a note');
  const model = developModel(b);
  developedCache ||= new Map(Object.entries(readJson(DEVELOPED_FILE, {})));
  // The note's paragraphs, as many as fit in 8,000 characters.
  const paras = [];
  let size = 0;
  for (const p of recallEsm.parasOf(text)) {
    const t = p.text.replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!t || size + t.length > 8000) break;
    paras.push({ line: p.line, text: t });
    size += t.length;
  }
  if (!paras.length) throw httpError(400, 'The note has nothing to develop yet.');
  const links = new Set([...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().toLowerCase()));
  const found = sameOnce(refs.map(read).filter(Boolean)).map((f) => ({ ...f, linked: links.has(f.name.toLowerCase()) || links.has(f.path.replace(/\.[^.]+$/, '').toLowerCase()) }));
  const want = lang === 'ko' || lang === 'en' ? lang : textLang(paras.map((p) => p.text)) || 'en';
  const req = { paras: paras.map((p) => p.text), today, lang: want, found };
  const key = crypto.createHash('sha1').update(JSON.stringify(['v2', model, want, today.slice(0, 10), req.paras, found.map((f) => [f.path, f.line, f.text, f.linked])])).digest('hex');
  if (developedCache.has(key)) return developedCache.get(key);
  const r = await developerFor(agent, env, model).develop(req);
  if (!r.ok) throw httpError(502, r.error || 'Claude did not answer.');
  return developKeep(key, { items: r.items.map((x) => ({ kind: x.kind, line: paras[x.at].line, say: x.say, refs: x.from.map((n) => found[n - 1]).filter(Boolean).map(refOut) })) });
}
// One of its questions answered (in the margin): the paragraph, the
// question, the answers before and what came of them, the answer and the
// notes the question came from. → { items: [{ kind: 'sharper' | 'next' |
// 'question', say, refs }] }. Kept by what was sent.
async function recallFollowUp(b) {
  const { followUp: f, refs = [], lang } = b;
  const str = (x, n) => typeof x === 'string' && x.trim() && x.length <= n;
  const turns = f?.before ?? [];
  const okTurn = (t) => t && str(t.answer, 2000) && Array.isArray(t.said) && t.said.length <= 3 && t.said.every((x) => x && typeof x.kind === 'string' && x.kind.length <= 20 && str(x.say, 1000));
  if (typeof b.path !== 'string' || !f || typeof f !== 'object' || !str(f.para, 4000) || !str(f.question, 1000) || !str(f.answer, 2000)
    || !Array.isArray(turns) || turns.length > 4 || !turns.every(okTurn) || !validRefs(refs, 6)) throw httpError(400, 'path, followUp: { para, question, before: [{ answer, said }], answer }, refs');
  const { agent, env, read } = await recallSending(b, 'Developing a note');
  const model = developModel(b);
  developedCache ||= new Map(Object.entries(readJson(DEVELOPED_FILE, {})));
  const found = sameOnce(refs.map(read).filter(Boolean));
  const req = { para: f.para.replace(/\s+/g, ' ').trim().slice(0, 1500), question: f.question.trim(), before: turns.map((t) => ({ answer: t.answer.trim(), said: t.said.map((x) => ({ kind: x.kind, say: x.say })) })), answer: f.answer.trim(), found };
  req.lang = lang === 'ko' || lang === 'en' ? lang : textLang([req.para, req.answer]) || 'en';
  const key = crypto.createHash('sha1').update(JSON.stringify(['f2', model, req.lang, req.para, req.question, req.before, req.answer, found.map((x) => [x.path, x.line, x.text])])).digest('hex');
  if (developedCache.has(key)) return developedCache.get(key);
  const r = await developerFor(agent, env, model).followUp(req);
  if (!r.ok) throw httpError(502, r.error || 'Claude did not answer.');
  return developKeep(key, { items: r.items.map((x) => ({ kind: x.kind, say: x.say, refs: x.from.map((n) => found[n - 1]).filter(Boolean).map(refOut) })) });
}
const developModel = (b) => (['haiku', 'sonnet', 'opus'].includes(b.thinkModel) ? b.thinkModel : 'sonnet');
function developerFor(agent, env, model) {
  if (developerModel !== model) { developer?.stop(); developer = null; }
  developerModel = model;
  developer ||= developMargin({ bin: liveBin(agent), env, opts: { ...liveOpts, model, effort: '' } });
  return developer;
}
function developKeep(key, out) {
  developedCache.set(key, out);
  while (developedCache.size > DEVELOPED_MAX) developedCache.delete(developedCache.keys().next().value);
  ensureDataDir();
  writeFileAtomic(DEVELOPED_FILE, JSON.stringify(Object.fromEntries(developedCache)));
  return out;
}
const refOut = ({ path: p, line, name, raw }) => ({ path: p, line, name, raw });
// The same words in two notes (a copy, a backup) go once: the first found.
function sameOnce(found) {
  const seen = new Set();
  return found.filter((f) => { const k = f.text.replace(/\s+/g, ' ').trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Brief (Labs; lib/brief.js, public/brief.js): a meeting note, a draft or a
// plan, its last meeting's note ({ path }: read here, never a private or
// ignored one), the paragraphs of other notes the page found near it, and
// what the page's rules already flagged, to the thinks-along model.
// → { items: [{ kind, line, say, refs }] }. Kept by what was sent
// (.agent-notes/briefed.json).
let briefer = null;
let brieferModel = '';
let briefedCache = null;
const BRIEFED_FILE = path.join(DATA_DIR, 'briefed.json');
async function labBrief(b) {
  const { path: rel, text, mode, refs = [], noted = [], prev = null, today = '', lang } = b;
  if (typeof rel !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 200000 || !['meeting', 'writing', 'plan'].includes(mode)
    || !validRefs(refs, 12) || !Array.isArray(noted) || noted.length > 30 || !noted.every((x) => typeof x === 'string' && x.length <= 400)
    || (prev != null && typeof prev?.path !== 'string') || typeof today !== 'string' || today.length > 40) throw httpError(400, 'path, text, mode, refs, noted, prev: { path }, today');
  const { agent, env, read } = await recallSending(b, 'Brief');
  const model = developModel(b);
  briefedCache ||= new Map(Object.entries(readJson(BRIEFED_FILE, {})));
  const paras = [];
  let size = 0;
  for (const p of recallEsm.parasOf(text)) {
    const t = p.text.replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!t || size + t.length > 8000) break;
    paras.push({ line: p.line, text: t });
    size += t.length;
  }
  if (!paras.length) throw httpError(400, 'The note has nothing in it yet.');
  const dated = (f) => (/\d{4}-\d{2}-\d{2}/.exec(f.name) || [])[0] || (() => { try { return new Date(fs.statSync(path.join(ROOT, f.path)).mtimeMs).toISOString().slice(0, 10); } catch { return ''; } })();
  const found = sameOnce(refs.map(read).filter(Boolean)).map((f) => ({ ...f, date: dated(f) }));
  let last = null;
  if (prev) {
    let a = null;
    try { a = workspacePath(prev.path); } catch { /* none */ }
    const f = a && relOf(a);
    if (f && NOTE_EXT.has(extOf(a)) && !loadIgnore(ROOT)(f) && f !== relOf(workspacePath(rel)) && fs.existsSync(a) && !isPrivateNote(a)) {
      const c = cachedText(f);
      if (c) last = { name: path.basename(f).replace(/\.[^.]+$/, ''), text: c.text.slice(0, 4000) };
    }
  }
  const want = lang === 'ko' || lang === 'en' ? lang : textLang(paras.map((p) => p.text)) || 'en';
  const req = { mode, paras: paras.map((p) => p.text), today, lang: want, last, noted, found };
  const key = crypto.createHash('sha1').update(JSON.stringify(['b1', model, mode, want, today.slice(0, 10), req.paras, last, noted, found.map((f) => [f.path, f.line, f.text])])).digest('hex');
  if (briefedCache.has(key)) return briefedCache.get(key);
  if (brieferModel !== model) { briefer?.stop(); briefer = null; }
  brieferModel = model;
  briefer ||= briefMargin({ bin: liveBin(agent), env, opts: { ...liveOpts, model, effort: '' } });
  const r = await briefer.brief(req);
  if (!r.ok) throw httpError(502, r.error || 'Claude did not answer.');
  const out = { items: r.items.map((x) => ({ kind: x.kind, line: paras[x.at].line, say: x.say, refs: x.from.map((n) => found[n - 1]).filter(Boolean).map(refOut) })) };
  briefedCache.set(key, out);
  while (briefedCache.size > DEVELOPED_MAX) briefedCache.delete(briefedCache.keys().next().value);
  ensureDataDir();
  writeFileAtomic(BRIEFED_FILE, JSON.stringify(Object.fromEntries(briefedCache)));
  return out;
}

// An answer to one of the margin's questions: a line at the end of KNOWN.md
// (made with a heading the first time).
const KNOWN_HEAD = '# Known\n\nWhat you told Margin when it asked (Settings \u2192 The margin asks). Plain lines: change or delete any.\n';
function addKnown({ line }) {
  if (typeof line !== 'string' || !/^- \S/.test(line) || /[\r\n]/.test(line) || line.length > 2000) throw httpError(400, 'line: one list item');
  const abs = workspacePath(KNOWN_FILE);
  let old = null;
  try { old = fs.readFileSync(abs, 'utf8'); } catch { /* the first */ }
  const text = old == null ? `${KNOWN_HEAD}\n${line}\n` : `${old}${old.endsWith('\n') || !old ? '' : '\n'}${line}\n`;
  if (old != null) keepVersion(KNOWN_FILE, old, 'save');
  writeFileAtomic(abs, text);
  if (old == null) treeCache = null;
  return { path: KNOWN_FILE, hash: hashOf(Buffer.from(text, 'utf8')) };
}

// Check a task off (or on again), if that line is still that task.
function toggleTask({ path: relPath, line, text }) {
  const abs = workspacePath(relPath);
  const old = fs.readFileSync(abs, 'utf8');
  const lines = old.split('\n');
  const l = lines[Number(line) - 1];
  const m = l != null && TASK_RE.exec(l.replace(/\r$/, ''));
  if (!m || m[2].trim() !== text) throw httpError(409, 'That task moved or changed; refresh the list');
  lines[line - 1] = l.replace(/\[([ xX])\]/, m[1] === ' ' ? '[x]' : '[ ]');
  const content = lines.join('\n');
  keepVersion(relOf(abs), old, 'save');
  writeFileAtomic(abs, content);
  return { path: relOf(abs), done: m[1] === ' ', hash: hashOf(Buffer.from(content, 'utf8')) };
}

// Every heading in the workspace, for "@" in quick open. Lines count from 0.
function noteHeadings(c) {
  if (!c.heads) {
    c.heads = [];
    let fence = null;
    c.text.replace(/^\uFEFF/, '').split('\n').forEach((l, i) => {
      l = l.replace(/\r$/, '');
      const f = l.match(/^\s{0,3}(```+|~~~+)/);
      if (f && (!fence || f[1].startsWith(fence))) { fence = fence ? null : f[1]; return; }
      const m = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m && m[2]) c.heads.push({ level: m[1].length, text: m[2], line: i });
    });
  }
  return c.heads;
}

function listHeadings() {
  const headings = [];
  for (const rel of workspaceFiles()) {
    if (!NOTE_EXT.has(extOf(rel)) || isTemplatePath(rel)) continue;
    const c = cachedText(rel);
    if (c) for (const h of noteHeadings(c)) headings.push({ path: rel, ...h });
    if (headings.length >= 50000) break;
  }
  return { headings };
}

// ---------------------------------------------------------------- local history
// Earlier versions of notes, so text that a save, an agent run, a link update
// or another program replaced can be brought back — with or without git. They
// live in .agent-notes/history/<note path>/<time>.<reason> (ignored by git,
// not in the tree). A save keeps the text it replaces at most every few
// minutes; a change from outside keeps it unless one was just kept; the rest
// always do. Old ones go: past HISTORY_KEEP per note, or HISTORY_DAYS old
// (but never the newest HISTORY_MIN).
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_EVERY = { save: 5 * 60 * 1000, outside: 60 * 1000 };
const HISTORY_KEEP = 50;
const HISTORY_DAYS = 30;
const HISTORY_MIN = 5;
const HISTORY_MAX_BYTES = 1024 * 1024;
const VERSION_RE = /^(\d{13})\.(save|outside|agent|links|restore)$/;

const historyDir = (rel) => resolveInside(HISTORY_DIR, rel);

function versionsOf(rel) {
  let names;
  try { names = fs.readdirSync(historyDir(rel)); } catch { return []; }
  return names.map((id) => VERSION_RE.exec(id)).filter(Boolean)
    .map((m) => ({ id: m[0], date: Number(m[1]), reason: m[2] }))
    .sort((a, b) => b.date - a.date);
}

function keepVersion(rel, text, reason) {
  if (!NOTE_EXT.has(extOf(rel)) || typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > HISTORY_MAX_BYTES) return;
  try {
    const dir = historyDir(rel);
    const list = versionsOf(rel);
    const every = HISTORY_EVERY[reason];
    const recent = every && list.find((v) => reason === 'save' || v.reason === reason);
    if (recent && Date.now() - recent.date < every) return;
    if (list[0] && fs.readFileSync(path.join(dir, list[0].id), 'utf8') === text) return;
    ensureDataDir();
    fs.mkdirSync(dir, { recursive: true });
    let now = Date.now();
    while (list.some((v) => v.date === now)) now++;
    fs.writeFileSync(path.join(dir, `${now}.${reason}`), text);
    const old = Date.now() - HISTORY_DAYS * 86400000;
    [{ date: now }, ...list].forEach((v, i) => {
      if (v.id && (i >= HISTORY_KEEP || (i >= HISTORY_MIN && v.date < old))) fs.rmSync(path.join(dir, v.id), { force: true });
    });
  } catch { /* history is a safety net: never let it break a save */ }
}

function listVersions(rel) {
  const abs = workspacePath(rel);
  return { path: relOf(abs), versions: versionsOf(relOf(abs)) };
}

function getVersion(rel, id) {
  if (!VERSION_RE.test(String(id || ''))) throw httpError(400, 'Invalid version');
  const file = path.join(historyDir(relOf(workspacePath(rel))), id);
  try { return { id, content: fs.readFileSync(file, 'utf8') }; } catch { throw httpError(404, 'That version does not exist'); }
}

// Notes another program changed (an agent working in the folder, another
// editor): the text from before the first such change, until they are looked
// at — so they can be reviewed like an agent run, change by change.
// before: null for a note it made; the text now is null for one it deleted.
// They are kept on disk (lib/outside.js), and so is what Margin last saw of
// each note: one changed while it was closed is found when it opens.
const outside = new OutsideStore(path.join(DATA_DIR, 'outside')); // rel → { before, since, at }
const OUTSIDE_MAX = 200;
const seenNotes = new Seen(path.join(DATA_DIR, 'seen'));

function changedOutside(rel, was, now, when = Date.now()) {
  const seen = outside.get(rel);
  if (seen) {
    if (now === seen.before) outside.delete(rel); // back as it was
    else outside.set(rel, { ...seen, at: when });
    return;
  }
  if (was != null && Buffer.byteLength(was) > HISTORY_MAX_BYTES) return;
  if (outside.size >= OUTSIDE_MAX) outside.delete(outside.keys().next().value);
  outside.set(rel, { before: was, since: when, at: when });
}

// A note as Margin sees it now (text null: gone, or not text).
function sawNote(rel, text, st) {
  if (text != null && st?.isFile() && st.size <= MAX_OPEN_BYTES) seenNotes.record(rel, text, st);
  else if (!st) seenNotes.forget(rel);
}

// When Margin opens: the notes changed, made or deleted while it was closed,
// as changes from outside; then every note seen as it is (the first time
// only that — what came before can't be known).
async function catchUp() {
  ensureDataDir();
  const files = new Map();
  for (const rel of walk(ROOT)) {
    if (!NOTE_EXT.has(extOf(rel))) continue;
    try { const st = fs.statSync(path.join(ROOT, rel)); if (st.isFile() && st.size <= MAX_OPEN_BYTES) files.set(rel, st); } catch { /* gone */ }
  }
  const read = (rel) => { try { return readText(path.join(ROOT, rel)); } catch { return null; } };
  const away = changedWhileAway(seenNotes, files, read);
  for (const c of away) {
    if (c.before != null && c.now != null) keepVersion(c.rel, c.before, 'outside');
    changedOutside(c.rel, c.before, c.now, Math.round(c.at));
  }
  let n = 0;
  for (const [rel, st] of files) {
    const e = seenNotes.entry(rel);
    if (e && e.size === st.size && e.mtimeMs === st.mtimeMs) continue;
    const text = read(rel);
    if (text != null) seenNotes.record(rel, text, st);
    if (++n % 200 === 0) await new Promise((r) => setImmediate(r));
  }
  for (const rel of [...seenNotes.files.keys()]) if (!files.has(rel)) seenNotes.forget(rel);
  seenNotes.save(true);
  seenNotes.sweep();
  if (away.length) broadcast('fs', { paths: away.map((c) => c.rel), structural: false });
}

// → { status, now } while the note still differs from before; else forgets it.
function outsideState(rel) {
  const seen = outside.get(rel);
  if (!seen) return null;
  const now = fs.existsSync(path.join(ROOT, rel)) ? cachedText(rel)?.text ?? null : null;
  if (now === seen.before) { outside.delete(rel); return null; }
  return { status: seen.before == null ? 'added' : now == null ? 'deleted' : 'modified', now };
}

function listOutside() {
  const changes = [];
  for (const [rel, seen] of outside) {
    const st = outsideState(rel);
    if (st) changes.push({ path: rel, status: st.status, since: seen.since, at: seen.at });
  }
  return { changes: changes.sort((a, b) => b.at - a.at) };
}

function outsideDiff(rel) {
  const key = relOf(workspacePath(rel));
  const st = outsideState(key);
  if (!st) throw httpError(404, 'No change from outside in that note');
  const { before } = outside.get(key);
  const hash = st.now == null ? null : hashOf(Buffer.from(st.now, 'utf8'));
  if (st.status === 'added') return { path: key, status: 'added', lines: st.now.split('\n'), hunks: null, hash };
  if (st.status === 'deleted') return { path: key, status: 'deleted', before, lines: before.split('\n'), hunks: null, hash };
  return { path: key, status: 'modified', base: before, hunks: buildHunks(before, st.now), hash };
}

// Our own moves and deletes are not changes from outside.
const ownPaths = new Map(); // rel → when
function ours(...rels) {
  const t = Date.now();
  for (const rel of rels) {
    ownPaths.set(rel, t);
    for (const k of textCache.keys()) if (k.startsWith(`${rel}/`)) ownPaths.set(k, t);
  }
  if (ownPaths.size > 5000) for (const [k, v] of ownPaths) if (t - v > 5000) ownPaths.delete(k);
}
const isOurs = (rel) => Date.now() - (ownPaths.get(rel) || 0) < 5000;

function outsideSeen({ paths }) {
  for (const p of Array.isArray(paths) ? paths : []) outside.delete(relOf(workspacePath(p)));
  return listOutside();
}

// Our own writes to notes: remember the new text, so the watcher doesn't
// take them for changes from outside.
function wroteNote(abs, data) {
  if (!isInside(ROOT, abs) || isInside(DATA_DIR, abs) || !NOTE_EXT.has(extOf(abs))) return;
  try {
    const st = fs.statSync(abs);
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    textCache.set(relOf(abs), { mtimeMs: st.mtimeMs, size: st.size, created: Math.round(st.birthtimeMs || st.mtimeMs), text, lower: text.toLowerCase() });
    sawNote(relOf(abs), text, st);
  } catch { /* the cache fills itself on the next read */ }
}

// A note moved or renamed: its history goes with it.
function moveHistory(fromRel, toRel) {
  try {
    const from = historyDir(fromRel);
    if (!fs.existsSync(from)) return;
    const to = historyDir(toRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to)) fs.renameSync(from, to);
  } catch { /* keep it where it was */ }
}

// ---------------------------------------------------------------- your margin comments

// Your comments on a note: beside it (DATA_DIR/comments/<note>.json), never
// in it — each on the words it quotes, with who said it and when if you like,
// replies, and resolved or not.
const COMMENTS_DIR = path.join(DATA_DIR, 'comments');
const commentsOf = (rel) => `${resolveInside(COMMENTS_DIR, rel)}.json`;
function noteComments(rel) {
  try { const list = JSON.parse(fs.readFileSync(commentsOf(rel), 'utf8')); return Array.isArray(list) ? list : []; } catch { return []; }
}
function getComments(relPath) {
  const rel = relOf(workspacePath(relPath));
  return { path: rel, comments: noteComments(rel) };
}
// A comment on a drawing is pinned there: on a box of a flow, or at a point
// (in the picture's own pixels) of a picture or a sketch.
const PIN_ON = new Set(['flow', 'picture', 'sketch']);
function pinOf(p) {
  if (!p || typeof p !== 'object') return undefined;
  if (p.on === 'flow') return typeof p.box === 'string' && p.box.trim() ? { on: 'flow', box: p.box.slice(0, 300) } : undefined;
  const x = Number(p.x), y = Number(p.y);
  if (!PIN_ON.has(p.on) || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e5 || Math.abs(y) > 1e5) return undefined;
  return { on: p.on, x: Math.round(x), y: Math.round(y) };
}
function pinText(p) {
  if (!p) return '';
  if (p.on === 'flow') return ` (on the box "${p.box.replace(/\s+/g, ' ')}" of the flow chart)`;
  return ` (on the ${p.on} at x ${p.x}, y ${p.y} of its pixels)`;
}
function saveComments({ path: relPath, comments }) {
  const rel = relOf(workspacePath(relPath));
  if (!Array.isArray(comments) || comments.length > 1000) throw httpError(400, 'comments should be a list');
  const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
  const said = (r) => ({ text: str(r?.text, 4000) || '', speaker: str(r?.speaker, 80), time: str(r?.time, 40) });
  const clean = comments.map((c) => ({
    id: str(c?.id, 40)?.replace(/[^\w-]/g, '') || crypto.randomBytes(4).toString('hex'),
    quote: str(c?.quote, 2000) || '',
    alts: Array.isArray(c?.alts) ? c.alts.map((a) => str(a, 2000)).filter(Boolean).slice(0, 3) : [],
    line: Number.isInteger(c?.line) && c.line >= 0 ? c.line : undefined,
    comment: str(c?.comment, 4000) || '',
    speaker: str(c?.speaker, 80),
    time: str(c?.time, 40),
    replies: Array.isArray(c?.replies) ? c.replies.slice(0, 100).map(said).filter((r) => r.text.trim()) : [],
    resolved: str(c?.resolved, 40),
    pin: pinOf(c?.pin),
  })).filter((c) => c.comment.trim() || c.replies.length);
  const file = commentsOf(rel);
  if (!clean.length) fs.rmSync(file, { force: true });
  else { ensureDataDir(); writeFileAtomic(file, JSON.stringify(clean, null, 2)); }
  return { path: rel, comments: clean };
}
function moveComments(fromRel, toRel) {
  try {
    const from = commentsOf(fromRel);
    if (!fs.existsSync(from)) return;
    const to = commentsOf(toRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to)) fs.renameSync(from, to);
  } catch { /* keep them where they were */ }
}
// The open ones, as an agent reads them (with a task about the note).
function commentsForAgent(rel) {
  const open = noteComments(rel).filter((c) => !c.resolved && c.comment.trim());
  if (!open.length) return '';
  const who = (x) => [x.speaker && `said by ${x.speaker}`, x.time && `at ${x.time}`].filter(Boolean).join(' ');
  const line = (c) => {
    const head = `- on "${c.quote.replace(/\s+/g, ' ').slice(0, 300)}"${pinText(c.pin)}: ${c.comment.replace(/\s+/g, ' ')}${who(c) ? ` (${who(c)})` : ''}`;
    return [head, ...c.replies.map((r) => `  - reply: ${r.text.replace(/\s+/g, ' ')}${who(r) ? ` (${who(r)})` : ''}`)].join('\n');
  };
  return `The user's own margin comments on ${rel} (kept beside the note, not in its text):\n${open.slice(0, 200).map(line).join('\n')}`;
}

// ---------------------------------------------------------------- beside a note (experimental)

// Kept beside a note, never in it (lib/beside.js): the paragraphs you
// locked (DATA_DIR/locks/<note>.json, each a paragraph as written — an
// agent's change to one is never applied), its drawer of scraps set aside
// for it (DATA_DIR/drawer/<note>.md, Markdown), and for a note made with
// Gather, the pieces it was made of (DATA_DIR/gathered/<note>.json). A
// desk's margin cards not kept yet (DATA_DIR/desk/<desk>.json): what the
// margin wrote on it, kept so closing the desk loses nothing, out of the
// .canvas until the person keeps them.
const LOCKS_DIR = path.join(DATA_DIR, 'locks');
const DESK_DIR = path.join(DATA_DIR, 'desk');
const deskMarginOf = (rel) => `${resolveInside(DESK_DIR, rel)}.json`;
const DRAWER_DIR = path.join(DATA_DIR, 'drawer');
const GATHERED_DIR = path.join(DATA_DIR, 'gathered');
const locksOf = (rel) => `${resolveInside(LOCKS_DIR, rel)}.json`;
const drawerOf = (rel) => `${resolveInside(DRAWER_DIR, rel)}.md`;
const gatheredOf = (rel) => `${resolveInside(GATHERED_DIR, rel)}.json`;
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const cleanStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function noteLocks(rel) {
  const list = readJson(locksOf(rel), []);
  return Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()) : [];
}
function saveLocks({ path: relPath, locks }) {
  const rel = relOf(workspacePath(relPath));
  if (!Array.isArray(locks) || locks.length > 500) throw httpError(400, 'locks should be a list');
  const clean = [...new Set(locks.map((q) => cleanStr(q, 20000)).filter((q) => q.trim()))];
  const file = locksOf(rel);
  if (!clean.length) fs.rmSync(file, { force: true });
  else { ensureDataDir(); fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileAtomic(file, JSON.stringify(clean, null, 2)); }
  return { path: rel, locks: clean };
}

function noteDrawer(rel) {
  try { return drawerScraps(fs.readFileSync(drawerOf(rel), 'utf8')); } catch { return []; }
}
function saveDrawer({ path: relPath, scraps }) {
  const rel = relOf(workspacePath(relPath));
  if (!Array.isArray(scraps) || scraps.length > 500) throw httpError(400, 'scraps should be a list');
  const clean = scraps.map((s) => ({
    text: cleanStr(s?.text, 50000).replace(/<!-- scrap/g, '<!--  scrap').trim(),
    from: cleanStr(s?.from, 1000).replace(/["\n]/g, '') || undefined,
    line: Number.isInteger(s?.line) && s.line >= 0 ? s.line : undefined,
    at: cleanStr(s?.at, 40).replace(/["\n]/g, '') || undefined,
  })).filter((s) => s.text);
  const file = drawerOf(rel);
  if (!clean.length) fs.rmSync(file, { force: true });
  else { ensureDataDir(); fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileAtomic(file, drawerText(clean)); }
  return { path: rel, scraps: noteDrawer(rel) };
}

const DESK_KINDS = new Set(['summary', 'merge', 'question', 'answer', 'trail']);
function deskMarginCards(rel) {
  const d = readJson(deskMarginOf(rel), null);
  return Array.isArray(d?.cards) ? d.cards : [];
}
function saveDeskMargin({ path: relPath, cards }) {
  const rel = relOf(workspacePath(relPath));
  if (!/\.canvas$/i.test(rel)) throw httpError(400, 'Not a desk');
  if (!Array.isArray(cards) || cards.length > 200) throw httpError(400, 'cards should be a list');
  const num = (v, min = -1e7) => (Number.isFinite(v) ? Math.max(min, Math.min(1e7, Math.round(v))) : min > 0 ? min : 0);
  const clean = cards.map((c) => ({
    id: cleanStr(c?.id, 64), kind: DESK_KINDS.has(c?.kind) ? c.kind : 'answer',
    batch: cleanStr(c?.batch, 64) || undefined, of: cleanStr(c?.of, 64) || undefined, title: cleanStr(c?.title, 200) || undefined,
    text: cleanStr(c?.text, 50000), x: num(c?.x), y: num(c?.y), width: num(c?.width, 60), height: num(c?.height, 40),
    paths: Array.isArray(c?.paths) ? c.paths.slice(0, 24).map((p) => cleanStr(p, 1000)).filter(Boolean) : undefined,
  })).filter((c) => c.id && c.text.trim());
  const file = deskMarginOf(rel);
  if (!clean.length) fs.rmSync(file, { force: true });
  else { ensureDataDir(); fs.mkdirSync(path.dirname(file), { recursive: true }); writeFileAtomic(file, JSON.stringify({ at: new Date().toISOString(), cards: clean }, null, 2)); }
  return { path: rel, cards: clean.length };
}

// The desk's "Over time" (public/trail.js): the notes on it, and the
// meetings before and after them ("Previous meeting: [[…]]" near the top,
// either way), each with what tells when it was (its file's times, its
// oldest kept version) and the to-do lines of its kept versions (when one
// was ticked). Read here, sent nowhere.
const TRAIL_MAX = 24;
const PREVIOUS_RE = /^\s*(?:\*\*)?Previous meeting:?(?:\*\*)?:?\s*\[\[([^\]|#]+)/i;
// The meeting a note names before it, from its first 4 KB, kept while the
// file is the same (every note is looked at for each request).
const previousNames = new Map(); // rel → { mtimeMs, size, name }
function previousName(rel) {
  const abs = path.join(ROOT, rel);
  let st;
  try { st = fs.statSync(abs); } catch { previousNames.delete(rel); return null; }
  const hit = previousNames.get(rel);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.name;
  let head = '';
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('utf8');
  } catch { /* unreadable: none */ }
  const name = head.split('\n', 20).map((l) => PREVIOUS_RE.exec(l)).find(Boolean)?.[1].trim() || null;
  if (previousNames.size > 50000) previousNames.clear();
  previousNames.set(rel, { mtimeMs: st.mtimeMs, size: st.size, name });
  return name;
}
function deskTrail({ paths }) {
  if (!Array.isArray(paths) || !paths.length) throw httpError(400, 'paths should be a list');
  const ignored = loadIgnore(ROOT);
  const notes = workspaceFiles().filter((f) => NOTE_EXT.has(extOf(f)) && !isTemplatePath(f) && !ignored(f));
  // [[name]] → a note: in the folder of the note that names it, then by its
  // path from the root (with or without .md), else by its name anywhere.
  const byPath = new Map(notes.map((f) => [f.toLowerCase(), f]));
  const byName = new Map();
  const stemOf = (f) => path.posix.basename(f).replace(/\.(md|markdown)$/i, '').toLowerCase();
  for (const f of notes) { const k = stemOf(f); if (!byName.has(k)) byName.set(k, f); }
  const find = (name, from) => {
    const t = name.trim().toLowerCase();
    const dir = path.posix.dirname(from.toLowerCase());
    const here = dir === '.' ? t : `${dir}/${t}`;
    return byPath.get(here) || byPath.get(`${here}.md`) || byPath.get(t) || byPath.get(`${t}.md`) || byName.get(stemOf(t)) || null;
  };
  const prevOf = new Map();
  for (const f of notes) {
    const name = previousName(f);
    const p = name && find(name, f);
    if (p && p !== f) prevOf.set(f, p);
  }
  const want = [];
  let more = false;
  const add = (f) => { if (!f || want.includes(f)) return; if (want.length < TRAIL_MAX) want.push(f); else more = true; };
  for (const p of paths) add(byPath.get(String(p).toLowerCase()));
  for (let i = 0; i < want.length; i++) {
    add(prevOf.get(want[i]));
    for (const [f, p] of prevOf) if (p === want[i]) add(f);
  }
  return {
    notes: want.map((f) => {
      const c = cachedText(f);
      let st = null;
      try { st = fs.statSync(path.join(ROOT, f)); } catch { /* gone */ }
      const versions = versionsOf(f).slice(0, HISTORY_KEEP).map((v) => {
        let t = '';
        try { t = fs.readFileSync(path.join(historyDir(f), v.id), 'utf8'); } catch { /* gone */ }
        return [v.date, t.split('\n').filter((l) => TASK_RE.test(l)).join('\n')];
      });
      return {
        path: f, text: (c?.text || '').slice(0, 200000), prev: prevOf.get(f) || null,
        created: st ? Math.round(st.birthtimeMs || st.mtimeMs) : null, modified: st ? Math.round(st.mtimeMs) : null,
        versions, private: isPrivateNote(path.join(ROOT, f)) || undefined,
      };
    }),
    more,
  };
}

function keepGathered(rel, pieces) {
  if (!Array.isArray(pieces) || !pieces.length) return;
  const clean = pieces.slice(0, 500).map((p) => ({ from: cleanStr(p?.from, 1000), line: Number.isInteger(p?.line) ? p.line : undefined, text: cleanStr(p?.text, 50000) })).filter((p) => p.from && p.text.trim());
  if (!clean.length) return;
  ensureDataDir();
  const file = gatheredOf(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify({ at: new Date().toISOString(), pieces: clean }, null, 2));
}

// Where a note's paragraphs came from: the lines each applied run put in it
// (and what it was asked), the pieces it was gathered from, the drawer's
// scraps from other notes, and the notes its own paragraphs were gathered
// into. The app finds them on the note as it is now.
function originOf(relPath) {
  const rel = relOf(workspacePath(relPath));
  let ids = [];
  try { ids = fs.readdirSync(RUNS_DIR).filter((n) => /^[\w-]+$/.test(n)).sort(); } catch { /* none yet */ }
  const runs = [];
  for (const id of ids) {
    let meta;
    try { meta = readMeta(id); } catch { continue; }
    const f = meta.status === 'applied' && meta.kind !== 'proof' ? meta.applied?.files?.find((x) => x.path === rel) : null;
    if (!f || f.status === 'deleted') continue;
    let lines = [];
    try {
      const work = fs.readFileSync(path.join(runDir(id), 'work', rel), 'utf8');
      if (f.status === 'added') lines = work.split('\n').filter((l) => l.trim());
      else lines = addedLines(buildHunks(fs.readFileSync(path.join(runDir(id), 'base', rel), 'utf8'), work), f.hunks || []);
    } catch { continue; }
    if (lines.length) runs.push({ id, task: meta.originalTask || meta.task, last: meta.task, round: meta.round || 1, recipe: meta.recipe || '', agent: meta.agent, at: meta.applied.at, lines });
  }
  const made = readJson(gatheredOf(rel), null);
  const usedIn = [];
  for (const file of fs.existsSync(GATHERED_DIR) ? walk(GATHERED_DIR) : []) {
    if (!file.endsWith('.json')) continue;
    const into = file.slice(0, -5);
    if (into === rel || !fs.existsSync(path.join(ROOT, into))) continue;
    const rec = readJson(path.join(GATHERED_DIR, file), null);
    for (const p of rec?.pieces || []) if (p.from === rel) usedIn.push({ into, text: p.text, at: rec.at });
  }
  return {
    path: rel, runs, usedIn, locks: noteLocks(rel),
    gathered: (made?.pieces || []).map((p) => ({ ...p, at: made.at })),
    drawer: noteDrawer(rel).filter((s) => s.from && s.from !== rel),
  };
}

// What an agent is told of them: the locked paragraphs of the notes it
// sees, and the drawer of the note in view (its scraps from notes it may
// not see left out).
function besideForAgent(files, focus) {
  const out = [];
  const locked = [];
  for (const f of files.slice(0, 2000)) {
    const locks = noteLocks(f);
    if (!locks.length) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const q of locks) if (text.includes(q)) locked.push(`In ${f}:\n<<<\n${q}\n>>>`);
  }
  if (locked.length) out.push(`The user locked these paragraphs. Leave each exactly as it is — Margin will not apply a change to them:\n${locked.slice(0, 100).join('\n')}`);
  if (focus) {
    const ignored = loadIgnore(ROOT);
    const scraps = noteDrawer(focus).filter((s) => !s.from || (!ignored(s.from) && !isPrivateNote(path.join(ROOT, s.from))));
    if (scraps.length) {
      out.push(`The user's drawer for ${focus}: material they set aside for this note, not in it. Use it where the task calls for it; it is not a file to edit.\n${scraps.slice(0, 100).map((s) => `<<<${s.from ? ` (from ${s.from})` : ''}\n${s.text.slice(0, 8000)}\n>>>`).join('\n')}`);
    }
  }
  return out.join('\n\n');
}

// A note moved: what is beside it goes with it.
function moveBeside(fromRel, toRel) {
  for (const of of [locksOf, drawerOf, gatheredOf, deskMarginOf]) {
    try {
      const from = of(fromRel);
      if (!fs.existsSync(from)) continue;
      const to = of(toRel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    } catch { /* keep it where it was */ }
  }
}

// ---------------------------------------------------------------- your suggestions

// Your suggestions on a note (suggesting, as tracked changes): a run like an
// agent's — base the note as it is, work as you would have it — written by
// you, so they are reviewed and applied the same way and the note itself is
// untouched until then. One open at a time for each note.
function openProof({ path: relPath }) {
  const rel = relOf(workspacePath(relPath));
  if (!NOTE_EXT.has(extOf(rel))) throw httpError(400, 'Suggestions are for notes');
  let now;
  try { now = readText(path.join(ROOT, rel)); } catch { throw httpError(404, 'Not found'); }
  if (now == null) throw httpError(400, 'Not a text file');
  const open = listRuns().find((r) => r.kind === 'proof' && r.focus === rel && r.status === 'review');
  if (open) {
    const dir = runDir(open.id);
    const base = fs.readFileSync(path.join(dir, 'base', rel), 'utf8');
    const work = fs.readFileSync(path.join(dir, 'work', rel), 'utf8');
    if (base === now) return { id: open.id, base, work };
    // The note changed since: the suggestions go on over it, where they can.
    const hunks = buildHunks(base, work);
    const m = mergeHunks(base, now, hunks, new Set(hunks.keys()));
    if (m.conflicts.length) throw httpError(409, 'The note changed where you made suggestions: settle those first', { id: open.id });
    fs.writeFileSync(path.join(dir, 'base', rel), now);
    fs.writeFileSync(path.join(dir, 'work', rel), m.text);
    return { id: open.id, base: now, work: m.text };
  }
  ensureDataDir();
  const id = newRunId();
  const dir = runDir(id);
  for (const sub of ['base', 'work']) {
    fs.mkdirSync(path.dirname(path.join(dir, sub, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, rel), now);
  }
  const at = new Date().toISOString();
  writeMeta({
    id, kind: 'proof', task: `Your suggestions on ${rel}`, scope: 'file', focus: rel, parent: null, round: 1, recipe: '',
    agent: 'You', agentId: null, command: null, model: '', status: 'review', startedAt: at, finishedAt: at,
    exitCode: 0, files: [rel], excluded: [], applied: null, selection: 0,
  });
  return { id, base: now, work: now, created: true };
}

// The note as you would have it, kept as you type.
function saveProof(id, { text }) {
  const meta = readMeta(id);
  if (meta.kind !== 'proof') throw httpError(400, 'Not your suggestions');
  if (meta.status !== 'review') throw httpError(409, 'These suggestions were settled already');
  if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) throw httpError(400, 'text required');
  fs.writeFileSync(path.join(runDir(id), 'work', meta.focus), text);
  return { id, saved: true };
}

// Your comments, shown with your suggestions: each on the words of the note
// as it was that it quotes.
function proofComments(meta) {
  let base = '';
  try { base = fs.readFileSync(path.join(runDir(meta.id), 'base', meta.focus), 'utf8'); } catch { /* gone */ }
  return noteComments(meta.focus).filter((c) => !c.resolved).map((c, n) => ({
    file: meta.focus, n, by: 'you', comment: c.comment, speaker: c.speaker, time: c.time, replies: c.replies,
    quote: [c.quote, ...(c.alts || [])].find((q) => q && base.includes(q)) || c.quote,
  }));
}

// ---------------------------------------------------------------- attachments

const RAW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

// Saves a pasted/dropped file into `assets/` next to the note; returns the
// path relative to the note for a portable Markdown link.
function saveAsset({ note, name, data }) {
  if (typeof data !== 'string' || !data) throw httpError(400, 'data (base64) required');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length || buf.length > MAX_ASSET_BYTES) throw httpError(413, 'Attachment must be between 1 byte and 25 MB');
  const noteAbs = workspacePath(note);
  const dir = path.join(path.dirname(noteAbs), 'assets');
  let file = path.basename(String(name || 'file')).normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '') || 'file';
  if (/^(image|pasted)\.\w+$/i.test(file)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    file = `pasted-${stamp}${path.extname(file)}`;
  }
  const ext = path.extname(file);
  const stemName = file.slice(0, file.length - ext.length);
  let target = path.join(dir, file);
  for (let n = 1; fs.existsSync(target); n++) target = path.join(dir, `${stemName}-${n}${ext}`);
  target = workspacePath(relOf(target));
  writeFileAtomic(target, buf);
  return { path: path.relative(path.dirname(noteAbs), target).split(path.sep).join('/'), workspacePath: relOf(target) };
}

function serveRaw(relPath, res) {
  const abs = workspacePath(relPath);
  const type = RAW_MIME[extOf(abs)];
  if (!type) throw httpError(415, 'Only images are served');
  let st;
  try { st = fs.statSync(abs); } catch { throw httpError(404, 'Not found'); }
  if (!st.isFile() || st.size > 50 * 1024 * 1024) throw httpError(413, 'Too large');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': st.size,
    // SVGs can carry script; a sandboxed CSP keeps a direct open inert.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Cache-Control': 'private, max-age=30',
  });
  fs.createReadStream(abs).pipe(res);
}

// ---------------------------------------------------------------- rename / move / delete
// Renames keep the workspace linked: [[wikilinks]] and relative Markdown links
// that pointed at moved notes are rewritten, and moved notes' own relative
// links are re-based. Deletes go to .agent-notes/trash so they can be undone.

function relLinkTarget(fromDir, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || /^[a-z][\w+.-]*:/i.test(clean) || clean.startsWith('/')) return null;
  let decoded = clean;
  try { decoded = decodeURI(clean); } catch { /* keep raw */ }
  return path.posix.normalize(path.posix.join(fromDir, decoded));
}

function relHref(fromDir, target, original) {
  let rel = path.posix.relative(fromDir, target) || path.posix.basename(target);
  const suffix = original.slice(original.split('#')[0].split('?')[0].length);
  if (/[ ()<>]/.test(rel) || /%[0-9A-F]{2}/i.test(original)) rel = encodeURI(rel);
  return rel + suffix;
}

function rewriteLinks(text, notePathOld, notePathNew, moved, renamedStems) {
  const oldDir = path.posix.dirname(notePathOld);
  const newDir = path.posix.dirname(notePathNew);
  let changed = false;
  // [text](relative/link.md) and ![alt](assets/x.png)
  let out = text.replace(/(\]\()([^)\s]+)(\s+"[^"]*")?\)/g, (m, open, href, title = '') => {
    const target = relLinkTarget(oldDir, href);
    if (!target) return m;
    const newTarget = moved.get(target) || target;
    if (newTarget === target && oldDir === newDir) return m;
    const next = relHref(newDir, newTarget, href);
    if (next === href) return m;
    changed = true;
    return `${open}${next}${title})`;
  });
  // [[Name]], [[Name|label]], [[Name#heading]], [[folder/Name]]
  out = out.replace(/(!?\[\[)([^\]|#\n]+)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\])/g, (m, open, target, rest) => {
    const t = target.trim();
    const lower = t.toLowerCase();
    if (renamedStems.has(lower)) { changed = true; return `${open}${renamedStems.get(lower)}${rest}`; }
    if (t.includes('/')) {
      const candidate = moved.get(`${t}.md`) || moved.get(t);
      if (candidate) { changed = true; return `${open}${candidate.replace(/\.md$/i, '')}${rest}`; }
    }
    return m;
  });
  return changed ? out : null;
}

function renamePath({ from, to }) {
  const src = workspacePath(from);
  let dstRel = String(to || '').trim().replace(/^\/+/, '');
  if (!dstRel) throw httpError(400, 'New name required');
  let st;
  try { st = fs.statSync(src); } catch { throw httpError(404, 'Not found'); }
  if (st.isFile() && NOTE_EXT.has(extOf(from)) && !path.extname(dstRel)) dstRel += path.extname(from);
  const dst = workspacePath(dstRel);
  if (fs.existsSync(dst) && fs.realpathSync(dst) !== fs.realpathSync(src)) throw httpError(409, 'Something with that name already exists');
  if (isInside(src, dst) && src !== dst) throw httpError(400, 'Cannot move a folder into itself');

  const fromRel = relOf(src);
  const toRel = relOf(dst);
  const all = walk(ROOT);
  const moved = new Map();
  if (st.isDirectory()) {
    for (const f of all) if (f.startsWith(`${fromRel}/`)) moved.set(f, toRel + f.slice(fromRel.length));
  } else moved.set(fromRel, toRel);

  // Bare [[Stem]] links follow a renamed note only if that stem was unique.
  const renamedStems = new Map();
  if (st.isFile() && NOTE_EXT.has(extOf(fromRel))) {
    const oldStem = path.posix.basename(fromRel, path.posix.extname(fromRel));
    const newStem = path.posix.basename(toRel, path.posix.extname(toRel));
    const sameStem = all.filter((f) => NOTE_EXT.has(extOf(f)) && path.posix.basename(f, path.posix.extname(f)).toLowerCase() === oldStem.toLowerCase());
    const newTaken = all.some((f) => f !== fromRel && NOTE_EXT.has(extOf(f)) && path.posix.basename(f, path.posix.extname(f)).toLowerCase() === newStem.toLowerCase());
    if (oldStem !== newStem && sameStem.length === 1) renamedStems.set(oldStem.toLowerCase(), newTaken ? toRel.replace(/\.md$/i, '') : newStem);
  }

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  ours(fromRel, toRel, ...moved.keys(), ...moved.values());
  fs.renameSync(src, dst);
  treeCache = null;
  for (const [a, b] of moved) { moveHistory(a, b); moveComments(a, b); moveBeside(a, b); }

  const updated = [];
  for (const f of all) {
    if (!NOTE_EXT.has(extOf(f))) continue;
    const now = moved.get(f) || f;
    const abs = path.join(ROOT, now);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (!text.includes('](') && !text.includes('[[')) continue;
    const next = rewriteLinks(text, f, now, moved, renamedStems);
    if (next !== null) { keepVersion(now, text, 'links'); writeFileAtomic(abs, next); updated.push(now); }
  }
  return { from: fromRel, to: toRel, moved: Object.fromEntries(moved), updated };
}

function deletePath({ path: relPath }) {
  const abs = workspacePath(relPath);
  if (!fs.existsSync(abs)) throw httpError(404, 'Not found');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const trashRel = `deleted-${stamp}-${crypto.randomBytes(2).toString('hex')}/${relOf(abs)}`;
  const trash = path.join(DATA_DIR, 'trash', trashRel);
  ensureDataDir();
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  ours(relOf(abs));
  fs.renameSync(abs, trash);
  treeCache = null;
  return { path: relOf(abs), trash: trashRel };
}

function restorePath({ trash, path: relPath }) {
  if (typeof trash !== 'string' || trash.includes('..')) throw httpError(400, 'Invalid trash entry');
  const src = resolveInside(path.join(DATA_DIR, 'trash'), trash);
  const dst = workspacePath(relPath);
  if (!fs.existsSync(src)) throw httpError(404, 'Trash entry not found');
  if (fs.existsSync(dst)) throw httpError(409, 'Something already exists at that path');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  ours(relOf(dst));
  fs.renameSync(src, dst);
  treeCache = null;
  return { path: relOf(dst) };
}

// Which of these paths the privacy rules withhold from agents, and why: a
// moved note may leave (or come under) .agentnotesignore. Paths not there
// yet are only matched against it.
function privateOf({ paths }) {
  if (!Array.isArray(paths) || paths.length > 5000) throw httpError(400, 'paths: a list');
  const ignored = loadIgnore(ROOT);
  const out = {};
  for (const rel of paths) {
    const abs = workspacePath(rel);
    const reason = ignored(relOf(abs)) ? '.agentnotesignore'
      : NOTE_EXT.has(extOf(abs)) && isPrivateNote(abs) ? 'front matter (private)' : null;
    if (reason) out[relOf(abs)] = reason;
  }
  return { private: out };
}

function createFolder({ path: relPath }) {
  const abs = workspacePath(relPath);
  if (fs.existsSync(abs)) throw httpError(409, 'Already exists');
  fs.mkdirSync(abs, { recursive: true });
  treeCache = null;
  return { path: relOf(abs) };
}

// ---------------------------------------------------------------- git (local only)
// Status, diffs, history, commits. Never fetches, pulls or pushes: nothing
// here talks to a remote. Runs the system `git` without a shell.

const REV_RE = /^[0-9a-f]{7,40}$/i;
const AGENT_EMAIL = 'agent@margin.local';

function git(args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (err && !allowFail) {
        const msg = (stderr || err.message).trim().split('\n').slice(-3).join(' ');
        return reject(httpError(err.code === 'ENOENT' ? 501 : 400, err.code === 'ENOENT' ? 'git is not installed' : `git: ${msg}`));
      }
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// Workspace may be a sub-folder of a repository: remember the prefix so we
// can translate between repo paths and workspace paths.
async function gitInfo() {
  const r = await git(['rev-parse', '--is-inside-work-tree', '--show-prefix', '--abbrev-ref', 'HEAD'], { allowFail: true });
  if (!r.ok) {
    const inside = await git(['rev-parse', '--is-inside-work-tree', '--show-prefix'], { allowFail: true });
    if (!inside.ok) return { repo: false };
    const [, prefix = ''] = inside.stdout.split('\n');
    return { repo: true, prefix, branch: '(no commits yet)', empty: true };
  }
  const [, prefix = '', branch = ''] = r.stdout.split('\n');
  return { repo: true, prefix, branch };
}

const toWorkspacePath = (info, repoPath) => (repoPath.startsWith(info.prefix) ? repoPath.slice(info.prefix.length) : null);

async function gitStatus() {
  const info = await gitInfo();
  if (!info.repo) return { repo: false };
  const r = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
  const parts = r.stdout.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    let repoPath = entry.slice(3);
    if (x === 'R' || x === 'C') i++; // rename source follows
    const p = toWorkspacePath(info, repoPath);
    if (!p || p.split('/').some((seg) => SKIP_NAMES.has(seg))) continue;
    const code = x === '?' ? 'U' : x === 'A' ? 'A' : (x === 'D' || y === 'D') ? 'D' : (x === 'R') ? 'R' : 'M';
    files.push({ path: p, code, staged: x !== ' ' && x !== '?' });
  }
  return { repo: true, branch: info.branch, empty: !!info.empty, files };
}

async function gitInit() {
  const info = await gitInfo();
  if (info.repo) throw httpError(409, 'Already a git repository');
  await git(['init']);
  return gitStatus();
}

async function headContent(info, p) {
  if (info.empty) return null;
  const r = await git(['show', `HEAD:${info.prefix}${p}`], { allowFail: true });
  return r.ok ? r.stdout : null;
}

async function gitDiff(p) {
  const info = await gitInfo();
  if (!info.repo) throw httpError(400, 'Not a git repository');
  const abs = workspacePath(p);
  const head = await headContent(info, relOf(abs));
  let current = null;
  try { current = readText(abs); } catch { current = null; }
  if (head === current) return { path: p, status: 'unchanged', hunks: [] };
  if (head == null) return { path: p, status: 'added', lines: (current || '').split('\n').slice(0, 2000) };
  if (current == null) return { path: p, status: 'deleted', lines: head.split('\n').slice(0, 2000) };
  return { path: p, status: 'modified', hunks: buildHunks(head, current) };
}

async function gitLog(p, limit = 100) {
  const info = await gitInfo();
  if (!info.repo || info.empty) return { repo: info.repo, commits: [] };
  const args = ['log', `-n${Math.min(500, Number(limit) || 100)}`, '--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s', '--name-only'];
  if (p) args.push('--follow', '--', relOf(workspacePath(p)));
  else args.push('--', '.');
  const r = await git(args);
  const commits = r.stdout.split('\x1e').filter((x) => x.trim()).map((block) => {
    const [head, ...names] = block.split('\n');
    const [hash, author, email, date, subject] = head.split('\x1f');
    const files = names.map((n) => n.trim()).filter(Boolean);
    return { hash, author, agent: email === AGENT_EMAIL, date, subject, gitPath: p ? files[0] : undefined, files: p ? undefined : files.length };
  });
  return { repo: true, commits };
}

async function gitShow(rev, gitPath) {
  if (!REV_RE.test(String(rev || ''))) throw httpError(400, 'Invalid revision');
  if (typeof gitPath !== 'string' || !gitPath || gitPath.includes('\0') || gitPath.startsWith('/')) throw httpError(400, 'Invalid path');
  const r = await git(['show', `${rev}:${gitPath}`], { allowFail: true });
  if (!r.ok) throw httpError(404, 'That version does not exist');
  if (r.stdout.includes('\0')) throw httpError(415, 'Binary file');
  return { rev, content: r.stdout };
}

// Commit workspace changes (all, or the given paths). Agent commits carry the
// agent as author; the committer is always the user's own git identity.
async function gitCommit({ message, paths, author }) {
  const info = await gitInfo();
  if (!info.repo) throw httpError(400, 'Not a git repository');
  const msg = String(message || '').trim();
  if (!msg) throw httpError(400, 'Commit message required');
  const list = Array.isArray(paths) && paths.length ? paths.map((p) => relOf(workspacePath(p))) : null;
  if (list) await git(['add', '-A', '--', ...list]);
  else await git(['add', '-A', '--', '.']);
  const args = ['commit', '-m', msg];
  if (author) args.push(`--author=${author}`);
  if (list) args.push('--', ...list);
  const r = await git(args, { allowFail: true });
  if (!r.ok) {
    const text = `${r.stdout}\n${r.stderr}`;
    if (/Please tell me who you are|user\.email|user\.name/.test(text)) {
      throw httpError(400, 'Set your git identity first: git config --global user.name "Your Name" && git config --global user.email you@example.com');
    }
    if (/nothing (added )?to commit|no changes added/.test(text)) throw httpError(409, 'Nothing to commit');
    throw httpError(400, `git: ${text.trim().split('\n').slice(-2).join(' ')}`);
  }
  const head = await git(['rev-parse', '--short', 'HEAD']);
  return { hash: head.stdout.trim(), status: await gitStatus() };
}

// ---------------------------------------------------------------- agent runs

const running = new Map();

function runDir(id) {
  if (!/^[\w-]+$/.test(String(id))) throw httpError(400, 'Invalid run id');
  return path.join(RUNS_DIR, id);
}

function readMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir(id), 'meta.json'), 'utf8')); }
  catch { throw httpError(404, 'Run not found'); }
}

function writeMeta(meta) {
  writeFileAtomic(path.join(runDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2));
  broadcast('runs', { id: meta.id, status: meta.status });
}

// Which files an agent would see for a given scope, and which ones the
// privacy rules withhold. The UI shows this before anything runs.
function resolveScope(scope, focus, task = '') {
  const ignored = loadIgnore(ROOT);
  const all = walk(ROOT);
  let files = all.filter((f) => NOTE_EXT.has(extOf(f)));
  if (scope === 'file') {
    files = files.filter((f) => f === focus);
    if (!files.length) throw httpError(400, 'Open a Markdown or text note to use "this note" scope');
  } else if (scope === 'folder') {
    const dir = focus ? path.posix.dirname(focus) : '.';
    if (dir !== '.') files = files.filter((f) => f.startsWith(`${dir}/`));
  } else if (scope === 'commands') {
    files = files.filter((f) => COMMAND_NOTES.includes(f));
  } else if (scope !== 'workspace') {
    throw httpError(400, 'Unknown scope');
  }
  // A task about Margin's notes of commands sees them too.
  if (scope !== 'commands' && COMMANDS_TASK.test(task)) {
    for (const f of COMMAND_NOTES) if (all.includes(f) && !files.includes(f)) files.push(f);
  }
  const included = [];
  const excluded = [];
  for (const f of files) {
    const reason = ignored(f) ? '.agentnotesignore'
      : isPrivateNote(path.join(ROOT, f)) ? 'front matter (private)' : null;
    if (reason) excluded.push({ path: f, reason });
    else included.push(f);
  }
  // A task about pictures sees the ones the shared notes show.
  const pictures = [];
  if (PICTURE_TASK.test(task)) {
    const there = new Set(all);
    for (const f of included) {
      let text = '';
      try { text = readText(path.join(ROOT, f)) || ''; } catch { continue; }
      for (const p of picturesIn(text, f, all)) {
        if (pictures.length >= MAX_PICTURES || pictures.includes(p) || !there.has(p) || ignored(p)) continue;
        try { if (fs.statSync(path.join(ROOT, p)).size <= MAX_PICTURE_BYTES) pictures.push(p); } catch { /* gone */ }
      }
    }
  }
  // The parts of them any note hides (```ink `hide` lines): the app covers
  // those before it shares the picture (startRun's `masked`).
  const hidden = {};
  if (pictures.length) {
    for (const f of all) {
      if (!NOTE_EXT.has(extOf(f))) continue;
      let text = '';
      try { text = readText(path.join(ROOT, f)) || ''; } catch { continue; }
      if (!/^\s*(```|~~~)\s*ink\b/im.test(text)) continue;
      for (const [p, rects] of hiddenIn(text, f, all)) if (pictures.includes(p)) (hidden[p] ||= []).push(...rects);
    }
  }
  return { scope, focus: focus || null, included, excluded, pictures, hidden, instructions: agentInstructions() ? INSTRUCTIONS : null };
}

// The folder's own instructions for agents: AGENTS.md at its top (the file
// coding agents read), sent with every task whatever its scope — unless it is
// kept private like any note.
const INSTRUCTIONS = 'AGENTS.md';
function agentInstructions() {
  const abs = path.join(ROOT, INSTRUCTIONS);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > 32 * 1024 || loadIgnore(ROOT)(INSTRUCTIONS) || isPrivateNote(abs)) return null;
  return readText(abs)?.trim() || null;
}

// The ```flow notation, for tasks that mention it or notes that have one
// (lib/flow-notation.md).
let flowNotation = null;
const FLOW_TASK = /\bflow(chart)?s?\b|\uD750\uB984\uB3C4|\uD50C\uB85C\uC6B0|\uC21C\uC11C\uB3C4|\uD504\uB85C\uC138\uC2A4 ?(\uADF8\uB9BC|\uB3C4\uC2DD|\uB2E4\uC774\uC5B4\uADF8\uB7A8)/i;
const flowGuide = (text, note) => (FLOW_TASK.test(text) || /^\s*```flow\s*$/m.test(note)
  ? (flowNotation ??= fs.readFileSync(path.join(APP_DIR, 'lib', 'flow-notation.md'), 'utf8').replace(/\r\n/g, '\n').trim())
  : '');

// Tasks about pictures (in English or Korean): the ```ink notation
// (lib/ink-notation.md), and the pictures the shared notes show are copied
// in with them, their sizes in the prompt.
const PICTURE_TASK = /\b(ink|pictures?|screenshots?|screen ?shots?|images?|photos?|annotat\w*|mark up|draw on|sketch(es)?)\b|\uC2A4\uCF00\uCE58|\uADF8\uB9BC|\uC2A4\uD06C\uB9B0\s?\uC0F7|\uC774\uBBF8\uC9C0|\uC0AC\uC9C4/i;
const MAX_PICTURES = 40;
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
let inkNotation = null;
const inkGuide = (text, note) => (PICTURE_TASK.test(text) || /^\s*```ink\s*$/m.test(note)
  ? (inkNotation ??= fs.readFileSync(path.join(APP_DIR, 'lib', 'ink-notation.md'), 'utf8').replace(/\r\n/g, '\n').trim())
  : '');
const picturesLine = (pictures = []) => {
  if (!pictures.length) return '';
  const sized = pictures.map((p) => {
    let size = null;
    try { size = pictureSize(fs.readFileSync(path.join(ROOT, p))); } catch { /* gone */ }
    return size ? `${p} (${size[0]}×${size[1]})` : p;
  });
  return `The pictures these notes show are in this directory too, so you can look at them (width×height in pixels): ${sized.join(', ')}.`;
};
const noteText = (rel) => { try { return rel ? readText(path.join(ROOT, rel)) || '' : ''; } catch { return ''; } };

// Margin notes: how to comment (and suggest) instead of editing, for tasks
// that ask for it (the red pen recipes).
const COMMENTS_FILE = '.agent-notes/comments.json';
const COMMENTS_GUIDE = `To write in the margin instead of in the text, put a JSON array in ${COMMENTS_FILE} (make the folder):
[{"file": "<path of the note>", "quote": "<exact text from the note: a few words, at most a sentence>", "comment": "<short reason or remark>", "suggest": "<text to replace the quote with; leave it out for a remark only>"}]
Quote the note exactly as it is, and as little as is needed to find the place. Write comments in the language of the note. Each comment is shown in the margin next to the quote; the user accepts or rejects each suggestion.`;
const commentsGuide = (text) => (text.includes(COMMENTS_FILE) || /\b(red pen|margin (notes|comments))\b/i.test(text) ? COMMENTS_GUIDE : '');

// The lens (experimental, public/lens.js): what the agent sees in a note —
// claims with no support, places that disagree, what is decided or still
// open — written beside it, never in it. Each finding quotes its places;
// the review draws them on the note, joined, and a fix comes back as a red
// pen proposal (a follow-up).
const LENS_FILE = '.agent-notes/lens.json';
const LENS_KINDS = new Set(['gap', 'conflict', 'open', 'decided', 'link']);
const LENS_GUIDE = `To show the user what you see in a note without changing it, put a JSON object in ${LENS_FILE} (make the folder):
{"findings": [{"file": "<path of the note>", "kind": "gap | conflict | open | decided | link", "quotes": ["<exact text from the note>", "..."], "note": "<what you see, in a sentence or two>"}]}
gap: a claim the note gives no support for; conflict: places that disagree (quote each of them); open: a question or a decision still open; decided: a decision made; link: places that belong together. The quotes of a finding are drawn joined by a line, so quote every place it is about (one to four), each exactly as it is in the note and as little as finds the place. Write the notes in the language of the note. At most 40 findings, the ones that matter most.`;
const lensGuide = (text) => (text.includes(LENS_FILE) ? LENS_GUIDE : '');

// Forks (experimental, public/forks.js): a paragraph written other ways,
// side by side with it. Nothing changes until one is taken in the review —
// then it is a change of the proposal, accepted and applied as any other.
const FORKS_FILE = '.agent-notes/forks.json';
const FORKS_GUIDE = `To offer a paragraph written other ways without changing the note, put a JSON object in ${FORKS_FILE} (make the folder):
{"forks": [{"file": "<path of the note>", "quote": "<the paragraph, exactly as it is in the note>", "options": [{"text": "<the paragraph written another way, in the note's Markdown>", "why": "<a few words on how it differs>"}]}]}
Two or three options for each paragraph, each one that could stand in its place as it is, different from the others in approach (shorter, more concrete, another order or tone…), in the language of the note.`;
const forksGuide = (text) => (text.includes(FORKS_FILE) ? FORKS_GUIDE : '');

// Margin's own commands, keys and macros, as notes at the top of the folder
// (public/leaderkeys.js, recipes.js, macrotext.js): the "commands" scope
// shares these alone, with their notation (lib/margin-config.md) and the
// names a key or a macro can run. The app asks for it ("Make or change a
// command…"); what comes back is reviewed as any run.
const COMMAND_NOTES = ['LEADER.md', 'RECIPES.md', 'MACROS.md'];
// Other tasks get the notation, and see these notes, only when they are
// plainly about them: by name, a (keyboard) macro, leader keys — in Korean
// too — or the note in view is one. Not "recipe" or "shortcut" alone: a note
// of cooking recipes isn't Margin's.
const COMMANDS_TASK = /(LEADER|RECIPES|MACROS)\.md|\b(a|an|the|my|this|that|new|keyboard) macros?\b|\bleader keys?\b|\uB9E4\uD06C\uB85C|\uB9AC\uB354 ?\uD0A4/i;
let marginConfig = null;
const commandsNotation = () => (marginConfig ??= fs.readFileSync(path.join(APP_DIR, 'lib', 'margin-config.md'), 'utf8').replace(/\r\n/g, '\n').trim());
const commandsGuide = ({ commands = [], keymap = [] }) => [
  commandsNotation(),
  keymap.length ? `\nThe keys after the leader now, written as LEADER.md would (Margin's own and the user's):\n${keymap.join('\n')}` : '',
  commands.length ? `\nThe other commands, on no key after the leader, by name (for LEADER.md and \`run\`, as the ones in the key map):\n${commands.map((c) => `- ${c}`).join('\n')}` : '',
].join('\n');
const cleanList = (list, max, len) => (Array.isArray(list) ? list : [])
  .filter((c) => typeof c === 'string').map((c) => c.replace(/\s+/g, ' ').trim().slice(0, len)).filter(Boolean).slice(0, max);

function buildPrompt(task, focus, followUp = '', pictures = [], commands = null) {
  if (commands) {
    return [
      'You are changing how Margin, the notes app the user is in, works for them, by editing its notes of commands.',
      `The current directory is a staged copy of those notes, ${COMMAND_NOTES.join(', ')} (the ones there are yet; make one if needed). Write only these three.`,
      'A human will review your changes as a diff before anything is applied; Margin checks that it can read every line, and shows what changes on the keys.',
      'Work without asking questions: nobody can answer them. If the task is unclear, make the most reasonable change. End with a line or two on what you did, in the user\'s language.',
      '',
      commandsGuide(commands),
      '',
      `Task: ${task}`,
    ].join('\n');
  }
  const note = noteText(focus);
  const flow = flowGuide(`${task}\n${followUp}`, note);
  const ink = inkGuide(`${task}\n${followUp}`, note);
  const margin = commentsGuide(`${task}\n${followUp}`);
  const lens = lensGuide(`${task}\n${followUp}`);
  const forks = forksGuide(`${task}\n${followUp}`);
  const config = COMMANDS_TASK.test(`${task}\n${followUp}`) || COMMAND_NOTES.includes(focus) ? commandsNotation() : '';
  const own = agentInstructions();
  return [
    'You are helping with a folder of plain Markdown notes.',
    'The current directory is a staged copy of the notes you are allowed to see.',
    'Complete the task by editing, creating or deleting files in this directory only.',
    'Keep edits focused; a human will review your changes as a diff before anything is applied.',
    'Work without asking questions: nobody can answer them. If the task is unclear, make the most reasonable edit.',
    'Diagrams render from ```mermaid code blocks.',
    flow ? `\n${flow}\n` : '',
    ink ? `\n${ink}\n` : '',
    pictures.length ? picturesLine(pictures) : '',
    margin ? `\n${margin}\n` : '',
    lens ? `\n${lens}\n` : '',
    forks ? `\n${forks}\n` : '',
    config ? `\n${config}\n` : '',
    own ? `\nInstructions for this notes folder (from ${INSTRUCTIONS}):\n${own}\n` : '',
    focus ? `The note the user is looking at: ${focus}` : '',
    '',
    `Task: ${task}`,
  ].join('\n');
}

function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

// A picture with hidden parts is shared only as the copy the app covered
// them in (`masked`: path → base64, the same kind and size of picture);
// without one it is withheld.
function coverPictures(pictures, hidden, masked, excluded) {
  const covered = new Map();
  for (const p of [...pictures]) {
    if (!hidden[p]) continue;
    const buf = typeof masked?.[p] === 'string' ? Buffer.from(masked[p], 'base64') : null;
    let size = null;
    try { size = pictureSize(fs.readFileSync(path.join(ROOT, p))); } catch { /* gone */ }
    const got = buf && buf.length <= MAX_PICTURE_BYTES * 2 ? pictureSize(buf) : null;
    const svg = buf && /<svg\b/i.test(buf.toString('utf8', 0, 4096));
    if (got && size && got[0] === size[0] && got[1] === size[1] && svg === (extOf(p) === '.svg')) {
      covered.set(p, buf);
      continue;
    }
    pictures.splice(pictures.indexOf(p), 1);
    excluded.push({ path: p, reason: 'parts hidden, could not cover them' });
  }
  return covered;
}

function startRun({ task, scope, focus, selection, agentId, model, recipe, masked, commands, keymap }) {
  if (!AGENT) throw httpError(400, 'No agent configured. Restart with --agent demo or --agent "<command>".');
  const agent = agentById(agentId);
  const command = agentCommand(agent, typeof model === 'string' ? model : '');
  task = String(task || '').trim();
  if (!task) throw httpError(400, 'Describe the task for the agent');
  const { included, excluded, pictures, hidden } = resolveScope(scope, focus, task);
  if (!included.length && scope !== 'commands') throw httpError(400, 'Nothing to share: every note in scope is excluded by privacy rules');
  if (included.length > 5000) throw httpError(400, 'Scope is too large (over 5000 notes); pick a folder');
  const covered = coverPictures(pictures, hidden, masked, excluded);

  ensureDataDir();
  const id = newRunId();
  const dir = runDir(id);
  for (const f of [...included, ...pictures]) {
    for (const sub of ['base', 'work']) {
      const dst = path.join(dir, sub, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (covered.has(f)) fs.writeFileSync(dst, covered.get(f));
      else fs.copyFileSync(path.join(ROOT, f), dst);
    }
  }
  for (const sub of ['base', 'work']) fs.mkdirSync(path.join(dir, sub), { recursive: true }); // (commands: maybe none yet)
  const focusShared = focus && included.includes(focus) ? focus : null;
  // A selection is only context from the focused note; never send it if that
  // note is withheld by privacy rules.
  const sel = focusShared && typeof selection === 'string' ? selection.slice(0, 20000) : '';
  const meta = {
    id, task, scope, focus: focusShared, parent: null, round: 1,
    recipe: typeof recipe === 'string' ? recipe.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    agent: agent.label, agentId: agent.id, command, model: (command === agent.command ? agent.model : model) || '',
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    exitCode: null, files: included, pictures, excluded, applied: null, selection: sel ? sel.length : 0,
    ...(scope === 'commands' ? { commands: { commands: cleanList(commands, 2000, 120), keymap: cleanList(keymap, 800, 200) } } : {}),
  };
  let prompt = buildPrompt(task, focusShared, '', pictures, meta.commands);
  if (covered.size) prompt += `\n\nParts of ${[...covered.keys()].join(', ')} are covered in gray: the user hid them. Leave their \`hide\` lines as they are, and don't guess what is under them.`;
  const mine = focusShared ? commentsForAgent(focusShared) : '';
  if (mine) prompt += `\n\n${mine}`;
  if (sel) prompt += `\n\nThe user selected this passage in ${focusShared}; focus the task on it:\n<<<\n${sel}\n>>>`;
  const beside = scope === 'commands' ? '' : besideForAgent(included, focusShared);
  if (beside) prompt += `\n\n${beside}`;
  return launchAgent(meta, prompt);
}

// A follow-up continues from the previous round's proposal (same base
// snapshot), so the final review is always "original notes → final proposal".
function followUpRun(prevId, { task }) {
  if (!AGENT) throw httpError(400, 'No agent configured');
  task = String(task || '').trim();
  if (!task) throw httpError(400, 'Describe what the agent should change');
  const prev = readMeta(prevId);
  if (!['review', 'failed', 'cancelled'].includes(prev.status)) throw httpError(409, `Run is ${prev.status}; cannot follow up`);
  const agent = agentById(prev.agentId);
  // Keep the model chosen for the first round (falls back to the profile's).
  let command = agent.command;
  try { command = agentCommand(agent, prev.model); } catch { /* model no longer offered */ }
  const id = newRunId();
  const dir = runDir(id);
  fs.cpSync(path.join(runDir(prevId), 'base'), path.join(dir, 'base'), { recursive: true });
  fs.cpSync(path.join(runDir(prevId), 'work'), path.join(dir, 'work'), { recursive: true });
  // The margin comments go on with the proposal they belong to.
  if (fs.existsSync(path.join(runDir(prevId), 'comments.json'))) fs.copyFileSync(path.join(runDir(prevId), 'comments.json'), path.join(dir, 'comments.json'));
  // And what the lens showed, until a round looks again.
  if (fs.existsSync(path.join(runDir(prevId), 'lens.json'))) fs.copyFileSync(path.join(runDir(prevId), 'lens.json'), path.join(dir, 'lens.json'));
  if (fs.existsSync(path.join(runDir(prevId), 'forks.json'))) fs.copyFileSync(path.join(runDir(prevId), 'forks.json'), path.join(dir, 'forks.json'));
  const round = (prev.round || 1) + 1;
  const meta = {
    ...prev, kind: undefined, id, task, parent: prevId, round, originalTask: prev.originalTask || prev.task,
    agent: agent.label, agentId: agent.id, command, model: command === agent.command ? agent.model : prev.model,
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    exitCode: null, signal: null, usage: undefined, resolvedModel: undefined, cancelReason: undefined, applied: null, child: undefined,
  };
  const prompt = [
    buildPrompt(meta.originalTask, meta.focus, task, meta.pictures, meta.commands),
    '',
    `This is round ${round}. Your earlier edits are already in this directory and are still pending human review.`,
    `The reviewer's follow-up: ${task}`,
  ].join('\n') + (meta.commands ? '' : (() => { const b = besideForAgent(meta.files || [], meta.focus); return b ? `\n\n${b}` : ''; })());
  const started = launchAgent(meta, prompt);
  prev.status = 'superseded';
  prev.child = id;
  writeMeta(prev);
  return started;
}

function launchAgent(meta, prompt) {
  const { id } = meta;
  const dir = runDir(id);
  const workDir = path.join(dir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  writeMeta(meta);
  fs.writeFileSync(path.join(dir, `prompt-${meta.round || 1}.txt`), prompt);

  const logPath = path.join(dir, 'agent.log');
  const logFd = fs.openSync(logPath, 'a');
  const env = {
    ...process.env,
    AGENT_NOTES_TASK: meta.task,
    AGENT_NOTES_PROMPT: prompt,
    AGENT_NOTES_SCOPE: meta.scope,
    AGENT_NOTES_FOCUS: meta.focus || '',
    AGENT_NOTES_ROUND: String(meta.round || 1),
  };
  // Inside the desktop app this process is Electron-as-Node; only the built-in
  // demo agent (which reuses our executable) should inherit that mode.
  const agent = agentById(meta.agentId);
  if (!agent.builtin) delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(meta.command || agent.command, {
    cwd: workDir,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', logFd, logFd],
    windowsHide: true,
    env,
  });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  running.set(id, child);

  const timer = setTimeout(() => cancelRun(id, 'timed out'), RUN_TIMEOUT_MS);
  child.on('error', (err) => fs.appendFileSync(logPath, `\n[agent-notes] could not start agent: ${err.message}\n`));
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    try { fs.closeSync(logFd); } catch { /* already closed */ }
    running.delete(id);
    const m = readMeta(id);
    m.exitCode = code;
    m.signal = signal;
    m.finishedAt = new Date().toISOString();
    if (m.status === 'running') m.status = code === 0 ? 'review' : 'failed';
    try { collectLens(m); } catch (e) { fs.appendFileSync(logPath, `\n[agent-notes] lens: ${e.message}\n`); }
    try { collectForks(m); } catch (e) { fs.appendFileSync(logPath, `\n[agent-notes] forks: ${e.message}\n`); }
    try { collectComments(m); } catch (e) { fs.appendFileSync(logPath, `\n[agent-notes] margin comments: ${e.message}\n`); }
    const out = parseAgentLog(readLog(id, LOG_PARSE_LIMIT), workDir);
    if (out.usage) m.usage = out.usage;
    if (out.model) m.resolvedModel = out.model;
    writeMeta(m);
  });
  return meta;
}

// The agent's margin comments (COMMENTS_FILE in its copy): kept with the run,
// never in a note. A suggestion is made in the staged copy, so it is reviewed
// and applied as any change is; the comment stays beside it.
const MAX_COMMENTS = 200;
function collectComments(meta) {
  const dir = runDir(meta.id);
  const file = path.join(dir, 'work', COMMENTS_FILE);
  if (!fs.existsSync(file)) return;
  let list;
  try {
    if (fs.statSync(file).size > 512 * 1024) throw new Error('comments.json is too large');
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
  if (list && !Array.isArray(list)) list = list.comments;
  if (!Array.isArray(list)) throw new Error('comments.json should hold an array');
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const kept = readComments(meta.id).filter((c) => c.round !== meta.round);
  const texts = new Map();
  for (const raw of list.slice(0, MAX_COMMENTS)) {
    const c = { file: str(raw?.file, 500)?.replace(/^\.\//, ''), quote: str(raw?.quote, 2000), comment: str(raw?.comment, 1000) || '', suggest: str(raw?.suggest, 5000), round: meta.round || 1 };
    if (!c.file || !meta.files.includes(c.file) || !c.quote?.trim()) continue;
    if (c.suggest != null && c.suggest !== c.quote) {
      const abs = path.join(dir, 'work', c.file);
      if (!texts.has(c.file)) texts.set(c.file, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
      const text = texts.get(c.file);
      const at = text == null ? -1 : text.indexOf(c.quote);
      if (at >= 0) { texts.set(c.file, text.slice(0, at) + c.suggest + text.slice(at + c.quote.length)); c.made = true; }
    }
    if (c.suggest == null && !c.comment.trim()) continue;
    kept.push(c);
  }
  for (const [f, text] of texts) if (text != null) fs.writeFileSync(path.join(dir, 'work', f), text);
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify(kept, null, 2));
}
// The notes the agent only commented on: their text as it was shared, to
// show the remarks on.
function commentBases(id, comments, changes) {
  const out = {};
  for (const c of comments) {
    if (c.file in out || changes.some((x) => x.path === c.file)) continue;
    try {
      const abs = path.join(runDir(id), 'base', c.file);
      if (fs.statSync(abs).size < 512 * 1024) out[c.file] = fs.readFileSync(abs, 'utf8');
    } catch { /* not shared */ }
  }
  return out;
}
// The lens's findings (LENS_FILE in the agent's copy): kept with the run,
// each on quotes found in the note as it was shared.
const MAX_LENS = 40;
function collectLens(meta) {
  const dir = runDir(meta.id);
  const file = path.join(dir, 'work', LENS_FILE);
  if (!fs.existsSync(file)) return;
  let raw;
  try {
    if (fs.statSync(file).size > 256 * 1024) throw new Error('lens.json is too large');
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } finally {
    fs.rmSync(file, { force: true });
    try { fs.rmdirSync(path.dirname(file)); } catch { /* comments.json is there too */ }
  }
  const list = Array.isArray(raw) ? raw : raw?.findings;
  if (!Array.isArray(list)) throw new Error('lens.json should hold {"findings": [...]}');
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const bases = new Map();
  const baseOf = (f) => {
    if (!bases.has(f)) {
      try { bases.set(f, fs.statSync(path.join(dir, 'base', f)).size < 512 * 1024 ? fs.readFileSync(path.join(dir, 'base', f), 'utf8') : null); } catch { bases.set(f, null); }
    }
    return bases.get(f);
  };
  const findings = [];
  for (const x of list.slice(0, 200)) {
    const file = (str(x?.file, 500) || meta.focus || '').replace(/^\.\//, '');
    const base = file && meta.files.includes(file) ? baseOf(file) : null;
    if (base == null) continue;
    const quotes = [...new Set((Array.isArray(x?.quotes) ? x.quotes : [x?.quote]).map((q) => str(q, 500)))]
      .filter((q) => q?.trim() && base.includes(q)).slice(0, 4);
    const note = (str(x?.note ?? x?.comment, 1000) || '').trim();
    if (!quotes.length || !note) continue;
    findings.push({ file, kind: LENS_KINDS.has(x?.kind) ? x.kind : 'link', quotes, note });
    if (findings.length >= MAX_LENS) break;
  }
  fs.writeFileSync(path.join(dir, 'lens.json'), JSON.stringify({ round: meta.round || 1, findings }, null, 2));
}
function readLens(id) {
  try { const l = JSON.parse(fs.readFileSync(path.join(runDir(id), 'lens.json'), 'utf8')); return Array.isArray(l?.findings) ? l.findings : []; } catch { return []; }
}
// The forks (FORKS_FILE in the agent's copy): kept with the run, each on a
// paragraph found in the note as it was shared; none taken yet.
const MAX_FORKS = 5;
function collectForks(meta) {
  const dir = runDir(meta.id);
  const file = path.join(dir, 'work', FORKS_FILE);
  if (!fs.existsSync(file)) return;
  let raw;
  try {
    if (fs.statSync(file).size > 256 * 1024) throw new Error('forks.json is too large');
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } finally {
    fs.rmSync(file, { force: true });
    try { fs.rmdirSync(path.dirname(file)); } catch { /* more is there */ }
  }
  const list = Array.isArray(raw) ? raw : raw?.forks;
  if (!Array.isArray(list)) throw new Error('forks.json should hold {"forks": [...]}');
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const forks = [];
  for (const x of list.slice(0, 20)) {
    const file = (str(x?.file, 500) || meta.focus || '').replace(/^\.\//, '');
    let base = null;
    try { if (file && meta.files.includes(file)) base = fs.readFileSync(path.join(dir, 'base', file), 'utf8'); } catch { /* not shared */ }
    const quote = str(x?.quote, 5000)?.replace(/^\n+|\n+$/g, '');
    if (base == null || !quote?.trim() || !base.includes(quote)) continue;
    const options = (Array.isArray(x?.options) ? x.options : []).slice(0, 3)
      .map((o) => ({ text: (str(typeof o === 'string' ? o : o?.text, 5000) || '').replace(/^\n+|\n+$/g, ''), why: (str(o?.why, 300) || '').trim() }))
      .filter((o) => o.text.trim() && o.text !== quote);
    if (!options.length) continue;
    forks.push({ file, quote, options, pick: null });
    if (forks.length >= MAX_FORKS) break;
  }
  writeForks(meta.id, forks);
}
const readForks = (id) => { try { const f = JSON.parse(fs.readFileSync(path.join(runDir(id), 'forks.json'), 'utf8')); return Array.isArray(f?.forks) ? f.forks : []; } catch { return []; } };
const writeForks = (id, forks) => fs.writeFileSync(path.join(runDir(id), 'forks.json'), JSON.stringify({ forks }, null, 2));
// Taking an option (or the paragraph as it was: pick null) puts it in the
// agent's copy, where the paragraph stands now; the review shows it as a
// change.
function takeFork(id, { n, pick }) {
  const meta = readMeta(id);
  if (meta.status !== 'review' || meta.kind === 'proof') throw httpError(409, 'This review is closed');
  const forks = readForks(id);
  const f = forks[n];
  if (!f) throw httpError(404, 'No such fork');
  if (pick != null && !(Number.isInteger(pick) && f.options[pick])) throw httpError(400, 'No such option');
  const textOf = (k) => (k == null ? f.quote : f.options[k].text);
  const abs = path.join(runDir(id), 'work', f.file);
  const work = fs.readFileSync(abs, 'utf8');
  const now = textOf(f.pick);
  const at = work.indexOf(now);
  if (at < 0) throw httpError(409, 'The paragraph changed in the proposal: it can’t be swapped any more');
  fs.writeFileSync(abs, work.slice(0, at) + textOf(pick) + work.slice(at + now.length));
  f.pick = pick ?? null;
  writeForks(id, forks);
  return { forks };
}

// The film (experimental, public/film.js): a note through the rounds of a
// run — as it was, each round's proposal with what you asked for it and
// what the agent noted, and what was applied — each with its changes from
// the one before.
function filmOf(id, { path: relPath }) {
  const rel = relOf(workspacePath(relPath));
  const chain = [];
  for (let at = id; at && chain.length < 50;) {
    let meta;
    try { meta = readMeta(at); } catch { break; } // a round before, removed
    chain.unshift(meta);
    at = meta.parent;
  }
  const read = (runId, sub) => { try { return fs.readFileSync(path.join(runDir(runId), sub, rel), 'utf8'); } catch { return null; } };
  const base = read(chain[0].id, 'base');
  if (base == null) throw httpError(404, 'This note wasn’t shared with the run');
  const frames = [{ kind: 'original', text: base, task: chain[0].originalTask || chain[0].task }];
  for (const r of chain) {
    const notes = readComments(r.id).filter((c) => c.file === rel && (c.round || 1) === (r.round || 1)).map((c) => c.comment || (c.suggest != null ? `→ ${c.suggest}` : '')).filter(Boolean);
    frames.push({ kind: 'round', round: r.round || 1, run: r.id, text: read(r.id, 'work') ?? '', task: r.task, notes: notes.slice(0, 30) });
  }
  const last = chain.at(-1);
  const done = last.applied?.files?.find((f) => f.path === rel);
  if (done?.hunks) {
    const hunks = buildHunks(base, frames.at(-1).text);
    frames.push({ kind: 'applied', text: applyHunks(base, hunks, new Set(done.hunks)), of: [done.hunks.length, done.of], undone: last.status === 'reverted' });
  }
  for (let k = 1; k < frames.length; k++) frames[k].hunks = buildHunks(frames[k - 1].text, frames[k].text);
  return { path: rel, frames };
}

// The notes the lens (and the forks) are on, as they were shared.
function lensBases(id, lens) {
  const out = {};
  for (const f of new Set(lens.map((x) => x.file))) {
    try { out[f] = fs.readFileSync(path.join(runDir(id), 'base', f), 'utf8'); } catch { /* not shared */ }
  }
  return out;
}
function readComments(id) {
  try { return JSON.parse(fs.readFileSync(path.join(runDir(id), 'comments.json'), 'utf8')); } catch { return []; }
}

function cancelRun(id, reason = 'cancelled') {
  const child = running.get(id);
  const meta = readMeta(id);
  if (!child || meta.status !== 'running') throw httpError(409, 'Run is not running');
  meta.status = 'cancelled';
  meta.cancelReason = reason;
  writeMeta(meta);
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    // shell:true on Windows means cmd.exe → agent; kill the whole tree.
    else spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
  } catch { child.kill(); }
  return meta;
}

const LOG_PARSE_LIMIT = 4 * 1024 * 1024;
function readLog(id, limit = 64 * 1024) {
  try {
    const buf = fs.readFileSync(path.join(runDir(id), 'agent.log'));
    return buf.length > limit ? `…\n${buf.subarray(-limit).toString('utf8')}` : buf.toString('utf8');
  } catch { return ''; }
}

// Everything the review screen shows about what the agent did and said.
function runReport(id) {
  const out = parseAgentLog(readLog(id, LOG_PARSE_LIMIT), path.join(runDir(id), 'work'));
  return {
    log: readLog(id), logFormat: out.format, activity: out.format === 'text' ? [] : out.activity,
    reply: out.reply, error: out.error, usage: out.usage, liveModel: out.model,
  };
}

// Compare the agent's staged copy against the snapshot it started from, and
// flag files that changed in the real workspace meanwhile ("stale").
function computeChanges(id) {
  const dir = runDir(id);
  let mine = false;
  try { mine = readMeta(id).kind === 'proof'; } catch { /* no meta */ }
  const baseDir = path.join(dir, 'base');
  const workDir = path.join(dir, 'work');
  const paths = new Set([...walk(baseDir), ...walk(workDir)]);
  const changes = [];
  for (const rel of [...paths].sort()) {
    const b = fs.existsSync(path.join(baseDir, rel)) ? fs.readFileSync(path.join(baseDir, rel)) : null;
    const w = fs.existsSync(path.join(workDir, rel)) ? fs.readFileSync(path.join(workDir, rel)) : null;
    if (b && w && b.equals(w)) continue;
    const status = !b ? 'added' : !w ? 'deleted' : 'modified';
    const binary = (b && b.includes(0)) || (w && w.includes(0));

    let reserved = false;
    let current = null;
    try { current = fs.readFileSync(workspacePath(rel)); } catch (e) { if (e.status) reserved = true; }
    const stale = status === 'added' ? !!current : !current || hashOf(current) !== hashOf(b);

    const change = { path: rel, status, binary: !!binary, stale, reserved };
    if (!binary) {
      if (status === 'modified') {
        change.hunks = buildHunks(b.toString('utf8'), w.toString('utf8'));
        if (b.length < 512 * 1024) change.base = b.toString('utf8'); // for the rendered "result" preview
      }
      else change.lines = (w || b).toString('utf8').split('\n').slice(0, 800);
      // Margin's notes of commands: as they would be, for the review to check.
      if (COMMAND_NOTES.includes(rel) && w && w.length < 256 * 1024) change.after = w.toString('utf8');
    }
    // Stale but still mergeable: the user edited other parts of the file.
    if (stale && status === 'modified' && !binary && current && !current.includes(0)) {
      change.conflicts = mergeHunks(b.toString('utf8'), current.toString('utf8'), change.hunks).conflicts;
      change.mergeable = change.conflicts.length < change.hunks.length;
    }
    // An agent's changes to a paragraph you locked can't be applied.
    const locks = !mine && change.hunks ? noteLocks(rel) : [];
    if (locks.length) {
      const locked = lockedHunks(change.hunks, lockRanges(b.toString('utf8'), locks));
      if (locked.length) {
        change.locked = locked;
        change.conflicts = [...new Set([...(change.conflicts || []), ...locked])].sort((x, y) => x - y);
        change.problems = Object.fromEntries(locked.map((i) => [i, 'in a paragraph you locked']));
      }
    }
    // How far it reaches into your words (lib/tiers.js): a label for the review.
    if (!mine && !change.reserved) change.tiers = tiersOf(change, { agent: agentWrote(rel) });
    changes.push(change);
  }
  return changes;
}

// The lines agents wrote in a note, as Origin knows them (applied runs):
// kept until a run is applied or reverted.
const agentWroteCache = new Map();
function agentWrote(rel) {
  if (!agentWroteCache.has(rel)) {
    let lines = new Set();
    try { lines = agentLines(originOf(rel).runs); } catch { /* not a note of the workspace */ }
    if (agentWroteCache.size > 500) agentWroteCache.clear();
    agentWroteCache.set(rel, lines);
  }
  return agentWroteCache.get(rel);
}

function applyRun(id, decisions) {
  const meta = readMeta(id);
  if (!['review', 'failed', 'cancelled'].includes(meta.status)) throw httpError(409, `Run is ${meta.status}; nothing to apply`);
  if (!decisions || typeof decisions !== 'object') throw httpError(400, 'decisions required');
  const dir = runDir(id);
  const applied = [];
  const skipped = [];
  for (const c of computeChanges(id)) {
    const d = decisions[c.path];
    if (!d) continue;
    if (c.reserved || (c.stale && !c.mergeable)) {
      skipped.push({ path: c.path, reason: c.reserved ? 'reserved path' : 'changed in your workspace since the agent started' });
      continue;
    }
    const target = workspacePath(c.path);
    if (c.status === 'modified' && !c.binary) {
      const sel = new Set((d.hunks || []).filter((n) => Number.isInteger(n) && n >= 0 && n < c.hunks.length));
      // Never a change to a paragraph you locked, whatever was asked.
      for (const n of c.locked || []) sel.delete(n);
      if (!sel.size) { if (d.hunks?.length) skipped.push({ path: c.path, reason: 'only changes to paragraphs you locked' }); continue; }
      const base = fs.readFileSync(path.join(dir, 'base', c.path), 'utf8');
      const before = fs.readFileSync(target);
      let out = applyHunks(base, c.hunks, sel);
      let merged = false;
      if (c.stale) {
        const conflicts = new Set(c.conflicts);
        const m = mergeHunks(base, before.toString('utf8'), c.hunks, sel);
        for (const n of [...sel]) if (conflicts.has(n)) sel.delete(n);
        if (!m.applied) { skipped.push({ path: c.path, reason: 'selected changes conflict with your edits' }); continue; }
        out = m.text;
        merged = true;
      }
      // Keep exactly what was on disk so "Undo apply" restores it byte for byte.
      writeFileAtomic(path.join(dir, 'backup', c.path), before);
      keepVersion(c.path, before.toString('utf8'), 'agent');
      writeFileAtomic(target, out);
      applied.push({ path: c.path, status: c.status, hunks: [...sel].sort((x, y) => x - y), of: c.hunks.length, merged, hash: hashOf(Buffer.from(out, 'utf8')) });
    } else if (d.file && (c.status === 'added' || c.status === 'modified')) {
      const data = fs.readFileSync(path.join(dir, 'work', c.path));
      if (fs.existsSync(target)) keepVersion(c.path, fs.readFileSync(target, 'utf8'), 'agent');
      writeFileAtomic(target, data);
      applied.push({ path: c.path, status: c.status, hash: hashOf(data) });
    } else if (d.file && c.status === 'deleted') {
      if (noteLocks(c.path).length) { skipped.push({ path: c.path, reason: 'it has paragraphs you locked' }); continue; }
      // Never hard-delete: move into the run's trash so it can be restored.
      const trash = path.join(DATA_DIR, 'trash', id, c.path);
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      ours(c.path);
      fs.renameSync(target, trash);
      applied.push({ path: c.path, status: c.status, trash: relOf(trash) });
    }
  }
  if (!applied.length) {
    throw httpError(409, skipped.length ? 'Nothing applied: selected files changed since the run started' : 'Nothing selected', { skipped });
  }
  meta.status = 'applied';
  meta.applied = { at: new Date().toISOString(), files: applied, skipped };
  writeMeta(meta);
  agentWroteCache.clear();
  return meta;
}

// Undo an applied run: only if every touched file is still exactly what we
// wrote (otherwise the user edited it since, and we refuse rather than clobber).
function revertRun(id) {
  const meta = readMeta(id);
  if (meta.status !== 'applied') throw httpError(409, 'Only applied runs can be undone');
  const dir = runDir(id);
  const blocked = [];
  for (const f of meta.applied.files) {
    const target = workspacePath(f.path);
    if (f.status === 'deleted') {
      if (fs.existsSync(target)) blocked.push({ path: f.path, reason: 'a file exists there again' });
    } else {
      let cur = null;
      try { cur = hashOf(fs.readFileSync(target)); } catch { /* missing */ }
      if (cur !== f.hash) blocked.push({ path: f.path, reason: 'edited after the run was applied' });
    }
  }
  if (blocked.length) throw httpError(409, 'Cannot undo: some files changed after applying', { blocked });
  const reverted = [];
  for (const f of meta.applied.files) {
    const target = workspacePath(f.path);
    if (f.status === 'modified') {
      const backup = path.join(dir, 'backup', f.path);
      keepVersion(f.path, fs.readFileSync(target, 'utf8'), 'agent');
      writeFileAtomic(target, fs.readFileSync(fs.existsSync(backup) ? backup : path.join(dir, 'base', f.path)));
    }
    else if (f.status === 'added') {
      const trash = path.join(DATA_DIR, 'trash', `${id}-undo`, f.path);
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      ours(f.path);
      fs.renameSync(target, trash);
    } else if (f.status === 'deleted') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      ours(f.path);
      fs.renameSync(path.join(ROOT, f.trash), target);
    }
    reverted.push(f.path);
  }
  meta.status = 'reverted';
  meta.revertedAt = new Date().toISOString();
  writeMeta(meta);
  agentWroteCache.clear();
  return { ...meta, reverted };
}

// Commit exactly the files an agent run changed, authored by the agent.
async function commitAppliedRun(meta) {
  try {
    const info = await gitInfo();
    if (!info.repo) return { error: 'Not a git repository' };
    const paths = meta.applied.files.map((f) => f.path);
    const subject = `Agent: ${meta.task.split('\n')[0].slice(0, 60)}`;
    const body = [
      `Applied from Margin run ${meta.id} (${paths.length} file${paths.length === 1 ? '' : 's'}).`,
      `Agent: ${meta.agent}`,
      `Reviewed and accepted in Margin.`,
    ].join('\n');
    const r = await gitCommit({ message: `${subject}\n\n${body}`, paths, author: `${meta.agent.replace(/[<>]/g, '')} (Margin) <${AGENT_EMAIL}>` });
    const m = readMeta(meta.id);
    m.applied.commit = r.hash;
    writeMeta(m);
    return { hash: r.hash };
  } catch (e) { return { error: e.message }; }
}

function discardRun(id) {
  const meta = readMeta(id);
  if (meta.status === 'running') throw httpError(409, 'Cancel the run first');
  if (meta.status === 'applied') throw httpError(409, 'Run was already applied');
  meta.status = 'discarded';
  meta.discardedAt = new Date().toISOString();
  writeMeta(meta);
  return meta;
}

function listRuns() {
  let ids = [];
  try { ids = fs.readdirSync(RUNS_DIR).filter((n) => /^[\w-]+$/.test(n)); } catch { /* none yet */ }
  return ids.sort().reverse().slice(0, 100).map((id) => {
    try { const m = readMeta(id); return { id, kind: m.kind || 'agent', task: m.task, recipe: m.recipe || '', status: m.status, startedAt: m.startedAt, scope: m.scope, focus: m.focus, agent: m.agent, usage: m.usage || null }; }
    catch { return null; }
  }).filter(Boolean);
}

// Runs left "running" by a previous server process can never finish.
function markInterruptedRuns() {
  for (const r of listRuns()) {
    if (r.status === 'running') {
      const m = readMeta(r.id);
      m.status = 'failed';
      m.cancelReason = 'server stopped while the agent was running';
      writeMeta(m);
    }
  }
}

// ---------------------------------------------------------------- http

async function routeApi(method, url, body) {
  const p = url.pathname;
  const q = (k) => url.searchParams.get(k);
  let m;
  if (method === 'GET' && p === '/api/info') {
    return {
      version: VERSION, root: ROOT, name: path.basename(ROOT),
      agent: AGENT ? { configured: true, label: AGENT.label, id: AGENT.id } : { configured: false },
      agents: AGENTS.map((a) => ({
        id: a.id, label: a.label, builtin: a.builtin, kind: a.kind, model: a.model,
        models: AGENT_KINDS[a.kind]?.models.map(([id, label]) => ({ id, label })) || [],
      })),
      hasIgnoreFile: fs.existsSync(path.join(ROOT, '.agentnotesignore')),
    };
  }
  if (method === 'GET' && p === '/api/tree') return { files: listTree(), dirs: emptyDirs() };
  if (method === 'GET' && p === '/api/file') return getFile(q('path'));
  if (method === 'GET' && p === '/api/stat') return statFile(q('path'));
  if (method === 'PUT' && p === '/api/file') return saveFile(body || {});
  if (method === 'POST' && p === '/api/file') return createFile(body || {});
  if (method === 'GET' && p === '/api/search') return search(q('q'));
  if (method === 'GET' && p === '/api/tags') return listTags();
  if (method === 'GET' && p === '/api/headings') return listHeadings();
  if (method === 'GET' && p === '/api/history') return listVersions(q('path'));
  if (method === 'GET' && p === '/api/history/version') return getVersion(q('path'), q('id'));
  if (method === 'GET' && p === '/api/outside') return listOutside();
  if (method === 'GET' && p === '/api/tasks') return listTasks();
  if (method === 'GET' && p === '/api/recall') return recallLines(url.searchParams.get('sig') || '');
  if (method === 'POST' && p === '/api/recall/known') return addKnown(body || {});
  if (method === 'POST' && p === '/api/recall/judge') return recallJudge(body || {});
  if (method === 'POST' && p === '/api/recall/think') return recallThink(body || {});
  if (method === 'POST' && p === '/api/recall/develop') return recallDevelop(body || {});
  if (method === 'POST' && p === '/api/lab/brief') return labBrief(body || {});
  if (method === 'GET' && p === '/api/embed') return embedStatus();
  if (method === 'POST' && p === '/api/embed') return embedOn(body || {});
  if (method === 'POST' && p === '/api/embed/download') { embed.download(); return embedStatus(); }
  if (method === 'POST' && p === '/api/embed/remove') { embed.remove(); return embedStatus(); }
  if (method === 'POST' && p === '/api/embed/near') return embedNear(body || {});
  if (method === 'POST' && p === '/api/tasks/toggle') return toggleTask(body || {});
  if (method === 'GET' && p === '/api/outside/diff') return outsideDiff(q('path'));
  if (method === 'POST' && p === '/api/outside/seen') return outsideSeen(body || {});
  if (method === 'POST' && p === '/api/asset') return saveAsset(body || {});
  if (method === 'POST' && p === '/api/rename') return renamePath(body || {});
  if (method === 'POST' && p === '/api/delete') return deletePath(body || {});
  if (method === 'POST' && p === '/api/restore') return restorePath(body || {});
  if (method === 'POST' && p === '/api/folder') return createFolder(body || {});
  if (method === 'POST' && p === '/api/private') return privateOf(body || {});
  if (method === 'GET' && p === '/api/git/status') return gitStatus();
  if (method === 'POST' && p === '/api/git/init') return gitInit();
  if (method === 'GET' && p === '/api/git/diff') return gitDiff(q('path'));
  if (method === 'GET' && p === '/api/git/log') return gitLog(q('path'), q('limit'));
  if (method === 'GET' && p === '/api/git/show') return gitShow(q('rev'), q('path'));
  if (method === 'POST' && p === '/api/git/commit') return gitCommit({ message: (body || {}).message, paths: (body || {}).paths });
  if (method === 'GET' && p === '/api/scope') return resolveScope(q('scope'), q('focus'), q('task') || '');
  if (method === 'GET' && p === '/api/runs') return { runs: listRuns() };
  if (method === 'GET' && p === '/api/agents/status') {
    const fresh = q('fresh') === '1';
    const list = await Promise.all(AGENTS.map(async (a) => ({ id: a.id, ...(await agentStatus(a, fresh)) })));
    return { agents: list };
  }
  if (method === 'GET' && p === '/api/locks') return { path: relOf(workspacePath(q('path'))), locks: noteLocks(relOf(workspacePath(q('path')))) };
  if (method === 'PUT' && p === '/api/locks') return saveLocks(body || {});
  if (method === 'GET' && p === '/api/drawer') return { path: relOf(workspacePath(q('path'))), scraps: noteDrawer(relOf(workspacePath(q('path')))) };
  if (method === 'PUT' && p === '/api/drawer') return saveDrawer(body || {});
  if (method === 'GET' && p === '/api/desk/margin') { const rel = relOf(workspacePath(q('path'))); return { path: rel, cards: deskMarginCards(rel) }; }
  if (method === 'PUT' && p === '/api/desk/margin') return saveDeskMargin(body || {});
  if (method === 'POST' && p === '/api/desk/trail') return deskTrail(body || {});
  if (method === 'GET' && p === '/api/origin') return originOf(q('path'));
  if (method === 'GET' && p === '/api/comments') return getComments(q('path'));
  if (method === 'PUT' && p === '/api/comments') return saveComments(body || {});
  if (method === 'POST' && p === '/api/proofs') return openProof(body || {});
  if (method === 'POST' && p === '/api/live/options') return { changed: setLiveOpts(body), ...liveOpts };
  if (method === 'POST' && p === '/api/live/start') { setLiveOpts(body); const key = liveFor(String((body || {}).path || '')); return { ...live.start(key), agent: liveAgent().label, ...liveOpts }; }
  if (method === 'POST' && p === '/api/live/warm') { setLiveOpts(body); return { ...liveUp().warm(), agent: liveAgent().label, ...liveOpts }; }
  if (method === 'POST' && p === '/api/live/stop') { live?.stop(); return { ok: true }; }
  if (method === 'GET' && p === '/api/live/status') return liveStatus();
  if (method === 'POST' && p === '/api/live/restart') { if (!setLiveOpts(body)) liveRestart(); return liveStatus(); }
  if (method === 'POST' && p === '/api/live/test') {
    setLiveOpts(body);
    const agent = liveAgent();
    if (!agent) throw httpError(400, 'The live margin needs the Claude Code agent (Settings \u2192 Agents).');
    return { agent: agent.label, ...(await testLine({ bin: liveBin(agent), env: liveEnv(), opts: liveOpts })) };
  }
  if (method === 'POST' && p === '/api/live/project') return liveProject(String((body || {}).path || ''));
  if (method === 'POST' && p === '/api/desk/warm') { setLiveOpts(body); return { ...deskUp().warm(), agent: liveAgent().label, ...liveOpts }; }
  if ((m = p.match(/^\/api\/proofs\/([\w-]+)$/)) && method === 'PUT') return saveProof(m[1], body || {});
  if (method === 'POST' && p === '/api/runs') return { ...startRun(body || {}), command: undefined };
  if ((m = p.match(/^\/api\/runs\/([\w-]+)$/)) && method === 'GET') {
    const meta = readMeta(m[1]);
    const reviewable = meta.status !== 'running';
    const changes = reviewable ? computeChanges(m[1]) : [];
    const comments = meta.kind === 'proof' ? proofComments(meta) : readComments(m[1]);
    const lens = reviewable ? readLens(m[1]) : [];
    const forks = reviewable ? readForks(m[1]) : [];
    return { ...meta, command: undefined, ...runReport(m[1]), changes, comments, commentBases: commentBases(m[1], comments, changes), lens, forks, lensBases: lensBases(m[1], [...lens, ...forks]) };
  }
  if ((m = p.match(/^\/api\/runs\/([\w-]+)\/fork$/)) && method === 'POST') return takeFork(m[1], body || {});
  if ((m = p.match(/^\/api\/runs\/([\w-]+)\/film$/)) && method === 'GET') {
    readMeta(m[1]);
    return filmOf(m[1], { path: q('path') });
  }
  if ((m = p.match(/^\/api\/runs\/([\w-]+)\/(apply|discard|cancel|revert|followup)$/)) && method === 'POST') {
    if (m[2] === 'apply') {
      const meta = applyRun(m[1], (body || {}).decisions);
      if ((body || {}).commit) meta.commit = await commitAppliedRun(meta);
      return meta;
    }
    if (m[2] === 'discard') return discardRun(m[1]);
    if (m[2] === 'revert') return revertRun(m[1]);
    if (m[2] === 'followup') return { ...followUpRun(m[1], body || {}), command: undefined };
    return cancelRun(m[1]);
  }
  throw httpError(404, 'Not found');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// The live margin (experimental, lib/live.js): a meeting note's lines, a
// few at a time, to a fast model through the signed-in claude CLI; its
// minutes come back as they are written (NDJSON), and nothing is saved. Its
// session stays up while the margin is on (warm, from the app's start).
let live = null;
// Their model and effort (Settings → Live margin), as the page last said:
// Haiku, not thinking, unless chosen. The live margin and the desk's share them.
const LIVE_MODELS = ['haiku', 'sonnet', 'opus'];
const LIVE_EFFORTS = ['low', 'medium', 'high'];
// agent: the Claude Code agent (its name in Settings → Agents) they go
// through; none, or one that is gone: the default agent when it is Claude
// Code, else the first that is.
let liveOpts = { model: 'haiku', effort: '', agent: '' };
const claudeAgents = () => AGENTS.filter((a) => a.kind === 'claude');
function setLiveOpts(b) {
  if (!b || typeof b !== 'object' || !('model' in b || 'effort' in b)) return false;
  const next = { model: LIVE_MODELS.includes(b.model) ? b.model : 'haiku', effort: LIVE_EFFORTS.includes(b.effort) ? b.effort : '',
    agent: claudeAgents().some((a) => a.label === b.agent) ? b.agent : '' };
  if (next.model === liveOpts.model && next.effort === liveOpts.effort && next.agent === liveOpts.agent) return false;
  liveOpts = next;
  liveRestart();
  return true;
}
// Up again: the resident session and its spare, the desk's too (each only
// if it was up).
function liveRestart() {
  const on = !!live?.on;
  live?.stop();
  live = null;
  if (on) liveUp().warm();
  const had = !!desk;
  desk?.stop();
  desk = null;
  if (had) deskUp().warm();
  judge?.stop();
  judge = null;
  thinker?.stop();
  thinker = null;
  developer?.stop();
  developer = null;
  briefer?.stop();
  briefer = null;
}
function liveAgent() {
  return claudeAgents().find((a) => a.label === liveOpts.agent) || (AGENT?.kind === 'claude' ? AGENT : claudeAgents()[0] || null);
}
const liveEnv = () => { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; return env; };
const liveBin = (agent) => agent.command.trim().split(/\s+/)[0];
// Settings' status: which agent, signed in or not, the session (up, waiting
// on a line how long, its last answer and error).
async function liveStatus() {
  const agent = liveAgent();
  return {
    agents: claudeAgents().map((a) => a.label), agent: agent?.label || null, chosen: liveOpts.agent, bin: agent ? liveBin(agent) : null,
    model: liveOpts.model, effort: liveOpts.effort, signIn: agent ? await agentStatus(agent) : null,
    on: !!live?.on, session: live ? live.state() : null,
  };
}
function liveUp() {
  const agent = liveAgent();
  if (!agent) throw httpError(400, 'The live margin needs the Claude Code agent (Settings → Agents).');
  if (!live) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    live = liveMargin({ bin: liveBin(agent), env, opts: liveOpts });
  }
  return live;
}
function liveFor(rel) {
  liveUp();
  const abs = workspacePath(rel);
  if (!NOTE_EXT.has(extOf(abs))) throw httpError(400, 'The live margin is for notes.');
  if (fs.existsSync(abs) && isPrivateNote(abs)) throw httpError(403, 'This note is private (front matter): its lines are not sent.');
  return relOf(abs);
}
// The meeting's project (front matter "project:", else "tags:"): the other
// notes that share it, newest first, for the margin to know — never a
// private one or one .agentnotesignore names.
function liveProject(rel) {
  const key = liveFor(rel);
  const mine = projectOf(cachedText(key)?.text);
  const by = mine.project.length ? 'project' : mine.tags.length ? 'tags' : null;
  if (!by) return { by: null, names: [], notes: [] };
  const want = new Set(mine[by]);
  const ignored = loadIgnore(ROOT);
  const notes = [];
  for (const f of workspaceFiles()) {
    if (f === key || !NOTE_EXT.has(extOf(f)) || ignored(f)) continue;
    const c = cachedText(f);
    if (!c || !/^\uFEFF?---/.test(c.text) || !projectOf(c.text)[by].some((v) => want.has(v)) || isPrivateNote(path.join(ROOT, f))) continue;
    notes.push({ path: f, mtime: c.mtimeMs, text: c.text.slice(0, 30000) });
  }
  notes.sort((a, b) => b.mtime - a.mtime);
  return { by, names: mine[by], notes: notes.slice(0, 30) };
}

// The desk's margin (experimental, lib/desk.js): the cards someone gives it,
// with a request. A note on a card is read here, never one that is private
// or that .agentnotesignore names (it is withheld, and said so).
let desk = null;
function deskUp() {
  const agent = liveAgent();
  if (!agent) throw httpError(400, 'The desk\u2019s margin needs the Claude Code agent (Settings \u2192 Agents).');
  if (!desk) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    desk = deskMargin({ bin: liveBin(agent), env, opts: liveOpts });
  }
  return desk;
}
// A picture the page sends with a card (a picture's card, scaled down; a
// marked part of one): only of a picture in the workspace that may be sent,
// and only as a picture.
const DESK_PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const deskPicture = (p) => (p && DESK_PICTURE_TYPES.has(p.media) && typeof p.data === 'string' && p.data.length < 7_000_000 && /^[A-Za-z0-9+/]+=*$/.test(p.data) ? { media: p.media, data: p.data } : null);
function deskCards(cards) {
  const ignored = loadIgnore(ROOT);
  const out = [];
  const withheld = [];
  let room = 40000;
  let pictures = 0;
  // A picture in the workspace that may be sent: its path from the root, or null.
  const sendable = (file) => {
    let abs;
    try { abs = workspacePath(file); } catch { return null; }
    const rel = relOf(abs);
    if (!RAW_MIME[extOf(abs)] || !fs.existsSync(abs)) return null;
    if (ignored(rel)) { withheld.push(rel); return null; }
    return rel;
  };
  for (const c of (Array.isArray(cards) ? cards : []).slice(0, 60)) {
    let title = '';
    let text = '';
    const pics = [];
    if (c && typeof c.file === 'string') {
      let abs;
      try { abs = workspacePath(c.file); } catch { continue; }
      const rel = relOf(abs);
      if (ignored(rel) || (NOTE_EXT.has(extOf(abs)) && isPrivateNote(abs))) { withheld.push(rel); continue; }
      title = path.basename(rel).replace(/\.[^.]+$/, '');
      // Its date, when the desk knows it (Over time): beside the title.
      if (typeof c.when === 'string' && c.when.trim()) title += ` (${c.when.trim().slice(0, 40)})`;
      const pic = RAW_MIME[extOf(abs)] && pictures < 8 && deskPicture(c.picture);
      if (pic) pics.push({ ...pic, what: `the picture ${path.basename(rel)}` });
      else if (!NOTE_EXT.has(extOf(abs))) text = '(a file that is not a note)';
      else text = cachedText(rel)?.text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') ?? '(not found)';
    } else if (c && typeof c.text === 'string') {
      text = c.text;
      // A note on a marked part of a picture: the part, and the whole.
      const r = c.region;
      const rel = r && typeof r.file === 'string' && Array.isArray(r.rect) && sendable(r.file);
      if (rel) {
        const name = path.basename(rel);
        const part = pictures < 8 && deskPicture(c.picture);
        const whole = pictures < 7 && deskPicture(c.whole);
        if (part) pics.push({ ...part, what: `the part of ${name} it marks (x, y, width, height: ${r.rect.slice(0, 4).map((v) => Math.round(Number(v) || 0)).join(', ')})` });
        if (whole) pics.push({ ...whole, what: `the whole of ${name}` });
      }
    } else continue;
    text = text.trim().slice(0, Math.min(6000, Math.max(0, room)));
    room -= text.length;
    pictures += pics.length;
    out.push({ n: out.length + 1, key: String(c.key || c.file || out.length).slice(0, 200), title, text, ...(pics.length ? { pictures: pics } : {}) });
  }
  return { cards: out, withheld: [...new Set(withheld)] };
}
// The language most of the workspace's notes are in ('ko', 'en', '' none):
// what a desk answers in about cards without words (pictures). The first
// 4,000 characters of up to 300 notes, counted once in ten minutes.
let notesLangAt = { at: 0, lang: '' };
function notesLang() {
  if (Date.now() - notesLangAt.at < 600000) return notesLangAt.lang;
  const texts = workspaceFiles().filter((p) => NOTE_EXT.has(extOf(p)) && !isTemplatePath(p)).slice(0, 300)
    .map((p) => cachedText(p)?.text.slice(0, 4000) || '');
  notesLangAt = { at: Date.now(), lang: textLang(texts) };
  return notesLangAt.lang;
}
function deskAsk(req, res, body) {
  const canvas = workspacePath(String(body.path || ''));
  if (loadIgnore(ROOT)(relOf(canvas))) throw httpError(403, 'This desk is in .agentnotesignore: its cards are not sent.');
  setLiveOpts(body);
  const m = deskUp();
  const { cards, withheld } = deskCards(body.cards);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  // First: the cards sent, with the numbers they were given (a talk keeps
  // its numbers, so they are known once the request is made).
  let head = false;
  const start = () => { if (!head) { head = true; res.write(`${JSON.stringify({ cards: cards.map((c) => [c.key, c.n]), withheld })}\n`); } };
  let over = false;
  const cancel = m.ask({ task: String(body.task || ''), cards, question: String(body.question || '').slice(0, 2000), talk: String(body.talk || '').slice(0, 100), lang: String(body.lang || ''), fallback: notesLang() || String(body.fallback || '').slice(0, 20) },
    (t) => { start(); res.write(`${JSON.stringify({ t })}\n`); }, (info) => { start(); over = true; res.end(`${JSON.stringify({ end: info })}\n`); });
  start();
  res.on('close', () => { if (!over) cancel(); });
}

function liveLine(req, res, body) {
  const key = liveFor(String(body.path || ''));
  const text = (v, n) => String(v || '').slice(0, n);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  let over = false;
  const cancel = live.line({
    key, title: text(body.title, 200), item: text(body.item, 200), line: text(body.line, 2000), under: text(body.under, 300), today: text(body.today, 300),
    memory: text(body.memory, 6000), found: text(body.found, 3000), task: ['answer', 'summary'].includes(body.task) ? body.task : null, note: body.task ? text(body.note, 16000) : '',
    questions: Array.isArray(body.questions) ? body.questions.slice(0, 40).map((q) => text(q, 300)) : [],
    agenda: Array.isArray(body.agenda) ? body.agenda.slice(0, 30).map((a) => text(a, 120)) : [],
  }, (t) => res.write(`${JSON.stringify({ t })}\n`), (info) => { over = true; res.end(`${JSON.stringify({ end: info })}\n`); });
  res.on('close', () => { if (!over) cancel(); });
}

function send(res, status, obj) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// The Excalidraw editor runs in a sandboxed iframe with an opaque origin, so
// its files are fetched cross-origin (CORS) and its page gets its own CSP
// (from VENDOR.json, written by vendor/excalidraw/build.mjs).
const EXCALIDRAW_DIR = path.join(PUBLIC_DIR, 'vendor', 'excalidraw');
let excalidrawCsp = null;
function excalidrawHeaders(abs, host) {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  if (path.basename(abs) === 'frame.html') {
    if (!excalidrawCsp) excalidrawCsp = JSON.parse(fs.readFileSync(path.join(EXCALIDRAW_DIR, 'VENDOR.json'), 'utf8')).csp;
    headers['Content-Security-Policy'] = excalidrawCsp.replace(/SELF/g, `http://${host}`);
  } else if (path.basename(abs) !== 'VENDOR.json') {
    headers['Cache-Control'] = 'max-age=31536000, immutable'; // file names carry content hashes
  }
  return headers;
}

// Mermaid draws in a sandboxed frame (public/diagrams.js) that may style the
// elements it measures; it loads only the app's own scripts.
const mermaidFrameCsp = (host) => `default-src 'none'; script-src http://${host}; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors http://${host}; base-uri 'none'; form-action 'none'`;

function serveStatic(pathname, res, host) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (!isInside(PUBLIC_DIR, abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return send(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
    ...(isInside(EXCALIDRAW_DIR, abs) ? excalidrawHeaders(abs, host) : {}),
    ...(rel === 'mermaid-frame.html' ? { 'Content-Security-Policy': mermaidFrameCsp(host) } : {}),
  });
  fs.createReadStream(abs).pipe(res);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, 'Request too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(httpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function tokenOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let allowedHosts = new Set();

const server = http.createServer(async (req, res) => {
  try {
    // Host check defeats DNS-rebinding; token check defeats other local pages.
    if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, { error: 'Forbidden host' });
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res, req.headers.host);
    // EventSource and <img> cannot send headers, so these two accept ?t=.
    if (req.method === 'GET' && (url.pathname === '/api/events' || url.pathname === '/api/raw')) {
      if (!tokenOk(url.searchParams.get('t'))) return send(res, 401, { error: 'Missing session token' });
      if (url.pathname === '/api/events') return openEventStream(req, res);
      return serveRaw(url.searchParams.get('path'), res);
    }
    if (!tokenOk(req.headers['x-agent-notes-token'])) {
      return send(res, 401, { error: 'Missing session token. Open the URL printed in the terminal.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/live/line') return liveLine(req, res, await readBody(req, 128 * 1024));
    if (req.method === 'POST' && url.pathname === '/api/desk/ask') return deskAsk(req, res, await readBody(req, 40 * 1024 * 1024));
    const body = req.method === 'POST' || req.method === 'PUT'
      ? await readBody(req, url.pathname === '/api/asset' || (url.pathname === '/api/file' && req.method === 'PUT') || (url.pathname === '/api/runs' && req.method === 'POST') ? 40 * 1024 * 1024 : undefined) : null;
    send(res, 200, await routeApi(req.method, url, body));
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : `Internal error: ${e.message}`, ...(e.data || {}) });
  }
});

// Try the next port when one is taken. Each attempt's handlers are removed
// when it fails, so only the port actually bound is announced.
function listen(port, attempts = 10) {
  const onError = (err) => {
    server.off('listening', onListening);
    if (err.code === 'EADDRINUSE' && attempts > 1) listen(port + 1, attempts - 1);
    else { console.error(err.message); process.exit(1); }
  };
  const onListening = () => {
    server.off('error', onError);
    allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const url = `http://127.0.0.1:${port}/?t=${TOKEN}`;
    console.log(`Margin ${VERSION}`);
    console.log(`  workspace  ${ROOT}`);
    console.log(`  agent      ${AGENTS.length ? AGENTS.map((a) => `${a === AGENT ? '*' : ''}${a.label}  (${a.command})`).join('\n             ') : 'none (start with --agent demo to try the review flow)'}`);
    console.log(`  open       ${url}`);
    console.log('  Local only: bound to 127.0.0.1, no outbound network calls from this app.');
    if (process.send) process.send({ type: 'ready', url, root: ROOT }); // desktop shell
    if (opts.open && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else if (opts.open && process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
    else if (opts.open && process.platform === 'linux') spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
}

markInterruptedRuns();
startWatcher();
listen(opts.port);
setImmediate(() => catchUp().catch((e) => console.error(`Looking for changes made while closed: ${e.message}`)));

function shutdown() {
  seenNotes.save();
  live?.stop();
  desk?.stop();
  judge?.stop();
  thinker?.stop();
  developer?.stop();
  briefer?.stop();
  embed.stop();
  for (const id of running.keys()) { try { cancelRun(id, 'server stopped'); } catch { /* ignore */ } }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
// Launched by the desktop app: never outlive it.
if (process.send) process.on('disconnect', shutdown);
