import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const core = {};
vm.runInNewContext(await readFile(new URL('../src/client-core.js', import.meta.url), 'utf8'), { exports: core });
const original = { id: 'message-1', message: 'original message', scheduledAt: '2030-01-01T12:00:00.000Z', status: 'active' };

async function fixture(handler) {
  const requests = [];
  const controller = core.createController('session-1', async req => {
    requests.push(req);
    if (req.action === 'list') return { tasks: [{ ...original }] };
    return handler(req);
  });
  await controller.refresh(); requests.length = 0;
  return { controller, requests };
}

test('message-only edit omits both time fields and preserves scheduledAt', async () => {
  const f = await fixture(async req => ({ task: { ...original, message: req.message } }));
  assert.equal(await f.controller.update(original.id, 'edited text'), true);
  assert.equal(f.requests[0].action, 'update'); assert.equal(f.requests[0].sessionId, 'session-1');
  assert.equal(f.requests[0].id, original.id); assert.equal(f.requests[0].message, 'edited text');
  assert.equal('hours' in f.requests[0], false); assert.equal('minutes' in f.requests[0], false);
  assert.equal(f.controller.getSnapshot().tasks[0].scheduledAt, original.scheduledAt);
  assert.equal(f.controller.getSnapshot().tasks[0].message, 'edited text');
});

test('optional changed delay supplies hours and minutes and accepts new server timestamp', async () => {
  const target = '2030-01-01T13:30:00.000Z';
  const f = await fixture(async req => ({ task: { ...original, message: req.message, scheduledAt: target } }));
  assert.equal(await f.controller.update(original.id, 'edited', '01:30'), true);
  assert.equal(f.requests[0].hours, 1); assert.equal(f.requests[0].minutes, 30);
  assert.equal(f.controller.getSnapshot().tasks[0].scheduledAt, target);
});

test('edit rejects blank/oversized message and invalid or zero delay without mutation', async () => {
  const f = await fixture(() => assert.fail('must not request invalid update'));
  for (const [message, duration] of [['', undefined], [' \n', undefined], ['x'.repeat(10001), undefined], ['valid', '00:00'], ['valid', '00:60'], ['valid', 'bad']]) {
    assert.equal(await f.controller.update(original.id, message, duration), false);
    assert.equal(f.controller.getSnapshot().tasks[0].message, original.message);
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.ok(f.controller.getSnapshot().error);
  }
  assert.equal(f.requests.length, 0);
});

test('edit accepts maximum 10000 character text and keeps whitespace verbatim', async () => {
  const f = await fixture(req => ({ task: { ...original, message: req.message } }));
  const message = '  ' + 'x'.repeat(9997) + '\n';
  assert.equal(await f.controller.update(original.id, message), true);
  assert.equal(f.requests[0].message, message);
});

test('update failure retains original queue row and error for inline draft retry', async () => {
  const f = await fixture(async () => { throw new Error('storage offline'); });
  assert.equal(await f.controller.update(original.id, 'unsaved edit', '00:05'), false);
  assert.equal(f.controller.getSnapshot().tasks[0].message, original.message);
  assert.equal(f.controller.getSnapshot().tasks[0].scheduledAt, original.scheduledAt);
  assert.match(f.controller.getSnapshot().error, /storage offline/);
  assert.equal(f.controller.getSnapshot().busy, false);
});

test('mismatched update response is not reported as success', async () => {
  const f = await fixture(async () => ({ task: { ...original, id: 'different-message' } }));
  assert.equal(await f.controller.update(original.id, 'edited'), false);
  assert.equal(f.controller.getSnapshot().tasks[0].message, original.message);
});

test('Send Now removes only confirmed sent row and preserves server warning', async () => {
  const f = await fixture(async req => ({ sent: true, id: req.id, warning: 'Cleanup required manual confirmation' }));
  assert.equal(await f.controller.sendNow(original.id), true);
  assert.equal(f.requests[0].action, 'sendNow'); assert.equal(f.requests[0].sessionId, 'session-1');
  assert.equal(f.controller.getSnapshot().tasks.length, 0);
  assert.equal(f.controller.getSnapshot().notice, 'Cleanup required manual confirmation');
});

test('Send Now failure or uncertain response retains queue row without automatic retry', async () => {
  for (const handler of [async () => { throw new Error('network offline'); }, async () => ({ sent: false, id: original.id }), async () => ({ sent: true, id: 'other' })]) {
    const f = await fixture(handler);
    assert.equal(await f.controller.sendNow(original.id), false);
    assert.equal(f.controller.getSnapshot().tasks.length, 1); assert.ok(f.controller.getSnapshot().error);
    assert.equal(f.requests.length, 1); assert.equal(f.controller.getSnapshot().busy, false);
  }
});

