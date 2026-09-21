/**
 * Behaviour tests for the JavaScript inside the snapshot file.
 *
 * The other snapshot tests check that the script is PRESENT. These run it.
 *
 * The script is extracted from the generated document and executed against a
 * small DOM stand-in built below, which implements only the handful of DOM
 * calls the script actually makes. That is enough to prove the real things:
 * the script parses, it draws one page of ten-cell rows from the embedded
 * data, the paging buttons move between pages and disable at the ends, and a
 * product with no image or no tags gets an empty cell.
 *
 * It is a stand-in, not a browser - it cannot prove how the page LOOKS. The
 * visual check is opening the file, which is recorded in
 * validation/product-keywords-validation.md.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSnapshotHtml } from './snapshot.js';

// ---------------------------------------------------------------------------
// A very small DOM.
// ---------------------------------------------------------------------------

/** One element, with just the surface the snapshot script touches. */
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this._text = '';
  }

  get textContent() {
    return this.children.length > 0
      ? this.children.map((child) => child.textContent).join('')
      : this._text;
  }

  set textContent(value) {
    // Assigning textContent replaces all children, as in a real DOM.
    this.children = [];
    this._text = String(value);
  }

  appendChild(node) {
    if (node instanceof Fragment) {
      this.children.push(...node.children);
      node.children = [];
      return node;
    }
    this._text = '';
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  click() {
    for (const handler of this.listeners.click ?? []) handler({ target: this });
  }

  /** Every descendant, self included. */
  tree() {
    return [this, ...this.children.flatMap((child) => child.tree())];
  }

  /** Descendants of a tag, in document order. */
  byTag(tag) {
    return this.tree().filter((node) => node.tagName === tag.toUpperCase());
  }
}

class Fragment {
  constructor() {
    this.children = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }
}

/** A text node, as document.createTextNode returns. */
class TextNode {
  constructor(text) {
    this.tagName = '#text';
    this.children = [];
    this._text = String(text);
  }

  get textContent() {
    return this._text;
  }

  tree() {
    return [this];
  }
}

/**
 * Build a document from the snapshot's markup.
 *
 * Only the elements the script looks up by id or class are modelled, which is
 * why this is a parser of the ids rather than of HTML.
 *
 * @param {string} html
 * @returns {{document: object, window: object, elements: Object<string, Element>}}
 */
function documentFor(html) {
  const elements = {};

  // Every id the script addresses, taken from the markup so a renamed id in
  // the template fails this test rather than passing silently.
  for (const [, id] of html.matchAll(/\bid="([a-z-]+)"/g)) {
    const element = new Element(id === 'rows' ? 'tbody' : 'div');
    element.attributes.id = id;
    elements[id] = element;
  }

  // The data block's contents, as the browser would see them.
  const json = /<script type="application\/json" id="snapshot-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  elements['snapshot-data'] = new Element('script');
  elements['snapshot-data'].textContent = json;

  // The two pagers, which the script hides as a group by class. Only the
  // pager is hidden on a one-page result - the count beside it stays.
  const bars = [...html.matchAll(/<nav class="pager"/g)].map(() => {
    const pager = new Element('nav');
    pager.className = 'pager';
    return pager;
  });

  const listeners = {};

  const document = {
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new TextNode(text),
    createDocumentFragment: () => new Fragment(),
    querySelectorAll: (selector) => {
      assert.equal(selector, '.pager', `unexpected selector: ${selector}`);
      return bars;
    },
    addEventListener: (type, handler) => {
      (listeners[type] ??= []).push(handler);
    },
    body: new Element('body'),
    dispatch: (type, event) => {
      for (const handler of listeners[type] ?? []) handler(event);
    },
  };

  const window = {
    location: { hash: '' },
    history: { replaceState: (_state, _title, url) => { window.location.hash = String(url); } },
    scrollTo: () => {},
  };

  return { document, window, elements, bars };
}

/**
 * Run the snapshot's inline script against the stand-in DOM.
 *
 * @param {Array<object>} rows
 * @param {string} [hash]
 * @returns {{document: object, window: object, elements: Object<string, Element>, bars: Element[]}}
 */
function run(rows, hash = '') {
  const html = buildSnapshotHtml({ rows, styles: '.x {}', pageSize: 2 });
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, 'the snapshot carries an inline script');

  const context = documentFor(html);
  context.window.location.hash = hash;

  // eslint-disable-next-line no-new-func -- running the shipped script is the point
  new Function('document', 'window', script)(context.document, context.window);

  return context;
}

