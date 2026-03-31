import { describe, expect, it } from 'vitest';
import { resolveGridSize } from './geometry';
import { renderAsciiFrame } from './index';
import type { FeatureGroups, ViewportSize } from './types';

const viewport: ViewportSize = { width: 120, height: 120 };

function fullViewportPolygon(): FeatureGroups {
	return {
		buildings: [
			{
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[0, 0],
							[120, 0],
							[120, 120],
							[0, 120],
							[0, 0]
						]
					]
				}
			}
		]
	};
}

describe('resolveGridSize', () => {
	it('scales the grid based on quality mode', () => {
		const moving = resolveGridSize(viewport, 'moving', {
			moving: { columns: 12 },
			settled: { columns: 20 }
		});
		const settled = resolveGridSize(viewport, 'settled', {
			moving: { columns: 12 },
			settled: { columns: 20 }
		});

		expect(moving).toEqual({ columns: 12, rows: 12 });
		expect(settled).toEqual({ columns: 20, rows: 20 });
	});
});

describe('renderAsciiFrame', () => {
	it('renders polygons as filled areas', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'settled',
			layers: fullViewportPolygon(),
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.cols).toBe(6);
		expect(frame.rowCount).toBe(6);
		expect(frame.rows.every((line) => line === '######')).toBe(true);
		expect(frame.dominantCounts.buildings).toBe(36);
	});

	it('renders green landcover polygons as filled areas', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'settled',
			layers: {
				greens: fullViewportPolygon().buildings
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.rows.every((line) => line === '%%%%%%')).toBe(true);
		expect(frame.dominantCounts.greens).toBe(36);
	});

	it('renders roads as directional strokes over lower-priority features', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'settled',
			layers: {
				...fullViewportPolygon(),
				roads: [
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 60],
								[120, 60]
							]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.rows[3]).toContain('-');
		expect(frame.rows.some((line) => line.includes('#'))).toBe(true);
	});

	it('keeps building massing at close zoom instead of letting roads replace it', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'settled',
			layers: {
				...fullViewportPolygon(),
				roads: [
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 60],
								[120, 60]
							]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				},
				view: {
					zoom: 15.2
				}
			}
		});

		expect(frame.rows[3]).not.toContain('-');
		expect(frame.rows[3]).toContain('#');
	});

	it('renders points as stamps', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'moving',
			layers: {
				points: [
					{
						geometry: {
							type: 'Point',
							coordinates: [60, 60]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.text).toContain('*');
	});

	it('renders rail lines as distinct linear features', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'moving',
			layers: {
				rails: [
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 60],
								[120, 60]
							]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.rows[3]).toContain('r');
		expect(frame.dominantCounts.rails).toBeGreaterThan(0);
	});

	it('renders tunnels as distinct linear features', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'moving',
			layers: {
				tunnels: [
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 60],
								[120, 60]
							]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.rows[3]).toContain('u');
		expect(frame.dominantCounts.tunnels).toBeGreaterThan(0);
	});

	it('renders water line features in the water layer', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'moving',
			layers: {
				water: [
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[0, 60],
								[120, 60]
							]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.rows[3]).toContain('=');
		expect(frame.dominantCounts.water).toBeGreaterThan(0);
	});

	it('culls geometry outside the viewport instead of clamping it to edges', () => {
		const frame = renderAsciiFrame({
			viewport,
			quality: 'moving',
			layers: {
				roads: [
					{
						geometry: {
							type: 'LineString',
							coordinates: [
								[-120, 60],
								[-10, 60]
							]
						}
					}
				]
			},
			config: {
				grid: {
					moving: { columns: 6 },
					settled: { columns: 6 }
				}
			}
		});

		expect(frame.rows.every((line) => line === '      ')).toBe(true);
		expect(frame.dominantCounts.background).toBe(36);
	});
});
