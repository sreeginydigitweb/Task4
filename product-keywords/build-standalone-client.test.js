/**
 * Behaviour tests for the JavaScript inside the generated index.html.
 *
 * The other build tests check the file's CONTENT. These run it.
 *
 * The script is extracted from a generated document and executed against a
 * small DOM stand-in, which implements only the handful of DOM calls the
 * script actually makes. That is enough to prove the things a reviewer will
 * actually do after double-clicking the file: search, filter by category,
 * clear the filters, and page forwards and backwards through the catalogue.
 *
 * It is a stand-in, not a browser - it cannot prove how the page LOOKS. What
 * it can prove is that opening the file with no server behind it produces a
 * working table, which is the whole point of the standalone build.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStandaloneHtml, encodeDataset } from './build-standalone.js';

// ---------------------------------------------------------------------------
// A very small DOM.
// ---------------------------------------------------------------------------

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.title = '';
    this._text = '';
  }

  get textContent() {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join('') : this._text;
  }

  set textContent(value) {
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

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  fire(type, event = {}) {
    for (const handler of this.listeners[type] ?? []) handler({ target: this, ...event });
  }

  click() { this.fire('click'); }

  tree() { return [this, ...this.children.flatMap((c) => c.tree())]; }
  byTag(tag) { return this.tree().filter((n) => n.tagName === tag.toUpperCase()); }
}

class Fragment {
  constructor() { this.children = []; }
  appendChild(node) { this.children.push(node); return node; }
}

/** Build a document from the generated markup and run the inline script. */
function run(products) {
  const { data, counts } = encodeDataset(products);
  const html = buildStandaloneHtml({ data, counts, styles: '.x {}' });
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, 'the file carries an inline script');

  const elements = {};
  for (const [, id] of html.matchAll(/\bid="([a-z-]+)"/g)) {
    elements[id] = new Element(id === 'rows' ? 'tbody' : 'div');
  }

  // The embedded data block, as the browser would read it.
  const json = /<script type="application\/json" id="product-data">([\s\S]*?)<\/script>/.exec(html)[1];
  elements['product-data'] = new Element('script');
  elements['product-data'].textContent = json;

  const pagers = [new Element('nav'), new Element('nav')];
  const documentListeners = {};

  const document = {
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Fragment(),
    querySelectorAll: (selector) => {
      assert.equal(selector, '.pager', `unexpected selector: ${selector}`);
      return pagers;
    },
    addEventListener: (type, handler) => { (documentListeners[type] ??= []).push(handler); },
    fire: (type, event) => { for (const h of documentListeners[type] ?? []) h(event); },
  };

  // eslint-disable-next-line no-new-func -- running the shipped script is the point
  new Function('document', 'window', script)(document, { location: { hash: '' } });

  return { elements, document, pagers, data };
}

/**
 * A catalogue of n products, with a predictable spread of categories,
 * marketplaces and platforms.
 *
 * The facets deliberately overlap the way the real ones do: most products are
 * listed in the UK, some in more than one marketplace, some on more than one
 * platform, and every fourth product is listed NOWHERE - which is the case
 * that must match neither dropdown and must never be given a value.
 */
const catalogue = (n) =>
  Array.from({ length: n }, (_, at) => ({
    id: at + 1,
    sku: `SKU${String(at + 1).padStart(4, '0')}`,
    title: at % 3 === 0 ? `Vintage Lamp Holder ${at + 1}` : `Brass Door Handle ${at + 1}`,
    image: at % 5 === 0 ? null : `https://sin1.contabostorage.com/img/${at + 1}.jpg`,
    category: at % 3 === 0 ? 'Lamp Holder' : 'Door Handle',
    marketplaces: at % 4 === 3 ? [] : at % 4 === 0 ? ['UK', 'Germany'] : ['UK'],
    platforms: at % 4 === 3 ? [] : at % 4 === 0 ? ['EBAY', 'AMAZON'] : ['EBAY'],
    evidence: at % 2 === 0
      ? [{ source: 'amazon', label: 'Amazon', kind: 'search-keywords',
           detail: 'listings.amazon_listing_search_engine_keywords.keyword',
           text: 'vintage lamp holder brass door handle' }]
      : [],
  }));

const rowsDrawn = (elements) => elements.rows.children;
const countText = (elements) => elements['count-top'].textContent;

/**
 * Type into the search box and press Enter.
 *
 * There is no Apply button any more, and typing on its own does nothing:
 * Enter is what applies a search, so every test that searches goes through
 * here rather than firing an 'input' the page no longer listens for.
 */
