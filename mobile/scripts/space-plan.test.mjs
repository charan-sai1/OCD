import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addItem,
  emptyEstimate,
  freeAfter,
  mergeEstimate,
  remainingAfter,
  roomFor,
} from '../src/direct/spacePlan.ts';

const MB = 1024 * 1024;

test('an item adds its size and count', () => {
  const e = addItem(emptyEstimate(), 12 * MB);
  assert.deepEqual(e, { count: 1, bytes: 12 * MB, skipped: 0 });
});

test('a skipped item counts as skipped, never as bytes', () => {
  const e = addItem(addItem(emptyEstimate(), 5 * MB), 9 * MB, true);
  assert.deepEqual(e, { count: 1, bytes: 5 * MB, skipped: 1 });
});

test('a file whose size could not be read is skipped', () => {
  const e = addItem(emptyEstimate(), -1);
  assert.deepEqual(e, { count: 0, bytes: 0, skipped: 1 });
});

test('merging adds every field', () => {
  const a = { count: 2, bytes: 10, skipped: 1 };
  const b = { count: 3, bytes: 40, skipped: 4 };
  assert.deepEqual(mergeEstimate(a, b), { count: 5, bytes: 50, skipped: 5 });
});

test('remaining space subtracts and never goes below zero', () => {
  assert.equal(remainingAfter(100, 30), 70);
  assert.equal(remainingAfter(100, 130), 0);
});

test('unknown free space stays unknown instead of becoming zero', () => {
  assert.equal(remainingAfter(null, 10), null);
  assert.equal(remainingAfter(undefined, 10), null);
  assert.equal(remainingAfter(Number.NaN, 10), null);
  assert.equal(remainingAfter(-5, 10), null);
});

test('a copy with headroom fits only when room is left over', () => {
  assert.equal(roomFor(100, 60, 30), true);
  assert.equal(roomFor(100, 60, 40), false);
  assert.equal(roomFor(100, 200, 30), false);
});

test('unknown free space cannot pass the room check', () => {
  assert.equal(roomFor(null, 1, 1), null);
});

test('freed space is added to the phone total', () => {
  assert.equal(freeAfter(500, 250), 750);
  assert.equal(freeAfter(null, 250), null);
  assert.equal(freeAfter(500, -20), 500);
});
