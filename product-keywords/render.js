/**
 * HTML rendering for the Product Keywords view.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE HTML LIVES
 *
 * The page itself is a real file: product-keywords/page.html. It holds the
 * doctype, the head, the title, ALL of the CSS, the heading, the count line,
 * both paging control bars with their button markup, and the complete
 * seven-column table structure including its headers. That file is the UI; it
 * can be read, shared or handed to a designer on its own.
 *
 * This module builds no structure. It supplies the values page.html marks with
 * a name in double curly braces:
 *
 *   count_text        "Showing 101-150 of 44,627 products."
 *   page_position     "Page 3 of 893"
 *   prev_attrs        href + rel for the Previous button, or aria-disabled
 *   next_attrs        href + rel for the Next button, or aria-disabled
 *   controls_hidden   "hidden" when the result fits on one page
 *   rows              the <tr> product rows
 *   empty_message     shown only when a page has no rows
 *
 * The rows are the single exception, and unavoidably so: there are 44,627
 * products, read 50 at a time, so they cannot be static markup. Everything
 * around them is.
 *
 * Changing how the page looks - markup, CSS, the order of the sections, the
 * buttons - is an edit to page.html alone. The template is read once, when the
 * module loads, so that edit needs a server restart.
 *
 * ---------------------------------------------------------------------------
 * Two rules hold throughout:
 *
 * 1. Every dynamic value goes through escapeHtml before it reaches the page.
 *    The data comes from PostgreSQL and includes free-typed product titles and
 *    keyword text in several languages, so the rule is not optional.
 *
 * 2. The page never claims a classification the database does not hold. A
 *    category with no source renders as an empty table cell, never as a
 *    keyword borrowed from somewhere else and relabelled.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** page.html, read once at startup. */
const TEMPLATE = readFileSync(join(HERE, 'page.html'), 'utf8');

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for interpolation into HTML text or an attribute.
 *
 * Ampersand is replaced in the same pass as the rest, so entities cannot be
 * double-built. Applied to every dynamic value without exception.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * A whole number, grouped for reading.
 *
 * The catalogue is tens of thousands of products, and an ungrouped 44599 is
 * read wrong at a glance.
 *
 * @param {number} value
 * @returns {string}
 */
export function number(value) {
  return Number(value).toLocaleString('en-GB');
}

/**
 * The stylesheet, taken from the one place it is written: page.html.
 *
 * The small message pages below share it rather than keeping a second copy, so
 * editing the `<style>` block in page.html restyles every page this
 * application serves.
 */
const STYLES = /<style>([\s\S]*?)<\/style>/.exec(TEMPLATE)?.[1] ?? '';

/**
 * Fill page.html placeholders with the markup this module built.
 *
 * ONE pass over the template, deliberately. The two alternatives in the
 * pattern cover the two shapes of placeholder:
 *
 * 1. Alone on its own line, where it takes the whole line with it if it has no
 *    value - so an absent section, such as the paging bars on a single-page
 *    result, leaves no blank gap behind.
 * 2. Anywhere else, replaced where it stands.
 *
 * Two hazards, both closed by doing it this way. A second pass would scan the
 * markup the first pass inserted, so a product whose TITLE contained
 * `{{table}}` would have the entire table spliced into its own name; String
 * replace never rescans what it inserts, so one pass cannot do that. And the
 * replacement is a FUNCTION rather than a string because `$&`, `$1` and
 * backtick carry special meaning in a string replacement - product titles are
 * free text and do contain them. A function returns its value literally.
 *
 * An unknown placeholder becomes empty rather than throwing: page.html belongs
 * to whoever is editing the page, and a typo there should not take the site
 * down.
 *
 * @param {Object<string, string>} values
 * @returns {string}
 */
function fillTemplate(values) {
  const value = (name) => (typeof values[name] === 'string' ? values[name] : '');

  return TEMPLATE.replace(
    /^[ \t]*\{\{(\w+)\}\}[ \t]*\r?\n|\{\{(\w+)\}\}/gm,
    (whole, ownLine, inline) => {
      if (inline !== undefined) return value(inline);

      const filled = value(ownLine);
      return filled === '' ? '' : `${filled}\n`;
    },
  );
}

/**
 * The page shell.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.lede]
 * @param {string} options.body
 * @returns {string}
 */
