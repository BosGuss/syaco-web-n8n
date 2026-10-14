const { SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');

// 1. กำหนดคำสั่งทั้งหมด (Command Definitions)
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('ทดสอบสถานะการเชื่อมต่อและความเร็วของบอท'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('ดูภาพรวมจำนวนรายการ Backlink Candidates ในฐานข้อมูล'),

  new SlashCommandBuilder()
    .setName('pending')
    .setDescription('ดูรายการที่กำลังรอตรวจสอบ (Pending Review) 5 รายการล่าสุด'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('แสดงรายการคำสั่งทั้งหมดและวิธีใช้งาน')
];

// 2. ฟังก์ชันลงทะเบียนคำสั่งกับ Discord API (Register Commands)
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

// 3. ฟังก์ชันประมวลผลคำสั่งเมื่อผู้ใช้พิมพ์ในแชท (Handle Commands)
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

  // คำสั่ง /pending
  if (commandName === 'pending') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const { rows } = await pool.query(`
        SELECT id, platform, post_title, post_url, match_score, created_at
        FROM backlink_candidates
        WHERE status = 'pending_review'
        ORDER BY created_at DESC
        LIMIT 5
      `);

      if (!rows.length) {
        return await interaction.editReply('🎉 ไม่มีรายการค้างที่รอรีวิวในขณะนี้!');
      }

      const embed = new EmbedBuilder()
        .setTitle('⏳ รายการที่รอรีวิว (5 รายการล่าสุด)')
        .setColor(0xfee75c)
        .setDescription(
          rows.map((r, i) => {
            const title = r.post_title ? (r.post_title.length > 50 ? r.post_title.slice(0, 47) + '...' : r.post_title) : 'No Title';
            return `**${i + 1}. [${r.platform}]** [${title}](${r.post_url})\n└ ID: \`${r.id}\` | Score: \`${r.match_score || '-'}\``;
          }).join('\n\n')
        )
        .setFooter({ text: 'กดปุ่ม Approve/Reject ได้จากการแจ้งเตือนในห้องแชท' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Error fetching pending items:', err);
      return await interaction.editReply(`⚠️ เกิดข้อผิดพลาด: ${err.message}`);
    }
  }

  // คำสั่ง /help
  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 คู่มือคำสั่ง Discord Bot')
      .setColor(0x57f287)
      .setDescription('คำสั่งที่สามารถใช้งานได้ในเซิร์ฟเวอร์:')
      .addFields(
        { name: '`/ping`', value: 'ทดสอบความเร็วและการเชื่อมต่อของบอท' },
        { name: '`/status`', value: 'ดูสรุปสถานะรายการทั้งหมดใน Database' },
        { name: '`/pending`', value: 'ดูรายการที่รอตรวจสอบ 5 รายการล่าสุด' },
        { name: '`/help`', value: 'แสดงคำอธิบายคำสั่งนี้' }
      )
      .setFooter({ text: 'Syaco Discord Bot' });

    return await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = {
  commands,
  registerCommands,
  handleCommand
};
