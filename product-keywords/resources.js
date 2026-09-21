/**
 * THE REAL RESOURCES ledsone HOLDS AGAINST A PRODUCT.
 *
 * provenance.js decides which resource earned a keyword. This file is where
 * the evidence it judges comes from: real rows, read from ledsone, joined to
 * the product by a relationship that was traced rather than assumed.
 *
 * Everything here is SELECT-only.
 *
 * ===========================================================================
 * THE JOIN PATHS - TRACED, NOT ASSUMED
 * ===========================================================================
 *
 * A product is joined to its marketplace listings by SKU, which is the rule
 * the rest of this project already uses for the Category and the Tags:
 *
 *   inventory.products.sku
 *     -> listings.<platform>_listings.sku  (or mapped_sku where one is set)
 *
 * ebay_listings has no mapped_sku column at all, so it joins on sku alone.
 *
 * From there each resource needs a different second hop, and two of them are
 * worth reading carefully because the obvious join is the wrong one:
 *
 *   AMAZON BACKEND KEYWORDS
 *     listings.amazon_listing_search_engine_keywords.product_id is NOT
 *     inventory.products.id. Its values run 451,226 to 1,023,036, while
 *     product ids run 1 to 44,660. It is listings.amazon_listings.id, whose
 *     range (451,226 to 1,022,930) matches. Joining it straight to a product
 *     id would match nothing at all - or, worse, match the wrong product.
 *     Verified on product 1: SKU HLBP128BB -> amazon listing 994083 -> one
 *     keyword row.
 *
 *   GOOGLE SEARCH CONSOLE
 *     GSC records a PAGE URL, not a SKU and not a product id. The link to a
 *     product is that product's own Shopify listing URL:
 *
 *       inventory.products.sku
 *         -> listings.shopify_listings.listing_url
 *         -> google_search_console.query_page.page
 *
 *     The stored listing_url carries a "?variant=..." suffix that the URL in
 *     GSC does not, so the query string is stripped before matching, and both
 *     http and https spellings are tried. Verified on product 1: its
 *     Electricalsone page has 19 real queries recorded against it.
 *
 *   AMAZON SEARCH QUERY PERFORMANCE
 *     joined by ASIN, taken from the product's own Amazon listing row.
 *
 *   AMAZON ADS SEARCH TERMS
 *     amazon_campaigns.search_term_sku_data carries a real sku column, and
 *     reaches the search term through search_term_performance_id.
 *
 * ---------------------------------------------------------------------------
 * ONE RECORD CAN BELONG TO SEVERAL PRODUCTS
 * ---------------------------------------------------------------------------
 *
 * Variants of the same product - a handle in four finishes - are four SKUs
 * sitting behind ONE Shopify parent listing, so they share that listing's id,
 * its tags and its page URL, and therefore its Google queries. Every lookup
 * from a shared key back to a SKU is one-to-MANY for that reason; see link().
 * Treating one as one-to-one gives the shared evidence to a single arbitrary
 * sibling and leaves the rest bare, which is what it did until it was fixed -
 * it cost about a tenth of all the tags on the page, and half the Google ones.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ===========================================================================
 *
 * ledsone's ten Shopify storefront names, the marketplace names and the eight
 * Search Console properties are all real, but a resource only ever reaches the
 * page through a record that CONTAINS THE KEYWORD - see provenance.js. Listing
 * a product on a platform is not evidence about a word, and naming a platform
 * on that basis is the assumption this whole design exists to avoid.
 */

import { INVENTORY_SCHEMA, LISTINGS_SCHEMA, rows } from './db.js';
import { SOURCE } from './provenance.js';

/**
 * The most Google Search Console queries to weigh for one product.
 *
 * A popular page can carry thousands of recorded queries and reading them all
 * would cost more than it proves: the busiest few hundred already contain
 * every phrase a short keyword could match. Taken in impression order, so the
 * set is the same on every page load rather than whatever the planner returned.
 */
const MAX_QUERIES_PER_PAGE = 200;

/** Schemas outside `listings` and `inventory`, kept overridable in one place. */
const CAMPAIGNS_SCHEMA = process.env.DB_AMAZON_CAMPAIGNS_SCHEMA ?? 'amazon_campaigns';
const REPORTS_SCHEMA = process.env.DB_BUSINESS_REPORTS_SCHEMA ?? 'business_reports';
const GSC_SCHEMA = process.env.DB_SEARCH_CONSOLE_SCHEMA ?? 'google_search_console';

/** Strip a query string, so a stored listing URL matches the URL GSC recorded. */
function pageUrl(listingUrl) {
  if (typeof listingUrl !== 'string' || listingUrl.trim() === '') return null;
  const [base] = listingUrl.split('?');
  return base.trim() === '' ? null : base.trim();
}

