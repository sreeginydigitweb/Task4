/**
 * Routing for the Product Keywords view.
 *
 * One page, and the handful of answers a small HTTP server still owes a
 * client: a redirect from the root, a 404 for anything else, and a plain
 * explanation for a submission this read-only application will never accept.
 *
 * All the decisions live here rather than in server.js, which is why they can
 * be tested without opening a socket.
 */

import { PAGE_SIZE, classifyKeywords, countProducts, findProductKeywordPage } from './source.js';
import { renderNotFoundPage, renderProductKeywordsPage, renderReadOnlyPage } from './render.js';

/** An HTML response. */
function html(body, status = 200) {
  return { status, contentType: 'text/html; charset=utf-8', body };
}

/** A 404. */
function notFound() {
  return html(renderNotFoundPage(), 404);
}

/**
 * Read the requested page number.
 *
 * Anything that is not a positive whole number - a word, a negative, a
 * fraction, nothing at all - is page 1 rather than an error. A bad page
 * parameter is a mistyped URL, not a fault worth a 500, and the number never
 * reaches SQL as text: it is used to compute an OFFSET that is passed as a
 * parameter.
 *
 * @param {URLSearchParams} query
 * @returns {number}
 */
export function pageFrom(query) {
  const raw = query.get('page');
  if (raw === null) return 1;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return 1;

  return value;
}

/**
 * The Product Keywords page.
 *
 * The total is read first so the requested page can be clamped to one that
 * exists - asking for page 900 of 892 returns the last page rather than an
 * empty table that looks like a data problem.
 *
 * @param {URLSearchParams} query
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
async function productKeywordsRoute(query) {
  const total = await countProducts();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageFrom(query), pageCount);

  const products = await findProductKeywordPage({ page, pageSize: PAGE_SIZE });

  return html(
    renderProductKeywordsPage({
      products,
      total,
      page,
      pageCount,
      pageSize: PAGE_SIZE,
      // The renderer receives resolved categories, keeping title generation
      // testable without a live database.
      classify: (product) => classifyKeywords(product.title, product.keywordCategories),
    }),
  );
}

/**
 * Resolve one request to a response.
 *
 * @param {string} pathname  Request path, without the query string.
 * @param {URLSearchParams} [query]
 * @returns {Promise<{status: number, contentType: string, body: string, location?: string}>}
 */
export async function route(pathname, query = new URLSearchParams()) {
  const path = normalisePath(pathname);

  switch (path) {
    case '':
    case '/':
      // There is one page; the root is a signpost to it rather than a second
      // URL serving the same thing.
      return {
        status: 302,
        contentType: 'text/html; charset=utf-8',
        location: '/product-keywords',
        body: '',
      };

    case '/product-keywords':
      return productKeywordsRoute(query);

    default:
      return notFound();
  }
}

/** Trailing slashes are tolerated so /product-keywords/ is not a dead end. */
function normalisePath(pathname) {
  return pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Resolve one form submission to a response.
 *
 * Nothing in this application accepts one. It is kept as a named route rather
 * than dropped so that a POST gets an answer that explains itself - the source
 * database is read-only and this application reports on it - instead of a bare
 * 404 that looks like a bug.
 *
 * @param {string} pathname
 * @param {URLSearchParams} [form] The decoded request body.
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
export async function routeForm(pathname, form = new URLSearchParams()) {
  void form;
  void pathname;

  return html(renderReadOnlyPage(), 405);
}
