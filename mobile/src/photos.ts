import type { GridItem } from './api';
import type { DirectItem } from './direct/drive';
import type { PhoneAsset } from './phoneRoll';

/**
 * A photo can come from three places: this phone's camera roll, a drive
 * plugged into the phone, or a computer on the same Wi-Fi. The Photos grid
 * flattens all three into one shape so a tile, the viewer and sharing can
 * work without knowing which disk answered.
 *
 * Keys are prefixed. The prefix is what routes a preview or an original back
 * to the source that owns it; it also keeps a drive path from colliding with a
 * camera-roll id.
 */
export type PhotoSource = 'phone' | 'drive' | 'computer';

export type UnifiedItem = GridItem & {
  source: PhotoSource;
  phone?: PhoneAsset;
  drive?: DirectItem;
  computer?: GridItem;
};

export const PHONE_PREFIX = 'phone:';
export const DRIVE_PREFIX = 'drive:';
export const COMPUTER_PREFIX = 'pc:';

/** Strips the source prefix, leaving the key the source itself understands. */
export function sourceKey(item: GridItem): string {
  if (item.key.startsWith(PHONE_PREFIX)) return item.key.slice(PHONE_PREFIX.length);
  if (item.key.startsWith(DRIVE_PREFIX)) return item.key.slice(DRIVE_PREFIX.length);
  if (item.key.startsWith(COMPUTER_PREFIX)) return item.key.slice(COMPUTER_PREFIX.length);
  return item.key;
}

export function phoneToItem(a: PhoneAsset): UnifiedItem {
  return {
    key: PHONE_PREFIX + a.id,
    name: a.filename,
    dir: 'Camera roll',
    lib: 'phone',
    kind: a.kind,
    w: 0,
    h: 0,
    shot: a.takenAt,
    size: a.size ?? 0,
    dur: a.kind === 'video' ? a.duration : undefined,
    v: a.takenAt,
    fav: false,
    source: 'phone',
    phone: a,
  };
}

export function driveToItem(it: DirectItem): UnifiedItem {
  return {
    key: DRIVE_PREFIX + it.key,
    name: it.name,
    dir: it.dir,
    lib: 'drive',
    kind: it.kind,
    w: it.w,
    h: it.h,
    shot: it.shot || it.v,
    size: it.size,
    dur: it.dur,
    v: it.v,
    fav: false,
    source: 'drive',
    drive: it,
  };
}

export function computerToItem(it: GridItem): UnifiedItem {
  return {
    ...it,
    key: COMPUTER_PREFIX + it.key,
    lib: it.lib || 'computer',
    source: 'computer',
    computer: it,
  };
}

export function sourceLabel(source: PhotoSource): string {
  if (source === 'phone') return 'Phone';
  if (source === 'drive') return 'Drive';
  return 'Computer';
}

/** The fields needed to place an item on a timeline. */
export type Dated = { key: string; shot?: number; v?: number };

/**
 * Newest first. An item with no capture date falls back to its file time, then
 * sorts last; the key keeps the order stable between renders.
 */
export function byShotDesc(a: Dated, b: Dated): number {
  const as = a.shot || a.v || 0;
  const bs = b.shot || b.v || 0;
  if (bs !== as) return bs - as;
  return a.key.localeCompare(b.key);
}

function mergeTwo(a: UnifiedItem[], b: UnifiedItem[]): UnifiedItem[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Array<UnifiedItem>(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) {
    out[k++] = byShotDesc(a[i], b[j]) <= 0 ? a[i++] : b[j++];
  }
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}

/**
 * Merges already-sorted lists into one newest-first list. A linear merge keeps
 * a large drive catalogue from being re-sorted every time another camera-roll
 * page arrives.
 */
export function mergeByDate(lists: UnifiedItem[][]): UnifiedItem[] {
  const present = lists.filter((l) => l.length > 0);
  if (present.length === 0) return [];
  if (present.length === 1) return present[0];
  let out = present[0];
  for (let i = 1; i < present.length; i += 1) out = mergeTwo(out, present[i]);
  return out;
}

export function sortByDate<T extends Dated>(items: T[]): T[] {
  return [...items].sort(byShotDesc);
}
