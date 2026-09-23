# Validation - Product Keywords

Ten checks were asked for. Each is recorded below with its result. Raw command
output is in `evidence/build-verification.md`.

| # | Check | Result |
|---|---|---|
| 1 | Install only required dependencies | **Pass** - one direct dependency, `pg`. 14 packages total including its own. |
| 2 | Run the application locally | **Pass** - starts on port 3100. |
| 3 | Test the database connection | **Pass** - `reading ledsone as varmen_user - read-only connection: yes, no write privileges.` |
| 4 | Test the `/product-keywords` route | **Pass** - HTTP 200 with real ledsone product data and generated title-only keywords. |
| 5 | Confirm the response is valid HTML | **Pass** - exactly 7 headers and 7 `<td>` cells in the validated first row. |
| 6 | Confirm database values are HTML escaped | **Pass** - zero bare ampersands, zero stray `<` in text nodes; injection payloads neutralised in unit tests. |
| 7 | Confirm no INSERT/UPDATE/DELETE SQL exists | **Pass** - asserted by `readonly.test.js` over every application module. |
| 8 | Confirm no second database is used | **Pass** - asserted by `readonly.test.js`; no reference to `order_management_copy`, `listing_generator` or `amazon_competitors`. |
| 9 | Confirm Inventory System is not modified | **Pass** - `git -C "../Inventory System" status` clean; no file written outside `Task 4`. |
| 10 | Run available tests | **Pass** - 221 tests, 221 passing, 0 failing. |

## Keyword completion round

A later round completed the three generated keyword categories, which were
blank for many products, and mirrored the page controls above and below the
table. Re-checked afterwards:

| # | Check | Result |
|---|---|---|
| 11 | Every example product id in the brief is populated | **Pass** - ids 2, 53, 56, 100, 101, 117, 118, 120, 133 and 143 each show four filled keyword cells in the live HTML |
| 12 | Logic is generic, not keyed on those ids | **Pass** - no product id or SKU appears in `keyword-generator.js`; the seam takes a title and nothing else, asserted by tests in `keyword-generator.test.js` and `source.test.js` |
| 13 | Recorded values are preserved | **Pass** - asserted in both `keyword-generator.test.js` and `source.test.js`; a whitespace-only recorded value counts as missing |
| 14 | Exactly 7 columns, no extra keyword column | **Pass** - live HTML on pages 1, 2, 3, 100, 500 and 893 |
| 15 | No placeholder text | **Pass** - zero occurrences of "Not recorded", "N/A", "Unknown" or "Keywords recorded (unclassified)" in the served HTML |
| 16 | Top and bottom controls drive the same page | **Pass** - both bars render identical markup; page 3 offers `page=2` and `page=4` from each, the label reads `Page 3 of 893` in both, and out-of-range still clamps (`page=999999` -> page 893) |
| 17 | Read-only protection intact | **Pass** - startup line still reads `read-only connection: yes, no write privileges`; no statement in the change is anything but a SELECT, and no generated value is written back |

Coverage measured over the first 5,000 products: Primary 100%, Secondary
74.5%, Long-Tail 72.3%, Competitor 72.5%. The blank remainder are names that
carry no product information - `Combo Default Title.` accounts for most of
them - where a meaningful term cannot be formed without inventing one.

## HTML extraction round

The page markup was then moved out of JavaScript into a real HTML file,
`product-keywords/page.html`, which `render.js` fills at request time.

| # | Check | Result |
|---|---|---|
| 18 | Output unchanged by the extraction | **Pass** - pages 1, 2 and 3 were captured before and after and compared byte for byte: identical (23,797 / 23,877 / 21,070 bytes). The only later difference is the editing guide added as an HTML comment in the template |
| 19 | Live data, columns and controls still correct | **Pass** - 7 columns, zero placeholder strings, both control bars, `Page 3 of 893` in each, all ten example ids still fully populated, per-page fill unchanged |
| 20 | Product data cannot be expanded as a placeholder | **Pass** - a product titled `Lamp {{table}} $1 $\`` renders literally; filling is a single pass and replacement values are never rescanned. Covered by a test |
| 21 | Template cannot introduce script or off-site content | **Pass** - `readonly.test.js` fails the build on a script tag, an inline event handler or an `http(s)://` URL in `page.html` |

## Complete-UI round

`page.html` was then made the complete, shareable UI file: the heading, count
area, both control bars with their button markup, and the whole table
structure including all seven headers moved into it, leaving `render.js`
supplying values only.

