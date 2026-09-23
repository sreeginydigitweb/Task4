/**
 * Build ONE standalone index.html holding the WHOLE ledsone catalogue.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PRODUCES
 *
 * `Task 4/index.html` - a single file someone can double-click. No server, no
 * database, no npm, no localhost, no network. It carries its own HTML, its own
 * CSS, its own JavaScript and every product the database returned, and the
 * search, the category filter and the paging all run inside the file.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT snapshot.js
 *
 * snapshot.js builds a 500-product sample and stays. It is a different job:
 * a small shareable extract, one JSON object per product, plain and readable.
 *
 * This builds the whole catalogue - about 44,600 products - and at that size
 * the shape of the data is the whole problem. Written the way snapshot.js
 * writes it, the same rows come to roughly 83MB, which is not a file anybody
 * opens twice. So the rows here are INTERNED and written as arrays rather than
 * objects: see encodeDataset. Same data, same values, a fraction of the bytes.
 *
 * Both read the catalogue through the same source.js, classify with the same
 * keyword-generator.js and prove resources with the same provenance.js. None
 * of that logic is copied or re-implemented here - this file is a shape, not a
 * second opinion about what the database says.
 *
 * ---------------------------------------------------------------------------
 * THE DATABASE IS USED AT BUILD TIME ONLY
 *
 * Node reads ledsone here, over the existing read-only connection, and writes
 * the RESULT into the file. The generated HTML holds no host, no port, no
 * user, no password, no connection string and no SQL - there is nothing in it
 * that could reach a database, and a browser could not do it anyway.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   npm run build                      the whole catalogue -> index.html
 *   npm run build -- --limit 2000      fewer, for a quick check
 *   npm run build -- --out somewhere.html
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkConnection, closePool } from './db.js';
import { withListingFacets } from './listing-facets.js';
import { readLiveStyles, serialiseData } from './snapshot.js';
import { classifyKeywordTerms, countProducts, findProductKeywordPage } from './source.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');

/** Where the file goes when no --out is given. The senior opens this. */
const DEFAULT_OUT = 'index.html';

/** Products shown per page in the browser. */
export const PAGE_SIZE = 50;

/**
 * Products read per database round trip.
 *
 * The page query is the application's own, so this is simply how many rows it
 * is asked for at a time. Fifty - the size the live page uses - would mean
 * nearly nine hundred round trips and about three quarters of an hour. Two
 * thousand brings the whole catalogue in at around twenty seconds a batch
 * without asking the shared database role for more than its one connection.
 */
const READ_BATCH = 2000;

/** The nine columns, in the required order. */
export const COLUMNS = Object.freeze([
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

/** The four keyword categories, in column order. */
const KEYWORD_COLUMNS = Object.freeze(['primary', 'secondary', 'longTail', 'competitor']);

/**
 * A string table.
 *
 * The catalogue repeats itself enormously: 37,786 products share one product
 * name, "Lamp Holder" is the primary keyword of thousands, and one Amazon
 * keyword record proves the same word for every variant behind a listing.
 * Written out per row that repetition IS the file size. Each distinct value is
 * stored once here and referred to by number.
 *
 * -1 means absent, and stays absent - it is never an index into anything.
 */
function stringTable() {
  const values = [];
  const seen = new Map();

  return {
    values,
    /** @param {unknown} value @returns {number} -1 when there is nothing to store. */
    of(value) {
      if (typeof value !== 'string' || value === '') return -1;

      const known = seen.get(value);
      if (known !== undefined) return known;

      const at = values.length;
      values.push(value);
      seen.set(value, at);
      return at;
    },
  };
}

/**
 * Intern one product's marketplaces (or platforms) and count each one.
 *
 * The values are ledsone's own - see listing-facets.js - and are stored
 * exactly as the database spells them. De-duplicated per product, because a
 * product listed three times in the UK is still ONE product in the UK count;
 * anything that is not a non-empty string is dropped rather than turned into
 * a value of its own.
 *
 * @param {unknown} values
 * @param {ReturnType<typeof stringTable>} table
 * @param {Map<number, number>} counts  Products per value, accumulated.
 * @returns {number[]}
 */
function facetIndexes(values, table, counts) {
  if (!Array.isArray(values)) return [];

  const indexes = [];

  for (const value of values) {
    const at = table.of(typeof value === 'string' ? value.trim() : value);
    if (at === -1 || indexes.includes(at)) continue;

    indexes.push(at);
    counts.set(at, (counts.get(at) ?? 0) + 1);
  }

  return indexes;
}

/**
 * A filter's options: busiest first, then alphabetically.
 *
 * @param {Map<number, number>} counts
 * @param {ReturnType<typeof stringTable>} table
 * @returns {Array<[number, number]>}
 */
function busiestFirst(counts, table) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || table.values[a[0]].localeCompare(table.values[b[0]], 'en'))
    .map(([index, count]) => [index, count]);
}

