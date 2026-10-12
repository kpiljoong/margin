'use strict';
// Margin desktop shell. The app itself is unchanged: we run server.js as
// a child process (Electron's bundled Node) bound to 127.0.0.1 and show its UI
// in a locked-down window. Native bits live here: folder picker, recent
// workspaces, agent settings, menus.

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session, globalShortcut, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { fork, execFileSync } = require('child_process');
const { Updater, DOWNLOAD_PAGE } = require('./updater');

const APP_ROOT = path.join(__dirname, '..');

// Dev/test: run an isolated instance (own settings + single-instance lock)
// without touching the user's real app, e.g. AGENT_NOTES_USER_DATA=/tmp/x npm start
if (process.env.AGENT_NOTES_USER_DATA) app.setPath('userData', path.resolve(process.env.AGENT_NOTES_USER_DATA));
// The app used to be called "Agent Notes": carry its settings over once.
else {
  const legacy = path.join(app.getPath('appData'), 'Agent Notes', 'config.json');
  const current = path.join(app.getPath('userData'), 'config.json');
  try {
    if (!fs.existsSync(current) && fs.existsSync(legacy)) {
      fs.mkdirSync(path.dirname(current), { recursive: true });
      fs.copyFileSync(legacy, current);
    }
  } catch { /* start fresh */ }
}

// The UI keeps nothing secret in cookies or saved passwords, so Chromium's
// keychain-backed encryption is unnecessary; skipping it avoids the macOS
// "wants to use your confidential information" prompt on unsigned builds.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const isMac = process.platform === 'darwin';

// Presets offered in the agent settings window. Profiles are stored as
// config.agents = [{ name, command }] with config.agentDefault = name.
// To support another CLI agent, add an entry: `bin` is the executable used to
// detect it and to recognise edited commands; the command must run headless,
// read the prompt from stdin and edit files in the current directory.
// Claude/Codex print JSON events so the review can show steps, reply and
// usage (lib/agentlog.js); server.js knows their model flags and sign-in check.
const AGENT_PRESETS = [
  { name: 'Demo (offline)', bin: 'demo', command: 'demo', detail: 'Built-in, deterministic, no network. Good for trying the review flow.' },
  { name: 'Claude Code', bin: 'claude', command: 'claude -p --model sonnet --output-format stream-json --verbose --permission-mode acceptEdits --no-session-persistence', detail: 'Claude Sonnet via the claude CLI. Shared notes are sent to Anthropic.' },
  { name: 'Codex', bin: 'codex', command: 'codex exec --json -m gpt-6-sol -c model_reasoning_effort=low -s workspace-write --skip-git-repo-check --ephemeral --color never -', detail: 'GPT-6 Sol via the codex CLI (sandboxed to the staged copy). Shared notes are sent to OpenAI.' },
];
// Earlier preset commands, upgraded in place when the config is loaded.
const LEGACY_PRESET_COMMANDS = {
  'claude -p --permission-mode acceptEdits': 'claude',
  'claude -p --model sonnet --permission-mode acceptEdits --no-session-persistence': 'claude',
  'codex exec -m gpt-6-sol -c model_reasoning_effort=low -s workspace-write --skip-git-repo-check --ephemeral --color never -': 'codex',
};
const presetFor = (command) => AGENT_PRESETS.find((p) => p.command === command) || AGENT_PRESETS.find((p) => String(command || '').trim().split(/\s+/)[0] === p.bin);

// Whether a preset's CLI is on PATH (after adopting the login shell PATH).
function hasBin(bin) {
  if (bin === 'demo') return true;
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  return (process.env.PATH || '').split(path.delimiter).some((d) => d && exts.some((x) => { try { return fs.statSync(path.join(d, bin + x)).isFile(); } catch { return false; } }));
}

const agentProfiles = () => (Array.isArray(config.agents) ? config.agents.filter((a) => a && a.command) : []);
const agentCommands = () => agentProfiles().map((a) => a.command);

// ---------------------------------------------------------------- config

const configPath = () => path.join(app.getPath('userData'), 'config.json');
let config = { workspace: null, recent: [], agent: '', bounds: null, background: '#1b1d23', quickCapture: true, autoUpdateCheck: false, shortcuts: {} };

