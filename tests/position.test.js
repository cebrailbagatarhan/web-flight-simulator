import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPauseCoordinates, tryCopyPosition } from '../src/utils/position.js';

test('formats geographic coordinates in latitude-longitude order', () => {
  assert.equal(formatPauseCoordinates(41.0082, 28.9784), '41.00820, 28.97840');
});

test('preserves southern and western hemispheres', () => {
  assert.equal(formatPauseCoordinates(-33.865143, -70.669265), '-33.86514, -70.66926');
});

test('accepts poles and antimeridian', () => {
  assert.equal(formatPauseCoordinates(90, -180), '90.00000, -180.00000');
});

test('normalizes negative zero', () => {
  assert.equal(formatPauseCoordinates(-0, -0), '0.00000, 0.00000');
});

test('rejects non-finite and out-of-range coordinates', () => {
  for (const coords of [[NaN, 0], [0, Infinity], [91, 0], [0, -181], ['41', 29]]) {
    assert.throws(() => formatPauseCoordinates(...coords), RangeError);
  }
});

test('copies the formatted position when clipboard is allowed', async () => {
  let copied;
  const clipboard = { writeText: async (text) => { copied = text; } };
  assert.equal(await tryCopyPosition('41.0, 29.0', clipboard), true);
  assert.equal(copied, '41.0, 29.0');
});

test('reports unavailable or rejected clipboard access without throwing', async () => {
  assert.equal(await tryCopyPosition('x', undefined), false);
  assert.equal(await tryCopyPosition('x', { writeText: async () => { throw new Error('denied'); } }), false);
});
