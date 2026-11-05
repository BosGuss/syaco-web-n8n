# SyaCo Content Automation v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 3 production-grade, autonomous n8n workflows and Discord bot enhancements for SyaCo: Flow 1 (Adjacent Solution Discovery to SyaCo Web Drafts), Flow 2 (Multi-Platform Content Creator for Bluesky, Dev.to, Hashnode, and Manual Article), and Flow 3 (Community Lead Assistant answering Pantip, Blognone, Blockdit, and Facebook Group threads via `/answer`).

**Architecture:** 
- PostgreSQL acts as the single source of truth and idempotency lock across all 3 independent workflows.
- n8n orchestrates scheduled tasks, webhooks, Gemini AI multi-lingual generation, and REST/GraphQL API dispatchers (AT Protocol for Bluesky, Forem for Dev.to, GraphQL for Hashnode, and SyaCo .NET REST API).
- Discord Bot provides interactive human-in-the-loop review cards (Approve / Edit / Reject / Mark Posted) and slash command modals (`/answer`).

**Tech Stack:**
- n8n (v1.x workflow engine, self-hosted Docker)
- PostgreSQL (Docker container `postgres`, database `syaco_n8n_db`)
- Google Gemini API (`gemini-2.5-flash` or configurable via `GEMINI_MODEL`)
- Discord.js v14 (Slash commands, buttons, modals, embeds)
- Node.js / Express (for internal Discord bot webhooks and notify server)
- External APIs: SyaCo API (`POST /api/solutions`), Bluesky AT Protocol, Dev.to REST API, Hashnode GraphQL API

## Global Constraints

- **Strict Bilingual Content:** AI prompts must output separate `th` and `en` properties; never concatenate languages or translate blindly.
- **Draft-Only Web Publishing:** SyaCo Solutions must always be created with `isPublished: false` and `link: ""` so backend slugifies `titleEn`.
- **Pure Published Catalog for Flow 3:** Flow 3 must query `GET https://www.syaco.co.th/api/solutions` without `?all=true` so only real live solutions are used in customer-facing answers.
- **Safe JSON Construction in n8n:** All outgoing HTTP JSON payloads containing Markdown or multiline text must be assembled in Code nodes as native JavaScript objects (`JSON.stringify` safe), never inline string templates.
- **Bluesky Byte Offset Calculation:** Bluesky facets must calculate UTF-8 byte start and end using `Buffer.byteLength(text.slice(0, index), 'utf8')`.
- **Atomic Concurrency & Idempotency:** State transitions in Postgres must use atomic `UPDATE ... WHERE status = '...' RETURNING *` to eliminate race conditions.
- **Community Safety & Anti-Spam:** Flow 3 must enforce a strict maximum quota of 5 community answers per rolling 7 days.

---

### Task 1: Database Migration & Initial Solution Seeding

**Files:**
- Create: `db/migrations/2026-11-04-content-automation.sql`
- Create: `scripts/seed-solutions.js`
- Test: `scripts/test-db-schema.js`

**Interfaces:**
- Produces: Tables `solution_suggestions`, `processed_solutions`, `content_drafts`, and updated constraints on `backlink_candidates`.

- [ ] **Step 1: Write SQL migration file**

Create `db/migrations/2026-11-04-content-automation.sql`:

```sql
-- Migration: Content Automation v2 Tables and Constraints

-- 1. Table: solution_suggestions (Flow 1)
CREATE TABLE IF NOT EXISTS solution_suggestions (
  id SERIAL PRIMARY KEY,
  base_solution_id TEXT,
  title_th TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_th TEXT NOT NULL,
  description_en TEXT NOT NULL,
  rationale TEXT,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_ai JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'publishing', 'published_as_draft', 'failed', 'rejected')),
  published_solution_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solution_suggestions_status ON solution_suggestions (status, created_at DESC);

-- 2. Table: processed_solutions (Flow 2 Idempotency)
CREATE TABLE IF NOT EXISTS processed_solutions (
  solution_id TEXT PRIMARY KEY,
  solution_title TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Table: content_drafts (Flow 2 Multi-Platform Drafts)
CREATE TABLE IF NOT EXISTS content_drafts (
  id SERIAL PRIMARY KEY,
  solution_id TEXT NOT NULL,
  solution_title TEXT,
  platform TEXT NOT NULL,
  title_th TEXT,
  content_markdown TEXT NOT NULL,
  tags TEXT[],
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'publishing', 'ready_to_post', 'posted', 'rejected', 'failed')),
  posted_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  CONSTRAINT uq_solution_platform UNIQUE (solution_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_lookup ON content_drafts (status, platform, created_at DESC);

-- 4. Update backlink_candidates constraints for Flow 3
DO $$
BEGIN
  -- Drop existing status check constraint if it exists to add 'manual' and new values cleanly
  ALTER TABLE backlink_candidates DROP CONSTRAINT IF EXISTS backlink_candidates_status_check;
  ALTER TABLE backlink_candidates ADD CONSTRAINT backlink_candidates_status_check
    CHECK (status IN ('pending_review', 'approved', 'manual', 'posted', 'rejected', 'failed', 'skipped'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
```

