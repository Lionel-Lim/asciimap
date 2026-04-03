import type { Feature } from '$lib/ascii';
import { acceptNonOverlapping } from './labelCollision';
import { measureTextBlock } from './textMeasure';
const cityLabelFontFamily = 'Georgia, Palatino, "Times New Roman", serif';

interface CityLabelSpec {
	fontSize: number;
	opacity: number;
	priority: number;
	weight: number;
}

interface CityLabelOptions {
	fontFamily?: string;
}

export interface CityLabelCommand {
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

const cityLabelSpecs: Record<string, CityLabelSpec> = {
	label_city_capital: {
		fontSize: 20,
		opacity: 0.98,
		priority: 4,
		weight: 700
	},
	label_city: {
		fontSize: 18,
		opacity: 0.94,
		priority: 3,
		weight: 700
	},
	label_town: {
		fontSize: 16,
		opacity: 0.88,
		priority: 2,
		weight: 600
	},
	label_village: {
		fontSize: 14,
		opacity: 0.78,
		priority: 1,
		weight: 500
	}
};

function readCityName(feature: Feature): string | null {
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
		if (typeof candidate === 'string' && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}

	return null;
}

function readLayerId(feature: Feature): string {
	return typeof feature.layerId === 'string'
		? feature.layerId
		: typeof feature.properties?.__layerId === 'string'
			? feature.properties.__layerId
			: 'label_town';
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

export function buildCityLabelCommands(
	features: readonly Feature[],
	viewport: { width: number; height: number },
	options?: CityLabelOptions
): CityLabelCommand[] {
	const candidates: CityLabelCommand[] = [];
	const fontFamily = options?.fontFamily ?? cityLabelFontFamily;

	for (const feature of features) {
		const name = readCityName(feature);
		const point = readPoint(feature);
		if (!name || !point) {
			continue;
		}

		const [x, y] = point;
		if (x < -120 || x > viewport.width + 120 || y < -120 || y > viewport.height + 120) {
			continue;
		}

		const layerId = readLayerId(feature);
		const spec = cityLabelSpecs[layerId] ?? cityLabelSpecs.label_town;
		const font = `${spec.weight} ${spec.fontSize}px ${fontFamily}`;
		const { height, width } = measureTextBlock(name, font, spec.fontSize * 1.25);
		candidates.push({
			font,
			height,
			key: `${layerId}:${name}:${Math.round(x)}:${Math.round(y)}`,
			name,
			opacity: spec.opacity,
			priority: spec.priority,
			width,
			x,
			y: y - height * 0.36
		});
	}

	candidates.sort(
		(left, right) => right.priority - left.priority || left.name.length - right.name.length
	);

	return acceptNonOverlapping(candidates, (candidate) => ({
		left: candidate.x - candidate.width / 2 - 6,
		right: candidate.x + candidate.width / 2 + 6,
		top: candidate.y - candidate.height / 2 - 3,
		bottom: candidate.y + candidate.height / 2 + 3
	}));
}
