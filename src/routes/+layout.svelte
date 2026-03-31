<script lang="ts">
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/600.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/icons/asciimap-icon.png" />
	<link rel="apple-touch-icon" href="/icons/asciimap-icon.png" />
</svelte:head>

{@render children()}
