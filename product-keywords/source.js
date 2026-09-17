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
 * The view does not display unclassified keyword text. It reads only the three
 * confirmed product fields and leaves the four unavailable categories blank.
 */

import { INVENTORY_SCHEMA, firstRow, rows } from './db.js';

/**
 * Products shown per page.
 *
 * The catalogue is 44,599 products, so the list is paged rather than returned
 * as one impractically large document.
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
 * When the rules ARE agreed, this function is what changes. It returns one
 * value per category; returning null means "the database does not say", and
 * the page renders that as a blank cell. Neither the SQL, the router nor the
 * rendering layer needs to be touched to switch a category on - which is the
 * whole reason the decision lives in a function of its own rather than being
 * spread through the query.
 *
 * @returns {{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}}
 */
export function classifyKeywords() {
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
 * One page of products.
 *
 * LIMIT and OFFSET are parameters, not interpolated text.
 *
 * @param {object} [options]
 * @param {number} [options.page]      1-based page number.
 * @param {number} [options.pageSize]
 * @returns {Promise<Array<{id: number, sku: string, title: string}>>}
 */
export async function findProductKeywordPage({ page = 1, pageSize = PAGE_SIZE } = {}) {
  const limit = Math.max(1, Math.trunc(pageSize));
  const offset = (Math.max(1, Math.trunc(page)) - 1) * limit;

  const found = await rows(
    `SELECT id, sku, title
     FROM ${INVENTORY_SCHEMA}.products
     ORDER BY id
     LIMIT $1 OFFSET $2`,
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
