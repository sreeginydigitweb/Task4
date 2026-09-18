/**
 * Rendering tests.
 *
 * All of it is pure string building, so none of this needs a database.
 *
 * The tests that matter most here are not the ones checking the table has the
 * right columns - they are the ones checking the page does not lie: unavailable
 * categories are genuinely blank, and product values cannot escape into markup.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  escapeHtml,
  layout,
  number,
  renderNotFoundPage,
  renderProductKeywordsPage,
  renderReadOnlyPage,
} from './render.js';

/** product-keywords/page.html - the UI file the application fills in. */
const TEMPLATE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');

/** The classification the application actually ships with: nothing is known. */
const nothingKnown = () => ({
  primary: null,
  secondary: null,
  longTail: null,
  competitor: null,
});

const oneProduct = [{ id: 8, sku: 'LHAHE27RO', title: 'Vintage Lamp Holder' }];

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

/** The eight columns, in the order the requirement sets. */
const COLUMNS = [
  'Product Image',
  'SKU',
  'Product ID',
  'Product Name',
  'Primary Keyword',
  'Secondary Keywords',
  'Long-Tail Keywords',
  'Competitor Keywords',
];

test('the table contains exactly the eight requested columns, in the requested order', () => {
  const html = page();
  const headings = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings, COLUMNS);
  assert.equal(headings[0], 'Product Image', 'the image is the first column');
});

test('the old unclassified keyword column is absent', () => {
  const html = page();
  assert.ok(!html.includes('Keywords recorded (unclassified)'));
  assert.ok(!html.includes('Keywords recorded in ledsone (unclassified)'));
});

test('unavailable keyword categories render as four actual blank table cells', () => {
  const html = page();
  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  const cells = [...row.matchAll(/<td(?: [^>]*)?>(.*?)<\/td>/g)].map((match) => match[1]);

  assert.equal(cells.length, 8);
  assert.deepEqual(cells.slice(4), ['', '', '', '']);
  assert.ok(!html.includes('Not recorded'));
});

test('generated keyword categories render in their existing four cells', () => {
  const html = page({
    products: [{ id: 9, sku: 'PL1', title: 'Pendant Light' }],
    classify: (product) => ({
      primary: product.title,
      secondary: 'Hanging Light',
      longTail: 'Pendant Ceiling Light',
      competitor: 'Ceiling Pendant',
    }),
  });

  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  const cells = [...row.matchAll(/<td(?: [^>]*)?>(.*?)<\/td>/g)].map((match) => match[1]);
  assert.deepEqual(cells.slice(4), ['Pendant Light', 'Hanging Light', 'Pendant Ceiling Light', 'Ceiling Pendant']);
});

test('the page never places a keyword classification claim in a table cell', () => {
  const html = page({
    products: [{ id: 1, sku: 'A', title: 'A product' }],
  });

  // The words appear only as column headings and in the explanatory notice.
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
      },
    ],
  });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'a SKU must not inject a script tag');
  assert.ok(!html.includes('<b>bold</b>'), 'a title must not inject markup');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Lamp &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;'));
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

test('a single page of results hides both control bars', () => {
  // The bars are part of page.html, so they are always in the markup. With one
  // page there is nowhere to go, so they carry the plain HTML `hidden`
  // attribute and the browser does not paint them.
  const html = page({ page: 1, pageCount: 1 });

  assert.ok(html.includes('class="controls controls-top" hidden>'));
  assert.ok(html.includes('class="controls controls-bottom" hidden>'));
  assert.ok(!html.includes('href="/product-keywords?page='), 'no page to link to');
});

// ---------------------------------------------------------------------------
// page.html is the UI. These tests read the FILE, not the rendered output, so
// they fail if the structure drifts back into JavaScript.
// ---------------------------------------------------------------------------

test('page.html is a complete HTML document', () => {
  assert.ok(TEMPLATE.startsWith('<!doctype html>'));
  assert.match(TEMPLATE, /<html lang="en">/);
  assert.match(TEMPLATE, /<head>/);
  assert.match(TEMPLATE, /<meta charset="utf-8">/);
  assert.match(TEMPLATE, /<meta name="viewport"/);
  assert.match(TEMPLATE, /<title>[^<]+<\/title>/);
  assert.match(TEMPLATE, /<body>/);
  assert.ok(TEMPLATE.trimEnd().endsWith('</html>'));
});

test('page.html contains all of the CSS', () => {
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

  for (const rule of ['.table-scroll', '.controls', '.pager .btn', '.count', 'th, td', ':root']) {
    assert.ok(styles.includes(rule), `${rule} must be styled in page.html`);
  }
  assert.ok(styles.length > 1000, 'the whole stylesheet lives in page.html');
});

