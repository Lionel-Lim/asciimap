import { mergeAsciiPalettes } from './palettes';
import {
	clamp01,
	createGridContext,
	cellRangeForBounds,
	forEachLineSamplePoint,
	forEachLineSegment,
	forEachPolygonPart,
	lineDirection,
	lineBounds,
	lineSteps,
	pointToCellIndex,
	polygonCoverageForCellBounds,
	polygonBounds,
	resolveGridSize
} from './geometry';
import type { AsciiFrame, AsciiFrameCell, AsciiRenderInput, EntityKind, Feature } from './types';

type DirectionBucket =
	| 'horizontal'
	| 'vertical'
	| 'diagonalSlash'
	| 'diagonalBackslash'
	| 'junction';

interface CellState {
	bestEntity: EntityKind | 'background';
	coverage: number;
	roadDirectionsMask: number;
	bridgeDirectionsMask: number;
	pointsUsed: number;
}

const roadDirectionBits: Record<DirectionBucket, number> = {
	horizontal: 1,
	vertical: 2,
	diagonalSlash: 4,
	diagonalBackslash: 8,
	junction: 16
};

function createCellState(): CellState {
	return {
		bestEntity: 'background',
		coverage: 0,
		roadDirectionsMask: 0,
		bridgeDirectionsMask: 0,
		pointsUsed: 0
	};
}

function getGridConfig(input: AsciiRenderInput['config']) {
	return {
		moving: { columns: input?.grid?.moving?.columns ?? 96 },
		settled: { columns: input?.grid?.settled?.columns ?? 160 }
	};
}

function resolvePriorities(input: AsciiRenderInput): Record<EntityKind, number> {
	const zoom = input.config?.view?.zoom ?? 0;
	const buildingDominant = zoom >= 15;

	return {
		points: 5,
		cities: 4,
		bridges: 3,
		roads: buildingDominant ? 1 : 2,
		buildings: buildingDominant ? 2 : 1,
		water: 0
	};
}

function updateBestCell(
	state: CellState,
	kind: EntityKind,
	coverage: number,
	priorities: Record<EntityKind, number>
): void {
	if (coverage <= 0) {
		return;
	}

	const score = priorities[kind];
	const currentScore = state.bestEntity === 'background' ? -1 : priorities[state.bestEntity];

	if (score > currentScore || (score === currentScore && coverage > state.coverage)) {
		state.bestEntity = kind;
		state.coverage = coverage;
	}
}

function samplePolygonFeature(
	stateGrid: CellState[][],
	feature: Feature,
	kind: EntityKind,
	context: ReturnType<typeof createGridContext>,
	priorities: Record<EntityKind, number>
): void {
	forEachPolygonPart(feature, (polygon) => {
		const bounds = polygonBounds(polygon);
		if (!bounds) {
			return;
		}
		const range = cellRangeForBounds(bounds, context);
		if (!range) {
			return;
		}

		for (let row = range.startRow; row <= range.endRow; row += 1) {
			for (let column = range.startColumn; column <= range.endColumn; column += 1) {
				const x0 = column * context.cellWidth;
				const y0 = row * context.cellHeight;
				const coverage = polygonCoverageForCellBounds(
					x0,
					y0,
					x0 + context.cellWidth,
					y0 + context.cellHeight,
					polygon
				);
				if (coverage <= 0) {
					continue;
				}

				const cell = stateGrid[row]?.[column];
				if (cell) {
					updateBestCell(cell, kind, coverage, priorities);
				}
			}
		}
	});
}

