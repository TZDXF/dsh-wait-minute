import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
function fixture(engine, body = {}) {
  const exports = {}, calls = [];
  vm.runInNewContext(source, { exports, require: () => ({ createElement() {} }), fetch: async (url, options) => {
    calls.push({ url, input: JSON.parse(options.body) });
    return { ok: true, status: 200, headers: { get: () => engine }, json: async () => body };
  } });
  return { api: exports.api, calls };
}
test('old/missing engine blocks creation BEFORE mutating request', async () => {
  const f = fixture(null);
  await assert.rejects(f.api({ action: 'create', sessionId: 's', message: 'hello', hours: 0, minutes: 1 }), /旧版/);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.action, 'created');
});
test('all mutations preflight before dispatch, and exclusively use the independent versioned endpoint', async () => {
  for (const action of ['create', 'update', 'sendNow', 'cancel']) {
    const f = fixture('standalone-outbox-v1', { ok: true });
    await f.api({ action, sessionId: 's', id: 'm', message: 'hello' });
    assert.deepEqual(f.calls.map(c => c.input.action), ['created', action]);
    assert.ok(f.calls.every(c => c.url === '/api/wait-minute/outbox-v1'));
  }
});
test('read-only requests reject an incompatible engine instead of displaying an old Schedule queue', async () => {
  for (const action of ['created', 'list']) {
    const f = fixture('schedule');
    await assert.rejects(f.api({ action, sessionId: 's' }), /旧版/);
    assert.equal(f.calls.length, 1);
  }
});
test('ordinary matching backend response is preserved after engine validation', async () => {
  const body = { tasks: [{ id: 'm', message: 'original' }] }, f = fixture('standalone-outbox-v1', body);
  assert.equal(await f.api({ action: 'list', sessionId: 's' }), body);
});
