# Task 4 - Product Keywords

A read-only HTML view of product and keyword data from the existing **ledsone**
PostgreSQL database.

One page, one table, no framework. Node 20 with a single dependency (`pg`) and
hand-rendered HTML.

```
ledsone DB  ->  SQL query  ->  Node application  ->  HTML table
```

## Purpose

Show the product catalogue alongside the keyword data recorded against each
product, in the table structure requested:

SKU · Product ID · Product Name · Primary Keyword · Secondary Keywords ·
Long-Tail Keywords · Competitor Keywords

Three of those seven columns are backed by ledsone. Four are not, and their
cells are intentionally blank rather than being filled with invented values. See **Current data limitations** below -
it is the most important section in this file.

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
npm test     # 39 tests, no database required
```

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
| SKU | `inventory.products.sku` |
| Product ID | `inventory.products.id` |
| Product Name | `inventory.products.title` (there is no `product_name` column) |

**Not in ledsone - intentionally blank:**

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

## Keyword classifications are not invented

This is a deliberate constraint, not an unfinished feature.

The page does not derive Primary from an EXACT match type, Secondary from
PHRASE or BROAD, or Long-Tail from word count. Those are business rules that
have not been agreed, and applying one would put a claim on the page that the
business has never made and that cannot be checked against anything in the
source. Competitor Keywords cannot be derived at all - ledsone holds no
competitor data.

So the four unavailable categories render as actual empty `<td></td>` cells.
There is no unclassified-keywords column.

Six tests in `product-keywords/source.test.js` assert that all four categories
return `null`, and a test in `render.test.js` extracts every table cell and
asserts that none of them contains the words Primary, Secondary, Long-Tail or
Competitor. If a classification is introduced later, those tests fail - which
is the point. It should be a deliberate change, not a quiet one.

**When the rules are agreed**, the single place to change is
`classifyKeywords()` in `product-keywords/source.js`. The SQL, the router and
the renderer do not need to change.

## Layout

```
product-keywords/     the application
  db.js                 pg Pool, read-only latch, startup check
  source.js             the product SELECTs and classification seam
  render.js             HTML string building and escaping
  router.js             paths and page numbers
  server.js             node:http server and security headers
  *.test.js             39 tests, no database required
  .env.example          documented configuration template

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
