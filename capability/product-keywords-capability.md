# Capability - Product Keywords

What this application can and cannot do, as built.

## Can

- Read the `ledsone` product catalogue (`inventory.products`, 44,599 rows) and
  show SKU, Product ID and Product Name.
- Show the Amazon search-engine keyword text recorded against a product,
  reached through the product's Amazon listing, de-duplicated and in the order
  the source records.
- Page through the catalogue 50 products at a time, at roughly half a second
  per page regardless of how deep the page is.
- Refuse to start if the database is not `ledsone`, if the connection is not
  read-only, or if the role can write to the source.
- Escape every database value before it reaches the page.

## Cannot

- **Classify keywords.** Primary, Secondary, Long-Tail and Competitor all show
  `Not recorded`, because ledsone records no such classification. Competitor
  keywords have no source in ledsone of any kind.
- **Write anything.** No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP or
  TRUNCATE exists in the codebase, and the connection is read-only at the
  server.
- **Read a second database.** No configuration reaches
  `order_management_copy`, where the classified keyword and competitor tables
  live.
- **Search or filter.** One route, paged. No search box, no sorting, no
  filters - none were asked for.
- **Edit, export or report.** No CRUD, no admin interface, no dashboard.

## Coverage, honestly stated

Keyword text is partial: on a sample page of 50 products, 24 carried any. The
keyword text is multilingual and unedited. Whether the remaining products
genuinely have no keywords, or have keywords this relationship does not reach,
has not been established.
