export type Provider = 'tavily' | 'exa' | 'brave';
export interface Settings {
  enabled: boolean;
  providers: Provider[];
  routing: 'priority' | 'blend';
  blendCount: number;
  fallbackOnError: boolean;
  searchDepth: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
  allowModelDepth: boolean;
  exaSearchType: 'lite' | 'auto' | 'deep';
  maxResults: number;
  turnMaxRequests: number;
  turnMaxTavilyCredits: number;
  dailyMaxRequests: number;
  tavilyMonthlyLimit: number;
  exaMonthlyLimit: number;
  braveMonthlyLimit: number;
  braveMinIntervalMs: number;
  cacheTtlSeconds: number;
  topic: 'general' | 'news' | 'finance';
  timeRange?: 'day' | 'week' | 'month' | 'year';
  includeDomains: string[];
  excludeDomains: string[];
  chunksPerSource: number;
  includeAnswer: boolean;
  timeoutMs: number;
}
export interface Counters {
  period: string;
  todayRequests: number;
  requests: number;
  successes: number;
  errors: number;
  tavilyCredits: number;
  confirmedCredits: number;
  estimatedUsd: number;
  costReportedRequests: number;
  uncertain: number;
}
export interface Probe {
  ok: boolean;
  latencyMs: number;
  checkedAt: number;
  kind?: 'authentication' | 'search';
  code?: string;
  message?: string;
}
export type Quota = {
  source: 'account-api';
  observedAt: number;
  key: { usage: number; limit: number | null; search_usage?: number };
  account: { current_plan: string | null; plan_usage: number; plan_limit: number; paygo_usage?: number; paygo_limit?: number };
} | {
  source: 'response-headers';
  observedAt: number;
  windows: { seconds: number; limit: number | null; remaining: number; resetsAt: number | null }[];
};
export interface ProviderView {
  id: Provider;
  label: string;
  dashboard: string;
  configured: boolean;
  source: string | null;
  reference: string | null;
  enabled: boolean;
  monthlyLimit: number;
  local: Counters;
  quota: Quota | null;
  probe: Probe | null;
}
export interface Status {
  version: string;
  providers: ProviderView[];
  turns: { sessionId: string | null; turn: number | null; updatedAt: number; requests: number; tavilyCredits: number }[];
  routing: string;
  enabled: boolean;
  dailyMaxRequests: number;
  turnMaxRequests: number;
  turnMaxTavilyCredits: number;
  now: number;
}
export type Api = <T>(method: string, payload?: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
