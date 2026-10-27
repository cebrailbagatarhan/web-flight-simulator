// The simulator stores altitude in meters; show both common cockpit units.
export function formatAltitudeDual(meters) {
  if (!Number.isFinite(meters)) return '—';
  const safeMeters = Math.max(0, meters);
  const feet = Math.round(safeMeters * 3.28084);
  const wholeMeters = Math.round(safeMeters);
  return `${feet.toLocaleString('en-US')} FT / ${wholeMeters.toLocaleString('en-US')} M`;
}
