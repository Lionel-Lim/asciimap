import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext';

const MEASURE_WIDTH = 100_000;
const widthCache = new Map<string, number>();

function fallbackWidth(text: string, font: string): number {
	const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
	const fontSize = fontSizeMatch ? Number.parseFloat(fontSizeMatch[1] ?? '14') : 14;
	return Math.max(fontSize * 0.72, text.length * fontSize * 0.54);
}

export function measureAircraftMarkerWidth(text: string, font: string): number {
	const cacheKey = `${font}\u0000${text}`;
	const cached = widthCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	let width = 0;
	try {
		const prepared = prepareWithSegments(text, font);
		walkLineRanges(prepared, MEASURE_WIDTH, (line) => {
			width = Math.max(width, line.width);
		});
	} catch {
		width = fallbackWidth(text, font);
	}
	widthCache.set(cacheKey, width);
	return width;
}
