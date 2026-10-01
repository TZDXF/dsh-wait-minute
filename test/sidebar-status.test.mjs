import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/client-sidebar.js', import.meta.url), 'utf8');
const react = { createElement(type, props, ...children) { return { type, props: props || {}, children }; }, useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot(); } };
const api = {};
vm.runInNewContext(source, { exports: api, require: name => { assert.equal(name, 'react'); return react; }, console: { warn() {} } });
const row = (sessionId = 's', count = 1, extra = {}) => ({ sessionId, count, scheduledAt: '2030-01-01T01:00:00Z', uncertainCount: 0, sendingCount: 0, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const microtasks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('summary maps only pending session counts without changing native running state', async () => {
  const store = api.createDelayedSummaryStore(async input => { assert.equal(input.action, 'summary'); return { sessions: [row('a', 2), row('b', 3)] }; });
  await store.refresh();
  assert.equal(store.getSnapshot().get('a').count, 2); assert.equal(store.getSnapshot().get('b').count, 3);
  assert.equal(store.getSnapshot().get('a').running, undefined); assert.equal(store.getSnapshot().get('missing'), undefined);
});
test('empty summary after send/cancel clears badges', async () => {
  let sessions = [row()]; const store = api.createDelayedSummaryStore(async () => ({ sessions }));
  await store.refresh(); assert.equal(store.getSnapshot().size, 1);
  sessions = []; await store.refresh(); assert.equal(store.getSnapshot().size, 0);
});
test('unchanged summary retains stable entry identities for React snapshots', async () => {
  const store = api.createDelayedSummaryStore(async () => ({ sessions: [row()] }));
  let changes = 0; store.subscribe(() => changes++);
  await store.refresh(); const snapshot = store.getSnapshot(), entry = snapshot.get('s');
  await store.refresh(); assert.equal(store.getSnapshot(), snapshot); assert.equal(store.getSnapshot().get('s'), entry); assert.equal(changes, 1);
});
test('mutation refresh invalidates older in-flight summary and forces follow-up read', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const store = api.createDelayedSummaryStore(() => ++calls === 1 ? first.promise : second.promise);
  const reading = store.refresh(); await microtasks();
  const mutationRefresh = store.refresh();
  first.resolve({ sessions: [] }); await microtasks();
  assert.equal(calls, 2); assert.equal(store.getSnapshot().size, 0);
  second.resolve({ sessions: [row('new', 4)] }); await Promise.all([reading, mutationRefresh]);
  assert.equal(store.getSnapshot().get('new').count, 4);
});
test('older summary cannot resurrect a canceled badge', async () => {
  let current = [row()]; const old = deferred(); let calls = 0;
  const store = api.createDelayedSummaryStore(() => ++calls === 2 ? old.promise : Promise.resolve({ sessions: current }));
  await store.refresh(); const reading = store.refresh(); await microtasks();
  current = []; const afterCancel = store.refresh();
  old.resolve({ sessions: [row('s', 9)] }); await Promise.all([reading, afterCancel]);
  assert.equal(store.getSnapshot().size, 0);
});
test('periodic polls do not invalidate or starve a slow in-flight request', async () => {
  const wait = deferred(); let calls = 0;
  const store = api.createDelayedSummaryStore(() => { calls++; return wait.promise; });
  const reading = store.refresh(); await microtasks(); store.poll(); store.poll();
  wait.resolve({ sessions: [row()] }); await reading;
  assert.equal(calls, 1); assert.equal(store.getSnapshot().get('s').count, 1);
});
test('failed or malformed summary retains last known state rather than falsely clearing', async () => {
  let result = { sessions: [row()] }; let fail = false;
  const store = api.createDelayedSummaryStore(async () => { if (fail) throw new Error('offline'); return result; });
  await store.refresh(); const original = store.getSnapshot();
  fail = true; await store.refresh(); assert.equal(store.getSnapshot(), original);
  fail = false; result = { sessions: [row('s', -1)] }; await store.refresh(); assert.equal(store.getSnapshot(), original);
});
test('dispose invalidates response, removes listeners, and prevents future requests', async () => {
  const wait = deferred(); let calls = 0, changes = 0;
  const store = api.createDelayedSummaryStore(() => { calls++; return wait.promise; });
  store.subscribe(() => changes++); const reading = store.refresh(); await microtasks(); store.dispose();
  wait.resolve({ sessions: [row()] }); await reading; await store.refresh();
  assert.equal(store.getSnapshot().size, 0); assert.equal(changes, 0); assert.equal(calls, 1);
});
test('status label distinguishes delayed, submitting, and uncertain, with full real count', () => {
  assert.match(api.delayedStatusLabel(row('s', 20)), /延迟中，20 条延迟消息/);
  assert.match(api.delayedStatusLabel(row('s', 2, { sendingCount: 1 })), /延迟发送中/);
  assert.match(api.delayedStatusLabel(row('s', 2, { uncertainCount: 1 })), /延迟待确认.*1 条发送结果待确认/);
});
function sidebarFixture() {
  const entries = new Map(), events = new Map(), removed = [], domEvents = new Map(), effects = [], styles = []; let sessions = [row('s', 3)];
  const document = { visibilityState: 'hidden', head: { appendChild: style => styles.push(style) }, createElement: () => ({ remove: () => removed.push('style') }),
    addEventListener: (name, fn) => domEvents.set(name, fn), removeEventListener: name => domEvents.delete(name) };
  const ctx = { slots: {
    inject(name, fn) { const off = fn(); return off; },
    register(options, component) { entries.set(options.name, { options, component }); return () => entries.delete(options.name); }
  }, on(name, fn) { events.set(name, fn); return () => events.delete(name); }, effect(fn) { effects.push(fn()); } };
  let tick; const request = async () => ({ sessions });
  const bridge = api.createDelayedSidebar(ctx, request, { document, setInterval: fn => { tick = fn; return 5; }, clearInterval: id => removed.push(id) });
  return { bridge, entries, events, document, domEvents, removed, effects, styles, tick: () => tick(), set: value => { sessions = value; } };
}
test('native list seats use fresh ids, visible clock count, and accessible delayed labels', async () => {
  const f = sidebarFixture(); await f.bridge.refresh();
  const leading = f.entries.get('sidebar.session.row.leading'), hover = f.entries.get('sidebar.session.row.hover');
  assert.equal(leading.options.id, 'wait-minute-delayed'); assert.equal(hover.options.id, 'wait-minute-delayed');
  const badge = leading.component({ sessionId: 's' });
  assert.equal(badge.props.role, 'img'); assert.match(badge.props['aria-label'], /3 条延迟消息/);
  assert.equal(badge.children[1].children[0], '3');
  assert.equal(leading.component({ sessionId: 'no-delay' }), null);
  assert.match(hover.component({ sessionId: 's' }).props['aria-label'], /最近计划时间/);
  f.bridge.dispose(); assert.equal(f.entries.size, 0);
});
test('uncertain count and send-in-progress are presented without pretending Agent is running', async () => {
  const f = sidebarFixture(); f.set([row('s', 2, { uncertainCount: 1, sendingCount: 1 })]); await f.bridge.refresh();
  const badge = f.entries.get('sidebar.session.row.leading').component({ sessionId: 's' });
  assert.equal(badge.props['data-uncertain'], 'true'); assert.match(badge.props.title, /1 条正在提交/);
  assert.equal(badge.props['aria-busy'], undefined); f.bridge.dispose();
});
test('visibility and reconnect restore summary; dispose removes owned slots, timers and listeners', async () => {
  const f = sidebarFixture(); await f.bridge.refresh();
  f.set([row('s', 9)]); f.document.visibilityState = 'visible'; f.domEvents.get('visibilitychange')(); await f.bridge.refresh();
  assert.match(f.entries.get('sidebar.session.row.leading').component({ sessionId: 's' }).props.title, /9 条延迟消息/);
  f.set([]); f.events.get('connection/reset')(); await f.bridge.refresh();
  assert.equal(f.entries.get('sidebar.session.row.leading').component({ sessionId: 's' }), null);
  f.bridge.dispose(); f.bridge.dispose(); assert.equal(f.events.size, 0); assert.equal(f.domEvents.size, 0);
  assert.equal(f.removed.filter(x => x === 5).length, 1); assert.equal(f.removed.filter(x => x === 'style').length, 1);
});
test('helper owns a Context cleanup effect and exposes scoped uncertainty styles', async () => {
  const f = sidebarFixture(); await f.bridge.refresh();
  assert.equal(f.effects.length, 1);
  assert.match(f.styles[0].textContent, /wm-delayed-mark\[data-uncertain=true\]/);
  assert.match(f.styles[0].textContent, /--dsw-alias-state-error-primary/);
  f.effects[0](); assert.equal(f.entries.size, 0); assert.equal(f.events.size, 0);
  f.bridge.dispose(); assert.equal(f.removed.filter(x => x === 5).length, 1);
});
test('summary snapshot explicitly strips message/title/native-status fields and rejects duplicate identity', async () => {
  let sessions = [row('s', 2, { message: 'private', title: 'private title', running: true })];
  const store = api.createDelayedSummaryStore(async () => ({ sessions }));
  await store.refresh();
  assert.deepEqual(Object.keys(store.getSnapshot().get('s')).sort(), ['count', 'scheduledAt', 'sendingCount', 'sessionId', 'uncertainCount']);
  const previous = store.getSnapshot(); sessions = [row('s'), row('s', 4)];
  await store.refresh(); assert.equal(store.getSnapshot(), previous);
});
test('non-Error failures are caught without rejected refresh promises or hot retry loops', async () => {
  let calls = 0;
  const store = api.createDelayedSummaryStore(async () => { calls++; throw null; });
  await store.refresh(); await microtasks(); assert.equal(calls, 1);
  await store.poll(); assert.equal(calls, 2); store.dispose();
});
