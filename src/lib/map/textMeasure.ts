import {
	layout,
	prepare,
	prepareWithSegments,
	walkLineRanges,
	type PreparedText,
	type PreparedTextWithSegments
} from '@chenglou/pretext';

const MEASURE_WIDTH = 100_000;

const preparedCache = new Map<string, PreparedText>();
const preparedSegmentsCache = new Map<string, PreparedTextWithSegments>();

function fallbackWidth(text: string, font: string): number {
	const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
	const fontSize = fontSizeMatch ? Number.parseFloat(fontSizeMatch[1] ?? '14') : 14;
	return Math.max(fontSize * 0.72, text.length * fontSize * 0.54);
}

function readPrepared(text: string, font: string): PreparedText {
	const cacheKey = `${font}\u0000${text}`;
	const cached = preparedCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const prepared = prepare(text, font);
	preparedCache.set(cacheKey, prepared);
	return prepared;
}

function readPreparedSegments(text: string, font: string): PreparedTextWithSegments {
	const cacheKey = `${font}\u0000${text}`;
	const cached = preparedSegmentsCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const prepared = prepareWithSegments(text, font);
	preparedSegmentsCache.set(cacheKey, prepared);
	return prepared;
}

export function measureTextBlock(
	text: string,
	font: string,
	lineHeight: number
): { height: number; width: number } {
	try {
		const prepared = readPrepared(text, font);
		const preparedSegments = readPreparedSegments(text, font);
		const { height } = layout(prepared, MEASURE_WIDTH, lineHeight);
		let width = 0;
		walkLineRanges(preparedSegments, MEASURE_WIDTH, (line) => {
			width = Math.max(width, line.width);
		});

		return {
			height,
			width
		};
	} catch {
		return {
			height: lineHeight,
			width: fallbackWidth(text, font)
		};
	}
}