// Keyboard shortcuts: the defaults (shared with the page, public/keys.js) and
// the ones changed in Settings (config.shortcuts = { id: keys }, "" for none).
const SHORTCUTS = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'public', 'shortcuts.json'), 'utf8'));
const KEYS_RE = /^(?:(?:CmdOrCtrl|Ctrl|Alt|Shift)\+){0,4}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|[[\]\\,./;'`=-]|Up|Down|Left|Right|Enter|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown)$/;
const validKeys = (k) => k === '' || (typeof k === 'string' && KEYS_RE.test(k));
function keysFor(id) {
  const custom = config.shortcuts || {};
  const k = Object.prototype.hasOwnProperty.call(custom, id) && validKeys(custom[id]) ? custom[id] : SHORTCUTS.find((s) => s.id === id)?.keys;
  return k || undefined;
}
// "⌃⌥N" on a Mac, "Ctrl+Alt+N" elsewhere.
function keysLabel(k) {
  if (!k) return 'none';
  const parts = k.split('+');
  const key = parts.pop();
  if (!isMac) return [...parts.map((m) => (m === 'CmdOrCtrl' ? 'Ctrl' : m)), key].join('+');
  return ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'].filter((m) => parts.includes(m)).map((m) => ({ CmdOrCtrl: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' })[m]).join('')
    + ({ Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵' }[key] || key);
}

// System-wide shortcut: bring the window forward and open quick capture.
// Returns false when another app holds those keys.
let quickCaptureKey = null;
function registerQuickCapture({ paused = false } = {}) {
  if (quickCaptureKey) globalShortcut.unregister(quickCaptureKey);
  quickCaptureKey = null;
  const key = keysFor('quick-capture');
  if (!config.quickCapture || !key || paused) return true;
  let ok = false;
  try {
    ok = globalShortcut.register(key, async () => {
      // The window last in front (or the last folder, opened again).
      let v = lastView();
      if (!v) { if (!config.workspace || !(await openWorkspace(config.workspace, { newWindow: true }))) return; v = lastView(); }
      if (!v) return;
      if (v.win.isMinimized()) v.win.restore();
      v.win.show();
      v.win.focus();
      app.focus({ steal: true });
      setTimeout(() => sendTo(v, 'quick-capture'), v.win.webContents.isLoading() ? 800 : 0);
    });
  } catch { /* not keys the system takes */ }
  if (ok) quickCaptureKey = key;
  return ok;
}

function loadConfig() {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }; } catch { /* first run */ }
  // v0.1/v0.2 stored a single command in config.agent.
  if (!Array.isArray(config.agents)) {
    const cmd = typeof config.agent === 'string' ? config.agent.trim() : '';
    const preset = presetFor(cmd);
    config.agents = cmd ? [{ name: preset ? preset.name : 'Custom', command: cmd }] : [];
    config.agentDefault = config.agents[0]?.name || '';
    delete config.agent;
  }
  for (const a of config.agents) {
    const bin = LEGACY_PRESET_COMMANDS[a?.command];
    if (bin) a.command = AGENT_PRESETS.find((p) => p.bin === bin).command;
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// GUI apps on macOS start with a minimal PATH, so CLI agents like `claude`
// (often under ~/.nvm, /opt/homebrew, ~/.local/bin) would not be found.
let pathAdopted = false;
function adoptLoginShellPath() {
  if (process.platform === 'win32' || pathAdopted) return;
  pathAdopted = true;
  try {
    const shellBin = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shellBin, ['-ilc', 'printf "__AN_PATH__%s__AN_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/__AN_PATH__(.*)__AN_PATH__/);
    if (m && m[1]) process.env.PATH = m[1];
  } catch { /* keep default PATH */ }
}

// ---------------------------------------------------------------- server

// Each window shows one folder of notes, with a server of its own:
// { win, server (its process), info: { url, origin, root }, root }.
// Two windows never show the same folder; closing one stops its server only.
const views = new Set();
let focusedView = null;
let quitting = false;
// Quitting asked for (the windows closing one by one keep their folders for next time); a window with unsaved notes may still call it off.
let closingAll = false;

function stopServer(view) {
  const child = view.server;
  view.server = null;
  view.info = null;
  if (child && child.exitCode === null) child.kill('SIGTERM');
}
const viewOf = (w) => (w ? [...views].find((v) => v.win === w || v.win?.webContents === w) || null : null);
// The window an IPC message came from — none of ours: nothing.
const viewFrom = (e) => [...views].find((v) => v.win && !v.win.isDestroyed() && e.sender === v.win.webContents) || null;
const viewByRoot = (root) => [...views].find((v) => v.root && realpath(v.root) === realpath(root)) || null;
const lastView = () => {
  const f = viewOf(BrowserWindow.getFocusedWindow());
  if (f) return f;
  return focusedView && views.has(focusedView) && focusedView.win && !focusedView.win.isDestroyed() ? focusedView : [...views].reverse().find((v) => v.win && !v.win.isDestroyed()) || null;
};
const anyInfo = () => [...views].some((v) => v.info);
// The folders open in windows, for the next start.
function rememberOpen() {
  if (quitting || closingAll) return;
  config.open = [...views].map((v) => v.root).filter(Boolean);
  saveConfig();
}

// The margin's model, fetched for the server through the system's network
// (Chromium's: its proxy, a PAC file, the certificates it trusts — as the
// browser gets it): only its files' hosts, only into models/ here, as a
// .part the server then checks (its size and SHA-256) and keeps or not.
const MODEL_HOSTS = new Set(['cdn.jsdelivr.net', 'unpkg.com', 'huggingface.co']);
async function fetchModelFile(child, m) {
  const say = (x) => { try { child.send({ ...x, id: m.id }); } catch { /* gone */ } };
  let out = null;
  try {
    const u = new URL(String(m.url));
    const dir = path.join(app.getPath('userData'), 'models') + path.sep;
    const to = path.resolve(String(m.to));
    if (u.protocol !== 'https:' || !MODEL_HOSTS.has(u.host) || !to.startsWith(dir) || !to.endsWith('.part') || !(m.size > 0)) throw new Error('not one of the model\u2019s files');
    const res = await net.fetch(u.href);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    out = fs.createWriteStream(to);
    const reader = res.body.getReader();
    let n = 0;
    let told = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > m.size) { reader.cancel().catch(() => {}); throw new Error('larger than expected (a page in its place?)'); }
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (n - told >= 1 << 20) { told = n; say({ type: 'model-file-got', got: n }); }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    say({ type: 'model-file-done', got: n });
  } catch (e) {
    out?.destroy();
    say({ type: 'model-file-done', error: e.message });
  }
}

function startServer(view, workspace) {
  stopServer(view);
  // Only external CLI agents need the user's full PATH. Running the login
  // shell lazily avoids touching shell startup files (and any folder-access
  // prompts they trigger) for people who never enable an agent.
  if (agentCommands().some((c) => c && c !== 'demo')) adoptLoginShellPath();
  return new Promise((resolve, reject) => {
    // 4321 for the first (the page's own storage is per port), the next one free for each other.
    const args = [workspace, '--no-open', '--port', '4321'];
    if (config.agentDefault) args.push('--default-agent', config.agentDefault);
    const child = fork(path.join(APP_ROOT, 'server.js'), args, {
      // (Its certificates as the system's too: a company's own, as the browser trusts them.)
      execArgv: [...process.execArgv, '--use-system-ca'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MARGIN_MODEL_FETCH: '1', AGENT_NOTES_AGENTS: JSON.stringify(agentProfiles()) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
    child.on('message', (m) => {
      if (m && m.type === 'model-file') { fetchModelFile(child, m); return; }
      if (m && m.type === 'ready') {
        if (view.server === child) view.info = { url: m.url, origin: new URL(m.url).origin, root: m.root };
        resolve(view.info);
      }
    });
    child.on('exit', (code) => {
      const unexpected = view.server === child && !quitting && !view.closing;
      if (view.server === child) { view.server = null; view.info = null; }
      if (unexpected) dialog.showErrorBox('Margin', `The local note server for ${path.basename(workspace)} stopped (exit ${code}).\n\n${stderr.slice(-800)}`);
      reject(new Error(stderr.trim() || `server exited with ${code}`));
    });
    view.server = child;
  });
}

// ---------------------------------------------------------------- windows

function createWindow(root = null) {
  const saved = root && config.boundsByRoot?.[root];
  let b = saved || config.bounds || { width: 1280, height: 820 };
  // A window more over one already there, not on top of it.
  if (!saved && [...views].some((v) => v.win && !v.win.isDestroyed() && v.win.getBounds().x === b.x && v.win.getBounds().y === b.y)) b = { ...b, x: (b.x ?? 80) + 28, y: (b.y ?? 60) + 28 };
  const win = new BrowserWindow({
    ...b,
    minWidth: 720,
    minHeight: 480,
    title: 'Margin',
    backgroundColor: config.background || '#1b1d23',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    icon: isMac ? undefined : path.join(APP_ROOT, 'public', 'icon.png'),
    trafficLightPosition: { x: 14, y: 12 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const view = { win, server: null, info: null, root };
  views.add(view);
  win.once('ready-to-show', () => win.show());

  // Only its own local server may be displayed; everything else goes to the OS browser.
  const openExternally = (url) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => { openExternally(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!view.info || !url.startsWith(view.info.origin)) { e.preventDefault(); openExternally(url); }
  });

  // The web UI blocks unload when tabs have unsaved edits; ask natively.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Discard Changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'If you continue, unsaved edits in open notes will be lost.',
    });
    if (choice === 0) e.preventDefault();
    else { restartPending = false; closingAll = false; } // the user kept the window, so no restart (nor quit)
  });

  const remember = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    config.bounds = win.getBounds();
    if (view.root) config.boundsByRoot = { ...(config.boundsByRoot || {}), [view.root]: config.bounds };
    saveConfig();
  };
  win.on('resize', debounce(remember, 500));
  win.on('move', debounce(remember, 500));
  win.on('focus', () => { focusedView = view; buildMenu(); });
  // Closed: its server stops (and the folder is not reopened next time, unless the app is quitting).
  win.on('closed', () => {
    view.closing = true;
    stopServer(view);
    views.delete(view);
    if (focusedView === view) focusedView = null;
    rememberOpen();
    if (!quitting) buildMenu();
  });
  return view;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function showServer(view) {
  if (view.info) {
    await view.win.loadURL(view.info.url);
    view.win.setTitle(`${path.basename(view.info.root)} — Margin`);
  }
}

// A folder in a window: the one showing it already (brought forward); else
// in place of the folder of the window asked for (view), or in a new window.
async function openWorkspace(dir, { view = null, newWindow = false } = {}) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    dialog.showErrorBox('Margin', `Folder not found:\n${dir}`);
    return false;
  }
  dir = path.resolve(dir);
  const there = viewByRoot(dir);
  if (there && there.info) {
    if (there.win.isMinimized()) there.win.restore();
    there.win.show();
    there.win.focus();
    return there;
  }
  // A window with no folder yet (the first one) is used first.
  let v = there || (newWindow ? [...views].find((x) => !x.root && !x.info) : view || lastView());
  if (!v) v = createWindow(dir);
  const was = v.root;
  v.root = dir;
  try {
    await startServer(v, dir);
  } catch (e) {
    v.root = was;
    dialog.showErrorBox('Margin', `Could not open ${dir}\n\n${e.message}`);
    if (!v.info && !was && views.size > 1) v.win.destroy();
    return false;
  }
  config.workspace = dir;
  config.recent = [dir, ...config.recent.filter((r) => r !== dir)].slice(0, 8);
  rememberOpen();
  app.addRecentDocument(dir);
  buildMenu();
  await showServer(v);
  return v;
}