const typeSearch = (elements, value) => {
  elements.search.value = value;
  elements.search.fire('keydown', { key: 'Enter', preventDefault() {} });
};

// ---------------------------------------------------------------------------
// It runs, and it draws the table.
// ---------------------------------------------------------------------------

test('the inline script runs and draws the first page with no server', () => {
  const { elements } = run(catalogue(120));

  assert.equal(rowsDrawn(elements).length, 50, 'a page is 50 products');
  assert.equal(rowsDrawn(elements)[0].tagName, 'TR');
});

test('every drawn row has nine cells, in the column order', () => {
  const { elements } = run(catalogue(60));
  const first = rowsDrawn(elements)[0].children;

  assert.equal(first.length, 9, 'nine cells per row');
  assert.equal(first[0].className, 'img');
  assert.equal(first[1].textContent, 'SKU0001');
  assert.equal(first[2].textContent, '1');
  assert.equal(first[3].textContent, 'Vintage Lamp Holder 1');
  assert.equal(first[4].textContent, 'Lamp Holder');
});

test('a product with no image gets a genuinely empty cell', () => {
  const { elements } = run(catalogue(10));
  // Products at index 0, 5 have no image in the fixture.
  assert.equal(rowsDrawn(elements)[0].children[0].children.length, 0, 'no img element');

  const withImage = rowsDrawn(elements)[1].children[0].children[0];
  assert.equal(withImage.tagName, 'IMG');
  assert.match(withImage.src, /^https:\/\/sin1\.contabostorage\.com\/img\/2\.jpg$/, 'the real URL is rebuilt');
  assert.equal(withImage.loading, 'lazy');
});

test('the count line reports the real total', () => {
  const { elements } = run(catalogue(120));

  assert.match(countText(elements), /Showing 1–4?9?50 of 120 products\./);
  assert.equal(elements['position-top'].textContent, '1 / 3', '120 products is three pages of 50');
});

// ---------------------------------------------------------------------------
// The resource pills.
// ---------------------------------------------------------------------------

test('resource pills sit inside the keyword cells and nowhere else', () => {
  const { elements } = run(catalogue(50));

  for (const row of rowsDrawn(elements)) {
    for (let cell = 0; cell < 5; cell += 1) {
      const pills = row.children[cell].tree().filter((n) => String(n.className).startsWith('tag tag-'));
      assert.equal(pills.length, 0, `no pill in column ${cell + 1}`);
    }
  }

  const keywordPills = rowsDrawn(elements)
    .flatMap((row) => row.children.slice(5))
    .flatMap((cell) => cell.tree())
    .filter((n) => String(n.className).startsWith('tag tag-'));

  assert.ok(keywordPills.length > 0, 'the keyword columns do carry pills');
  for (const pill of keywordPills) assert.equal(pill.textContent, 'Amazon');
});

test('a keyword the evidence cannot prove is drawn with no pill at all', () => {
  // Odd-numbered fixture products carry no evidence.
  const { elements } = run(catalogue(50));
  const unproven = rowsDrawn(elements)[1];
  const pills = unproven.children.slice(5).flatMap((c) => c.tree()).filter((n) => String(n.className).startsWith('tag tag-'));

  assert.equal(pills.length, 0, 'no resource, so no pill');
  assert.ok(unproven.children[5].textContent.length > 0, 'but the keyword itself is still shown');
});

test('a pill keeps the tooltip naming the record that proved it', () => {
  const { elements } = run(catalogue(20));
  const pill = rowsDrawn(elements)[0].children.slice(5)
    .flatMap((c) => c.tree()).find((n) => String(n.className).startsWith('tag tag-'));

  assert.match(pill.title, /listings\.amazon_listing_search_engine_keywords\.keyword/);
});

// ---------------------------------------------------------------------------
// Search, category filter, Clear Filters - all in the browser.
// ---------------------------------------------------------------------------

test('SEARCH narrows the table without any server', () => {
  const { elements } = run(catalogue(120));

  typeSearch(elements, 'SKU0007');

  assert.equal(rowsDrawn(elements).length, 1, 'one product matches');
  assert.equal(rowsDrawn(elements)[0].children[1].textContent, 'SKU0007');
  assert.match(countText(elements), /Showing 1–1 of 1 products\./);
});

test('search matches the product name as well as the SKU and id', () => {
  const { elements } = run(catalogue(30));

  typeSearch(elements, 'vintage lamp');

  const names = rowsDrawn(elements).map((r) => r.children[3].textContent);
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => n.toLowerCase().includes('vintage lamp')));
});

