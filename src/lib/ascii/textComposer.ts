import type { ProjectedAircraftMarker } from '$lib/aircraft/stamp';
import type { CityLabelCommand } from '$lib/map/cityLabels';
import type { LandmarkLabelCommand } from '$lib/map/landmarkLabels';
import type { AsciiFrame, AsciiFrameCell, EntityKind } from './types';

type TextLabelCommand = CityLabelCommand | LandmarkLabelCommand;

interface TextComposerOptions {
	cityLabels?: readonly CityLabelCommand[];
	landmarkLabels?: readonly LandmarkLabelCommand[];
	aircraft?: readonly ProjectedAircraftMarker[];
}

interface MutableStampCell {
	char: string;
	entity: EntityKind | 'background';
	opacity: number;
}

export const TEXT_AIRCRAFT_GLYPHS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const;

function createMutableCells(frame: AsciiFrame): MutableStampCell[] {
	if (frame.cells && frame.cells.length >= frame.cols * frame.rowCount) {
		return frame.cells.map((cell) => ({
			char: cell.char,
			entity: cell.entity,
			opacity: cell.opacity ?? 1
		}));
	}

	const cells: MutableStampCell[] = [];
	for (let row = 0; row < frame.rowCount; row += 1) {
		const text = frame.rows[row] ?? '';
		for (let column = 0; column < frame.cols; column += 1) {
			const char = text[column] ?? ' ';
			cells.push({
				char,
				entity: 'background',
				opacity: 1
			});
		}
	}
	return cells;
}

function buildFrameRows(
	cells: readonly MutableStampCell[],
	cols: number,
	rowCount: number
): { rows: string[]; text: string } {
	const rows: string[] = [];

	for (let row = 0; row < rowCount; row += 1) {
		let text = '';
		for (let column = 0; column < cols; column += 1) {
			text += cells[row * cols + column]?.char ?? ' ';
		}
		rows.push(text);
	}

	return {
		rows,
		text: rows.join('\n')
	};
}

function quantizeAircraftHeading(heading: number): (typeof TEXT_AIRCRAFT_GLYPHS)[number] {
	const normalized = ((heading % 360) + 360) % 360;
	const index = Math.round(normalized / 45) % TEXT_AIRCRAFT_GLYPHS.length;
	return TEXT_AIRCRAFT_GLYPHS[index] ?? TEXT_AIRCRAFT_GLYPHS[0];
}

function writeCell(
	cells: MutableStampCell[],
	frame: AsciiFrame,
	row: number,
	column: number,
	char: string,
	entity: EntityKind | 'background',
	opacity: number
): void {
	if (row < 0 || row >= frame.rowCount || column < 0 || column >= frame.cols) {
		return;
	}

	cells[row * frame.cols + column] = {
		char,
		entity,
		opacity
	};
}

function placeLabels(
	cells: MutableStampCell[],
	frame: AsciiFrame,
	cityLabels: readonly CityLabelCommand[],
	landmarkLabels: readonly LandmarkLabelCommand[]
): void {
	const occupied = new Set<number>();
	const labels: Array<TextLabelCommand & { entity: EntityKind }> = [
		...cityLabels.map((command) => ({ ...command, entity: 'cities' as const })),
		...landmarkLabels.map((command) => ({ ...command, entity: 'points' as const }))
	].sort(
		(left, right) =>
			right.priority - left.priority ||
			left.name.length - right.name.length ||
			left.y - right.y ||
			left.x - right.x
	);

	for (const label of labels) {
		const row = Math.round(label.y / frame.cellHeight - 0.5);
		if (row < 0 || row >= frame.rowCount) {
			continue;
		}

		const glyphs = Array.from(label.name);
		const anchorColumn = Math.round(label.x / frame.cellWidth - 0.5);
		const startColumn = Math.round(anchorColumn - glyphs.length / 2);
		const endColumn = startColumn + glyphs.length - 1;
		if (endColumn < 0 || startColumn >= frame.cols) {
			continue;
		}

		let intersects = false;
		for (let index = 0; index < glyphs.length; index += 1) {
			const column = startColumn + index;
			if (column < 0 || column >= frame.cols) {
				continue;
			}

			if (occupied.has(row * frame.cols + column)) {
				intersects = true;
				break;
			}
		}
		if (intersects) {
			continue;
		}

		for (let index = 0; index < glyphs.length; index += 1) {
			const column = startColumn + index;
			if (column < 0 || column >= frame.cols) {
				continue;
			}

			const char = glyphs[index] ?? ' ';
			writeCell(
				cells,
				frame,
				row,
				column,
				char,
				char === ' ' ? 'background' : label.entity,
				label.opacity
			);
			occupied.add(row * frame.cols + column);
		}
	}
}

function placeAircraft(
	cells: MutableStampCell[],
	frame: AsciiFrame,
	markers: readonly ProjectedAircraftMarker[]
): number {
	if (markers.length === 0) {
		return 0;
	}

	const occupied = new Set<number>();
	let visibleCount = 0;

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

		writeCell(
			cells,
			frame,
			row,
			column,
			quantizeAircraftHeading(marker.heading),
			'points',
			marker.onGround ? 0.72 : 0.96
		);
		occupied.add(cellIndex);
		visibleCount += 1;
	}

	return visibleCount;
}

function rebuildFrameCells(
	frame: AsciiFrame,
	mutableCells: readonly MutableStampCell[]
): readonly AsciiFrameCell[] {
	return mutableCells.map((cell) => ({
		char: cell.char,
		entity: cell.entity,
		coverage: cell.char === ' ' ? 0 : 1,
		opacity: cell.opacity
	}));
}

export function composeTextModeFrame(
	frame: AsciiFrame,
	options?: TextComposerOptions
): { frame: AsciiFrame; visibleAircraftCount: number } {
	const cells = createMutableCells(frame);
	placeLabels(cells, frame, options?.cityLabels ?? [], options?.landmarkLabels ?? []);
	const visibleAircraftCount = placeAircraft(cells, frame, options?.aircraft ?? []);
	const rebuiltCells = rebuildFrameCells(frame, cells);
	const rebuilt = buildFrameRows(cells, frame.cols, frame.rowCount);

	return {
		frame: {
			...frame,
			rows: rebuilt.rows,
			text: rebuilt.text,
			cells: rebuiltCells
		},
		visibleAircraftCount
	};
}
