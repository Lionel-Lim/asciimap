import { describe, expect, it } from 'vitest';
import {
	AIRPLANES_LIVE_MAX_RADIUS_NM,
	aircraftBoundsKey,
	buildAircraftFeedQuery,
	parseAircraftFeedStates,
	resolveAircraftFeedSampledAt
} from './feed';

describe('buildAircraftFeedQuery', () => {
	it('produces a stable cache key for rounded bounds', () => {
		expect(
			aircraftBoundsKey({
				lamin: 51.33,
				lomin: -0.48,
				lamax: 51.68,
				lomax: 0.27
			})
		).toBe('51.33:-0.48:51.68:0.27');
	});

	it('converts viewport bounds into a center point and radius', () => {
		const query = buildAircraftFeedQuery({
			lamin: 51.29,
			lomin: -0.59,
			lamax: 51.61,
			lomax: 0.05
		});

		expect(query.latitude).toBeCloseTo(51.45, 2);
		expect(query.longitude).toBeCloseTo(-0.27, 2);
		expect(query.radiusNm).toBeGreaterThan(0);
		expect(query.radiusNm).toBeLessThanOrEqual(AIRPLANES_LIVE_MAX_RADIUS_NM);
	});

	it('caps very large viewports to the provider radius limit', () => {
		const query = buildAircraftFeedQuery({
			lamin: -80,
			lomin: -170,
			lamax: 80,
			lomax: 170
		});

		expect(query.radiusNm).toBe(AIRPLANES_LIVE_MAX_RADIUS_NM);
	});
});

describe('parseAircraftFeedStates', () => {
	it('extracts aircraft positions from Airplanes.live responses', () => {
		const aircraft = parseAircraftFeedStates({
			ac: [
				{
					hex: '408229',
					flight: 'BAW33A  ',
					lat: 51.478271,
					lon: -0.185803,
					alt_baro: 3025,
					alt_geom: 3300,
					gs: 178,
					track: 269.68
				}
			]
		});

		expect(aircraft).toEqual([
			{
				icao24: '408229',
				callsign: 'BAW33A',
				longitude: -0.185803,
				latitude: 51.478271,
				onGround: false,
				velocity: 178 * 0.514444,
				trueTrack: 269.68,
				geoAltitude: 3300
			}
		]);
	});

	it('falls back to the last known position when lat/lon are omitted', () => {
		const aircraft = parseAircraftFeedStates({
			ac: [
				{
					hex: '45211e',
					flight: 'CFG846 ',
					alt_baro: 'ground',
					lastPosition: {
						lat: 43.261414,
						lon: 29.636404
					}
				}
			]
		});

		expect(aircraft).toEqual([
			{
				icao24: '45211e',
				callsign: 'CFG846',
				longitude: 29.636404,
				latitude: 43.261414,
				onGround: true,
				velocity: null,
				trueTrack: null,
				geoAltitude: null
			}
		]);
	});
});

describe('resolveAircraftFeedSampledAt', () => {
	it('accepts millisecond timestamps', () => {
		expect(resolveAircraftFeedSampledAt({ now: 1_695_420_989_961 }, 0)).toBe(1_695_420_989_961);
	});

	it('normalizes second timestamps to milliseconds', () => {
		expect(resolveAircraftFeedSampledAt({ now: 1_695_420_989 }, 0)).toBe(1_695_420_989_000);
	});
});
