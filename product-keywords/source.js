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

import {
  ALL_CATEGORIES,
  categoryFor,
  countInCategory,
  idsInCategory,
  pageOfCategory,
} from './categories.js';
import { INVENTORY_SCHEMA, LISTINGS_SCHEMA, firstRow, rows } from './db.js';
import { keywordTermSources, resolveKeywordCategories } from './keyword-generator.js';

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
 * The same four categories, split into individual keywords with the source of
 * each one.
 *
 * Reports on the values `classifyKeywords` produces; it changes none of them.
 * See keywordTermSources for what 'db', 'gen' and 'mix' mean.
 *
 * @param {unknown} title
 * @param {Partial<{primary: string|null, secondary: string|null, longTail: string|null, competitor: string|null}>} [recorded]
 * @returns {ReturnType<typeof keywordTermSources>}
 */
export function classifyKeywordTerms(title, recorded = {}) {
  return keywordTermSources(title, recorded);
}

/**
 * Tidy a search box value.
 *
 * Whitespace-only is no search. Nothing else is stripped: the value is never
 * put into SQL as text, only ever as a parameter.
 *
 * @param {unknown} search
 * @returns {string}
 */
export function normaliseSearch(search) {
  return typeof search === 'string' ? search.trim() : '';
}

/**
 * The WHERE clause and parameters for the current filters.
 *
 * Both filters narrow the same list, so count and page must agree on them -
 * which is why this is built once and used by both.
 *
 *   category  ids from the category index, because a category derived from a
 *             product name cannot be matched in SQL
 *   search    SKU, product id or product name
 *
 * The search text reaches the database as a PARAMETER, never as SQL. `ILIKE`
 * is case-insensitive; the `%` wrappers are added to the parameter value, not
 * to the statement, so a `%` typed in the box is matched literally by the
 * driver rather than becoming a wildcard of its own.
 *
 * @param {Array<unknown>|null} ids  Candidate product ids, or null for all.
 * @param {string} search
 * @returns {{where: string, params: unknown[]}}
 */
