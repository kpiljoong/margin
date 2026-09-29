'use strict';
// Margin launcher — the app's entry point. This file and codepack.js stay
// fixed inside the app bundle; code updates never replace them.
//
// On every launch it picks the app code to run: the newest installed code
// update (userData/app-<version>/) that is newer than the code in the bundle,
// still verifies against the public key below, fits this shell (minShell) and
// has not failed to start twice. Otherwise it runs the bundled code.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const codepack = require('./codepack');

const BUNDLE_ROOT = path.join(__dirname, '..');
const bundled = require('../package.json');
// Bump "marginShell" in package.json whenever a change needs a new app
// download: a new Electron, or a change to boot.js / codepack.js.
const SHELL = Number.isInteger(bundled.marginShell) ? bundled.marginShell : 1;
const MAX_ATTEMPTS = 2;
// Ed25519 key that signs code packages (private half: MARGIN_UPDATE_KEY in CI).
// build/code-package.js refuses to sign with a key that doesn't pair with it.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAwdwnXUYs+/pGbpDSHwEfpsn3pIqocPWmylrWEBmaJSo=
-----END PUBLIC KEY-----
`;

// Same rule as main.js, applied before anything reads the user data folder.
if (process.env.AGENT_NOTES_USER_DATA) app.setPath('userData', path.resolve(process.env.AGENT_NOTES_USER_DATA));

// Development runs (`npm start`) use the working tree unless asked otherwise.
const enabled = app.isPackaged || process.env.MARGIN_CODE_UPDATES === '1';
const userData = app.getPath('userData');
const statePath = path.join(userData, 'code-state.json');
const dirFor = (v) => path.join(userData, `app-${v}`);
const log = (...a) => console.error('[margin boot]', ...a);

function readState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(statePath, 'utf8')) || {}; } catch { /* none yet */ }
  const version = (v) => (codepack.parseVersion(v) ? v : null);
  return {
    current: version(s.current),
    previous: version(s.previous),
    attempts: s.attempts && typeof s.attempts === 'object' ? s.attempts : {},
    bad: s.bad && typeof s.bad === 'object' ? s.bad : {},
    rolledBack: s.rolledBack || null,
  };
}

function saveState() {
  try {
    fs.mkdirSync(userData, { recursive: true });
    const tmp = `${statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, statePath);
  } catch (e) { log('could not save state:', e.message); }
}

function markBad(v, reason) {
  log(`setting aside code ${v}: ${reason}`);
  state.bad[v] = reason;
  delete state.attempts[v];
  if (v === state.current) state.rolledBack = { version: v, reason, at: new Date().toISOString() };
}

const state = readState();
let chosen = null;

if (enabled) {
  for (const v of [...new Set([state.current, state.previous])]) {
    if (!v || state.bad[v]) continue;
    // Never run code older than (or equal to) what the bundle already has:
    // installing a newer app makes older code updates obsolete.
    if (codepack.compareVersions(v, bundled.version) <= 0) continue;
    const tries = state.attempts[v] || 0;
    if (tries >= MAX_ATTEMPTS) { markBad(v, 'it did not start successfully twice'); continue; }
    let manifest;
    try { manifest = codepack.verifyDir(dirFor(v), PUBLIC_KEY); } catch (e) { markBad(v, `verification failed: ${e.message}`); continue; }
    if (manifest.version !== v) { markBad(v, `folder holds version ${manifest.version}`); continue; }
    if (manifest.minShell > SHELL) continue;
    state.attempts[v] = tries + 1; // cleared by markHealthy() once the UI is up
    chosen = { version: v, dir: dirFor(v), manifest };
    break;
  }
  saveState();
}

const activeVersion = chosen ? chosen.version : bundled.version;

// Remove package folders that can never run again.
function cleanUp() {
  const keep = new Set([state.current, state.previous].filter((v) => v && !state.bad[v] && codepack.compareVersions(v, bundled.version) > 0));
  let entries = [];
  try { entries = fs.readdirSync(userData); } catch { return; }
  for (const name of entries) {
    const m = /^app-(.+?)(\.partial-\d+)?$/.exec(name);
    if (!m || (keep.has(m[1]) && !m[2]) || (chosen && name === path.basename(chosen.dir))) continue;
    try { fs.rmSync(path.join(userData, name), { recursive: true, force: true }); } catch { /* try again next time */ }
  }
}

global.marginBoot = Object.freeze({
  enabled,
  shell: SHELL,
  bundledVersion: bundled.version,
  activeVersion,
  source: chosen ? 'update' : 'bundle',
  codeDir: chosen ? chosen.dir : BUNDLE_ROOT,
  compareVersions: codepack.compareVersions,

  // Called by the app once its window is usable.
  markHealthy() {
    if (!enabled) return;
    if (chosen) delete state.attempts[chosen.version];
    saveState();
    cleanUp();
  },

  // An update that was set aside since the user last saw the notice.
  rolledBack() { return state.rolledBack ? { ...state.rolledBack } : null; },
  // Why a version was set aside, if it was.
  setAsideReason(v) { return state.bad[v] || null; },
  clearRollbackNotice() { state.rolledBack = null; saveState(); },

  // Throws unless the bytes are a manifest signed with our key.
  verifyManifest(bytes, sig) { return codepack.verifyManifest(bytes, sig, PUBLIC_KEY); },

  // Install a downloaded package; it runs from the next launch on.
  install(manifestBytes, sig, packGz) {
    if (!enabled) throw new Error('Code updates are off in development runs');
    const m = codepack.verifyManifest(manifestBytes, sig, PUBLIC_KEY);
    // A version that was set aside may be downloaded again.
    const newest = [activeVersion, bundled.version, state.bad[state.current] ? null : state.current].filter(Boolean)
      .reduce((a, b) => (codepack.compareVersions(a, b) >= 0 ? a : b));
    if (codepack.compareVersions(m.version, newest) <= 0) throw new Error(`Margin ${m.version} is not newer than ${newest}`);
    if (m.minShell > SHELL) throw new Error(`Margin ${m.version} needs a new app download`);
    if (!m.pack || packGz.length !== m.pack.size || codepack.sha256(packGz) !== m.pack.sha256) throw new Error('Downloaded package does not match its manifest');

    const dest = dirFor(m.version);
    const tmp = `${dest}.partial-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      codepack.unpack(packGz, tmp);
      fs.writeFileSync(path.join(tmp, codepack.MANIFEST), manifestBytes);
      fs.writeFileSync(path.join(tmp, codepack.SIGNATURE), String(sig).trim());
      codepack.verifyDir(tmp, PUBLIC_KEY);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
    // Keep the code that is running now as the fallback.
    state.previous = chosen ? chosen.version : null;
    state.current = m.version;
    delete state.bad[m.version];
    delete state.attempts[m.version];
    saveState();
    return { version: m.version };
  },
});

if (chosen) log(`running code ${chosen.version} (app ${bundled.version})`);

try {
  require(path.join(chosen ? chosen.dir : BUNDLE_ROOT, 'desktop', 'main.js'));
} catch (e) {
  if (!chosen) throw e;
  // The update broke before it could start: set it aside and start over.
  log(`code ${chosen.version} failed to load:`, e);
  markBad(chosen.version, `it failed to load: ${e.message}`);
  saveState();
  app.relaunch();
  app.exit(0);
}
