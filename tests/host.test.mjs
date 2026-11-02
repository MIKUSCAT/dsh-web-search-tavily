import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import { WebRuntime } from '@deepseek-ai/dsh-web';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as WebTools from '@deepseek-ai/dsh-tool-web';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment';
import { createScope } from '@deepseek-ai/dsh-scope';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Plugin from '../index.mjs';
import { json, tavilyResult } from './helpers.mjs';

async function host(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-hybrid-host-'));
  const root = new Context();
  const boundary = { lastTurn: 1, openTurnStartSeq: 0 };
  root.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: directory, TAVILY_API_KEY: 'environment-test-key' } }]));
  root.provide('sessionProjections', { stateOf: () => boundary });
  await root.plugin(Credentials, { dshHome: directory, watch: false });
  await root.plugin(SystemPrompt, {});
  await root.plugin(ToolRuntime, {});
  await root.plugin(WebRuntime, { searchProvider: 'hybrid-search' });
  await root.plugin(WebTools, { fetch: false });
  await root.plugin(Connection, {});
  // Like the desktop host, the Typert gateway owns the single shared /api interceptor.
  root.connection.rpc.intercept('/api', endpoint => endpoint.startsWith('gateway-test/'), async () => ({ ok: true, value: 'gateway' }));
  const plugin = await root.plugin(Plugin, options);
  const bridge = root.connection.createSharedFetchHandler('/api');
  const client = new Context();
  await client.plugin({ apply: ctx => installConnection(ctx, { interactions: 'none', transport: {
    fetch: (input, init) => bridge.fetch(new Request(new URL(input, 'http://dsh.test/'), init), root.connection.browserPeer)
  } }) });
  const agent = { id: SessionId('test-session'), session: Session.create(SessionId('test-session')) };
  const scope = createScope(root, agent); agent.ctx = scope.ctx;
  const call = (name, args, id) => root.tools.execute({ name, arguments: args, callId: id, agent, signal: new AbortController().signal });
  t.after(async () => { await client.fiber.dispose(); await root.fiber.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { root, client, directory, plugin, call, boundary };
}

test('real DSH Connection carrier saves keys into the real credential store and overrides the launch environment', async t => {
  const ambientBefore = process.env.TAVILY_API_KEY;
  const { root, client, directory } = await host(t);
  const saved = await client.get('connection').rpc.call('/api', 'hybrid-search/save-key', { provider: 'tavily', value: 'managed-test-key' });
  assert.equal(saved.ok, true); assert.equal(saved.value.providers[0].source, 'file');
  assert.equal((await root.credentials.resolve('TAVILY_API_KEY')).value, 'managed-test-key');
  assert.match(await readFile(join(directory, '.credentials.yaml'), 'utf8'), /managed-test-key/);
  assert.doesNotMatch(JSON.stringify(saved), /managed-test-key|environment-test-key/);
  assert.ok(process.env.TAVILY_API_KEY === ambientBefore, 'The plugin must not change process environment variables.');
  const status = await client.get('connection').rpc.call('/api', 'hybrid-search/status', {});
  assert.equal(status.ok, true);
  assert.deepEqual(await client.get('connection').rpc.call('/api', 'gateway-test/ping', {}), { ok: true, value: 'gateway' });
});

test('real native web_search query batches and both direct tools share a per-turn budget without losing successful sources', async t => {
  const { call, boundary } = await host(t, { turnMaxRequests: 2, cacheTtlSeconds: 0 });
  let sent = 0;
  t.mock.method(globalThis, 'fetch', async () => { sent++; return json(tavilyResult()); });
  const batch = await call('web_search', { queries: ['one', 'two', 'three', 'four'] }, 'batch');
  assert.equal(batch.isError, false);
  assert.equal(sent, 2);
  assert.ok(batch.value.sources.length > 0);
  const limited = await call('tavily_search', { query: 'five' }, 'legacy');
  assert.equal(limited.isError, false); assert.match(limited.value.content, /budget/); assert.equal(sent, 2);
  boundary.lastTurn = 2; boundary.openTurnStartSeq = 100;
  const next = await call('hybrid_search', { query: 'new turn' }, 'hybrid');
  assert.equal(next.isError, false); assert.equal(sent, 3);
});

test('unloading the plugin unregisters native tools and its management endpoint', async t => {
  const { root, client, plugin } = await host(t);
  assert.ok(root.tools.get('hybrid_search'));
  await plugin.dispose();
  assert.equal(root.tools.get('hybrid_search'), undefined);
  await assert.rejects(client.get('connection').rpc.call('/api', 'hybrid-search/status', {}), /404/);
});
