const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

// 1. Helper สร้าง Embed, ปุ่ม Action และจัดการ Cookie
function normalizeDevtoCookie(cookie) {
  let c = (cookie || '').trim();
  if (!c) return '';
  if (!c.includes('=')) {
    c = c.startsWith('eyJf')
      ? `remember_user_token=${c}`
      : `_Devto_Forem_Session=${c}`;
  }
  return c;
}

async function saveAndVerifyDevtoCookie(interaction, rawCookie, pool) {
  const normalized = normalizeDevtoCookie(rawCookie);
  if (!normalized) {
    return await interaction.editReply('❌ ค่า Cookie ว่างเปล่า กรุณาระบุ Cookie ที่ถูกต้อง');
  }

  // 1. Test against Dev.to
  let isValid = false;
  let userDetails = null;
  let testError = null;

  try {
    const testRes = await fetch('https://dev.to/async_info/base_data', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': normalized
      },
      signal: AbortSignal.timeout(5000)
    });
    const data = await testRes.json().catch(() => null);
    if (data?.user) {
      isValid = true;
      userDetails = data.user;
    }
  } catch (err) {
    testError = err.message;
  }

  // 2. Save to database
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES ('DEVTO_COOKIE', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [normalized]);

    process.env.DEVTO_COOKIE = normalized;
  } catch (dbErr) {
    console.error('Failed to save DEVTO_COOKIE to DB:', dbErr);
    return await interaction.editReply(`⚠️ บันทึกลงฐานข้อมูลไม่สำเร็จ: ${dbErr.message}`);
  }

  // 3. Response
  if (isValid && userDetails) {
    const embed = new EmbedBuilder()
      .setTitle('✅ บันทึก DEVTO_COOKIE สำเร็จ!')
      .setColor(0x57f287)
      .setDescription('เชื่อมต่อบัญชี Dev.to สำเร็จแล้ว พร้อมใช้งานสำหรับการโพสต์คอมเมนต์ทันที')
      .addFields(
        { name: '👤 บัญชี Dev.to', value: `@${userDetails.username || userDetails.name || 'User'}`, inline: true },
        { name: '💾 สถานะการบันทึก', value: 'บันทึกลง Database เรียบร้อย (คงอยู่ถาวรแม้รีสตาร์ทบอท)', inline: true }
      )
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ บันทึก DEVTO_COOKIE แล้ว แต่การทดสอบไม่ผ่าน')
      .setColor(0xfee75c)
      .setDescription('บันทึกคุกกี้ลงในระบบแล้ว แต่ Dev.to ตอบกลับว่า Session ไม่ถูกต้องหรือหมดอายุ')
      .addFields(
        {
          name: 'สาเหตุที่เป็นไปได้',
          value: '• Cookie อาจหมดอายุแล้ว หรือก๊อปปี้มาไม่ครบ\n• แนะนำให้เปิด DevTools (F12) -> Network -> ดู Request Headers ของ dev.to แล้วคัดลอกค่า Cookie ทั้งหมดมาวาง'
        }
      )
      .setFooter({ text: testError ? `Error: ${testError}` : 'Session Not Authenticated' })
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  }
}

