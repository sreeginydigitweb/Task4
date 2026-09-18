/**
 * Tests for product categories and the index the filter runs on.
 *
 * `categoryFor` and `buildIndex` are pure, so none of this needs a database.
 *
 * The check that matters most is the order of the two sources: ledsone's own
 * recorded category always wins, and a category is only derived from the
 * product name where the database records none.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ALL_CATEGORIES,
  buildIndex,
  categoryFor,
  categorySource,
} from './categories.js';

/** A catalogue row as the index query returns it. */
const row = (id, title, product_type = null) => ({ id, title, product_type });

// ---------------------------------------------------------------------------
// Where one product's category comes from.
// ---------------------------------------------------------------------------

test("ledsone's own recorded category wins", () => {
  assert.equal(categoryFor('Vintage Brass Pendant Light', 'Pendant Lighting'), 'Pendant Lighting');
  assert.equal(categorySource('Vintage Brass Pendant Light', 'Pendant Lighting'), 'ledsone');
});

test('a recorded category is used exactly as the business stores it', () => {
  // Not merged, not translated, not tidied - editing the business's own data
  // on a guess would be worse than showing it.
  for (const recorded of ['Pendant_Lamp_Lights', 'LIGHT_FIXTURE', 'Pendelleuchten', 'Ceiling Lights & Chandeliers']) {
    assert.equal(categoryFor('Some product', recorded), recorded);
  }
});

test('a blank recorded category counts as missing, not as data', () => {
  for (const blank of [null, undefined, '', '   ', 42]) {
    assert.equal(categoryFor('Screwless Wall light switches', blank), 'Light Switch');
  }
});

test('a recorded category is trimmed', () => {
  assert.equal(categoryFor('anything', '  Wall Light  '), 'Wall Light');
});

test('with nothing recorded, the category is derived from the product name', () => {
  assert.equal(categoryFor('Vintage Metal E27 Bulb Socket Lamp Holder', null), 'Lamp Holder');
  assert.equal(categorySource('Vintage Metal E27 Bulb Socket Lamp Holder', null), 'product-name');
});

test('a derived category is the product type the name already states', () => {
  // The same terminology map that produces the Primary Keyword, not a second
  // vocabulary invented for categories.
  const cases = [
    ['Screwless Flat plate Wall light switches Black Round 1 Gang', 'Light Switch'],
    ['Vintage 3 core Electric round cable covered with colored fabric', 'Lighting Cable'],
    ['Kitchen Drawer Pull Knob Retro Cupboard Furniture Handle', 'Cabinet Knob'],
    ['Modern Metal Green Brass Easy Fit Cone Shape Lampshade', 'Lamp Shade'],
  ];

  for (const [title, expected] of cases) {
    assert.equal(categoryFor(title, null), expected, title);
  }
});

test('a name with no product terminology has no category at all', () => {
  for (const title of ['Combo Default Title.', 'Nect bottle holder-copper', '', null, undefined]) {
    assert.equal(categoryFor(title, null), null, String(title));
    assert.equal(categorySource(title, null), 'none');
  }
});

test('categorising is deterministic and never keyed on a product id', () => {
  assert.equal(categoryFor.length, 2, 'a title and a recorded value, nothing else');
  assert.equal(categoryFor('Pendant Light Fitting', null), categoryFor('Pendant Light Fitting', null));
});

// ---------------------------------------------------------------------------
// The index the filter runs on.
// ---------------------------------------------------------------------------

const CATALOGUE = [
  row(1, 'Brass Door Handle', 'Door Hardware'),
  row(2, 'Steel Door Handle', 'Door Hardware'),
  row(3, 'Vintage Pendant Light', 'Pendant Lighting'),
  row(4, 'Wall light switches 1 Gang', null), // derived -> Light Switch
  row(5, 'Combo Default Title.', null), // no category
  row(6, 'Another Pendant Light Fitting', 'Pendant Lighting'),
  row(7, 'Pendant Light with no listing', null), // derived -> Pendant Light
];

