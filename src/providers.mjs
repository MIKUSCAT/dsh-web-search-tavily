import { LABELS } from './config.mjs';
import { fail, finite, record, nonempty, safeUrl, fetchJson, filterSources } from './http.mjs';

export const ENDPOINTS = {
  tavily: 'https://api.tavily.com/search',
  exa: 'https://api.exa.ai/search',
  brave: 'https://api.search.brave.com/res/v1/web/search'
};
export const DASHBOARDS = {
  tavily: 'https://app.tavily.com/',
  exa: 'https://dashboard.exa.ai/',
  brave: 'https://api-dashboard.search.brave.com/'
};
const rangeDays = { day: 1, week: 7, month: 30, year: 365 };

export function searchRequest(provider, query, limit, options, apiKey, now = Date.now()) {
  const headers = { accept: 'application/json' };
  if (provider === 'tavily') {
    headers.authorization = `Bearer ${apiKey}`;
    headers['content-type'] = 'application/json';
    const body = {
      query, search_depth: options.searchDepth, topic: options.topic, max_results: limit,
      include_answer: options.includeAnswer, include_raw_content: false, include_images: false,
      auto_parameters: false, include_usage: true
    };
    if (options.timeRange) body.time_range = options.timeRange;
    if (options.includeDomains.length) body.include_domains = options.includeDomains;
    if (options.excludeDomains.length) body.exclude_domains = options.excludeDomains;
    if (options.searchDepth !== 'ultra-fast' && options.chunksPerSource) body.chunks_per_source = options.chunksPerSource;
    return { url: ENDPOINTS.tavily, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  if (provider === 'exa') {
    headers['x-api-key'] = apiKey;
    headers['content-type'] = 'application/json';
    const body = { query, type: options.exaSearchType, numResults: limit, contents: { highlights: true } };
    if (options.topic === 'news') body.category = 'news';
    if (options.timeRange) body.startPublishedDate = new Date(now - rangeDays[options.timeRange] * 86400000).toISOString();
    if (options.includeDomains.length) body.includeDomains = options.includeDomains;
    if (options.excludeDomains.length) body.excludeDomains = options.excludeDomains;
    return { url: ENDPOINTS.exa, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  headers['X-Subscription-Token'] = apiKey;
  const url = new URL(options.topic === 'news' ? 'https://api.search.brave.com/res/v1/news/search' : ENDPOINTS.brave);
  const include = options.includeDomains.length ? ` (${options.includeDomains.map(domain => `site:${domain}`).join(' OR ')})` : '';
  const exclude = options.excludeDomains.map(domain => ` -site:${domain}`).join('');
  url.searchParams.set('q', query + include + exclude);
  url.searchParams.set('count', String(limit));
  url.searchParams.set('text_decorations', 'false');
  if (options.timeRange) url.searchParams.set('freshness', { day: 'pd', week: 'pw', month: 'pm', year: 'py' }[options.timeRange]);
  return { url: url.href, init: { method: 'GET', headers } };
}

function source(item, provider) {
  if (!record(item)) return undefined;
  const url = safeUrl(item.url);
  if (!url) return undefined;
  const title = nonempty(item.title);
  const snippet = nonempty(provider === 'tavily' ? item.content : provider === 'exa'
    ? Array.isArray(item.highlights) ? item.highlights.filter(value => typeof value === 'string').join('\n') || item.text : item.text
    : item.description);
  const publishedAt = nonempty(item.published_date ?? item.publishedDate ?? item.page_age);
  return { url, ...(title ? { title } : {}), ...(snippet ? { snippet: snippet.slice(0, 4500) } : {}),
    ...(publishedAt ? { publishedAt } : {}) };
}

export function normalize(provider, value, limit, options) {
  const results = provider === 'brave' ? options.topic === 'news' ? value?.results : value?.web?.results ?? [] : value?.results;
  if (!record(value) || !Array.isArray(results)) throw fail(`${LABELS[provider]} returned invalid results.`, 'WEB_INVALID_RESPONSE');
  const sources = filterSources(results.map(item => source(item, provider)).filter(Boolean), options);
  const content = provider === 'tavily' && nonempty(value.answer);
  const usage = { requests: 1 };
  if (provider === 'tavily') {
    usage.credits = finite(value.usage?.credits) ? value.usage.credits : options.searchDepth === 'advanced' ? 2 : 1;
    usage.creditsReported = finite(value.usage?.credits);
  }
  if (provider === 'exa' && finite(value.costDollars?.total)) usage.estimatedUsd = value.costDollars.total;
  return { sources: sources.slice(0, limit), truncated: sources.length > limit, ...(content ? { content } : {}), usage };
}

export async function runSearch(fetcher, provider, query, limit, options, apiKey, signal, onQuota, now) {
  const { url, init } = searchRequest(provider, query, limit, options, apiKey, now);
  const result = await fetchJson(fetcher, url, init, signal, LABELS[provider], headers => {
    if (provider === 'brave') onQuota(parseBraveQuota(headers, now));
  });
  return normalize(provider, result, limit, options);
}

// Parse policy windows rather than assuming "second value means this month".
export function parseBraveQuota(headers, now = Date.now()) {
  const list = name => (headers.get(name) || '').split(',').map(value => value.trim());
  const policies = list('x-ratelimit-policy');
  const limits = list('x-ratelimit-limit');
  const remaining = list('x-ratelimit-remaining');
  const resets = list('x-ratelimit-reset');
  const windows = policies.map((policy, index) => {
    const match = /^(\d+)\s*;\s*w=(\d+)$/.exec(policy);
    if (!match || !/^\d+$/.test(remaining[index] || '')) return undefined;
    const limit = /^\d+$/.test(limits[index] || '') ? Number(limits[index]) : Number(match[1]);
    const reset = /^\d+$/.test(resets[index] || '') ? now + Number(resets[index]) * 1000 : null;
    return { seconds: Number(match[2]), limit: limit === 0 ? null : limit, remaining: Number(remaining[index]), resetsAt: reset };
  }).filter(Boolean);
  return windows.length ? { source: 'response-headers', observedAt: now, windows } : undefined;
}

export function normalizeTavilyUsage(value, now = Date.now()) {
  if (!record(value?.key) || !record(value?.account) || !finite(value.key.usage)
    || (value.key.limit !== null && !finite(value.key.limit))
    || !finite(value.account.plan_usage) || !finite(value.account.plan_limit)) {
    throw fail('Tavily returned invalid usage details.', 'WEB_INVALID_RESPONSE');
  }
  const numbers = object => Object.fromEntries(Object.entries(object).filter(([key, number]) => key !== 'current_plan' && (finite(number) || number === null)));
  return { source: 'account-api', observedAt: now,
    key: numbers(value.key), account: { ...numbers(value.account), current_plan: nonempty(value.account.current_plan) ?? null } };
}

export async function tavilyUsage(fetcher, key, signal, now) {
  const result = await fetchJson(fetcher, 'https://api.tavily.com/usage', {
    method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${key}` }
  }, signal, 'Tavily');
  return normalizeTavilyUsage(result, now);
}