| # | Check | Result |
|---|---|---|
| 22 | page.html is a complete HTML document | **Pass** - doctype, `<html lang>`, head, charset, viewport, `<title>`, body, closing `</html>` |
| 23 | page.html holds the full table structure | **Pass** - `table-scroll`, `<table>`, `<thead>`, `<tbody>`, `</table>` all present in the file |
| 24 | page.html holds all 7 headers, in order | **Pass** - asserted against the file, not the rendered output |
| 25 | page.html holds both control areas and the buttons | **Pass** - two `controls` divs, two `<nav class="pager">`, and the `<a class="btn">` markup for Previous and Next in each |
| 26 | page.html holds all the CSS | **Pass** - the `<style>` block carries every rule the page uses |
| 27 | render.js no longer rebuilds the page structure | **Pass** - a test fails the build if `<table>`, `<thead>`, `<tbody>`, `table-scroll`, any `<th>`, a control bar, a `<nav class="pager">`, an `<a class="btn">`, the count paragraph, or any CSS reappears in `render.js` |
| 28 | Dynamic-data insertion points are commented | **Pass** - `Dynamic product count`, `TOP CONTROLS / PAGINATION`, `Dynamic product rows inserted here`, `EMPTY STATE`, `BOTTOM CONTROLS / PAGINATION` |
| 29 | No credentials, queries or secrets in page.html | **Pass** - asserted by test; no SQL, no `DB_*` name, no password |
| 30 | Live output still correct | **Pass** - HTTP 200; pages 1, 3, 500 and 893 each parse to 7 headers and 50 / 50 / 50 / 27 rows; `Page 3 of 893` in both bars; Next reaches page 4; `page=999999` clamps to 893 |
| 31 | Keyword values unchanged by the refactor | **Pass** - per-page filled counts identical to the previous round (page 1 all filled, page 500 none, page 893 6/4/4) |
| 32 | Read-only protection unchanged | **Pass** - startup still reports `read-only connection: yes, no write privileges`; no SQL was touched |

Two deliberate behaviour changes, both forced by the structure becoming
static, both covered by tests:

- A paging button with nowhere to go was a `<span>`; it is now an `<a>` with
  `aria-disabled="true"` and no `href`, so one piece of button markup can live
  in the template and still be inert when there is no page to reach.
- A single-page result used to omit the control bars; they are now always in
  the markup and carry the HTML `hidden` attribute instead. With 44,627
  products the catalogue never has fewer than 893 pages, so this is reachable
  only in tests.

## Product Image round

A Product Image column was then added as the first column, taking the table
from seven columns to eight.

| # | Check | Result |
|---|---|---|
| 33 | Image source found in ledsone, not invented | **Pass** - `inventory.product_media.image_url` (`type = 'main-image'`), falling back to `inventory.product_images.image_url` (first by `image_ordering`). Both key on `product_id` = `inventory.products.id`. Found by sweeping `information_schema.columns` for image-like names across every schema |
| 34 | Existing verified logic reused | **Pass** - the two image CTEs are taken unchanged from `../Inventory System/inventory/source.js`, which already reads these tables against the same database. A test asserts the `type = 'main-image'` rule, the `coalesce(mm, fi)` preference and the `image_ordering` order are all still there |
| 35 | Other applications' image tables not read | **Pass** - a test fails the build if `amazon_listing_images`, `ebay_listing_images`, `shopify_listing_images`, `merchant_products` or `main_image_url` appears in `source.js` |
| 36 | page.html holds the Product Image header, first | **Pass** - asserted against the file; `<th>Product Image</th>` precedes `<th>SKU</th>` |
| 37 | page.html holds all 8 headers, in order | **Pass** - Product Image, SKU, Product ID, Product Name, Primary, Secondary, Long-Tail, Competitor |
| 38 | Image cell styled in page.html, no external CSS | **Pass** - `td.img` and `td.img img` rules are in the template's `<style>` block; no `<link>` element anywhere |
| 39 | A real image renders where one exists | **Pass** - live page 8 renders `<img src="https://sin1.contabostorage.com/.../351.jpg" alt="Retro Industrial Black Ceiling Hook..." width="56" height="56" loading="lazy" decoding="async">` |
| 40 | A missing image gives a blank cell | **Pass** - `<td class="img"></td>`, no `<img>`, no placeholder. Covered for null, undefined, `''` and whitespace, and for a row with no image field at all |
| 41 | Non-http image values are refused | **Pass** - `javascript:`, `data:`, a relative path and `ftp://` are all treated as no image, because `src` is an attribute the browser acts on |
| 42 | Image URL and alt text are escaped | **Pass** - a URL and a title both carrying `" onerror="alert(1)` are rendered as `&quot;`; no real `onerror` attribute is created |
| 43 | No script introduced | **Pass** - zero `<script` in the served page and none in the template; no inline event handler on the image |
| 44 | Keyword columns unchanged | **Pass** - live page 8 keyword cells are the same values as before the column was added; a test pins the four keyword cells at their new offsets |
| 45 | Pagination unchanged | **Pass** - `Page 3 of 893` in both bars, `page=2`/`page=4` from each, `page=999999` clamps to the last page |
| 46 | No product duplicated by the joins | **Pass** - pages 1, 8, 32 and 893 each return as many distinct product ids as rows (50 / 50 / 50 / 36); `DISTINCT ON` gives at most one image row per product |
| 47 | Still read-only | **Pass** - the added SQL is a SELECT with two LEFT JOINs; startup still reports `read-only connection: yes, no write privileges` |

