/**
 * CLI Test Script for Discord Notification Cards
 * Runs directly against DB & Bot Notify API without touching n8n workflows.
 * Usage:
 *   node scripts/test-discord-card.js [flow1|flow2|flow3]
 */
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

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5680', 10),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

// If running from host, notify API might be via docker exec or port
const NOTIFY_URL = process.env.NOTIFY_URL || 'http://localhost:3000/notify';

async function main() {
  const target = (process.argv[2] || 'flow2').toLowerCase();

  console.log(`\n🧪 [Discord Card CLI Test] Target: ${target.toUpperCase()}`);

  try {
    if (target === 'flow2') {
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

      await pool.query(
        "UPDATE content_drafts SET status = 'pending_review', error_message = NULL WHERE solution_id = $1;",
        [sol.solution_id]
      );
      console.log(`🔄 รีเซ็ตสถานะ Draft ของ Solution ${sol.solution_id} เป็น 'pending_review' เพื่อให้ปุ่มพร้อมกดเทสต์`);
      console.log(`\n👉 สามารถส่งคำสั่งเข้าบอตได้ด้วยคำสั่ง CMD ด้านล่าง:\n`);
      console.log(`docker compose exec discord-bot node -e "fetch('http://localhost:3000/notify', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({type:'flow2_drafts', solution_id:'${sol.solution_id}', solution_title:'${sol.solution_title}'})}).then(r=>r.json()).then(console.log)"\n`);

    } else if (target === 'flow1') {
      const sugRes = await pool.query(`SELECT id, title_th FROM solution_suggestions ORDER BY id DESC LIMIT 1;`);
      if (sugRes.rows.length) {
        const s = sugRes.rows[0];
        await pool.query("UPDATE solution_suggestions SET status = 'pending_review' WHERE id = $1", [s.id]);
        console.log(`📦 รีเซ็ต Suggestion ID: #${s.id} เป็น 'pending_review'`);
      }
    } else if (target === 'flow3') {
      const leadRes = await pool.query(`SELECT id, post_title FROM backlink_candidates ORDER BY id DESC LIMIT 1;`);
      if (leadRes.rows.length) {
        const c = leadRes.rows[0];
        await pool.query("UPDATE backlink_candidates SET status = 'pending_review' WHERE id = $1", [c.id]);
        console.log(`📦 รีเซ็ต Candidate ID: #${c.id} เป็น 'pending_review'`);
      }
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
