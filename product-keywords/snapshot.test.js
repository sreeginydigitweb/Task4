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
    primary: [{ t: 'Door Handle', r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' }],
    secondary: [
      { t: 'Door Pull', r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' },
      { t: 'Pull Handle', r: 'google-search-console', l: 'Google Search Console', d: 'a real Google query' },
      // Proven by a storefront, which is named as the business it is.
      { t: 'Brass', r: 'shopify', l: 'Electricalsone', d: 'listings.shopify_listing_tag.tag' },
    ],
    longTail: [{ t: 'Brass Door Handle', r: null, l: null, d: null }],
    competitor: [{ t: 'Cabinet Handle', r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' }],
  },
  {
    image: null,
    sku: 'SOGS1GGK',
    id: '390',
    name: 'Decorative Black Glossy Main Plug One Gang Switch',
    category: null,
    // A product nothing proves: every keyword shows, none wears a tag.
    primary: [{ t: 'Light Switch', r: null, l: null, d: null }],
    secondary: [{ t: 'Wall Switch', r: null, l: null, d: null }],
    longTail: [{ t: 'Black Light Switch', r: null, l: null, d: null }],
    competitor: [{ t: 'Light Switch Cover', r: null, l: null, d: null }],
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

test('the snapshot has all nine headers, in the required order', () => {
  const headings = [...snapshot().matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings, [
    'Product Image',
    'SKU',
    'Product ID',
    'Product Name',
    'Category',
    'Primary Keyword',
    'Secondary Keywords',
    'Long-Tail Keywords',
    'Competitor Keywords',
  ]);
  assert.deepEqual(headings, COLUMNS);
});

test('the snapshot has no Tags column, and no tag data left behind to feed one', () => {
  const html = snapshot();
  const headings = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.equal(headings.length, 9, 'nine columns, no more');
  assert.ok(!headings.some((heading) => /^tags?$/i.test(heading)), 'no Tags header');

  // The row data carried tags only to fill that column, so it carries none now
  // - a snapshot shipping data nothing can draw is just weight in the file.
  for (const row of embeddedData(html)) {
    assert.ok(!('tags' in row), 'no orphaned tag data on a row');
  }

  // And nothing is left that could draw one.
  assert.ok(!html.includes('class="ptag"'), 'no product-tag pill markup');
  assert.ok(!html.includes('.ptag {'), 'no product-tag styling');
});

test('a keyword resource pill still sits inside its keyword cell', () => {
  // Removing the Tags column must not disturb the provenance pills: they live
  // under their own keyword, inside the keyword cell, exactly as before.
  const row = embeddedData(snapshot())[0];

  assert.deepEqual(row.primary, [
    { t: 'Door Handle', r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' },
  ]);
  assert.equal(row.secondary[1].l, 'Google Search Console');
  assert.equal(row.secondary[2].l, 'Electricalsone', 'a storefront keeps its business name');
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
  assert.deepEqual(data[0].primary, [
    { t: 'Door Handle', r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' },
  ]);
  assert.deepEqual(data[0].competitor, [
    { t: 'Cabinet Handle', r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' },
  ]);
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
    ]);
  }
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
  //
  // Every tag, in all four categories, names a real resource proven from a
  // real record. This row carries NO evidence at all, so no keyword earns a
  // tag - and none is invented. A blank tag is the honest outcome.
  const untagged = (t) => ({ t, r: null, l: null, d: null });

  assert.deepEqual(row.primary, [untagged('Pendant Light')]);
  assert.deepEqual(row.secondary, [untagged('Hanging Light'), untagged('Pendant Lamp')]);
  assert.deepEqual(row.longTail, [untagged('Pendant Ceiling Light')]);
  assert.deepEqual(row.competitor, [untagged('Ceiling Pendant'), untagged('Hanging Lamp')]);
});

test('a snapshot row tags every column from the real records held against the product', () => {
  // Evidence is what resources.js read from ledsone. Each record carries the
  // resource, the name to show, and the table it came from.
  const evidence = [
    {
      source: 'amazon',
      label: 'Amazon',
      kind: 'search-keywords',
      detail: 'listings.amazon_listing_search_engine_keywords.keyword',
      text: 'pendant light fittings and hanging light shades',
    },
    {
      source: 'shopify',
      label: 'Vintagelite',
      kind: 'tag',
      detail: 'listings.shopify_listing_tag.tag',
      text: 'Ceiling Pendant',
    },
  ];

  const row = toSnapshotRow({ id: 9, sku: 'PL1', title: 'Pendant Light', image: null, evidence });

  // The tooltip names the table AND quotes the record that actually matched,
  // so the reader can check the tag against the row that justifies it.
  const amazonKeywords =
    'listings.amazon_listing_search_engine_keywords.keyword: ' +
    '"pendant light fittings and hanging light shades"';

  // Primary and one secondary appear in Amazon's backend keywords.
  assert.deepEqual(row.primary, [
    { t: 'Pendant Light', r: 'amazon', l: 'Amazon', d: amazonKeywords },
  ]);
  assert.deepEqual(row.secondary, [
    { t: 'Hanging Light', r: 'amazon', l: 'Amazon', d: amazonKeywords },
    // "Pendant Lamp" is in neither record, so it earns nothing.
    { t: 'Pendant Lamp', r: null, l: null, d: null },
  ]);
  // The competitor term is proven by a storefront, which is named as the
  // business rather than as the platform it runs on.
  assert.deepEqual(row.competitor, [
    {
      t: 'Ceiling Pendant',
      r: 'shopify',
      l: 'Vintagelite',
      d: 'listings.shopify_listing_tag.tag: "Ceiling Pendant"',
    },
    { t: 'Hanging Lamp', r: null, l: null, d: null },
  ]);
});

test('a snapshot row never invents a resource for any column', () => {
  // Evidence that mentions none of the keywords proves none of them. A word
  // that merely shares a record's subject is not a word that record supplied.
  const evidence = [
    {
      source: 'ebay',
      label: 'eBay',
      kind: 'listing-title',
      detail: 'listings.ebay_listings.title',
      text: 'Solid Brass Door Knocker Antique Finish',
    },
  ];

  for (const supplied of [evidence, [], null, undefined]) {
    const row = toSnapshotRow({ id: 9, sku: 'PL1', title: 'Pendant Light', image: null, evidence: supplied });

    for (const column of ['primary', 'secondary', 'longTail', 'competitor']) {
      for (const entry of row[column]) {
        assert.equal(entry.r, null, `${column} "${entry.t}" must carry no resource`);
        assert.equal(entry.l, null, 'and no label');
      }
    }
  }
});

test('a scattered word match never earns a resource', () => {
  // "Cupboard Handle" is NOT proven by "Kitchen Cupboard Wardrobe Door
  // Handles": both words are present but they describe different things. Only
  // a consecutive phrase counts.
  const evidence = [
    {
      source: 'amazon',
      label: 'Amazon',
      kind: 'listing-title',
      detail: 'listings.amazon_listings.title',
      text: '128mm Brass Cabinet Handles | Kitchen Cupboard Wardrobe Door Handles',
    },
  ];

  const row = toSnapshotRow({ id: 1, sku: 'HLBP128BB', title: 'Brass Door Handle', image: null, evidence });
  const byTerm = new Map(row.competitor.map((entry) => [entry.t, entry.r]));

  assert.equal(byTerm.get('Cabinet Handle'), 'amazon', 'a real consecutive phrase is proven');
  assert.equal(byTerm.get('Cupboard Handle'), null, 'scattered words prove nothing');
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
