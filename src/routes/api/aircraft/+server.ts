import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	type AircraftBounds,
	type AircraftFeedResponse,
	OPENSKY_POLL_INTERVAL_MS,
	aircraftBoundsKey,
	clampOpenSkyBounds,
	parseOpenSkyStates
} from '$lib/aircraft/opensky';

const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const cache = new Map<string, { expiresAt: number; payload: AircraftFeedResponse }>();

function parseBounds(url: URL): AircraftBounds | null {
	const lamin = Number.parseFloat(url.searchParams.get('lamin') ?? '');
	const lomin = Number.parseFloat(url.searchParams.get('lomin') ?? '');
	const lamax = Number.parseFloat(url.searchParams.get('lamax') ?? '');
	const lomax = Number.parseFloat(url.searchParams.get('lomax') ?? '');

	if ([lamin, lomin, lamax, lomax].some((value) => Number.isNaN(value))) {
		return null;
	}

	return clampOpenSkyBounds({ lamin, lomin, lamax, lomax });
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const bounds = parseBounds(url);
	if (!bounds) {
		return json({ error: 'Invalid bounding box.' }, { status: 400 });
	}

	const cacheKey = aircraftBoundsKey(bounds);
	const now = Date.now();
	const cached = cache.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return json({ ...cached.payload, cached: true });
	}

	const upstreamUrl = new URL(OPENSKY_STATES_URL);
	upstreamUrl.searchParams.set('lamin', `${bounds.lamin}`);
	upstreamUrl.searchParams.set('lomin', `${bounds.lomin}`);
	upstreamUrl.searchParams.set('lamax', `${bounds.lamax}`);
	upstreamUrl.searchParams.set('lomax', `${bounds.lomax}`);

	try {
		const response = await fetch(upstreamUrl, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(10_000)
		});

		if (!response.ok) {
			throw new Error(`OpenSky responded with ${response.status}`);
		}

		const payload = await response.json();
		const result: AircraftFeedResponse = {
			aircraft: parseOpenSkyStates(payload),
			cached: false,
			fetchedAt: now,
			sourceTime:
				payload && typeof payload === 'object' && typeof payload.time === 'number'
					? payload.time
					: null,
			stale: false
		};

		cache.set(cacheKey, {
			expiresAt: now + OPENSKY_POLL_INTERVAL_MS,
			payload: result
		});

		return json(result);
	} catch (error) {
		if (cached) {
			return json({ ...cached.payload, cached: true, stale: true });
		}

		return json(
			{
				aircraft: [],
				cached: false,
				fetchedAt: now,
				sourceTime: null,
				stale: false,
				error: error instanceof Error ? error.message : 'Unable to load aircraft.'
			},
			{ status: 502 }
		);
	}
};
