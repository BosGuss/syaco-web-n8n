const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} = require('discord.js');
const express = require('express');
const { Pool } = require('pg');

// Database Connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

// Bluesky Helper Functions
async function postToBluesky(postUrl, text) {
  const m = String(postUrl || '').match(/^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)$/);
  if (!m) throw new Error('Invalid Bluesky URL format');
  const [, actor, rkey] = m;

  // 1. Create Session
  const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: process.env.BLUESKY_HANDLE,
      password: process.env.BLUESKY_APP_PASSWORD,
    }),
  });
  const session = await sessionRes.json();
  if (!session.accessJwt) throw new Error(`Bluesky Login failed: ${JSON.stringify(session)}`);

  // 2. Resolve Profile DID
  const profileRes = await fetch(`https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  const profile = await profileRes.json();
  if (!profile.did) throw new Error('Could not resolve actor DID');

  // 3. Get Parent Post
  const parentRes = await fetch(`https://api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at://${profile.did}/app.bsky.feed.post/${rkey}`);
  const parentData = await parentRes.json();
  const parent = parentData.posts?.[0];
  if (!parent?.uri || !parent?.cid) throw new Error('Could not load parent post');

  // 4. Parse Links into Facets
  const byteLen = (str) => Buffer.byteLength(str, 'utf8');
  const facets = [];
  const linkRegex = /https?:\/\/[^\s]+/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    const byteStart = byteLen(text.slice(0, match.index));
    facets.push({
      index: { byteStart, byteEnd: byteStart + byteLen(url) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }

  // 5. Build Record & Create
  const root = parent.record?.reply?.root || { uri: parent.uri, cid: parent.cid };
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    reply: {
      root: { uri: root.uri, cid: root.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    },
    ...(facets.length ? { facets } : {}),
  };

  const createRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });
  const created = await createRes.json();
  if (!created.uri) throw new Error(`Bluesky post rejected: ${JSON.stringify(created)}`);

  const createdRkey = String(created.uri).split('/').pop();
  return `https://bsky.app/profile/${session.handle}/post/${createdRkey}`;
}

// Dev.to Helper Functions
async function postToDevTo(postUrl, text) {
  let cookie = (process.env.DEVTO_COOKIE || '').trim();
  if (!cookie) throw new Error('DEVTO_COOKIE is not set in environment');
  if (!cookie.includes('=')) {
    cookie = cookie.startsWith('eyJf')
      ? `remember_user_token=${cookie}`
      : `_Devto_Forem_Session=${cookie}`;
  }

  const cookies = new Map();
  function addCookies(str) {
    if (!str) return;
    for (const p of str.split(';')) {
      const idx = p.indexOf('=');
      if (idx > -1) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k && v) cookies.set(k, v);
      }
    }
  }
  function handleSetCookie(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of raw) {
      const p = c.split(';')[0];
      const idx = p.indexOf('=');
      if (idx > -1) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k && v) cookies.set(k, v);
      }
    }
  }
  function getCookieHeader() {
    return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  addCookies(cookie);

  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://dev.to',
    'Referer': postUrl,
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // 1. Visit article page first to activate Devise session and extract article ID
  const pageRes = await fetch(postUrl, {
    headers: { ...baseHeaders, 'Cookie': getCookieHeader(), 'Accept': 'text/html' }
  });
  handleSetCookie(pageRes);
  const html = await pageRes.text();

  const idMatch = html.match(/data-article-id="(\d+)"/) || html.match(/data-commentable-id="(\d+)"/);
  if (!idMatch) throw new Error('Could not extract Dev.to Article ID from URL: ' + postUrl);
  const articleId = parseInt(idMatch[1]);

  // 2. Fetch live authenticity_token and verify logged-in user from async_info/base_data
  const tokenRes = await fetch('https://dev.to/async_info/base_data', {
    headers: { ...baseHeaders, 'Cookie': getCookieHeader() },
  });
  handleSetCookie(tokenRes);
  const tokenData = await tokenRes.json();
  const csrfToken = tokenData?.token;
  if (!csrfToken) throw new Error('Could not fetch Dev.to CSRF token');

  const user = typeof tokenData?.user === 'string' ? JSON.parse(tokenData.user) : tokenData?.user;
  if (!user) throw new Error('Dev.to session expired or invalid (user is not logged in). Please update DEVTO_COOKIE.');

  // 3. Post comment using the full accumulated cookies matching the CSRF session
  const postRes = await fetch('https://dev.to/comments', {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'Cookie': getCookieHeader(),
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      authenticity_token: csrfToken,
      comment: {
        body_markdown: text,
        commentable_id: articleId,
        commentable_type: 'Article',
      },
    }),
  });

  if (!postRes.ok) {
    const errText = await postRes.text();
    throw new Error(`Dev.to comment rejected (HTTP ${postRes.status}): ${errText.slice(0, 300)}`);
  }

  // Dev.to responds with { status: "created", url: "/username/comment/id", id_code: "..." }
  const resData = await postRes.json().catch(() => ({}));
  if (resData?.url) {
    return `https://dev.to${resData.url}`;
  }
  const commentId = resData?.id_code || resData?.id;
  return commentId ? `${postUrl}#comment-${commentId}` : postUrl;
}

