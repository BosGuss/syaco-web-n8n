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
      if (e.code === 'ECONNREFUSED' || e.code === '3D000' || (e.message && e.message.includes('does not exist'))) {
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

async function seed() {
  const pool = await getPool();
  console.log('Fetching existing solutions from SyaCo API...');
  const res = await fetch('https://www.syaco.co.th/api/solutions?all=true', {
    headers: {
      Authorization: `Bearer ${process.env.SYACO_API_TOKEN || 'sya_perm_79279d93e026ed7638b9065af33c5b78bff1c5fdfd62e3ecbf12a707bcd97b71'}`
    }
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const solutions = await res.json();
  console.log(`Found ${solutions.length} existing solutions. Seeding into processed_solutions...`);

  for (const sol of solutions) {
    const id = String(sol.id);
    const title = sol.titleEn || sol.titleTh || `Solution #${id}`;
    await pool.query(`
      INSERT INTO processed_solutions (solution_id, solution_title, status, first_seen_at, updated_at)
      VALUES ($1, $2, 'completed', NOW(), NOW())
      ON CONFLICT (solution_id) DO NOTHING;
    `, [id, title]);
    console.log(`  - Seeded solution ${id}: ${title}`);
  }

  console.log('Seeding completed successfully.');
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