Live coverage measured: pages 1 and 3 all 50 rows with images; page 8 has 48
with / 2 without; page 32 has 39 with / 11 without; page 893 has 30 with / 6
without. Across the catalogue, 7,341 of 44,636 products (16.4%) have no image
in either table.

**One security change was required.** The page previously sent
`Content-Security-Policy: default-src 'none'` with no `img-src`, which would
have blocked every product image silently. `img-src` now names the two hosts
the image data actually uses and nothing else:

```
img-src https://sin1.contabostorage.com https://dashboard.digitweblk.com http://dashboard.digitweblk.com
```

A test fails the build if that becomes a wildcard, gains `data:` or `blob:`, or
stops being a list of plain host origins. `referrer-policy: no-referrer` is
unchanged, so the image host is not told which page requested it. Loading a
remote image does still tell that host a viewer opened the page, and one of the
two hosts is reached over plain http for 162 of the URLs - both noted rather
than hidden. **If the business moves its image storage, the `IMAGE_HOSTS`
constant in `server.js` must be updated or images will stop appearing.**

## Self-contained single-file round

`npm run snapshot` was added, producing one shareable HTML file that needs
nothing else. The live application was deliberately left unchanged.

| # | Check | Result |
|---|---|---|
| 48 | One file, complete HTML document | **Pass** - `share/product-keywords-snapshot.html`, 0.23 MB for 500 products: doctype, head, title, body, closing `</html>` |
| 49 | Nothing loaded from outside the file | **Pass** - zero `<script src>`, zero `<link>`, zero `@import`, zero `<iframe>`/`<object>`. The only URLs anywhere are image addresses inside the embedded data |
| 50 | All CSS inline | **Pass** - the live `page.html` stylesheet is read at build time and inlined, so both look the same and there is one place to restyle |
| 51 | All JavaScript inline | **Pass** - paging, row rendering and keyboard paging in one inline `<script>`; no import, require, fetch, XHR or framework |
| 52 | All 8 columns, in order | **Pass** - Product Image, SKU, Product ID, Product Name, Primary, Secondary, Long-Tail, Competitor |
| 53 | Real product data embedded | **Pass** - 500 products as JSON in the file; 498 with an image, 2 without. Verified by parsing the block back out |
| 54 | It actually runs | **Pass** - the generated file's own script was executed against its own data: 50 rows drawn, 8 cells each, `Showing 1-50 of 500`, both bars `Page 1 of 10` |
| 55 | Pagination works inside the file | **Pass** - Next reaches page 2 then clamps at 10; Previous disabled on page 1, Next disabled on page 10; bottom bar drives the same page as the top; arrow keys page; `#page=N` opens a page directly and nonsense falls back to page 1 |
| 56 | Blank image cells where there is no image | **Pass** - product 390 (`SOGS1GGK`, page 8 of the snapshot) renders an image cell with no child and no text, keywords intact |
| 57 | No credentials in the shared file | **Pass** - a test fails the build on `password:`/`password=`, any `DB_*` name, `postgres://`, `connectionString`, the role name, `sslmode=` or the port |
| 58 | No SQL or database client in the file | **Pass** - no statement, no `FROM inventory.`, no `new Pool`/`new Client`, no `pg` import |
| 59 | The PostgreSQL limitation is stated, not glossed | **Pass** - the file says in writing that browser JavaScript cannot speak to PostgreSQL and that the data was read in Node at build time. A test asserts the sentence is there |
| 60 | Embedded product text cannot become markup | **Pass** - a name of `Lamp</script><script>alert(1)</script>` is escaped in the data block (still exactly 2 script elements) and rendered with `textContent`, creating no element. `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and `new Function` are all absent from the client script |
| 61 | Non-http image addresses refused at render time | **Pass** - `javascript:`, `data:`, a relative path and `ftp://` all produce an empty cell |
| 62 | Fully offline variant works | **Pass** - `--limit 20 --embed-images` gave 20/20 images as `data:` URIs, zero remote URLs anywhere, 1.10 MB (~55KB per product) |
| 63 | The live application is unchanged | **Pass** - `page.html` still has no script and still contains `{{rows}}`, asserted by a test; the live page still returns HTTP 200 with 8 headers, zero script tags and `Page 8 of 893` |
| 64 | Keyword generation untouched | **Pass** - the snapshot calls the application's own `classifyKeywords`; `Pendant Light` still yields the same four values |
| 65 | Test suite | **Pass** - 139 tests, 139 passing, 0 failing |

