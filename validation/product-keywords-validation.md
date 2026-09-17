# Validation - Product Keywords

Ten checks were asked for. Each is recorded below with its result. Raw command
output is in `evidence/build-verification.md`.

| # | Check | Result |
|---|---|---|
| 1 | Install only required dependencies | **Pass** - one direct dependency, `pg`. 14 packages total including its own. |
| 2 | Run the application locally | **Pass** - starts on port 3100. |
| 3 | Test the database connection | **Pass** - `reading ledsone as varmen_user - read-only connection: yes, no write privileges.` |
| 4 | Test the `/product-keywords` route | **Pass** - HTTP 200, 42,725 bytes. |
| 5 | Confirm the response is valid HTML | **Pass** - all tags balanced; 400 `<td>` for 50 rows x 8 columns. |
| 6 | Confirm database values are HTML escaped | **Pass** - zero bare ampersands, zero stray `<` in text nodes; injection payloads neutralised in unit tests. |
| 7 | Confirm no INSERT/UPDATE/DELETE SQL exists | **Pass** - asserted by `readonly.test.js` over every application module. |
| 8 | Confirm no second database is used | **Pass** - asserted by `readonly.test.js`; no reference to `order_management_copy`, `listing_generator` or `amazon_competitors`. |
| 9 | Confirm Inventory System is not modified | **Pass** - `git -C "../Inventory System" status` clean; no file written outside `Task 4`. |
| 10 | Run available tests | **Pass** - 41 tests, 41 passing, 0 failing. |

## Does the page return real ledsone data?

Yes. The count line reads **44,599 products**, which is the true row count of
`inventory.products`. SKUs (`HLBP128BB`, `RD20`, `LHAHE27RO`), product ids and
titles are the real catalogue, and the keyword text shown against
`LHAHE27RO` is the two rows ledsone actually holds for that product's Amazon
listing.

## Factual validation - does the page avoid claiming anything untrue?

This is the check that matters most for this task, because the four requested
keyword categories do not exist in the source.

| Claim the page could have made | Does it? |
|---|---|
| That a keyword is the Primary one | No - `Not recorded` |
| That keywords are Secondary | No - `Not recorded` |
| That keywords are Long-Tail | No - `Not recorded` |
| That keywords are Competitor keywords | No - `Not recorded` |
| That the keyword text it shows is classified | No - the column heading says "unclassified" |

Three tests enforce this rather than leaving it to review:

- `render.test.js` - *"the page never labels keyword text as Primary,
  Secondary, Long-Tail or Competitor"* extracts every `<td>` on a rendered page
  and asserts that none contains any of the four words.
- `render.test.js` - *"an unclassified category renders as Not recorded, not as
  a blank cell"* asserts exactly four honest cells per row.
- `source.test.js` - six tests assert `classifyKeywords()` returns `null` for
  all four categories, including for inputs specifically shaped to tempt a
  derivation (a single keyword, a long phrase, competitor-sounding text).

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
