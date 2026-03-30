import { prepareWithSegments, walkLineRanges } from '@chenglou/pretext';
import type { AsciiFrame, AsciiFrameCell, Feature } from '$lib/ascii';

const LABEL_MEASURE_WIDTH = 100_000;
const MAX_NAME_LENGTH = 22;
const landmarkFontFamily = 'Georgia, Palatino, "Times New Roman", serif';
const landmarkWidthCache = new Map<string, number>();

interface LandmarkLabelSpec {
	fontSizeMultiplier: number;
	minZoom: number;
	opacity: number;
	priority: number;
	weight: number;
}

interface LandmarkLabelCommand {
	font: string;
	name: string;
	opacity: number;
	priority: number;
	row: number;
	startColumn: number;
	widthInCells: number;
}

const landmarkLabelSpecs: Record<string, LandmarkLabelSpec> = {
	label_other: {
		fontSizeMultiplier: 0.98,
		minZoom: 14.2,
		opacity: 0.94,
		priority: 4,
		weight: 700
	},
	poi_r1: {
		fontSizeMultiplier: 0.96,
		minZoom: 14.2,
		opacity: 0.92,
		priority: 4,
		weight: 700
	},
	poi_r7: {
		fontSizeMultiplier: 0.92,
		minZoom: 14.8,
		opacity: 0.88,
		priority: 3,
		weight: 600
	},
	poi_r20: {
		fontSizeMultiplier: 0.88,
		minZoom: 15.2,
		opacity: 0.82,
		priority: 2,
		weight: 600
	}
};

function measureLabelWidth(text: string, font: string): number {
	const cacheKey = `${font}\u0000${text}`;
	const cached = landmarkWidthCache.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const prepared = prepareWithSegments(text, font);
	let width = 0;
	walkLineRanges(prepared, LABEL_MEASURE_WIDTH, (line) => {
		width = Math.max(width, line.width);
	});
	landmarkWidthCache.set(cacheKey, width);
	return width;
}

function readLabelName(feature: Feature): string | null {
	const properties = feature.properties;
	const candidates = [
		properties?.['name_en'],
		properties?.['name:en'],
		properties?.['name_latin'],
		properties?.['name:latin'],
		properties?.['name_int'],
		properties?.name
	];

	for (const candidate of candidates) {
		if (typeof candidate === 'string') {
			const trimmed = candidate.trim();
			if (trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH) {
				return trimmed;
			}
		}
	}

	return null;
}

function readLayerId(feature: Feature): string {
	return typeof feature.properties?.__layerId === 'string' ? feature.properties.__layerId : '';
}

function readPoint(feature: Feature): readonly [number, number] | null {
	if (feature.geometry.type === 'Point') {
		return feature.geometry.coordinates;
	}
	if (feature.geometry.type === 'MultiPoint' && feature.geometry.coordinates.length > 0) {
		return feature.geometry.coordinates[0] ?? null;
	}
	return null;
}

function buildRows(cells: readonly AsciiFrameCell[], cols: number, rowCount: number): string[] {
	const rows: string[] = [];
	for (let row = 0; row < rowCount; row += 1) {
		const start = row * cols;
		rows.push(
			cells
				.slice(start, start + cols)
				.map((cell) => cell.char)
				.join('')
		);
	}
	return rows;
}

export function stampLandmarkLabels(
	frame: AsciiFrame,
	features: readonly Feature[] | undefined,
	zoom: number
): AsciiFrame {
	if (!frame.cells || !features || features.length === 0) {
		return frame;
	}

	const candidates: LandmarkLabelCommand[] = [];
	for (const feature of features) {
		const layerId = readLayerId(feature);
		const spec = landmarkLabelSpecs[layerId];
		if (!spec || zoom < spec.minZoom) {
			continue;
		}

		const name = readLabelName(feature);
		const point = readPoint(feature);
		if (!name || !point) {
			continue;
		}

		const fontSize = Math.max(11, frame.cellHeight * spec.fontSizeMultiplier);
		const font = `${spec.weight} ${fontSize}px ${landmarkFontFamily}`;
		const measuredWidth = measureLabelWidth(name, font);
		const widthInCells = Math.max(name.length, Math.ceil(measuredWidth / frame.cellWidth));
		if (widthInCells < 2 || widthInCells > Math.floor(frame.cols * 0.4)) {
			continue;
		}

		const row = Math.round(point[1] / frame.cellHeight - 0.5);
		const startColumn = Math.round(point[0] / frame.cellWidth - widthInCells / 2);
		if (
			row < 0 ||
			row >= frame.rowCount ||
			startColumn < 0 ||
			startColumn + name.length > frame.cols
		) {
			continue;
		}

		candidates.push({
			font,
			name,
			opacity: spec.opacity,
			priority: spec.priority,
			row,
			startColumn,
			widthInCells
		});
	}

	candidates.sort(
		(left, right) => right.priority - left.priority || left.name.length - right.name.length
	);

	const accepted: LandmarkLabelCommand[] = [];
	const occupied: Array<{ row: number; left: number; right: number }> = [];
	for (const candidate of candidates) {
		const left = candidate.startColumn - 1;
		const right = candidate.startColumn + candidate.widthInCells;
		if (
			occupied.some(
				(existing) =>
					existing.row === candidate.row && !(right < existing.left || left > existing.right)
			)
		) {
			continue;
		}

		accepted.push(candidate);
		occupied.push({ row: candidate.row, left, right });
	}

	if (accepted.length === 0) {
		return frame;
	}

	const cells = [...frame.cells];
	for (const label of accepted) {
		for (let index = 0; index < label.name.length; index += 1) {
			const column = label.startColumn + index;
			const cellIndex = label.row * frame.cols + column;
			const existing = cells[cellIndex];
			if (!existing) {
				continue;
			}

			cells[cellIndex] = {
				...existing,
				char: label.name[index] ?? existing.char,
				entity: 'points',
				font: label.font,
				opacity: label.opacity,
				coverage: 1
			};
		}
	}

	const rows = buildRows(cells, frame.cols, frame.rowCount);
	return {
		...frame,
		rows,
		text: rows.join('\n'),
		cells
	};
}
