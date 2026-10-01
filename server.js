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
  '.html', '.css', '.js', '.ts', '.py', '.sh', '.agentnotesignore', '.gitignore']);
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
function createFile({ path: relPath, content }) {
  if (!NOTE_EXT.has(extOf(relPath || ''))) relPath = `${relPath}.md`;
  const abs = workspacePath(relPath);
  if (fs.existsSync(abs)) throw httpError(409, 'A file with that name already exists');
  const title = path.basename(relPath).replace(/\.[^.]+$/, '');
  writeFileAtomic(abs, typeof content === 'string' ? content : `# ${title}\n\n`);
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
  const entry = { mtimeMs: st.mtimeMs, size: st.size, text, lower: text.toLowerCase() };
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
      if (!was || !NOTE_EXT.has(extOf(p))) continue;
      let now = null;
      try { now = readText(path.join(ROOT, p)); } catch { continue; } // moved or deleted: not a change of text
      if (now != null && now !== was.text) keepVersion(p, was.text, 'outside');
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

function listTags() {
  const counts = new Map();
  for (const rel of workspaceFiles()) {
    if (!NOTE_EXT.has(extOf(rel))) continue;
    const c = cachedText(rel);
    if (c) for (const t of noteTags(c.text)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return { tags: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) };
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
    if (!NOTE_EXT.has(extOf(rel))) continue;
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

// Our own writes to notes: remember the new text, so the watcher doesn't
// take them for changes from outside.
function wroteNote(abs, data) {
  if (!isInside(ROOT, abs) || isInside(DATA_DIR, abs) || !NOTE_EXT.has(extOf(abs))) return;
  try {
    const st = fs.statSync(abs);
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    textCache.set(relOf(abs), { mtimeMs: st.mtimeMs, size: st.size, text, lower: text.toLowerCase() });
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
  fs.renameSync(src, dst);
  treeCache = null;
  for (const [a, b] of moved) moveHistory(a, b);

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
  fs.renameSync(src, dst);
  treeCache = null;
  return { path: relOf(dst) };
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
function resolveScope(scope, focus) {
  const ignored = loadIgnore(ROOT);
  let files = walk(ROOT).filter((f) => NOTE_EXT.has(extOf(f)));
  if (scope === 'file') {
    files = files.filter((f) => f === focus);
    if (!files.length) throw httpError(400, 'Open a Markdown or text note to use "this note" scope');
  } else if (scope === 'folder') {
    const dir = focus ? path.posix.dirname(focus) : '.';
    if (dir !== '.') files = files.filter((f) => f.startsWith(`${dir}/`));
  } else if (scope !== 'workspace') {
    throw httpError(400, 'Unknown scope');
  }
  const included = [];
  const excluded = [];
  for (const f of files) {
    const reason = ignored(f) ? '.agentnotesignore'
      : isPrivateNote(path.join(ROOT, f)) ? 'front matter (private)' : null;
    if (reason) excluded.push({ path: f, reason });
    else included.push(f);
  }
  return { scope, focus: focus || null, included, excluded };
}

// The ```flow notation, for tasks that mention it (lib/flow-notation.md).
let flowNotation = null;
const flowGuide = (text) => (/\bflow\b/i.test(text)
  ? (flowNotation ??= fs.readFileSync(path.join(APP_DIR, 'lib', 'flow-notation.md'), 'utf8').trim())
  : '');

function buildPrompt(task, focus, followUp = '') {
  const flow = flowGuide(`${task}\n${followUp}`);
  return [
    'You are helping with a folder of plain Markdown notes.',
    'The current directory is a staged copy of the notes you are allowed to see.',
    'Complete the task by editing, creating or deleting files in this directory only.',
    'Keep edits focused; a human will review your changes as a diff before anything is applied.',
    'Work without asking questions: nobody can answer them. If the task is unclear, make the most reasonable edit.',
    'Diagrams render from ```mermaid code blocks.',
    flow ? `\n${flow}\n` : '',
    focus ? `The note the user is looking at: ${focus}` : '',
    '',
    `Task: ${task}`,
  ].join('\n');
}

function newRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function startRun({ task, scope, focus, selection, agentId, model }) {
  if (!AGENT) throw httpError(400, 'No agent configured. Restart with --agent demo or --agent "<command>".');
  const agent = agentById(agentId);
  const command = agentCommand(agent, typeof model === 'string' ? model : '');
  task = String(task || '').trim();
  if (!task) throw httpError(400, 'Describe the task for the agent');
  const { included, excluded } = resolveScope(scope, focus);
  if (!included.length) throw httpError(400, 'Nothing to share: every note in scope is excluded by privacy rules');
  if (included.length > 5000) throw httpError(400, 'Scope is too large (over 5000 notes); pick a folder');

  ensureDataDir();
  const id = newRunId();
  const dir = runDir(id);
  for (const f of included) {
    for (const sub of ['base', 'work']) {
      const dst = path.join(dir, sub, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), dst);
    }
  }
  const focusShared = focus && included.includes(focus) ? focus : null;
  // A selection is only context from the focused note; never send it if that
  // note is withheld by privacy rules.
  const sel = focusShared && typeof selection === 'string' ? selection.slice(0, 20000) : '';
  const meta = {
    id, task, scope, focus: focusShared, parent: null, round: 1,
    agent: agent.label, agentId: agent.id, command, model: (command === agent.command ? agent.model : model) || '',
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    exitCode: null, files: included, excluded, applied: null, selection: sel ? sel.length : 0,
  };
  let prompt = buildPrompt(task, focusShared);
  if (sel) prompt += `\n\nThe user selected this passage in ${focusShared}; focus the task on it:\n<<<\n${sel}\n>>>`;
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
  const round = (prev.round || 1) + 1;
  const meta = {
    ...prev, id, task, parent: prevId, round, originalTask: prev.originalTask || prev.task,
    agent: agent.label, agentId: agent.id, command, model: command === agent.command ? agent.model : prev.model,
    status: 'running', startedAt: new Date().toISOString(), finishedAt: null,
    exitCode: null, signal: null, usage: undefined, resolvedModel: undefined, cancelReason: undefined, applied: null, child: undefined,
  };
  const prompt = [
    buildPrompt(meta.originalTask, meta.focus, task),
    '',
    `This is round ${round}. Your earlier edits are already in this directory and are still pending human review.`,
    `The reviewer's follow-up: ${task}`,
  ].join('\n');
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
    const out = parseAgentLog(readLog(id, LOG_PARSE_LIMIT), workDir);
    if (out.usage) m.usage = out.usage;
    if (out.model) m.resolvedModel = out.model;
    writeMeta(m);
  });
  return meta;
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
    }
    // Stale but still mergeable: the user edited other parts of the file.
    if (stale && status === 'modified' && !binary && current && !current.includes(0)) {
      change.conflicts = mergeHunks(b.toString('utf8'), current.toString('utf8'), change.hunks).conflicts;
      change.mergeable = change.conflicts.length < change.hunks.length;
    }
    changes.push(change);
  }
  return changes;
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
      if (!sel.size) continue;
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
      // Never hard-delete: move into the run's trash so it can be restored.
      const trash = path.join(DATA_DIR, 'trash', id, c.path);
      fs.mkdirSync(path.dirname(trash), { recursive: true });
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
      fs.renameSync(target, trash);
    } else if (f.status === 'deleted') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(ROOT, f.trash), target);
    }
    reverted.push(f.path);
  }
  meta.status = 'reverted';
  meta.revertedAt = new Date().toISOString();
  writeMeta(meta);
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
    try { const m = readMeta(id); return { id, task: m.task, status: m.status, startedAt: m.startedAt, scope: m.scope, focus: m.focus, agent: m.agent, usage: m.usage || null }; }
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
  if (method === 'POST' && p === '/api/asset') return saveAsset(body || {});
  if (method === 'POST' && p === '/api/rename') return renamePath(body || {});
  if (method === 'POST' && p === '/api/delete') return deletePath(body || {});
  if (method === 'POST' && p === '/api/restore') return restorePath(body || {});
  if (method === 'POST' && p === '/api/folder') return createFolder(body || {});
  if (method === 'GET' && p === '/api/git/status') return gitStatus();
  if (method === 'POST' && p === '/api/git/init') return gitInit();
  if (method === 'GET' && p === '/api/git/diff') return gitDiff(q('path'));
  if (method === 'GET' && p === '/api/git/log') return gitLog(q('path'), q('limit'));
  if (method === 'GET' && p === '/api/git/show') return gitShow(q('rev'), q('path'));
  if (method === 'POST' && p === '/api/git/commit') return gitCommit({ message: (body || {}).message, paths: (body || {}).paths });
  if (method === 'GET' && p === '/api/scope') return resolveScope(q('scope'), q('focus'));
  if (method === 'GET' && p === '/api/runs') return { runs: listRuns() };
  if (method === 'GET' && p === '/api/agents/status') {
    const fresh = q('fresh') === '1';
    const list = await Promise.all(AGENTS.map(async (a) => ({ id: a.id, ...(await agentStatus(a, fresh)) })));
    return { agents: list };
  }
  if (method === 'POST' && p === '/api/runs') return { ...startRun(body || {}), command: undefined };
  if ((m = p.match(/^\/api\/runs\/([\w-]+)$/)) && method === 'GET') {
    const meta = readMeta(m[1]);
    const reviewable = meta.status !== 'running';
    return { ...meta, command: undefined, ...runReport(m[1]), changes: reviewable ? computeChanges(m[1]) : [] };
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
    const body = req.method === 'POST' || req.method === 'PUT'
      ? await readBody(req, url.pathname === '/api/asset' || (url.pathname === '/api/file' && req.method === 'PUT') ? 40 * 1024 * 1024 : undefined) : null;
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

function shutdown() {
  for (const id of running.keys()) { try { cancelRun(id, 'server stopped'); } catch { /* ignore */ } }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
// Launched by the desktop app: never outlive it.
if (process.send) process.on('disconnect', shutdown);
