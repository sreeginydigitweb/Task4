/**
 * Product categories, and the index the category filter runs on.
 *
 * ---------------------------------------------------------------------------
 * WHERE A CATEGORY COMES FROM
 *
 * Two sources, in this order. Nothing is invented and no category data is
 * duplicated into a new table.
 *
 * 1. LEDSONE'S OWN CATEGORY: listings.shopify_listings.product_type, joined to
 *    inventory.products by SKU. This is the business's recorded category and
 *    it always wins. The join is the one Smart Inventory Control
 *    (../Inventory System) already uses against this database - the latest
 *    listing per SKU, by updated_at - reused unchanged.
 *
 *    It reaches 19,343 of 44,636 products (43.3%).
 *
 * 2. DERIVED FROM THE PRODUCT NAME, only where ledsone records nothing. The
 *    product type is taken from the terminology map in keyword-generator.js -
 *    the SAME map that already produces the Primary Keyword, not a second
 *    vocabulary written for categories. So a derived category is never a new
 *    fact: it is the product type the name already states.
 *
 *    It adds a further 1,899 products (4.3%).
 *
 * Together: 21,242 of 44,636 products (47.6%) carry a category, in 488
 * distinct values. The remaining 23,394 have no category and show a blank
 * cell - the catalogue holds many non-descriptive names such as
 * "Combo Default Title." and nothing can be said about them honestly.
 *
 * The recorded values are the marketplace's own and are shown as they are
 * stored, including near-duplicates ("Pendant Light", "Pendant Lighting",
 * "Pendant_Lamp_Lights") and other languages ("Pendelleuchten"). They are not
 * merged or translated: that would be editing the business's data on a guess.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS AN INDEX
 *
 * A derived category is computed in JavaScript from the product name, so
 * PostgreSQL cannot filter or count on it. Paging a filtered list correctly
 * needs to know every matching product before it can pick out one page, so the
 * whole catalogue's categories are worked out once and held in memory: an id
 * per category, and the counts the filter shows.
 *
 * It costs about 3.4 seconds to build and roughly 17MB, and is rebuilt when it
 * goes stale. Nothing is written back to the database.
 */

import { INVENTORY_SCHEMA, LISTINGS_SCHEMA, rows } from './db.js';
import { matchProductType, normaliseProductTitle } from './keyword-generator.js';

/** How long a built index is used before it is built again. */
export const INDEX_TTL_MS = 10 * 60 * 1000;

/** The filter value meaning "do not filter". */
export const ALL_CATEGORIES = '';

/**
 * The category for one product.
 *
 * Pure, and the single place the two sources are ordered. A recorded value
 * that is blank or only whitespace counts as missing rather than as data,
 * exactly as a recorded keyword does.
 *
 * @param {unknown} title          inventory.products.title
 * @param {unknown} recordedType   listings.shopify_listings.product_type
 * @returns {string|null}
 */
export function categoryFor(title, recordedType) {
  if (typeof recordedType === 'string' && recordedType.trim() !== '') {
    return recordedType.trim();
  }

  const type = matchProductType(normaliseProductTitle(title));
  return type ? type.primary : null;
}

/**
 * Where a product's category came from. For documentation and tests, not for
 * the page - the page shows a category, not its provenance.
 *
 * @param {unknown} title
 * @param {unknown} recordedType
 * @returns {'ledsone'|'product-name'|'none'}
 */
export function categorySource(title, recordedType) {
  if (typeof recordedType === 'string' && recordedType.trim() !== '') return 'ledsone';
  return matchProductType(normaliseProductTitle(title)) ? 'product-name' : 'none';
}

/**
 * The SQL that reads ledsone's recorded category for every product.
 *
 * One listing per SKU - the most recently updated - so a product cannot appear
 * twice because it is listed more than once.
 *
 * @returns {string}
 */