// 2. Helper สำหรับจัดการ Environment File และ Gemini AI
function updateEnvFile(key, value) {
  const paths = ['/app/.env', path.resolve(__dirname, '../.env')];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        let content = fs.readFileSync(p, 'utf8');
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value}`);
        } else {
          content += `\n${key}=${value}\n`;
        }
        fs.writeFileSync(p, content, 'utf8');
        console.log(`[Env] Updated ${key} in ${p}`);
        return true;
      }
    } catch (err) {
      console.warn(`[Env] Could not update ${p}:`, err.message);
    }
  }
  return false;
}

async function verifyGemini(apiKey, model) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  const mdl = model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!key) return { ok: false, message: 'ไม่มี GEMINI_API_KEY', model: mdl };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
      signal: AbortSignal.timeout(6000)
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.candidates?.length) {
      return { ok: true, model: mdl };
    } else {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, message: errMsg, model: mdl };
    }
  } catch (err) {
    return { ok: false, message: err.message, model: mdl };
  }
}

async function saveAndVerifyGeminiKey(interaction, rawKey, pool) {
  const key = (rawKey || '').trim();
  if (!key) return await interaction.editReply('❌ ค่า API Key ว่างเปล่า');

  const currentModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const check = await verifyGemini(key, currentModel);

  // Save to DB
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES ('GEMINI_API_KEY', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [key]);
    process.env.GEMINI_API_KEY = key;
  } catch (err) {
    console.error('Failed to save GEMINI_API_KEY to DB:', err);
  }

  // Update .env
  updateEnvFile('GEMINI_API_KEY', key);

  const masked = key.length > 8 ? `${key.slice(0, 6)}...${key.slice(-4)}` : '******';
  if (check.ok) {
    const embed = new EmbedBuilder()
      .setTitle('✅ บันทึก GEMINI_API_KEY สำเร็จ!')
      .setColor(0x57f287)
      .setDescription('เชื่อมต่อ Google Gemini API สำเร็จแล้ว')
      .addFields(
        { name: '🔑 API Key', value: `\`${masked}\``, inline: true },
        { name: '🤖 ทดสอบกับ Model', value: `\`${check.model}\``, inline: true },
        { name: '💾 สถานะการบันทึก', value: 'บันทึกลง Database และไฟล์ .env เรียบร้อย', inline: false }
      )
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ บันทึก GEMINI_API_KEY แล้ว แต่การทดสอบไม่ผ่าน')
      .setColor(0xfee75c)
      .setDescription('ระบบบันทึกคีย์แล้ว แต่ Google API ส่งข้อผิดพลาดกลับมา')
      .addFields(
        { name: '🔑 API Key', value: `\`${masked}\``, inline: true },
        { name: '⚠️ ข้อความตอบกลับ', value: `\`${check.message}\``, inline: false }
      )
      .setFooter({ text: 'สามารถทดสอบอีกครั้งผ่านคำสั่ง /health' })
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  }
}

