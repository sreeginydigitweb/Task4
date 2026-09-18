# Data map - Product Keywords

Every column on `/product-keywords`, and where its value comes from.

Database: **ledsone** (PostgreSQL). No other database is read.

## The table

| # | HTML column | Database | Schema.table | Column | Status |
|---|---|---|---|---|---|
| 1 | Product Image | ledsone | `inventory.product_media`, then `inventory.product_images` | `image_url` | Confirmed; main image preferred, first gallery image as fallback, blank if neither |
| 2 | SKU | ledsone | `inventory.products` | `sku` | Confirmed |
| 3 | Product ID | ledsone | `inventory.products` | `id` | Confirmed |
| 4 | Product Name | ledsone | `inventory.products` | `title` | Confirmed |
| 5 | Category | ledsone | `listings.shopify_listings` then `inventory.products` | `product_type`, else `title` | Confirmed where recorded; otherwise the product type the name states; blank if neither |
| 6 | Primary Keyword | ledsone | `inventory.products` | `title` | Deterministic fallback; recorded category wins if available |
| 7 | Secondary Keywords | ledsone | `inventory.products` | `title` | Deterministic fallback; blank if no meaningful term |
| 8 | Long-Tail Keywords | ledsone | `inventory.products` | `title` | Deterministic fallback; blank if no meaningful term |
| 9 | Competitor Keywords | ledsone | `inventory.products` | `title` | Generic alternative terminology only; never a competitor brand |

## Column 1 - the product image relationship

```
inventory.products
    │  products.id = product_media.product_id      (type = 'main-image')
    ├──────────────────────────────────────────────►  inventory.product_media
    │                                                 43,350 rows
    │  products.id = product_images.product_id
    └──────────────────────────────────────────────►  inventory.product_images
                                                      36,748 rows, ordered by
                                                      image_ordering
```

Both are LEFT joins, one row per product (`DISTINCT ON (product_id)`), so no
product is duplicated and none is dropped. `coalesce(main_media.image_url,
first_image.image_url)` picks the designated main image, then the first gallery
image. Neither table declares a foreign key, but `product_id` is
`inventory.products.id` - the relationship the Smart Inventory Control
application already relies on against this database, whose two image CTEs are
reused here unchanged.

7,341 of 44,636 products (16.4%) have no image in either table. Those cells are
empty HTML cells. No placeholder image and no stand-in URL is ever emitted, and
a stored value that is not an `http`/`https` address is treated as no image.

The `listings`, `google_ads` and `suppliers` image tables also exist in ledsone
and are deliberately **not** read - they belong to other applications. A test
fails the build if one is referenced.

## Column 5 - the category relationship

```
inventory.products
    │  products.sku = coalesce(nullif(shopify_listings.mapped_sku,''),
    │                          shopify_listings.sku)
    └──────────────────────────────────────►  listings.shopify_listings
                                              .product_type
                                              one listing per SKU, the most
                                              recently updated
```

A LEFT join, one row per SKU (`DISTINCT ON`), so no product is duplicated and
none is dropped. Where `product_type` is absent, the category is the product
type the Product Name itself states, taken from the same terminology map that
produces the Primary Keyword - not a second vocabulary written for categories.

| | Products | Share |
|---|---|---|
| Recorded in ledsone | 19,343 | 43.3% |
| Derived from the Product Name | 1,899 | 4.3% |
| **With a category** | **21,242** | **47.6%** |
| No category - blank cell | 23,394 | 52.4% |

488 distinct categories. Recorded values are shown exactly as stored, including
near-duplicates and other languages; merging or translating them would be
editing the business's data on a guess.

Other category sources in ledsone, and why they are not used:
`staff.ph_categories` (77 curated names) reaches only 4,457 products (10.0%),
and only through a three-hop ASIN join; `listings.bandq_categories`,
`listings.shopify_collections`, `listings.amazon_listings.product_type` and
`google_ads.merchant_products` belong to other applications or cover less. A
test fails the build if any is referenced.

No category is written back and no category table is created.

## Columns 6-9 - the keyword categories

No confirmed classified keyword source currently exists in ledsone. The
fallback uses only Product Name. It never maps unclassified keyword text or
advertising match types into these fields. Missing values render as actual
blank HTML cells, `<td></td>`.

Columns 6-9 resolve in one fixed order: a recorded ledsone value if there is
one, otherwise generation from `title`, otherwise blank. A recorded value is
never overwritten, and a recorded value that is empty or whitespace counts as
missing rather than as data.

Generation reads two things out of `title` and nothing else - the product TYPE
(generic terminology such as "wall light switches" -> Light Switch) and
ATTRIBUTE words the name already contains (style, colour, material,
configuration, lamp fitting, form). Column 7 carries synonyms plus supported
attributes, column 8 a more specific multi-word phrase, column 9 alternative
wording for the same product type. Nothing is keyed on `id` or `sku`.

These generated values exist in the HTML response only. No row is written,
updated or cached in ledsone or anywhere else; the connection stays read-only.

## Column 3 - a naming note

The product name is `inventory.products.title`. There is no `product_name`
column. The HTML heading says "Product Name" because that is what was asked
for; the source column is `title`.

## Keyword-text investigation (not displayed)

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
| `listings.amazon_listing_search_engine_keywords` | 189,983 | Keyword text only. No category column; `view_order` is a display sequence (values 1-20+), not a keyword type. |
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

`classifyKeywords()` in `product-keywords/source.js`. It returns one value per
category; `null` means "the database does not say" and renders as an empty HTML
cell. Today it returns `null`
for all four. Neither the SQL, the router nor the renderer needs to change to
switch a category on.
