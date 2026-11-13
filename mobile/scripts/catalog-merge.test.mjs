import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeCatalogEntries } from '../src/direct/catalog.ts';

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
