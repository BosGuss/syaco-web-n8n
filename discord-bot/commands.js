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
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const { searchRecentThreads } = require('./thread-search');

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

async function saveAndVerifyDevtoKey(interaction, rawKey, pool) {
  const key = (rawKey || '').trim();
  if (!key) {
    return await interaction.editReply('❌ ค่า API Key ว่างเปล่า กรุณาระบุ Dev.to API Key ที่ถูกต้อง');
  }

  // 1. Test against Dev.to API
  let isValid = false;
  let userDetails = null;
  let testError = null;

  try {
    const testRes = await fetch('https://dev.to/api/users/me', {
      headers: {
        'api-key': key
      },
      signal: AbortSignal.timeout(5000)
    });
    if (testRes.ok) {
      const data = await testRes.json().catch(() => null);
      if (data?.username) {
        isValid = true;
        userDetails = data;
      }
    } else {
      const errBody = await testRes.text().catch(() => '');
      testError = `HTTP ${testRes.status} ${errBody.slice(0, 150)}`;
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
      );
    `);
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES ('DEVTO_API_KEY', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW();
    `, [key]);

    process.env.DEVTO_API_KEY = key;
  } catch (dbErr) {
    console.error('Failed to save DEVTO_API_KEY to DB:', dbErr);
    return await interaction.editReply(`⚠️ บันทึกลงฐานข้อมูลไม่สำเร็จ: ${dbErr.message}`);
  }

  // Update .env file
  updateEnvFile('DEVTO_API_KEY', key);

  const masked = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '******';

  // 3. Response
  if (isValid && userDetails) {
    const embed = new EmbedBuilder()
      .setTitle('✅ บันทึก DEVTO_API_KEY สำเร็จ!')
      .setColor(0x57f287)
      .setDescription('เชื่อมต่อบัญชี Dev.to สำเร็จแล้ว พร้อมใช้งานสำหรับการเผยแพร่บทความทันที')
      .addFields(
        { name: '👤 บัญชี Dev.to', value: `@${userDetails.username} (${userDetails.name || 'User'})`, inline: true },
        { name: '🔑 API Key', value: `\`${masked}\``, inline: true },
        { name: '💾 สถานะการบันทึก', value: 'บันทึกลง Database และไฟล์ .env เรียบร้อย', inline: false }
      )
      .setTimestamp();
    return await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ บันทึก DEVTO_API_KEY แล้ว แต่การทดสอบไม่ผ่าน')
      .setColor(0xfee75c)
      .setDescription('ระบบบันทึกคีย์ลงฐานข้อมูลแล้ว แต่ Dev.to ตอบกลับว่า API Key ไม่ถูกต้องหรือหมดอายุ')
      .addFields(
        { name: '🔑 API Key', value: `\`${masked}\``, inline: true },
        {
          name: 'สาเหตุที่เป็นไปได้',
          value: '• API Key อาจไม่ถูกต้องหรือก๊อปปี้มาไม่ครบ\n• แนะนำให้ไปที่ Settings -> Extensions บน Dev.to เพื่อสร้าง Key ใหม่'
        }
      )
      .setFooter({ text: testError ? `Error: ${testError}` : 'API Key Invalid' })
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

function buildFlow2Card(d, fallbackSolutionTitle) {
  const cut = (str, len) => (String(str || '').length > len ? str.slice(0, len - 3) + '...' : str || '-');
  const tagsFormatted = (d.tags || []).length > 0 ? (d.tags || []).map(t => `\`${t}\``).join(' ') : '`-`';
  const solutionTitle = fallbackSolutionTitle || d.solution_title || d.title_th || 'Enterprise Solution';

  let embed;
  let actionRow;

  if (d.platform === 'bluesky') {
    // 🦋 Bluesky: Short Social Micro-Post (Live Post)
    const text = d.content_markdown || '';
    const charCount = text.length;
    const byteCount = Buffer.byteLength(text, 'utf8');

    embed = new EmbedBuilder()
      .setTitle(`🦋 [Bluesky] โพสต์สั้นโซเชียล (Live Auto-Post)`)
      .setColor(0x0085ff)
      .setDescription(`>>> ${text}`)
      .addFields(
        { name: '📦 โซลูชันเป้าหมาย', value: solutionTitle, inline: true },
        { name: '📊 ความยาว', value: `${charCount} ตัวอักษร (${byteCount} bytes / สูงสุด 300)`, inline: true },
        { name: '🏷️ แท็ก', value: tagsFormatted, inline: true },
        { name: '⚡ การทำงาน', value: 'อนุมัติแล้วจะยิงโพสต์ขึ้นหน้าฟีด Bluesky ทันที', inline: false }
      )
      .setFooter({ text: `Draft ID: #${d.id} • สถานะ: ${d.status || 'รออนุมัติ'}` })
      .setTimestamp();

    actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`flow2_publish_${d.id}`).setLabel('🚀 เผยแพร่สดบน Bluesky').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`flow2_edit_${d.id}`).setLabel('✏️ แก้ไขข้อความ').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`flow2_reject_${d.id}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
    );

  } else if (d.platform === 'devto') {
    // 📝 Dev.to: Technical Guide (Draft Mode)
    const previewText = cut(d.content_markdown, 380);

    embed = new EmbedBuilder()
      .setTitle(`📝 [Dev.to] บทความเทคนิค (Draft Mode)`)
      .setColor(0x0a0a0a)
      .setDescription(`📌 **ชื่อบทความ:** ${d.title_th || solutionTitle}\n🛡️ **โหมดความปลอดภัย:** ส่งเข้า **แบบร่าง (Unpublished Draft)** บน Dev.to`)
      .addFields(
        { name: '📦 โซลูชันเป้าหมาย', value: solutionTitle, inline: true },
        { name: '🏷️ แท็ก', value: tagsFormatted, inline: true },
        { name: '📄 ตัวอย่างเนื้อหา (Preview)', value: `\`\`\`markdown\n${previewText}\n\`\`\``, inline: false },
        { name: '💡 ขั้นตอนแนะนำ', value: 'เมื่อกดยืนยัน บทความจะถูกส่งเข้าหน้า Drafts บน Dev.to ทีมงานสามารถคลิกลิงก์ไปตรวจเช็กฟอร์แมตและกด Publish บนเว็บ Dev.to ได้อย่างปลอดภัย ไม่ถูกระบบ Anti-Spam แบน', inline: false }
      )
      .setFooter({ text: `Draft ID: #${d.id} • สถานะ: ${d.status || 'บันทึกเป็นแบบร่าง'}` })
      .setTimestamp();

    actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`flow2_publish_${d.id}`).setLabel('📝 ส่งเข้า Draft บน Dev.to').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`flow2_edit_${d.id}`).setLabel('✏️ แก้ไขเนื้อหา').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`flow2_reject_${d.id}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
    );

  } else {
    // 📰 Manual: Long-Form Enterprise Article
    const previewText = cut(d.content_markdown, 380);

    embed = new EmbedBuilder()
      .setTitle(`📰 [บทความยาว] Manual Enterprise Article`)
      .setColor(0x6366f1)
      .setDescription(`📌 **ชื่อบทความ:** ${d.title_th || solutionTitle}\n🎯 **แพลตฟอร์มแนะนำ:** Blognone, TechTalkThai, สื่อไอที, เว็บไซต์องค์กร`)
      .addFields(
        { name: '📦 โซลูชันเป้าหมาย', value: solutionTitle, inline: true },
        { name: '🏷️ แท็ก', value: tagsFormatted, inline: true },
        { name: '📄 ตัวอย่างเนื้อหา (Preview)', value: `\`\`\`markdown\n${previewText}\n\`\`\``, inline: false },
        { name: '💡 การทำงาน', value: 'กดปุ่ม **"คัดลอกบทความเต็ม"** เพื่อนำ Markdown ไปโพสต์ หรือกด **"ทำเครื่องหมายพร้อมใช้งาน"** เพื่อบันทึกสถานะในระบบ', inline: false }
      )
      .setFooter({ text: `Draft ID: #${d.id} • สถานะ: ${d.status || 'สำหรับคัดลอกไปเผยแพร่ด้วยตนเอง'}` })
      .setTimestamp();

    actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`flow2_copy_${d.id}`).setLabel('📋 คัดลอกบทความเต็ม').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`flow2_edit_${d.id}`).setLabel('✏️ แก้ไขเนื้อหา').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`flow2_publish_${d.id}`).setLabel('✅ ทำเครื่องหมายพร้อมใช้งาน').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`flow2_reject_${d.id}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
    );
  }

  return { embed, actionRow };
}

function buildRadarEmbedsAndMenu(threads, solutionsCovered = []) {
  const cut = (str, len) => (String(str || '').length > len ? str.slice(0, len - 3) + '...' : str || '');
  const getEmoji = (plat) => {
    if (plat === 'pantip') return '🔴';
    if (plat === 'linkedin') return '🔵';
    if (plat === 'facebook') return '🔷';
    return '🌐';
  };

  const embeds = [];
  const chunkSize = 5;
  const totalChunks = Math.ceil(threads.length / chunkSize) || 1;

  for (let c = 0; c < totalChunks; c++) {
    const chunk = threads.slice(c * chunkSize, (c + 1) * chunkSize);
    const startNum = c * chunkSize + 1;

    let desc = '';
    if (c === 0) {
      const nowYear = new Date().getFullYear();
      const prevYear = nowYear - 1;
      const nowBE = nowYear + 543;
      const prevBE = nowBE - 1;
      const solText = solutionsCovered.length > 0 ? cut(solutionsCovered.join(', '), 150) : 'SyaCo Enterprise Solutions';
      desc += `🎯 **โซลูชันที่สำรวจ:** ${solText}\n📅 **เงื่อนไข:** กระทู้/โพสต์ล่าสุดไม่เกิน 1 ปี (${prevYear} - ${nowYear} / พ.ศ. ${prevBE} - ${nowBE})\n💡 **คำแนะนำ:** เลือกกระทู้ที่ต้องการจากเมนูด้านล่างเพื่อให้ AI ร่างคำตอบได้ทันที\n\n`;
    }

    desc += chunk.map((t, idx) => {
      const num = startNum + idx;
      const emoji = getEmoji(t.platform);
      const title = cut(t.post_title || t.title, 60);
      const snippet = cut(t.snippet, 70);
      const categoryTag = t.solutionCategory ? `\`${cut(t.solutionCategory, 25)}\`` : `\`${(t.platform || 'WEB').toUpperCase()}\``;
      return `**${num}.** ${emoji} [${title}](${t.post_url}) ${categoryTag}\n> ${snippet || 'ไม่มีคำอธิบายเพิ่มเติม'}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle(`🌅 [Daily Thread Radar] เรดาร์กระทู้ประจำวัน (${c + 1}/${totalChunks}) — ทั้งหมด ${threads.length} รายการ`)
      .setColor(0x5865f2)
      .setDescription(cut(desc, 1800) || 'ไม่พบรายการ')
      .setFooter({ text: `SyaCo Community Lead Hunter • หน้า ${c + 1}/${totalChunks}` })
      .setTimestamp();

    embeds.push(embed);
  }

  // สร้าง StringSelectMenu สำหรับเลือกกระทู้ที่ต้องการร่างคำตอบ (สูงสุด 25 ตัวเลือก)
  const menuOptions = threads.slice(0, 25).map((t, idx) => {
    const num = idx + 1;
    const cleanTitle = cut(t.post_title || t.title || 'กระทู้ไม่มีชื่อ', 50);
    const cleanSnippet = cut(t.snippet || t.post_url, 45);
    return {
      label: `${num}. [${(t.platform || 'WEB').toUpperCase()}] ${cleanTitle}`,
      description: cleanSnippet || t.post_url,
      value: String(t.id),
      emoji: getEmoji(t.platform)
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_radar_draft')
    .setPlaceholder('🎯 เลือกกระทู้ที่ต้องการให้ AI ช่วยร่างคำตอบ (เลือกได้ 1-5 ข้อ)...')
    .setMinValues(1)
    .setMaxValues(Math.min(5, menuOptions.length))
    .addOptions(menuOptions);

  const actionRow = new ActionRowBuilder().addComponents(selectMenu);

  return { embeds, components: [actionRow] };
}

// 2. กำหนดคำสั่งทั้งหมด (7 คำสั่งหลัก สั้น กระชับ จำง่าย ครบทุกฟังก์ชัน)
const commands = [
  // 1. /find - ค้นหากระทู้/โพสต์น่าสนใจ หรือดึงเรดาร์ประจำวัน 20 รายการ
  new SlashCommandBuilder()
    .setName('find')
    .setDescription('ค้นหากระทู้/โพสต์น่าสนใจ (ไม่เกิน 1 ปี) หรือดึงเรดาร์ประจำวัน พร้อมเมนูให้ AI ร่างคำตอบ')
    .addStringOption(option =>
      option.setName('keyword')
        .setDescription('คำค้นหา เช่น ERP, สต็อก (หากเว้นว่าง ระบบจะดึงเรดาร์ออโต้ ~20 รายการ)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('platform')
        .setDescription('เลือกแพลตฟอร์ม (ค่าเริ่มต้น: ทุกแพลตฟอร์ม)')
        .setRequired(false)
        .addChoices(
          { name: '🌐 ทุกแพลตฟอร์ม (Pantip, LinkedIn, Facebook)', value: 'all' },
          { name: '🔴 Pantip', value: 'pantip' },
          { name: '🔵 LinkedIn', value: 'linkedin' },
          { name: '🔷 Facebook', value: 'facebook' }
        )
    )
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('จำนวนกระทู้ที่ต้องการ (1-25 รายการ, ค่าเริ่มต้น: 20)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  // 2. /answer - ส่งคำถามกระทู้ให้ AI ช่วยตอบ
  new SlashCommandBuilder()
    .setName('answer')
    .setDescription('ส่งคำถามหรือโพสต์จาก Pantip, LinkedIn, Facebook ให้ AI ช่วยร่างคำตอบ')
    .addStringOption(option =>
      option.setName('platform')
        .setDescription('แพลตฟอร์มต้นทาง')
        .setRequired(true)
        .addChoices(
          { name: 'Pantip', value: 'pantip' },
          { name: 'LinkedIn', value: 'linkedin' },
          { name: 'Facebook', value: 'facebook' },
          { name: 'Facebook Group', value: 'facebook_group' }
        )
    ),

  // 3. /settings - จัดการการตั้งค่าทั้งหมดในที่เดียว
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('จัดการการตั้งค่าระบบบอทและตารางเวลา')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('ดูค่าการตั้งค่าปัจจุบันทั้งหมด (ห้องแจ้งเตือน, เวลาเรดาร์, สิทธิ์)')
    )
    .addSubcommand(sub =>
      sub.setName('radar')
        .setDescription('ตั้งเวลาดึงกระทู้อัตโนมัติประจำวัน')
        .addStringOption(opt =>
          opt.setName('time')
            .setDescription('เวลา HH:MM เช่น 11:00 หรือ 09:00 (เวลาไทย)')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('เปิดหรือปิดระบบดึงอัตโนมัติ')
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName('limit')
            .setDescription('จำนวนกระทู้เป้าหมาย (5-25 รายการ)')
            .setRequired(false)
            .setMinValue(5)
            .setMaxValue(25)
        )
    )
    .addSubcommand(sub =>
      sub.setName('channel')
        .setDescription('ตั้งค่าห้องนี้ (หรือห้องที่เลือก) เป็นห้องรับแจ้งเตือน')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('ห้องที่ต้องการ (เว้นว่างเพื่อใช้ห้องปัจจุบัน)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('admin')
        .setDescription('ตั้งค่า Discord User IDs ที่มีสิทธิ์อนุมัติ/เผยแพร่')
        .addStringOption(opt =>
          opt.setName('ids')
            .setDescription('User IDs คั่นด้วย comma')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('devto')
        .setDescription('ตั้งค่า Dev.to API Key หรือ Cookie (เปิดหน้าต่างกรอก)')
    ),

  // 4. /status - รวมการดูภาพรวมสถิติ, รายการรอรีวิว, และรายการที่โพสต์แล้ว
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('ดูภาพรวมจำนวนรายการ หรือดูรายการที่รอตรวจสอบ/โพสต์แล้ว')
    .addStringOption(opt =>
      opt.setName('view')
        .setDescription('เลือกประเภทข้อมูลที่ต้องการดู (ค่าเริ่มต้น: สรุปภาพรวม)')
        .setRequired(false)
        .addChoices(
          { name: '📊 สรุปภาพรวมสถิติ (Overview)', value: 'overview' },
          { name: '⏳ รายการที่รอรีวิว (Pending Review)', value: 'pending' },
          { name: '✅ รายการที่โพสต์สำเร็จแล้ว (Posted)', value: 'posted' }
        )
    )
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription('จำนวนรายการที่ต้องการแสดง (1-10 รายการ)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  // 5. /drafts - ดูรายการดราฟต์บทความ Flow 2 ที่รอการตรวจสอบ (Pending Review)
  new SlashCommandBuilder()
    .setName('drafts')
    .setDescription('ดูรายการดราฟต์บทความ Flow 2 ที่รอการตรวจสอบ (Pending Review)')
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription('จำนวนดราฟต์ที่ต้องการดู (ค่าเริ่มต้น: 5)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('view')
        .setDescription('เลือกประเภทดราฟต์ (ค่าเริ่มต้น: pending)')
        .setRequired(false)
    ),

  // 6. /idea - ขอไอเดียโซลูชันใหม่จาก Flow 1
  new SlashCommandBuilder()
    .setName('idea')
    .setDescription('ขอไอเดียโซลูชันใหม่จาก Flow 1 (วิเคราะห์ข่าวสารและเทคโนโลยี Enterprise)')
    .addStringOption(opt =>
      opt.setName('solution')
        .setDescription('เลือกโซลูชันหลักที่ต้องการต่อยอด (แสดงชื่อจากระบบ SyaCo)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  // 7. /health - ตรวจสอบความเร็วและสถานะระบบ (Ping, DB, n8n, AI, APIs)
  new SlashCommandBuilder()
    .setName('health')
    .setDescription('ตรวจสอบความเร็วและสถานะระบบ (Ping, DB, n8n, AI, APIs)'),

  // 8. /help - แสดงคู่มือการใช้งาน
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
    // 1. ล้าง Global Slash Commands ทิ้งทั้งหมด (เพื่อไม่ให้แสดงคำสั่งซ้ำ 2 อันใน Discord)
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [] }
    );
    console.log('🧹 [Commands] ล้าง Global Slash Commands เรียบร้อย (ป้องกันคำสั่งซ้ำ)');

    // 2. รวบรวม Server ID ทั้งหมดที่บอทเข้าร่วม
    const targetGuilds = new Set();
    if (serverId) targetGuilds.add(serverId);
    if (client.guilds && client.guilds.cache.size > 0) {
      for (const gId of client.guilds.cache.keys()) {
        targetGuilds.add(gId);
      }
    }

    // 3. ลงทะเบียนเฉพาะ Guild Commands (อัปเดตทันที ไม่ดีเลย์ และไม่ซ้ำ)
    for (const gId of targetGuilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, gId),
          { body: commandData }
        );
        console.log(`✅ [Commands] ลงทะเบียน Guild Slash Commands เข้า Server ID: ${gId} สำเร็จ!`);
      } catch (gErr) {
        console.warn(`[Commands] ข้าม Server ID "${gId}":`, gErr.message);
      }
    }
  } catch (error) {
    console.error('❌ [Commands] เกิดข้อผิดพลาดในการลงทะเบียน Commands:', error);
  }
}

// 4. ฟังก์ชันประมวลผลคำสั่งเมื่อผู้ใช้พิมพ์ในแชท (Handle Commands)
async function handleCommand(interaction, { pool, client }) {
  const { commandName } = interaction;

  // 1. คำสั่ง /find (ค้นหากระทู้/โพสต์น่าสนใจ หรือดึงเรดาร์ประจำวัน 20 รายการ)
  if (commandName === 'find' || commandName === 'find-threads' || commandName === 'radar') {
    const rawKeyword = (interaction.options?.getString?.('keyword') || '').trim();
    const platform = interaction.options?.getString?.('platform') || 'all';
    const limit = interaction.options?.getInteger?.('limit') || 20;

    await interaction.deferReply();

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS thread_search_cache (
          id SERIAL PRIMARY KEY,
          platform VARCHAR(50) NOT NULL,
          post_url TEXT NOT NULL,
          post_title TEXT NOT NULL,
          snippet TEXT,
          search_keyword TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      const { collectDailyRadarThreads, searchRecentThreads } = require('./thread-search');

      // ดึงรายการ URL ที่เคยค้นพบไปแล้ว (จาก cache และ backlink candidates) เพื่อป้องกันการค้นพบซ้ำ
      const { rows: cachedRows } = await pool.query(`
        SELECT DISTINCT post_url FROM thread_search_cache WHERE created_at > NOW() - INTERVAL '7 days'
        UNION
        SELECT DISTINCT post_url FROM backlink_candidates WHERE platform = $1 OR $1 = 'all'
      `, [platform]);
      const excludeUrls = new Set(cachedRows.map(r => r.post_url).filter(Boolean));

      // เป็นโหมด Radar เมื่อไม่ได้ระบุคีย์เวิร์ด และเลือกแพลตฟอร์มทั้งหมด (all)
      const isRadar = (!rawKeyword || rawKeyword === 'auto') && platform === 'all';
      let results = [];
      let solutionsCovered = [];

      if (isRadar) {
        const radarRes = await collectDailyRadarThreads(limit, excludeUrls);
        results = radarRes.results;
        solutionsCovered = radarRes.solutionsCovered;
      } else {
        const isAutoCategory = !rawKeyword || rawKeyword === 'auto' || rawKeyword.startsWith('auto:');
        const mode = isAutoCategory ? 'auto' : 'manual';
        const searchRes = await searchRecentThreads({
          keyword: rawKeyword,
          mode,
          platform,
          limit,
          excludeUrls
        });
        results = searchRes.results;
        if (searchRes.autoMeta?.solutionTitle) {
          solutionsCovered = [searchRes.autoMeta.solutionTitle];
        } else {
          solutionsCovered = [rawKeyword || (platform !== 'all' ? platform.toUpperCase() : 'General')];
        }
      }

      // หากคัดกรองด้วย excludeUrls แล้วผลลัพธ์ว่างเปล่า ให้ผ่อนปรนค้นหาซ้ำโดยไม่ตัด excludeUrls
      // เพื่อให้ผู้ใช้มีกระทู้คุณภาพสำหรับสร้าง Backlink เสมอ (ป้องกันข้อความ "ไม่พบกระทู้")
      if (!results.length && excludeUrls.size > 0) {
        if (isRadar) {
          const fallbackRadar = await collectDailyRadarThreads(limit, new Set());
          results = fallbackRadar.results;
          solutionsCovered = fallbackRadar.solutionsCovered;
        } else {
          const isAutoCategory = !rawKeyword || rawKeyword === 'auto' || rawKeyword.startsWith('auto:');
          const mode = isAutoCategory ? 'auto' : 'manual';
          const fallbackRes = await searchRecentThreads({
            keyword: rawKeyword,
            mode,
            platform,
            limit,
            excludeUrls: new Set()
          });
          results = fallbackRes.results;
          if (fallbackRes.autoMeta?.solutionTitle) {
            solutionsCovered = [fallbackRes.autoMeta.solutionTitle];
          } else {
            solutionsCovered = [rawKeyword || (platform !== 'all' ? platform.toUpperCase() : 'General')];
          }
        }
      }

      if (!results.length) {
        return await interaction.editReply('🔍 ไม่พบกระทู้หรือโพสต์ใหม่ที่ตรงกับเงื่อนไขในช่วง 1 ปีนี้ กรุณาลองใหม่อีกครั้ง');
      }

      // บันทึกลง thread_search_cache เพื่อเชื่อมกับ Select Menu
      const savedRows = [];
      for (const item of results) {
        const { rows } = await pool.query(
          `INSERT INTO thread_search_cache (platform, post_url, post_title, snippet, search_keyword)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [item.platform, item.url, item.title, item.snippet || '', item.solutionCategory || rawKeyword || 'find_search']
        );
        savedRows.push({
          ...rows[0],
          solutionCategory: item.solutionCategory
        });
      }

      const { embeds, components } = buildRadarEmbedsAndMenu(savedRows, solutionsCovered);
      if (embeds.length <= 2) {
        return await interaction.editReply({ embeds, components });
      } else {
        const half = Math.ceil(embeds.length / 2);
        await interaction.editReply({
          content: `🌅 **ผลการค้นหากระทู้/เรดาร์ (ส่วนที่ 1/2) — ทั้งหมด ${savedRows.length} รายการ**`,
          embeds: embeds.slice(0, half)
        });
        return await interaction.followUp({
          content: `(ส่วนที่ 2/2) 👇 **เลือกกระทู้ที่ต้องการให้ AI ช่วยร่างคำตอบจากเมนูด้านล่างได้ทันทีครับ:**`,
          embeds: embeds.slice(half),
          components
        });
      }
    } catch (err) {
      console.error('[find] Error:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาดในการค้นหากระทู้: ${err.message}`);
    }
  }

  // 2. คำสั่ง /answer (ส่งคำถามกระทู้ให้ AI ช่วยตอบ)
  if (commandName === 'answer') {
    const platform = interaction.options.getString('platform');
    const modal = new ModalBuilder()
      .setCustomId(`modal_answer_${platform}`)
      .setTitle(`ส่งคำถามกระทู้ [${platform}]`);

    const urlInput = new TextInputBuilder()
      .setCustomId('post_url')
      .setLabel('ลิงก์กระทู้ (URL)')
      .setPlaceholder('https://pantip.com/topic/43000000')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const questionInput = new TextInputBuilder()
      .setCustomId('question_text')
      .setLabel('ข้อความคำถามในกระทู้ (คัดลอกมาวาง)')
      .setPlaceholder('วางข้อความคำถามที่ต้องการให้ AI วิเคราะห์ที่นี่...')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(2000)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(urlInput),
      new ActionRowBuilder().addComponents(questionInput)
    );
    return await interaction.showModal(modal);
  }

  // 3. คำสั่ง /settings (จัดการการตั้งค่าทั้งหมดในที่เดียว)
  if (commandName === 'settings') {
    const subcommand = interaction.options.getSubcommand();

    // 3.1 /settings view
    if (subcommand === 'view') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const { rows: settingsRows } = await pool.query('SELECT key, value FROM bot_settings');
        const getSetting = (k, def = '') => settingsRows.find(r => r.key === k)?.value || process.env[k] || def;

        const radarTime = getSetting('DAILY_RADAR_TIME', '11:00');
        const radarEnabled = getSetting('DAILY_RADAR_ENABLED', 'true') !== 'false';
        const radarLimit = getSetting('DAILY_RADAR_LIMIT', '20');
        const channelId = getSetting('DISCORD_CHANNEL_ID', '');
        const adminRaw = getSetting('DISCORD_ADMIN_IDS', '');
        const devtoKey = getSetting('DEVTO_API_KEY', '');
        const devtoCookie = getSetting('DEVTO_COOKIE', '');

        const adminIds = adminRaw.split(/[,;\s]+/).filter(Boolean);
        const channelText = channelId ? `<#${channelId}> (\`${channelId}\`)` : '`ยังไม่ได้ระบุ (ใช้ /settings channel เพื่อตั้งค่า)`';
        const adminText = adminIds.length > 0
          ? adminIds.map(id => `<@${id}>`).join(', ')
          : '`ทุกคนในเซิร์ฟเวอร์มีสิทธิ์ (ไม่ได้จำกัด)`';

        const embed = new EmbedBuilder()
          .setTitle('⚙️ การตั้งค่าระบบบอทในปัจจุบัน (Bot Settings)')
          .setColor(0x5865f2)
          .addFields(
            { name: '📢 ห้องแจ้งเตือน', value: channelText, inline: false },
            { name: '⏰ เวลาเรดาร์กระทู้อัตโนมัติ', value: `\`${radarTime} น.\` (สถานะ: ${radarEnabled ? '🟢 เปิดใช้งาน' : '🔴 ปิด'})`, inline: true },
            { name: '🎯 จำนวนกระทู้เรดาร์', value: `\`${radarLimit} กระทู้\``, inline: true },
            { name: '🛡️ รายชื่อผู้ดูแลระบบ (Admin IDs)', value: adminText, inline: false },
            { name: '💻 Dev.to Integration', value: `API Key: ${devtoKey ? '🟢 บันทึกแล้ว' : '⚪ ยังไม่มี'} | Cookie: ${devtoCookie ? '🟢 บันทึกแล้ว' : '⚪ ยังไม่มี'}`, inline: false }
          )
          .setFooter({ text: 'พิมพ์ /settings [subcommand] เพื่อแก้ไขการตั้งค่า' })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return await interaction.editReply(`⚠️ เกิดข้อผิดพลาดในการดึงการตั้งค่า: ${err.message}`);
      }
    }

    // 3.2 /settings radar
    if (subcommand === 'radar') {
      const rawTime = interaction.options.getString('time');
      const enabled = interaction.options.getBoolean('enabled');
      const limit = interaction.options.getInteger('limit');

      if (!rawTime && enabled === null && !limit) {
        const { rows: tRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_TIME'");
        const { rows: eRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_ENABLED'");
        const { rows: lRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_LIMIT'");

        const curTime = tRows[0]?.value || '11:00';
        const curEnabled = eRows[0]?.value !== 'false';
        const curLimit = lRows[0]?.value || '20';

        const embed = new EmbedBuilder()
          .setTitle('⚙️ สถานะการตั้งค่า Daily Thread Radar')
          .setColor(curEnabled ? 0x57f287 : 0xed4245)
          .addFields(
            { name: '⏰ เวลาดึงกระทู้อัตโนมัติ', value: `\`${curTime} น.\` (เวลาไทย Asia/Bangkok)`, inline: true },
            { name: '📊 สถานะระบบอัตโนมัติ', value: curEnabled ? '🟢 เปิดใช้งาน (Active)' : '🔴 ปิดใช้งาน (Disabled)', inline: true },
            { name: '🎯 จำนวนกระทู้เป้าหมาย', value: `\`${curLimit} กระทู้\``, inline: true }
          )
          .setFooter({ text: 'ใช้ /settings radar time:11:00 enabled:true เพื่อปรับเปลี่ยน' });

        return await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      if (rawTime) {
        const match = rawTime.trim().match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
        if (!match) {
          return await interaction.editReply('⚠️ รูปแบบเวลาไม่ถูกต้อง กรุณากรอกเป็น `HH:MM` เช่น `11:00` หรือ `09:00`');
        }
        const hour = match[1].padStart(2, '0');
        const min = match[2];
        const timeFormatted = `${hour}:${min}`;
        await pool.query(
          "INSERT INTO bot_settings (key, value, updated_at) VALUES ('DAILY_RADAR_TIME', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
          [timeFormatted]
        );
      }

      if (enabled !== null) {
        await pool.query(
          "INSERT INTO bot_settings (key, value, updated_at) VALUES ('DAILY_RADAR_ENABLED', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
          [enabled ? 'true' : 'false']
        );
      }

      if (limit) {
        await pool.query(
          "INSERT INTO bot_settings (key, value, updated_at) VALUES ('DAILY_RADAR_LIMIT', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
          [String(limit)]
        );
      }

      return await interaction.editReply('✅ **บันทึกการตั้งค่า Daily Thread Radar เรียบร้อยแล้ว!**');
    }

    // 3.3 /settings channel
    if (subcommand === 'channel') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        if (!targetChannel) {
          return await interaction.editReply('❌ ไม่พบห้องที่ต้องการตั้งค่า');
        }

        await pool.query(`
          CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        await pool.query(`
          INSERT INTO bot_settings (key, value, updated_at)
          VALUES ('DISCORD_CHANNEL_ID', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW();
        `, [targetChannel.id]);

        process.env.DISCORD_CHANNEL_ID = targetChannel.id;
        updateEnvFile('DISCORD_CHANNEL_ID', targetChannel.id);

        const embed = new EmbedBuilder()
          .setTitle('✅ ตั้งค่าห้องแจ้งเตือนสำเร็จ!')
          .setColor(0x57f287)
          .setDescription(`ต่อไปนี้รายการ Backlink Candidates และผลการวิจัยจะถูกส่งมาที่ห้องนี้ครับ 🎉`)
          .addFields(
            { name: '📢 ห้องแจ้งเตือน', value: `<#${targetChannel.id}> (\`${targetChannel.name || targetChannel.id}\`)`, inline: true },
            { name: '🏠 เซิร์ฟเวอร์', value: interaction.guild ? `${interaction.guild.name}` : '-', inline: true }
          )
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
      }
    }

    // 3.4 /settings admin
    if (subcommand === 'admin') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const rawIds = interaction.options.getString('ids');
        const parsedIds = rawIds
          .split(/[,;\s]+/)
          .map(id => id.trim())
          .filter(Boolean);

        const currentAdmins = (process.env.DISCORD_ADMIN_IDS || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        if (currentAdmins.length > 0 && !currentAdmins.includes(interaction.user.id)) {
          return await interaction.editReply('⛔ คุณไม่มีสิทธิ์แก้ไขรายชื่อ Admin (เฉพาะแอดมินปัจจุบันเท่านั้น)');
        }

        const newVal = parsedIds.join(',');
        await pool.query(`
          CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        await pool.query(`
          INSERT INTO bot_settings (key, value, updated_at)
          VALUES ('DISCORD_ADMIN_IDS', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW();
        `, [newVal]);

        process.env.DISCORD_ADMIN_IDS = newVal;
        updateEnvFile('DISCORD_ADMIN_IDS', newVal);

        return await interaction.editReply(`✅ **ตั้งค่า DISCORD_ADMIN_IDS สำเร็จ!**\nรายชื่อผู้มีสิทธิ์ (${parsedIds.length} คน):\n${parsedIds.map(id => `• <@${id}> (\`${id}\`)`).join('\n')}`);
      } catch (err) {
        return await interaction.editReply(`⚠️ บันทึกไม่สำเร็จ: ${err.message}`);
      }
    }

    // 3.5 /settings devto
    if (subcommand === 'devto') {
      const embed = new EmbedBuilder()
        .setTitle('⚙️ ตั้งค่าการเชื่อมต่อ Dev.to (API Key & Cookie)')
        .setColor(0x5865f2)
        .setDescription('เลือกรายการที่ต้องการตั้งค่าด้านล่าง ระบบจะเปิดหน้าต่าง Popup กรอกข้อมูลอย่างปลอดภัย:')
        .addFields(
          { name: '🔑 Dev.to API Key', value: 'ใช้สำหรับการเผยแพร่บทความอัตโนมัติ (Publish Article)', inline: true },
          { name: '🍪 Dev.to Session Cookie', value: 'ใช้สำหรับการโพสต์ความคิดเห็นในบทความ (Comment)', inline: true }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_settings_devto_key')
          .setLabel('🔑 ตั้งค่า API Key')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_settings_devto_cookie')
          .setLabel('🍪 ตั้งค่า Cookie')
          .setStyle(ButtonStyle.Secondary)
      );

      return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
  }

  // Legacy command fallbacks for settings
  if (commandName === 'set-channel') {
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    await interaction.deferReply({ ephemeral: true });
    try {
      await pool.query(`
        INSERT INTO bot_settings (key, value, updated_at)
        VALUES ('DISCORD_CHANNEL_ID', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW();
      `, [targetChannel.id]);
      process.env.DISCORD_CHANNEL_ID = targetChannel.id;
      updateEnvFile('DISCORD_CHANNEL_ID', targetChannel.id);
      return await interaction.editReply(`✅ ตั้งค่าห้องแจ้งเตือนเป็น <#${targetChannel.id}> เรียบร้อยครับ`);
    } catch (e) {
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${e.message}`);
    }
  }
  if (commandName === 'set-admin-ids') {
    const rawIds = interaction.options.getString('ids');
    const parsedIds = rawIds.split(/[,;\s]+/).map(id => id.trim()).filter(Boolean);
    await interaction.deferReply({ ephemeral: true });
    const newVal = parsedIds.join(',');
    await pool.query(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES ('DISCORD_ADMIN_IDS', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW();
    `, [newVal]);
    process.env.DISCORD_ADMIN_IDS = newVal;
    updateEnvFile('DISCORD_ADMIN_IDS', newVal);
    return await interaction.editReply(`✅ ตั้งค่า Admin IDs สำเร็จ (${parsedIds.length} คน)`);
  }
  if (commandName === 'set-devto-key') {
    const modal = new ModalBuilder().setCustomId('modal_devto_key').setTitle('ตั้งค่า DEVTO_API_KEY');
    const keyInput = new TextInputBuilder().setCustomId('key_value').setLabel('Dev.to API Key').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
    return await interaction.showModal(modal);
  }
  if (commandName === 'set-devto-cookie') {
    const modal = new ModalBuilder().setCustomId('modal_devto_cookie').setTitle('ตั้งค่า DEVTO_COOKIE');
    const cookieInput = new TextInputBuilder().setCustomId('cookie_value').setLabel('Dev.to Cookie').setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(cookieInput));
    return await interaction.showModal(modal);
  }
  if (commandName === 'set-radar-time') {
    const rawTime = interaction.options.getString('time');
    const enabled = interaction.options.getBoolean('enabled');
    const match = (rawTime || '').trim().match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
    if (!match) return await interaction.reply({ content: '⚠️ กรุณาระบุเวลาเป็น HH:MM เช่น 11:00', ephemeral: true });
    const timeFormatted = `${match[1].padStart(2, '0')}:${match[2]}`;
    await pool.query("INSERT INTO bot_settings (key, value, updated_at) VALUES ('DAILY_RADAR_TIME', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [timeFormatted]);
    if (enabled !== null) {
      await pool.query("INSERT INTO bot_settings (key, value, updated_at) VALUES ('DAILY_RADAR_ENABLED', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [enabled ? 'true' : 'false']);
    }
    return await interaction.reply({ content: `✅ บันทึกเวลาเรดาร์เป็น ${timeFormatted} น. เรียบร้อยครับ`, ephemeral: true });
  }
  if (commandName === 'radar-status') {
    const { rows: tRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_TIME'");
    const { rows: eRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_ENABLED'");
    const curTime = tRows[0]?.value || '11:00';
    const curEnabled = eRows[0]?.value !== 'false';
    return await interaction.reply({ content: `⚙️ **Daily Radar:** เวลา \`${curTime} น.\` | สถานะ: ${curEnabled ? '🟢 เปิดใช้งาน' : '🔴 ปิดใช้งาน'}`, ephemeral: true });
  }

  // 4. คำสั่ง /drafts (ดูรายการดราฟต์บทความ Flow 2 ที่รอการตรวจสอบ)
  if (commandName === 'drafts') {
    await interaction.deferReply();
    const limit = interaction.options?.getInteger?.('limit') || 5;

    try {
      const { rows } = await pool.query(`
        SELECT id, solution_id, solution_title, platform, title_th, content_markdown, tags, status, created_at
        FROM content_drafts
        WHERE status = 'pending_review'
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `, [limit]);

      if (!rows.length) {
        return await interaction.editReply('🎉 ไม่มีดราฟต์บทความค้างตรวจในขณะนี้ (Pending: 0)');
      }

      const platformCounts = rows.reduce((acc, r) => {
        acc[r.platform] = (acc[r.platform] || 0) + 1;
        return acc;
      }, {});

      const platformSummary = Object.entries(platformCounts)
        .map(([p, cnt]) => `• **${p.toUpperCase()}**: ${cnt} รายการ`)
        .join('\n');

      const overviewEmbed = new EmbedBuilder()
        .setTitle(`📝 รายการดราฟต์บทความ Flow 2 ที่รอการตรวจสอบ (${rows.length} รายการล่าสุด)`)
        .setColor(0x5865f2)
        .setDescription(`พบดราฟต์บทความที่สถานะเป็น **Pending Review** ทั้งหมด **${rows.length}** รายการ:\n\n${platformSummary}`)
        .setFooter({ text: 'กดปุ่มที่การ์ดด้านล่างเพื่อเผยแพร่, แก้ไข หรือปฏิเสธแต่ละรายการ' })
        .setTimestamp();

      await interaction.editReply({ embeds: [overviewEmbed] });

      for (let i = 0; i < rows.length; i++) {
        const d = rows[i];
        const { embed: cardEmbed, actionRow } = buildFlow2Card(d, d.solution_title);
        await interaction.followUp({
          content: `📝 **[${i + 1}/${rows.length}] Draft ID: \`#${d.id}\`** | Platform: **${(d.platform || '').toUpperCase()}** | Solution: **${d.solution_title || d.title_th || '-'}**`,
          embeds: [cardEmbed],
          components: [actionRow]
        });
      }
      return;
    } catch (err) {
      console.error('Error in /drafts command:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาดในการดึงข้อมูลดราฟต์: ${err.message}`);
    }
  }

  // 5. คำสั่ง /status (ภาพรวม, รายการรอรีวิว, หรือรายการที่โพสต์แล้ว)
  if (commandName === 'status' || commandName === 'pending' || commandName === 'posted' || commandName === 'recent-posted' || commandName === 'latest' || commandName === 'get') {
    let view = interaction.options?.getString?.('view') || 'overview';
    if (commandName === 'pending') view = 'pending';
    if (commandName === 'posted' || commandName === 'recent-posted') view = 'posted';

    const limit = interaction.options?.getInteger?.('limit') || 5;

    // Handle legacy /get [id]
    if (commandName === 'get') {
      const candidateId = interaction.options.getString('id')?.trim();
      await interaction.deferReply();
      try {
        const { rows } = await pool.query('SELECT * FROM backlink_candidates WHERE id::text = $1', [candidateId]);
        if (!rows.length) return await interaction.editReply(`❌ ไม่พบข้อมูล Candidate ID: ${candidateId}`);
        const row = rows[0];
        const embed = createCandidateEmbed(row);
        const actionRow = createActionButtons(row.id);
        return await interaction.editReply({
          content: `🔍 **Candidate ID: \`${row.id}\`** (สถานะ: \`${row.status}\`)`,
          embeds: [embed],
          components: [actionRow]
        });
      } catch (err) {
        return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
      }
    }

    // View: pending
    if (view === 'pending') {
      await interaction.deferReply();
      try {
        const { rows: backlinkRows } = await pool.query(`
          SELECT *
          FROM backlink_candidates
          WHERE status = 'pending_review'
          ORDER BY created_at DESC, id DESC
          LIMIT $1
        `, [limit]);

        const { rows: draftRows } = await pool.query(`
          SELECT id, solution_id, solution_title, platform, title_th, content_markdown, tags, status, created_at
          FROM content_drafts
          WHERE status = 'pending_review'
          ORDER BY created_at DESC, id DESC
          LIMIT $1
        `, [limit]);

        if (!backlinkRows.length && !draftRows.length) {
          return await interaction.editReply('🎉 **ไม่มีรายการค้างที่รอรีวิวในขณะนี้!** (Pending Review: 0)');
        }

        const summaryEmbed = new EmbedBuilder()
          .setTitle('⏳ รายการที่รอการตรวจสอบ (Pending Review)')
          .setColor(0xfee75c)
          .setDescription('สรุปรายการทั้งหมดที่ค้างอยู่ในระบบและต้องการการตรวจสอบ:')
          .addFields(
            { name: '💬 กระทู้รอตอบ (Flow 3)', value: `**${backlinkRows.length}** รายการ`, inline: true },
            { name: '📝 ดราฟต์บทความรอยืนยัน (Flow 2)', value: `**${draftRows.length}** รายการ`, inline: true }
          )
          .setFooter({ text: 'คุณสามารถใช้ /drafts เพื่อดูเฉพาะดราฟต์บทความ Flow 2 ได้โดยตรง' })
          .setTimestamp();

        await interaction.editReply({ embeds: [summaryEmbed] });

        // 1. Follow up with Flow 3 Backlink Candidates
        for (let i = 0; i < backlinkRows.length; i++) {
          const row = backlinkRows[i];
          const embed = createCandidateEmbed(row);
          const actionRow = createActionButtons(row.id);
          await interaction.followUp({
            content: `💬 **[Flow 3] [${i + 1}/${backlinkRows.length}] Candidate ID: \`${row.id}\`** | Platform: **${row.platform}** | Score: \`${row.match_score || '-'}\``,
            embeds: [embed],
            components: [actionRow]
          });
        }

        // 2. Follow up with Flow 2 Content Drafts
        for (let i = 0; i < draftRows.length; i++) {
          const d = draftRows[i];
          const { embed: draftEmbed, actionRow } = buildFlow2Card(d, d.solution_title);
          await interaction.followUp({
            content: `📝 **[Flow 2] [${i + 1}/${draftRows.length}] Draft ID: \`#${d.id}\`** | Platform: **${(d.platform || '').toUpperCase()}** | Solution: **${d.solution_title || d.title_th || '-'}**`,
            embeds: [draftEmbed],
            components: [actionRow]
          });
        }
        return;
      } catch (err) {
        return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
      }
    }

    // View: posted
    if (view === 'posted') {
      await interaction.deferReply();
      try {
        const { rows } = await pool.query(`
          SELECT id, platform, post_title, post_url, posted_url, posted_at
          FROM backlink_candidates
          WHERE status = 'posted'
          ORDER BY posted_at DESC NULLS LAST, id DESC
          LIMIT $1
        `, [limit]);

        if (!rows.length) {
          return await interaction.editReply('📋 ยังไม่มีรายการที่โพสต์สำเร็จในระบบ (สถานะ `posted`)');
        }

        const embed = new EmbedBuilder()
          .setTitle(`✅ รายการที่โพสต์สำเร็จ (${rows.length} รายการล่าสุด)`)
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
        return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
      }
    }

    // Default View: overview
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
        .setTitle('📊 ภาพรวมสถานะ Backlink Candidates ทั้งหมด')
        .setColor(0x5865f2)
        .addFields(fields)
        .setFooter({ text: 'พิมพ์ /status view:pending หรือ view:posted เพื่อดูรายการเจาะจง' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // 5. คำสั่ง /idea (และ alias /request-idea, /run)
  if (commandName === 'idea' || commandName === 'request-idea' || commandName === 'run' || commandName === 'run-research') {
    await interaction.deferReply();
    const webhookUrl = process.env.N8N_FLOW1_IDEA_WEBHOOK_URL || 'http://n8n:5678/webhook/flow1-request-idea';

    const solutionInput = interaction.options.getString('solution');
    let targetSolutionId = null;
    let targetSolutionTitle = null;

    if (solutionInput) {
      try {
        const trimmed = solutionInput.trim();
        const { rows } = await pool.query(
          'SELECT solution_id, solution_title FROM processed_solutions WHERE LOWER(solution_title) = LOWER($1) OR solution_id = $1 LIMIT 1',
          [trimmed]
        );
        if (rows.length > 0) {
          targetSolutionId = rows[0].solution_id;
          targetSolutionTitle = rows[0].solution_title;
        } else {
          const { rows: partialRows } = await pool.query(
            'SELECT solution_id, solution_title FROM processed_solutions WHERE LOWER(solution_title) LIKE LOWER($1) LIMIT 1',
            [`%${trimmed}%`]
          );
          if (partialRows.length > 0) {
            targetSolutionId = partialRows[0].solution_id;
            targetSolutionTitle = partialRows[0].solution_title;
          }
        }
      } catch (dbErr) {
        console.error('Error resolving solution for /idea:', dbErr);
      }
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggered_by: interaction.user.tag,
          user_id: interaction.user.id,
          requested_at: new Date().toISOString(),
          target_solution_id: targetSolutionId || null,
          target_solution_title: targetSolutionTitle || null
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (res.ok) {
        const targetMsg = targetSolutionTitle
          ? `\n🎯 **เจาะจงโซลูชันหลัก:** \`${targetSolutionTitle}\` (ID: ${targetSolutionId})`
          : '\n🎲 **โหมด:** สำรวจและกระจายไอเดียตามแนวโน้มเทคโนโลยี (ครอบคลุมทุกโซลูชัน)';

        return await interaction.editReply(
          `💡 **สั่งขอไอเดียโซลูชันใหม่บน n8n สำเร็จแล้ว!**${targetMsg}\nระบบกำลังดึงข้อมูลฟีด TechTalkThai & Blognone เพื่อวิเคราะห์ Gap และสร้าง Adjacent Solution ผ่าน Gemini AI\nเมื่อประมวลผลเสร็จแล้วจะส่งการแจ้งเตือนมายังห้องนี้ครับ`
        );
      } else {
        return await interaction.editReply(
          `⚠️ **n8n ตอบกลับสถานะ HTTP ${res.status}**\nปลายทาง: \`${webhookUrl}\``
        );
      }
    } catch (err) {
      return await interaction.editReply(
        `⚠️ **ไม่สามารถเรียก n8n ได้:** ${err.message}\nปลายทาง: \`${webhookUrl}\``
      );
    }
  }

  // 6. คำสั่ง /health (และ alias /ping)
  if (commandName === 'health' || commandName === 'ping') {
    await interaction.deferReply();

    const wsPing = client.ws.ping >= 0 ? `${client.ws.ping}ms` : 'กำลังคำนวณ...';

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

    // 4. Check Dev.to
    let devtoStatus = '⚪ Not Configured';
    const devApiKey = (process.env.DEVTO_API_KEY || '').trim();
    const devCookie = (process.env.DEVTO_COOKIE || '').trim();

    let apiStatusText = '';
    if (devApiKey) {
      try {
        const userRes = await fetch('https://dev.to/api/users/me', {
          headers: { 'api-key': devApiKey },
          signal: AbortSignal.timeout(4000)
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          apiStatusText = `🟢 API (@${userData.username || 'User'})`;
        } else {
          apiStatusText = `🔴 API Invalid (HTTP ${userRes.status})`;
        }
      } catch (e) {
        apiStatusText = `🔴 API Error: ${e.message}`;
      }
    }

    let cookieStatusText = '';
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
          cookieStatusText = `🟢 Cookie (@${devData.user.username || 'User'})`;
        } else {
          cookieStatusText = '🔴 Cookie Expired';
        }
      } catch (e) {
        cookieStatusText = `🔴 Cookie Error: ${e.message}`;
      }
    }

    if (apiStatusText && cookieStatusText) {
      devtoStatus = `${apiStatusText} • ${cookieStatusText}`;
    } else if (apiStatusText) {
      devtoStatus = apiStatusText;
    } else if (cookieStatusText) {
      devtoStatus = cookieStatusText;
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

    // 6. Notification Channel
    const currentChannelId = process.env.DISCORD_CHANNEL_ID;
    const channelDisplay = currentChannelId ? `<#${currentChannelId}> (\`${currentChannelId}\`)` : '⚪ Not Set (ใช้ `/settings channel` เพื่อตั้งค่า)';

    const embed = new EmbedBuilder()
      .setTitle('🩺 รายงานสถานะสุขภาพระบบ (System Health & Ping)')
      .setColor(0x5865f2)
      .addFields(
        { name: '🏓 Discord Gateway Latency', value: `\`${wsPing}\``, inline: true },
        { name: '🐘 PostgreSQL Database', value: pgStatus, inline: true },
        { name: '⚡ n8n Service', value: n8nStatus, inline: true },
        { name: '🤖 Gemini AI', value: geminiStatus, inline: false },
        { name: '🦋 Bluesky Account', value: bskyStatus, inline: true },
        { name: '💻 Dev.to Connection', value: devtoStatus, inline: true },
        { name: '📢 Notification Channel', value: channelDisplay, inline: false }
      )
      .setTimestamp();

    return await interaction.editReply({ embeds: [embed] });
  }

  // 8. คำสั่ง /help (แสดงคู่มือคำสั่งทั้ง 8)
  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 คู่มือคำสั่ง Discord Bot (SyaCo Community & Content Stack)')
      .setColor(0x57f287)
      .setDescription('คำสั่งทั้งหมด 8 คำสั่งหลัก สั้น กระชับ จำง่าย ครบทุกฟังก์ชัน:')
      .addFields(
        {
          name: '1. `/find [keyword] [platform] [limit]`',
          value: '• ค้นหากระทู้/โพสต์น่าสนใจ (ไม่เกิน 1 ปี) พร้อม Dropdown ให้ AI ร่างคำตอบทันที\n• **เว้นช่อง keyword ว่าง:** ดึงเรดาร์ออโต้ ~20 รายการครอบคลุมทุกหมวดโซลูชัน SyaCo\n• **ใส่ keyword:** ค้นหาคำที่ต้องการ หรือเลือกหมวดหมู่อัตโนมัติ'
        },
        {
          name: '2. `/answer <platform>`',
          value: '• ส่งลิงก์กระทู้หรือคำถามจาก Pantip, LinkedIn, Facebook ให้ AI ช่วยวิเคราะห์และร่างคำตอบ'
        },
        {
          name: '3. `/settings <view | radar | channel | admin | devto>`',
          value: '• ศูนย์กลางจัดการการตั้งค่าทั้งหมด:\n  - `/settings view`: ดูค่าปัจจุบันทั้งหมด\n  - `/settings radar time:11:00 enabled:true`: ตั้งเวลาเรดาร์ประจำวัน\n  - `/settings channel`: ตั้งห้องนี้เป็นห้องแจ้งเตือน\n  - `/settings admin ids:...`: กำหนดสิทธิ์แอดมิน\n  - `/settings devto`: ตั้งค่า Dev.to API Key & Cookie'
        },
        {
          name: '4. `/status [view] [limit]`',
          value: '• ดูสถานะงาน:\n  - `overview`: สรุปจำนวนรายการทั้งหมดในระบบ\n  - `pending`: แสดงรายการที่รอรีวิวพร้อมปุ่ม Approve / Edit / Reject (รวมทั้งกระทู้ Flow 3 และบทความ Flow 2)\n  - `posted`: แสดงรายการที่โพสต์สำเร็จพร้อมลิงก์'
        },
        {
          name: '5. `/drafts [limit]`',
          value: '• ดูรายการดราฟต์บทความ Flow 2 ที่รอการตรวจสอบ (Pending Review) พร้อมปุ่ม Publish, Edit, Reject'
        },
        {
          name: '6. `/idea [solution]`',
          value: '• ขอไอเดียโซลูชันใหม่จาก Flow 1 (สามารถเลือกต่อยอดจากโซลูชัน เช่น Smart Inventory & Warehouse หรือเว้นว่างเพื่อให้ AI สุ่มวิเคราะห์)'
        },
        {
          name: '7. `/health`',
          value: '• ตรวจสอบความเร็ว Latency และความพร้อมของระบบ (DB, n8n, AI, Bluesky, Dev.to)'
        },
        {
          name: '8. `/help`',
          value: '• แสดงคู่มือการใช้งานคำสั่งทั้งหมด'
        }
      )
      .setFooter({ text: 'SyaCo Enterprise Solution Hunter • v2.0 Clean Edition' });

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = {
  commands,
  registerCommands,
  handleCommand,
  createCandidateEmbed,
  createActionButtons,
  buildRadarEmbedsAndMenu,
  buildFlow2Card,
  normalizeDevtoCookie,
  saveAndVerifyDevtoCookie,
  saveAndVerifyDevtoKey,
  verifyGemini
};
