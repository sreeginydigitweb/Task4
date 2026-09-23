/**
 * Where a product is actually LISTED: its marketplaces and its platforms.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DATABASE ACTUALLY HOLDS - TRACED, NOT ASSUMED
 *
 * `ledsone` has no "marketplace" column on a product and no "platform" column
 * on a product. Neither is a property of `inventory.products` at all. Both are
 * properties of the LISTINGS the business has published for that product's
 * SKU, and both were found by reading the schema rather than by guessing at
 * plausible names:
 *
 *   PLATFORM     listings.<x>_listings.sub_source
 *                  -> order_management.sub_source.id
 *                  -> order_management.sub_source.source_id
 *                  -> order_management.source.source_name
 *
 *                `order_management.source` is ledsone's own list of selling
 *                platforms - AMAZON, EBAY, SHOPIFY, B&Q, ETSY, ONBUY,
 *                WAYFAIR and the rest. Every listing row carries a
 *                `sub_source`, which is the SELLING ACCOUNT ("led_sone",
 *                "amazon Ledsone", "bq_ledsone"), and each account belongs to
 *                exactly one platform. So the platform is read from the
 *                database's own table through the account, NOT inferred from
 *                which of the four listing tables a row happens to sit in -
 *                that would be this file inventing a name ledsone already
 *                stores.
 *
 *   MARKETPLACE  listings.<x>_listings.site
 *
 *                The storefront locale the listing is published to: 'UK',
 *                'Germany', 'US', 'France' and so on. It is the same spelling
 *                across all four listing tables, and the same spelling
 *                `order_management.market_place.name` and
 *                `listings.market_place_id_mapping.site` use, so it is taken
 *                as recorded rather than mapped through anything.
 *
 * No value in either list is written down in this file. The dropdowns are
 * built from whatever `source_name` and `site` actually contain at build
 * time; if the business adds a platform or opens a new marketplace tomorrow,
 * the next build shows it with no change here.
 *
 * ---------------------------------------------------------------------------
 * THE JOIN TO A PRODUCT
 *
 * By SKU, exactly as resources.js and source.js already join listings to
 * products:
 *
 *   amazon, shopify, b&q   coalesce(nullif(mapped_sku, ''), sku)
 *   ebay                   sku          (that table has no mapped_sku column)
 *
 * and `wrong_sku = 0` throughout, which is the flag ledsone sets on a listing
 * whose SKU is known to be mis-mapped. Including those would hang a
 * marketplace on the wrong product, so they are skipped here for the same
 * reason resources.js skips them.
 *
 * ---------------------------------------------------------------------------
 * ONE-TO-MANY, KEPT AS ONE-TO-MANY
 *
 * A product is normally listed several times over - the same SKU on eBay UK,
 * Amazon Germany and a Shopify storefront - so both answers are LISTS, not
 * values. Every marketplace and every platform a product is genuinely listed
 * on is kept, de-duplicated and sorted.
 *
 * A product with no listing at all - 10,634 of them when last measured - gets
 * two EMPTY lists. Nothing is substituted, defaulted or guessed: it matches
 * neither dropdown and shows nothing, which is the honest answer.
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY, like everything else here. Two SELECTs' worth of CTEs in one
 * statement, parameterised, over the schema constants below.
 */

import { LISTINGS_SCHEMA, ORDERS_SCHEMA, rows } from './db.js';

/**
 * The four listing tables, and how each one spells its product SKU.
 *
 * Untrimmed, exactly as resources.js and source.js compare it. Trimming here
 * alone would make this module disagree with them about which product a
 * space-padded listing belongs to.
 */
const LISTING_TABLES = Object.freeze([
  { table: 'amazon_listings', sku: `coalesce(nullif(l.mapped_sku, ''), l.sku)` },
  // ebay_listings has no mapped_sku column.
  { table: 'ebay_listings', sku: 'l.sku' },
  { table: 'shopify_listings', sku: `coalesce(nullif(l.mapped_sku, ''), l.sku)` },
  { table: 'bandq_listings', sku: `coalesce(nullif(l.mapped_sku, ''), l.sku)` },
]);

/** The union of every listing row, as (sku, site, sub_source). */
const EVERY_LISTING = LISTING_TABLES.map(
  ({ table, sku }) =>
    `SELECT ${sku} AS sku, btrim(l.site) AS site, l.sub_source
       FROM ${LISTINGS_SCHEMA}.${table} l
      WHERE coalesce(l.wrong_sku, 0) = 0`,
).join('\n     UNION ALL\n     ');

/**
 * The marketplaces and platforms recorded against each of these SKUs.
 *
 * One round trip for the whole batch, narrowed by SKU first so it is an
 * indexed lookup per listing rather than a scan of half a million rows.
 *
 * A SKU with no listing is simply absent from the map; callers read that as
 * two empty lists.
 *
 * @param {readonly string[]} skus
 * @returns {Promise<Map<string, {marketplaces: string[], platforms: string[]}>>}
 */
export async function facetsForSkus(skus) {
  const wanted = [...new Set((skus ?? []).filter((sku) => typeof sku === 'string' && sku !== ''))];

  /** @type {Map<string, {marketplaces: string[], platforms: string[]}>} */
  const facets = new Map();
  if (wanted.length === 0) return facets;

  const found = await rows(
    `WITH listing AS (
       ${EVERY_LISTING}
     )
     SELECT li.sku,
            array_agg(DISTINCT li.site ORDER BY li.site)
              FILTER (WHERE coalesce(li.site, '') <> '')                    AS marketplaces,
            array_agg(DISTINCT btrim(s.source_name) ORDER BY btrim(s.source_name))
              FILTER (WHERE coalesce(btrim(s.source_name), '') <> '')       AS platforms
     FROM listing li
     LEFT JOIN ${ORDERS_SCHEMA}.sub_source ss ON ss.id = li.sub_source
     LEFT JOIN ${ORDERS_SCHEMA}.source      s ON s.id  = ss.source_id
     WHERE li.sku = ANY($1)
     GROUP BY li.sku`,
    [wanted],
  );

  for (const row of found) {
    facets.set(row.sku, {
      marketplaces: Array.isArray(row.marketplaces) ? row.marketplaces : [],
      platforms: Array.isArray(row.platforms) ? row.platforms : [],
    });
  }

  return facets;
}

/**
 * Attach `marketplaces` and `platforms` to a batch of product rows.
 *
 * The rows are the ones findProductKeywordPage returned; nothing already on
 * them is read or changed. A product ledsone holds no listing for keeps two
 * empty arrays.
 *
 * @template {{sku: string}} T
 * @param {readonly T[]} products
 * @returns {Promise<Array<T & {marketplaces: string[], platforms: string[]}>>}
 */
export async function withListingFacets(products) {
  const list = products ?? [];
  if (list.length === 0) return [];

  const facets = await facetsForSkus(list.map((product) => product.sku));

  return list.map((product) => {
    const found = facets.get(product.sku);
    return {
      ...product,
      marketplaces: found?.marketplaces ?? [],
      platforms: found?.platforms ?? [],
    };
  });
}

export { ORDERS_SCHEMA };
