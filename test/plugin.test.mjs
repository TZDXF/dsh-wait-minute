import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequest, delaySeconds } from '../src/domain.js';
import { createOutbox } from '../src/outbox.js';
import { apply, createHandler, inject } from '../src/index.js';

test('converts hours and minutes exactly', () => {
  assert.equal(delaySeconds(1, 30), 5400); assert.equal(delaySeconds(0, 1), 60);
  assert.equal(delaySeconds(8760, 59), 31539540);
});
test('rejects zero, negative, decimal, strings and out-of-range time', () => {
  for (const [h, m] of [[0, 0], [-1, 0], [1.2, 0], [0, 60], [0, -1], [8761, 0], ['1', 0], [0, NaN]]) assert.throws(() => delaySeconds(h, m));
});
test('validates but preserves literal delayed message content', () => {
  assert.deepEqual(createRequest({ sessionId: 's', message: '  hello\nworld  ', hours: 1, minutes: 30 }),
    { sessionId: 's', message: '  hello\nworld  ', seconds: 5400 });
  for (const message of ['', ' \n', 'x'.repeat(10001), null]) assert.throws(() => createRequest({ sessionId: 's', message, hours: 1, minutes: 0 }));
});
function request(body, { method = 'POST', type = 'application/json' } = {}) {
  const req = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
  req.method = method; req.headers = { 'content-type': type }; return req;
}
function response() { return { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } }; }
async function fixture(rejection) {
  let sequence = 0, writes = 0; const sent = [];
  const unit = { loadAll: async () => ({ tables: { messages: {} } }), putRecord: async () => { writes++; }, deleteRecord: async () => {}, close: async () => {} };
  const now = Date.parse('2030-01-01T00:00:00Z');
  const outbox = await createOutbox({ unit, now: () => now, uuid: () => String(++sequence), setTimer: () => 1, clearTimer: () => {},
    send: async row => { sent.push(row.message); return { accepted: true }; } });
  const ctx = { connection: { requestRejection: () => rejection },
    sessionController: { resolveAgent: async id => ({ agent: { session: { id } } }) } };
  Object.defineProperty(ctx, 'schedule', { get() { assert.fail('must not access Schedule'); } });
  return { ctx, unit, outbox, sent, now, writes: () => writes, handler: createHandler(ctx, outbox) };
}
async function invoke(f, body, options) { const res = response(); await f.handler(request(body, options), res); return res; }
async function add(f, sessionId = 's', message = 'hello') {
  return invoke(f, { action: 'create', sessionId, message, hours: 1, minutes: 30 });
}