/**
 * Turn the rows read from ledsone into the compact structure the file carries.
 *
 * Nothing is dropped, rounded or summarised. Every product, every keyword and
 * every proven resource survives; only the SHAPE changes.
 *
 * A row becomes:
 *
 *   [ id, sku, titleIndex, image, categoryIndex, primary, secondary, long,
 *     competitor, marketplaceIndexes, platformIndexes ]
 *
 * The two trailing lists are where the product is LISTED - see
 * listing-facets.js. Both are arrays because a product is normally listed in
 * several marketplaces and on several platforms at once, and both are EMPTY
 * for a product ledsone holds no listing for. They sit at the END so that
 * every existing position keeps its meaning.
 *
 * where `image` is [prefixIndex, rest] or null, and each keyword list holds
 * one entry per keyword:
 *
 *   [ termIndex ]                          nothing proved a resource
 *   [ termIndex, labelIndex, detailIndex ] proven - the pill and its tooltip
 *
 * @param {Array<object>} products  Rows from findProductKeywordPage.
 * @returns {{data: object, counts: object}}
 */
export function encodeDataset(products) {
  const titles = stringTable();
  const terms = stringTable();
  // The slug drives the pill's COLOUR and the name is what it reads. They are
  // NOT the same: every storefront shares the slug "shopify" while naming its
  // own business, so deriving one from the other would either lose the colour
  // or lose the name. The pair is interned once - there are about a dozen.
  const resources = stringTable();
  const details = stringTable();
  const categories = stringTable();
  const prefixes = stringTable();
  // Where the product is listed. Both are short lists - about seventeen
  // marketplaces and a handful of platforms across the whole catalogue - so
  // interning them costs almost nothing and keeps every row two arrays of
  // small numbers rather than repeated text.
  const marketplaces = stringTable();
  const platforms = stringTable();

  const categoryCounts = new Map();
  const marketplaceCounts = new Map();
  const platformCounts = new Map();
  const counts = { products: 0, primary: 0, secondary: 0, longTail: 0, competitor: 0, proven: 0, withImage: 0 };

  const rows = products.map((product) => {
    counts.products += 1;

    // The image address, split so the host is stored once rather than 40,000
    // times. Anything that is not an http(s) address is kept whole.
    let image = null;
    if (typeof product.image === 'string' && product.image !== '') {
      const split = /^(https?:\/\/[^/]+\/)(.*)$/.exec(product.image);
      image = split ? [prefixes.of(split[1]), split[2]] : [prefixes.of(''), product.image];
      counts.withImage += 1;
    }

    const categoryIndex = categories.of(product.category ?? null);
    if (categoryIndex !== -1) {
      categoryCounts.set(categoryIndex, (categoryCounts.get(categoryIndex) ?? 0) + 1);
    }

    // Every marketplace and every platform ledsone records a listing on for
    // this product, kept whole. A product with no listing keeps two empty
    // arrays: it matches neither dropdown and nothing is invented for it.
    const marketplaceIndexes = facetIndexes(product.marketplaces, marketplaces, marketplaceCounts);
    const platformIndexes = facetIndexes(product.platforms, platforms, platformCounts);

    // The keywords and their resources, from the application's own classifier
    // and the evidence source.js already read. Values are untouched.
    const keywords = classifyKeywordTerms(product.title, {}, product.evidence ?? []);

    const encoded = KEYWORD_COLUMNS.map((name) => {
      const list = keywords[name] ?? [];
      counts[name] += list.length;

      return list.map((entry) => {
        const term = terms.of(entry.term);

        // A keyword nothing proves carries no resource. It is written short,
        // and the browser draws it with no pill - never a guessed one.
        if (typeof entry.resource !== 'string' || entry.resource === '') return [term];

        counts.proven += 1;
        const resource = resources.of(JSON.stringify([entry.resource, entry.resourceLabel ?? entry.resource]));
        return [term, resource, details.of(entry.resourceDetail)];
      });
    });

    return [
      Number(product.id), String(product.sku ?? ''), titles.of(product.title), image, categoryIndex,
      ...encoded,
      marketplaceIndexes, platformIndexes,
    ];
  });

  // The three filters, busiest first then alphabetically - the order
  // categories.js already uses, so the Categories list reads the same as the
  // live page, and the two new lists read the same way as it.
  const categoryOrder = busiestFirst(categoryCounts, categories);
  const marketplaceOrder = busiestFirst(marketplaceCounts, marketplaces);
  const platformOrder = busiestFirst(platformCounts, platforms);

  return {
    data: {
      titles: titles.values,
      terms: terms.values,
      resources: resources.values.map((pair) => JSON.parse(pair)),
      details: details.values,
      categories: categories.values,
      marketplaces: marketplaces.values,
      platforms: platforms.values,
      prefixes: prefixes.values,
      categoryOrder,
      marketplaceOrder,
      platformOrder,
      rows,
    },
    counts,
  };
}

