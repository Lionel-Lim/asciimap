import type { Feature } from '$lib/ascii';
import { measureTextBlock } from './textMeasure';

const MAX_NAME_LENGTH = 22;
const landmarkFontFamily = 'Georgia, Palatino, "Times New Roman", serif';

interface LandmarkLabelSpec {
	fontSizeMultiplier: number;
	minZoom: number;
	opacity: number;
	priority: number;
	weight: number;
}

export interface LandmarkLabelCommand {
	font: string;
	height: number;
	key: string;
	name: string;
	opacity: number;
	priority: number;
	width: number;
	x: number;
	y: number;
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

function intersects(
	left: { left: number; right: number; top: number; bottom: number },
	right: { left: number; right: number; top: number; bottom: number }
): boolean {
	return !(
		left.right < right.left ||
		left.left > right.right ||
		left.bottom < right.top ||
		left.top > right.bottom
	);
}

export function buildLandmarkLabelCommands(
	features: readonly Feature[] | undefined,
	viewport: { width: number; height: number },
	zoom: number
): LandmarkLabelCommand[] {
	if (!features || features.length === 0) {
		return [];
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

		const [x, y] = point;
		if (x < -120 || x > viewport.width + 120 || y < -120 || y > viewport.height + 120) {
			continue;
		}

		const fontSize = Math.max(11, 14 * spec.fontSizeMultiplier);
		const font = `${spec.weight} ${fontSize}px ${landmarkFontFamily}`;
		const { height, width } = measureTextBlock(name, font, fontSize * 1.2);
		if (width < 18 || width > viewport.width * 0.4) {
			continue;
		}

		candidates.push({
			font,
			height,
			key: `${layerId}:${name}:${Math.round(x)}:${Math.round(y)}`,
			name,
			opacity: spec.opacity,
			priority: spec.priority,
			width,
			x,
			y: y - height * 0.56
		});
	}

	candidates.sort(
		(left, right) => right.priority - left.priority || left.name.length - right.name.length
	);

	const accepted: LandmarkLabelCommand[] = [];
	const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
	for (const candidate of candidates) {
		const bounds = {
			left: candidate.x - candidate.width / 2 - 6,
			right: candidate.x + candidate.width / 2 + 6,
			top: candidate.y - candidate.height / 2 - 3,
			bottom: candidate.y + candidate.height / 2 + 3
		};
		if (occupied.some((existing) => intersects(bounds, existing))) {
			continue;
		}

		accepted.push(candidate);
		occupied.push(bounds);
	}

	return accepted;
}
