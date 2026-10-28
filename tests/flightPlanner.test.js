import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoute, calculateInitialBearing } from '../src/flightPlanner.js';

test('same point has zero distance and duration', () => {
  assert.deepEqual(calculateRoute(38, 27, 38, 27, 300), { distanceNm: 0, durationMinutes: 0 });
});

test('one degree of latitude is approximately 60 nautical miles', () => {
  const route = calculateRoute(0, 0, 1, 0, 120);
  assert.ok(Math.abs(route.distanceNm - 60) < 0.1);
  assert.ok(Math.abs(route.durationMinutes - 30) < 0.1);
});

test('crossing the date line uses shortest great-circle route', () => {
  const route = calculateRoute(0, 179, 0, -179, 120);
  assert.ok(route.distanceNm > 119 && route.distanceNm < 121);
});

test('invalid coordinates and speed are rejected', () => {
  for (const values of [[91, 0, 0, 0, 100], [0, 181, 0, 0, 100], [0, 0, 0, 0, 0], [NaN, 0, 0, 0, 100]]) {
    assert.throws(() => calculateRoute(...values), RangeError);
  }
});

test('initial bearing follows cardinal directions', () => {
  for (const [coords, bearing] of [
    [[0, 0, 1, 0], 0], [[0, 0, 0, 1], 90],
    [[0, 0, -1, 0], 180], [[0, 0, 0, -1], 270],
  ]) {
    assert.ok(Math.abs(calculateInitialBearing(...coords) - bearing) < 1e-9);
  }
});

test('initial bearing handles the date line', () => {
  assert.ok(Math.abs(calculateInitialBearing(0, 179, 0, -179) - 90) < 1e-9);
});

test('coincident and antipodal points have no unique bearing', () => {
  assert.equal(calculateInitialBearing(38, 27, 38, 27), null);
  assert.equal(calculateInitialBearing(0, 0, 0, 180), null);
});

test('initial bearing rejects invalid coordinates', () => {
  for (const coords of [[91, 0, 0, 0], [0, 0, 0, 181], [NaN, 0, 0, 0]]) {
    assert.throws(() => calculateInitialBearing(...coords), RangeError);
  }
});
