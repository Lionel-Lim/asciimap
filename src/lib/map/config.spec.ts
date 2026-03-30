import { describe, expect, it } from 'vitest';
import { describeRoadDetail, describeWaterDetail, resolveQueryLayers } from './config';

describe('resolveQueryLayers', () => {
	it('starts with only main roads at low detail', () => {
		const movingLayers = resolveQueryLayers('moving', 0);
		const settledLayers = resolveQueryLayers('settled', 10);

		expect(movingLayers.roads).toEqual(['road_motorway', 'road_trunk_primary']);
		expect(movingLayers.bridges).toEqual(['bridge_motorway', 'bridge_trunk_primary']);
		expect(settledLayers.roads).toEqual(['road_motorway', 'road_trunk_primary']);
	});

	it('adds minor branches at higher detail', () => {
		const settledLayers = resolveQueryLayers('settled', 60);
		const denseMovingLayers = resolveQueryLayers('moving', 100);

		expect(settledLayers.roads).toContain('road_minor');
		expect(settledLayers.bridges).toContain('bridge_street');
		expect(settledLayers.roads).not.toContain('road_path_pedestrian');
		expect(denseMovingLayers.roads).toContain('road_path_pedestrian');
		expect(denseMovingLayers.bridges).toContain('bridge_path_pedestrian');
	});

	it('always includes city label layers', () => {
		const layers = resolveQueryLayers('settled', 60);
		expect(layers.cities).toEqual([
			'label_city_capital',
			'label_city',
			'label_town',
			'label_village'
		]);
	});
});

describe('describeRoadDetail', () => {
	it('maps slider positions to readable labels', () => {
		expect(describeRoadDetail(0)).toBe('Main roads');
		expect(describeRoadDetail(40)).toBe('Balanced');
		expect(describeRoadDetail(72)).toBe('Branches');
		expect(describeRoadDetail(100)).toBe('All branches');
	});
});

describe('describeWaterDetail', () => {
	it('maps slider positions to readable labels', () => {
		expect(describeWaterDetail(0)).toBe('Light');
		expect(describeWaterDetail(45)).toBe('Balanced');
		expect(describeWaterDetail(70)).toBe('Solid');
		expect(describeWaterDetail(100)).toBe('Dense');
	});
});
