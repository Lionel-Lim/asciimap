import type { AsciiFrame, AsciiFrameCell, EntityKind } from './types';

export interface TextFrameSegment {
	entity: EntityKind | 'background';
	opacity: number;
	text: string;
}

export interface TextFrameRow {
	index: number;
	segments: TextFrameSegment[];
}

function normalizedOpacity(cell: AsciiFrameCell): number {
	return Math.max(0, Math.min(1, cell.opacity ?? 1));
}

function buildFallbackRows(frame: AsciiFrame): TextFrameRow[] {
	return frame.rows.map((text, index) => ({
		index,
		segments: [
			{
				entity: 'background',
				opacity: 1,
				text
			}
		]
	}));
}

export function buildTextFrameRows(frame: AsciiFrame): TextFrameRow[] {
	const expectedCells = frame.cols * frame.rowCount;
	if (!frame.cells || frame.cells.length < expectedCells) {
		return buildFallbackRows(frame);
	}

	const rows: TextFrameRow[] = [];

	for (let row = 0; row < frame.rowCount; row += 1) {
		const startIndex = row * frame.cols;
		const endIndex = startIndex + frame.cols;
		const segments: TextFrameSegment[] = [];

		for (let index = startIndex; index < endIndex; index += 1) {
			const cell = frame.cells[index];
			if (!cell) {
				continue;
			}

			const opacity = normalizedOpacity(cell);
			const previous = segments[segments.length - 1];
			if (previous && previous.entity === cell.entity && previous.opacity === opacity) {
				previous.text += cell.char;
				continue;
			}

			segments.push({
				entity: cell.entity,
				opacity,
				text: cell.char
			});
		}

		rows.push({
			index: row,
			segments
		});
	}

	return rows;
}
