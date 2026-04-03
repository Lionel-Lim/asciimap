import { describe, expect, it } from 'vitest';
import { buildTextFrameRows } from './textFrame';
import type { AsciiFrame } from './types';

function createFrame(): AsciiFrame {
	return {
		cols: 4,
		rows: ['RR  ', 'BBWW'],
		rowCount: 2,
		cellWidth: 10,
		cellHeight: 10,
		text: 'RR  \nBBWW',
		dominantCounts: {
			background: 2,
			bridges: 0,
			buildings: 2,
			cities: 0,
			greens: 0,
			points: 0,
			rails: 0,
			roads: 2,
			tunnels: 0,
			water: 2
		},
		cells: [
			{ char: 'R', coverage: 1, entity: 'roads' },
			{ char: 'R', coverage: 1, entity: 'roads' },
			{ char: ' ', coverage: 0, entity: 'background' },
			{ char: ' ', coverage: 0, entity: 'background' },
			{ char: 'B', coverage: 1, entity: 'buildings' },
			{ char: 'B', coverage: 1, entity: 'buildings' },
			{ char: 'W', coverage: 1, entity: 'water', opacity: 0.6 },
			{ char: 'W', coverage: 1, entity: 'water', opacity: 0.6 }
		]
	};
}

describe('buildTextFrameRows', () => {
	it('groups adjacent cells with the same entity and opacity', () => {
		const rows = buildTextFrameRows(createFrame());

		expect(rows).toHaveLength(2);
		expect(rows[0]?.segments).toEqual([
			{ entity: 'roads', opacity: 1, text: 'RR' },
			{ entity: 'background', opacity: 1, text: '  ' }
		]);
		expect(rows[1]?.segments).toEqual([
			{ entity: 'buildings', opacity: 1, text: 'BB' },
			{ entity: 'water', opacity: 0.6, text: 'WW' }
		]);
	});
});
