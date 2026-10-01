// Shared controller and version-pinned composer adapter. Bundled before client.js.
function parseDuration(value) {
  const match = /^(\d{2,4}):([0-5]\d)$/.exec(value);
  if (!match) throw new Error('请输入小时:分钟，例如 00:05 或 01:30');
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 8760 || hours * 60 + minutes < 1) throw new Error('延迟至少 1 分钟，小时不超过 8760');
  return { hours, minutes };
}

function countdown(scheduledAt, now) {
  const seconds = Math.max(0, Math.ceil((Date.parse(scheduledAt) - now) / 1000));
  if (seconds === 0) return '等待投递';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  return [hours, minutes, seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
}

function createController(sessionId, request) {
  let state = { enabled: false, duration: '00:00', busy: false, tasks: [], error: '', notice: '' };
  const listeners = new Set();
  let readVersion = 0;
  let disposed = false;
  function patch(change) {
    if (disposed) return;
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setEnabled(enabled) { if (!state.busy) patch({ enabled, error: '', notice: '' }); },
    setDuration(duration) { if (!state.busy) patch({ duration, error: '', notice: '' }); },
    fail(error) { patch({ error }); },
    async refresh() {
      const version = ++readVersion;
      try {
        const result = await request({ action: 'list', sessionId });
        if (version === readVersion) patch({ tasks: result.tasks.filter(t => t.status === 'active') });
      } catch (e) { if (version === readVersion) patch({ error: e.message }); }
    },
    async enqueue(input, actions, readCurrent) {
      if (state.busy || disposed) return false;
      try {
        const time = parseDuration(state.duration);
        if (!input?.draft?.trim()) throw new Error('请先在聊天输入框输入消息');
        if (input.attachmentIds?.length) throw new Error('暂不支持附件延迟发送，请先移除附件或关闭延迟模式');
        if (input.phase !== 'plain' || input.draft.trimStart().startsWith('/')) throw new Error('延迟发送仅支持普通消息，不执行斜杠命令');
        patch({ busy: true, error: '', notice: '' });
        const result = await request({ action: 'create', sessionId, message: input.draft, ...time });
        // Do not erase text entered after the click, nor clear a different session.
        const current = readCurrent();
        if (!disposed && current?.draft === input.draft && current?.draftRev === input.draftRev) actions.setDraft('');
        ++readVersion; // Reject list responses started before creation.
        patch({ tasks: [...state.tasks.filter(t => t.id !== result.task.id), result.task], enabled: false,
          duration: '00:00', notice: '', error: result.warning || '' });
        return true;
      } catch (e) { patch({ error: `${e.message}。若网络中断，请刷新队列确认后再重试。` }); return false; }
      finally { patch({ busy: false }); }
    },
    async update(id, message, duration) {
      if (state.busy || disposed || state.tasks.find(task => task.id === id)?.sending) return false;
      try {
        if (typeof message !== 'string' || !message.trim()) throw new Error('消息内容不能为空');
        if (message.length > 10000) throw new Error('消息最多 10000 个字符');
        const time = duration === undefined ? {} : parseDuration(duration);
        patch({ busy: true, error: '' });
        const result = await request({ action: 'update', sessionId, id, message, ...time });
        if (!result.task || result.task.id !== id) throw new Error('服务端未返回更新后的消息');
        ++readVersion;
        patch({ tasks: state.tasks.map(task => task.id === id ? result.task : task) });
        return true;
      } catch (e) { patch({ error: e.message }); return false; }
      finally { patch({ busy: false }); }
    },
    async sendNow(id) {
      if (state.busy || disposed || state.tasks.find(task => task.id === id)?.sending) return false;
      patch({ busy: true, error: '' });
      try {
        const result = await request({ action: 'sendNow', sessionId, id });
        if (result.sent !== true || result.id !== id) throw new Error('消息尚未确认发送成功，请刷新后确认');
        ++readVersion;
        patch({ tasks: state.tasks.filter(task => task.id !== id), notice: result.warning || '' });
        return true;
      } catch (e) { patch({ error: e.message }); return false; }
      finally { patch({ busy: false }); }
    },
    async cancel(id) {
      if (state.busy) return;
      patch({ busy: true, error: '' });
      try {
        await request({ action: 'cancel', sessionId, id });
        ++readVersion;
        patch({ tasks: state.tasks.filter(t => t.id !== id) });
      } catch (e) { patch({ error: e.message }); }
      finally { patch({ busy: false }); }
    },
    dispose() { disposed = true; ++readVersion; listeners.clear(); }
  };
}

// DSH 0.2.0-rc.2 has no public pre-submit hook. This narrow DOM adapter only
// captures the resident composer primary Send click and editor Enter; it does not
// patch services, the editor, or Stop. The selectors were read from its artifact.
const PRIMARY_SELECTOR = 'button.RlGAzG_primary';
function attachSubmissionGuard(card, readContext) {
  const consume = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
  function eligible(ctx) {
    return ctx.state.enabled && !ctx.locked && !!(ctx.input?.draft?.trim() || ctx.input?.attachmentIds?.length);
  }
  function click(event) {
    const button = event.target.closest?.('button');
    const primaries = card.querySelectorAll(PRIMARY_SELECTOR);
    const primary = primaries[primaries.length - 1];
    if (!button || button !== primary || button.disabled) return;
    const ctx = readContext();
    if (!eligible(ctx)) return; // Empty draft remains the native Stop/steer path.
    consume(event);
    if (!ctx.state.busy) void ctx.enqueue();
  }
  function keydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    if (!event.target.closest?.('[contenteditable="true"]')) return;
    const ctx = readContext();
    if (!eligible(ctx)) return;
    consume(event);
    if (!ctx.state.busy && !event.repeat) void ctx.enqueue();
  }
  card.addEventListener('click', click, true);
  card.addEventListener('keydown', keydown, true);
  return () => {
    card.removeEventListener('click', click, true);
    card.removeEventListener('keydown', keydown, true);
  };
}
exports.parseDuration = parseDuration;
exports.countdown = countdown;
exports.createController = createController;
exports.attachSubmissionGuard = attachSubmissionGuard;

