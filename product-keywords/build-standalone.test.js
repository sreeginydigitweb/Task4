/**
 * Tests for the standalone build.
 *
 * Two halves, and the split matters:
 *
 *   - `encodeDataset` and `buildStandaloneHtml` are pure. They are tested here
 *     with hand-written rows, no database, like everything else in the suite.
 *
 *   - The GENERATED index.html is a build artefact. It is only checked when it
 *     exists, because a clean checkout has not built it yet and a test that
 *     failed for that reason would be noise rather than a finding. When it IS
 *     there, the checks are the ones that matter for a file somebody opens by
 *     double-clicking: no credentials, no external dependency, no server.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { COLUMNS, buildStandaloneHtml, encodeDataset } from './build-standalone.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const INDEX = join(PROJECT, 'index.html');

/** A product as findProductKeywordPage hands it over, with its evidence. */
const product = (over = {}) => ({
  id: 1,
  sku: 'HLBP128BB',
  title: 'Brass Door Handle',
  image: 'https://sin1.contabostorage.com/bucket/img/1.jpg',
  category: 'Door Handle',
  evidence: [],
  // Where ledsone records this product as listed - see listing-facets.js.
  // Both are lists, because a product is normally listed several times over.
  marketplaces: ['UK', 'Germany'],
  platforms: ['EBAY', 'AMAZON'],
  ...over,
});

/** Evidence that proves a phrase, shaped as resources.js produces it. */
const record = (text, over = {}) => ({
  source: 'amazon',
  label: 'Amazon',
  kind: 'search-keywords',
  detail: 'listings.amazon_listing_search_engine_keywords.keyword',
  text,
  ...over,
});

const dataset = (products) => encodeDataset(products);

// ---------------------------------------------------------------------------
// The encoding keeps everything and repeats nothing.
// ---------------------------------------------------------------------------

test('every product survives the encoding', () => {
  const { data, counts } = dataset([product(), product({ id: 2, sku: 'B' }), product({ id: 3, sku: 'C' })]);

  assert.equal(data.rows.length, 3);
  assert.equal(counts.products, 3);
  assert.deepEqual(data.rows.map((row) => row[0]), [1, 2, 3], 'ids kept');
  assert.deepEqual(data.rows.map((row) => row[1]), ['HLBP128BB', 'B', 'C'], 'SKUs kept');
});

test('a repeated product name is stored once and referenced', () => {
  // This is what makes the whole catalogue a file worth opening: 37,786
  // products share one placeholder name.
  const many = Array.from({ length: 50 }, (_, at) => product({ id: at + 1, sku: `S${at}`, title: 'Combo Default Title.' }));
  const { data } = dataset(many);

  assert.equal(data.titles.length, 1, 'one distinct title stored');
  assert.deepEqual([...new Set(data.rows.map((row) => row[2]))], [0], 'every row points at it');
});

test('a resource keeps BOTH its slug and its business name', () => {
  // The slug picks the pill colour and the name is what the reader sees. Every
  // storefront shares the slug "shopify" while naming a different business, so
  // losing either one would be wrong in a different way.
  const { data } = dataset([
    product({ evidence: [record('door handle brass', { source: 'shopify', label: 'Vintagelite', kind: 'tag' })] }),
    product({ id: 2, sku: 'B', evidence: [record('door handle brass', { source: 'shopify', label: 'Electricalsone', kind: 'tag' })] }),
  ]);

  const names = data.resources.map(([, label]) => label);
  const slugs = data.resources.map(([slug]) => slug);

  assert.ok(names.includes('Vintagelite') && names.includes('Electricalsone'), 'both businesses named');
  assert.deepEqual([...new Set(slugs)], ['shopify'], 'and both share the colour');
});

test('a keyword nothing proves is written short, with no resource', () => {
  const { data, counts } = dataset([product({ evidence: [] })]);
  const primary = data.rows[0][5];

  assert.equal(primary.length, 1, 'one primary keyword');
  assert.equal(primary[0].length, 1, 'term only - no resource, no tooltip');
  assert.equal(counts.proven, 0);
});

