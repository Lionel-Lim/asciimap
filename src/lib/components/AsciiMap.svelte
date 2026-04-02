<script lang="ts">
	import { onMount } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import {
		AIRCRAFT_BLEND_DURATION_MS,
		buildAircraftTracks,
		resolveDisplayedAircraft,
		type AircraftTrack
	} from '$lib/aircraft/motion';
	import { stampAircraftGlyphs, type PresentedAircraftGlyph } from '$lib/aircraft/stamp';
	import {
		AIRCRAFT_MIN_REQUEST_GAP_MS,
		AIRCRAFT_POLL_INTERVAL_MS,
		aircraftBoundsKey,
		buildAircraftFeedQuery,
		buildAircraftFeedUrl,
		normalizeAircraftBounds,
		parseAircraftFeedStates,
		resolveAircraftFeedSampledAt,
		type AircraftBounds
	} from '$lib/aircraft/feed';
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
		LANDMARK_LABEL_MIN_ZOOM,
		LAYER_LABELS,
		MAP_STYLE_URL,
		ROAD_DETAIL_RANGE,
		WATER_DETAIL_RANGE,
		resolveEffectiveRoadDetail,
		resolveQueryLayers,
		type LayerToggleKey,
		type RenderPreference
	} from '$lib/map/config';
	import { buildCityLabelCommands, type CityLabelCommand } from '$lib/map/cityLabels';
	import { buildLandmarkLabelCommands, type LandmarkLabelCommand } from '$lib/map/landmarkLabels';
	import { projectMapFeatures } from '$lib/map/projection';
	import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
	import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl';

	const entityColors: Record<
		| 'background'
		| 'roads'
		| 'bridges'
		| 'buildings'
		| 'water'
		| 'greens'
		| 'rails'
		| 'tunnels'
		| 'cities'
		| 'points',
		string
	> = {
		background: 'rgba(0, 0, 0, 0)',
		roads: '#f8f5ea',
		bridges: '#ffd596',
		buildings: '#f4ba67',
		water: '#75d7ff',
		greens: '#9be279',
		rails: '#d3b5ff',
		tunnels: '#a19ab8',
		cities: '#c7d7ff',
		points: '#90f3d5'
	};

	const layerKeys: LayerToggleKey[] = [
		'roads',
		'bridges',
		'buildings',
		'water',
		'greens',
		'rails',
		'tunnels',
		'cities',
		'landmarks'
	];
	const qualityOptions = [
		['auto', 'Auto'],
		['performance', 'Performance'],
		['quality', 'Quality']
	] as const;
	const authorName = 'DY';
	const rasterRenderer = createRasterAsciiRenderer();
	const glyphFontFamily = 'Georgia, Palatino, "Times New Roman", serif';
	const aircraftMarkerGlyph = 'A';
	const aircraftOverlayFrameMs = 1000 / 30;
	const aircraftViewportRefreshMs = 20_000;
	const glyphWidthSamples = [
		'W',
		'B',
		'R',
		'X',
		'G',
		'M',
		'T',
		'C',
		'w',
		'b',
		'r',
		'x',
		'g',
		'm',
		't',
		'c'
	];
	const emptyFeatures: readonly Feature[] = [];
	const layerGlyphs: Record<LayerToggleKey | 'aircraft', { color: string; glyph: string }> = {
		roads: { color: entityColors.roads, glyph: 'R / r' },
		bridges: { color: entityColors.bridges, glyph: 'X / x' },
		buildings: { color: entityColors.buildings, glyph: 'B / b' },
		water: { color: entityColors.water, glyph: 'W / w' },
		greens: { color: entityColors.greens, glyph: 'G / g' },
		rails: { color: entityColors.rails, glyph: 'R / r' },
		tunnels: { color: entityColors.tunnels, glyph: 'U / u' },
		cities: { color: entityColors.cities, glyph: 'Aa' },
		landmarks: { color: entityColors.points, glyph: 'Aa' },
		aircraft: { color: entityColors.points, glyph: 'aAa' }
	};
	type QueryPlan = {
		key: string;
		activeLayerIds: string[];
		layerIdToBucket: Record<string, LayerToggleKey>;
	};
	type VisibleFeatureCache = {
		key: string;
		featureCounts: Record<LayerToggleKey, number>;
		groups: FeatureGroups;
	};
	type CityLabelCache = {
		commands: CityLabelCommand[];
		features: readonly Feature[];
		height: number;
		width: number;
	};
	type LandmarkLabelCache = {
		commands: LandmarkLabelCommand[];
		features: readonly Feature[];
		height: number;
		width: number;
		zoom: number;
	};
	type AircraftFeedIssueCode =
		| 'none'
		| 'rate_limit'
		| 'network'
		| 'provider_unavailable'
		| 'bad_response'
		| 'provider_error'
		| 'unknown';
	let stage: HTMLDivElement;
	let mapHost: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let baseFrameCanvas: HTMLCanvasElement | undefined;
	let map: MapLibreMap | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let frameRequest = 0;
	let frame = $state<AsciiFrame | null>(null);
	let errorMessage = $state('');
	let isLoaded = $state(false);
	let qualityPreference = $state<RenderPreference>('auto');
	let roadDetail = $state(DEFAULT_ROAD_DETAIL);
	let waterDetail = $state(DEFAULT_WATER_DETAIL);
	let showBackgroundMap = $state(false);
	let layerState = $state<Record<LayerToggleKey, boolean>>({
		roads: true,
		bridges: true,
		buildings: true,
		water: true,
		greens: true,
		rails: true,
		tunnels: true,
		cities: true,
		landmarks: true
	});
	let featureCounts = $state<Record<LayerToggleKey, number>>({
		roads: 0,
		bridges: 0,
		buildings: 0,
		water: 0,
		greens: 0,
		rails: 0,
		tunnels: 0,
		cities: 0,
		landmarks: 0
	});
	let fps = $state(0);
	let lastRenderAt = 0;
	let onFontsReady: (() => void) | undefined;
	let cityLabelCommands = $state<CityLabelCommand[]>([]);
	let landmarkLabelCommands = $state<LandmarkLabelCommand[]>([]);
	let showAircraft = $state(true);
	let aircraftCount = $state(0);
	let aircraftVisibleCount = $state(0);
	let aircraftFeedIssueCode = $state<AircraftFeedIssueCode>('none');
	let aircraftFeedMessage = $state('');
	let aircraftFeedStale = $state(false);
	let aircraftFeedEmpty = $state(false);
	let aircraftFetchedAt = $state<number | null>(null);
	let aircraftLoading = $state(false);
	let aircraftTracks = new Map<string, AircraftTrack>();
	let aircraftAnimationFrame = 0;
	let aircraftPollTimer: number | undefined;
	let aircraftUiTimer: number | undefined;
	let aircraftCooldownUntil = 0;
	let aircraftUiNow = $state(Date.now());
	let lastAircraftRequestAt = 0;
	let lastAircraftViewportFetchAt = 0;
	let lastAircraftBoundsKey = '';
	let lastAircraftOverlayAt = 0;
	let aircraftGlyphs: PresentedAircraftGlyph[] = [];
	const glyphFontSizeCache: Record<string, number> = {};
	let queryPlanCache: QueryPlan | null = null;
	let visibleFeatureCache: VisibleFeatureCache | null = null;
	let visibleFeatureVersion = 0;
	let cityLabelCache: CityLabelCache | null = null;
	let landmarkLabelCache: LandmarkLabelCache | null = null;

	function currentQualityMode(): QualityMode {
		return qualityPreference === 'performance' ? 'moving' : 'settled';
	}

	function currentMapZoom(): number {
		return map?.getZoom() ?? INITIAL_VIEW.zoom;
	}

	function cityLabelsVisibleAtZoom(zoom: number): boolean {
		return layerState.cities && zoom <= CITY_LABEL_MAX_ZOOM;
	}

	function currentEffectiveRoadDetail(): number {
		const zoom = currentMapZoom();
		return resolveEffectiveRoadDetail(roadDetail, zoom, cityLabelsVisibleAtZoom(zoom));
	}

	function currentQueryPlan(): QueryPlan {
		const quality = currentQualityMode();
		const effectiveRoadDetail = currentEffectiveRoadDetail();
		const layerStateKey = layerKeys.map((layerKey) => (layerState[layerKey] ? '1' : '0')).join('');
		const key = `${quality}|${effectiveRoadDetail}|${layerStateKey}`;
		if (queryPlanCache?.key === key) {
			return queryPlanCache;
		}

		const queryLayers = resolveQueryLayers(quality, effectiveRoadDetail);
		const activeLayerIds: string[] = [];
		const layerIdToBucket: Record<string, LayerToggleKey> = {};

		for (const layerKey of layerKeys) {
			const layerIds = queryLayers[layerKey];
			for (const layerId of layerIds) {
				layerIdToBucket[layerId] = layerKey;
				if (layerState[layerKey]) {
					activeLayerIds.push(layerId);
				}
			}
		}

		queryPlanCache = {
			key,
			activeLayerIds,
			layerIdToBucket
		};
		return queryPlanCache;
	}

	function invalidateVisibleFeatureCache(): void {
		visibleFeatureVersion += 1;
		visibleFeatureCache = null;
	}

	function resolveCityCommands(
		features: readonly Feature[],
		viewportWidth: number,
		viewportHeight: number
	): CityLabelCommand[] {
		if (
			cityLabelCache?.features === features &&
			cityLabelCache.width === viewportWidth &&
			cityLabelCache.height === viewportHeight
		) {
			return cityLabelCache.commands;
		}

		const commands = buildCityLabelCommands(features, {
			width: viewportWidth,
			height: viewportHeight
		});
		cityLabelCache = {
			commands,
			features,
			height: viewportHeight,
			width: viewportWidth
		};
		return commands;
	}

	function resolveLandmarkCommands(
		features: readonly Feature[],
		viewportWidth: number,
		viewportHeight: number,
		zoom: number
	): LandmarkLabelCommand[] {
		if (
			landmarkLabelCache?.features === features &&
			landmarkLabelCache.width === viewportWidth &&
			landmarkLabelCache.height === viewportHeight &&
			landmarkLabelCache.zoom === zoom
		) {
			return landmarkLabelCache.commands;
		}

		const commands = buildLandmarkLabelCommands(
			features,
			{
				width: viewportWidth,
				height: viewportHeight
			},
			zoom
		);
		landmarkLabelCache = {
			commands,
			features,
			height: viewportHeight,
			width: viewportWidth,
			zoom
		};
		return commands;
	}

	function currentAircraftBounds(): AircraftBounds | null {
		if (!map) {
			return null;
		}

		const bounds = map.getBounds();
		return normalizeAircraftBounds({
			lamin: bounds.getSouth(),
			lomin: bounds.getWest(),
			lamax: bounds.getNorth(),
			lomax: bounds.getEast()
		});
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

	function stopAircraftPolling(): void {
		if (aircraftPollTimer !== undefined) {
			window.clearTimeout(aircraftPollTimer);
			aircraftPollTimer = undefined;
		}
	}

	function scheduleAircraftPolling(delay = AIRCRAFT_POLL_INTERVAL_MS): void {
		stopAircraftPolling();
		if (!showAircraft) {
			return;
		}

		aircraftPollTimer = window.setTimeout(() => {
			aircraftPollTimer = undefined;
			if (document.visibilityState === 'hidden') {
				scheduleAircraftPolling(AIRCRAFT_POLL_INTERVAL_MS);
				return;
			}

			void refreshAircraft(true);
		}, delay);
	}

	function stopAircraftAnimation(): void {
		if (aircraftAnimationFrame !== 0) {
			window.cancelAnimationFrame(aircraftAnimationFrame);
			aircraftAnimationFrame = 0;
		}
	}

	function redrawCurrentView(): void {
		if (frame) {
			stampAircraftIntoFrame(frame);
			if (!blitBaseFrame()) {
				drawFrame(frame);
			}
			drawAircraftGlyphs();
			return;
		}

		aircraftVisibleCount = 0;
		aircraftGlyphs = [];
	}

	function animateAircraft(now: number): void {
		aircraftAnimationFrame = 0;
		if (!showAircraft || aircraftTracks.size === 0) {
			return;
		}

		if (now - lastAircraftOverlayAt >= aircraftOverlayFrameMs) {
			lastAircraftOverlayAt = now;
			redrawCurrentView();
		}

		aircraftAnimationFrame = window.requestAnimationFrame(animateAircraft);
	}

	function startAircraftAnimation(): void {
		if (aircraftAnimationFrame !== 0 || !showAircraft || aircraftTracks.size === 0) {
			return;
		}

		aircraftAnimationFrame = window.requestAnimationFrame(animateAircraft);
	}

	function aircraftFeedStatus(): string {
		if (!showAircraft) {
			return 'Off';
		}
		if (aircraftLoading && aircraftFetchedAt === null) {
			return 'Loading';
		}
		if (aircraftFeedStale && aircraftFetchedAt !== null) {
			return aircraftFeedMessage
				? `Stale (${formatRelativeTime(aircraftFetchedAt)}): ${aircraftFeedMessage}`
				: `Stale (${formatRelativeTime(aircraftFetchedAt)})`;
		}
		if (aircraftFeedIssueCode !== 'none') {
			return aircraftFeedMessage;
		}
		if (aircraftFeedEmpty && aircraftFetchedAt !== null) {
			return `No aircraft in view (${formatRelativeTime(aircraftFetchedAt)})`;
		}
		if (aircraftFeedStale) {
			return 'Stale data';
		}
		if (aircraftFetchedAt !== null) {
			return `Live (${formatRelativeTime(aircraftFetchedAt)})`;
		}
		return 'Waiting';
	}

	function formatRelativeTime(timestamp: number): string {
		const elapsedMs = Math.max(0, aircraftUiNow - timestamp);
		if (elapsedMs < 5_000) {
			return 'just now';
		}
		if (elapsedMs < 60_000) {
			return `${Math.round(elapsedMs / 1_000)}s ago`;
		}
		if (elapsedMs < 3_600_000) {
			return `${Math.round(elapsedMs / 60_000)}m ago`;
		}

		return `${Math.round(elapsedMs / 3_600_000)}h ago`;
	}

	function formatDuration(ms: number): string {
		if (ms < 1_000) {
			return `${(ms / 1_000).toFixed(1)}s`;
		}
		if (ms < 10_000) {
			return `${(ms / 1_000).toFixed(1)}s`;
		}
		if (ms < 60_000) {
			return `${Math.ceil(ms / 1_000)}s`;
		}

		return `${Math.ceil(ms / 60_000)}m`;
	}

	function aircraftCooldownRemainingMs(): number {
		return Math.max(0, aircraftCooldownUntil - aircraftUiNow);
	}

	function aircraftFetchDisabled(): boolean {
		return !showAircraft || aircraftLoading || aircraftCooldownRemainingMs() > 0;
	}

	function aircraftActionLabel(): string {
		if (!showAircraft) {
			return 'Aircraft Off';
		}
		if (aircraftLoading) {
			return 'Fetching aircraft…';
		}

		const cooldownRemainingMs = aircraftCooldownRemainingMs();
		if (cooldownRemainingMs > 0) {
			return `Wait ${formatDuration(cooldownRemainingMs)}`;
		}

		return 'Fetch Aircraft Here';
	}

	function aircraftActionHint(): string {
		if (!showAircraft) {
			return 'Enable the aircraft layer to resume polling and manual fetches.';
		}
		if (aircraftLoading) {
			return 'Refreshing aircraft for the current map view.';
		}

		const cooldownRemainingMs = aircraftCooldownRemainingMs();
		if (cooldownRemainingMs > 0) {
			return `Cooling down for ${formatDuration(cooldownRemainingMs)} to respect Airplanes.live's 1 request/second limit.`;
		}
		if (aircraftFeedStale && aircraftFetchedAt !== null) {
			return `${aircraftFeedMessage || 'Aircraft refresh failed.'} Showing stale data from ${formatRelativeTime(aircraftFetchedAt)}.`;
		}
		if (aircraftFeedIssueCode !== 'none') {
			return aircraftFeedMessage;
		}
		if (aircraftFeedEmpty && aircraftFetchedAt !== null) {
			return `No aircraft found in the current map view as of ${formatRelativeTime(aircraftFetchedAt)}.`;
		}
		if (aircraftFetchedAt !== null) {
			return `Last refreshed ${formatRelativeTime(aircraftFetchedAt)}. Fetches aircraft for the current map view immediately.`;
		}

		return 'Fetches aircraft for the current map view immediately.';
	}

	function aircraftActionHintTone(): 'muted' | 'success' | 'warning' | 'error' {
		if (!showAircraft) {
			return 'muted';
		}
		if (aircraftFeedIssueCode !== 'none') {
			return aircraftFeedStale ? 'warning' : 'error';
		}
		if (aircraftCooldownRemainingMs() > 0) {
			return 'warning';
		}
		if (aircraftFeedEmpty || aircraftFetchedAt !== null) {
			return 'success';
		}

		return 'muted';
	}

	function setAircraftFeedIssue(code: AircraftFeedIssueCode, message: string): void {
		aircraftFeedIssueCode = code;
		aircraftFeedMessage = message;
	}

	function clearAircraftFeedIssue(): void {
		setAircraftFeedIssue('none', '');
	}

	function updateAircraftVisibility(checked: boolean): void {
		showAircraft = checked;
		if (!checked) {
			stopAircraftPolling();
			stopAircraftAnimation();
			redrawCurrentView();
			return;
		}

		if (aircraftTracks.size > 0) {
			startAircraftAnimation();
			redrawCurrentView();
		}

		void refreshAircraft(lastAircraftRequestAt === 0);
	}

	async function refreshAircraft(force = false): Promise<void> {
		if (!map || !showAircraft || aircraftLoading) {
			return;
		}

		const bounds = currentAircraftBounds();
		if (!bounds) {
			return;
		}

		const now = Date.now();
		if (now < aircraftCooldownUntil) {
			return;
		}

		const boundsKey = aircraftBoundsKey(bounds);
		const sameBounds = boundsKey === lastAircraftBoundsKey;
		if (
			!force &&
			((sameBounds &&
				lastAircraftRequestAt !== 0 &&
				now - lastAircraftRequestAt < AIRCRAFT_POLL_INTERVAL_MS) ||
				(!sameBounds &&
					lastAircraftViewportFetchAt !== 0 &&
					now - lastAircraftViewportFetchAt < aircraftViewportRefreshMs))
		) {
			return;
		}

		aircraftLoading = true;
		aircraftCooldownUntil = now + AIRCRAFT_MIN_REQUEST_GAP_MS;
		lastAircraftRequestAt = now;
		if (!sameBounds) {
			lastAircraftViewportFetchAt = now;
		}
		try {
			const url = buildAircraftFeedUrl(buildAircraftFeedQuery(bounds));

			const response = await fetch(url, {
				headers: { accept: 'application/json' }
			});
			const rawResponse = await response.text();
			if (!response.ok) {
				if (response.status === 429) {
					throw new Error('Airplanes.live rate limit reached. Try again in a moment.');
				}
				if (response.status >= 500) {
					throw new Error('Airplanes.live is temporarily unavailable. Try again shortly.');
				}

				throw new Error(`Airplanes.live responded with ${response.status}.`);
			}
			let payload: unknown;
			try {
				payload = JSON.parse(rawResponse);
			} catch {
				throw new Error(
					/rate limit/i.test(rawResponse)
						? 'Airplanes.live rate limit reached. Try again in a moment.'
						: 'Airplanes.live returned an unreadable response.'
				);
			}
			if (
				payload &&
				typeof payload === 'object' &&
				typeof (payload as { msg?: unknown }).msg === 'string' &&
				(payload as { msg: string }).msg !== 'No error'
			) {
				throw new Error(`Airplanes.live: ${(payload as { msg: string }).msg}`);
			}

			const aircraft = parseAircraftFeedStates(payload);
			const sampledAt = resolveAircraftFeedSampledAt(payload, now);
			aircraftTracks = buildAircraftTracks(
				aircraftTracks,
				aircraft,
				now,
				sampledAt,
				AIRCRAFT_BLEND_DURATION_MS
			);
			aircraftCount = aircraft.length;
			aircraftFeedEmpty = aircraft.length === 0;
			aircraftFeedStale = false;
			clearAircraftFeedIssue();
			aircraftFetchedAt = now;
			lastAircraftBoundsKey = boundsKey;
			startAircraftAnimation();
			redrawCurrentView();
		} catch (error) {
			const hadTrackedAircraft = aircraftTracks.size > 0;
			aircraftFeedEmpty = false;
			if (
				error instanceof TypeError &&
				/(networkerror|failed to fetch|load failed)/i.test(error.message)
			) {
				setAircraftFeedIssue('network', 'Airplanes.live feed is unreachable from the browser.');
			} else {
				const message =
					error instanceof Error ? error.message : 'Unable to refresh the aircraft feed.';

				if (/rate limit/i.test(message)) {
					setAircraftFeedIssue('rate_limit', message);
				} else if (/temporarily unavailable|responded with 5/i.test(message)) {
					setAircraftFeedIssue('provider_unavailable', message);
				} else if (/unreadable response/i.test(message)) {
					setAircraftFeedIssue('bad_response', message);
				} else if (/responded with \d+/i.test(message)) {
					setAircraftFeedIssue('provider_error', message);
				} else {
					setAircraftFeedIssue('unknown', message);
				}
			}
			aircraftFeedStale = hadTrackedAircraft;
		} finally {
			aircraftLoading = false;
			scheduleAircraftPolling(AIRCRAFT_POLL_INTERVAL_MS);
		}
	}

	function fetchAircraftHere(): void {
		void refreshAircraft(true);
	}

	function friendlyMapError(message: string): string {
		if (message.includes('Failed to initialize WebGL')) {
			return 'WebGL is unavailable in this browser session, so the live MapLibre layer cannot start here. Open the prototype in a normal desktop browser to see the ASCII map render.';
		}

		return message;
	}

	function stampAircraftIntoFrame(baseFrame: AsciiFrame): AsciiFrame {
		if (!showAircraft || !map || aircraftTracks.size === 0) {
			aircraftVisibleCount = 0;
			aircraftGlyphs = [];
			return baseFrame;
		}

		const displayedAircraft = resolveDisplayedAircraft(aircraftTracks.values(), Date.now());
		if (displayedAircraft.length === 0) {
			aircraftVisibleCount = 0;
			aircraftGlyphs = [];
			return baseFrame;
		}

		const markers = displayedAircraft.map((aircraft) => {
			const point = map!.project([aircraft.displayLongitude, aircraft.displayLatitude]);
			return {
				heading: aircraft.heading,
				x: point.x,
				y: point.y,
				onGround: aircraft.onGround
			};
		});
		const stamped = stampAircraftGlyphs(baseFrame, markers, {
			char: aircraftMarkerGlyph,
			fontFamily: glyphFontFamily,
			zoom: map.getZoom()
		});
		aircraftVisibleCount = stamped.visibleCount;
		aircraftGlyphs = stamped.glyphs;
		return stamped.frame;
	}

	function resolveGlyphFontSize(
		context: CanvasRenderingContext2D,
		cellWidth: number,
		cellHeight: number
	): number {
		const cacheKey = `${Math.round(cellWidth * 100)}:${Math.round(cellHeight * 100)}`;
		const cached = glyphFontSizeCache[cacheKey];
		if (typeof cached === 'number') {
			return cached;
		}

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
			glyphFontSizeCache[cacheKey] = targetHeight;
			return targetHeight;
		}

		const resolved = Math.max(8, targetHeight * (maxAllowedWidth / widestGlyph));
		glyphFontSizeCache[cacheKey] = resolved;
		return resolved;
	}

	function ensureCanvasContext(
		targetCanvas: HTMLCanvasElement,
		viewportWidth: number,
		viewportHeight: number,
		syncCss: boolean
	): { context: CanvasRenderingContext2D; pixelRatio: number } | null {
		const context = targetCanvas.getContext('2d');
		if (!context) {
			return null;
		}

		const pixelRatio = window.devicePixelRatio || 1;
		const targetWidth = Math.max(1, Math.round(viewportWidth * pixelRatio));
		const targetHeight = Math.max(1, Math.round(viewportHeight * pixelRatio));

		if (syncCss) {
			const cssWidth = `${viewportWidth}px`;
			const cssHeight = `${viewportHeight}px`;
			if (targetCanvas.style.width !== cssWidth) {
				targetCanvas.style.width = cssWidth;
			}
			if (targetCanvas.style.height !== cssHeight) {
				targetCanvas.style.height = cssHeight;
			}
		}

		if (targetCanvas.width !== targetWidth || targetCanvas.height !== targetHeight) {
			targetCanvas.width = targetWidth;
			targetCanvas.height = targetHeight;
		}

		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		return { context, pixelRatio };
	}

	function getBaseFrameCanvas(): HTMLCanvasElement | null {
		if (baseFrameCanvas) {
			return baseFrameCanvas;
		}
		if (typeof document === 'undefined') {
			return null;
		}

		baseFrameCanvas = document.createElement('canvas');
		return baseFrameCanvas;
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

	function collectVisibleFeatures(
		activeMap: MapLibreMap,
		viewportWidth: number,
		viewportHeight: number
	): FeatureGroups {
		const queryPlan = currentQueryPlan();
		const center = activeMap.getCenter();
		const cacheKey = [
			visibleFeatureVersion,
			queryPlan.key,
			viewportWidth,
			viewportHeight,
			activeMap.getZoom(),
			activeMap.getBearing(),
			activeMap.getPitch(),
			center.lng,
			center.lat,
			activeMap.getStyle()?.layers?.length ?? 0
		].join('|');
		if (visibleFeatureCache?.key === cacheKey) {
			featureCounts = visibleFeatureCache.featureCounts;
			return visibleFeatureCache.groups;
		}

		const groups: FeatureGroups = {};
		const rawGroups: Record<LayerToggleKey, MapGeoJSONFeature[]> = {
			roads: [],
			bridges: [],
			buildings: [],
			water: [],
			greens: [],
			rails: [],
			tunnels: [],
			cities: [],
			landmarks: []
		};
		const nextFeatureCounts: Record<LayerToggleKey, number> = {
			roads: 0,
			bridges: 0,
			buildings: 0,
			water: 0,
			greens: 0,
			rails: 0,
			tunnels: 0,
			cities: 0,
			landmarks: 0
		};
		if (queryPlan.activeLayerIds.length === 0) {
			featureCounts = nextFeatureCounts;
			visibleFeatureCache = {
				key: cacheKey,
				featureCounts: nextFeatureCounts,
				groups
			};
			return groups;
		}

		const queried = activeMap.queryRenderedFeatures({
			layers: queryPlan.activeLayerIds
		});

		for (const feature of queried) {
			const bucket = queryPlan.layerIdToBucket[feature.layer.id];
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
			} else if (layerKey === 'greens') {
				groups.greens = projected;
			} else if (layerKey === 'rails') {
				groups.rails = projected;
			} else if (layerKey === 'tunnels') {
				groups.tunnels = projected;
			} else if (layerKey === 'cities') {
				groups.cities = projected;
			} else if (layerKey === 'landmarks') {
				groups.landmarks = projected;
			} else {
				groups[layerKey] = projected;
			}
			nextFeatureCounts[layerKey] = projected.length;
		}

		featureCounts = nextFeatureCounts;
		visibleFeatureCache = {
			key: cacheKey,
			featureCounts: nextFeatureCounts,
			groups
		};
		return groups;
	}

	function drawFrame(nextFrame: AsciiFrame): void {
		drawFrameToCanvas(canvas, nextFrame, true);
	}

	function drawFrameToCanvas(
		targetCanvas: HTMLCanvasElement,
		nextFrame: AsciiFrame,
		syncCss: boolean
	): boolean {
		if (!stage) {
			return false;
		}

		const viewportWidth = stage.clientWidth;
		const viewportHeight = stage.clientHeight;
		if (viewportWidth === 0 || viewportHeight === 0) {
			return false;
		}

		const prepared = ensureCanvasContext(targetCanvas, viewportWidth, viewportHeight, syncCss);
		if (!prepared) {
			return false;
		}

		const { context } = prepared;
		context.clearRect(0, 0, viewportWidth, viewportHeight);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const defaultFont = `600 ${resolveGlyphFontSize(context, nextFrame.cellWidth, nextFrame.cellHeight)}px ${glyphFontFamily}`;
		context.font = defaultFont;
		context.globalAlpha = 1;
		let currentFont = defaultFont;
		let currentOpacity = 1;
		let cellIndex = 0;
		const rotatedGlyphs: Array<{
			entity: keyof typeof entityColors;
			font: string;
			glyph: string;
			opacity: number;
			rotation: number;
			x: number;
			y: number;
		}> = [];

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

				const x = column * nextFrame.cellWidth + nextFrame.cellWidth / 2;
				const rotation = cell?.rotation ?? 0;
				if (rotation !== 0) {
					rotatedGlyphs.push({
						entity,
						font,
						glyph,
						opacity,
						rotation,
						x,
						y
					});
					continue;
				}

				context.fillStyle = entityColors[entity];
				context.fillText(glyph, x, y);
			}
		}

		for (const glyph of rotatedGlyphs) {
			context.save();
			context.font = glyph.font;
			context.globalAlpha = glyph.opacity;
			context.fillStyle = entityColors[glyph.entity];
			context.translate(glyph.x, glyph.y);
			context.rotate((glyph.rotation * Math.PI) / 180);
			context.fillText(glyph.glyph, 0, 0);
			context.restore();
		}

		if (currentOpacity !== 1) {
			context.globalAlpha = 1;
		}

		return true;
	}

	function renderBaseFrame(nextFrame: AsciiFrame): boolean {
		const targetCanvas = getBaseFrameCanvas();
		if (!targetCanvas) {
			return false;
		}

		return drawFrameToCanvas(targetCanvas, nextFrame, false);
	}

	function blitBaseFrame(): boolean {
		if (!stage || !baseFrameCanvas) {
			return false;
		}

		const viewportWidth = stage.clientWidth;
		const viewportHeight = stage.clientHeight;
		const prepared = ensureCanvasContext(canvas, viewportWidth, viewportHeight, true);
		if (!prepared) {
			return false;
		}

		const { context } = prepared;
		if (baseFrameCanvas.width !== canvas.width || baseFrameCanvas.height !== canvas.height) {
			return false;
		}

		context.clearRect(0, 0, viewportWidth, viewportHeight);
		context.drawImage(
			baseFrameCanvas,
			0,
			0,
			baseFrameCanvas.width,
			baseFrameCanvas.height,
			0,
			0,
			viewportWidth,
			viewportHeight
		);
		return true;
	}

	function drawAircraftGlyphs(): void {
		if (!canvas || aircraftGlyphs.length === 0) {
			return;
		}

		const context = canvas.getContext('2d');
		if (!context) {
			return;
		}

		const pixelRatio = window.devicePixelRatio || 1;
		context.save();
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		for (const glyph of aircraftGlyphs) {
			context.save();
			context.translate(glyph.x, glyph.y);
			context.rotate((glyph.rotation * Math.PI) / 180);
			context.globalCompositeOperation = 'destination-out';
			const wakeRadius = Math.max(glyph.clearWidth, glyph.clearHeight) * 0.52;
			const wakeGradient = context.createRadialGradient(
				0,
				0,
				Math.max(1.5, wakeRadius * 0.1),
				0,
				0,
				wakeRadius
			);
			wakeGradient.addColorStop(0, 'rgba(0, 0, 0, 0.68)');
			wakeGradient.addColorStop(0.58, 'rgba(0, 0, 0, 0.24)');
			wakeGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
			context.fillStyle = wakeGradient;
			context.beginPath();
			context.ellipse(0, 0, glyph.clearWidth / 2, glyph.clearHeight / 2, 0, 0, Math.PI * 2);
			context.fill();

			context.lineJoin = 'round';
			context.lineCap = 'round';
			context.fillStyle = entityColors.points;
			for (const segment of glyph.segments) {
				context.font = segment.font;
				context.lineWidth = Math.max(1.6, glyph.clearHeight * 0.1);
				context.strokeStyle = 'rgba(0, 0, 0, 1)';
				context.globalAlpha = 0.92;
				context.strokeText(segment.char, segment.dx, segment.dy);
				context.fillText(segment.char, segment.dx, segment.dy);
			}

			context.globalCompositeOperation = 'source-over';
			context.fillStyle = entityColors.points;
			for (const segment of glyph.segments) {
				context.font = segment.font;
				context.globalAlpha = glyph.opacity * segment.opacity;
				context.fillText(segment.char, segment.dx, segment.dy);
			}
			context.restore();
		}

		context.restore();
	}

	function renderFrame(): void {
		if (!map || !stage || !canvas || !map.isStyleLoaded()) {
			return;
		}

		const renderQuality = currentQualityMode();
		const mapZoom = map.getZoom();

		const viewportWidth = stage.clientWidth;
		const viewportHeight = stage.clientHeight;

		if (viewportWidth === 0 || viewportHeight === 0) {
			return;
		}

		const layers = collectVisibleFeatures(map, viewportWidth, viewportHeight);
		let nextFrame = rasterRenderer.render({
			viewport: { width: viewportWidth, height: viewportHeight },
			quality: renderQuality,
			layers: {
				roads: layers.roads,
				bridges: layers.bridges,
				buildings: layers.buildings,
				water: layers.water,
				greens: layers.greens,
				rails: layers.rails,
				tunnels: layers.tunnels,
				points: layers.points
			},
			config: {
				grid: GRID_PRESETS[qualityPreference],
				detail: {
					water: waterDetail
				},
				view: {
					zoom: mapZoom
				}
			}
		});

		nextFrame = applyProportionalTypography(nextFrame, {
			waterDetail
		});
		cityLabelCommands = cityLabelsVisibleAtZoom(mapZoom)
			? resolveCityCommands(layers.cities ?? emptyFeatures, viewportWidth, viewportHeight)
			: [];
		landmarkLabelCommands =
			layerState.landmarks && mapZoom >= LANDMARK_LABEL_MIN_ZOOM
				? resolveLandmarkCommands(
						layers.landmarks ?? emptyFeatures,
						viewportWidth,
						viewportHeight,
						mapZoom
					)
				: [];
		frame = nextFrame;
		renderBaseFrame(nextFrame);
		redrawCurrentView();

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
					invalidateVisibleFeatureCache();
					window.requestAnimationFrame(() => map?.resize());
					queueRender();
					if (showAircraft) {
						void refreshAircraft(true);
					}
				});

				map.on('movestart', queueRender);
				map.on('move', queueRender);
				map.on('zoom', queueRender);
				map.on('moveend', () => {
					queueRender();
					if (!showAircraft) {
						return;
					}

					const bounds = currentAircraftBounds();
					if (!bounds) {
						return;
					}

					const nextBoundsKey = aircraftBoundsKey(bounds);
					if (nextBoundsKey !== lastAircraftBoundsKey) {
						void refreshAircraft(false);
					}
				});
				map.on('idle', queueRender);
				map.on('sourcedata', invalidateVisibleFeatureCache);
				map.on('styledata', invalidateVisibleFeatureCache);
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
				aircraftUiTimer = window.setInterval(() => {
					aircraftUiNow = Date.now();
				}, 250);
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
			stopAircraftPolling();
			stopAircraftAnimation();
			if (aircraftUiTimer !== undefined) {
				window.clearInterval(aircraftUiTimer);
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
			<div class="label-overlay">
				{#each cityLabelCommands as label (label.key)}
					<span
						class="map-label city-label"
						style={`left:${label.x}px;top:${label.y}px;font:${label.font};opacity:${label.opacity};`}
					>
						{label.name}
					</span>
				{/each}
				{#each landmarkLabelCommands as label (label.key)}
					<span
						class="map-label landmark-label"
						style={`left:${label.x}px;top:${label.y}px;font:${label.font};opacity:${label.opacity};`}
					>
						{label.name}
					</span>
				{/each}
			</div>

			{#if !isLoaded && !errorMessage}
				<div class="status-card">Loading vector tiles and warming the ASCII overlay…</div>
			{/if}

			{#if errorMessage}
				<div class="status-card error">{errorMessage}</div>
			{/if}
		</div>
	</div>

	<aside class="control-panel">
		<header class="title-block">
			<pre class="title-art" aria-label="ASCII MAP">
█████╗  ███████╗ ██████╗██╗██╗    ███╗   ███╗ █████╗ ██████╗ 
██╔══██╗██╔════╝██╔════╝██║██║    ████╗ ████║██╔══██╗██╔══██╗
███████║███████╗██║     ██║██║    ██╔████╔██║███████║██████╔╝
██╔══██║╚════██║██║     ██║██║    ██║╚██╔╝██║██╔══██║██╔═══╝ 
██║  ██║███████║╚██████╗██║██║    ██║ ╚═╝ ██║██║  ██║██║     
╚═╝  ╚═╝╚══════╝ ╚═════╝╚═╝╚═╝    ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝</pre>

			<div class="social-row" aria-label="Creator badges">
				<a
					class="social-badge"
					href="https://github.com/Lionel-Lim/"
					target="_blank"
					rel="noreferrer"
					aria-label="DY Lim on GitHub"
					title="GitHub"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M12 2C6.48 2 2 6.59 2 12.26c0 4.54 2.87 8.39 6.84 9.75.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.22-3.37-1.22-.46-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.72 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.7.12 2.49.36 1.9-1.32 2.74-1.05 2.74-1.05.56 1.41.21 2.46.11 2.72.64.72 1.03 1.63 1.03 2.75 0 3.95-2.34 4.81-4.57 5.07.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.27 10.27 0 0 0 22 12.26C22 6.59 17.52 2 12 2Z"
						/>
					</svg>
				</a>
				<a
					class="social-badge linkedin-badge"
					href="https://www.linkedin.com/in/dylim/"
					target="_blank"
					rel="noreferrer"
					aria-label="DY Lim on LinkedIn"
					title="LinkedIn"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path
							d="M6.94 8.5A1.56 1.56 0 1 1 6.94 5.4a1.56 1.56 0 0 1 0 3.1ZM5.62 18.6h2.64V9.93H5.62V18.6Zm4.3 0h2.63v-4.82c0-1.28.24-2.52 1.78-2.52 1.52 0 1.54 1.47 1.54 2.6v4.74h2.64v-5.3c0-2.6-.56-4.6-3.55-4.6-1.44 0-2.41.81-2.8 1.58h-.04V9.93H9.93c.03.77 0 8.67 0 8.67Z"
						/>
					</svg>
				</a>
			</div>
		</header>

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
			<h2>Layers</h2>
			<div class="toggle-grid">
				{#each layerKeys as layerKey (layerKey)}
					<label class="toggle-row">
						<span class="layer-copy">
							<span class="layer-label">{LAYER_LABELS[layerKey]}</span>
							<span class="layer-glyph" style={`--layer-color:${layerGlyphs[layerKey].color};`}>
								{layerGlyphs[layerKey].glyph}
							</span>
						</span>
						<input
							type="checkbox"
							checked={layerState[layerKey]}
							onchange={(event) =>
								updateLayer(layerKey, (event.currentTarget as HTMLInputElement).checked)}
						/>
					</label>
				{/each}
				<label class="toggle-row">
					<span class="layer-copy">
						<span class="layer-label">Aircraft</span>
						<span class="layer-glyph" style={`--layer-color:${layerGlyphs.aircraft.color};`}>
							{layerGlyphs.aircraft.glyph}
						</span>
					</span>
					<input
						type="checkbox"
						checked={showAircraft}
						onchange={(event) =>
							updateAircraftVisibility((event.currentTarget as HTMLInputElement).checked)}
					/>
				</label>
			</div>
			<div class="action-group">
				<button
					type="button"
					class="action-button"
					disabled={aircraftFetchDisabled()}
					onclick={fetchAircraftHere}
				>
					{aircraftActionLabel()}
				</button>
				<p
					class="action-hint"
					class:success={aircraftActionHintTone() === 'success'}
					class:warning={aircraftActionHintTone() === 'warning'}
					class:error={aircraftActionHintTone() === 'error'}
					aria-live="polite"
				>
					{aircraftActionHint()}
				</p>
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
					<dd>R/r · X/x · B/b · W/w · G/g · R/r · U/u · aAa + labels</dd>
				</div>
				<div>
					<dt>Road detail</dt>
					<dd>{describeRoadDetail(roadDetail)}</dd>
				</div>
				<div>
					<dt>Effective roads</dt>
					<dd>{describeRoadDetail(currentEffectiveRoadDetail())}</dd>
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
							featureCounts.greens +
							featureCounts.rails +
							featureCounts.tunnels +
							featureCounts.cities +
							featureCounts.landmarks}
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
					<dt>Greens</dt>
					<dd>{featureCounts.greens}</dd>
				</div>
				<div>
					<dt>Rail</dt>
					<dd>{featureCounts.rails}</dd>
				</div>
				<div>
					<dt>Tunnels</dt>
					<dd>{featureCounts.tunnels}</dd>
				</div>
				<div>
					<dt>Cities</dt>
					<dd>{featureCounts.cities}</dd>
				</div>
				<div>
					<dt>Landmarks</dt>
					<dd>{featureCounts.landmarks}</dd>
				</div>
				<div>
					<dt>Aircraft</dt>
					<dd>
						{showAircraft ? `${aircraftVisibleCount} visible / ${aircraftCount} tracked` : 'off'}
					</dd>
				</div>
				<div>
					<dt>Aircraft feed</dt>
					<dd>{aircraftFeedStatus()}</dd>
				</div>
				<div>
					<dt>Basemap</dt>
					<dd>{showBackgroundMap ? 'Visible' : 'Hidden'}</dd>
				</div>
			</dl>
		</section>

		<p class="footnote">
			Map data © OpenStreetMap contributors, served via OpenFreeMap / OpenMapTiles (Liberty style,
			including Natural Earth shaded relief). Aircraft data © Airplanes.live. Built with SvelteKit,
			Svelte, Vite, MapLibre GL JS, Pretext, and IBM Plex Mono (@fontsource).
		</p>
		<p class="byline">by {authorName}</p>
	</aside>
</section>

<style>
	.prototype-shell {
		height: 100vh;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
		gap: 1rem;
		padding: 1rem;
		overflow: hidden;
		align-items: start;
	}

	.stage-wrap {
		min-width: 0;
		position: sticky;
		top: 1rem;
		height: calc(100vh - 2rem);
	}

	.map-stage {
		position: relative;
		height: 100%;
		overflow: hidden;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 1.5rem;
		background:
			radial-gradient(circle at 20% 20%, rgba(117, 215, 255, 0.14), transparent 28%),
			linear-gradient(160deg, rgba(6, 17, 23, 0.98), rgba(4, 8, 11, 0.96));
		box-shadow:
			0 24px 60px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.02);
	}

	.map-host,
	.ascii-canvas,
	.scanlines,
	.label-overlay {
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

	.label-overlay {
		pointer-events: none;
		overflow: hidden;
	}

	.map-label {
		position: absolute;
		transform: translate(-50%, -50%);
		white-space: nowrap;
		font-kerning: normal;
		font-variant-ligatures: common-ligatures;
		text-rendering: geometricPrecision;
	}

	.city-label {
		color: #c7d7ff;
		text-shadow:
			0 1px 0 rgba(4, 8, 11, 0.98),
			0 -1px 0 rgba(4, 8, 11, 0.98),
			1px 0 0 rgba(4, 8, 11, 0.98),
			-1px 0 0 rgba(4, 8, 11, 0.98),
			0 0 18px rgba(4, 8, 11, 0.4);
	}

	.landmark-label {
		color: #90f3d5;
		text-shadow:
			0 1px 0 rgba(4, 8, 11, 0.98),
			0 -1px 0 rgba(4, 8, 11, 0.98),
			1px 0 0 rgba(4, 8, 11, 0.98),
			-1px 0 0 rgba(4, 8, 11, 0.98),
			0 0 14px rgba(144, 243, 213, 0.24);
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
		height: calc(100vh - 2rem);
		padding: 1.2rem 1.1rem;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 1.5rem;
		background: rgba(7, 16, 20, 0.88);
		box-shadow: 0 20px 48px rgba(0, 0, 0, 0.24);
		backdrop-filter: blur(18px);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.panel-section h2,
	.footnote,
	dt {
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #9db5b4;
	}

	.title-block {
		display: grid;
		gap: 0.75rem;
	}

	.title-art {
		margin: 0;
		padding: 0.2rem 0 0.1rem;
		overflow-x: auto;
		color: #edf7f2;
		font-family: 'IBM Plex Mono', 'Courier New', monospace;
		font-size: clamp(0.36rem, 0.78vw, 0.56rem);
		font-weight: 600;
		line-height: 1.06;
		letter-spacing: -0.02em;
		text-shadow:
			0 0 18px rgba(117, 215, 255, 0.08),
			0 0 28px rgba(144, 243, 213, 0.06);
		scrollbar-width: none;
	}

	.title-art::-webkit-scrollbar {
		display: none;
	}

	.byline {
		margin: 0;
		font-size: 0.92rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: rgba(237, 247, 242, 0.72);
	}

	.social-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.social-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 999px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
			rgba(7, 16, 20, 0.92);
		color: #edf7f2;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 8px 18px rgba(0, 0, 0, 0.18);
	}

	.linkedin-badge {
		color: #9fd4ff;
	}

	.social-badge svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
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

	.layer-copy {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		min-width: 0;
	}

	.layer-label {
		font-size: 0.9rem;
		color: #edf7f2;
	}

	.layer-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.18rem 0.48rem;
		border: 1px solid color-mix(in srgb, var(--layer-color) 26%, rgba(255, 255, 255, 0.08));
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--layer-color);
		font-family: 'IBM Plex Mono', 'Courier New', monospace;
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		line-height: 1;
		white-space: nowrap;
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
		grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.28fr) minmax(0, 0.92fr);
		gap: 0.4rem;
	}

	.range-card {
		display: grid;
		gap: 0.7rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid rgba(144, 243, 213, 0.12);
		border-radius: 1.1rem;
		background: rgba(255, 255, 255, 0.03);
	}

	.action-group {
		display: grid;
		gap: 0.65rem;
		margin-top: 0.75rem;
	}

	.action-button {
		padding: 0.78rem 0.9rem;
		border: 1px solid rgba(144, 243, 213, 0.18);
		border-radius: 999px;
		background: rgba(144, 243, 213, 0.08);
		color: #edf7f2;
		font: inherit;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			background 120ms ease,
			opacity 120ms ease;
	}

	.action-button:hover,
	.action-button:focus-visible {
		transform: translateY(-1px);
		border-color: rgba(144, 243, 213, 0.34);
		background: rgba(144, 243, 213, 0.14);
		outline: none;
	}

	.action-button:disabled {
		opacity: 0.6;
		transform: none;
		cursor: not-allowed;
	}

	.action-hint {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: rgba(237, 247, 242, 0.62);
	}

	.action-hint.success {
		color: rgba(155, 226, 121, 0.88);
	}

	.action-hint.warning {
		color: rgba(255, 213, 150, 0.88);
	}

	.action-hint.error {
		color: rgba(255, 196, 169, 0.92);
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
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		padding: 0.72rem 0.5rem;
		border: 1px solid rgba(144, 243, 213, 0.12);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.03);
		font-size: 0.88rem;
		line-height: 1.1;
		text-align: center;
		white-space: nowrap;
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
			height: auto;
			grid-template-columns: 1fr;
			overflow: visible;
		}

		.stage-wrap {
			position: relative;
			top: 0;
			height: auto;
		}

		.map-stage {
			min-height: 62vh;
			height: 62vh;
		}

		.control-panel {
			height: auto;
			overflow: visible;
		}
	}
</style>
