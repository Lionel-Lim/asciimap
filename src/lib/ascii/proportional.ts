import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext';
import type { AsciiFrame, AsciiFrameCell } from './types';

type ProportionalEntity = 'roads' | 'bridges' | 'buildings' | 'water' | 'cities';
type FontStyleVariant = 'normal' | 'italic';
type GlyphTier = 'edge' | 'core';

interface GlyphPaletteEntry {
	char: string;
	font: string;
	width: number;
	brightness: number;
}

interface EntityTypographySpec {
	family: string;
	glyphs: Record<GlyphTier, string>;
	weights: readonly number[];
	styles: readonly FontStyleVariant[];
	sizeMultiplier: number;
	alphaFloor: number;
	opacityExponent: number;
	brightnessBoost: number;
	bandDepth: number;
	coreThreshold: number;
}

export interface ProportionalTypographyOptions {
	waterDetail?: number;
}

const glyphWidthCache = new Map<string, number>();
const glyphBrightnessCache = new Map<string, number>();
const paletteLookupCache = new Map<string, readonly GlyphPaletteEntry[]>();
const BRIGHTNESS_BUCKETS = 256;
const LARGE_LINE_WIDTH = 100_000;
const brightnessCanvas =
	typeof document !== 'undefined' ? document.createElement('canvas') : undefined;

const typographySpecs: Record<ProportionalEntity, EntityTypographySpec> = {
	roads: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		glyphs: {
			edge: 'r',
			core: 'R'
		},
		weights: [500, 700],
		styles: ['normal'],
		sizeMultiplier: 0.92,
		alphaFloor: 0.24,
		opacityExponent: 1.4,
		brightnessBoost: 1,
		bandDepth: 0,
		coreThreshold: 0.92
	},
	bridges: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		glyphs: {
			edge: 'x',
			core: 'X'
		},
		weights: [600, 700],
		styles: ['normal'],
		sizeMultiplier: 0.96,
		alphaFloor: 0.38,
		opacityExponent: 1.15,
		brightnessBoost: 1.04,
		bandDepth: 0,
		coreThreshold: 0.82
	},
	buildings: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		glyphs: {
			edge: 'b',
			core: 'B'
		},
		weights: [500, 700, 800],
		styles: ['normal'],
		sizeMultiplier: 0.96,
		alphaFloor: 0.18,
		opacityExponent: 1.55,
		brightnessBoost: 1.08,
		bandDepth: 4.5,
		coreThreshold: 0.76
	},
	water: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		glyphs: {
			edge: 'w',
			core: 'W'
		},
		weights: [400, 500, 700],
		styles: ['normal', 'italic'],
		sizeMultiplier: 1,
		alphaFloor: 0.14,
		opacityExponent: 1.7,
		brightnessBoost: 0.94,
		bandDepth: 3.75,
		coreThreshold: 0.55
	},
	cities: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		glyphs: {
			edge: 'c',
			core: 'C'
		},
		weights: [500, 700],
		styles: ['normal'],
		sizeMultiplier: 0.9,
		alphaFloor: 0.44,
		opacityExponent: 1.05,
		brightnessBoost: 1,
		bandDepth: 0,
		coreThreshold: 0.74
	}
};

const neighborOffsets: readonly [number, number][] = [
	[-1, -1],
	[-1, 0],
	[-1, 1],
	[0, -1],
	[0, 1],
	[1, -1],
	[1, 0],
	[1, 1]
];

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function resolveWaterDetail(options?: ProportionalTypographyOptions): number {
	return Math.max(0, Math.min(100, options?.waterDetail ?? 50));
}

function isProportionalEntity(entity: AsciiFrameCell['entity']): entity is ProportionalEntity {
	return (
		entity === 'roads' ||
		entity === 'bridges' ||
		entity === 'buildings' ||
		entity === 'water' ||
		entity === 'cities'
	);
}

function buildRows(cells: readonly AsciiFrameCell[], cols: number, rowCount: number): string[] {
	const rows: string[] = [];
	for (let row = 0; row < rowCount; row += 1) {
		const start = row * cols;
		const chars = cells.slice(start, start + cols).map((cell) => cell.char);
		rows.push(chars.join(''));
	}
	return rows;
}

function measureGlyphWidth(char: string, font: string): number {
	const cacheKey = `${font}\u0000${char}`;
	const cached = glyphWidthCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const prepared = prepareWithSegments(char, font);
	let width = 0;
	walkLineRanges(prepared, LARGE_LINE_WIDTH, (line) => {
		width = line.width;
	});

	glyphWidthCache.set(cacheKey, width);
	return width;
}

