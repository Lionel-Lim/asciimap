import { mergeAsciiPalettes } from './palettes';
import {
	clamp01,
	createGridContext,
	lineDirection,
	lineSteps,
	pointToCellIndex,
	resolveGridSize
} from './geometry';
import { renderAsciiFrame as renderAsciiFrameFallback } from './render';
import type {
	AsciiFrame,
	AsciiFrameCell,
	AsciiRenderInput,
	EntityKind,
	Feature,
	Geometry
} from './types';

type DirectionBucket =
	| 'horizontal'
	| 'vertical'
	| 'diagonalSlash'
	| 'diagonalBackslash'
	| 'junction';

type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;
type CanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

interface CellState {
	bestEntity: EntityKind | 'background';
	coverage: number;
	roadDirectionsMask: number;
	bridgeDirectionsMask: number;
	railDirectionsMask: number;
	tunnelDirectionsMask: number;
	pointsUsed: number;
}

interface RasterBuffers {
	canvas: CanvasSurface;
	context: CanvasContext;
	sampleWidth: number;
	sampleHeight: number;
	supersample: number;
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
		railDirectionsMask: 0,
		tunnelDirectionsMask: 0,
		pointsUsed: 0
	};
}

function resetCellState(state: CellState): void {
	state.bestEntity = 'background';
	state.coverage = 0;
	state.roadDirectionsMask = 0;
	state.bridgeDirectionsMask = 0;
	state.railDirectionsMask = 0;
	state.tunnelDirectionsMask = 0;
	state.pointsUsed = 0;
}

function getGridConfig(input: AsciiRenderInput['config']) {
	return {
		moving: { columns: input?.grid?.moving?.columns ?? 96 },
		settled: { columns: input?.grid?.settled?.columns ?? 160 }
	};
}

function resolveWaterDetail(input: AsciiRenderInput): number {
	return Math.max(0, Math.min(100, input.config?.detail?.water ?? 50));
}

function resolveWaterStrokeWidth(waterDetail: number): number {
	return 1.8 + (waterDetail / 100) * 2.8;
}

function amplifyWaterCoverage(coverage: number, waterDetail: number): number {
	const normalizedDetail = waterDetail / 100;
	if (coverage <= 0) {
		return 0;
	}

	return clamp01(coverage * (0.88 + normalizedDetail * 0.5));
}

