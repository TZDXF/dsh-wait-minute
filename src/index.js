import { API_PATH, createRequest, requireString } from './domain.js';
import { openCreatedSessions } from './created-sessions.js';
import { openOutbox } from './outbox.js';
import { createQueuedTitleGenerator } from './title-generator.js';

export const name = 'wait-minute';
// The hub alone does not guarantee that its JSON backend has registered.
export const inject = ['webServer', 'connection', 'storage', 'storage.backend.json', 'sessionController', 'sessionTitle', 'sessions', 'llm', 'agentDefaultModel'];
export const HEALTH_PATH = '/.well-known/wait-minute';
const MAX_BODY_BYTES = 48 * 1024;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Wait-Minute-Engine': 'standalone-outbox-v1', 'X-Wait-Minute-Version': '1.0.0' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Error('请求必须使用 application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大');
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式无效');
  return value;
}

export function createHandler(ctx, outbox, createdSessions) {
  return async (req, res) => {
    const rejection = ctx.connection.requestRejection(req);
    if (rejection !== undefined) return send(res, rejection, { error: '未授权的请求' });
    if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST' });
    let input;
    try { input = await readBody(req); }
    catch { return send(res, 400, { error: '请求无效，请检查 JSON 格式与长度' }); }
    try {
      if (input.action === 'created') return send(res, 200, { sessions: createdSessions?.list() ?? [] });
      if (input.action === 'summary') return send(res, 200, { sessions: outbox.summary() });
      const sessionId = requireString(input.sessionId, '会话 ID');
      if (input.action === 'create') {
        const value = createRequest(input);
        const resolved = await ctx.sessionController.resolveAgent(sessionId);
        if (resolved.error) throw new Error(resolved.error.message);
        const task = await outbox.create(input);
        let sessionCreated, warning;
        if (createdSessions) {
          try { sessionCreated = await createdSessions.promote(resolved.agent.session, value.message); }
          catch (error) { warning = `消息已加入队列，但会话标题/创建状态保存失败：${error.message}。请勿重复发送。`; }
        }
        return send(res, 201, { task, sessionCreated, warning });
      }
      if (input.action === 'list') return send(res, 200, { tasks: outbox.list(sessionId),
        sessions: createdSessions?.list().filter(row => row.sessionId === sessionId) });
      const id = requireString(input.id, '消息 ID');
      if (input.action === 'cancel') return send(res, 200, await outbox.cancel(sessionId, id));
      if (input.action === 'sendNow') return send(res, 200, await outbox.sendNow(sessionId, id));
      if (input.action === 'update') return send(res, 200, { task: await outbox.update({ ...input, sessionId, id }) });
      return send(res, 400, { error: '未知操作' });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : '操作失败' });
    }
  };
}

// Public build/readiness information only: no messages, identities or tokens.
// Installed after both storage units successfully open, so it confirms real startup.
export function healthHandler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: '仅支持 GET' });
  return send(res, 200, { engine: 'standalone-outbox-v1', version: '1.0.0', ready: true });
}

export async function apply(ctx) {
  const createdSessions = await openCreatedSessions(ctx, { generate: createQueuedTitleGenerator(ctx) });
  ctx.effect(() => () => createdSessions.close());
  const outbox = await openOutbox(ctx);
  ctx.effect(() => () => outbox.close());
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: API_PATH, handler: createHandler(ctx, outbox, createdSessions) }));
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: HEALTH_PATH, handler: healthHandler }));
}
