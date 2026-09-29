'use strict';
(async () => {
  const api = window.marginUpdate;
  const $ = (id) => document.getElementById(id);
  const statusBox = $('status');
  const msg = statusBox.querySelector('.msg');
  const action = $('action');
  let info = await api.get();

  const mb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const when = (iso) => (iso ? `Last checked ${new Date(iso).toLocaleString()}` : '');
  const setMsg = (text, small = '') => { msg.replaceChildren(text); if (small) msg.append(Object.assign(document.createElement('small'), { textContent: small })); };
  const setAction = (label, fn, primary = false) => {
    action.hidden = !label;
    action.textContent = label || '';
    action.className = primary ? 'primary' : '';
    action.disabled = false;
    action.onclick = fn || null;
  };

  function render() {
    const v = info.versions;
    $('version').textContent = !v.version ? 'Updates are available in the installed app only.'
      : v.source === 'update' ? `Margin ${v.version} (app ${v.appVersion} with a code update)` : `Margin ${v.version}`;
    const rb = info.rolledBack;
    $('notice').hidden = !rb;
    if (rb) $('notice').textContent = `The update to ${rb.version} was set aside because ${rb.reason}. Margin is running ${v.version}.`;
    $('auto').checked = !!info.auto;
    $('auto').disabled = !info.supported;

    const s = info.state;
    statusBox.className = s.status;
    const check = () => api.check();
    switch (s.status) {
      case 'checking': setMsg('Checking for updates…'); setAction('Check Now'); action.disabled = true; break;
      case 'up-to-date': setMsg('Margin is up to date.', [s.latest ? `Latest: ${s.latest}` : s.message, when(s.checkedAt)].filter(Boolean).join(' · ')); setAction('Check Now', check); break;
      case 'available':
        if (s.auto && s.setAside) { setMsg('Margin is up to date.', `${s.latest} was set aside earlier: ${s.setAside}`); setAction('Check Now', check); break; }
        setMsg(`Margin ${s.latest} is available.`, s.setAside ? `Set aside earlier because ${s.setAside}. Installing downloads it again.` : `${mb(s.size)} download · takes effect after a restart`);
        setAction('Install Update', () => api.install(), true);
        break;
      case 'downloading': setMsg(`Downloading Margin ${s.latest}…`); setAction('Install Update'); action.disabled = true; break;
      case 'ready': setMsg(`Margin ${s.latest} is installed.`, 'Restart to start using it. Unsaved notes will ask first.'); setAction('Restart Now', () => api.restart(), true); break;
      case 'needs-app': setMsg(`Margin ${s.latest} needs a new app download.`, 'This version changes the app itself, so it can’t be installed in place.'); setAction('Open Download Page', () => api.openDownload(), true); break;
      case 'error': setMsg(s.phase === 'install' ? 'Could not install the update.' : 'Could not check for updates.', s.message || ''); setAction('Try Again', check); break;
      case 'unsupported': setMsg(s.message || 'Updates are unavailable.'); setAction(null); break;
      default: setMsg('Updates are checked only when you ask, or daily if turned on below.', when(s.checkedAt)); setAction('Check Now', check);
    }
  }

  api.onState((state) => { info = { ...info, state }; render(); });
  $('auto').addEventListener('change', async (e) => { info = await api.setAuto(e.target.checked); render(); });
  $('close').addEventListener('click', () => api.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
  render();
})();
