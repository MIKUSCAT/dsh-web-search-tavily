import test from 'node:test';
import assert from 'node:assert/strict';
import { searchRequest, normalize, parseBraveQuota, normalizeTavilyUsage } from '../src/providers.mjs';
import { snapshot } from '../src/config.mjs';
import { mergeSources } from '../src/runtime.mjs';
import { config, harness, json, tavilyResult, exaResult, braveResult, usageResult, quotaHeaders, turn, deferred } from './helpers.mjs';

test('Tavily sends explicit cost controls and reports usage without putting a key in JSON or URLs', () => {
  const result = searchRequest('tavily', 'test query', 6, snapshot(config()), 'test-only-secret');
  const body = JSON.parse(result.init.body);
  assert.equal(body.search_depth, 'basic');
  assert.equal(body.auto_parameters, false);
  assert.equal(body.include_usage, true);
  assert.equal(body.chunks_per_source, 1);
  assert.equal(body.max_results, 6);
  assert.equal(result.init.headers.authorization, 'Bearer test-only-secret');
  assert.ok(!result.url.includes('test-only-secret'));
  assert.ok(!result.init.body.includes('test-only-secret'));
});

test('Exa uses the current lite mode and supported domain, news, and publication-date filters', () => {
  const result = searchRequest('exa', 'a question', 3, snapshot(config({ exaSearchType: 'lite', timeRange: 'day', topic: 'news', includeDomains: ['example.org'] })), 'exa-test', Date.UTC(2026, 10, 2));
  const body = JSON.parse(result.init.body);
  assert.equal(body.type, 'lite'); assert.equal(body.numResults, 3);
  assert.deepEqual(body.contents, { highlights: true });
  assert.equal(body.startPublishedDate, '2026-11-01T00:00:00.000Z');
  assert.equal(body.category, 'news'); assert.deepEqual(body.includeDomains, ['example.org']);
  assert.equal(result.init.headers['x-api-key'], 'exa-test');
});

test('Brave uses GET, escaped queries, official authentication and correct news/freshness endpoints', () => {
  const result = searchRequest('brave', 'RNA & DNA 中文', 4, snapshot(config({ topic: 'news', timeRange: 'week', includeDomains: ['nature.com'], excludeDomains: ['spam.example'] })), 'brave-test');
  const url = new URL(result.url);
  assert.equal(url.pathname, '/res/v1/news/search');
  assert.equal(url.searchParams.get('freshness'), 'pw');
  assert.equal(url.searchParams.get('q'), 'RNA & DNA 中文 (site:nature.com) -site:spam.example');
  assert.equal(url.searchParams.get('count'), '4');
  assert.equal(result.init.headers['X-Subscription-Token'], 'brave-test');
});

test('all providers normalize genuine sources without fabricated snippets or unsafe URLs', () => {
  const options = snapshot(config());
  for (const [provider, value] of [['tavily', tavilyResult()], ['exa', exaResult()], ['brave', braveResult()]]) {
    const result = normalize(provider, value, 3, options);
    assert.equal(result.sources.length, 1);
    assert.match(result.sources[0].snippet, /snippet|highlight/);
  }
  const result = normalize('tavily', { results: [{ url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com/' }, { url: 'https://example.org/' }] }, 5, options);
  assert.deepEqual(result.sources, [{ url: 'https://example.org/' }]);
  assert.deepEqual(normalize('tavily', { results: [] }, 5, options).sources, []);
  assert.throws(() => normalize('exa', {}, 5, options), { code: 'WEB_INVALID_RESPONSE' });
});

test('merged sources are round-robin fair, URL-deduplicated and bounded', () => {
  const value = mergeSources([
    { sources: [{ url: 'https://example.org/a?utm_source=t#part' }, { url: 'https://example.org/b' }], truncated: false },
    { sources: [{ url: 'https://example.org/a' }, { url: 'https://example.org/c' }], truncated: false }
  ], 2);
  assert.deepEqual(value.sources.map(source => source.url), ['https://example.org/a?utm_source=t#part', 'https://example.org/b']);
  assert.equal(value.truncated, true);
});

test('Tavily usage distinguishes null key limits, account plans and paygo', () => {
  const result = normalizeTavilyUsage(usageResult, 42);
  assert.equal(result.key.limit, null); assert.equal(result.account.current_plan, 'Researcher');
  assert.equal(result.account.plan_usage, 350); assert.equal(result.observedAt, 42);
  assert.throws(() => normalizeTavilyUsage({ key: { usage: 1 }, account: usageResult.account }), { code: 'WEB_INVALID_RESPONSE' });
});

test('Brave quota windows are parsed from policies, including unlimited plans', () => {
  const quota = parseBraveQuota(new Headers(quotaHeaders), 1000);
  assert.deepEqual(quota.windows[1], { seconds: 2592000, limit: 1000, remaining: 990, resetsAt: 3601000 });
  assert.equal(parseBraveQuota(new Headers()), undefined);
  assert.equal(parseBraveQuota(new Headers({ ...quotaHeaders, 'x-ratelimit-limit': '1, 0' })).windows[1].limit, null);
});

test('priority routing skips missing keys and searches exactly one configured provider', async t => {
  const { runtime, requests } = harness({ keys: { exa: 'test-exa' } }); t.after(() => runtime.dispose());
  const result = await turn('session:1', () => runtime.search({ query: 'find this' }));
  assert.equal(requests.length, 1); assert.ok(requests[0].url.includes('exa.ai'));
  assert.equal(result.sources[0].title, 'Exa title');
});

test('manual strength lock and source cap override model arguments', async t => {
  const { runtime, requests } = harness({ values: { maxResults: 2, searchDepth: 'basic', allowModelDepth: false } }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'a', maxResults: 20 }, undefined, { depth: 'advanced' }));
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.search_depth, 'basic'); assert.equal(body.max_results, 2);
});

test('model-controlled depth is honored only when explicitly enabled', async t => {
  const { runtime, requests } = harness({ values: { allowModelDepth: true } }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'a' }, undefined, { depth: 'advanced' }));
  assert.equal(JSON.parse(requests[0].init.body).search_depth, 'advanced');
  assert.equal((await runtime.status()).providers[0].local.tavilyCredits, 2);
});

