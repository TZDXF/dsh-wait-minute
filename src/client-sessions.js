// DSH 0.2.0-rc.2's blank bit is cleared only after a prompt/turn. Delayed
// acceptance is not a model prompt. Reuse its native engagement callback instead
// of inventing a turn or putting the question into the model inbox early.
function createSessionEngagementBridge(sessions) {
  const records = new Map();
  let disposed = false, reconciling = false;
  function reconcile() {
    if (disposed || reconciling) return;
    reconciling = true;
    try {
      const list = sessions.list.getSnapshot();
      for (const [id] of records) {
        const row = list.byId[id];
        if (!row || !row.blank) continue;
        const session = sessions.manager.get(id);
        if (typeof session.handleBlank !== 'function' || typeof session.options?.onEngaged !== 'function') {
          throw new Error('当前运行时不支持延迟会话创建状态适配');
        }
        session.handleBlank(false);
        session.options.onEngaged(session);
      }
    } finally { reconciling = false; }
  }
  const off = sessions.list.subscribe(reconcile);
  return {
    markCreated(rows) {
      if (disposed) return;
      for (const row of rows) if (row && typeof row.sessionId === 'string') records.set(row.sessionId, row);
      reconcile();
    },
    reconcile,
    dispose() { disposed = true; off(); records.clear(); }
  };
}
exports.createSessionEngagementBridge = createSessionEngagementBridge;
