/**
 * Small, pure space arithmetic shared by the backup sheet and the free-space
 * screen. Everything here is deliberately free of React and Expo imports so it
 * can be exercised by the node tests.
 */

export type SpaceEstimate = {
  /** Items that will actually be copied (or deleted). */
  count: number;
  /** Their total size in bytes. */
  bytes: number;
  /** Items the active rules exclude, such as screenshots or tiny files. */
  skipped: number;
};

export function emptyEstimate(): SpaceEstimate {
  return { count: 0, bytes: 0, skipped: 0 };
}

/** Adds one item. A negative size means the file could not be read. */
export function addItem(
  estimate: SpaceEstimate,
  size: number,
  skipped = false,
): SpaceEstimate {
  if (skipped || size < 0) {
    estimate.skipped += 1;
    return estimate;
  }
  estimate.count += 1;
  estimate.bytes += size;
  return estimate;
}

/** Adds another estimate into the first one. */
export function mergeEstimate(
  into: SpaceEstimate,
  from: SpaceEstimate,
): SpaceEstimate {
  into.count += from.count;
  into.bytes += from.bytes;
  into.skipped += from.skipped;
  return into;
}

/**
 * Space left after adding `add` bytes. Returns null when the platform did not
 * report a free-space figure, rather than pretending zero.
 */
export function remainingAfter(
  free: number | null | undefined,
  add: number,
): number | null {
  if (free === null || free === undefined || !Number.isFinite(free) || free < 0) {
    return null;
  }
  return Math.max(0, free - Math.max(0, add));
}

/**
 * Whether `add` bytes plus the safety headroom still fit. Null means "cannot
 * tell", which the caller should show as a warning, never as a pass.
 */
export function roomFor(
  free: number | null | undefined,
  add: number,
  headroom: number,
): boolean | null {
  const left = remainingAfter(free, add + Math.max(0, headroom));
  return left === null ? null : left > 0;
}

/**
 * The phone's free space after deleting `freed` bytes. A backup never deletes,
 * so the free-space screen is the only place this figure changes.
 */
export function freeAfter(
  phoneFree: number | null | undefined,
  freed: number,
): number | null {
  if (
    phoneFree === null ||
    phoneFree === undefined ||
    !Number.isFinite(phoneFree) ||
    phoneFree < 0
  ) {
    return null;
  }
  return phoneFree + Math.max(0, freed);
}
