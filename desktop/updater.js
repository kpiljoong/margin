'use strict';
// In-app code updates: check GitHub Releases for a newer code package,
// download it and hand it to the launcher (boot.js) to verify and install.
// Nothing is contacted unless the user turns on automatic checks or clicks
// "Check for Updates". Only the version question leaves the machine.

const { net } = require('electron');
const { EventEmitter } = require('events');

const FEED = process.env.MARGIN_UPDATE_URL || 'https://github.com/kpiljoong/margin/releases/latest/download';
const DOWNLOAD_PAGE = 'https://github.com/kpiljoong/margin/releases/latest';
const DAY = 24 * 60 * 60 * 1000;

const boot = global.marginBoot || null;

// The feed must be https, except a local server for testing.
function feedUrl(name) {
  const u = new URL(`${FEED.replace(/\/$/, '')}/${name}`);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error(`Refusing update feed ${u.origin}`);
  return u.toString();
}

async function download(name, maxBytes) {
  const res = await net.fetch(feedUrl(name), { cache: 'no-store', redirect: 'follow' });
  if (res.status === 404) { const e = new Error('No code update has been published yet'); e.notFound = true; throw e; }
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${name}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error(`${name} is too large`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`${name} is too large`);
  return buf;
}

const cmp = (a, b) => boot.compareVersions(a, b);

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: 'idle' };
    this.offer = null; // { manifestBytes, sig, manifest }
    this.timer = null;
  }

  get supported() { return !!(boot && boot.enabled); }

  versions() {
    return {
      version: boot ? boot.activeVersion : null,
      appVersion: boot ? boot.bundledVersion : null,
      source: boot ? boot.source : 'bundle',
      shell: boot ? boot.shell : null,
    };
  }

  set(state) {
    this.state = { ...state, checkedAt: state.checkedAt || this.state.checkedAt };
    this.emit('state', this.state);
  }

  async check({ auto = false } = {}) {
    if (!this.supported) { this.set({ status: 'unsupported', message: 'Updates are available in the installed app only.' }); return this.state; }
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    if (this.state.status === 'ready') return this.state;
    this.set({ status: 'checking' });
    try {
      const [manifestBytes, sigBytes] = await Promise.all([download('margin-code.json', 2 * 1024 * 1024), download('margin-code.sig', 4096)]);
      const sig = sigBytes.toString('utf8');
      const manifest = boot.verifyManifest(manifestBytes, sig);
      const checkedAt = new Date().toISOString();
      const releaseUrl = /^https:\/\/github\.com\/kpiljoong\/margin\/releases\//.test(manifest.releaseUrl || '') ? manifest.releaseUrl : DOWNLOAD_PAGE;
      if (cmp(manifest.version, boot.activeVersion) <= 0) {
        this.offer = null;
        this.set({ status: 'up-to-date', latest: manifest.version, checkedAt });
      } else if (manifest.minShell > boot.shell) {
        this.offer = null;
        this.set({ status: 'needs-app', latest: manifest.version, releaseUrl, checkedAt });
      } else {
        this.offer = { manifestBytes, sig, manifest };
        // A version that was set aside is offered again only on request.
        const setAside = boot.setAsideReason(manifest.version);
        this.set({ status: 'available', latest: manifest.version, size: manifest.pack?.size || 0, releaseUrl, checkedAt, setAside, auto });
      }
    } catch (e) {
      this.set(e.notFound ? { status: 'up-to-date', checkedAt: new Date().toISOString(), message: e.message } : { status: 'error', message: e.message });
    }
    return this.state;
  }

  async install() {
    if (!this.offer || this.state.status !== 'available') return this.state;
    const { manifestBytes, sig, manifest } = this.offer;
    this.set({ ...this.state, status: 'downloading' });
    try {
      const packGz = await download('margin-code.pack.gz', Math.max(1, manifest.pack?.size || 0) + 1024);
      boot.install(manifestBytes, sig, packGz);
      this.offer = null;
      this.set({ ...this.state, status: 'ready' });
    } catch (e) {
      this.set({ ...this.state, status: 'error', phase: 'install', message: e.message });
    }
    return this.state;
  }

  // Automatic checks: shortly after launch, then once a day.
  schedule(enabled) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!enabled || !this.supported) return;
    const run = () => { this.check({ auto: true }).finally(() => { this.timer = setTimeout(run, DAY); }); };
    this.timer = setTimeout(run, Number(process.env.MARGIN_UPDATE_DELAY_MS) || 15000);
  }
}

module.exports = { Updater, DOWNLOAD_PAGE };