function resolvePriorities(input: AsciiRenderInput): Record<EntityKind, number> {
	const zoom = input.config?.view?.zoom ?? 0;
	const buildingDominant = zoom >= 15;

	return {
		points: 8,
		cities: 7,
		bridges: 6,
		rails: 5,
		roads: buildingDominant ? 3 : 4,
		tunnels: buildingDominant ? 2 : 3,
		buildings: buildingDominant ? 4 : 2,
		greens: 1,
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

function resolveRailCoverage(cell: CellState): number {
	const mask = cell.railDirectionsMask;
	if (mask === 0) {
		return 0.68;
	}

	return mask & (mask - 1) ? 1 : 0.76;
}

function resolveTunnelCoverage(cell: CellState): number {
	const mask = cell.tunnelDirectionsMask;
	if (mask === 0) {
		return 0.52;
	}

	return mask & (mask - 1) ? 0.86 : 0.58;
}

function resolveCityCoverage(feature: Feature): number {
	const layerId =
		typeof feature.layerId === 'string'
			? feature.layerId
			: typeof feature.properties?.__layerId === 'string'
				? feature.properties.__layerId
				: '';

	switch (layerId) {
		case 'label_city_capital':
			return 1;
		case 'label_city':
			return 0.92;
		case 'label_town':
			return 0.72;
		case 'label_village':
			return 0.58;
		default:
			return 0.46;
	}
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

	if (cell.bestEntity === 'rails') {
		return {
			char: chooseLinearGlyph(cell.railDirectionsMask, palettes.rails),
			entity: 'rails',
			coverage: resolveRailCoverage(cell)
		};
	}

	if (cell.bestEntity === 'tunnels') {
		return {
			char: chooseLinearGlyph(cell.tunnelDirectionsMask, palettes.tunnels),
			entity: 'tunnels',
			coverage: resolveTunnelCoverage(cell)
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

	if (cell.bestEntity === 'greens') {
		return {
			char: chooseDensityGlyph(clamp01(cell.coverage), palettes.greens),
			entity: 'greens',
			coverage: cell.coverage
		};
	}

	return {
		char: chooseDensityGlyph(clamp01(cell.coverage), palettes.water),
		entity: 'water',
		coverage: cell.coverage
	};
}

function createCanvasSurface(width: number, height: number): RasterBuffers | null {
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (context) {
			return {
				canvas,
				context,
				sampleWidth: width,
				sampleHeight: height,
				supersample: 1
			};
		}
	}

	const offscreenConstructor = globalThis.OffscreenCanvas;
	if (offscreenConstructor) {
		const canvas = new offscreenConstructor(width, height);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (context) {
			return {
				canvas,
				context,
				sampleWidth: width,
				sampleHeight: height,
				supersample: 1
			};
		}
	}

	return null;
}

function ensureBuffers(
	buffers: RasterBuffers | null,
	sampleWidth: number,
	sampleHeight: number,
	supersample: number
): RasterBuffers | null {
	if (!buffers || buffers.sampleWidth !== sampleWidth || buffers.sampleHeight !== sampleHeight) {
		const next = createCanvasSurface(sampleWidth, sampleHeight);
		if (!next) {
			return null;
		}

		next.supersample = supersample;
		return next;
	}

	buffers.supersample = supersample;
	return buffers;
}

function beginPath(context: CanvasContext, geometry: Geometry): boolean {
	switch (geometry.type) {
		case 'Polygon': {
			context.beginPath();
			for (const ring of geometry.coordinates) {
				if (ring.length === 0) {
					continue;
				}
				context.moveTo(ring[0][0], ring[0][1]);
				for (let index = 1; index < ring.length; index += 1) {
					const point = ring[index];
					if (point) {
						context.lineTo(point[0], point[1]);
					}
				}
				context.closePath();
			}
			return true;
		}
		case 'MultiPolygon': {
			context.beginPath();
			for (const polygon of geometry.coordinates) {
				for (const ring of polygon) {
					if (ring.length === 0) {
						continue;
					}
					context.moveTo(ring[0][0], ring[0][1]);
					for (let index = 1; index < ring.length; index += 1) {
						const point = ring[index];
						if (point) {
							context.lineTo(point[0], point[1]);
						}
					}
					context.closePath();
				}
			}
			return true;
		}
		case 'LineString': {
			if (geometry.coordinates.length === 0) {
				return false;
			}
			context.beginPath();
			context.moveTo(geometry.coordinates[0][0], geometry.coordinates[0][1]);
			for (let index = 1; index < geometry.coordinates.length; index += 1) {
				const point = geometry.coordinates[index];
				if (point) {
					context.lineTo(point[0], point[1]);
				}
			}
			return true;
		}
		case 'MultiLineString': {
			context.beginPath();
			for (const line of geometry.coordinates) {
				if (line.length === 0) {
					continue;
				}
				context.moveTo(line[0][0], line[0][1]);
				for (let index = 1; index < line.length; index += 1) {
					const point = line[index];
					if (point) {
						context.lineTo(point[0], point[1]);
					}
				}
			}
			return true;
		}
		default:
			return false;
	}
}

function rasterizeCoverage(
	buffers: RasterBuffers,
	features: readonly Feature[],
	input: AsciiRenderInput,
	kind: 'water' | 'buildings' | 'greens',
	coverage: Float32Array
): Float32Array {
	const { context, sampleWidth, sampleHeight, supersample } = buffers;
	coverage.fill(0);

	if (features.length === 0) {
		return coverage;
	}

	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, sampleWidth, sampleHeight);
	context.setTransform(
		sampleWidth / input.viewport.width,
		0,
		0,
		sampleHeight / input.viewport.height,
		0,
		0
	);
	context.fillStyle = '#ffffff';
	context.strokeStyle = '#ffffff';
	context.lineCap = 'round';
	context.lineJoin = 'round';
	context.lineWidth = kind === 'water' ? resolveWaterStrokeWidth(resolveWaterDetail(input)) : 1;

	for (const feature of features) {
		const geometry = feature.geometry;
		if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
			if (beginPath(context, geometry)) {
				context.fill('evenodd');
			}
			continue;
		}

		if (
			kind === 'water' &&
			(geometry.type === 'LineString' || geometry.type === 'MultiLineString')
		) {
			if (beginPath(context, geometry)) {
				context.stroke();
			}
		}
	}

	const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
	const cols = sampleWidth / supersample;
	const rows = sampleHeight / supersample;

	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < cols; column += 1) {
			let alpha = 0;
			for (let sampleRow = 0; sampleRow < supersample; sampleRow += 1) {
				for (let sampleColumn = 0; sampleColumn < supersample; sampleColumn += 1) {
					const x = column * supersample + sampleColumn;
					const y = row * supersample + sampleRow;
					alpha += data[(y * sampleWidth + x) * 4 + 3] ?? 0;
				}
			}
			const alphaCoverage = alpha / (255 * supersample * supersample);
			coverage[row * cols + column] =
				kind === 'water'
					? amplifyWaterCoverage(alphaCoverage, resolveWaterDetail(input))
					: alphaCoverage;
		}
	}

	return coverage;
}

function ensureStateGrid(stateGrid: CellState[][], rows: number, cols: number): CellState[][] {
	if (stateGrid.length !== rows || stateGrid[0]?.length !== cols) {
		return Array.from({ length: rows }, () =>
			Array.from({ length: cols }, () => createCellState())
		);
	}

	for (let row = 0; row < rows; row += 1) {
		const currentRow = stateGrid[row]!;
		for (let column = 0; column < cols; column += 1) {
			resetCellState(currentRow[column]!);
		}
	}

	return stateGrid;
}

function ensureCoverageBuffer(buffer: Float32Array | null, length: number): Float32Array {
	if (!buffer || buffer.length !== length) {
		return new Float32Array(length);
	}

	buffer.fill(0);
	return buffer;
}

