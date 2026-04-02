import { describe, expect, it } from 'vitest';
import {
	AIRCRAFT_BLEND_DURATION_MS,
	buildAircraftTracks,
	extrapolateAircraftPosition,
	resolveDisplayAircraftState
} from './motion';
import type { AircraftState } from './feed';

const sampleAircraft: AircraftState = {
	callsign: 'BAW123',
	geoAltitude: 10_500,
	icao24: '40621d',
	latitude: 51.5,
	longitude: -0.12,
	onGround: false,
	trueTrack: 90,
	velocity: 250
};

describe('extrapolateAircraftPosition', () => {
	it('moves eastbound aircraft forward over time', () => {
		const next = extrapolateAircraftPosition(sampleAircraft, 30_000);

		expect(next.latitude).toBeCloseTo(sampleAircraft.latitude, 3);
		expect(next.longitude).toBeGreaterThan(sampleAircraft.longitude);
	});

	it('does not move grounded aircraft', () => {
		const next = extrapolateAircraftPosition({ ...sampleAircraft, onGround: true }, 45_000);

		expect(next).toEqual({
			latitude: sampleAircraft.latitude,
			longitude: sampleAircraft.longitude
		});
	});
});

describe('buildAircraftTracks', () => {
	it('moves immediately after the first sample instead of waiting for a correction blend', () => {
		const fetchedAt = 1_000_000;
		const tracks = buildAircraftTracks(new Map(), [sampleAircraft], fetchedAt, fetchedAt);
		const track = tracks.get(sampleAircraft.icao24);

		expect(track).toBeDefined();

		const displayed = resolveDisplayAircraftState(track!, fetchedAt + 5_000);
		expect(displayed.displayLongitude).toBeGreaterThan(sampleAircraft.longitude);
	});

	it('blends from the previously displayed position into the new sample', () => {
		const now = 1_000_000;
		const previousTracks = buildAircraftTracks(new Map(), [sampleAircraft], now, now);
		const updated = buildAircraftTracks(
			previousTracks,
			[
				{
					...sampleAircraft,
					latitude: 51.6,
					longitude: -0.02
				}
			],
			now + 60_000,
			now + 60_000
		);

		const track = updated.get(sampleAircraft.icao24);
		expect(track).toBeDefined();
		expect(track?.fromLatitude).toBeCloseTo(sampleAircraft.latitude, 5);
		expect(track?.fromLongitude).toBeGreaterThan(sampleAircraft.longitude);
	});

	it('resolves halfway through the correction blend', () => {
		const fetchedAt = 2_000_000;
		const track = {
			blendDurationMs: AIRCRAFT_BLEND_DURATION_MS,
			blendStartedAt: fetchedAt,
			current: {
				...sampleAircraft,
				latitude: 51.6,
				longitude: -0.02
			},
			fromLatitude: 51.5,
			fromLongitude: -0.12,
			sampledAt: fetchedAt
		};

		const displayed = resolveDisplayAircraftState(
			track,
			fetchedAt + AIRCRAFT_BLEND_DURATION_MS / 2
		);

		expect(displayed.displayLatitude).toBeCloseTo(51.55, 2);
		expect(displayed.displayLongitude).toBeCloseTo(-0.07, 2);
	});
});