/** Both spellings of a URL, because GSC records some pages as http. */
function urlSpellings(url) {
  if (url.startsWith('https://')) return [url, `http://${url.slice('https://'.length)}`];
  if (url.startsWith('http://')) return [url, `https://${url.slice('http://'.length)}`];
  return [url];
}

/**
 * Remember that a key belongs to a SKU.
 *
 * These lookups are one-to-MANY, and that is not a detail. Sibling variants of
 * the same product share their parent's Shopify listing and therefore its
 * listing id and its page URL: a wardrobe handle in four finishes is four SKUs
 * behind one page. Keeping only the last SKU seen - which a plain Map.set does
 * - silently handed that parent's tags and every Google query to whichever
 * sibling happened to come back last, and left the others with nothing.
 *
 * @param {Map<string, string[]>} into
 * @param {string} key
 * @param {string} sku
 */
function link(into, key, sku) {
  if (key === null || key === undefined || !sku) return;
  const at = String(key);
  const list = into.get(at);
  if (list) {
    if (!list.includes(sku)) list.push(sku);
  } else {
    into.set(at, [sku]);
  }
}

/** Add one piece of evidence to a SKU's list. */
function record(into, sku, entry) {
  if (!sku || typeof entry.text !== 'string' || entry.text.trim() === '') return;
  const list = into.get(sku);
  if (list) list.push(entry);
  else into.set(sku, [entry]);
}

/**
 * Every real record the resources hold against each of these SKUs.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS IN TWO ROUND TRIPS RATHER THAN NINE
 *
 * Nine lookups feed this, and the database is remote: each one costs about
 * 200ms of latency whatever it returns, so issuing them one after another spent
 * most of a page load waiting rather than working. They are issued in two
 * parallel batches instead, which is the fewest possible - five of them need
 * only the SKUs, and the other four need something the first five found:
 *
 *   batch 1   amazon listings, ebay titles, b&q titles, shopify listings,
 *             amazon ads search terms
 *   batch 2   amazon backend keywords and search-query performance (need the
 *             listing id and the ASIN), shopify tags and Google Search Console
 *             queries (need the listing id and the page URL)
 *
 * The page is narrowed to its 50 rows before this is called, so every statement
 * runs against 50 SKUs rather than the catalogue.
 *
 * A SKU with nothing recorded anywhere is simply absent from the map, and all
 * of its keywords will show no tag.
 *
 * @param {string[]} skus
 * @returns {Promise<Map<string, Array<{source: string, label: string, kind: string, detail: string, text: string}>>>}
 */