/**
 * The JavaScript the generated file runs.
 *
 * Everything is built with createElement and textContent, so no product title,
 * keyword or category can ever become markup however it is spelled in the
 * database. There is no fetch, no XMLHttpRequest, no import and no external
 * script: the data is already here.
 *
 * @param {number} pageSize
 * @returns {string}
 */
function clientScript(pageSize) {
  return `
'use strict';

/* The whole catalogue, decoded from the block above. Data only. */
var D = JSON.parse(document.getElementById('product-data').textContent);
var PAGE_SIZE = ${Number(pageSize)};

var ROWS = D.rows;
var TITLES = D.titles, TERMS = D.terms, RESOURCES = D.resources, DETAILS = D.details;
var CATS = D.categories, PREFIX = D.prefixes;
/* Where each product is listed. Both are lists per product, so a product in
   four marketplaces is matched by any of the four. */
var MARKETS = D.marketplaces, PLATFORMS = D.platforms;

/* Lower-cased SKU, id and name per product, built once so that typing in the
   search box does not lower-case the whole catalogue on every keystroke. */
var HAYSTACK = new Array(ROWS.length);
for (var i = 0; i < ROWS.length; i++) {
  var r = ROWS[i];
  HAYSTACK[i] = (r[1] + ' ' + r[0] + ' ' + (r[2] === -1 ? '' : TITLES[r[2]])).toLowerCase();
}

var el = function (id) { return document.getElementById(id); };
var state = { page: 1, category: -1, marketplace: -1, platform: -1, search: '', matches: null };

/* ----------------------------------------------------------------------- */
/* Which products the current filters allow. Indices, not copies of rows.   */
/* ----------------------------------------------------------------------- */
/* Does this product's list of marketplaces (or platforms) include the one
   chosen? -1 is "All", which allows everything including a product that has
   no listing at all. A missing list matches nothing but All. */
function listed(list, wanted) {
  if (wanted === -1) return true;
  if (!list) return false;

  for (var k = 0; k < list.length; k++) if (list[k] === wanted) return true;
  return false;
}

function applyFilters() {
  var needle = state.search.trim().toLowerCase();
  var category = state.category;
  var marketplace = state.marketplace;
  var platform = state.platform;
  var out = [];

  /* AND, all four of them: a product has to pass every filter that is set. */
  for (var i = 0; i < ROWS.length; i++) {
    if (category !== -1 && ROWS[i][4] !== category) continue;
    if (!listed(ROWS[i][9], marketplace)) continue;
    if (!listed(ROWS[i][10], platform)) continue;
    if (needle !== '' && HAYSTACK[i].indexOf(needle) === -1) continue;
    out.push(i);
  }

  state.matches = out;
}

/* ----------------------------------------------------------------------- */
/* Drawing one page.                                                        */
/* ----------------------------------------------------------------------- */
function cell(text, className) {
  var td = document.createElement('td');
  if (className) td.className = className;
  /* textContent, not innerHTML: product text is text. */
  if (text !== null && text !== undefined) td.textContent = String(text);
  return td;
}

function imageCell(row) {
  var td = document.createElement('td');
  td.className = 'img';
  var image = row[3];
  /* No image recorded: a genuinely empty cell, never a placeholder picture. */
  if (!image) return td;

  var img = document.createElement('img');
  img.src = PREFIX[image[0]] + image[1];
  img.alt = row[2] === -1 ? '' : TITLES[row[2]];
  img.width = 56;
  img.height = 56;
  img.loading = 'lazy';
  td.appendChild(img);
  return td;
}

/* A keyword cell: each keyword as ordinary text on its own line, with a small
   coloured pill BELOW it naming the real resource that supplied it. A keyword
   nothing proves gets no pill at all rather than a guessed one. */
function keywordCell(list) {
  var td = document.createElement('td');
  if (!list || !list.length) return td;

  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    var line = document.createElement('span');
    line.className = 'kw';

    var word = document.createElement('span');
    word.className = 'term';
    word.textContent = TERMS[entry[0]];
    line.appendChild(word);

    /* entry[1] is present only when a real record proved the resource.
       RESOURCES[n] is [slug, name]: the slug picks the colour, the name is
       what the reader sees - "Electricalsone", not "shopify". */
    if (entry.length > 1 && entry[1] !== -1) {
      var resource = RESOURCES[entry[1]];
      var tag = document.createElement('span');
      tag.className = 'tag tag-' + resource[0];
      tag.textContent = resource[1];
      if (entry.length > 2 && entry[2] !== -1) tag.title = DETAILS[entry[2]];
      line.appendChild(tag);
    }

    td.appendChild(line);
  }

  return td;
}

function drawRows(page) {
  var body = el('rows');
  body.textContent = '';

  var matches = state.matches;
  var from = (page - 1) * PAGE_SIZE;
  var to = Math.min(from + PAGE_SIZE, matches.length);
  var fragment = document.createDocumentFragment();

  for (var i = from; i < to; i++) {
    var row = ROWS[matches[i]];
    var tr = document.createElement('tr');

    tr.appendChild(imageCell(row));
    tr.appendChild(cell(row[1], 'sku'));
    tr.appendChild(cell(row[0], 'num'));
    tr.appendChild(cell(row[2] === -1 ? '' : TITLES[row[2]], 'name'));
    tr.appendChild(cell(row[4] === -1 ? '' : CATS[row[4]], 'category'));
    tr.appendChild(keywordCell(row[5]));
    tr.appendChild(keywordCell(row[6]));
    tr.appendChild(keywordCell(row[7]));
    tr.appendChild(keywordCell(row[8]));

    fragment.appendChild(tr);
  }

  body.appendChild(fragment);
  el('empty').hidden = matches.length !== 0;
}

function number(value) { return value.toLocaleString('en-GB'); }

function drawControls(page) {
  var total = state.matches.length;
  var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  var first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  var last = Math.min(page * PAGE_SIZE, total);

  /* What the count line names: every filter that is actually set. */
  var chosen = [];
  if (state.category !== -1) chosen.push(CATS[state.category]);
  if (state.marketplace !== -1) chosen.push(MARKETS[state.marketplace]);
  if (state.platform !== -1) chosen.push(PLATFORMS[state.platform]);
  var where = chosen.length === 0 ? '' : ' in ' + chosen.join(' + ');
  var text = total === 0
    ? 'No products match' + (where || ' this search') + '.'
    : 'Showing ' + number(first) + '\\u2013' + number(last) + ' of ' + number(total) + ' products' + where + '.';

  var places = ['top', 'bottom'];
  for (var p = 0; p < places.length; p++) {
    var at = places[p];
    el('count-' + at).textContent = text;
    el('position-' + at).textContent = number(page) + ' / ' + number(pages);
    el('prev-' + at).disabled = page <= 1;
    el('next-' + at).disabled = page >= pages;
  }

  var pagers = document.querySelectorAll('.pager');
  for (var q = 0; q < pagers.length; q++) pagers[q].hidden = pages <= 1;
}

function show(page) {
  var pages = Math.max(1, Math.ceil(state.matches.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, page), pages);

  drawRows(state.page);
  drawControls(state.page);
}

/* ----------------------------------------------------------------------- */
/* The filter card.                                                         */
/* ----------------------------------------------------------------------- */
function refilter(page) {
  applyFilters();
  show(page || 1);
}

/* A dropdown's value: '' is All, which is -1 here. */
function choice(id) {
  var value = el(id).value;
  return value === '' ? -1 : Number(value);
}

/* The three dropdowns, in the order they appear on the page. */
var FILTERS = ['category', 'marketplace', 'platform'];

function readControls() {
  state.search = el('search').value;
  state.category = choice('category');
  state.marketplace = choice('marketplace');
  state.platform = choice('platform');
}

/* There is NO Apply button. Each control applies itself:

     SEARCH      on Enter, or the moment the box is emptied
     DROPDOWNS   the moment the choice changes

   Every one of them goes through refilter(1), which re-reads ALL FOUR
   controls and returns to PAGE ONE. That is why a filter can never strand the
   reader on a page number the narrowed list no longer has, and why the
   filters always combine rather than replace one another. */

/* SEARCH - on Enter. preventDefault stops the browser's own search-input
   behaviour; the filtering is this line, not a form submission. */
el('search').addEventListener('keydown', function (event) {
  if (event.key === 'Enter') { event.preventDefault(); readControls(); refilter(1); }
});

/* The one exception to Enter: EMPTYING the box - its (x) button, or deleting
   the text - drops the search at once, so an empty box never sits over a
   table still filtered by the old term. Typing anything else still waits. */
el('search').addEventListener('input', function () {
  if (el('search').value === '' && state.search !== '') { readControls(); refilter(1); }
});

/* CATEGORY, MARKETPLACE, PLATFORM - immediately on change. */
for (var f = 0; f < FILTERS.length; f++) {
  el(FILTERS[f]).addEventListener('change', function () { readControls(); refilter(1); });
}

/* CLEAR FILTERS resets all four controls, and the paging with them. */
el('clear-filter').addEventListener('click', function () {
  el('search').value = '';
  for (var c = 0; c < FILTERS.length; c++) el(FILTERS[c]).value = '';
  readControls();
  refilter(1);
});

var steps = ['top', 'bottom'];
for (var s = 0; s < steps.length; s++) {
  el('prev-' + steps[s]).addEventListener('click', function () { show(state.page - 1); });
  el('next-' + steps[s]).addEventListener('click', function () { show(state.page + 1); });
}

document.addEventListener('keydown', function (event) {
  if (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
  if (event.key === 'ArrowLeft') show(state.page - 1);
  if (event.key === 'ArrowRight') show(state.page + 1);
});

refilter(1);
`;
}

