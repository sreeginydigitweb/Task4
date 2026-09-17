# Data map - Product Keywords

Every column on `/product-keywords`, and where its value comes from.

Database: **ledsone** (PostgreSQL). No other database is read.

## The table

| # | HTML column | Database | Schema.table | Column | Status |
|---|---|---|---|---|---|
| 1 | SKU | ledsone | `inventory.products` | `sku` | Confirmed |
| 2 | Product ID | ledsone | `inventory.products` | `id` | Confirmed |
| 3 | Product Name | ledsone | `inventory.products` | `title` | Confirmed |
| 4 | Primary Keyword | — | — | — | **No source in ledsone** |
| 5 | Secondary Keywords | — | — | — | **No source in ledsone** |
| 6 | Long-Tail Keywords | — | — | — | **No source in ledsone** |
| 7 | Competitor Keywords | — | — | — | **No source in ledsone** |
| 8 | Keywords recorded in ledsone (unclassified) | ledsone | `listings.amazon_listing_search_engine_keywords` | `keyword` | Confirmed, unclassified |

Columns 4-7 render as `Not recorded`. Column 8 is not one of the seven
requested columns; it was added so the keyword text ledsone *does* hold is
visible without being filed under a category the database does not assign.

## Column 3 - a naming note

The product name is `inventory.products.title`. There is no `product_name`
column. The HTML heading says "Product Name" because that is what was asked
for; the source column is `title`.

## Column 8 - the relationship

Keyword text does not hang off the product. It reaches it through the Amazon
listing:

```
inventory.products.sku
    = listings.amazon_listings.mapped_sku
listings.amazon_listings.id
    = listings.amazon_listing_search_engine_keywords.product_id
```

**The middle step is not optional.**
`listings.amazon_listing_search_engine_keywords` has a column called
`product_id`, but it references the **listing**, not the product.

Measured on the live database:

| Check | Result |
|---|---|
| Rows in `amazon_listing_search_engine_keywords` | 189,983 |
| …whose `product_id` matches `listings.amazon_listings.id` | 155,374 (82%) |
| …whose `product_id` matches `inventory.products.id` | **0** |
| `products.sku = amazon_listings.mapped_sku` | 44,156 rows |
| `products.sku = amazon_listings.sku` | 61,208 rows |

`mapped_sku` is used rather than `sku`. Both join, but `sku` produces more
rows for the same products, so `mapped_sku` is the tighter of the two.

One SKU can have several Amazon listings (different marketplaces, parent and
child rows), so the same keyword string can arrive more than once. `DISTINCT
ON (keyword)` collapses those before aggregation. Keyword coverage is partial:
on a sample page of 50 products, 24 carried keyword text.

## Columns 4-7 - what was checked before concluding "no source"

A column-name sweep across all eighteen ledsone schemas for `%primary%`,
`%secondary%`, `%long_tail%`, `%longtail%`, `%competitor%`, `%seed%`,
`%suggestion%` and `%phrase%` returned exactly two rows, both unrelated:

- `google_ads.campaigns.campaign_primary_status`
- `order_management.local_postage_rates.secondary_currency`

Keyword-bearing tables that DO exist in ledsone, and why none of them supplies
a classification:

| Table | Rows | Why not used for columns 4-7 |
|---|---|---|
| `listings.amazon_listing_search_engine_keywords` | 189,983 | Keyword text only. No category column; `view_order` is a display sequence (values 1-20+), not a keyword type. **Used for column 8.** |
| `amazon_campaigns.keywords` | 68,751 | Has `match_type` (BROAD 23,727 / EXACT 7,518 / PHRASE 6,085). An advertising match type is not a primary/secondary distinction, and calling it one has not been approved. Reaches SKU only via `ad_group_id → ads.listing_sku`, covering 4,752 of 44,599 products (10.7%). |
| `amazon_campaigns.keyword_performance_data` | 1,004,254 | Daily PPC performance per keyword. No classification. |
| `google_ads.keywords` | 6,005 | Ad-group scoped. No product or SKU link. |
| `google_search_console.query` | 9,801,949 | Search queries. Keyed on query and page URL; no SKU or product id column. |
| `listings.shopify_listing_tag` | 147,766 | Shopify tags, not keyword categories. |

**Competitor keywords have no source in ledsone of any kind** - no table,
column or view. Competitor data exists in the estate, in
`order_management_copy.listing_generator.amazon_competitors`, which is a
different database on a different host and is deliberately out of scope for
this version.

## Where a classification would be added

`classifyKeywords()` in `product-keywords/source.js`. It receives the keyword
strings for one product and returns one value per category; `null` means "the
database does not say" and renders as `Not recorded`. Today it returns `null`
for all four. Neither the SQL, the router nor the renderer needs to change to
switch a category on.
