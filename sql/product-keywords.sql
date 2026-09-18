-- Task 4 - Product Keywords. The read-only SQL the application runs.
--
-- Database: ledsone (PostgreSQL). Every statement is SELECT-only and the
-- connection sets default_transaction_read_only = on.

-- 1. Catalogue total, used for pagination.
SELECT count(*)::int AS total
FROM inventory.products;

-- 2. One page of confirmed product data for the seven-column view.
-- $1 = LIMIT; $2 = OFFSET. Both values are parameters, never interpolated.
--
-- The four keyword categories have no confirmed classified source in ledsone.
-- They are resolved in application code: a confirmed category would win;
-- otherwise product-keywords/keyword-generator.js derives deterministic
-- Primary, Secondary, Long-Tail and Competitor search terms from
-- inventory.products.title only, and leaves a category blank when the name
-- supports nothing meaningful.
--
-- Those generated values are never written back. There is no INSERT, UPDATE or
-- upsert anywhere in this project: the keywords exist for the duration of one
-- HTML response and are recomputed on the next request.
-- The product image is the one joined value. Two tables in the inventory
-- schema hold images, both keyed on product_id = inventory.products.id:
--   inventory.product_media   type = 'main-image' marks the designated one
--   inventory.product_images  a gallery, ordered by image_ordering
-- The designated main image wins, the first gallery image is the fallback.
-- This is the rule the Smart Inventory Control application already uses
-- against the same database; these CTEs are reused from it unchanged.
-- Both joins are LEFT joins: a product with no image is still listed, with a
-- null image_url, and the view leaves the cell blank.
WITH page AS (
  SELECT id, sku, title
  FROM inventory.products
  ORDER BY id
  LIMIT $1 OFFSET $2
),
main_media AS (
  SELECT DISTINCT ON (m.product_id) m.product_id, m.image_url
  FROM inventory.product_media m
  WHERE m.type = 'main-image' AND coalesce(m.image_url, '') <> ''
  ORDER BY m.product_id, m.id
),
first_image AS (
  SELECT DISTINCT ON (i.product_id) i.product_id, i.image_url
  FROM inventory.product_images i
  WHERE coalesce(i.image_url, '') <> ''
  ORDER BY i.product_id, i.image_ordering NULLS LAST, i.id
)
SELECT p.id, p.sku, p.title,
       coalesce(mm.image_url, fi.image_url) AS image_url
FROM page p
LEFT JOIN main_media  mm ON mm.product_id = p.id
LEFT JOIN first_image fi ON fi.product_id = p.id
ORDER BY p.id;

-- 3. Startup protection: confirm the database, read-only transaction, and
-- absence of write privileges on the product source.
-- $1 = schema name ('inventory'); $2 = table name ('inventory.products').
SELECT current_database()                        AS database,
       current_user                              AS "user",
       current_setting('transaction_read_only')  AS read_only,
       (SELECT count(*)::int FROM information_schema.tables
         WHERE table_schema = $1)                AS tables,
       (has_table_privilege($2, 'INSERT')
        OR has_table_privilege($2, 'UPDATE')
        OR has_table_privilege($2, 'DELETE'))    AS can_write;

-- Unclassified keyword text and advertising match types are not mapped into a
-- category. No competitor database, brand, API, or website is queried.
