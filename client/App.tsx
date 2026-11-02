import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { Api, Provider, ProviderView, Probe, Settings, Status } from './types';
import type { Key, T } from './locales';
import { errorText } from './locales';

const PROVIDERS: Provider[] = ['tavily', 'exa', 'brave'];
const names = { tavily: 'Tavily', exa: 'Exa', brave: 'Brave' };
const initials = { tavily: 'T', exa: 'E', brave: 'B' };
const fields: (keyof Settings)[] = ['enabled', 'providers', 'routing', 'blendCount', 'fallbackOnError', 'searchDepth',
  'allowModelDepth', 'exaSearchType', 'maxResults', 'turnMaxRequests', 'turnMaxTavilyCredits', 'dailyMaxRequests',
  'tavilyMonthlyLimit', 'exaMonthlyLimit', 'braveMonthlyLimit', 'braveMinIntervalMs', 'cacheTtlSeconds', 'topic', 'timeRange',
  'includeDomains', 'excludeDomains', 'chunksPerSource', 'includeAnswer', 'timeoutMs'];
const numeric: Partial<Record<keyof Settings, [number, number]>> = {
  blendCount: [2, 3], maxResults: [1, 10], turnMaxRequests: [1, 100], turnMaxTavilyCredits: [1, 200],
  dailyMaxRequests: [0, 100000], tavilyMonthlyLimit: [0, 1000000], exaMonthlyLimit: [0, 1000000], braveMonthlyLimit: [0, 1000000],
  braveMinIntervalMs: [0, 60000], cacheTtlSeconds: [0, 3600], chunksPerSource: [1, 3], timeoutMs: [1000, 120000]
};
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const date = (time: number) => new Date(time).toLocaleString();

