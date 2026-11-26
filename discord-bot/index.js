const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const express = require('express');
const { Pool } = require('pg');
const { approveAndCreateDraft } = require('./solution-draft');
const { sanitizeDevtoTags, publishDraft, rejectDraft } = require('./flow2-publisher');

// Database Connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

// Grapheme Helpers (for AT Protocol 300 grapheme limit)
function truncateToGraphemes(text, max = 300) {
  if (!text) return '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(text)).map(s => s.segment);
    if (segments.length <= max) return text;
    return segments.slice(0, max - 3).join('') + '...';
  }
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max - 3).join('') + '...';
}

// Bluesky Helper Functions
async function postToBluesky(postUrl, text) {
  const m = String(postUrl || '').match(/^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)$/);
  if (!m) throw new Error('Invalid Bluesky URL format');
  const [, actor, rkey] = m;

  // 1. Truncate text to max 300 graphemes (AT Protocol limit)
  const trimmedText = truncateToGraphemes(String(text || '').trim(), 300);

  // 2. Create Session
  const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: process.env.BLUESKY_HANDLE,
      password: process.env.BLUESKY_APP_PASSWORD,
    }),
  });
  if (!sessionRes.ok) {
    const errBody = await sessionRes.text().catch(() => '');
    throw new Error(`Bluesky Login failed (HTTP ${sessionRes.status}): ${errBody.slice(0, 300)}`);
  }
  const session = await sessionRes.json();
  if (!session.accessJwt) throw new Error('Bluesky Login failed: No access token');

  // 3. Resolve Profile DID
  const profileRes = await fetch(`https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
  if (!profileRes.ok) {
    const errBody = await profileRes.text().catch(() => '');
    throw new Error(`Bluesky resolve profile failed (HTTP ${profileRes.status}): ${errBody.slice(0, 300)}`);
  }
  const profile = await profileRes.json();
  if (!profile.did) throw new Error('Could not resolve actor DID');

  // 4. Get Parent Post
  const parentRes = await fetch(`https://api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at://${profile.did}/app.bsky.feed.post/${rkey}`);
  if (!parentRes.ok) {
    const errBody = await parentRes.text().catch(() => '');
    throw new Error(`Bluesky load parent post failed (HTTP ${parentRes.status}): ${errBody.slice(0, 300)}`);
  }
  const parentData = await parentRes.json();
  const parent = parentData.posts?.[0];
  if (!parent?.uri || !parent?.cid) throw new Error('Could not load parent post');

  // 5. Parse Links into Facets using byte offsets of trimmedText
  const byteLen = (str) => Buffer.byteLength(str, 'utf8');
  const facets = [];
  const linkRegex = /https?:\/\/[^\s]+/g;
  let match;
  while ((match = linkRegex.exec(trimmedText)) !== null) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    const byteStart = byteLen(trimmedText.slice(0, match.index));
    facets.push({
      index: { byteStart, byteEnd: byteStart + byteLen(url) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
    });
  }

  // 6. Build Record & Create
  const root = parent.record?.reply?.root || { uri: parent.uri, cid: parent.cid };
  const record = {
    $type: 'app.bsky.feed.post',
    text: trimmedText,
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
  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => '');
    throw new Error(`Bluesky createRecord rejected (HTTP ${createRes.status}): ${errBody.slice(0, 300)}`);
  }
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
  createCandidateEmbed,
  createActionButtons,
  buildRadarEmbedsAndMenu,
  buildFlow2Card,
  handleFlow2DraftsNotify,
  getFlow2CandidateSolutions,
  saveAndVerifyDevtoCookie,
  saveAndVerifyDevtoKey
} = require('./commands');

// Admin Allowlist Helpers
function getAdminIds() {
  const raw = process.env.DISCORD_ADMIN_IDS || '';
  return raw
    .split(/[,;\s]+/)
    .map(id => id.trim())
    .filter(Boolean);
}

function isAuthorizedAdmin(user) {
  const adminIds = getAdminIds();
  if (adminIds.length > 0) {
    return adminIds.includes(String(user?.id || ''));
  }
  return true;
}

function formatReviewedBy(user) {
  if (!user) return 'system';
  const name = user.tag || user.username || 'unknown';
  return `${name} (${user.id})`;
}

function buildFlow1Card(s, baseSolutionText, reviewedBy = null) {
  const cut = (str, len) => (String(str || '').length > len ? str.slice(0, len - 3) + '...' : str || '-');
  const embed = new EmbedBuilder()
    .setTitle(`💡 [AI Solution Proposal] ${cut(s.title_th, 100)}`)
    .setColor(0x57f287)
    .setDescription(`**Title (EN):** ${s.title_en}\n\n**คำอธิบาย:** ${cut(s.description_th, 500)}\n\n**Rationale:** ${cut(s.rationale, 500)}`)
    .addFields(
      { name: '🎯 Base Solution', value: baseSolutionText || '-', inline: true },
      { name: 'สถานะ', value: reviewedBy ? 'รอการอนุมัติเพื่อสร้างเป็น Draft บนเว็บ (แก้ไขแล้ว)' : 'รอการอนุมัติเพื่อสร้างเป็น Draft บนเว็บ', inline: true }
    )
    .setTimestamp();

  if (reviewedBy) {
    embed.setFooter({ text: `แก้ไขล่าสุดโดย: ${reviewedBy}` });
  }

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`flow1_approve_${s.id}`).setLabel('✅ อนุมัติสร้าง Draft บนเว็บ').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`flow1_edit_${s.id}`).setLabel('✏️ แก้ไข').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`flow1_retry_${s.id}`).setLabel('🔄 ลองใหม่').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`flow1_reject_${s.id}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
  );

  return { embed, actionRow };
}

// Note: buildFlow2Card is imported from ./commands for sharing across bot modules

async function loadBotSettings() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await pool.query("SELECT key, value FROM bot_settings WHERE key IN ('DEVTO_API_KEY', 'DEVTO_COOKIE', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'DISCORD_CHANNEL_ID', 'DISCORD_ADMIN_IDS')");
    for (const r of rows) {
      if (r.value) {
        process.env[r.key] = r.value;
        console.log(`[Settings] Loaded ${r.key} from database`);
      }
    }
    const { rows: lastDates } = await pool.query("SELECT key, value FROM bot_settings WHERE key IN ('LAST_RADAR_RUN_DATE', 'LAST_FLOW1_RUN_DATE', 'LAST_FLOW2_RUN_DATE')");
    for (const d of lastDates) {
      if (d.key === 'LAST_RADAR_RUN_DATE') lastRadarRunDate = d.value;
      if (d.key === 'LAST_FLOW1_RUN_DATE') lastFlow1RunDate = d.value;
      if (d.key === 'LAST_FLOW2_RUN_DATE') lastFlow2RunDate = d.value;
    }
  } catch (err) {
    console.error('[Settings] Error loading bot settings:', err);
  }
}

let lastRadarRunDate = '';

async function runDailyRadarTask() {
  try {
    const { rows: enabledRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_ENABLED'");
    if (enabledRows.length && enabledRows[0].value === 'false') {
      console.log('[DailyRadar] Automation is disabled in settings.');
      return;
    }

    const { rows: limitRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_LIMIT'");
    const targetLimit = parseInt(limitRows[0]?.value || '20', 10);

    let channelId = null;
    const { rows: channelRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
    if (channelRows.length && channelRows[0].value && channelRows[0].value !== '123456789012345678') {
      channelId = channelRows[0].value;
    } else {
      channelId = process.env.DISCORD_CHANNEL_ID;
    }

    if (!channelId || channelId === '123456789012345678') {
      console.warn('[DailyRadar] No DISCORD_CHANNEL_ID configured, skipping daily radar broadcast.');
      return;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn(`[DailyRadar] Channel ${channelId} not accessible.`);
      return;
    }

    console.log(`[DailyRadar] Starting automated daily thread gathering (target: ${targetLimit})...`);
    const { collectDailyRadarThreads } = require('./thread-search');

    // ดึงรายการ URL ที่เคยค้นพบไปแล้วเพื่อป้องกันเรดาร์ซ้ำ (ย้อนหลัง 7 วัน)
    const { rows: cachedRows } = await pool.query(`
      SELECT DISTINCT post_url FROM thread_search_cache WHERE created_at > NOW() - INTERVAL '7 days'
      UNION
      SELECT DISTINCT post_url FROM backlink_candidates
    `);
    const excludeUrls = new Set(cachedRows.map(r => r.post_url).filter(Boolean));

    const radarData = await collectDailyRadarThreads(targetLimit, excludeUrls);
    const { solutionsCovered, results } = radarData;

    if (!results.length) {
      console.log('[DailyRadar] No new threads found today.');
      return;
    }

    // บันทึกลง thread_search_cache
    const savedRows = [];
    for (const item of results) {
      const { rows } = await pool.query(
        `INSERT INTO thread_search_cache (platform, post_url, post_title, snippet, search_keyword)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [item.platform, item.url, item.title, item.snippet || '', item.solutionCategory || 'daily_radar']
      );
      savedRows.push({
        ...rows[0],
        solutionCategory: item.solutionCategory
      });
    }

    const { embeds, components } = buildRadarEmbedsAndMenu(savedRows, solutionsCovered);

    if (embeds.length <= 2) {
      await channel.send({
        content: `🌅 **สวัสดีตอนเช้าครับทีมงาน! เรดาร์กระทู้/โพสต์น่าสนใจประจำวันพร้อมแล้ว (${savedRows.length} รายการ)**\nแตะปุ่มด่วน **[⚡ ร่างข้อ 1-5]** หรือเลือกจากดรอปดาวน์ด้านล่างเพื่อให้ AI ร่างคำตอบได้ทันทีครับ:`,
        embeds,
        components
      });
    } else {
      const half = Math.ceil(embeds.length / 2);
      await channel.send({
        content: `🌅 **สวัสดีตอนเช้าครับทีมงาน! เรดาร์กระทู้/โพสต์น่าสนใจประจำวันพร้อมแล้ว (${savedRows.length} รายการ)**\n(ส่วนที่ 1/2)`,
        embeds: embeds.slice(0, half)
      });
      await channel.send({
        content: `(ส่วนที่ 2/2) 👇 **เลือกกระทู้ที่ต้องการให้ AI ช่วยร่างคำตอบจากเมนูด้านล่างได้ทันทีครับ:**`,
        embeds: embeds.slice(half),
        components
      });
    }
    console.log(`[DailyRadar] Successfully broadcasted ${savedRows.length} threads to #${channel.name}`);
  } catch (err) {
    console.error('[DailyRadar] Scheduled run failed:', err);
  }
}

