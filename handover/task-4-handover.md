# Handover - Task 4, Product Keywords

Assumes no knowledge of the conversation this was built in.

## What this is

A read-only HTML view of the existing `ledsone` PostgreSQL database. One page,
one table: the product catalogue with the keyword text recorded against each
product.

## Where it is

```
Task 4/
  product-keywords/     the application (5 modules + 4 test files)
  sql/                  the SQL, readable outside the JavaScript
  data-maps/            column-by-column source map
  documentation/        how it works
  evidence/             command output proving the claims
  validation/           the ten checks and their results
  ... plus the rest of the 12-folder standard
```

## Running it

```
npm install
cp product-keywords/.env.example product-keywords/.env
# fill in DB_HOST, DB_USER, DB_PASSWORD
npm start
```

Then open <http://localhost:3100/product-keywords>.

Requires Node 20+. One dependency, `pg`.

`product-keywords/.env` is gitignored and must stay that way - it holds the
real credentials. `.env.example` is the committed template and contains none.

The role in `DB_USER` must hold **SELECT only**. The application checks at
startup and refuses to run if the role can write to `inventory.products`.

## State

**Finished and working:** SKU, Product ID, Product Name, and the keyword text
ledsone holds. 41 tests pass. Verified against the live database on
17 September 2026.

**Not finished, and blocked on a decision, not on code:** Primary Keyword,
Secondary Keywords, Long-Tail Keywords and Competitor Keywords. All four render
as `Not recorded` because ledsone holds no such classification. This was
checked across all eighteen schemas, not assumed - see
`data-maps/product-keywords-data-map.md`.

## The decision waiting on someone else

The four keyword categories need a source. There are three options, and the
choice is a business one:

1. **Derive them from ledsone.** `amazon_campaigns.keywords.match_type`
   (EXACT/PHRASE/BROAD) could stand in for primary/secondary, and word count
   for long-tail. Both are rules nobody has approved, PPC data covers only
   10.7% of products, and Competitor would stay permanently empty. Discovery
   was explicitly instructed not to apply these.
2. **Read the second database.** `order_management_copy.listing_generator`
   holds the real classified keyword and competitor tables
   (`amazon_competitors`, `tbl_h10_cerebro_keywords`,
   `autocomplete_sku_seed_keyword` with its `is_primary_seed` flag). It is a
   different database on a different host. This version was explicitly told not
   to read it.
3. **Leave them as `Not recorded`** and treat the current page as complete for
   what ledsone can honestly supply.

## Where the change goes when the decision is made

`classifyKeywords()` in `product-keywords/source.js`. One function. It takes
the keyword strings for a product and returns one value per category; `null`
means "the database does not say" and renders as `Not recorded`.

The SQL, the router and the renderer do not need to change to switch a
category on. That is why the decision lives in a function of its own.

Note that `product-keywords/source.test.js` asserts all four are currently
`null`. Those tests are meant to fail when the rules change - update them
deliberately, as part of the same change.

## Traps worth knowing about

- **`amazon_listing_search_engine_keywords.product_id` is not a product id.**
  It references `listings.amazon_listings.id`. Zero of its 189,983 rows match
  `inventory.products.id`. Joining it straight to products returns an empty
  result with no error. Always go through `amazon_listings`.
- **There is no `product_name` column.** It is `inventory.products.title`.
- **One SKU can have several Amazon listings**, so keyword text arrives
  duplicated. The query already collapses this with `DISTINCT ON`.
- **Keyword text is multilingual and long** - German, French, Italian and Dutch
  all appear, some strings several hundred characters. It is shown as recorded.

## Git

The repository is initialised but has **no commits and no remote**. Nothing has
been committed or pushed. A remote needs creating, and the first commit needs
making, once the build is approved.
