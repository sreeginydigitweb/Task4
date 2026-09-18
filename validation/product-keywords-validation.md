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
| 10 | Run available tests | **Pass** - 139 tests, 139 passing, 0 failing. |

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

## Not validated

- **Browser rendering.** The HTML was validated structurally, not opened in a
  browser. No layout or accessibility review was carried out.
- **Keyword completeness.** 24 of 50 products on page 1 carry keyword text.
  Whether the remaining 26 genuinely have none, or have keywords that this
  relationship does not reach, was not investigated - the join was measured
  (155,374 of 189,983 keyword rows reach a listing), but the gap was not
  traced product by product.
- **Load.** Two pages were timed. No concurrent or sustained load test was run.