function sampleLinearFeature(
	stateGrid: CellState[][],
	feature: Feature,
	kind: 'roads' | 'bridges' | 'water',
	context: ReturnType<typeof createGridContext>,
	priorities: Record<EntityKind, number>
): void {
	forEachLineSegment(feature, (segment) => {
		const segmentBounds = lineBounds(segment.start, segment.end);
		if (!segmentBounds || !cellRangeForBounds(segmentBounds, context)) {
			return;
		}

		const direction = lineDirection(segment.start, segment.end);
		const steps = lineSteps(segment.start, segment.end, context.cellWidth, context.cellHeight);
		forEachLineSamplePoint(segment.start, segment.end, steps, (point) => {
			const cellIndex = pointToCellIndex(point, context);
			if (!cellIndex) {
				return;
			}

			const cell = stateGrid[cellIndex.row]?.[cellIndex.column];
			if (!cell) {
				return;
			}

			if (kind === 'roads') {
				cell.roadDirectionsMask |= roadDirectionBits[direction];
			} else if (kind === 'bridges') {
				cell.bridgeDirectionsMask |= roadDirectionBits[direction];
			}

			updateBestCell(cell, kind, 1, priorities);
		});
	});
}

function samplePointFeature(
	stateGrid: CellState[][],
	feature: Feature,
	kind: 'points' | 'cities',
	context: ReturnType<typeof createGridContext>,
	priorities: Record<EntityKind, number>
): void {
	const points =
		feature.geometry.type === 'Point'
			? [feature.geometry.coordinates]
			: feature.geometry.type === 'MultiPoint'
				? feature.geometry.coordinates
				: [];

	for (const point of points) {
		const cellIndex = pointToCellIndex(point, context);
		if (!cellIndex) {
			continue;
		}

		const cell = stateGrid[cellIndex.row]?.[cellIndex.column];
		if (!cell) {
			continue;
		}

		if (kind === 'cities') {
			const layerId =
				typeof feature.properties?.__layerId === 'string' ? feature.properties.__layerId : '';
			const coverage =
				layerId === 'label_city_capital'
					? 1
					: layerId === 'label_city'
						? 0.92
						: layerId === 'label_town'
							? 0.72
							: layerId === 'label_village'
								? 0.58
								: 0.46;
			updateBestCell(cell, 'cities', coverage, priorities);
			continue;
		}

		cell.pointsUsed += 1;
		updateBestCell(cell, 'points', 1, priorities);
	}
}

function chooseLinearGlyph(
	mask: number,
	palette: ReturnType<typeof mergeAsciiPalettes>['roads']
): string {
	if (mask === 0) {
		return palette.horizontal[0] ?? '-';
	}

	const hasMultipleDirections = mask & (mask - 1);
	if (hasMultipleDirections) {
		return palette.junction[0] ?? '+';
	}

	switch (mask) {
		case 1:
			return palette.horizontal[0] ?? '-';
		case 2:
			return palette.vertical[0] ?? '|';
		case 4:
			return palette.diagonalSlash[0] ?? '/';
		case 8:
			return palette.diagonalBackslash[0] ?? '\\';
		case 16:
			return palette.junction[0] ?? '+';
		default:
			return palette.junction[0] ?? '+';
	}
}

function chooseDensityGlyph(
	coverage: number,
	palette: { 0: string; 1: string; 2: string; 3: string }
): string {
	if (coverage >= 0.9) {
		return palette[3];
	}
	if (coverage >= 0.6) {
		return palette[2];
	}
	if (coverage >= 0.2) {
		return palette[1];
	}
	return palette[0];
}

function resolveRoadCoverage(cell: CellState): number {
	const mask = cell.roadDirectionsMask;
	if (mask === 0) {
		return 0.58;
	}

	return mask & (mask - 1) ? 1 : 0.62;
}

function resolveBridgeCoverage(cell: CellState): number {
	const mask = cell.bridgeDirectionsMask;
	if (mask === 0) {
		return 0.64;
	}

	return mask & (mask - 1) ? 1 : 0.7;
}

