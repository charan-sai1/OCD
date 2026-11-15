/**
 * Reading camera details out of the platform's media info.
 *
 * iOS hands back CoreImage properties, which group tags into dictionaries such
 * as `{Exif}`, `{TIFF}` and `{GPS}`. Android hands back a flat map of EXIF tag
 * names. Both are handled here so the backup does not need to care which phone
 * it is running on, and so the parsing can be tested without a device.
 */

export type AssetInfoLike =
  | {
      exif?: unknown;
      location?: { latitude?: number; longitude?: number } | null;
      orientation?: number;
    }
  | null
  | undefined;

/** Everything worth keeping from a photo's own metadata. */
export type AssetExif = {
  /** Shot time, Unix seconds. */
  shot?: number;
  make?: string;
  model?: string;
  iso?: number;
  /** Aperture, as an f-number. */
  fnumber?: number;
  /** Exposure time, seconds. */
  exposure?: number;
  /** Focal length, millimetres. */
  focal?: number;
  lat?: number;
  lon?: number;
  gps?: boolean;
  /** EXIF orientation, 1–8. */
  orient?: number;
};

function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

/**
 * Numbers arrive as numbers, decimal strings, fractions such as "1/125", or
 * two-element rational arrays. A value that cannot be understood is left out
 * rather than guessed at.
 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(s);
    if (frac) {
      const den = Number(frac[2]);
      return den ? Number(frac[1]) / den : undefined;
    }
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (Array.isArray(v) && v.length === 2) {
    const a = num(v[0]);
    const b = num(v[1]);
    return a !== undefined && b ? a / b : undefined;
  }
  return undefined;
}

/** ISO is sometimes written as an array of one value. */
function firstNum(v: unknown): number | undefined {
  if (Array.isArray(v)) return v.length ? num(v[0]) : undefined;
  return num(v);
}

/**
 * EXIF dates carry no timezone, so they are read as local time, which is how
 * the camera and the phone treat them. Accepts `YYYY:MM:DD HH:MM:SS`, the
 * dash-separated variant, an ISO string, or a Date.
 */
export function exifShotTime(v: unknown): number | undefined {
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? Math.round(ms / 1000) : undefined;
  }
  if (typeof v === 'number') {
    // Already seconds in this app's schema; guard against a millisecond value
    // so a bad write cannot land in the year 50,000.
    if (!Number.isFinite(v) || v <= 0) return undefined;
    const seconds = v > 1e12 ? Math.round(v / 1000) : Math.round(v);
    return seconds > 0 ? seconds : undefined;
  }
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;

  const ymd = /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2})[:\-](\d{2})(?:[:\-](\d{2}))?)?/.exec(s);
  // EXIF's `YYYY:MM:DD HH:MM:SS` has no zone and is local by definition. A
  // string that names a zone is a real instant, so it is parsed as one.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (ymd && !hasZone) {
    const d = new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      Number(ymd[4] ?? 0),
      Number(ymd[5] ?? 0),
      Number(ymd[6] ?? 0),
    );
    const ms = d.getTime();
    if (Number.isFinite(ms)) return Math.round(ms / 1000);
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : undefined;
}

/** Pulls the camera and location fields out of `getAssetInfoAsync().exif`. */
export function assetExif(info: AssetInfoLike): AssetExif {
  const out: AssetExif = {};
  const raw = record(info?.exif);
  const exif = { ...raw, ...record(raw?.['{Exif}']) };
  const tiff = { ...raw, ...record(raw?.['{TIFF}']) };
  const gps = record(raw?.['{GPS}']) ?? record(raw?.GPS) ?? raw ?? {};

  out.make = text(tiff.Make) ?? text(exif.Make);
  out.model = text(tiff.Model) ?? text(exif.Model);
  out.iso = firstNum(exif.ISOSpeedRatings) ?? firstNum(exif.PhotographicSensitivity);
  out.fnumber = num(exif.FNumber);
  out.exposure = num(exif.ExposureTime);
  out.focal = num(exif.FocalLength);

  const orient = num(exif.Orientation) ?? num(tiff.Orientation) ?? num(info?.orientation);
  if (orient && orient >= 1 && orient <= 8) out.orient = Math.round(orient);

  out.shot =
    exifShotTime(exif.DateTimeOriginal) ??
    exifShotTime(exif.DateTimeDigitized) ??
    exifShotTime(tiff.DateTime);

  // The platform's location field is already decimal degrees; the raw GPS
  // dictionary is the fallback for files where only the file knows.
  const loc = info?.location;
  let lat = num(loc?.latitude);
  let lon = num(loc?.longitude);
  if (lat === undefined || lon === undefined) {
    lat = num(gps.Latitude) ?? num(gps.GPSLatitude);
    lon = num(gps.Longitude) ?? num(gps.GPSLongitude);
    const latRef = text(gps.LatitudeRef) ?? text(gps.GPSLatitudeRef);
    const lonRef = text(gps.LongitudeRef) ?? text(gps.GPSLongitudeRef);
    if (lat !== undefined && latRef?.toUpperCase() === 'S') lat = -Math.abs(lat);
    if (lon !== undefined && lonRef?.toUpperCase() === 'W') lon = -Math.abs(lon);
  }
  if (
    lat !== undefined &&
    lon !== undefined &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    (lat !== 0 || lon !== 0)
  ) {
    out.lat = lat;
    out.lon = lon;
    out.gps = true;
  }

  // Drop keys that ended up undefined so callers can test `in`.
  for (const key of Object.keys(out) as (keyof AssetExif)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}
