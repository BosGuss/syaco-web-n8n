let pg;
try {
  pg = require('pg');
} catch (e) {
  try {
    const path = require('path');
    const globalPath = path.join(process.env.APPDATA || '', 'npm/node_modules/n8n/node_modules/pg');
    pg = require(globalPath);
  } catch (e2) {
    throw e;
  }
}
const { Pool } = pg;
const assert = require('assert');

async function getPool() {
  const defaultPort = parseInt(process.env.POSTGRES_PORT || '5432');
  const baseConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'syaco_n8n_db',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'admin',
  };

  const pool = new Pool({ ...baseConfig, port: defaultPort });
  if (!process.env.POSTGRES_PORT && defaultPort === 5432) {
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        const fallbackPool = new Pool({ ...baseConfig, port: 5680 });
        await fallbackPool.query('SELECT 1');
        await pool.end().catch(() => {});
        return fallbackPool;
      }
      throw e;
    }
  }
  return pool;
}

async function runTest() {
  const pool = await getPool();
  const t1 = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'solution_suggestions'");
  assert.strictEqual(t1.rows[0].count, '1', 'solution_suggestions table must exist');

  const t2 = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'processed_solutions'");
  assert.strictEqual(t2.rows[0].count, '1', 'processed_solutions table must exist');

  const t3 = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'content_drafts'");
  assert.strictEqual(t3.rows[0].count, '1', 'content_drafts table must exist');

  const seedCheck = await pool.query("SELECT COUNT(*) FROM processed_solutions WHERE status = 'completed'");
  assert(parseInt(seedCheck.rows[0].count) > 0, 'Seeded solutions count must be > 0');

  console.log(`✅ Database schema and seeding verified successfully. (${seedCheck.rows[0].count} seeded solutions found)`);
  await pool.end();
}

runTest().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
