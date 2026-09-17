/**
 * Tests for the classification seam.
 *
 * These do not touch the database. They exist to pin down the one promise this
 * application makes about keywords: that it does not invent a classification
 * `ledsone` does not hold.
 *
 * If somebody later changes classifyKeywords to derive a category from match
 * type, word count or anything else, these tests fail - which is the point.
 * The rules have not been agreed, so deriving one should not be able to happen
 * quietly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PAGE_SIZE, classifyKeywords } from './source.js';

test('no keyword category is claimed, whatever keywords the product has', () => {
  assert.deepEqual(classifyKeywords([]), {
    primary: null,
    secondary: null,
    longTail: null,
    competitor: null,
  });
});

test('a single keyword is not promoted to Primary', () => {
  const result = classifyKeywords(['led bulb']);
  assert.equal(result.primary, null, 'one keyword does not make it the primary one');
});

test('extra keywords are not demoted to Secondary', () => {
  const result = classifyKeywords(['led bulb', 'e27 led bulb', 'warm white led bulb']);
  assert.equal(result.secondary, null);
});

test('a long phrase is not called Long-Tail on word count alone', () => {
  const result = classifyKeywords(['e27 screw led filament bulb warm white dimmable vintage']);
  assert.equal(result.longTail, null, 'word count is a guess, not a record');
});

test('Competitor is never populated: ledsone has no competitor keyword source', () => {
  const result = classifyKeywords(['competitor brand name', 'rival lamp co']);
  assert.equal(result.competitor, null);
});

test('every category is null, so the renderer always shows Not recorded', () => {
  const values = Object.values(classifyKeywords(['anything at all']));

  assert.equal(values.length, 4);
  assert.ok(
    values.every((value) => value === null),
    'a non-null category would put an unapproved business rule on the page',
  );
});

test('the page size is a sane, whole, positive number', () => {
  assert.ok(Number.isInteger(PAGE_SIZE));
  assert.ok(PAGE_SIZE > 0 && PAGE_SIZE <= 500);
});
