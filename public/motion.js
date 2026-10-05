// Small motions that say where you are: a highlight that slides to what is
// selected (the tab, the view, the note in the tree) instead of jumping, and
// a note coming in. CSS does the moving (app.css "motion"); reduced motion
// turns the transitions off, and then the highlight is simply there.

// The highlight of host (a pill behind its selected child): from where it
// was to where `target` is. host may have been rebuilt since (its children
// replaced): the last place is kept on host (or on memo, when host itself is
// made anew each time), so the pill starts from there.
export function glide(host, target, cls, memo = host) {
  if (!host) return;
  let pill = host.querySelector(`:scope > .${cls}`);
  const fresh = !pill;
  if (fresh) {
    pill = document.createElement('div');
    pill.className = `glide ${cls}`;
    pill.setAttribute('aria-hidden', 'true');
    host.prepend(pill);
  }
  host.classList.add('glides');
  if (!target || !target.offsetParent) { pill.classList.add('off'); memo.glideAt = null; return; }
  const at = place(host, target);
  const put = (p) => {
    pill.style.transform = `translate(${p.x}px, ${p.y}px)`;
    pill.style.width = `${p.w}px`;
    pill.style.height = `${p.h}px`;
  };
  const was = memo.glideAt;
  memo.glideAt = at;
  if (fresh || pill.classList.contains('off')) {
    // Where it was (or, the first time, already there), without moving…
    pill.classList.add('still');
    put(was || at);
    pill.classList.remove('off');
    void pill.offsetWidth;
    pill.classList.remove('still');
  }
  // …then to where it is.
  if (!was || was.x !== at.x || was.y !== at.y || was.w !== at.w || was.h !== at.h || fresh) put(at);
}

// Before host's children are replaced: where its pill is now (mid-way, if it
// is moving), for glide to go on from there.
export function hold(host, cls, memo = host) {
  const pill = host?.querySelector(`:scope > .${cls}`);
  if (pill && !pill.classList.contains('off')) memo.glideAt = place(host, pill);
}
function place(host, el) {
  const hr = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - hr.left + host.scrollLeft - host.clientLeft, y: r.top - hr.top + host.scrollTop - host.clientTop, w: r.width, h: r.height };
}

// What is shown in a place changed (another note in a pane, another view in
// the side bar): it comes in, once. `key` names what is shown now.
export function enter(el, key) {
  if (!el || el.enterKey === key) return;
  const first = el.enterKey === undefined;
  el.enterKey = key;
  if (first) return; // not as the app starts
  el.classList.remove('entering');
  void el.offsetWidth;
  el.classList.add('entering');
  clearTimeout(el.enterTimer);
  el.enterTimer = setTimeout(() => el.classList.remove('entering'), 700);
}
