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
import { SOURCE_LABEL } from './provenance.js';

/** product-keywords/page.html - the UI file the application fills in. */
const TEMPLATE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');

/** The classification the application actually ships with: nothing is known. */
const nothingKnown = () => ({
  primary: [],
  secondary: [],
  longTail: [],
  competitor: [],
});

/** One keyword per category - the shape classify returns.
 *
 * `resource` is the REAL resource that supplied the word, `resourceLabel` the
 * name shown on its pill and `resourceDetail` the record it was proven from.
 * Those three are what the renderer actually receives.
 */
const term = (t, resource = 'amazon', resourceLabel = 'Amazon') => [
  { term: t, resource, resourceLabel, resourceDetail: `Proven from a real ${resourceLabel} record` },
];

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

/** The nine columns, in the order the requirement sets. */
const COLUMNS = [
  'Product Image',
  'SKU',
  'Product ID',
  'Product Name',
  'Category',
  'Primary Keyword',
  'Secondary Keywords',
  'Long-Tail Keywords',
  'Competitor Keywords',
];

/** Where the four keyword cells start, after image/sku/id/name/category. */
const FIRST_KEYWORD_CELL = 5;

test('the table contains exactly the nine requested columns, in the requested order', () => {
  const html = page();
  const headings = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings, COLUMNS);
  assert.equal(headings[0], 'Product Image', 'the image is the first column');
  assert.equal(headings[4], 'Category', 'Category sits after Product Name');
});

// ---------------------------------------------------------------------------
// The Category column and the category filter.
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { name: 'Pendant Lighting', count: 3374 },
  { name: 'Wall Light', count: 1667 },
  { name: 'Light Switch', count: 190 },
];

/** A page with a filter applied. */
const filtered = (overrides = {}) =>
  page({
    products: [{ id: 3, sku: 'PL1', title: 'Vintage Pendant Light', category: 'Pendant Lighting' }],
    categories: CATEGORIES,
    category: 'Pendant Lighting',
    total: 3374,
    catalogueTotal: 44636,
    page: 2,
    pageCount: 68,
    ...overrides,
  });

test("a product's category is shown in its own cell, after the product name", () => {
  const html = page({
    products: [{ id: 3, sku: 'PL1', title: 'Vintage Pendant Light', category: 'Pendant Lighting' }],
  });
  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  const cells = [...row.matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);

  assert.equal(cells.length, 9);
  assert.equal(cells[4], 'Pendant Lighting');
  assert.ok(html.includes('<td class="category">Pendant Lighting</td>'));
});

test('a product with no category gets a blank cell, not a placeholder', () => {
  for (const missing of [null, undefined, '']) {
    const html = page({ products: [{ id: 5, sku: 'X', title: 'Combo Default Title.', category: missing }] });
    const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
    const cells = [...row.matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);

    assert.equal(cells.length, 9, String(missing));
    assert.equal(cells[4], '', 'the category cell is genuinely empty');
    assert.ok(html.includes('<td class="category"></td>'));
    for (const placeholder of ['Uncategorised', 'Unknown', 'N/A', 'None']) {
      assert.ok(!html.includes(placeholder), `${placeholder} must not appear`);
    }
  }
});

test('a category from the database is escaped before it reaches the page', () => {
  const html = page({
    products: [{ id: 1, sku: 'X', title: 'A product', category: '<b>Lights</b> & "more"' }],
    categories: [{ name: '<b>Lights</b> & "more"', count: 1 }],
    category: '<b>Lights</b> & "more"',
  });

  assert.ok(!html.includes('<b>Lights</b>'), 'a category must not inject markup');
  assert.ok(html.includes('&lt;b&gt;Lights&lt;/b&gt; &amp; &quot;more&quot;'));
});

test('the filter offers All Categories first, with the catalogue total', () => {
  const html = page({ categories: CATEGORIES, catalogueTotal: 44636 });
  const options = [...html.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)];

  assert.equal(options[0][1], '', 'All Categories is the empty value');
  assert.equal(options[0][3], 'All Categories (44,636)');
  assert.match(options[0][2], /selected/, 'and it is selected when nothing is filtered');
});

