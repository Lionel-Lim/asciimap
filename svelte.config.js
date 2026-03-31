import adapter from '@sveltejs/adapter-static';
import { relative, sep } from 'node:path';

const basePath = process.env.BASE_PATH
	? process.env.BASE_PATH.startsWith('/')
		? process.env.BASE_PATH
		: `/${process.env.BASE_PATH}`
	: '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// defaults to rune mode for the project, execept for `node_modules`. Can be removed in svelte 6.
		runes: ({ filename }) => {
			const relativePath = relative(import.meta.dirname, filename);
			const pathSegments = relativePath.toLowerCase().split(sep);
			const isExternalLibrary = pathSegments.includes('node_modules');

			return isExternalLibrary ? undefined : true;
		}
	},
	kit: {
		adapter: adapter(),
		paths: {
			base: basePath
		}
	}
};

export default config;