export async function evidenceForSkus(skus) {
  const wanted = [...new Set((skus ?? []).filter((sku) => typeof sku === 'string' && sku !== ''))];
  /** @type {Map<string, Array<{source: string, label: string, kind: string, detail: string, text: string}>>} */
  const evidence = new Map();
  if (wanted.length === 0) return evidence;

  // ==========================================================================
  // BATCH 1 - everything that needs only the SKUs.
  // ==========================================================================
  const [amazon, ebay, bandq, shopify, adTerms] = await Promise.all([
    rows(
      `SELECT coalesce(nullif(l.mapped_sku, ''), l.sku) AS sku, l.id, l.asin, l.title
       FROM ${LISTINGS_SCHEMA}.amazon_listings l
       WHERE coalesce(nullif(l.mapped_sku, ''), l.sku) = ANY($1)
         AND coalesce(l.wrong_sku, 0) = 0
       ORDER BY l.id`,
      [wanted],
    ),
    // Many eBay rows carry no title at all; those produce no evidence.
    rows(
      `SELECT DISTINCT ON (l.sku) l.sku, l.title
       FROM ${LISTINGS_SCHEMA}.ebay_listings l
       WHERE l.sku = ANY($1) AND coalesce(l.wrong_sku, 0) = 0
         AND coalesce(l.title, '') <> ''
       ORDER BY l.sku, coalesce(l.is_ended, 0), l.updated_at DESC NULLS LAST, l.id`,
      [wanted],
    ),
    rows(
      `SELECT DISTINCT ON (coalesce(nullif(l.mapped_sku, ''), l.sku))
              coalesce(nullif(l.mapped_sku, ''), l.sku) AS sku, l.title
       FROM ${LISTINGS_SCHEMA}.bandq_listings l
       WHERE coalesce(nullif(l.mapped_sku, ''), l.sku) = ANY($1)
         AND coalesce(l.wrong_sku, 0) = 0 AND coalesce(l.title, '') <> ''
       ORDER BY 1, l.updated_at DESC NULLS LAST, l.id`,
      [wanted],
    ),
    // A SKU sits on a CHILD listing, and the useful title, the tags and the
    // page URL all belong to its PARENT - a child's own title is usually the
    // variant name ("Default Title"). So the parent is followed, exactly as
    // the Tags column already does.
    //
    // BOTH URLs are kept, because they are not the same page and only one of
    // them is the one Google recorded: a parent's listing_url has the Shopify
    // product id appended to the slug, while the child's is the plain product
    // URL with a "?variant=" suffix that is stripped below. Preferring the
    // parent silently lost every Search Console match.
    rows(
      `WITH child AS (
         SELECT coalesce(nullif(l.mapped_sku, ''), l.sku) AS sku, l.id, l.channel, l.title, l.listing_url
         FROM ${LISTINGS_SCHEMA}.shopify_listings l
         WHERE coalesce(nullif(l.mapped_sku, ''), l.sku) = ANY($1)
           AND coalesce(l.wrong_sku, 0) = 0
       )
       SELECT c.sku, c.id, coalesce(p.channel, c.channel) AS channel,
              coalesce(nullif(p.title, ''), c.title) AS title,
              c.listing_url AS child_url,
              p.listing_url AS parent_url,
              coalesce(p.id, c.id) AS owner_id
       FROM child c
       LEFT JOIN ${LISTINGS_SCHEMA}.shopify_listings_parent_child_mapping m ON m.child_id = c.id
       LEFT JOIN ${LISTINGS_SCHEMA}.shopify_listings p ON p.id = m.parent_id
       ORDER BY c.sku, c.id`,
      [wanted],
    ),
    // Search terms this SKU's Amazon advertising actually matched.
    rows(
      `SELECT DISTINCT d.sku, t.search_term
       FROM ${CAMPAIGNS_SCHEMA}.search_term_sku_data d
       JOIN ${CAMPAIGNS_SCHEMA}.search_term_performance_data t
         ON t.id = d.search_term_performance_id
       WHERE d.sku = ANY($1) AND coalesce(t.search_term, '') <> ''
       ORDER BY d.sku, t.search_term`,
      [wanted],
    ),
  ]);

  // --------------------------------------------------------------------------
  // What batch 1 found, and the keys batch 2 needs.
  // --------------------------------------------------------------------------
  const skuForListing = new Map();
  const skuForAsin = new Map();

  for (const row of amazon) {
    link(skuForListing, row.id, row.sku);
    if (row.asin) link(skuForAsin, row.asin, row.sku);

    record(evidence, row.sku, {
      source: SOURCE.AMAZON,
      label: 'Amazon',
      kind: 'listing-title',
      detail: "In this product's Amazon listing title (listings.amazon_listings.title)",
      text: row.title,
    });
  }

  for (const row of ebay) {
    record(evidence, row.sku, {
      source: SOURCE.EBAY,
      label: 'eBay',
      kind: 'listing-title',
      detail: "In this product's eBay listing title (listings.ebay_listings.title)",
      text: row.title,
    });
  }

  for (const row of bandq) {
    record(evidence, row.sku, {
      source: SOURCE.BANDQ,
      label: 'B&Q',
      kind: 'listing-title',
      detail: "In this product's B&Q listing title (listings.bandq_listings.title)",
      text: row.title,
    });
  }

  for (const row of adTerms) {
    record(evidence, row.sku, {
      source: SOURCE.AMAZON,
      label: 'Amazon',
      kind: 'search-query',
      detail:
        "A search term this product's Amazon advertising matched " +
        '(amazon_campaigns.search_term_performance_data.search_term)',
      text: row.search_term,
    });
  }

  // ledsone runs several Shopify storefronts, so the pill names the one the
  // record belongs to ("Electricalsone", "Vintagelite") - the real business the
  // reader would visit, not the platform it runs on.
  const skuForOwner = new Map();
  const skuForPage = new Map();
  const labelForSku = new Map();

  for (const row of shopify) {
    const label = typeof row.channel === 'string' && row.channel.trim() !== '' ? row.channel.trim() : 'Shopify';
    labelForSku.set(row.sku, label);
    link(skuForOwner, row.owner_id, row.sku);

    // "Default Title" is Shopify's placeholder for a single-variant product,
    // not a real title, and it would prove nothing.
    if (typeof row.title === 'string' && row.title.trim() !== '' && row.title.trim() !== 'Default Title') {
      record(evidence, row.sku, {
        source: SOURCE.SHOPIFY,
        label,
        kind: 'listing-title',
        detail: `In this product's ${label} listing title (listings.shopify_listings.title)`,
        text: row.title,
      });
    }

    for (const candidate of [row.child_url, row.parent_url]) {
      const page = pageUrl(candidate);
      if (page) for (const spelling of urlSpellings(page)) link(skuForPage, spelling, row.sku);
    }
  }

  // ==========================================================================
  // BATCH 2 - everything keyed off what batch 1 found.
  // ==========================================================================
  const listingIds = [...skuForListing.keys()].map(Number);
  const asins = [...skuForAsin.keys()];
  const ownerIds = [...skuForOwner.keys()].map(Number);
  const pages = [...skuForPage.keys()];

  const [backend, asinQueries, tags, gscQueries] = await Promise.all([
    // The seller's own backend search terms. A record whose entire purpose is
    // to hold keywords, so it outranks everything else.
    listingIds.length === 0
      ? []
      : rows(
          `SELECT k.product_id, k.keyword
           FROM ${LISTINGS_SCHEMA}.amazon_listing_search_engine_keywords k
           WHERE k.product_id = ANY($1)
           ORDER BY k.product_id, k.view_order NULLS LAST, k.id`,
          [listingIds],
        ),
    // Real queries shoppers typed on Amazon, recorded against this ASIN.
    asins.length === 0
      ? []
      : rows(
          `SELECT asin, search_query
           FROM ${REPORTS_SCHEMA}.amz_search_query_performance
           WHERE asin = ANY($1) AND coalesce(search_query, '') <> ''
           GROUP BY asin, search_query
           ORDER BY asin, max(coalesce(search_query_volume, 0)) DESC, search_query`,
          [asins],
        ),
    // The storefront's own filed tags - keyword-like labels, so they outrank
    // any listing title.
    ownerIds.length === 0
      ? []
      : rows(
          `SELECT t.product_id, btrim(t.tag) AS tag
           FROM ${LISTINGS_SCHEMA}.shopify_listing_tag t
           WHERE t.product_id = ANY($1) AND t.is_deleted = 0 AND btrim(coalesce(t.tag, '')) <> ''
           ORDER BY t.product_id, btrim(t.tag)`,
          [ownerIds],
        ),
    // The real queries that put this product's page in front of a searcher.
    //
    // The per-page cap is applied HERE rather than after the rows arrive. A
    // plain "ORDER BY sum(impressions) LIMIT n" has to sort every matching
    // group before it can discard any, which measured at 1,500ms and shipped
    // 7,036 rows; ranking within each page and keeping the top few is the same
    // set of rows for the same reason, at 350ms and 2,994 rows.
    pages.length === 0
      ? []
      : rows(
          `SELECT page, query
           FROM (
             SELECT page, query,
                    row_number() OVER (
                      PARTITION BY page
                      ORDER BY sum(coalesce(impressions, 0)) DESC, query
                    ) AS rank
             FROM ${GSC_SCHEMA}.query_page
             WHERE page = ANY($1) AND coalesce(query, '') <> ''
             GROUP BY page, query
           ) ranked
           WHERE rank <= $2
           ORDER BY page, rank`,
          [pages, MAX_QUERIES_PER_PAGE],
        ),
  ]);

  for (const row of backend) {
    for (const sku of skuForListing.get(String(row.product_id)) ?? []) record(evidence, sku, {
      source: SOURCE.AMAZON,
      label: 'Amazon',
      kind: 'search-keywords',
      detail:
        "Recorded in this product's Amazon backend search keywords " +
        '(listings.amazon_listing_search_engine_keywords.keyword)',
      text: row.keyword,
    });
  }

  for (const row of asinQueries) {
    for (const sku of skuForAsin.get(row.asin) ?? []) record(evidence, sku, {
      source: SOURCE.AMAZON,
      label: 'Amazon',
      kind: 'search-query',
      detail:
        'A shopper search query recorded against this ASIN on Amazon ' +
        '(business_reports.amz_search_query_performance.search_query)',
      text: row.search_query,
    });
  }

  for (const row of tags) {
    for (const sku of skuForOwner.get(String(row.product_id)) ?? []) {
      const label = labelForSku.get(sku) ?? 'Shopify';

      record(evidence, sku, {
        source: SOURCE.SHOPIFY,
        label,
        kind: 'tag',
        detail: `Filed as a tag on this product's ${label} listing (listings.shopify_listing_tag.tag)`,
        text: row.tag,
      });
    }
  }

  // Already capped and ordered by the query above, busiest first. A page is
  // shared by every variant behind it, so each of them gets the query.
  for (const row of gscQueries) {
    for (const sku of skuForPage.get(row.page) ?? []) record(evidence, sku, {
      source: SOURCE.SEARCH_CONSOLE,
      label: 'Google Search Console',
      kind: 'search-query',
      detail:
        "A real Google search query recorded against this product's page " +
        '(google_search_console.query_page.query)',
      text: row.query,
    });
  }

  return evidence;
}

/**
 * The same evidence, for one page of products.
 *
 * @param {Array<{sku: string}>} products
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function evidenceForProducts(products) {
  return evidenceForSkus((products ?? []).map((product) => product?.sku));
}

/** Exported for the reports; the page itself never needs it. */
export { INVENTORY_SCHEMA };