test('a search matching nothing shows the empty state, not a stale table', () => {
  const { elements } = run(catalogue(30));

  typeSearch(elements, 'nothing-matches-this');

  assert.equal(rowsDrawn(elements).length, 0);
  assert.equal(elements.empty.hidden, false, 'the empty note is shown');
  assert.match(countText(elements), /No products match/);
});

test('there is no Apply button on the page at all', () => {
  const { elements } = run(catalogue(30));

  assert.equal(elements.apply, undefined, 'nothing with id="apply" is rendered');
  assert.ok(elements['clear-filter'], 'Clear Filters is still there');
});

test('ENTER in the search box is what applies a search', () => {
  const { elements } = run(catalogue(90));

  typeSearch(elements, 'Door Handle');

  const names = rowsDrawn(elements).map((r) => r.children[3].textContent);
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => n.includes('Door Handle')));
});

test('typing alone does not filter - the table waits for Enter', () => {
  const { elements } = run(catalogue(120));

  // Typed, and an 'input' event fired - the page no longer listens for one.
  elements.search.value = 'SKU0007';
  elements.search.fire('input');
  assert.equal(rowsDrawn(elements).length, 50, 'still the unfiltered first page');

  elements.search.fire('keydown', { key: 'a', preventDefault() {} });
  assert.equal(rowsDrawn(elements).length, 50, 'and any other key leaves it alone');

  elements.search.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(rowsDrawn(elements).length, 1, 'Enter applies it');
});

test('CATEGORY filtering works, and the count names the category', () => {
  const { elements, data } = run(catalogue(90));
  const lampHolder = data.categories.indexOf('Lamp Holder');

  elements.category.value = String(lampHolder);
  elements.category.fire('change');

  const categories = rowsDrawn(elements).map((r) => r.children[4].textContent);
  assert.ok(categories.length > 0);
  assert.ok(categories.every((c) => c === 'Lamp Holder'));
  assert.match(countText(elements), /products in Lamp Holder\./);
});

test('search and category narrow together', () => {
  const { elements, data } = run(catalogue(120));

  elements.category.value = String(data.categories.indexOf('Door Handle'));
  elements.category.fire('change');
  typeSearch(elements, 'SKU0011');

  assert.equal(rowsDrawn(elements).length, 1);
  assert.equal(rowsDrawn(elements)[0].children[4].textContent, 'Door Handle');
});

test('CLEAR FILTERS puts the whole catalogue back', () => {
  const { elements, data } = run(catalogue(120));

  typeSearch(elements, 'SKU0007');
  elements.category.value = String(data.categories.indexOf('Lamp Holder'));
  elements.category.fire('change');

  elements['clear-filter'].click();

  assert.equal(elements.search.value, '', 'the search box is emptied');
  assert.equal(elements.category.value, '', 'the category returns to All Categories');
  assert.equal(rowsDrawn(elements).length, 50, 'a full page again');
  assert.match(countText(elements), /of 120 products\./);
});

// ---------------------------------------------------------------------------
// Marketplace and Platform - the same way, in the browser, with no server.
// ---------------------------------------------------------------------------

/** The option index a dropdown uses for one value. */
const option = (data, which, value) => String(data[which].indexOf(value));

test('the MARKETPLACE dropdown narrows the table', () => {
  const { elements, data } = run(catalogue(120));

  elements.marketplace.value = option(data, 'marketplaces', 'Germany');
  elements.marketplace.fire('change');

  // Every fourth product from index 0 is the one listed in Germany.
  const ids = rowsDrawn(elements).map((r) => Number(r.children[2].textContent));
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => (id - 1) % 4 === 0), 'only the German listings');
  assert.match(countText(elements), /products in Germany\./);
});

test('the PLATFORM dropdown narrows the table', () => {
  const { elements, data } = run(catalogue(120));

  elements.platform.value = option(data, 'platforms', 'AMAZON');
  elements.platform.fire('change');

  const ids = rowsDrawn(elements).map((r) => Number(r.children[2].textContent));
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => (id - 1) % 4 === 0), 'only the Amazon listings');
  assert.match(countText(elements), /products in AMAZON\./);
});