test('update busy lock prevents simultaneous update, Send Now, cancel and enqueue', async () => {
  let finish;
  const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.controller.update(original.id, 'edit');
  assert.equal(f.controller.getSnapshot().busy, true);
  assert.equal(await f.controller.update(original.id, 'second'), false);
  assert.equal(await f.controller.sendNow(original.id), false);
  await f.controller.cancel(original.id);
  assert.equal(await f.controller.enqueue({ draft: 'other', phase: 'plain', attachmentIds: [] }, { setDraft() {} }, () => ({})), false);
  assert.equal(f.requests.length, 1);
  finish({ task: { ...original, message: 'edit' } }); assert.equal(await pending, true);
});

test('Send Now busy lock prevents duplicate Send Now and edit', async () => {
  let finish;
  const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.controller.sendNow(original.id);
  assert.equal(await f.controller.sendNow(original.id), false);
  assert.equal(await f.controller.update(original.id, 'edit'), false);
  assert.equal(f.requests.length, 1);
  finish({ sent: true, id: original.id }); assert.equal(await pending, true);
});

test('stale list response cannot overwrite updated content or restore immediately sent message', async () => {
  for (const action of ['update', 'sendNow']) {
    let finishRead, listCalls = 0;
    const controller = core.createController('session-1', req => {
      if (req.action === 'list') return ++listCalls === 1 ? Promise.resolve({ tasks: [{ ...original }] }) : new Promise(resolve => { finishRead = resolve; });
      return Promise.resolve(req.action === 'update' ? { task: { ...original, message: 'new' } } : { sent: true, id: original.id });
    });
    await controller.refresh(); const stale = controller.refresh();
    if (action === 'update') await controller.update(original.id, 'new'); else await controller.sendNow(original.id);
    finishRead({ tasks: [{ ...original }] }); await stale;
    assert.equal(controller.getSnapshot().tasks.length, action === 'update' ? 1 : 0);
    if (action === 'update') assert.equal(controller.getSnapshot().tasks[0].message, 'new');
  }
});

test('new actions refuse mutations for sending row or disposed controller', async () => {
  let calls = 0;
  const controller = core.createController('s', req => req.action === 'list'
    ? { tasks: [{ ...original, sending: true }] } : (calls++, {}));
  await controller.refresh();
  assert.equal(await controller.update(original.id, 'edit'), false);
  assert.equal(await controller.sendNow(original.id), false);
  controller.dispose();
  assert.equal(await controller.update(original.id, 'edit'), false);
  assert.equal(await controller.sendNow(original.id), false);
  assert.equal(calls, 0);
});

const uiSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
function queueUi(task, confirm = () => true) {
  const exports = {}, entries = new Map(), sent = [], removed = [], edits = [], hooks = [];
  const state = { tasks: Array.isArray(task) ? task : [task], busy: false, error: '', notice: '' };
  let cursor = 0, tree, refreshes = 0;
  const controller = { getSnapshot: () => state, subscribe() {}, refresh: async () => { refreshes++; },
    cancel: async id => { removed.push(id); }, update: async (...args) => { edits.push(args); return false; },
    sendNow: async id => { sent.push(id); return true; } };
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: (subscribe, read) => read(), useId: () => 'wm-queue-test-list',
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; }, useEffect() {} };
  vm.runInNewContext(uiSource, { exports, require: () => React, createController: () => controller,
    createSessionEngagementBridge: () => ({}), window: { confirm }, countdown: () => '00:05:00', parseDuration: core.parseDuration });
  exports.apply({ sessions: {}, effect() {}, slots: { inject: (name, fn) => fn(), register: (options, component) => { entries.set(options.name, component); return () => {}; } } });
  const wrapper = entries.get('conversation.input.dock')({ sessionId: 's' });
  function all(node, predicate) {
    if (!node || typeof node !== 'object') return [];
    const own = predicate(node) ? [node] : [];
    return [...own, ...node.children.flat(Infinity).flatMap(child => all(child, predicate))];
  }
  const result = { sent, removed, edits, state, get refreshes() { return refreshes; },
    get tree() { return tree; }, get buttons() { return all(tree, node => node.type === 'button'); },
    get text() { return all(tree, () => true).flatMap(node => node.children.filter(child => typeof child === 'string')).join(' '); },
    nodes(predicate) { return all(tree, predicate); }, render() { cursor = 0; tree = wrapper.type(wrapper.props); return tree; },
    button(label) { return this.buttons.find(button => button.props['aria-label'] === label); } };
  result.render(); return result;
}

test('queue UI calls messages rather than automation and provides edit/Send Now controls', () => {
  const f = queueUi(original);
  assert.equal(f.tree.props['aria-label'], '延迟消息队列');
  for (const label of ['编辑', '立即发送', '取消发送']) {
    const button = f.button(label); assert.ok(button); assert.ok(button.props.title);
    assert.equal(button.children[0].type, 'svg');
  }
});