// Pure helpers for the segmented elapsed-duration editor (not scheduling logic).
function durationSegmentLimit(segment) {
  if (segment === 'hours') return 8760;
  if (segment === 'minutes') return 59;
  throw new Error('Unknown duration segment');
}

function validateDurationSegment(segment, value) {
  const limit = durationSegmentLimit(segment);
  if (typeof value !== 'string' || !/^\d*$/.test(value)) return false;
  if (value.length > (segment === 'hours' ? 4 : 2)) return false;
  return value === '' || Number(value) <= limit;
}

function padDurationSegment(segment, value) {
  if (!validateDurationSegment(segment, value)) return null;
  return String(Number(value || '0')).padStart(2, '0');
}

function formatDurationSegments(hours, minutes) {
  const h = padDurationSegment('hours', hours);
  const m = padDurationSegment('minutes', minutes);
  return h === null || m === null ? null : `${h}:${m}`;
}

function adjustDurationSegment(segment, value, delta) {
  if (!validateDurationSegment(segment, value) || !Number.isSafeInteger(delta)) return null;
  const next = Math.min(durationSegmentLimit(segment), Math.max(0, Number(value || '0') + delta));
  return String(next).padStart(2, '0');
}

function normalizeDurationPaste(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{1,4})\s*[:：]\s*(\d{1,2})\s*$/.exec(value);
  return match ? formatDurationSegments(match[1], match[2]) : null;
}

function durationInputParts(value) {
  const normalized = normalizeDurationPaste(value) ?? '00:00';
  const [hours, minutes] = normalized.split(':');
  return { hours, minutes };
}

exports.durationSegmentLimit = durationSegmentLimit;
exports.validateDurationSegment = validateDurationSegment;
exports.padDurationSegment = padDurationSegment;
exports.formatDurationSegments = formatDurationSegments;
exports.adjustDurationSegment = adjustDurationSegment;
exports.normalizeDurationPaste = normalizeDurationPaste;
exports.durationInputParts = durationInputParts;
