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

A filter card above the table holding **Search**, **Categories** and **Clear
Filters**. It is an ordinary GET form: the page reloads as
`?search=...&category=...`. **No JavaScript** - the server does the filtering,
so the live page stays script-free.

Search matches the **SKU** or the **Product Name** on any part of the value,
and the **Product ID** exactly - so searching `2` returns product 2 rather
than every id containing a 2. The text reaches PostgreSQL as a parameter, never
as SQL, and the `%` wrappers are added to the parameter value, so a `%` typed
in the box is matched literally.

- **All Categories** is the empty value, which the router reads as no filter.
- Options are listed busiest first with their product counts, because the
  catalogue has hundreds of marketplace categories and most cover few products.
- The count line reports the filtered total, not the catalogue total.
- **Both filters are carried on every paging link**, so Next from page 3
  of "Wall Light" lands on page 4 of "Wall Light", and a search survives paging
  the same way.
- A **Clear Filters** link appears only while a filter is on.
- A category that no longer exists is treated as no filter rather than as an
  error, so a stale bookmark shows the catalogue instead of a failure.

The `Content-Security-Policy` `form-action` directive moved from `'none'` to
`'self'` for this form. It was `'none'` while the page had no form at all;
`'self'` still refuses to let a form here submit anywhere else. The filter
changes nothing - it selects which rows are read.

## 4. Keyword sources investigated

Six keyword-bearing tables exist in ledsone. Each was examined against the
requirement **that it supply a primary/secondary/long-tail/competitor
CLASSIFICATION**, and none does - that is what "not used" means below.

Most of them ARE read now, for a different question: not what a keyword's
category is, but which real resource supplied it. See section 6a and
`resources.js`. A table can be useless for classification and still be solid
evidence of provenance, and several here are exactly that.

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

### Where each keyword actually comes from

Traced through the code, not inferred. `generateKeywordTerms()` in
`keyword-generator.js` is the single generator, and it records the input for
every term it produces.

| Category | What produces it |
|---|---|
| **Primary** | The `primary` string of the matched `PRODUCT_TYPES` entry. The Product Name **selects** the entry by regex; the word itself is written in `keyword-generator.js`. Unmatched names instead get a shortened phrase of the Product Name. |
| **Secondary** | The entry's `secondary` array (curated synonyms), plus up to two attribute words **read literally out of the Product Name**. |
| **Long-Tail** | Product Name attributes qualifying the entry's `primary` (`Vintage Brass Door Handle`), or the entry's `longTail` string when the name supplies no attribute. |
| **Competitor** | The entry's `competitor` array only. Never a competitor product, brand or seller, and never another product's data. |

**Worked example — why "Door Pull" is a Secondary Keyword.** For
`12.8cm Brass Pull and Push Door Handle, …`:

1. `matchProductType()` tests `/\bdoor\s+handles?\b/i` against the **Product
   Name** and selects the Door Handle entry.
2. That entry reads
   `secondary: ['Door Pull', 'Pull Handle']` — hand-written terminology in
   `keyword-generator.js`.
3. `productAttributes()` finds `Vintage` and `Brass` **in the title text**.
4. The cell is the two curated synonyms plus the two title words.

So "Door Pull" came from the **terminology map, selected by the Product Name**.
It was *not* derived from the Primary Keyword, *not* from competitor data, and
*not* from the database. "Brass" in the same cell came from a different input —
the Product Name itself.

### The RESOURCE rules

The pill names **the real data resource that supplied the keyword** — Amazon,
eBay, one of ledsone's storefronts, Google Search Console. It never names a
method. There is no `GEN`, no `Generated`, no `Terminology`, no `Product Name`
and no `Product Type`: those say how the application arrived at the wording,
which is a different question from where the word came from, and only the
second one tells the reader where to go and check.

This applies to **all four** keyword columns alike.

#### A tag has to be earned

A resource supplied a keyword when **that keyword's words actually appear, as a
consecutive phrase, in a real record that resource holds against this product**.
Nothing weaker counts.

In particular, a product merely *being listed* on Amazon does not prove Amazon
supplied the word "Door Handle". That is an assumption about a platform, not
evidence about a word, and tagging on it would invent a provenance the data
cannot support. The product must be listed there **and** the record must
contain the phrase.

Matching folds plurals — a listing saying `Door Handles` proves the keyword
`Door Handle` — and ignores case and punctuation. It will not fold `brass` to
`bras`, and it requires the words to be **consecutive**:

| Keyword | Record | Proven? |
|---|---|---|
| `Cupboard Handle` | `cupboard handles vintage` | yes |
| `Cupboard Handle` | `Kitchen Cupboard Wardrobe Door Handles` | **no** — both words present, different things |
| `Door Pull` | `Cupboard Door Drawer Pull Handles` | **no** — `Door Drawer Pull` is not `Door Pull` |
| `Brass` | `brasserie lighting` | **no** — whole words only |

#### Where the evidence comes from