test('a proven keyword carries its resource and the record that proved it', () => {
  const { data, counts } = dataset([product({ evidence: [record('vintage brass door handles for cupboards')] })]);
  const primary = data.rows[0][5];

  assert.equal(primary[0].length, 3, 'term, resource, tooltip');
  assert.equal(data.resources[primary[0][1]][1], 'Amazon');
  assert.match(data.details[primary[0][2]], /listings\.amazon_listing_search_engine_keywords\.keyword/);
  assert.ok(counts.proven >= 1);
});

test('the image host is stored once, not per product', () => {
  const many = Array.from({ length: 20 }, (_, at) =>
    product({ id: at + 1, sku: `S${at}`, image: `https://sin1.contabostorage.com/bucket/img/${at}.jpg` }));
  const { data, counts } = dataset(many);

  assert.equal(data.prefixes.length, 1, 'one host stored');
  assert.equal(counts.withImage, 20);
  assert.ok(data.rows.every((row) => row[3][1].endsWith('.jpg')), 'each row keeps its own path');
});

test('a product with no image gets no image, not a placeholder', () => {
  for (const missing of [null, undefined, '']) {
    const { data, counts } = dataset([product({ image: missing })]);

    assert.equal(data.rows[0][3], null, String(missing));
    assert.equal(counts.withImage, 0);
  }
});

test('a product with no category is encoded as absent, never as a guess', () => {
  const { data } = dataset([product({ category: null })]);

  assert.equal(data.rows[0][4], -1);
  assert.equal(data.categoryOrder.length, 0, 'and it counts towards no category');
});

test('categories are counted and ordered busiest first', () => {
  const { data } = dataset([
    product({ id: 1, sku: 'A', category: 'Lamp Holder' }),
    product({ id: 2, sku: 'B', category: 'Door Handle' }),
    product({ id: 3, sku: 'C', category: 'Lamp Holder' }),
    product({ id: 4, sku: 'D', category: 'Lamp Holder' }),
  ]);

  const ordered = data.categoryOrder.map(([index, count]) => [data.categories[index], count]);
  assert.deepEqual(ordered, [['Lamp Holder', 3], ['Door Handle', 1]]);
});

test('keyword counts are the real totals, per column', () => {
  const { counts } = dataset([product(), product({ id: 2, sku: 'B' })]);

  for (const column of ['primary', 'secondary', 'longTail', 'competitor']) {
    assert.ok(Number.isInteger(counts[column]), `${column} counted`);
  }
  assert.equal(counts.primary, 2, 'one primary keyword per product');
});

// ---------------------------------------------------------------------------
// Marketplace and Platform: ledsone's own record of where a product is listed.
// ---------------------------------------------------------------------------

test('a product keeps EVERY marketplace and platform it is listed on', () => {
  const { data } = dataset([product({ marketplaces: ['UK', 'Germany', 'France'], platforms: ['EBAY', 'SHOPIFY'] })]);
  const row = data.rows[0];

  assert.deepEqual(row[9].map((at) => data.marketplaces[at]), ['UK', 'Germany', 'France'], 'all three kept');
  assert.deepEqual(row[10].map((at) => data.platforms[at]), ['EBAY', 'SHOPIFY'], 'both kept');
});

test('a product listed nowhere gets two empty lists, never an invented value', () => {
  for (const missing of [[], null, undefined]) {
    const { data } = dataset([product({ marketplaces: missing, platforms: missing })]);

    assert.deepEqual(data.rows[0][9], [], String(missing));
    assert.deepEqual(data.rows[0][10], [], String(missing));
    assert.deepEqual(data.marketplaceOrder, [], 'and it counts towards no marketplace');
    assert.deepEqual(data.platformOrder, [], 'and towards no platform');
  }
});

test('marketplaces and platforms are counted per PRODUCT and ordered busiest first', () => {
  const { data } = dataset([
    product({ id: 1, sku: 'A', marketplaces: ['UK', 'UK', 'Germany'], platforms: ['EBAY'] }),
    product({ id: 2, sku: 'B', marketplaces: ['UK'], platforms: ['EBAY', 'AMAZON'] }),
    product({ id: 3, sku: 'C', marketplaces: ['UK', 'France'], platforms: ['AMAZON'] }),
  ]);

  assert.deepEqual(
    data.marketplaceOrder.map(([at, count]) => [data.marketplaces[at], count]),
    [['UK', 3], ['France', 1], ['Germany', 1]],
    'listed twice in the UK is still one UK product',
  );
  assert.deepEqual(
    data.platformOrder.map(([at, count]) => [data.platforms[at], count]),
    [['AMAZON', 2], ['EBAY', 2]],
  );
});

