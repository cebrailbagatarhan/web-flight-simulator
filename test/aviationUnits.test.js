import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAltitudeDual } from '../src/utils/aviationUnits.js';

test('pause altitude shows feet and meters for a known height', () => {
  assert.equal(formatAltitudeDual(1000), '3,281 FT / 1,000 M');
});

test('zero and negative altitude use a safe ground-level display', () => {
  assert.equal(formatAltitudeDual(0), '0 FT / 0 M');
  assert.equal(formatAltitudeDual(-20), '0 FT / 0 M');
});

test('invalid altitude never appears as NaN or Infinity in the UI', () => {
  assert.equal(formatAltitudeDual(NaN), '—');
  assert.equal(formatAltitudeDual(Infinity), '—');
});