/** A product row, with only what differs spelled out. */
const product = (n, overrides = {}) => ({
  image: `https://sin1.contabostorage.com/img/${n}.jpg`,
  sku: `SKU${n}`,
  id: String(n),
  name: `Product ${n}`,
  category: `Category ${n}`,
  // Each keyword category is its individual keywords, with the REAL RESOURCE
  // that supplied each: r = the slug that picks the colour, l = the resource's
  // proven name, d = the record it was proven from.
  primary: [{ t: `Primary ${n}`, r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' }],
  secondary: [{ t: `Secondary ${n}`, r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' }],
  longTail: [{ t: `LongTail ${n}`, r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' }],
  competitor: [{ t: `Competitor ${n}`, r: 'amazon', l: 'Amazon', d: 'listings.amazon_listings.title' }],
  ...overrides,
});

const FIVE = [product(1), product(2), product(3), product(4), product(5)];

// ---------------------------------------------------------------------------
// It runs, and it draws the table.
// ---------------------------------------------------------------------------

test('the inline script runs and draws the first page', () => {
  const { elements } = run(FIVE);
  const rows = elements.rows.children;

  assert.equal(rows.length, 2, 'one page of rows, at the page size given');
  assert.equal(rows[0].tagName, 'TR');
});

test('every drawn row has nine cells, in the column order', () => {
  const { elements } = run(FIVE);

  for (const row of elements.rows.children) {
    assert.equal(row.children.length, 9, 'nine cells per row');
  }

  const first = elements.rows.children[0].children;
  assert.equal(first[0].className, 'img');
  assert.equal(first[1].textContent, 'SKU1');
  assert.equal(first[2].textContent, '1');
  assert.equal(first[3].textContent, 'Product 1');
  assert.equal(first[4].textContent, 'Category 1');

  // The four keyword cells hold the keyword plus its resource pill, and they
  // follow Category directly - there is no Tags cell between them.
  assert.equal(first[5].textContent, 'Primary 1Amazon');
  assert.equal(first[6].textContent, 'Secondary 1Amazon');
  assert.equal(first[7].textContent, 'LongTail 1Amazon');
  assert.equal(first[8].textContent, 'Competitor 1Amazon');
});

// ---------------------------------------------------------------------------
// Keyword text is ordinary text; only the small tag is coloured.
// ---------------------------------------------------------------------------

/** The span.kw lines inside one keyword cell. */
const keywordLines = (cell) => cell.children.filter((child) => child.className === 'kw');

test('the tag sits below its keyword, each in its own block', () => {
  const { elements } = run([
    product(1, {
      secondary: [
        { t: 'Door Pull', r: 'amazon', l: 'Amazon', d: 'amazon backend search keywords' },
        { t: 'Pull Handle', r: 'google-search-console', l: 'Google Search Console', d: 'a real Google query' },
        // A Shopify storefront is named after the business, not the platform.
        { t: 'Brass', r: 'shopify', l: 'Electricalsone', d: 'a tag on the Electricalsone listing' },
      ],
    }),
    product(2),
  ]);

  const lines = keywordLines(elements.rows.children[0].children[6]);
  assert.equal(lines.length, 3, 'one block per keyword');

  // Each .kw holds a .term block then a .tag block - keyword first, tag below.
  for (const line of lines) {
    assert.deepEqual(
      line.children.map((child) => String(child.className).split(' ')[0]),
      ['term', 'tag'],
    );
  }

  assert.deepEqual(
    lines.map((line) => line.children[0].textContent),
    ['Door Pull', 'Pull Handle', 'Brass'],
  );
  // The pill names the REAL RESOURCE - never GEN, never "Generated", never a
  // method - and a storefront is named as the business it is.
  assert.deepEqual(
    lines.map((line) => line.children[1].textContent),
    ['Amazon', 'Google Search Console', 'Electricalsone'],
  );
});

test('the keyword itself carries no colour class, only the pill does', () => {
  const { elements } = run([
    product(1, {
      secondary: [
        { t: 'Door Pull', r: 'amazon', l: 'Amazon', d: "Recorded in this product's Amazon backend search keywords" },
      ],
    }),
    product(2),
  ]);
  const line = keywordLines(elements.rows.children[0].children[6])[0];

  // The line is a plain .kw - no chip, no colour class, no background.
  assert.equal(line.className, 'kw');

  const tag = line.children.find((child) => String(child.className).startsWith('tag'));
  assert.equal(tag.className, 'tag tag-amazon', 'the pill is the only thing classed by resource');
  assert.equal(tag.textContent, 'Amazon');
  assert.equal(tag.title, "Recorded in this product's Amazon backend search keywords");
});

test('each resource gets its own pill class and its own label', () => {
  // Every real resource, including two storefronts that share the shopify
  // colour but carry their own names.
  const expected = [
    ['amazon', 'Amazon'],
    ['ebay', 'eBay'],
    ['bandq', 'B&Q'],
    ['google-search-console', 'Google Search Console'],
    ['shopify', 'Electricalsone'],
    ['shopify', 'Vintagelite'],
  ];

  for (const [resource, label] of expected) {
    const { elements } = run([
      product(1, { primary: [{ t: 'Term', r: resource, l: label, d: 'a real record' }] }),
      product(2),
    ]);
    const line = keywordLines(elements.rows.children[0].children[5])[0];
    const tag = line.children.find((child) => String(child.className).startsWith('tag'));

    assert.equal(tag.className, `tag tag-${resource}`);
    assert.equal(tag.textContent, label);
  }
});

test('a keyword with unproven provenance gets NO pill in the snapshot either', () => {
  for (const resource of [null, undefined, 'nonsense']) {
    const { elements } = run([product(1, { primary: [{ t: 'Term', r: resource }] }), product(2)]);
    const line = keywordLines(elements.rows.children[0].children[5])[0];

    assert.equal(line.children[0].textContent, 'Term', 'the keyword is still shown');
    assert.equal(
      line.children.filter((child) => String(child.className).startsWith('tag')).length,
      0,
      `no pill for resource ${String(resource)}`,
    );
  }
});

test('the snapshot says GEN nowhere - not in its data, not in its script', () => {
  const html = buildSnapshotHtml({ rows: FIVE, styles: '.x {}', pageSize: 2 });
  const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(!/\bGEN\b/.test(visible), 'GEN must not appear');
  assert.ok(!/\bMIX\b/.test(visible), 'MIX must not appear');
  assert.ok(!/\bGenerated\b/.test(visible), '"Generated" is a method, not a resource');
  assert.ok(!visible.includes('tag-gen'), 'no gen class');
  assert.ok(!visible.includes('tag-mix'), 'no mix class');
  assert.ok(!visible.includes('"s":'), 'the old source field is gone from the data');
});

test('a keyword category with nothing in it is an empty cell, with no tag', () => {
  const { elements } = run([product(1, { longTail: [] }), product(2)]);
  const cell = elements.rows.children[0].children[7];

  assert.equal(cell.children.length, 0);
  assert.equal(cell.textContent, '');
});

test('a keyword containing markup stays text, tag and all', () => {
  const { elements } = run([
    product(1, {
      primary: [{ t: '<b>Lamp</b><script>alert(1)</script>', r: 'amazon', l: 'Amazon', d: 'a real record' }],
    }),
    product(2),
  ]);
  const line = keywordLines(elements.rows.children[0].children[5])[0];

  assert.equal(line.children[0].textContent, '<b>Lamp</b><script>alert(1)</script>');
  assert.equal(line.children[1].textContent, 'Amazon');
  // Two spans only - the keyword made no elements of its own.
  assert.equal(line.children.filter((child) => child.tagName === 'SPAN').length, 2);
});

test('a product with an image gets an img element with alt text and a size', () => {
  const { elements } = run(FIVE);
  const cell = elements.rows.children[0].children[0];

  assert.equal(cell.children.length, 1);

  const img = cell.children[0];
  assert.equal(img.tagName, 'IMG');
  assert.equal(img.src, 'https://sin1.contabostorage.com/img/1.jpg');
  assert.equal(img.alt, 'Product 1');
  assert.equal(img.width, 56);
  assert.equal(img.height, 56);
  assert.equal(img.loading, 'lazy');
});

test('a product with no image gets a genuinely empty cell', () => {
  const { elements } = run([product(1, { image: null }), product(2)]);
  const cell = elements.rows.children[0].children[0];

  assert.equal(cell.className, 'img');
  assert.equal(cell.children.length, 0, 'no image element');
  assert.equal(cell.textContent, '', 'and no placeholder text');
});

test('an image address that is not http(s) is refused at render time', () => {
  for (const hostile of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '/img/1.jpg', 'ftp://x/y.jpg']) {
    const { elements } = run([product(1, { image: hostile }), product(2)]);
    const cell = elements.rows.children[0].children[0];

    assert.equal(cell.children.length, 0, `${hostile} must not become an image`);
  }
});

test('product text is set as text, so markup in a name cannot become elements', () => {
  const { elements } = run([product(1, { name: '<b>bold</b><script>alert(1)</script>' }), product(2)]);
  const nameCell = elements.rows.children[0].children[3];

  assert.equal(nameCell.textContent, '<b>bold</b><script>alert(1)</script>');
  assert.equal(nameCell.children.length, 0, 'no element was created from the name');
});

// ---------------------------------------------------------------------------
// Paging.
// ---------------------------------------------------------------------------

test('the count line reports the rows on the page and the snapshot total', () => {
  const { elements } = run(FIVE);

  assert.equal(elements["count-top"].textContent, 'Showing 1–2 of 5 products in this snapshot.');
});

test('both control bars show the same page position', () => {
  const { elements } = run(FIVE);

  assert.equal(elements['position-top'].textContent, 'Page 1 of 3');
  assert.equal(elements['position-bottom'].textContent, 'Page 1 of 3');
});

test('the count is written at the left of BOTH control bars', () => {
  const { elements } = run(FIVE);

  assert.equal(elements['count-top'].textContent, 'Showing 1–2 of 5 products in this snapshot.');
  assert.equal(elements['count-bottom'].textContent, elements['count-top'].textContent);

  // And both keep up as the page changes.
  elements['next-top'].click();
  assert.equal(elements['count-bottom'].textContent, elements['count-top'].textContent);
  assert.equal(elements['count-bottom'].textContent, 'Showing 3–4 of 5 products in this snapshot.');
});

test('the count comes before the pager in each bar, so it sits at the left', () => {
  const html = buildSnapshotHtml({ rows: FIVE, styles: '.x {}', pageSize: 2 });

  for (const place of ['top', 'bottom']) {
    const bar = new RegExp(`<div class="controls controls-${place}">([\\s\\S]*?)</div>`).exec(html)?.[1] ?? '';

    const count = bar.indexOf(`id="count-${place}"`);
    const pager = bar.indexOf('<nav class="pager"');

    assert.ok(count !== -1 && pager !== -1, `${place}: the bar carries both`);
    assert.ok(count < pager, `${place}: the count comes before the pager`);
  }
});

test('Next moves on, and both bars follow', () => {
  const { elements } = run(FIVE);

  elements['next-top'].click();

  assert.equal(elements['position-top'].textContent, 'Page 2 of 3');
  assert.equal(elements['position-bottom'].textContent, 'Page 2 of 3');
  assert.equal(elements.rows.children[0].children[1].textContent, 'SKU3');
  assert.equal(elements["count-top"].textContent, 'Showing 3–4 of 5 products in this snapshot.');
});

test('the bottom bar drives the same page as the top one', () => {
  const { elements } = run(FIVE);

  elements['next-bottom'].click();
  assert.equal(elements['position-top'].textContent, 'Page 2 of 3');

  elements['prev-bottom'].click();
  assert.equal(elements['position-top'].textContent, 'Page 1 of 3');
  assert.equal(elements.rows.children[0].children[1].textContent, 'SKU1');
});

test('Previous is disabled on the first page and Next on the last', () => {
  const { elements } = run(FIVE);

  assert.equal(elements['prev-top'].disabled, true);
  assert.equal(elements['next-top'].disabled, false);

  elements['next-top'].click();
  elements['next-top'].click();

  assert.equal(elements['position-top'].textContent, 'Page 3 of 3');
  assert.equal(elements['prev-top'].disabled, false);
  assert.equal(elements['next-top'].disabled, true, 'the last page offers no Next');
});

test('the last page shows only the rows that remain', () => {
  const { elements } = run(FIVE);

  elements['next-top'].click();
  elements['next-top'].click();

  assert.equal(elements.rows.children.length, 1, 'five rows at two per page leaves one');
  assert.equal(elements["count-top"].textContent, 'Showing 5–5 of 5 products in this snapshot.');
});

test('paging past either end is clamped rather than breaking', () => {
  const { elements } = run(FIVE);

  elements['prev-top'].click();
  assert.equal(elements['position-top'].textContent, 'Page 1 of 3');

  for (let i = 0; i < 10; i += 1) elements['next-top'].click();
  assert.equal(elements['position-top'].textContent, 'Page 3 of 3');
});

test('a page can be reached directly by its address fragment', () => {
  const { elements } = run(FIVE, '#page=3');

  assert.equal(elements['position-top'].textContent, 'Page 3 of 3');
  assert.equal(elements.rows.children[0].children[1].textContent, 'SKU5');
});

test('a nonsense address fragment falls back to page 1', () => {
  for (const hash of ['', '#', '#page=0', '#page=abc', '#nonsense']) {
    const { elements } = run(FIVE, hash);
    assert.equal(elements['position-top'].textContent, 'Page 1 of 3', hash);
  }
});

test('the address is kept in step so a page can be linked to or reloaded', () => {
  const { elements, window } = run(FIVE);

  elements['next-top'].click();
  assert.match(window.location.hash, /page=2/);
});

test('arrow keys page, but only when nothing else has focus', () => {
  const { document, elements } = run(FIVE);

  document.dispatch('keydown', { key: 'ArrowRight', target: document.body });
  assert.equal(elements['position-top'].textContent, 'Page 2 of 3');

  document.dispatch('keydown', { key: 'ArrowLeft', target: document.body });
  assert.equal(elements['position-top'].textContent, 'Page 1 of 3');

  // A keypress aimed at a control must not also page the table.
  document.dispatch('keydown', { key: 'ArrowRight', target: elements['next-top'] });
  assert.equal(elements['position-top'].textContent, 'Page 1 of 3');
});

// ---------------------------------------------------------------------------
// The category filter, inside the file.
// ---------------------------------------------------------------------------

/** Four in "Lights", one in "Switches", one with no category. */
const MIXED = [
  product(1, { category: 'Lights' }),
  product(2, { category: 'Lights' }),
  product(3, { category: 'Switches' }),
  product(4, { category: 'Lights' }),
  product(5, { category: null }),
  product(6, { category: 'Lights' }),
];

/** Pick a category as a person would, and let the change handler run. */
function choose(context, value) {
  context.elements.category.value = value;
  for (const handler of context.elements.category.listeners.change ?? []) handler({ target: context.elements.category });
}

test('the filter offers All Categories and every category in the file', () => {
  const html = buildSnapshotHtml({ rows: MIXED, styles: '.x {}', pageSize: 2 });
  const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)];

  assert.equal(options[0][1], '', 'All Categories is the empty value');
  assert.equal(options[0][2], 'All Categories (6)');
  // Busiest first.
  assert.equal(options[1][1], 'Lights');
  assert.equal(options[1][2], 'Lights (4)');
  assert.equal(options[2][2], 'Switches (1)');
  assert.equal(options.length, 3, 'the uncategorised product adds no option');
});

test('choosing a category filters the table to it', () => {
  const context = run(MIXED);
  choose(context, 'Lights');

  const shown = context.elements.rows.children.map((row) => row.children[1].textContent);
  assert.deepEqual(shown, ['SKU1', 'SKU2'], 'page 1 of the filtered rows');
  assert.equal(context.elements['position-top'].textContent, 'Page 1 of 2', 'four rows at two per page');
});

test('the count updates to the filtered total', () => {
  const context = run(MIXED);
  choose(context, 'Lights');

  assert.equal(context.elements["count-top"].textContent, 'Showing 1–2 of 4 products in Lights in this snapshot.');
});

test('pagination keeps working after filtering, within the category', () => {
  const context = run(MIXED);
  choose(context, 'Lights');
  context.elements['next-top'].click();

  const shown = context.elements.rows.children.map((row) => row.children[1].textContent);
  assert.deepEqual(shown, ['SKU4', 'SKU6'], 'the rest of the Lights rows, skipping SKU3 and SKU5');
  assert.equal(context.elements['position-top'].textContent, 'Page 2 of 2');
  assert.equal(context.elements['next-top'].disabled, true, 'no further page in this category');
});

test('the chosen category is preserved while paging', () => {
  const context = run(MIXED);
  choose(context, 'Lights');
  context.elements['next-top'].click();

  assert.match(context.window.location.hash, /category=Lights/, 'the address keeps the category');
  assert.match(context.window.location.hash, /page=2/);

  // Every row on the second page is still in the chosen category.
  for (const row of context.elements.rows.children) {
    assert.equal(row.children[4].textContent, 'Lights');
  }
});

test('filtering restarts at page 1, because page 3 of everything is not page 3 of one category', () => {
  const context = run(MIXED);
  context.elements['next-top'].click();
  context.elements['next-top'].click();
  assert.equal(context.elements['position-top'].textContent, 'Page 3 of 3');

  choose(context, 'Lights');
  assert.equal(context.elements['position-top'].textContent, 'Page 1 of 2');
});

test('All Categories brings everything back', () => {
  const context = run(MIXED);
  choose(context, 'Switches');
  assert.equal(context.elements["count-top"].textContent, 'Showing 1–1 of 1 products in Switches in this snapshot.');

  choose(context, '');
  assert.equal(context.elements["count-top"].textContent, 'Showing 1–2 of 6 products in this snapshot.');
  assert.equal(context.elements['position-top'].textContent, 'Page 1 of 3');
});

test('Clear resets the filter', () => {
  const context = run(MIXED);
  choose(context, 'Lights');
  context.elements['clear-filter'].click();

  assert.equal(context.elements['position-top'].textContent, 'Page 1 of 3');
  assert.equal(context.elements.category.value, '', 'the picker goes back to All Categories');
});

test('a product with no category is only ever shown under All Categories', () => {
  const context = run(MIXED);

  choose(context, 'Lights');
  const inLights = context.elements.rows.children.map((row) => row.children[1].textContent);
  assert.ok(!inLights.includes('SKU5'));

  choose(context, 'Switches');
  const inSwitches = context.elements.rows.children.map((row) => row.children[1].textContent);
  assert.ok(!inSwitches.includes('SKU5'));
});

test('a blank category renders as an empty cell', () => {
  const context = run([product(5, { category: null }), product(6, { category: '' })]);

  for (const row of context.elements.rows.children) {
    assert.equal(row.children[4].textContent, '', 'no placeholder text');
    assert.equal(row.children[4].children.length, 0);
  }
});

test('a filtered page can be opened directly from the address', () => {
  const context = run(MIXED, '#page=2&category=Lights');

  assert.equal(context.elements['position-top'].textContent, 'Page 2 of 2');
  assert.equal(context.elements.category.value, 'Lights', 'the picker shows the category');
  assert.deepEqual(
    context.elements.rows.children.map((row) => row.children[1].textContent),
    ['SKU4', 'SKU6'],
  );
});

test('a category the file does not hold is treated as no filter', () => {
  for (const hash of ['#category=Nonsense', '#page=1&category=', '#category=%E0%A4%A']) {
    const context = run(MIXED, hash);

    assert.equal(context.elements["count-top"].textContent, 'Showing 1–2 of 6 products in this snapshot.', hash);
  }
});

test('a category needing encoding round-trips through the address', () => {
  const rows = [product(1, { category: 'Ceiling Lights & Chandeliers' }), product(2, { category: 'Other' })];
  const context = run(rows, '#page=1&category=Ceiling%20Lights%20%26%20Chandeliers');

  assert.equal(context.elements.category.value, 'Ceiling Lights & Chandeliers');
  assert.equal(context.elements.rows.children.length, 1);
});

// ---------------------------------------------------------------------------
// The search box, inside the file.
// ---------------------------------------------------------------------------

/** Type into the search box and let the handler run. */
function type(context, value) {
  context.elements.search.value = value;
  for (const handler of context.elements.search.listeners.input ?? []) handler({ target: context.elements.search });
}

const SEARCHABLE = [
  product(1, { sku: 'HLBP128BB', name: 'Brass Door Handle', category: 'Handles' }),
  product(2, { sku: 'SWRS1GBM', name: 'Wall Light Switch', category: 'Switches' }),
  product(3, { sku: 'HLBK30GB', name: 'Drawer Pull Knob', category: 'Handles' }),
  product(4, { sku: 'CL3RBL', name: 'Fabric Cable', category: 'Cables' }),
];

test('the snapshot carries a search box with the expected placeholder', () => {
  const html = buildSnapshotHtml({ rows: SEARCHABLE, styles: '.x {}', pageSize: 2 });

  assert.match(html, /<input type="search" id="search"/);
  assert.match(html, /placeholder="Search by SKU, Product ID or name\.\.\."/);
  assert.ok(html.includes('Clear Filters'));
});

test('searching matches the product name', () => {
  const context = run(SEARCHABLE);
  type(context, 'handle');

  assert.deepEqual(
    context.elements.rows.children.map((row) => row.children[1].textContent),
    ['HLBP128BB'],
  );
  assert.equal(context.elements["count-top"].textContent, 'Showing 1–1 of 1 products matching “handle” in this snapshot.');
});

test('searching matches the SKU', () => {
  const context = run(SEARCHABLE);
  type(context, 'SWRS');

  assert.deepEqual(
    context.elements.rows.children.map((row) => row.children[1].textContent),
    ['SWRS1GBM'],
  );
});

test('searching matches a Product ID exactly, not partially', () => {
  // Ids 7 and 77, and no digits in any SKU or name, so the only thing that can
  // match "7" is the id itself.
  const context = run([
    product(7, { id: '7', sku: 'AAA', name: 'Alpha' }),
    product(8, { id: '77', sku: 'BBB', name: 'Beta' }),
    product(9, { id: '99', sku: 'CCC', name: 'Gamma' }),
  ]);
  type(context, '7');

  assert.deepEqual(
    context.elements.rows.children.map((row) => row.children[2].textContent),
    ['7'],
    'id 77 must not match a search for 7',
  );
});

test('search is case-insensitive and ignores surrounding space', () => {
  for (const typed of ['BRASS', '  brass  ', 'bRaSs']) {
    const context = run(SEARCHABLE);
    type(context, typed);

    assert.equal(context.elements.rows.children.length, 1, typed);
  }
});

test('search and category narrow together', () => {
  const context = run(SEARCHABLE);
  choose(context, 'Handles');
  type(context, 'drawer');

  assert.deepEqual(
    context.elements.rows.children.map((row) => row.children[1].textContent),
    ['HLBK30GB'],
  );
  assert.match(context.elements["count-top"].textContent, /in Handles matching “drawer”/);
});

test('a search that matches nothing says so', () => {
  const context = run(SEARCHABLE);
  type(context, 'nothing at all');

  assert.equal(context.elements.rows.children.length, 0);
  assert.equal(context.elements.empty.hidden, false);
  assert.equal(context.elements["count-top"].textContent, 'No products matching “nothing at all”.');
});

test('Clear Filters resets both the search and the category', () => {
  const context = run(SEARCHABLE);
  choose(context, 'Handles');
  type(context, 'drawer');
  context.elements['clear-filter'].click();

  assert.equal(context.elements.rows.children.length, 2, 'back to a full page');
  assert.equal(context.elements.search.value, '');
  assert.equal(context.elements.category.value, '');
});

test('the search term is kept in the address so a search can be linked to', () => {
  const context = run(SEARCHABLE);
  type(context, 'brass');

  assert.match(context.window.location.hash, /search=brass/);
});

test('a search can be opened directly from the address', () => {
  const context = run(SEARCHABLE, '#page=1&search=Wall%20Light');

  assert.equal(context.elements.search.value, 'Wall Light');
  assert.deepEqual(
    context.elements.rows.children.map((row) => row.children[1].textContent),
    ['SWRS1GBM'],
  );
});

test('pagers are hidden when everything fits on one page, but the counts stay', () => {
  const { bars, elements } = run([product(1), product(2)]);

  assert.equal(bars.length, 2);
  assert.ok(bars.every((bar) => bar.hidden === true), 'one page needs no paging controls');

  // The count is not inside the pager, so it still reports what is shown.
  assert.equal(elements['count-top'].textContent, 'Showing 1–2 of 2 products in this snapshot.');
  assert.equal(elements['count-bottom'].textContent, elements['count-top'].textContent);
});

test('control bars are shown when there is more than one page', () => {
  const { bars } = run(FIVE);

  assert.ok(bars.every((bar) => bar.hidden === false));
});

test('an empty snapshot says so instead of drawing rows', () => {
  const { elements } = run([]);

  assert.equal(elements.rows.children.length, 0);
  assert.equal(elements.empty.hidden, false, 'the empty-state note is shown');
  assert.equal(elements["count-top"].textContent, 'No products.');
});
