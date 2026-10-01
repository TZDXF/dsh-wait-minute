// Bundled after client-core.js by scripts/build.mjs.
const React = require('react');
const h = React.createElement;
exports.inject = ['slots', 'sessions'];

const style = `
.wm-control { display:flex;align-items:center;gap:5px;flex:none;color:var(--dsw-alias-label-primary); }
.wm-delay { width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer; }
.wm-delay:hover { background:var(--dsw-alias-bg-layer-2); }
.wm-delay[aria-pressed=true] { color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2); }
.wm-delay:disabled { opacity:.45;cursor:not-allowed; }
.wm-duration { display:inline-flex;align-items:center;gap:0;height:30px;padding:0 5px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px ui-monospace,monospace; }
.wm-duration:focus-within { border-color:var(--dsw-alias-brand-primary); }
.wm-duration[aria-disabled=true] { opacity:.45; }
.wm-duration-segment { width:2.4ch;min-width:2.4ch;padding:2px 0;border:0;border-radius:3px;outline:none;background:transparent;color:inherit;text-align:center;font:inherit;box-sizing:content-box; }
.wm-duration-segment[data-segment=hours] { width:var(--wm-hours-width,2.4ch); }
.wm-duration-segment:focus { background:var(--dsw-alias-bg-layer-2); }
.wm-control .wm-duration-segment:focus-visible { outline:none; }
.wm-duration-separator { padding:0 1px;user-select:none;color:var(--dsw-alias-label-secondary); }
.wm-control :focus-visible { outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px; }
/* Mirrors DSH 0.2.0-rc.2 QueueDock geometry/tokens, but keeps an independent seat. */
.wm-queue { box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));max-width:calc(var(--dsh-composer-card-max-width,100%) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));margin:0 auto calc(0px - var(--dsh-composer-stack-gap,0px) - 3px);padding:0 var(--dsh-composer-dock-inset,0px);flex:none;color:var(--dsw-alias-label-primary); }
.wm-queue-panel { isolation:isolate;position:relative;width:100%;padding:2px 0;overflow:hidden;border-radius:var(--dsw-radius-lg) var(--dsw-radius-lg) 0 0;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2); }
.wm-queue-panel:before { content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);pointer-events:none; }
.wm-queue-panel:after { content:"";position:absolute;inset:0;border:.5px solid var(--dsw-alias-border-l1);border-bottom:none;border-radius:inherit;pointer-events:none; }
.wm-queue-heading { display:flex;align-items:center;padding-right:5px; }
.wm-queue-header { box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:4px 12px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer; }
.wm-queue-header:disabled { cursor:default; }
.wm-queue-header:focus-visible,.wm-queue-action:focus-visible,.wm-queue-lead-refresh:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px; }
.wm-queue-lead { flex:none;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary); }
.wm-queue-lead-refresh { width:18px;height:18px;padding:0;border:0;border-radius:999px;background:transparent;cursor:pointer; }
.wm-queue-count { flex:auto;min-width:0;font:var(--dsw-font-xs-13);font-family:Inter,var(--dsw-font-family);font-size:13px;font-weight:500;line-height:24px; }
.wm-queue-chevron { display:grid;place-items:center;flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary); }
.wm-queue-list { max-height:180px;margin:0;padding:0;list-style:none;overflow-y:auto; }
.wm-queue-list[hidden] { display:none; }
.wm-queue-message { border-radius:var(--dsw-radius-md); }
.wm-queue-message+.wm-queue-message { box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1); }
.wm-queue-row { box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:36px;padding:4px 5px 4px 12px;border-radius:var(--dsw-radius-md); }
.wm-queue-text { flex:auto;min-width:0;color:var(--dsw-alias-label-primary-dimmed);font:var(--dsw-font-xs-13);font-family:Inter,var(--dsw-font-family);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-break:break-word; }
.wm-countdown { flex:none;color:var(--dsw-alias-label-tertiary);font:12px ui-monospace,monospace;white-space:nowrap;font-variant-numeric:tabular-nums; }
.wm-queue-actions { display:flex;flex:none;align-items:center;gap:10px; }
.wm-queue-action { display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer; }
.wm-queue-action:hover:not(:disabled),.wm-queue-lead-refresh:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.wm-queue-action:disabled,.wm-queue-lead-refresh:disabled { cursor:default;opacity:.45; }
.wm-queue-editor { display:grid;gap:8px;padding:3px 12px 10px; }
.wm-queue-editor textarea { box-sizing:border-box;width:100%;min-height:28px;max-height:127px;padding:3px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);font-family:Inter,var(--dsw-font-family);resize:vertical;overflow-y:auto; }
.wm-queue-editor textarea:focus-visible { outline:none;border-color:var(--dsw-alias-state-business-primary); }
.wm-queue-edit-controls { display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:var(--dsw-font-xs-13); }
.wm-queue-edit-controls label { display:flex;align-items:center;gap:5px; }
.wm-queue-edit-hint { color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13); }
.wm-queue-edit-actions { display:flex;align-items:center;justify-content:flex-end;gap:10px; }
.wm-queue-notice,.wm-queue .wm-error { padding:5px 12px;font:var(--dsw-font-xs-13);overflow-wrap:anywhere; }
.wm-queue-notice { color:var(--dsw-alias-label-secondary); }
.wm-queue-orphan { padding-top:5px; }
.wm-queue-orphan>.wm-queue-edit-hint { padding:0 12px; }
.wm-error { color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere; }
`;