function catalogueQuery() {
  return `WITH shopify AS (
      SELECT DISTINCT ON (coalesce(nullif(l.mapped_sku, ''), l.sku))
             coalesce(nullif(l.mapped_sku, ''), l.sku) AS sku,
             l.product_type
      FROM ${LISTINGS_SCHEMA}.shopify_listings l
      WHERE coalesce(l.product_type, '') <> ''
      ORDER BY 1, l.updated_at DESC NULLS LAST, l.id DESC
    )
    SELECT p.id, p.title, s.product_type
    FROM ${INVENTORY_SCHEMA}.products p
    LEFT JOIN shopify s ON s.sku = p.sku
    ORDER BY p.id`;
}

/**
 * Build the index from a list of {id, title, product_type} rows.
 *
 * Separated from the query so it can be tested without a database.
 *
 * @param {Array<{id: unknown, title: unknown, product_type: unknown}>} catalogue
 * @returns {{builtAt: number, total: number, withCategory: number, categories: Array<{name: string, count: number}>, idsByCategory: Map<string, Array<unknown>>}}
 */
export function buildIndex(catalogue) {
  const idsByCategory = new Map();
  let withCategory = 0;

  for (const row of catalogue) {
    const category = categoryFor(row.title, row.product_type);
    if (category === null) continue;

    withCategory += 1;
    const ids = idsByCategory.get(category);
    if (ids === undefined) idsByCategory.set(category, [row.id]);
    else ids.push(row.id);
  }

  // Busiest first, then alphabetically, so the filter opens on the categories
  // that actually matter rather than on a value covering three products.
  const categories = [...idsByCategory.entries()]
    .map(([name, ids]) => ({ name, count: ids.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'));

  return {
    builtAt: Date.now(),
    total: catalogue.length,
    withCategory,
    categories,
    idsByCategory,
  };
}

/** @type {ReturnType<typeof buildIndex>|null} */
let index = null;

/** @type {Promise<ReturnType<typeof buildIndex>>|null} */
let building = null;

/**
 * The index, built on first use and rebuilt when stale.
 *
 * Concurrent callers share one build rather than each starting their own.
 *
 * @param {object} [options]
 * @param {number} [options.now]
 * @returns {Promise<ReturnType<typeof buildIndex>>}
 */
export async function getCategoryIndex({ now = Date.now() } = {}) {
  if (index !== null && now - index.builtAt < INDEX_TTL_MS) return index;
  if (building !== null) return building;

  building = rows(catalogueQuery())
    .then((catalogue) => {
      index = buildIndex(catalogue);
      return index;
    })
    .finally(() => {
      building = null;
    });

  return building;
}

/** Drop the cached index. For tests and for a deliberate refresh. */
export function resetCategoryIndex() {
  index = null;
  building = null;
}

/**
 * The categories the filter offers, busiest first.
 *
 * @returns {Promise<Array<{name: string, count: number}>>}
 */
export async function findCategories() {
  return (await getCategoryIndex()).categories;
}

/**
 * Is this a category the catalogue actually has?
 *
 * A filter value that matches nothing is treated as no filter rather than as
 * an error - a stale bookmark should show the catalogue, not a failure.
 *
 * @param {unknown} category
 * @returns {Promise<string>} The category, or ALL_CATEGORIES.
 */
export async function resolveCategory(category) {
  if (typeof category !== 'string' || category.trim() === '') return ALL_CATEGORIES;

  const { idsByCategory } = await getCategoryIndex();
  return idsByCategory.has(category) ? category : ALL_CATEGORIES;
}

/**
 * How many products a filter matches.
 *
 * @param {string} category  ALL_CATEGORIES for the whole catalogue.
 * @returns {Promise<number>}
 */
export async function countInCategory(category) {
  const { total, idsByCategory } = await getCategoryIndex();
  if (category === ALL_CATEGORIES) return total;
  return idsByCategory.get(category)?.length ?? 0;
}

/**
 * The product ids on one page of a filtered list.
 *
 * @param {string} category
 * @param {object} options
 * @param {number} options.page      1-based.
 * @param {number} options.pageSize
 * @returns {Promise<Array<unknown>>}
 */
export async function pageOfCategory(category, { page, pageSize }) {
  const { idsByCategory } = await getCategoryIndex();
  const ids = idsByCategory.get(category) ?? [];
  const first = (Math.max(1, Math.trunc(page)) - 1) * pageSize;

  return ids.slice(first, first + pageSize);
}