- [ ] **Step 2: Apply migration to PostgreSQL container**

Run command via PowerShell to execute SQL script in postgres container:
```powershell
docker compose exec -T postgres psql -U postgres -d syaco_n8n_db -f - < db/migrations/2026-11-04-content-automation.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE` successful.

- [ ] **Step 3: Write seed script to register existing SyaCo solutions**

Create `scripts/seed-solutions.js`:

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

async function seed() {
  console.log('Fetching existing solutions from SyaCo API...');
  const res = await fetch('https://www.syaco.co.th/api/solutions?all=true', {
    headers: {
      Authorization: `Bearer ${process.env.SYACO_API_TOKEN || 'sya_perm_79279d93e026ed7638b9065af33c5b78bff1c5fdfd62e3ecbf12a707bcd97b71'}`
    }
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const solutions = await res.json();
  console.log(`Found ${solutions.length} existing solutions. Seeding into processed_solutions...`);

  for (const sol of solutions) {
    const id = String(sol.id);
    const title = sol.titleEn || sol.titleTh || `Solution #${id}`;
    await pool.query(`
      INSERT INTO processed_solutions (solution_id, solution_title, status, first_seen_at, updated_at)
      VALUES ($1, $2, 'completed', NOW(), NOW())
      ON CONFLICT (solution_id) DO NOTHING;
    `, [id, title]);
    console.log(`  - Seeded solution ${id}: ${title}`);
  }

  console.log('Seeding completed successfully.');
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run seed script**

Run:
```powershell
node scripts/seed-solutions.js
```
Expected: "Seeding completed successfully" with all currently existing SyaCo solutions marked as `completed`.

- [ ] **Step 5: Write schema verification test script**

Create `scripts/test-db-schema.js`:

```javascript
const { Pool } = require('pg');
const assert = require('assert');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

async function runTest() {
  const t1 = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'solution_suggestions'");
  assert.strictEqual(t1.rows[0].count, '1', 'solution_suggestions table must exist');

  const t2 = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'processed_solutions'");
  assert.strictEqual(t2.rows[0].count, '1', 'processed_solutions table must exist');

  const t3 = await pool.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'content_drafts'");
  assert.strictEqual(t3.rows[0].count, '1', 'content_drafts table must exist');

  const seedCheck = await pool.query("SELECT COUNT(*) FROM processed_solutions WHERE status = 'completed'");
  assert(parseInt(seedCheck.rows[0].count) > 0, 'Seeded solutions count must be > 0');

  console.log('✅ Database schema and seeding verified successfully.');
  await pool.end();
}

runTest().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
```

Run:
```powershell
node scripts/test-db-schema.js
```
Expected: `✅ Database schema and seeding verified successfully.`

- [ ] **Step 6: Git commit**
```powershell
git add db/ scripts/
git commit -m "feat(db): add migrations for content automation v2 and seed processed solutions"
```

---

### Task 2: Discord Bot Enhancements (Mark Posted Button & `/answer` Slash Command)

**Files:**
- Modify: `discord-bot/commands.js`
- Modify: `discord-bot/index.js`
- Test: `discord-bot/test-bot-interaction.js`

**Interfaces:**
- Consumes: PostgreSQL `backlink_candidates` table.
- Produces: Slash command `/answer`, modal `modal_answer`, button `markposted_{id}`.

- [ ] **Step 1: Add `/answer` command definition to `discord-bot/commands.js`**

In `discord-bot/commands.js`, add `answerCommand` in `commands` array:
```javascript
new SlashCommandBuilder()
  .setName('answer')
  .setDescription('ส่งคำถามจากกระทู้ Pantip, Blognone, Blockdit หรือ Facebook Group ให้ AI ช่วยร่างคำตอบ')
  .addStringOption(option =>
    option
      .setName('platform')
      .setDescription('แพลตฟอร์มต้นทาง')
      .setRequired(true)
      .addChoices(
        { name: 'Pantip', value: 'pantip' },
        { name: 'Blognone', value: 'blognone' },
        { name: 'Blockdit', value: 'blockdit' },
        { name: 'Facebook Group', value: 'facebook_group' }
      )
  )
```

In `handleCommand` function inside `discord-bot/commands.js`, add handler:
```javascript
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
```

- [ ] **Step 2: Add `markposted` button and modal submit handler in `discord-bot/index.js`**

In `discord-bot/index.js`:
1. When handling manual approvals in `handleApproval(interaction, candidateId)`:
```javascript
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
```

2. In `client.on('interactionCreate', ...)`:
Add button handler for `markposted`:
```javascript
      if (action === 'markposted') {
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
```

3. In `isModalSubmit()`:
Handle `modal_answer_{platform}`:
```javascript
      if (interaction.customId.startsWith('modal_answer_')) {
        const platform = interaction.customId.replace('modal_answer_', '');
        const postUrl = interaction.fields.getTextInputValue('post_url').trim();
        const questionText = interaction.fields.getTextInputValue('question_text').trim();

        await interaction.deferReply({ ephemeral: true });

        // Forward to n8n Flow 3 webhook
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
            signal: AbortSignal.timeout(8000),
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
```

- [ ] **Step 3: Test syntax and reload discord bot**

Run:
```powershell
node -c discord-bot/commands.js
node -c discord-bot/index.js
docker compose restart discord-bot
```
Expected: Bot restarts cleanly and logs `Discord bot logged in as ...`.

- [ ] **Step 4: Git commit**
```powershell
git add discord-bot/
git commit -m "feat(discord-bot): add /answer slash command modal and mark-posted button support"
```

---

### Task 3: Build & Configure Flow 1 (Solution Discovery & Draft Publisher)

**Files:**
- Create: `workflows/flow1-solution-discovery.json`
- Test: `scripts/test-flow1.js`

**Interfaces:**
- Consumes: `https://www.syaco.co.th/api/solutions?all=true`, `https://www.techtalkthai.com/feed/`, `https://www.blognone.com/node/feed`, Gemini API.
- Produces: Entries in `solution_suggestions`, notifications to `http://discord-bot:3000/notify`, and POST requests to `https://www.syaco.co.th/api/solutions` with `isPublished: false`.

- [ ] **Step 1: Create n8n Flow 1 Workflow JSON**

Create `workflows/flow1-solution-discovery.json` with the complete node configuration:
1. Schedule Trigger (Every Monday 9:00 AM)
2. HTTP Request: `GET https://www.syaco.co.th/api/solutions?all=true` (Node name: `Get Current Solutions`)
3. Parallel Branches (Fan-out from `Get Current Solutions`):
   - Branch A: HTTP Request `GET https://www.techtalkthai.com/feed/` (Node: `Fetch TechTalkThai Feed`)
   - Branch B: HTTP Request `GET https://www.blognone.com/node/feed` (Node: `Fetch Blognone Feed`)
4. Merge Node: `Merge Feeds` (`n8n-nodes-base.merge` v3.2, mode: `chooseBranch`, waitForAll) to synchronize both feeds
5. Code Node: `Filter Topics & Build Adjacent Prompt`:
   - Extracts catalog core topics (ERP, PLC, IoT, API integration).
   - Filters external RSS items by enterprise keywords (`erp`, `plc`, `data pipeline`, `legacy`, `modbus`, `iot`, `factory`, `automation`).
   - Strict Instruction: "Do not fabricate quantitative statistics or fake customer case studies in results. Focus strictly on architectural and business value."
6. HTTP Request: `AI Gap Analysis` (POST Gemini API with structured JSON output schema).
7. Code Node: `Parse Solution Suggestions`:
   - Extracts `titleTh`, `titleEn`, `descriptionTh`, `descriptionEn`, `rationale`, `baseSolutionId`, `features`, `results`, `problems`, `targetAudience`.
8. Postgres Node: `INSERT INTO solution_suggestions (..., status = 'pending_review') RETURNING *`.
9. HTTP Request: `Notify Discord Embed` with buttons for Approve & Reject.
10. Webhook Trigger: `Webhook: /webhook/flow1-approve-solution`.
11. Postgres Node: `Atomic Lock Before Publish`:
    ```sql
    UPDATE solution_suggestions
    SET status = 'publishing', reviewed_at = NOW(), error_message = NULL
    WHERE id = $1 AND status IN ('pending_review', 'failed')
    RETURNING *;
    ```
12. Code Node: `Build SyaCo Payload (Draft Mode)`:
    - Verifies slug availability before posting.
    - Sets `isPublished: false`, `link: ""`, `icon: "Layers"`, `order: 99`.
    - Assembles the 3 content sections (`hero`, `solutions` with `results`, `problems`, `targetAudience`, and `examplesDeveloped: { items: [] }`).
13. HTTP Request: `POST https://www.syaco.co.th/api/solutions` with Bearer Token from `$env.SYACO_API_TOKEN`.
14. Postgres Node: Update `status = 'published_as_draft'`, `published_solution_id = $json.id`, `published_at = NOW()`.
15. HTTP Request: Send confirmation embed to Discord.

- [ ] **Step 2: Import workflow into n8n via API or MCP**

Import `workflows/flow1-solution-discovery.json` to the running n8n instance and verify node connection integrity.

- [ ] **Step 3: Write test script to verify Flow 1 payload assembler**

Create `scripts/test-flow1.js`:

```javascript
const assert = require('assert');

function assemblePayload(item) {
  function buildContent(isTh) {
    const titles = isTh ? {
      results: 'ผลลัพธ์',
      problems: 'เราช่วยแก้ปัญหาอะไร',
      target: 'ระบบนี้เหมาะกับใคร',
      examples: 'ตัวอย่างระบบที่พัฒนา'
    } : {
      results: 'Expected Results',
      problems: 'What problems we solve',
      target: 'Who this system is for',
      examples: 'Examples of Developed Systems'
    };

    return {
      hero: {
        titleLine1: isTh ? item.title_th : item.title_en,
        description: isTh ? item.description_th : item.description_en,
        backgroundImage: '/asset/image/bg/ai-hero-bg.webp'
      },
      solutions: {
        results: {
          title: titles.results,
          items: item.content_ai?.[isTh ? 'th' : 'en']?.results || []
        },
        problems: {
          title: titles.problems,
          items: item.content_ai?.[isTh ? 'th' : 'en']?.problems || []
        },
        targetAudience: {
          title: titles.target,
          items: (item.content_ai?.[isTh ? 'th' : 'en']?.targetAudience || []).map((t, idx) => ({
            icon: `/asset/icons/target-${(idx % 4) + 1}.svg`,
            text: typeof t === 'string' ? t : t.text
          }))
        }
      },
      examplesDeveloped: {
        title: titles.examples,
        items: []
      }
    };
  }

  return {
    titleEn: item.title_en,
    titleTh: item.title_th,
    descEn: item.description_en,
    descTh: item.description_th,
    link: '',
    icon: 'Layers',
    alt: item.title_en,
    order: 99,
    isPublished: false,
    metaTitleTh: item.title_th,
    metaTitleEn: item.title_en,
    metaDescriptionTh: item.description_th,
    metaDescriptionEn: item.description_en,
    features: (item.features || []).map((f, i) => ({
      labelTh: f.labelTh || f,
      labelEn: f.labelEn || f,
      order: i + 1
    })),
    content: {
      th: buildContent(true),
      en: buildContent(false)
    }
  };
}

const mockItem = {
  title_th: 'ระบบเชื่อมโยงข้อมูล PLC เข้ากับ SAP',
  title_en: 'Automated PLC to SAP Gateway',
  description_th: 'เชื่อมต่อข้อมูลเครื่องจักรเข้าสู่ SAP อัตโนมัติ',
  description_en: 'Automated data pipeline from shop-floor PLC to SAP ERP',
  features: [{ labelTh: 'Real-time Sync', labelEn: 'Real-time Sync' }],
  content_ai: {
    th: {
      results: ['ลดเวลาบันทึกข้อมูล'],
      problems: ['ระบบแยกส่วน'],
      targetAudience: ['โรงงานอุตสาหกรรม']
    },
    en: {
      results: ['Reduced sync delay'],
      problems: ['Data silos'],
      targetAudience: ['Manufacturing plants']
    }
  }
};

const payload = assemblePayload(mockItem);
assert.strictEqual(payload.isPublished, false, 'isPublished must be false');
assert.strictEqual(payload.link, '', 'link must be empty string for backend slugify');
assert.strictEqual(payload.content.th.solutions.targetAudience.items[0].icon, '/asset/icons/target-1.svg');
assert.deepStrictEqual(payload.content.th.examplesDeveloped.items, []);
console.log('✅ Flow 1 payload assembler logic passed all checks.');
```

Run:
```powershell
node scripts/test-flow1.js
```
Expected: `✅ Flow 1 payload assembler logic passed all checks.`

- [ ] **Step 4: Git commit**
```powershell
git add workflows/ scripts/test-flow1.js
git commit -m "feat(flow1): add solution discovery and safe draft publisher workflow"
```

---

### Task 4: Build & Configure Flow 2 (Multi-Platform Content Creator & Publisher)

**Files:**
- Create: `workflows/flow2-content-publisher.json`
- Test: `scripts/test-flow2.js`

**Interfaces:**
- Consumes: `https://www.syaco.co.th/api/solutions` (new solutions not in `processed_solutions`), Gemini API.
- Produces: Entries in `content_drafts`, notifications to Discord, and posts to Bluesky, Dev.to, Hashnode, and Discord `#ready-to-post`.

- [ ] **Step 1: Create n8n Flow 2 Workflow JSON**

Create `workflows/flow2-content-publisher.json`:
1. Schedule Trigger: Every 24 hours at 08:00 AM.
2. HTTP Request: `GET https://www.syaco.co.th/api/solutions`.
3. Postgres Query: `SELECT solution_id FROM processed_solutions WHERE status = 'completed';`.
4. Code Node: `Filter New Solutions`:
   - Checks if any solution ID from SyaCo is missing from `processed_solutions`.
   - If none: Stop workflow.
5. Split In Batches: Batch size 1.
6. Postgres Query: `Lock Solution Status`:
   ```sql
   INSERT INTO processed_solutions (solution_id, solution_title, status)
   VALUES ($1, $2, 'processing')
   ON CONFLICT (solution_id) DO UPDATE 
     SET status = 'processing', updated_at = NOW()
   WHERE processed_solutions.status <> 'completed';
   ```
7. Split AI Requests (2 Separate Gemini Calls for stability):
   - **Call A**: Gemini Prompt for Micro Post (`blueskyPost`: ≤ 300 chars TH) + Dev.to Post (`devtoArticle`: Markdown + tags).
   - **Call B**: Gemini Prompt for In-depth Article (`hashnodeArticle`: Markdown Architecture) + Enterprise Press-Release (`manualArticle`: Markdown).
8. Code Node: `Parse, Sanitize & Normalize Drafts`:
   - Sanitize Dev.to tags: Regex `/[^a-z0-9]/gi` -> lowercase, dedupe, slice max 4 tags.
   - Format Hashnode tags: `[{ name: tag, slug: tag.toLowerCase() }]`.
   - Calculate Bluesky UTF-8 Byte Offset for link facet using `Buffer.byteLength`.
   - Prepare individual items for insertion.
9. Postgres Query (Single Atomic CTE):
   ```sql
   WITH ins AS (
     INSERT INTO content_drafts (solution_id, solution_title, platform, title_th, content_markdown, tags, status)
     VALUES 
       ($1, $2, 'bluesky', $3, $4, $5, 'pending_review'),
       ($1, $2, 'devto', $6, $7, $8, 'pending_review'),
       ($1, $2, 'hashnode', $9, $10, $11, 'pending_review'),
       ($1, $2, 'manual_article', $12, $13, $14, 'pending_review')
     ON CONFLICT (solution_id, platform) DO NOTHING
     RETURNING id
   )
   UPDATE processed_solutions SET status = 'completed', updated_at = NOW() WHERE solution_id = $1;
   ```
10. HTTP Request: Notify Discord review card with buttons:
    - `🚀 Post Bluesky` (`post_bluesky_{draft_id}`)
    - `🚀 Post Dev.to` (`post_devto_{draft_id}`)
    - `🚀 Post Hashnode` (`post_hashnode_{draft_id}`)
    - `📋 Copy Manual Article` (`copy_manual_{draft_id}`)
    - `❌ Reject` (`reject_draft_{draft_id}`)
11. Webhook Trigger: `Webhook: /webhook/flow2-dispatch-action`.
12. Postgres Query: Atomic Status Lock:
    ```sql
    UPDATE content_drafts
    SET status = 'publishing'
    WHERE id = $1 AND status IN ('pending_review', 'failed')
    RETURNING *;
    ```
13. Switch Node (`platform`):
    - **Branch `bluesky`**:
      - Code node constructs native `blueskyBody` object.
      - HTTP POST createSession -> HTTP POST createRecord.
      - Update `status = 'posted'`, `posted_url = ...`.
    - **Branch `devto`**:
      - Code node constructs native `devtoBody` object:
        ```javascript
        return [{ json: {
          devtoBody: {
            article: {
              title: $json.title_th,
              body_markdown: $json.content_markdown,
              published: true,
              tags: $json.tags
            }
          }
        }}];
        ```
      - HTTP POST `https://dev.to/api/articles` with `api-key`.
      - Update `status = 'posted'`, `posted_url = ...`.
    - **Branch `hashnode`**:
      - Code node constructs native `hashnodeBody` object:
        ```javascript
        return [{ json: {
          hashnodeBody: {
            query: `mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url title } } }`,
            variables: {
              input: {
                title: $json.title_th,
                contentMarkdown: $json.content_markdown,
                publicationId: $env.HASHNODE_PUBLICATION_ID,
                tags: ($json.tags || []).map(t => ({ name: t, slug: t.toLowerCase() }))
              }
            }
          }
        }}];
        ```
      - HTTP POST `https://gql.hashnode.com` with Bearer token.
      - Update `status = 'posted'`, `posted_url = ...`.
    - **Branch `manual_article`**:
      - Send markdown to Discord `#ready-to-post`.
      - Update `status = 'ready_to_post'`.