Each record carries the exact table and column it was read from, and the pill's
tooltip quotes **the record that actually matched**, so any tag on the page can
be checked against the row that justifies it.

| Resource | Record | Joined by |
|---|---|---|
| **Amazon** | `listings.amazon_listing_search_engine_keywords.keyword` — the seller's own backend search terms | SKU → `amazon_listings.id` |
| **Amazon** | `business_reports.amz_search_query_performance.search_query` — real shopper queries | SKU → `amazon_listings.asin` |
| **Amazon** | `amazon_campaigns.search_term_performance_data.search_term` | `search_term_sku_data.sku` |
| **Amazon** | `listings.amazon_listings.title` | SKU |
| **Google Search Console** | `google_search_console.query_page.query` — real Google queries for the product's page | SKU → Shopify `listing_url` → `query_page.page` |
| **a named storefront** | `listings.shopify_listing_tag.tag`, `shopify_listings.title` | SKU → child listing → parent |
| **eBay** | `listings.ebay_listings.title` | SKU |
| **B&Q** | `listings.bandq_listings.title` | SKU |
| *(no pill)* | nothing holds the phrase | — |

When one keyword is proven by several records at once — which is common — the
**strongest kind** wins, so the tag names the most direct evidence: backend
search keywords first, then a real search query, then a filed tag, then a
listing title.

#### This supersedes the earlier rule

An earlier version of this view deliberately refused to name Amazon, eBay or
Google, on the grounds that the application did not read their keyword data and
labelling a word `Amazon` because Amazon happened to hold it would be inventing
provenance. That reasoning was right, and it is what the evidence rule above now
satisfies rather than abandons: the application **does** read those records now,
and a resource is named only when its own record contains the word.

The four old pills — `Product Type`, `Product Name`, `Product Name + Type`,
`Database` — named a method, so they are gone from the page, and their colours
are gone from the stylesheet. The generator still records *how* it produced each
wording, on the term's `input` field; the page does not show it.

#### Storefronts are named as businesses

ledsone runs ten Shopify storefronts. A keyword proven from one says
**`Electricalsone`** or **`Vintagelite`** — the real business a reader could
visit — rather than "Shopify", which is only the software it runs on. They share
one pill colour.

#### Variants share their parent's evidence

Variants of one product are several SKUs behind one Shopify parent listing, so
they share its tags, its page URL and therefore its Google queries. Every lookup
from a shared key back to a SKU is one-to-many for that reason.

### How a keyword is displayed

Each keyword is **ordinary dark body text** — no colour, no chip, no
background — with a small coloured **pill** on the line **below** it naming its
resource. The pill is the only coloured thing in the cell, and it is **not a
separate column**; the table still has the four keyword columns and nothing
more. The keyword is never inside the pill.

One colour per **resource**, never per keyword:

| Pill | Colour |
|---|---|
| `Amazon` | white on amber `#8a5200` |
| `eBay` | white on red `#a4232b` |
| a storefront (`Electricalsone`, `Vintagelite`, …) | white on green `#3f6e2a` |
| `B&Q` | white on ochre `#9a5d00` |
| `Google Search Console` | white on blue `#1b5e9c` |

Product ID 1 renders exactly this:

```
Door Handle                 Vintage
Google Search Console       Amazon

                            Brass
Door Pull                   Amazon
(no tag)
                            Pull Handle
Vintage Brass Door Handle   Amazon
(no tag)
Cabinet Handle              Cupboard Handle
Amazon                      Google Search Console
```

`Door Pull` and `Vintage Brass Door Handle` carry **no tag**: no record held
against this product contains either phrase. That is the honest outcome, and it
is deliberately preferred to naming a method.

A blank keyword cell shows no tag at all.

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

The table has exactly nine columns. There is no unclassified-keywords column,
no keyword-source column and no Tags column: a keyword's RESOURCE pill sits
underneath the keyword itself, inside that keyword's own cell.

## 6b. The Tags column was removed

The table used to carry a tenth column of ledsone's own stored product tags,
read from `listings.shopify_listing_tag`. That column is gone. The table is the
nine columns above, and nothing on the page draws a product tag.

Three things are worth separating, because they are easy to confuse:

- **The RESOURCE pills stay.** They were never product tags. They sit inside
  the keyword cells, below their own keyword, and name where that keyword came
  from. Removing the Tags column did not touch them: the pill counts on a page
  are unchanged.
- **`shopify_listing_tag` is still read**, but only as *evidence*. A tag the
  business filed against a product can prove that a keyword came from that
  storefront, in which case the pill names the storefront - `Electricalsone`,
  `Vintagelite`. It never reaches the page as a tag of its own. See
  `resources.js`.
- **The query still fetches the tags.** `source.js` keeps its `product_tags`
  CTE and every row still carries a `tags` array; nothing reads it. It was left
  in place deliberately rather than removed as part of a presentation change.
  It costs roughly 300ms of the page query, so it is worth removing when the
  database layer is next touched.

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
