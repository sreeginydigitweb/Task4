# Capability - Product Keywords

What this application can and cannot do, as built.

## Can

- Read the `ledsone` product catalogue (`inventory.products`, ~44,600 rows) and
  show SKU, Product ID and Product Name.
- Show each product's picture, from `inventory.product_media`
  (`type = 'main-image'`) falling back to `inventory.product_images` - the rule
  Smart Inventory Control already uses. About one product in six has no image;
  those cells stay blank.
- Generate deterministic Primary, Secondary, Long-Tail and Competitor keywords
  from Product Name when a confirmed classified database value is unavailable,
  preserving any recorded value it does find.
- Fill the four keyword columns for any product whose name carries recognised
  product terminology - measured at 72-75% of the first 5,000 products for the
  three generated categories, and 100% for Primary.
- Page through the catalogue 50 products at a time, at roughly half a second
  per page regardless of how deep the page is, with the same control bar above
  and below the table.
- Refuse to start if the database is not `ledsone`, if the connection is not
  read-only, or if the role can write to the source.
- Escape every database value before it reaches the page.

## Cannot

- **Invent product facts or competitor brands.** The fallback uses only title
  text and generic product-type terminology. It does not name companies or add
  unsupported specifications; a category remains blank when it cannot form a
  meaningful term.
- **Store a generated keyword.** Generation happens per request, for the HTML
  view only. No keyword row is created, updated or cached anywhere, and there
  is no persistence mechanism to do it with.
- **Invent a product image.** A product the database holds no image for gets an
  empty cell - no placeholder graphic, no stand-in URL, and no image fetched
  from anywhere but the hosts ledsone's own image URLs already point at. A
  stored value that is not an `http`/`https` address is treated as no image.
- **Load anything else from off-site.** `Content-Security-Policy` still sets
  `default-src 'none'`; `img-src` names the two product-image hosts and
  nothing more.
- **Follow a Keyword Guidance PDF.** No such file exists in this repository.
  The documented fallback rules in `keyword-generator.js` stand in until real
  guidance is supplied, and nothing claims to quote guidance that is not here.
- **Write anything.** No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP or
  TRUNCATE exists in the codebase, and the connection is read-only at the
  server.
- **Read a second database.** No configuration reaches
  `order_management_copy`, where the classified keyword and competitor tables
  live.
- **Search or filter.** One route, paged. No search box, no sorting, no
  filters - none were asked for.
- **Edit, export or report.** No CRUD, no admin interface, no dashboard.