let lastFlow1RunDate = '';
let lastFlow2RunDate = '';

async function runDailyFlow1Task() {
  try {
    const { rows: enabledRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'FLOW1_DAILY_ENABLED'");
    if (enabledRows.length && enabledRows[0].value === 'false') {
      console.log('[DailyFlow1] Automation is disabled in settings.');
      return { ok: false, reason: 'disabled' };
    }

    const webhookUrl = process.env.N8N_FLOW1_IDEA_WEBHOOK_URL || 'http://n8n:5678/webhook/flow1-request-idea';
    console.log(`[DailyFlow1] Triggering Flow 1 Solution Discovery at ${webhookUrl}...`);

    let channelId = null;
    const { rows: channelRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
    if (channelRows.length && channelRows[0].value && channelRows[0].value !== '123456789012345678') {
      channelId = channelRows[0].value;
    } else {
      channelId = process.env.DISCORD_CHANNEL_ID;
    }

    if (channelId && channelId !== '123456789012345678') {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const { rows: tRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'FLOW1_DAILY_TIME'");
        const flow1TimeStr = tRows[0]?.value || '10:30';
        await channel.send({
          content: `🌅 **[Daily Trigger] เริ่มต้นค้นหาโอกาสและไอเดียโซลูชันประจำวัน (Flow 1: Solution Discovery) อัตโนมัติ (${flow1TimeStr} น.)**\nระบบกำลังดึงข้อมูลฟีด TechTalkThai & Blognone เพื่อวิเคราะห์ Adjacent Solutions ผ่าน Gemini AI...`
        }).catch(() => {});
      }
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggered_by: 'Daily Schedule (Discord Bot Scheduler)',
        source: 'daily_cron',
        requested_at: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(15000)
    });

    console.log(`[DailyFlow1] Webhook dispatched. Response status: ${res.status}`);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('[DailyFlow1] Scheduled run failed:', err);
    return { ok: false, error: err.message };
  }
}

async function runDailyFlow2Task() {
  try {
    const { rows: enabledRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'FLOW2_DAILY_ENABLED'");
    if (enabledRows.length && enabledRows[0].value === 'false') {
      console.log('[DailyFlow2] Automation is disabled in settings.');
      return { ok: false, reason: 'disabled' };
    }

    // 1. ตรวจสอบว่ามีโซลูชันใหม่ที่ต้องสร้างคอนเทนต์ หรือมีฉบับร่างค้างตรวจทานหรือไม่
    const candidates = await getFlow2CandidateSolutions(pool);
    if (!candidates || candidates.length === 0) {
      console.log('[DailyFlow2] ไม่พบโซลูชันใหม่หรือฉบับร่างที่รอตรวจทาน (0 candidates) ข้ามการส่งข้อความแจ้งเตือนและการรันประจำวัน');
      return { ok: true, skipped: true, reason: 'no_candidate_solutions' };
    }

    console.log(`[DailyFlow2] พบโซลูชันที่ต้องดำเนินการ ${candidates.length} รายการ เริ่มต้นส่งข้อความแจ้งเตือนและทริกเกอร์ n8n...`);

    const webhookUrl = process.env.N8N_FLOW2_WEBHOOK_URL || 'http://n8n:5678/webhook/flow2-run-publisher';
    console.log(`[DailyFlow2] Triggering Flow 2 Content Publisher at ${webhookUrl}...`);

    let channelId = null;
    const { rows: channelRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
    if (channelRows.length && channelRows[0].value && channelRows[0].value !== '123456789012345678') {
      channelId = channelRows[0].value;
    } else {
      channelId = process.env.DISCORD_CHANNEL_ID;
    }

    if (channelId && channelId !== '123456789012345678') {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const { rows: tRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'FLOW2_DAILY_TIME'");
        const flow2TimeStr = tRows[0]?.value || '11:30';
        await channel.send({
          content: `✍️ **[Daily Trigger] เริ่มต้นสร้างและตรวจทานคอนเทนต์ประจำวัน (Flow 2: Content Publisher) อัตโนมัติ (${flow2TimeStr} น.)**\nระบบกำลังตรวจสอบโซลูชันที่เสร็จสมบูรณ์ และร่างเนื้อหาบทความ/โซเชียลพร้อมปุ่มอนุมัติเผยแพร่...`
        }).catch(() => {});
      }
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggered_by: 'Daily Schedule (Discord Bot Scheduler)',
        source: 'daily_cron',
        requested_at: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(15000)
    });

    console.log(`[DailyFlow2] Webhook dispatched. Response status: ${res.status}`);
    return { ok: res.ok, status: res.status, candidateCount: candidates.length };
  } catch (err) {
    console.error('[DailyFlow2] Scheduled run failed:', err);
    return { ok: false, error: err.message };
  }
}

function startRadarCronScheduler() {
  console.log('⏰ [DailyScheduler] ระบบตรวจเวลา Daily Trigger อัตโนมัติเริ่มทำงานแล้ว (เช็คทุก 45 วินาที: Flow 1 [10:30], Flow 2 [11:30], Flow 3 [11:00])');
  setInterval(async () => {
    try {
      const now = new Date();
      const bkkFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour12: false
      });
      const parts = bkkFormatter.formatToParts(now);
      const getVal = type => parts.find(p => p.type === type)?.value;
      const todayStr = `${getVal('year')}-${getVal('month')}-${getVal('day')}`;
      const currentTime = `${getVal('hour')}:${getVal('minute')}`;

      // 1. Flow 3: Daily Radar (default: 11:00)
      const { rows: radarRows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DAILY_RADAR_TIME'");
      const radarTargetTime = radarRows[0]?.value || '11:00';
      if (currentTime === radarTargetTime && lastRadarRunDate !== todayStr) {
        lastRadarRunDate = todayStr;
        await pool.query("INSERT INTO bot_settings (key, value, updated_at) VALUES ('LAST_RADAR_RUN_DATE', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [todayStr]).catch(() => {});
        console.log(`⏰ [DailyRadar] ถึงเวลาเป้าหมาย ${currentTime} น. (วันที่ ${todayStr}) เริ่มต้นดึงเรดาร์กระทู้ประจำวัน...`);
        await runDailyRadarTask();
      }

      // 2. Flow 1: Solution Discovery (default: 10:30)
      const { rows: flow1Rows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'FLOW1_DAILY_TIME'");
      const flow1TargetTime = flow1Rows[0]?.value || '10:30';
      if (currentTime === flow1TargetTime && lastFlow1RunDate !== todayStr) {
        lastFlow1RunDate = todayStr;
        await pool.query("INSERT INTO bot_settings (key, value, updated_at) VALUES ('LAST_FLOW1_RUN_DATE', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [todayStr]).catch(() => {});
        console.log(`⏰ [DailyFlow1] ถึงเวลาเป้าหมาย ${currentTime} น. (วันที่ ${todayStr}) เริ่มต้นรัน Flow 1 Solution Discovery...`);
        await runDailyFlow1Task();
      }

      // 3. Flow 2: Content Publisher (default: 11:30)
      const { rows: flow2Rows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'FLOW2_DAILY_TIME'");
      const flow2TargetTime = flow2Rows[0]?.value || '11:30';
      if (currentTime === flow2TargetTime && lastFlow2RunDate !== todayStr) {
        lastFlow2RunDate = todayStr;
        await pool.query("INSERT INTO bot_settings (key, value, updated_at) VALUES ('LAST_FLOW2_RUN_DATE', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()", [todayStr]).catch(() => {});
        console.log(`⏰ [DailyFlow2] ถึงเวลาเป้าหมาย ${currentTime} น. (วันที่ ${todayStr}) เริ่มต้นรัน Flow 2 Content Publisher...`);
        await runDailyFlow2Task();
      }
    } catch (err) {
      console.error('[DailyScheduler] Cron check error:', err);
    }
  }, 45000);
}

client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  await loadBotSettings();
  await registerCommands(client);
  startRadarCronScheduler();
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

// Handle Discord Gateway Interactions
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const { commandName } = interaction;
      if (commandName === 'find' || commandName === 'find-threads') {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'keyword') {
          const val = (focused.value || '').toLowerCase().trim();
          const choices = [
            { name: '🤖 [ทำออโต้] AI สุ่มวิเคราะห์จาก SyaCo Solutions ทั้งหมด', value: 'auto' },
            { name: '🤖 [ออโต้] Smart Inventory & Warehouse (สต็อก / คลังสินค้า)', value: 'auto:warehouse' },
            { name: '🤖 [ออโต้] Data Integration & APIs (ERP / PLC / API)', value: 'auto:data' },
            { name: '🤖 [ออโต้] Real-time Tracking & Logistics (GPS / ขนส่ง)', value: 'auto:logistics' },
            { name: '🤖 [ออโต้] Analytics & Dashboard (BI / รายงานผู้บริหาร)', value: 'auto:analytics' },
            { name: '🤖 [ออโต้] AI & Automation (AI / ตรวจจับ Defect / อัตโนมัติ)', value: 'auto:automation' },
            { name: '🤖 [ออโต้] Alerts & Notification System (แจ้งเตือน / อนุมัติงาน)', value: 'auto:alerts' },
            { name: '🤖 [ออโต้] Enterprise Web & Mobile Apps (แอปทำงาน Offline)', value: 'auto:apps' }
          ];
          const filtered = val
            ? choices.filter(c => c.name.toLowerCase().includes(val) || c.value.toLowerCase().includes(val))
            : choices;
          return await interaction.respond(filtered.slice(0, 10));
        }
      }

      if (commandName === 'idea' || commandName === 'request-idea') {
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'solution') {
          const val = (focused.value || '').toLowerCase().trim();
          try {
            const { rows } = await pool.query(
              'SELECT solution_id, solution_title FROM processed_solutions ORDER BY solution_id'
            );
            const filtered = val
              ? rows.filter(r => (r.solution_title && r.solution_title.toLowerCase().includes(val)) || String(r.solution_id).includes(val))
              : rows;
            const choices = filtered.slice(0, 25).map(r => ({
              name: r.solution_title,
              value: r.solution_title
            }));
            return await interaction.respond(choices);
          } catch (dbErr) {
            console.error('Error in idea autocomplete:', dbErr);
            return await interaction.respond([]);
          }
        }
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      return await handleCommand(interaction, { pool, client });
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_radar_draft') {
        const selectedIds = interaction.values;
        await interaction.deferReply({ ephemeral: true });

        try {
          const n8nWebhookUrl = process.env.N8N_FLOW3_WEBHOOK_URL || 'http://n8n:5678/webhook/answer-question';
          const dispatched = [];
          const already = [];

          for (const val of selectedIds) {
            const cacheId = parseInt(val, 10);
            const { rows } = await pool.query('SELECT * FROM thread_search_cache WHERE id = $1', [cacheId]);
            if (rows.length) {
              const thread = rows[0];
              const questionText = `${thread.post_title}\n\n${thread.snippet || ''}`.trim();

              const webhookRes = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  post_url: thread.post_url,
                  question_text: questionText,
                  platform: thread.platform,
                  requested_by: interaction.user.tag,
                }),
                signal: AbortSignal.timeout(10000),
              });

              const resData = await webhookRes.json().catch(() => ({}));
              if (resData.status === 'already_exists') {
                already.push(`[${thread.platform.toUpperCase()}] ${thread.post_title.slice(0, 50)}...`);
              } else {
                dispatched.push(`[${thread.platform.toUpperCase()}] ${thread.post_title.slice(0, 50)}...`);
              }
            }
          }

          let replyMsg = '';
          if (dispatched.length > 0) {
            replyMsg += `✅ **ส่งกระทู้ให้ AI เรียบร้อยแล้ว (${dispatched.length} รายการ)!**\n` +
              dispatched.map((t, i) => `${i + 1}. *${t}*`).join('\n') +
              '\n\n🤖 AI กำลังประเมิน Lead Fit และร่างคำตอบ การ์ดรีวิวจะถูกส่งเข้ามาในห้องแจ้งเตือนทันทีเมื่อพร้อมครับ\n';
          }
          if (already.length > 0) {
            replyMsg += `\n⚠️ กระทู้เหล่านี้มีอยู่ในระบบแล้ว:\n` + already.map(t => `• *${t}*`).join('\n');
          }

          return await interaction.editReply(replyMsg || 'ดำเนินการเรียบร้อยครับ');
        } catch (err) {
          console.error('[select_radar_draft] Error:', err);
          return await interaction.editReply(`⚠️ ไม่สามารถส่งกระทู้เข้า Flow 3 ได้: ${err.message}`);
        }
      }
    }

    if (interaction.isButton()) {
      // อนุญาตให้ทุกคนใน Server มีสิทธิ์กดปุ่มได้ โดยระบบจะบันทึกข้อมูลผู้ดำเนินการลงฐานข้อมูลเสมอ

      if (interaction.customId.startsWith('lead_draft_')) {
        const cacheId = parseInt(interaction.customId.replace('lead_draft_', ''), 10);
        await interaction.deferReply({ ephemeral: true });

        try {
          const { rows } = await pool.query(
            'SELECT * FROM thread_search_cache WHERE id = $1',
            [cacheId]
          );

          if (!rows.length) {
            return await interaction.editReply('❌ ไม่พบข้อมูลกระทู้นี้ในระบบ หรืออาจหมดอายุแล้ว กรุณาลองค้นหาใหม่อีกครั้ง');
          }

          const thread = rows[0];
          const n8nWebhookUrl = process.env.N8N_FLOW3_WEBHOOK_URL || 'http://n8n:5678/webhook/answer-question';
          const questionText = `${thread.post_title}\n\n${thread.snippet || ''}`.trim();

          const webhookRes = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              post_url: thread.post_url,
              question_text: questionText,
              platform: thread.platform,
              requested_by: interaction.user.tag,
            }),
            signal: AbortSignal.timeout(10000),
          });

          const resData = await webhookRes.json().catch(() => ({}));
          if (resData.status === 'already_exists') {
            return await interaction.editReply(`⚠️ กระทู้นี้อยู่ในระบบแล้ว (Candidate ID: #${resData.id}, สถานะ: \`${resData.existing_status}\`)`);
          }
          if (resData.status === 'quota_exceeded') {
            try {
              let alertChannelId = null;
              const { rows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
              if (rows.length && rows[0].value && rows[0].value !== '123456789012345678') {
                alertChannelId = rows[0].value;
              }
              if (!alertChannelId) alertChannelId = process.env.DISCORD_CHANNEL_ID;
              if (alertChannelId) {
                const alertChannel = await client.channels.fetch(alertChannelId).catch(() => null);
                if (alertChannel) {
                  const quotaAlertEmbed = new EmbedBuilder()
                    .setTitle('🚫 [Flow 3] แจ้งเตือน: โควตาตอบกระทู้เต็มแล้ว')
                    .setColor(0xef4444)
                    .setDescription(`ผู้ใช้ **${interaction.user.tag}** (<@${interaction.user.id}>) พยายามส่งกระทู้เข้าระบบ แต่โควตาสัปดาห์นี้เต็มแล้ว`)
                    .addFields(
                      { name: 'แพลตฟอร์ม', value: platform, inline: true },
                      { name: 'จำนวนใน 7 วัน', value: `${resData.count} รายการ`, inline: true },
                      { name: 'ลิงก์กระทู้', value: postUrl, inline: false }
                    )
                    .setFooter({ text: 'ระบบหยุดการประมวลผลเพื่อความปลอดภัยตามนโยบาย Anti-Spam' })
                    .setTimestamp();
                  await alertChannel.send({ embeds: [quotaAlertEmbed] }).catch(() => {});
                }
              }
            } catch (err) {
              console.error('Error sending quota alert to channel:', err);
            }

            const limitText = resData.limit && resData.limit < 999999 ? `/${resData.limit}` : '';
            return await interaction.editReply(`🚫 **โควตาสัปดาห์นี้เต็มแล้ว (${resData.count}${limitText} รายการ)** ระบบได้ส่งการแจ้งเตือนไปยังห้องหลักเรียบร้อยครับ`);
          }

          const notifyChannelId = process.env.DISCORD_CHANNEL_ID;
          const channelMention = notifyChannelId ? `<#${notifyChannelId}>` : 'ห้องแจ้งเตือน';

          return await interaction.editReply(
            `✅ **ส่งกระทู้เข้าสู่ระบบ Flow 3 สำเร็จ!**\n` +
            `📌 **หัวข้อ:** ${thread.post_title}\n` +
            `🌐 **แพลตฟอร์ม:** \`${thread.platform.toUpperCase()}\`\n` +
            `🔗 **URL:** ${thread.post_url}\n\n` +
            `🤖 AI กำลังวิเคราะห์ปัญหา ประเมิน Lead Fit และร่างคำตอบ การ์ดตรวจทานจะถูกส่งไปที่ ${channelMention} เมื่อพร้อมครับ!`
          );
        } catch (err) {
          console.error('[lead_draft] Error:', err);
          return await interaction.editReply(`⚠️ ไม่สามารถส่งคำขอไปยัง n8n ได้: ${err.message}`);
        }
      }

      if (interaction.customId === 'btn_settings_devto_key') {
        const modal = new ModalBuilder()
          .setCustomId('modal_devto_key')
          .setTitle('ตั้งค่า DEVTO_API_KEY');

        const keyInput = new TextInputBuilder()
          .setCustomId('key_value')
          .setLabel('Dev.to API Key')
          .setPlaceholder('วาง Dev.to API Key เช่น GPzyFieTByvp2TJeNmoyKD4W')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
        return await interaction.showModal(modal);
      }

      if (interaction.customId === 'btn_settings_devto_cookie') {
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

      if (interaction.customId.startsWith('flow1_approve_')) {
        const id = interaction.customId.replace('flow1_approve_', '');
        await interaction.deferUpdate();
        try {
          const reviewedBy = formatReviewedBy(interaction.user);
          const result = await approveAndCreateDraft({ id, pool, reviewedBy });
          if (result.success) {
            await interaction.editReply({
              content: `✅ **อนุมัติและสร้าง Draft บน syaco.co.th สำเร็จ!** (Solution ID: \`${result.solutionId}\`)\n👤 **อนุมัติโดย:** \`${reviewedBy}\`\n🔗 https://www.syaco.co.th/admin/solutions\nทีมงานสามารถตรวจสอบและใส่ตัวอย่างเพิ่มเติมได้ในระบบหลังบ้าน`,
              components: []
            });
          } else {
            const { rows: curRows } = await pool.query('SELECT * FROM solution_suggestions WHERE id = $1', [parseInt(id, 10)]);
            if (curRows.length) {
              const currentItem = curRows[0];
              let baseSolutionText = String(currentItem.base_solution_id || '-');
              if (currentItem.base_solution_id) {
                try {
                  const { rows: solRows } = await pool.query(
                    'SELECT solution_title FROM processed_solutions WHERE solution_id = $1 LIMIT 1',
                    [String(currentItem.base_solution_id)]
                  );
                  if (solRows.length && solRows[0].solution_title) {
                    baseSolutionText = `${solRows[0].solution_title} (ID: ${currentItem.base_solution_id})`;
                  }
                } catch (_) {}
              }
              const { embed, actionRow } = buildFlow1Card(currentItem, baseSolutionText, reviewedBy);
              embed.setColor(0xed4245);
              embed.addFields({
                name: '⚠️ สาเหตุที่ไม่สามารถสร้าง Draft ได้',
                value: String(result.message || result.error || 'Unknown error').slice(0, 1024),
                inline: false
              });
              await interaction.editReply({
                content: `⚠️ **สร้าง Draft บน SyaCo ไม่สำเร็จ:** ${result.message || result.error || 'Server error'}\n*(สามารถกดปุ่ม **"✅ อนุมัติสร้าง Draft บนเว็บ"** ด้านล่างเพื่อลองใหม่ หรือกด **"✏️ แก้ไข"** / **"🔄 ลองใหม่"** ได้ครับ)*`,
                embeds: [embed],
                components: [actionRow]
              });
            } else {
              await interaction.editReply({
                content: `⚠️ ไม่สามารถสร้าง Draft ได้: ${result.message || result.error || 'Unknown error'}`,
                components: []
              });
            }
          }
        } catch (err) {
          const { rows: curRows } = await pool.query('SELECT * FROM solution_suggestions WHERE id = $1', [parseInt(id, 10)]).catch(() => ({ rows: [] }));
          if (curRows.length) {
            const currentItem = curRows[0];
            let baseSolutionText = String(currentItem.base_solution_id || '-');
            if (currentItem.base_solution_id) {
              try {
                const { rows: solRows } = await pool.query(
                  'SELECT solution_title FROM processed_solutions WHERE solution_id = $1 LIMIT 1',
                  [String(currentItem.base_solution_id)]
                );
                if (solRows.length && solRows[0].solution_title) {
                  baseSolutionText = `${solRows[0].solution_title} (ID: ${currentItem.base_solution_id})`;
                }
              } catch (_) {}
            }
            const { embed, actionRow } = buildFlow1Card(currentItem, baseSolutionText);
            embed.setColor(0xed4245);
            embed.addFields({
              name: '⚠️ ข้อผิดพลาดของระบบ',
              value: String(err.message || 'Unknown error').slice(0, 1024),
              inline: false
            });
            await interaction.editReply({
              content: `⚠️ **เกิดข้อผิดพลาดในการสร้าง Draft:** ${err.message}\n*(สามารถกดลองอนุมัติใหม่ได้จากปุ่มด้านล่าง)*`,
              embeds: [embed],
              components: [actionRow]
            });
          } else {
            await interaction.editReply({
              content: `⚠️ เกิดข้อผิดพลาดในการสร้าง Draft: ${err.message}`,
              components: []
            });
          }
        }
        return;
      }

      if (interaction.customId.startsWith('flow1_reject_')) {
        const id = interaction.customId.replace('flow1_reject_', '');
        const reviewedBy = formatReviewedBy(interaction.user);
        await pool.query(
          "UPDATE solution_suggestions SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2 WHERE id = $1",
          [parseInt(id), reviewedBy]
        );
        await interaction.update({
          content: `❌ **ปฏิเสธไอเดียโซลูชันนี้แล้ว** (ID: #${id})\n👤 **ปฏิเสธโดย:** \`${reviewedBy}\``,
          components: []
        });
        return;
      }

      if (interaction.customId.startsWith('flow1_retry_')) {
        const id = interaction.customId.replace('flow1_retry_', '');
        await interaction.deferReply();
        const reviewedBy = formatReviewedBy(interaction.user);

        let targetSolutionId = null;
        let targetSolutionTitle = null;
        try {
          const { rows } = await pool.query(
            'SELECT base_solution_id FROM solution_suggestions WHERE id = $1',
            [parseInt(id, 10)]
          );
          if (rows.length && rows[0].base_solution_id) {
            const baseId = String(rows[0].base_solution_id);
            const { rows: solRows } = await pool.query(
              'SELECT solution_id, solution_title FROM processed_solutions WHERE solution_id = $1 LIMIT 1',
              [baseId]
            );
            if (solRows.length && solRows[0].solution_title) {
              targetSolutionId = solRows[0].solution_id;
              targetSolutionTitle = solRows[0].solution_title;
            }
          }
        } catch (e) {
          console.error('Error fetching base solution for retry:', e);
        }

        const webhookUrl = process.env.N8N_FLOW1_IDEA_WEBHOOK_URL || 'http://n8n:5678/webhook/flow1-request-idea';
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
              ? `\n🎯 **ต่อยอดจากโซลูชันเดิม:** \`${targetSolutionTitle}\` (ID: ${targetSolutionId})`
              : '\n🎲 **โหมด:** สำรวจและกระจายไอเดียตามแนวโน้มเทคโนโลยี';

            return await interaction.editReply(
              `🔄 **สั่งลองขอไอเดียโซลูชันใหม่จาก Flow 1 สำเร็จแล้ว!** (อ้างอิงจากไอเดีย #${id})${targetMsg}\n👤 **สั่งโดย:** \`${reviewedBy}\`\nระบบกำลังดึงข้อมูลฟีดและวิเคราะห์ Adjacent Solution ใหม่ผ่าน Gemini AI\nเมื่อประมวลผลเสร็จแล้วจะส่งการแจ้งเตือนมายังห้องนี้ครับ`
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

      if (interaction.customId.startsWith('flow1_edit_')) {
        const id = parseInt(interaction.customId.replace('flow1_edit_', ''), 10);
        const { rows } = await pool.query(
          'SELECT id, base_solution_id, title_th, title_en, description_th, description_en, rationale, status FROM solution_suggestions WHERE id = $1',
          [id]
        );

        if (!rows.length) {
          return await interaction.reply({ content: '❌ ไม่พบข้อมูลไอเดียโซลูชันนี้', ephemeral: true });
        }

        const item = rows[0];
        if (item.status === 'published_as_draft' || item.status === 'publishing') {
          return await interaction.reply({
            content: `⚠️ ไอเดียนี้ได้รับการอนุมัติ/สร้างบนเว็บแล้ว ไม่สามารถแก้ไขได้`,
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_flow1_edit_${id}`)
          .setTitle(`✏️ แก้ไขไอเดียโซลูชัน #${id}`.slice(0, 45));

        const titleThInput = new TextInputBuilder()
          .setCustomId('title_th')
          .setLabel('ชื่อโซลูชัน (ภาษาไทย)')
          .setStyle(TextInputStyle.Short)
          .setValue((item.title_th || '').slice(0, 150))
          .setMaxLength(150)
          .setRequired(true);

        const titleEnInput = new TextInputBuilder()
          .setCustomId('title_en')
          .setLabel('Title (English)')
          .setStyle(TextInputStyle.Short)
          .setValue((item.title_en || '').slice(0, 150))
          .setMaxLength(150)
          .setRequired(true);

        const descThInput = new TextInputBuilder()
          .setCustomId('description_th')
          .setLabel('คำอธิบาย (ภาษาไทย)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue((item.description_th || '').slice(0, 1000))
          .setMaxLength(1000)
          .setRequired(true);

        const descEnInput = new TextInputBuilder()
          .setCustomId('description_en')
          .setLabel('Description (English)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue((item.description_en || '').slice(0, 1000))
          .setMaxLength(1000)
          .setRequired(false);

        const rationaleInput = new TextInputBuilder()
          .setCustomId('rationale')
          .setLabel('เหตุผลเชิงกลยุทธ์ (Rationale)')
          .setStyle(TextInputStyle.Paragraph)
          .setValue((item.rationale || '').slice(0, 1000))
          .setMaxLength(1000)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleThInput),
          new ActionRowBuilder().addComponents(titleEnInput),
          new ActionRowBuilder().addComponents(descThInput),
          new ActionRowBuilder().addComponents(descEnInput),
          new ActionRowBuilder().addComponents(rationaleInput)
        );

        return await interaction.showModal(modal);
      }

      if (interaction.customId.startsWith('flow2_publish_')) {
        const id = interaction.customId.replace('flow2_publish_', '');
        await interaction.deferUpdate();
        try {
          const reviewedBy = formatReviewedBy(interaction.user);
          const result = await publishDraft({
            id: parseInt(id),
            pool,
            client,
            channelId: interaction.channelId,
            reviewedBy
          });
          if (result.success) {
            const isManual = result.platform === 'manual_article' || result.platform === 'manual';
            if (isManual) {
              let draftData = result.draft;
              if (!draftData || !draftData.title_th) {
                const { rows } = await pool.query('SELECT title_th, content_markdown, tags, solution_title FROM content_drafts WHERE id = $1', [parseInt(id)]);
                draftData = rows[0] || {};
              }
              const title = draftData.title_th || 'Manual Enterprise Article';
              const tags = (draftData.tags || []).join(', ') || '-';
              const preview = (draftData.content_markdown || '').slice(0, 350);

              // 1. In-place update of original card (Approach 1: Green border, keep Copy button)
              const cardEmbed = new EmbedBuilder()
                .setTitle(`✅ [พร้อมใช้งานแล้ว] Manual Enterprise Article`)
                .setColor(0x10b981)
                .setDescription(`📌 **ชื่อบทความ:** ${title}\n👤 **ดำเนินการโดย:** \`${reviewedBy}\`\n🎯 **แพลตฟอร์มแนะนำ:** Blognone, TechTalkThai, สื่อไอที, เว็บไซต์องค์กร`)
                .addFields(
                  { name: '🏷️ แท็ก', value: tags, inline: true },
                  { name: '💾 สถานะ', value: 'พร้อมนำไปเผยแพร่ (Ready to post)', inline: true },
                  { name: '📄 ตัวอย่างเนื้อหา (Preview)', value: `\`\`\`markdown\n${preview}...\n\`\`\``, inline: false },
                  { name: '💡 การทำงาน', value: 'สามารถกดปุ่ม **"📋 คัดลอกบทความเต็ม"** ด้านล่างเพื่อคัดลอก Markdown ได้ตลอดเวลา', inline: false }
                )
                .setFooter({ text: `Draft ID: #${id} • อนุมัติเรียบร้อย` })
                .setTimestamp();

              const cardRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`flow2_copy_${id}`).setLabel('📋 คัดลอกบทความเต็ม').setStyle(ButtonStyle.Primary)
              );

              await interaction.editReply({
                embeds: [cardEmbed],
                components: [cardRow]
              });

              // 2. Send Quoted Reply notification with Jump Link + Copy Button (Approach 2)
              if (interaction.message && typeof interaction.message.reply === 'function') {
                try {
                  const replyEmbed = new EmbedBuilder()
                    .setTitle(`📝 [MANUAL ARTICLE READY] บทความพร้อมนำไปเผยแพร่แล้ว`)
                    .setColor(0x10b981)
                    .setDescription(`📌 **ชื่อบทความ:** ${title}\n👤 **อนุมัติโดย:** \`${reviewedBy}\`\n🏷️ **แท็ก:** ${tags}`)
                    .addFields(
                      { name: '📄 ตัวอย่างเนื้อหา (Preview)', value: `\`\`\`markdown\n${preview}...\n\`\`\``, inline: false },
                      { name: '👉 ขั้นตอนต่อไป', value: 'กดปุ่ม **"📋 คัดลอกบทความเต็ม"** ด้านล่างเพื่อนำ Markdown ไปโพสต์ หรือกด **"🔗 กระโดดไปที่การ์ดต้นทาง"** เพื่อกลับไปดูการ์ดหลัก', inline: false }
                    )
                    .setFooter({ text: `Draft ID: #${id} • Ready to Publish` })
                    .setTimestamp();

                  const replyRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`flow2_copy_${id}`).setLabel('📋 คัดลอกบทความเต็ม').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔗 กระโดดไปที่การ์ดต้นทาง').setURL(interaction.message.url)
                  );

                  await interaction.message.reply({
                    embeds: [replyEmbed],
                    components: [replyRow]
                  });
                } catch (replyErr) {
                  console.warn('[flow2_publish] Quoted reply warning:', replyErr.message);
                }
              }
              return;
            }

            const isDraft = result.isDraft || result.status === 'ready_to_post';
            const actionTitle = isDraft ? 'บันทึกเป็นแบบร่าง (Draft) สำเร็จแล้ว!' : 'เผยแพร่โพสต์สำเร็จ!';
            const platformName = (result.platform || 'Platform').toUpperCase();
            const linkDisplay = result.postedUrl
              ? (isDraft && result.platform === 'devto'
                  ? `[เปิดดูแบบร่างและกด Publish บน Dev.to Dashboard](${result.postedUrl})`
                  : `[ดูโพสต์ที่เผยแพร่แล้ว](${result.postedUrl})`)
              : 'พร้อมใช้งานแล้ว';
            const noteText = isDraft && result.platform === 'devto'
              ? '\n💡 *หมายเหตุ: สร้างเป็นแบบร่าง (Draft) เพื่อป้องกันไม่ให้ระบบ Anti-Spam ของ Dev.to บล็อกบัญชีใหม่ ทีมงานสามารถตรวจทานและกด Publish บนเว็บได้เลย*'
              : '';

            const doneEmbed = new EmbedBuilder()
              .setTitle(`✅ ${actionTitle} [${platformName}]`)
              .setColor(0x10b981)
              .setDescription(`👤 **ดำเนินการโดย:** \`${reviewedBy}\`\n🔗 **ลิงก์:** ${linkDisplay}${noteText}`)
              .setFooter({ text: `Draft ID: #${id} • สำเร็จ` })
              .setTimestamp();

            await interaction.editReply({
              embeds: [doneEmbed],
              components: []
            });
          } else {
            const failEmbed = new EmbedBuilder()
              .setTitle(`⚠️ เผยแพร่ไม่สำเร็จ [${(result.platform || '').toUpperCase()}]`)
              .setColor(0xf59e0b)
              .setDescription(`ข้อผิดพลาด: ${result.error || result.message || 'Unknown error'}`)
              .setFooter({ text: `Draft ID: #${id}` })
              .setTimestamp();

            await interaction.editReply({
              embeds: [failEmbed],
              components: []
            });
          }
        } catch (err) {
          await interaction.editReply({
            content: `⚠️ เกิดข้อผิดพลาดในการเผยแพร่: ${err.message}`,
            components: []
          });
        }
        return;
      }

      if (interaction.customId.startsWith('flow2_reject_')) {
        const id = interaction.customId.replace('flow2_reject_', '');
        const reviewedBy = formatReviewedBy(interaction.user);
        await rejectDraft({ id: parseInt(id), pool, reviewedBy });

        const rejectEmbed = new EmbedBuilder()
          .setTitle('❌ ปฏิเสธ Draft นี้แล้ว')
          .setColor(0xef4444)
          .setDescription(`👤 **ปฏิเสธโดย:** \`${reviewedBy}\`\nDraft ID: \`#${id}\` จะไม่ถูกเผยแพร่`)
          .setFooter({ text: `Draft ID: #${id} • ปฏิเสธ` })
          .setTimestamp();

        await interaction.update({
          embeds: [rejectEmbed],
          components: []
        });
        return;
      }

      if (interaction.customId.startsWith('flow2_edit_')) {
        const id = parseInt(interaction.customId.replace('flow2_edit_', ''), 10);
        const { rows } = await pool.query(
          'SELECT id, platform, title_th, content_markdown, tags, status FROM content_drafts WHERE id = $1',
          [id]
        );

        if (!rows.length) {
          return await interaction.reply({ content: '❌ ไม่พบข้อมูล Draft นี้', ephemeral: true });
        }

        const draft = rows[0];
        if (draft.status === 'posted') {
          return await interaction.reply({
            content: `⚠️ Draft ID: #${id} มีสถานะเป็น 'posted' แล้ว ไม่สามารถแก้ไขได้`,
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`modal_flow2_edit_${id}`)
          .setTitle(`✏️ แก้ไข Draft #${id} (${draft.platform})`.slice(0, 45));

        const isBluesky = draft.platform === 'bluesky';

        if (isBluesky) {
          const contentInput = new TextInputBuilder()
            .setCustomId('content_markdown')
            .setLabel('ข้อความโพสต์ Bluesky (ไม่เกิน 300 ตัวอักษร)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue((draft.content_markdown || '').slice(0, 300))
            .setMaxLength(300)
            .setRequired(true);

          const tagsInput = new TextInputBuilder()
            .setCustomId('tags')
            .setLabel('แท็ก (คั่นด้วย comma เช่น syaco, tech)')
            .setStyle(TextInputStyle.Short)
            .setValue((draft.tags || []).join(', '))
            .setMaxLength(100)
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(contentInput),
            new ActionRowBuilder().addComponents(tagsInput)
          );
        } else {
          const titleInput = new TextInputBuilder()
            .setCustomId('title')
            .setLabel('ชื่อบทความ / หัวข้อ (Title)')
            .setStyle(TextInputStyle.Short)
            .setValue((draft.title_th || '').slice(0, 100))
            .setMaxLength(100)
            .setRequired(true);

          const contentInput = new TextInputBuilder()
            .setCustomId('content_markdown')
            .setLabel('เนื้อหาบทความ (Markdown)')
            .setStyle(TextInputStyle.Paragraph)
            .setValue((draft.content_markdown || '').slice(0, 4000))
            .setMaxLength(4000)
            .setRequired(true);

          const tagsInput = new TextInputBuilder()
            .setCustomId('tags')
            .setLabel('แท็ก (คั่นด้วย comma เช่น tech, devops)')
            .setStyle(TextInputStyle.Short)
            .setValue((draft.tags || []).join(', '))
            .setMaxLength(100)
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(contentInput),
            new ActionRowBuilder().addComponents(tagsInput)
          );
        }

        return await interaction.showModal(modal);
      }

      if (interaction.customId.startsWith('flow2_copy_')) {
        const id = interaction.customId.replace('flow2_copy_', '');
        const { rows } = await pool.query('SELECT title_th, content_markdown, tags, platform FROM content_drafts WHERE id = $1', [parseInt(id)]);
        if (!rows.length) {
          return await interaction.reply({ content: 'ไม่พบข้อมูลบทความ', ephemeral: true });
        }
        const draft = rows[0];
        const tagsStr = (draft.tags || []).join(', ') || '-';
        const label = draft.platform === 'devto' ? 'Dev.to Technical Article' : 'Manual Enterprise Article';
        const header = `📋 **เนื้อหาบทความฉบับเต็ม (${label})**\n\n📌 **ชื่อบทความ:** ${draft.title_th}\n🏷️ **แท็ก:** \`${tagsStr}\`\n\n\`\`\`markdown\n`;
        const footer = `\n\`\`\``;
        const maxBody = Math.max(100, 1950 - header.length - footer.length);
        const fullContent = draft.content_markdown || '';
        const isTruncated = fullContent.length > maxBody;
        const text = isTruncated
          ? fullContent.slice(0, maxBody - 3) + '...'
          : fullContent;

        const files = [];
        if (isTruncated) {
          const buffer = Buffer.from(fullContent, 'utf8');
          files.push(new AttachmentBuilder(buffer, { name: `article-${id}.md` }));
        }

        await interaction.reply({
          content: `${header}${text}${footer}${isTruncated ? `\n📎 *บทความมีความยาวเกิน 2,000 ตัวอักษร ได้แนบไฟล์ \`article-${id}.md\` ฉบับเต็มให้ดาวน์โหลดแล้วด้านล่าง*` : ''}`,
          files,
          ephemeral: true
        });
        return;
      }

      if (interaction.customId.startsWith('copy_answer_')) {
        const candidateId = interaction.customId.replace('copy_answer_', '');
        const { rows } = await pool.query('SELECT answer, post_url, post_title, platform FROM backlink_candidates WHERE id::text = $1', [candidateId]);
        if (!rows.length) {
          return await interaction.reply({ content: '❌ ไม่พบข้อมูลคำตอบนี้ในระบบ', ephemeral: true });
        }
        return await interaction.reply({
          content: `📋 **ข้อความคำตอบสำหรับนำไปโพสต์ (Candidate #${candidateId} - ${rows[0].platform.toUpperCase()}):**\n\`\`\`text\n${rows[0].answer}\n\`\`\`\n🔗 **ลิงก์กระทู้:** ${rows[0].post_url}`,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith('markposted_')) {
        const candidateId = interaction.customId.replace('markposted_', '');
        const reviewedBy = formatReviewedBy(interaction.user);
        const { rows } = await pool.query(
          "UPDATE backlink_candidates SET status = 'posted', posted_at = NOW(), reviewed_at = NOW(), reviewed_by = $2 WHERE id::text = $1 AND status = 'manual' RETURNING *",
          [candidateId, reviewedBy]
        );
        if (!rows.length) {
          return await interaction.reply({ content: '⚠️ รายการนี้ไม่อยู่ในสถานะ Manual หรือได้รับการอัปเดตไปแล้ว', ephemeral: true });
        }
        const row = rows[0];
        const doneEmbed = new EmbedBuilder()
          .setTitle(`🎉 บันทึกการตอบกระทู้สำเร็จแล้ว [${row.platform.toUpperCase()}]`)
          .setColor(0x10b981)
          .setDescription(`👤 **บันทึกโดย:** \`${reviewedBy}\`\n📌 **กระทู้:** [${row.post_title}](${row.post_url})\n\n✅ บันทึกสถานะเป็น \`posted\` ในระบบเรียบร้อยแล้ว`)
          .setFooter({ text: `Candidate ID: #${candidateId} • เสร็จสมบูรณ์` })
          .setTimestamp();

        const linkRow = (row.post_url && row.post_url.startsWith('http'))
          ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔗 เปิดดูกระทู้ที่ตอบแล้ว').setURL(row.post_url))]
          : [];

        return await interaction.update({
          content: null,
          embeds: [doneEmbed],
          components: linkRow,
        });
      }

      const [action, candidateId] = interaction.customId.split('_');

      if (action === 'reject') {
        const reviewedBy = formatReviewedBy(interaction.user);
        await pool.query(
          "UPDATE backlink_candidates SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2 WHERE id::text = $1",
          [candidateId, reviewedBy]
        );
        const rejectEmbed = new EmbedBuilder()
          .setTitle('❌ ปฏิเสธคำตอบนี้แล้ว')
          .setColor(0xef4444)
          .setDescription(`👤 **ปฏิเสธโดย:** \`${reviewedBy}\`\nCandidate ID: \`#${candidateId}\` ถูกยกเลิกและจะไม่นำไปโพสต์`)
          .setFooter({ text: `Candidate ID: #${candidateId} • ปฏิเสธ` })
          .setTimestamp();

        await interaction.update({
          content: null,
          embeds: [rejectEmbed],
          components: [],
        });
        return;
      }

      if (action === 'edit') {
        const { rows } = await pool.query('SELECT answer FROM backlink_candidates WHERE id::text = $1', [candidateId]);
        if (!rows.length) return interaction.reply({ content: '❌ ไม่พบข้อมูล Candidate ในระบบ', ephemeral: true });

        const modal = new ModalBuilder()
          .setCustomId(`modal_${candidateId}`)
          .setTitle(`✏️ ปรับแต่งข้อความคำตอบ #${candidateId}`.slice(0, 45));

        const answerInput = new TextInputBuilder()
          .setCustomId('edited_answer')
          .setLabel('ข้อความคำตอบ (Answer Text)')
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
      if (interaction.customId === 'modal_devto_key') {
        if (!isAuthorizedAdmin(interaction.user)) {
          return await interaction.reply({
            content: `⛔ **ไม่มีสิทธิ์ดำเนินการ:** เฉพาะผู้ดูแลระบบที่ระบุใน \`DISCORD_ADMIN_IDS\` เท่านั้นที่สามารถตั้งค่า API Key ได้ (ID ของคุณ: \`${interaction.user.id}\`)`,
            ephemeral: true
          });
        }
        const rawKey = interaction.fields.getTextInputValue('key_value');
        await interaction.deferReply({ ephemeral: true });
        return await saveAndVerifyDevtoKey(interaction, rawKey, pool);
      }

      if (interaction.customId === 'modal_devto_cookie') {
        if (!isAuthorizedAdmin(interaction.user)) {
          return await interaction.reply({
            content: `⛔ **ไม่มีสิทธิ์ดำเนินการ:** เฉพาะผู้ดูแลระบบที่ระบุใน \`DISCORD_ADMIN_IDS\` เท่านั้นที่สามารถตั้งค่า Cookie ได้ (ID ของคุณ: \`${interaction.user.id}\`)`,
            ephemeral: true
          });
        }
        const rawCookie = interaction.fields.getTextInputValue('cookie_value');
        await interaction.deferReply({ ephemeral: true });
        return await saveAndVerifyDevtoCookie(interaction, rawCookie, pool);
      }

      if (interaction.customId.startsWith('modal_flow1_edit_')) {
        const id = parseInt(interaction.customId.replace('modal_flow1_edit_', ''), 10);
        const { rows: existingRows } = await pool.query(
          'SELECT id, base_solution_id, status FROM solution_suggestions WHERE id = $1',
          [id]
        );

        if (!existingRows.length) {
          return await interaction.reply({ content: '❌ ไม่พบข้อมูลไอเดียนี้ในระบบ', ephemeral: true });
        }

        const newTitleTh = interaction.fields.getTextInputValue('title_th').trim();
        const newTitleEn = interaction.fields.getTextInputValue('title_en').trim();
        const newDescTh = interaction.fields.getTextInputValue('description_th').trim();
        const newDescEn = interaction.fields.getTextInputValue('description_en')?.trim() || '';
        const newRationale = interaction.fields.getTextInputValue('rationale')?.trim() || '';
        const reviewedBy = formatReviewedBy(interaction.user);

        const updateRes = await pool.query(
          `UPDATE solution_suggestions
           SET title_th = $1,
               title_en = $2,
               description_th = $3,
               description_en = COALESCE(NULLIF($4, ''), description_en),
               rationale = COALESCE(NULLIF($5, ''), rationale),
               reviewed_at = NOW(),
               reviewed_by = $6
           WHERE id = $7 AND status IN ('pending_review', 'failed')
           RETURNING *;`,
          [newTitleTh, newTitleEn, newDescTh, newDescEn, newRationale, reviewedBy, id]
        );

        if (!updateRes.rows.length) {
          return await interaction.reply({
            content: '⚠️ ไม่สามารถบันทึกได้ อาจเนื่องจากไอเดียนี้มีสถานะไม่พร้อมแก้ไข',
            ephemeral: true
          });
        }

        const updated = updateRes.rows[0];
        let baseSolutionText = String(updated.base_solution_id || '-');
        if (updated.base_solution_id) {
          try {
            const { rows: solRows } = await pool.query(
              'SELECT solution_title FROM processed_solutions WHERE solution_id = $1 LIMIT 1',
              [String(updated.base_solution_id)]
            );
            if (solRows.length && solRows[0].solution_title) {
              baseSolutionText = `${solRows[0].solution_title} (ID: ${updated.base_solution_id})`;
            }
          } catch (_) {}
        }

        const { embed, actionRow } = buildFlow1Card(updated, baseSolutionText, reviewedBy);

        await interaction.update({
          embeds: [embed],
          components: [actionRow]
        });
        return;
      }

      if (interaction.customId.startsWith('modal_flow2_edit_')) {
        const id = parseInt(interaction.customId.replace('modal_flow2_edit_', ''), 10);
        const { rows: existingRows } = await pool.query(
          'SELECT id, platform, solution_id, solution_title FROM content_drafts WHERE id = $1',
          [id]
        );

        if (!existingRows.length) {
          return await interaction.reply({ content: '❌ ไม่พบข้อมูล Draft ในระบบ', ephemeral: true });
        }

        const current = existingRows[0];
        const isBluesky = current.platform === 'bluesky';
        const newTitle = isBluesky
          ? null
          : interaction.fields.getTextInputValue('title').trim();
        const newContent = interaction.fields.getTextInputValue('content_markdown').trim();
        const rawTags = interaction.fields.getTextInputValue('tags');
        let newTags = [];

        if (rawTags) {
          newTags = rawTags
            .split(/[,;\s]+/)
            .map(t => t.trim().toLowerCase().replace(/[^a-z0-9ก-๙]/g, ''))
            .filter(Boolean);
        }

        if (current.platform === 'devto') {
          newTags = sanitizeDevtoTags(newTags);
        }

        const reviewedBy = formatReviewedBy(interaction.user);

        const updateRes = await pool.query(
          `UPDATE content_drafts
           SET title_th = COALESCE($1, title_th),
               content_markdown = $2,
               tags = $3,
               reviewed_at = NOW(),
               reviewed_by = $4,
               error_message = NULL
           WHERE id = $5 AND status IN ('pending_review', 'failed')
           RETURNING *;`,
          [newTitle, newContent, newTags, reviewedBy, id]
        );

        if (!updateRes.rows.length) {
          return await interaction.reply({
            content: '⚠️ ไม่สามารถบันทึกได้ อาจเนื่องจาก Draft นี้มีสถานะไม่พร้อมแก้ไข',
            ephemeral: true
          });
        }

        const updatedDraft = updateRes.rows[0];
        const { embed, actionRow } = buildFlow2Card(updatedDraft, current.solution_title);

        await interaction.update({
          embeds: [embed],
          components: [actionRow]
        });

        await interaction.followUp({
          content: `✅ **แก้ไขเนื้อหา Draft #${id} (${updatedDraft.platform.toUpperCase()}) สำเร็จแล้ว!** โดย \`${reviewedBy}\``,
          ephemeral: true
        });
        return;
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
            try {
              let alertChannelId = null;
              const { rows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
              if (rows.length && rows[0].value && rows[0].value !== '123456789012345678') {
                alertChannelId = rows[0].value;
              }
              if (!alertChannelId) alertChannelId = process.env.DISCORD_CHANNEL_ID;
              if (alertChannelId) {
                const alertChannel = await client.channels.fetch(alertChannelId).catch(() => null);
                if (alertChannel) {
                  const quotaAlertEmbed = new EmbedBuilder()
                    .setTitle('🚫 [Flow 3] แจ้งเตือน: โควตาตอบกระทู้เต็มแล้ว')
                    .setColor(0xef4444)
                    .setDescription(`ผู้ใช้ **${interaction.user.tag}** (<@${interaction.user.id}>) พยายามส่งกระทู้เข้าระบบ แต่โควตาสัปดาห์นี้เต็มแล้ว`)
                    .addFields(
                      { name: 'แพลตฟอร์ม', value: platform, inline: true },
                      { name: 'จำนวนใน 7 วัน', value: `${resData.count} รายการ`, inline: true },
                      { name: 'ลิงก์กระทู้', value: postUrl, inline: false }
                    )
                    .setFooter({ text: 'ระบบหยุดการประมวลผลเพื่อความปลอดภัยตามนโยบาย Anti-Spam' })
                    .setTimestamp();
                  await alertChannel.send({ embeds: [quotaAlertEmbed] }).catch(() => {});
                }
              }
            } catch (err) {
              console.error('Error sending quota alert to channel:', err);
            }

            const limitText = resData.limit && resData.limit < 999999 ? `/${resData.limit}` : '';
            return await interaction.editReply(`🚫 **โควตาสัปดาห์นี้เต็มแล้ว (${resData.count}${limitText} รายการ)** ระบบได้ส่งการแจ้งเตือนไปยังห้องหลักเรียบร้อยครับ`);
          }

          return await interaction.editReply(`✅ **ส่งกระทู้เข้าสู่ระบบเรียบร้อย!** AI กำลังประเมิน Lead Fit และร่างคำตอบ การ์ดจะปรากฏในห้องแจ้งเตือนเมื่อพร้อมตรวจทานครับ`);
        } catch (err) {
          return await interaction.editReply(`⚠️ ไม่สามารถส่งคำขอไปยัง n8n ได้: ${err.message}`);
        }
      }

      const candidateId = interaction.customId.replace('modal_', '');
      const newAnswer = interaction.fields.getTextInputValue('edited_answer').trim();
      const reviewedBy = formatReviewedBy(interaction.user);

      const { rows } = await pool.query(
        'UPDATE backlink_candidates SET answer = $1, reviewed_at = NOW(), reviewed_by = $3 WHERE id::text = $2 RETURNING *',
        [newAnswer, candidateId, reviewedBy]
      );

      if (!rows.length) {
        return await interaction.reply({ content: 'Candidate not found', ephemeral: true });
      }

      const updatedEmbed = createCandidateEmbed(rows[0]);
      const actionRow = createActionButtons(rows[0].id, rows[0].post_url);

      await interaction.update({
        content: `✏️ **ปรับปรุงข้อความคำตอบเรียบร้อย!** (แก้ไขโดย \`${reviewedBy}\` — ตรวจทานและกด **✅ อนุมัติคำตอบ** เมื่อพร้อมโพสต์)`,
        embeds: [updatedEmbed],
        components: [actionRow],
      });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content: `⚠️ เกิดข้อผิดพลาด: ${err.message}`,
          components: []
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: `⚠️ เกิดข้อผิดพลาด: ${err.message}`,
          ephemeral: true
        });
      }
    } catch (replyErr) {
      console.error('Failed to report interaction error to Discord:', replyErr);
    }
  }
});

