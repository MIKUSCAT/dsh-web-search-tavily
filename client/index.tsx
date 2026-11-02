import React, { useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { App } from './App';
import { zh, en, type Key } from './locales';
import type { Api, Settings } from './types';
import css from './style.css';

export const NS = 'dshHybridSearch';
export const inject = ['slots', 'locale', 'configForms', 'connection'];
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { dshHybridSearch: Key }
}

export function apply(ctx: Context & { connection: ConnectionHandle }) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'Hybrid search translations');
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.dshHybridSearch = 'true';
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, 'Hybrid search stylesheet');
  const t = ctx.locale.bind(NS);
  const api: Api = async <T,>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) => {
    const result = await ctx.connection.rpc.call('/api', `hybrid-search/${method}`, payload, signal);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value as T;
  };
  const form = ctx.configForms.get<Settings>('web-search-tavily');
  const selection = ctx.configForms.get<{ searchProvider?: string }>('web');
  const ConnectedPanel = () => {
    const state = useSyncExternalStore(listener => selection.subscribe(listener), () => selection.getSnapshot(), () => selection.getSnapshot());
    return <App form={form} api={api} t={t} isActive={state.value?.searchProvider === 'hybrid-search'}
      activate={state.writable ? async () => {
        if (!await selection.set('searchProvider', 'hybrid-search')) throw Object.assign(new Error('Config conflict'), { code: 'WEB_CONFIG_CONFLICT' });
      } : undefined} />;
  };
  const Panel = ({ view }: PluginConfigViewProps) => view === 'summary' ? <span>{t('summary')}</span> : <ConnectedPanel />;
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: 'dsh-web-search-tavily', locale: NS }, Panel));
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config',
    key: 'dsh-web-search-tavily#web-search-tavily', locale: NS }, Panel));
}
