/**
 * Rendering tests.
 *
 * All of it is pure string building, so none of this needs a database.
 *
 * The tests that matter most here are not the ones checking the table has the
 * right columns - they are the ones checking the page does not lie: that an
 * unclassified keyword category says so, and that nothing a member of staff or
 * a supplier typed into `ledsone` can escape into the markup.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOT_RECORDED,
  escapeHtml,
  layout,
  number,
  renderNotFoundPage,
  renderProductKeywordsPage,
  renderReadOnlyPage,
  tableOrEmpty,
} from './render.js';

/** The classification the application actually ships with: nothing is known. */
const nothingKnown = () => ({
  primary: null,
  secondary: null,
  longTail: null,
  competitor: null,
});

const oneProduct = [{ id: 8, sku: 'LHAHE27RO', title: 'Vintage Lamp Holder', keywords: ['e27 holder'] }];

function page(overrides = {}) {
  return renderProductKeywordsPage({
    products: oneProduct,
    total: 1,
    page: 1,
    pageCount: 1,
    pageSize: 50,
    classify: nothingKnown,
    ...overrides,
  });
}

test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
});

test('escapeHtml does not double-build entities', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
});

test('escapeHtml renders null and undefined as empty, not as the words', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('number groups thousands for reading', () => {
  assert.equal(number(44599), '44,599');
});

test('the page carries all seven requested columns, in the requested order', () => {
  const html = page();
  const headings = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings.slice(0, 7), [
    'SKU',
    'Product ID',
    'Product Name',
    'Primary Keyword',
    'Secondary Keywords',
    'Long-Tail Keywords',
    'Competitor Keywords',
  ]);
});

test('the eighth column names the keyword text for what it is: unclassified', () => {
  const html = page();
  const headings = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.equal(headings.length, 8);
  assert.match(headings[7], /unclassified/i);
  assert.match(headings[7], /ledsone/i);
});

test('an unclassified category renders as Not recorded, not as a blank cell', () => {
  const html = page();

  // Four categories, four honest cells.
  const absent = [...html.matchAll(/<td class="absent">Not recorded<\/td>/g)];
  assert.equal(absent.length, 4);
  assert.equal(NOT_RECORDED, 'Not recorded');
});

test('the page never labels keyword text as Primary, Secondary, Long-Tail or Competitor', () => {
  const html = page({
    products: [{ id: 1, sku: 'A', title: 'A product', keywords: ['led bulb', 'e27 screw led bulb warm white'] }],
  });

  // The words appear only as column headings and in the explanatory notice -
  // never in a cell next to a keyword.
  const cells = [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((match) => match[1]);
  const claims = cells.filter((cell) => /Primary|Secondary|Long-Tail|Competitor/i.test(cell));

  assert.deepEqual(claims, [], 'no table cell may claim a keyword classification');
});

test('product values from the database are escaped before they reach the page', () => {
  const html = page({
    products: [
      {
        id: 99,
        sku: '<script>alert(1)</script>',
        title: 'Lamp "quoted" & <b>bold</b>',
        keywords: ['<img src=x onerror=alert(2)>'],
      },
    ],
  });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'a SKU must not inject a script tag');
  assert.ok(!html.includes('<img src=x'), 'keyword text must not inject markup');
  assert.ok(!html.includes('<b>bold</b>'), 'a title must not inject markup');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Lamp &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;'));
});

test('a product with no keyword text says so rather than showing an empty list', () => {
  const html = page({ products: [{ id: 6, sku: 'RD40', title: 'Threaded rod', keywords: [] }] });

  const absent = [...html.matchAll(/<td class="absent">Not recorded<\/td>/g)];
  assert.equal(absent.length, 5, 'four categories plus the keyword column');
  assert.ok(!html.includes('<ul class="kw"></ul>'));
});

test('every recorded keyword is shown, one per list item', () => {
  const html = page({
    products: [{ id: 1, sku: 'A', title: 'A', keywords: ['first keyword', 'second keyword'] }],
  });

  assert.ok(html.includes('<li>first keyword</li>'));
  assert.ok(html.includes('<li>second keyword</li>'));
});

test('the row-count line uses the page size it was given', () => {
  const html = page({ products: oneProduct, total: 200, page: 3, pageCount: 4, pageSize: 50 });
  assert.match(html, /Showing 101/);
});

test('the pager offers next and previous only where a page exists', () => {
  const first = page({ page: 1, pageCount: 3, total: 150 });
  assert.ok(first.includes('page=2'));
  assert.ok(!first.includes('page=0'));

  const last = page({ page: 3, pageCount: 3, total: 150 });
  assert.ok(last.includes('page=2'));
  assert.ok(!last.includes('page=4'));
});

test('a single page of results shows no pager at all', () => {
  assert.ok(!page({ page: 1, pageCount: 1 }).includes('class="pager"'));
});

test('an empty result set shows a message rather than an empty table', () => {
  const html = page({ products: [], total: 0, pageCount: 1 });

  assert.ok(html.includes('No products found.'));
  assert.ok(!html.includes('<tbody>'));
});

test('tableOrEmpty escapes the empty message', () => {
  assert.ok(tableOrEmpty('', '<th>x</th>', '<b>none</b>').includes('&lt;b&gt;none&lt;/b&gt;'));
});

test('the page states plainly that the four categories are not in ledsone', () => {
  const html = page();

  assert.match(html, /ledsone holds no such classification/i);
  assert.match(html, /No competitor keyword source exists in ledsone/i);
  assert.match(html, /Nothing on this page has been guessed or derived/i);
});

test('layout escapes the title and produces a complete document', () => {
  const html = layout({ title: '<x>', body: '<p>hi</p>' });

  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('&lt;x&gt;'));
  assert.ok(!html.includes('<title><x>'));
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('the not-found page points at the one route this application serves', () => {
  assert.ok(renderNotFoundPage().includes('/product-keywords'));
});

test('the read-only page says nothing can be changed through this application', () => {
  assert.match(renderReadOnlyPage(), /only reads the ledsone database/i);
});
