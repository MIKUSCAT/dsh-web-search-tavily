import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PROVIDERS, LABELS, DEPTHS, RANGES, snapshot } from './config.mjs';
import { WebError } from '@deepseek-ai/dsh-web';
import { fail, invalid, checkAbort, abortable, canonicalUrl, domainList, record } from './http.mjs';
import { DASHBOARDS, runSearch, tavilyUsage } from './providers.mjs';
import { UsageLedger } from './ledger.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const handled = error => error instanceof WebError ? error : fail('Search operation could not complete.');
const isBudget = error => error?.code === 'WEB_BUDGET_EXHAUSTED';
const fallbackCodes = new Set(['WEB_PROVIDER_CREDENTIAL_MISSING', 'WEB_RATE_LIMITED', 'WEB_NETWORK_ERROR', 'WEB_PROVIDER_ERROR', 'WEB_INVALID_RESPONSE']);
export const searchContext = new AsyncLocalStorage();

export function mergeSources(results, limit) {
  const sources = [], seen = new Set();
  const maximum = Math.max(0, ...results.map(result => result.sources.length));
  let total = 0;
  for (let index = 0; index < maximum; index++) {
    for (const result of results) {
      const item = result.sources[index];
      if (!item) continue;
      const canonical = canonicalUrl(item.url);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      total++;
      if (sources.length < limit) sources.push(item);
    }
  }
  return { sources, truncated: total > limit || results.some(result => result.truncated) };
}

export class HybridSearchRuntime {
  constructor({ config, resolveKey, file = null, fetcher = (...args) => globalThis.fetch(...args), now = () => Date.now(), ledger }) {
    this.config = config;
    this.resolveKey = resolveKey;
    this.fetcher = fetcher;
    this.now = now;
    this.ledger = ledger ?? new UsageLedger(file, now);
    this.lifetime = new AbortController();
    this.cache = new Map();
    this.inflight = new Map();
    this.quotas = new Map();
    this.probes = new Map();
    this.turns = new Map();
    this.braveNextAt = 0;
    this.background = new Set();
  }

  options(overrides = {}) {
    const options = snapshot(this.config);
    if (!options.providers.every(provider => PROVIDERS.includes(provider))) throw invalid('Unknown search provider.');
    if (!DEPTHS.includes(options.searchDepth) || !['lite', 'auto', 'deep'].includes(options.exaSearchType)) throw invalid('Invalid search strength.');
    if (overrides.depth !== undefined && !DEPTHS.includes(overrides.depth)) throw invalid('Invalid search depth.');
    if (options.allowModelDepth && overrides.depth) options.searchDepth = overrides.depth;
    for (const [field, allowed] of [['topic', ['general', 'news', 'finance']], ['timeRange', RANGES]]) {
      if (overrides[field] !== undefined && !allowed.includes(overrides[field])) throw invalid(`Invalid ${field}.`);
      if (overrides[field] !== undefined) options[field] = overrides[field];
    }
    options.includeDomains = domainList(options.includeDomains, 'includeDomains');
    options.excludeDomains = domainList(options.excludeDomains, 'excludeDomains');
    return options;
  }

  async credential(provider, options, signal, draft) {
    const resolved = draft === undefined ? await abortable(this.resolveKey(provider, options), signal)
      : { value: draft, source: 'draft', writable: true };
    checkAbort(signal);
    const value = resolved?.value?.trim();
    if (!value) return undefined;
    if (value.length > 4096 || /[\r\n\u0000]/.test(value)) throw invalid(`${LABELS[provider]} key contains invalid characters.`);
    return { ...resolved, value, identity: `${provider}:${digest(value)}`, provider };
  }

