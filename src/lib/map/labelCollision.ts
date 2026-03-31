interface Bounds {
	bottom: number;
	left: number;
	right: number;
	top: number;
}

const BUCKET_SIZE = 96;

function intersects(left: Bounds, right: Bounds): boolean {
	return !(
		left.right < right.left ||
		left.left > right.right ||
		left.bottom < right.top ||
		left.top > right.bottom
	);
}

function getBucketKeys(bounds: Bounds): string[] {
	const minColumn = Math.floor(bounds.left / BUCKET_SIZE);
	const maxColumn = Math.floor(bounds.right / BUCKET_SIZE);
	const minRow = Math.floor(bounds.top / BUCKET_SIZE);
	const maxRow = Math.floor(bounds.bottom / BUCKET_SIZE);
	const keys: string[] = [];

	for (let row = minRow; row <= maxRow; row += 1) {
		for (let column = minColumn; column <= maxColumn; column += 1) {
			keys.push(`${column}:${row}`);
		}
	}

	return keys;
}

export function acceptNonOverlapping<T>(
	candidates: readonly T[],
	readBounds: (candidate: T) => Bounds
): T[] {
	const accepted: T[] = [];
	const occupiedByBucket = new Map<string, Bounds[]>();

	for (const candidate of candidates) {
		const bounds = readBounds(candidate);
		const bucketKeys = getBucketKeys(bounds);
		const seenBounds = new Set<Bounds>();
		let blocked = false;

		for (const bucketKey of bucketKeys) {
			const occupied = occupiedByBucket.get(bucketKey);
			if (!occupied) {
				continue;
			}

			for (const existing of occupied) {
				if (seenBounds.has(existing)) {
					continue;
				}
				seenBounds.add(existing);
				if (intersects(bounds, existing)) {
					blocked = true;
					break;
				}
			}

			if (blocked) {
				break;
			}
		}

		if (blocked) {
			continue;
		}

		accepted.push(candidate);
		for (const bucketKey of bucketKeys) {
			const occupied = occupiedByBucket.get(bucketKey);
			if (occupied) {
				occupied.push(bounds);
				continue;
			}

			occupiedByBucket.set(bucketKey, [bounds]);
		}
	}

	return accepted;
}
