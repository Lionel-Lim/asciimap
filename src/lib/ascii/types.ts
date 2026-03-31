export type QualityMode = 'moving' | 'settled';

export type EntityKind =
	| 'roads'
	| 'bridges'
	| 'buildings'
	| 'water'
	| 'greens'
	| 'rails'
	| 'tunnels'
	| 'cities'
	| 'points';

export type Point2D = readonly [number, number];

export type LineString = readonly Point2D[];

export type LinearRing = readonly Point2D[];

export type Polygon = readonly LinearRing[];

export type MultiPoint = readonly Point2D[];

export type MultiLineString = readonly LineString[];

export type MultiPolygon = readonly Polygon[];

export type Geometry =
	| { type: 'Point'; coordinates: Point2D }
	| { type: 'MultiPoint'; coordinates: MultiPoint }
	| { type: 'LineString'; coordinates: LineString }
	| { type: 'MultiLineString'; coordinates: MultiLineString }
	| { type: 'Polygon'; coordinates: Polygon }
	| { type: 'MultiPolygon'; coordinates: MultiPolygon };

export interface Feature<TProperties extends Record<string, unknown> = Record<string, unknown>> {
	geometry: Geometry;
	properties?: TProperties;
}

export interface FeatureGroups {
	roads?: readonly Feature[];
	bridges?: readonly Feature[];
	buildings?: readonly Feature[];
	water?: readonly Feature[];
	greens?: readonly Feature[];
	rails?: readonly Feature[];
	tunnels?: readonly Feature[];
	cities?: readonly Feature[];
	landmarks?: readonly Feature[];
	points?: readonly Feature[];
}

export type LayerGroups = FeatureGroups;

export interface ViewportSize {
	width: number;
	height: number;
}

export interface GridPreset {
	columns: number;
}

export interface GridConfig {
	moving: GridPreset;
	settled: GridPreset;
}

export interface RoadGlyphPalette {
	horizontal: readonly string[];
	vertical: readonly string[];
	diagonalSlash: readonly string[];
	diagonalBackslash: readonly string[];
	junction: readonly string[];
}

export interface DensityGlyphPalette {
	readonly 0: string;
	readonly 1: string;
	readonly 2: string;
	readonly 3: string;
}

export interface AsciiPalettes {
	roads: RoadGlyphPalette;
	bridges: RoadGlyphPalette;
	rails: RoadGlyphPalette;
	tunnels: RoadGlyphPalette;
	buildings: DensityGlyphPalette;
	water: DensityGlyphPalette;
	greens: DensityGlyphPalette;
	cities: readonly string[];
	points: readonly string[];
	background: string;
}

export interface AsciiRendererConfig {
	grid?: Partial<GridConfig>;
	palettes?: Partial<AsciiPalettes>;
	detail?: {
		water?: number;
	};
	view?: {
		zoom?: number;
	};
}

export interface AsciiFrameCell {
	char: string;
	entity: EntityKind | 'background';
	coverage: number;
	font?: string;
	opacity?: number;
	rotation?: number;
}

export interface AsciiFrame {
	cols: number;
	rows: string[];
	rowCount: number;
	cellWidth: number;
	cellHeight: number;
	text: string;
	dominantCounts: Record<EntityKind | 'background', number>;
	cells?: readonly AsciiFrameCell[];
}

export interface AsciiRenderInput {
	viewport: ViewportSize;
	quality: QualityMode;
	layers: LayerGroups;
	config?: AsciiRendererConfig;
}