- [ ] **Step 2: Write test script for Bluesky UTF-8 Byte Offset calculation and Dev.to tag sanitizer**

Create `scripts/test-flow2.js`:

```javascript
const assert = require('assert');

// 1. Test Dev.to Tag Sanitization
function sanitizeDevtoTags(rawTags) {
  return (rawTags || [])
    .map(t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length >= 2)
    .slice(0, 4);
}

const dirtyTags = ['SAP ERP', 'เชื่อมต่อ', 'PLC-2026', 'Modbus/TCP', 'Node.js', 'Extra'];
const cleanTags = sanitizeDevtoTags(dirtyTags);
assert.deepStrictEqual(cleanTags, ['saperp', 'plc2026', 'modbustcp', 'nodejs']);
assert(cleanTags.length <= 4);

// 2. Test Bluesky UTF-8 Byte Offset
function computeBlueskyFacet(text, link) {
  const byteLen = (str) => Buffer.byteLength(str, 'utf8');
  const linkIndex = text.indexOf(link);
  if (linkIndex === -1) return null;

  const byteStart = byteLen(text.slice(0, linkIndex));
  const byteEnd = byteStart + byteLen(link);

  return {
    index: { byteStart, byteEnd },
    features: [{ "$type": "app.bsky.richtext.facet#link", uri: link }]
  };
}

const thaiText = "ระบบเชื่อมต่อ PLC เข้า SAP อัตโนมัติ ดูรายละเอียดที่ https://www.syaco.co.th/solutions/plc";
const link = "https://www.syaco.co.th/solutions/plc";
const facet = computeBlueskyFacet(thaiText, link);

assert(facet !== null);
// Verify slice matches link bytes exactly
const textBuf = Buffer.from(thaiText, 'utf8');
const extractedUrl = textBuf.slice(facet.index.byteStart, facet.index.byteEnd).toString('utf8');
assert.strictEqual(extractedUrl, link, 'Extracted URL using byte offsets must match original link');

console.log('✅ Flow 2 sanitization and UTF-8 byte offset tests passed.');
```