test('blend fans out only to the selected number of providers and deduplicates their results', async t => {
  const { runtime, requests } = harness({ values: { routing: 'blend', blendCount: 2 }, keys: { tavily: 't', exa: 'e', brave: 'b' } }); t.after(() => runtime.dispose());
  const result = await turn('s:1', () => runtime.search({ query: 'compare' }));
  assert.equal(requests.length, 2);
  assert.deepEqual(result.sources.map(source => source.title), ['Tavily title', 'Exa title']);
  assert.ok(!requests.some(request => request.url.includes('brave')));
});

test('blend preserves usable results and reports a failed provider', async t => {
  const { runtime } = harness({ values: { routing: 'blend' }, keys: { tavily: 't', exa: 'e' }, fetcher: url => String(url).includes('exa') ? json({ error: 'do not echo me' }, 500) : json(tavilyResult()) }); t.after(() => runtime.dispose());
  const result = await turn('s:1', () => runtime.search({ query: 'compare' }));
  assert.equal(result.sources.length, 1); assert.match(result.content, /Exa returned HTTP 500/);
  assert.doesNotMatch(result.content, /echo me/);
});

test('fallback is off by default, with no implicit retries or alternate paid requests', async t => {
  const { runtime, requests } = harness({ keys: { tavily: 't', exa: 'e' }, fetcher: () => json({}, 429) }); t.after(() => runtime.dispose());
  await assert.rejects(turn('s:1', () => runtime.search({ query: 'x' })), { code: 'WEB_RATE_LIMITED' });
  assert.equal(requests.length, 1);
});

test('explicit fallback uses the next provider and counts both outgoing requests', async t => {
  const { runtime, requests } = harness({ values: { fallbackOnError: true }, keys: { tavily: 't', exa: 'e' }, fetcher: url => String(url).includes('tavily') ? json({}, 429) : json(exaResult()) }); t.after(() => runtime.dispose());
  const result = await turn('s:1', () => runtime.search({ query: 'x' }));
  assert.equal(requests.length, 2); assert.equal(result.sources[0].title, 'Exa title');
  assert.equal((await runtime.status()).turns[0].requests, 2);
});

test('legacy direct Tavily calls cannot bypass provider disablement or global pause', async t => {
  const { runtime, requests } = harness({ values: { providers: ['exa'] }, keys: { tavily: 't', exa: 'e' } }); t.after(() => runtime.dispose());
  await assert.rejects(runtime.search({ query: 'x' }, undefined, { onlyProvider: 'tavily' }), { code: 'WEB_PROVIDER_CREDENTIAL_MISSING' });
  const paused = harness({ values: { enabled: false } }); t.after(() => paused.runtime.dispose());
  await assert.rejects(paused.runtime.search({ query: 'x' }), { code: 'WEB_SEARCH_DISABLED' });
  assert.equal(requests.length + paused.requests.length, 0);
});

test('known exhausted account quota is skipped until refresh or expiry', async t => {
  const { runtime, requests } = harness({ keys: { tavily: 't', exa: 'e' }, fetcher: url => String(url).includes('/usage') ? json({ ...usageResult, account: { ...usageResult.account, plan_usage: 1000 } }) : json(exaResult()) }); t.after(() => runtime.dispose());
  await runtime.refreshUsage('tavily');
  await turn('s:1', () => runtime.search({ query: 'x' }));
  assert.ok(requests[1].url.includes('exa'));
});

test('Tavily connection test uses only usage API and consumes no search request', async t => {
  const { runtime, requests } = harness(); t.after(() => runtime.dispose());
  const result = await runtime.probe('tavily');
  assert.equal(result.probe.ok, true); assert.equal(result.probe.kind, 'authentication');
  assert.equal(requests[0].url, 'https://api.tavily.com/usage');
  assert.equal(result.provider.local.requests, 0); assert.equal(result.provider.quota.account.current_plan, 'Researcher');
});