// Discord Client Setup
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const {
  registerCommands,
  handleCommand,
  saveAndVerifyDevtoCookie,
  saveAndVerifyGeminiKey,
  saveAndVerifyGeminiModel
} = require('./commands');

async function loadBotSettings() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await pool.query("SELECT key, value FROM bot_settings WHERE key IN ('DEVTO_COOKIE', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'DISCORD_CHANNEL_ID')");
    for (const r of rows) {
      if (r.value) {
        process.env[r.key] = r.value;
        console.log(`[Settings] Loaded ${r.key} from database`);
      }
    }
  } catch (err) {
    console.error('[Settings] Error loading bot settings:', err);
  }
}

client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  await loadBotSettings();
  await registerCommands(client);
});

// เมื่อบอทได้รับเชิญเข้า Server ใหม่ ให้ลงทะเบียน Slash Commands ทันที
client.on('guildCreate', async (guild) => {
  console.log(`[Bot] ได้รับเชิญเข้า Server ใหม่: "${guild.name}" (${guild.id})`);
  try {
    await registerCommands(client);
    console.log(`✅ [Bot] อัปเดตคำสั่งสำหรับ Server ใหม่ "${guild.name}" สำเร็จอัตโนมัติ!`);
  } catch (err) {
    console.error(`[Bot] ไม่สามารถลงทะเบียนคำสั่งสำหรับ Server ใหม่:`, err);
  }
});

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

