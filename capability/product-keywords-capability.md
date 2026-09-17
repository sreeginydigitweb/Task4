# Capability - Product Keywords

What this application can and cannot do, as built.

## Can

- Read the `ledsone` product catalogue (`inventory.products`, 44,599 rows) and
  show SKU, Product ID and Product Name.
- Page through the catalogue 50 products at a time, at roughly half a second
  per page regardless of how deep the page is.
- Refuse to start if the database is not `ledsone`, if the connection is not
  read-only, or if the role can write to the source.
- Escape every database value before it reaches the page.

## Cannot

- **Classify keywords.** Primary, Secondary, Long-Tail and Competitor are blank
  cells because ledsone records no such classification. Competitor keywords
  have no source in ledsone of any kind.
- **Write anything.** No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP or
  TRUNCATE exists in the codebase, and the connection is read-only at the
  server.
- **Read a second database.** No configuration reaches
  `order_management_copy`, where the classified keyword and competitor tables
  live.
- **Search or filter.** One route, paged. No search box, no sorting, no
  filters - none were asked for.
- **Edit, export or report.** No CRUD, no admin interface, no dashboard.
