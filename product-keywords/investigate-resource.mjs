/**
 * READ-ONLY, TARGETED investigation (fast). Only SELECTs. Temporary.
 */
import { rows, closePool } from './db.js';

const out = (label, value) => console.log(`\n=== ${label} ===\n${value ?? '(null)'}`);

try {
  const c1 = await rows(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='listings' AND table_name='amazon_listing_search_engine_keywords'
     ORDER BY ordinal_position`,
  );
  out('amazon_listing_search_engine_keywords cols', c1.map((c) => `${c.column_name} (${c.data_type})`).join('\n'));
  try {
    const n = await rows(`SELECT count(*)::int n FROM listings.amazon_listing_search_engine_keywords`);
    out('amazon_listing_search_engine_keywords count', n[0].n);
    const s = await rows(`SELECT * FROM listings.amazon_listing_search_engine_keywords LIMIT 15`);
    out('amazon_listing_search_engine_keywords sample', JSON.stringify(s, null, 2));
  } catch (e) { out('amz sek sample', 'ERR: ' + e.message); }

  const c2 = await rows(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='listings' AND table_name='shopify_listing_meta' ORDER BY ordinal_position`,
  );
  out('shopify_listing_meta cols', c2.map((c) => `${c.column_name} (${c.data_type})`).join('\n'));
  try {
    const n = await rows(`SELECT count(*)::int n FROM listings.shopify_listing_meta`);
    out('shopify_listing_meta count', n[0].n);
    const s = await rows(`SELECT * FROM listings.shopify_listing_meta LIMIT 5`);
    out('shopify_listing_meta sample', JSON.stringify(s, null, 2));
  } catch (e) { out('shopify_listing_meta', 'ERR: ' + e.message); }

  try {
    const r = await rows(
      `SELECT * FROM listings.amazon_listing_search_engine_keywords WHERE keyword ILIKE '%door handle%' LIMIT 10`,
    );
    out('amz sek rows mentioning door handle', JSON.stringify(r, null, 2));
  } catch (e) { out('amz sek door handle', 'ERR: ' + e.message); }

  try {
    const m = await rows(`SELECT * FROM listings.market_place_id_mapping LIMIT 50`);
    out('market_place_id_mapping sample', JSON.stringify(m, null, 2));
  } catch (e) { out('market_place_id_mapping', 'ERR: ' + e.message); }

  try {
    const m = await rows(`SELECT * FROM listings.amazon_marketplaces LIMIT 50`);
    out('amazon_marketplaces', JSON.stringify(m, null, 2));
  } catch (e) { out('amazon_marketplaces', 'ERR: ' + e.message); }

  for (const t of ['source', 'sub_source']) {
    try {
      const s = await rows(`SELECT * FROM order_management.${t} ORDER BY 1 LIMIT 100`);
      out(`order_management.${t}`, JSON.stringify(s, null, 2));
    } catch (e) { out(`order_management.${t}`, 'ERR: ' + e.message); }
  }

  const kw2 = await rows(
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND column_name ILIKE '%keyword%' ORDER BY 1,2,3`,
  );
  out('all keyword columns', kw2.map((c) => `${c.table_schema}.${c.table_name}.${c.column_name}`).join('\n'));

  for (const t of ['keywords', 'search_term_sku_data']) {
    try {
      const c = await rows(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema='amazon_campaigns' AND table_name=$1 ORDER BY ordinal_position`, [t]);
      out(`amazon_campaigns.${t} cols`, c.map((x) => `${x.column_name} (${x.data_type})`).join('\n'));
      const s = await rows(`SELECT * FROM amazon_campaigns.${t} LIMIT 5`);
      out(`amazon_campaigns.${t} sample`, JSON.stringify(s, null, 2));
    } catch (e) { out(`amazon_campaigns.${t}`, 'ERR: ' + e.message); }
  }

  try {
    const c = await rows(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='google_ads' AND table_name='keywords' ORDER BY ordinal_position`);
    out('google_ads.keywords cols', c.map((x) => `${x.column_name} (${x.data_type})`).join('\n'));
    const s = await rows(`SELECT * FROM google_ads.keywords LIMIT 5`);
    out('google_ads.keywords sample', JSON.stringify(s, null, 2));
  } catch (e) { out('google_ads.keywords', 'ERR: ' + e.message); }

  const polyCols = await rows(
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND data_type IN ('text','character varying','character')
       AND (column_name ILIKE '%url%' OR column_name ILIKE '%source%'
            OR column_name ILIKE '%site%' OR column_name ILIKE '%supplier%'
            OR column_name ILIKE '%name%' OR column_name ILIKE '%store%'
            OR column_name ILIKE '%vendor%' OR column_name ILIKE '%origin%')
     ORDER BY 1,2,3`);
  const poly = [];
  for (const c of polyCols) {
    try {
      const r = await rows(
        `SELECT count(*)::int n FROM "${c.table_schema}"."${c.table_name}"
         WHERE "${c.column_name}" ILIKE '%polycrome%'`);
      if (r[0]?.n > 0) poly.push(`${c.table_schema}.${c.table_name}.${c.column_name} = ${r[0].n}`);
    } catch { /* skip */ }
  }
  out('polycrome columns', poly.join('\n') || '(none)');
} catch (error) {
  console.error('INVESTIGATION FAILED:', error.message, error.code ?? '');
} finally {
  await closePool();
}
