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

export const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
export const OPENSKY_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const OPENSKY_MAX_DEGREE_SPAN = 3.5;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function roundCoordinate(value: number): number {
	return Math.round(value * 100) / 100;
}

export function clampOpenSkyBounds(bounds: AircraftBounds): AircraftBounds {
	const centerLat = (bounds.lamin + bounds.lamax) / 2;
	const centerLon = (bounds.lomin + bounds.lomax) / 2;
	const latSpan = Math.min(Math.abs(bounds.lamax - bounds.lamin), OPENSKY_MAX_DEGREE_SPAN);
	const lonSpan = Math.min(Math.abs(bounds.lomax - bounds.lomin), OPENSKY_MAX_DEGREE_SPAN);
	const halfLat = latSpan / 2;
	const halfLon = lonSpan / 2;

	return {
		lamin: roundCoordinate(clamp(centerLat - halfLat, -90, 90)),
		lamax: roundCoordinate(clamp(centerLat + halfLat, -90, 90)),
		lomin: roundCoordinate(clamp(centerLon - halfLon, -180, 180)),
		lomax: roundCoordinate(clamp(centerLon + halfLon, -180, 180))
	};
}

export function aircraftBoundsKey(bounds: AircraftBounds): string {
	return `${bounds.lamin}:${bounds.lomin}:${bounds.lamax}:${bounds.lomax}`;
}

export function parseOpenSkyStates(payload: unknown): AircraftState[] {
	if (
		!payload ||
		typeof payload !== 'object' ||
		!Array.isArray((payload as { states?: unknown }).states)
	) {
		return [];
	}

	const states = (payload as { states: unknown[] }).states;
	const aircraft: AircraftState[] = [];

	for (const rawState of states) {
		if (!Array.isArray(rawState)) {
			continue;
		}

		const icao24 = typeof rawState[0] === 'string' ? rawState[0].trim() : '';
		const callsign =
			typeof rawState[1] === 'string' && rawState[1].trim().length > 0 ? rawState[1].trim() : null;
		const longitude = typeof rawState[5] === 'number' ? rawState[5] : null;
		const latitude = typeof rawState[6] === 'number' ? rawState[6] : null;
		const onGround = rawState[8] === true;
		const velocity = typeof rawState[9] === 'number' ? rawState[9] : null;
		const trueTrack = typeof rawState[10] === 'number' ? rawState[10] : null;
		const geoAltitude = typeof rawState[13] === 'number' ? rawState[13] : null;

		if (!icao24 || latitude === null || longitude === null) {
			continue;
		}

		aircraft.push({
			icao24,
			callsign,
			longitude,
			latitude,
			onGround,
			velocity,
			trueTrack,
			geoAltitude
		});
	}

	return aircraft;
}
