import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoute } from '../src/flightPlanner.js';

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

test('tailwind shortens time and headwind lengthens time without changing distance', () => {
  const calm = calculateRoute(0, 0, 1, 0, 120);
  const tailwind = calculateRoute(0, 0, 1, 0, 120, 30);
  const headwind = calculateRoute(0, 0, 1, 0, 120, -30);
  assert.equal(tailwind.distanceNm, calm.distanceNm);
  assert.equal(headwind.distanceNm, calm.distanceNm);
  assert.ok(Math.abs(tailwind.durationMinutes - calm.durationMinutes * 120 / 150) < 1e-10);
  assert.ok(Math.abs(headwind.durationMinutes - calm.durationMinutes * 120 / 90) < 1e-10);
});

test('nonpositive or nonfinite ground speed is rejected', () => {
  for (const wind of [-120, -121, NaN, Infinity, -Infinity]) {
    assert.throws(() => calculateRoute(0, 0, 1, 0, 120, wind), RangeError);
  }
});