async function handleApproval(interaction, candidateId, overrideAnswer = null) {
  await interaction.deferUpdate();

  const { rows } = await pool.query(
    "SELECT * FROM backlink_candidates WHERE id::text = $1 AND status IN ('pending_review', 'failed')",
    [candidateId]
  );
  if (!rows.length) {
    return interaction.followUp({ content: 'Candidate was already handled or not found.', ephemeral: true });
  }

  const row = rows[0];
  const finalAnswer = overrideAnswer || row.answer;
  const reviewedBy = formatReviewedBy(interaction.user);

  if (row.platform === 'bluesky') {
    try {
      const postedUrl = await postToBluesky(row.post_url, finalAnswer);
      await pool.query(
        "UPDATE backlink_candidates SET status = 'posted', answer = $1, posted_url = $2, posted_at = NOW(), reviewed_at = NOW(), reviewed_by = $4, error_message = NULL WHERE id::text = $3",
        [finalAnswer, postedUrl, candidateId, reviewedBy]
      );

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅ เผยแพร่สดบน Bluesky สำเร็จ!')
        .setColor(0x0085ff)
        .setDescription(`👤 **อนุมัติโดย:** \`${reviewedBy}\`\n🔗 **ลิงก์:** [เปิดดู Reply บน Bluesky](${postedUrl})`)
        .setFooter({ text: `Candidate ID: #${candidateId} • เผยแพร่แล้ว` })
        .setTimestamp();

      const linkRow = [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔗 เปิดดู Reply บน Bluesky').setURL(postedUrl))];

      await interaction.editReply({
        content: null,
        embeds: [doneEmbed],
        components: linkRow,
      });
    } catch (postError) {
      await pool.query(
        "UPDATE backlink_candidates SET status = 'failed', error_message = $1, reviewed_at = NOW(), reviewed_by = $3 WHERE id::text = $2",
        [postError.message, candidateId, reviewedBy]
      );
      const retryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${candidateId}`).setLabel('🔄 ลองอนุมัติใหม่').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`edit_${candidateId}`).setLabel('✏️ แก้ไขข้อความ').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`reject_${candidateId}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({
        content: `⚠️ **โพสต์บน Bluesky ไม่สำเร็จ:** ${postError.message}\nสามารถแก้ไขหรือลองใหม่ได้จากปุ่มด้านล่างครับ:`,
        components: [retryRow],
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
        "UPDATE backlink_candidates SET status = 'posted', answer = $1, posted_url = $2, posted_at = NOW(), reviewed_at = NOW(), reviewed_by = $4, error_message = NULL WHERE id::text = $3",
        [finalAnswer, postedUrl, candidateId, reviewedBy]
      );

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅ โพสต์คอมเมนต์บน Dev.to สำเร็จ!')
        .setColor(0x10b981)
        .setDescription(`👤 **อนุมัติโดย:** \`${reviewedBy}\`\n🔗 **ลิงก์:** [เปิดดูคอมเมนต์บน Dev.to](${postedUrl})`)
        .setFooter({ text: `Candidate ID: #${candidateId} • เผยแพร่แล้ว` })
        .setTimestamp();

      const linkRow = [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔗 เปิดดูคอมเมนต์บน Dev.to').setURL(postedUrl))];

      await interaction.editReply({
        content: null,
        embeds: [doneEmbed],
        components: linkRow,
      });
    } catch (postError) {
      await pool.query(
        "UPDATE backlink_candidates SET status = 'failed', error_message = $1, reviewed_at = NOW(), reviewed_by = $3 WHERE id::text = $2",
        [postError.message, candidateId, reviewedBy]
      );
      const retryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${candidateId}`).setLabel('🔄 ลองอนุมัติใหม่').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`edit_${candidateId}`).setLabel('✏️ แก้ไขข้อความ').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`reject_${candidateId}`).setLabel('❌ ปฏิเสธ').setStyle(ButtonStyle.Danger)
      );
      await interaction.editReply({
        content: `⚠️ **โพสต์บน Dev.to ไม่สำเร็จ:** ${postError.message}\nสามารถแก้ไขหรือลองใหม่ได้จากปุ่มด้านล่างครับ:`,
        components: [retryRow],
      });
      await interaction.followUp({
        content: `🔗 **Thread Link:** ${row.post_url}\nDraft Answer:\n\`\`\`\n${finalAnswer}\n\`\`\``,
        ephemeral: true,
      });
    }
  } else {
    // Pantip, LinkedIn, Facebook, Facebook Group -> Manual Workflow
    await pool.query(
      "UPDATE backlink_candidates SET status = 'manual', answer = $1, reviewed_at = NOW(), reviewed_by = $3, error_message = NULL WHERE id::text = $2",
      [finalAnswer, candidateId, reviewedBy]
    );

    const platName = String(row.platform || 'Platform').toUpperCase();
    const approvedEmbed = new EmbedBuilder()
      .setTitle(`📋 อนุมัติคำตอบเรียบร้อยแล้ว [${platName}]`)
      .setColor(0x10b981)
      .setDescription(
        `👤 **อนุมัติโดย:** \`${reviewedBy}\`\n` +
        `📌 **กระทู้:** [${row.post_title}](${row.post_url})\n\n` +
        `👇 **ขั้นตอนการนำไปตอบ:**\n` +
        `1. แตะปุ่ม **Copy** ที่มุมขวาบนของกล่องข้อความด้านล่าง\n` +
        `2. กดปุ่ม **"🔗 ไปยังกระทู้เพื่อตอบ"** เพื่อเปิดหน้ากระทู้ทันที\n` +
        `3. วางข้อความและส่งในกระทู้ จากนั้นกลับมากด **"✅ บันทึกว่าโพสต์แล้ว"**`
      )
      .addFields(
        { name: '📄 ข้อความคำตอบที่พร้อมโพสต์ (แตะ Copy ได้ทันที)', value: `\`\`\`text\n${finalAnswer.slice(0, 1024)}\n\`\`\`` }
      )
      .setFooter({ text: `Candidate ID: #${candidateId} • สถานะ: พร้อมนำไปตอบในกระทู้` })
      .setTimestamp();

    const actionButtons = [];
    if (row.post_url && row.post_url.startsWith('http')) {
      actionButtons.push(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('🔗 ไปยังกระทู้เพื่อตอบ').setURL(row.post_url)
      );
    }
    actionButtons.push(
      new ButtonBuilder().setCustomId(`markposted_${candidateId}`).setLabel('✅ บันทึกว่าโพสต์แล้ว (Mark as Posted)').setStyle(ButtonStyle.Success)
    );
    actionButtons.push(
      new ButtonBuilder().setCustomId(`copy_answer_${candidateId}`).setLabel('📋 แสดงข้อความเต็ม').setStyle(ButtonStyle.Secondary)
    );

    const actionRow = new ActionRowBuilder().addComponents(actionButtons);

    await interaction.editReply({
      content: null,
      embeds: [approvedEmbed],
      components: [actionRow]
    });
  }
}

// Internal Express Server for n8n Flow 1, 2, 3 notifications
const app = express();
app.use(express.json());

app.post('/notify', async (req, res) => {
  try {
    const body = req.body;

    let channelId = null;
    try {
      const { rows } = await pool.query("SELECT value FROM bot_settings WHERE key = 'DISCORD_CHANNEL_ID'");
      if (rows.length && rows[0].value && rows[0].value !== '123456789012345678') {
        channelId = rows[0].value;
      }
    } catch (_) {}

    if (!channelId) {
      const envChannel = (process.env.DISCORD_CHANNEL_ID || '').trim();
      if (envChannel && envChannel !== '123456789012345678') {
        channelId = envChannel;
      }
    }

    // Fallback: If still not configured, pick the first available text channel in connected guild
    if (!channelId && client.guilds.cache.size > 0) {
      for (const guild of client.guilds.cache.values()) {
        const defaultChannel = guild.channels.cache.find(c => c.isTextBased() && c.name !== 'command');
        if (defaultChannel) {
          channelId = defaultChannel.id;
          process.env.DISCORD_CHANNEL_ID = channelId;
          await pool.query(
            "INSERT INTO bot_settings (key, value, updated_at) VALUES ('DISCORD_CHANNEL_ID', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
            [channelId]
          ).catch(() => {});
          console.log(`[Notify] Auto-selected Discord channel #${defaultChannel.name} (${channelId})`);
          break;
        }
      }
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

      let baseSolutionText = String(s.base_solution_id || '-');
      if (s.base_solution_id) {
        try {
          const { rows } = await pool.query(
            'SELECT solution_title FROM processed_solutions WHERE solution_id = $1 LIMIT 1',
            [String(s.base_solution_id)]
          );
          if (rows.length && rows[0].solution_title) {
            baseSolutionText = `${rows[0].solution_title} (ID: ${s.base_solution_id})`;
          }
        } catch (_) {}
      }

      const { embed, actionRow } = buildFlow1Card(s, baseSolutionText);

      await channel.send({ embeds: [embed], components: [actionRow] });
      return res.json({ ok: true, type: 'flow1_suggestion', id: s.id });
    }

    // 2. Flow 2: Multi-Platform Drafts Notification
    if (body.type === 'flow2_drafts' && body.solution_id) {
      const result = await handleFlow2DraftsNotify({
        pool,
        channel,
        solution_id: body.solution_id,
        solution_title: body.solution_title
      });
      return res.json(result);
    }

    // 3. Flow 2: Manual Ready Announcement
    if (body.type === 'manual_ready' && body.draft_id) {
      const { rows } = await pool.query('SELECT title_th, content_markdown, tags FROM content_drafts WHERE id = $1', [body.draft_id]);
      if (rows.length) {
        const d = rows[0];
        await channel.send({
          content: `📝 **MANUAL ARTICLE READY**\n━━━━━━━━━━━━━━━━━━━━━━━\n📌 **ชื่อบทความ:** ${d.title_th}\n🏷️ **แท็ก:** ${(d.tags || []).join(', ')}\n\n\`\`\`markdown\n${d.content_markdown.slice(0, 1800)}\n\`\`\`\n━━━━━━━━━━━━━━━━━━━━━━━\n👉 สามารถคัดลอกไปเผยแพร่ตามแพลตฟอร์มต่างๆ ได้ทันที`
        });
      }
      return res.json({ ok: true, type: 'manual_ready' });
    }

    // 4. Flow 3: Quota Exceeded Alert
    if (body.type === 'flow3_quota_exceeded') {
      const quotaEmbed = new EmbedBuilder()
        .setTitle('🚫 [Flow 3] แจ้งเตือน: โควตาตอบกระทู้เต็มแล้ว (Quota Exceeded)')
        .setColor(0xef4444)
        .setDescription(`ระบบตรวจพบว่าจำนวนกระทู้ที่ถูกส่ง/อนุมัติในรอบ 7 วันที่ผ่านมาครบโควตาแล้ว และไม่สามารถประมวลผลกระทู้ใหม่ได้\n\n📊 **สถิติ 7 วันล่าสุด:** \`${body.count} รายการ\` (โควตาที่กำหนด: \`${body.limit && body.limit < 999999 ? body.limit : 'ไม่จำกัด'}\`)`)
        .addFields(
          { name: 'แพลตฟอร์ม', value: String(body.platform || '-'), inline: true },
          { name: 'ผู้ส่งคำขอ', value: String(body.requested_by || '-'), inline: true },
          { name: 'ลิงก์ที่พยายามส่ง', value: String(body.post_url || '-'), inline: false }
        )
        .setFooter({ text: 'เพื่อความปลอดภัยของบัญชีตามนโยบาย Anti-Spam ชุมชน' })
        .setTimestamp();

      await channel.send({ embeds: [quotaEmbed] });
      return res.json({ ok: true, type: 'flow3_quota_exceeded' });
    }

    // 5. Default: Candidate for Flow 3
    const candidate = body;
    if (!candidate || !candidate.id) {
      return res.json({ ok: true, skipped: true, reason: 'No candidate ID (likely duplicate post_url)' });
    }

    const embed = createCandidateEmbed(candidate);
    const row = createActionButtons(candidate.id, candidate.post_url);

    await channel.send({ embeds: [embed], components: [row] });
    return res.json({ ok: true, id: candidate.id });
  } catch (err) {
    console.error('Notify endpoint error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint สำหรับสั่งรัน Daily Radar ทันทีผ่าน API หรือ n8n
app.post('/daily-radar/trigger', async (req, res) => {
  try {
    const limit = parseInt(req.body?.limit || '20', 10);
    runDailyRadarTask().catch(e => console.error('[DailyRadar] Async task error:', e));
    return res.json({ ok: true, message: `Daily radar task dispatched (target: ${limit} threads)` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint สำหรับสั่งรัน Flow 1 Solution Discovery ทันทีผ่าน API หรือบอท
app.post('/flow1/trigger', async (req, res) => {
  try {
    runDailyFlow1Task().catch(e => console.error('[DailyFlow1] Async task error:', e));
    return res.json({ ok: true, message: 'Flow 1 Solution Discovery dispatched' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint สำหรับสั่งรัน Flow 2 Content Publisher ทันทีผ่าน API หรือบอท
app.post('/flow2/trigger', async (req, res) => {
  try {
    runDailyFlow2Task().catch(e => console.error('[DailyFlow2] Async task error:', e));
    return res.json({ ok: true, message: 'Flow 2 Content Publisher dispatched' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  const PORT = 3000;
  app.listen(PORT, () => console.log(`Internal notify API listening on port ${PORT}`));

  if (process.env.DISCORD_BOT_TOKEN) {
    client.login(process.env.DISCORD_BOT_TOKEN).catch(e => console.error('[Bot Login Error]', e.message));
  }
}

module.exports = {
  buildFlow2Card,
  runDailyRadarTask,
  runDailyFlow1Task,
  runDailyFlow2Task,
  app,
  client
};
