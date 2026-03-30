import type { Feature } from '$lib/ascii';
import type { Position } from 'geojson';
import type { Map, MapGeoJSONFeature } from 'maplibre-gl';

function projectPosition(map: Map, position: Position): [number, number] {
	const [longitude, latitude] = position;
	const point = map.project([longitude, latitude]);
	return [point.x, point.y];
}

function projectLine(map: Map, coordinates: readonly Position[]): readonly [number, number][] {
	return coordinates.map((position) => projectPosition(map, position));
}

function projectGeometry(
	map: Map,
	geometry: MapGeoJSONFeature['geometry']
): Feature['geometry'] | null {
	switch (geometry.type) {
		case 'Point':
			return {
				type: 'Point',
				coordinates: projectPosition(map, geometry.coordinates)
			};
		case 'MultiPoint':
			return {
				type: 'MultiPoint',
				coordinates: geometry.coordinates.map((position) => projectPosition(map, position))
			};
		case 'LineString':
			return {
				type: 'LineString',
				coordinates: projectLine(map, geometry.coordinates)
			};
		case 'MultiLineString':
			return {
				type: 'MultiLineString',
				coordinates: geometry.coordinates.map((line) => projectLine(map, line))
			};
		case 'Polygon':
			return {
				type: 'Polygon',
				coordinates: geometry.coordinates.map((ring) => projectLine(map, ring))
			};
		case 'MultiPolygon':
			return {
				type: 'MultiPolygon',
				coordinates: geometry.coordinates.map((polygon) =>
					polygon.map((ring) => projectLine(map, ring))
				)
			};
		default:
			return null;
	}
}

export function projectMapFeatures(map: Map, features: readonly MapGeoJSONFeature[]): Feature[] {
	const projected: Feature[] = [];

	for (const feature of features) {
		const geometry = projectGeometry(map, feature.geometry);
		if (!geometry) {
			continue;
		}

		projected.push({
			geometry,
			properties: feature.properties
		});
	}

	return projected;
}