/**
 * Build the whole file.
 *
 * @param {object} options
 * @param {object} options.data     From encodeDataset.
 * @param {object} options.counts   From encodeDataset.
 * @param {string} options.styles   The live stylesheet, from page.html.
 * @param {number} [options.pageSize]
 * @returns {string}
 */
export function buildStandaloneHtml({ data, counts, styles, pageSize = PAGE_SIZE }) {
  const headers = COLUMNS.map((name) => `            <th>${escapeHtml(name)}</th>`).join('\n');

  // One dropdown's options: "All ..." first, then the values busiest first.
  // Nothing here names a category, a marketplace or a platform - every option
  // is whatever the database actually returned at build time.
  const optionsFor = (order, values, all) =>
    [
      `<option value="" selected>${escapeHtml(all)} (${counts.products.toLocaleString('en-GB')})</option>`,
      ...order.map(
        ([index, count]) =>
          `<option value="${index}">${escapeHtml(values[index])} (${count.toLocaleString('en-GB')})</option>`,
      ),
    ].join('');

  const categoryOptions = optionsFor(data.categoryOrder, data.categories, 'All Categories');
  const marketplaceOptions = optionsFor(data.marketplaceOrder, data.marketplaces, 'All Marketplaces');
  const platformOptions = optionsFor(data.platformOrder, data.platforms, 'All Platforms');

  const controls = (place) => `    <div class="controls controls-${place}">
      <p class="count" id="count-${place}"></p>
      <nav class="pager" aria-label="Pagination ${place}" hidden>
        <button type="button" class="btn" id="prev-${place}">&larr; Previous</button>
        <span class="here" id="position-${place}"></span>
        <button type="button" class="btn" id="next-${place}">Next &rarr;</button>
      </nav>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Product Keywords</title>
<!--
  ===========================================================================
  PRODUCT KEYWORDS - COMPLETE, STANDALONE.
  ===========================================================================

  ONE file. Open it by double-clicking; nothing else is needed. It holds its
  own HTML, its own CSS, its own JavaScript and the whole catalogue. There is
  no external stylesheet, no external script, no framework, no CDN, no server
  and no database connection.

  It holds NO host, NO port, NO user, NO password, NO connection string and NO
  SQL. The database was read by the build, in Node; what landed here is the
  result. A browser could not reach PostgreSQL in any case.

  The search, the Categories / Marketplace / Platform filters and the paging
  all run on the data below. The three dropdowns and the search box narrow
  together - a product has to pass all four - and Clear Filters puts every one
  of them back.

  There is no Apply button. Press Enter in the search box, or change any of
  the three dropdowns, and the table is redrawn from page one.

  Marketplace and Platform are ledsone's OWN records of where each product is
  listed: the marketplace is the listing's site and the platform is the selling
  platform that listing's account belongs to. A product the business has not
  listed anywhere carries neither, and is shown only under "All".

  Nine columns: Product Image, SKU, Product ID, Product Name, Category, and
  the four keyword columns. A keyword's RESOURCE pill sits underneath the
  keyword itself, inside its own cell - there is no separate tag column.

  A pill names the REAL place a keyword was proven to come from - Amazon,
  Google Search Console, one of the storefronts - and its tooltip names the
  database table and quotes the record. A keyword nothing proves is shown with
  NO pill; that is the honest answer and it is deliberate.
-->
<style>
${styles}

/* Standalone-only additions. The paging controls are buttons here rather than
   links, because there is no server to answer a link. */
button.btn { font: inherit; cursor: pointer; }
button.btn:disabled { color: var(--muted); opacity: .55; cursor: default; border-color: var(--line); }
.filter button.btn { padding: 5px 12px; }
.controls[hidden], [hidden] { display: none !important; }
</style>
</head>
<body>
  <main>

    <h1>Product Keywords</h1>

    <div class="filter">
      <div class="field">
        <label for="search">Search</label>
        <input type="search" id="search" placeholder="Search by SKU, Product ID or name..." autocomplete="off">
      </div>
      <div class="field">
        <label for="category">Categories</label>
        <select id="category">${categoryOptions}</select>
      </div>
      <div class="field">
        <label for="marketplace">Marketplace</label>
        <select id="marketplace">${marketplaceOptions}</select>
      </div>
      <div class="field">
        <label for="platform">Platform</label>
        <select id="platform">${platformOptions}</select>
      </div>
      <div class="field actions">
        <button type="button" class="btn" id="clear-filter">Clear Filters</button>
      </div>
    </div>

${controls('top')}

    <div class="table-scroll">
      <table>
        <thead>
          <tr>
${headers}
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <p class="empty" id="empty" hidden>No products match.</p>

${controls('bottom')}

  </main>

  <!-- ================= THE CATALOGUE =================
       Data only: no SQL, no credentials, no connection details. Repeated
       values - product names, keywords, resource names and the records that
       prove them - are stored once and referred to by number, which is what
       makes the whole catalogue a file worth opening. Every "<" is escaped so
       no product title can end this element. -->
  <script type="application/json" id="product-data">${serialiseData(data)}</script>

  <script>
${clientScript(pageSize)}
  </script>
</body>
</html>
`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape one of the few static values this builder writes into the document. */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Read the catalogue, a batch at a time.
 *
 * Uses the application's existing paged query, so there is no second piece of
 * SQL to keep in step, the read stays read-only, and the category, the image,
 * the keywords and the resource evidence are all resolved exactly as the live
 * page resolves them.
 *
 * @param {number} limit
 * @param {(read: number, total: number) => void} [onProgress]
 * @returns {Promise<Array<object>>}
 */
async function readCatalogue(limit, onProgress) {
  const collected = [];

  for (let page = 1; collected.length < limit; page += 1) {
    // The page query is the application's own; withListingFacets then adds
    // where each of those products is listed. Nothing already on the rows is
    // read or changed by it.
    const batch = await withListingFacets(await findProductKeywordPage({ page, pageSize: READ_BATCH }));
    if (batch.length === 0) break;

    collected.push(...batch);
    onProgress?.(Math.min(collected.length, limit), limit);

    if (batch.length < READ_BATCH) break;
  }

  return collected.slice(0, limit);
}

/** Read the command line. */
function options(argv) {
  const value = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? null : argv[at + 1];
  };

  const rawLimit = value('--limit');
  const limit = rawLimit === null ? Infinity : Number(rawLimit);

  if (rawLimit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a whole number of products, not ${JSON.stringify(rawLimit)}.`);
  }

  return { limit, out: resolve(PROJECT, value('--out') ?? DEFAULT_OUT) };
}

/* c8 ignore start - the command, exercised by running the build */
async function main() {
  const { limit, out } = options(process.argv.slice(2));

  // Fail here, readably, rather than half way through a long read - and prove
  // the source is still read-only to us before touching it.
  const where = await checkConnection();
  console.log(`[build] reading ${where.database} as ${where.user} - read-only: ${where.readOnly ? 'yes' : 'NO'}.`);

  const catalogueTotal = await countProducts();
  const wanted = Math.min(limit, catalogueTotal);
  console.log(`[build] ledsone holds ${catalogueTotal.toLocaleString('en-GB')} products.`);

  const started = Date.now();
  const products = await readCatalogue(wanted, (read, total) => {
    const percent = Math.floor((read / total) * 100);
    process.stdout.write(`\r[build] fetched ${read.toLocaleString('en-GB')} / ${total.toLocaleString('en-GB')} (${percent}%)...`);
  });
  process.stdout.write('\n');

  console.log(`[build] Fetched ${products.length.toLocaleString('en-GB')} products from ledsone.`);
  if (products.length !== catalogueTotal && limit === Infinity) {
    console.log(
      `[build] NOTE: the catalogue reported ${catalogueTotal.toLocaleString('en-GB')} products and ` +
        `${products.length.toLocaleString('en-GB')} were read. Nothing is padded or invented; the ` +
        'difference is reported as it stands.',
    );
  }

  const { data, counts } = encodeDataset(products);
  const html = buildStandaloneHtml({ data, counts, styles: await readLiveStyles() });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');

  const bytes = Buffer.byteLength(html);
  const keywords = counts.primary + counts.secondary + counts.longTail + counts.competitor;

  console.log('');
  console.log('Standalone build complete.');
  console.log('');
  console.log(`  Products fetched   : ${products.length.toLocaleString('en-GB')}`);
  console.log(`  Products embedded  : ${data.rows.length.toLocaleString('en-GB')}`);
  console.log(`  Products with image: ${counts.withImage.toLocaleString('en-GB')}`);
  console.log(`  Categories         : ${data.categoryOrder.length.toLocaleString('en-GB')}`);
  console.log(`  Marketplaces       : ${data.marketplaceOrder.length.toLocaleString('en-GB')}`);
  console.log(`  Platforms          : ${data.platformOrder.length.toLocaleString('en-GB')}`);
  console.log(`  Primary keywords   : ${counts.primary.toLocaleString('en-GB')}`);
  console.log(`  Secondary keywords : ${counts.secondary.toLocaleString('en-GB')}`);
  console.log(`  Long-tail keywords : ${counts.longTail.toLocaleString('en-GB')}`);
  console.log(`  Competitor keywords: ${counts.competitor.toLocaleString('en-GB')}`);
  console.log(`  Keywords in total  : ${keywords.toLocaleString('en-GB')}`);
  console.log(`  Proven resource tags: ${counts.proven.toLocaleString('en-GB')}`);
  console.log(`  Distinct resources : ${data.resources.length.toLocaleString('en-GB')}`);
  console.log(`  Output             : ${relative(PROJECT, out)} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  Built in           : ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log('');
  console.log('Open it directly. No server, no database, no npm.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .catch((error) => {
      console.error('[build] failed:', error.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
/* c8 ignore stop */
