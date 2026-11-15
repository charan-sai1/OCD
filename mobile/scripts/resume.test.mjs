import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeResume,
  encodeResume,
  resumeConditions,
} from '../src/direct/resume.ts';

const RECORD = {
  volumeId: 'win:6EC7-679B',
  label: 'Elements',
  conditions: {
    media: 'both',
    albumId: '',
    albumTitle: '',
    since: 1700000000,
    until: 0,
    skipScreenshots: true,
    minBytes: 1024,
    layout: 'phone',
    duplicates: 'quarantine',
    duplicateFolder: 'Old copies',
    updateCatalog: true,
  },
  assetIds: ['a1', 'a2'],
  startedAt: 1700000123,
};

test('a marker survives writing and reading', () => {
  const got = decodeResume(encodeResume(RECORD));
  assert.deepEqual(got, RECORD);
});

test('a marker for a ticked set keeps the exact ids', () => {
  const got = decodeResume(encodeResume(RECORD));
  assert.deepEqual(got?.assetIds, ['a1', 'a2']);
});

test('a whole-roll marker has no assetIds', () => {
  const got = decodeResume(
    encodeResume({ ...RECORD, assetIds: undefined }),
  );
  assert.equal(got?.assetIds, undefined);
});

test('resume forces duplicates to skip and changes nothing else', () => {
  const got = resumeConditions(RECORD);
  assert.equal(got.duplicates, 'skip');
  assert.deepEqual(
    { ...got, duplicates: RECORD.conditions.duplicates },
    RECORD.conditions,
  );
});

test('garbage, the wrong version, or a missing drive is rejected', () => {
  assert.equal(decodeResume(''), null);
  assert.equal(decodeResume(null), null);
  assert.equal(decodeResume('not json'), null);
  assert.equal(decodeResume('[]'), null);
  assert.equal(decodeResume(JSON.stringify({ version: 2 })), null);
  assert.equal(
    decodeResume(JSON.stringify({ version: 1, volumeId: '  ' })),
    null,
  );
  assert.equal(
    decodeResume(JSON.stringify({ version: 1, volumeId: 'win:1' })),
    null,
  );
});

test('unknown values fall back instead of failing the marker', () => {
  const got = decodeResume(
    JSON.stringify({
      version: 1,
      volumeId: 'win:1',
      label: 42,
      startedAt: -5,
      conditions: {
        media: 'hologram',
        since: -1,
        minBytes: 'plenty',
        skipScreenshots: 'yes',
        layout: 'spiral',
        duplicates: 'delete!',
        updateCatalog: null,
      },
      assetIds: ['ok', '', 7, 'also-ok'],
    }),
  );

  assert.ok(got);
  assert.equal(got.label, '');
  assert.equal(got.startedAt, 0);
  assert.equal(got.conditions.media, 'both');
  assert.equal(got.conditions.since, 0);
  assert.equal(got.conditions.minBytes, 0);
  assert.equal(got.conditions.skipScreenshots, true);
  assert.equal(got.conditions.layout, 'phone');
  assert.equal(got.conditions.duplicates, 'skip');
  assert.equal(got.conditions.updateCatalog, true);
  assert.deepEqual(got.assetIds, ['ok', 'also-ok']);
});
