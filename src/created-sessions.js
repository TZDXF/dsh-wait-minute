export const SESSION_TITLE_PREFIX = '延迟 · ';

export function initialTitle(message) {
  return SESSION_TITLE_PREFIX + Array.from(message.trim().replace(/\s+/g, ' ')).slice(0, 36).join('');
}

// Creation identity survives cancellation independently of the message outbox.
export async function openCreatedSessions(ctx, { generate, titleTimeoutMs = 6000 } = {}) {
  const backend = ctx.storage.backend.get('json');
  if (!backend.kv) throw new Error('延迟发送需要支持 kv 的 JSON 持久化后端');
  const unit = await backend.kv.open({ name: 'wait_minute_created_sessions', version: 1,
    tables: ['created'], hasGlobal: false, layout: 'per-record' });
  const loaded = await unit.loadAll();
  const records = new Map();
  for (const [id, row] of Object.entries(loaded.tables.created ?? {})) {
    if (!row || row.sessionId !== id || typeof row.title !== 'string' || typeof row.createdAt !== 'string') {
      await unit.close(); throw new Error('延迟会话创建记录格式无效');
    }
    records.set(id, row);
  }
  let tail = Promise.resolve(), closing = false;
  const jobs = new Map();
  function serialize(operation) {
    if (closing) return Promise.reject(new Error('会话标题存储已关闭'));
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }
  function refine(session, message, row, accepted) {
    if (!generate || closing || jobs.has(session.id)) return;
    const controller = new AbortController();
    let timeout;
    const job = Promise.resolve().then(async () => {
      let onAbort;
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(new Error('标题生成已取消或超时'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      });
      timeout = setTimeout(() => controller.abort(), titleTimeoutMs);
      try {
        const result = await Promise.race([Promise.resolve().then(() => generate(session, message, controller.signal)), interrupted]);
        clearTimeout(timeout);
        if (closing || controller.signal.aborted || typeof result !== 'string' || !result.trim()) return;
        const title = Array.from(result.trim().replace(/\s+/g, ' ')).slice(0, 80).join('');
        await serialize(async () => {
          if (closing || controller.signal.aborted) return;
          const current = ctx.sessionTitle.get(session);
          // An explicit rename, even back to the same text, supersedes this job.
          if (current?.title !== accepted.title || current?.eventSeq !== accepted.eventSeq) return;
          const refined = ctx.sessionTitle.rename(session, title) || ctx.sessionTitle.get(session);
          if (!await ctx.sessions.flush(session)) throw new Error('会话标题没有持久化监听器');
          // Keep the service's normalized title, not an over-length raw model result.
          const latest = ctx.sessionTitle.get(session) || refined;
          const next = { ...row, title: latest?.title || title,
            titleStatus: latest?.eventSeq === refined?.eventSeq ? 'generated' : 'existing' };
          await unit.putRecord('created', session.id, next);
          records.set(session.id, next);
        });
      } catch {
        // An auxiliary title error must never undo an accepted delayed message.
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', onAbort);
        controller.abort();
      }
    }).finally(() => jobs.delete(session.id));
    jobs.set(session.id, { controller, promise: job });
    void job.catch(() => {});
  }
  return {
    list: () => [...records.values()],
    promote(session, message) {
      return serialize(async () => {
        const existing = records.get(session.id);
        const knownTitle = ctx.sessionTitle.get(session);
        const hasTitle = typeof knownTitle?.title === 'string' && !!knownTitle.title.trim();
        const title = hasTitle ? knownTitle.title : existing?.title || initialTitle(message);
        const fresh = !existing && !hasTitle;
        const row = existing ? { ...existing, title } : { sessionId: session.id, title,
          createdAt: new Date().toISOString(), titleStatus: hasTitle ? 'existing' : 'fallback' };
        // Publish the preview immediately, before waiting on KV or model work.
        if (!hasTitle) ctx.sessionTitle.rename(session, title);
        const accepted = ctx.sessionTitle.get(session);
        if (!existing || existing.title !== row.title) {
          await unit.putRecord('created', session.id, row);
          records.set(session.id, row);
        }
        if (!await ctx.sessions.flush(session)) throw new Error('会话标题没有持久化监听器');
        if (fresh && accepted) refine(session, message, row, { title: accepted.title, eventSeq: accepted.eventSeq });
        return row;
      });
    },
    async whenIdle() { await Promise.all([...jobs.values()].map(job => job.promise)); await tail; },
    async close() {
      closing = true;
      for (const job of jobs.values()) job.controller.abort();
      await Promise.all([...jobs.values()].map(job => job.promise));
      await tail; await unit.close();
    }
  };
}
