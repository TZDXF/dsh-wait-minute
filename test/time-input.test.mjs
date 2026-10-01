import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const exports = {};
const source = await readFile(new URL('../src/client-core.js', import.meta.url), 'utf8');
vm.runInNewContext(source, { exports });
const { durationSegmentLimit, validateDurationSegment, padDurationSegment,
  formatDurationSegments, adjustDurationSegment, normalizeDurationPaste, durationInputParts, parseDuration } = exports;

test('duration segments have independent elapsed-time bounds', () => {
  assert.equal(durationSegmentLimit('hours'), 8760);
  assert.equal(durationSegmentLimit('minutes'), 59);
  assert.throws(() => durationSegmentLimit('seconds'), /Unknown duration segment/);
  assert.equal(validateDurationSegment('hours', '8760'), true);
  assert.equal(validateDurationSegment('hours', '8761'), false);
  assert.equal(validateDurationSegment('minutes', '59'), true);
  assert.equal(validateDurationSegment('minutes', '60'), false);
});

test('typed segments accept empty drafts and ASCII digits only', () => {
  for (const value of ['', '0', '00', '9', '09', '59']) assert.equal(validateDurationSegment('minutes', value), true);
  for (const value of ['-1', '+1', '1.5', '1e1', ' 1', '1 ', 'ab', '：', '９', '000', null, 1]) {
    assert.equal(validateDurationSegment('minutes', value), false, String(value));
  }
  assert.equal(validateDurationSegment('hours', '0000'), true);
  assert.equal(validateDurationSegment('hours', '00000'), false);
});

test('blur padding strips redundant zeroes and pads each valid segment', () => {
  assert.equal(padDurationSegment('hours', ''), '00');
  assert.equal(padDurationSegment('hours', '9'), '09');
  assert.equal(padDurationSegment('hours', '0009'), '09');
  assert.equal(padDurationSegment('hours', '8760'), '8760');
  assert.equal(padDurationSegment('minutes', '5'), '05');
  assert.equal(padDurationSegment('minutes', '60'), null);
});

test('editable segment drafts emit canonical HH:MM to existing controller', () => {
  assert.equal(formatDurationSegments('1', '5'), '01:05');
  assert.equal(formatDurationSegments('', '5'), '00:05');
  assert.equal(formatDurationSegments('', ''), '00:00');
  assert.equal(formatDurationSegments('8760', '59'), '8760:59');
  assert.equal(formatDurationSegments('1', '60'), null);
});

test('wheel and ArrowUp/Down adjust only selected segment with clamped bounds', () => {
  assert.equal(adjustDurationSegment('hours', '09', 1), '10');
  assert.equal(adjustDurationSegment('hours', '8760', 1), '8760');
  assert.equal(adjustDurationSegment('hours', '00', -1), '00');
  assert.equal(adjustDurationSegment('minutes', '58', 1), '59');
  assert.equal(adjustDurationSegment('minutes', '59', 1), '59');
  assert.equal(adjustDurationSegment('minutes', '00', -1), '00');
  assert.equal(adjustDurationSegment('minutes', '', 1), '01');
  assert.equal(adjustDurationSegment('hours', 'xx', 1), null);
  assert.equal(adjustDurationSegment('minutes', '01', 0.5), null);
  assert.equal(formatDurationSegments('12', adjustDurationSegment('minutes', '59', 1)), '12:59');
});

test('HH:MM paste normalizes short segments, whitespace and full-width colon', () => {
  assert.equal(normalizeDurationPaste('1:2'), '01:02');
  assert.equal(normalizeDurationPaste(' 01 : 05 '), '01:05');
  assert.equal(normalizeDurationPaste('0009:05'), '09:05');
  assert.equal(normalizeDurationPaste('1：2'), '01:02');
  assert.equal(normalizeDurationPaste('8760:59'), '8760:59');
  for (const value of ['8761:00', '00:60', '-1:05', '01:99', '01:05:00', 'a:b', '', '1', null]) {
    assert.equal(normalizeDurationPaste(value), null, String(value));
  }
});

test('external duration updates reset both segments using canonical strings', () => {
  const parts = durationInputParts('1:2');
  assert.equal(parts.hours, '01'); assert.equal(parts.minutes, '02');
  const reset = durationInputParts('00:00');
  assert.equal(reset.hours, '00'); assert.equal(reset.minutes, '00');
  const fallback = durationInputParts('invalid');
  assert.equal(fallback.hours, '00'); assert.equal(fallback.minutes, '00');
});

test('UI can edit zero while unchanged scheduling validation requires >=1 minute', () => {
  assert.equal(normalizeDurationPaste('0:0'), '00:00');
  assert.throws(() => parseDuration(formatDurationSegments('', '')), /至少 1 分钟/);
  const valid = parseDuration(formatDurationSegments('', '1'));
  assert.equal(valid.hours, 0); assert.equal(valid.minutes, 1);
});
