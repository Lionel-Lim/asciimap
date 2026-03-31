import { describe, expect, it } from 'vitest';
import type { Feature } from '$lib/ascii';
import { buildLandmarkLabelCommands } from './landmarkLabels';

describe('buildLandmarkLabelCommands', () => {
	it('skips landmarks below their zoom threshold and uses the English name when available', () => {
		const features: Feature[] = [
			{
				geometry: { type: 'Point', coordinates: [180, 120] },
				properties: {
					__layerId: 'poi_r1',
					name: 'Musee',
					'name:en': 'Museum'
				}
			}
		];

		expect(buildLandmarkLabelCommands(features, { width: 400, height: 240 }, 13.9)).toEqual([]);

		const commands = buildLandmarkLabelCommands(features, { width: 400, height: 240 }, 14.5);
		expect(commands).toHaveLength(1);
		expect(commands[0]?.name).toBe('Museum');
	});
});
