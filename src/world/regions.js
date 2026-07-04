export async function reverseGeocode(lon, lat) {
	try {
		const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=5&addressdetails=1`);
		const data = await response.json();

		if (data && data.address) {
			const addr = data.address;
			const state = addr.state || addr.region || addr.province;
			const country = addr.country;

			if (state && country) {
				return `${state}, ${country}`.toUpperCase();
			}

			if (country) {
				return country.toUpperCase();
			}
		}
	} catch (error) {
		console.error('Reverse geocoding error:', error);
	}

	return null;
}

export function calculateDistance(lon1, lat1, lon2, lat2) {
	const earthRadius = 6371e3;
	const lat1Rad = lat1 * Math.PI / 180;
	const lat2Rad = lat2 * Math.PI / 180;
	const deltaLat = (lat2 - lat1) * Math.PI / 180;
	const deltaLon = (lon2 - lon1) * Math.PI / 180;

	const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
		Math.cos(lat1Rad) * Math.cos(lat2Rad) *
		Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return earthRadius * c;
}