test('a repeated marketplace name is stored once and referred to by number', () => {
  const many = Array.from({ length: 40 }, (_, at) =>
    product({ id: at + 1, sku: `S${at}`, marketplaces: ['UK'], platforms: ['EBAY'] }));
  const { data } = dataset(many);

  assert.deepEqual(data.marketplaces, ['UK']);
  assert.deepEqual(data.platforms, ['EBAY']);
  assert.ok(data.rows.every((row) => row[9][0] === 0 && row[10][0] === 0));
});

test('the keyword columns keep their positions when the facets are added', () => {
  // The two lists sit at the END of the row for exactly this reason.
  const { data } = dataset([product({ evidence: [record('brass door handle')] })]);
  const row = data.rows[0];

  assert.equal(row[4], data.categories.indexOf('Door Handle'), 'category is still position 4');
  for (const at of [5, 6, 7, 8]) assert.ok(Array.isArray(row[at]), `keyword column at ${at}`);
  assert.ok(row[5].length > 0, 'and the primary keyword is still there');
});

// ---------------------------------------------------------------------------
// The generated document.
// ---------------------------------------------------------------------------

const html = (products = [product()]) => {
  const { data, counts } = dataset(products);
  return buildStandaloneHtml({ data, counts, styles: '.x {}' });
};

test('the document has exactly the nine required columns, in order', () => {
  const headings = [...html().matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);

  assert.deepEqual(headings, [
    'Product Image', 'SKU', 'Product ID', 'Product Name', 'Category',
    'Primary Keyword', 'Secondary Keywords', 'Long-Tail Keywords', 'Competitor Keywords',
  ]);
  assert.deepEqual(headings, COLUMNS);
  assert.ok(!headings.some((h) => /^tags?$/i.test(h)), 'no Tags column');
});

test('the document carries the filter controls the UI needs', () => {
  const document = html();

  for (const id of ['search', 'category', 'marketplace', 'platform', 'clear-filter',
    'prev-top', 'next-top', 'position-top', 'count-top',
    'prev-bottom', 'next-bottom', 'position-bottom', 'count-bottom', 'rows', 'empty']) {
    assert.ok(document.includes(`id="${id}"`), `${id} is present`);
  }
});

