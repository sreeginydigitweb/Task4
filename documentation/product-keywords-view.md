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
| Product Image | `inventory.product_media.image_url` (`type = 'main-image'`), falling back to `inventory.product_images.image_url` |

### Product Image

Two tables in the `inventory` schema hold images, both keyed on `product_id`,
which is `inventory.products.id`:

| Table | Rows | Role |
|---|---|---|
| `inventory.product_media` | 43,350 | `image_url`, with `type = 'main-image'` marking the designated main picture |
| `inventory.product_images` | 36,748 | `image_url` gallery, ordered by `image_ordering` |

The designated main image wins; the first gallery image is the fallback. That
preference was **not decided here** - it is the rule the Smart Inventory
Control application (`../Inventory System`, `inventory/source.js`) already uses
against this same database, and its two image CTEs are reused unchanged. No
image column, table or relationship was invented, and the listings,
`google_ads` and `suppliers` image tables are deliberately not read: they
belong to other applications. A test fails the build if any of them appears.

Both joins are LEFT joins, so a product with no image is still listed. About
one product in six has no image in either table (7,341 of 44,636 measured);
those cells are left genuinely empty - no placeholder image, no stand-in URL.

The page is narrowed first, in a `page` CTE, so the image lookups run against
the 50 rows being shown rather than the whole catalogue. Measured at roughly
0.2-0.3s per page, and no product is duplicated by the joins (`DISTINCT ON`
gives at most one image row per product).

There is no `product_name` column in ledsone. The heading reads "Product Name"
because that is the requested wording; the value comes from `title`.

### Category

| Source | Column | Reaches |
|---|---|---|
| `listings.shopify_listings` | `product_type`, joined to products by SKU | 19,343 products (43.3%) |
| Derived from `inventory.products.title` | the terminology map in `keyword-generator.js` | a further 1,899 (4.3%) |

ledsone's own recorded category always wins; a category is derived from the
product name only where the database records none. Together they cover 21,242
of 44,636 products (47.6%) in 488 distinct categories. The remaining 23,394
have no category and show a blank cell.

The derived value is **not a second vocabulary invented for categories** - it
is the same product-type map that already produces the Primary Keyword, so a
derived category only ever restates the product type the name itself gives.

Recorded values are shown exactly as the business stores them, near-duplicates
and other languages included (`Pendant Light`, `Pendant Lighting`,
`Pendant_Lamp_Lights`, `Pendelleuchten`, `LIGHT_FIXTURE`). They are not merged
or translated: that would be editing the business's data on a guess.

**Sources considered and not used.** `staff.ph_categories` holds 77 curated
category names, but reaches only 4,457 products (10.0%) and only through a
three-hop ASIN join, so it is narrower than the recorded product type.
`listings.bandq_categories`, `listings.shopify_collections`,
`listings.amazon_listings.product_type` and `google_ads.merchant_products`
belong to other applications or cover less. A test fails the build if any of
them is referenced.

Nothing is written back. No category table is created and no category is
stored; the value is worked out on read.

### Why there is a category index

A derived category is computed in JavaScript from the product name, so
PostgreSQL cannot filter or count on it - and paging a filtered list correctly
needs to know every matching product before it can pick out one page. So the
whole catalogue's categories are worked out once and held in memory: the ids
in each category, and the counts the filter shows. It costs about 3.4 seconds
to build and roughly 17MB, and is rebuilt when it goes stale (10 minutes).

### The category filter

An ordinary GET form above the table: choose a category, press Filter, and the
page reloads as `?category=...`. **No JavaScript** - the server does the
filtering, so the live page stays script-free.

- **All Categories** is the empty value, which the router reads as no filter.
- Options are listed busiest first with their product counts, because the
  catalogue has hundreds of marketplace categories and most cover few products.
- The count line reports the filtered total, not the catalogue total.
- **The chosen category is carried on every paging link**, so Next from page 3
  of "Wall Light" lands on page 4 of "Wall Light".
- A **Clear** link appears only while a filter is on.
- A category that no longer exists is treated as no filter rather than as an
  error, so a stale bookmark shows the catalogue instead of a failure.

The `Content-Security-Policy` `form-action` directive moved from `'none'` to
`'self'` for this form. It was `'none'` while the page had no form at all;
`'self'` still refuses to let a form here submit anywhere else. The filter
changes nothing - it selects which rows are read.