  async deadline(signal, timeoutMs, operation) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const combined = AbortSignal.any([this.lifetime.signal, deadline.signal, ...(signal ? [signal] : [])]);
    try { checkAbort(combined); const value = await operation(combined); checkAbort(combined); return value; }
    catch (error) {
      if (signal?.aborted || this.lifetime.signal.aborted) throw fail('Search cancelled.', 'WEB_ABORTED');
      if (deadline.signal.aborted) throw fail('Search timed out. A sent request may still have consumed quota.', 'WEB_TIMEOUT');
      throw handled(error);
    } finally { clearTimeout(timer); }
  }

  quotaAvailable(credential, options) {
    const quota = this.quotas.get(credential.identity);
    if (!quota) return true;
    if (quota.source === 'response-headers') {
      return !quota.windows.some(window => window.seconds >= 86400 && window.limit !== null
        && window.remaining === 0 && window.resetsAt > this.now());
    }
    if (this.now() - quota.observedAt > 300000) return true;
    const cost = options.searchDepth === 'advanced' ? 2 : 1;
    if (quota.key.limit !== null && Number.isFinite(quota.key.limit) && quota.key.limit - quota.key.usage < cost) return false;
    return quota.account.plan_limit - quota.account.plan_usage >= cost
      || (quota.account.paygo_limit ?? 0) - (quota.account.paygo_usage ?? 0) >= cost;
  }

  /** Leases let duplicate callers share one request without sharing cancellation ownership. */
  lease(entry, signal) {
    entry.waiters++;
    return abortable(entry.promise, signal).finally(async () => {
      entry.waiters--;
      if (!entry.waiters && !entry.done) {
        entry.controller.abort();
        await entry.promise.catch(() => {});
      }
    });
  }

  single(credential, query, limit, options, signal, turnKey, { probe = false } = {}) {
    checkAbort(signal);
    const provider = credential.provider;
    const cacheKey = digest(JSON.stringify([credential.identity, query.trim().replace(/\s+/g, ' '), limit,
      options.searchDepth, options.exaSearchType, options.topic, options.timeRange ?? null,
      options.includeDomains, options.excludeDomains, options.chunksPerSource, options.includeAnswer]));
    const cache = !probe && options.cacheTtlSeconds > 0 && this.cache.get(cacheKey);
    if (cache && Math.min(cache.expires, cache.createdAt + options.cacheTtlSeconds * 1000) > this.now()) return Promise.resolve(structuredClone(cache.value));
    const pendingKey = `${turnKey}:${cacheKey}`;
    const existing = !probe && this.inflight.get(pendingKey);
    if (existing && !existing.controller.signal.aborted) return this.lease(existing, signal);
    const controller = new AbortController();
    const entry = { controller, waiters: 0, done: false, promise: null };
    const workSignal = AbortSignal.any([controller.signal, this.lifetime.signal]);
    const plan = { provider, identity: credential.identity, credits: provider === 'tavily' ? options.searchDepth === 'advanced' ? 2 : 1 : 0 };
    entry.promise = (async () => {
      const [receipt] = await this.ledger.reserve([plan], options, turnKey);
      let outcome = { ok: false };
      try {
        checkAbort(workSignal);
        if (provider === 'brave') {
          const startAt = Math.max(this.now(), this.braveNextAt);
          this.braveNextAt = startAt + (options.braveMinIntervalMs ?? 1000);
          if (startAt > this.now()) await delay(startAt - this.now(), undefined, { signal: workSignal });
          checkAbort(workSignal);
        }
        receipt.started = true;
        const result = await runSearch(this.fetcher, provider, query, limit, options, credential.value, workSignal,
          quota => { if (quota) this.quotas.set(credential.identity, quota); }, this.now());
        outcome = { ok: true, usage: result.usage };
        const value = { sources: result.sources, truncated: result.truncated, ...(result.content ? { content: result.content } : {}) };
        // Brave result retention depends on the customer's plan. Never cache its result bodies.
        if (!probe && provider !== 'brave' && options.cacheTtlSeconds > 0) {
          if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
          this.cache.set(cacheKey, { value, createdAt: this.now(), expires: this.now() + options.cacheTtlSeconds * 1000 });
        }
        return value;
      } catch (error) {
        outcome.rejected = error instanceof WebError && /^.+ returned HTTP \d+\.$/.test(error.message);
        throw error;
      } finally { await this.ledger.settle(receipt, outcome); }
    })().finally(() => {
      entry.done = true;
      if (this.inflight.get(pendingKey) === entry) this.inflight.delete(pendingKey);
      this.background.delete(entry.promise);
    });
    this.background.add(entry.promise);
    if (!probe) this.inflight.set(pendingKey, entry);
    return this.lease(entry, signal);
  }

  async search(request, signal, overrides = {}) {
    const options = this.options(overrides);
    if (!options.enabled) throw fail('Web search is disabled in DSH Hybrid Search.', 'WEB_SEARCH_DISABLED');
    if (typeof request?.query !== 'string' || !request.query.trim() || request.query.length > 4096) throw invalid('Search needs a query of 1–4096 characters.');
    if (request.maxResults !== undefined && (!Number.isSafeInteger(request.maxResults) || request.maxResults < 1)) throw invalid('Invalid result count.');
    const limit = Math.min(request.maxResults ?? options.maxResults, options.maxResults);
    const context = searchContext.getStore();
    // Host callers outside a tool turn share a bounded bucket; they cannot mint a new one with a model argument.
    const turnKey = context?.turnKey ?? 'unscoped';
    this.turns.set(turnKey, { sessionId: context?.sessionId ?? null, turn: context?.turn ?? null, updatedAt: this.now() });
    return this.deadline(signal, options.timeoutMs, async combined => {
      const selected = overrides.onlyProvider ? options.providers.filter(provider => provider === overrides.onlyProvider) : options.providers;
      const credentials = (await Promise.all(selected.map(provider => this.credential(provider, options, combined)))).filter(Boolean);
      const available = credentials.filter(credential => this.quotaAvailable(credential, options));
      if (!credentials.length) throw fail('Add an API key and enable a provider in DSH Hybrid Search.', 'WEB_PROVIDER_CREDENTIAL_MISSING');
      if (!available.length) throw fail('The configured providers have no available quota. Refresh their usage in DSH Hybrid Search.', 'WEB_RATE_LIMITED');
      const results = [], errors = [];
      if (options.routing === 'blend' && !overrides.onlyProvider) {
        const settled = await Promise.allSettled(available.slice(0, options.blendCount).map(credential =>
          this.single(credential, request.query, limit, options, combined, turnKey)));
        for (const result of settled) {
          if (result.status === 'fulfilled') results.push(result.value);
          else errors.push(handled(result.reason));
        }
      } else {
        for (const credential of available) {
          try { results.push(await this.single(credential, request.query, limit, options, combined, turnKey)); break; }
          catch (error) {
            const failure = handled(error);
            errors.push(failure);
            if (!options.fallbackOnError || !fallbackCodes.has(failure.code)) break;
          }
        }
      }
      checkAbort(combined);
      if (!results.length && errors.length && !errors.every(isBudget)) throw errors[0];
      const merged = mergeSources(results, limit);
      const messages = results.map(result => result.content).filter(Boolean);
      if (errors.length) messages.push(`Search notice: ${errors.map(error => error.message).join(' ')}`);
      return { ...merged, ...(messages.length ? { content: messages.join('\n\n') } : {}) };
    });
  }

  async refreshUsage(provider, signal) {
    if (!PROVIDERS.includes(provider)) throw invalid('Unknown provider.');
    const options = this.options();
    return this.deadline(signal, options.timeoutMs, async combined => {
      const credential = await this.credential(provider, options, combined);
      if (!credential) throw fail(`${LABELS[provider]} key is not configured.`, 'WEB_PROVIDER_CREDENTIAL_MISSING');
      if (provider === 'tavily') this.quotas.set(credential.identity, await tavilyUsage(this.fetcher, credential.value, combined, this.now()));
      return this.providerView(provider, options, credential);
    });
  }

  async probe(provider, draft, signal) {
    if (!PROVIDERS.includes(provider)) throw invalid('Unknown provider.');
    const options = this.options();
    return this.deadline(signal, options.timeoutMs, async combined => {
      const credential = await this.credential(provider, options, combined, draft);
      if (!credential) throw fail(`${LABELS[provider]} key is not configured.`, 'WEB_PROVIDER_CREDENTIAL_MISSING');
      const start = this.now();
      let result;
      try {
        if (provider === 'tavily') {
          this.quotas.set(credential.identity, await tavilyUsage(this.fetcher, credential.value, combined, this.now()));
        } else {
          await this.single(credential, 'DeepSeek Harness', 1, { ...options, exaSearchType: 'lite', topic: 'general',
            timeRange: undefined, includeDomains: [], excludeDomains: [] }, combined, `probe:${randomUUID()}`, { probe: true });
        }
        result = { ok: true, checkedAt: this.now(), latencyMs: Math.max(0, this.now() - start),
          kind: provider === 'tavily' ? 'authentication' : 'search' };
      } catch (error) {
        const failure = handled(error);
        result = { ok: false, checkedAt: this.now(), latencyMs: Math.max(0, this.now() - start), code: failure.code, message: failure.message };
      }
      this.probes.set(credential.identity, result);
      return { probe: result, provider: await this.providerView(provider, options, credential) };
    });
  }

  async providerView(provider, options, credential) {
    const local = await this.ledger.view(credential?.identity ?? `${provider}:unconfigured`);
    return { id: provider, label: LABELS[provider], dashboard: DASHBOARDS[provider],
      configured: Boolean(credential), source: credential?.source ?? null, reference: credential?.reference ?? null,
      enabled: options.providers.includes(provider),
      monthlyLimit: options[`${provider}MonthlyLimit`], local,
      quota: credential ? this.quotas.get(credential.identity) ?? null : null,
      probe: credential ? this.probes.get(credential.identity) ?? null : null };
  }

  async status() {
    const options = this.options();
    const providers = await Promise.all(PROVIDERS.map(async provider => {
      const credential = await this.credential(provider, options, this.lifetime.signal);
      return this.providerView(provider, options, credential);
    }));
    const turns = [...this.turns].slice(-8).reverse().map(([key, value]) => ({ ...value, ...this.ledger.turnView(key) }));
    return { version: '0.3.0', providers, turns, routing: options.routing, enabled: options.enabled,
      dailyMaxRequests: options.dailyMaxRequests, turnMaxRequests: options.turnMaxRequests,
      turnMaxTavilyCredits: options.turnMaxTavilyCredits, now: this.now() };
  }

  async dispose() {
    this.lifetime.abort();
    await Promise.allSettled([...this.background]);
    this.cache.clear();
    this.inflight.clear();
    await this.ledger.flush();
  }
}