// A note opens inside a workspace: the one already open or a recent one that
// contains it, otherwise the folder it sits in.
const NOTE_FILE = /\.(md|markdown|mdx|txt)$/i;
const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const within = (dir, file) => { const r = path.relative(dir, file); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

function workspaceFor(file) {
  const open = [...views].map((v) => v.root).filter((r) => r && within(realpath(r), file)).sort((a, b) => b.length - a.length)[0];
  if (open) return open;
  const known = config.recent.map(realpath).filter((r) => within(r, file)).sort((a, b) => b.length - a.length)[0];
  return known || path.dirname(file);
}

// A note opens in the window of its folder (a new window when none shows it).
async function openNote(file) {
  file = realpath(file);
  const root = workspaceFor(file);
  const v = viewByRoot(root) || (await openWorkspace(root, { newWindow: true }));
  if (!v) return false;
  app.addRecentDocument(file);
  v.win.webContents.send('desktop:open-note', path.relative(v.info.root, file).split(path.sep).join('/'));
  if (v.win.isMinimized()) v.win.restore();
  v.win.focus();
  return true;
}

// Folders open as the workspace; Markdown/text files open as notes. Requests
// run one at a time: macOS can deliver the same file twice at launch (argv and
// an open-file event), and two workspace switches must not overlap.
let opening = Promise.resolve();
function openPath(p) {
  const run = opening.then(() => openPathNow(p));
  opening = run.catch(() => {});
  return run;
}

async function openPathNow(p) {
  let st;
  try { st = fs.statSync(p); } catch { dialog.showErrorBox('Margin', `Not found:\n${p}`); return false; }
  // From outside (Finder, the Dock, another launch): a folder in a window of its own.
  if (st.isDirectory()) return !!(await openWorkspace(path.resolve(p), { newWindow: true }));
  if (st.isFile() && NOTE_FILE.test(p)) return openNote(p);
  dialog.showErrorBox('Margin', `Margin opens folders and Markdown or text notes (.md, .markdown, .mdx, .txt).\n\n${p}`);
  return false;
}

async function openPaths(paths) {
  // Several notes from one workspace all open; otherwise the last one wins.
  for (const p of paths) await openPath(p);
}

async function chooseFile() {
  const r = await dialog.showOpenDialog(lastView()?.win || undefined, {
    title: 'Open a note',
    buttonLabel: 'Open',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }],
  });
  if (!r.canceled && r.filePaths.length) { await openPaths(r.filePaths); return anyInfo(); }
  return false;
}