function sampleRoadLikeFeature(
	stateGrid: CellState[][],
	feature: Feature,
	kind: 'roads' | 'bridges' | 'rails' | 'tunnels',
	context: ReturnType<typeof createGridContext>,
	priorities: Record<EntityKind, number>
): void {
	const lines =
		feature.geometry.type === 'LineString'
			? [feature.geometry.coordinates]
			: feature.geometry.type === 'MultiLineString'
				? feature.geometry.coordinates
				: [];

	for (const line of lines) {
		for (let index = 1; index < line.length; index += 1) {
			const start = line[index - 1];
			const end = line[index];
			if (!start || !end) {
				continue;
			}

			const direction = lineDirection(start, end);
			const steps = lineSteps(start, end, context.cellWidth, context.cellHeight);

			for (let step = 0; step <= steps; step += 1) {
				const t = steps === 0 ? 0 : step / steps;
				const point: [number, number] = [
					start[0] + (end[0] - start[0]) * t,
					start[1] + (end[1] - start[1]) * t
				];
				const cellIndex = pointToCellIndex(point, context);
				if (!cellIndex) {
					continue;
				}

				const cell = stateGrid[cellIndex.row]?.[cellIndex.column];
				if (!cell) {
					continue;
				}

				if (kind === 'bridges') {
					cell.bridgeDirectionsMask |= roadDirectionBits[direction];
				} else if (kind === 'rails') {
					cell.railDirectionsMask |= roadDirectionBits[direction];
				} else if (kind === 'tunnels') {
					cell.tunnelDirectionsMask |= roadDirectionBits[direction];
				} else {
					cell.roadDirectionsMask |= roadDirectionBits[direction];
				}
				updateBestCell(cell, kind, 1, priorities);
			}
		}
	}
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
			updateBestCell(cell, 'cities', resolveCityCoverage(feature), priorities);
			continue;
		}

		cell.pointsUsed += 1;
		updateBestCell(cell, 'points', 1, priorities);
	}
}

export function createRasterAsciiRenderer() {
	let buffers: RasterBuffers | null = null;
	let stateGrid: CellState[][] = [];
	let waterCoverageBuffer: Float32Array | null = null;
	let buildingCoverageBuffer: Float32Array | null = null;
	let greenCoverageBuffer: Float32Array | null = null;

	return {
		render(input: AsciiRenderInput): AsciiFrame {
			const gridConfig = getGridConfig(input.config);
			const palettes = mergeAsciiPalettes(input.config?.palettes);
			const priorities = resolvePriorities(input);
			const size = resolveGridSize(input.viewport, input.quality, gridConfig);
			const context = createGridContext(input.viewport, size);
			const supersample = input.quality === 'moving' ? 2 : 4;

			buffers = ensureBuffers(
				buffers,
				size.columns * supersample,
				size.rows * supersample,
				supersample
			);

			if (!buffers) {
				return renderAsciiFrameFallback(input);
			}

			const cellCount = size.rows * size.columns;
			stateGrid = ensureStateGrid(stateGrid, size.rows, size.columns);
			waterCoverageBuffer = ensureCoverageBuffer(waterCoverageBuffer, cellCount);
			buildingCoverageBuffer = ensureCoverageBuffer(buildingCoverageBuffer, cellCount);
			greenCoverageBuffer = ensureCoverageBuffer(greenCoverageBuffer, cellCount);

			const waterCoverage = rasterizeCoverage(
				buffers,
				input.layers.water ?? [],
				input,
				'water',
				waterCoverageBuffer
			);
			const buildingCoverage = rasterizeCoverage(
				buffers,
				input.layers.buildings ?? [],
				input,
				'buildings',
				buildingCoverageBuffer
			);
			const greenCoverage = rasterizeCoverage(
				buffers,
				input.layers.greens ?? [],
				input,
				'greens',
				greenCoverageBuffer
			);

			for (let row = 0; row < size.rows; row += 1) {
				for (let column = 0; column < size.columns; column += 1) {
					const cell = stateGrid[row]?.[column];
					if (!cell) {
						continue;
					}
					const index = row * size.columns + column;
					updateBestCell(cell, 'water', waterCoverage[index] ?? 0, priorities);
					updateBestCell(cell, 'greens', greenCoverage[index] ?? 0, priorities);
					updateBestCell(cell, 'buildings', buildingCoverage[index] ?? 0, priorities);
				}
			}

			for (const feature of input.layers.bridges ?? []) {
				sampleRoadLikeFeature(stateGrid, feature, 'bridges', context, priorities);
			}

			for (const feature of input.layers.roads ?? []) {
				sampleRoadLikeFeature(stateGrid, feature, 'roads', context, priorities);
			}

			for (const feature of input.layers.rails ?? []) {
				sampleRoadLikeFeature(stateGrid, feature, 'rails', context, priorities);
			}

			for (const feature of input.layers.tunnels ?? []) {
				sampleRoadLikeFeature(stateGrid, feature, 'tunnels', context, priorities);
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
				rails: 0,
				tunnels: 0,
				buildings: 0,
				water: 0,
				greens: 0,
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
	};
}