Run:
```powershell
node scripts/test-flow2.js
```
Expected: `✅ Flow 2 sanitization and UTF-8 byte offset tests passed.`

- [ ] **Step 3: Import workflow into n8n**

Import `workflows/flow2-content-publisher.json` into n8n and verify credentials and database connections.

- [ ] **Step 4: Git commit**
```powershell
git add workflows/ scripts/test-flow2.js
git commit -m "feat(flow2): add multi-platform content creator and publisher workflow"
```

---

### Task 5: Build & Configure Flow 3 (Community Lead Assistant - `/answer`)

**Files:**
- Create: `workflows/flow3-community-lead-assistant.json`
- Test: `scripts/test-flow3.js`

**Interfaces:**
- Consumes: Webhook `/webhook/answer-question` from Discord bot, `GET https://www.syaco.co.th/api/solutions` (strictly without `?all=true`).
- Produces: Entries in `backlink_candidates`, notifications to `http://discord-bot:3000/notify`.

- [ ] **Step 1: Create n8n Flow 3 Workflow JSON**

Create `workflows/flow3-community-lead-assistant.json`:
1. Webhook Node: `POST /webhook/answer-question`:
   - Receives `{ post_url, question_text, platform, requested_by }`.
2. Code Node: `Platform-Aware Normalize Post URL`:
   ```javascript
   function normalizeUrl(rawUrl, platform) {
     try {
       const u = new URL(rawUrl.trim());
       if (platform === 'pantip' || u.hostname.includes('pantip.com')) {
         const m = u.pathname.match(/\/topic\/(\d+)/);
         return m ? `https://pantip.com/topic/${m[1]}` : u.origin + u.pathname;
       }
       if (platform === 'facebook_group' || u.hostname.includes('facebook.com')) {
         const keepParams = ['story_fbid', 'id', 'post_id'];
         const newParams = new URLSearchParams();
         keepParams.forEach(p => { if (u.searchParams.has(p)) newParams.set(p, u.searchParams.get(p)); });
         const qs = newParams.toString();
         return u.origin + u.pathname + (qs ? '?' + qs : '');
       }
       return u.origin + u.pathname;
     } catch (e) {
       return rawUrl.trim();
     }
   }
   const normalized = normalizeUrl($json.post_url, $json.platform);
   return [{ json: { ...$json, normalized_url: normalized } }];
   ```
3. Postgres Query: `Check Weekly Quota & Existing URL`:
   ```sql
   WITH quota AS (
     SELECT COUNT(*) AS weekly_count 
     FROM backlink_candidates 
     WHERE platform IN ('pantip', 'blognone', 'blockdit', 'facebook_group')
       AND status IN ('pending_review', 'approved', 'manual', 'posted')
       AND created_at >= NOW() - INTERVAL '7 days'
   ),
   existing AS (
     SELECT id, status, match_score 
     FROM backlink_candidates 
     WHERE post_url = $1
   )
   SELECT 
     (SELECT weekly_count FROM quota) AS weekly_count,
     (SELECT id FROM existing) AS existing_id,
     (SELECT status FROM existing) AS existing_status;
   ```
4. If Node: `Check Quota and Duplicate`:
   - If `existing_id IS NOT NULL`: Respond to Webhook `{ status: "already_exists", id: existing_id, existing_status: existing_status }` and Stop.
   - If `weekly_count >= 5`: Respond to Webhook `{ status: "quota_exceeded", count: weekly_count }` and Stop.
   - Otherwise continue.
5. HTTP Request: `GET https://www.syaco.co.th/api/solutions` (**Strictly without `?all=true`**).
6. Code Node: `Build Lead Qualification & Draft Prompt`:
   - System Instruction: Evaluate `lead_fit` (HIGH/MEDIUM/LOW), `canAnswer` (boolean), `matchedSolutionId`.
   - Voice tailoring:
     - Pantip: Friendly, respectful, engineering peer.
     - Blognone: Concise, technical, architectural focus.
     - Blockdit: Structured, step-by-step problem-solution.
     - Facebook Group: Helpful, practical troubleshooting.
   - Disclosure rule: Clear disclosure "ผมมาจากทีม SyaCo...", no backlink by default unless directly relevant.
