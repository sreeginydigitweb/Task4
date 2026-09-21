# Task 4 - Product Keywords

A read-only HTML view of product and keyword data from the existing **ledsone**
PostgreSQL database.

One page, one table, no framework. Node 20 with a single dependency (`pg`).

The page itself is a plain, complete HTML file: **`product-keywords/page.html`**.
It holds the doctype, head, title, all of the CSS, the heading, both paging
control bars (product count at the left, Previous / page / Next at the right),
the category filter, and the full ten-column table structure including every
header. Open it and you can see the whole screen
without reading any JavaScript, and it can be shared on its own as the UI
reference. The application only fills in values - the product rows and the
paging state - read live from the database. Edit that file to change how the
page looks.

```
ledsone DB  ->  SQL query  ->  Node application  ->  HTML table
```

## Purpose

Show the product catalogue alongside the keyword data recorded against each
product, in the table structure requested:

Product Image · SKU · Product ID · Product Name · Category ·
Primary Keyword · Secondary Keywords · Long-Tail Keywords · Competitor Keywords

Five of those nine columns are backed by ledsone. The four keyword columns are
not: they are generated from the Product Name, and a cell stays genuinely blank
rather than being filled with an invented value when the name supports nothing
meaningful. See **Current data limitations** and **Keyword generation** below -
together they are the most important part of this file.

There is deliberately no source/provenance column. A keyword's RESOURCE pill
sits underneath the keyword itself, inside its own cell.

### The keyword resource pill

There is one kind of tag on this page, and it lives **inside a keyword cell**,
directly below the keyword it belongs to. It is never a column of its own.

| | **Keyword resource pill** |
|---|---|
| What | The REAL DATA RESOURCE that supplied the keyword: `Amazon`, `eBay`, `Google Search Console`, `Vintagelite`, `Electricalsone`, `B&Q` |
| Where | underneath each keyword, in all four keyword columns |
| Never | `GEN`, `Generated`, `Terminology`, `Product Name`, `Product Type` - a method is not a resource |
| Look | solid amber / red / green / blue, white label - one colour per resource |
| Source | a real record that resource holds against this product and that CONTAINS the keyword - see **Keyword resource tags** |

A keyword nothing proves keeps its wording and wears no pill at all.

## Scope: ledsone only

This application reads `ledsone` and nothing else.

Classified keyword and competitor tables do exist elsewhere in the estate, in
`order_management_copy.listing_generator`. That is a different database on a
different host, and this version deliberately does not read it. There is no
configuration that could reach it, and a test
(`product-keywords/readonly.test.js`) fails the build if any module so much as
references it.

## Read-only

The source database is never written to. Three independent things ensure that:

1. Every statement in the codebase is a `SELECT`. There is no INSERT, UPDATE,
   DELETE, CREATE, ALTER, DROP or TRUNCATE anywhere in it - asserted by a test
   that scans every module with comments stripped.
2. The connection pool sets `default_transaction_read_only = on` as a startup
   option, so the **server** refuses a write on this connection whatever the
   application asks for.
3. The database role should hold SELECT and nothing else. The application
   checks this at startup with `has_table_privilege()` and **refuses to start**
   if the role can write to `inventory.products`.

No tables were created or altered, and no data was inserted, updated or deleted
at any point - including during development.

## Running it locally

Requires Node 20 or later.

```bash
npm install

cp product-keywords/.env.example product-keywords/.env
# then fill in DB_HOST, DB_USER and DB_PASSWORD

npm start
```

Open <http://localhost:3100/product-keywords>.

`product-keywords/.env` holds real credentials and is gitignored.
`product-keywords/.env.example` is the committed template and contains none.
Every setting is documented in it.

```bash
npm test     # 247 tests, no database required
```

## The shareable single file

`npm run snapshot` builds **one self-contained HTML file** at
`share/product-keywords-snapshot.html`. Open it by double-clicking; nothing
else is needed. It carries its own HTML, CSS, JavaScript and data - no server,
no database, no separate `.js` or `.css` file, no framework, no CDN.

```bash
npm run snapshot                          # 500 products (10 pages of 50)
npm run snapshot -- --limit 2000          # more products
npm run snapshot -- --limit 200 --embed-images
npm run snapshot -- --out share/for-review.html
```

All nine columns - product images, the category filter and paging
(Previous / Next at top and bottom, plus arrow keys and a
`#page=N&category=...` fragment) - work inside the file. Every product the file
carries brings every tag ledsone holds for it; no product is sampled and no tag
list is truncated in the data.

Two things to be clear about:

- **It is a point-in-time copy, not a live view.** It shows the catalogue as it
  was when built, and says so on the page. Rebuild it to refresh.
