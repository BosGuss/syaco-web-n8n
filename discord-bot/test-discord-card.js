/**
 * CLI Test Script for Discord Notification Cards
 * Runs directly against DB & Bot Notify API without touching n8n workflows.
 * Usage:
 *   node test-discord-card.js [flow1|flow2|flow3] [reset]
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

const NOTIFY_URL = process.env.NOTIFY_URL || 'http://localhost:3000/notify';

async function main() {
  const target = (process.argv[2] || 'flow2').toLowerCase();
  const shouldReset = process.argv.includes('reset') || true;

  console.log(`\n🧪 [Discord Card CLI Test] Target: ${target.toUpperCase()}`);
  console.log(`📡 Notify Endpoint: ${NOTIFY_URL}\n`);

  try {
    if (target === 'flow2') {
      // 1. Fetch latest solution from content_drafts
      const solRes = await pool.query(`
        SELECT solution_id, solution_title, COUNT(*) as draft_count
        FROM content_drafts
        GROUP BY solution_id, solution_title
        ORDER BY MAX(id) DESC
        LIMIT 1;
      `);

      if (!solRes.rows.length) {
        console.error('❌ ไม่พบข้อมูลในตาราง content_drafts');
        process.exit(1);
      }

      const sol = solRes.rows[0];
      console.log(`📦 พบ Solution ID: ${sol.solution_id} (${sol.solution_title}) มี ${sol.draft_count} drafts`);

      if (shouldReset) {
        const resetRes = await pool.query(
          "UPDATE content_drafts SET status = 'pending_review', error_message = NULL WHERE solution_id = $1 RETURNING id, platform, status;",
          [sol.solution_id]
        );
        console.log(`🔄 รีเซ็ตสถานะ Draft ทั้ง ${resetRes.rowCount} รายการเป็น 'pending_review' เรียบร้อย`);
      }

      // 2. Call Notify API
      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'flow2_drafts',
          solution_id: String(sol.solution_id),
          solution_title: sol.solution_title || 'Enterprise Solution'
        })
      });

      const json = await res.json();
      console.log('✅ ตอบกลับจาก Notify API:', json);
      console.log('\n🎉 ส่งการ์ด Flow 2 (Bluesky, Dev.to, บทความยาว) เข้า Discord เรียบร้อยแล้ว! ตรวจสอบในห้องแชทได้เลยครับ\n');

    } else if (target === 'flow1') {
      // Flow 1 Suggestion
      const sugRes = await pool.query(`
        SELECT id, title_th, title_en, description_th, rationale, base_solution_id
        FROM solution_suggestions
        ORDER BY id DESC
        LIMIT 1;
      `);

      if (!sugRes.rows.length) {
        console.error('❌ ไม่พบข้อมูลในตาราง solution_suggestions');
        process.exit(1);
      }

      const s = sugRes.rows[0];
      await pool.query("UPDATE solution_suggestions SET status = 'pending_review' WHERE id = $1", [s.id]);
      console.log(`📦 พบ Solution Suggestion ID: #${s.id} (${s.title_th})`);

      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'flow1_suggestion',
          suggestion: s
        })
      });

      const json = await res.json();
      console.log('✅ ตอบกลับจาก Notify API:', json);
      console.log('\n🎉 ส่งการ์ด Flow 1 เข้า Discord เรียบร้อยแล้ว!\n');

    } else if (target === 'flow3') {
      // Flow 3 Lead / Backlink Candidate
      const leadRes = await pool.query(`
        SELECT id, platform, post_title, post_url, answer, match_score, solution_title, relevance_reason
        FROM backlink_candidates
        ORDER BY id DESC
        LIMIT 1;
      `);

      if (!leadRes.rows.length) {
        console.error('❌ ไม่พบข้อมูลในตาราง backlink_candidates');
        process.exit(1);
      }

      const c = leadRes.rows[0];
      await pool.query("UPDATE backlink_candidates SET status = 'pending_review' WHERE id = $1", [c.id]);
      console.log(`📦 พบ Candidate ID: #${c.id} (${c.post_title})`);

      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c)
      });

      const json = await res.json();
      console.log('✅ ตอบกลับจาก Notify API:', json);
      console.log('\n🎉 ส่งการ์ด Flow 3 เข้า Discord เรียบร้อยแล้ว!\n');
    } else {
      console.log("Usage: node test-discord-card.js [flow1|flow2|flow3]");
    }
  } catch (err) {
    console.error('❌ เกิดข้อผิดพลาด:', err.message);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
