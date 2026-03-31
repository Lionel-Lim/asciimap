import { describe, expect, it } from 'vitest';
import type { AsciiFrame } from '$lib/ascii';
import { stampAircraftGlyphs } from './stamp';

function createFrame(): AsciiFrame {
	const cells = Array.from({ length: 9 }, () => ({
		char: '.',
		entity: 'background' as const,
		coverage: 0
	}));

	return {
		cols: 3,
		rows: ['...', '...', '...'],
		rowCount: 3,
		cellWidth: 10,
		cellHeight: 10,
		text: '...\n...\n...',
		dominantCounts: {
			background: 9,
			roads: 0,
			bridges: 0,
			buildings: 0,
			water: 0,
			greens: 0,
			rails: 0,
			tunnels: 0,
			cities: 0,
			points: 0
		},
		cells
	};
}

describe('stampAircraftGlyphs', () => {
	it('reserves space in the field and returns a positioned glyph command', () => {
		const { frame, glyphs, visibleCount } = stampAircraftGlyphs(createFrame(), [
			{ heading: 90, x: 15, y: 15, onGround: false }
		]);

		expect(visibleCount).toBe(1);
		expect(glyphs).toHaveLength(1);
		expect(glyphs[0]).toMatchObject({
			clearHeight: expect.any(Number),
			clearWidth: expect.any(Number),
			rotation: 90,
			x: 15,
			y: 15
		});
		expect(glyphs[0]?.segments).toHaveLength(3);
		expect(glyphs[0]?.segments.map((segment) => segment.char)).toEqual(['a', 'A', 'a']);
		expect(frame.rows[1]).toBe('...');
	});

	it('skips aircraft outside the frame', () => {
		const { frame, glyphs, visibleCount } = stampAircraftGlyphs(createFrame(), [
			{ heading: 45, x: -20, y: -20, onGround: false }
		]);

		expect(visibleCount).toBe(0);
		expect(glyphs).toEqual([]);
		expect(frame.rows).toEqual(['...', '...', '...']);
	});

	it('keeps only one aircraft per occupied cell', () => {
		const { visibleCount } = stampAircraftGlyphs(createFrame(), [
			{ heading: 0, x: 15, y: 15, onGround: false },
			{ heading: 180, x: 14, y: 16, onGround: true }
		]);

		expect(visibleCount).toBe(1);
	});
});
