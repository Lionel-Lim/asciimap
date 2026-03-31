import { describe, expect, it } from 'vitest';
import type { Feature } from '$lib/ascii';
import { buildCityLabelCommands } from './cityLabels';

describe('buildCityLabelCommands', () => {
	it('prefers English names and keeps higher-priority city labels when bounds collide', () => {
		const features: Feature[] = [
			{
				geometry: { type: 'Point', coordinates: [140, 90] },
				properties: {
					__layerId: 'label_city',
					name: 'Londres',
					name_en: 'London'
				}
			},
			{
				geometry: { type: 'Point', coordinates: [144, 94] },
				properties: {
					__layerId: 'label_village',
					name: 'Smallham'
				}
			}
		];

		const commands = buildCityLabelCommands(features, { width: 320, height: 200 });

		expect(commands).toHaveLength(1);
		expect(commands[0]?.name).toBe('London');
		expect(commands[0]?.key).toContain('label_city:London');
	});
});
