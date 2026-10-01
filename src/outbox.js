import { randomUUID } from 'node:crypto';
import { createRequest, delaySeconds, MAX_MESSAGE_LENGTH, messageView, requireString } from './domain.js';

export async function openOutboxUnit(ctx) {
  const backend = ctx.storage.backend.get('json');
  if (!backend.kv) throw new Error('延迟消息队列需要支持 kv 的 JSON 持久化后端');
  return backend.kv.open({ name: 'wait_minute_outbox', version: 1, tables: ['messages'], hasGlobal: false, layout: 'per-record' });
}

// A persistent per-session outbox. This is not a Schedule/automation registration.
// All mutations and expiry sends share a FIFO, so edit/cancel/send-now cannot race
// with a due send. Sending uses the ordinary Session prompt admission endpoint.
export async function createOutbox({ unit, send, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, uuid = randomUUID }) {
  const loaded = await unit.loadAll();
  const rows = new Map();
  let tail = Promise.resolve(), timer, closed = false;
  for (const [id, raw] of Object.entries(loaded.tables.messages ?? {})) {
    if (!raw || raw.id !== id || !['pending', 'sending', 'uncertain', 'sent'].includes(raw.state) ||
        !Number.isFinite(Date.parse(raw.scheduledAt)) || typeof raw.requestId !== 'string' || !raw.requestId) {
      await unit.close(); throw new Error('延迟消息队列记录格式无效');
    }
    requireString(raw.sessionId, '会话 ID'); requireString(raw.message, '消息', MAX_MESSAGE_LENGTH);
    let row = raw;
    if (row.state === 'sending') {
      row = { ...row, state: 'uncertain', error: '上次发送被中断，结果不明确；请确认会话记录后再决定是否立即发送。' };
      await unit.putRecord('messages', id, row);
    }
    rows.set(id, row);
  }

  function arm() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (closed) return;
    const due = [...rows.values()].filter(row => row.state === 'pending').map(row => Date.parse(row.scheduledAt));
    if (!due.length) return;
    const delay = Math.min(2147483647, Math.max(0, Math.min(...due) - now()));
    timer = setTimer(() => { timer = undefined; void api.runDue().catch(error => console.warn('延迟消息投递失败：', error.message)); }, delay);
    timer?.unref?.();
  }
  function serialized(operation) {
    if (closed) return Promise.reject(new Error('延迟消息队列已关闭'));
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result.finally(arm);
  }
  function find(sessionId, id) {
    const row = rows.get(id);
    if (!row || row.sessionId !== sessionId) throw new Error('延迟消息不存在或不属于当前会话');
    return row;
  }
  async function store(row) {
    await unit.putRecord('messages', row.id, row);
    rows.set(row.id, row);
    return row;
  }
  async function deliver(row) {
    if (row.state === 'sent') return { sent: true, id: row.id };
    // Persist intent BEFORE admission. Recovery never silently resends an
    // interrupted/ambiguous message; an explicit user retry is required.
    const { error: previousError, ...clean } = row;
    let sending;
    try { sending = await store({ ...clean, state: 'sending' }); }
    catch (error) {
      const blocked = { ...clean, state: 'uncertain', error: `消息尚未发送：发送前保存失败：${error.message}。请修复后手动重试。` };
      rows.set(row.id, blocked); // Stop an expired record from retrying in a zero-delay loop.
      throw new Error(blocked.error);
    }
    let admitted = false;
    try {
      const result = await send(sending);
      if (result?.accepted !== true) throw new Error('会话未确认接收消息');
      admitted = true;
      const sent = { ...sending, state: 'sent', deliveredAt: new Date(now()).toISOString() };
      rows.set(row.id, sent);
      await unit.putRecord('messages', row.id, sent);
      // Retain the sent tombstone: API retries for this id must not resend it.
      return { sent: true, id: row.id };
    } catch (error) {
      if (admitted) return { sent: true, id: row.id, warning: '消息已提交，但发送记录保存失败；请不要重复发送。' };
      const uncertain = { ...sending, state: 'uncertain', error: `发送结果未确认：${error.message}；请先检查会话记录。` };
      rows.set(row.id, uncertain);
      try { await unit.putRecord('messages', row.id, uncertain); } catch { /* persisted sending also recovers as uncertain */ }
      throw new Error(uncertain.error);
    }
  }
  const api = {
    list(sessionId) {
      return [...rows.values()].filter(row => row.sessionId === sessionId && row.state !== 'sent')
        .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)).map(messageView);
    },
    summary() {
      const grouped = new Map();
      for (const row of rows.values()) {
        if (row.state === 'sent') continue;
        let value = grouped.get(row.sessionId);
        if (!value) {
          value = { sessionId: row.sessionId, count: 0, scheduledAt: row.scheduledAt, uncertainCount: 0, sendingCount: 0 };
          grouped.set(row.sessionId, value);
        }
        value.count++;
        if (Date.parse(row.scheduledAt) < Date.parse(value.scheduledAt)) value.scheduledAt = row.scheduledAt;
        if (row.state === 'uncertain') value.uncertainCount++;
        if (row.state === 'sending') value.sendingCount++;
      }
      return [...grouped.values()];
    },
    create(input) {
      const value = createRequest(input);
      const createdAt = now();
      return serialized(async () => {
        const row = await store({ id: 'delayed-message-' + uuid(), requestId: uuid(), sessionId: value.sessionId,
          message: value.message, scheduledAt: new Date(createdAt + value.seconds * 1000).toISOString(),
          createdAt: new Date(createdAt).toISOString(), state: 'pending' });
        return messageView(row);
      });
    },
    update(input) {
      const message = requireString(input.message, '消息', MAX_MESSAGE_LENGTH);
      const hasTime = input.hours !== undefined || input.minutes !== undefined;
      const seconds = hasTime ? delaySeconds(input.hours, input.minutes) : undefined;
      return serialized(async () => {
        const row = find(input.sessionId, input.id);
        if (row.state === 'sent') throw new Error('消息已发送，不能编辑');
        if (row.state === 'uncertain') throw new Error('请先确认会话记录；发送结果不明确的消息不能直接编辑');
        const next = { ...row, message,
          scheduledAt: seconds === undefined ? row.scheduledAt : new Date(now() + seconds * 1000).toISOString() };
        return messageView(await store(next));
      });
    },
    cancel(sessionId, id) {
      return serialized(async () => {
        const row = find(sessionId, id);
        if (row.state === 'sent') throw new Error('消息已发送，不能撤回');
        await unit.deleteRecord('messages', id); rows.delete(id); return { deleted: true };
      });
    },
    sendNow(sessionId, id) { return serialized(() => deliver(find(sessionId, id))); },
    runDue() {
      return serialized(async () => {
        const due = [...rows.values()].filter(row => row.state === 'pending' && Date.parse(row.scheduledAt) <= now())
          .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
        for (const row of due) {
          try { await deliver(row); }
          catch { /* per-message error is persisted and exposed in the queue; continue other messages */ }
        }
      });
    },
    async close() {
      closed = true; if (timer !== undefined) clearTimer(timer); timer = undefined;
      await tail; await unit.close();
    }
  };
  arm();
  return api;
}

export async function openOutbox(ctx) {
  return createOutbox({ unit: await openOutboxUnit(ctx), send: row => ctx.sessionController.prompt({
    requestId: row.requestId, sessionId: row.sessionId, mode: 'queue', content: [{ type: 'text', text: row.message }]
  }, new AbortController().signal) });
}
