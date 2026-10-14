const {
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

// 1. Helper สร้าง Embed และ ปุ่ม Action
function createCandidateEmbed(row) {
  const cut = (s, n) => (String(s || '').length > n ? s.slice(0, n - 3) + '...' : s || '-');
  return new EmbedBuilder()
    .setTitle(`[${row.platform}] ${cut(row.post_title, 200)}`)
    .setURL(row.post_url)
    .setColor(0x5865f2)
    .addFields(
      { name: 'Solution', value: cut(row.solution_title, 250), inline: true },
      { name: 'Match Score', value: String(row.match_score), inline: true },
      { name: 'Platform', value: String(row.platform), inline: true },
      { name: 'Matched Problem', value: cut(row.matched_problem, 500) },
      { name: 'Draft Answer', value: cut(row.answer, 1000) }
    );
}

function createActionButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve_${id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`edit_${id}`).setLabel('Edit Answer').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`reject_${id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
  );
}

// 2. กำหนดคำสั่งทั้งหมด (Command Definitions)
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('ทดสอบสถานะการเชื่อมต่อและความเร็วของบอท'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('ดูภาพรวมจำนวนรายการ Backlink Candidates ในฐานข้อมูล'),

  new SlashCommandBuilder()
    .setName('pending')
    .setDescription('ดูรายการที่กำลังรอตรวจสอบ พร้อมปุ่ม Approve / Edit / Reject')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('จำนวนรายการที่ต้องการแสดง (ค่าเริ่มต้น: 5 รายการ)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('recent-posted')
    .setDescription('ดู 5 รายการล่าสุดที่สร้างและโพสต์ Backlink สำเร็จแล้ว'),

  new SlashCommandBuilder()
    .setName('get')
    .setDescription('ดึง Candidate ตาม ID ขึ้นมาตรวจสอบ พร้อมปุ่ม Approve / Edit / Reject')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('Candidate ID ที่ต้องการเรียกดู')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('review-latest')
    .setDescription('ดึง Candidate ทั้งหมดในรอบเวลาล่าสุดที่รอรีวิวขึ้นมาแสดงพร้อมปุ่มจัดการ')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('จำนวนรายการสูงสุดที่ต้องการแสดง (ค่าเริ่มต้น: แสดงทั้งหมดในรอบล่าสุด)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('run-research')
    .setDescription('สั่งให้ n8n เริ่มค้นหาและประมวลผล Backlink รอบใหม่'),

  new SlashCommandBuilder()
    .setName('health')
    .setDescription('ตรวจสอบสุขภาพของระบบ (PostgreSQL, n8n, Bluesky, Dev.to)'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('แสดงรายการคำสั่งทั้งหมดและวิธีใช้งาน')
];

// 3. ฟังก์ชันลงทะเบียนคำสั่งกับ Discord API (Register Commands)
async function registerCommands(client) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn('[Commands] ไม่พบ DISCORD_BOT_TOKEN ข้ามการลงทะเบียนคำสั่ง');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commandData = commands.map(cmd => cmd.toJSON());
  const serverId = process.env.DISCORD_SERVER_ID;

  try {
    if (serverId) {
      console.log(`[Commands] กำลังลงทะเบียนคำสั่งเข้า Server ID: ${serverId} (อัปเดตทันที)...`);
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, serverId),
        { body: commandData }
      );
      console.log('✅ [Commands] ลงทะเบียน Guild Slash Commands สำเร็จ!');
    } else {
      console.log('[Commands] กำลังลงทะเบียน Global Slash Commands...');
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commandData }
      );
      console.log('✅ [Commands] ลงทะเบียน Global Slash Commands สำเร็จ!');
    }
  } catch (error) {
    console.error('❌ [Commands] เกิดข้อผิดพลาดในการลงทะเบียน Commands:', error);
  }
}

// 4. ฟังก์ชันประมวลผลคำสั่งเมื่อผู้ใช้พิมพ์ในแชท (Handle Commands)
async function handleCommand(interaction, { pool, client }) {
  const { commandName } = interaction;

  // คำสั่ง /ping
  if (commandName === 'ping') {
    const wsPing = client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'กำลังคำนวณ...';
    return await interaction.reply({
      content: `🏓 **Pong!**\n- WebSocket Latency: \`${wsPing}\``,
      ephemeral: true
    });
  }

  // คำสั่ง /status
  if (commandName === 'status') {
    await interaction.deferReply();
    try {
      const { rows } = await pool.query(`
        SELECT status, COUNT(*) AS count
        FROM backlink_candidates
        GROUP BY status
        ORDER BY count DESC
      `);

      if (!rows.length) {
        return await interaction.editReply('📊 ยังไม่มีข้อมูลในตาราง `backlink_candidates`');
      }

      const statusIcons = {
        pending_review: '⏳',
        posted: '✅',
        manual: '📋',
        approved: '🚀',
        rejected: '❌',
        failed: '⚠️',
        skipped: '⏭️'
      };

      const fields = rows.map(r => ({
        name: `${statusIcons[r.status] || '▫️'} ${r.status}`,
        value: `**${r.count}** รายการ`,
        inline: true
      }));

      const embed = new EmbedBuilder()
        .setTitle('📊 ภาพรวม Backlink Candidates')
        .setColor(0x5865f2)
        .addFields(fields)
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error fetching status:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // คำสั่ง /pending (ดึงรายการที่รอรีวิว พร้อมปุ่ม Action)
  if (commandName === 'pending') {
    await interaction.deferReply();
    try {
      const limit = interaction.options.getInteger('limit') || 5;
      const { rows } = await pool.query(`
        SELECT *
        FROM backlink_candidates
        WHERE status = 'pending_review'
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `, [limit]);

      if (!rows.length) {
        return await interaction.editReply('🎉 **ไม่มีรายการค้างที่รอรีวิวในขณะนี้!** (Pending Review: 0)');
      }

      await interaction.editReply({
        content: `⏳ **รายการที่รอรีวิว (${rows.length} รายการล่าสุด):**`
      });

      // ส่งทุกรายการออกไปพร้อมปุ่ม Approve / Edit / Reject ทันที
      await Promise.all(
        rows.map((row, i) => {
          const embed = createCandidateEmbed(row);
          const actionRow = createActionButtons(row.id);
          return interaction.followUp({
            content: `📋 **[${i + 1}/${rows.length}] Candidate ID: \`${row.id}\`** | Platform: **${row.platform}** | Score: \`${row.match_score || '-'}\``,
            embeds: [embed],
            components: [actionRow]
          });
        })
      );
    } catch (err) {
      console.error('Error fetching pending items:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // คำสั่ง /recent-posted (ดู 5 รายการล่าสุดที่โพสต์สำเร็จ)
  if (commandName === 'recent-posted') {
    await interaction.deferReply();
    try {
      const { rows } = await pool.query(`
        SELECT id, platform, post_title, post_url, posted_url, posted_at
        FROM backlink_candidates
        WHERE status = 'posted'
        ORDER BY posted_at DESC NULLS LAST, id DESC
        LIMIT 5
      `);

      if (!rows.length) {
        return await interaction.editReply('📋 ยังไม่มีรายการที่โพสต์สำเร็จในระบบ (สถานะ `posted`)');
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ รายการที่โพสต์สำเร็จ (5 รายการล่าสุด)')
        .setColor(0x57f287)
        .setDescription(
          rows.map((r, i) => {
            const title = r.post_title ? (r.post_title.length > 50 ? r.post_title.slice(0, 47) + '...' : r.post_title) : 'No Title';
            const postedLink = r.posted_url ? `[เปิดโพสต์/คอมเมนต์จริง](${r.posted_url})` : 'ไม่มีลิงก์โพสต์';
            const dateStr = r.posted_at ? new Date(r.posted_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
            return `**${i + 1}. [${r.platform}]** [${title}](${r.post_url})\n└ ID: \`${r.id}\` | 🔗 ${postedLink}\n└ 🕒 ${dateStr}`;
          }).join('\n\n')
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error in recent-posted:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // คำสั่ง /get [id] (ดึง Candidate ตาม ID พร้อมปุ่ม Action)
  if (commandName === 'get') {
    const candidateId = interaction.options.getString('id').trim();
    await interaction.deferReply();
    try {
      const { rows } = await pool.query('SELECT * FROM backlink_candidates WHERE id::text = $1', [candidateId]);
      if (!rows.length) {
        return await interaction.editReply(`❌ ไม่พบข้อมูล Candidate ID: \`${candidateId}\``);
      }

      const row = rows[0];
      const embed = createCandidateEmbed(row);
      const actionRow = createActionButtons(row.id);

      if (row.status === 'pending_review') {
        return await interaction.editReply({
          content: `🔍 **Candidate ID: \`${row.id}\`** (สถานะ: ⏳ \`${row.status}\`)`,
          embeds: [embed],
          components: [actionRow]
        });
      } else {
        const postedMsg = row.posted_url ? `\n🔗 [ลิงก์ที่โพสต์ไว้](${row.posted_url})` : '';
        return await interaction.editReply({
          content: `🔍 **Candidate ID: \`${row.id}\`** (สถานะปัจจุบัน: **${row.status}**)${postedMsg}\n*(กดปุ่มด้านล่างหากต้องการเปลี่ยนสถานะใหม่)*`,
          embeds: [embed],
          components: [actionRow]
        });
      }
    } catch (err) {
      console.error('Error in get command:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // คำสั่ง /review-latest (ดึง Candidate ทั้งหมดในรอบเวลาล่าสุดที่รอรีวิวขึ้นมาแสดงในห้องแชท)
  if (commandName === 'review-latest') {
    await interaction.deferReply();
    try {
      // ค้นหารอบเวลาล่าสุดที่มี candidate สถานะ pending_review
      const { rows } = await pool.query(`
        WITH latest_time AS (
          SELECT created_at
          FROM backlink_candidates
          WHERE status = 'pending_review'
          ORDER BY created_at DESC
          LIMIT 1
        )
        SELECT *
        FROM backlink_candidates
        WHERE status = 'pending_review'
          AND created_at >= (SELECT created_at FROM latest_time) - INTERVAL '1 minute'
        ORDER BY match_score DESC NULLS LAST, id ASC
      `);

      if (!rows.length) {
        return await interaction.editReply('🎉 **ไม่มี Candidate ที่รอตรวจสอบในขณะนี้!** (Pending Review: 0)');
      }

      const requestedLimit = interaction.options.getInteger('limit');
      const maxLimit = requestedLimit && requestedLimit > 0 ? requestedLimit : 25;
      const targetRows = rows.slice(0, maxLimit);
      const batchTime = new Date(rows[0].created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      await interaction.editReply({
        content: `⏳ **ดึงรายการในรอบเวลาล่าสุด (${batchTime}) ทั้งหมด ${targetRows.length} รายการ เรียบร้อยแล้ว:**`
      });

      // ส่งทุกรายการออกไปเป็นการ์ดแยกพร้อมกันทันที (ไม่หน่วงเวลา)
      await Promise.all(
        targetRows.map((row, i) => {
          const embed = createCandidateEmbed(row);
          const actionRow = createActionButtons(row.id);
          return interaction.followUp({
            content: `📋 **[${i + 1}/${targetRows.length}] Candidate ID: \`${row.id}\`** | Platform: **${row.platform}** | Score: \`${row.match_score || '-'}\``,
            embeds: [embed],
            components: [actionRow]
          });
        })
      );
    } catch (err) {
      console.error('Error in review-latest:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // คำสั่ง /run-research (สั่ง n8n เริ่มค้นหา Backlink รอบใหม่)
  if (commandName === 'run-research') {
    await interaction.deferReply();
    const webhookUrl = process.env.N8N_RESEARCH_WEBHOOK_URL || 'http://n8n:5678/webhook/run-research';

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggered_by: interaction.user.tag,
          user_id: interaction.user.id,
          requested_at: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        return await interaction.editReply(
          '🚀 **สั่งรัน Backlink Research บน n8n สำเร็จแล้ว!**\nระบบกำลังเริ่มค้นหากระทู้และคัดเลือกเนื้อหา หากพบรายการที่ตรงเป้าหมายจะแจ้งเตือนเข้ามาในห้องนี้ทันทีครับ'
        );
      } else {
        return await interaction.editReply(
          `⚠️ **n8n ตอบกลับสถานะ HTTP ${res.status}**\nปลายทาง: \`${webhookUrl}\`\n💡 *คำแนะนำ: ตรวจสอบว่าใน n8n มี Webhook Node (POST, path: \`/webhook/run-research\`) และเปิด Active หรือยัง*`
        );
      }
    } catch (err) {
      return await interaction.editReply(
        `⚠️ **ไม่สามารถเรียก n8n ได้:** ${err.message}\nปลายทาง: \`${webhookUrl}\`\n💡 *คำแนะนำ: สามารถเพิ่ม Webhook Node ใน n8n Workflow เชื่อมกับจุดเริ่มต้นของ Research Flow เพื่อรองรับคำสั่งนี้ได้ครับ*`
      );
    }
  }

  // คำสั่ง /health (ตรวจสอบสุขภาพระบบ)
  if (commandName === 'health') {
    await interaction.deferReply();

    // 1. Check PostgreSQL
    let pgStatus = '🔴 Disconnected';
    try {
      const pgStart = Date.now();
      await pool.query('SELECT 1');
      const pgMs = Date.now() - pgStart;
      pgStatus = `🟢 Connected (${pgMs}ms)`;
    } catch (e) {
      pgStatus = `🔴 Error: ${e.message}`;
    }

    // 2. Check n8n
    let n8nStatus = '🔴 Unreachable';
    try {
      const n8nRes = await fetch('http://n8n:5678/healthz', { signal: AbortSignal.timeout(3000) });
      if (n8nRes.ok) {
        n8nStatus = '🟢 Online (HTTP 200)';
      } else {
        n8nStatus = `🟡 HTTP ${n8nRes.status}`;
      }
    } catch (e) {
      n8nStatus = `🔴 Offline (${e.message})`;
    }

    // 3. Check Bluesky Session
    let bskyStatus = '⚪ Not Configured';
    if (process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD) {
      try {
        const bskyRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: process.env.BLUESKY_HANDLE,
            password: process.env.BLUESKY_APP_PASSWORD
          }),
          signal: AbortSignal.timeout(4000)
        });
        const sessionData = await bskyRes.json();
        if (sessionData.accessJwt) {
          bskyStatus = `🟢 Active (@${process.env.BLUESKY_HANDLE})`;
        } else {
          bskyStatus = `🔴 Auth Failed (${sessionData.message || 'Invalid credentials'})`;
        }
      } catch (e) {
        bskyStatus = `🔴 Error: ${e.message}`;
      }
    }

    // 4. Check Dev.to Session Cookie
    let devtoStatus = '⚪ Not Configured';
    const devCookie = (process.env.DEVTO_COOKIE || '').trim();
    if (devCookie) {
      try {
        const cookieStr = devCookie.includes('remember_user_token=') ? devCookie : `remember_user_token=${devCookie}`;
        const devRes = await fetch('https://dev.to/async_info/base_data', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Cookie': cookieStr
          },
          signal: AbortSignal.timeout(4000)
        });
        const devData = await devRes.json();
        if (devData?.user) {
          devtoStatus = `🟢 Logged in (@${devData.user.username || 'User'})`;
        } else {
          devtoStatus = '🔴 Session Expired (Need to refresh DEVTO_COOKIE)';
        }
      } catch (e) {
        devtoStatus = `🔴 Error: ${e.message}`;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🩺 รายงานสถานะสุขภาพระบบ (System Health)')
      .setColor(0x5865f2)
      .addFields(
        { name: '🐘 PostgreSQL', value: pgStatus, inline: false },
        { name: '⚡ n8n Service', value: n8nStatus, inline: false },
        { name: '🦋 Bluesky Account', value: bskyStatus, inline: false },
        { name: '💻 Dev.to Session', value: devtoStatus, inline: false }
      )
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }

  // คำสั่ง /help
  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 คู่มือคำสั่ง Discord Bot')
      .setColor(0x57f287)
      .setDescription('คำสั่งที่สามารถใช้งานได้ในเซิร์ฟเวอร์:')
      .addFields(
        { name: '`/review-latest [limit]`', value: 'ดึง Candidate ทั้งหมดในรอบเวลาล่าสุดขึ้นมาพร้อมปุ่มจัดการ' },
        { name: '`/get <id>`', value: 'ดึง Candidate ตาม ID ที่ระบุขึ้นมาดู/กด Approve/Reject' },
        { name: '`/recent-posted`', value: 'ดู 5 รายการล่าสุดที่โพสต์ Backlink สำเร็จ' },
        { name: '`/status`', value: 'ดูสรุปสถิติจำนวนรายการในแต่ละสถานะ' },
        { name: '`/pending [limit]`', value: 'ดึงรายการที่รอรีวิวขึ้นมาพร้อมปุ่ม Approve / Edit / Reject' },
        { name: '`/run-research`', value: 'สั่งเริ่มกระบวนการค้นหา Backlink ใน n8n ทันที' },
        { name: '`/health`', value: 'ตรวจสอบสถานะการเชื่อมต่อ (DB, n8n, Bluesky, Dev.to)' },
        { name: '`/ping`', value: 'ทดสอบความเร็วและการเชื่อมต่อของบอท' }
      )
      .setFooter({ text: 'SyaCo Content & Backlink Automation Stack' });

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = {
  commands,
  registerCommands,
  handleCommand,
  createCandidateEmbed,
  createActionButtons
};
