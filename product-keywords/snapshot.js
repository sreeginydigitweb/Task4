/**
 * Build ONE self-contained Product Keywords HTML file.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PRODUCES
 *
 * A single .html file that another person can open by double-clicking it. It
 * carries everything the page needs inside itself:
 *
 *   - the complete HTML structure
 *   - all of the CSS, inline (taken from page.html, so the snapshot looks
 *     exactly like the live page and there is one place to restyle both)
 *   - all of the JavaScript, inline - paging and row rendering
 *   - the product data, embedded as JSON
 *   - all ten columns, Product Image first, including ledsone's own stored
 *     Product Tags
 *
 * No server, no database, no separate .js or .css file, no framework, no CDN
 * script. Opening the file is enough.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FILE FROM page.html
 *
 * page.html is the LIVE application's template. It has `{{...}}` slots that a
 * server fills per request, it needs no JavaScript at all (its paging is
 * ordinary links the server answers), and the server sends
 * `Content-Security-Policy: default-src 'none'`, which forbids scripts. Script
 * added there would be dead code that the browser refuses to run.
 *
 * So the live page stays script-free and database-backed, and this snapshot is
 * the shareable single file. Both render the same ten columns from the same
 * CSS and the same keyword logic.
 *
 * ---------------------------------------------------------------------------
 * THE DATABASE BOUNDARY - PLAINLY
 *
 * Browser JavaScript CANNOT connect to PostgreSQL. There is no way to do it
 * and nothing here pretends otherwise: a browser speaks HTTP, PostgreSQL
 * speaks its own wire protocol over TCP, and any credential shipped to a
 * browser is readable by whoever opens the file.
 *
 * So the database work happens HERE, in Node, at build time, over the same
 * read-only connection the live application uses. What lands in the HTML is
 * the RESULT - plain product rows, already rendered. The file contains no
 * host, no port, no user, no password, no connection string and no SQL.
 *
 * That makes the snapshot a point-in-time copy, not a live view. It shows what
 * the catalogue said when it was built, and it says so on the page.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 *
 *   npm run snapshot                      # 500 products (10 pages of 50)
 *   npm run snapshot -- --limit 2000      # more products
 *   npm run snapshot -- --limit 200 --embed-images
 *   npm run snapshot -- --out share/for-review.html
 *
 * --embed-images downloads each picture and inlines it as a data: URI, so the
 * file needs no internet at all. It makes the file much larger (roughly 30KB
 * per product) and takes a while, so it is off by default; without it the
 * img elements point at the same image addresses ledsone already holds, and
 * viewing the pictures needs a connection.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closePool } from './db.js';
import { RESOURCE_DESCRIPTION, RESOURCE_LABEL } from './keyword-generator.js';
// The product-tag overflow threshold, taken from the live renderer so the two
// cannot disagree about how many pills a cell draws.
import { TAGS_SHOWN } from './render.js';
import { PAGE_SIZE, classifyKeywordTerms, countProducts, findProductKeywordPage } from './source.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, '..');

/** Products included when no --limit is given. Ten pages of fifty. */
export const DEFAULT_LIMIT = 500;

/** Where the file is written when no --out is given. */
const DEFAULT_OUT = join('share', 'product-keywords-snapshot.html');

/** Images larger than this are left as a URL rather than inlined. */
const MAX_EMBEDDED_IMAGE_BYTES = 512 * 1024;

/** How many images to download at once when embedding. */
const IMAGE_CONCURRENCY = 8;

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for HTML text or an attribute.
 *
 * Only used for the handful of static values this builder writes into the
 * document. The product data does not go through here - it is embedded as
 * JSON and written into the page by the browser as text, which cannot become
 * markup at all. See serialiseData and the client script.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * The live page's stylesheet, read out of page.html.
 *
 * One stylesheet for both the live page and the snapshot: restyling page.html
 * restyles the next snapshot too.
 *
 * @returns {Promise<string>}
 */
export async function readLiveStyles() {
  const template = await readFile(join(HERE, 'page.html'), 'utf8');
  const styles = /<style>([\s\S]*?)<\/style>/.exec(template)?.[1];

  if (!styles) {
    throw new Error('No <style> block found in product-keywords/page.html.');
  }

  return styles.trim();
}