test('page.html contains the complete table structure', () => {
  assert.match(TEMPLATE, /<div class="table-scroll">/);
  assert.match(TEMPLATE, /<table>/);
  assert.match(TEMPLATE, /<thead>/);
  assert.match(TEMPLATE, /<\/thead>/);
  assert.match(TEMPLATE, /<tbody>/);
  assert.match(TEMPLATE, /<\/tbody>/);
  assert.match(TEMPLATE, /<\/table>/);
});

test('page.html contains all eight table headers, in order', () => {
  const headings = [...TEMPLATE.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings, COLUMNS);
});

test('page.html contains the Product Image header, first', () => {
  assert.ok(TEMPLATE.includes('<th>Product Image</th>'));

  const image = TEMPLATE.indexOf('<th>Product Image</th>');
  const sku = TEMPLATE.indexOf('<th>SKU</th>');
  assert.ok(image > 0 && image < sku, 'Product Image comes before SKU');
});

test('page.html styles the image cell without any external stylesheet', () => {
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

  assert.ok(styles.includes('td.img'), 'the image cell is styled in page.html');
  assert.match(styles, /td\.img img\s*\{[\s\S]*?width:/, 'the image has a size');
  assert.doesNotMatch(TEMPLATE, /<link\b/i, 'no external stylesheet');
});

test('page.html contains the heading and the count area', () => {
  assert.match(TEMPLATE, /<h1>Product Keywords<\/h1>/);
  assert.match(TEMPLATE, /<p class="count">\{\{count_text\}\}<\/p>/);
});

test('page.html contains both control areas and their button markup', () => {
  assert.match(TEMPLATE, /<div class="controls controls-top"/);
  assert.match(TEMPLATE, /<div class="controls controls-bottom"/);
  assert.equal((TEMPLATE.match(/<nav class="pager"/g) ?? []).length, 2);

  // The buttons themselves - tag, class and label - are written out here.
  assert.equal((TEMPLATE.match(/<a class="btn" \{\{prev_attrs\}\}>&larr; Previous<\/a>/g) ?? []).length, 2);
  assert.equal((TEMPLATE.match(/<a class="btn" \{\{next_attrs\}\}>Next &rarr;<\/a>/g) ?? []).length, 2);
});

test('page.html marks where dynamic data is inserted, with comments', () => {
  assert.match(TEMPLATE, /<!--[\s\S]*?Dynamic product count/);
  assert.match(TEMPLATE, /<!--[\s\S]*?Dynamic product rows inserted here/);
  assert.match(TEMPLATE, /TOP CONTROLS \/ PAGINATION/);
  assert.match(TEMPLATE, /BOTTOM CONTROLS \/ PAGINATION/);
});

test('page.html holds no credentials, queries or secrets', () => {
  assert.doesNotMatch(TEMPLATE, /\bSELECT\b|\bFROM\s+inventory\b/i, 'no SQL belongs in the UI file');
  assert.doesNotMatch(TEMPLATE, /DB_PASSWORD|DB_USER|DB_HOST|password/i);
});

test('render.js supplies values, not the Product Keywords page structure', () => {
  const code = readFileSync(new URL('./render.js', import.meta.url), 'utf8');

  // Every piece of this page's structure exists in exactly one place, and it
  // is page.html. (The small 404/405/error shell is still built in render.js;
  // it is a different page and not part of this UI.)
  const structure = [
    '<table>',
    '<thead>',
    '<tbody>',
    '<div class="table-scroll">',
    '<th>SKU</th>',
    '<th>Competitor Keywords</th>',
    'class="controls controls-top"',
    'class="controls controls-bottom"',
    '<nav class="pager"',
    '<a class="btn"',
    '<p class="count">',
  ];

  for (const markup of structure) {
    assert.ok(!code.includes(markup), `render.js must not rebuild ${markup}`);
  }
  assert.ok(!code.includes('color-scheme'), 'render.js must hold no CSS');

  // What it does build is the per-product rows, which come from the database
  // 50 at a time and cannot be static markup.
  assert.ok(code.includes('<td class="sku">'), 'render.js builds the row cells');
});

test('the rendered page matches the structure page.html describes', () => {
  const html = page({ page: 2, pageCount: 4, total: 200 });

  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('.table-scroll'), 'the CSS reaches the page from the template');
  assert.ok(!/\{\{\w+\}\}/.test(html), 'an unfilled placeholder reached the page');
});

test('a product value containing replacement syntax is not expanded', () => {
  // $& and {{rows}} are meaningful to a naive string replace. Product titles
  // are free text and can contain either.
  const html = page({
    products: [{ id: 1, sku: '$&', title: 'Lamp {{rows}} $1 $`' }],
    classify: nothingKnown,
  });

  assert.ok(html.includes('<td class="sku">$&amp;</td>'));
  assert.ok(html.includes('Lamp {{rows}} $1 $`'));
  assert.equal((html.match(/<table>/g) ?? []).length, 1, 'the title must not spawn a second table');
});