- **Browser JavaScript cannot connect to PostgreSQL**, and nothing pretends
  otherwise. The database is read in Node at build time over the same
  read-only connection the live app uses, and only the *result* is embedded.
  The file contains no host, port, user, password, connection string or SQL,
  and a test fails the build if any of those ever appear in it.

By default the `<img>` elements point at the image addresses ledsone already
holds, so viewing the pictures needs a connection; everything else works
offline. `--embed-images` inlines them as `data:` URIs for a file that needs no
internet at all, at roughly 55KB per product.

The live application at `/product-keywords` is unaffected and stays
script-free - `page.html` remains its server-side template.

## Available route

| Route | Method | Returns |
|---|---|---|
| `/product-keywords` | GET | The product keyword table. `?page=N` pages 50 products at a time. |
| `/` | GET | 302 redirect to `/product-keywords` |
| anything else | GET | 404 |
| any path | POST | 405 with a page explaining the application is read-only |

## Current data limitations

**Backed by ledsone and complete:**

| Column | Source |
|---|---|
| Product Image | `inventory.product_media.image_url` where `type = 'main-image'`, falling back to `inventory.product_images.image_url` (first by `image_ordering`). Both key on `product_id` = `products.id`. About one product in six has no image; those cells are blank, never a placeholder. |
| SKU | `inventory.products.sku` |
| Product ID | `inventory.products.id` |
| Product Name | `inventory.products.title` (there is no `product_name` column) |
| Category | `listings.shopify_listings.product_type` joined by SKU, falling back to the product type the Product Name states. 47.6% of products have one; the rest show a blank cell. Nothing is written back. |

The image rule - designated main image first, first gallery image as fallback -
is reused unchanged from **Smart Inventory Control** (`../Inventory System`),
which already reads these tables. Nothing about the image source was invented
here, and the `listings`, `google_ads` and `suppliers` image tables are not
read.

**Not classified in ledsone - Product Name fallback:**

| Column | Why |
|---|---|
| Primary Keyword | No column in ledsone marks a keyword as primary. |
| Secondary Keywords | No column marks keywords as secondary. |
| Long-Tail Keywords | No column marks keywords as long-tail. |
| Competitor Keywords | **No competitor keyword source exists in ledsone at all** - no table, column or view. |

This was established by sweeping all eighteen ledsone schemas for column names
matching `%primary%`, `%secondary%`, `%long_tail%`, `%longtail%`,
`%competitor%`, `%seed%`, `%suggestion%` and `%phrase%`. Two rows came back,
both unrelated to keywords. The queries are in
`query-packs/keyword-source-investigation.md`.

## The Tags column was removed

The table had a tenth column carrying ledsone's own stored product tags from
`listings.shopify_listing_tag`. It is gone: the table is the nine columns
listed at the top, and nothing on the page draws a product tag.

Two things survive it and are easy to confuse with it, so they are worth
naming:

- **The keyword resource pills stay.** They were never product tags. They sit
  inside the keyword cells and name where each keyword came from - see below.
- **`shopify_listing_tag` is still read**, but now only as *evidence*: a tag
  the business filed against a product can prove that a keyword came from that
  storefront. It reaches the page as a resource name, never as a tag of its own.

## Keyword resource tags

Every keyword in all four keyword columns carries a tag naming the **real data
resource that supplied it** - and only when that can be proven from data.

### What counts as proof

A resource supplied a keyword when **that keyword's words actually appear, as a
consecutive phrase, in a real record that resource holds against this product**.
Nothing weaker counts. In particular, a product merely *being listed* on Amazon
does not prove Amazon supplied the word "Door Handle": that is an assumption
about a platform, not evidence about a word.

Matching folds plurals ("Door Handles" proves "Door Handle") and ignores case
and punctuation, but it requires the words to be **consecutive**. "Cupboard
Handle" is proven by `cupboard handles vintage`; it is *not* proven by
`Kitchen Cupboard Wardrobe Door Handles`, where both words appear but describe
different things.

**A keyword nothing proves keeps its wording and wears no tag at all.** That is
the honest outcome and it is deliberately preferred to naming a method. It is
also common, and it is counted rather than hidden.

### The resources, and how each is reached