// Handle Discord Gateway Interactions
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      return await handleCommand(interaction, { pool, client });
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('flow1_approve_')) {
        const id = interaction.customId.replace('flow1_approve_', '');
        await interaction.deferUpdate();
        try {
          const n8nUrl = process.env.N8N_FLOW1_WEBHOOK_URL || 'http://n8n:5678/webhook/flow1-approve-solution';
          const res = await fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suggestion_id: parseInt(id), action: 'approve' }),
            signal: AbortSignal.timeout(15000)
          });
          const data = await res.json().catch(() => ({}));
          if (data.success) {
            await interaction.editReply({
              content: `✅ **อนุมัติและสร้าง Draft บน syaco.co.th สำเร็จ!** (Solution ID: \`${data.solutionId || id}\`)\nทีมงานสามารถตรวจสอบและใส่ตัวอย่างเพิ่มเติมได้ในระบบหลังบ้าน`,
              components: []
            });
          } else {
            await interaction.editReply({
              content: `⚠️ ไม่สามารถสร้าง Draft ได้: ${data.message || data.error || 'Unknown error'}`,
              components: []
            });
          }
        } catch (err) {
          await interaction.editReply({
            content: `⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อไปยัง n8n: ${err.message}`,
            components: []
          });
        }
        return;
      }

      if (interaction.customId.startsWith('flow1_reject_')) {
        const id = interaction.customId.replace('flow1_reject_', '');
        await pool.query(
          "UPDATE solution_suggestions SET status = 'rejected', reviewed_at = NOW() WHERE id = $1",
          [parseInt(id)]
        );
        await interaction.update({
          content: `❌ **ปฏิเสธไอเดียโซลูชันนี้แล้ว** (ID: #${id})`,
          components: []
        });
        return;
      }

      if (interaction.customId.startsWith('flow2_publish_')) {
        const id = interaction.customId.replace('flow2_publish_', '');
        await interaction.deferUpdate();
        try {
          const n8nUrl = process.env.N8N_FLOW2_WEBHOOK_URL || 'http://n8n:5678/webhook/flow2-dispatch-action';
          const res = await fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draft_id: parseInt(id), action: 'publish' }),
            signal: AbortSignal.timeout(20000)
          });
          const data = await res.json().catch(() => ({}));
          if (data.success) {
            await interaction.editReply({
              content: `🚀 **เผยแพร่โพสต์สำเร็จ!** (${data.platform || 'Platform'})\n🔗 ${data.posted_url || 'ดูโพสต์ที่เผยแพร่แล้ว'}`,
              components: []
            });
          } else {
            await interaction.editReply({
              content: `⚠️ เผยแพร่ไม่สำเร็จ: ${data.error || data.message || 'Unknown error'}`,
              components: []
            });
          }
        } catch (err) {
          await interaction.editReply({
            content: `⚠️ เกิดข้อผิดพลาดในการเรียก n8n: ${err.message}`,
            components: []
          });
        }
        return;
      }

      if (interaction.customId.startsWith('flow2_reject_')) {
        const id = interaction.customId.replace('flow2_reject_', '');
        await pool.query(
          "UPDATE content_drafts SET status = 'rejected' WHERE id = $1",
          [parseInt(id)]
        );
        await interaction.update({
          content: `❌ **ปฏิเสธ Draft นี้แล้ว** (ID: #${id})`,
          components: []
        });
        return;
      }

      if (interaction.customId.startsWith('flow2_copy_')) {
        const id = interaction.customId.replace('flow2_copy_', '');
        const { rows } = await pool.query('SELECT title_th, content_markdown, tags FROM content_drafts WHERE id = $1', [parseInt(id)]);
        if (!rows.length) {
          return await interaction.reply({ content: 'ไม่พบข้อมูลบทความ', ephemeral: true });
        }
        const draft = rows[0];
        const tagsStr = (draft.tags || []).join(', ');
        await interaction.reply({
          content: `📋 **บทความสำหรับนำไปโพสต์มือ (Blognone / TechTalkThai / Medium)**\n\n📌 **ชื่อบทความ:** ${draft.title_th}\n🏷️ **แท็ก:** \`${tagsStr}\`\n\n\`\`\`markdown\n${draft.content_markdown.slice(0, 1800)}\n\`\`\``,
          ephemeral: true
        });
        return;
      }

      if (interaction.customId.startsWith('markposted_')) {
        const candidateId = interaction.customId.replace('markposted_', '');
        const { rows } = await pool.query(
          "UPDATE backlink_candidates SET status = 'posted', posted_at = NOW() WHERE id::text = $1 AND status = 'manual' RETURNING *",
          [candidateId]
        );
        if (!rows.length) {
          return await interaction.reply({ content: 'รายการนี้ไม่อยู่ในสถานะ Manual หรือได้รับการอัปเดตไปแล้ว', ephemeral: true });
        }
        return await interaction.update({
          content: `🎉 **บันทึกสถานะเรียบร้อย:** โพสต์คำตอบในกระทู้สำเร็จแล้ว (${rows[0].platform})\n🔗 [เปิดกระทู้](${rows[0].post_url})`,
          components: [],
        });
      }

      const [action, candidateId] = interaction.customId.split('_');

      if (action === 'reject') {
        await pool.query(
          "UPDATE backlink_candidates SET status = 'rejected', reviewed_at = NOW() WHERE id::text = $1",
          [candidateId]
        );
        await interaction.update({
          content: '❌ **Candidate Rejected**',
          components: [],
        });
        return;
      }

      if (action === 'edit') {
        const { rows } = await pool.query('SELECT answer FROM backlink_candidates WHERE id::text = $1', [candidateId]);
        if (!rows.length) return interaction.reply({ content: 'Candidate not found', ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId(`modal_${candidateId}`)
          .setTitle('Edit Draft Answer');

        const answerInput = new TextInputBuilder()
          .setCustomId('edited_answer')
          .setLabel('Answer Text')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(rows[0].answer || '')
          .setMaxLength(1500)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(answerInput));
        return await interaction.showModal(modal);
      }

      if (action === 'approve') {
        await handleApproval(interaction, candidateId);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_devto_cookie') {
        const rawCookie = interaction.fields.getTextInputValue('cookie_value');
        await interaction.deferReply({ ephemeral: true });
        return await saveAndVerifyDevtoCookie(interaction, rawCookie, pool);
      }

      if (interaction.customId === 'modal_gemini_key') {
        const rawKey = interaction.fields.getTextInputValue('key_value');
        await interaction.deferReply({ ephemeral: true });
        return await saveAndVerifyGeminiKey(interaction, rawKey, pool);
      }

      if (interaction.customId.startsWith('modal_answer_')) {
        const platform = interaction.customId.replace('modal_answer_', '');
        const postUrl = interaction.fields.getTextInputValue('post_url').trim();
        const questionText = interaction.fields.getTextInputValue('question_text').trim();

        await interaction.deferReply({ ephemeral: true });

        try {
          const n8nWebhookUrl = process.env.N8N_FLOW3_WEBHOOK_URL || 'http://n8n:5678/webhook/answer-question';
          const webhookRes = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              post_url: postUrl,
              question_text: questionText,
              platform: platform,
              requested_by: interaction.user.tag,
            }),
            signal: AbortSignal.timeout(10000),
          });

          const resData = await webhookRes.json().catch(() => ({}));
          if (resData.status === 'already_exists') {
            return await interaction.editReply(`⚠️ กระทู้นี้อยู่ในระบบแล้ว (ID: #${resData.id}, สถานะ: \`${resData.existing_status}\`)`);
          }
          if (resData.status === 'quota_exceeded') {
            return await interaction.editReply(`🚫 **โควตาสัปดาห์นี้เต็มแล้ว (${resData.count}/5)** เพื่อป้องกันการสแปมตามนโยบายชุมชน`);
          }

          return await interaction.editReply(`✅ **ส่งกระทู้เข้าสู่ระบบเรียบร้อย!** AI กำลังประเมิน Lead Fit และร่างคำตอบ การ์ดจะปรากฏในห้องแจ้งเตือนเมื่อพร้อมตรวจทานครับ`);
        } catch (err) {
          return await interaction.editReply(`⚠️ ไม่สามารถส่งคำขอไปยัง n8n ได้: ${err.message}`);
        }
      }

      const candidateId = interaction.customId.replace('modal_', '');
      const newAnswer = interaction.fields.getTextInputValue('edited_answer').trim();

      const { rows } = await pool.query(
        'UPDATE backlink_candidates SET answer = $1 WHERE id::text = $2 RETURNING *',
        [newAnswer, candidateId]
      );

      if (!rows.length) {
        return await interaction.reply({ content: 'Candidate not found', ephemeral: true });
      }

      const updatedEmbed = createCandidateEmbed(rows[0]);
      const actionRow = createActionButtons(rows[0].id);

      await interaction.update({
        content: '✏️ **Draft Answer Updated!** (Press **Approve** when ready to post)',
        embeds: [updatedEmbed],
        components: [actionRow],
      });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `⚠️ Error: ${err.message}`, ephemeral: true });
    }
  }
});

