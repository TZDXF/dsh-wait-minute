import test from 'node:test';
import assert from 'node:assert/strict';
import { openCreatedSessions } from '../src/created-sessions.js';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(initial) {
  let snapshot = initial, sequence = initial?.eventSeq ?? 0, closed = false;
  const records = {}, renamed = [], published = deferred(); let putGate;
  const unit = { loadAll: async () => ({ tables: { created: {} } }),
    putRecord: async (_, id, row) => { if (putGate) await putGate; records[id] = structuredClone(row); }, close: async () => { closed = true; } };
  const ctx = { storage: { backend: { get: name => { assert.equal(name, 'json'); return { kv: { open: async () => unit } }; } } },
    sessionTitle: { get: () => snapshot, rename(_, title) { snapshot = { title, eventSeq: ++sequence }; renamed.push(title); published.resolve(snapshot); return snapshot; } },
    sessions: { flush: async () => true } };
  Object.defineProperty(ctx, 'sessionController', { get() { assert.fail('title generation cannot send a main conversation prompt'); } });
  return { ctx, records, renamed, published, session: { id: 'new' }, current: () => snapshot,
    setPutGate: value => { putGate = value; }, closed: () => closed };
}
test('preview publishes before disk wait; accepted create does not wait for formal model title', async () => {
  const f = fixture(), disk = deferred(), model = deferred(); f.setPutGate(disk.promise);
  const registry = await openCreatedSessions(f.ctx, { generate: () => model.promise });
  const accepting = registry.promote(f.session, '整理需求');
  await f.published.promise;
  assert.equal(f.current().title, '延迟 · 整理需求'); assert.equal(Object.keys(f.records).length, 0);
  disk.resolve(); const row = await accepting;
  assert.equal(row.title, '延迟 · 整理需求');
  model.resolve('需求整理'); await registry.whenIdle();
  assert.equal(f.current().title, '需求整理'); assert.equal(f.records.new.title, '需求整理');
  assert.equal(registry.list()[0].titleStatus, 'generated'); await registry.close();
});
test('title provider failure keeps preview and does not undo accepted creation', async () => {
  const f = fixture(), registry = await openCreatedSessions(f.ctx, { generate: async () => { throw new Error('offline'); } });
  const row = await registry.promote(f.session, '消息'); await registry.whenIdle();
  assert.equal(row.title, '延迟 · 消息'); assert.equal(f.current().title, row.title); assert.equal(registry.list().length, 1);
  await registry.close();
});
test('manual rename, even to identical preview text, supersedes background title refinement', async () => {
  const f = fixture(), model = deferred(), registry = await openCreatedSessions(f.ctx, { generate: () => model.promise });
  const row = await registry.promote(f.session, '消息');
  f.ctx.sessionTitle.rename(f.session, row.title); model.resolve('模型标题'); await registry.whenIdle();
  assert.equal(f.current().title, row.title); assert.equal(f.renamed.length, 2); await registry.close();
});
test('existing ordinary or explicitly named session is never regenerated', async () => {
  const f = fixture({ title: '我的项目', eventSeq: 5 }); let calls = 0;
  const registry = await openCreatedSessions(f.ctx, { generate: async () => { calls++; return '模型标题'; } });
  await registry.promote(f.session, '新的延迟消息'); await registry.whenIdle();
  assert.equal(calls, 0); assert.equal(f.current().title, '我的项目'); assert.equal(f.renamed.length, 0); await registry.close();
});
test('empty initial snapshot does not prevent prompt-time preview and formal title generation', async () => {
  const f = fixture({ title: '', eventSeq: 0 }), registry = await openCreatedSessions(f.ctx, { generate: async () => '及时标题' });
  await registry.promote(f.session, '内容'); await registry.whenIdle();
  assert.deepEqual(f.renamed, ['延迟 · 内容', '及时标题']); await registry.close();
});
test('bounded timeout settles a non-cooperating provider while retaining preview', async () => {
  const f = fixture(); let signal;
  const registry = await openCreatedSessions(f.ctx, { titleTimeoutMs: 10, generate: async (_, __, value) => {
    signal = value; return new Promise(() => {});
  } });
  await registry.promote(f.session, '超时'); await registry.whenIdle();
  assert.equal(signal.aborted, true); assert.equal(f.current().title, '延迟 · 超时'); await registry.close();
});
test('disposal aborts in-flight title request and closes its store without later rename', async () => {
  const f = fixture(), registry = await openCreatedSessions(f.ctx, { generate: () => new Promise(() => {}) });
  await registry.promote(f.session, '内容'); await registry.close();
  assert.equal(f.closed(), true); assert.equal(f.renamed.length, 1);
});
test('registry stores the title normalized by the native title service rather than raw model output', async () => {
  const f = fixture(), rename = f.ctx.sessionTitle.rename;
  f.ctx.sessionTitle.rename = (session, title) => rename(session, title.slice(0, 10));
  const registry = await openCreatedSessions(f.ctx, { generate: async () => 'abcdefghijklmnop' });
  await registry.promote(f.session, '内容'); await registry.whenIdle();
  assert.equal(f.records.new.title, 'abcdefghij'); assert.equal(f.current().title, 'abcdefghij'); await registry.close();
});