Two limitations recorded rather than hidden:

- The snapshot is a **point-in-time copy**. It states its build time on the
  page and does not update.
- Without `--embed-images` the pictures load from the addresses ledsone holds,
  so viewing them needs a connection. Everything else in the file works
  offline.

The visual rendering was not opened in a browser; the checks above are
structural and behavioural (the shipped script executed against a DOM
stand-in).

## Categories round

A Category column and a category filter were added, taking the table from
eight columns to nine. A Tags column was added after it, taking it to ten -
see **Product Tags round** below.

### The category source, as found

| Source | Reaches products | Distinct values | Verdict |
|---|---|---|---|
| `listings.shopify_listings.product_type` (by SKU) | 19,343 (43.3%) | 595 | **Used.** The business's own recorded category; the join Smart Inventory Control already uses |
| Derived from `inventory.products.title` | +1,899 (4.3%) | 28 | **Used as the fallback only**, from the map that already produces the Primary Keyword |
| `staff.ph_categories` + `ph_category_products` | 4,457 (10.0%) | 77 | Not used. Reaches products only through a three-hop ASIN join and covers far less |
| `listings.amazon_listings.product_type` | 8,834 (19.8%) | - | Not used. Narrower than the Shopify one |
| `listings.bandq_categories`, `listings.shopify_collections`, `google_ads.merchant_products` | - | - | Not used. Other applications' data |

Combined: **21,242 of 44,636 products (47.6%) carry a category, in 488 distinct
values.** 23,394 have none and show a blank cell.

The choice between "recorded only", "derived only" and the hybrid was put to
the requester with these measurements before anything was built; the hybrid was
chosen.

| # | Check | Result |
|---|---|---|
| 66 | Category data retrieved from ledsone, not invented | **Pass** - `listings.shopify_listings.product_type`, one listing per SKU by `updated_at`; asserted against the source by test |
| 67 | Relationship to inventory.products | **Pass** - `products.sku = coalesce(nullif(mapped_sku,''), sku)`, LEFT joined so an uncategorised product is kept; no product duplicated |
| 68 | Recorded category always wins | **Pass** - derived only where ledsone records nothing; blank/whitespace counts as missing |
| 69 | Recorded values are not edited | **Pass** - near-duplicates and other languages shown as stored (`Pendant_Lamp_Lights`, `Pendelleuchten`, `LIGHT_FIXTURE`) |
| 70 | No other category table read, nothing written back | **Pass** - a test fails the build on `ph_categories`, `bandq_categories`, `shopify_collections` or `merchant_products`, or on any write statement |
| 71 | Category shown in the table, 5th column | **Pass** - live headers: Product Image, SKU, Product ID, Product Name, **Category**, Primary, Secondary, Long-Tail, Competitor |
| 72 | Missing category handled | **Pass** - `<td class="category"></td>`; no "Uncategorised", "Unknown", "N/A" or "None". Live page 500: 44 of 50 rows blank |
| 73 | Filter shows available categories | **Pass** - 489 options live (All Categories plus 488), busiest first with counts: `Pendant Lighting (1,700)`, `Wall Light (1,215)`, `LIGHT_FIXTURE (897)` |
| 74 | Selecting a category filters the table | **Pass** - `?category=Pendant Lighting` returns 50 rows, every one in that category |
| 75 | Count updates to the filtered total | **Pass** - `Showing 1-50 of 1,700 products in Pendant Lighting.` against `44,641` unfiltered |
| 76 | Pagination works after filtering | **Pass** - `Page 1 of 34` for 1,700 products at 50 a page; page 3 returns 50 rows, all still in the category |
| 77 | Category preserved across pages | **Pass** - every paging link carries it: `/product-keywords?page=2&category=Pendant%20Lighting`, in both control bars |
| 78 | All Categories shows everything | **Pass** - back to `44,641`; the Clear control is hidden when no filter is on and shown when one is |
| 79 | Unknown category is not an error | **Pass** - `?category=NoSuchCategoryAtAll` returns HTTP 200 and the full catalogue |
| 80 | Category values are escaped | **Pass** - a category of `<b>Lights</b> & "more"` renders escaped, in the cell, the option and the paging link |
| 81 | Live page still needs no JavaScript | **Pass** - the filter is a GET form; zero `<script` in the served page |
| 82 | Keyword generation unchanged | **Pass** - no change to `keyword-generator.js`; all its tests pass untouched |
| 83 | Snapshot carries categories | **Pass** - `share/product-keywords-snapshot.html`: 9 headers, `category` on every embedded row, 63 categories in this 500-product file |
| 84 | Snapshot category filter works | **Pass** - the file's own script was run against its own data: choosing `Lamp_Holder` gives `Showing 1-50 of 69 products in Lamp_Holder`, `Page 1 of 2`, every row matching; Next stays inside the category; Clear returns to `500` / `Page 1 of 10` |
| 85 | Snapshot preserves the category while paging | **Pass** - the address becomes `#page=2&category=Lamp_Holder`, and `#page=2&category=Lights` opens filtered |
| 86 | Snapshot still self-contained | **Pass** - zero external scripts, zero `<link>`, zero credential patterns, zero SQL statements |
| 87 | Test suite | **Pass** - 184 tests, 184 passing, 0 failing |

