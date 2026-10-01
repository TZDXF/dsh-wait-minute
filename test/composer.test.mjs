import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../src/client-core.js', import.meta.url), 'utf8');
const core = {};
vm.runInNewContext(source, { exports: core });
const { parseDuration, countdown, createController, attachSubmissionGuard } = core;
const input = { draft: 'new session first message', draftRev: 1, attachmentIds: [], phase: 'plain' };

test('00:00 is HH:MM duration, not wall-clock time', () => {
  assert.equal(parseDuration('00:01').minutes, 1);
  assert.equal(parseDuration('01:30').hours, 1);
  assert.equal(parseDuration('01:30').minutes, 30);
  for (const value of ['00:00', '1:30', '00:60', '-1:00', '12:99', '9000:00', '']) assert.throws(() => parseDuration(value));
});

test('countdown is based on persisted timestamp and never goes negative', () => {
  const target = '2030-01-01T12:00:00Z';
  assert.equal(countdown(target, Date.parse(target) - 5400000), '01:30:00');
  assert.equal(countdown(target, Date.parse(target) - 1001), '00:00:02');
  assert.equal(countdown(target, Date.parse(target) - 1), '00:00:01');
  assert.equal(countdown(target, Date.parse(target) + 5000), '等待投递');
});

test('blank new session first message goes only to delayed queue, clears draft after persistence', async () => {
  const requests = [], cleared = [];
  const controller = createController('blank-session', async req => {
    requests.push(req); assert.equal(cleared.length, 0);
    return { task: { id: 't', status: 'active', message: req.message, scheduledAt: '2030-01-01T00:00:00Z' } };
  });
  controller.setEnabled(true); controller.setDuration('00:05');
  assert.equal(await controller.enqueue(input, { setDraft: text => cleared.push(text) }, () => input), true);
  assert.equal(requests.length, 1); assert.equal(requests[0].action, 'create');
  assert.equal(requests[0].sessionId, 'blank-session'); assert.equal(requests[0].minutes, 5);
  assert.equal(cleared[0], ''); assert.equal(controller.getSnapshot().tasks[0].id, 't');
  assert.equal(controller.getSnapshot().enabled, false);
});

test('creation failure retains first message and delay selection', async () => {
  let cleared = false;
  const controller = createController('new', async () => { throw new Error('offline'); });
  controller.setEnabled(true); controller.setDuration('00:05');
  assert.equal(await controller.enqueue(input, { setDraft: () => { cleared = true; } }, () => input), false);
  assert.equal(cleared, false); assert.equal(controller.getSnapshot().enabled, true);
  assert.match(controller.getSnapshot().error, /offline/);
});

test('changed draft is never erased when delayed request finishes', async () => {
  let cleared = false;
  const controller = createController('s', async () => ({ task: { id: 't', status: 'active' } }));
  controller.setDuration('00:05');
  await controller.enqueue(input, { setDraft: () => { cleared = true; } }, () => ({ ...input, draft: 'typing another message', draftRev: 2 }));
  assert.equal(cleared, false);
});

test('invalid time, commands and attachments fail closed', async () => {
  let calls = 0;
  const controller = createController('s', async () => { calls++; });
  const actions = { setDraft: () => assert.fail('must not clear draft') };
  assert.equal(await controller.enqueue(input, actions, () => input), false);
  controller.setDuration('00:05');
  assert.equal(await controller.enqueue({ ...input, draft: '/plan x' }, actions, () => input), false);
  assert.equal(await controller.enqueue({ ...input, attachmentIds: ['file'] }, actions, () => input), false);
  assert.equal(calls, 0);
});

test('double click cannot create duplicate delayed tasks', async () => {
  let resolve, calls = 0;
  const controller = createController('s', () => { calls++; return new Promise(done => { resolve = done; }); });
  controller.setDuration('00:05');
  const first = controller.enqueue(input, { setDraft() {} }, () => input);
  assert.equal(await controller.enqueue(input, { setDraft() {} }, () => input), false);
  resolve({ task: { id: 't', status: 'active' } }); await first;
  assert.equal(calls, 1);
});

