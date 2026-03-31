import { OPENSKY_POLL_INTERVAL_MS, type AircraftState } from './opensky';

export interface AircraftTrack {
	blendDurationMs: number;
	blendStartedAt: number;
	current: AircraftState;
	fromLatitude: number;
	fromLongitude: number;
	sampledAt: number;
}

export interface DisplayAircraftState extends AircraftState {
	displayLatitude: number;
	displayLongitude: number;
	heading: number;
}

export const AIRCRAFT_BLEND_DURATION_MS = 12_000;
const MAX_EXTRAPOLATION_MS = OPENSKY_POLL_INTERVAL_MS;
const METERS_PER_DEGREE_LATITUDE = 111_320;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function nearlyEqual(left: number, right: number): boolean {
	return Math.abs(left - right) < 1e-6;
}

function normalizeHeading(heading: number | null): number {
	if (typeof heading !== 'number' || Number.isNaN(heading)) {
		return 0;
	}

	const normalized = heading % 360;
	return normalized >= 0 ? normalized : normalized + 360;
}

export function extrapolateAircraftPosition(
	state: AircraftState,
	elapsedMs: number
): { latitude: number; longitude: number } {
	if (
		state.onGround ||
		typeof state.velocity !== 'number' ||
		state.velocity <= 0 ||
		typeof state.trueTrack !== 'number'
	) {
		return {
			latitude: state.latitude,
			longitude: state.longitude
		};
	}

	const elapsedSeconds = Math.max(0, Math.min(MAX_EXTRAPOLATION_MS, elapsedMs)) / 1000;
	if (elapsedSeconds === 0) {
		return {
			latitude: state.latitude,
			longitude: state.longitude
		};
	}

	const headingRadians = (normalizeHeading(state.trueTrack) * Math.PI) / 180;
	const eastMeters = Math.sin(headingRadians) * state.velocity * elapsedSeconds;
	const northMeters = Math.cos(headingRadians) * state.velocity * elapsedSeconds;
	const metersPerDegreeLongitude = Math.max(
		1,
		METERS_PER_DEGREE_LATITUDE * Math.cos((state.latitude * Math.PI) / 180)
	);

	return {
		latitude: state.latitude + northMeters / METERS_PER_DEGREE_LATITUDE,
		longitude: state.longitude + eastMeters / metersPerDegreeLongitude
	};
}

export function resolveDisplayAircraftState(
	track: AircraftTrack,
	now: number
): DisplayAircraftState {
	const blendProgress = clamp01((now - track.blendStartedAt) / track.blendDurationMs);
	const heading = normalizeHeading(track.current.trueTrack);
	const hasCorrectionBlend =
		!nearlyEqual(track.fromLatitude, track.current.latitude) ||
		!nearlyEqual(track.fromLongitude, track.current.longitude);

	if (hasCorrectionBlend && blendProgress < 1) {
		return {
			...track.current,
			displayLatitude:
				track.fromLatitude + (track.current.latitude - track.fromLatitude) * blendProgress,
			displayLongitude:
				track.fromLongitude + (track.current.longitude - track.fromLongitude) * blendProgress,
			heading
		};
	}

	const motionStartedAt = hasCorrectionBlend
		? Math.max(track.sampledAt, track.blendStartedAt + track.blendDurationMs)
		: track.sampledAt;
	const extrapolated = extrapolateAircraftPosition(
		track.current,
		Math.max(0, now - motionStartedAt)
	);

	return {
		...track.current,
		displayLatitude: extrapolated.latitude,
		displayLongitude: extrapolated.longitude,
		heading
	};
}

export function buildAircraftTracks(
	previousTracks: ReadonlyMap<string, AircraftTrack>,
	nextAircraft: readonly AircraftState[],
	fetchedAt: number,
	sampledAt: number,
	blendDurationMs = AIRCRAFT_BLEND_DURATION_MS
): Map<string, AircraftTrack> {
	const nextTracks = new Map<string, AircraftTrack>();

	for (const aircraft of nextAircraft) {
		const previousTrack = previousTracks.get(aircraft.icao24);
		const from = previousTrack
			? resolveDisplayAircraftState(previousTrack, fetchedAt)
			: {
					displayLatitude: aircraft.latitude,
					displayLongitude: aircraft.longitude
				};

		nextTracks.set(aircraft.icao24, {
			blendDurationMs,
			blendStartedAt: fetchedAt,
			current: aircraft,
			fromLatitude: from.displayLatitude,
			fromLongitude: from.displayLongitude,
			sampledAt
		});
	}

	return nextTracks;
}

export function resolveDisplayedAircraft(
	tracks: Iterable<AircraftTrack>,
	now: number
): DisplayAircraftState[] {
	const displayed: DisplayAircraftState[] = [];

	for (const track of tracks) {
		displayed.push(resolveDisplayAircraftState(track, now));
	}

	return displayed;
}
