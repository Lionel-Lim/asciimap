export interface AircraftBounds {
	lamax: number;
	lamin: number;
	lomax: number;
	lomin: number;
}

export interface AircraftState {
	callsign: string | null;
	geoAltitude: number | null;
	icao24: string;
	latitude: number;
	longitude: number;
	onGround: boolean;
	trueTrack: number | null;
	velocity: number | null;
}

export interface AircraftFeedQuery {
	latitude: number;
	longitude: number;
	radiusNm: number;
}

export const AIRCRAFT_FEED_URL = 'https://api.airplanes.live/v2/point';
export const AIRCRAFT_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const AIRCRAFT_MIN_REQUEST_GAP_MS = 1_500;
export const AIRPLANES_LIVE_MAX_RADIUS_NM = 250;
const KNOTS_TO_METERS_PER_SECOND = 0.514444;
const METERS_PER_NAUTICAL_MILE = 1852;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function roundCoordinate(value: number): number {
	return Math.round(value * 100) / 100;
}

function roundRadius(value: number): number {
	return Math.round(value * 10) / 10;
}

function toRadians(value: number): number {
	return (value * Math.PI) / 180;
}

function haversineDistanceMeters(
	startLatitude: number,
	startLongitude: number,
	endLatitude: number,
	endLongitude: number
): number {
	const deltaLatitude = toRadians(endLatitude - startLatitude);
	const deltaLongitude = toRadians(endLongitude - startLongitude);
	const latitudeA = toRadians(startLatitude);
	const latitudeB = toRadians(endLatitude);
	const haversine =
		Math.sin(deltaLatitude / 2) ** 2 +
		Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;

	return 2 * 6_371_000 * Math.asin(Math.sqrt(haversine));
}

export function normalizeAircraftBounds(bounds: AircraftBounds): AircraftBounds {
	return {
		lamin: roundCoordinate(clamp(bounds.lamin, -90, 90)),
		lamax: roundCoordinate(clamp(bounds.lamax, -90, 90)),
		lomin: roundCoordinate(clamp(bounds.lomin, -180, 180)),
		lomax: roundCoordinate(clamp(bounds.lomax, -180, 180))
	};
}

export function aircraftBoundsKey(bounds: AircraftBounds): string {
	return `${bounds.lamin}:${bounds.lomin}:${bounds.lamax}:${bounds.lomax}`;
}

export function buildAircraftFeedQuery(bounds: AircraftBounds): AircraftFeedQuery {
	const normalizedBounds = normalizeAircraftBounds(bounds);
	const latitude = roundCoordinate((normalizedBounds.lamin + normalizedBounds.lamax) / 2);
	const longitude = roundCoordinate((normalizedBounds.lomin + normalizedBounds.lomax) / 2);
	const corners = [
		[normalizedBounds.lamin, normalizedBounds.lomin],
		[normalizedBounds.lamin, normalizedBounds.lomax],
		[normalizedBounds.lamax, normalizedBounds.lomin],
		[normalizedBounds.lamax, normalizedBounds.lomax]
	] as const;
	const radiusMeters = Math.max(
		...corners.map(([cornerLatitude, cornerLongitude]) =>
			haversineDistanceMeters(latitude, longitude, cornerLatitude, cornerLongitude)
		)
	);

	return {
		latitude,
		longitude,
		radiusNm: roundRadius(
			Math.max(1, Math.min(AIRPLANES_LIVE_MAX_RADIUS_NM, radiusMeters / METERS_PER_NAUTICAL_MILE))
		)
	};
}

export function buildAircraftFeedUrl(query: AircraftFeedQuery): URL {
	return new URL(`${AIRCRAFT_FEED_URL}/${query.latitude}/${query.longitude}/${query.radiusNm}`);
}

function parseSampledAt(rawTimestamp: unknown, fallback: number): number {
	if (typeof rawTimestamp !== 'number' || Number.isNaN(rawTimestamp)) {
		return fallback;
	}

	return rawTimestamp >= 100_000_000_000 ? rawTimestamp : rawTimestamp * 1000;
}

export function resolveAircraftFeedSampledAt(payload: unknown, fallback: number): number {
	if (!payload || typeof payload !== 'object') {
		return fallback;
	}

	return parseSampledAt((payload as { now?: unknown }).now, fallback);
}

export function parseAircraftFeedStates(payload: unknown): AircraftState[] {
	if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { ac?: unknown }).ac)) {
		return [];
	}

	const aircraft: AircraftState[] = [];

	for (const rawState of (payload as { ac: unknown[] }).ac) {
		if (!rawState || typeof rawState !== 'object') {
			continue;
		}

		const state = rawState as {
			alt_baro?: unknown;
			alt_geom?: unknown;
			flight?: unknown;
			gs?: unknown;
			hex?: unknown;
			lastPosition?: { lat?: unknown; lon?: unknown } | null;
			lat?: unknown;
			lon?: unknown;
			track?: unknown;
		};
		const icao24 = typeof state.hex === 'string' ? state.hex.trim() : '';
		const callsign =
			typeof state.flight === 'string' && state.flight.trim().length > 0
				? state.flight.trim()
				: null;
		const latitude =
			typeof state.lat === 'number'
				? state.lat
				: typeof state.lastPosition?.lat === 'number'
					? state.lastPosition.lat
					: null;
		const longitude =
			typeof state.lon === 'number'
				? state.lon
				: typeof state.lastPosition?.lon === 'number'
					? state.lastPosition.lon
					: null;

		if (!icao24 || latitude === null || longitude === null) {
			continue;
		}

		aircraft.push({
			icao24,
			callsign,
			longitude,
			latitude,
			onGround: state.alt_baro === 'ground',
			velocity: typeof state.gs === 'number' ? state.gs * KNOTS_TO_METERS_PER_SECOND : null,
			trueTrack: typeof state.track === 'number' ? state.track : null,
			geoAltitude: typeof state.alt_geom === 'number' ? state.alt_geom : null
		});
	}

	return aircraft;
}