export function layout({ title, lede = '', body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Task 4</title>
<style>${STYLES}</style>
</head>
<body>
  <header class="masthead">
    <div class="title">Product Keywords</div>
    <div class="sub">Read-only view of the ledsone database</div>
  </header>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ''}
${body}
    <footer>Task 4 &middot; reads ledsone, read-only &middot; no data is written</footer>
  </main>
</body>
</html>
`;
}

/**
 * One cell for a keyword category.
 *
 * A category the database does not record is an actual empty HTML cell.
 *
 * @param {string|null} value
 * @returns {string}
 */
function categoryCell(value) {
  if (value === null || value === undefined || value === '') {
    return '<td></td>';
  }
  return `<td>${escapeHtml(value)}</td>`;
}

/**
 * The product image cell.
 *
 * A picture is shown only when the database actually holds a web address for
 * one. Anything else - no row in either image table, an empty string, or a
 * value that is not an http(s) address - leaves the cell genuinely empty. No
 * placeholder image, no stand-in URL, no "no image" graphic.
 *
 * The scheme check is deliberate. The URL is database text, and `src` is an
 * attribute the browser acts on, so only http and https are let through; a
 * `data:`, `javascript:` or relative value is treated as no image rather than
 * passed to the browser. The URL and the alt text are both escaped, so a
 * quote in either cannot close the attribute and add one of its own.
 *
 * @param {string|null} url    The image address from ledsone.
 * @param {unknown} productName  Used as the alt text.
 * @returns {string}
 */
function imageCell(url, productName) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    return '<td class="img"></td>';
  }

  const alt = escapeHtml(productName);
  return (
    `<td class="img"><img src="${escapeHtml(url.trim())}" alt="${alt}"` +
    ' width="56" height="56" loading="lazy" decoding="async"></td>'
  );
}

/**
 * The attributes one paging button carries.
 *
 * The button itself - its tag, its class, its label - is written out in
 * page.html. All this decides is whether the button leads anywhere: an
 * `href` when the page exists, `aria-disabled` when it does not. A disabled
 * button therefore has no href at all, which is why `page=0` never appears in
 * the markup and why the browser will not follow it.
 *
 * The value is interpolated as markup rather than text, so it is built only
 * from a whole number and fixed strings - never from database data.
 *
 * @param {number|null} target  The page to link to, or null for disabled.
 * @param {'prev'|'next'} rel
 * @returns {string}
 */
function buttonAttributes(target, rel) {
  return target === null
    ? 'aria-disabled="true"'
    : `href="/product-keywords?page=${Math.trunc(target)}" rel="${rel}"`;
}

/**
 * The Product Keywords page.
 *
 * This function builds VALUES, not structure. The document - doctype, head,
 * CSS, heading, count line, both control bars with their buttons, and the
 * seven-column table with its headers - is written out in page.html, and is
 * filled here with the seven slots that depend on the data:
 *
 *   count_text, page_position, prev_attrs, next_attrs, controls_hidden,
 *   rows, empty_message
 *
 * The rows are the one piece of markup built here, because they come from the
 * database a page at a time. Each is exactly eight cells, in the order
 * page.html heads them, and every value passes through escapeHtml. A keyword
 * category with nothing to show is an empty cell, never placeholder text, and
 * so is a product the database holds no image for.
 *
 * @param {object} options
 * @param {Array<{id: number, sku: string, title: string, image?: string|null}>} options.products
 * @param {number} options.total     Products in the catalogue.
 * @param {number} options.page      1-based.
 * @param {number} options.pageCount
 * @param {number} options.pageSize  Products per page, for the row-count line.
 * @param {(product: {id: number, sku: string, title: string}) => {primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}} options.classify
 * @returns {string}
 */
export function renderProductKeywordsPage({
  products,
  total,
  page,
  pageCount,
  pageSize,
  classify,
}) {
  const rows = products
    .map((product) => {
      const category = classify(product);

      return (
        '          <tr>' +
        imageCell(product.image ?? null, product.title) +
        `<td class="sku">${escapeHtml(product.sku)}</td>` +
        `<td class="num">${escapeHtml(product.id)}</td>` +
        `<td class="name">${escapeHtml(product.title)}</td>` +
        categoryCell(category.primary) +
        categoryCell(category.secondary) +
        categoryCell(category.longTail) +
        categoryCell(category.competitor) +
        '</tr>'
      );
    })
    .join('\n');

  const first = products.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const countText =
    products.length === 0
      ? 'No products on this page.'
      : `Showing ${number(first)}&ndash;${number(first + products.length - 1)} of ${number(total)} products.`;

  // One page of results has nowhere to page to, so page.html hides both bars
  // rather than showing two buttons that cannot be used.
  const single = pageCount <= 1;

  return fillTemplate({
    count_text: countText,
    page_position: `Page ${number(page)} of ${number(pageCount)}`,
    prev_attrs: buttonAttributes(page > 1 ? page - 1 : null, 'prev'),
    next_attrs: buttonAttributes(page < pageCount ? page + 1 : null, 'next'),
    controls_hidden: single ? ' hidden' : '',
    rows,
    empty_message: rows === '' ? '    <p class="empty">No products found.</p>' : '',
  });
}

/**
 * Shown for any path this application does not serve.
 *
 * @returns {string}
 */
export function renderNotFoundPage() {
  return layout({
    title: 'Page not found',
    body: '    <p class="empty">There is one page in this application: <a href="/product-keywords">/product-keywords</a>.</p>',
  });
}

/**
 * Shown when something is submitted.
 *
 * Nothing in this application accepts a submission - the source database is
 * read-only to it - so the answer explains that rather than being a bare 404
 * that looks like a fault.
 *
 * @returns {string}
 */
export function renderReadOnlyPage() {
  return layout({
    title: 'Read-only',
    body: '    <p class="empty">This application only reads the ledsone database. Nothing can be created, edited or deleted through it.</p>',
  });
}

/**
 * Shown when a page cannot be built.
 *
 * The operator gets the detail on the console; the page says nothing
 * technical.
 *
 * @returns {string}
 */
export function renderErrorPage() {
  return layout({
    title: 'Something went wrong',
    body: '    <p class="empty">The page could not be built. The database may be unreachable - check the server console.</p>',
  });
}
