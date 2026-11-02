import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { harness } from './helpers.mjs';
import { snapshot } from '../src/config.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver })) {
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
await mkdir(new URL('../.cache', import.meta.url), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('../client/App.tsx', import.meta.url))], outfile: fileURLToPath(new URL('../.cache/ui.cjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] });
await build({ entryPoints: [fileURLToPath(new URL('../client/locales.ts', import.meta.url))], outfile: fileURLToPath(new URL('../.cache/locales.cjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs' });
const require = createRequire(import.meta.url);
const { App } = require('../.cache/ui.cjs');
const { zh, en } = require('../.cache/locales.cjs');
after(() => { cleanup(); dom.window.close(); });

function form(value) {
  let state = { status: 'ready', value, base: {}, user: {}, revision: 1, writable: true };
  const listeners = new Set(); const mutations = [];
  return {
    mutations, refuse: false,
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops, revision) {
      mutations.push({ ops, revision });
      if (this.refuse || revision !== state.revision) return false;
      const value = { ...state.value };
      for (const operation of ops) { if (operation.op === 'set') value[operation.path[0]] = operation.value; else delete value[operation.path[0]]; }
      state = { ...state, value, revision: state.revision + 1 };
      for (const listener of listeners) listener();
      return true;
    }
  };
}

async function fixture(t, language = 'zh') {
  const { runtime } = harness({ keys: {} }); t.after(() => runtime.dispose());
  let status = await runtime.status();
  const calls = [];
  const api = async (method, payload = {}, signal) => {
    calls.push({ method, payload, signal });
    if (method === 'save-key') status = { ...status, providers: status.providers.map(provider => provider.id === payload.provider ? { ...provider, configured: true, source: 'store' } : provider) };
    if (method === 'delete-key') status = { ...status, providers: status.providers.map(provider => provider.id === payload.provider ? { ...provider, configured: false } : provider) };
    if (method === 'test') return { probe: { ok: true, kind: payload.provider === 'tavily' ? 'authentication' : 'search', latencyMs: 25 }, provider: status.providers.find(provider => provider.id === payload.provider) };
    if (method === 'usage') return status.providers.find(provider => provider.id === payload.provider);
    return structuredClone(status);
  };
  const settings = form(snapshot(runtime.config));
  const dictionary = language === 'zh' ? zh : en;
  const view = render(React.createElement(App, { form: settings, api, t: key => dictionary[key] }));
  t.after(() => cleanup());
  await waitFor(() => assert.ok(view.getByRole('heading', { name: dictionary.control })));
  return { view, settings, calls, api, dictionary };
}

test('native settings page renders all providers without exposing stored keys and supports both languages', async t => {
  for (const language of ['zh', 'en']) {
    const { view, dictionary } = await fixture(t, language);
    for (const name of ['Tavily', 'Exa', 'Brave']) assert.ok(view.getByLabelText(`${name} API Key`));
    assert.equal(view.getByRole('button', { name: dictionary.save }).disabled, true);
    assert.equal(view.getAllByRole('button', { name: dictionary.testSearch }).length, 2);
    view.unmount();
  }
});

test('provider key is saved only on its explicit save button and the input is cleared afterward', async t => {
  const { view, calls, settings } = await fixture(t);
  const input = view.getByLabelText('Exa API Key');
  fireEvent.change(input, { target: { value: 'test-secret-from-user' } });
  assert.equal(calls.filter(call => call.method === 'save-key').length, 0);
  const card = input.closest('article');
  fireEvent.click([...card.querySelectorAll('button')].find(button => button.textContent === zh.saveKey));
  await waitFor(() => assert.equal(input.value, ''));
  const saved = calls.find(call => call.method === 'save-key');
  assert.equal(saved.payload.provider, 'exa'); assert.equal(saved.payload.value, 'test-secret-from-user');
  assert.equal(settings.mutations.length, 0);
  assert.ok(!view.container.textContent.includes('test-secret-from-user'));
});

test('routing and budgets are staged together and persist with the original revision fence', async t => {
  const { view, settings } = await fixture(t);
  fireEvent.click(view.getByRole('button', { name: /多家混合/ }));
  const requestInput = view.getByLabelText(zh.turnRequests);
  fireEvent.change(requestInput, { target: { value: '3' } });
  assert.equal(settings.mutations.length, 0);
  fireEvent.click(view.getByRole('button', { name: zh.save }));
  await waitFor(() => assert.equal(settings.mutations.length, 1));
  assert.equal(settings.mutations[0].revision, 1);
  assert.deepEqual(settings.mutations[0].ops.map(op => [op.path[0], op.value]), [['routing', 'blend'], ['turnMaxRequests', 3]]);
});

test('invalid budgets block saves; a conflict preserves the user draft', async t => {
  const { view, settings } = await fixture(t);
  const input = view.getByLabelText(zh.turnRequests);
  fireEvent.change(input, { target: { value: '-1' } });
  assert.equal(view.getByRole('button', { name: zh.save }).disabled, true);
  fireEvent.change(input, { target: { value: '3' } }); settings.refuse = true;
  fireEvent.click(view.getByRole('button', { name: zh.save }));
  await waitFor(() => assert.ok(view.getByRole('alert').textContent.includes(zh.conflict)));
  assert.equal(input.value, '3');
});

test('draft-key tests are explicit and never save a credential', async t => {
  const { view, calls } = await fixture(t);
  const input = view.getByLabelText('Brave API Key'); fireEvent.change(input, { target: { value: 'unsaved-test-key' } });
  const card = input.closest('article');
  fireEvent.click([...card.querySelectorAll('button')].find(button => button.textContent === zh.testSearch));
  await waitFor(() => assert.ok(card.textContent.includes(zh.testSearchOk)));
  assert.equal(calls.find(call => call.method === 'test').payload.value, 'unsaved-test-key');
  assert.equal(calls.filter(call => call.method === 'save-key').length, 0);
  assert.equal(input.value, 'unsaved-test-key');
});

test('mount cleanup aborts a pending status request', async t => {
  const { runtime } = harness({ keys: {} }); t.after(() => runtime.dispose());
  let signal;
  const view = render(React.createElement(App, { form: form(snapshot(runtime.config)), t: key => zh[key], api: (_method, _payload, cancellation) => {
    signal = cancellation; return new Promise((_resolve, reject) => cancellation.addEventListener('abort', () => reject({ code: 'WEB_ABORTED' }), { once: true }));
  } }));
  await waitFor(() => assert.ok(signal)); view.unmount();
  assert.equal(signal.aborted, true);
});

test('translation dictionaries keep identical keys', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});
