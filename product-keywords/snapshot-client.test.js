/**
 * Behaviour tests for the JavaScript inside the snapshot file.
 *
 * The other snapshot tests check that the script is PRESENT. These run it.
 *
 * The script is extracted from the generated document and executed against a
 * small DOM stand-in built below, which implements only the handful of DOM
 * calls the script actually makes. That is enough to prove the real things:
 * the script parses, it draws one page of eight-cell rows from the embedded
 * data, the paging buttons move between pages and disable at the ends, and a
 * product with no image gets an empty cell.
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

  // The two control bars, which the script hides as a group by class.
  const bars = [...html.matchAll(/class="controls controls-(top|bottom)"/g)].map(() => {
    const bar = new Element('div');
    bar.className = 'controls';
    return bar;
  });

  const listeners = {};

  const document = {
    getElementById: (id) => elements[id] ?? null,
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Fragment(),
    querySelectorAll: (selector) => {
      assert.equal(selector, '.controls', `unexpected selector: ${selector}`);
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
  primary: `Primary ${n}`,
  secondary: `Secondary ${n}`,
  longTail: `LongTail ${n}`,
  competitor: `Competitor ${n}`,
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

test('every drawn row has eight cells, in the column order', () => {
  const { elements } = run(FIVE);

  for (const row of elements.rows.children) {
    assert.equal(row.children.length, 8, 'eight cells per row');
  }

  const first = elements.rows.children[0].children;
  assert.equal(first[0].className, 'img');
  assert.equal(first[1].textContent, 'SKU1');
  assert.equal(first[2].textContent, '1');
  assert.equal(first[3].textContent, 'Product 1');
  assert.equal(first[4].textContent, 'Primary 1');
  assert.equal(first[5].textContent, 'Secondary 1');
  assert.equal(first[6].textContent, 'LongTail 1');
  assert.equal(first[7].textContent, 'Competitor 1');
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

  assert.equal(elements.count.textContent, 'Showing 1–2 of 5 products in this snapshot.');
});

test('both control bars show the same page position', () => {
  const { elements } = run(FIVE);

  assert.equal(elements['position-top'].textContent, 'Page 1 of 3');
  assert.equal(elements['position-bottom'].textContent, 'Page 1 of 3');
});

test('Next moves on, and both bars follow', () => {
  const { elements } = run(FIVE);

  elements['next-top'].click();

  assert.equal(elements['position-top'].textContent, 'Page 2 of 3');
  assert.equal(elements['position-bottom'].textContent, 'Page 2 of 3');
  assert.equal(elements.rows.children[0].children[1].textContent, 'SKU3');
  assert.equal(elements.count.textContent, 'Showing 3–4 of 5 products in this snapshot.');
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
  assert.equal(elements.count.textContent, 'Showing 5–5 of 5 products in this snapshot.');
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

test('control bars are hidden when everything fits on one page', () => {
  const { bars } = run([product(1), product(2)]);

  assert.equal(bars.length, 2);
  assert.ok(bars.every((bar) => bar.hidden === true), 'one page needs no paging controls');
});

test('control bars are shown when there is more than one page', () => {
  const { bars } = run(FIVE);

  assert.ok(bars.every((bar) => bar.hidden === false));
});

test('an empty snapshot says so instead of drawing rows', () => {
  const { elements } = run([]);

  assert.equal(elements.rows.children.length, 0);
  assert.equal(elements.empty.hidden, false, 'the empty-state note is shown');
  assert.equal(elements.count.textContent, 'No products on this page.');
});
