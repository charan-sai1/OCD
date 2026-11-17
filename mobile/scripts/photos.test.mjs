import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPUTER_PREFIX,
  DRIVE_PREFIX,
  PHONE_PREFIX,
  byShotDesc,
  computerToItem,
  driveToItem,
  mergeByDate,
  phoneToItem,
  sortByDate,
  sourceKey,
  sourceLabel,
} from '../src/photos.ts';

const asset = {
  id: 'asset-1',
  filename: 'IMG_0001.HEIC',
  uri: 'file:///cache/IMG_0001.HEIC',
  size: 2048,
  takenAt: 1_700_000_000,
  kind: 'image',
  duration: 0,
};

function grid(over = {}) {
  return {
    key: 'Photos/IMG_0001.HEIC',
    name: 'IMG_0001.HEIC',
    dir: 'Photos',
    lib: 'lib1',
    kind: 'image',
    w: 4032,
    h: 3024,
    shot: 1_700_000_100,
    size: 2048,
    dur: undefined,
    v: 1_700_000_200,
    fav: false,
    ...over,
  };
}

test('sourceKey strips exactly the prefix each source owns', () => {
  assert.equal(sourceKey({ ...grid(), key: PHONE_PREFIX + 'abc' }), 'abc');
  assert.equal(sourceKey({ ...grid(), key: DRIVE_PREFIX + 'A/B.jpg' }), 'A/B.jpg');
  assert.equal(sourceKey({ ...grid(), key: COMPUTER_PREFIX + 'Photos/C.jpg' }), 'Photos/C.jpg');
  // An unprefixed key is passed through so an older caller still works.
  assert.equal(sourceKey(grid()), 'Photos/IMG_0001.HEIC');
});

test('a phone asset becomes a unified item with a routed key', () => {
  const item = phoneToItem(asset);
  assert.equal(item.key, PHONE_PREFIX + 'asset-1');
  assert.equal(item.source, 'phone');
  assert.equal(item.name, 'IMG_0001.HEIC');
  assert.equal(item.shot, asset.takenAt);
  assert.equal(item.v, asset.takenAt);
  assert.equal(item.size, 2048);
  assert.equal(item.phone?.uri, asset.uri);
  assert.equal(item.dur, undefined);
});

test('a phone video carries its duration and a missing size becomes zero', () => {
  const item = phoneToItem({ ...asset, kind: 'video', duration: 12.5, size: undefined });
  assert.equal(item.dur, 12.5);
  assert.equal(item.size, 0);
});

test('a drive item falls back to the file time when there is no capture date', () => {
  const item = driveToItem({
    key: 'Photos/VID_1.MP4',
    name: 'VID_1.MP4',
    dir: 'Photos',
    rel: 'Photos/VID_1.MP4',
    kind: 'video',
    w: 0,
    h: 0,
    shot: 0,
    size: 99,
    dur: 3,
    v: 1_699_000_000,
  });
  assert.equal(item.key, DRIVE_PREFIX + 'Photos/VID_1.MP4');
  assert.equal(item.source, 'drive');
  assert.equal(item.shot, 1_699_000_000);
  assert.equal(item.dur, 3);
});

test('a computer item keeps its fields and gains the pc prefix', () => {
  const source = grid();
  const item = computerToItem(source);
  assert.equal(item.key, COMPUTER_PREFIX + source.key);
  assert.equal(item.source, 'computer');
  assert.equal(item.shot, source.shot);
  assert.equal(item.w, 4032);
  assert.equal(source.key, 'Photos/IMG_0001.HEIC', 'the input must not be edited');
});

test('sourceLabel names every source', () => {
  assert.equal(sourceLabel('phone'), 'Phone');
  assert.equal(sourceLabel('drive'), 'Drive');
  assert.equal(sourceLabel('computer'), 'Computer');
});

test('newest first, then file time, then key for a stable order', () => {
  const items = [
    { key: 'b', shot: 10 },
    { key: 'c', shot: 30 },
    { key: 'a', shot: 10 },
    { key: 'd', shot: 0, v: 20 },
    { key: 'e', shot: 0 },
  ];
  assert.deepEqual(
    sortByDate(items).map((i) => i.key),
    ['c', 'd', 'a', 'b', 'e'],
  );
});

test('byShotDesc never reports equal for distinct keys', () => {
  assert.equal(byShotDesc({ key: 'a', shot: 5 }, { key: 'b', shot: 5 }), -1);
  assert.equal(byShotDesc({ key: 'b', shot: 5 }, { key: 'a', shot: 5 }), 1);
});

test('merging keeps every list newest-first across sources', () => {
  const phone = [
    { key: 'p1', shot: 9, source: 'phone' },
    { key: 'p2', shot: 6, source: 'phone' },
  ];
  const drive = [
    { key: 'd1', shot: 8, source: 'drive' },
    { key: 'd2', shot: 5, source: 'drive' },
  ];
  const pc = [
    { key: 'c1', shot: 7, source: 'computer' },
    { key: 'c2', shot: 4, source: 'computer' },
  ];
  assert.deepEqual(
    mergeByDate([phone, drive, pc]).map((i) => i.key),
    ['p1', 'd1', 'c1', 'p2', 'd2', 'c2'],
  );
});

test('merging ignores empty lists and does not reorder equal dates blindly', () => {
  assert.deepEqual(mergeByDate([[], [], []]), []);
  const a = [{ key: 'a', shot: 1 }];
  assert.equal(mergeByDate([[], a, []]), a, 'a single list is returned as-is');
  const merged = mergeByDate([
    [{ key: 'b', shot: 2 }],
    [{ key: 'a', shot: 2 }],
  ]);
  assert.deepEqual(merged.map((i) => i.key), ['a', 'b']);
});

test('sortByDate returns a new array and leaves the input alone', () => {
  const input = [{ key: 'a', shot: 1 }, { key: 'b', shot: 2 }];
  const sorted = sortByDate(input);
  assert.deepEqual(sorted.map((i) => i.key), ['b', 'a']);
  assert.deepEqual(input.map((i) => i.key), ['a', 'b']);
});