function Icon({ kind, spin = false }: { kind: 'refresh' | 'check' | 'up' | 'down' | 'link' | 'search'; spin?: boolean }) {
  const paths = {
    refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17',
    check: 'm5 12 4 4L19 6', up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6',
    link: 'M14 4h6v6M20 4l-9 9M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5'
  };
  return <svg className={spin ? 'hs-spin' : undefined} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function NumberField({ label, field, settings, change, t, disabled = false }: { label: string; field: keyof Settings; settings: Settings; change: (field: keyof Settings, value: unknown) => void; t: T; disabled?: boolean }) {
  const value = settings[field] as number;
  const [min, max] = numeric[field]!;
  const valid = Number.isInteger(value) && value >= min && value <= max;
  return <label className="hs-field"><span>{label}</span><input type="number" min={min} max={max} step="1" value={Number.isNaN(value) ? '' : value}
    aria-invalid={!valid} disabled={disabled} onChange={event => change(field, event.target.value === '' ? NaN : Number(event.target.value))} />
    {!valid && <span className="hs-error">{t('invalidNumber')}</span>}</label>;
}

function Meter({ used, limit, label, t }: { used: number; limit: number | null; label: string; t: T }) {
  return <div className="hs-meter"><div className="hs-line"><span>{label}</span><strong>{used.toLocaleString()} <span className="hs-muted">/ {limit === null ? t('noLimit') : limit.toLocaleString()}</span></strong></div>
    {limit !== null && limit > 0 && <div className="hs-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)}>
      <div className={used / limit >= .9 ? 'hs-high' : ''} style={{ width: `${Math.max(0, Math.min(100, used / limit * 100))}%` }} /></div>}</div>;
}

function Usage({ provider, t }: { provider: ProviderView; t: T }) {
  const quota = provider.quota;
  if (provider.id === 'tavily') return <div className="hs-usage">
    {quota?.source === 'account-api' ? <>
      <div className="hs-line"><span>{t('plan')}</span><span className="hs-plan">{quota.account.current_plan ?? '—'}</span></div>
      <Meter label={t('accountUsage')} used={quota.account.plan_usage} limit={quota.account.plan_limit} t={t} />
      <div className="hs-line"><span>{t('remaining')} · {t('plan')}</span><strong>{Math.max(0, quota.account.plan_limit - quota.account.plan_usage).toLocaleString()} credits</strong></div>
      <Meter label={t('keyUsage')} used={quota.key.usage} limit={quota.key.limit} t={t} />
      {Boolean(quota.account.paygo_limit || quota.account.paygo_usage) && <div className="hs-line"><span>{t('paygo')}</span><span>{quota.account.paygo_usage ?? 0} / {quota.account.paygo_limit ?? 0}</span></div>}
      <div className="hs-meta">{t('updated')} {date(quota.observedAt)}</div>
    </> : <p className="hs-empty">{t('waitUsage')}</p>}
    <div className="hs-line hs-local"><span>{t('localCredits')}</span><strong>{provider.local.tavilyCredits.toLocaleString()} credits</strong></div>
    {provider.local.uncertain > 0 && <div className="hs-meta">{t('unconfirmed')} · {provider.local.uncertain}</div>}
  </div>;
  if (provider.id === 'exa') return <div className="hs-usage">
    <div className="hs-line"><span>{t('localRequests')}</span><strong>{provider.local.requests.toLocaleString()}</strong></div>
    <div className="hs-line"><span>{t('estimatedCost')}</span><strong>{provider.local.costReportedRequests > 0 || !provider.local.requests ? `$${provider.local.estimatedUsd.toFixed(4)}` : '—'}</strong></div>
    {provider.local.successes > provider.local.costReportedRequests && <div className="hs-meta">{t('costMissing')}</div>}
    <p className="hs-empty">{t('noBalance')}</p>
  </div>;
  const window = quota?.source === 'response-headers' ? [...quota.windows].filter(item => item.seconds >= 86400).sort((a, b) => b.seconds - a.seconds)[0] : undefined;
  return <div className="hs-usage">
    {window ? <>
      <div className="hs-line"><span>{t('remaining')}</span><strong>{window.limit === null ? t('noLimit') : window.remaining.toLocaleString()}</strong></div>
      {window.limit !== null && <Meter label={t('quotaHeaders')} used={Math.max(0, window.limit - window.remaining)} limit={window.limit} t={t} />}
      {window.resetsAt !== null && <div className="hs-meta">{t('resetAt')} {date(window.resetsAt)}</div>}
    </> : <p className="hs-empty">{t('waitBrave')}</p>}
    <div className="hs-line hs-local"><span>{t('localRequests')}</span><strong>{provider.local.requests.toLocaleString()}</strong></div>
  </div>;
}

export interface AppProps { form: ConfigForm<Settings>; api: Api; t: T; isActive?: boolean; activate?: () => Promise<void> }
export function App({ form, api, t, isActive = true, activate }: AppProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form]);
  const getSnapshot = useCallback(() => form.getSnapshot(), [form]);
  const accepted = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [draft, setDraft] = useState<Settings>();
  const [dirty, setDirty] = useState(false);
  const revision = useRef<number>();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [keys, setKeys] = useState<Record<Provider, string>>({ tavily: '', exa: '', brave: '' });
  const [messages, setMessages] = useState<Partial<Record<Provider, { error: boolean; text: string }>>>({});
  const controller = useRef(new AbortController());
  useEffect(() => {
    const own = new AbortController();
    controller.current = own;
    return () => own.abort();
  }, []);

  useEffect(() => {
    if (!dirty && accepted.value) {
      setDraft(Object.fromEntries(fields.map(field => [field, accepted.value![field]])) as unknown as Settings);
      revision.current = accepted.revision;
    }
  }, [accepted.value, accepted.revision, dirty]);

  const load = useCallback(async (refreshQuota = false) => {
    const signal = controller.current.signal;
    const value = await api<Status>('status', {}, signal);
    if (signal.aborted) return;
    setStatus(value);
    const tavily = value.providers.find(provider => provider.id === 'tavily');
    if (refreshQuota && tavily?.configured) {
      try {
        const provider = await api<ProviderView>('usage', { provider: 'tavily' }, signal);
        if (signal.aborted) return;
        setStatus(current => current ? { ...current, providers: current.providers.map(item => item.id === 'tavily' ? provider : item) } : current);
      } catch (failure) { if (!signal.aborted) setMessages(current => ({ ...current, tavily: { error: true, text: errorText(failure, t) } })); }
    }
  }, [api, controller, t]);

  useEffect(() => {
    const signal = controller.current.signal;
    void load(true).catch(failure => { if (!signal.aborted) setError(errorText(failure, t)); });
    const timer = setInterval(() => {
      if (!pending.current && !document.hidden) void load().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [load, controller, t]);

  async function run(id: string, operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(id); setError(''); setNotice('');
    try { await operation(); }
    catch (failure) { if (!controller.current.signal.aborted) setError(errorText(failure, t)); }
    finally { pending.current = false; if (!controller.current.signal.aborted) setBusy(null); }
  }

  function change(field: keyof Settings, value: unknown) {
    if (!dirty) revision.current = accepted.revision;
    setDraft(current => ({ ...current!, [field]: value }));
    setDirty(true); setNotice('');
  }

  const invalidFields = draft ? Object.entries(numeric).filter(([field, [min, max]]) => {
    const value = draft[field as keyof Settings];
    return typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max;
  }).length : 0;
  const domainsInvalid = draft ? [...draft.includeDomains, ...draft.excludeDomains].filter(Boolean).some(domain =>
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(domain.trim())) : false;

  async function save() {
    await run('settings', async () => {
      if (!draft || invalidFields || domainsInvalid) return;
      const operations = fields.filter(field => !equal(draft[field], accepted.value?.[field])).map(field => draft[field] === undefined
        ? { op: 'unset' as const, path: [field] } : { op: 'set' as const, path: [field], value: draft[field] });
      if (!await form.mutate(operations, revision.current)) { setError(t('conflict')); return; }
      setDirty(false); setNotice(t('saved')); await load();
    });
  }

  async function providerAction(provider: ProviderView, action: 'save-key' | 'delete-key' | 'test' | 'usage') {
    await run(`${provider.id}:${action}`, async () => {
      try {
        const payload: Record<string, unknown> = { provider: provider.id };
        if (provider.reference) payload.reference = provider.reference;
        const value = keys[provider.id].trim();
        if (action === 'save-key' || (action === 'test' && value)) payload.value = value;
        if (action === 'test') {
          const result = await api<{ probe: Probe; provider: ProviderView }>(action, payload, controller.current.signal);
          const probe = result.probe;
          const text = probe.ok ? `${t(probe.kind === 'authentication' ? 'testAuthOk' : 'testSearchOk')} · ${probe.latencyMs} ms`
            : errorText(probe, t);
          setMessages(current => ({ ...current, [provider.id]: { error: !probe.ok, text: value ? `${t('draftTest')} · ${text}` : text } }));
          if (!value) await load();
        } else if (action === 'usage') {
          const result = await api<ProviderView>(action, payload, controller.current.signal);
          setStatus(current => current ? { ...current, providers: current.providers.map(item => item.id === result.id ? result : item) } : current);
        } else {
          const result = await api<Status>(action, payload, controller.current.signal);
          setStatus(result);
          setKeys(current => ({ ...current, [provider.id]: '' }));
          const stillConfigured = action === 'delete-key' && result.providers.find(item => item.id === provider.id)?.configured;
          setMessages(current => ({ ...current, [provider.id]: { error: false,
            text: t(action === 'save-key' ? 'keySaved' : stillConfigured ? 'inheritedKey' : 'keyRemoved') } }));
        }
      } catch (failure) {
        if (!controller.current.signal.aborted) setMessages(current => ({ ...current, [provider.id]: { error: true, text: errorText(failure, t) } }));
      }
    });
  }

  if (accepted.status === 'unavailable') return <div className="dsh-hs"><div role="alert" className="hs-alert">{t('unavailable')}</div></div>;
  if (!draft || !status) return <div className="dsh-hs"><div className="hs-loading" role="status"><Icon kind="refresh" spin />{error || t('loading')}</div>
    {error && <button className="hs-button" onClick={() => void run('refresh', () => load(true))}>{t('retry')}</button>}</div>;
  const order = [...draft.providers, ...PROVIDERS.filter(provider => !draft.providers.includes(provider))];
  const ordered = order.map(id => status.providers.find(provider => provider.id === id)!);
  const configured = status.providers.filter(provider => provider.configured).length;
  const latest = status.turns[0];
  function toggleProvider(provider: Provider) {
    change('providers', draft!.providers.includes(provider) ? draft!.providers.filter(id => id !== provider) : [...draft!.providers, provider]);
  }
  function move(provider: Provider, direction: -1 | 1) {
    const providers = [...draft!.providers], index = providers.indexOf(provider), next = index + direction;
    if (index < 0 || next < 0 || next >= providers.length) return;
    [providers[index], providers[next]] = [providers[next], providers[index]];
    change('providers', providers);
  }

  return <div className="dsh-hs">
    <div className="hs-hero"><div><div className="hs-eyebrow"><Icon kind="search" /> DSH HYBRID SEARCH</div><h2>{t('control')}</h2><p>{t('controlSub')}</p></div>
      <button className="hs-icon-button" title={t('refresh')} aria-label={t('refresh')} disabled={busy !== null} onClick={() => void run('refresh', () => load(true))}><Icon kind="refresh" spin={busy === 'refresh'} /></button></div>
    <div className="hs-stats"><div><span>{t('today')}</span><strong>{status.providers[0]?.local.todayRequests ?? 0}<em> / {draft.dailyMaxRequests || '∞'}</em></strong></div>
      <div><span>{t('configured')}</span><strong>{configured}<em> / 3</em></strong></div><div><span>{t('turn')}</span><strong>{latest ? latest.requests : '—'}<em> {latest ? t('requests') : t('noTurn')}</em></strong></div></div>
    {error && <div className="hs-alert" role="alert">{error}</div>}
    {!isActive && <div className="hs-activation"><span>{t('inactive')}</span><button className="hs-button" disabled={busy !== null || !activate} onClick={() => void run('activate', activate!)}>{t('activate')}</button></div>}
    {notice && <div className="hs-notice" role="status"><Icon kind="check" />{notice}</div>}
    <fieldset className="hs-fieldset" disabled={busy !== null || !accepted.writable}>
      <section className="hs-section"><div className="hs-section-heading"><h3>{t('strategy')}</h3><label className="hs-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => change('enabled', event.target.checked)} /><span>{t(draft.enabled ? 'enabled' : 'disabled')}</span></label></div>
        <div className="hs-modes">{(['priority', 'blend'] as const).map(mode => <button key={mode} type="button" className={`hs-mode${draft.routing === mode ? ' hs-selected' : ''}`} aria-pressed={draft.routing === mode} onClick={() => change('routing', mode)}>
          <span className="hs-radio" /><span><strong>{t(mode)}</strong><span>{t(mode === 'priority' ? 'priorityDesc' : 'blendDesc')}</span></span></button>)}</div>
        {draft.routing === 'blend' && <label className="hs-field hs-inline-field"><span>{t('blendCount')}</span><select value={draft.blendCount} onChange={event => change('blendCount', Number(event.target.value))}><option value={2}>{t('two')}</option><option value={3}>{t('three')}</option></select></label>}
        {draft.routing === 'priority' && <label className="hs-check"><input type="checkbox" checked={draft.fallbackOnError} onChange={event => change('fallbackOnError', event.target.checked)} /><span>{t('fallback')}<span className="hs-muted"> · {t('fallbackDesc')}</span></span></label>}
        <div className="hs-grid hs-depths"><label className="hs-field"><span>{t('strength')}</span><select value={draft.searchDepth} onChange={event => change('searchDepth', event.target.value)}>
          {(['basic', 'advanced', 'fast', 'ultra-fast'] as const).map(value => <option key={value} value={value}>{t(value === 'ultra-fast' ? 'ultraFast' : value)}</option>)}</select></label>
          <label className="hs-field"><span>{t('exaStrength')}</span><select value={draft.exaSearchType} onChange={event => change('exaSearchType', event.target.value)}>{(['lite', 'auto', 'deep'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div>
        <label className="hs-check"><input type="checkbox" checked={draft.allowModelDepth} onChange={event => change('allowModelDepth', event.target.checked)} /><span>{t('modelDepth')}</span><span className="hs-lock">{t(draft.allowModelDepth ? 'modelAllowed' : 'locked')}</span></label>
      </section>
      <section className="hs-section"><div className="hs-section-heading"><h3>{t('budget')}</h3></div><div className="hs-grid hs-budget-grid">
        <NumberField label={t('turnRequests')} field="turnMaxRequests" settings={draft} change={change} t={t} /><NumberField label={t('turnCredits')} field="turnMaxTavilyCredits" settings={draft} change={change} t={t} />
        <NumberField label={t('dailyRequests')} field="dailyMaxRequests" settings={draft} change={change} t={t} /><NumberField label={t('results')} field="maxResults" settings={draft} change={change} t={t} />
      </div></section>
    </fieldset>
    <section className="hs-section hs-sources"><div className="hs-section-heading"><h3>{t('providers')}</h3><span className="hs-muted">{t('sourceCount')} {draft.providers.length}</span></div>
      {!draft.providers.length && <div className="hs-alert" role="status">{t('noSource')}</div>}
      <div className="hs-provider-list">{ordered.map(provider => <article key={provider.id} className={`hs-provider hs-${provider.id}${draft.providers.includes(provider.id) ? '' : ' hs-provider-off'}`}>
        <div className="hs-provider-head"><div className="hs-provider-title"><span className="hs-logo">{initials[provider.id]}</span><strong>{names[provider.id]}</strong><span className={`hs-badge${provider.configured ? ' hs-configured' : ''}`}>{t(provider.configured ? provider.source === 'legacy-config' ? 'legacy' : provider.source === 'process' || provider.source?.includes('env') ? 'environment' : 'stored' : 'notConfigured')}</span></div>
          <div className="hs-provider-actions"><button className="hs-icon-button" title={t('moveUp')} aria-label={`${names[provider.id]} ${t('moveUp')}`} disabled={busy !== null || draft.providers.indexOf(provider.id) <= 0} onClick={() => move(provider.id, -1)}><Icon kind="up" /></button>
            <button className="hs-icon-button" title={t('moveDown')} aria-label={`${names[provider.id]} ${t('moveDown')}`} disabled={busy !== null || !draft.providers.includes(provider.id) || draft.providers.indexOf(provider.id) >= draft.providers.length - 1} onClick={() => move(provider.id, 1)}><Icon kind="down" /></button>
            <input type="checkbox" aria-label={`${names[provider.id]} ${t('sourceOn')}`} checked={draft.providers.includes(provider.id)} disabled={busy !== null || !accepted.writable} onChange={() => toggleProvider(provider.id)} /></div></div>
        <div className="hs-provider-body"><div className="hs-key-column"><label className="hs-field"><span>{t('key')}</span><input type="password" autoComplete="off" spellCheck={false} aria-label={`${names[provider.id]} API Key`} value={keys[provider.id]}
          placeholder={t(provider.configured ? 'keepKey' : 'keyPlaceholder')} disabled={busy !== null} onChange={event => {
            setKeys(current => ({ ...current, [provider.id]: event.target.value })); setMessages(current => ({ ...current, [provider.id]: undefined }));
          }} /></label>
          <div className="hs-button-row"><button className="hs-button hs-primary" disabled={busy !== null || !keys[provider.id].trim()} onClick={() => void providerAction(provider, 'save-key')}>{t('saveKey')}</button>
            <button className="hs-button" disabled={busy !== null || (!provider.configured && !keys[provider.id].trim())} onClick={() => void providerAction(provider, 'test')}>{busy === `${provider.id}:test` ? t('testing') : t(provider.id === 'tavily' ? 'test' : 'testSearch')}</button></div>
          {messages[provider.id] && <div className={messages[provider.id]!.error ? 'hs-message hs-error' : 'hs-message hs-success'} role={messages[provider.id]!.error ? 'alert' : 'status'}>{messages[provider.id]!.text}</div>}
          <div className="hs-key-links"><button className="hs-text-button" disabled={busy !== null || !provider.configured} onClick={() => void providerAction(provider, 'delete-key')}>{t('removeKey')}</button><a href={provider.dashboard} target="_blank" rel="noreferrer">{t('dashboard')} <Icon kind="link" /></a></div>
          <NumberField label={`${t('monthlyLocal')} · ${provider.id === 'tavily' ? 'credits' : t('requests')}`} field={`${provider.id}MonthlyLimit`} settings={draft} change={change} t={t} disabled={busy !== null || !accepted.writable} />
        </div><div className="hs-usage-column"><Usage provider={provider} t={t} /><button className="hs-text-button hs-refresh-usage" disabled={busy !== null || !provider.configured} onClick={() => void providerAction(provider, 'usage')}><Icon kind="refresh" spin={busy === `${provider.id}:usage`} />{t(provider.id === 'tavily' ? 'refreshUsage' : 'refreshLocal')}</button></div></div>
      </article>)}</div>
      <p className="hs-meta hs-local-note">{t('localOnly')} · {t('zeroUnlimited')}</p>
    </section>
    <fieldset className="hs-fieldset" disabled={busy !== null || !accepted.writable}><details className="hs-section hs-more"><summary>{t('more')}</summary><div className="hs-grid">
      <label className="hs-field"><span>{t('topic')}</span><select value={draft.topic} onChange={event => change('topic', event.target.value)}>{(['general', 'news', 'finance'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
      <label className="hs-field"><span>{t('timeRange')}</span><select value={draft.timeRange ?? ''} onChange={event => change('timeRange', event.target.value || undefined)}><option value="">{t('anytime')}</option>{(['day', 'week', 'month', 'year'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>
      {(['includeDomains', 'excludeDomains'] as const).map(field => <label className="hs-field" key={field}><span>{t(field)}</span><textarea placeholder={t('domainsPlaceholder')} rows={3} value={draft[field].join('\n')} onChange={event => change(field, event.target.value.split('\n'))} />{domainsInvalid && <span className="hs-error">{t('invalidDomains')}</span>}</label>)}
      {([['cacheTtlSeconds', 'cache'], ['timeoutMs', 'timeout'], ['chunksPerSource', 'chunks'], ['braveMinIntervalMs', 'braveInterval']] as [keyof Settings, Key][]).map(([field, label]) => <NumberField key={field} label={t(label)} field={field} settings={draft} change={change} t={t} />)}
    </div><label className="hs-check"><input type="checkbox" checked={draft.includeAnswer} onChange={event => change('includeAnswer', event.target.checked)} /><span>{t('answer')}</span></label></details></fieldset>
    <div className={`hs-save-bar${dirty ? ' hs-save-bar-sticky' : ''}`}><span className="hs-muted" role="status">{dirty ? t('unsaved') : notice}</span><div className="hs-button-row"><button className="hs-button" disabled={!dirty || busy !== null} onClick={() => { setDirty(false); setError(''); }}>{t('discard')}</button>
      <button className="hs-button hs-primary" disabled={!dirty || busy !== null || invalidFields > 0 || domainsInvalid || !accepted.writable} onClick={() => void save()}>{busy === 'settings' ? t('saving') : t('save')}</button></div></div>
  </div>;
}
