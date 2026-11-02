import assert from 'node:assert/strict';
import { Config } from '../src/config.mjs';
import { HybridSearchRuntime, searchContext } from '../src/runtime.mjs';

export function config(value = {}) {
  const result = Config['~standard'].validate(value);
  assert.equal(result.issues, undefined, JSON.stringify(result.issues));
  return result.value;
}
export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
export const tavilyResult = (url = 'https://example.com/tavily') => ({ results: [{ url, title: 'Tavily title', content: 'A source snippet' }], usage: { credits: 1 } });
export const exaResult = (url = 'https://example.com/exa') => ({ results: [{ url, title: 'Exa title', highlights: ['An Exa highlight'], publishedDate: '2026-10-01T00:00:00Z' }], costDollars: { total: .004 } });
export const braveResult = (url = 'https://example.com/brave') => ({ web: { results: [{ url, title: 'Brave title', description: 'Brave snippet' }] } });
export const usageResult = { key: { usage: 150, limit: null, search_usage: 100 }, account: { current_plan: 'Researcher', plan_usage: 350, plan_limit: 1000, paygo_usage: 0, paygo_limit: 0 } };
export const quotaHeaders = { 'x-ratelimit-policy': '1;w=1, 1000;w=2592000', 'x-ratelimit-limit': '1, 1000', 'x-ratelimit-remaining': '0, 990', 'x-ratelimit-reset': '1, 3600' };
export function harness({ values = {}, keys = { tavily: 'test-tavily-key' }, fetcher, now, file, ledger } = {}) {
  const requests = [];
  const runtime = new HybridSearchRuntime({ config: config({ braveMinIntervalMs: 0, ...values }), now, file, ledger,
    resolveKey: async provider => keys[provider] ? { value: keys[provider], source: 'test-store', reference: `${provider.toUpperCase()}_API_KEY` } : undefined,
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      if (fetcher) return fetcher(url, init);
      if (String(url).includes('/usage')) return json(usageResult);
      if (String(url).includes('exa.ai')) return json(exaResult());
      if (String(url).includes('brave.com')) return json(braveResult(), 200, quotaHeaders);
      const body = JSON.parse(init.body);
      return json({ ...tavilyResult(), usage: { credits: body.search_depth === 'advanced' ? 2 : 1 } });
    }
  });
  return { runtime, requests, keys };
}
export function turn(key, operation) { return searchContext.run({ turnKey: key, sessionId: key.split(':')[0], turn: Number(key.split(':')[1]) || 1 }, operation); }
export function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
