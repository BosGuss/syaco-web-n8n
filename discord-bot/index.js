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
  if (!cookie.includes('remember_user_token=')) {
    cookie = `remember_user_token=${cookie}`;
  }

  const baseHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://dev.to',
    'Referer': postUrl,
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // 1. Fetch live authenticity_token and check login status from async_info/base_data
  const tokenRes = await fetch('https://dev.to/async_info/base_data', {
    headers: { ...baseHeaders, 'Cookie': cookie },
  });
  const tokenData = await tokenRes.json();
  const csrfToken = tokenData?.token;
  if (!csrfToken) throw new Error('Could not fetch Dev.to CSRF token');
  if (!tokenData?.user) throw new Error('Dev.to session expired or invalid (user is not logged in). Please update DEVTO_COOKIE.');

  // Collect returned session cookies (e.g. _Devto_Forem_Session, updated remember_user_token)
  const rawSetCookie = tokenRes.headers.getSetCookie ? tokenRes.headers.getSetCookie() : [tokenRes.headers.get('set-cookie')].filter(Boolean);
  const newCookies = rawSetCookie.map(c => c.split(';')[0]).join('; ');
  const combinedCookie = newCookies ? `${cookie}; ${newCookies}` : cookie;

  // 2. Fetch article page to extract data-article-id / commentable_id
  const pageRes = await fetch(postUrl, { headers: { ...baseHeaders, 'Cookie': combinedCookie, 'Accept': 'text/html' } });
  const html = await pageRes.text();
  const idMatch = html.match(/data-article-id="(\d+)"/) || html.match(/data-commentable-id="(\d+)"/);
  if (!idMatch) throw new Error('Could not extract Dev.to Article ID from URL: ' + postUrl);
  const articleId = parseInt(idMatch[1]);

  // 3. Post comment
  const postRes = await fetch('https://dev.to/comments', {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'Cookie': combinedCookie,
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
const { registerCommands, handleCommand } = require('./commands');

client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  await registerCommands(client);
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
    // Reddit -> Manual Workflow
    await pool.query(
      "UPDATE backlink_candidates SET status = 'manual', answer = $1, reviewed_at = NOW() WHERE id::text = $2",
      [finalAnswer, candidateId]
    );

    await interaction.editReply({
      content: `📋 **Approved for Manual Posting** (${row.platform})\nThread: ${row.post_url}\n\n**Copy text below to reply:**`,
      components: [],
    });
    await interaction.followUp({
      content: `🔗 **Thread Link:** ${row.post_url}\nDraft Answer:\n\`\`\`\n${finalAnswer}\n\`\`\``,
    });
  }
}

// Internal Express Server for n8n Flow 1 notification
const app = express();
app.use(express.json());

app.post('/notify', async (req, res) => {
  try {
    const candidate = req.body;
    // If ON CONFLICT DO NOTHING produced an empty row, skip gracefully without throwing 400
    if (!candidate || !candidate.id) {
      return res.json({ ok: true, skipped: true, reason: 'No candidate ID (likely duplicate post_url)' });
    }

    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (!channelId) {
      return res.status(500).json({ error: 'DISCORD_CHANNEL_ID is not configured' });
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      return res.status(500).json({ error: 'Discord Channel not found' });
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