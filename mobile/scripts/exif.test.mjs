import assert from 'node:assert/strict';
import test from 'node:test';

import { assetExif, exifShotTime } from '../src/direct/exif.ts';

test('iOS nests EXIF under CoreImage dictionaries', () => {
  // getAssetInfoAsync on iOS returns CIImage properties, which group tags.
  const info = {
    exif: {
      '{TIFF}': { Make: 'Apple', Model: 'iPhone 15 Pro', Orientation: 6 },
      '{Exif}': {
        DateTimeOriginal: '2024:05:06 07:08:09',
        FNumber: 1.78,
        ExposureTime: 0.008,
        FocalLength: 6.86,
        ISOSpeedRatings: [64],
      },
      '{GPS}': {
        Latitude: 12.9716,
        Longitude: 77.5946,
        LatitudeRef: 'N',
        LongitudeRef: 'E',
      },
    },
    location: null,
  };

  const got = assetExif(info);

  assert.equal(got.make, 'Apple');
  assert.equal(got.model, 'iPhone 15 Pro');
  assert.equal(got.orient, 6);
  assert.equal(got.iso, 64);
  assert.equal(got.fnumber, 1.78);
  assert.equal(got.exposure, 0.008);
  assert.equal(got.focal, 6.86);
  assert.equal(got.gps, true);
  assert.equal(got.lat, 12.9716);
  assert.equal(got.lon, 77.5946);
  // EXIF has no timezone; it is read as local time, like the camera wrote it.
  assert.equal(got.shot, Math.round(new Date(2024, 4, 6, 7, 8, 9).getTime() / 1000));
});

test('Android flat EXIF accepts fractions and array values', () => {
  const got = assetExif({
    exif: {
      Make: 'Google',
      Model: 'Pixel 8',
      Orientation: 1,
      DateTimeOriginal: '2023-12-31 23:59:58',
      FNumber: '178/100',
      ExposureTime: '1/125',
      FocalLength: [686, 100],
      PhotographicSensitivity: [400],
    },
    // Android exposes the position through AssetInfo.location; the raw GPS
    // latitude tags are not in the flat map.
    location: { latitude: 12.9716, longitude: 77.5946 },
  });

  assert.equal(got.make, 'Google');
  assert.equal(got.fnumber, 1.78);
  assert.equal(got.exposure, 0.008);
  assert.equal(got.focal, 6.86);
  assert.equal(got.iso, 400);
  assert.equal(got.orient, 1);
  assert.equal(got.lat, 12.9716);
  assert.equal(got.lon, 77.5946);
  assert.equal(got.shot, Math.round(new Date(2023, 11, 31, 23, 59, 58).getTime() / 1000));
});

test('southern and western positions become negative', () => {
  const got = assetExif({
    exif: {
      GPSLatitude: 33.8688,
      GPSLatitudeRef: 'S',
      GPSLongitude: 151.2093,
      GPSLongitudeRef: 'W',
    },
  });

  assert.equal(got.gps, true);
  assert.equal(got.lat, -33.8688);
  assert.equal(got.lon, -151.2093);
});

test('the platform location field wins over raw tags', () => {
  const got = assetExif({
    exif: { GPSLatitude: 1, GPSLongitude: 2 },
    location: { latitude: 51.5074, longitude: -0.1278 },
  });

  assert.equal(got.lat, 51.5074);
  assert.equal(got.lon, -0.1278);
  assert.equal(got.gps, true);
});

test('a missing or zero position is not reported as GPS', () => {
  assert.equal(assetExif({ exif: {} }).gps, undefined);
  assert.equal(assetExif({ location: { latitude: 0, longitude: 0 } }).gps, undefined);
  assert.equal(assetExif(null).gps, undefined);
});

test('bad dates and impossible orientation are left out', () => {
  const got = assetExif({
    exif: {
      DateTimeOriginal: 'not a date',
      Orientation: 42,
      FNumber: 'wide open',
      ExposureTime: '',
      ISOSpeedRatings: [],
    },
  });

  assert.equal(got.shot, undefined);
  assert.equal(got.orient, undefined);
  assert.equal(got.fnumber, undefined);
  assert.equal(got.exposure, undefined);
  assert.equal(got.iso, undefined);
});

test('exifShotTime handles seconds, milliseconds, Dates and ISO strings', () => {
  assert.equal(exifShotTime(0), undefined);
  assert.equal(exifShotTime(-5), undefined);
  assert.equal(exifShotTime(1700000000), 1700000000);
  assert.equal(exifShotTime(1700000000123), 1700000000);
  assert.equal(
    exifShotTime(new Date(1700000000000)),
    1700000000,
  );
  assert.equal(
    exifShotTime('2024-05-06T07:08:09Z'),
    Math.round(Date.parse('2024-05-06T07:08:09Z') / 1000),
  );
  assert.equal(exifShotTime(''), undefined);
  assert.equal(exifShotTime({}), undefined);
});
