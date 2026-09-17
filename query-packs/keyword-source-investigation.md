# Query pack - keyword source investigation

The read-only queries used to establish what `ledsone` does and does not hold
about keywords. All are SELECTs; run them against `ledsone` to reproduce the
findings in `data-maps/product-keywords-data-map.md`.

Figures were measured on 17 September 2026. Re-derive rather than quoting them
from here - the database is live.

## 1. Which schemas exist

```sql
SELECT string_agg(DISTINCT table_schema, ', ' ORDER BY table_schema)
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema');
```

Returned 18 schemas: accounting, amazon_campaigns, amazon_fba,
business_reports, configurator, customer_service, customers, ebay_campaigns,
employee_management, google_ads, google_analytics, google_search_console,
inventory, listings, order_management, public, staff, suppliers.

## 2. Is there a keyword classification column anywhere?

The question the whole task turns on.

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND (column_name ILIKE '%primary%'    OR column_name ILIKE '%secondary%'
    OR column_name ILIKE '%long_tail%'  OR column_name ILIKE '%longtail%'
    OR column_name ILIKE '%competitor%' OR column_name ILIKE '%seed%'
    OR column_name ILIKE '%suggestion%' OR column_name ILIKE '%phrase%')
ORDER BY table_schema, table_name, column_name;
```

**Two rows, both unrelated:** `google_ads.campaigns.campaign_primary_status`
and `order_management.local_postage_rates.secondary_currency`.

This is the evidence for "no confirmed Primary/Secondary/Long-Tail/Competitor
column in ledsone".

## 3. Which tables hold keywords at all

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name ILIKE '%keyword%'
ORDER BY table_schema, table_name;
```

Five: `amazon_campaigns.keyword_performance_data` (1,004,254 rows),
`amazon_campaigns.keywords` (68,751), `google_ads.keyword_performance` (578),
`google_ads.keywords` (6,005),
`listings.amazon_listing_search_engine_keywords` (189,983).

## 4. Does the keyword table join to products, or to listings?

The trap. `amazon_listing_search_engine_keywords` has a column called
`product_id`; this establishes what it actually references.

```sql
SELECT
 (SELECT count(*) FROM listings.amazon_listing_search_engine_keywords) AS kw_rows,
 (SELECT count(*) FROM listings.amazon_listing_search_engine_keywords k
    WHERE EXISTS (SELECT 1 FROM inventory.products p WHERE p.id = k.product_id))
      AS matching_inventory_products,
 (SELECT count(*) FROM listings.amazon_listing_search_engine_keywords k
    WHERE EXISTS (SELECT 1 FROM listings.amazon_listings a WHERE a.id = k.product_id))
      AS matching_amazon_listings;
```

`kw_rows` 189,983 · `matching_inventory_products` **0** ·
`matching_amazon_listings` 155,374.

## 5. Which SKU column to join on

```sql
SELECT
 (SELECT count(*) FROM listings.amazon_listings a
    JOIN inventory.products p ON p.sku = a.sku)         AS join_on_sku,
 (SELECT count(*) FROM listings.amazon_listings a
    JOIN inventory.products p ON p.sku = a.mapped_sku)  AS join_on_mapped_sku;
```

`sku` 61,208 · `mapped_sku` 44,156. `mapped_sku` is the tighter join and is
what the application uses.

## 6. Is `view_order` a keyword type?

Checked because a "view order" column could conceivably rank keywords.

```sql
SELECT view_order, count(*)
FROM listings.amazon_listing_search_engine_keywords
GROUP BY view_order ORDER BY view_order;
```

Values run 1 to 20+ (68,706 rows at 1, 11,786 at 2, tailing off). It is a
display sequence, not a classification.

## 7. PPC match types, and how far they reach

Checked as a possible Primary/Secondary source, then ruled out - an
advertising match type is not an approved keyword classification.

```sql
SELECT match_type, count(*) AS kws FROM amazon_campaigns.keywords
GROUP BY match_type ORDER BY kws DESC;
```

BROAD 23,727 · EXACT 7,518 · PHRASE 6,085.

Coverage against the catalogue:

```sql
SELECT count(DISTINCT a.listing_sku) AS distinct_skus,
       count(DISTINCT CASE WHEN EXISTS (
         SELECT 1 FROM inventory.products p WHERE p.sku = a.listing_sku
       ) THEN a.listing_sku END) AS skus_in_inventory_products
FROM amazon_campaigns.keywords k
JOIN amazon_campaigns.ads a ON a.ad_group_id = k.ad_group_id;
```

16,440 distinct SKUs, of which **4,752 exist in `inventory.products`** - 10.7%
of the 44,599-product catalogue. Note the join fans out (many ads per ad
group), so `DISTINCT` is required.

## 8. Index check, before settling on the paged query shape

```sql
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE (schemaname = 'listings'  AND tablename IN ('amazon_listings',
                                                  'amazon_listing_search_engine_keywords'))
   OR (schemaname = 'inventory' AND tablename = 'products')
ORDER BY tablename, indexname;
```

Confirmed `amazon_listings(mapped_sku)`,
`amazon_listing_search_engine_keywords(product_id)` and `products(id)` are all
indexed - which is what makes the per-page LATERAL lookup cheap.

## 9. Confirming the second database is a different database

```sql
SELECT current_database(),
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'listing_generator') AS lg_tables;
```

Against ledsone: `listing_generator` table count **0**. The classified keyword
and competitor tables are in `order_management_copy`, which this project does
not read.