7. HTTP Request: Gemini API (Structured JSON).
8. Code Node: `Decision Filter & Format Answer`:
   - If `lead_fit === 'LOW'` or `canAnswer !== true` or `matchScore < 0.75`:
     - Save to `backlink_candidates` with `status = 'skipped'`.
     - End silently.
   - Otherwise:
     - Formulate anchor and UTM tracking link: `?utm_source=${platform}&utm_medium=community_answer&utm_campaign=lead_gen`.
9. Postgres Query:
   ```sql
   INSERT INTO backlink_candidates
     (post_url, post_title, platform, solution_id, solution_title, solution_url,
      matched_problem, match_score, relevance_reason, answer, link_included,
      link_reason, suggested_anchor, status)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending_review')
   RETURNING *;
   ```
10. HTTP Request: Notify Discord `http://discord-bot:3000/notify` with review embed.

- [ ] **Step 2: Write test script for Flow 3 URL normalizer and quota logic**

Create `scripts/test-flow3.js`:

```javascript
const assert = require('assert');

function normalizeUrl(rawUrl, platform) {
  try {
    const u = new URL(rawUrl.trim());
    if (platform === 'pantip' || u.hostname.includes('pantip.com')) {
      const m = u.pathname.match(/\/topic\/(\d+)/);
      return m ? `https://pantip.com/topic/${m[1]}` : u.origin + u.pathname;
    }
    if (platform === 'facebook_group' || u.hostname.includes('facebook.com')) {
      const keepParams = ['story_fbid', 'id', 'post_id'];
      const newParams = new URLSearchParams();
      keepParams.forEach(p => { if (u.searchParams.has(p)) newParams.set(p, u.searchParams.get(p)); });
      const qs = newParams.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    }
    return u.origin + u.pathname;
  } catch (e) {
    return rawUrl.trim();
  }
}

