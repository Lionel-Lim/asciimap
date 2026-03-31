import { describe, expect, it } from 'vitest';
import {
	OPENSKY_MAX_DEGREE_SPAN,
	aircraftBoundsKey,
	clampOpenSkyBounds,
	parseOpenSkyStates
} from './opensky';

describe('clampOpenSkyBounds', () => {
	it('limits bounding boxes to the 1-credit anonymous area bucket', () => {
		const bounds = clampOpenSkyBounds({
			lamin: 40,
			lamax: 50,
			lomin: -10,
			lomax: 10
		});

		expect(bounds.lamax - bounds.lamin).toBeLessThanOrEqual(OPENSKY_MAX_DEGREE_SPAN);
		expect(bounds.lomax - bounds.lomin).toBeLessThanOrEqual(OPENSKY_MAX_DEGREE_SPAN);
	});

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
});

describe('parseOpenSkyStates', () => {
	it('extracts aircraft positions from state vectors', () => {
		const aircraft = parseOpenSkyStates({
			states: [
				[
					'40621d',
					'BAW123 ',
					'United Kingdom',
					0,
					0,
					-0.1276,
					51.5072,
					1000,
					false,
					210,
					90,
					0,
					null,
					950,
					null,
					false,
					0
				]
			]
		});

		expect(aircraft).toEqual([
			{
				icao24: '40621d',
				callsign: 'BAW123',
				longitude: -0.1276,
				latitude: 51.5072,
				onGround: false,
				velocity: 210,
				trueTrack: 90,
				geoAltitude: 950
			}
		]);
	});
});