One security change: `Content-Security-Policy` `form-action` moved from
`'none'` to `'self'` so the filter form can submit back to this application.
It was `'none'` only because the page previously had no form; `'self'` still
refuses to let a form here submit anywhere else, and a POST is still answered
with the read-only explanation.

A category index is held in memory (about 3.4s to build, ~17MB, rebuilt after
10 minutes). It exists because a category derived from a product name cannot
be filtered or counted in SQL, and paging a filtered list correctly needs the
whole matching set. Nothing is written to the database.

## Keyword source tags round

Each keyword now carries a small tag saying where it came from.

**Three things in the request did not match the project as it stood, and were
reported rather than quietly worked around:**

- There was **no sidebar** to remove - the page has never had one.
- There were **no coloured keyword chips or backgrounds** to correct. The tags
  are a new feature, not a revision.
- The page title was `Product Keywords - Task 4`; it is now exactly
  `Product Keywords`, on both the live page and the snapshot.

| # | Check | Result |
|---|---|---|
| 88 | Keyword text is ordinary dark text | **Pass** - `.kw { color: var(--ink) }`, no background, no border, no chip class. Asserted against the stylesheet and the rendered cell |
| 89 | Only the tag is coloured | **Pass** - the only source-coloured rules are `.tag-db`, `.tag-gen`, `.tag-mix`; `.tag` sets `background: none` |
| 90 | DB blue, GEN orange, MIX purple | **Pass** - `--tag-db: #1b5e9c`, `--tag-gen: #a35400`, `--tag-mix: #6b3fa0`, with lighter equivalents in dark mode |
| 91 | The tag is small and beside its keyword | **Pass** - 10px, inline after the keyword, inside the same `.kw` line |
| 92 | No separate tag column | **Pass** - still exactly nine headers and nine cells per row |
| 93 | The four keyword columns are unchanged | **Pass** - Primary, Secondary, Long-Tail, Competitor all still present and in order |
| 94 | Keyword values and generation unchanged | **Pass** - `keywordTermSources` reports on what `resolveKeywordCategories` already returns; no generation rule was touched, and every pre-existing keyword test passes unaltered |
| 95 | All three tag states work | **Pass** - with a recorded value that partly agrees with the generator: `Hanging Light` -> MIX, `Ceiling Drop` -> DB, `Pendant Lamp` -> MIX; with none recorded, all GEN |
| 96 | Tags on the live page | **Pass** - 389 tags on page 1, all GEN, because ledsone records no keyword category |
| 97 | Keyword values are escaped, tag and all | **Pass** - a keyword of `<b>Lamp</b> & "co"` renders escaped |
| 98 | An unknown source does not break the page | **Pass** - falls back to GEN rather than emitting `tag-nonsense` |
| 99 | Blank keyword cell shows no tag | **Pass** |
| 100 | Page title is exactly "Product Keywords" | **Pass** - live page and snapshot |
| 101 | No sidebar | **Pass** - confirmed absent; the only `drawer`/`aside`-like matches on the page are inside product titles |
| 102 | Categories, filter, image, pagination kept | **Pass** - 9 columns, 489 live filter options, filtering and paging re-verified |
| 103 | Snapshot carries the tags | **Pass** - 389 tags on its page 1, rendered by its own script through `createTextNode` + a `.tag` span, so keyword text is never parsed as markup |
| 104 | Snapshot still standalone | **Pass** - 0.31 MB, zero external scripts, zero `<link>`, zero credential patterns, zero SQL; filter and paging still work inside the file |
| 105 | Test suite | **Pass** - 201 tests, 201 passing, 0 failing |