test('Brave and Exa tests issue one real low-cost search and return no source text to settings', async t => {
  for (const provider of ['exa', 'brave']) {
    const { runtime, requests } = harness({ keys: { [provider]: 'test-key' } }); t.after(() => runtime.dispose());
    const result = await runtime.probe(provider);
    assert.equal(result.probe.ok, true); assert.equal(requests.length, 1); assert.equal(result.provider.local.requests, 1);
    assert.ok(!JSON.stringify(result).includes('snippet')); assert.ok(!JSON.stringify(result).includes('test-key'));
    if (provider === 'exa') { assert.equal(JSON.parse(requests[0].init.body).type, 'lite'); assert.equal(result.provider.local.estimatedUsd, .004); }
    else assert.equal(result.provider.quota.windows[1].remaining, 990);
  }
});

test('refreshing Brave/Exa records does not cause another billable search', async t => {
  const { runtime, requests } = harness({ keys: { exa: 'e', brave: 'b' } }); t.after(() => runtime.dispose());
  await runtime.status(); await runtime.refreshUsage('exa'); await runtime.refreshUsage('brave');
  assert.equal(requests.length, 0);
});

test('source caches are credential-specific, expire, and never retain Brave bodies', async t => {
  let now = Date.UTC(2026, 10, 2);
  const { runtime, requests, keys } = harness({ now: () => now }); t.after(() => runtime.dispose());
  await turn('s:1', () => runtime.search({ query: 'x' }));
  await turn('s:2', () => runtime.search({ query: 'x' }));
  assert.equal(requests.length, 1);
  keys.tavily = 'rotated-key'; await turn('s:3', () => runtime.search({ query: 'x' }));
  assert.equal(requests.length, 2);
  now += 121000; await turn('s:4', () => runtime.search({ query: 'x' })); assert.equal(requests.length, 3);
  const brave = harness({ keys: { brave: 'b' } }); t.after(() => brave.runtime.dispose());
  await turn('b:1', () => brave.runtime.search({ query: 'x' })); await turn('b:2', () => brave.runtime.search({ query: 'x' }));
  assert.equal(brave.requests.length, 2); assert.equal(brave.runtime.cache.size, 0);
});

test('concurrent duplicate queries share one request; one caller cancelling does not cancel the other', async t => {
  const gate = deferred(), entered = deferred();
  const { runtime, requests } = harness({ fetcher: async () => { entered.resolve(); await gate.promise; return json(tavilyResult()); } }); t.after(() => runtime.dispose());
  const abort = new AbortController();
  const first = turn('s:1', () => runtime.search({ query: 'x' }, abort.signal));
  const second = turn('s:1', () => runtime.search({ query: 'x' }));
  await entered.promise; abort.abort(); await assert.rejects(first, { code: 'WEB_ABORTED' });
  gate.resolve(); assert.equal((await second).sources.length, 1); assert.equal(requests.length, 1);
});

test('HTTP errors never echo an upstream secret and never follow redirects', async t => {
  const { runtime, requests } = harness({ keys: { tavily: 'PRIVATE-KEY' }, fetcher: () => json({ error: 'PRIVATE-KEY raw headers' }, 401) }); t.after(() => runtime.dispose());
  await assert.rejects(turn('s:1', () => runtime.search({ query: 'x' })), error => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING' && !String(error).includes('PRIVATE-KEY'));
  assert.equal(requests[0].init.redirect, 'error');
  assert.ok(!JSON.stringify(await runtime.status()).includes('PRIVATE-KEY'));
});

test('invalid queries and domains fail before any request is sent', async t => {
  const { runtime, requests } = harness(); t.after(() => runtime.dispose());
  await assert.rejects(runtime.search({ query: ' ' }), { code: 'WEB_INVALID_REQUEST' });
  await assert.rejects(runtime.search({ query: 'x', maxResults: -1 }), { code: 'WEB_INVALID_REQUEST' });
  const malformed = harness({ values: { includeDomains: ['https://example.org/path'] } }); t.after(() => malformed.runtime.dispose());
  await assert.rejects(malformed.runtime.search({ query: 'x' }), { code: 'WEB_INVALID_REQUEST' });
  assert.equal(requests.length + malformed.requests.length, 0);
});

test('pre-cancelled searches send no requests', async t => {
  const { runtime, requests } = harness(); t.after(() => runtime.dispose());
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runtime.search({ query: 'x' }, abort.signal), { code: 'WEB_ABORTED' });
  assert.equal(requests.length, 0);
});

test('response body limits and total request deadlines are enforced', async t => {
  const big = harness({ fetcher: () => json({ results: [], padding: 'x'.repeat(2 * 1024 * 1024) }) }); t.after(() => big.runtime.dispose());
  await assert.rejects(big.runtime.search({ query: 'x' }), { code: 'WEB_RESPONSE_TOO_LARGE' });
  const slow = harness({ values: { timeoutMs: 1000 }, fetcher: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) }); t.after(() => slow.runtime.dispose());
  await assert.rejects(slow.runtime.search({ query: 'x' }), { code: 'WEB_TIMEOUT' });
});