test('the index counts every product that has a category', () => {
  const index = buildIndex(CATALOGUE);

  assert.equal(index.total, 7);
  assert.equal(index.withCategory, 6, 'one product has no category');
});

test('the index groups products under both recorded and derived categories', () => {
  const { idsByCategory } = buildIndex(CATALOGUE);

  assert.deepEqual(idsByCategory.get('Door Hardware'), [1, 2]);
  assert.deepEqual(idsByCategory.get('Pendant Lighting'), [3, 6]);
  assert.deepEqual(idsByCategory.get('Light Switch'), [4], 'derived from the name');
  assert.deepEqual(idsByCategory.get('Pendant Light'), [7], 'derived, and distinct from the recorded one');
});

test('a product with no category is in no category at all', () => {
  const { idsByCategory } = buildIndex(CATALOGUE);

  for (const ids of idsByCategory.values()) {
    assert.ok(!ids.includes(5), 'the uncategorised product is not grouped anywhere');
  }
});

test('categories are offered busiest first, then alphabetically', () => {
  const { categories } = buildIndex(CATALOGUE);

  assert.deepEqual(categories, [
    { name: 'Door Hardware', count: 2 },
    { name: 'Pendant Lighting', count: 2 },
    { name: 'Light Switch', count: 1 },
    { name: 'Pendant Light', count: 1 },
  ]);
});

test('the counts add up to the number of categorised products', () => {
  const index = buildIndex(CATALOGUE);
  const summed = index.categories.reduce((total, { count }) => total + count, 0);

  assert.equal(summed, index.withCategory);
});

test('ids keep catalogue order, so a filtered list pages in the same order', () => {
  const { idsByCategory } = buildIndex([...CATALOGUE].reverse().reverse());

  assert.deepEqual(idsByCategory.get('Door Hardware'), [1, 2]);
});

test('an empty catalogue produces an empty index rather than an error', () => {
  const index = buildIndex([]);

  assert.equal(index.total, 0);
  assert.equal(index.withCategory, 0);
  assert.deepEqual(index.categories, []);
});

test('All Categories is the empty value', () => {
  assert.equal(ALL_CATEGORIES, '');
});

// ---------------------------------------------------------------------------
// The relationship to inventory.products.
// ---------------------------------------------------------------------------

test('the recorded category is read from ledsone and joined by SKU', () => {
  const code = readFileSync(new URL('./categories.js', import.meta.url), 'utf8');

  // listings.shopify_listings.product_type, one listing per SKU - the rule
  // Smart Inventory Control already uses against this database.
  assert.match(code, /\$\{LISTINGS_SCHEMA\}\.shopify_listings/);
  assert.match(code, /l\.product_type/);
  assert.match(code, /DISTINCT ON \(coalesce\(nullif\(l\.mapped_sku, ''\), l\.sku\)\)/);
  assert.match(code, /ORDER BY 1, l\.updated_at DESC NULLS LAST, l\.id DESC/);

  // Joined to products by SKU, and LEFT so an uncategorised product is kept.
  assert.match(code, /LEFT JOIN shopify s ON s\.sku = p\.sku/);
  assert.match(code, /FROM \$\{INVENTORY_SCHEMA\}\.products p/);
});

test('no category data is written back, and no other category table is read', () => {
  const code = readFileSync(new URL('./categories.js', import.meta.url), 'utf8');
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

  for (const write of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i, /\bCREATE\s+TABLE\b/i]) {
    assert.doesNotMatch(withoutComments, write, 'categories are never written to the database');
  }

  // The other category-ish tables in ledsone belong to other applications.
  for (const elsewhere of ['ph_categories', 'ph_category_products', 'bandq_categories', 'shopify_collections', 'merchant_products']) {
    assert.ok(!withoutComments.includes(elsewhere), `categories.js must not read ${elsewhere}`);
  }
});