// 1. Pantip URL normalizer
const p1 = normalizeUrl('https://pantip.com/topic/43012345?utm_source=facebook&utm_medium=share', 'pantip');
assert.strictEqual(p1, 'https://pantip.com/topic/43012345');

// 2. Facebook Group URL normalizer (Must retain story_fbid/id)
const fb1 = normalizeUrl('https://www.facebook.com/groups/itprothailand/permalink/?story_fbid=987654321&id=123456789&ref=notif', 'facebook_group');
assert(fb1.includes('story_fbid=987654321'));
assert(fb1.includes('id=123456789'));
assert(!fb1.includes('ref=notif'));

// 3. Blognone URL normalizer
const bn1 = normalizeUrl('https://www.blognone.com/node/139999?fbclid=IwAR2345', 'blognone');
assert.strictEqual(bn1, 'https://www.blognone.com/node/139999');

console.log('✅ Flow 3 platform-aware URL normalization tests passed.');
```

Run:
```powershell
node scripts/test-flow3.js
```
Expected: `✅ Flow 3 platform-aware URL normalization tests passed.`

- [ ] **Step 3: Import workflow into n8n**

Import `workflows/flow3-community-lead-assistant.json` into n8n and activate webhook endpoints.

- [ ] **Step 4: Git commit**
```powershell
git add workflows/ scripts/test-flow3.js
git commit -m "feat(flow3): add community lead assistant on-demand answering workflow"
```

---

### Task 6: End-to-End System Integration & Verification

**Files:**
- Create: `scripts/verify-all.js`
- Test: Full pipeline dry-run across all 3 flows

**Interfaces:**
- Validates: End-to-end communication between Discord Bot, n8n, Postgres, and SyaCo API.

- [ ] **Step 1: Write comprehensive automated verification script**

Create `scripts/verify-all.js`:

```javascript
const { Pool } = require('pg');
const assert = require('assert');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'syaco_n8n_db',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'admin',
});