function finalizeCell(
	cell: CellState,
	palettes: ReturnType<typeof mergeAsciiPalettes>
): AsciiFrameCell {
	if (cell.bestEntity === 'background') {
		return {
			char: palettes.background,
			entity: 'background',
			coverage: 0
		};
	}

	if (cell.bestEntity === 'roads') {
		return {
			char: chooseLinearGlyph(cell.roadDirectionsMask, palettes.roads),
			entity: 'roads',
			coverage: resolveRoadCoverage(cell)
		};
	}

	if (cell.bestEntity === 'bridges') {
		return {
			char: chooseLinearGlyph(cell.bridgeDirectionsMask, palettes.bridges),
			entity: 'bridges',
			coverage: resolveBridgeCoverage(cell)
		};
	}

	if (cell.bestEntity === 'cities') {
		return {
			char: cell.coverage >= 0.85 ? (palettes.cities[1] ?? 'C') : (palettes.cities[0] ?? 'c'),
			entity: 'cities',
			coverage: cell.coverage
		};
	}

	if (cell.bestEntity === 'points') {
		const char = palettes.points[Math.min(cell.pointsUsed - 1, palettes.points.length - 1)] ?? '*';
		return {
			char,
			entity: 'points',
			coverage: 1
		};
	}

	if (cell.bestEntity === 'buildings') {
		return {
			char: chooseDensityGlyph(clamp01(cell.coverage), palettes.buildings),
			entity: 'buildings',
			coverage: cell.coverage
		};
	}

	return {
		char: chooseDensityGlyph(clamp01(cell.coverage), palettes.water),
		entity: 'water',
		coverage: cell.coverage
	};
}

export function renderAsciiFrame(input: AsciiRenderInput): AsciiFrame {
	const gridConfig = getGridConfig(input.config);
	const palettes = mergeAsciiPalettes(input.config?.palettes);
	const priorities = resolvePriorities(input);
	const size = resolveGridSize(input.viewport, input.quality, gridConfig);
	const context = createGridContext(input.viewport, size);
	const stateGrid: CellState[][] = Array.from({ length: size.rows }, () =>
		Array.from({ length: size.columns }, () => createCellState())
	);

	for (const feature of input.layers.water ?? []) {
		samplePolygonFeature(stateGrid, feature, 'water', context, priorities);
		sampleLinearFeature(stateGrid, feature, 'water', context, priorities);
	}
	for (const feature of input.layers.buildings ?? []) {
		samplePolygonFeature(stateGrid, feature, 'buildings', context, priorities);
	}
	for (const feature of input.layers.bridges ?? []) {
		sampleLinearFeature(stateGrid, feature, 'bridges', context, priorities);
	}
	for (const feature of input.layers.roads ?? []) {
		sampleLinearFeature(stateGrid, feature, 'roads', context, priorities);
	}
	for (const feature of input.layers.cities ?? []) {
		samplePointFeature(stateGrid, feature, 'cities', context, priorities);
	}
	for (const feature of input.layers.points ?? []) {
		samplePointFeature(stateGrid, feature, 'points', context, priorities);
	}

	const cells: AsciiFrameCell[] = [];
	const rows: string[] = [];
	const dominantCounts: Record<'background' | EntityKind, number> = {
		background: 0,
		roads: 0,
		bridges: 0,
		buildings: 0,
		water: 0,
		cities: 0,
		points: 0
	};

	for (let row = 0; row < size.rows; row += 1) {
		const chars: string[] = [];
		for (let column = 0; column < size.columns; column += 1) {
			const cell = stateGrid[row]?.[column] ?? createCellState();
			const resolved = finalizeCell(cell, palettes);
			cells.push(resolved);
			dominantCounts[resolved.entity] += 1;
			chars.push(resolved.char);
		}
		rows.push(chars.join(''));
	}

	return {
		cols: size.columns,
		rows,
		rowCount: size.rows,
		cellWidth: context.cellWidth,
		cellHeight: context.cellHeight,
		text: rows.join('\n'),
		dominantCounts,
		cells
	};
}
