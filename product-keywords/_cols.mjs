import { rows, closePool } from './db.js';
try {
  for (const t of ['amazon_listings','ebay_listings','shopify_listings','bandq_listings']) {
    const c = await rows(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='listings' AND table_name=$1
         AND column_name IN ('sku','mapped_sku','parent_sku','is_ended','wrong_sku','status','site','channel','updated_at','id')
       ORDER BY column_name`, [t]);
    console.log(`${t}: ${c.map(x=>x.column_name).join(', ')}`);
  }
} catch (e) { console.error('FAILED:', e.message); } finally { await closePool(); }