/**
 * Characters that must not appear raw inside a script element.
 *
 * Built from a string rather than written as a regular-expression literal on
 * purpose: U+2028 and U+2029 are line terminators in JavaScript source, so a
 * literal one would break this file open. Naming them by escape keeps the
 * source plain ASCII.
 */
const SCRIPT_UNSAFE = new RegExp('[<\u2028\u2029]', 'g');

/**
 * Embed the data so that it cannot end the script element that holds it.
 *
 * The one thing that could break out of `<script type="application/json">` is
 * the text `</script>`, and more generally any `<`. Escaping every `<` as a
 * JSON unicode escape closes that off: the parsed value is identical, and no
 * product title can terminate the element.
 *
 * U+2028 and U+2029 are escaped for the same reason - they are valid inside a
 * JSON string but are line terminators in JavaScript, so a parser reading the
 * block as script would see the string end mid-way.
 *
 * @param {unknown} data
 * @returns {string}
 */
export function serialiseData(data) {
  return JSON.stringify(data).replace(SCRIPT_UNSAFE, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
}

/**
 * Turn one database row into the record the snapshot carries.
 *
 * Keyword values come from the application's own classifier, unchanged - the
 * snapshot shows the same keywords as the live page, from the same code.
 *
 * @param {{id: number, sku: string, title: string, image: string|null, category?: string|null, tags?: string[]}} product
 * @returns {{image: string|null, sku: string, id: string, name: string, category: string|null, tags: string[], primary: object[], secondary: object[], longTail: object[], competitor: object[]}}
 */
export function toSnapshotRow(product) {
  // Each category as its individual keywords, with the RESOURCE each came
  // from. The keyword VALUES are the application's own, unchanged.
  const keywords = classifyKeywordTerms(product.title);
  // t = the keyword, r = the resource it came from ('product-type',
  // 'product-name', 'product-name-type', 'database', or null when unproven,
  // in which case the cell shows no pill).
  const terms = (name) => keywords[name].map(({ term, resource }) => ({ t: term, r: resource }));

  return {
    image: typeof product.image === 'string' && product.image.trim() !== '' ? product.image.trim() : null,
    sku: product.sku ?? '',
    id: String(product.id ?? ''),
    name: product.title ?? '',
    // ledsone's own category, else one derived from the product name, else
    // null for a blank cell. Resolved by source.js; see categories.js.
    category: typeof product.category === 'string' && product.category.trim() !== '' ? product.category.trim() : null,
    // ledsone's OWN stored product tags, every one the database holds for this
    // product - not a sample, and not derived from anything. An empty array
    // where the business recorded none; the cell is then blank. These are not
    // the keyword RESOURCE pills carried in `r` below.
    tags: Array.isArray(product.tags)
      ? product.tags
          .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
          .map((tag) => tag.trim())
      : [],
    primary: terms('primary'),
    secondary: terms('secondary'),
    longTail: terms('longTail'),
    competitor: terms('competitor'),
  };
}

/**
 * The categories present in a set of snapshot rows, busiest first.
 *
 * Built from the rows the file actually carries rather than from the whole
 * catalogue, so every option in the filter matches something in this file.
 *
 * @param {Array<{category: string|null}>} rows
 * @returns {Array<{name: string, count: number}>}
 */
export function categoriesIn(rows) {
  const counts = new Map();

  for (const row of rows) {
    if (typeof row.category !== 'string' || row.category === '') continue;
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'));
}

/**
 * The paging and rendering script the snapshot carries.
 *
 * Deliberately plain: no framework, no build step, no import, nothing fetched.
 * It reads the embedded JSON and draws one page of rows at a time.
 *
 * Rows are built with createElement and textContent, never by assembling
 * markup from data. A product title containing `<script>` becomes those
 * characters on screen and can never become an element - the browser is never
 * asked to parse product text as HTML. The image is the one attribute taken
 * from data, and only after its address is checked.
 *
 * @param {number} pageSize
 * @returns {string}
 */
function clientScript(pageSize) {
  return `
'use strict';

var PAGE_SIZE = ${Number(pageSize)};
var ROWS = JSON.parse(document.getElementById('snapshot-data').textContent);
var current = 1;
var category = '';        /* '' means All Categories */
var search = '';          /* '' means no search */
var visible = ROWS;       /* the rows the filters leave */
var PAGE_COUNT = 1;

var tbody = document.getElementById('rows');
/* The count appears at the LEFT of both control bars, so both are written. */
var countLines = [document.getElementById('count-top'), document.getElementById('count-bottom')];
var empty = document.getElementById('empty');
var picker = document.getElementById('category');
var box = document.getElementById('search');

/* Only a real web address may become an image source. A data:, javascript: or
   relative value is treated as no image, exactly as the live page does. */
function imageUrl(value) {
  return typeof value === 'string' && /^https?:\\/\\//i.test(value) ? value : null;
}

function cell(text, className) {
  var td = document.createElement('td');
  if (className) td.className = className;
  /* textContent, not innerHTML: product text is text. */
  if (text !== null && text !== undefined) td.textContent = String(text);
  return td;
}

/* How many PRODUCT tag pills a cell draws before the rest go into a "+N" pill.
   Every tag is in the data and every one is reachable - the overflow pill
   names the remainder in its tooltip. This only stops a product with a hundred
   tags making a row taller than the screen. */
var TAGS_SHOWN = ${Number(TAGS_SHOWN)};

/* The PRODUCT TAGS cell: ledsone's own stored tags, as small blue pills.
   Different data from the keyword RESOURCE pills below, and in its own
   column. A product with none gets a genuinely empty cell. */
function tagsCell(tags) {
  var td = document.createElement('td');
  td.className = 'tags';
  if (!tags || !tags.length) return td;

  tags.slice(0, TAGS_SHOWN).forEach(function (tag) {
    var pill = document.createElement('span');
    pill.className = 'ptag';
    /* textContent: a tag is product text and is never parsed as markup. */
    pill.textContent = tag;
    td.appendChild(pill);
  });

  var rest = tags.slice(TAGS_SHOWN);
  if (rest.length) {
    var more = document.createElement('span');
    more.className = 'ptag ptag-more';
    more.title = rest.join(', ');
    more.textContent = '+' + rest.length.toLocaleString('en-GB');
    td.appendChild(more);
  }

  return td;
}

/* The RESOURCE each keyword came from: its pill text, and its tooltip. Both
   are filled in at build time from the application's own lists, so this file
   cannot name a resource differently from the live page.

   A resource is a PLACE ("Product Type", "Product Name", "Database"), never a
   method. There is no "GEN" and no "Generated" here by design. */
var RESOURCE_LABEL = ${serialiseData(RESOURCE_LABEL)};
var RESOURCE_TITLE = ${serialiseData(RESOURCE_DESCRIPTION)};

/* A keyword cell: each keyword as ordinary text on its own line, with a small
   coloured pill below it naming the resource it came from. The keyword itself
   gets no colour and no background; only the pill is coloured. */
function keywordCell(terms) {
  var td = document.createElement('td');
  if (!terms || !terms.length) return td;

  terms.forEach(function (entry) {
    var line = document.createElement('span');
    line.className = 'kw';

    /* The keyword, as text - never parsed as markup - on its own line. */
    var word = document.createElement('span');
    word.className = 'term';
    word.textContent = entry.t;
    line.appendChild(word);

    /* The resource pill goes on the line BELOW the keyword. A keyword whose
       resource could not be established carries NO pill rather than a guessed
       one. */
    if (RESOURCE_LABEL[entry.r]) {
      var tag = document.createElement('span');
      tag.className = 'tag tag-' + entry.r;
      tag.title = RESOURCE_TITLE[entry.r] || RESOURCE_LABEL[entry.r];
      tag.textContent = RESOURCE_LABEL[entry.r];
      line.appendChild(tag);
    }

    td.appendChild(line);
  });

  return td;
}

function imageCell(row) {
  var td = document.createElement('td');
  td.className = 'img';

  var url = imageUrl(row.image);
  if (url === null) return td;          /* no image: a genuinely empty cell */

  var img = document.createElement('img');
  img.src = url;
  img.alt = row.name || '';
  img.width = 56;
  img.height = 56;
  img.loading = 'lazy';
  img.decoding = 'async';
  td.appendChild(img);
  return td;
}

function drawRows(page) {
  var first = (page - 1) * PAGE_SIZE;
  var slice = visible.slice(first, first + PAGE_SIZE);

  tbody.textContent = '';
  var fragment = document.createDocumentFragment();

  slice.forEach(function (row) {
    var tr = document.createElement('tr');
    tr.appendChild(imageCell(row));
    tr.appendChild(cell(row.sku, 'sku'));
    tr.appendChild(cell(row.id, 'num'));
    tr.appendChild(cell(row.name, 'name'));
    tr.appendChild(cell(row.category, 'category'));
    tr.appendChild(tagsCell(row.tags));
    tr.appendChild(keywordCell(row.primary));
    tr.appendChild(keywordCell(row.secondary));
    tr.appendChild(keywordCell(row.longTail));
    tr.appendChild(keywordCell(row.competitor));
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);
  empty.hidden = slice.length > 0;

  var where = (category === '' ? '' : ' in ' + category) +
    (search === '' ? '' : ' matching \\u201c' + search + '\\u201d');

  var text = slice.length === 0
    ? 'No products' + where + '.'
    : 'Showing ' + (first + 1).toLocaleString('en-GB') + '\\u2013' +
      (first + slice.length).toLocaleString('en-GB') + ' of ' +
      visible.length.toLocaleString('en-GB') + ' products' + where + ' in this snapshot.';

  countLines.forEach(function (line) { if (line) line.textContent = text; });
}

function drawControls(page) {
  ['top', 'bottom'].forEach(function (place) {
    document.getElementById('position-' + place).textContent =
      'Page ' + page.toLocaleString('en-GB') + ' of ' + PAGE_COUNT.toLocaleString('en-GB');

    var previous = document.getElementById('prev-' + place);
    var next = document.getElementById('next-' + place);

    previous.disabled = page <= 1;
    next.disabled = page >= PAGE_COUNT;
    previous.setAttribute('aria-disabled', String(page <= 1));
    next.setAttribute('aria-disabled', String(page >= PAGE_COUNT));
  });

  /* Only the PAGER is hidden on a one-page result, not the whole bar - the
     count at the left of each bar must keep reporting what is shown. */
  document.querySelectorAll('.pager').forEach(function (pager) {
    pager.hidden = PAGE_COUNT <= 1;
  });
}

/* Does one product match the search box? SKU and name match on any part;
   Product ID matches exactly, so searching "2" does not return every id
   containing a 2. */
function matchesSearch(row, needle) {
  if (needle === '') return true;

  var lower = needle.toLowerCase();
  return String(row.sku || '').toLowerCase().indexOf(lower) !== -1 ||
    String(row.name || '').toLowerCase().indexOf(lower) !== -1 ||
    String(row.id || '') === needle;
}

/* Apply the chosen filters. Paging always restarts at page 1, because page 7
   of everything is not page 7 of one category. */
function filterTo(nextCategory, nextSearch, page) {
  category = typeof nextCategory === 'string' ? nextCategory : '';
  search = typeof nextSearch === 'string' ? nextSearch.trim() : '';

  visible = ROWS.filter(function (row) {
    return (category === '' || row.category === category) && matchesSearch(row, search);
  });

  PAGE_COUNT = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  if (picker && picker.value !== category) picker.value = category;
  if (box && box.value !== search) box.value = search;

  show(page || 1);
}

function show(page) {
  current = Math.min(Math.max(1, page), PAGE_COUNT);
  drawRows(current);
  drawControls(current);
  /* Keep the address bar in step so a page can be linked to or reloaded, and
     so the chosen category survives a reload. */
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', '#page=' + current +
      (category === '' ? '' : '&category=' + encodeURIComponent(category)) +
      (search === '' ? '' : '&search=' + encodeURIComponent(search)));
  }
}

['top', 'bottom'].forEach(function (place) {
  document.getElementById('prev-' + place).addEventListener('click', function () {
    show(current - 1);
    window.scrollTo(0, 0);
  });
  document.getElementById('next-' + place).addEventListener('click', function () {
    show(current + 1);
    window.scrollTo(0, 0);
  });
});

/* Left and right arrow keys page too, as long as nothing else has focus. */
document.addEventListener('keydown', function (event) {
  if (event.target !== document.body) return;
  if (event.key === 'ArrowLeft') show(current - 1);
  if (event.key === 'ArrowRight') show(current + 1);
});

if (picker) {
  picker.addEventListener('change', function () {
    filterTo(picker.value, search, 1);
    window.scrollTo(0, 0);
  });
}

if (box) {
  /* Filters as you type - there is no server to ask, so there is nothing to
     wait for. */
  box.addEventListener('input', function () { filterTo(category, box.value, 1); });
  box.addEventListener('search', function () { filterTo(category, box.value, 1); });
}

var clear = document.getElementById('clear-filter');
if (clear) {
  clear.addEventListener('click', function () {
    filterTo('', '', 1);
    window.scrollTo(0, 0);
  });
}

/* Open on whatever the address asks for, so a filtered page can be linked to. */
var hash = window.location.hash || '';
var wantedPage = parseInt((hash.match(/page=(\\d+)/) || [])[1], 10);
var wantedCategory = (hash.match(/category=([^&]*)/) || [])[1];
var wantedSearch = (hash.match(/search=([^&]*)/) || [])[1];

function decode(value) {
  try {
    return value ? decodeURIComponent(value) : '';
  } catch (error) {
    return '';
  }
}

wantedCategory = decode(wantedCategory);
wantedSearch = decode(wantedSearch);

/* A category the file does not hold is treated as no filter, not an error. */
var known = ROWS.some(function (row) { return row.category === wantedCategory; });

filterTo(known ? wantedCategory : '', wantedSearch, Number.isFinite(wantedPage) ? wantedPage : 1);
`.trim();
}

/**
 * The ten columns, in the order the requirement sets.
 *
 * There is deliberately no source/provenance column: a keyword's RESOURCE pill
 * sits underneath the keyword itself, inside its own cell.
 */
export const COLUMNS = Object.freeze([
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

/**
 * Build the whole self-contained document.
 *
 * Pure: hand it rows and a stylesheet and it returns the file's text. No
 * database, no filesystem, which is why the tests can exercise it directly.
 *
 * @param {object} options
 * @param {Array<object>} options.rows        Snapshot rows (see toSnapshotRow).
 * @param {string} options.styles             The stylesheet, inline.
 * @param {number} [options.pageSize]
 * @param {string} [options.generatedAt]      ISO timestamp, shown on the page.
 * @param {number} [options.catalogueTotal]   Products in the whole catalogue.
 * @param {boolean} [options.imagesEmbedded]
 * @returns {string}
 */
export function buildSnapshotHtml({
  rows,
  styles,
  pageSize = PAGE_SIZE,
  generatedAt = new Date().toISOString(),
  catalogueTotal = rows.length,
  imagesEmbedded = false,
}) {
  const built = new Date(generatedAt);
  const when = Number.isNaN(built.valueOf()) ? String(generatedAt) : built.toISOString().replace('T', ' ').slice(0, 16);

  const withImage = rows.filter((row) => typeof row.image === 'string' && row.image !== '').length;

  const categories = categoriesIn(rows);
  const withCategory = categories.reduce((sum, { count }) => sum + count, 0);
  const withTags = rows.filter((row) => Array.isArray(row.tags) && row.tags.length > 0).length;
  const tagCount = rows.reduce((sum, row) => sum + (Array.isArray(row.tags) ? row.tags.length : 0), 0);

  const headers = COLUMNS.map((name) => `            <th>${escapeHtml(name)}</th>`).join('\n');

  // "All Categories" is the empty value, which the script reads as no filter.
  const options = [
    `<option value="">All Categories (${rows.length.toLocaleString('en-GB')})</option>`,
    ...categories.map(
      ({ name, count }) =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count.toLocaleString('en-GB')})</option>`,
    ),
  ].join('');

  // One bar, two ends: the product count at the LEFT, the Previous / page /
  // Next group at the RIGHT. Same arrangement above and below the table. The
  // `hidden` starts on the PAGER alone, so the count is never hidden with it.
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
  PRODUCT KEYWORDS - SELF-CONTAINED SNAPSHOT
  ===========================================================================

  ONE file. Open it by double-clicking; nothing else is needed. It contains
  its own HTML, its own CSS, its own JavaScript and its own data. There is no
  external stylesheet, no external script, no framework, no CDN and no server.

  Built from the ledsone database at ${escapeHtml(when)} UTC by
  product-keywords/snapshot.js.

  WHAT IT IS NOT: a live view. The rows below are a point-in-time copy. To see
  today's catalogue, run the live application (npm start) or rebuild this file
  (npm run snapshot).

  NO DATABASE ACCESS IS POSSIBLE FROM THIS FILE, BY DESIGN. Browser JavaScript
  cannot speak to PostgreSQL - a browser speaks HTTP, PostgreSQL does not - and
  any credential put in a file like this one would be readable by anyone who
  opened it. So the database was read in Node, at build time, over the
  application's read-only connection, and only the RESULT is here. This file
  holds no host, no port, no user, no password, no connection string and no
  SQL.

  ${
    imagesEmbedded
      ? 'IMAGES ARE EMBEDDED in this file as data: URIs, so it needs no internet.'
      : 'IMAGES LOAD FROM THE ADDRESSES HELD IN LEDSONE, so viewing the pictures\n  needs an internet connection. Everything else works offline. Rebuild with\n  --embed-images to inline them and remove that dependency.'
  }

  Product rows: ${rows.length.toLocaleString('en-GB')} of ${catalogueTotal.toLocaleString('en-GB')} in the catalogue.
  With an image: ${withImage.toLocaleString('en-GB')}. Without: ${(rows.length - withImage).toLocaleString('en-GB')} - those cells
  are deliberately blank; no placeholder picture is ever substituted.

  Categories: ${categories.length.toLocaleString('en-GB')} across ${withCategory.toLocaleString('en-GB')} of these products;
  ${(rows.length - withCategory).toLocaleString('en-GB')} have none and show a blank Category cell. A category is
  ledsone's own recorded one where it has one, otherwise the product type the
  product name itself states. The filter above the table works entirely inside
  this file.

  Product tags: ${tagCount.toLocaleString('en-GB')} in total across ${withTags.toLocaleString('en-GB')} of these products;
  ${(rows.length - withTags).toLocaleString('en-GB')} have none and show a blank Tags cell. EVERY tag ledsone holds
  for EVERY product in this file is carried in the data below - no product is
  sampled and no tag list is truncated in the data. They are the business's own
  stored tags from listings.shopify_listing_tag, reached through the listing
  that carries the SKU and that listing's parent; nothing here derives, guesses
  or invents a tag. A cell draws the first ${Number(TAGS_SHOWN)} as pills and names any remainder
  in a "+N" pill's tooltip, so a product with a hundred tags cannot make one
  row taller than the screen.

  These PRODUCT TAGS are a different thing from the RESOURCE pills under each
  keyword: the first is ledsone's own product data, the second names where
  this application took a keyword's wording from.
-->
<style>
${styles}

/* Snapshot-only additions. The paging controls are buttons here rather than
   links, because there is no server to answer a link. */
button.btn { font: inherit; cursor: pointer; }
button.btn:disabled { color: var(--muted); opacity: .55; cursor: default; border-color: var(--line); }
.filter button.btn { padding: 5px 12px; }
.controls[hidden], [hidden] { display: none !important; }
.snapshot-note { color: var(--muted); font-size: 12px; margin: 0 0 14px; max-width: 90ch; }
.snapshot-note code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
</head>
<body>
  <main>

    <!-- ================= PAGE HEADING ================= -->
    <h1>Product Keywords</h1>

    <!-- Static note: says what this file is, so nobody mistakes it for live. -->
    <p class="snapshot-note">
      Self-contained snapshot of the ledsone catalogue, built ${escapeHtml(when)} UTC.
      ${rows.length.toLocaleString('en-GB')} of ${catalogueTotal.toLocaleString('en-GB')} products.
      This file is a point-in-time copy and does not update; it holds no database
      connection and no credentials. Rebuild with <code>npm run snapshot</code>.
    </p>

    <!-- ================= FILTER CARD =================
         Filters the embedded rows in the browser. There is no server here, so
         searching or choosing a category re-draws the table from the data
         already in this file. Counts are for this snapshot, not the whole
         catalogue. -->
    <div class="filter">
      <div class="field">
        <label for="search">Search</label>
        <input type="search" id="search" placeholder="Search by SKU, Product ID or name..." autocomplete="off">
      </div>
      <div class="field">
        <label for="category">Categories</label>
        <select id="category">${options}</select>
      </div>
      <div class="field actions">
        <button type="button" class="btn" id="clear-filter">Clear Filters</button>
      </div>
    </div>

${controls('top')}

    <!-- ================= PRODUCT KEYWORD TABLE =================
         Ten columns, in the required order. The Tags column carries ledsone's
         own stored product tags; there is no separate source column, because a
         keyword's RESOURCE pill sits underneath the keyword itself. -->
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
${headers}
          </tr>
        </thead>
        <tbody id="rows">
          <!-- Rows are drawn here by the inline script, from the embedded
               JSON below. One table row per product, ten cells each. -->
        </tbody>
      </table>
    </div>

    <!-- ================= EMPTY STATE ================= -->
    <p class="empty" id="empty" hidden>No products in this snapshot.</p>

${controls('bottom')}

  </main>

  <!-- ================= EMBEDDED PRODUCT DATA =================
       The fetched ledsone rows, already classified. Data only: no SQL, no
       credentials, no connection details. Every "<" is escaped so no product
       title can end this element. -->
  <script type="application/json" id="snapshot-data">${serialiseData(rows)}</script>

  <!-- ================= ALL THE JAVASCRIPT THIS PAGE NEEDS =================
       Inline and complete: paging, row rendering, keyboard paging. Nothing is
       loaded from anywhere. Rows are built with createElement and textContent,
       so embedded product text can never become markup. -->
  <script>
${clientScript(pageSize)}
  </script>
</body>
</html>
`;
}

/**
 * Read `limit` products from ledsone, a page at a time.
 *
 * Uses the application's existing paged query, so there is no second piece of
 * SQL to keep in step and the read stays read-only.
 *
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
async function readProducts(limit) {
  const collected = [];

  for (let page = 1; collected.length < limit; page += 1) {
    const batch = await findProductKeywordPage({ page, pageSize: PAGE_SIZE });
    if (batch.length === 0) break;

    collected.push(...batch);
    process.stdout.write(`\r[snapshot] read ${Math.min(collected.length, limit)} products...`);
  }

  process.stdout.write('\n');
  return collected.slice(0, limit).map(toSnapshotRow);
}

/**
 * Replace image addresses with data: URIs so the file needs no internet.
 *
 * A picture that cannot be fetched keeps its address rather than failing the
 * build - the cell then behaves exactly as it does without this option.
 *
 * @param {Array<object>} rows
 * @returns {Promise<Array<object>>}
 */
async function embedImages(rows) {
  const targets = rows.filter((row) => typeof row.image === 'string' && /^https?:\/\//i.test(row.image));
  let done = 0;
  let failed = 0;

  const worker = async () => {
    for (let row = targets.pop(); row !== undefined; row = targets.pop()) {
      try {
        const response = await fetch(row.image);
        const type = response.headers.get('content-type') ?? '';

        if (response.ok && type.startsWith('image/')) {
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.byteLength <= MAX_EMBEDDED_IMAGE_BYTES) {
            row.image = `data:${type};base64,${bytes.toString('base64')}`;
          }
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }

      done += 1;
      process.stdout.write(`\r[snapshot] embedded ${done} images...`);
    }
  };

  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
  process.stdout.write('\n');
  if (failed > 0) {
    console.log(`[snapshot] ${failed} image(s) could not be fetched; those keep their address.`);
  }

  return rows;
}

/** Read the command line. */
function options(argv) {
  const value = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? null : argv[at + 1];
  };

  const rawLimit = value('--limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a whole number of products, not ${JSON.stringify(rawLimit)}.`);
  }

  return {
    limit,
    out: resolve(PROJECT, value('--out') ?? DEFAULT_OUT),
    embed: argv.includes('--embed-images'),
  };
}

/**
 * Build the file.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const { limit, out, embed } = options(process.argv.slice(2));

  const catalogueTotal = await countProducts();
  console.log(`[snapshot] ledsone holds ${catalogueTotal.toLocaleString('en-GB')} products; taking ${limit.toLocaleString('en-GB')}.`);

  const rows = await readProducts(limit);
  if (embed) await embedImages(rows);

  const html = buildSnapshotHtml({
    rows,
    styles: await readLiveStyles(),
    catalogueTotal,
    imagesEmbedded: embed,
  });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');

  const withImage = rows.filter((row) => row.image).length;
  console.log(
    `[snapshot] wrote ${relative(PROJECT, out)} - ` +
      `${rows.length.toLocaleString('en-GB')} products, ${withImage.toLocaleString('en-GB')} with an image, ` +
      `${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB. Open it directly; nothing else is needed.`,
  );
}

// Only when run as a command, so importing this file for tests touches no
// database and writes nothing.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .catch((error) => {
      console.error(`[snapshot] ${error.message}`);
      process.exitCode = 1;
    })
    .finally(closePool);
}
