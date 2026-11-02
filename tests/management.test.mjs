import test from 'node:test';
import assert from 'node:assert/strict';
import { managementHandler, API_PREFIX, searchTool } from '../index.mjs';
import { credentialReference } from '../src/config.mjs';
import { HybridSearchRuntime } from '../src/runtime.mjs';
import { config, harness, json, usageResult, turn } from './helpers.mjs';

const owner = { principal: { kind: 'owner' } };
function management() {
  const store = new Map(), ambient = new Map([['TAVILY_API_KEY', 'old-env-key']]);
  const credentials = {
    async resolve(reference) { return store.has(reference) ? { value: store.get(reference), source: 'store' } : ambient.has(reference) ? { value: ambient.get(reference), source: 'process' } : undefined; },
    async set(reference, value) { store.set(reference, value); },
    async unset(reference) { store.delete(reference); }
  };
  const settings = config();
  const runtime = new HybridSearchRuntime({ config: settings,
    resolveKey: async (provider, options) => credentials.resolve(credentialReference(options, provider)),
    fetcher: async () => json(usageResult)
  });
  return { runtime, store, handler: managementHandler({ credentials }, runtime, settings) };
}

test('saving keys through management writes the winning DSH credential and returns no secret', async t => {
  const { runtime, store, handler } = management(); t.after(() => runtime.dispose());
  const result = await handler(API_PREFIX + 'save-key', { provider: 'tavily', value: 'NEW-SECRET' }, undefined, owner);
  assert.equal(result.ok, true); assert.equal(store.get('TAVILY_API_KEY'), 'NEW-SECRET');
  assert.equal(result.value.providers[0].source, 'store');
  assert.doesNotMatch(JSON.stringify(result), /NEW-SECRET|old-env-key/);
  const removed = await handler(API_PREFIX + 'delete-key', { provider: 'tavily' }, undefined, owner);
  assert.equal(removed.value.providers[0].configured, true); assert.equal(removed.value.providers[0].source, 'process');
});

test('non-owner requests and changed references cannot write credentials', async t => {
  const { runtime, store, handler } = management(); t.after(() => runtime.dispose());
  const forbidden = await handler(API_PREFIX + 'save-key', { provider: 'exa', value: 'SECRET' }, undefined, { principal: { kind: 'guest' } });
  assert.equal(forbidden.error.code, 'FORBIDDEN');
  const conflict = await handler(API_PREFIX + 'save-key', { provider: 'exa', value: 'SECRET', reference: 'OTHER_API_KEY' }, undefined, owner);
  assert.equal(conflict.error.code, 'WEB_CONFIG_CONFLICT'); assert.equal(store.size, 0);
});

test('invalid management data never writes or echoes credentials', async t => {
  const { runtime, store, handler } = management(); t.after(() => runtime.dispose());
  for (const payload of [null, { provider: 'bad', value: 'SECRET' }, { provider: 'exa', value: 'SECRET\nInjected' }]) {
    const result = await handler(API_PREFIX + 'save-key', payload, undefined, owner);
    assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  assert.equal(store.size, 0);
});

test('tool schema retains native web-card presentation and direct Tavily obeys shared budgets', async t => {
  const { runtime, requests } = harness({ values: { turnMaxRequests: 1 } }); t.after(() => runtime.dispose());
  const hybrid = searchTool(runtime), legacy = searchTool(runtime, 'tavily');
  const exec = { signal: new AbortController().signal };
  const value = await turn('s:1', () => hybrid.execute({ query: 'first' }, exec));
  const limited = await turn('s:1', () => legacy.execute({ query: 'second' }, exec));
  assert.equal(requests.length, 1); assert.match(limited.content, /budget/);
  const meta = hybrid.output.presentationMeta({}, value);
  const card = hybrid.presentResult({ query: 'first' }, { meta, isError: false });
  assert.equal(card.card, 'web'); assert.equal(card.kind, 'search'); assert.equal(card.sources[0].title, 'Tavily title');
  assert.match(hybrid.output.render({}, value)[0].text, /external, untrusted/);
});