## 4. Keyword sources investigated

Six keyword-bearing tables exist in ledsone. Each was examined against the
requirement:

| Table | Rows | Outcome |
|---|---|---|
| `listings.amazon_listing_search_engine_keywords` | 189,983 | Not displayed. Keyword text is unclassified. |
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

## 6a. How a keyword cell is filled

Three sources, always tried in this order:

1. **Confirmed classified data in ledsone.** If the database holds a value for
   a category, it wins and is never overwritten. A recorded value that is empty
   or only whitespace counts as missing, not as data.
2. **Generation from Product Name + Keyword Guidance.** Used only for the
   categories left unfilled by step 1.
3. **Blank.** An actual empty `<td></td>`. No "Not recorded", no "N/A", no
   dash, no placeholder of any kind.

ledsone currently has no confirmed classified category source (section 6), so
in practice every category is generated from `inventory.products.title`. Step 1
is still the first branch in the code: the seam exists so a real classified
source can be plugged in later without touching generation, rendering or SQL.

### Keyword Guidance status

**There is no Keyword Guidance PDF in this repository.** The repository was
searched; no such file exists. Nothing in the code or these documents claims a
rule came from one.

Until real guidance is supplied, the fallback is the project's own existing
rule set, stated at the top of `product-keywords/keyword-generator.js`:

- Every term must be supported by the Product Name. No other source is read.
- The four categories carry four different search purposes; no category is a
  copy of the product name or of another category.
- No brand, company, competitor name, model number, price, measurement or
  unsupported specification is ever introduced.
- Generation is a pure function of the title - same name in, same keywords out.
- Where the name supports nothing meaningful, the value is blank.

When the real guidance arrives, it replaces the rule set in that one file.

### The generation path

```
Product Name (inventory.products.title)
   |
   +-- product TYPE       generic product terminology: "wall light switches"
   |                      -> Light Switch
   +-- ATTRIBUTES         words already present in the name, at most one per
                          group (style, colour, material, configuration,
                          fitting, form): Black, 1 Gang, Screwless
   |
   v
Primary   Secondary   Long-Tail   Competitor
```

| Category | Search purpose | Built from |
|---|---|---|
| **Secondary Keywords** | Related terms, synonyms and relevant attributes a shopper may search instead | The type's synonyms, plus attribute words the name itself contains |
| **Long-Tail Keywords** | A more specific multi-word phrase | The name's attributes qualifying the type term, e.g. `Black 1 Gang Screwless Light Switch`. Where the name supplies no attribute, a longer phrase built from the type's own terminology, e.g. `Pendant Light` -> `Pendant Ceiling Light` |
| **Competitor Keywords** | Alternative wording other listings use for the same kind of product | The type's alternative terminology only. **No competitor company, seller or brand is named, because none is invented and none is read from anywhere** |

The type map is keyed on product terminology, never on a product id or SKU. A
product added to ledsone tomorrow is classified by the same rules, and the ids
named in the brief have no special case anywhere in the code.

### When a cell stays blank

A name with no recognised product terminology keeps its own shortened phrase as
the Primary Keyword and contributes any attribute words it contains as
Secondary Keywords; Long-Tail and Competitor stay blank, because inventing a
synonym for an unrecognised product type would be a guess. A name carrying no
product information at all - the catalogue's `Combo Default Title.` rows, for
example - generates nothing beyond its own phrase. Blank is the correct answer
there, not a placeholder.

Measured over the first 5,000 products: Primary 100%, Secondary 74.5%,
Long-Tail 72.3%, Competitor 72.5%. The remainder are names such as
`Combo Default Title.` or product families the catalogue holds only a handful
of, where no meaningful term can be formed from the name alone.

### These values are not stored

Generation happens per request, in memory, for the HTML view only. Nothing is
written back: no keyword row is created, updated or cached in ledsone or
anywhere else. The connection remains read-only (section 1), and the
application has no persistence mechanism to add one to.

The table has exactly eight columns and no unclassified-keywords column.

## 7. Request flow

```
browser
  → product-keywords/server.js    node:http, security headers
  → product-keywords/router.js    path and page-number handling
  → product-keywords/source.js    product SELECTs and category priority
  → product-keywords/keyword-generator.js title-only deterministic fallback
  → product-keywords/db.js        pg Pool, read-only latch
  → ledsone
  → product-keywords/render.js    builds the rows, escapes every value
  → product-keywords/page.html    the page itself; render.js fills its slots
  → HTML response
```

