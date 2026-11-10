/**
 * SyaCo Flow 2 Publisher Module
 * Handles direct social media publishing for Flow 2 content drafts:
 * - Bluesky (AT Protocol session & link facet calculation)
 * - Dev.to (REST API)
 * - Manual Article (Ready to publish announcement)
 * Includes PostgreSQL atomic locking and error state tracking.
 */

function sanitizeDevtoTags(rawTags) {
  return (rawTags || [])
    .map(t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length >= 2)
    .slice(0, 4);
}

function computeBlueskyFacet(text) {
  if (!text || typeof text !== 'string') return [];
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return [];

  const link = urlMatch[0];
  const linkIndex = text.indexOf(link);
  const byteStart = Buffer.byteLength(text.slice(0, linkIndex), 'utf8');
  const byteEnd = byteStart + Buffer.byteLength(link, 'utf8');

  return [{
    index: { byteStart, byteEnd },
    features: [{ '$type': 'app.bsky.richtext.facet#link', uri: link }]
  }];
}

async function publishToBluesky({
  draft,
  fetchFn = globalThis.fetch,
  handle = process.env.BLUESKY_HANDLE,
  appPassword = process.env.BLUESKY_APP_PASSWORD,
  serviceUrl = 'https://bsky.social'
}) {
  if (!handle || !appPassword) {
    throw new Error('Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD');
  }

  // 1. Create Session
  const sessionRes = await fetchFn(`${serviceUrl}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
    signal: AbortSignal.timeout(15000)
  });

  if (!sessionRes.ok) {
    const errText = await sessionRes.text().catch(() => '');
    throw new Error(`Bluesky auth failed (HTTP ${sessionRes.status}): ${errText}`);
  }

  const session = await sessionRes.json();
  const text = draft.content_markdown || '';
  const facets = computeBlueskyFacet(text);

  // 2. Post record
  const postBody = {
    repo: session.did,
    collection: 'app.bsky.feed.post',
    record: {
      '$type': 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      facets
    }
  };

  const postRes = await fetchFn(`${serviceUrl}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(postBody),
    signal: AbortSignal.timeout(15000)
  });

  if (!postRes.ok) {
    const errText = await postRes.text().catch(() => '');
    throw new Error(`Bluesky post failed (HTTP ${postRes.status}): ${errText}`);
  }

  const postData = await postRes.json();
  const rkey = postData.uri ? postData.uri.split('/').pop() : '';
  const postedUrl = `https://bsky.app/profile/${session.handle || handle}/post/${rkey}`;

  return { postedUrl, uri: postData.uri, rkey };
}