// In place of the window's folder (view), or in a new window.
async function chooseFolder({ view = null, newWindow = false } = {}) {
  const r = await dialog.showOpenDialog((view || lastView())?.win || undefined, {
    title: newWindow ? 'Open a folder of notes in a new window' : 'Open a folder of notes',
    buttonLabel: 'Open Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!r.canceled && r.filePaths[0]) return !!(await openWorkspace(r.filePaths[0], { view, newWindow }));
  return false;
}

async function openSample() {
  const dst = path.join(app.getPath('userData'), 'Sample Notes');
  if (!fs.existsSync(dst)) fs.cpSync(path.join(APP_ROOT, 'example-workspace'), dst, { recursive: true });
  // The sample is for trying the review flow, so make sure the demo agent exists.
  if (!agentProfiles().some((a) => a.command === 'demo')) {
    config.agents = [...agentProfiles(), { name: AGENT_PRESETS[0].name, command: 'demo' }];
    if (!config.agentDefault) config.agentDefault = AGENT_PRESETS[0].name;
  }
  return !!(await openWorkspace(dst));
}

async function firstRun() {
  appStarted();
  const { response } = await dialog.showMessageBox(lastView()?.win, {
    type: 'none',
    buttons: ['Open Folder…', 'Open File…', 'Try Sample Notes', 'Quit'],
    defaultId: 0,
    cancelId: 3,
    message: 'Welcome to Margin',
    detail: 'Open any folder of Markdown files — they stay plain files on your disk.\n\nOr try the sample notes with the offline demo agent to see how delegating and reviewing works.',
  });
  if (response === 0 && (await chooseFolder())) return;
  if (response === 1 && (await chooseFile())) return;
  if (response === 2 && (await openSample())) return;
  if (response === 3) { app.quit(); return; }
  if (!anyInfo()) firstRun();
}

// ---------------------------------------------------------------- updates

const boot = global.marginBoot || null;
const updater = new Updater();
let updateWin = null;
let restartPending = false;
const offered = new Set(); // versions already shown by an automatic check

// The launcher counts a code update as broken if it never gets this far.
let started = false;
function appStarted() {
  if (started) return;
  started = true;
  boot?.markHealthy();
  const rb = boot?.rolledBack();
  if (rb) {
    boot.clearRollbackNotice();
    dialog.showMessageBox(lastView()?.win || undefined, {
      type: 'warning',
      message: `The update to Margin ${rb.version} was set aside`,
      detail: `It could not be used because ${rb.reason}. Margin is running ${boot.activeVersion}.`,
    });
  }
}

function updateInfo() {
  return { supported: updater.supported, auto: !!config.autoUpdateCheck, versions: updater.versions(), state: updater.state, rolledBack: boot?.rolledBack() || null };
}

function openUpdateWindow() {
  if (updateWin) { updateWin.focus(); return; }
  updateWin = new BrowserWindow({
    width: 520,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Software Update',
    backgroundColor: '#21242b',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'update-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  updateWin.setMenu(null);
  updateWin.loadFile(path.join(__dirname, 'update.html'));
  updateWin.once('ready-to-show', () => updateWin.show());
  updateWin.webContents.on('will-navigate', (e) => e.preventDefault());
  updateWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  updateWin.on('closed', () => { updateWin = null; });
}

updater.on('state', (state) => {
  updateWin?.webContents.send('update:state', state);
  // An automatic check found something: show it once per version.
  if (['available', 'needs-app'].includes(state.status) && !(state.auto && state.setAside) && !updateWin && !offered.has(state.latest)) {
    offered.add(state.latest);
    openUpdateWindow();
  }
});

function checkForUpdates() {
  openUpdateWindow();
  if (!['available', 'ready', 'downloading'].includes(updater.state.status)) updater.check();
}

function restartToUpdate() {
  restartPending = true;
  app.quit(); // unsaved notes ask first; cancelling keeps the app running
}

const fromUpdateWin = (e) => updateWin && e.sender === updateWin.webContents;
ipcMain.handle('update:get', (e) => (fromUpdateWin(e) ? updateInfo() : null));
ipcMain.handle('update:check', (e) => (fromUpdateWin(e) ? updater.check() : null));
ipcMain.handle('update:install', (e) => (fromUpdateWin(e) ? updater.install() : null));
ipcMain.handle('update:set-auto', (e, on) => {
  if (!fromUpdateWin(e)) return null;
  config.autoUpdateCheck = !!on;
  saveConfig();
  updater.schedule(config.autoUpdateCheck);
  return updateInfo();
});
ipcMain.on('update:restart', (e) => { if (fromUpdateWin(e) && updater.state.status === 'ready') restartToUpdate(); });
ipcMain.on('update:open-download', (e) => {
  if (!fromUpdateWin(e)) return;
  const url = updater.state.releaseUrl || DOWNLOAD_PAGE;
  if (/^https:\/\/github\.com\/kpiljoong\/margin\//.test(url)) shell.openExternal(url);
});
ipcMain.on('update:close', (e) => { if (fromUpdateWin(e)) updateWin.close(); });

// ---------------------------------------------------------------- agent settings

let agentWin = null;

function openAgentSettings() {
  if (agentWin) { agentWin.focus(); return; }
  agentWin = new BrowserWindow({
    parent: lastView()?.win || undefined,
    modal: !!lastView(),
    width: 560,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Agent',
    backgroundColor: '#21242b',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'agent-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  agentWin.setMenu(null);
  agentWin.loadFile(path.join(__dirname, 'agent.html'));
  agentWin.once('ready-to-show', () => agentWin.show());
  agentWin.webContents.on('will-navigate', (e) => e.preventDefault());
  agentWin.on('closed', () => { agentWin = null; });
}

async function setAgents(agents, defaultName) {
  config.agents = agents;
  config.agentDefault = agents.some((a) => a.name === defaultName) ? defaultName : (agents[0]?.name || '');
  saveConfig();
  buildMenu();
  // Each window's server again, with the new agent; running agent runs are cancelled.
  for (const v of [...views].filter((x) => x.root && x.info)) {
    try { await startServer(v, v.root); await showServer(v); } catch (e) { dialog.showErrorBox('Margin', `Could not open ${v.root}\n\n${e.message}`); }
  }
}

// Only accept IPC from our own windows — each message acts on the window it came from.
const fromAgentWin = (e) => agentWin && e.sender === agentWin.webContents;

ipcMain.on('desktop:open-folder', (e) => { const v = viewFrom(e); if (v) chooseFolder({ view: v }); });
ipcMain.on('desktop:open-file', (e) => { if (viewFrom(e)) chooseFile(); });
// Paths come from files the user dropped on the window (see preload.js).
ipcMain.on('desktop:open-paths', (e, paths) => {
  if (!viewFrom(e) || !Array.isArray(paths)) return;
  const list = paths.filter((p) => typeof p === 'string' && path.isAbsolute(p)).slice(0, 20);
  if (list.length) openPaths(list);
});
ipcMain.on('desktop:configure-agent', (e) => { if (viewFrom(e)) openAgentSettings(); });
ipcMain.on('desktop:reveal', (e, rel) => {
  const v = viewFrom(e);
  if (!v?.info) return;
  if (rel === undefined) { shell.openPath(v.info.root); return; }
  // Only items inside its workspace.
  const root = path.resolve(v.info.root);
  const abs = path.resolve(root, String(rel));
  if (abs !== root && !abs.startsWith(root + path.sep)) return;
  if (fs.existsSync(abs)) shell.showItemInFolder(abs);
});
ipcMain.on('desktop:close-window', (e) => { viewFrom(e)?.win.close(); });
ipcMain.on('desktop:ui-ready', (e) => { if (viewFrom(e)) appStarted(); });
ipcMain.on('desktop:background', (e, color) => {
  if (!viewFrom(e) || !/^#[0-9a-f]{6}$/i.test(color) || color === config.background) return;
  config.background = color;
  for (const v of views) if (v.win && !v.win.isDestroyed()) v.win.setBackgroundColor(color);
  saveConfig();
});

// The page's own small settings (theme, layout, tabs…: { key: string }),
// kept here rather than in browser storage, which is per port — so a second
// running app that got another port would start from scratch. Read once,
// synchronously, as the page starts; null until the page has stored any.
// Keys hold the workspace path (any characters: \ on Windows, Korean names…).
const PAGE_KEY_RE = /^an\.[^\u0000-\u001f\u007f]{1,1000}$/u;
const PAGE_MAX = 4 * 1024 * 1024;
let pageSaveTimer = null;
const savePageSoon = () => { clearTimeout(pageSaveTimer); pageSaveTimer = setTimeout(saveConfig, 300); };
ipcMain.on('desktop:page-store', (e) => { e.returnValue = viewFrom(e) && config.page ? { ...config.page } : null; });
ipcMain.on('desktop:page-store-set', (e, entries) => {
  if (!viewFrom(e) || !entries || typeof entries !== 'object') return;
  const page = { ...(config.page || {}) };
  for (const [k, v] of Object.entries(entries)) {
    if (!PAGE_KEY_RE.test(k)) continue;
    if (v == null) delete page[k];
    else if (typeof v === 'string') page[k] = v;
  }
  if (JSON.stringify(page).length > PAGE_MAX) return;
  config.page = page;
  savePageSoon();
});
// Written by now: the window (and its last writes) closes before will-quit.
app.on('will-quit', () => { if (pageSaveTimer) { clearTimeout(pageSaveTimer); pageSaveTimer = null; saveConfig(); } });

// Menu items that act inside the web UI.
ipcMain.handle('desktop:get-shortcuts', (e) => (viewFrom(e) ? { ...(config.shortcuts || {}) } : null));
// Stores the changed shortcuts and puts them in the menu and the system.
ipcMain.handle('desktop:set-shortcuts', (e, custom) => {
  if (!viewFrom(e) || !custom || typeof custom !== 'object') return null;
  const known = new Set(SHORTCUTS.map((s) => s.id));
  config.shortcuts = Object.fromEntries(Object.entries(custom).filter(([id, k]) => known.has(id) && validKeys(k)));
  saveConfig();
  buildMenu();
  return { quickCapture: registerQuickCapture() };
});
// While a shortcut is being recorded, the system-wide one lets its keys through.
ipcMain.on('desktop:recording-keys', (e, on) => { if (viewFrom(e)) registerQuickCapture({ paused: !!on }); });
const sendTo = (v, name) => { if (v?.info && v.win && !v.win.isDestroyed()) v.win.webContents.send('desktop:command', name); };
// A menu command: to the window it was chosen in (else the one last in front).
const sendCommand = (name) => (_item, w) => sendTo(viewOf(w) || lastView(), name);
ipcMain.handle('agent:get', (e) => {
  if (!fromAgentWin(e)) return null;
  adoptLoginShellPath();
  const presets = AGENT_PRESETS.map((p) => ({ ...p, installed: hasBin(p.bin) }));
  return { agents: agentProfiles(), defaultName: config.agentDefault, presets };
});
ipcMain.handle('agent:set', async (e, payload) => {
  if (!fromAgentWin(e) || !payload || !Array.isArray(payload.agents) || payload.agents.length > 12) return false;
  const seen = new Set();
  const agents = [];
  for (const a of payload.agents) {
    const name = String(a?.name || '').trim().slice(0, 60);
    const command = String(a?.command || '').trim();
    if (!name || !command || command.length > 2000 || seen.has(name.toLowerCase())) return false;
    seen.add(name.toLowerCase());
    agents.push({ name, command });
  }
  agentWin.close();
  await setAgents(agents, String(payload.defaultName || ''));
  return true;
});
ipcMain.on('agent:cancel', (e) => { if (fromAgentWin(e)) agentWin.close(); });

// ---------------------------------------------------------------- menu

function agentLabel() {
  const n = agentProfiles().length;
  return n ? `${config.agentDefault || agentProfiles()[0].name}${n > 1 ? ` (+${n - 1} more)` : ''}` : 'Off';
}

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates…', click: checkForUpdates },
        { type: 'separator' },
        { label: 'Settings…', accelerator: keysFor('settings'), click: sendCommand('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Note…', accelerator: keysFor('new-note'), click: sendCommand('new-note') },
        { label: 'New Folder…', accelerator: keysFor('new-folder'), click: sendCommand('new-folder') },
        { label: 'Quick Open…', accelerator: keysFor('quick-open'), click: sendCommand('quick-open') },
        { label: 'Quick Capture…', click: sendCommand('quick-capture') },
        {
          label: `Global Quick Capture Shortcut (${keysLabel(keysFor('quick-capture'))})`,
          type: 'checkbox',
          checked: !!config.quickCapture,
          click: (item) => { config.quickCapture = item.checked; saveConfig(); registerQuickCapture(); },
        },
        { type: 'separator' },
        { label: 'Open File…', accelerator: keysFor('open-file'), click: () => chooseFile() },
        { label: 'Open Folder…', accelerator: keysFor('open-folder'), click: (_i, w) => chooseFolder({ view: viewOf(w) }) },
        { label: 'Open Folder in New Window…', accelerator: keysFor('open-folder-window'), click: () => chooseFolder({ newWindow: true }) },
        {
          label: 'Open Recent',
          submenu: config.recent.length
            ? [...config.recent.map((r) => ({ label: r, click: (_i, w) => openWorkspace(r, { view: viewOf(w) }) })),
              { type: 'separator' },
              { label: 'In a New Window', submenu: config.recent.map((r) => ({ label: r, click: () => openWorkspace(r, { newWindow: true }) })) },
              { type: 'separator' },
              { label: 'Clear Recent', click: () => { config.recent = []; saveConfig(); app.clearRecentDocuments(); buildMenu(); } }]
            : [{ label: 'No recent folders', enabled: false }],
        },
        { label: 'Open Sample Notes', click: () => openSample() },
        { type: 'separator' },
        { label: isMac ? 'Reveal Folder in Finder' : 'Show Folder', enabled: anyInfo(), click: (_i, w) => { const v = viewOf(w) || lastView(); if (v?.info) shell.openPath(v.info.root); } },
        { type: 'separator' },
        { label: 'Export Note as HTML…', click: sendCommand('export-html') },
        { label: 'Print Note…', accelerator: keysFor('print'), click: sendCommand('print') },
        { type: 'separator' },
        { label: 'Save', accelerator: keysFor('save'), click: sendCommand('save') },
        { label: 'Close Tab', accelerator: keysFor('close-tab'), click: sendCommand('close-tab') },
        { label: 'Close Window', accelerator: keysFor('close-window'), click: (_i, w) => w && w.close() },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      // Undo and redo go to the page: a note's editor keeps its own history
      // (public/undo.js), which the built-in Undo wouldn't reach.
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: (_i, w) => (viewOf(w) ? sendTo(viewOf(w), 'undo') : w?.webContents.undo()) },
        { label: 'Redo', accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'Ctrl+Y', click: (_i, w) => (viewOf(w) ? sendTo(viewOf(w), 'redo') : w?.webContents.redo()) },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }] : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'Agent',
      submenu: [
        { label: `Default: ${agentLabel()}`, enabled: false },
        { label: 'Manage Agents…', click: () => openAgentSettings() },
        { label: 'Delegate Task…', accelerator: keysFor('delegate'), click: sendCommand('delegate') },
        { label: 'Show Runs', accelerator: keysFor('runs'), click: sendCommand('runs') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette…', accelerator: keysFor('palette'), click: sendCommand('palette') },
        { label: 'Search Workspace', accelerator: keysFor('search'), click: sendCommand('search') },
        { label: 'Cycle Edit / Split / Preview', accelerator: keysFor('cycle-mode'), click: sendCommand('cycle-mode') },
        { label: 'Focus Mode', accelerator: keysFor('focus'), click: sendCommand('focus') },
        { label: 'Toggle Sidebar', accelerator: keysFor('sidebar'), click: sendCommand('sidebar') },
        { label: 'Split Editor / Switch Pane', accelerator: keysFor('split'), click: sendCommand('split') },
        { label: 'Choose Theme…', click: sendCommand('theme') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        // The interface's size, kept in the page's settings (the editor's text keeps its own).
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: sendCommand('ui-reset') },
        { label: 'Bigger Interface', accelerator: 'CmdOrCtrl+=', click: sendCommand('ui-bigger') },
        { label: 'Smaller Interface', accelerator: 'CmdOrCtrl+-', click: sendCommand('ui-smaller') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: keysFor('nav-back'), click: sendCommand('nav-back') },
        { label: 'Forward', accelerator: keysFor('nav-forward'), click: sendCommand('nav-forward') },
      ],
    },
    { role: 'windowMenu' },
    ...(isMac ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: checkForUpdates }, { role: 'about' }] }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const pathArg = (argv, cwd = process.cwd()) => argv.slice(app.isPackaged ? 1 : 2)
    // (Not the app's own folder: "electron ." in development.)
    .filter((a) => !a.startsWith('-')).map((a) => path.resolve(cwd, a)).find((a) => a !== path.resolve(APP_ROOT) && fs.existsSync(a));

  // Windows/Linux: "Open with Margin" while the app is running.
  app.on('second-instance', (_e, argv, cwd) => {
    const p = app.isReady() && pathArg(argv, cwd);
    if (p) openPath(p);
    else { const v = lastView(); if (v) { if (v.win.isMinimized()) v.win.restore(); v.win.focus(); } }
  });

  // macOS: dropping a folder or note on the Dock icon, Finder's "Open With",
  // `open -a "Margin" ~/notes`.
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (app.isReady()) openPath(p);
    else config.pendingOpen = p;
  });

  app.whenReady().then(async () => {
    loadConfig();
    // The UI needs no browser permissions (camera, notifications, …) except
    // writing to the clipboard (copy link, copy diagram or drawing as image),
    // and only for the app's own pages. Reading the clipboard stays denied.
    const ownPage = (u) => typeof u === 'string' && [...views].some((v) => v.info && (u === v.info.origin || u.startsWith(`${v.info.origin}/`)));
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => cb(perm === 'clipboard-sanitized-write' && ownPage(details?.requestingUrl)));
    if (boot) {
      app.setAboutPanelOptions({
        applicationVersion: boot.activeVersion,
        version: boot.source === 'update' ? `app ${boot.bundledVersion}` : '',
      });
    }
    buildMenu();
    registerQuickCapture();
    updater.schedule(config.autoUpdateCheck);
    // Packaged builds get the icon from electron-builder; show it in dev too.
    const devIcon = path.join(APP_ROOT, 'public', 'icon.png');
    if (!app.isPackaged && isMac && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
    const requested = config.pendingOpen || pathArg(process.argv);
    delete config.pendingOpen;
    // The folders open last time, each in its window again (the last one used in front).
    const again = (Array.isArray(config.open) && config.open.length ? config.open : config.workspace ? [config.workspace] : [])
      .filter((d, i, a) => typeof d === 'string' && a.indexOf(d) === i && fs.existsSync(d));
    const front = config.workspace;
    for (const d of [...again.filter((x) => x !== front), ...again.filter((x) => x === front)]) await openWorkspace(d, { newWindow: true });
    // A note or folder opened from Finder goes into its window.
    if (requested && (await openPath(requested))) return;
    if (!anyInfo()) { createWindow(); await firstRun(); }
  });

  // The Dock icon with no window: the last folder again.
  app.on('activate', async () => { if (!views.size && app.isReady()) { if (!(config.workspace && (await openWorkspace(config.workspace, { newWindow: true })))) { createWindow(); firstRun(); } } });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  // The server stops only once the quit is certain: a window with unsaved
  // notes may still cancel it, and then it must go on working.
  // Quitting: the windows close, but the folders they show open again next time.
  app.on('before-quit', () => { config.open = [...views].map((v) => v.root).filter(Boolean); saveConfig(); closingAll = true; });
  app.on('will-quit', () => {
    quitting = true;
    for (const v of views) stopServer(v);
    globalShortcut.unregisterAll();
    if (restartPending) app.relaunch();
  });
}
