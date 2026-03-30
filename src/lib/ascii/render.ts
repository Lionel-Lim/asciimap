import { defaultAsciiPalettes, mergeAsciiPalettes } from './palettes';
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
	pointsUsed: number;
}

const priorities: Record<EntityKind, number> = {
	points: 3,
	roads: 2,
	buildings: 1,
	water: 0
};

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
		pointsUsed: 0
	};
}

function getGridConfig(input: AsciiRenderInput['config']) {
	return {
		moving: { columns: input?.grid?.moving?.columns ?? 96 },
		settled: { columns: input?.grid?.settled?.columns ?? 160 }
	};
}

function updateBestCell(state: CellState, kind: EntityKind, coverage: number): void {
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
	context: ReturnType<typeof createGridContext>
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
					updateBestCell(cell, kind, coverage);
				}
			}
		}
	});
}

function sampleLinearFeature(
	stateGrid: CellState[][],
	feature: Feature,
	kind: 'roads' | 'water',
	context: ReturnType<typeof createGridContext>
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
			}

			updateBestCell(cell, kind, 1);
		});
	});
}

function samplePointFeature(
	stateGrid: CellState[][],
	feature: Feature,
	context: ReturnType<typeof createGridContext>
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

		cell.pointsUsed += 1;
		updateBestCell(cell, 'points', 1);
	}
}

function chooseRoadGlyph(cell: CellState, palettes = defaultAsciiPalettes): string {
	const mask = cell.roadDirectionsMask;
	if (mask === 0) {
		return palettes.roads.horizontal[0] ?? '-';
	}

	const hasMultipleDirections = mask & (mask - 1);
	if (hasMultipleDirections) {
		return palettes.roads.junction[0] ?? '+';
	}

	switch (mask) {
		case 1:
			return palettes.roads.horizontal[0] ?? '-';
		case 2:
			return palettes.roads.vertical[0] ?? '|';
		case 4:
			return palettes.roads.diagonalSlash[0] ?? '/';
		case 8:
			return palettes.roads.diagonalBackslash[0] ?? '\\';
		case 16:
			return palettes.roads.junction[0] ?? '+';
		default:
			return palettes.roads.junction[0] ?? '+';
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
			char: chooseRoadGlyph(cell, palettes),
			entity: 'roads',
			coverage: 1
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
	const size = resolveGridSize(input.viewport, input.quality, gridConfig);
	const context = createGridContext(input.viewport, size);
	const stateGrid: CellState[][] = Array.from({ length: size.rows }, () =>
		Array.from({ length: size.columns }, () => createCellState())
	);

	for (const feature of input.layers.water ?? []) {
		samplePolygonFeature(stateGrid, feature, 'water', context);
		sampleLinearFeature(stateGrid, feature, 'water', context);
	}
	for (const feature of input.layers.buildings ?? []) {
		samplePolygonFeature(stateGrid, feature, 'buildings', context);
	}
	for (const feature of input.layers.roads ?? []) {
		sampleLinearFeature(stateGrid, feature, 'roads', context);
	}
	for (const feature of input.layers.points ?? []) {
		samplePointFeature(stateGrid, feature, context);
	}

	const cells: AsciiFrameCell[] = [];
	const rows: string[] = [];
	const dominantCounts: Record<'background' | EntityKind, number> = {
		background: 0,
		roads: 0,
		buildings: 0,
		water: 0,
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