test('paging controls are rendered both above and below the table', () => {
  const html = page({ page: 2, pageCount: 4, total: 200 });

  assert.ok(html.includes('class="controls controls-top"'), 'a control bar above the table');
  assert.ok(html.includes('class="controls controls-bottom"'), 'a control bar below the table');

  const top = html.indexOf('controls-top');
  const table = html.indexOf('<table>');
  const bottom = html.indexOf('controls-bottom');
  assert.ok(top < table && table < bottom, 'the bars sit above and below the table');
});

test('the top and bottom controls describe the same current page', () => {
  const html = page({ page: 2, pageCount: 4, total: 200 });
  const bars = [...html.matchAll(/<nav class="pager"[^>]*>([\s\S]*?)<\/nav>/g)].map((match) => match[1]);

  assert.equal(bars.length, 2, 'exactly two control bars');
  // Identical markup, so neither bar can drift from the other or from the page.
  assert.equal(bars[0], bars[1]);
  assert.match(bars[0], /Page 2 of 4/);
  assert.ok(bars[0].includes('page=1') && bars[0].includes('page=3'));
});

test('both control bars send the reader to the same page', () => {
  const html = page({ page: 2, pageCount: 4, total: 200 });
  const links = [...html.matchAll(/href="(\/product-keywords\?page=\d+)"/g)].map((match) => match[1]);

  assert.deepEqual(links, [
    '/product-keywords?page=1',
    '/product-keywords?page=3',
    '/product-keywords?page=1',
    '/product-keywords?page=3',
  ]);
});

test('the controls are plain HTML buttons, with no framework and no script', () => {
  const html = page({ page: 2, pageCount: 4, total: 200 });

  assert.ok(html.includes('<a class="btn" href="/product-keywords?page=1"'));
  assert.ok(!html.includes('<script'), 'the page runs no JavaScript');
  assert.ok(!/react|vue\.js|angular|htmx/i.test(html), 'no frontend framework is loaded');
});

test('a control with nowhere to go carries no href', () => {
  // The button markup is fixed in page.html; only its attributes change. With
  // no page to reach it becomes aria-disabled and has no href, so it is greyed
  // out by the stylesheet and the browser will not follow it.
  const first = page({ page: 1, pageCount: 3, total: 150 });
  assert.ok(first.includes('<a class="btn" aria-disabled="true">&larr; Previous</a>'));
  assert.ok(!first.includes('page=0'));

  const last = page({ page: 3, pageCount: 3, total: 150 });
  assert.ok(last.includes('<a class="btn" aria-disabled="true">Next &rarr;</a>'));
  assert.ok(!last.includes('page=4'));
});

test('an empty result set says so, and keeps the table structure', () => {
  const html = page({ products: [], total: 0, pageCount: 1 });

  assert.ok(html.includes('No products found.'));
  // The headings come from page.html, so they stand whether or not there are
  // rows to put under them.
  assert.ok(html.includes('<tbody>'));
  assert.ok(html.includes('<th>SKU</th>'));

  // Comments stripped first: page.html documents the row shape in a comment,
  // and documentation is not data.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/<tbody>[\s\S]*?<tr>/.test(markup), 'no product row is invented');
});

