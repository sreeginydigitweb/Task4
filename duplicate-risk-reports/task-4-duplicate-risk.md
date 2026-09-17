# Duplicate risk - Task 4

Discovery found one project in the estate doing something closely related:
**Smart Inventory Control** (`../Inventory System`, repo
`sreeginydigitweb/InventorySystem`). It reads the same `ledsone` database and
renders HTML tables with a SKU and Product column.

## What was reused rather than rewritten

| Existing file | What Task 4 did |
|---|---|
| `Inventory System/inventory/db.js` | **Copied the implementation pattern** - pg Pool, the `default_transaction_read_only=on` latch, `query`/`rows`/`firstRow`, and the `checkConnection()` startup refusal. Adapted to two schemas (`inventory`, `listings`) instead of four, and to this project's application name. |
| `inventory/render.js` | **Copied the approach** - `escapeHtml()`, `layout()`, `tableOrEmpty()`, the `Not recorded` convention (there `NOT_IN_SOURCE`, here `NOT_RECORDED`). |
| `inventory/router.js` | **Copied the approach** - a `switch` on a normalised path returning `{status, contentType, body}`. |
| `inventory/server.js` | **Copied the approach** - `node:http`, security headers, startup connection check, signal handling. |
| `inventory/.env.example` | **Copied the structure and the read-only preamble.** |
| The 12-folder skeleton | **Reused** - identical folder set to the other three repos in the estate. |

## What was deliberately built fresh

- **The SQL.** `Inventory System/inventory/source.js` has no keyword query;
  its product query selects stock, supplier and listing fields Task 4 does not
  need. A new, narrower statement was written.
- **`classifyKeywords()`.** No equivalent exists anywhere in the estate.
- **`readonly.test.js`.** No equivalent exists; written because Task 4 has
  constraints (one database, no writes) worth asserting in code rather than
  trusting to comments.

## What was NOT duplicated

- **No second ledsone connection library.** `db.js` is the pattern, copied once.
- **No second products listing page.** Task 4 does not reproduce
  `/products`; it serves one route, `/product-keywords`, with a different
  purpose.
- **No shared code was imported across project boundaries.** Task 4 is
  self-contained: it does not `import` from `../Inventory System`, which would
  couple two separately versioned repositories.

## Inventory System was not modified

Verified: `git -C "../Inventory System" status` reports a clean tree. No file
outside `Task 4` was created, edited or deleted.

## Residual risk

Two copies of the same connection pattern now exist in the estate
(`Inventory System/inventory/db.js` and `Task 4/product-keywords/db.js`). A fix
to one - a pool setting, a new safety check - will not reach the other. That is
a deliberate trade: the alternative is a shared package, which neither project
is set up to consume and which would tie their release cycles together. Worth
revisiting if a third project needs the same connection.
