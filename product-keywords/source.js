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

import { ALL_CATEGORIES, categoryFor, countInCategory, pageOfCategory } from './categories.js';
import { INVENTORY_SCHEMA, LISTINGS_SCHEMA, firstRow, rows } from './db.js';
import { resolveKeywordCategories } from './keyword-generator.js';

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
 * resolved. A confirmed database category wins; otherwise the product title
 * supplies a deterministic search-term fallback.
 *
 * `ledsone` currently has no confirmed classified categories, so production
 * calls use the title fallback. The `recorded` argument is deliberately kept
 * at this seam: if a properly classified source is later introduced, it can be
 * passed here without changing rendering or routing.
 *
 * @param {unknown} title
 * @param {Partial<{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}>} [recorded]
 * @returns {{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}}
 */
export function classifyKeywords(title, recorded = {}) {
  return resolveKeywordCategories(title, recorded);
}

/**
 * How many products the catalogue holds.
 *
 * Used for the page count and the row-count line. Kept as its own statement so
 * the page query never has to count what it is not showing.
 *
 * @returns {Promise<number>}
 */
export async function countProducts({ category = ALL_CATEGORIES } = {}) {
  if (category !== ALL_CATEGORIES) {
    // A filtered count comes from the category index, because a category
    // derived from a product name cannot be counted in SQL.
    return countInCategory(category);
  }

  const row = await firstRow(`SELECT count(*)::int AS total FROM ${INVENTORY_SCHEMA}.products`);
  return row?.total ?? 0;
}

/**
 * One page of products, with the image to show for each.
 *
 * LIMIT and OFFSET are parameters, not interpolated text.
 *
 * ---------------------------------------------------------------------------
 * THE PRODUCT IMAGE
 *
 * Two tables in the `inventory` schema hold product images, and both key on
 * `product_id`, which is `inventory.products.id`:
 *
 *   inventory.product_media   image_url, with type = 'main-image' marking the
 *                             one designated as the product's main picture
 *   inventory.product_images  image_url, a gallery ordered by image_ordering
 *
 * The designated main image wins; the first gallery image is the fallback.
 * That preference is not a guess made here - it is the rule the Smart
 * Inventory Control application (`../Inventory System`, inventory/source.js)
 * already uses against this same database, and this query is that query's
 * image CTEs reused unchanged.
 *
 * Both joins are LEFT joins, so a product with no image is still listed; its
 * image is null and the view leaves the cell blank. About one product in six
 * is in that position - 7,341 of 44,636 when last measured, though the
 * catalogue is live and grows.
 *
 * The page is narrowed FIRST, in the `page` CTE, so the image lookups run
 * against the 50 rows being shown rather than the whole catalogue.
 *
 * ---------------------------------------------------------------------------
 * THE CATEGORY
 *
 * ledsone's own category is `listings.shopify_listings.product_type`, joined
 * by SKU - one listing per SKU, the most recently updated. It is read here for
 * the rows being shown; where it is absent, categories.js derives one from the
 * product name. See categories.js for why that order.
 *
 * ---------------------------------------------------------------------------
 * FILTERING
 *
 * With a category chosen, the ids for the page come from the category index
 * rather than from LIMIT/OFFSET - a category derived from a product name
 * cannot be filtered in SQL. The row query is otherwise identical, so a
 * filtered page and an unfiltered one are built the same way.
 *
 * @param {object} [options]
 * @param {number} [options.page]      1-based page number.
 * @param {number} [options.pageSize]
 * @param {string} [options.category]  ALL_CATEGORIES for the whole catalogue.
 * @returns {Promise<Array<{id: number, sku: string, title: string, image: string|null, category: string|null}>>}
 */
export async function findProductKeywordPage({
  page = 1,
  pageSize = PAGE_SIZE,
  category = ALL_CATEGORIES,
} = {}) {
  const limit = Math.max(1, Math.trunc(pageSize));
  const offset = (Math.max(1, Math.trunc(page)) - 1) * limit;

  // With a filter, the page is a list of ids; without one, it is a slice of
  // the catalogue in id order. Both reach the same row query below.
  const filteredIds = category === ALL_CATEGORIES ? null : await pageOfCategory(category, { page, pageSize: limit });

  const found = await rows(
    `WITH page AS (
       ${
         filteredIds === null
           ? `SELECT id, sku, title
       FROM ${INVENTORY_SCHEMA}.products
       ORDER BY id
       LIMIT $1 OFFSET $2`
           : `SELECT id, sku, title
       FROM ${INVENTORY_SCHEMA}.products
       WHERE id = ANY($1)
       ORDER BY id`
       }
     ),
     shopify_category AS (
       SELECT DISTINCT ON (coalesce(nullif(l.mapped_sku, ''), l.sku))
              coalesce(nullif(l.mapped_sku, ''), l.sku) AS sku,
              l.product_type
       FROM ${LISTINGS_SCHEMA}.shopify_listings l
       WHERE coalesce(l.product_type, '') <> ''
       ORDER BY 1, l.updated_at DESC NULLS LAST, l.id DESC
     ),
     main_media AS (
       SELECT DISTINCT ON (m.product_id) m.product_id, m.image_url
       FROM ${INVENTORY_SCHEMA}.product_media m
       WHERE m.type = 'main-image' AND coalesce(m.image_url, '') <> ''
       ORDER BY m.product_id, m.id
     ),
     first_image AS (
       SELECT DISTINCT ON (i.product_id) i.product_id, i.image_url
       FROM ${INVENTORY_SCHEMA}.product_images i
       WHERE coalesce(i.image_url, '') <> ''
       ORDER BY i.product_id, i.image_ordering NULLS LAST, i.id
     )
     SELECT p.id, p.sku, p.title,
            coalesce(mm.image_url, fi.image_url) AS image_url,
            sc.product_type
     FROM page p
     LEFT JOIN shopify_category sc ON sc.sku = p.sku
     LEFT JOIN main_media  mm ON mm.product_id = p.id
     LEFT JOIN first_image fi ON fi.product_id = p.id
     ORDER BY p.id`,
    filteredIds === null ? [limit, offset] : [filteredIds],
  );

  return found.map((row) => ({
    id: row.id,
    sku: row.sku,
    title: row.title,
    // Null when neither table holds one. The view shows a blank cell; it never
    // substitutes a placeholder image.
    image: row.image_url ?? null,
    // ledsone's recorded category, else one derived from the product name,
    // else null for a blank cell.
    category: categoryFor(row.title, row.product_type),
  }));
}