test('authentication blocks all operations before touching outbox', async () => {
  for (const status of [401, 403]) {
    const f = await fixture(status);
    const res = await add(f); assert.equal(res.status, status); assert.equal(f.writes(), 0);
  }
});
test('creates, lists and cancels a message without automation registration', async () => {
  assert.ok(!inject.includes('schedule'));
  const f = await fixture(), created = await add(f);
  assert.equal(created.status, 201); assert.equal(created.body.task.status, 'active');
  assert.equal(Date.parse(created.body.task.scheduledAt), f.now + 5400000);
  assert.equal((await invoke(f, { action: 'list', sessionId: 's' })).body.tasks[0].message, 'hello');
  assert.equal((await invoke(f, { action: 'cancel', sessionId: 's', id: created.body.task.id })).status, 200);
  assert.deepEqual((await invoke(f, { action: 'list', sessionId: 's' })).body.tasks, []);
  assert.equal(f.sent.length, 0);
});
test('editing preserves deadline unless new duration is supplied; Send Now sends edited text once', async () => {
  const f = await fixture(), created = (await add(f)).body.task;
  let result = await invoke(f, { action: 'update', sessionId: 's', id: created.id, message: 'edited' });
  assert.equal(result.status, 200); assert.equal(result.body.task.scheduledAt, created.scheduledAt);
  result = await invoke(f, { action: 'update', sessionId: 's', id: created.id, message: 'edited again', hours: 0, minutes: 5 });
  assert.equal(Date.parse(result.body.task.scheduledAt), f.now + 300000);
  result = await invoke(f, { action: 'sendNow', sessionId: 's', id: created.id });
  assert.equal(result.body.sent, true); assert.deepEqual(f.sent, ['edited again']);
  assert.equal((await invoke(f, { action: 'sendNow', sessionId: 's', id: created.id })).body.sent, true);
  assert.equal(f.sent.length, 1); assert.equal(f.outbox.list('s').length, 0);
});
test('cross-session edit/cancel/immediate-send are rejected', async () => {
  const f = await fixture(), own = (await add(f)).body.task;
  await add(f, 'other', 'other message');
  assert.equal(f.outbox.list('s').length, 1);
  for (const action of ['update', 'cancel', 'sendNow']) {
    assert.equal((await invoke(f, { action, sessionId: 'other', id: own.id, message: 'stolen' })).status, 400);
  }
  assert.equal(f.sent.length, 0);
});
test('invalid requests never create messages', async () => {
  const f = await fixture();
  for (const body of ['{', 'null', '[]', 'x'.repeat(50000)]) assert.equal((await invoke(f, body)).status, 400);
  assert.equal((await invoke(f, {}, { method: 'GET' })).status, 405);
  assert.equal((await invoke(f, {}, { type: 'text/plain' })).status, 400);
  assert.equal((await invoke(f, { action: 'create', sessionId: 's', message: 'hello', hours: 0, minutes: 0 })).status, 400);
  assert.equal(f.writes(), 0);
});
test('outbox storage failures are not reported as success', async () => {
  const f = await fixture(); f.unit.putRecord = async () => { throw new Error('storage unavailable'); };
  const res = await add(f); assert.equal(res.status, 400); assert.equal(res.body.error, 'storage unavailable');
});
test('declares the exact JSON backend lifecycle dependency', () => {
  assert.ok(inject.includes('storage.backend.json'));
});
test('host lifecycle opens isolated outbox and closes both storage units; never uses Schedule', async () => {
  let route, disposed = false; const closed = [], disposers = [], descriptors = [];
  const ctx = { connection: {}, sessionController: { prompt: async () => ({ accepted: true }) },
    storage: { backend: { names: () => ['json'], get: name => (assert.equal(name, 'json'), { kv: { open: async descriptor => {
      assert.match(descriptor.name, /^[a-z][a-z0-9_]*$/, 'unit names must match the real JSON backend contract');
      for (const table of descriptor.tables) assert.match(table, /^[a-z][a-z0-9_]*$/, 'table names must match the real JSON backend contract');
      descriptors.push(descriptor); return { loadAll: async () => ({ tables: {} }), close: async () => closed.push(descriptor.name) };
    } } }) } }, effect: fn => disposers.push(fn()), webServer: { register: value => { if (value.path === '/api/wait-minute/outbox-v1') route = value; return () => { disposed = true; }; } } };
  Object.defineProperty(ctx, 'schedule', { get() { assert.fail('no automation access'); } });
  await apply(ctx); assert.equal(route.path, '/api/wait-minute/outbox-v1');
  assert.deepEqual(descriptors.map(d => d.name), ['wait_minute_created_sessions', 'wait_minute_outbox']);
  for (const dispose of [...disposers].reverse()) await dispose();
  assert.ok(disposed); assert.equal(closed.length, 2);
});
test('client bundle registers composer control and delayed message queue', async () => {
  let descriptor;
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { descriptor = value; } } } });
  const client = descriptor.factory(name => { assert.equal(name, 'react'); return { createElement: (type, props) => ({ type, props }) }; });
  const entries = new Map();
  client.apply({ sessions: { list: { subscribe: () => () => {} } }, effect: () => {}, slots: {
    inject: (slot, fn) => fn(), register: (value, component) => { entries.set(value.name, { value, component }); return () => {}; }
  } });
  assert.equal(entries.get('conversation.input.dock').value.id, 'wait-minute');
  assert.equal(entries.get('conversation.input.dock').component({ sessionId: 's' }).props.key, 's');
  assert.ok(entries.has('conversation.input.activity'));
});
