import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { healthHandler, HEALTH_PATH, VERSION } from '../src/index.js';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); } };
}
test('public readiness endpoint exposes only the actual engine and build, not session or message data', () => {
  assert.equal(HEALTH_PATH, '/.well-known/wait-minute');
  const res = response(); healthHandler({ method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.equal(VERSION, version, '接口标识必须等于 package.json 的版本');
  assert.deepEqual(res.body, { engine: 'standalone-outbox-v1', version, ready: true });
  assert.equal(res.headers['X-Wait-Minute-Engine'], res.body.engine);
  assert.equal(res.headers['X-Wait-Minute-Version'], res.body.version);
});
test('public diagnostics reject mutation methods and do not perform any queue operation', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = response(); healthHandler({ method }, res); assert.equal(res.status, 405);
    assert.equal(res.body.ready, undefined);
  }
});
