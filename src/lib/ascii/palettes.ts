import type { AsciiPalettes, DensityGlyphPalette, RoadGlyphPalette } from './types';

const roadPalette: RoadGlyphPalette = {
	horizontal: ['-'],
	vertical: ['|'],
	diagonalSlash: ['/'],
	diagonalBackslash: ['\\'],
	junction: ['+']
};

const bridgePalette: RoadGlyphPalette = {
	horizontal: ['='],
	vertical: ['!'],
	diagonalSlash: ['/'],
	diagonalBackslash: ['\\'],
	junction: ['#']
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
	bridges: bridgePalette,
	buildings: buildingPalette,
	water: waterPalette,
	cities: ['c', 'C'],
	points: ['*', 'o', 'x'],
	background: ' '
};

export function mergeAsciiPalettes(overrides?: Partial<AsciiPalettes>): AsciiPalettes {
	if (!overrides) {
		return defaultAsciiPalettes;
	}

	return {
		roads: { ...defaultAsciiPalettes.roads, ...overrides.roads },
		bridges: { ...defaultAsciiPalettes.bridges, ...overrides.bridges },
		buildings: { ...defaultAsciiPalettes.buildings, ...overrides.buildings },
		water: { ...defaultAsciiPalettes.water, ...overrides.water },
		cities: overrides.cities ?? defaultAsciiPalettes.cities,
		points: overrides.points ?? defaultAsciiPalettes.points,
		background: overrides.background ?? defaultAsciiPalettes.background
	};
}