async function publishToDevto({
  draft,
  fetchFn = globalThis.fetch,
  apiKey = process.env.DEVTO_API_KEY
}) {
  if (!apiKey) {
    throw new Error('DEVTO_API_KEY is not set in environment or bot settings');
  }

  const tags = sanitizeDevtoTags(draft.tags || ['architecture', 'tech']);
  const title = (draft.title_th || draft.title_en || 'SyaCo Enterprise Solution').trim();

  const res = await fetchFn('https://dev.to/api/articles', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      article: {
        title,
        body_markdown: draft.content_markdown || '',
        published: true,
        tags
      }
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Dev.to API failed (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  const postedUrl = data.url || (data.id ? `https://dev.to/${data.id}` : 'https://dev.to');

  return { postedUrl, id: data.id };
}

async function publishDraft({
  id,
  pool,
  fetchFn = globalThis.fetch,
  client = null,
  channelId = null,
  config = {},
  reviewedBy = null
}) {
  const draftId = parseInt(id, 10);
  if (isNaN(draftId)) {
    return { success: false, code: 'INVALID_ID', message: 'ID ไม่ถูกต้อง' };
  }

  // 1. Atomic Lock
  let lockRes;
  try {
    lockRes = await pool.query(
      `UPDATE content_drafts
       SET status = 'publishing', reviewed_at = NOW(), reviewed_by = COALESCE($2, reviewed_by), error_message = NULL
       WHERE id = $1 AND status IN ('pending_review', 'failed')
       RETURNING *;`,
      [draftId, reviewedBy]
    );
  } catch (dbErr) {
    return { success: false, code: 'DB_ERROR', message: `Database error: ${dbErr.message}` };
  }

  if (!lockRes.rows || lockRes.rows.length === 0) {
    const checkRes = await pool.query(
      'SELECT id, status, posted_url, platform FROM content_drafts WHERE id = $1;',
      [draftId]
    ).catch(() => ({ rows: [] }));

    if (checkRes.rows.length === 0) {
      return { success: false, code: 'NOT_FOUND', message: `ไม่พบข้อมูล Draft ID: #${draftId}` };
    }
    const current = checkRes.rows[0];
    return {
      success: false,
      code: 'ALREADY_PROCESSED',
      message: `Draft นี้มีสถานะเป็น '${current.status}' แล้ว (URL: ${current.posted_url || '-'})`,
      platform: current.platform,
      postedUrl: current.posted_url
    };
  }

  const draft = lockRes.rows[0];
  const platform = String(draft.platform || '').toLowerCase();

  try {
    let result = null;

    if (platform === 'bluesky') {
      result = await publishToBluesky({ draft, fetchFn, ...config.bluesky });
    } else if (platform === 'devto') {
      result = await publishToDevto({ draft, fetchFn, ...config.devto });
    } else if (platform === 'manual_article' || platform === 'manual') {
      // Manual Ready
      if (client && channelId) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel) {
            const cut = (str, len) => (String(str || '').length > len ? str.slice(0, len - 3) + '...' : str || '-');
            await channel.send({
              content: `📝 **MANUAL ARTICLE READY**\n━━━━━━━━━━━━━━━━━━━━━━━\n📌 **ชื่อบทความ:** ${draft.title_th}\n🏷️ **แท็ก:** ${(draft.tags || []).join(', ')}\n\n\`\`\`markdown\n${cut(draft.content_markdown, 1800)}\n\`\`\`\n━━━━━━━━━━━━━━━━━━━━━━━\n👉 สามารถคัดลอกไปเผยแพร่ตามแพลตฟอร์มต่างๆ ได้ทันที`
            });
          }
        } catch (discordErr) {
          console.warn('[Flow2Publisher] Discord announcement warning:', discordErr.message);
        }
      }

      await pool.query(
        "UPDATE content_drafts SET status = 'ready_to_post', posted_at = NOW(), reviewed_at = NOW(), reviewed_by = COALESCE($2, reviewed_by), error_message = NULL WHERE id = $1",
        [draft.id, reviewedBy]
      );

      return {
        success: true,
        platform: draft.platform,
        status: 'ready_to_post',
        message: 'บทความถูกบันทึกพร้อมนำไปเผยแพร่แล้ว'
      };
    } else {
      throw new Error(`Unsupported platform: '${platform}'`);
    }

    // Update DB to posted
    await pool.query(
      `UPDATE content_drafts
       SET status = 'posted', posted_url = $1, posted_at = NOW(), reviewed_at = NOW(), reviewed_by = COALESCE($3, reviewed_by), error_message = NULL
       WHERE id = $2;`,
      [result.postedUrl, draft.id, reviewedBy]
    );

    return {
      success: true,
      platform: draft.platform,
      postedUrl: result.postedUrl,
      draftId: draft.id
    };
  } catch (publishErr) {
    const errMsg = publishErr.message || 'Publishing error';
    await pool.query(
      "UPDATE content_drafts SET status = 'failed', error_message = $1 WHERE id = $2",
      [errMsg, draft.id]
    ).catch(() => {});

    return {
      success: false,
      code: 'PUBLISH_FAILED',
      platform: draft.platform,
      error: errMsg,
      message: errMsg
    };
  }
}

async function rejectDraft({ id, pool, reviewedBy = null }) {
  const draftId = parseInt(id, 10);
  if (isNaN(draftId)) {
    return { success: false, code: 'INVALID_ID', message: 'ID ไม่ถูกต้อง' };
  }

  await pool.query(
    "UPDATE content_drafts SET status = 'rejected', reviewed_at = NOW(), reviewed_by = COALESCE($2, reviewed_by) WHERE id = $1",
    [draftId, reviewedBy]
  );

  return { success: true, id: draftId };
}

module.exports = {
  sanitizeDevtoTags,
  computeBlueskyFacet,
  publishToBluesky,
  publishToDevto,
  publishDraft,
  rejectDraft
};