function estimateGlyphBrightness(char: string, font: string): number {
	if (!brightnessCanvas) {
		return 0;
	}

	const cacheKey = `${font}\u0000${char}`;
	const cached = glyphBrightnessCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const context = brightnessCanvas.getContext('2d', { willReadFrequently: true });
	if (!context) {
		return 0;
	}

	const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
	const fontSize = fontSizeMatch ? Number.parseFloat(fontSizeMatch[1] ?? '16') : 16;
	const size = Math.max(40, Math.ceil(fontSize * 3));

	brightnessCanvas.width = size;
	brightnessCanvas.height = size;
	context.clearRect(0, 0, size, size);
	context.font = font;
	context.fillStyle = '#ffffff';
	context.textAlign = 'left';
	context.textBaseline = 'middle';
	context.fillText(char, 2, size / 2);

	const data = context.getImageData(0, 0, size, size).data;
	let alphaTotal = 0;
	for (let index = 3; index < data.length; index += 4) {
		alphaTotal += data[index] ?? 0;
	}

	const brightness = alphaTotal / (255 * size * size);
	glyphBrightnessCache.set(cacheKey, brightness);
	return brightness;
}

function findBestGlyph(
	entries: readonly GlyphPaletteEntry[],
	targetBrightness: number,
	targetWidth: number
): GlyphPaletteEntry {
	let low = 0;
	let high = entries.length - 1;

	while (low < high) {
		const middle = (low + high) >> 1;
		if ((entries[middle]?.brightness ?? 0) < targetBrightness) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	let best = entries[Math.max(0, Math.min(entries.length - 1, low))] ?? entries[0]!;
	let bestScore = Number.POSITIVE_INFINITY;
	const start = Math.max(0, low - 18);
	const end = Math.min(entries.length, low + 18);

	for (let index = start; index < end; index += 1) {
		const entry = entries[index];
		if (!entry) {
			continue;
		}

		const brightnessError = Math.abs(entry.brightness - targetBrightness) * 2.6;
		const widthError = Math.abs(entry.width - targetWidth) / Math.max(1, targetWidth);
		const overshootPenalty = entry.width > targetWidth * 1.05 ? 0.18 : 0;
		const score = brightnessError + widthError + overshootPenalty;
		if (score < bestScore) {
			bestScore = score;
			best = entry;
		}
	}

	return best;
}

function buildPaletteLookup(
	entity: ProportionalEntity,
	tier: GlyphTier,
	cellWidth: number,
	cellHeight: number
): readonly GlyphPaletteEntry[] {
	const roundedWidth = Math.max(1, Math.round(cellWidth * 10) / 10);
	const roundedHeight = Math.max(1, Math.round(cellHeight * 10) / 10);
	const cacheKey = `${entity}:${tier}:${roundedWidth}:${roundedHeight}`;
	const cached = paletteLookupCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const spec = typographySpecs[entity];
	const targetWidth = roundedWidth * 0.92;
	const fontSize = Math.max(6, roundedHeight * spec.sizeMultiplier);
	const entries: GlyphPaletteEntry[] = [];
	const glyph = spec.glyphs[tier];

	for (const style of spec.styles) {
		for (const weight of spec.weights) {
			const font = `${style === 'italic' ? 'italic ' : ''}${weight} ${fontSize}px ${spec.family}`;
			const width = measureGlyphWidth(glyph, font);
			if (width <= 0) {
				continue;
			}

			const brightness = estimateGlyphBrightness(glyph, font);
			entries.push({
				char: glyph,
				font,
				width,
				brightness
			});
		}
	}

	if (entries.length === 0) {
		paletteLookupCache.set(cacheKey, []);
		return [];
	}

	const maxBrightness = Math.max(...entries.map((entry) => entry.brightness), 0);
	if (maxBrightness > 0) {
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry) {
				entry.brightness /= maxBrightness;
			}
		}
	}

	entries.sort((left, right) => left.brightness - right.brightness);

	const lookup = Array.from({ length: BRIGHTNESS_BUCKETS }, (_, brightnessByte) => {
		const targetBrightness = brightnessByte / (BRIGHTNESS_BUCKETS - 1);
		return findBestGlyph(entries, targetBrightness, targetWidth);
	});

	paletteLookupCache.set(cacheKey, lookup);
	return lookup;
}

function resolvePaletteEntry(
	entity: ProportionalEntity,
	tier: GlyphTier,
	targetBrightness: number,
	cellWidth: number,
	cellHeight: number
): GlyphPaletteEntry | null {
	const lookup = buildPaletteLookup(entity, tier, cellWidth, cellHeight);
	if (lookup.length === 0) {
		return null;
	}

	const brightnessByte = Math.max(
		0,
		Math.min(BRIGHTNESS_BUCKETS - 1, Math.round(targetBrightness * (BRIGHTNESS_BUCKETS - 1)))
	);
	return lookup[brightnessByte] ?? null;
}