test('uncertain row shows error and explicit Send Now requires duplicate-warning confirmation', async () => {
  let confirmed = 0;
  const f = queueUi({ ...original, error: '投递结果不确定' }, text => { confirmed++; assert.match(text, /重复消息/); return false; });
  assert.match(f.text, /投递结果不确定/);
  await f.button('立即发送').props.onClick();
  assert.equal(confirmed, 1); assert.equal(f.sent.length, 0);
  const accepted = queueUi({ ...original, error: '投递结果不确定' }, () => true);
  await accepted.button('立即发送').props.onClick();
  assert.deepEqual(accepted.sent, [original.id]);
});

test('sending row disables all message mutation controls', () => {
  const f = queueUi({ ...original, sending: true });
  for (const label of ['编辑', '立即发送', '取消发送']) assert.equal(f.button(label).props.disabled, true);
  assert.match(f.text, /发送中/);
});

test('single delayed message matches native direct-row strip without a disclosure header', () => {
  const f = queueUi(original);
  assert.equal(f.nodes(node => node.type === 'ul')[0].props.hidden, false);
  assert.equal(f.nodes(node => node.type === 'li').length, 1);
  assert.equal(f.buttons.filter(button => button.props['aria-expanded'] !== undefined).length, 0);
  assert.ok(f.nodes(node => node.props.className === 'wm-queue-panel').length);
  assert.equal(f.tree.props['data-delayed-queue'], '');
  assert.equal(f.tree.props['data-queue-dock'], undefined);
});

test('multiple messages default to native count disclosure and retain next countdown', () => {
  const f = queueUi([original, { ...original, id: 'later', message: 'later' }]);
  let header = f.buttons.find(button => button.props['aria-expanded'] !== undefined);
  assert.equal(header.props['aria-expanded'], false);
  assert.equal(header.props['aria-controls'], f.nodes(node => node.type === 'ul')[0].props.id);
  assert.equal(f.nodes(node => node.type === 'ul')[0].props.hidden, true);
  assert.equal(f.nodes(node => node.type === 'li').length, 0);
  assert.match(f.text, /2 条延迟消息/);
  assert.ok(f.nodes(node => node.props['aria-label'] === '下一条消息剩余时间').length);
  header.props.onClick(); f.render();
  header = f.buttons.find(button => button.props['aria-expanded'] !== undefined);
  assert.equal(header.props['aria-expanded'], true);
  assert.equal(f.nodes(node => node.type === 'li').length, 2);
});

test('editing keeps disclosure expanded and unsuccessful save retains local draft', async () => {
  const f = queueUi([original, { ...original, id: 'later' }]);
  f.buttons.find(button => button.props['aria-expanded'] !== undefined).props.onClick(); f.render();
  f.button('编辑').props.onClick(); f.render();
  assert.equal(f.buttons.find(button => button.props['aria-expanded'] !== undefined).props.disabled, true);
  const textarea = f.nodes(node => node.type === 'textarea')[0];
  assert.equal(textarea.props.rows, 1);
  textarea.props.onChange({ target: { value: 'retained editing draft' } }); f.render();
  await f.nodes(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); f.render();
  assert.equal(f.nodes(node => node.type === 'textarea')[0].props.value, 'retained editing draft');
  assert.equal(f.edits[0][1], 'retained editing draft');
  f.state.tasks = []; f.render();
  assert.match(f.text, /编辑草稿仍保留/);
  assert.equal(f.nodes(node => node.type === 'textarea')[0].props.value, 'retained editing draft');
});

test('native-looking strip keeps manual refresh and delete controls functional', async () => {
  const f = queueUi(original);
  await f.button('刷新延迟消息队列').props.onClick();
  await f.button('取消发送').props.onClick();
  assert.equal(f.refreshes, 1); assert.deepEqual(f.removed, [original.id]);
});

test('queue styling uses shipped native compositor geometry, panel and icon-action tokens', () => {
  for (const token of ['--dsh-composer-side-clearance', '--dsh-composer-dock-inset', '--dsh-composer-stack-gap',
    '--dsw-specific-menu', '--dsw-menu-backdrop-filter', '--dsw-alias-label-primary-dimmed', '--dsw-alias-interactive-bg-hover']) assert.ok(uiSource.includes(token));
  assert.match(uiSource, /\.wm-queue-panel:after[^\n]*border:\.5px[^\n]*border-bottom:none/);
  assert.match(uiSource, /\.wm-queue-row[^\n]*min-height:36px/);
  assert.match(uiSource, /\.wm-queue-action \{[^\n]*width:28px;height:28px[^\n]*border-radius:999px/);
  assert.match(uiSource, /\.wm-queue-list \{ max-height:180px/);
});
