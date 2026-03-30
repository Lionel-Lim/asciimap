import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext';
import type { AsciiFrame, AsciiFrameCell } from './types';

type ProportionalEntity = 'buildings' | 'water';
type FontStyleVariant = 'normal' | 'italic';

interface GlyphPaletteEntry {
	char: string;
	font: string;
	width: number;
	brightness: number;
}

interface EntityTypographySpec {
	family: string;
	charset: string;
	weights: readonly number[];
	styles: readonly FontStyleVariant[];
	sizeMultiplier: number;
	alphaFloor: number;
	brightnessBoost: number;
	maxWidthRatio: number;
}

const glyphWidthCache = new Map<string, number>();
const glyphBrightnessCache = new Map<string, number>();
const paletteLookupCache = new Map<string, readonly GlyphPaletteEntry[]>();
const BRIGHTNESS_BUCKETS = 256;
const LARGE_LINE_WIDTH = 100_000;
const brightnessCanvas =
	typeof document !== 'undefined' ? document.createElement('canvas') : undefined;

const typographySpecs: Record<ProportionalEntity, EntityTypographySpec> = {
	buildings: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		charset: '.,:;!+=*#%&AMW8',
		weights: [400, 600, 700],
		styles: ['normal'],
		sizeMultiplier: 0.84,
		alphaFloor: 0.34,
		brightnessBoost: 1.08,
		maxWidthRatio: 1.28
	},
	water: {
		family: 'Georgia, Palatino, "Times New Roman", serif',
		charset: ".,'`-_:;~=+/|)(oOQ",
		weights: [400, 500, 600],
		styles: ['normal', 'italic'],
		sizeMultiplier: 0.88,
		alphaFloor: 0.26,
		brightnessBoost: 0.94,
		maxWidthRatio: 1.36
	}
};

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
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
	cellWidth: number,
	cellHeight: number
): readonly GlyphPaletteEntry[] {
	const roundedWidth = Math.max(1, Math.round(cellWidth * 10) / 10);
	const roundedHeight = Math.max(1, Math.round(cellHeight * 10) / 10);
	const cacheKey = `${entity}:${roundedWidth}:${roundedHeight}`;
	const cached = paletteLookupCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const spec = typographySpecs[entity];
	const targetWidth = roundedWidth * 0.92;
	const fontSize = Math.max(8, roundedHeight * spec.sizeMultiplier);
	const entries: GlyphPaletteEntry[] = [];

	for (const style of spec.styles) {
		for (const weight of spec.weights) {
			const font = `${style === 'italic' ? 'italic ' : ''}${weight} ${fontSize}px ${spec.family}`;
			for (const char of spec.charset) {
				if (char === ' ') {
					continue;
				}

				const width = measureGlyphWidth(char, font);
				if (width <= 0 || width > targetWidth * spec.maxWidthRatio) {
					continue;
				}

				const brightness = estimateGlyphBrightness(char, font);
				entries.push({
					char,
					font,
					width,
					brightness
				});
			}
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

function resolveCellTypography(
	cell: AsciiFrameCell,
	cellWidth: number,
	cellHeight: number
): AsciiFrameCell {
	if (cell.entity !== 'buildings' && cell.entity !== 'water') {
		return cell;
	}

	const entity = cell.entity;
	const spec = typographySpecs[entity];
	const lookup = buildPaletteLookup(entity, cellWidth, cellHeight);
	if (lookup.length === 0) {
		return cell;
	}

	const targetBrightness = clamp01(cell.coverage * spec.brightnessBoost);
	const brightnessByte = Math.max(
		0,
		Math.min(BRIGHTNESS_BUCKETS - 1, Math.round(targetBrightness * (BRIGHTNESS_BUCKETS - 1)))
	);
	const match = lookup[brightnessByte];
	if (!match) {
		return cell;
	}

	return {
		...cell,
		char: match.char,
		font: match.font,
		opacity: Math.max(spec.alphaFloor, targetBrightness)
	};
}

export function applyProportionalTypography(frame: AsciiFrame): AsciiFrame {
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
		const nextCells = frame.cells.map((cell) => {
			const resolved = resolveCellTypography(cell, frame.cellWidth, frame.cellHeight);
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

		const rows = buildRows(nextCells, frame.cols, frame.rowCount);
		return {
			...frame,
			cells: nextCells,
			rows,
			text: rows.join('\n')
		};
	} catch {
		return frame;
	}
}
