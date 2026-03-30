import type {
	Feature,
	Geometry,
	LinearRing,
	Point2D,
	Polygon,
	QualityMode,
	ViewportSize
} from './types';

export interface GridSize {
	columns: number;
	rows: number;
}

export interface CellRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	centerX: number;
	centerY: number;
}

export interface GridContext {
	size: GridSize;
	cellWidth: number;
	cellHeight: number;
}

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface CellRange {
	startColumn: number;
	endColumn: number;
	startRow: number;
	endRow: number;
}

export function resolveGridSize(
	viewport: ViewportSize,
	quality: QualityMode,
	grid: { moving: { columns: number }; settled: { columns: number } }
): GridSize {
	const columns = Math.max(1, Math.round(grid[quality].columns));
	const safeWidth = Math.max(1, viewport.width);
	const safeHeight = Math.max(1, viewport.height);
	const rows = Math.max(1, Math.round(columns * (safeHeight / safeWidth)));

	return { columns, rows };
}

export function createGridContext(viewport: ViewportSize, size: GridSize): GridContext {
	return {
		size,
		cellWidth: viewport.width / size.columns,
		cellHeight: viewport.height / size.rows
	};
}

export function buildCellRect(context: GridContext, column: number, row: number): CellRect {
	const x0 = column * context.cellWidth;
	const y0 = row * context.cellHeight;

	return {
		x0,
		y0,
		x1: x0 + context.cellWidth,
		y1: y0 + context.cellHeight,
		centerX: x0 + context.cellWidth / 2,
		centerY: y0 + context.cellHeight / 2
	};
}

export function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function pointToCellIndex(
	point: Point2D,
	context: GridContext
): { column: number; row: number } | null {
	if (point[0] < 0 || point[1] < 0) {
		return null;
	}

	const viewportWidth = context.size.columns * context.cellWidth;
	const viewportHeight = context.size.rows * context.cellHeight;

	if (point[0] >= viewportWidth || point[1] >= viewportHeight) {
		return null;
	}

	const column = Math.floor(point[0] / context.cellWidth);
	const row = Math.floor(point[1] / context.cellHeight);

	return { column, row };
}

export function makeBounds(): Bounds {
	return {
		minX: Number.POSITIVE_INFINITY,
		minY: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxY: Number.NEGATIVE_INFINITY
	};
}

export function expandBounds(bounds: Bounds, point: Point2D): Bounds {
	if (point[0] < bounds.minX) {
		bounds.minX = point[0];
	}
	if (point[1] < bounds.minY) {
		bounds.minY = point[1];
	}
	if (point[0] > bounds.maxX) {
		bounds.maxX = point[0];
	}
	if (point[1] > bounds.maxY) {
		bounds.maxY = point[1];
	}

	return bounds;
}

export function isBoundsValid(bounds: Bounds): boolean {
	return (
		bounds.minX !== Number.POSITIVE_INFINITY &&
		bounds.minY !== Number.POSITIVE_INFINITY &&
		bounds.maxX !== Number.NEGATIVE_INFINITY &&
		bounds.maxY !== Number.NEGATIVE_INFINITY
	);
}

export function intersectBounds(a: Bounds, b: Bounds): boolean {
	return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function viewportBounds(context: GridContext): Bounds {
	return {
		minX: 0,
		minY: 0,
		maxX: context.size.columns * context.cellWidth,
		maxY: context.size.rows * context.cellHeight
	};
}

export function cellRangeForBounds(bounds: Bounds, context: GridContext): CellRange | null {
	const visible = viewportBounds(context);
	if (!intersectBounds(bounds, visible)) {
		return null;
	}

	const startColumn = Math.max(0, Math.floor(bounds.minX / context.cellWidth));
	const endColumnEdgeAligned =
		bounds.maxX === bounds.minX ? Math.floor(bounds.maxX / context.cellWidth) : undefined;
	const endColumn = Math.min(
		context.size.columns - 1,
		endColumnEdgeAligned ?? Math.ceil(bounds.maxX / context.cellWidth) - 1
	);
	const startRow = Math.max(0, Math.floor(bounds.minY / context.cellHeight));
	const endRowEdgeAligned =
		bounds.maxY === bounds.minY ? Math.floor(bounds.maxY / context.cellHeight) : undefined;
	const endRow = Math.min(context.size.rows - 1, Math.ceil(bounds.maxY / context.cellHeight) - 1);
	const resolvedEndRow = endRowEdgeAligned ?? endRow;

	if (endColumn < startColumn || resolvedEndRow < startRow) {
		return null;
	}

	return {
		startColumn,
		endColumn,
		startRow,
		endRow: resolvedEndRow
	};
}

export function forEachGeometryPart(geometry: Geometry, visit: (part: Geometry) => void): void {
	switch (geometry.type) {
		case 'Point':
		case 'LineString':
		case 'Polygon':
			visit(geometry);
			return;
		case 'MultiPoint':
			for (const coordinates of geometry.coordinates) {
				visit({ type: 'Point', coordinates });
			}
			return;
		case 'MultiLineString':
			for (const coordinates of geometry.coordinates) {
				visit({ type: 'LineString', coordinates });
			}
			return;
		case 'MultiPolygon':
			for (const coordinates of geometry.coordinates) {
				visit({ type: 'Polygon', coordinates });
			}
			return;
	}
}

export function pointInRing(point: Point2D, ring: LinearRing): boolean {
	let inside = false;
	const [x, y] = point;

	for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
		const current = ring[index];
		const previousPoint = ring[previous];
		const xi = current?.[0] ?? 0;
		const yi = current?.[1] ?? 0;
		const xj = previousPoint?.[0] ?? 0;
		const yj = previousPoint?.[1] ?? 0;
		const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.000001) + xi;
		if (intersects) {
			inside = !inside;
		}
	}

	return inside;
}

