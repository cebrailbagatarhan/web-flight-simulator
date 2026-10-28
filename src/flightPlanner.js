/** Lightweight great-circle flight planning. Coordinates in degrees, speed in knots. */
const EARTH_RADIUS_NM = 3440.065;

export function calculateRoute(fromLat, fromLon, toLat, toLon, speedKnots, windKnots = 0) {
  const values = [fromLat, fromLon, toLat, toLon, speedKnots, windKnots];
  if (!values.every(Number.isFinite) || Math.abs(fromLat) > 90 || Math.abs(toLat) > 90 ||
      Math.abs(fromLon) > 180 || Math.abs(toLon) > 180 || speedKnots <= 0 ||
      speedKnots + windKnots <= 0) {
    throw new RangeError('Enter valid coordinates and a positive ground speed.');
  }
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLat = radians(toLat - fromLat);
  const deltaLon = radians(toLon - fromLon);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(deltaLon / 2) ** 2;
  const distanceNm = 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(Math.min(1, a)));
  return { distanceNm, durationMinutes: distanceNm / (speedKnots + windKnots) * 60 };
}

export function setupFlightPlanner(doc = document) {
  const openButton = doc.getElementById('flightPlannerBtn');
  const modal = doc.getElementById('flightPlannerModal');
  const form = doc.getElementById('flightPlannerForm');
  const output = doc.getElementById('flightPlannerResult');
  if (!openButton || !modal || !form || !output) return;
  const close = () => modal.classList.add('hidden');
  openButton.addEventListener('click', () => modal.classList.remove('hidden'));
  modal.querySelector('.close-modal').addEventListener('click', close);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const windKnots = Number(data.get('windKnots') ?? 0);
    try {
      const { distanceNm, durationMinutes } = calculateRoute(
        Number(data.get('fromLat')), Number(data.get('fromLon')),
        Number(data.get('toLat')), Number(data.get('toLon')),
        Number(data.get('speedKnots')), windKnots
      );
      const windDescription = windKnots === 0 ? 'no wind' :
        `constant ${windKnots > 0 ? 'tailwind' : 'headwind'} ${Math.abs(windKnots)} kt`;
      output.textContent = `Great-circle distance: ${distanceNm.toFixed(1)} NM · Estimated time: ${Math.round(durationMinutes)} min (${windDescription})`;
    } catch (error) {
      output.textContent = error.message;
    }
  });
}

if (typeof document !== 'undefined') setupFlightPlanner();
