/** Lightweight great-circle flight planning. Coordinates in degrees, speed in knots. */
const EARTH_RADIUS_NM = 3440.065;

export function calculateRoute(fromLat, fromLon, toLat, toLon, speedKnots) {
  const values = [fromLat, fromLon, toLat, toLon, speedKnots];
  if (!values.every(Number.isFinite) || Math.abs(fromLat) > 90 || Math.abs(toLat) > 90 ||
      Math.abs(fromLon) > 180 || Math.abs(toLon) > 180 || speedKnots <= 0) {
    throw new RangeError('Enter valid coordinates and a positive cruise speed.');
  }
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLat = radians(toLat - fromLat);
  const deltaLon = radians(toLon - fromLon);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(deltaLon / 2) ** 2;
  const distanceNm = 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(Math.min(1, a)));
  return { distanceNm, durationMinutes: distanceNm / speedKnots * 60 };
}

/** Initial great-circle course in degrees clockwise from true north, or null if undefined. */
export function calculateInitialBearing(fromLat, fromLon, toLat, toLon) {
  const values = [fromLat, fromLon, toLat, toLon];
  if (!values.every(Number.isFinite) || Math.abs(fromLat) > 90 || Math.abs(toLat) > 90 ||
      Math.abs(fromLon) > 180 || Math.abs(toLon) > 180) {
    throw new RangeError('Enter valid coordinates.');
  }
  const radians = degrees => degrees * Math.PI / 180;
  const start = radians(fromLat);
  const end = radians(toLat);
  const deltaLon = radians(toLon - fromLon);
  const east = Math.sin(deltaLon) * Math.cos(end);
  const north = Math.cos(start) * Math.sin(end) -
    Math.sin(start) * Math.cos(end) * Math.cos(deltaLon);
  // Coincident and antipodal points do not have a unique initial course.
  if (Math.hypot(east, north) < 1e-12) return null;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
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
    try {
      const fromLat = Number(data.get('fromLat'));
      const fromLon = Number(data.get('fromLon'));
      const toLat = Number(data.get('toLat'));
      const toLon = Number(data.get('toLon'));
      const { distanceNm, durationMinutes } = calculateRoute(
        fromLat, fromLon, toLat, toLon, Number(data.get('speedKnots'))
      );
      const bearing = calculateInitialBearing(fromLat, fromLon, toLat, toLon);
      const bearingText = bearing === null ? 'N/A' : `${bearing.toFixed(0)}° true`;
      output.textContent = `Great-circle distance: ${distanceNm.toFixed(1)} NM · Estimated time: ${Math.round(durationMinutes)} min (no wind) · Initial bearing: ${bearingText}`;
    } catch (error) {
      output.textContent = error.message;
    }
  });
}

if (typeof document !== 'undefined') setupFlightPlanner();