function SegmentedDurationInput({ value, disabled, invalid, onValueChange }) {
  const [parts, setParts] = React.useState(() => durationInputParts(value));
  const drafts = React.useRef(parts);
  const emitted = React.useRef(value);
  const hoursRef = React.useRef(null);
  const minutesRef = React.useRef(null);
  const current = React.useRef(null);

  function write(next) {
    const normalized = formatDurationSegments(next.hours, next.minutes);
    if (normalized === null) return;
    drafts.current = next;
    setParts(next);
    emitted.current = normalized;
    onValueChange(normalized);
  }
  function change(segment, text) {
    if (!disabled && validateDurationSegment(segment, text)) write({ ...drafts.current, [segment]: text });
  }
  function adjust(segment, delta) {
    if (disabled) return;
    const next = adjustDurationSegment(segment, drafts.current[segment], delta);
    if (next !== null) write({ ...drafts.current, [segment]: next });
  }
  function blur(segment) {
    const padded = padDurationSegment(segment, drafts.current[segment]);
    if (!disabled && padded !== null) write({ ...drafts.current, [segment]: padded });
  }
  function keydown(segment, event) {
    if (disabled || event.isComposing) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      adjust(segment, event.key === 'ArrowUp' ? 1 : -1);
    } else if ((event.key === 'ArrowRight' && segment === 'hours') || (event.key === 'ArrowLeft' && segment === 'minutes')) {
      event.preventDefault();
      event.stopPropagation();
      const target = segment === 'hours' ? minutesRef.current : hoursRef.current;
      target?.focus();
      target?.select();
    }
  }
  function paste(event) {
    const text = event.clipboardData.getData('text');
    if (!/[:：]/.test(text)) return; // Plain digits follow the active segment's normal validation.
    event.preventDefault();
    if (disabled) return;
    const normalized = normalizeDurationPaste(text);
    if (normalized !== null) write(durationInputParts(normalized));
  }
  current.current = { disabled, adjust };
  React.useEffect(() => {
    // Keep an actively typed segment unpadded until blur; only external changes reset it.
    if (value === emitted.current) return;
    emitted.current = value;
    const next = durationInputParts(value);
    drafts.current = next;
    setParts(next);
  }, [value]);
  React.useEffect(() => {
    // React's delegated wheel handler may be passive. Local non-passive listeners
    // prevent the surrounding composer/page from scrolling while a segment changes.
    const entries = [['hours', hoursRef.current], ['minutes', minutesRef.current]];
    const off = entries.map(([segment, element]) => {
      if (!element) return () => {};
      const wheel = event => {
        if (current.current.disabled || event.deltaY === 0 || event.ctrlKey) return;
        event.preventDefault();
        event.stopPropagation();
        current.current.adjust(segment, event.deltaY < 0 ? 1 : -1);
      };
      element.addEventListener('wheel', wheel, { passive: false });
      return () => element.removeEventListener('wheel', wheel);
    });
    return () => off.forEach(dispose => dispose());
  }, []);

  function segment(name, ref, label) {
    return h('input', { ref, className: 'wm-duration-segment', 'data-segment': name,
      type: 'text', inputMode: 'numeric', role: 'spinbutton', value: parts[name],
      maxLength: name === 'hours' ? 4 : 2, disabled, spellCheck: false, autoComplete: 'off',
      'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': durationSegmentLimit(name),
      'aria-valuenow': Number(parts[name] || '0'), 'aria-valuetext': `${Number(parts[name] || '0')} ${label}`,
      'aria-invalid': invalid,
      onChange: event => change(name, event.target.value), onBlur: () => blur(name),
      onFocus: event => event.target.select(), onKeyDown: event => keydown(name, event), onPaste: paste,
      style: name === 'hours' ? { '--wm-hours-width': `${Math.max(2, parts.hours.length) + 0.4}ch` } : undefined });
  }
  return h('div', { className: 'wm-duration', role: 'group', 'aria-label': '延迟时长，小时:分钟',
    'aria-disabled': disabled, 'aria-invalid': invalid,
    title: '小时:分钟；滚轮或上下方向键调整当前段，左右方向键切换段' },
    segment('hours', hoursRef, '小时'),
    h('span', { className: 'wm-duration-separator', 'aria-hidden': true }, ':'),
    segment('minutes', minutesRef, '分钟'));
}

