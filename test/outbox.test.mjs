import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox, openOutbox } from '../src/outbox.js';

const START = Date.parse('2030-01-01T00:00:00.000Z');
const clone = value => JSON.parse(JSON.stringify(value));
const input = (message = '  literal message\nsecond line  ', minutes = 1) => ({ sessionId: 'session-a', message, hours: 0, minutes });

function fixture(seed = {}) {
  const persisted = new Map(Object.entries(seed).map(([id, row]) => [id, clone(row)]));
  const timers = new Map(), sends = [], writes = [], events = [];
  let clock = START, counter = 0, timerCounter = 0, closes = 0;
  const env = {
    persisted, timers, sends, writes, events,
    putFailure: null, deleteFailure: null, sendImpl: async () => ({ accepted: true }), box: null,
    now: () => clock,
    advance(ms) { clock += ms; },
    setTimer(callback, delay) {
      const handle = { id: ++timerCounter, callback, delay, unrefCalled: false,
        unref() { this.unrefCalled = true; } };
      timers.set(handle.id, handle); return handle;
    },
    clearTimer(handle) { if (handle) timers.delete(handle.id); },
    timer() { assert.equal(timers.size, 1); return [...timers.values()][0]; },
    async fireTimer() {
      const handle = env.timer(); timers.delete(handle.id); handle.callback();
      // The explicitly queued pass joins behind the timer callback's FIFO pass.
      // No sleeps or timing polls are needed to observe both settling.
      await env.box.runDue();
    },
    closes: () => closes,
    newUnit() {
      return {
        loadAll: async () => ({ tables: { messages: Object.fromEntries([...persisted].map(([id, row]) => [id, clone(row)])) } }),
        async putRecord(table, id, row) {
          assert.equal(table, 'messages');
          events.push('put:' + row.state); writes.push(clone(row));
          if (env.putFailure?.(row)) throw new Error('fake put failure');
          persisted.set(id, clone(row));
        },
        async deleteRecord(table, id) {
          assert.equal(table, 'messages');
          if (env.deleteFailure) throw new Error('fake delete failure');
          persisted.delete(id);
        },
        async close() { closes++; }
      };
    },
    async open() {
      env.box = await createOutbox({ unit: env.newUnit(), now: env.now, setTimer: env.setTimer, clearTimer: env.clearTimer,
        uuid: () => 'uuid-' + (++counter),
        send: async row => { events.push('send'); sends.push(clone(row)); return env.sendImpl(row); } });
      return env.box;
    }
  };
  return env;
}
async function setup(t, seed) {
  const env = fixture(seed); await env.open();
  t.after(async () => { if (env.box) await env.box.close(); });
  return env;
}
function savedRow(overrides = {}) {
  return { id: 'delayed-message-seed', requestId: 'stable-request', sessionId: 'session-a', message: 'seed message',
    scheduledAt: new Date(START + 60000).toISOString(), createdAt: new Date(START).toISOString(), state: 'pending', ...overrides };
}

test('pending message persists and does not deliver before its due time', async t => {
  const env = await setup(t), box = env.box;
  const row = await box.create(input());
  assert.equal(row.status, 'active'); assert.equal(row.message, input().message);
  assert.equal(env.persisted.get(row.id).state, 'pending'); assert.equal(env.sends.length, 0);
  assert.equal(env.timer().delay, 60000); assert.equal(env.timer().unrefCalled, true);
  env.advance(59999); await box.runDue(); assert.equal(env.sends.length, 0);
  env.advance(1); await env.fireTimer();
  assert.equal(env.sends.length, 1); assert.equal(box.list('session-a').length, 0);
  assert.equal(env.persisted.get(row.id).state, 'sent');
});

test('injected delivery receives the exact unwrapped message and stable request identity', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  env.advance(60000); await env.box.runDue();
  assert.equal(env.sends[0].message, input().message);
  assert.equal(env.sends[0].sessionId, 'session-a'); assert.equal(env.sends[0].id, row.id);
  assert.equal(env.sends[0].requestId, env.persisted.get(row.id).requestId);
  assert.ok(!env.sends[0].message.includes('[SCHEDULE REMINDER]'));
  assert.deepEqual(env.events, ['put:pending', 'put:sending', 'send', 'put:sent']);
});

test('content-only edit preserves the original deadline and edited content is sent', async t => {
  const env = await setup(t); const original = await env.box.create(input('before', 5));
  env.advance(30000);
  const edited = await env.box.update({ sessionId: 'session-a', id: original.id, message: 'after\nedit' });
  assert.equal(edited.scheduledAt, original.scheduledAt);
  assert.equal(edited.message, 'after\nedit');
  assert.equal(env.timer().delay, 270000);
  await env.box.sendNow('session-a', original.id);
  assert.equal(env.sends[0].message, 'after\nedit');
});

