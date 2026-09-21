/**
 * READ-ONLY: can inventory.products.id = 1 be linked to a real resource?
 */
import { rows, closePool } from './db.js';

const out = (l, v) => console.log(`\n=== ${l} ===\n${v ?? '(null)'}`);

try {
  // Product 1's sku
  const p1 = await rows(`SELECT id, sku, title FROM inventory.products WHERE id = 1`);
  const sku = p1[0].sku;
  out('product 1', JSON.stringify(p1[0]));

  // Does listings.amazon_listing_search_engine_keywords.product_id match
  // inventory.products.id, or listings.amazon_listings.id, or something else?
  const sek = await rows(`SELECT min(product_id) lo, max(product_id) hi, count(*) n FROM listings.amazon_listing_search_engine_keywords`);
  out('amz sek product_id range', JSON.stringify(sek[0]));
  const amz = await rows(`SELECT min(id) lo, max(id) hi, count(*) n FROM listings.amazon_listings`);
  out('amazon_listings.id range', JSON.stringify(amz[0]));
  const prod = await rows(`SELECT min(id) lo, max(id) hi, count(*) n FROM inventory.products`);
  out('inventory.products.id range', JSON.stringify(prod[0]));

  // Is product 1's own amazon listing ASIN present in the sek table's product_id?
  const amz1 = await rows(`SELECT id, asin, sku FROM listings.amazon_listings WHERE sku = $1`, [sku]);
  out('amazon_listings for sku', JSON.stringify(amz1));
  if (amz1.length) {
    const hit = await rows(
      `SELECT * FROM listings.amazon_listing_search_engine_keywords WHERE product_id = $1 LIMIT 5`,
      [amz1[0].id],
    );
    out('sek rows for that amazon listing id', JSON.stringify(hit, null, 2));
  }

  // Any row in amazon_campaigns.search_term_sku_data for product 1's sku?
  const st = await rows(
    `SELECT count(*)::int n FROM amazon_campaigns.search_term_sku_data WHERE sku = $1`, [sku]);
  out('search_term_sku_data rows for sku', st[0].n);
  const stx = await rows(
    `SELECT * FROM amazon_campaigns.search_term_sku_data WHERE sku = $1 LIMIT 5`, [sku]);
  out('search_term_sku_data rows for sku (detail)', JSON.stringify(stx, null, 2));

  // Any ebay listing for sku?
  const eb = await rows(`SELECT * FROM listings.ebay_listings WHERE sku = $1 LIMIT 3`, [sku]);
  out('ebay_listings for sku', JSON.stringify(eb, null, 2));

  // Does inventory hold a "supplier"/source join table anywhere referencing product?
  const tbls = await rows(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND table_name ILIKE '%product%' ORDER BY 1,2`);
  out('tables with "product" in name', tbls.map((t) => `${t.table_schema}.${t.table_name}`).join('\n'));

  // suppliers schema: is there a product<->supplier link?
  const supcols = await rows(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='suppliers' ORDER BY table_name, ordinal_position`);
  out('suppliers schema columns', supcols.map((c) => `${c.table_name}.${c.column_name}`).join('\n'));
} catch (e) {
  console.error('FAILED:', e.message);
} finally {
  await closePool();
}
