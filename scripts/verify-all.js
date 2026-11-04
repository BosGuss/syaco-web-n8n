let pg;
try {
  pg = require('pg');
} catch (e) {
  const path = require('path');
  const globalPath = path.join(process.env.APPDATA || '', 'npm/node_modules/n8n/node_modules/pg');
  pg = require(globalPath);
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

async function verify() {
  console.log('Starting End-to-End Verification...');
  const pool = await getPool();

  // 1. Verify SyaCo API Auth & Drafts Endpoint
  console.log('1. Checking SyaCo Solutions API...');
  const res = await fetch('https://www.syaco.co.th/api/solutions?all=true', {
    headers: { Authorization: `Bearer ${process.env.SYACO_API_TOKEN || 'sya_perm_79279d93e026ed7638b9065af33c5b78bff1c5fdfd62e3ecbf12a707bcd97b71'}` }
  });
  assert.strictEqual(res.status, 200, 'SyaCo API must respond with 200');
  const sols = await res.json();
  console.log(`   Found ${sols.length} solutions on SyaCo API.`);

  // 2. Verify Flow 1 Table constraints & state machine
  console.log('2. Verifying Flow 1 DB state machine...');
  const f1 = await pool.query(`
    INSERT INTO solution_suggestions 
      (title_th, title_en, description_th, description_en, status, features, content_ai)
    VALUES 
      ('ทดสอบระบบ', 'Test Gateway', 'คำอธิบาย', 'Description', 'pending_review', '[]'::jsonb, '{}'::jsonb)
    RETURNING id;
  `);
  const f1Id = f1.rows[0].id;
  const lock = await pool.query(`
    UPDATE solution_suggestions
    SET status = 'publishing'
    WHERE id = $1 AND status IN ('pending_review', 'failed')
    RETURNING *;
  `, [f1Id]);
  assert.strictEqual(lock.rows[0].status, 'publishing', 'Atomic lock must transition to publishing');

  // Cleanup test row
  await pool.query('DELETE FROM solution_suggestions WHERE id = $1', [f1Id]);
  console.log('   Flow 1 state machine verified.');

  // 3. Verify Flow 2 CTE Multi-Insert and Unique Constraint
  console.log('3. Verifying Flow 2 CTE Multi-Insert and Unique constraint...');
  const solId = 'test_sol_verify_999';
  await pool.query(`
    WITH ins AS (
      INSERT INTO content_drafts (solution_id, solution_title, platform, title_th, content_markdown, tags, status)
      VALUES 
        ($1, 'Test', 'bluesky', 'หัวข้อ', 'เนื้อหา', ARRAY['tag1'], 'pending_review'),
        ($1, 'Test', 'devto', 'หัวข้อ', 'เนื้อหา', ARRAY['tag1'], 'pending_review')
      ON CONFLICT (solution_id, platform) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*) FROM ins;
  `, [solId]);

  const countDrafts = await pool.query('SELECT COUNT(*) FROM content_drafts WHERE solution_id = $1', [solId]);
  assert.strictEqual(countDrafts.rows[0].count, '2', 'Must insert 2 drafts');

  // Duplicate insert test (Idempotency)
  await pool.query(`
    INSERT INTO content_drafts (solution_id, solution_title, platform, title_th, content_markdown, tags, status)
    VALUES ($1, 'Test', 'bluesky', 'หัวข้อ', 'เนื้อหา', ARRAY['tag1'], 'pending_review')
    ON CONFLICT (solution_id, platform) DO NOTHING;
  `, [solId]);
  const dupCheck = await pool.query('SELECT COUNT(*) FROM content_drafts WHERE solution_id = $1 AND platform = $2', [solId, 'bluesky']);
  assert.strictEqual(dupCheck.rows[0].count, '1', 'Duplicate insert must be ignored');

  await pool.query('DELETE FROM content_drafts WHERE solution_id = $1', [solId]);
  console.log('   Flow 2 CTE Multi-Insert and Idempotency verified.');

  // 4. Verify Flow 3 Quota counting query
  console.log('4. Verifying Flow 3 Quota counting query...');
  const qTest = await pool.query(`
    SELECT COUNT(*) AS weekly_count 
    FROM backlink_candidates 
    WHERE platform IN ('pantip', 'blognone', 'blockdit', 'facebook_group')
      AND status IN ('pending_review', 'approved', 'manual', 'posted')
      AND created_at >= NOW() - INTERVAL '7 days';
  `);
  assert(parseInt(qTest.rows[0].weekly_count) >= 0, 'Weekly count query must execute cleanly');
  console.log(`   Flow 3 Quota count: ${qTest.rows[0].weekly_count}/5 in rolling 7 days.`);

  console.log('🎉 All End-to-End System Checks Passed Successfully!');
  await pool.end();
}

verify().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