## Does the page return real ledsone data?

Yes. The count line reads **44,599 products**, which is the true row count of
`inventory.products`. The validated first row was SKU `HLBP128BB`, product id
`1`, and its real title. Its search categories were generated only from that
title because ledsone has no confirmed classified category source.

## Factual validation - does the page avoid claiming anything untrue?

This is the check that matters most for this task, because the four requested
keyword categories do not exist in the source.

| Claim the page could have made | Does it? |
|---|---|
| That unclassified database text is a keyword category | No - it is not mapped |
| That unsupported product facts are present | No - title-only deterministic fallback |
| That a competitor company or brand is named | No - generic alternative terminology only |
| That a category without a meaningful term is populated | No - blank cell |

Three tests enforce this rather than leaving it to review:

- `keyword-generator.test.js` verifies the `Pendant Light` result,
  determinism, title-only terms, and safe blanks.
- `render.test.js` - *"unavailable keyword categories render as four actual
  blank table cells"* asserts exactly four empty cells per row.
- `source.test.js` verifies title fallback and that a confirmed recorded value
  takes priority for its category.

If someone later derives a category without approval, the suite fails.

## Product Tags round

A Tags column was added, taking the table from nine columns to ten, and the
pagination bars were rearranged so the product count sits at the left and the
Previous / page / Next controls at the right, above and below the table.

### The tag source, as found

The investigation ran before any code changed. Sweeping all schemas for
`%tag%` returned exactly one tag table: `listings.shopify_listing_tag`.

| Question | Answer |
|---|---|
| Which table holds the tags? | `listings.shopify_listing_tag` |
| Which column? | `.tag` (`varchar`), with `.is_deleted = 0` for live rows |
| Stored or derived? | **Stored.** 147,833 live rows |
| How does it relate to `inventory.products`? | Indirectly - see below |

### Two traps, both measured rather than assumed

| Trap | Evidence |
|---|---|
| `shopify_listing_tag.product_id` looks like a product id but is a **listing id** | Product ids run 1–44,652. `shopify_listing_tag.product_id` runs 344,702–1,022,891, and `shopify_listings.id` runs 344,704–1,022,893. The ranges do not overlap at all. A direct join returns 0 rows, silently. |
| Tags hang off **parent** listings, which have no SKU | 14,761 of 14,765 tagged listings are parents. Joining tags to products by SKU alone reaches **4 products**. Going through `shopify_listings_parent_child_mapping` reaches **19,723**. |

### Coverage, as measured

| | Products |
|---|---|
| With at least one tag | 19,723 (44.2%) |
| With none - blank cell | 24,920 (55.8%) |
| Total | 44,643 |

Tags per product: minimum 1, median 14, 95th percentile 54, maximum 132.

### Checks carried out

| Check | Result |
|---|---|
| Ten columns, Tags after Category | Pass - live page and snapshot |
| Tags are blue pills, keyword text still plain dark | Pass |
| The keyword source label still sits *below* its keyword, in the keyword cell | Pass |
| No source/provenance column was added | Pass |
| Product ID 1 (`HLBP128BB`) shows its real tag | Pass - `Handles`, matching the database exactly |
| A product with 40 stored tags shows all 40 | Pass - product 101 (`CL3RGR`): 8 pills plus a `+32` pill naming the other 32 |
| Tags are per-product, not a shared sample | Pass - the 500-product snapshot holds 21,836 tags, 1,409 distinct strings and 427 distinct tag-sets across 464 tagged products |
| A product with no tags gets a blank cell | Pass - 36 of the 500 snapshot products, no placeholder |
| Count at the left, pager at the right, both bars | Pass - live page and snapshot |
| Count still shown when there is only one page | Pass - only the pager is hidden |
| Search, Categories, Clear Filters, paging | Pass - unchanged |
| Snapshot still standalone | Pass - no `<link>`, no external `<script src>`, no CDN, no `@import`, no credentials |
| Test suite | Pass - 243 tests, no database required |

