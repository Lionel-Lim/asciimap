import type { AsciiFrame } from '$lib/ascii';
import { measureAircraftMarkerWidth } from './marker';

export interface ProjectedAircraftMarker {
	heading: number;
	onGround: boolean;
	x: number;
	y: number;
}

interface StampAircraftGlyphOptions {
	char?: string;
	fontFamily?: string;
	groundOpacity?: number;
	visibleOpacity?: number;
	zoom?: number;
}

export interface PresentedAircraftGlyph {
	clearHeight: number;
	clearWidth: number;
	rotation: number;
	segments: readonly {
		char: string;
		dx: number;
		dy: number;
		font: string;
		opacity: number;
	}[];
	opacity: number;
	x: number;
	y: number;
}

const defaultOptions = {
	char: 'A',
	flankChar: 'a',
	flankOpacity: 0.76,
	fontFamily: 'Georgia, Palatino, "Times New Roman", serif',
	groundOpacity: 0.72,
	visibleOpacity: 0.96,
	zoom: 13.4
} as const satisfies Required<StampAircraftGlyphOptions> & {
	flankChar: string;
	flankOpacity: number;
};

function resolveAircraftFont(
	frame: AsciiFrame,
	char: string,
	fontFamily: string,
	zoom: number,
	sizeScale: number,
	maxWidthScale: number,
	fontWeight: number
): { font: string; fontSize: number; width: number } {
	const zoomScale =
		zoom <= 9
			? 2.8
			: zoom <= 10.5
				? 2.35
				: zoom <= 12
					? 1.95
					: zoom <= 13.5
						? 1.55
						: zoom <= 15
							? 1.2
							: 1;
	const initialFontSize = Math.max(9, frame.cellHeight * 0.94 * zoomScale * sizeScale);
	const maxAllowedWidth = Math.max(1, frame.cellWidth * maxWidthScale * zoomScale);
	let fontSize = initialFontSize;
	let font = `${fontWeight} ${fontSize}px ${fontFamily}`;
	let measuredWidth = measureAircraftMarkerWidth(char, font);

	if (measuredWidth > maxAllowedWidth && measuredWidth > 0) {
		fontSize = Math.max(9, initialFontSize * (maxAllowedWidth / measuredWidth));
		font = `${fontWeight} ${fontSize}px ${fontFamily}`;
		measuredWidth = measureAircraftMarkerWidth(char, font);
	}

	return {
		font,
		fontSize,
		width: measuredWidth
	};
}

export function stampAircraftGlyphs(
	frame: AsciiFrame,
	markers: readonly ProjectedAircraftMarker[],
	options?: StampAircraftGlyphOptions
): { frame: AsciiFrame; glyphs: PresentedAircraftGlyph[]; visibleCount: number } {
	if (markers.length === 0) {
		return {
			frame,
			glyphs: [],
			visibleCount: 0
		};
	}

	const resolvedOptions = { ...defaultOptions, ...options };
	const coreFont = resolveAircraftFont(
		frame,
		resolvedOptions.char,
		resolvedOptions.fontFamily,
		resolvedOptions.zoom ?? 13.4,
		1,
		0.82,
		700
	);
	const flankFont = resolveAircraftFont(
		frame,
		resolvedOptions.flankChar,
		resolvedOptions.fontFamily,
		resolvedOptions.zoom ?? 13.4,
		0.58,
		0.42,
		600
	);
	const glyphs: PresentedAircraftGlyph[] = [];
	const occupied = new Set<number>();
	let visibleCount = 0;
	const flankGap = Math.max(1.5, coreFont.fontSize * 0.04, flankFont.width * 0.18);
	const totalWidth = flankFont.width * 2 + coreFont.width + flankGap * 2;
	const leftCenter = -totalWidth / 2 + flankFont.width / 2;
	const coreCenter = leftCenter + flankFont.width / 2 + flankGap + coreFont.width / 2;
	const rightCenter = totalWidth / 2 - flankFont.width / 2;

	for (const marker of markers) {
		const column = Math.round(marker.x / frame.cellWidth - 0.5);
		const row = Math.round(marker.y / frame.cellHeight - 0.5);
		if (column < 0 || column >= frame.cols || row < 0 || row >= frame.rowCount) {
			continue;
		}

		const cellIndex = row * frame.cols + column;
		if (occupied.has(cellIndex)) {
			continue;
		}

		glyphs.push({
			clearHeight: Math.max(frame.cellHeight * 1.24, coreFont.fontSize * 1.42),
			clearWidth: Math.max(frame.cellWidth * 1.5, totalWidth * 1.16),
			opacity: marker.onGround ? resolvedOptions.groundOpacity : resolvedOptions.visibleOpacity,
			rotation: marker.heading,
			segments: [
				{
					char: resolvedOptions.flankChar,
					dx: leftCenter,
					dy: 0,
					font: flankFont.font,
					opacity: resolvedOptions.flankOpacity
				},
				{
					char: resolvedOptions.char,
					dx: coreCenter,
					dy: 0,
					font: coreFont.font,
					opacity: 1
				},
				{
					char: resolvedOptions.flankChar,
					dx: rightCenter,
					dy: 0,
					font: flankFont.font,
					opacity: resolvedOptions.flankOpacity
				}
			],
			x: marker.x,
			y: marker.y
		});
		occupied.add(cellIndex);
		visibleCount += 1;
	}

	if (visibleCount === 0) {
		return {
			frame,
			glyphs: [],
			visibleCount: 0
		};
	}
	return {
		frame,
		glyphs,
		visibleCount
	};
}
