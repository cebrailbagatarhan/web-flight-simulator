/** Format a pause-map position for pasting into a map search field. */
export function formatPauseCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new RangeError('Invalid geographic coordinates');
  }
  const decimal = (value) => (Object.is(value, -0) ? 0 : value).toFixed(5);
  return `${decimal(latitude)}, ${decimal(longitude)}`;
}

/** Return false when clipboard access is unavailable or denied. */
export async function tryCopyPosition(text, clipboard) {
  if (!clipboard || typeof clipboard.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
