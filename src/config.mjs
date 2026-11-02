import z from '@deepseek-ai/schemastery';

export const PROVIDERS = ['tavily', 'exa', 'brave'];
export const LABELS = { tavily: 'Tavily', exa: 'Exa', brave: 'Brave' };
export const REFERENCES = { tavily: 'TAVILY_API_KEY', exa: 'EXA_API_KEY', brave: 'BRAVE_API_KEY' };
export const DEPTHS = ['basic', 'advanced', 'fast', 'ultra-fast'];
export const RANGES = ['day', 'week', 'month', 'year'];
export const plain = value => value && typeof value.get === 'function' ? value.get() : value;

// Keep the original row and Tavily field names so installed profiles keep their settings.
export const Config = z.object({
  providers: z.array(z.union(PROVIDERS)).default(PROVIDERS)
    .description('Enabled search providers in priority order. Providers without a key are skipped.').volatile(),
  routing: z.union(['priority', 'blend']).default('priority')
    .description('priority: use one configured provider; blend: search multiple providers and merge sources.').volatile(),
  blendCount: z.number().step(1).min(2).max(3).default(2)
    .description('Maximum providers searched for one query in blend mode.').volatile(),
  fallbackOnError: z.boolean().default(false)
    .description('Allow the next enabled provider after a credential, quota, network or upstream error. Every outgoing request counts.').volatile(),
  enabled: z.boolean().default(true).description('Allow this plugin to search.').volatile(),
  searchDepth: z.union(DEPTHS).default('basic').description('Tavily search depth; advanced costs 2 credits, other depths cost 1.').volatile(),
  allowModelDepth: z.boolean().default(false).description('Let the model choose Tavily depth within the configured credit budget.').volatile(),
  exaSearchType: z.union(['lite', 'auto', 'deep']).default('lite').description('Exa retrieval mode.').volatile(),
  maxResults: z.number().step(1).min(1).max(10).default(6).description('Hard maximum sources per query, shared by all providers.').volatile(),
  turnMaxRequests: z.number().step(1).min(1).max(100).default(4).description('Maximum outgoing search requests across all tools in one assistant turn.').volatile(),
  turnMaxTavilyCredits: z.number().step(1).min(1).max(200).default(4).description('Maximum Tavily credits reserved in one assistant turn.').volatile(),
  dailyMaxRequests: z.number().step(1).min(0).max(100000).default(100).description('Local daily outgoing-request limit; 0 disables this limit.').volatile(),
  tavilyMonthlyLimit: z.number().step(1).min(0).max(1000000).default(1000).description('Local monthly Tavily credit limit; 0 disables it.').volatile(),
  exaMonthlyLimit: z.number().step(1).min(0).max(1000000).default(1000).description('Local monthly Exa outgoing-request limit; 0 disables it.').volatile(),
  braveMonthlyLimit: z.number().step(1).min(0).max(1000000).default(1000).description('Local monthly Brave outgoing-request limit; 0 disables it.').volatile(),
  braveMinIntervalMs: z.number().step(1).min(0).max(60000).default(1000).description('Minimum interval between Brave requests in milliseconds.').volatile(),
  cacheTtlSeconds: z.number().step(1).min(0).max(3600).default(120).description('In-memory Tavily/Exa cache lifetime; 0 disables it. Brave only deduplicates in-flight requests.').volatile(),
  apiKey: z.string().role('secret').description('Legacy literal Tavily key, used only when the credential service has no key.').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default('TAVILY_API_KEY').description('Tavily credential reference.').volatile(),
  exaApiKeyEnv: z.string().role('credential-ref').default('EXA_API_KEY').description('Exa credential reference.').volatile(),
  braveApiKeyEnv: z.string().role('credential-ref').default('BRAVE_API_KEY').description('Brave credential reference.').volatile(),
  topic: z.union(['general', 'news', 'finance']).default('general').description('Tavily category; news also selects Exa news and Brave news.').volatile(),
  timeRange: z.union(RANGES).description('Optional date filter.').volatile(),
  includeDomains: z.array(z.string()).default([]).description('Only include these domains.').volatile(),
  excludeDomains: z.array(z.string()).default([]).description('Exclude these domains.').volatile(),
  chunksPerSource: z.number().step(1).min(1).max(3).default(1).description('Tavily snippet chunks per source.').volatile(),
  includeAnswer: z.boolean().default(false).description('Include Tavily-generated answer text.').volatile(),
  timeoutMs: z.number().step(1).min(1000).max(120000).default(30000).description('Total deadline per logical search, including all providers.').volatile(),
  registerTool: z.boolean().default(true).description('Register hybrid_search and the compatible tavily_search tool. Live policies apply to both.')
});

export function snapshot(config) {
  const out = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, plain(value)]));
  out.providers = [...new Set((out.providers ?? PROVIDERS).map(plain))];
  out.includeDomains = (out.includeDomains ?? []).map(plain);
  out.excludeDomains = (out.excludeDomains ?? []).map(plain);
  return out;
}

export function credentialReference(options, provider) {
  return options[provider === 'tavily' ? 'apiKeyEnv' : `${provider}ApiKeyEnv`] || REFERENCES[provider];
}
