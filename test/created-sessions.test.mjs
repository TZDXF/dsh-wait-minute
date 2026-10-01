import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { initialTitle, openCreatedSessions } from '../src/created-sessions.js';
import { createHandler } from '../src/index.js';

function fixture() {
  const records = {}, titles = new Map(), trace = [];
  const unit = { loadAll: async () => ({ tables: { created: { ...records } } }),
    putRecord: async (table, id, row) => { trace.push('created-persisted'); records[id] = row; }, close: async () => {} };
  const session = { id: 'blank-first' };
  const ctx = { storage: { backend: { names: () => ['json'], get: () => ({ kv: { open: async () => unit } }) } },
    sessionTitle: { get: s => titles.get(s.id), rename(s, title) { trace.push('title-created'); titles.set(s.id, { title }); } },
    sessions: { flush: async () => { trace.push('session-flushed'); return true; } },
    sessionController: { resolveAgent: async () => ({ agent: { session } }) },
    connection: { requestRejection: () => undefined },
    outbox: { create: async input => { trace.push('outbox-persisted'); return { id: 't', message: input.message,
      scheduledAt: '2030-01-01T00:00:00Z', status: 'active' }; } } };
  return { ctx, records, titles, trace, session };
}
async function invoke(ctx, registry, body) {
  const req = Readable.from([JSON.stringify(body)]); req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
  const res = { writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
  await createHandler(ctx, ctx.outbox, registry)(req, res); return res;
}

test('title is generated from delayed content without a model prompt', () => {
  assert.equal(initialTitle('  明天\n帮我整理项目  '), '延迟 · 明天 帮我整理项目');
  assert.equal(Array.from(initialTitle('😀'.repeat(100))).length, Array.from('延迟 · ').length + 36);
});

test('successful first delay persists created state and title only after outbox acceptance', async () => {
  const f = fixture(), registry = await openCreatedSessions(f.ctx);
  const res = await invoke(f.ctx, registry, { action: 'create', sessionId: 'blank-first', message: '整理项目', hours: 0, minutes: 5 });
  assert.equal(res.status, 201); assert.equal(res.body.sessionCreated.sessionId, 'blank-first');
  assert.equal(f.titles.get('blank-first').title, '延迟 · 整理项目');
  assert.deepEqual(f.trace, ['outbox-persisted', 'title-created', 'created-persisted', 'session-flushed']);
  assert.equal(registry.list().length, 1);
});

test('created state survives task cancellation and registry reopen', async () => {
  const f = fixture(); let registry = await openCreatedSessions(f.ctx);
  await registry.promote(f.session, 'first'); await registry.close();
  // Markers live in their own table, not in Schedule task storage.
  registry = await openCreatedSessions(f.ctx);
  assert.equal(registry.list()[0].sessionId, 'blank-first');
  await registry.promote(f.session, 'later');
  assert.equal(f.titles.get('blank-first').title, '延迟 · first');
});

test('explicit titles are not overwritten', async () => {
  const f = fixture(); f.titles.set(f.session.id, { title: 'My project' });
  const registry = await openCreatedSessions(f.ctx); await registry.promote(f.session, 'do something');
  assert.equal(f.titles.get(f.session.id).title, 'My project');
  assert.ok(!f.trace.includes('title-created'));
});

test('failed scheduling does not mark or title the blank session', async () => {
  const f = fixture(), registry = await openCreatedSessions(f.ctx);
  f.ctx.outbox.create = async () => { throw new Error('offline'); };
  const res = await invoke(f.ctx, registry, { action: 'create', sessionId: 'blank-first', message: 'first', hours: 0, minutes: 5 });
  assert.equal(res.status, 400); assert.equal(registry.list().length, 0); assert.equal(f.titles.size, 0);
});

test('metadata failure after outbox persistence warns without pretending outbox failed', async () => {
  const f = fixture(), registry = await openCreatedSessions(f.ctx);
  f.ctx.sessions.flush = async () => { throw new Error('flush failed'); };
  const res = await invoke(f.ctx, registry, { action: 'create', sessionId: 'blank-first', message: 'first', hours: 0, minutes: 5 });
  assert.equal(res.status, 201); assert.equal(res.body.task.id, 't'); assert.match(res.body.warning, /请勿重复发送/);
  f.ctx.sessions.flush = async () => true;
  const restored = await invoke(f.ctx, registry, { action: 'created' });
  assert.equal(restored.body.sessions.length, 1);
});

test('missing session is rejected before creating a delayed task', async () => {
  const f = fixture(), registry = await openCreatedSessions(f.ctx);
  f.ctx.sessionController.resolveAgent = async () => ({ error: { message: 'not found' } });
  const res = await invoke(f.ctx, registry, { action: 'create', sessionId: 'missing', message: 'first', hours: 0, minutes: 5 });
  assert.equal(res.status, 400); assert.equal(f.trace.length, 0);
});

const bridgeExports = {};
vm.runInNewContext(await readFile(new URL('../src/client-sessions.js', import.meta.url), 'utf8'), { exports: bridgeExports });
function clientFixture() {
  const listeners = new Set();
  let list = { byId: { created: { id: 'created', blank: true }, empty: { id: 'empty', blank: true } } };
  const calls = [];
  const sessions = { list: { getSnapshot: () => list, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } },
    manager: { get: id => ({ sessionId: id, handleBlank: value => { calls.push(['blank', id, value]); },
      options: { onEngaged(session) { calls.push(['engaged', session.sessionId]);
        list = { ...list, byId: { ...list.byId, [id]: { ...list.byId[id], blank: false } } };
        for (const fn of listeners) fn(); } } }) } };
  return { sessions, calls, listeners, get: () => list,
    reset() { list = { ...list, byId: { ...list.byId, created: { id: 'created', blank: true } } }; for (const fn of listeners) fn(); } };
}

test('created session is visible and excluded from New Session reuse; unrelated blank remains reusable', () => {
  const f = clientFixture(), bridge = bridgeExports.createSessionEngagementBridge(f.sessions);
  bridge.markCreated([{ sessionId: 'created', title: 'title' }]);
  assert.equal(f.get().byId.created.blank, false); assert.equal(f.get().byId.empty.blank, true);
  const reusable = Object.values(f.get().byId).filter(row => row.blank).map(row => row.id);
  assert.deepEqual(reusable, ['empty']);
  assert.deepEqual(f.calls, [['blank', 'created', false], ['engaged', 'created']]);
});

test('saved delayed engagement reapplies after reconnect without fake turns or prompt submission', () => {
  const f = clientFixture(), bridge = bridgeExports.createSessionEngagementBridge(f.sessions);
  bridge.markCreated([{ sessionId: 'created' }]); f.reset();
  assert.equal(f.get().byId.created.blank, false); assert.equal(f.calls.length, 4);
  bridge.dispose(); assert.equal(f.listeners.size, 0);
});
