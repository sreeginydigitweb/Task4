/**
 * Routing tests.
 *
 * Only the routes that need no database are exercised here - the root
 * redirect, unknown paths, and the page-number parsing. The one route that
 * reads `ledsone` is covered against the live database by the checks recorded
 * in evidence/build-verification.md, rather than by a mock that would only
 * prove the mock works.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { pageFrom, route, routeForm } from './router.js';

test('no page parameter is page 1', () => {
  assert.equal(pageFrom(new URLSearchParams()), 1);
});

test('a valid page number is taken as given', () => {
  assert.equal(pageFrom(new URLSearchParams('page=7')), 7);
});

test('a nonsense page parameter falls back to page 1 rather than erroring', () => {
  for (const raw of ['0', '-3', 'abc', '1.5', '', 'DROP TABLE products']) {
    assert.equal(pageFrom(new URLSearchParams(`page=${encodeURIComponent(raw)}`)), 1, raw);
  }
});

test('the root redirects to the one page this application serves', async () => {
  const result = await route('/');

  assert.equal(result.status, 302);
  assert.equal(result.location, '/product-keywords');
});

test('an unknown path is a 404, not a crash', async () => {
  const result = await route('/does-not-exist');

  assert.equal(result.status, 404);
  assert.equal(result.contentType, 'text/html; charset=utf-8');
  assert.ok(result.body.includes('/product-keywords'));
});

test('a submission is answered with the read-only explanation, not a 404', async () => {
  const result = await routeForm('/product-keywords', new URLSearchParams('sku=X'));

  assert.equal(result.status, 405);
  assert.match(result.body, /only reads the ledsone database/i);
});
