export type LayerToggleKey = 'roads' | 'buildings' | 'water';
export type RenderPreference = 'auto' | 'performance' | 'quality';

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

export const LAYER_LABELS: Record<LayerToggleKey, string> = {
	roads: 'Roads',
	buildings: 'Buildings',
	water: 'Water'
};

export const QUERY_LAYER_PRESETS = {
	moving: {
		roads: ['road_secondary_tertiary', 'road_trunk_primary', 'road_motorway'],
		buildings: ['building'],
		water: ['water', 'waterway_river', 'waterway_other']
	},
	settled: {
		roads: [
			'road_minor',
			'road_secondary_tertiary',
			'road_trunk_primary',
			'road_motorway',
			'road_path_pedestrian'
		],
		buildings: ['building'],
		water: ['water', 'waterway_river', 'waterway_other']
	}
} as const satisfies Record<'moving' | 'settled', Record<LayerToggleKey, readonly string[]>>;

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