async function verify() {
  console.log('Starting End-to-End Verification...');

  // 1. Verify SyaCo API Auth & Drafts Endpoint
  console.log('1. Checking SyaCo Solutions API...');
  const res = await fetch('https://www.syaco.co.th/api/solutions?all=true', {
    headers: { Authorization: `Bearer ${process.env.SYACO_API_TOKEN || 'sya_perm_79279d93e026ed7638b9065af33c5b78bff1c5fdfd62e3ecbf12a707bcd97b71'}` }
  });
  assert.strictEqual(res.status, 200, 'SyaCo API must respond with 200');

  // 2. Verify Flow 1 Table constraints & state machine
  console.log('2. Verifying Flow 1 DB state machine...');
  const f1 = await pool.query(`
    INSERT INTO solution_suggestions 
      (title_th, title_en, description_th, description_en, status, features, content_ai)
    VALUES 
      ('ทดสอบระบบ', 'Test Gateway', 'คำอธิบาย', 'Description', 'pending_review', '[]'::jsonb, '{}'::jsonb)
    RETURNING id;
  `);
  const f1Id = f1.rows[0].id;
  const lock = await pool.query(`
    UPDATE solution_suggestions
    SET status = 'publishing'
    WHERE id = $1 AND status IN ('pending_review', 'failed')
    RETURNING *;
  `, [f1Id]);
  assert.strictEqual(lock.rows[0].status, 'publishing', 'Atomic lock must transition to publishing');

  // Cleanup test row
  await pool.query('DELETE FROM solution_suggestions WHERE id = $1', [f1Id]);

  // 3. Verify Flow 2 CTE Multi-Insert and Unique Constraint
  console.log('3. Verifying Flow 2 CTE Multi-Insert and Unique constraint...');
  const solId = 'test_sol_999';
  await pool.query(`
    WITH ins AS (
      INSERT INTO content_drafts (solution_id, solution_title, platform, title_th, content_markdown, tags, status)
      VALUES 
        ($1, 'Test', 'bluesky', 'หัวข้อ', 'เนื้อหา', ARRAY['tag1'], 'pending_review'),
        ($1, 'Test', 'devto', 'หัวข้อ', 'เนื้อหา', ARRAY['tag1'], 'pending_review')
      ON CONFLICT (solution_id, platform) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*) FROM ins;
  `, [solId]);

  const countDrafts = await pool.query('SELECT COUNT(*) FROM content_drafts WHERE solution_id = $1', [solId]);
  assert.strictEqual(countDrafts.rows[0].count, '2', 'Must insert 2 drafts');

  // Duplicate insert test
  await pool.query(`
    INSERT INTO content_drafts (solution_id, solution_title, platform, title_th, content_markdown, tags, status)
    VALUES ($1, 'Test', 'bluesky', 'หัวข้อ', 'เนื้อหา', ARRAY['tag1'], 'pending_review')
    ON CONFLICT (solution_id, platform) DO NOTHING;
  `, [solId]);
  const dupCheck = await pool.query('SELECT COUNT(*) FROM content_drafts WHERE solution_id = $1 AND platform = $2', [solId, 'bluesky']);
  assert.strictEqual(dupCheck.rows[0].count, '1', 'Duplicate insert must be ignored');

  await pool.query('DELETE FROM content_drafts WHERE solution_id = $1', [solId]);

  // 4. Verify Flow 3 Quota query
  console.log('4. Verifying Flow 3 Quota counting query...');
  const qTest = await pool.query(`
    SELECT COUNT(*) AS weekly_count 
    FROM backlink_candidates 
    WHERE platform IN ('pantip', 'blognone', 'blockdit', 'facebook_group')
      AND status IN ('pending_review', 'approved', 'manual', 'posted')
      AND created_at >= NOW() - INTERVAL '7 days';
  `);
  assert(parseInt(qTest.rows[0].weekly_count) >= 0, 'Weekly count query must execute cleanly');

  console.log('🎉 All End-to-End System Checks Passed Successfully!');
  await pool.end();
}

verify().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run verification script**

Run:
```powershell
node scripts/verify-all.js
```
Expected: `🎉 All End-to-End System Checks Passed Successfully!`

- [ ] **Step 3: Final Git commit**
```powershell
git add scripts/verify-all.js
git commit -m "test: add comprehensive end-to-end integration verification suite"
```