test('a product listed nowhere is shown under All and matched by neither filter', () => {
  const { elements, data } = run(catalogue(120));
  const unlisted = (id) => (id - 1) % 4 === 3;

  // It is there to begin with.
  typeSearch(elements, 'SKU0004');
  assert.equal(rowsDrawn(elements).length, 1, 'the unlisted product is in the catalogue');

  for (const [id, which, value] of [['marketplace', 'marketplaces', 'UK'], ['platform', 'platforms', 'EBAY']]) {
    const fresh = run(catalogue(120));
    fresh.elements[id].value = option(fresh.data, which, value);
    fresh.elements[id].fire('change');

    const ids = rowsDrawn(fresh.elements).map((r) => Number(r.children[2].textContent));
    assert.ok(!ids.some(unlisted), `no unlisted product matches ${value}`);
  }
});

test('a product in several marketplaces is matched by ANY of them', () => {
  const { elements, data } = run(catalogue(40));

  for (const value of ['UK', 'Germany']) {
    elements.marketplace.value = option(data, 'marketplaces', value);
    elements.marketplace.fire('change');
    const ids = rowsDrawn(elements).map((r) => Number(r.children[2].textContent));
    assert.ok(ids.includes(1), `product 1 is listed in ${value} and matches it`);
  }
});

test('all four filters narrow TOGETHER - search AND category AND marketplace AND platform', () => {
  const { elements, data } = run(catalogue(200));

  elements.category.value = String(data.categories.indexOf('Lamp Holder'));
  elements.category.fire('change');
  elements.marketplace.value = option(data, 'marketplaces', 'Germany');
  elements.marketplace.fire('change');
  elements.platform.value = option(data, 'platforms', 'AMAZON');
  elements.platform.fire('change');

  const rows = rowsDrawn(elements);
  assert.ok(rows.length > 0, 'the combination still matches something');
  for (const row of rows) {
    const id = Number(row.children[2].textContent);
    assert.equal(row.children[4].textContent, 'Lamp Holder');
    assert.equal((id - 1) % 4, 0, 'and it is one of the multi-marketplace products');
    assert.equal((id - 1) % 3, 0, 'and a Lamp Holder');
  }

  // Now the search as well, on top of the three dropdowns.
  const first = Number(rows[0].children[2].textContent);
  typeSearch(elements, `SKU${String(first).padStart(4, '0')}`);
  assert.equal(rowsDrawn(elements).length, 1, 'all four together leave exactly the one');

  // A combination nothing satisfies is empty, not a partial match.
  elements.platform.value = option(data, 'platforms', 'EBAY');
  elements.platform.fire('change');
  typeSearch(elements, 'SKU0002');
  assert.equal(rowsDrawn(elements).length, 0, 'AND, not OR');
  assert.equal(elements.empty.hidden, false);
});

test('CLEAR FILTERS resets all FOUR filters and returns the whole catalogue', () => {
  const { elements, data } = run(catalogue(120));

  typeSearch(elements, 'SKU0005');
  elements.category.value = String(data.categories.indexOf('Door Handle'));
  elements.category.fire('change');
  elements.marketplace.value = option(data, 'marketplaces', 'UK');
  elements.marketplace.fire('change');
  elements.platform.value = option(data, 'platforms', 'EBAY');
  elements.platform.fire('change');

  elements['clear-filter'].click();

  assert.equal(elements.search.value, '', 'the search box is emptied');
  assert.equal(elements.category.value, '', 'All Categories');
  assert.equal(elements.marketplace.value, '', 'All Marketplaces');
  assert.equal(elements.platform.value, '', 'All Platforms');
  assert.equal(rowsDrawn(elements).length, 50, 'a full page again');
  assert.match(countText(elements), /Showing 1–50 of 120 products\./);
  assert.equal(elements['position-top'].textContent, '1 / 3', 'and back to page one');
});

test('the count line names every filter that is set', () => {
  const { elements, data } = run(catalogue(120));

  elements.category.value = String(data.categories.indexOf('Lamp Holder'));
  elements.category.fire('change');
  elements.marketplace.value = option(data, 'marketplaces', 'UK');
  elements.marketplace.fire('change');
  elements.platform.value = option(data, 'platforms', 'EBAY');
  elements.platform.fire('change');

  assert.match(countText(elements), /products in Lamp Holder \+ UK \+ EBAY\./);
});

test('choosing a marketplace or a platform resets to page one', () => {
  for (const [id, which, value] of [['marketplace', 'marketplaces', 'UK'], ['platform', 'platforms', 'EBAY']]) {
    const { elements, data } = run(catalogue(400));

    elements['next-top'].click();
    elements['next-top'].click();
    assert.equal(elements['position-top'].textContent, '3 / 8', `paged away before the ${id} filter`);

    elements[id].value = option(data, which, value);
    elements[id].fire('change');

    assert.ok(elements['position-top'].textContent.startsWith('1 /'), `${id} went back to page one`);
    assert.equal(rowsDrawn(elements)[0].children[2].textContent, '1', 'and drew the first page');
  }
});