function resolveCellTypography(
	cell: AsciiFrameCell,
	cellWidth: number,
	cellHeight: number,
	distanceFromEdge: number,
	options?: ProportionalTypographyOptions
): AsciiFrameCell {
	if (!isProportionalEntity(cell.entity)) {
		return cell;
	}

	const entity = cell.entity;
	const spec = typographySpecs[entity];
	const waterDetail = entity === 'water' ? resolveWaterDetail(options) : 50;
	const dynamicSpec =
		entity === 'water'
			? {
					...spec,
					alphaFloor: 0.14 + (waterDetail / 100) * 0.24,
					brightnessBoost: 0.9 + (waterDetail / 100) * 0.22,
					bandDepth: Math.max(1.6, 6.5 - (waterDetail / 100) * 4.8),
					coreThreshold: Math.max(0.42, 0.78 - (waterDetail / 100) * 0.28)
				}
			: spec;
	const signal =
		dynamicSpec.bandDepth > 0 && distanceFromEdge > 0
			? clamp01((distanceFromEdge - 1) / dynamicSpec.bandDepth)
			: clamp01(cell.coverage);
	const tier: GlyphTier = signal >= dynamicSpec.coreThreshold ? 'core' : 'edge';
	const targetBrightness = clamp01((0.2 + signal * 0.8) * dynamicSpec.brightnessBoost);
	const match = resolvePaletteEntry(entity, tier, targetBrightness, cellWidth, cellHeight);
	if (!match) {
		return cell;
	}

	const opacity =
		dynamicSpec.alphaFloor +
		(1 - dynamicSpec.alphaFloor) * Math.pow(signal, dynamicSpec.opacityExponent);

	return {
		...cell,
		char: match.char,
		font: match.font,
		opacity: clamp01(opacity)
	};
}

function buildInteriorDistanceMap(
	frame: AsciiFrame,
	cells: readonly AsciiFrameCell[],
	entity: ProportionalEntity
): Int16Array {
	const distances = new Int16Array(cells.length);
	distances.fill(-1);
	const queue: number[] = [];

	for (let index = 0; index < cells.length; index += 1) {
		const cell = cells[index];
		if (!cell || cell.entity !== entity) {
			continue;
		}

		const row = Math.floor(index / frame.cols);
		const column = index % frame.cols;
		let isBoundary = false;

		for (const [rowOffset, columnOffset] of neighborOffsets) {
			const neighborRow = row + rowOffset;
			const neighborColumn = column + columnOffset;
			if (
				neighborRow < 0 ||
				neighborRow >= frame.rowCount ||
				neighborColumn < 0 ||
				neighborColumn >= frame.cols
			) {
				isBoundary = true;
				break;
			}

			const neighborIndex = neighborRow * frame.cols + neighborColumn;
			if (cells[neighborIndex]?.entity !== entity) {
				isBoundary = true;
				break;
			}
		}

		if (isBoundary) {
			distances[index] = 1;
			queue.push(index);
		}
	}

	for (let head = 0; head < queue.length; head += 1) {
		const index = queue[head]!;
		const row = Math.floor(index / frame.cols);
		const column = index % frame.cols;
		const nextDistance = distances[index] + 1;

		for (const [rowOffset, columnOffset] of neighborOffsets) {
			const neighborRow = row + rowOffset;
			const neighborColumn = column + columnOffset;
			if (
				neighborRow < 0 ||
				neighborRow >= frame.rowCount ||
				neighborColumn < 0 ||
				neighborColumn >= frame.cols
			) {
				continue;
			}

			const neighborIndex = neighborRow * frame.cols + neighborColumn;
			if (cells[neighborIndex]?.entity !== entity || distances[neighborIndex] !== -1) {
				continue;
			}

			distances[neighborIndex] = nextDistance;
			queue.push(neighborIndex);
		}
	}

	return distances;
}

function buildInteriorDistanceMaps(
	frame: AsciiFrame,
	cells: readonly AsciiFrameCell[]
): Record<ProportionalEntity, Int16Array> {
	return {
		roads: buildInteriorDistanceMap(frame, cells, 'roads'),
		bridges: buildInteriorDistanceMap(frame, cells, 'bridges'),
		buildings: buildInteriorDistanceMap(frame, cells, 'buildings'),
		water: buildInteriorDistanceMap(frame, cells, 'water'),
		cities: buildInteriorDistanceMap(frame, cells, 'cities')
	};
}

export function applyProportionalTypography(
	frame: AsciiFrame,
	options?: ProportionalTypographyOptions
): AsciiFrame {
	if (!frame.cells || frame.cells.length === 0) {
		return frame;
	}

	if (
		typeof Intl === 'undefined' ||
		typeof Intl.Segmenter === 'undefined' ||
		(typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined')
	) {
		return frame;
	}

	try {
		let changed = false;
		const distanceMaps = buildInteriorDistanceMaps(frame, frame.cells);
		const resolvedCells = frame.cells.map((cell, index) => {
			const distanceFromEdge = isProportionalEntity(cell.entity)
				? Math.max(0, distanceMaps[cell.entity][index] ?? 0)
				: 0;
			const resolved = resolveCellTypography(
				cell,
				frame.cellWidth,
				frame.cellHeight,
				distanceFromEdge,
				options
			);
			if (
				resolved.char !== cell.char ||
				resolved.font !== cell.font ||
				resolved.opacity !== cell.opacity
			) {
				changed = true;
			}
			return resolved;
		});
		if (!changed) {
			return frame;
		}

		const rows = buildRows(resolvedCells, frame.cols, frame.rowCount);
		return {
			...frame,
			cells: resolvedCells,
			rows,
			text: rows.join('\n')
		};
	} catch {
		return frame;
	}
}
