/**
 * Everything this application reads from `ledsone`.
 *
 * Two statements, both SELECTs, both parameterised. Nothing else in the
 * project issues SQL.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DATABASE ACTUALLY HOLDS
 *
 * Product identity is straightforward and confirmed:
 *
 *   inventory.products.id     -> Product ID
 *   inventory.products.sku    -> SKU
 *   inventory.products.title  -> Product Name
 *
 * Keywords are not. `ledsone` stores keyword TEXT, but it does not store any
 * classification of that text. There is no primary keyword column, no
 * secondary keyword column, no long-tail column, and no competitor keyword
 * table anywhere in the database - this was checked across all eighteen
 * schemas during discovery, not assumed.
 *
 * What does exist, and can be tied to a product, is Amazon search-engine
 * keyword text. It reaches a product through the listing, not directly:
 *
 *   inventory.products.sku
 *     = listings.amazon_listings.mapped_sku
 *   listings.amazon_listings.id
 *     = listings.amazon_listing_search_engine_keywords.product_id
 *
 * The middle step is not optional. `amazon_listing_search_engine_keywords`
 * has a column called `product_id`, but it references the LISTING, not
 * inventory.products - of its 189,983 rows, zero match inventory.products.id
 * and 155,374 match listings.amazon_listings.id. Joining it straight to
 * products on that name returns nothing at all, silently.
 *
 * So the keyword text this application shows is real, and it belongs to the
 * product it is shown against. What it is NOT is classified, and this module
 * does not pretend otherwise. See classifyKeywords() below.
 */

import { INVENTORY_SCHEMA, LISTINGS_SCHEMA, firstRow, rows } from './db.js';

/**
 * Products shown per page.
 *
 * The catalogue is 44,599 products and a product can carry dozens of keyword
 * strings, several of them hundreds of characters long. One page of everything
 * would be a document measured in megabytes, so the list is paged and the
 * keyword lookup runs only for the products on the page being shown.
 */
export const PAGE_SIZE = 50;

/**
 * THE CLASSIFICATION SEAM.
 *
 * This is the one place where the four requested keyword categories are
 * decided, and today it decides that none of them are known.
 *
 * That is not a placeholder standing in for work that was skipped. It is the
 * accurate answer: `ledsone` holds no primary/secondary/long-tail/competitor
 * distinction to read, and inventing one - calling an EXACT match "primary",
 * or a four-word phrase "long-tail" - would put a claim on the page that the
 * business has never made and cannot be checked against anything. The rules
 * for these four categories have not been agreed, so nothing is asserted.
 *
 * When the rules ARE agreed, this function is what changes. It receives the
 * keyword strings recorded against one product and returns one value per
 * category; returning null means "the database does not say", and the page
 * renders that as "Not recorded". Neither the SQL, the router nor the
 * rendering layer needs to be touched to switch a category on - which is the
 * whole reason the decision lives in a function of its own rather than being
 * spread through the query.
 *
 * @param {readonly string[]} keywords  Keyword text recorded for the product.
 * @returns {{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}}
 */
export function classifyKeywords(keywords) {
  void keywords;

  return {
    // No column in ledsone marks a keyword as the primary one.
    primary: null,
    // No column in ledsone marks keywords as secondary.
    secondary: null,
    // No column in ledsone marks keywords as long-tail. Word count is a guess,
    // not a record, so it is not used.
    longTail: null,
    // No competitor keyword source exists in ledsone at all. The competitor
    // tables are in a different database, which this version does not read.
    competitor: null,
  };
}

/**
 * How many products the catalogue holds.
 *
 * Used for the page count and the row-count line. Kept as its own statement so
 * the page query never has to count what it is not showing.
 *
 * @returns {Promise<number>}
 */
export async function countProducts() {
  const row = await firstRow(`SELECT count(*)::int AS total FROM ${INVENTORY_SCHEMA}.products`);
  return row?.total ?? 0;
}

/**
 * One page of products, each with the keyword text recorded against it.
 *
 * The shape of the statement matters. The products for the page are chosen
 * FIRST, in a CTE, and the keyword lookup is a LATERAL join that runs only for
 * those rows - so the work is proportional to the page, not to the catalogue,
 * and both sides of it are index-served (`amazon_listings.mapped_sku` and
 * `amazon_listing_search_engine_keywords.product_id` are both indexed). The
 * alternative - joining everything and paging the result - would read the
 * whole catalogue to show fifty rows of it.
 *
 * DISTINCT ON collapses the duplicates that come from a SKU having more than
 * one Amazon listing (several marketplaces, parent and child rows), which
 * would otherwise repeat the same keyword string several times against one
 * product. Products are still one row each: the keyword text is aggregated
 * into an array rather than multiplying the product row.
 *
 * LIMIT and OFFSET are parameters, not interpolated text.
 *
 * @param {object} [options]
 * @param {number} [options.page]      1-based page number.
 * @param {number} [options.pageSize]
 * @returns {Promise<Array<{id: number, sku: string, title: string, keywords: string[]}>>}
 */
export async function findProductKeywordPage({ page = 1, pageSize = PAGE_SIZE } = {}) {
  const limit = Math.max(1, Math.trunc(pageSize));
  const offset = (Math.max(1, Math.trunc(page)) - 1) * limit;

  const found = await rows(
    `WITH page AS (
       SELECT id, sku, title
       FROM ${INVENTORY_SCHEMA}.products
       ORDER BY id
       LIMIT $1 OFFSET $2
     )
     SELECT p.id,
            p.sku,
            p.title,
            COALESCE(k.keywords, ARRAY[]::text[]) AS keywords
     FROM page p
     LEFT JOIN LATERAL (
       SELECT array_agg(d.keyword ORDER BY d.view_order, d.keyword) AS keywords
       FROM (
         SELECT DISTINCT ON (kw.keyword) kw.keyword, kw.view_order
         FROM ${LISTINGS_SCHEMA}.amazon_listings a
         JOIN ${LISTINGS_SCHEMA}.amazon_listing_search_engine_keywords kw
           ON kw.product_id = a.id
         WHERE a.mapped_sku = p.sku
         ORDER BY kw.keyword, kw.view_order
       ) d
     ) k ON true
     ORDER BY p.id`,
    [limit, offset],
  );

  return found.map((row) => ({
    id: row.id,
    sku: row.sku,
    title: row.title,
    // Null keyword text is dropped rather than shown as an empty entry: a row
    // exists for it in the source, but there is nothing in it to display.
    keywords: (row.keywords ?? []).filter((keyword) => keyword !== null && keyword !== ''),
  }));
}