async function handleApproval(interaction, candidateId, overrideAnswer = null) {
  await interaction.deferUpdate();

  const { rows } = await pool.query(
    "SELECT * FROM backlink_candidates WHERE id::text = $1 AND status = 'pending_review'",
    [candidateId]
  );
  if (!rows.length) {
    return interaction.followUp({ content: 'Candidate was already handled or not found.', ephemeral: true });
  }

  const row = rows[0];
  const finalAnswer = overrideAnswer || row.answer;

  if (row.platform === 'bluesky') {
    try {
      const postedUrl = await postToBluesky(row.post_url, finalAnswer);
      await pool.query(
        "UPDATE backlink_candidates SET status = 'posted', answer = $1, posted_url = $2, posted_at = NOW(), reviewed_at = NOW() WHERE id::text = $3",
        [finalAnswer, postedUrl, candidateId]
      );

      await interaction.editReply({
        content: `✅ **Posted to Bluesky!**\n🔗 [Open Reply](${postedUrl})`,
        components: [],
      });
    } catch (postError) {
      await pool.query(
        "UPDATE backlink_candidates SET status = 'failed', error_message = $1 WHERE id::text = $2",
        [postError.message, candidateId]
      );
      await interaction.editReply({
        content: `⚠️ **Posting failed:** ${postError.message}\nYou can post manually below:`,
        components: [],
      });
      await interaction.followUp({
        content: `🔗 **Thread Link:** ${row.post_url}\nDraft Answer:\n\`\`\`\n${finalAnswer}\n\`\`\``,
        ephemeral: true,
      });
    }
  } else if (row.platform === 'devto') {
    try {
      const postedUrl = await postToDevTo(row.post_url, finalAnswer);
      await pool.query(
        "UPDATE backlink_candidates SET status = 'posted', answer = $1, posted_url = $2, posted_at = NOW(), reviewed_at = NOW() WHERE id::text = $3",
        [finalAnswer, postedUrl, candidateId]
      );

      await interaction.editReply({
        content: `✅ **Posted to Dev.to!**\n🔗 [Open Comment](${postedUrl})`,
        components: [],
      });
    } catch (postError) {
      await pool.query(
        "UPDATE backlink_candidates SET status = 'failed', error_message = $1 WHERE id::text = $2",
        [postError.message, candidateId]
      );
      await interaction.editReply({
        content: `⚠️ **Dev.to posting failed:** ${postError.message}\nYou can post manually below:`,
        components: [],
      });
      await interaction.followUp({
        content: `🔗 **Thread Link:** ${row.post_url}\nDraft Answer:\n\`\`\`\n${finalAnswer}\n\`\`\``,
        ephemeral: true,
      });
    }
  } else {
    // Reddit, Pantip, Blognone, Blockdit, Facebook -> Manual Workflow
    await pool.query(
      "UPDATE backlink_candidates SET status = 'manual', answer = $1, reviewed_at = NOW() WHERE id::text = $2",
      [finalAnswer, candidateId]
    );

    const markPostedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`markposted_${candidateId}`)
        .setLabel('✅ Mark as Posted (โพสต์แล้ว)')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.editReply({
      content: `📋 **Approved for Manual Posting** (${row.platform})\nThread: ${row.post_url}\n\n**นำข้อความด้านล่างไปตอบในกระทู้ด้วยตนเอง เมื่อเสร็จแล้วกดปุ่ม "Mark as Posted":**`,
      components: [markPostedRow],
    });
    await interaction.followUp({
      content: `🔗 **Thread Link:** ${row.post_url}\nDraft Answer:\n\`\`\`\n${finalAnswer}\n\`\`\``,
    });
  }
}

