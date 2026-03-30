<script lang="ts">
	import { onMount } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { type AsciiFrame, type Feature, type FeatureGroups, type QualityMode } from '$lib/ascii';
	import { applyProportionalTypography } from '$lib/ascii/proportional';
	import { createRasterAsciiRenderer } from '$lib/ascii/raster';
	import {
		CITY_LABEL_MAX_ZOOM,
		DEFAULT_ROAD_DETAIL,
		DEFAULT_WATER_DETAIL,
		describeRoadDetail,
		describeWaterDetail,
		GRID_PRESETS,
		INITIAL_VIEW,
		LAYER_LABELS,
		MAP_STYLE_URL,
		QUALITY_SETTLE_MS,
		ROAD_DETAIL_RANGE,
		WATER_DETAIL_RANGE,
		resolveQueryLayers,
		type LayerToggleKey,
		type RenderPreference
	} from '$lib/map/config';
	import { buildCityLabelCommands } from '$lib/map/cityLabels';
	import { projectMapFeatures } from '$lib/map/projection';
	import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
	import type { Map, MapGeoJSONFeature } from 'maplibre-gl';

	const entityColors: Record<
		'background' | 'roads' | 'bridges' | 'buildings' | 'water' | 'cities' | 'points',
		string
	> = {
		background: 'rgba(0, 0, 0, 0)',
		roads: '#f8f5ea',
		bridges: '#ffd596',
		buildings: '#f4ba67',
		water: '#75d7ff',
		cities: '#c7d7ff',
		points: '#90f3d5'
	};

	const layerKeys: LayerToggleKey[] = ['roads', 'bridges', 'buildings', 'water', 'cities'];
	const qualityOptions = [
		['auto', 'Auto'],
		['performance', 'Performance'],
		['quality', 'Quality']
	] as const;
	const rasterRenderer = createRasterAsciiRenderer();
	const glyphFontFamily = 'Georgia, Palatino, "Times New Roman", serif';
	const glyphWidthSamples = ['W', 'B', 'R', 'X', 'C', 'w', 'b', 'r', 'x', 'c'];
	const cityLabelStroke = 'rgba(4, 8, 11, 0.84)';

	let stage: HTMLDivElement;
	let mapHost: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let map: Map | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let frameRequest = 0;
	let settleTimer: number | undefined;
	let frame = $state<AsciiFrame | null>(null);
	let errorMessage = $state('');
	let isLoaded = $state(false);
	let interactionMode = $state<QualityMode>('moving');
	let qualityPreference = $state<RenderPreference>('auto');
	let roadDetail = $state(DEFAULT_ROAD_DETAIL);
	let waterDetail = $state(DEFAULT_WATER_DETAIL);
	let showBackgroundMap = $state(true);
	let layerState = $state<Record<LayerToggleKey, boolean>>({
		roads: true,
		bridges: true,
		buildings: true,
		water: true,
		cities: true
	});
	let featureCounts = $state<Record<LayerToggleKey, number>>({
		roads: 0,
		bridges: 0,
		buildings: 0,
		water: 0,
		cities: 0
	});
	let fps = $state(0);
	let lastRenderAt = 0;
	let onFontsReady: (() => void) | undefined;

	function currentQualityMode(): QualityMode {
		if (qualityPreference === 'performance') {
			return 'moving';
		}

		if (qualityPreference === 'quality') {
			return 'settled';
		}

		return interactionMode;
	}

	function currentQueryLayers(): Record<LayerToggleKey, readonly string[]> {
		return resolveQueryLayers(currentQualityMode(), roadDetail);
	}

	function queueRender(): void {
		if (!map || !canvas || !stage || frameRequest !== 0) {
			return;
		}

		frameRequest = window.requestAnimationFrame(() => {
			frameRequest = 0;
			renderFrame();
		});
	}

	function beginInteraction(): void {
		interactionMode = 'moving';
		if (settleTimer) {
			clearTimeout(settleTimer);
			settleTimer = undefined;
		}
		queueRender();
	}

	function scheduleSettledRender(): void {
		if (settleTimer) {
			clearTimeout(settleTimer);
		}

		settleTimer = window.setTimeout(() => {
			interactionMode = 'settled';
			queueRender();
		}, QUALITY_SETTLE_MS);
	}

	function updateLayer(layer: LayerToggleKey, checked: boolean): void {
		layerState = { ...layerState, [layer]: checked };
		queueRender();
	}

	function updateQualityPreference(nextPreference: 'auto' | 'performance' | 'quality'): void {
		qualityPreference = nextPreference;
		queueRender();
	}

	function updateRoadDetail(nextRoadDetail: number): void {
		roadDetail = nextRoadDetail;
		queueRender();
	}

	function updateWaterDetail(nextWaterDetail: number): void {
		waterDetail = nextWaterDetail;
		queueRender();
	}

	function updateBackgroundMap(checked: boolean): void {
		showBackgroundMap = checked;
		if (checked) {
			window.requestAnimationFrame(() => {
				map?.resize();
				map?.triggerRepaint();
				queueRender();
			});
			return;
		}

		queueRender();
	}

	function friendlyMapError(message: string): string {
		if (message.includes('Failed to initialize WebGL')) {
			return 'WebGL is unavailable in this browser session, so the live MapLibre layer cannot start here. Open the prototype in a normal desktop browser to see the ASCII map render.';
		}

		return message;
	}

	function resolveGlyphFontSize(
		context: CanvasRenderingContext2D,
		cellWidth: number,
		cellHeight: number
	): number {
		const targetHeight = Math.max(8, cellHeight * 0.82);
		context.font = `600 ${targetHeight}px ${glyphFontFamily}`;

		const widestGlyph = glyphWidthSamples.reduce((maxWidth, glyph) => {
			return Math.max(maxWidth, context.measureText(glyph).width);
		}, 0);

		if (widestGlyph <= 0) {
			return targetHeight;
		}

		const maxAllowedWidth = Math.max(1, cellWidth * 0.9);
		if (widestGlyph <= maxAllowedWidth) {
			return targetHeight;
		}

		return Math.max(8, targetHeight * (maxAllowedWidth / widestGlyph));
	}

	async function loadMapStyle(): Promise<StyleSpecification> {
		const response = await fetch(MAP_STYLE_URL);
		if (!response.ok) {
			throw new Error(`Unable to load map style (${response.status}).`);
		}

		const style = (await response.json()) as StyleSpecification;

		return {
			...style,
			layers: style.layers.filter((layer) => layer.id !== 'building-3d')
		};
	}

	function collectVisibleFeatures(activeMap: Map): FeatureGroups {
		const groups: FeatureGroups = {};
		const rawGroups: Record<LayerToggleKey, MapGeoJSONFeature[]> = {
			roads: [],
			bridges: [],
			buildings: [],
			water: [],
			cities: []
		};
		const nextFeatureCounts: Record<LayerToggleKey, number> = {
			roads: 0,
			bridges: 0,
			buildings: 0,
			water: 0,
			cities: 0
		};
		const queryLayers = currentQueryLayers();
		const layerIdToBucket: Record<string, LayerToggleKey> = Object.fromEntries(
			layerKeys.flatMap((layerKey) =>
				queryLayers[layerKey].map((layerId: string) => [layerId, layerKey] as const)
			)
		);

		const activeLayerIds = layerKeys.flatMap((layerKey) =>
			layerState[layerKey] ? [...queryLayers[layerKey]] : []
		);

		if (activeLayerIds.length === 0) {
			featureCounts = nextFeatureCounts;
			return groups;
		}

		const queried = activeMap.queryRenderedFeatures({
			layers: activeLayerIds
		});

		for (const feature of queried) {
			const bucket = layerIdToBucket[feature.layer.id];
			if (bucket && layerState[bucket]) {
				rawGroups[bucket].push(feature);
			}
		}

		for (const layerKey of layerKeys) {
			if (rawGroups[layerKey].length === 0) {
				continue;
			}

			const projected = projectMapFeatures(activeMap, rawGroups[layerKey]);
			if (layerKey === 'bridges') {
				groups.bridges = projected;
			} else if (layerKey === 'cities') {
				groups.cities = projected;
			} else {
				groups[layerKey] = projected;
			}
			nextFeatureCounts[layerKey] = projected.length;
		}

		featureCounts = nextFeatureCounts;
		return groups;
	}

	function drawFrame(nextFrame: AsciiFrame): void {
		const context = canvas.getContext('2d');
		if (!context) {
			return;
		}

		const viewportWidth = stage.clientWidth;
		const viewportHeight = stage.clientHeight;
		const pixelRatio = window.devicePixelRatio || 1;
		const targetWidth = Math.max(1, Math.round(viewportWidth * pixelRatio));
		const targetHeight = Math.max(1, Math.round(viewportHeight * pixelRatio));
		const cssWidth = `${viewportWidth}px`;
		const cssHeight = `${viewportHeight}px`;

		if (canvas.style.width !== cssWidth) {
			canvas.style.width = cssWidth;
		}
		if (canvas.style.height !== cssHeight) {
			canvas.style.height = cssHeight;
		}

		if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
			canvas.width = targetWidth;
			canvas.height = targetHeight;
		}

		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.clearRect(0, 0, viewportWidth, viewportHeight);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const defaultFont = `600 ${resolveGlyphFontSize(context, nextFrame.cellWidth, nextFrame.cellHeight)}px ${glyphFontFamily}`;
		context.font = defaultFont;
		context.globalAlpha = 1;
		let currentFont = defaultFont;
		let currentOpacity = 1;
		let cellIndex = 0;

		for (let row = 0; row < nextFrame.rowCount; row += 1) {
			const currentRow = nextFrame.rows[row] ?? '';
			const y = row * nextFrame.cellHeight + nextFrame.cellHeight / 2;

			for (let column = 0; column < nextFrame.cols; column += 1) {
				const glyph = currentRow[column] ?? ' ';
				const cell = nextFrame.cells?.[cellIndex];
				const entity = cell?.entity ?? 'background';
				cellIndex += 1;

				if (glyph === ' ') {
					continue;
				}

				const font = cell?.font ?? defaultFont;
				if (font !== currentFont) {
					context.font = font;
					currentFont = font;
				}

				const opacity = cell?.opacity ?? 1;
				if (opacity !== currentOpacity) {
					context.globalAlpha = opacity;
					currentOpacity = opacity;
				}

				context.fillStyle = entityColors[entity];
				context.fillText(glyph, column * nextFrame.cellWidth + nextFrame.cellWidth / 2, y);
			}
		}

		if (currentOpacity !== 1) {
			context.globalAlpha = 1;
		}
	}

	function drawCityLabels(cityFeatures: readonly Feature[] | undefined): void {
		if (
			!cityFeatures ||
			cityFeatures.length === 0 ||
			!map ||
			map.getZoom() > CITY_LABEL_MAX_ZOOM ||
			!layerState.cities
		) {
			return;
		}

		const context = canvas.getContext('2d');
		if (!context) {
			return;
		}

		const labels = buildCityLabelCommands(cityFeatures, {
			width: stage.clientWidth,
			height: stage.clientHeight
		});
		if (labels.length === 0) {
			return;
		}

		const pixelRatio = window.devicePixelRatio || 1;
		context.save();
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.strokeStyle = cityLabelStroke;
		context.lineJoin = 'round';
		context.lineWidth = 3;

		let currentFont = '';
		let currentOpacity = 1;

		for (const label of labels) {
			if (label.font !== currentFont) {
				context.font = label.font;
				currentFont = label.font;
			}
			if (label.opacity !== currentOpacity) {
				context.globalAlpha = label.opacity;
				currentOpacity = label.opacity;
			}

			context.fillStyle = entityColors.cities;
			context.strokeText(label.name, label.x, label.y);
			context.fillText(label.name, label.x, label.y);
		}

		context.restore();
	}

	function renderFrame(): void {
		if (!map || !stage || !canvas || !map.isStyleLoaded()) {
			return;
		}

		const renderQuality = currentQualityMode();

		const viewportWidth = stage.clientWidth;
		const viewportHeight = stage.clientHeight;

		if (viewportWidth === 0 || viewportHeight === 0) {
			return;
		}

		const layers = collectVisibleFeatures(map);
		let nextFrame = rasterRenderer.render({
			viewport: { width: viewportWidth, height: viewportHeight },
			quality: renderQuality,
			layers: {
				roads: layers.roads,
				bridges: layers.bridges,
				buildings: layers.buildings,
				water: layers.water,
				points: layers.points
			},
			config: {
				grid: GRID_PRESETS[qualityPreference],
				detail: {
					water: waterDetail
				}
			}
		});

		nextFrame = applyProportionalTypography(nextFrame, {
			waterDetail
		});

		drawFrame(nextFrame);
		drawCityLabels(layers.cities);
		frame = nextFrame;

		const now = performance.now();
		if (lastRenderAt !== 0) {
			const instantaneousFps = 1000 / Math.max(1, now - lastRenderAt);
			fps = fps === 0 ? instantaneousFps : fps * 0.65 + instantaneousFps * 0.35;
		}
		lastRenderAt = now;
	}

	onMount(() => {
		void (async () => {
			try {
				const maplibregl = await import('maplibre-gl');
				const style = await loadMapStyle();

				map = new maplibregl.Map({
					container: mapHost,
					style,
					center: INITIAL_VIEW.center,
					zoom: INITIAL_VIEW.zoom,
					pitch: INITIAL_VIEW.pitch,
					bearing: INITIAL_VIEW.bearing,
					attributionControl: false
				});

				map.on('load', () => {
					isLoaded = true;
					window.requestAnimationFrame(() => map?.resize());
					interactionMode = 'settled';
					queueRender();
				});

				map.on('movestart', beginInteraction);
				map.on('move', queueRender);
				map.on('zoom', queueRender);
				map.on('moveend', scheduleSettledRender);
				map.on('idle', () => {
					if (interactionMode === 'settled') {
						queueRender();
					}
				});
				map.on('error', (event) => {
					const message =
						event.error instanceof Error
							? event.error.message
							: 'Map rendering failed unexpectedly.';
					errorMessage = friendlyMapError(message);
				});

				resizeObserver = new ResizeObserver(() => {
					map?.resize();
					queueRender();
				});
				resizeObserver.observe(stage);

				onFontsReady = () => {
					queueRender();
				};

				void document.fonts?.ready.then(() => {
					onFontsReady?.();
				});
				document.fonts?.addEventListener?.('loadingdone', onFontsReady);
			} catch (error) {
				errorMessage = friendlyMapError(
					error instanceof Error ? error.message : 'Unable to initialize the browser map runtime.'
				);
			}
		})();

		return () => {
			if (frameRequest !== 0) {
				window.cancelAnimationFrame(frameRequest);
			}
			if (settleTimer) {
				clearTimeout(settleTimer);
			}
			if (onFontsReady) {
				document.fonts?.removeEventListener?.('loadingdone', onFontsReady);
			}
			resizeObserver?.disconnect();
			map?.remove();
		};
	});