The snapshot's own tag figures are stated in its header comment: 21,836 tags
across 464 of its 500 products, 36 with none.

## Keyword resource round - GEN removed

The keyword provenance label was replaced. It used to read `DB` / `GEN` /
`MIX`, which names a **method**; it now names the **resource** the word came
from. No keyword value changed, and no generation rule was touched.

### Why GEN had to go

`GEN` said "the application generated this", which tells a reader nothing about
where to check the word. Worse, in production it could never say anything else:
`router.js` passes `product.keywordCategories`, and `findProductKeywordPage`
never sets that property — so `recorded` was always `undefined`, the `db` and
`mix` branches were unreachable, and every keyword was `GEN` **by
construction rather than by evidence**.

### The four resources, as traced from the implementation

| Resource | Where the word is written | Generator field |
|---|---|---|
| **Product Type** | the matched `PRODUCT_TYPES` entry in `keyword-generator.js` | `primary`, `secondary[]`, `competitor[]`, fallback `longTail` |
| **Product Name** | `inventory.products.title` | `productAttributes()`, and `conciseTitlePhrase()` when no type matches |
| **Product Name + Type** | both, in one phrase | `` `${qualifiers} ${type.primary}` `` |
| **Database** | a keyword value recorded in ledsone | the `recorded` seam; wins over generation |

Amazon, eBay, Google and Search Console are **deliberately not resources**.
ledsone holds real keyword data for those platforms (section 6a of the
documentation), but this application does not read it, so no keyword on this
page came from them. Labelling one `Amazon` because Amazon happens to hold the
same word would invent a provenance the code cannot support.

### Checks carried out

| # | Check | Result |
|---|---|---|
| 115 | `GEN` reaches the reader nowhere | **Pass** - live page and snapshot, after stripping HTML and CSS comments: no `GEN`, no `MIX`, no `Generated`, no `tag-gen`/`tag-mix` class. The two remaining occurrences in the snapshot file are comments stating the word is deliberately absent |
| 116 | The pill names a resource, not a method | **Pass** - `Product Type`, `Product Name`, `Product Name + Type`, `Database` |
| 117 | Product ID 1 traces correctly | **Pass** - see the table below; every one verified against `keyword-generator.js` |
| 118 | All four keyword columns carry pills | **Pass** - Primary, Secondary, Long-Tail and Competitor all pilled on the live page |
| 119 | Works for all products, not just id 1 | **Pass** - page 1: 389 keywords, 251 Product Type, 89 Product Name, 49 Product Name + Type, **0 without a pill** |
| 120 | Snapshot carries the same resources | **Pass** - 500 products, 3,802 keywords: 2,497 Product Type, 862 Product Name, 443 Product Name + Type, 0 Database, **0 without a pill** |
| 121 | Old fields gone from the snapshot data | **Pass** - rows carry `{"t":…,"r":…}`; no `"s":` source field and no `"i":` input field remain |
| 122 | One colour per resource type | **Pass** - teal `#0f6b5f`, umber `#8a4b12`, purple `#6b3fa0`, blue `#1b5e9c`; asserted distinct by test, with dark-mode equivalents |
| 123 | Keyword text still plain dark, pill below it | **Pass** - `.kw .term { color: var(--ink) }`, no background; pill is `inline-block` on the following line |
| 124 | No separate source column | **Pass** - still exactly ten headers and ten cells per row |
| 125 | Unprovable provenance gets no pill | **Pass** - `null`, `undefined` and an unknown resource all render the keyword with no pill, rather than falling back to a label |
| 126 | Keyword VALUES unchanged | **Pass** - only the provenance label changed; every keyword-generation test passes unaltered, and page-1 keyword text is identical to the previous round |
| 127 | Test suite | **Pass** - 247 tests, 247 passing |

### Product ID 1, as rendered live

| Keyword | Column | Resource |
|---|---|---|
| Door Handle | Primary | Product Type |
| Door Pull | Secondary | Product Type |
| Pull Handle | Secondary | Product Type |
| Vintage | Secondary | Product Name |
| Brass | Secondary | Product Name |
| Vintage Brass Door Handle | Long-Tail | Product Name + Type |
| Cabinet Handle | Competitor | Product Type |
| Cupboard Handle | Competitor | Product Type |

