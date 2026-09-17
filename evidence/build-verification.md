# Build verification - 17 September 2026

Commands as run, and what they returned. Everything below was executed against
the live `ledsone` database from this machine.

## 1. Dependency install

```
$ npm install --no-audit --no-fund
added 14 packages in 2s
```

One direct dependency (`pg`); the rest are its own.

## 2. Test suite

```
$ npm test
ℹ tests 41
ℹ suites 0
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 561.4265
```

## 3. Database connection and read-only check

```
$ node product-keywords/server.js
[product-keywords] running on http://localhost:3100/product-keywords
[product-keywords] reading ledsone as varmen_user - read-only connection: yes, no write privileges.
```

The second line is the startup check reporting back: the database is `ledsone`,
`transaction_read_only` is `on`, and `has_table_privilege()` confirms the role
holds no INSERT, UPDATE or DELETE on `inventory.products`. The application
refuses to start if any of the three is not true.

## 4. The route

```
$ curl -s -D - -o /tmp/pk.html "http://localhost:3100/product-keywords"
HTTP/1.1 200 OK
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'
x-content-type-options: nosniff
referrer-policy: no-referrer
content-type: text/html; charset=utf-8

$ wc -c < /tmp/pk.html
42725
```

## 5. Real ledsone data on the page

```
$ grep -oE '<p class="count">[^<]*' /tmp/pk.html
<p class="count">Showing 1&ndash;50 of 44,599 products.

$ grep -oE '<tr><td class="sku">.{0,200}' /tmp/pk.html | head -1
<tr><td class="sku">HLBP128BB</td><td class="num">1</td><td class="name">12.8cm Brass Pull and Push Door Handle, Solid Antique Vintage Style Body, ...
```

44,599 is the true row count of `inventory.products`. The SKUs, product ids and
titles are the real catalogue.

A product with keyword text, rendered in full:

```
$ grep -oE '<tr><td class="sku">LHAHE27RO</td>.{0,700}' /tmp/pk.html
<tr><td class="sku">LHAHE27RO</td><td class="num">8</td>
<td class="name">Vintage Antique Retro Metal Bulb Socket Lamp Holder ...</td>
<td class="absent">Not recorded</td>
<td class="absent">Not recorded</td>
<td class="absent">Not recorded</td>
<td class="absent">Not recorded</td>
<td class="keywords"><ul class="kw">
  <li>E27 Screw Light Bulb Socket Holder, ES Lamp Holder Base, Edison Screw E27 Wall Socket, Ceiling Light Fitting, AC 220-250V</li>
  <li>portalampada portalampada E27 portalampada portalampada E27 lampadina a vite portalampade vintage E27 portalampada a vite portalampada edison.</li>
</ul></td></tr>
```

Four categories honestly `Not recorded`; the real keyword text in the eighth
column.

Keyword coverage on page 1:

```
$ grep -oc '<tr><td class="sku">' /tmp/pk.html     # product rows
50
$ grep -oc '<ul class="kw">' /tmp/pk.html          # rows carrying keyword text
24
```

## 6. Valid HTML

```
$ for t in tr td th ul li table; do ... done
tr: open=51 close=51        (50 products + 1 heading row)
td: open=400 close=400      (50 rows x 8 columns)
th: open=8 close=8
ul: open=24 close=24
li: open=51 close=51
table: open=1 close=1
```

Column headings, in order:

```
$ grep -oE "<th>[^<]*</th>" /tmp/pk.html
<th>SKU</th>
<th>Product ID</th>
<th>Product Name</th>
<th>Primary Keyword</th>
<th>Secondary Keywords</th>
<th>Long-Tail Keywords</th>
<th>Competitor Keywords</th>
<th>Keywords recorded in ledsone (unclassified)</th>
```

## 7. Escaping

```
$ grep -oP '&(?!amp;|lt;|gt;|quot;|#39;|ndash;|larr;|rarr;|middot;|ldquo;|rdquo;|rsquo;)' /tmp/pk.html | wc -l
0
$ grep -oE '>[^<>]*<[^/a-zA-Z!]' /tmp/pk.html | wc -l
0
```

No bare ampersand and no stray `<` in any text node across 42KB of
database-sourced output. The unit tests additionally push `<script>`,
`<img src=x onerror=...>` and quoted text through every cell and assert none of
it survives as markup.

## 8. Routing and paging

```
$ curl -s -D - -o /dev/null "http://localhost:3100/"          → 302, location: /product-keywords
$ curl -s -o /dev/null -w "%{http_code}" "http://localhost:3100/nope"   → 404
$ curl -s "...?page=3"        → Showing 101–150 of 44,599 products.
$ curl -s "...?page=99999"    → Showing 44,551–44,599 of 44,599 products.  Page 892 of 892
$ curl -s "...?page=DROP%20TABLE"  → Showing 1–50 of 44,599 products.
```

Out-of-range clamps to the last page; a nonsense parameter falls back to page 1
rather than erroring.

## 9. Writes are refused

```
$ curl -s -X POST -d "sku=X" "http://localhost:3100/product-keywords" -w "%{http_code}"
405
only reads the ledsone database. Nothing can be created, edited or deleted through it.
```

## 10. Performance

```
page 1:   0.607775s
page 500: 0.437454s
```

Page 500 is no slower than page 1, which is the paged LATERAL join behaving as
intended - the keyword lookup runs for fifty products, not for the catalogue.

## 11. The database was not modified

No INSERT, UPDATE, DELETE, CREATE, ALTER, DROP or TRUNCATE was issued at any
point during the build, and none exists in the codebase - asserted by
`readonly.test.js`, which strips comments and then scans every application
module for write statements. The connection carries
`default_transaction_read_only=on`, so the server would refuse one regardless.