export function pointInPolygon(point: Point2D, polygon: Polygon): boolean {
	if (polygon.length === 0) {
		return false;
	}

	if (!pointInRing(point, polygon[0] ?? [])) {
		return false;
	}

	for (let ringIndex = 1; ringIndex < polygon.length; ringIndex += 1) {
		if (pointInRing(point, polygon[ringIndex] ?? [])) {
			return false;
		}
	}

	return true;
}

export function polygonCoverageForCell(rect: CellRect, polygon: Polygon): number {
	return polygonCoverageForCellBounds(rect.x0, rect.y0, rect.x1, rect.y1, polygon);
}

export function polygonCoverageForCellBounds(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	polygon: Polygon
): number {
	let hits = 0;
	const sampleCount = 5;
	const centerX = x0 + (x1 - x0) / 2;
	const centerY = y0 + (y1 - y0) / 2;

	if (pointInPolygon([centerX, centerY], polygon)) {
		hits += 1;
	}
	if (pointInPolygon([x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.25], polygon)) {
		hits += 1;
	}
	if (pointInPolygon([x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.25], polygon)) {
		hits += 1;
	}
	if (pointInPolygon([x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.75], polygon)) {
		hits += 1;
	}
	if (pointInPolygon([x0 + (x1 - x0) * 0.75, y0 + (y1 - y0) * 0.75], polygon)) {
		hits += 1;
	}

	return clamp01(hits / sampleCount);
}

export function polygonBounds(polygon: Polygon): Bounds | null {
	const bounds = makeBounds();

	for (const ring of polygon) {
		for (const point of ring) {
			expandBounds(bounds, point);
		}
	}

	return isBoundsValid(bounds) ? bounds : null;
}

export function lineBounds(start: Point2D, end: Point2D): Bounds {
	return {
		minX: Math.min(start[0], end[0]),
		minY: Math.min(start[1], end[1]),
		maxX: Math.max(start[0], end[0]),
		maxY: Math.max(start[1], end[1])
	};
}

export function geometryBounds(geometry: Geometry): Bounds | null {
	switch (geometry.type) {
		case 'Point':
			return {
				minX: geometry.coordinates[0],
				minY: geometry.coordinates[1],
				maxX: geometry.coordinates[0],
				maxY: geometry.coordinates[1]
			};
		case 'MultiPoint': {
			const bounds = makeBounds();
			for (const point of geometry.coordinates) {
				expandBounds(bounds, point);
			}
			return isBoundsValid(bounds) ? bounds : null;
		}
		case 'LineString': {
			const bounds = makeBounds();
			for (const point of geometry.coordinates) {
				expandBounds(bounds, point);
			}
			return isBoundsValid(bounds) ? bounds : null;
		}
		case 'MultiLineString': {
			const bounds = makeBounds();
			for (const line of geometry.coordinates) {
				for (const point of line) {
					expandBounds(bounds, point);
				}
			}
			return isBoundsValid(bounds) ? bounds : null;
		}
		case 'Polygon':
			return polygonBounds(geometry.coordinates);
		case 'MultiPolygon': {
			const bounds = makeBounds();
			for (const polygon of geometry.coordinates) {
				const polygonBound = polygonBounds(polygon);
				if (!polygonBound) {
					continue;
				}
				if (polygonBound.minX < bounds.minX) {
					bounds.minX = polygonBound.minX;
				}
				if (polygonBound.minY < bounds.minY) {
					bounds.minY = polygonBound.minY;
				}
				if (polygonBound.maxX > bounds.maxX) {
					bounds.maxX = polygonBound.maxX;
				}
				if (polygonBound.maxY > bounds.maxY) {
					bounds.maxY = polygonBound.maxY;
				}
			}
			return isBoundsValid(bounds) ? bounds : null;
		}
	}
}

export function lineDirection(
	start: Point2D,
	end: Point2D
): 'horizontal' | 'vertical' | 'diagonalSlash' | 'diagonalBackslash' {
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);

	if (absDx >= absDy * 2) {
		return 'horizontal';
	}

	if (absDy >= absDx * 2) {
		return 'vertical';
	}

	return dx * dy >= 0 ? 'diagonalBackslash' : 'diagonalSlash';
}

export function lineSteps(
	start: Point2D,
	end: Point2D,
	cellWidth: number,
	cellHeight: number
): number {
	const dx = Math.abs(end[0] - start[0]) / cellWidth;
	const dy = Math.abs(end[1] - start[1]) / cellHeight;
	return Math.max(1, Math.ceil(Math.max(dx, dy) * 2));
}

export function forEachLineSamplePoint(
	start: Point2D,
	end: Point2D,
	steps: number,
	visit: (point: Point2D) => void
): void {
	for (let step = 0; step <= steps; step += 1) {
		const t = steps === 0 ? 0 : step / steps;
		visit([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
	}
}

export function forEachLineSegment(
	feature: Feature,
	visit: (segment: { start: Point2D; end: Point2D }) => void
): void {
	forEachGeometryPart(feature.geometry, (part) => {
		if (part.type !== 'LineString') {
			return;
		}

		for (let index = 1; index < part.coordinates.length; index += 1) {
			const start = part.coordinates[index - 1];
			const end = part.coordinates[index];
			if (start && end) {
				visit({ start, end });
			}
		}
	});
}

export function forEachPolygonPart(feature: Feature, visit: (polygon: Polygon) => void): void {
	forEachGeometryPart(feature.geometry, (part) => {
		if (part.type === 'Polygon') {
			visit(part.coordinates);
		}
	});
}
