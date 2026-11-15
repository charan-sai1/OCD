import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCatalogEntries,
  encodeCatalog,
  mergeCatalogEntries,
  parseCatalog,
} from '../src/direct/catalog.ts';

const PATH = 'Phone/2024/05/IMG_1234.JPG';

test('an addition at a removed path survives the merge', () => {
  // Quarantine moved the old drive copy aside, then the phone copy landed at
  // the same path. The old entry is removed; the new one must still be added.
  const previous = [{ p: PATH, size: 10, m: 1, t: 5, k: 'image' }];
  const additions = [{ p: PATH, s: 20, m: 2, t: 6, k: 'image' }];

  const merged = mergeCatalogEntries(previous, additions, [PATH]);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], additions[0]);
});

test('a removal still drops an entry the run did not replace', () => {
  const other = 'Phone/2024/05/IMG_9999.JPG';
  const previous = [
    { p: PATH, size: 10, m: 1, t: 5, k: 'image' },
    { p: other, size: 11, m: 1, t: 5, k: 'image' },
  ];

  const merged = mergeCatalogEntries(previous, [], [PATH]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].p, other);
});

test('an addition replaces a previous entry at the same path in place', () => {
  const other = 'Phone/2024/05/IMG_0001.JPG';
  const previous = [
    { p: other, size: 1, m: 1, k: 'image' },
    { p: PATH, size: 10, m: 1, t: 5, k: 'image' },
  ];
  const additions = [{ p: PATH, s: 20, m: 2, t: 6, k: 'image' }];

  const merged = mergeCatalogEntries(previous, additions);

  assert.deepEqual(
    merged.map((e) => e.p),
    [other, PATH],
  );
  assert.deepEqual(merged[1], additions[0]);
});

const CONTENT = {
  live: 'Phone/2024/05/IMG_1234.MOV',
  hash: 'a'.repeat(64),
  make: 'Apple',
  model: 'iPhone 15',
  iso: 64,
  fnumber: 1.78,
  exposure: 0.008,
  focal: 6.86,
  lat: 12.97,
  lon: 77.59,
  gps: true,
  orient: 6,
};

test('an unchanged file keeps its hash, Live pair, camera and GPS fields', () => {
  const previous = [{ p: PATH, size: 10, m: 5, t: 100, k: 'image', ...CONTENT }];
  const scan = [{ p: PATH, s: 10, m: 5, k: 'image' }];

  const [entry] = buildCatalogEntries(scan, new Map(), previous);

  assert.deepEqual(entry, {
    p: PATH,
    s: 10,
    m: 5,
    k: 'image',
    t: 100,
    ...CONTENT,
  });
});

test('a file whose bytes changed drops last run’s content metadata', () => {
  const previous = [{ p: PATH, size: 10, m: 5, t: 100, k: 'image', ...CONTENT }];
  const scan = [{ p: PATH, s: 11, m: 5, k: 'image' }];

  const [entry] = buildCatalogEntries(scan, new Map(), previous);

  assert.deepEqual(entry, { p: PATH, s: 11, m: 5, k: 'image' });
  assert.equal('hash' in entry, false);
  assert.equal('live' in entry, false);
});

test('a merge carries content metadata from a catalog entry', () => {
  // Entries read from the drive use long keys; the merge writes short ones but
  // must not lose anything that describes the bytes.
  const previous = [{ p: PATH, size: 10, m: 5, t: 100, k: 'image', ...CONTENT }];

  const [entry] = mergeCatalogEntries(previous, []);

  assert.equal(entry.s, 10);
  assert.equal(entry.t, 100);
  assert.deepEqual(
    { live: entry.live, hash: entry.hash, gps: entry.gps, orient: entry.orient },
    {
      live: CONTENT.live,
      hash: CONTENT.hash,
      gps: true,
      orient: 6,
    },
  );
  assert.equal(entry.fnumber, 1.78);
  assert.equal(entry.lat, 12.97);
});

test('every content field survives writing and reading the catalog', () => {
  const entries = [
    {
      p: PATH,
      s: 10,
      m: 5,
      k: 'image',
      t: 100,
      ...CONTENT,
      // 0,0 is a real position, so the GPS flag, not the value, must carry it.
      lat: 0,
      lon: 0,
    },
  ];

  const bytes = encodeCatalog(
    {
      format: 'ocd-catalog',
      version: 1,
      volumeId: 'phone:1',
      generated: '2024-05-06T07:08:09Z',
    },
    entries,
  );
  const parsed = parseCatalog(bytes);

  assert.equal(parsed.entries.length, 1);
  const got = parsed.entries[0];
  assert.equal(got.p, PATH);
  assert.equal(got.t, 100);
  assert.equal(got.make, 'Apple');
  assert.equal(got.model, 'iPhone 15');
  assert.equal(got.iso, 64);
  assert.equal(got.fnumber, 1.78);
  assert.equal(got.exposure, 0.008);
  assert.equal(got.focal, 6.86);
  assert.equal(got.orient, 6);
  assert.equal(got.live, CONTENT.live);
  assert.equal(got.hash, CONTENT.hash);
  assert.equal(got.gps, true);
  assert.equal(got.lat, 0);
  assert.equal(got.lon, 0);
});

