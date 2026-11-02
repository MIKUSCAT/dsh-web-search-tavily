import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, turn, deferred, json, tavilyResult } from './helpers.mjs';

test('concurrent fan-out cannot overspend a shared turn request budget', async t => {
  const { runtime, requests } = harness({ values: { turnMaxRequests: 2, cacheTtlSeconds: 0 } }); t.after(() => runtime.dispose());
  const results = await turn('s:1', () => Promise.all(Array.from({ length: 8 }, (_, index) => runtime.search({ query: `query ${index}` }))));
  assert.equal(requests.length, 2);
  assert.equal(results.filter(result => result.sources.length).length, 2);
  assert.equal(results.filter(result => /budget/.test(result.content)).length, 6);
  assert.equal((await runtime.status()).turns[0].requests, 2);
});

test('Tavily credit budget is independent of request count and shared across tools', async t => {
  const { runtime, requests } = harness({ values: { searchDepth: 'advanced', turnMaxTavilyCredits: 3, turnMaxRequests: 10 } }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'first' }));
  const result = await turn('s:1', () => runtime.search({ query: 'second' }, undefined, { onlyProvider: 'tavily' }));
  assert.equal(requests.length, 1); assert.match(result.content, /budget/);
  await turn('s:2', () => runtime.search({ query: 'new turn' })); assert.equal(requests.length, 2);
});

test('daily budgets span turns and providers', async t => {
  const { runtime, requests } = harness({ values: { dailyMaxRequests: 2, routing: 'blend' }, keys: { tavily: 't', exa: 'e' } }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'first' }));
  const result = await turn('s:2', () => runtime.search({ query: 'second' }));
  assert.equal(requests.length, 2); assert.match(result.content, /daily search limit/);
});

test('local monthly caps stop requests after restart and persist no keys, queries or sources', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-hybrid-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'usage.json');
  const first = harness({ file, values: { tavilyMonthlyLimit: 1 } });
  await turn('s:1', () => first.runtime.search({ query: 'private query that must not be saved' }));
  await first.runtime.dispose();
  const source = await readFile(file, 'utf8');
  assert.doesNotMatch(source, /test-tavily-key|private query|example.com|snippet/);
  const second = harness({ file, values: { tavilyMonthlyLimit: 1 } }); t.after(() => second.runtime.dispose());
  const result = await turn('s:2', () => second.runtime.search({ query: 'next query' }));
  assert.match(result.content, /monthly limit/); assert.equal(second.requests.length, 0);
  assert.equal((await second.runtime.status()).providers[0].local.requests, 1);
});

test('new day/month replenishes only the corresponding local period', async t => {
  let now = Date.UTC(2026, 9, 31, 12);
  const { runtime, requests } = harness({ values: { tavilyMonthlyLimit: 1, dailyMaxRequests: 1 }, now: () => now }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'old month' }));
  now = Date.UTC(2026, 10, 1, 12);
  await turn('s:2', () => runtime.search({ query: 'new month' }));
  assert.equal(requests.length, 2); assert.equal((await runtime.status()).providers[0].local.requests, 1);
});

test('separate plugin instances sharing a usage file cannot race past the daily cap', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-hybrid-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'usage.json');
  const first = harness({ file, values: { dailyMaxRequests: 1 } });
  const second = harness({ file, values: { dailyMaxRequests: 1 } });
  t.after(() => Promise.all([first.runtime.dispose(), second.runtime.dispose()]));
  const results = await Promise.all([turn('first:1', () => first.runtime.search({ query: 'first' })), turn('second:1', () => second.runtime.search({ query: 'second' }))]);
  assert.equal(first.requests.length + second.requests.length, 1);
  assert.equal(results.filter(result => result.sources.length > 0).length, 1);
});

test('a failing usage store blocks search before any provider call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-hybrid-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { runtime, requests } = harness({ file: directory });
  await assert.rejects(runtime.search({ query: 'x' }), { code: 'WEB_USAGE_STORAGE_ERROR' });
  assert.equal(requests.length, 0);
  await assert.rejects(runtime.dispose(), { code: 'WEB_USAGE_STORAGE_ERROR' });
});

test('one blend provider hitting budget does not discard already-paid successful results', async t => {
  const { runtime, requests } = harness({ values: { turnMaxRequests: 1, routing: 'blend' }, keys: { tavily: 't', exa: 'e' } }); t.after(() => runtime.dispose());
  const result = await turn('s:1', () => runtime.search({ query: 'x' }));
  assert.equal(requests.length, 1); assert.equal(result.sources.length, 1); assert.match(result.content, /budget/);
});

test('all duplicate waiters cancelling aborts owned work and waits for ledger settlement', async t => {
  const entered = deferred(); let aborted = false;
  const { runtime } = harness({ fetcher: (_url, init) => new Promise((_resolve, reject) => {
    entered.resolve(); init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  }) }); t.after(() => runtime.dispose());
  const a = new AbortController(), b = new AbortController();
  const first = turn('s:1', () => runtime.search({ query: 'x' }, a.signal));
  const second = turn('s:1', () => runtime.search({ query: 'x' }, b.signal));
  await entered.promise; a.abort(); b.abort();
  await Promise.all([assert.rejects(first, { code: 'WEB_ABORTED' }), assert.rejects(second, { code: 'WEB_ABORTED' })]);
  assert.equal(aborted, true); assert.equal(runtime.background.size, 0);
  const status = await runtime.status(); assert.equal(status.providers[0].local.errors, 1);
});

test('cancelled Brave requests still waiting for a rate-limit slot are refunded before send', async t => {
  const entered = deferred();
  const { runtime, requests } = harness({ values: { braveMinIntervalMs: 1000 }, keys: { brave: 'b' } }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'first' }));
  const abort = new AbortController();
  const promise = turn('s:2', () => runtime.search({ query: 'second' }, abort.signal));
  await new Promise(resolve => setTimeout(resolve, 15)); abort.abort();
  await assert.rejects(promise, { code: 'WEB_ABORTED' });
  assert.equal(requests.length, 1); assert.equal((await runtime.status()).providers[2].local.requests, 1);
});

test('HTTP rejections refund Tavily credits while transport uncertainty stays conservatively counted', async t => {
  const denied = harness({ fetcher: () => json({}, 401) }); t.after(() => denied.runtime.dispose());
  await assert.rejects(denied.runtime.search({ query: 'a' }));
  assert.equal((await denied.runtime.status()).providers[0].local.tavilyCredits, 0);
  const uncertain = harness({ fetcher: async () => { throw new Error('network dropped'); } }); t.after(() => uncertain.runtime.dispose());
  await assert.rejects(uncertain.runtime.search({ query: 'a' }));
  const local = (await uncertain.runtime.status()).providers[0].local;
  assert.equal(local.tavilyCredits, 1); assert.equal(local.uncertain, 1); assert.equal(local.confirmedCredits, 0);
});
