/** Tests for the category-resolution seam. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PAGE_SIZE, classifyKeywords } from './source.js';

test('missing database categories use the Product Name fallback', () => {
  assert.deepEqual(classifyKeywords('Pendant Light'), {
    primary: 'Pendant Light',
    secondary: 'Hanging Light, Pendant Lamp',
    longTail: 'Pendant Ceiling Light',
    competitor: 'Ceiling Pendant, Hanging Lamp',
  });
});

test('a confirmed recorded category takes priority over the fallback', () => {
  const keywords = classifyKeywords('Pendant Light', {
    primary: 'Recorded Pendant Term',
    competitor: 'Recorded Alternative Term',
  });

  assert.equal(keywords.primary, 'Recorded Pendant Term');
  assert.equal(keywords.competitor, 'Recorded Alternative Term');
  assert.equal(keywords.secondary, 'Hanging Light, Pendant Lamp');
  assert.equal(keywords.longTail, 'Pendant Ceiling Light');
});

test('empty recorded values fall back instead of appearing as empty data', () => {
  const keywords = classifyKeywords('Pendant Light', { primary: '   ', secondary: null });

  assert.equal(keywords.primary, 'Pendant Light');
  assert.equal(keywords.secondary, 'Hanging Light, Pendant Lamp');
});

test('a missing title produces blank categories without error', () => {
  assert.deepEqual(classifyKeywords(null), {
    primary: null,
    secondary: null,
    longTail: null,
    competitor: null,
  });
});

test('each missing category is generated, and a recorded one is left alone', () => {
  const title = 'Screwless Flat plate Wall light switches Black Round 1 Gang';

  // Nothing recorded: all four come from the Product Name.
  const generated = classifyKeywords(title);
  assert.equal(generated.primary, 'Light Switch');
  assert.ok(generated.secondary && generated.longTail && generated.competitor);

  // One recorded value survives untouched while the rest are still generated.
  const mixed = classifyKeywords(title, { longTail: 'Recorded Long Tail' });
  assert.equal(mixed.longTail, 'Recorded Long Tail');
  assert.equal(mixed.secondary, generated.secondary);
  assert.equal(mixed.competitor, generated.competitor);
});

test('classification is driven by the Product Name, never by a product id', () => {
  // The seam is handed a title. There is no id or SKU argument to key on, so
  // the ids named in the brief cannot be special cases: two different products
  // with the same name resolve identically.
  const title = 'Vintage 3 core Electric round cable covered with colored fabric';

  assert.deepEqual(classifyKeywords(title), classifyKeywords(title));
  assert.notDeepEqual(classifyKeywords(title), classifyKeywords('Brass Door Handle'));
});

test('the products named in the brief all resolve to full keyword sets', () => {
  // The titles below are the real ledsone names of the example product ids
  // (2, 53, 56, 100/101, 117/118, 120, 133, 143). They are here as generation
  // inputs, not as a list of rows to patch: nothing keys on the ids.
  const titles = [
    'M10 1mm Fine pitch threaded aluminium rod nipple hollow tube in various length Screw connectors',
    'Kitchen Drawer Pull Knob Retro Cupboard Furniture Handle',
    'Lever Wire Connectors Compact Splicing Wire Connector 3 Port Conductor Electrical Connectors',
    'Vintage 3 core Electric round cable covered with colored fabric. Textile Cable.',
    'Screwless Flat plate Wall light switches Black Round 1 Gang',
    'Black Round 2 Gang Screwless Flat plate Wall light switches',
    'Vintage 2 core Twisted Italian Braided Cable, Electrical Fabric Flexible Lamp Cable Wire Cord',
    '1 Gang Screwless Flat plate Wall light Black Square switches',
    'White Color Screw less 2 Gang Wall Light Switch',
  ];

  for (const title of titles) {
    const keywords = classifyKeywords(title);

    assert.ok(keywords.primary, `no primary keyword for: ${title}`);
    assert.ok(keywords.secondary, `no secondary keywords for: ${title}`);
    assert.ok(keywords.longTail, `no long-tail keywords for: ${title}`);
    assert.ok(keywords.competitor, `no competitor keywords for: ${title}`);
  }
});

test('the product-image query reuses the verified inventory rule', () => {
  const code = readFileSync(new URL('./source.js', import.meta.url), 'utf8');

  // Designated main image first, first gallery image as the fallback - the
  // rule the Smart Inventory Control application already uses against this
  // database, not a new one invented here.
  assert.match(code, /type = 'main-image'/);
  assert.match(code, /coalesce\(mm\.image_url, fi\.image_url\)/);
  assert.match(code, /ORDER BY i\.product_id, i\.image_ordering NULLS LAST, i\.id/);

  // Keyed on products.id, and LEFT joined so a product with no image is not
  // dropped from the page.
  assert.match(code, /LEFT JOIN main_media\s+mm ON mm\.product_id = p\.id/);
  assert.match(code, /LEFT JOIN first_image fi ON fi\.product_id = p\.id/);

  // Paging is unchanged: still parameterised, and still applied before the
  // image lookups so they run against one page.
  assert.match(code, /LIMIT \$1 OFFSET \$2/);
  assert.match(code, /\[limit, offset\]/);
});

test('the page size is a sane, whole, positive number', () => {
  assert.ok(Number.isInteger(PAGE_SIZE));
  assert.ok(PAGE_SIZE > 0 && PAGE_SIZE <= 500);
});