| Resource | Record | Joined by |
|---|---|---|
| Amazon | `listings.amazon_listing_search_engine_keywords.keyword` (the seller's own backend search terms) | SKU -> `amazon_listings.id` |
| Amazon | `business_reports.amz_search_query_performance.search_query` (real shopper queries) | SKU -> `amazon_listings.asin` |
| Amazon | `amazon_campaigns.search_term_performance_data.search_term` (advertising search terms) | `search_term_sku_data.sku` |
| Amazon | `listings.amazon_listings.title` | SKU |
| Google Search Console | `google_search_console.query_page.query` (real Google queries) | SKU -> Shopify `listing_url` -> `query_page.page` |
| a named storefront | `listings.shopify_listing_tag.tag` and `shopify_listings.title` | SKU -> child listing -> parent |
| eBay | `listings.ebay_listings.title` | SKU |
| B&Q | `listings.bandq_listings.title` | SKU |

Two of those joins are traps, and both are documented in `resources.js`:

- `amazon_listing_search_engine_keywords.product_id` is **not** a product id.
  It is `listings.amazon_listings.id`.
- Google Search Console records a **page URL**, never a SKU. The parent
  listing's URL has the Shopify product id appended and the child's carries a
  `?variant=` suffix; only the stripped child URL matches what Google recorded.

### Storefronts are named as businesses

ledsone runs ten Shopify storefronts, so a keyword proven from one says
**`Electricalsone`** or **`Vintagelite`** - the real business a reader could
visit - rather than "Shopify", which is only the software it runs on. They
share one pill colour.

### Variants share their parent's evidence

Variants of one product are several SKUs behind one Shopify parent listing, so
they share its tags, its page URL and therefore its Google queries. Every
lookup from a shared key back to a SKU is one-to-many for that reason.

## Keyword generation

The category priority is: a confirmed classified `ledsone` value, then a
deterministic Product Name search-term fallback, then a blank cell when no
meaningful term can be formed. `ledsone` currently has no confirmed classified
source for these four categories, so the running view uses the title fallback.

There is **no Keyword Guidance PDF in this repository**; the repository was
searched for one. Until real guidance is supplied, generation follows the
project's own rules, stated at the top of `keyword-generator.js`.

The page does not derive a category from advertising match type or unclassified
keyword text. Its pure generator uses only `inventory.products.title`: a
generic product-terminology map recognises the product TYPE, and an attribute
vocabulary picks up words the name already contains - style, colour, material,
configuration, lamp fitting, form. A material or colour therefore appears only
when the product name itself says so; it is read out of the name, never
guessed. No brand, company, measurement, price or compatibility claim is ever
added. Competitor Keywords are alternative generic wording for the same product
type; no competitor brand or company is named.

Secondary Keywords carry synonyms and supported attributes, Long-Tail Keywords
a more specific multi-word phrase (`Black 1 Gang Screwless Light Switch`), and
Competitor Keywords the alternative wording a shopper might use instead - three
different search purposes, never a copy of the product name. A category that
cannot be generated remains an actual empty `<td></td>` cell. There is no
unclassified-keywords column.

The type map is keyed on terminology, not on product ids: a product added to
ledsone later is handled by the same rules, and no id is special-cased.
Generated values live in the HTML response only - nothing is written back to
ledsone or cached anywhere.

`product-keywords/keyword-generator.test.js` covers deterministic title-only
generation, category distinctness, attribute support, brand avoidance,
id-independence, and blank handling. The category seam tests confirm a recorded
value wins over fallback output.

If a confirmed classified database source is added later, it is passed to
`classifyKeywords()` in `product-keywords/source.js`; the renderer and routing
do not need to change.

## Layout

```
product-keywords/     the application
  db.js                 pg Pool, read-only latch, startup check
  source.js             product SELECTs and keyword-priority seam
  categories.js         product categories and the filter index
  keyword-generator.js  deterministic Product Name fallback
  page.html             THE PAGE - doctype, head, title, all CSS, heading,
                        both control bars (count left, pager right) and the
                        complete 10-column table structure
  render.js             supplies values for page.html; builds the rows only
  snapshot.js           builds the self-contained single-file HTML snapshot
  router.js             paths and page numbers
  server.js             node:http server and security headers
  *.test.js             247 tests, no database required
  .env.example          documented configuration template

share/                the generated single-file HTML snapshot (build artifact)
sql/                  the SQL, readable outside the JavaScript
data-maps/            column-by-column source map
documentation/        how it works
evidence/             command output backing every claim made
validation/           the ten required checks and their results
handover/             what the next person needs
capability/           what it can and cannot do
duplicate-risk-reports/  what was reused from the Inventory System
query-packs/          the investigation queries
prompts/              the constraints this was built under
workflows/            the sequence and who decides what
closure/              sign-off (not closed - four columns are open)
```

## Related work

The connection and rendering patterns were copied from **Smart Inventory
Control** (`../Inventory System`), which reads the same database. That
repository was not modified; Task 4 is a separate, self-contained project and
does not import from it. See `duplicate-risk-reports/task-4-duplicate-risk.md`.
