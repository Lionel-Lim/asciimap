import { describe, expect, it } from 'vitest';
import type { ProjectedAircraftMarker } from '$lib/aircraft/stamp';
import type { CityLabelCommand } from '$lib/map/cityLabels';
import type { LandmarkLabelCommand } from '$lib/map/landmarkLabels';
import { composeTextModeFrame, TEXT_AIRCRAFT_GLYPHS } from './textComposer';
import type { AsciiFrame } from './types';

function createFrame(): AsciiFrame {
	const cols = 6;
	const rowCount = 3;
	const rows = ['......', '......', '......'];
	return {
		cols,
		rows,
		rowCount,
		cellWidth: 10,
		cellHeight: 10,
		text: rows.join('\n'),
		dominantCounts: {
			background: cols * rowCount,
			bridges: 0,
			buildings: 0,
			cities: 0,
			greens: 0,
			points: 0,
			rails: 0,
			roads: 0,
			tunnels: 0,
			water: 0
		},
		cells: Array.from({ length: cols * rowCount }, () => ({
			char: '.',
			coverage: 1,
			entity: 'background' as const,
			opacity: 1
		}))
	};
}

describe('composeTextModeFrame', () => {
	it('stamps city and landmark labels directly into the ASCII frame', () => {
		const cityLabel: CityLabelCommand = {
			font: '600 12px "IBM Plex Mono"',
			height: 12,
			key: 'city:london',
			name: 'LDN',
			opacity: 0.9,
			priority: 3,
			width: 30,
			x: 25,
			y: 15
		};
		const landmarkLabel: LandmarkLabelCommand = {
			font: '600 12px "IBM Plex Mono"',
			height: 12,
			key: 'landmark:tower',
			name: 'TWR',
			opacity: 0.82,
			priority: 2,
			width: 30,
			x: 45,
			y: 5
		};

		const resolved = composeTextModeFrame(createFrame(), {
			cityLabels: [cityLabel],
			landmarkLabels: [landmarkLabel]
		});

		expect(resolved.frame.rows).toEqual(['...TWR', '.LDN..', '......']);
		expect(resolved.frame.cells?.slice(3, 6)).toEqual([
			{ char: 'T', coverage: 1, entity: 'points', opacity: 0.82 },
			{ char: 'W', coverage: 1, entity: 'points', opacity: 0.82 },
			{ char: 'R', coverage: 1, entity: 'points', opacity: 0.82 }
		]);
		expect(resolved.frame.cells?.slice(7, 10)).toEqual([
			{ char: 'L', coverage: 1, entity: 'cities', opacity: 0.9 },
			{ char: 'D', coverage: 1, entity: 'cities', opacity: 0.9 },
			{ char: 'N', coverage: 1, entity: 'cities', opacity: 0.9 }
		]);
	});

	it('renders aircraft as inline 8-direction arrows and de-duplicates occupied cells', () => {
		const markers: ProjectedAircraftMarker[] = [
			{ heading: 180, onGround: false, x: 35, y: 15 },
			{ heading: 225, onGround: true, x: 34, y: 16 },
			{ heading: 315, onGround: true, x: 55, y: 25 }
		];

		const resolved = composeTextModeFrame(createFrame(), { aircraft: markers });

		expect(resolved.visibleAircraftCount).toBe(2);
		expect(resolved.frame.rows).toEqual(['......', '...↓..', '.....↖']);
		expect(resolved.frame.cells?.[9]).toEqual({
			char: TEXT_AIRCRAFT_GLYPHS[4],
			coverage: 1,
			entity: 'points',
			opacity: 0.96
		});
		expect(resolved.frame.cells?.[17]).toEqual({
			char: TEXT_AIRCRAFT_GLYPHS[7],
			coverage: 1,
			entity: 'points',
			opacity: 0.72
		});
	});
});
