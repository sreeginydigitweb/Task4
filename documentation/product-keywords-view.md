# Product Keywords - how it works

A read-only HTML view of product and keyword data from the existing **ledsone**
PostgreSQL database. One page, one table, no framework.

## 1. Database

**ledsone**, PostgreSQL. It is an existing business database and the source of
truth; this application reports on it and never writes to it.

No second database is read. Configuration allows one host and one database
name, and the constraint is asserted by a test
(`product-keywords/readonly.test.js`) that fails if any module references
`order_management_copy`, `listing_generator` or `amazon_competitors`.

## 2. Product source

`inventory.products` - 44,599 rows.

## 3. Product fields

| Field on the page | Column |
|---|---|
| Product ID | `inventory.products.id` |
| SKU | `inventory.products.sku` |
| Product Name | `inventory.products.title` |

There is no `product_name` column in ledsone. The heading reads "Product Name"
because that is the requested wording; the value comes from `title`.

## 4. Keyword sources investigated

Six keyword-bearing tables exist in ledsone. Each was examined against the
requirement:

| Table | Rows | Outcome |
|---|---|---|
| `listings.amazon_listing_search_engine_keywords` | 189,983 | **Used.** Keyword text that can be tied to a product. Unclassified. |
| `amazon_campaigns.keywords` | 68,751 | Not used. Has `match_type` (EXACT/PHRASE/BROAD), but an advertising match type is not an approved primary/secondary distinction, and it covers only 10.7% of products. |
| `amazon_campaigns.keyword_performance_data` | 1,004,254 | Not used. Daily PPC performance; no classification. |
| `google_ads.keywords` | 6,005 | Not used. No product or SKU link. |
| `google_search_console.query` | 9,801,949 | Not used. No SKU or product id column. |
| `listings.shopify_listing_tag` | 147,766 | Not used. Tags, not keyword categories. |

## 5. The confirmed relationship

```
inventory.products
    │  products.sku = amazon_listings.mapped_sku      (44,156 rows)
    ▼
listings.amazon_listings
    │  amazon_listings.id = ..._keywords.product_id   (155,374 of 189,983)
    ▼
listings.amazon_listing_search_engine_keywords
```

`amazon_listing_search_engine_keywords.product_id` references the **listing**,
not the product: zero of its 189,983 rows match `inventory.products.id`.
Joining it directly to products on that column name returns nothing, without
an error. The two-step path above is required.

## 6. Keyword limitations

These are limitations of the data, not of the implementation:

- **No confirmed Primary Keyword column.** Nothing in ledsone marks a keyword
  as the primary one.
- **No confirmed Secondary Keyword column.** Nothing marks keywords as
  secondary.
- **No confirmed Long-Tail Keyword column.** Nothing marks keywords as
  long-tail. Word count would be a guess, not a record, so it is not used.
- **No Competitor Keyword source in ledsone at all** - no table, column or
  view. Competitor data exists elsewhere in the estate, in
  `order_management_copy`, which this version does not read.

All four render as `Not recorded`.

The keyword text ledsone *does* hold is shown in a separate, eighth column
headed "Keywords recorded in ledsone (unclassified)". It is real, it belongs to
the product it appears against, and the heading states that it carries no
category - rather than spreading it across the four category columns as though
it had been classified.

Coverage is partial: on a sample page of 50 products, 24 carried keyword text.
The text is multilingual (English, German, French, Italian, Dutch appear in the
sampled rows) and some strings run to several hundred characters. It is shown
as recorded, unedited.

## 7. Request flow

```
browser
  → product-keywords/server.js    node:http, security headers
  → product-keywords/router.js    path and page-number handling
  → product-keywords/source.js    the two SELECTs, and classifyKeywords()
  → product-keywords/db.js        pg Pool, read-only latch
  → ledsone
  → product-keywords/render.js    HTML string building, escaping
  → HTML response
```

## 8. Paging

50 products per page, `?page=N`. The products for a page are selected first and
the keyword lookup runs only for those rows, so the cost is proportional to the
page rather than the catalogue. A page number that is out of range clamps to
the last page; anything that is not a positive whole number falls back to page
1. The limit and offset are query parameters, never interpolated text.

Measured: page 1 in 0.61s, page 500 in 0.44s.

## 9. Where a classification would be added

`classifyKeywords()` in `product-keywords/source.js`. It takes the keyword
strings for one product and returns one value per category; `null` means "the
database does not say". Changing it is the only change needed to switch a
category on - the SQL, the router and the renderer stay as they are.

`product-keywords/source.test.js` asserts that all four categories are
currently `null`, so a derived rule cannot be introduced quietly.
