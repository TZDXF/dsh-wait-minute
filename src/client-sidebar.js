// DSH 0.2.0-rc.2 public LIST seats read from ui-workspace's shipped owner:
// sidebar.session.row.leading is available for idle, nonblank, unarchived rows;
// sidebar.session.row.hover supplements all rows without overriding native busy.
function createDelayedSummaryStore(request) {
  let rows = new Map(), disposed = false, wanted = 0, handled = 0, worker = null;
  const listeners = new Set();
  function commit(input) {
    if (!Array.isArray(input)) throw new Error('延迟消息状态格式无效');
    const next = new Map();
    for (const row of input) {
      if (!row || typeof row.sessionId !== 'string' || !row.sessionId || !Number.isSafeInteger(row.count) || row.count <= 0 ||
          typeof row.scheduledAt !== 'string' || !Number.isFinite(Date.parse(row.scheduledAt)) || next.has(row.sessionId) || !Number.isSafeInteger(row.uncertainCount) || row.uncertainCount < 0 ||
          !Number.isSafeInteger(row.sendingCount) || row.sendingCount < 0 || row.uncertainCount + row.sendingCount > row.count) {
        throw new Error('延迟消息状态格式无效');
      }
      const old = rows.get(row.sessionId);
      next.set(row.sessionId, old && ['count', 'scheduledAt', 'uncertainCount', 'sendingCount'].every(key => old[key] === row[key]) ? old : Object.freeze({ sessionId: row.sessionId, count: row.count, scheduledAt: row.scheduledAt, uncertainCount: row.uncertainCount, sendingCount: row.sendingCount }));
    }
    if (next.size === rows.size && [...next].every(([id, row]) => rows.get(id) === row)) return;
    rows = next;
    for (const fn of listeners) fn();
  }
  async function pump() {
    do {
      const version = wanted;
      try {
        const result = await request({ action: 'summary' });
        if (!disposed && version === wanted) commit(result.sessions);
      } catch (error) {
        if (!disposed && version === wanted) console.warn('延迟消息会话状态刷新失败：', error?.message ?? String(error));
        // Retain the last known state, rather than falsely clearing on failure.
      }
      handled = version;
    } while (!disposed && handled !== wanted);
  }
  function start() {
    worker = Promise.resolve().then(pump).finally(() => {
      worker = null;
      if (!disposed && handled !== wanted) return start();
    });
    return worker;
  }
  function refresh() {
    if (disposed) return Promise.resolve();
    ++wanted; // A mutation invalidates any older in-flight summary.
    return worker || start();
  }
  return {
    getSnapshot: () => rows,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    refresh,
    // Periodic reads do not invalidate a slow read; mutations/visibility/reset do.
    poll: () => worker || refresh(),
    dispose() { disposed = true; ++wanted; rows = new Map(); listeners.clear(); }
  };
}

function delayedStatusLabel(row) {
  const state = row.uncertainCount > 0 ? '延迟待确认' : row.sendingCount > 0 ? '延迟发送中' : '延迟中';
  const parts = [state, `${row.count} 条延迟消息`];
  if (row.uncertainCount) parts.push(`${row.uncertainCount} 条发送结果待确认`);
  if (row.sendingCount) parts.push(`${row.sendingCount} 条正在提交`);
  parts.push(`最近计划时间：${new Date(row.scheduledAt).toLocaleString()}`);
  return parts.join('，');
}