test('stale refresh cannot replace a newly created queue row', async () => {
  let finishRead;
  const controller = createController('s', req => req.action === 'list' ? new Promise(resolve => { finishRead = resolve; }) : Promise.resolve({ task: { id: 'new', status: 'active' } }));
  const reading = controller.refresh();
  controller.setDuration('00:05');
  await controller.enqueue(input, { setDraft() {} }, () => input);
  finishRead({ tasks: [] }); await reading;
  assert.equal(controller.getSnapshot().tasks.length, 1);
});

function guardFixture() {
  const listeners = new Map();
  const primary = { disabled: false }, stop = {};
  const card = { querySelectorAll: () => [stop, primary],
    addEventListener: (name, listener, capture) => { assert.equal(capture, true); listeners.set(name, listener); },
    removeEventListener: name => listeners.delete(name) };
  let sends = 0;
  const ctx = { state: { enabled: true, busy: false }, input, locked: false, enqueue: () => { sends++; } };
  const off = attachSubmissionGuard(card, () => ctx);
  function event(target = primary, changes = {}) {
    const e = { target: { closest: selector => selector === 'button' ? target : target === 'editor' ? {} : null },
      prevented: false, key: 'Enter', shiftKey: false, isComposing: false,
      preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...changes };
    return e;
  }
  return { listeners, primary, stop, ctx, off, event, sends: () => sends };
}

test('native Send is captured; ordinary Send and Stop remain unchanged', () => {
  const f = guardFixture();
  let e = f.event(); f.listeners.get('click')(e); assert.ok(e.prevented); assert.equal(f.sends(), 1);
  f.ctx.state.enabled = false;
  e = f.event(); f.listeners.get('click')(e); assert.equal(e.prevented, false);
  f.ctx.state.enabled = true; f.ctx.input = { ...input, draft: '' };
  e = f.event(); f.listeners.get('click')(e); assert.equal(e.prevented, false);
  f.ctx.input = input; e = f.event(f.stop); f.listeners.get('click')(e); assert.equal(e.prevented, false);
  f.off(); assert.equal(f.listeners.size, 0);
});

test('Enter is delayed; Shift+Enter, IME and other controls are not intercepted', () => {
  const f = guardFixture();
  let e = f.event('editor'); f.listeners.get('keydown')(e); assert.ok(e.prevented); assert.equal(f.sends(), 1);
  for (const change of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { key: 'Escape' }]) {
    e = f.event('editor', change); f.listeners.get('keydown')(e); assert.equal(e.prevented, false);
  }
  e = f.event('duration-field'); f.listeners.get('keydown')(e); assert.equal(e.prevented, false);
});

test('busy, repeat and attachment-only submissions never leak to immediate Send', () => {
  const f = guardFixture(); f.ctx.state.busy = true;
  let e = f.event(); f.listeners.get('click')(e); assert.ok(e.prevented); assert.equal(f.sends(), 0);
  f.ctx.state.busy = false;
  e = f.event('editor', { repeat: true }); f.listeners.get('keydown')(e); assert.ok(e.prevented); assert.equal(f.sends(), 0);
  f.ctx.input = { ...input, draft: '', attachmentIds: ['file'] };
  e = f.event(); f.listeners.get('click')(e); assert.ok(e.prevented);
});

test('refresh rebuilds queue and excludes delivered messages; cancel removes one row', async () => {
  const requests = [];
  const controller = createController('s', async req => { requests.push(req); return req.action === 'list'
    ? { tasks: [{ id: 'active', status: 'active' }, { id: 'sent', status: 'inactive' }] } : { deleted: true }; });
  await controller.refresh(); assert.equal(controller.getSnapshot().tasks.length, 1);
  await controller.cancel('active'); assert.equal(controller.getSnapshot().tasks.length, 0);
  assert.equal(requests[1].action, 'cancel'); assert.equal(requests[1].sessionId, 's');
});
