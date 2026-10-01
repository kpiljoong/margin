// Where the app keeps its small settings (theme, layout, open tabs, recent
// notes…), with the localStorage calls the rest of the app uses.
//
// In the desktop app they live in the app's own config (desktop/main.js):
// browser storage belongs to the page's port, and when 4321 is taken (another
// running copy of the app) the page gets the next one — and would start with
// default settings. The first time, what is in browser storage is copied over.
// In a browser it is just localStorage.
const desktop = typeof window !== 'undefined' ? window.agentNotesDesktop : null;

function browserStore() {
  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  return {
    getItem: (k) => { try { return ls ? ls.getItem(k) : null; } catch { return null; } },
    setItem: (k, v) => { try { ls?.setItem(k, String(v)); } catch { /* full, or private mode */ } },
    removeItem: (k) => { try { ls?.removeItem(k); } catch { /* private mode */ } },
  };
}

function desktopStore() {
  let mem = null;
  try { mem = desktop.pageStore(); } catch { return null; }
  if (!mem) {
    // First run with this: bring over what this port's storage has.
    mem = {};
    const ls = browserStore();
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('an.')) mem[k] = ls.getItem(k); } } catch { /* none */ }
    desktop.pageStoreSet({ ...mem });
  }
  // Writes are sent together, once per task.
  let out = null;
  const send = (k, v) => {
    if (!out) { out = {}; queueMicrotask(() => { const o = out; out = null; desktop.pageStoreSet(o); }); }
    out[k] = v;
  };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { v = String(v); if (mem[k] === v) return; mem[k] = v; send(k, v); },
    removeItem: (k) => { if (!(k in mem)) return; delete mem[k]; send(k, null); },
  };
}

export const store = (desktop?.pageStore && desktopStore()) || browserStore();