function createDelayedSidebar(ctx, request, options = {}) {
  const UIReact = require('react');
  const element = UIReact.createElement;
  const store = createDelayedSummaryStore(request);
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  const interval = options.setInterval ?? setInterval;
  const clear = options.clearInterval ?? clearInterval;
  const cleanups = [];
  let disposed = false;
  function clock() {
    return element('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
      element('circle', { cx: 12, cy: 12, r: 8.5 }), element('path', { d: 'M12 7v5l3 2' }));
  }
  function useRow(sessionId) {
    return UIReact.useSyncExternalStore(store.subscribe, () => store.getSnapshot().get(sessionId));
  }
  function DelayedLeading({ sessionId }) {
    const row = useRow(sessionId);
    if (!row) return null;
    return element('span', { className: 'wm-delayed-mark', 'data-uncertain': row.uncertainCount > 0 ? 'true' : undefined,
      role: 'img', title: delayedStatusLabel(row), 'aria-label': delayedStatusLabel(row) },
      clock(), element('span', { className: 'wm-delayed-count', 'aria-hidden': true }, row.count > 9 ? '9+' : String(row.count)));
  }
  function DelayedHover({ sessionId }) {
    const row = useRow(sessionId);
    if (!row) return null;
    return element('div', { className: 'wm-delayed-hover', 'aria-label': delayedStatusLabel(row) },
      element('div', { className: 'wm-delayed-hover-heading' }, clock(), element('span', null, row.uncertainCount ? '延迟待确认' : row.sendingCount ? '延迟发送中' : '延迟中'),
        element('span', { className: 'wm-delayed-hover-count' }, `${row.count} 条消息`)),
      element('div', { className: 'wm-delayed-hover-time' }, `最近计划时间：${new Date(row.scheduledAt).toLocaleString()}`),
      row.uncertainCount > 0 && element('div', { className: 'wm-delayed-hover-warning' }, `${row.uncertainCount} 条发送结果待确认，请检查会话后手动重试`));
  }
  // Own ids compose beside existing entries. Never replace the native status,
  // mutate its running flag, patch DOM, or borrow the automation marker's id.
  for (const [name, component] of [['sidebar.session.row.leading', DelayedLeading], ['sidebar.session.row.hover', DelayedHover]]) {
    cleanups.push(ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'wait-minute-delayed', order: 25 }, component)));
  }
  if (doc?.head) {
    const style = doc.createElement('style');
    style.textContent = `.wm-delayed-mark{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;flex:none;color:var(--dsw-alias-brand-primary)}
.wm-delayed-mark[data-uncertain=true]{color:var(--dsw-alias-state-error-primary)}
.wm-delayed-count{position:absolute;right:-2px;bottom:0;padding:0 1px;border-radius:3px;background:var(--dsw-alias-bg-base);font:8px/10px ui-monospace,monospace;white-space:nowrap}
.wm-delayed-hover{display:flex;flex-direction:column;gap:4px;margin-bottom:8px;font-size:12px;color:var(--dsw-alias-label-primary)}
.wm-delayed-hover-heading{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-brand-primary)}
.wm-delayed-hover-count,.wm-delayed-hover-time{color:var(--dsw-alias-label-secondary)}
.wm-delayed-hover-warning{color:var(--dsw-alias-state-error-primary)}`;
    doc.head.appendChild(style); cleanups.push(() => style.remove());
  }
  const timer = interval(() => { void store.poll(); }, 5000);
  cleanups.push(() => clear(timer));
  const visible = () => { if (doc.visibilityState === 'visible') void store.refresh(); };
  if (doc?.addEventListener) {
    doc.addEventListener('visibilitychange', visible);
    cleanups.push(() => doc.removeEventListener('visibilitychange', visible));
  }
  cleanups.push(ctx.on('connection/reset', () => { void store.refresh(); }));
  void store.refresh();
  const bridge = {
    refresh: () => store.refresh(),
    dispose() {
      if (disposed) return;
      disposed = true; store.dispose();
      for (const off of cleanups.reverse()) if (typeof off === 'function') off();
    }
  };
  if (typeof ctx.effect === 'function') ctx.effect(() => () => bridge.dispose());
  return bridge;
}
exports.createDelayedSummaryStore = createDelayedSummaryStore;
exports.delayedStatusLabel = delayedStatusLabel;
exports.createDelayedSidebar = createDelayedSidebar;
