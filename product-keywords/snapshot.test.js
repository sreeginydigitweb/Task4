/**
 * Tests for the self-contained snapshot file.
 *
 * `buildSnapshotHtml` is pure - rows and a stylesheet in, one file's text out -
 * so all of this runs without a database.
 *
 * The checks that matter most are not that the columns are present. They are
 * the ones proving the file is genuinely self-contained (nothing external is
 * referenced), that it leaks no database credentials, and that embedded
 * product text cannot become markup or escape the element holding it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  COLUMNS,
  DEFAULT_LIMIT,
  buildSnapshotHtml,
  escapeHtml,
  serialiseData,
  toSnapshotRow,
} from './snapshot.js';

const STYLES = ':root { --ink: #000; }\n.table-scroll { overflow-x: auto; }\n.count { color: grey; }';

const ROWS = [
  {
    image: 'https://sin1.contabostorage.com/img/product_images/1.jpg',
    sku: 'HLBP128BB',
    id: '1',
    name: 'Brass Pull and Push Door Handle',
    category: 'Door Handle',
    tags: ['Door Handle', 'Brass', 'Cabinet Handle', 'Pull Handle'],
    primary: [{ t: 'Door Handle', r: 'product-type' }],
    secondary: [
      { t: 'Door Pull', r: 'product-type' },
      { t: 'Pull Handle', r: 'product-type' },
      // "Brass" is a word read out of the product's own name, so its resource
      // is the Product Name, not the Product Type entry.
      { t: 'Brass', r: 'product-name' },
    ],
    longTail: [{ t: 'Brass Door Handle', r: 'product-name-type' }],
    competitor: [{ t: 'Cabinet Handle', r: 'product-type' }],
  },
  {
    image: null,
    sku: 'SOGS1GGK',
    id: '390',
    name: 'Decorative Black Glossy Main Plug One Gang Switch',
    category: null,
    tags: [],
    primary: [{ t: 'Light Switch', r: 'product-type' }],
    secondary: [{ t: 'Wall Switch', r: 'product-type' }],
    longTail: [{ t: 'Black Light Switch', r: 'product-type' }],
    competitor: [{ t: 'Light Switch Cover', r: 'product-type' }],
  },
];

const snapshot = (overrides = {}) =>
  buildSnapshotHtml({ rows: ROWS, styles: STYLES, generatedAt: '2026-09-18T10:00:00.000Z', ...overrides });

/** The JSON the file embeds, parsed back. */
function embeddedData(html) {
  const json = /<script type="application\/json" id="snapshot-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(json, 'the file embeds a data block');
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// One file, complete in itself.
// ---------------------------------------------------------------------------

test('the snapshot is a complete HTML document', () => {
  const html = snapshot();

  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<body>/);
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('nothing at all is loaded from outside the file', () => {
  const html = snapshot();

  // No external script, stylesheet, font or import of any kind.
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, 'no external script');
  assert.doesNotMatch(html, /<link\b/i, 'no external stylesheet or preload');
  assert.doesNotMatch(html, /@import/i, 'no CSS import');
  assert.doesNotMatch(html, /<iframe|<object|<embed/i);

  // The only http(s) references allowed are image addresses inside the data.
  const outsideData = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(outsideData, /https?:\/\//, 'the document itself references no URL');
});

test('the CSS is inline, and carries the live stylesheet', () => {
  const html = snapshot();
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');

  assert.ok(styles.includes('.table-scroll'), 'the live stylesheet is included');
  assert.ok(styles.includes('button.btn'), 'the snapshot styles its own buttons');
});

test('the JavaScript is inline, and is the whole of what the page needs', () => {
  const html = snapshot();
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  assert.ok(script.length > 500, 'the behaviour is present, not stubbed');
  for (const behaviour of ['PAGE_SIZE', 'drawRows', 'drawControls', 'addEventListener', 'JSON.parse']) {
    assert.ok(script.includes(behaviour), `${behaviour} is in the inline script`);
  }
  // No framework, no module loading, no network call.
  assert.doesNotMatch(script, /\bimport\b|\brequire\(|\bfetch\(|XMLHttpRequest/);
  assert.doesNotMatch(script, /react|vue|angular|jquery/i);
});

// ---------------------------------------------------------------------------
// The columns.
// ---------------------------------------------------------------------------

test('the snapshot has all ten headers, in the required order', () => {
  const headings = [...snapshot().matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings, [
    'Product Image',
    'SKU',
    'Product ID',
    'Product Name',
    'Category',
    'Tags',
    'Primary Keyword',
    'Secondary Keywords',
    'Long-Tail Keywords',
    'Competitor Keywords',
  ]);
  assert.deepEqual(headings, COLUMNS);
});

test('the table structure is in the file, with a tbody for the rows', () => {
  const html = snapshot();

  assert.match(html, /<div class="table-scroll">/);
  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<tbody id="rows">/);
  assert.match(html, /<\/table>/);
});

test('pagination controls are in the file, above and below the table', () => {
  const html = snapshot();

  assert.match(html, /<div class="controls controls-top"/);
  assert.match(html, /<div class="controls controls-bottom"/);
  assert.equal((html.match(/<nav class="pager"/g) ?? []).length, 2);

  for (const id of ['prev-top', 'next-top', 'position-top', 'prev-bottom', 'next-bottom', 'position-bottom']) {
    assert.ok(html.includes(`id="${id}"`), `${id} is present`);
  }
  // Four paging buttons, plus the filter's Clear.
  assert.equal((html.match(/<button type="button" class="btn"/g) ?? []).length, 5);
});

// ---------------------------------------------------------------------------
// The data.
// ---------------------------------------------------------------------------

test('real product data is embedded in the file', () => {
  const data = embeddedData(snapshot());

  assert.equal(data.length, 2);
  assert.equal(data[0].sku, 'HLBP128BB');
  assert.equal(data[0].id, '1');
  assert.equal(data[0].name, 'Brass Pull and Push Door Handle');
  assert.deepEqual(data[0].primary, [{ t: 'Door Handle', r: 'product-type' }]);
  assert.deepEqual(data[0].competitor, [{ t: 'Cabinet Handle', r: 'product-type' }]);
});

test('every row carries all ten column values', () => {
  for (const row of embeddedData(snapshot())) {
    assert.deepEqual(Object.keys(row).sort(), [
      'category',
      'competitor',
      'id',
      'image',
      'longTail',
      'name',
      'primary',
      'secondary',
      'sku',
      'tags',
    ]);
  }
});

test("every product's own tags are embedded, and a product with none gets an empty list", () => {
  const data = embeddedData(snapshot());

  assert.deepEqual(data[0].tags, ['Door Handle', 'Brass', 'Cabinet Handle', 'Pull Handle']);
  assert.deepEqual(data[1].tags, [], 'no tag is invented for a product that has none');
});

test('toSnapshotRow carries ledsone tags through unchanged, trimming and dropping blanks', () => {
  const row = toSnapshotRow({
    id: 1,
    sku: 'HLBP128BB',
    title: 'Brass Door Handle',
    image: null,
    category: 'Door Handle',
    // As the database hands them over: the stored values carry leading spaces.
    tags: [' Handles', 'Brass ', '   ', ''],
  });

  assert.deepEqual(row.tags, ['Handles', 'Brass']);
});

test('a product with no tags field at all becomes an empty list, not undefined', () => {
  const row = toSnapshotRow({ id: 2, sku: 'X', title: 'A product', image: null });

  assert.deepEqual(row.tags, []);
});

test('the file says how many of its products carry tags', () => {
  const html = snapshot();

  assert.match(html, /Product tags: 4 in total across 1 of these products/);
  assert.match(html, /1 have none and show a blank Tags cell/);
  assert.match(html, /no product is\s+sampled and no tag list is truncated in the data/);
});

test('a product image address is embedded, and a missing one stays null', () => {
  const data = embeddedData(snapshot());

  assert.match(data[0].image, /^https:\/\/sin1\.contabostorage\.com\//);
  assert.equal(data[1].image, null, 'no placeholder image is substituted');
});

test('the file says how many products it holds and that it is not live', () => {
  const html = snapshot({ catalogueTotal: 44636 });

  assert.match(html, /44,636/, 'the catalogue total is stated');
  assert.match(html, /point-in-time copy/i);
  assert.match(html, /2026-09-18 10:00/, 'the build time is stated');
});

// ---------------------------------------------------------------------------
// No credentials, and no pretence that a browser can reach PostgreSQL.
// ---------------------------------------------------------------------------

test('the snapshot contains no database credentials or connection details', () => {
  const html = snapshot();

  // Checked against the WHOLE file, comments included: a credential must not
  // be able to hide in prose either. These are credential SHAPES rather than
  // bare words, because the file legitimately explains in writing that it
  // holds no host, user or password.
  for (const pattern of [
    /password\s*[:=]/i,
    /passwd|pwd\s*[:=]/i,
    /\bDB_(PASSWORD|USER|HOST|PORT|NAME)\b/,
    /postgres(ql)?:\/\//i,
    /\bconnectionString\b/i,
    /\bvarmen_user\b/,
    /sslmode=/i,
    /\b5432\b/,
  ]) {
    assert.doesNotMatch(html, pattern, `${pattern} must never appear in a shared file`);
  }

  // And the env var names must not appear even once outside the prose.
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const name of ['DB_PASSWORD', 'DB_USER', 'DB_HOST', 'DB_PORT', 'DB_NAME']) {
    assert.ok(!withoutComments.includes(name), `${name} must not be in the document`);
  }
});

test('the snapshot contains no SQL and no database client code', () => {
  const html = snapshot();

  // A SQL SHAPE, not the bare word: the filter markup contains a <select>.
  assert.doesNotMatch(html, /\bSELECT\s+[\w*".]+[\s\S]{0,80}?\bFROM\b/i, 'no SQL statement');
  assert.doesNotMatch(html, /\bFROM\s+inventory\./i);
  assert.doesNotMatch(html, /\bLEFT JOIN\b/i);
  assert.doesNotMatch(html, /\bnew\s+(pg\.)?(Pool|Client)\b/, 'no database client is constructed');
  assert.doesNotMatch(html, /require\(['"]pg['"]\)|from ['"]pg['"]/);
});

test('the file states plainly that a browser cannot reach PostgreSQL', () => {
  // The limitation is written down rather than glossed over, so nobody tries
  // to "fix" the snapshot by adding a connection to it.
  assert.match(snapshot(), /cannot speak to PostgreSQL|cannot connect to PostgreSQL/i);
});

// ---------------------------------------------------------------------------
// Embedded product text cannot become markup.
// ---------------------------------------------------------------------------

test('a product title cannot close the data element', () => {
  const html = buildSnapshotHtml({
    styles: STYLES,
    rows: [
      {
        image: null,
        sku: 'X',
        id: '1',
        name: 'Lamp</script><script>alert(1)</script>',
        primary: null,
        secondary: null,
        longTail: null,
        competitor: null,
      },
    ],
  });

  // Exactly three script elements: the JSON block and the one inline script,
  // plus nothing smuggled in by the data.
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  assert.ok(!html.includes('</script><script>alert(1)'), 'the payload is escaped, not literal');

  // And it survives as ordinary text once parsed back.
  assert.equal(embeddedData(html)[0].name, 'Lamp</script><script>alert(1)</script>');
});

test('serialiseData escapes every character that could end a script element', () => {
  const json = serialiseData({ name: '</script><img src=x>' });

  assert.ok(!json.includes('<'), 'no raw < survives');
  assert.equal(JSON.parse(json).name, '</script><img src=x>', 'the value is unchanged');
});

test('serialiseData escapes line separators that JSON allows but JavaScript does not', () => {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  const value = `a${lineSeparator}b${paragraphSeparator}c`;

  const json = serialiseData({ name: value });

  assert.ok(json.includes('\\u2028'), 'U+2028 is escaped');
  assert.ok(json.includes('\\u2029'), 'U+2029 is escaped');
  assert.ok(!json.includes(lineSeparator), 'no raw separator survives');
  assert.equal(JSON.parse(json).name, value, 'the value round-trips unchanged');
});

test('the client script renders text as text, never as markup', () => {
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(snapshot())?.[1] ?? '';
  assert.ok(script.includes('textContent'), 'cells are filled with textContent');

  // Comments stripped: the script explains in a comment why it uses
  // textContent rather than innerHTML, and that sentence is not a use.
  const code = script.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

  for (const unsafe of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
    assert.ok(!code.includes(unsafe), `${unsafe} must not be used on product data`);
  }
});

test('the client script accepts only http(s) image addresses', () => {
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(snapshot())?.[1] ?? '';

  assert.ok(script.includes('imageUrl'), 'the address is checked before use');
  assert.match(script, /\^https\?:\\\/\\\//, 'only http(s) is allowed through');
});

test('escapeHtml neutralises the characters that matter', () => {
  assert.equal(escapeHtml(`<a "b" 'c' & d>`), '&lt;a &quot;b&quot; &#39;c&#39; &amp; d&gt;');
  assert.equal(escapeHtml(null), '');
});

// ---------------------------------------------------------------------------
// The row builder reuses the application's own keyword logic, unchanged.
// ---------------------------------------------------------------------------

test('a snapshot row takes its keywords from the application classifier', () => {
  const row = toSnapshotRow({ id: 9, sku: 'PL1', title: 'Pendant Light', image: null });

  // Each category is its individual keywords, with the source of each. The
  // VALUES are the application's own, unchanged.
  // s = the tag, i = the input that produced the keyword.
  assert.deepEqual(row.primary, [{ t: 'Pendant Light', r: 'product-type' }]);
  assert.deepEqual(row.secondary, [
    { t: 'Hanging Light', r: 'product-type' },
    { t: 'Pendant Lamp', r: 'product-type' },
  ]);
  assert.deepEqual(row.longTail, [{ t: 'Pendant Ceiling Light', r: 'product-type' }]);
  assert.deepEqual(row.competitor, [
    { t: 'Ceiling Pendant', r: 'product-type' },
    { t: 'Hanging Lamp', r: 'product-type' },
  ]);
});

test('a snapshot row keeps the product name and identifiers as they are', () => {
  const row = toSnapshotRow({ id: 117, sku: 'SWRS1GBM', title: 'Wall light switches', image: '  ' });

  assert.equal(row.sku, 'SWRS1GBM');
  assert.equal(row.id, '117');
  assert.equal(row.name, 'Wall light switches');
  assert.equal(row.image, null, 'a whitespace-only image address counts as none');
});

test('a row with no image field at all is safe', () => {
  assert.equal(toSnapshotRow({ id: 1, sku: 'X', title: 'A product' }).image, null);
});

test('the default snapshot size is a sane whole number of pages', () => {
  assert.ok(Number.isInteger(DEFAULT_LIMIT));
  assert.ok(DEFAULT_LIMIT > 0);
});

test('an empty snapshot is still a valid page with an empty-state note', () => {
  const html = buildSnapshotHtml({ rows: [], styles: STYLES });

  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /id="empty" hidden/);
  assert.match(html, /No products in this snapshot/);
  assert.deepEqual(embeddedData(html), []);
});

// ---------------------------------------------------------------------------
// The live application is left alone.
// ---------------------------------------------------------------------------

test('page.html stays the live template, with no script in it', () => {
  const template = readFileSync(new URL('./page.html', import.meta.url), 'utf8');

  // The live page needs no JavaScript: its paging is server-answered links,
  // and the server sends Content-Security-Policy: default-src 'none'. A script
  // there would be dead code the browser refuses to run.
  assert.ok(!/<script/i.test(template), 'the live template carries no script');
  assert.ok(template.includes('{{rows}}'), 'and it is still a server template');
});