// Internal Express Server for n8n Flow 1, 2, 3 notifications
const app = express();
app.use(express.json());

app.post('/notify', async (req, res) => {
  try {
    const body = req.body;

    let channelId = process.env.DISCORD_CHANNEL_ID;
    if (!channelId) {
      try {
        const { rows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
        if (rows.length && rows[0].value) {
          channelId = rows[0].value;
          process.env.DISCORD_CHANNEL_ID = channelId;
        }
      } catch (_) {}
    }

    if (!channelId) {
      return res.status(500).json({ error: 'DISCORD_CHANNEL_ID is not configured. Please run /set-channel in Discord.' });
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      return res.status(500).json({ error: 'Discord Channel not found' });
    }

    // 1. Flow 1: New Proposed Adjacent Solution
    if (body.type === 'flow1_suggestion' && body.suggestion) {
      const s = body.suggestion;
      const cut = (str, len) => (String(str || '').length > len ? str.slice(0, len - 3) + '...' : str || '-');
      const embed = new EmbedBuilder()
        .setTitle(`💡 [AI Solution Proposal] ${cut(s.title_th, 100)}`)
        .setColor(0x57f287)
        .setDescription(`**Title (EN):** ${s.title_en}\n\n**คำอธิบาย:** ${cut(s.description_th, 500)}\n\n**Rationale:** ${cut(s.rationale, 500)}`)
        .addFields(
          { name: '🎯 Base Solution ID', value: String(s.base_solution_id || '-'), inline: true },
          { name: 'สถานะ', value: 'รอการอนุมัติเพื่อสร้างเป็น Draft บนเว็บ', inline: true }
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`flow1_approve_${s.id}`).setLabel('✅ อนุมัติสร้าง Draft บนเว็บ').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`flow1_reject_${s.id}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
      );

      await channel.send({ embeds: [embed], components: [row] });
      return res.json({ ok: true, type: 'flow1_suggestion', id: s.id });
    }

    // 2. Flow 2: Multi-Platform Drafts Notification
    if (body.type === 'flow2_drafts' && body.solution_id) {
      const { rows } = await pool.query(
        "SELECT id, platform, title_th, content_markdown, tags FROM content_drafts WHERE solution_id = $1 AND status = 'pending_review'",
        [body.solution_id]
      );
      if (!rows.length) {
        return res.json({ ok: true, message: 'No pending drafts found' });
      }

      for (const d of rows) {
        const cut = (str, len) => (String(str || '').length > len ? str.slice(0, len - 3) + '...' : str || '-');
        const embed = new EmbedBuilder()
          .setTitle(`📢 [${d.platform.toUpperCase()}] Draft สำหรับ: ${body.solution_title || 'Solution'}`)
          .setColor(d.platform === 'bluesky' ? 0x0085ff : (d.platform === 'devto' ? 0x0a0a0a : 0x2563eb))
          .setDescription(cut(d.content_markdown, 1500))
          .addFields(
            { name: 'Platform', value: d.platform, inline: true },
            { name: 'Tags', value: (d.tags || []).join(', ') || '-', inline: true }
          )
          .setTimestamp();

        let actionBtn;
        if (d.platform === 'bluesky') {
          actionBtn = new ButtonBuilder().setCustomId(`flow2_publish_${d.id}`).setLabel('🚀 โพสต์ Bluesky').setStyle(ButtonStyle.Primary);
        } else if (d.platform === 'devto') {
          actionBtn = new ButtonBuilder().setCustomId(`flow2_publish_${d.id}`).setLabel('🚀 โพสต์ Dev.to').setStyle(ButtonStyle.Primary);
        } else if (d.platform === 'hashnode') {
          actionBtn = new ButtonBuilder().setCustomId(`flow2_publish_${d.id}`).setLabel('🚀 โพสต์ Hashnode').setStyle(ButtonStyle.Primary);
        } else {
          actionBtn = new ButtonBuilder().setCustomId(`flow2_copy_${d.id}`).setLabel('📋 ดูเนื้อหาโพสต์มือ').setStyle(ButtonStyle.Secondary);
        }

        const row = new ActionRowBuilder().addComponents(
          actionBtn,
          new ButtonBuilder().setCustomId(`flow2_reject_${d.id}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [embed], components: [row] });
      }
      return res.json({ ok: true, type: 'flow2_drafts', count: rows.length });
    }

    // 3. Flow 2: Manual Ready Announcement
    if (body.type === 'manual_ready' && body.draft_id) {
      const { rows } = await pool.query('SELECT title_th, content_markdown, tags FROM content_drafts WHERE id = $1', [body.draft_id]);
      if (rows.length) {
        const d = rows[0];
        await channel.send({
          content: `📝 **BLOGNONE / TECHTALKTHAI ARTICLE READY**\n━━━━━━━━━━━━━━━━━━━━━━━\n📌 **ชื่อบทความ:** ${d.title_th}\n🏷️ **แท็ก:** ${(d.tags || []).join(', ')}\n\n\`\`\`markdown\n${d.content_markdown.slice(0, 1800)}\n\`\`\`\n━━━━━━━━━━━━━━━━━━━━━━━\n👉 สามารถคัดลอกไปเผยแพร่บน Blognone / TechTalkThai ได้ทันที`
        });
      }
      return res.json({ ok: true, type: 'manual_ready' });
    }

    // 4. Default: Candidate for Flow 3
    const candidate = body;
    if (!candidate || !candidate.id) {
      return res.json({ ok: true, skipped: true, reason: 'No candidate ID (likely duplicate post_url)' });
    }

    const embed = createCandidateEmbed(candidate);
    const row = createActionButtons(candidate.id);

    await channel.send({ embeds: [embed], components: [row] });
    return res.json({ ok: true, id: candidate.id });
  } catch (err) {
    console.error('Notify endpoint error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Internal notify API listening on port ${PORT}`));

client.login(process.env.DISCORD_BOT_TOKEN);