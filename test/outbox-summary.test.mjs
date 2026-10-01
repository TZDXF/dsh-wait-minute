import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createOutbox } from '../src/outbox.js';
import { createHandler } from '../src/index.js';
async function fixture(send = async () => ({ accepted: true })) {
  let id = 0;
  const unit = { loadAll: async () => ({ tables: {} }), putRecord: async () => {}, deleteRecord: async () => {}, close: async () => {} };
  const outbox = await createOutbox({ unit, send, now: () => Date.parse('2030-01-01T00:00:00Z'),
    uuid: () => String(++id), setTimer: () => 1, clearTimer: () => {} });
  return { outbox, add: (sessionId, minutes = 5) => outbox.create({ sessionId, message: 'private message', hours: 0, minutes }) };
}
async function invoke(ctx, outbox, input) {
  const req = Readable.from([JSON.stringify(input)]); req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await createHandler(ctx, outbox)(req, res); return res;
}
test('summary groups pending rows per session using earliest deadline and never exposes messages', async () => {
  const f = await fixture(); await f.add('a', 10); const earliest = await f.add('a', 2); await f.add('b');
  const rows = f.outbox.summary(); assert.equal(rows.length, 2);
  const a = rows.find(row => row.sessionId === 'a'); assert.equal(a.count, 2); assert.equal(a.scheduledAt, earliest.scheduledAt);
  assert.deepEqual(Object.keys(a).sort(), ['count', 'scheduledAt', 'sendingCount', 'sessionId', 'uncertainCount']);
  assert.ok(!JSON.stringify(rows).includes('private message')); await f.outbox.close();
});
test('last cancellation or confirmed immediate send removes delayed state entirely', async () => {
  const f = await fixture(), a = await f.add('a'), b = await f.add('b');
  await f.outbox.cancel('a', a.id); assert.equal(f.outbox.summary().some(row => row.sessionId === 'a'), false);
  await f.outbox.sendNow('b', b.id); assert.deepEqual(f.outbox.summary(), []); await f.outbox.close();
});
test('uncertain result remains visible as delayed state without faking native execution', async () => {
  const f = await fixture(async () => { throw new Error('uncertain'); }), a = await f.add('a');
  await assert.rejects(f.outbox.sendNow('a', a.id));
  const state = f.outbox.summary()[0]; assert.equal(state.count, 1); assert.equal(state.uncertainCount, 1); assert.equal(state.sendingCount, 0);
  assert.equal(state.phase, undefined); await f.outbox.close();
});
test('summary API is authenticated and does not require a current session id', async () => {
  const f = await fixture(); await f.add('other');
  const res = await invoke({ connection: { requestRejection: () => undefined } }, f.outbox, { action: 'summary' });
  assert.equal(res.status, 200); assert.equal(res.body.sessions[0].sessionId, 'other'); await f.outbox.close();
});
test('unauthenticated summary never reads another session state', async () => {
  const outbox = { summary: () => assert.fail('unauthenticated state read') };
  const res = await invoke({ connection: { requestRejection: () => 401 } }, outbox, { action: 'summary' }); assert.equal(res.status, 401);
});