test('each dropdown applies on its own change, with no button to press', () => {
  for (const [id, which, value] of [
    ['category', 'categories', 'Lamp Holder'],
    ['marketplace', 'marketplaces', 'Germany'],
    ['platform', 'platforms', 'AMAZON'],
  ]) {
    const { elements, data } = run(catalogue(120));
    const before = rowsDrawn(elements).length;

    elements[id].value = which === 'categories'
      ? String(data.categories.indexOf(value))
      : option(data, which, value);
    elements[id].fire('change');

    assert.match(countText(elements), new RegExp(`products in ${value.replace('&', '&')}\\.`), `${id} applied itself`);
    assert.ok(rowsDrawn(elements).length > 0, `${id} still shows products`);
    assert.ok(before === 50, 'and the page was full before the change');
  }
});

test('a dropdown change picks up whatever is already typed in the search box', () => {
  // readControls() re-reads ALL FOUR controls, so a search typed but not yet
  // Entered is applied by the next dropdown change rather than being lost.
  const { elements, data } = run(catalogue(120));

  elements.search.value = 'SKU0005';
  elements.marketplace.value = option(data, 'marketplaces', 'UK');
  elements.marketplace.fire('change');

  assert.equal(rowsDrawn(elements).length, 1, 'the typed search counted too');
  assert.equal(rowsDrawn(elements)[0].children[1].textContent, 'SKU0005');
});

test('neither filter adds a tenth cell to a row', () => {
  const { elements, data } = run(catalogue(60));

  elements.marketplace.value = option(data, 'marketplaces', 'UK');
  elements.marketplace.fire('change');

  for (const row of rowsDrawn(elements)) assert.equal(row.children.length, 9, 'still nine cells');
});

// ---------------------------------------------------------------------------
// Paging.
// ---------------------------------------------------------------------------

test('NEXT and PREVIOUS move through the catalogue', () => {
  const { elements } = run(catalogue(120));

  assert.equal(rowsDrawn(elements)[0].children[2].textContent, '1');

  elements['next-top'].click();
  assert.equal(elements['position-top'].textContent, '2 / 3');
  assert.equal(rowsDrawn(elements)[0].children[2].textContent, '51');
  assert.match(countText(elements), /Showing 51–100 of 120 products\./);

  elements['prev-bottom'].click();
  assert.equal(elements['position-top'].textContent, '1 / 3');
  assert.equal(rowsDrawn(elements)[0].children[2].textContent, '1');
});

test('the last page holds the remainder, and Next stops there', () => {
  const { elements } = run(catalogue(120));

  elements['next-top'].click();
  elements['next-top'].click();

  assert.equal(elements['position-top'].textContent, '3 / 3');
  assert.equal(rowsDrawn(elements).length, 20, '120 is 50 + 50 + 20');
  assert.equal(elements['next-top'].disabled, true, 'Next is disabled at the end');
  assert.equal(elements['prev-top'].disabled, false);
});

test('Previous is disabled on the first page', () => {
  const { elements } = run(catalogue(120));

  assert.equal(elements['prev-top'].disabled, true);
  assert.equal(elements['next-top'].disabled, false);
});

test('filtering resets to page one rather than stranding the reader', () => {
  const { elements } = run(catalogue(200));

  elements['next-top'].click();
  elements['next-top'].click();
  assert.equal(elements['position-top'].textContent, '3 / 4');

  typeSearch(elements, 'Door Handle');

  assert.equal(elements['position-top'].textContent.startsWith('1 /'), true, 'back to the first page');
});

test('a single page of results hides the pager entirely', () => {
  const { elements, pagers } = run(catalogue(30));

  assert.equal(elements['position-top'].textContent, '1 / 1');
  for (const pager of pagers) assert.equal(pager.hidden, true, 'nothing to page to');
});

test('the arrow keys page, but not while the reader is typing', () => {
  const { elements, document } = run(catalogue(120));

  document.fire('keydown', { key: 'ArrowRight', target: { tagName: 'BODY' } });
  assert.equal(elements['position-top'].textContent, '2 / 3');

  document.fire('keydown', { key: 'ArrowRight', target: { tagName: 'INPUT' } });
  assert.equal(elements['position-top'].textContent, '2 / 3', 'typing in the search box does not page');
});
