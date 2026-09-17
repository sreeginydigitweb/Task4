/**
 * HTML rendering for the Product Keywords view.
 *
 * Pure string building. No data access, no database, no I/O: every function
 * here is handed the rows it should show and does nothing but turn them into
 * markup, which is why it can all be tested without a connection.
 *
 * Two rules hold throughout:
 *
 * 1. Every dynamic value goes through escapeHtml before it reaches the page.
 *    The data comes from PostgreSQL and includes free-typed product titles and
 *    keyword text in several languages, so the rule is not optional.
 *
 * 2. The page never claims a classification the database does not hold. A
 *    category with no source renders as NOT_RECORDED - not as a blank cell, and
 *    never as a keyword borrowed from somewhere else and relabelled.
 */

/**
 * Shown wherever `ledsone` has no value for a field.
 *
 * Deliberately not a blank cell and not a dash on its own. "Not recorded" says
 * the business has not captured this, which is the true answer for all four
 * keyword categories today, and it cannot be mistaken for a value.
 *
 * One representation, used everywhere.
 */
export const NOT_RECORDED = 'Not recorded';

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

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --ink: #1b1f24;
  --muted: #5b6672;
  --line: #d8dee6;
  --accent: #1f4f82;
  --absent-bg: #f1f3f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171b;
    --panel: #1c2026;
    --ink: #e6e9ed;
    --muted: #9aa5b1;
    --line: #2e353e;
    --accent: #7fb0e6;
    --absent-bg: #22272e;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.masthead {
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  padding: 14px 20px;
}
.masthead .title { font-weight: 650; letter-spacing: .01em; }
.masthead .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
main { padding: 20px; max-width: 100%; }
h1 { font-size: 21px; margin: 0 0 6px; }
.lede { color: var(--muted); margin: 0 0 16px; max-width: 70ch; }
.notice {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  padding: 12px 14px;
  margin: 0 0 16px;
  max-width: 90ch;
}
.notice h2 { font-size: 14px; margin: 0 0 6px; }
.notice p { margin: 0 0 6px; color: var(--muted); }
.notice p:last-child { margin-bottom: 0; }
.count { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
.scroll-hint { color: var(--muted); font-size: 12px; margin: 0 0 6px; }
.table-scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--panel); position: sticky; top: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
td.sku { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.name { min-width: 26ch; max-width: 40ch; }
td.absent { background: var(--absent-bg); color: var(--muted); font-style: italic; white-space: nowrap; }
td.keywords { min-width: 30ch; max-width: 60ch; }
ul.kw { margin: 0; padding-left: 16px; }
ul.kw li { margin: 0 0 3px; overflow-wrap: anywhere; }
ul.kw li:last-child { margin-bottom: 0; }
.pager { display: flex; gap: 10px; align-items: center; margin-top: 14px; font-size: 13px; }
.pager a { color: var(--accent); }
.pager span.here { color: var(--muted); }
.empty { color: var(--muted); padding: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; }
footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
`;

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
 * Wrap table markup, or show an empty-state message when there is nothing to
 * show.
 *
 * @param {string} rows
 * @param {string} head
 * @param {string} emptyMessage
 * @returns {string}
 */
export function tableOrEmpty(rows, head, emptyMessage) {
  if (!rows) {
    return `    <p class="empty">${escapeHtml(emptyMessage)}</p>`;
  }

  return `    <p class="scroll-hint">Scroll the table sideways to see every column.</p>
    <div class="table-scroll">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`;
}

/**
 * One cell for a keyword category.
 *
 * A category the database does not record is rendered as NOT_RECORDED in a
 * visibly muted cell, so a reader can tell at a glance that the column is
 * empty because the business has not captured it - not because this particular
 * product happens to have nothing.
 *
 * @param {string|null} value
 * @returns {string}
 */
function categoryCell(value) {
  if (value === null || value === undefined || value === '') {
    return `<td class="absent">${escapeHtml(NOT_RECORDED)}</td>`;
  }
  return `<td>${escapeHtml(value)}</td>`;
}

/**
 * The keyword text recorded against a product, as a list.
 *
 * Shown as its own column, under a heading that says exactly what it is:
 * unclassified Amazon search-engine keyword text. It is deliberately NOT
 * poured into the four category columns, because nothing in `ledsone` says
 * which of them any of it belongs to.
 *
 * @param {readonly string[]} keywords
 * @returns {string}
 */
function keywordsCell(keywords) {
  if (!keywords || keywords.length === 0) {
    return `<td class="absent">${escapeHtml(NOT_RECORDED)}</td>`;
  }

  const items = keywords
    .map((keyword) => `<li>${escapeHtml(keyword)}</li>`)
    .join('');

  return `<td class="keywords"><ul class="kw">${items}</ul></td>`;
}

/**
 * Previous / next links.
 *
 * @param {number} page
 * @param {number} pageCount
 * @returns {string}
 */
function pager(page, pageCount) {
  if (pageCount <= 1) return '';

  const previous =
    page > 1
      ? `<a href="/product-keywords?page=${page - 1}" rel="prev">&larr; Previous</a>`
      : '<span class="here">&larr; Previous</span>';

  const next =
    page < pageCount
      ? `<a href="/product-keywords?page=${page + 1}" rel="next">Next &rarr;</a>`
      : '<span class="here">Next &rarr;</span>';

  return `    <nav class="pager">${previous}<span class="here">Page ${number(page)} of ${number(pageCount)}</span>${next}</nav>`;
}

/** The table heading, in the order the requirement asks for. */
const HEAD =
  '<th>SKU</th>' +
  '<th>Product ID</th>' +
  '<th>Product Name</th>' +
  '<th>Primary Keyword</th>' +
  '<th>Secondary Keywords</th>' +
  '<th>Long-Tail Keywords</th>' +
  '<th>Competitor Keywords</th>' +
  '<th>Keywords recorded in ledsone (unclassified)</th>';

/**
 * The Product Keywords page.
 *
 * Seven columns because seven were asked for, plus an eighth that carries the
 * keyword text `ledsone` actually holds. The eighth column is the honest place
 * for that text: it is real data, tied to the right product, but the database
 * does not say which category any of it belongs to, so it is shown under a
 * heading that says so rather than being spread across the four category
 * columns as though it had been classified.
 *
 * @param {object} options
 * @param {Array<{id: number, sku: string, title: string, keywords: string[]}>} options.products
 * @param {number} options.total     Products in the catalogue.
 * @param {number} options.page      1-based.
 * @param {number} options.pageCount
 * @param {number} options.pageSize  Products per page, for the row-count line.
 * @param {(keywords: readonly string[]) => {primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}} options.classify
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
      const category = classify(product.keywords);

      return (
        '          <tr>' +
        `<td class="sku">${escapeHtml(product.sku)}</td>` +
        `<td class="num">${escapeHtml(product.id)}</td>` +
        `<td class="name">${escapeHtml(product.title)}</td>` +
        categoryCell(category.primary) +
        categoryCell(category.secondary) +
        categoryCell(category.longTail) +
        categoryCell(category.competitor) +
        keywordsCell(product.keywords) +
        '</tr>'
      );
    })
    .join('\n');

  const first = products.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const count =
    products.length === 0
      ? '<p class="count">No products on this page.</p>'
      : `<p class="count">Showing ${number(first)}&ndash;${number(first + products.length - 1)} of ${number(total)} products.</p>`;

  const notice = `    <section class="notice">
      <h2>What this page can and cannot tell you</h2>
      <p>SKU, Product ID and Product Name come from <code>inventory.products</code> in ledsone and are complete.</p>
      <p>Primary, Secondary, Long-Tail and Competitor are shown as &ldquo;${escapeHtml(NOT_RECORDED)}&rdquo; because ledsone holds no such classification. No competitor keyword source exists in ledsone at all. Nothing on this page has been guessed or derived.</p>
      <p>The final column is the keyword text ledsone does hold for the product &ndash; Amazon search-engine keywords, reached through the product&rsquo;s Amazon listing. It is unclassified, and is shown as recorded.</p>
    </section>`;

  return layout({
    title: 'Product Keywords',
    lede: 'Products from the ledsone catalogue with the keyword text recorded against them.',
    body: [notice, count, tableOrEmpty(rows, HEAD, 'No products found.'), pager(page, pageCount)]
      .filter(Boolean)
      .join('\n'),
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
