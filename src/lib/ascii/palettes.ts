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

const railPalette: RoadGlyphPalette = {
	horizontal: ['r'],
	vertical: ['r'],
	diagonalSlash: ['r'],
	diagonalBackslash: ['r'],
	junction: ['R']
};

const tunnelPalette: RoadGlyphPalette = {
	horizontal: ['u'],
	vertical: ['u'],
	diagonalSlash: ['u'],
	diagonalBackslash: ['u'],
	junction: ['U']
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

const greenPalette: DensityGlyphPalette = {
	0: '.',
	1: ',',
	2: ';',
	3: '%'
};

export const defaultAsciiPalettes: AsciiPalettes = {
	roads: roadPalette,
	bridges: bridgePalette,
	rails: railPalette,
	tunnels: tunnelPalette,
	buildings: buildingPalette,
	water: waterPalette,
	greens: greenPalette,
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
		rails: { ...defaultAsciiPalettes.rails, ...overrides.rails },
		tunnels: { ...defaultAsciiPalettes.tunnels, ...overrides.tunnels },
		buildings: { ...defaultAsciiPalettes.buildings, ...overrides.buildings },
		water: { ...defaultAsciiPalettes.water, ...overrides.water },
		greens: { ...defaultAsciiPalettes.greens, ...overrides.greens },
		cities: overrides.cities ?? defaultAsciiPalettes.cities,
		points: overrides.points ?? defaultAsciiPalettes.points,
		background: overrides.background ?? defaultAsciiPalettes.background
	};
}
