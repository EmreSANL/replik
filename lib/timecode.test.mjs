import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimecode } from './timecode.ts';

test('scene timecodes retain milliseconds and round over second boundaries', () => {
  assert.equal(formatTimecode(4.5), '00:04.500');
  assert.equal(formatTimecode(59.9995), '01:00.000');
  assert.equal(formatTimecode(61.234), '01:01.234');
});

test('invalid and negative media positions stay at zero', () => {
  assert.equal(formatTimecode(-1), '00:00.000');
  assert.equal(formatTimecode(Number.NaN), '00:00.000');
});