test('the filter lists every category, with its product count', () => {
  const html = page({ categories: CATEGORIES, catalogueTotal: 44636 });
  const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)];

  assert.equal(options.length, 4, 'All Categories plus the three given');
  assert.equal(options[1][1], 'Pendant Lighting');
  assert.equal(options[1][2], 'Pendant Lighting (3,374)');
  assert.equal(options[3][2], 'Light Switch (190)');
});

test('the chosen category is the selected option', () => {
  const html = filtered();
  const selected = [...html.matchAll(/<option value="([^"]*)"[^>]*selected[^>]*>/g)].map((match) => match[1]);

  assert.deepEqual(selected, ['Pendant Lighting'], 'exactly one option is selected');
});

test('the count line reports the filtered total, not the catalogue', () => {
  assert.match(filtered(), /Showing 51&ndash;51 of 3,374 products in Pendant Lighting\./);
});

test('with no filter the count line names no category', () => {
  const html = page({ total: 44636, categories: CATEGORIES });

  assert.match(html, /of 44,636 products\./);
  assert.ok(!html.includes(' products in '), 'no category is named');
});

test('the chosen category is carried on both paging links', () => {
  const html = filtered();
  const links = [...html.matchAll(/href="(\/product-keywords\?[^"]*)"/g)].map((match) => match[1]);

  // Previous and Next, in each of the two control bars.
  assert.deepEqual(links, [
    '/product-keywords?page=1&amp;category=Pendant%20Lighting',
    '/product-keywords?page=3&amp;category=Pendant%20Lighting',
    '/product-keywords?page=1&amp;category=Pendant%20Lighting',
    '/product-keywords?page=3&amp;category=Pendant%20Lighting',
  ]);
});

test('a category needing encoding survives the paging link intact', () => {
  const html = filtered({
    category: 'Ceiling Lights & Chandeliers',
    categories: [{ name: 'Ceiling Lights & Chandeliers', count: 1127 }],
  });

  assert.ok(html.includes('category=Ceiling%20Lights%20%26%20Chandeliers'));
  assert.ok(!html.includes('category=Ceiling Lights & Chandeliers'), 'the raw value is not put in a URL');
});

test('paging links carry no category when nothing is filtered', () => {
  const html = page({ page: 2, pageCount: 4, total: 200, categories: CATEGORIES });
  const links = [...html.matchAll(/href="(\/product-keywords\?[^"]*)"/g)].map((match) => match[1]);

  assert.deepEqual(links, [
    '/product-keywords?page=1',
    '/product-keywords?page=3',
    '/product-keywords?page=1',
    '/product-keywords?page=3',
  ]);
});

test('Clear Filters is shown only while a filter is on', () => {
  assert.ok(filtered().includes('<a class="btn" href="/product-keywords">Clear Filters</a>'));
  assert.ok(page({ search: 'door' }).includes('<a class="btn" href="/product-keywords">Clear Filters</a>'));
  assert.ok(
    page({ categories: CATEGORIES }).includes('<a class="btn" href="/product-keywords" hidden>Clear Filters</a>'),
  );
});

test('an empty filtered result says which category is empty', () => {
  const html = filtered({ products: [], total: 0, pageCount: 1 });

  assert.match(html, /No products found in Pendant Lighting\./);
});

test('the filter is a plain GET form back to this application', () => {
  const html = page({ categories: CATEGORIES });

  assert.match(html, /<form class="filter" method="get" action="\/product-keywords">/);
  assert.match(html, /<select name="category" id="category">/);
  assert.match(html, /<input type="search" name="search" id="search"/);
  assert.match(html, /placeholder="Search by SKU, Product ID or name\.\.\."/);
  assert.match(html, /<button type="submit" class="btn btn-primary">Apply<\/button>/);
  assert.ok(!html.includes('<script'), 'the filter needs no JavaScript');
});

// ---------------------------------------------------------------------------
// Keyword text is ordinary text. Only the small source tag is coloured.
// ---------------------------------------------------------------------------

