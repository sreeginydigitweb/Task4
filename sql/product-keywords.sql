-- Task 4 - Product Keywords. The SQL this application actually runs.
--
-- Database: ledsone (PostgreSQL). Nothing here writes: every statement is a
-- SELECT, and the connection they run on sets
-- default_transaction_read_only = on, so the server refuses a write on it
-- regardless of what is asked.
--
-- Kept here so the queries can be read, run and changed outside the
-- JavaScript. The application builds the same statements in
-- product-keywords/source.js; the schema names there come from configuration
-- (defaults: inventory, listings) rather than being hard-coded as they are
-- below.


-- ---------------------------------------------------------------------------
-- 1. How many products the catalogue holds.
--
-- Used for the page count and the row-count line. Kept as its own statement so
-- the page query never has to count what it is not showing.
-- ---------------------------------------------------------------------------

SELECT count(*)::int AS total
FROM inventory.products;


-- ---------------------------------------------------------------------------
-- 2. One page of products, with the keyword text recorded against each.
--
-- $1 = LIMIT  (rows per page, 50)
-- $2 = OFFSET ((page - 1) * 50)
--
-- Both are parameters, never interpolated text.
--
-- WHY IT IS SHAPED THIS WAY
--
-- The products for the page are chosen FIRST, in the `page` CTE, and the
-- keyword lookup is a LATERAL join that runs only for those fifty rows. The
-- work is therefore proportional to the page, not to the 44,599-row
-- catalogue, and both sides of the lookup are index-served:
--
--   listings_amazon_listings_mapped_sku_idx        on amazon_listings(mapped_sku)
--   listings_amz_search_kw_product_id_idx          on ..._keywords(product_id)
--
-- Joining everything and paging the result instead would read the whole
-- catalogue to show fifty rows of it.
--
-- THE RELATIONSHIP, AND THE TRAP IN IT
--
-- Keyword text does not hang off the product directly. It reaches it through
-- the Amazon listing:
--
--   inventory.products.sku
--     = listings.amazon_listings.mapped_sku
--   listings.amazon_listings.id
--     = listings.amazon_listing_search_engine_keywords.product_id
--
-- The middle step is NOT optional. `amazon_listing_search_engine_keywords`
-- has a column named `product_id`, but it references the LISTING, not
-- inventory.products. Of its 189,983 rows, 155,374 match
-- listings.amazon_listings.id and ZERO match inventory.products.id. Joining it
-- straight to products on that name returns an empty result, silently.
--
-- DISTINCT ON collapses the duplicates that arise when one SKU has several
-- Amazon listings (multiple marketplaces, parent and child rows), which would
-- otherwise repeat the same keyword string several times for one product.
-- The product stays one row: keyword text is aggregated into an array rather
-- than multiplying the product row.
-- ---------------------------------------------------------------------------

WITH page AS (
  SELECT id, sku, title
  FROM inventory.products
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
    FROM listings.amazon_listings a
    JOIN listings.amazon_listing_search_engine_keywords kw
      ON kw.product_id = a.id
    WHERE a.mapped_sku = p.sku
    ORDER BY kw.keyword, kw.view_order
  ) d
) k ON true
ORDER BY p.id;


-- ---------------------------------------------------------------------------
-- 3. The startup check.
--
-- $1 = schema name ('inventory')
-- $2 = table name  ('inventory.products')
--
-- Asks the server three questions: which database this is, whether the
-- connection is in read-only transaction mode, and whether this role could
-- write to the source if it tried. The application refuses to start if the
-- database is wrong, the connection is not read-only, or the role turns out
-- to hold INSERT, UPDATE or DELETE.
-- ---------------------------------------------------------------------------

SELECT current_database()                        AS database,
       current_user                              AS "user",
       current_setting('transaction_read_only')  AS read_only,
       (SELECT count(*)::int FROM information_schema.tables
         WHERE table_schema = $1)                AS tables,
       (has_table_privilege($2, 'INSERT')
        OR has_table_privilege($2, 'UPDATE')
        OR has_table_privilege($2, 'DELETE'))    AS can_write;


-- ---------------------------------------------------------------------------
-- NOT PRESENT, AND WHY
--
-- There is no query here for Primary Keyword, Secondary Keywords, Long-Tail
-- Keywords or Competitor Keywords. That is not an omission - ledsone holds no
-- column, table or view that records any of those four classifications. A
-- column-name sweep across all eighteen schemas for %primary%, %secondary%,
-- %long_tail%, %longtail%, %competitor%, %seed% and %phrase% returned two
-- rows, both unrelated (google_ads.campaigns.campaign_primary_status and
-- order_management.local_postage_rates.secondary_currency).
--
-- Writing SQL that derived them - EXACT match type as "primary", word count as
-- "long-tail" - would put a business rule nobody has agreed into the database
-- layer. When the rules are agreed they belong in classifyKeywords() in
-- product-keywords/source.js, and any SQL they need can be added here then.
-- ---------------------------------------------------------------------------