test('the page states keyword source priority and blank fallback behaviour', () => {
  const html = page();

  assert.equal((html.match(/<h1>Product Keywords<\/h1>/g) ?? []).length, 1);
  assert.ok(!html.includes('deterministic Product Name search keywords'));
  assert.ok(!html.includes('What this page can and cannot tell you'));
  assert.ok(!html.includes('Scroll the table sideways to see every column'));
  assert.ok(!html.includes('No competitor brands are used'));
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

test('no placeholder text stands in for a blank keyword cell', () => {
  const html = page({
    products: [{ id: 5, sku: 'X1', title: 'Vintage Garden Ornament' }],
    classify: () => ({
      primary: 'Vintage Garden Ornament',
      secondary: null,
      longTail: null,
      competitor: null,
    }),
  });

  for (const placeholder of ['Not recorded', 'N/A', 'Unknown', '&mdash;', 'No data', 'None']) {
    assert.ok(!html.includes(placeholder), `${placeholder} must not appear`);
  }
  assert.ok(html.includes('<td></td>'), 'a blank category is a genuinely empty cell');
});

test('a fully generated row fills all four keyword cells', () => {
  const html = page({
    products: [
      {
        id: 117,
        sku: 'SWRS1GBM',
        title: 'Screwless Wall light switches Black 1 Gang',
        image: 'https://sin1.contabostorage.com/img/product_images/117.jpg',
      },
    ],
    classify: () => ({
      primary: 'Light Switch',
      secondary: 'Wall Switch, Switch Plate, Black',
      longTail: 'Black 1 Gang Screwless Light Switch',
      competitor: 'Light Switch Cover, Wall Plate Switch',
    }),
  });

  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  const cells = [...row.matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);

  assert.equal(cells.length, 8, 'eight columns, no extra keyword column');
  assert.ok(
    cells.every((cell) => cell !== ''),
    'every cell in a fully populated row has a value',
  );
});

// ---------------------------------------------------------------------------
// The Product Image column.
// ---------------------------------------------------------------------------

const withImage = (image) =>
  page({
    products: [{ id: 1, sku: 'HLBP128BB', title: 'Brass Pull and Push Door Handle', image }],
  });

/** The first row's cells, image cell included. */
function firstRowCells(html) {
  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  return [...row.matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
}

test('a product with an image renders an img in the first cell', () => {
  const html = withImage('https://sin1.contabostorage.com/img/product_images/1.jpg');
  const cells = firstRowCells(html);

  assert.equal(cells.length, 8);
  assert.match(cells[0], /^<img /, 'the image is the first cell');
  assert.ok(html.includes('src="https://sin1.contabostorage.com/img/product_images/1.jpg"'));
  assert.ok(html.includes('<td class="img"><img '));
});

test('the image alt text is the product name', () => {
  const html = withImage('https://sin1.contabostorage.com/img/product_images/1.jpg');

  assert.ok(html.includes('alt="Brass Pull and Push Door Handle"'));
});

test('the image carries a size and loads lazily, with no script', () => {
  const html = withImage('https://sin1.contabostorage.com/img/product_images/1.jpg');

  assert.match(html, /<img [^>]*width="56"[^>]*>/);
  assert.match(html, /<img [^>]*height="56"[^>]*>/);
  assert.match(html, /<img [^>]*loading="lazy"[^>]*>/);
  assert.ok(!html.includes('<script'), 'the page runs no JavaScript');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handler on the image');
});

test('a product with no image gets a blank cell, not a placeholder', () => {
  for (const missing of [null, undefined, '', '   ']) {
    const cells = firstRowCells(withImage(missing));
    const html = withImage(missing);

    assert.equal(cells.length, 8, `still eight cells for ${JSON.stringify(missing)}`);
    assert.equal(cells[0], '', 'the image cell is genuinely empty');
    assert.ok(!html.includes('<img'), 'no image element is invented');
    assert.ok(html.includes('<td class="img"></td>'));
  }
});

test('a product row with no image field at all still renders', () => {
  const cells = firstRowCells(page({ products: [{ id: 5, sku: 'X', title: 'A product' }] }));

  assert.equal(cells.length, 8);
  assert.equal(cells[0], '');
});

test('an image address that is not http(s) is treated as no image', () => {
  // The URL is database text and `src` is acted on by the browser, so only
  // real web addresses are passed through.
  for (const hostile of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    '/img/product_images/1.jpg',
    'ftp://example.invalid/x.jpg',
  ]) {
    const html = withImage(hostile);

    assert.ok(html.includes('<td class="img"></td>'), `${hostile} must not become an image`);
    assert.ok(!html.includes('<img'), `${hostile} must not render an img element`);
  }
});

test('an image URL and alt text cannot break out of their attributes', () => {
  const html = page({
    products: [
      {
        id: 1,
        sku: 'X',
        title: 'Lamp" onerror="alert(1)',
        image: 'https://sin1.contabostorage.com/a.jpg" onerror="alert(1)',
      },
    ],
  });

  // The payload survives as TEXT inside the attribute value, which is the
  // point: every quote that could have ended the attribute is an entity, so
  // `onerror` never becomes an attribute of its own.
  assert.ok(html.includes('&quot; onerror=&quot;alert(1)'), 'the quotes are escaped');
  assert.ok(!/onerror="/.test(html), 'no real onerror attribute is created');
  assert.ok(!/alt="[^"]*"[^>]*onerror/.test(html));
});

test('the image column does not disturb the keyword columns', () => {
  const html = page({
    products: [{ id: 1, sku: 'X', title: 'Pendant Light', image: 'https://sin1.contabostorage.com/a.jpg' }],
    classify: () => ({
      primary: 'Pendant Light',
      secondary: 'Hanging Light',
      longTail: 'Pendant Ceiling Light',
      competitor: 'Ceiling Pendant',
    }),
  });

  assert.deepEqual(firstRowCells(html).slice(4), [
    'Pendant Light',
    'Hanging Light',
    'Pendant Ceiling Light',
    'Ceiling Pendant',
  ]);
});