## 7a. The HTML file

`product-keywords/page.html` is the page, and it is complete enough to share on
its own. It holds:

- `<!doctype html>`, `<html>`, `<head>`, the meta tags and the `<title>`
- **all** of the CSS, the product-image cell styling included
- the `<h1>` heading and the count line
- both paging control bars, including the button markup
- the full table: `<div class="table-scroll">`, `<table>`, `<thead>`, all eight
  `<th>` headers, `<tbody>`, `</table>`
- HTML comments marking every point where dynamic data arrives

`render.js` builds no structure. It supplies seven values, each marked in the
template by a name in double curly braces:

| Slot | Filled with |
|---|---|
| `count_text` | `Showing 101-150 of 44,627 products.` |
| `page_position` | `Page 3 of 893` |
| `prev_attrs` | `href` + `rel` for the Previous button, or `aria-disabled="true"` |
| `next_attrs` | the same for the Next button |
| `controls_hidden` | ` hidden` when the result fits on one page |
| `rows` | the `<tr>` product rows |
| `empty_message` | shown only when a page has no rows |

The rows are the one piece of markup still built in JavaScript, and
unavoidably: there are 44,627 products, read 50 at a time, so they cannot be
static. Their cell classes are documented at the top of the template.

Change markup, styling, the buttons, or the order of the sections by editing
that file alone; no JavaScript change is needed for any of it.

### Two consequences of the structure being static

- **The control bars always exist in the markup.** With only one page there is
  nowhere to go, so both bars carry the plain HTML `hidden` attribute (and
  `.controls[hidden] { display: none; }` in the stylesheet, which the class
  selector would otherwise override). A button with no page to reach is
  rendered `aria-disabled="true"` with no `href` at all, so it is greyed out
  and the browser will not follow it - which is why `page=0` never appears.
- **The table headers stand even with no rows.** An empty result adds the
  "No products found." note underneath rather than replacing the table.

Three details worth knowing:

- **Filling is a single pass.** A slot name appearing inside product data - a
  product actually titled `Lamp {{rows}}` - is never expanded, and a
  replacement value is never rescanned. A test covers it, along with `$&` and
  `$1`, which are free text in a product title but special to a naive string
  replace.
- **A placeholder alone on its line takes the line with it** when it has
  nothing to show, so a single-page result leaves no blank gap where the paging
  bars would be. A name nothing recognises renders as empty rather than
  throwing - a typo in the template must not take the page down.
- **The template is read once at startup.** Restart the server after editing
  it.

The stylesheet is read out of that file's `<style>` block and shared with the
404, 405 and error pages, so there is one place to restyle everything.

`readonly.test.js` fails the build if the template gains a script tag, an
inline event handler or an off-site URL - the server sends
`Content-Security-Policy: default-src 'none'`, so any of the three would fail
silently in a browser otherwise.

## 8. Paging and the page controls

50 products per page, `?page=N`. A page number that is out of range clamps to
the last page; anything that is not a positive whole number falls back to page
1. The limit and offset are query parameters, never interpolated text.

Measured: page 1 in 0.61s, page 500 in 0.44s.

The control bar - Previous, the current page position, Next - is rendered
**above and below the table**, from one function in `render.js`, so a long page
does not have to be scrolled back to the top to move on.

There is no second copy of the paging logic to keep in step. Both bars are
plain HTML links to `?page=N`, computed from the single page number the route
resolved, so whichever bar is used the same page is requested and both bars
redraw from it. A control with nowhere to go - Previous on page 1, Next on the
last page - renders as a disabled-looking span rather than a link, which is why
`page=0` never appears in the markup. On a single-page result neither bar is
rendered at all.

No JavaScript and no frontend framework is involved, in keeping with the rest
of the page.

## 9. Where a classification would be added

`classifyKeywords()` in `product-keywords/source.js`. It preserves any
confirmed recorded category and otherwise calls the pure title generator. A
missing value remains a blank cell. Adding a confirmed database source changes
only this input seam; the SQL, router, and renderer stay as they are.

`product-keywords/keyword-generator.test.js` verifies deterministic output,
the `Pendant Light` example, that each category is distinct, that attributes
only ever come from the name, that competitor terms name no brand, that the
logic is not keyed on a product id, and blank handling.
