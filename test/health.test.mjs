import test from 'node:test';
import assert from 'node:assert/strict';
import { healthHandler, HEALTH_PATH } from '../src/index.js';
function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); } };
}
test('public readiness endpoint exposes only the actual engine and build, not session or message data', () => {
  assert.equal(HEALTH_PATH, '/.well-known/wait-minute');
  const res = response(); healthHandler({ method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { engine: 'standalone-outbox-v1', version: '1.0.0', ready: true });
  assert.equal(res.headers['X-Wait-Minute-Engine'], res.body.engine);
  assert.equal(res.headers['X-Wait-Minute-Version'], res.body.version);
});
test('public diagnostics reject mutation methods and do not perform any queue operation', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = response(); healthHandler({ method }, res); assert.equal(res.status, 405);
    assert.equal(res.body.ready, undefined);
  }
});