test('time edit resets due time relative to the save clock', async t => {
  const env = await setup(t); const original = await env.box.create(input('before', 5));
  env.advance(45000);
  const edited = await env.box.update({ sessionId: 'session-a', id: original.id, message: 'edited', hours: 1, minutes: 2 });
  assert.equal(Date.parse(edited.scheduledAt), env.now() + 3720000);
  assert.equal(env.timer().delay, 3720000);
  assert.throws(() => env.box.update({ sessionId: 'session-a', id: original.id, message: 'edited', hours: 1 }), /分钟/);
  assert.throws(() => env.box.update({ sessionId: 'session-a', id: original.id, message: 'edited', hours: 0, minutes: 0 }), /至少/);
});

test('cancel removes a pending message and timer without delivering it', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  assert.deepEqual(await env.box.cancel('session-a', row.id), { deleted: true });
  assert.equal(env.persisted.has(row.id), false); assert.equal(env.timers.size, 0);
  env.advance(120000); await env.box.runDue(); assert.equal(env.sends.length, 0);
});

test('immediate send admits once, stores a tombstone and repeated retries remain idempotent', async t => {
  const env = await setup(t); const row = await env.box.create(input('send now', 30));
  assert.deepEqual(await env.box.sendNow('session-a', row.id), { sent: true, id: row.id });
  assert.equal(env.sends.length, 1); assert.equal(env.timers.size, 0);
  assert.deepEqual(await env.box.sendNow('session-a', row.id), { sent: true, id: row.id });
  env.advance(3600000); await env.box.runDue(); assert.equal(env.sends.length, 1);
  await assert.rejects(env.box.cancel('session-a', row.id), /已发送/);
  await assert.rejects(env.box.update({ sessionId: 'session-a', id: row.id, message: 'changed' }), /已发送/);
});

test('runDue and sendNow share a FIFO and cannot duplicate an admitted message', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  env.advance(60000);
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  env.sendImpl = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const due = env.box.runDue(); await entered;
  const immediate = env.box.sendNow('session-a', row.id);
  assert.equal(env.sends.length, 1);
  release({ accepted: true }); await due;
  assert.deepEqual(await immediate, { sent: true, id: row.id }); assert.equal(env.sends.length, 1);
});

test('pending rows survive restart and remain unsent until their deadline', async t => {
  const env = await setup(t); const row = await env.box.create(input('persisted', 5));
  await env.box.close(); env.box = null;
  env.advance(30000); await env.open();
  assert.equal(env.box.list('session-a')[0].id, row.id); assert.equal(env.timer().delay, 270000);
  await env.box.runDue(); assert.equal(env.sends.length, 0);
  env.advance(270000); await env.box.runDue(); assert.equal(env.sends.length, 1);
});

test('interrupted sending recovers as uncertain and never automatically resends', async t => {
  const raw = savedRow({ state: 'sending', scheduledAt: new Date(START - 1000).toISOString() });
  const env = await setup(t, { [raw.id]: raw });
  assert.equal(env.persisted.get(raw.id).state, 'uncertain');
  assert.match(env.box.list('session-a')[0].error, /结果不明确/);
  assert.equal(env.timers.size, 0);
  await env.box.runDue(); assert.equal(env.sends.length, 0);
  await assert.rejects(env.box.update({ sessionId: 'session-a', id: raw.id, message: 'new' }), /不能直接编辑/);
  await env.box.sendNow('session-a', raw.id);
  assert.equal(env.sends.length, 1); assert.equal(env.sends[0].requestId, raw.requestId);
});

test('cross-session list/edit/send/cancel cannot access another session message', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  assert.deepEqual(env.box.list('session-b'), []);
  await assert.rejects(env.box.update({ sessionId: 'session-b', id: row.id, message: 'stolen' }), /不属于/);
  await assert.rejects(env.box.sendNow('session-b', row.id), /不属于/);
  await assert.rejects(env.box.cancel('session-b', row.id), /不属于/);
  assert.equal(env.box.list('session-a')[0].message, input().message); assert.equal(env.sends.length, 0);
});

test('create persistence failure leaves no queued message or send', async t => {
  const env = await setup(t); env.putFailure = row => row.state === 'pending';
  await assert.rejects(env.box.create(input()), /put failure/);
  assert.equal(env.persisted.size, 0); assert.equal(env.box.list('session-a').length, 0);
  assert.equal(env.timers.size, 0); assert.equal(env.sends.length, 0);
});

