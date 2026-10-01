export const MAX_HOURS = 8760;
export const MAX_MESSAGE_LENGTH = 10000;
export const API_PATH = '/api/wait-minute/outbox-v1';

export function requireString(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${name}必须是非空文本，最多 ${max} 个字符`);
  }
  return value;
}

export function delaySeconds(hours, minutes) {
  if (!Number.isSafeInteger(hours) || hours < 0 || hours > MAX_HOURS) throw new Error(`小时必须是 0 到 ${MAX_HOURS} 的整数`);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 59) throw new Error('分钟必须是 0 到 59 的整数');
  const seconds = hours * 3600 + minutes * 60;
  if (seconds === 0) throw new Error('延迟时间至少为 1 分钟');
  return seconds;
}

export function createRequest(input) {
  return { sessionId: requireString(input.sessionId, '会话 ID'),
    message: requireString(input.message, '消息', MAX_MESSAGE_LENGTH),
    seconds: delaySeconds(input.hours, input.minutes) };
}

export function messageView(row) {
  return { id: row.id, message: row.message, scheduledAt: row.scheduledAt,
    status: row.state === 'sent' ? 'inactive' : 'active', sending: row.state === 'sending', error: row.error };
}
