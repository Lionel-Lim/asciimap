<script lang="ts">
	import { assets } from '$app/paths';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/600.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={`${assets}/icons/asciimap-icon.png`} />
	<link rel="apple-touch-icon" href={`${assets}/icons/asciimap-icon.png`} />
</svelte:head>

{@render children()}