function filterClause(ids, search) {
  const conditions = [];
  const params = [];

  if (ids !== null) {
    params.push(ids);
    conditions.push(`id = ANY($${params.length})`);
  }

  if (search !== '') {
    params.push(`%${search}%`);
    const like = `$${params.length}`;
    params.push(search);
    const exact = `$${params.length}`;

    // Product id is a number, so it is matched exactly rather than partially -
    // searching "2" should not return every id containing a 2.
    conditions.push(`(sku ILIKE ${like} OR title ILIKE ${like} OR id::text = ${exact})`);
  }

  return { where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`, params };
}

/**
 * The product ids a category filter allows, or null when it allows everything.
 *
 * @param {string} category
 * @returns {Promise<Array<unknown>|null>}
 */
async function candidateIds(category) {
  if (category === ALL_CATEGORIES) return null;
  return idsInCategory(category);
}

/**
 * How many products match the current filters.
 *
 * With neither filter this is the catalogue total, which is a cheap count of
 * its own. With a category and no search it comes from the category index. Any
 * search has to be counted in the database, because the text is not indexed
 * here.
 *
 * @param {object} [options]
 * @param {string} [options.category]
 * @param {string} [options.search]
 * @returns {Promise<number>}
 */
export async function countProducts({ category = ALL_CATEGORIES, search = '' } = {}) {
  const term = normaliseSearch(search);

  if (term === '') {
    if (category !== ALL_CATEGORIES) {
      // A category-only count comes from the index, because a category derived
      // from a product name cannot be counted in SQL.
      return countInCategory(category);
    }

    const row = await firstRow(`SELECT count(*)::int AS total FROM ${INVENTORY_SCHEMA}.products`);
    return row?.total ?? 0;
  }

  const { where, params } = filterClause(await candidateIds(category), term);
  const row = await firstRow(
    `SELECT count(*)::int AS total FROM ${INVENTORY_SCHEMA}.products ${where}`,
    params,
  );

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
 * THE PRODUCT TAGS
 *
 * These are ledsone's OWN stored tags. Nothing here derives, guesses or
 * invents one: a product shows the tags the business recorded against it, or
 * it shows none.
 *
 *   listings.shopify_listing_tag.tag          the tag text
 *   listings.shopify_listing_tag.product_id   the LISTING it belongs to
 *   listings.shopify_listing_tag.is_deleted   0 = live; deleted rows are skipped
 *
 * The column name `product_id` is misleading and is the one thing worth
 * reading carefully. It is NOT `inventory.products.id`. Its values run from
 * 344,702 to 1,022,891, while product ids run 1 to 44,652; it is
 * `listings.shopify_listings.id`, whose range (344,704 to 1,022,893) matches
 * exactly. Joining it straight to a product id would silently match nothing.
 *
 * The second thing worth reading carefully is WHICH listing carries the tags.
 * Of the 14,765 tagged listings, 14,761 are PARENT listings - and a parent
 * listing has no SKU at all. So joining tags to products by SKU alone reaches
 * four products out of 44,643. The parent's children are the rows that carry
 * the SKUs, and `listings.shopify_listings_parent_child_mapping` is what links
 * them. Following it is what takes the coverage from 4 products to 19,723.
 *
 * So a product's tags are those recorded against either:
 *
 *   - the listing that carries its SKU, or
 *   - that listing's PARENT, via parent_child_mapping
 *
 * de-duplicated and trimmed (the stored values often have a leading space).
 * 19,723 of 44,643 products have at least one tag; the other 24,920 have none
 * and show a blank cell, exactly as a missing image or category does.
 *
 * The lookup starts from the 50 rows being shown, not from the tag table, so
 * it is an indexed lookup per listing rather than a scan of 147,833 tag rows.
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
 * @returns {Promise<Array<{id: number, sku: string, title: string, image: string|null, category: string|null, tags: string[]}>>}
 */
export async function findProductKeywordPage({
  page = 1,
  pageSize = PAGE_SIZE,
  category = ALL_CATEGORIES,
  search = '',
} = {}) {
  const limit = Math.max(1, Math.trunc(pageSize));
  const offset = (Math.max(1, Math.trunc(page)) - 1) * limit;
  const term = normaliseSearch(search);

  // Three ways to pick a page, all ending in the same row query:
  //
  //   no filters        a slice of the catalogue in id order
  //   category only     the page's ids straight from the category index
  //   any search        a database query over the candidates, because the
  //                     text is not indexed in memory
  const categoryOnly = term === '' && category !== ALL_CATEGORIES;
  const pageIds = categoryOnly ? await pageOfCategory(category, { page, pageSize: limit }) : null;

  let pageSelect;
  let pageParams;

  if (pageIds !== null) {
    pageParams = [pageIds];
    pageSelect = `SELECT id, sku, title
       FROM ${INVENTORY_SCHEMA}.products
       WHERE id = ANY($1)
       ORDER BY id`;
  } else if (term === '') {
    pageParams = [limit, offset];
    pageSelect = `SELECT id, sku, title
       FROM ${INVENTORY_SCHEMA}.products
       ORDER BY id
       LIMIT $1 OFFSET $2`;
  } else {
    const { where, params } = filterClause(await candidateIds(category), term);
    pageParams = [...params, limit, offset];
    pageSelect = `SELECT id, sku, title
       FROM ${INVENTORY_SCHEMA}.products
       ${where}
       ORDER BY id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  }

  const found = await rows(
    `WITH page AS (
       ${pageSelect}
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
     ),
     -- The listing that carries each shown product's SKU.
     page_listing AS (
       SELECT p.sku, l.id AS listing_id
       FROM page p
       JOIN ${LISTINGS_SCHEMA}.shopify_listings l
         ON coalesce(nullif(l.mapped_sku, ''), l.sku) = p.sku
     ),
     -- The listings whose tags count as this SKU's: that listing, and its
     -- parent. Almost every tagged listing is a parent, and a parent has no
     -- SKU of its own, so the second half is where nearly all the tags are.
     tag_owner AS (
       SELECT sku, listing_id AS owner_id FROM page_listing
       UNION
       SELECT pl.sku, m.parent_id
       FROM page_listing pl
       JOIN ${LISTINGS_SCHEMA}.shopify_listings_parent_child_mapping m
         ON m.child_id = pl.listing_id
     ),
     -- ledsone's stored tags for those listings. Trimmed, because the stored
     -- values often carry a leading space; de-duplicated, because a parent and
     -- a child can record the same tag; sorted, so the order is stable between
     -- page loads rather than whatever the planner happened to produce.
     product_tags AS (
       SELECT o.sku, array_agg(DISTINCT btrim(t.tag) ORDER BY btrim(t.tag)) AS tags
       FROM tag_owner o
       JOIN ${LISTINGS_SCHEMA}.shopify_listing_tag t ON t.product_id = o.owner_id
       WHERE t.is_deleted = 0 AND btrim(coalesce(t.tag, '')) <> ''
       GROUP BY o.sku
     )
     SELECT p.id, p.sku, p.title,
            coalesce(mm.image_url, fi.image_url) AS image_url,
            sc.product_type,
            pt.tags
     FROM page p
     LEFT JOIN shopify_category sc ON sc.sku = p.sku
     LEFT JOIN main_media  mm ON mm.product_id = p.id
     LEFT JOIN first_image fi ON fi.product_id = p.id
     LEFT JOIN product_tags pt ON pt.sku = p.sku
     ORDER BY p.id`,
    pageParams,
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
    // ledsone's own stored tags. An empty array when the business recorded
    // none - the view shows a blank cell rather than inventing one.
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));
}
