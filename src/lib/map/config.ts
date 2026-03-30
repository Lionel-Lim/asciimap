export type LayerToggleKey = 'roads' | 'bridges' | 'buildings' | 'water' | 'cities';
export type RenderPreference = 'auto' | 'performance' | 'quality';
export type RoadDetailLabel = 'Main roads' | 'Balanced' | 'Branches' | 'All branches';
export type WaterDetailLabel = 'Light' | 'Balanced' | 'Solid' | 'Dense';

export interface GridPresetConfig {
	moving: { columns: number };
	settled: { columns: number };
}

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const INITIAL_VIEW = {
	center: [-0.1276, 51.5072] as [number, number],
	zoom: 13.4,
	pitch: 0,
	bearing: 0
};

export const QUALITY_SETTLE_MS = 180;
export const CITY_LABEL_MAX_ZOOM = 12;

export const LAYER_LABELS: Record<LayerToggleKey, string> = {
	roads: 'Roads',
	bridges: 'Bridges',
	buildings: 'Buildings',
	water: 'Water',
	cities: 'Cities'
};

const ROAD_LAYER_PRESETS = {
	moving: {
		roads: [
			['road_motorway', 'road_trunk_primary'],
			['road_motorway', 'road_trunk_primary', 'road_secondary_tertiary'],
			['road_motorway', 'road_trunk_primary', 'road_secondary_tertiary'],
			[
				'road_motorway',
				'road_trunk_primary',
				'road_secondary_tertiary',
				'road_minor',
				'road_path_pedestrian'
			]
		]
	},
	settled: {
		roads: [
			['road_motorway', 'road_trunk_primary'],
			['road_motorway', 'road_trunk_primary', 'road_secondary_tertiary'],
			['road_motorway', 'road_trunk_primary', 'road_secondary_tertiary', 'road_minor'],
			[
				'road_motorway',
				'road_trunk_primary',
				'road_secondary_tertiary',
				'road_minor',
				'road_path_pedestrian'
			]
		]
	}
} as const satisfies Record<'moving' | 'settled', { roads: readonly (readonly string[])[] }>;

const BRIDGE_LAYER_PRESETS = {
	moving: {
		bridges: [
			['bridge_motorway', 'bridge_trunk_primary'],
			['bridge_motorway', 'bridge_trunk_primary', 'bridge_secondary_tertiary'],
			[
				'bridge_motorway',
				'bridge_trunk_primary',
				'bridge_secondary_tertiary',
				'bridge_street',
				'bridge_link',
				'bridge_motorway_link'
			],
			[
				'bridge_motorway',
				'bridge_trunk_primary',
				'bridge_secondary_tertiary',
				'bridge_street',
				'bridge_link',
				'bridge_motorway_link',
				'bridge_service_track',
				'bridge_path_pedestrian'
			]
		]
	},
	settled: {
		bridges: [
			['bridge_motorway', 'bridge_trunk_primary'],
			['bridge_motorway', 'bridge_trunk_primary', 'bridge_secondary_tertiary'],
			[
				'bridge_motorway',
				'bridge_trunk_primary',
				'bridge_secondary_tertiary',
				'bridge_street',
				'bridge_link',
				'bridge_motorway_link'
			],
			[
				'bridge_motorway',
				'bridge_trunk_primary',
				'bridge_secondary_tertiary',
				'bridge_street',
				'bridge_link',
				'bridge_motorway_link',
				'bridge_service_track',
				'bridge_path_pedestrian'
			]
		]
	}
} as const satisfies Record<'moving' | 'settled', { bridges: readonly (readonly string[])[] }>;

const STATIC_QUERY_LAYERS = {
	buildings: ['building'],
	water: ['water', 'waterway_river', 'waterway_other'],
	cities: ['label_city_capital', 'label_city', 'label_town', 'label_village']
} as const satisfies Record<'buildings' | 'water' | 'cities', readonly string[]>;

export const DEFAULT_ROAD_DETAIL = 40;
export const ROAD_DETAIL_RANGE = {
	min: 0,
	max: 100
} as const;

export const DEFAULT_WATER_DETAIL = 80;
export const WATER_DETAIL_RANGE = {
	min: 0,
	max: 100
} as const;

function resolveRoadDetailLevel(quality: 'moving' | 'settled', roadDetail: number): 0 | 1 | 2 | 3 {
	const clampedDetail = Math.max(
		ROAD_DETAIL_RANGE.min,
		Math.min(ROAD_DETAIL_RANGE.max, roadDetail)
	);

	if (quality === 'moving') {
		if (clampedDetail >= 85) {
			return 3;
		}
		if (clampedDetail >= 55) {
			return 2;
		}
		if (clampedDetail >= 25) {
			return 1;
		}
		return 0;
	}

	if (clampedDetail >= 70) {
		return 3;
	}
	if (clampedDetail >= 45) {
		return 2;
	}
	if (clampedDetail >= 20) {
		return 1;
	}
	return 0;
}

export function describeRoadDetail(roadDetail: number): RoadDetailLabel {
	const clampedDetail = Math.max(
		ROAD_DETAIL_RANGE.min,
		Math.min(ROAD_DETAIL_RANGE.max, roadDetail)
	);
	if (clampedDetail >= 85) {
		return 'All branches';
	}
	if (clampedDetail >= 55) {
		return 'Branches';
	}
	if (clampedDetail >= 25) {
		return 'Balanced';
	}
	return 'Main roads';
}

export function describeWaterDetail(waterDetail: number): WaterDetailLabel {
	const clampedDetail = Math.max(
		WATER_DETAIL_RANGE.min,
		Math.min(WATER_DETAIL_RANGE.max, waterDetail)
	);
	if (clampedDetail >= 85) {
		return 'Dense';
	}
	if (clampedDetail >= 60) {
		return 'Solid';
	}
	if (clampedDetail >= 30) {
		return 'Balanced';
	}
	return 'Light';
}

export function resolveQueryLayers(
	quality: 'moving' | 'settled',
	roadDetail: number
): Record<LayerToggleKey, readonly string[]> {
	const roadDetailLevel = resolveRoadDetailLevel(quality, roadDetail);

	return {
		roads: ROAD_LAYER_PRESETS[quality].roads[roadDetailLevel],
		bridges: BRIDGE_LAYER_PRESETS[quality].bridges[roadDetailLevel],
		buildings: STATIC_QUERY_LAYERS.buildings,
		water: STATIC_QUERY_LAYERS.water,
		cities: STATIC_QUERY_LAYERS.cities
	};
}

export const GRID_PRESETS: Record<RenderPreference, GridPresetConfig> = {
	auto: {
		moving: { columns: 64 },
		settled: { columns: 132 }
	},
	performance: {
		moving: { columns: 52 },
		settled: { columns: 52 }
	},
	quality: {
		moving: { columns: 72 },
		settled: { columns: 156 }
	}
};