test('there is no Apply button - each control applies itself', () => {
  const document = html();

  assert.ok(!document.includes('id="apply"'), 'no Apply button');
  assert.doesNotMatch(document, />\s*Apply\s*</, 'and nothing labelled Apply');

  // Clear Filters is the only button left in the filter card.
  const card = /<div class="filter">[\s\S]*?<\/div>\s*<\/div>/.exec(document)[0];
  const buttons = [...card.matchAll(/<button[^>]*id="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons, ['clear-filter']);

  // The script must not reach for it either.
  assert.doesNotMatch(document, /el\('apply'\)/);
});

test('the search box applies on Enter, and the dropdowns on change', () => {
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(html())[1];

  assert.match(script, /el\('search'\)\.addEventListener\('keydown'/, 'Enter applies the search');
  assert.match(script, /event\.key === 'Enter'/);
  assert.match(script, /el\(FILTERS\[f\]\)\.addEventListener\('change'/, 'each dropdown applies on change');
  assert.match(script, /var FILTERS = \['category', 'marketplace', 'platform'\]/);
});

test('nothing is loaded from outside the file', () => {
  const document = html();

  assert.doesNotMatch(document, /<script[^>]+\bsrc=/i, 'no external script');
  assert.doesNotMatch(document, /<link\b/i, 'no external stylesheet');
  assert.doesNotMatch(document, /@import/i);
  assert.doesNotMatch(document, /<iframe|<object|<embed/i);

  // Outside the data block there must be no URL at all.
  const outsideData = document.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(outsideData, /https?:\/\//, 'the document itself references no URL');
});

test('the document never reaches for a server or a database', () => {
  const document = html();

  assert.doesNotMatch(document, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(document, /localhost|127\.0\.0\.1|:3100|\/api\b/);
  assert.doesNotMatch(document, /\bSELECT\b.*\bFROM\b/i, 'no SQL');
});

test('no credential can reach the generated file', () => {
  const document = html();

  for (const pattern of [
    /password\s*[:=]/i, /passwd|pwd\s*[:=]/i, /\bDB_(PASSWORD|USER|HOST|PORT|NAME)\b/,
    /postgres(ql)?:\/\//i, /\bconnectionString\b/i, /\bvarmen_user\b/, /sslmode=/i, /\b5432\b/,
    /169\.58\.91\.229/,
  ]) {
    assert.doesNotMatch(document, pattern, `${pattern} must never appear`);
  }
});

test('product text cannot become markup', () => {
  const nasty = '</script><img src=x onerror=alert(1)>';
  const document = html([product({ title: nasty, sku: nasty })]);

  // The data block cannot be ended by a product value.
  const block = /<script type="application\/json" id="product-data">([\s\S]*?)<\/script>/.exec(document)?.[1];
  assert.ok(block, 'the data block is still intact');
  assert.ok(!block.includes('</script>'), 'no product value can close the element');
  assert.ok(JSON.parse(block).titles.includes(nasty), 'and the value itself is kept exactly');
});

test('the embedded block is data, and parses', () => {
  const document = html([product(), product({ id: 2, sku: 'B' })]);
  const block = /<script type="application\/json" id="product-data">([\s\S]*?)<\/script>/.exec(document)[1];
  const data = JSON.parse(block);

  assert.equal(data.rows.length, 2);
  assert.deepEqual(
    Object.keys(data).sort(),
    [
      'categories', 'categoryOrder', 'details', 'marketplaceOrder', 'marketplaces',
      'platformOrder', 'platforms', 'prefixes', 'resources', 'rows', 'terms', 'titles',
    ],
  );
});

test('a generation method is never written as a resource name', () => {
  // The whole provenance rule, enforced on the artefact this time.
  const { data } = dataset([product({ evidence: [record('brass door handles')] })]);

  for (const [, label] of data.resources) {
    assert.ok(
      !['GEN', 'MIX', 'Generated', 'Terminology', 'Product Name', 'Product Type', 'Product Name + Type'].includes(label),
      `"${label}" is a method, not a resource`,
    );
  }
});

test('the document carries a Marketplace and a Platform dropdown, beside Categories', () => {
  const document = html([
    product({ id: 1, sku: 'A', marketplaces: ['UK'], platforms: ['EBAY'] }),
    product({ id: 2, sku: 'B', marketplaces: ['Germany'], platforms: ['AMAZON'] }),
  ]);

  assert.match(document, /<label for="marketplace">Marketplace<\/label>/);
  assert.match(document, /<label for="platform">Platform<\/label>/);

  // Beside Categories, and in the required order.
  const order = ['id="category"', 'id="marketplace"', 'id="platform"'].map((id) => document.indexOf(id));
  assert.ok(order.every((at) => at > -1) && order[0] < order[1] && order[1] < order[2], 'Search, Categories, Marketplace, Platform');
  assert.ok(document.indexOf('id="search"') < order[0], 'Search comes first');
  assert.ok(order[2] < document.indexOf('id="clear-filter"'), 'Clear Filters comes last');
});

test('the dropdowns list the real values with their counts, and an All option', () => {
  const document = html([
    product({ id: 1, sku: 'A', marketplaces: ['UK'], platforms: ['EBAY'] }),
    product({ id: 2, sku: 'B', marketplaces: ['UK', 'Germany'], platforms: ['AMAZON'] }),
  ]);

  const list = (id) => /<select id="([a-z]+)">([\s\S]*?)<\/select>/g;
  const selects = Object.fromEntries([...document.matchAll(list())].map((m) => [m[1], m[2]]));

  assert.match(selects.marketplace, /<option value="" selected>All Marketplaces \(2\)<\/option>/);
  assert.match(selects.marketplace, />UK \(2\)</);
  assert.match(selects.marketplace, />Germany \(1\)</);
  assert.match(selects.platform, /<option value="" selected>All Platforms \(2\)<\/option>/);
  assert.match(selects.platform, />EBAY \(1\)</);
  assert.match(selects.platform, />AMAZON \(1\)</);
});

test('adding the two filters adds no table column', () => {
  const headings = [...html().matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);

  assert.equal(headings.length, 9);
  assert.ok(!headings.some((h) => /marketplace|platform/i.test(h)), 'neither is a column');
});

// ---------------------------------------------------------------------------
// The built artefact, when it exists.
// ---------------------------------------------------------------------------

const built = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : null;
const builtData = built
  ? JSON.parse(/<script type="application\/json" id="product-data">([\s\S]*?)<\/script>/.exec(built)[1])
  : null;

test('the built index.html holds the whole catalogue, not a sample', { skip: !built }, () => {
  // The point of the build. 500 would mean the snapshot was copied instead.
  assert.ok(builtData.rows.length > 10_000, `only ${builtData.rows.length} products embedded`);
  assert.notEqual(builtData.rows.length, 500, 'this must not be the 500-product snapshot');
});

test('the built index.html has exactly nine columns and no Tags column', { skip: !built }, () => {
  const headings = [...built.matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);

  assert.deepEqual(headings, COLUMNS);
  assert.ok(!headings.some((h) => /^tags?$/i.test(h)));
});

test('the built index.html embeds no credential and no external dependency', { skip: !built }, () => {
  assert.doesNotMatch(built, /\bDB_(PASSWORD|USER|HOST)\b|varmen_user|169\.58\.91\.229|postgres(ql)?:\/\//i);
  assert.doesNotMatch(built, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(built, /<link\b/i);
  assert.doesNotMatch(built, /\bfetch\(|XMLHttpRequest|localhost/);
});

test('every resource in the built file is a real place, never a method', { skip: !built }, () => {
  const banned = ['GEN', 'MIX', 'Generated', 'Terminology', 'Product Name', 'Product Type', 'Product Name + Type'];

  for (const [slug, label] of builtData.resources) {
    assert.ok(!banned.includes(label), `"${label}" is a method, not a resource`);
    assert.ok(slug && label, 'every resource has both a colour and a name');
  }
});

test('the built index.html carries no Apply button', { skip: !built }, () => {
  assert.ok(!built.includes('id="apply"'), 'no Apply button in the built file');
  assert.doesNotMatch(built, /el\('apply'\)/, 'and the script does not reach for one');
  assert.ok(built.includes('id="clear-filter"'), 'Clear Filters is still there');
  assert.match(built, /el\('search'\)\.addEventListener\('keydown'/, 'Enter still applies the search');
});

test('the built index.html carries both new dropdowns, built from the database', { skip: !built }, () => {
  assert.match(built, /<label for="marketplace">Marketplace<\/label>/);
  assert.match(built, /<label for="platform">Platform<\/label>/);

  assert.ok(builtData.marketplaces.length > 0, 'the marketplace list is not empty');
  assert.ok(builtData.platforms.length > 0, 'the platform list is not empty');
  assert.equal(builtData.marketplaceOrder.length, builtData.marketplaces.length);
  assert.equal(builtData.platformOrder.length, builtData.platforms.length);

  // Real values, and every one of them actually used by a product.
  for (const value of [...builtData.marketplaces, ...builtData.platforms]) {
    assert.equal(typeof value, 'string');
    assert.notEqual(value.trim(), '');
  }
  for (const [, count] of [...builtData.marketplaceOrder, ...builtData.platformOrder]) {
    assert.ok(count > 0, 'no option names a value no product has');
  }
});

test('the built rows carry their marketplaces and platforms, one-to-many', { skip: !built }, () => {
  assert.ok(builtData.rows.every((row) => Array.isArray(row[9]) && Array.isArray(row[10])), 'every row has both lists');

  const many = builtData.rows.filter((row) => row[9].length > 1);
  assert.ok(many.length > 0, 'a product in several marketplaces keeps all of them');

  const none = builtData.rows.filter((row) => row[9].length === 0 && row[10].length === 0);
  assert.ok(none.length > 0, 'and a product listed nowhere keeps neither');

  const marketplaces = builtData.marketplaces.length;
  const platforms = builtData.platforms.length;
  for (const row of builtData.rows) {
    for (const at of row[9]) assert.ok(at >= 0 && at < marketplaces, 'marketplace index is in range');
    for (const at of row[10]) assert.ok(at >= 0 && at < platforms, 'platform index is in range');
  }
});

test('the built file is a sane size for something a person opens', { skip: !built }, () => {
  const mb = statSync(INDEX).size / 1024 / 1024;

  assert.ok(mb > 1, `${mb.toFixed(2)}MB looks too small for the whole catalogue`);
  assert.ok(mb < 60, `${mb.toFixed(2)}MB is too large to open comfortably`);
});
