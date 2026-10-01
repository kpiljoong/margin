// node --test (npm test): public/store.js — in the desktop app the page's
// settings live in the app's config (via the preload bridge), not in browser
// storage that belongs to one port.
import test from 'node:test';
import assert from 'node:assert/strict';

function fakeLocalStorage(init) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

async function load({ saved, local }) {
  const sent = [];
  const ls = fakeLocalStorage(local);
  globalThis.localStorage = ls;
  globalThis.window = { localStorage: ls, agentNotesDesktop: saved === undefined ? undefined : { pageStore: () => saved, pageStoreSet: (o) => sent.push(o) } };
  const { store } = await import(`../public/store.js?${Math.random()}`);
  return { store, sent, ls };
}

test('the first time, the settings in browser storage are carried over to the app', async () => {
  const { store, sent } = await load({ saved: null, local: { 'an.settings': '{"theme":"nord"}', 'an.view': 'files', other: 'x' } });
  assert.equal(store.getItem('an.settings'), '{"theme":"nord"}');
  assert.deepEqual(sent, [{ 'an.settings': '{"theme":"nord"}', 'an.view': 'files' }]);
});

test('after that the app config is what counts, whatever the port storage has', async () => {
  const { store, sent, ls } = await load({ saved: { 'an.view': 'git' }, local: { 'an.view': 'files' } });
  assert.equal(store.getItem('an.view'), 'git');
  assert.equal(store.getItem('an.missing'), null);
  store.setItem('an.view', 'search');
  store.setItem('an.mode', 'split');
  store.setItem('an.mode', 'split'); // unchanged: not sent again
  store.removeItem('an.view');
  await Promise.resolve();
  assert.deepEqual(sent, [{ 'an.view': null, 'an.mode': 'split' }], 'one message per task');
  assert.equal(ls.getItem('an.view'), 'files', 'browser storage is left alone');
});

test('in a browser it is localStorage', async () => {
  const { store, ls } = await load({ saved: undefined, local: {} });
  store.setItem('an.view', 'files');
  assert.equal(ls.getItem('an.view'), 'files');
});
