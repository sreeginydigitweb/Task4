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

Product Image · SKU · Product ID · Product Name · Category · Tags ·
Primary Keyword · Secondary Keywords · Long-Tail Keywords · Competitor Keywords

Six of those ten columns are backed by ledsone. The four keyword columns are
not: they are generated from the Product Name, and a cell stays genuinely blank
rather than being filled with an invented value when the name supports nothing
meaningful. See **Current data limitations** and **Keyword generation** below -
together they are the most important part of this file.

There is deliberately no source/provenance column. A keyword's RESOURCE pill
sits underneath the keyword itself, inside its own cell.

### Two different kinds of tag

The page shows both, and they are unrelated:

| | **Product Tags** | **Keyword resource pills** |
|---|---|---|
| What | ledsone's own stored tags: `Handles`, `Threaded Rod` | The RESOURCE a keyword came from: `Product Type`, `Product Name`, `Product Name + Type`, `Database` |
| Where | the Tags column | underneath each keyword, in the keyword cell |
| Never | - | `GEN` or `Generated` - a method is not a resource |
| Look | small blue pills, blue ink on a pale blue ground | solid teal / umber / purple / blue, white label - one colour per resource type |
| Source | `listings.shopify_listing_tag` | the Product Type map, the Product Name, or a recorded ledsone value |

Product Tags are business data and are never derived, guessed or invented.
19,723 of 44,643 products carry at least one; the other 24,920 show a blank
cell. See **Product Tags** below for how they are reached.

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

All ten columns - product images, Product Tags, the category filter and paging
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
| Tags | `listings.shopify_listing_tag.tag`. **Stored, not derived.** 19,723 of 44,643 products (44.2%) carry at least one; the other 24,920 show a blank cell. See **Product Tags** below. |

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

## Product Tags

Tags are **stored business data**, not derived. They come from one table:

| | |
|---|---|
| Table | `listings.shopify_listing_tag` |
| Tag text | `.tag` (stored with a leading space on many rows, so it is trimmed) |
| Owner | `.product_id` |
| Live rows | `.is_deleted = 0` |

### `product_id` is a LISTING id, not a product id

This is the one thing worth reading carefully. Despite its name,
`shopify_listing_tag.product_id` is **not** `inventory.products.id`:

| Column | Range |
|---|---|
| `inventory.products.id` | 1 – 44,652 |
| `shopify_listing_tag.product_id` | 344,702 – 1,022,891 |
| `listings.shopify_listings.id` | 344,704 – 1,022,893 |

It is `shopify_listings.id`. Joining it straight to a product id matches
nothing at all - silently, with no error.

### The tags hang off the PARENT listing

Of the 14,765 tagged listings, **14,761 are parent listings**, and a parent
listing has no SKU. So joining tags to products by SKU alone reaches **4
products out of 44,643**. The children carry the SKUs, and
`listings.shopify_listings_parent_child_mapping` links them. Following it takes
coverage from 4 products to 19,723.

### The relationship, end to end

```
inventory.products.sku
  -> shopify_listings  (coalesce(nullif(mapped_sku,''), sku) = products.sku)
       -> that listing's own tags                        (4 products)
       -> parent_child_mapping.child_id -> .parent_id
            -> the parent listing's tags            (19,723 products)
```

Tags from both are combined, trimmed, de-duplicated and sorted. Coverage:

| | Products |
|---|---|
| With at least one tag | 19,723 (44.2%) |
| With none - blank cell | 24,920 (55.8%) |
| Total | 44,643 |

Products carry a median of 14 tags and as many as 132. A cell draws the first
eight as pills and names the remainder in a `+N` pill's tooltip - a limit on
row height, not on the data: every tag is carried and every one is reachable.

**Product ID 1** (`HLBP128BB`, a brass pull and push door handle) has exactly
one tag: `Handles`.

The lookup runs from the 50 rows being shown rather than from the tag table, so
it is an indexed lookup per listing rather than a scan of 147,833 tag rows.

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
