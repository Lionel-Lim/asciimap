import type { AsciiPalettes, DensityGlyphPalette, RoadGlyphPalette } from './types';

const roadPalette: RoadGlyphPalette = {
	horizontal: ['-'],
	vertical: ['|'],
	diagonalSlash: ['/'],
	diagonalBackslash: ['\\'],
	junction: ['+']
};

const buildingPalette: DensityGlyphPalette = {
	0: '.',
	1: ':',
	2: '*',
	3: '#'
};

const waterPalette: DensityGlyphPalette = {
	0: '.',
	1: '~',
	2: '=',
	3: '='
};

export const defaultAsciiPalettes: AsciiPalettes = {
	roads: roadPalette,
	buildings: buildingPalette,
	water: waterPalette,
	points: ['*', 'o', 'x'],
	background: ' '
};

export function mergeAsciiPalettes(overrides?: Partial<AsciiPalettes>): AsciiPalettes {
	if (!overrides) {
		return defaultAsciiPalettes;
	}

	return {
		roads: { ...defaultAsciiPalettes.roads, ...overrides.roads },
		buildings: { ...defaultAsciiPalettes.buildings, ...overrides.buildings },
		water: { ...defaultAsciiPalettes.water, ...overrides.water },
		points: overrides.points ?? defaultAsciiPalettes.points,
		background: overrides.background ?? defaultAsciiPalettes.background
	};
}