/** A page whose secondary keywords carry one of each source. */
const tagged = () =>
  page({
    products: [{ id: 1, sku: 'HLBP128BB', title: 'Brass Door Handle' }],
    classify: () => ({
      primary: term('Door Handle'),
      secondary: [
        {
          term: 'Door Pull',
          resource: 'amazon',
          resourceLabel: 'Amazon',
          resourceDetail:
            "Recorded in this product's Amazon backend search keywords " +
            '(listings.amazon_listing_search_engine_keywords.keyword)',
        },
        {
          term: 'Pull Handle',
          resource: 'google-search-console',
          resourceLabel: 'Google Search Console',
          resourceDetail:
            "A real Google search query recorded against this product's page " +
            '(google_search_console.query_page.query)',
        },
        {
          // A Shopify storefront is named after the business, not the platform.
          term: 'Brass',
          resource: 'shopify',
          resourceLabel: 'Electricalsone',
          resourceDetail:
            "Filed as a tag on this product's Electricalsone listing " +
            '(listings.shopify_listing_tag.tag)',
        },
      ],
      longTail: term('Brass Door Handle'),
      competitor: term('Cabinet Handle'),
    }),
  });

test('the resource pill sits BELOW its keyword, not beside it', () => {
  const cell = firstRowCells(tagged())[6];

  // Keyword and pill are separate blocks inside one .kw, the keyword first.
  assert.ok(cell.includes('<span class="term">Door Pull</span><span class="tag tag-amazon"'));
  assert.ok(
    cell.includes('<span class="term">Pull Handle</span><span class="tag tag-google-search-console"'),
  );
  assert.ok(cell.includes('<span class="term">Brass</span><span class="tag tag-shopify"'));

  // Never "Door Pull [Amazon]" running along one line.
  assert.ok(!/Door Pull <span class="tag/.test(cell), 'the pill must not follow inline');
  assert.equal([...cell.matchAll(/<span class="kw">/g)].length, 3, 'one block per keyword');
});

test('the keyword and its tag are each their own line', () => {
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

  assert.match(styles, /\.kw \.term \{[^}]*display: block/, 'the keyword is a block');
  // inline-block: the pill starts a new line (the keyword above is a block)
  // but only as wide as its own label.
  assert.match(styles, /\.tag \{[^}]*display: inline-block/, 'the pill hugs its label');
});

test('the pill names the RESOURCE, and never says GEN or Generated', () => {
  const cell = firstRowCells(tagged())[6];
  const tags = [...cell.matchAll(/<span class="tag tag-[\w-]+"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

  // Every one is a real place a reader could go and check, and the Shopify
  // storefront is named as the business rather than as the platform.
  assert.deepEqual(tags, ['Amazon', 'Google Search Console', 'Electricalsone']);
});

test('the word GEN reaches the reader nowhere on the page', () => {
  // The whole point of the resource pill: a method is not a source. "GEN",
  // "MIX" and "Generated" must not reach the reader - pill, tooltip or markup.
  //
  // Comments are stripped first - HTML and CSS both. page.html's own
  // documentation explains WHY there is no GEN, and those sentences have to be
  // allowed to say the word. The CSS RULES are not stripped, so a stray
  // .tag-gen selector would still be caught below.
  const visible = tagged()
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(!/\bGEN\b/.test(visible), 'GEN must not appear');
  assert.ok(!/\bMIX\b/.test(visible), 'MIX must not appear');
  assert.ok(!/>\s*DB\s*</.test(visible), 'DB must not appear as a pill label');
  assert.ok(!/\bGenerated\b/.test(visible), '"Generated" is a method, not a resource');
  assert.ok(!visible.includes('tag-gen'), 'no gen class');
  assert.ok(!visible.includes('tag-mix'), 'no mix class');
  assert.ok(!visible.includes('tag-db"'), 'no db class');
});

test('every resource the generator can report has a label and a colour', () => {
  // A resource with no label would render no pill and silently lose provenance.
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

  for (const [resource, label] of Object.entries(SOURCE_LABEL)) {
    const html = page({
      products: [{ id: 1, sku: 'X', title: 'A product' }],
      classify: () => ({ primary: [{ term: 'Something', resource }], secondary: [], longTail: [], competitor: [] }),
    });

    // The label is compared ESCAPED, because that is what a correct renderer
    // writes: "B&Q" reaches the page as "B&amp;Q" and displays as "B&Q".
    const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    assert.ok(html.includes(`<span class="tag tag-${resource}"`), `${resource} renders a pill`);
    assert.ok(html.includes(`>${escaped}</span>`), `${resource} is labelled "${label}"`);
    assert.match(styles, new RegExp(`\\.tag-${resource} \\{ background: var\\(--tag-${resource}\\); \\}`));
    assert.match(styles, new RegExp(`--tag-${resource}: #[0-9a-f]{6};`), `${resource} has a colour`);
  }
});

test('a keyword whose resource cannot be established gets no pill', () => {
  for (const unprovable of [null, undefined, 'nonsense']) {
    const html = page({
      products: [{ id: 1, sku: 'X', title: 'A product' }],
      classify: () => ({
        primary: [{ term: 'Something', resource: unprovable }],
        secondary: [],
        longTail: [],
        competitor: [],
      }),
    });

    assert.ok(html.includes('<span class="term">Something</span>'), 'the keyword is still shown');
    assert.ok(!html.includes('class="tag tag-'), `no pill for ${String(unprovable)}`);
  }
});

test('the keyword itself carries no colour, chip or background', () => {
  const cell = firstRowCells(tagged())[6];

  // The keyword line is a plain .kw with no source class of its own; only the
  // tag inside it is classed by source.
  assert.ok(!/<span class="kw [^"]/.test(cell), 'the keyword span has no extra class');
  assert.ok(!/class="kw"[^>]*style=/.test(cell), 'no inline styling on a keyword');
  assert.ok(!cell.includes('chip'), 'keywords are not chips');
  assert.ok(!cell.includes('background'), 'no background on a keyword');
});

test('only the tag is coloured, and the keyword text is not', () => {
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

  // The keyword takes the ordinary body colour.
  assert.match(styles, /\.kw \.term \{[^}]*color: var\(--ink\)/, 'keyword text is normal dark text');
  assert.ok(!/\.kw \.term \{[^}]*background:/.test(styles), 'no background on keyword text');

  // The pill's COLOUR is a background, and only the resource rules set one.
  assert.match(styles, /\.tag-amazon \{ background: var\(--tag-amazon\); \}/);
  assert.match(styles, /\.tag-ebay \{ background: var\(--tag-ebay\); \}/);
  assert.match(styles, /\.tag-google-search-console \{ background: var\(--tag-google-search-console\); \}/);

  // ONE COLOUR PER RESOURCE TYPE, never per keyword - and all four distinct,
  // so the reader can tell the resources apart at a glance.
  const colours = Object.keys(SOURCE_LABEL).map(
    (resource) => new RegExp(`--tag-${resource}: (#[0-9a-f]{6});`).exec(styles)?.[1],
  );
  assert.ok(colours.every(Boolean), 'every resource has a colour');
  assert.equal(new Set(colours).size, colours.length, 'each resource type has its own colour');

  // A small, compact, rounded pill with a white label on the colour.
  assert.match(styles, /\.tag \{[^}]*border-radius: 999px;/, 'the tag is a pill');
  assert.match(styles, /\.tag \{[^}]*color: #fff;/, 'the label reads on the colour');
  assert.match(styles, /\.tag \{[^}]*padding: 1px 7px;/, 'and it is compact');
  assert.match(styles, /\.tag \{[^}]*font-size: 10px;/, 'and small');
});

test('the tag is small', () => {
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';
  const size = /\.tag \{[^}]*font-size: (\d+)px/.exec(styles)?.[1];

  assert.ok(Number(size) <= 11, `the tag should be small, got ${size}px`);
});

test('there is no separate tag column of any kind', () => {
  // Nine columns are the whole table. There is no Tags column, and there is no
  // column for a keyword's provenance either: a resource belongs UNDERNEATH
  // its own keyword, inside that keyword's cell.
  const headings = [...tagged().matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);

  assert.deepEqual(headings, COLUMNS, 'still exactly the nine columns');
  assert.ok(!headings.some((heading) => /^tags?$/i.test(heading)), 'no Tags column');
  assert.ok(!headings.some((heading) => /source|provenance|origin/i.test(heading)));
  assert.ok(!headings.some((heading) => /^(DB|GEN|MIX)$/i.test(heading)));
  assert.equal(firstRowCells(tagged()).length, 9, 'and nine cells per row');

  // Every resource pill is inside a keyword cell and nowhere else.
  const cells = firstRowCells(tagged());
  for (const earlier of cells.slice(0, FIRST_KEYWORD_CELL)) {
    assert.ok(!earlier.includes('class="tag tag-'), 'no resource pill before the keyword cells');
  }
  assert.ok(cells[6].includes('class="tag tag-'), 'the resource pill is in the keyword cell');
});

test('a keyword value from the database is escaped, tag and all', () => {
  const html = page({
    products: [{ id: 1, sku: 'X', title: 'A product' }],
    classify: () => ({
      primary: [{ term: '<b>Lamp</b> & "co"', source: 'db' }],
      secondary: [],
      longTail: [],
      competitor: [],
    }),
  });

  assert.ok(!html.includes('<b>Lamp</b>'), 'a keyword must not inject markup');
  assert.ok(html.includes('&lt;b&gt;Lamp&lt;/b&gt; &amp; &quot;co&quot;'));
});

test('a keyword with unproven provenance gets NO tag, not a guessed one', () => {
  // Labelling this GEN would claim the application generated it, which is
  // exactly the invention to avoid. The keyword still shows; the tag does not.
  for (const source of [null, undefined, 'nonsense']) {
    const html = page({
      products: [{ id: 1, sku: 'X', title: 'A product' }],
      classify: () => ({
        primary: [{ term: 'Something', source, input: null }],
        secondary: [],
        longTail: [],
        competitor: [],
      }),
    });

    assert.ok(html.includes('<span class="term">Something</span>'), 'the keyword is still shown');
    assert.ok(!html.includes('class="tag tag-'), `no source tag for ${String(source)}`);
    assert.ok(!html.includes('tag-nonsense'));
  }
});

test("the pill's tooltip names the table and column the word was proven from", () => {
  // The tooltip is what makes a tag checkable: it points at the row.
  const cell = firstRowCells(tagged())[6];

  assert.ok(cell.includes('listings.amazon_listing_search_engine_keywords.keyword'));
  assert.ok(cell.includes('google_search_console.query_page.query'));
  assert.ok(cell.includes('listings.shopify_listing_tag.tag'));
});

test('a method name is never used as a resource tag', () => {
  // The whole point. These describe how the wording was produced; the tag
  // answers where the word came from, and they are not the same question.
  const cell = firstRowCells(tagged())[6];
  const labels = [...cell.matchAll(/<span class="tag tag-[\w-]+"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

  for (const method of ['GEN', 'Generated', 'Terminology', 'Product Name', 'Product Type', 'Product Name + Type']) {
    assert.ok(!labels.includes(method), `"${method}" is a method, not a resource`);
  }
});

test('a keyword category with nothing in it is a blank cell, with no tag', () => {
  const cells = firstRowCells(page());

  assert.deepEqual(cells.slice(FIRST_KEYWORD_CELL), ['', '', '', '']);
  assert.ok(!page().includes('class="tag tag-'), 'no source tag is shown for a blank cell');
});

test('the page title is exactly Product Keywords', () => {
  assert.ok(TEMPLATE.includes('<title>Product Keywords</title>'));
  assert.ok(page().includes('<title>Product Keywords</title>'));
});

test('there is no sidebar', () => {
  const html = page();

  for (const sidebar of ['sidebar', '<aside', 'nav-menu', 'drawer']) {
    assert.ok(!html.toLowerCase().includes(sidebar), `${sidebar} must not be in the page`);
  }
});

// ---------------------------------------------------------------------------
// The search box.
// ---------------------------------------------------------------------------

test('the filter card offers Search, Categories and Clear Filters', () => {
  const html = page({ categories: CATEGORIES });

  assert.match(html, /<label for="search">Search<\/label>/);
  assert.match(html, /<label for="category">Categories<\/label>/);
  assert.ok(html.includes('Clear Filters'));
});

test('the search box keeps what was typed', () => {
  const html = page({ search: 'pendant' });

  assert.match(html, /id="search" value="pendant"/);
});

test('a search term is escaped in the box and in the count line', () => {
  const html = page({ search: '"><script>alert(1)</script>', total: 0, products: [] });

  assert.ok(!html.includes('<script>alert(1)'), 'a search term must not inject markup');
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
});

test('the count line names the search term', () => {
  const html = page({ search: 'door', total: 12 });

  assert.match(html, /of 12 products matching &ldquo;door&rdquo;\./);
});

test('the count line names both filters together', () => {
  const html = filtered({ search: 'door', total: 3 });

  assert.match(html, /of 3 products in Pendant Lighting matching &ldquo;door&rdquo;\./);
});

test('an empty search result says what was searched for', () => {
  const html = page({ products: [], total: 0, pageCount: 1, search: 'nothing' });

  assert.match(html, /No products found matching &ldquo;nothing&rdquo;\./);
});

test('the search term is carried on every paging link', () => {
  const html = page({ page: 2, pageCount: 4, total: 200, search: 'wall light' });
  const links = [...html.matchAll(/href="(\/product-keywords\?[^"]*)"/g)].map((match) => match[1]);

  assert.deepEqual(links, [
    '/product-keywords?page=1&amp;search=wall%20light',
    '/product-keywords?page=3&amp;search=wall%20light',
    '/product-keywords?page=1&amp;search=wall%20light',
    '/product-keywords?page=3&amp;search=wall%20light',
  ]);
});

test('a search and a category are carried together while paging', () => {
  const html = filtered({ search: 'door' });
  const links = [...html.matchAll(/href="(\/product-keywords\?[^"]*)"/g)].map((match) => match[1]);

  assert.equal(links[0], '/product-keywords?page=1&amp;category=Pendant%20Lighting&amp;search=door');
  assert.equal(links[1], '/product-keywords?page=3&amp;category=Pendant%20Lighting&amp;search=door');
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

  assert.equal(cells.length, 9);
  assert.deepEqual(cells.slice(FIRST_KEYWORD_CELL), ['', '', '', '']);
  assert.ok(!html.includes('Not recorded'));
});

test('generated keyword categories render in their existing four cells', () => {
  const html = page({
    products: [{ id: 9, sku: 'PL1', title: 'Pendant Light' }],
    classify: (product) => ({
      primary: term(product.title),
      secondary: term('Hanging Light'),
      longTail: term('Pendant Ceiling Light'),
      competitor: term('Ceiling Pendant'),
    }),
  });

  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  const cells = [...row.matchAll(/<td(?: [^>]*)?>(.*?)<\/td>/g)].map((match) => match[1]);
  // The cell holds each keyword in a .term block with its tag below; this
  // reads back just the keyword text.
  const text = (cell) =>
    [...cell.matchAll(/<span class="term">([\s\S]*?)<\/span>/g)].map((match) => match[1]).join(', ');
  assert.deepEqual(cells.slice(FIRST_KEYWORD_CELL).map(text), ['Pendant Light', 'Hanging Light', 'Pendant Ceiling Light', 'Ceiling Pendant']);
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

test('a single page of results hides both pagers but keeps both counts', () => {
  // The bars are part of page.html, so they are always in the markup. With one
  // page there is nowhere to go, so the PAGER carries the plain HTML `hidden`
  // attribute and the browser does not paint it. The count is not inside the
  // pager, so it still reports what is being shown.
  const html = page({ page: 1, pageCount: 1 });

  assert.equal((html.match(/<nav class="pager" aria-label="Pagination \w+" hidden>/g) ?? []).length, 2);
  assert.ok(!html.includes('class="controls controls-top" hidden'), 'the bar itself is not hidden');
  assert.ok(!html.includes('class="controls controls-bottom" hidden'), 'the bar itself is not hidden');
  assert.equal((html.match(/<p class="count">/g) ?? []).length, 2, 'both counts still shown');
  assert.ok(!html.includes('href="/product-keywords?page='), 'no page to link to');
});

// ---------------------------------------------------------------------------
// The pagination bar: product count at the LEFT, Previous/page/Next at the
// RIGHT, in that arrangement above AND below the table.
// ---------------------------------------------------------------------------

test('each control bar puts the count first and the pager after it', () => {
  const html = page({ page: 2, pageCount: 9, total: 440 });

  for (const place of ['top', 'bottom']) {
    const bar = new RegExp(`<div class="controls controls-${place}">([\\s\\S]*?)</div>`).exec(html)?.[1] ?? '';

    const count = bar.indexOf('<p class="count">');
    const pager = bar.indexOf('<nav class="pager"');

    assert.ok(count !== -1, `${place}: the bar carries the count`);
    assert.ok(pager !== -1, `${place}: the bar carries the pager`);
    assert.ok(count < pager, `${place}: the count comes before the pager`);
  }
});

test('the bar is a flex row that pushes the pager to the right', () => {
  const styles = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

  // Count first, pager last, space-between: the count sits at the left edge
  // and the pager at the right edge of the same row.
  assert.match(styles, /\.controls \{[^}]*display: flex/);
  assert.match(styles, /\.controls \{[^}]*justify-content: space-between/);
});

test('both bars report the same count and the same page position', () => {
  const html = page({ page: 3, pageCount: 9, total: 440, products: oneProduct, pageSize: 50 });

  const counts = [...html.matchAll(/<p class="count">([\s\S]*?)<\/p>/g)].map((match) => match[1]);
  const positions = [...html.matchAll(/<span class="here">([^<]*)<\/span>/g)].map((match) => match[1]);

  assert.equal(counts.length, 2);
  assert.equal(counts[0], counts[1]);
  assert.match(counts[0], /^Showing /);
  assert.deepEqual(positions, ['Page 3 of 9', 'Page 3 of 9']);
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

test('page.html contains all nine table headers, in order', () => {
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
  assert.match(TEMPLATE, /<!--[\s\S]*?the dynamic product count/);
  assert.match(TEMPLATE, /<!--[\s\S]*?Dynamic product rows inserted here/);
  assert.match(TEMPLATE, /TOP CONTROLS \/ PAGINATION/);
  assert.match(TEMPLATE, /BOTTOM CONTROLS \/ PAGINATION/);
});

test('page.html holds no credentials, queries or secrets', () => {
  // A SQL SHAPE, not the bare word: the filter markup contains a <select>
  // element, which is not a query.
  assert.doesNotMatch(TEMPLATE, /\bSELECT\s+[\w*".]+[\s\S]{0,80}?\bFROM\b/i, 'no SQL belongs in the UI file');
  assert.doesNotMatch(TEMPLATE, /\bFROM\s+inventory\./i);
  assert.doesNotMatch(TEMPLATE, /\bLEFT JOIN\b|\bWHERE\s+\w+\s*=/i);
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
        category: 'Light Switch',
        tags: ['Light Switch', 'Screwless', 'Black'],
      },
    ],
    classify: () => ({
      primary: term('Light Switch'),
      secondary: term('Wall Switch'),
      longTail: term('Black 1 Gang Screwless Light Switch'),
      competitor: term('Light Switch Cover'),
    }),
  });

  const row = /<tbody>[\s\S]*?<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? '';
  const cells = [...row.matchAll(/<td(?: [^>]*)?>([\s\S]*?)<\/td>/g)].map((match) => match[1]);

  assert.equal(cells.length, 9, 'nine columns, no extra keyword column');
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

  assert.equal(cells.length, 9);
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

    assert.equal(cells.length, 9, `still nine cells for ${JSON.stringify(missing)}`);
    assert.equal(cells[0], '', 'the image cell is genuinely empty');
    assert.ok(!html.includes('<img'), 'no image element is invented');
    assert.ok(html.includes('<td class="img"></td>'));
  }
});

test('a product row with no image field at all still renders', () => {
  const cells = firstRowCells(page({ products: [{ id: 5, sku: 'X', title: 'A product' }] }));

  assert.equal(cells.length, 9);
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
      primary: term('Pendant Light'),
      secondary: term('Hanging Light'),
      longTail: term('Pendant Ceiling Light'),
      competitor: term('Ceiling Pendant'),
    }),
  });

  // The cell holds each keyword in a .term block with its tag below; this
  // reads back just the keyword text.
  const text = (cell) =>
    [...cell.matchAll(/<span class="term">([\s\S]*?)<\/span>/g)].map((match) => match[1]).join(', ');
  assert.deepEqual(firstRowCells(html).slice(FIRST_KEYWORD_CELL).map(text), [
    'Pendant Light',
    'Hanging Light',
    'Pendant Ceiling Light',
    'Ceiling Pendant',
  ]);
});
