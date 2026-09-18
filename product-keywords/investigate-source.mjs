/**
 * READ-ONLY investigation of ledsone for a real keyword SOURCE resource.
 *
 * Temporary script for Task 4 keyword-source investigation. Only SELECTs.
 * Reports which tables/columns could name a real external resource
 * (a platform, website or marketplace) that a Primary Keyword came from.
 */
import { rows, closePool } from './db.js';

const out = (label, value) => console.log(`\n=== ${label} ===\n${value}`);

try {
  // 1. Every schema.
  const schemas = await rows(
    `SELECT string_agg(DISTINCT table_schema, ', ' ORDER BY table_schema) AS s
     FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog','information_schema')`,
  );
  out('schemas', schemas[0]?.s);

  // 2. Any column that could name a source / platform / website / marketplace.
  const sourceCols = await rows(
    `SELECT table_schema, table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND ( column_name ILIKE '%source%'   OR column_name ILIKE '%platform%'
          OR column_name ILIKE '%website%'  OR column_name ILIKE '%marketplace%'
          OR column_name ILIKE '%supplier%' OR column_name ILIKE '%origin%'
          OR column_name ILIKE '%site%'     OR column_name ILIKE '%store%'
          OR column_name ILIKE '%channel%'  OR column_name ILIKE '%vendor%'
          OR column_name ILIKE '%polycrome%')
     ORDER BY table_schema, table_name, column_name`,
  );
  out('source-like columns', sourceCols.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name} (${r.data_type})`).join('\n'));

  // 3. Any table whose NAME mentions a source/marketplace/supplier.
  const srcTables = await rows(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND ( table_name ILIKE '%source%'   OR table_name ILIKE '%supplier%'
          OR table_name ILIKE '%marketplace%' OR table_name ILIKE '%platform%'
          OR table_name ILIKE '%website%'  OR table_name ILIKE '%vendor%')
     ORDER BY table_schema, table_name`,
  );
  out('source-like tables', srcTables.map((r) => `${r.table_schema}.${r.table_name}`).join('\n'));

  // 4. Grep the source-like / url-like text columns for the literal 'polycrome'.
  const textCols = await rows(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND data_type IN ('text','character varying','character')
       AND ( column_name ILIKE '%url%'      OR column_name ILIKE '%link%'
          OR column_name ILIKE '%source%'   OR column_name ILIKE '%supplier%'
          OR column_name ILIKE '%marketplace%' OR column_name ILIKE '%platform%'
          OR column_name ILIKE '%site%'     OR column_name ILIKE '%domain%'
          OR column_name ILIKE '%name%'     OR column_name ILIKE '%origin%' )
     ORDER BY table_schema, table_name, column_name`,
  );
  const hits = [];
  for (const c of textCols) {
    try {
      const q = `SELECT count(*)::int AS n FROM "${c.table_schema}"."${c.table_name}"
                 WHERE "${c.column_name}" ILIKE '%polycrome%'`;
      const r = await rows(q);
      if (r[0]?.n > 0) hits.push(`${c.table_schema}.${c.table_name}.${c.column_name} = ${r[0].n}`);
    } catch (e) {
      // skip tables that reject the count (permissions etc.)
    }
  }
  out('columns containing "polycrome"', hits.join('\n') || '(none)');

  // 5. Distinct URL-like hosts anywhere in text columns (find real websites).
  const hostRows = [];
  const urlCols = await rows(
    `SELECT table_schema, table_name, column_name
     FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND data_type IN ('text','character varying','character')
       AND ( column_name ILIKE '%url%' OR column_name ILIKE '%link%'
          OR column_name ILIKE '%href%' OR column_name ILIKE '%domain%'
          OR column_name ILIKE '%site%' )
     ORDER BY table_schema, table_name, column_name`,
  );
  for (const c of urlCols) {
    try {
      const q = `SELECT DISTINCT (regexp_match("${c.column_name}", 'https?://([^/]+)'))[1] AS host
                 FROM "${c.table_schema}"."${c.table_name}"
                 WHERE "${c.column_name}" ~ '^https?://' LIMIT 50`;
      const r = await rows(q);
      for (const x of r) if (x.host) hostRows.push(`${c.table_schema}.${c.table_name}.${c.column_name}: ${x.host}`);
    } catch (e) {
      // skip
    }
  }
  out('URL hosts found in url-like columns', hostRows.join('\n') || '(none)');

  // 6. suppliers schema tables and a sample.
  const supplierTables = await rows(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'suppliers' ORDER BY table_name`,
  );
  out('suppliers tables', supplierTables.map((r) => r.table_name).join('\n'));

  // 7. inventory.products columns (does the product row name a source?).
  const prodCols = await rows(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'inventory' AND table_name = 'products'
     ORDER BY ordinal_position`,
  );
  out('inventory.products columns', prodCols.map((c) => `${c.column_name} (${c.data_type})`).join('\n'));

  // 8. Product ID 1 exactly, as required.
  const p1 = await rows(`SELECT * FROM inventory.products WHERE id = 1`);
  out('inventory.products WHERE id = 1', JSON.stringify(p1, null, 2));
} catch (error) {
  console.error('INVESTIGATION FAILED:', error.message, error.code ?? '');
} finally {
  await closePool();
}
