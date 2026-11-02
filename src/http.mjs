import { WebError } from '@deepseek-ai/dsh-web';

export const fail = (message, code = 'WEB_PROVIDER_ERROR') => new WebError(message, code);
export const invalid = message => fail(message, 'WEB_INVALID_REQUEST');
export const cancelled = () => fail('Search cancelled.', 'WEB_ABORTED');
export const checkAbort = signal => { if (signal?.aborted) throw cancelled(); };
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const nonempty = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
export const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function abortable(operation, signal) {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) { Promise.resolve(operation).catch(() => {}); return Promise.reject(cancelled()); }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(cancelled()); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function readJson(response, signal, limit = 2 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length'));
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (declared > limit || (mime && mime !== 'application/json' && !mime.endsWith('+json'))) {
    response.body?.cancel().catch(() => {});
    throw fail('Search provider returned an oversized or non-JSON response.', 'WEB_INVALID_RESPONSE');
  }
  if (!response.body) throw fail('Search provider returned an empty response.', 'WEB_INVALID_RESPONSE');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const next = await abortable(reader.read(), signal);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw fail('Search response exceeds the 2 MiB limit.', 'WEB_RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { throw fail('Search provider returned invalid JSON.', 'WEB_INVALID_RESPONSE'); }
}

export async function fetchJson(fetcher, url, init, signal, label, onHeaders = () => {}) {
  checkAbort(signal);
  let response;
  try {
    response = await abortable(fetcher(url, { ...init, signal, redirect: 'error' }), signal);
  } catch (error) {
    checkAbort(signal);
    if (error instanceof WebError) throw error;
    throw fail(`${label} could not be reached. Check the DSH network/proxy settings.`, 'WEB_NETWORK_ERROR');
  }
  onHeaders(response.headers);
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    const status = response.status;
    const code = status === 401 || status === 403 ? 'WEB_PROVIDER_CREDENTIAL_MISSING'
      : [402, 429, 432, 433].includes(status) ? 'WEB_RATE_LIMITED' : 'WEB_PROVIDER_ERROR';
    // Do not echo upstream bodies: some servers include a credential in their error text.
    throw fail(`${label} returned HTTP ${status}.`, code);
  }
  return readJson(response, signal);
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href.replace(/\/$/, '');
}

export function domainList(value, label, maximum = 150) {
  if (!Array.isArray(value)) throw invalid(`Invalid ${label}.`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`Invalid ${label}.`);
    const domain = item.trim().toLowerCase();
    if (!domain) continue;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain) || domain.length > 253) {
      throw invalid(`${label} must contain hostnames without paths.`);
    }
    if (!out.includes(domain)) out.push(domain);
  }
  if (out.length > maximum) throw invalid(`${label} accepts at most ${maximum} domains.`);
  return out;
}

export function filterSources(sources, options) {
  const match = (host, domain) => host === domain || host.endsWith(`.${domain}`);
  return sources.filter(source => {
    const host = new URL(source.url).hostname.toLowerCase();
    return (!options.includeDomains.length || options.includeDomains.some(domain => match(host, domain)))
      && !options.excludeDomains.some(domain => match(host, domain));
  });
}