## Marketplace and Platform round

The standalone page gained two filters, **Marketplace** and **Platform**, read
by `listing-facets.js`. A code review then found three faults, fixed in
`c99f772`: clearing the search box left the table filtered by the old term,
`DB_ORDERS_SCHEMA` reached the SQL unchecked, and listing SKUs were trimmed
where `resources.js` and `source.js` compare them untrimmed. `index.html` was
rebuilt from `ledsone` on 2026-09-23 after the fixes.

Every count below was computed twice: once from the built `index.html`, and
once by an independent SQL query written for this check, not the
application's own.

### Checks carried out

| # | Check | Result |
|---|---|---|
| 128 | Test suite | **Pass** - 338 tests, 338 passing |
| 129 | Database connection | **Pass** - `ledsone` as `varmen_user`, read-only, no write privilege on `inventory.products`; `order_management.sub_source` (119 rows) and `source` (17 rows) readable |
| 130 | Marketplace values and counts are ledsone's own | **Pass** - all 17 marketplaces match the database exactly, UK 31,064 down to Saudi Arabia 43. No value is written in the code |
| 131 | Platform values and counts are ledsone's own | **Pass** - EBAY 25,791, SHOPIFY 20,444, AMAZON 18,994, B&Q 4,185; identical in page and database |
| 132 | A product with no listing is shown with nothing | **Pass** - 10,662 products carry two empty lists, and they are exactly the products the database has no listing for. The database now reports 10,664: the two extra, ids 44734 and 44735 ("Combo Default Title."), were added after the build and are not in the page |
| 133 | Filters combine | **Pass** - Germany 16,223, then Germany + B&Q 2,635; the database gives 2,635 for the same pair |
| 134 | Emptying the search box drops the search at once | **Pass** - in a headless browser: a search with no match shows 0 rows; emptying the box returns 50 rows and "Showing 1–50 of 44,724 products." A client test fails on the old code and passes on the fix |
| 135 | Emptying the search box keeps the dropdowns | **Pass** - Germany + B&Q + "pendant" gives 108; emptying the box returns to 2,635 with both dropdowns still set |
| 136 | Typing alone still waits for Enter | **Pass** - unchanged client test: an `input` with text in the box leaves the table alone |
| 137 | Clear Filters resets everything | **Pass** - back to 44,724 |
| 138 | `DB_ORDERS_SCHEMA` is checked | **Pass** - `x;drop` and `Order-Mgmt` are refused at startup; an empty value falls back to `order_management` |
| 139 | Listing SKUs join exactly as elsewhere | **Pass** - no `btrim` on any SKU in `listing-facets.js`; the same `coalesce(nullif(mapped_sku, ''), sku)` as `resources.js` |
| 140 | No console errors, no failed requests | **Pass** - both the live route and `index.html` |
| 141 | Second database untouched | **Pass** - `readonly.test.js`; `order_management` is read, `order_management_copy` is not |

### Space-padded SKUs, as measured

14 products have a SKU with a leading or trailing space. None of them gets a
marketplace or platform, before the fix or after it: before, the listing side
was trimmed but the product was looked up by its padded SKU; now neither side
is trimmed and no listing carries the padded spelling. Separately, 64 Amazon
listings carry a padded SKU; before the fix they were credited to 21 products
that `resources.js` never links them to, and now they are not. This page and
the rest of the application now agree on all of them. Whether those 14
products *should* match their trimmed listings is a data question, and is not
answered here.

### What "Germany + B&Q" means

The two dropdowns are independent lists per product. Germany + B&Q is a
product listed **somewhere** in Germany **and somewhere** on B&Q, not
necessarily a B&Q listing in Germany. That is how the page is built, and the
database check (133) used the same meaning.

## Not validated

- **Browser rendering.** The HTML was validated structurally, not opened in a
  browser. No layout or accessibility review was carried out. This includes the
  Tags column and the rearranged pagination bars: the markup, the CSS rules and
  the rendered values were checked, but not how they look on screen. From the
  Marketplace and Platform round on, the standalone page's search and filters
  were driven in a headless browser, but its layout still was not reviewed.
- **Keyword completeness.** 24 of 50 products on page 1 carry keyword text.
  Whether the remaining 26 genuinely have none, or have keywords that this
  relationship does not reach, was not investigated - the join was measured
  (155,374 of 189,983 keyword rows reach a listing), but the gap was not
  traced product by product.
- **Load.** Two pages were timed. No concurrent or sustained load test was run.