async function checkedRequest(input) {
  const response = await fetch('/api/wait-minute/outbox-v1', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
  if (response.headers.get('X-Wait-Minute-Engine') !== 'standalone-outbox-v1') {
    throw new Error('后端仍加载旧版或不兼容的延迟发送实现。请安装新版并重新启用；仍无效时重启 DSH。本次未继续提交消息。');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}
async function api(input) {
  // Probe a read-only operation BEFORE any mutation. Checking only a create
  // response would be too late: a cached old Host might already create Schedule.
  if (['create', 'update', 'sendNow', 'cancel'].includes(input.action)) await checkedRequest({ action: 'created' });
  return checkedRequest(input);
}
exports.api = api;

exports.apply = function(ctx) {
  const controllers = new Map();
  const bridge = createSessionEngagementBridge(ctx.sessions);
  let sidebar;
  async function request(input) {
    const result = await api(input);
    if (result.sessionCreated) bridge.markCreated([result.sessionCreated]);
    if (result.sessions && input.action !== 'summary') bridge.markCreated(result.sessions);
    if (['create', 'update', 'cancel', 'sendNow'].includes(input.action)) void sidebar?.refresh();
    return result;
  }
  ctx.effect(() => {
    sidebar = createDelayedSidebar(ctx, request);
    return () => { sidebar.dispose(); sidebar = undefined; };
  });
  ctx.effect(() => {
    const restore = () => { void request({ action: 'created' }).catch(error => console.warn('延迟会话状态恢复失败：', error.message)); };
    restore();
    const off = ctx.on('connection/reset', restore);
    return () => { off(); bridge.dispose(); };
  });
  function forSession(id) {
    if (!controllers.has(id)) controllers.set(id, createController(id, request));
    return controllers.get(id);
  }
  ctx.effect(() => {
    const element = document.createElement('style');
    element.textContent = style; document.head.appendChild(element);
    return () => { element.remove(); for (const controller of controllers.values()) controller.dispose(); controllers.clear(); };
  });

  function DelayControl(props) {
    const controller = forSession(props.sessionId);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    const input = props.useInput(s => s);
    const session = props.useSession(s => s);
    const ref = React.useRef(null);
    const current = React.useRef(null);
    const [guardReady, setGuardReady] = React.useState(false);
    current.current = { state, input,
      locked: props.locked || session?.removed || !!session?.subagent,
      enqueue: () => controller.enqueue(current.current.input, props.inputActions, () => current.current.input) };
    React.useEffect(() => {
      const card = ref.current?.closest('[data-composer-card]');
      if (!card || !card.querySelector(PRIMARY_SELECTOR)) {
        controller.fail('当前发送控件与插件不兼容，延迟功能未启用');
        return;
      }
      const off = attachSubmissionGuard(card, () => current.current);
      setGuardReady(true);
      return off;
    }, [props.sessionId]);
    const locked = current.current.locked || !guardReady || state.busy;
    let invalid = false;
    if (state.enabled) { try { parseDuration(state.duration); } catch { invalid = true; } }
    return h('div', { className: 'wm-control', ref },
      h('button', { type: 'button', className: 'wm-delay', disabled: locked,
        'aria-label': state.enabled ? '关闭延迟发送' : '延迟发送', 'aria-pressed': state.enabled,
        title: state.enabled ? '关闭延迟发送' : '延迟发送',
        onClick: () => controller.setEnabled(!state.enabled) },
        h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
          h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M12 7v5l3 2' }))),
      state.enabled && h(SegmentedDurationInput, { value: state.duration, disabled: locked, invalid,
        onValueChange: duration => controller.setDuration(duration) })
    );
  }

  function DelayQueue(props) {
    const controller = forSession(props.sessionId);
    const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    const [now, setNow] = React.useState(Date.now());
    // Keep the editing draft outside a queue row, so a failed save or a poll
    // removing an expired row cannot erase text the user has been editing.
    const [editing, setEditing] = React.useState(null);
    const [collapsed, setCollapsed] = React.useState(true);
    const listId = React.useId();
    React.useEffect(() => {
      if (!state.tasks.length && !collapsed) setCollapsed(true);
    }, [state.tasks.length, collapsed]);
    function icon(kind, size = 14) {
      const paths = {
        edit: 'M15 5l4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z',
        send: 'M21 3L3 10l7 3 3 7zM10 13L21 3',
        trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
        refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9',
        down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6',
        check: 'M5 12l4 4L19 6', close: 'M6 6l12 12M18 6L6 18', clock: 'M12 7v5l3 2'
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
        kind === 'clock' && h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: paths[kind] }));
    }
    React.useEffect(() => {
      let live = true;
      let reading = false;
      async function refresh() { if (reading || !live) return; reading = true; try { await controller.refresh(); } finally { reading = false; } }
      void refresh();
      const tick = setInterval(() => { if (live) setNow(Date.now()); }, 1000);
      const poll = setInterval(() => void refresh(), 5000);
      const onVisible = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void refresh(); } };
      document.addEventListener('visibilitychange', onVisible);
      return () => { live = false; clearInterval(tick); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
    }, [props.sessionId]);

    function startEditing(task) {
      if (state.busy || task.sending || editing) return;
      const remaining = Math.min(8760 * 60 + 59, Math.max(1, Math.ceil((Date.parse(task.scheduledAt) - Date.now()) / 60000)));
      const duration = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
      setEditing({ id: task.id, message: task.message, duration, changeDelay: false, scheduledAt: task.scheduledAt });
    }
    async function sendNow(task) {
      if (state.busy || task.sending || editing) return;
      if (task.error && !window.confirm('这条消息可能已经发送，但投递结果未能确认。再次发送可能产生重复消息，确定立即重试发送？')) return;
      await controller.sendNow(task.id);
    }
    const editingRow = editing ? state.tasks.find(task => task.id === editing.id) : null;
    const editorBusy = state.busy || !!editingRow?.sending;
    let durationInvalid = false;
    if (editing?.changeDelay) { try { parseDuration(editing.duration); } catch { durationInvalid = true; } }
    const canSave = editing && editingRow && !editorBusy && !!editing.message.trim()
      && editing.message.length <= 10000 && !durationInvalid;
    async function save(event) {
      event.preventDefault();
      if (!canSave) return;
      const draft = editing;
      const success = await controller.update(draft.id, draft.message, draft.changeDelay ? draft.duration : undefined);
      if (success) setEditing(current => current?.id === draft.id ? null : current);
    }
    function renderEditor() {
      return h('form', { className: 'wm-queue-editor', key: editing.id, onSubmit: event => void save(event) },
        h('textarea', { value: editing.message, rows: 1, autoFocus: true, maxLength: 10000, disabled: editorBusy,
          'aria-label': '编辑延迟消息', onChange: event => setEditing(current => ({ ...current, message: event.target.value })) }),
        h('div', { className: 'wm-queue-edit-controls' },
          h('label', null, h('input', { type: 'checkbox', checked: editing.changeDelay, disabled: editorBusy,
            onChange: event => setEditing(current => ({ ...current, changeDelay: event.target.checked })) }), '重新设置延迟'),
          h(SegmentedDurationInput, { value: editing.duration, disabled: editorBusy || !editing.changeDelay,
            invalid: durationInvalid, onValueChange: duration => setEditing(current => ({ ...current, duration })) })),
        h('div', { className: 'wm-queue-edit-hint' }, editing.changeDelay
          ? '新延迟从本次保存成功时开始计算，至少 1 分钟。'
          : `保持原发送时间：${new Date(editing.scheduledAt).toLocaleString()}`),
        h('div', { className: 'wm-queue-edit-actions' },
          h('button', { type: 'submit', className: 'wm-queue-action', disabled: !canSave,
            'aria-label': '保存', title: state.busy ? '保存中…' : '保存编辑' }, icon('check')),
          h('button', { type: 'button', className: 'wm-queue-action', disabled: editorBusy,
            'aria-label': '取消编辑', title: '取消编辑', onClick: () => setEditing(null) }, icon('close'))));
    }
    const interactionActive = !!editing || state.busy;
    const expanded = !collapsed || interactionActive;
    const listVisible = state.tasks.length === 1 || expanded;
    const nextAt = state.tasks.length ? Math.min(...state.tasks.map(task => Date.parse(task.scheduledAt))) : now;
    if (!state.tasks.length && !state.error && !state.notice && !editing) return null;
    return h('div', { className: 'wm-queue', role: 'region', 'aria-label': '延迟消息队列', 'data-delayed-queue': '' },
      h('div', { className: 'wm-queue-panel' },
        state.error && h('div', { className: 'wm-error', role: 'alert' }, state.error),
        state.notice && h('div', { className: 'wm-queue-notice', role: 'status' }, state.notice),
        state.tasks.length > 1 && h('div', { className: 'wm-queue-heading' },
          h('button', { type: 'button', className: 'wm-queue-header', 'aria-controls': listId,
            'aria-expanded': expanded, disabled: interactionActive, onClick: () => setCollapsed(value => !value) },
            h('span', { className: 'wm-queue-lead', 'aria-hidden': true }, icon('clock', 18)),
            h('span', { className: 'wm-queue-count' }, `${state.tasks.length} 条延迟消息`),
            !listVisible && h('span', { className: 'wm-countdown', 'aria-label': '下一条消息剩余时间',
              title: new Date(nextAt).toLocaleString() }, state.tasks.some(task => task.sending) ? '发送中…' : countdown(new Date(nextAt).toISOString(), now)),
            h('span', { className: 'wm-queue-chevron', 'aria-hidden': true }, icon(expanded ? 'down' : 'up'))),
          h('button', { type: 'button', className: 'wm-queue-action', 'aria-label': '刷新延迟消息队列',
            title: '刷新延迟消息队列', disabled: state.busy, onClick: () => void controller.refresh() }, icon('refresh'))),
        h('ul', { id: listId, className: 'wm-queue-list', hidden: !listVisible },
          ...(listVisible ? state.tasks : []).map(task => h('li', { className: 'wm-queue-message', key: task.id },
            h('div', { className: 'wm-queue-row' },
              state.tasks.length === 1 && h('button', { type: 'button', className: 'wm-queue-lead wm-queue-lead-refresh',
                'aria-label': '刷新延迟消息队列', title: '延迟消息，点击刷新队列', disabled: state.busy,
                onClick: () => void controller.refresh() }, icon('clock', 18)),
              h('span', { className: 'wm-queue-text', title: task.message }, task.message),
              h('span', { className: 'wm-countdown', 'aria-label': '剩余时间', title: new Date(task.scheduledAt).toLocaleString() }, task.sending ? '发送中…' : countdown(task.scheduledAt, now)),
              h('div', { className: 'wm-queue-actions' },
                h('button', { type: 'button', className: 'wm-queue-action', 'aria-label': '编辑', title: '编辑这条延迟消息',
                  disabled: state.busy || task.sending || !!editing, onClick: () => startEditing(task) }, icon('edit')),
                h('button', { type: 'button', className: 'wm-queue-action', 'aria-label': '取消发送', title: '取消这条延迟消息',
                  disabled: state.busy || task.sending || !!editing, onClick: () => void controller.cancel(task.id) }, icon('trash')),
                h('button', { type: 'button', className: 'wm-queue-action', 'aria-label': '立即发送', title: '立即发送这条消息',
                  disabled: state.busy || task.sending || !!editing, onClick: () => void sendNow(task) }, icon('send', 16)))),
            task.error && h('div', { className: 'wm-error', role: 'alert' }, task.error),
            editing?.id === task.id && renderEditor()))),
        editing && !editingRow && h('div', { className: 'wm-queue-orphan' },
          h('div', { className: 'wm-queue-edit-hint' }, '这条消息已不在延迟队列中，编辑草稿仍保留，可复制内容或取消编辑。'), renderEditor()),
        state.tasks.length === 0 && !editing && h('button', { type: 'button', className: 'wm-queue-action',
          'aria-label': '刷新延迟消息队列', title: '刷新延迟消息队列', disabled: state.busy,
          onClick: () => void controller.refresh() }, icon('refresh')))
    );
  }

  // This seat is after the model selector and immediately before Send. It is
  // available for a real blank session as well as an existing conversation.
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity'
  }, props => h(DelayControl, { ...props, key: props.sessionId })));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'wait-minute', order: 25, label: '延迟队列'
  }, props => h(DelayQueue, { ...props, key: props.sessionId })));
};