</script>

<section class="prototype-shell">
	<div class="stage-wrap">
		<div bind:this={stage} class="map-stage">
			<div bind:this={mapHost} class:map-hidden={!showBackgroundMap} class="map-host"></div>
			<canvas bind:this={canvas} class="ascii-canvas"></canvas>
			<div class="scanlines" aria-hidden="true"></div>

			{#if !isLoaded && !errorMessage}
				<div class="status-card">Loading vector tiles and warming the ASCII overlay…</div>
			{/if}

			{#if errorMessage}
				<div class="status-card error">{errorMessage}</div>
			{/if}
		</div>
	</div>

	<aside class="control-panel">
		<p class="eyebrow">Milestone 1 Prototype</p>
		<h1>Real-Time ASCII OSM Viewer</h1>
		<p class="lede">
			Live vector-tile features are sampled in the browser and redrawn as a proportional
			letterfield. Drag, zoom, and toggle roads, bridges, buildings, water, or city labels
			independently while stronger cells step up from <code>r</code>/<code>b</code>/<code>w</code>
			to <code>R</code>/<code>B</code>/<code>W</code>. City names switch to measured label text at
			broader zoom levels.
		</p>

		<section class="panel-section">
			<h2>Layers</h2>
			<div class="toggle-grid">
				{#each layerKeys as layerKey (layerKey)}
					<label class="toggle-row">
						<span>{LAYER_LABELS[layerKey]}</span>
						<input
							type="checkbox"
							checked={layerState[layerKey]}
							onchange={(event) =>
								updateLayer(layerKey, (event.currentTarget as HTMLInputElement).checked)}
						/>
					</label>
				{/each}
			</div>
		</section>

		<section class="panel-section">
			<h2>Road Detail</h2>
			<div class="range-card">
				<div class="range-head">
					<span>{describeRoadDetail(roadDetail)}</span>
					<strong>{roadDetail}%</strong>
				</div>
				<input
					type="range"
					min={ROAD_DETAIL_RANGE.min}
					max={ROAD_DETAIL_RANGE.max}
					step="1"
					value={roadDetail}
					oninput={(event) =>
						updateRoadDetail(Number.parseInt((event.currentTarget as HTMLInputElement).value, 10))}
				/>
				<div class="range-scale" aria-hidden="true">
					<span>Main</span>
					<span>Branches</span>
				</div>
			</div>
		</section>

		<section class="panel-section">
			<h2>Water Detail</h2>
			<div class="range-card">
				<div class="range-head">
					<span>{describeWaterDetail(waterDetail)}</span>
					<strong>{waterDetail}%</strong>
				</div>
				<input
					type="range"
					min={WATER_DETAIL_RANGE.min}
					max={WATER_DETAIL_RANGE.max}
					step="1"
					value={waterDetail}
					oninput={(event) =>
						updateWaterDetail(Number.parseInt((event.currentTarget as HTMLInputElement).value, 10))}
				/>
				<div class="range-scale" aria-hidden="true">
					<span>Light</span>
					<span>Dense</span>
				</div>
			</div>
		</section>

		<section class="panel-section">
			<h2>Display</h2>
			<label class="toggle-row">
				<span>Background Map</span>
				<input
					type="checkbox"
					checked={showBackgroundMap}
					onchange={(event) =>
						updateBackgroundMap((event.currentTarget as HTMLInputElement).checked)}
				/>
			</label>
		</section>

		<section class="panel-section">
			<h2>Quality</h2>
			<div class="segmented-row quality-row">
				{#each qualityOptions as [value, label] (value)}
					<button
						type="button"
						class:active={qualityPreference === value}
						onclick={() => updateQualityPreference(value)}
					>
						{label}
					</button>
				{/each}
			</div>
		</section>

		<section class="panel-section stats">
			<h2>Telemetry</h2>
			<dl>
				<div>
					<dt>Mode</dt>
					<dd>{currentQualityMode() === 'moving' ? 'Interaction grid' : 'Settled grid'}</dd>
				</div>
				<div>
					<dt>Glyphs</dt>
					<dd>R/r · X/x · B/b · W/w + city names</dd>
				</div>
				<div>
					<dt>Road detail</dt>
					<dd>{describeRoadDetail(roadDetail)}</dd>
				</div>
				<div>
					<dt>Water detail</dt>
					<dd>{describeWaterDetail(waterDetail)}</dd>
				</div>
				<div>
					<dt>Grid</dt>
					<dd>{frame ? `${frame.cols} × ${frame.rowCount}` : 'warming up'}</dd>
				</div>
				<div>
					<dt>FPS</dt>
					<dd>{fps ? `${fps.toFixed(1)}` : '—'}</dd>
				</div>
				<div>
					<dt>Features</dt>
					<dd>
						{featureCounts.roads +
							featureCounts.bridges +
							featureCounts.buildings +
							featureCounts.water +
							featureCounts.cities}
					</dd>
				</div>
				<div>
					<dt>Roads</dt>
					<dd>{featureCounts.roads}</dd>
				</div>
				<div>
					<dt>Bridges</dt>
					<dd>{featureCounts.bridges}</dd>
				</div>
				<div>
					<dt>Buildings</dt>
					<dd>{featureCounts.buildings}</dd>
				</div>
				<div>
					<dt>Water</dt>
					<dd>{featureCounts.water}</dd>
				</div>
				<div>
					<dt>Cities</dt>
					<dd>{featureCounts.cities}</dd>
				</div>
				<div>
					<dt>Basemap</dt>
					<dd>{showBackgroundMap ? 'Visible' : 'Hidden'}</dd>
				</div>
			</dl>
		</section>

		<p class="footnote">
			Map data © OpenStreetMap contributors. Style via OpenFreeMap Liberty. Map runtime by MapLibre
			GL JS.
		</p>
	</aside>
</section>

<style>
	.prototype-shell {
		min-height: 100vh;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
		gap: 1rem;
		padding: 1rem;
	}

	.stage-wrap {
		min-width: 0;
	}

	.map-stage {
		position: relative;
		min-height: calc(100vh - 2rem);
		overflow: hidden;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 1.5rem;
		background:
			radial-gradient(circle at 20% 20%, rgba(117, 215, 255, 0.14), transparent 28%),
			radial-gradient(circle at 80% 10%, rgba(244, 186, 103, 0.16), transparent 24%),
			linear-gradient(160deg, rgba(6, 17, 23, 0.98), rgba(4, 8, 11, 0.96));
		box-shadow:
			0 24px 60px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.02);
	}

	.map-host,
	.ascii-canvas,
	.scanlines {
		position: absolute;
		inset: 0;
	}

	.map-host {
		opacity: 0.16;
		filter: grayscale(0.4) saturate(0.7) contrast(0.85);
		transition: opacity 140ms ease;
	}

	.map-host.map-hidden {
		opacity: 0;
	}

	.ascii-canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.ascii-canvas,
	.scanlines {
		pointer-events: none;
	}

	.scanlines {
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 65%),
			repeating-linear-gradient(
				180deg,
				rgba(144, 243, 213, 0.04) 0,
				rgba(144, 243, 213, 0.04) 1px,
				transparent 1px,
				transparent 4px
			);
		mix-blend-mode: screen;
		opacity: 0.45;
	}

	.control-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.2rem 1.1rem;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 1.5rem;
		background: rgba(7, 16, 20, 0.88);
		box-shadow: 0 20px 48px rgba(0, 0, 0, 0.24);
		backdrop-filter: blur(18px);
	}

	.eyebrow,
	.panel-section h2,
	.footnote,
	dt {
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #9db5b4;
	}

	h1 {
		margin: 0;
		font-family: 'Iowan Old Style', 'Book Antiqua', Georgia, serif;
		font-size: clamp(2rem, 2.6vw, 3.4rem);
		line-height: 0.98;
		letter-spacing: -0.03em;
	}

	.lede {
		margin: 0;
		font-size: 0.97rem;
		line-height: 1.65;
		color: rgba(237, 247, 242, 0.84);
	}

	.panel-section {
		padding-top: 0.9rem;
		border-top: 1px solid rgba(144, 243, 213, 0.12);
	}

	.panel-section h2 {
		margin: 0 0 0.75rem;
	}

	.toggle-grid {
		display: grid;
		gap: 0.65rem;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid rgba(144, 243, 213, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
	}

	.toggle-row span {
		font-size: 0.9rem;
	}

	.toggle-row input {
		accent-color: #90f3d5;
	}

	.segmented-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.quality-row {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.range-card {
		display: grid;
		gap: 0.7rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid rgba(144, 243, 213, 0.12);
		border-radius: 1.1rem;
		background: rgba(255, 255, 255, 0.03);
	}

	.range-head,
	.range-scale {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.range-head span,
	.range-scale span {
		font-size: 0.82rem;
		color: rgba(237, 247, 242, 0.72);
	}

	.range-head strong {
		font-size: 0.95rem;
		color: #edf7f2;
	}

	.range-card input[type='range'] {
		width: 100%;
		margin: 0;
		accent-color: #f4ba67;
	}

	.segmented-row button {
		padding: 0.72rem 0.8rem;
		border: 1px solid rgba(144, 243, 213, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			background 120ms ease;
	}

	.segmented-row button:hover,
	.segmented-row button:focus-visible {
		transform: translateY(-1px);
		border-color: rgba(144, 243, 213, 0.34);
		outline: none;
	}

	.segmented-row button.active {
		border-color: rgba(244, 186, 103, 0.38);
		background: rgba(244, 186, 103, 0.14);
		color: #fff2d3;
	}

	.stats dl {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.stats dl div {
		padding: 0.75rem 0.8rem;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(144, 243, 213, 0.1);
	}

	dt,
	dd {
		margin: 0;
	}

	dd {
		margin-top: 0.28rem;
		font-size: 0.95rem;
		color: #edf7f2;
	}

	.status-card {
		position: absolute;
		left: 1rem;
		bottom: 1rem;
		max-width: min(28rem, calc(100% - 2rem));
		padding: 0.85rem 1rem;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 1rem;
		background: rgba(7, 16, 20, 0.88);
		color: #edf7f2;
		backdrop-filter: blur(14px);
	}

	.status-card.error {
		border-color: rgba(244, 186, 103, 0.34);
		color: #ffe4be;
	}

	.footnote {
		margin: auto 0 0;
		line-height: 1.6;
	}

	:global(.maplibregl-ctrl-bottom-right),
	:global(.maplibregl-ctrl-bottom-left) {
		display: none;
	}

	@media (max-width: 960px) {
		.prototype-shell {
			grid-template-columns: 1fr;
		}

		.map-stage {
			min-height: 62vh;
		}
	}
</style>