async function saveAndVerifyGeminiModel(interaction, modelName, pool) {
  const model = (modelName || '').trim();
  if (!model) return await interaction.editReply('❌ ชื่อโมเดลว่างเปล่า');

  const check = await verifyGemini(process.env.GEMINI_API_KEY, model);

  // Save to DB
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES ('GEMINI_MODEL', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [model]);
    process.env.GEMINI_MODEL = model;
  } catch (err) {
    console.error('Failed to save GEMINI_MODEL to DB:', err);
  }

  // Update .env
  updateEnvFile('GEMINI_MODEL', model);

  if (check.ok) {
    const embed = new EmbedBuilder()
      .setTitle('✅ เปลี่ยน GEMINI_MODEL สำเร็จ!')
      .setColor(0x57f287)
      .setDescription('ตั้งค่าและทดสอบโมเดลสำเร็จแล้ว พร้อมใช้งานใน Pipeline')
      .addFields(
        { name: '🤖 Model', value: `\`${model}\``, inline: true },
        { name: '💾 สถานะการบันทึก', value: 'บันทึกลง Database และไฟล์ .env เรียบร้อย', inline: true }
      )
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ บันทึก GEMINI_MODEL แล้ว แต่การทดสอบไม่ผ่าน')
      .setColor(0xfee75c)
      .setDescription('ระบบบันทึกชื่อโมเดลแล้ว แต่ Google API ตอบกลับว่าไม่สามารถเรียกใช้โมเดลนี้ได้')
      .addFields(
        { name: '🤖 Model', value: `\`${model}\``, inline: true },
        { name: '⚠️ ข้อความตอบกลับ', value: `\`${check.message}\``, inline: false }
      )
      .setFooter({ text: 'คำแนะนำ: แนะนำให้ใช้ gemini-3.8-flash หรือตรวจสอบโควตา API' })
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  }
}
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
    .setName('posted')
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
    .setName('latest')
    .setDescription('ดึง Candidate ทั้งหมดในรอบเวลาล่าสุดที่รอรีวิวขึ้นมาแสดงพร้อมปุ่มจัดการ')
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('จำนวนรายการสูงสุดที่ต้องการแสดง (ค่าเริ่มต้น: แสดงทั้งหมดในรอบล่าสุด)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('run')
    .setDescription('สั่งให้ n8n เริ่มค้นหาและประมวลผล Backlink รอบใหม่'),

  new SlashCommandBuilder()
    .setName('health')
    .setDescription('ตรวจสอบสุขภาพของระบบ (PostgreSQL, n8n, Bluesky, Dev.to, Gemini AI)'),

  new SlashCommandBuilder()
    .setName('set-gemini-key')
    .setDescription('ตั้งค่าหรืออัปเดต GEMINI_API_KEY สำหรับ AI Pipeline')
    .addStringOption(option =>
      option.setName('key')
        .setDescription('ค่า Gemini API Key (หากเว้นว่างไว้จะมีหน้าต่างป๊อปอัปให้วาง)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('set-gemini-model')
    .setDescription('ตั้งค่าหรือเปลี่ยนรุ่น GEMINI_MODEL สำหรับ AI Pipeline')
    .addStringOption(option =>
      option.setName('model')
        .setDescription('ชื่อโมเดล เช่น gemini-3.8-flash, gemini-3.5-flash-lite, gemini-2.5-pro')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('set-devto-cookie')
    .setDescription('ตั้งค่าหรืออัปเดต DEVTO_COOKIE สำหรับโพสต์คอมเมนต์บน Dev.to')
    .addStringOption(option =>
      option.setName('cookie')
        .setDescription('ค่า Cookie ของ Dev.to (หากเว้นว่างไว้จะมีหน้าต่างป๊อปอัปให้วาง)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('set-cookie')
    .setDescription('ตั้งค่า DEVTO_COOKIE (ป๊อปอัปหรือระบุค่าโดยตรง)')
    .addStringOption(option =>
      option.setName('cookie')
        .setDescription('ค่า Cookie ของ Dev.to')
        .setRequired(false)
    ),

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

  // คำสั่ง /posted หรือ /recent-posted (ดู 5 รายการล่าสุดที่โพสต์สำเร็จ)
  if (commandName === 'posted' || commandName === 'recent-posted') {
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

  // คำสั่ง /latest หรือ /review-latest (ดึง Candidate ทั้งหมดในรอบเวลาล่าสุดที่รอรีวิวขึ้นมาแสดงในห้องแชท)
  if (commandName === 'latest' || commandName === 'review-latest') {
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

  // คำสั่ง /run หรือ /run-research (สั่ง n8n เริ่มค้นหา Backlink รอบใหม่)
  if (commandName === 'run' || commandName === 'run-research') {
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
        const cookieStr = normalizeDevtoCookie(devCookie);
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

    // 5. Check Gemini AI
    let geminiStatus = '⚪ Not Configured';
    if (process.env.GEMINI_API_KEY) {
      const gemCheck = await verifyGemini();
      if (gemCheck.ok) {
        geminiStatus = `🟢 Active (\`${gemCheck.model}\`)`;
      } else {
        geminiStatus = `🔴 Error (\`${gemCheck.model}\`): ${gemCheck.message}`;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('🩺 รายงานสถานะสุขภาพระบบ (System Health)')
      .setColor(0x5865f2)
      .addFields(
        { name: '🐘 PostgreSQL', value: pgStatus, inline: false },
        { name: '⚡ n8n Service', value: n8nStatus, inline: false },
        { name: '🦋 Bluesky Account', value: bskyStatus, inline: false },
        { name: '💻 Dev.to Session', value: devtoStatus, inline: false },
        { name: '🤖 Gemini AI', value: geminiStatus, inline: false }
      )
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }

  // คำสั่ง /set-gemini-key
  if (commandName === 'set-gemini-key') {
    const rawKey = interaction.options.getString('key');
    if (!rawKey) {
      const modal = new ModalBuilder()
        .setCustomId('modal_gemini_key')
        .setTitle('ตั้งค่า GEMINI_API_KEY');

      const keyInput = new TextInputBuilder()
        .setCustomId('key_value')
        .setLabel('Gemini API Key')
        .setPlaceholder('วางค่า Gemini API Key ที่นี่...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
      return await interaction.showModal(modal);
    }

    await interaction.deferReply({ ephemeral: true });
    return await saveAndVerifyGeminiKey(interaction, rawKey, pool);
  }

  // คำสั่ง /set-gemini-model
  if (commandName === 'set-gemini-model') {
    const model = interaction.options.getString('model');
    await interaction.deferReply({ ephemeral: true });
    return await saveAndVerifyGeminiModel(interaction, model, pool);
  }

  // คำสั่ง /set-devto-cookie และ /set-cookie
  if (commandName === 'set-devto-cookie' || commandName === 'set-cookie') {
    const rawCookie = interaction.options.getString('cookie');
    if (!rawCookie) {
      const modal = new ModalBuilder()
        .setCustomId('modal_devto_cookie')
        .setTitle('ตั้งค่า DEVTO_COOKIE');

      const cookieInput = new TextInputBuilder()
        .setCustomId('cookie_value')
        .setLabel('Dev.to Cookie')
        .setPlaceholder('วาง Cookie ทั้งหมด หรือ remember_user_token=...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(cookieInput));
      return await interaction.showModal(modal);
    }

    await interaction.deferReply({ ephemeral: true });
    return await saveAndVerifyDevtoCookie(interaction, rawCookie, pool);
  }

  // คำสั่ง /help
  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 คู่มือคำสั่ง Discord Bot')
      .setColor(0x57f287)
      .setDescription('คำสั่งที่สามารถใช้งานได้ในเซิร์ฟเวอร์:')
      .addFields(
        { name: '`/latest [limit]`', value: 'ดึง Candidate ทั้งหมดในรอบเวลาล่าสุดขึ้นมาพร้อมปุ่มจัดการ' },
        { name: '`/get <id>`', value: 'ดึง Candidate ตาม ID ที่ระบุขึ้นมาดู/กด Approve/Reject' },
        { name: '`/posted`', value: 'ดู 5 รายการล่าสุดที่โพสต์ Backlink สำเร็จ' },
        { name: '`/status`', value: 'ดูสรุปสถิติจำนวนรายการในแต่ละสถานะ' },
        { name: '`/pending [limit]`', value: 'ดึงรายการที่รอรีวิวขึ้นมาพร้อมปุ่ม Approve / Edit / Reject' },
        { name: '`/run`', value: 'สั่งเริ่มกระบวนการค้นหา Backlink ใน n8n ทันที' },
        { name: '`/set-gemini-key [key]`', value: 'อัปเดต Gemini API Key (มี Modal ป๊อปอัป)' },
        { name: '`/set-gemini-model <model>`', value: 'เปลี่ยนรุ่น Gemini Model (เช่น gemini-3.8-flash)' },
        { name: '`/set-devto-cookie [cookie]`', value: 'อัปเดต Cookie ของ Dev.to ผ่าน Discord (มี Modal ให้วาง)' },
        { name: '`/health`', value: 'ตรวจสอบสถานะการเชื่อมต่อ (DB, n8n, Bluesky, Dev.to, Gemini)' },
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
  createActionButtons,
  normalizeDevtoCookie,
  saveAndVerifyDevtoCookie,
  saveAndVerifyGeminiKey,
  saveAndVerifyGeminiModel
};