test('intent persistence failure prevents sending, exposes error and stops zero-delay retries', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  env.putFailure = value => value.state === 'sending';
  await assert.rejects(env.box.sendNow('session-a', row.id), /put failure/);
  assert.equal(env.sends.length, 0); assert.equal(env.persisted.get(row.id).state, 'pending');
  assert.match(env.box.list('session-a')[0].error, /消息尚未发送/);
  assert.equal(env.timers.size, 0);
  env.advance(60000); await env.box.runDue(); assert.equal(env.sends.length, 0);
  const dueEnv = await setup(t); const dueRow = await dueEnv.box.create(input());
  dueEnv.putFailure = value => value.state === 'sending'; dueEnv.advance(60000);
  await dueEnv.box.runDue();
  assert.equal(dueEnv.sends.length, 0); assert.equal(dueEnv.persisted.get(dueRow.id).state, 'pending');
  assert.match(dueEnv.box.list('session-a')[0].error, /消息尚未发送/);
  assert.equal(dueEnv.timers.size, 0);
});

test('failed admission becomes uncertain, stops timers and does not block other due messages', async t => {
  const env = await setup(t); const bad = await env.box.create(input('bad')); const good = await env.box.create(input('good'));
  env.sendImpl = row => row.message === 'bad' ? Promise.reject(new Error('admission interrupted')) : Promise.resolve({ accepted: true });
  env.advance(60000); await env.box.runDue();
  assert.equal(env.persisted.get(bad.id).state, 'uncertain'); assert.equal(env.persisted.get(good.id).state, 'sent');
  assert.match(env.box.list('session-a')[0].error, /admission interrupted/);
  assert.equal(env.timers.size, 0);
  await env.box.runDue(); assert.equal(env.sends.length, 2);
});

test('accepted send state-save failure returns acknowledged warning instead of fake failure', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  env.putFailure = value => value.state === 'sent';
  const result = await env.box.sendNow('session-a', row.id);
  assert.equal(result.sent, true); assert.match(result.warning, /消息已提交/);
  assert.equal(env.box.list('session-a').length, 0); assert.equal(env.persisted.get(row.id).state, 'sending');
  const retried = await env.box.sendNow('session-a', row.id);
  assert.equal(retried.sent, true); assert.equal(env.sends.length, 1);
  await env.box.close(); env.box = null; env.putFailure = null; await env.open();
  assert.equal(env.persisted.get(row.id).state, 'uncertain'); await env.box.runDue(); assert.equal(env.sends.length, 1);
});

test('persisted sent tombstone survives restart and prevents API retry duplication', async t => {
  const env = await setup(t); const row = await env.box.create(input()); await env.box.sendNow('session-a', row.id);
  await env.box.close(); env.box = null; await env.open();
  assert.equal(env.box.list('session-a').length, 0);
  assert.deepEqual(await env.box.sendNow('session-a', row.id), { sent: true, id: row.id });
  assert.equal(env.sends.length, 1); assert.equal(env.timers.size, 0);
});

test('closing cancels timers, drains store lifecycle and rejects later mutations', async t => {
  const env = await setup(t); const row = await env.box.create(input());
  assert.equal(env.timers.size, 1); await env.box.close(); env.box = null;
  assert.equal(env.timers.size, 0); assert.equal(env.closes(), 1);
  // Keep the closed object only for the rejection check, not a second close.
  const closedEnv = fixture(); const closedBox = await closedEnv.open(); await closedBox.close();
  await assert.rejects(closedBox.sendNow('session-a', row.id), /已关闭/);
});

test('production adapter submits ordinary plain text through Session prompt, with no Schedule access', async () => {
  const env = fixture(); let descriptor, request, signal;
  const originalNow = Date.now, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const ctx = { storage: { backend: { names: () => ['fake'], get: name => (assert.equal(name, 'json'), { kv: { open: async value => { descriptor = value; return env.newUnit(); } } }) } },
    sessionController: { prompt: async (value, receivedSignal) => { request = value; signal = receivedSignal; return { accepted: true }; } } };
  Object.defineProperty(ctx, 'schedule', { get() { assert.fail('must never access Schedule'); } });
  let box;
  try {
    Date.now = env.now; globalThis.setTimeout = env.setTimer; globalThis.clearTimeout = env.clearTimer;
    box = await openOutbox(ctx);
  } finally {
    Date.now = originalNow; globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
  try {
    const row = await box.create(input()); await box.sendNow('session-a', row.id);
    assert.equal(descriptor.name, 'wait_minute_outbox'); assert.deepEqual(descriptor.tables, ['messages']);
    assert.deepEqual(request.content, [{ type: 'text', text: input().message }]);
    assert.equal(request.sessionId, 'session-a'); assert.equal(request.mode, 'queue');
    assert.equal(typeof request.requestId, 'string'); assert.equal(signal.aborted, false);
    assert.ok(!JSON.stringify(request).includes('schedule_id'));
  } finally { await box.close(); }
});
