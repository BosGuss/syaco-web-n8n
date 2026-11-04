# SyaCo Content Automation v2 — 3 Workflows

3 n8n workflows สำหรับ content automation และการขยายโซลูชันของ SyaCo โดยใช้ **Auto-Post APIs (Bluesky, Dev.to, Hashnode)** และ **Manual Posting (Blognone / TechTalkThai)** เป็น target platforms

> [!NOTE]
> - **Auto-Post Platforms (มี API)**:
>   - **Bluesky (`bsky.app`)**: โพสต์ผ่าน AT Protocol REST API (สั้นกระชับ ≤ 300 ตัวอักษร)
>   - **Dev.to (`dev.to`)**: โพสต์บทความเทคนิคผ่าน Forem/Dev.to REST API (`POST https://dev.to/api/articles`) ด้วย API Key
>   - **Hashnode (`hashnode.com`)**: เผยแพร่บทความลง Publication ผ่าน Hashnode GraphQL API (`publishPost` mutation) ด้วย Personal Access Token
> - **Manual Post (Blognone / TechTalkThai / Community อื่นๆ)**: ใช้ **Human-in-the-Loop** model โดย n8n สร้าง Draft ภาษาไทยแบบจัดรูปเล่มเรียบร้อยแล้วส่งเข้า Discord ให้ทีมงานกด Copy-Paste ไปเผยแพร่ต่อด้วยมือ

---

## Architecture Overview

```
[Flow 1] Solution Discovery          (อิสระ — ทำงานทุก Monday 9:00 AM)
         ดู solution เดิม + Tech trends → AI suggest solution ใหม่สำหรับ SyaCo
         → Discord review & approve → สร้างเป็น Draft บนเว็บ syaco.co.th ผ่าน Solutions API

[Flow 2] Content Creator & Publisher (อิสระ — ทำงานทุก 24 ชม.)
         ตรวจจับ solution ใหม่บน syaco.co.th/api/solutions
         → AI สร้างเนื้อหาแยกตามแต่ละ Platform (แยก AI call เพื่อความเสถียร):
            1) Bluesky Post (สั้นกระชับ, Punchy, ≤ 300 ตัวอักษร, คำนวณ UTF-8 byte offset สำหรับ link facets)
            2) Dev.to Article (Markdown Technical Guide + Sanitize tags a-z0-9 สูงสุด 4 แท็ก + ชี้ลิงก์ในเนื้อหา ไม่ใส่ canonical_url มั่ว)
            3) Hashnode Article (Markdown Architecture + originalArticleURL ถ้ามี + tags [{ name, slug }])
            4) Long-form Article Draft (สำหรับโพสต์มือเองบน Blognone/TechTalkThai)
         → Discord Review & Approve:
            - ปุ่มยิง Auto-Post: [🚀 Bluesky] [🚀 Dev.to] [🚀 Hashnode]
            - ปุ่มคัดลอก Manual: [📋 Copy Manual Article] เข้า Discord #ready-to-post
            - ปุ่ม Reject / Edit ราย Platform

[Flow 3] Community Lead Assistant (/answer on-demand)
         ทีมส่ง `/answer` จาก Discord (วาง Link กระทู้ + คำถาม)
         → ตรวจโควตา 3–5 กระทู้/สัปดาห์ ใน DB (ป้องกันสแปม/บัญชีถูกแบน)
         → Platform-aware URL normalization (เช่น Pantip เก็บ /topic/ID, Facebook เก็บ story_fbid/id)
         → ดึง SyaCo Solutions (เฉพาะ published: GET /api/solutions ไม่มี ?all=true)
         → คัดกรอง Lead Fit ระดับ Enterprise & Can-Answer
         → AI ร่างคำตอบเฉพาะเจาะจง (Pantip, Blognone, Blockdit, Facebook Group)
         → บันทึกลงตารางเดิม `backlink_candidates` (Idempotent by post_url)
         → ส่ง Card เข้า Discord พร้อมปุ่ม Approve / Edit / Reject และปุ่ม Mark Posted (สำหรับ Manual)
```

> [!NOTE]
> Flow 1 และ Flow 2 **ทำงานเป็นอิสระต่อกันโดยสมบูรณ์**:
> - Flow 1 มีหน้าที่วิเคราะห์ Gap และสร้าง Solution ใหม่ขึ้นบนระบบของ SyaCo เท่านั้น
> - Flow 2 เป็นตัวตรวจจับ Solution ที่เกิดขึ้นใหม่บนเว็บ `syaco.co.th` (ไม่ว่าจะมาจาก Flow 1 หรือทีมงานสร้างเอง) แล้วนำมาแตกเป็น Content Drafts ต่อไป

---

## Flow 1 — Solution Discovery (Weekly AI Gap Analysis)

**Trigger:** Schedule — ทุก Monday 9:00 AM  
**Goal:** วิเคราะห์ solution เดิมบน syaco.co.th + เทรนด์ Enterprise B2B จาก TechTalkThai & Blognone → AI ออกแบบ Adjacent Solution ใหม่ของ SyaCo (Bilingual TH/EN) → ทีมอนุมัติผ่าน Discord UI → เผยแพร่ขึ้น syaco.co.th ในสถานะ Draft เพื่อความปลอดภัย

### Nodes:
1. **Schedule Trigger** — ทุก Monday 9:00 AM
2. **Get Current Solutions** — HTTP GET `syaco.co.th/api/solutions`
3. **Format Solutions Catalog** — Code node: รวบรวมหมวดหมู่และความเชี่ยวชาญหลัก (ERP, IoT, Data Pipelines, Web Platform)
4. **Fetch External Feeds (Parallel):**
   - **TechTalkThai RSS** — HTTP GET `https://www.techtalkthai.com/feed/` (Enterprise & B2B IT trends)
   - **Blognone RSS** — HTTP GET `https://www.blognone.com/feed` (Dev & Local Tech discussions)
5. **Filter by Keywords & Extract Topics** — Code node:
   - กรองเฉพาะหัวข้อที่ตรงกับ Enterprise/Data/Cloud/IoT keywords (เช่น `erp`, `data pipeline`, `legacy`, `modbus`, `iot`, `factory`, `automation`)
6. **Build Adjacent Solution Prompt** — Code node:
   - ใช้แนวคิด **Adjacent Solution Strategy** (ต่อยอดจาก Solution เดิม 1 ก้าว)
   - สั่งให้ Gemini สร้าง "เนื้อหาข้อความ" 2 ภาษา (TH + EN) ให้ครบตาม 3 ส่วนของหน้าเว็บ:
     1. `hero`: description
     2. `solutions`:
        - `results`: 2-4 ผลลัพธ์เชิงคุณค่าที่คาดหวัง (ข้อความอธิบายประโยชน์เชิงระบบ เช่น "ลดเวลาการบันทึกข้อมูลและข้อผิดพลาดระหว่างแผนก", **ห้าม AI สมมติตัวเลขเปอร์เซ็นต์สถิติที่ไม่มีอยู่จริง**)
        - `problems`: 3-5 ปัญหาจริงที่ระบบเข้าไปแก้
        - `targetAudience`: 3-4 กลุ่มเป้าหมาย
     3. `features`: 2-4 จุดเด่นสำคัญ (labelTh / labelEn)
   - ส่วนโค้ดประกอบโครงสร้าง, Asset path icons (`/asset/icons/target-*.svg`), และ `examplesDeveloped.items: []` จะให้ Code node ประกอบให้อัตโนมัติ เพื่อไม่ให้ AI ต้องจำ path และลดความผิดพลาด
7. **AI Gap & Solution Analysis** — HTTP POST Gemini API (Structured JSON)
8. **Parse Solution Suggestions** — Code node: ดึงข้อมูลครบทุกฟิลด์ (titleTh, titleEn, descTh, descEn, rationale, targetAudience, results, problems, features, baseSolutionId)
9. **Save to Postgres** — INSERT `solution_suggestions` พร้อมบันทึกคอลัมน์ `features` (JSONB) และ `content_ai` (JSONB) เพื่อเก็บ problems, results, targetAudience ทั้ง 2 ภาษาครบถ้วน (`status = 'pending_review'`)
10. **Build Structured Discord Embed** — Code node:
    - ออกแบบ UI พร้อมข้อมูลเปรียบเทียบ: โซลูชันเดิม vs โซลูชันใหม่ที่เสนอ, กลุ่มเป้าหมาย, และเหตุผลทางธุรกิจ
    - ปุ่ม Interactive: `✅ อนุมัติและสร้าง Draft บนเว็บ`, `❌ ปฏิเสธ`, `🔄 ขอไอเดียใหม่`
11. **Notify Discord** — HTTP POST → `discord-bot:3000/notify`
12. **Webhook: Approve Solution** — Discord bot POST กลับพร้อม `{ suggestion_id, action: 'approve' }`
13. **Atomic Lock Before Publish** — Postgres (Atomic Update):
    ```sql
    UPDATE solution_suggestions
    SET status = 'publishing', reviewed_at = NOW(), error_message = NULL
    WHERE id = $1 AND status IN ('pending_review', 'failed')
    RETURNING *;
    ```
    - หากไม่มีแถวถูกคืนค่า (Rows = 0 แสดงว่ากำลัง publishing หรือ published ไปแล้ว) → จบการทำงานทันที ป้องกัน Double Click หรือ Race condition
14. **Pre-check SyaCo Slug & Build Payload (Draft Mode)** — Code node:
    - ดึงข้อมูลจากแถวที่ถูกล็อคสำเร็จ (`features` และ `content_ai` JSONB)
    - **ป้องกัน Retry ซ้ำซ้อนตอนเน็ตเวิร์ก timeout**: ตรวจสอบก่อนว่า slug `/solutions/{slug}` มีอยู่แล้วบนเว็บหรือไม่ก่อน POST
    - กำหนดฟิลด์ระดับบนให้ครบถ้วนตาม `SolutionCreateRequest`:
      - `titleEn`, `titleTh`, `descEn`, `descTh`
      - `icon: "Layers"`, `alt: titleEn`, `order: 99`
      - `isPublished: false` (Draft Mode) และ `link: ""` (ให้ backend สร้าง slug อัตโนมัติ)
      - `metaTitleTh`, `metaTitleEn`, `metaDescriptionTh`, `metaDescriptionEn`
    - ประกอบโครงสร้าง `content` 3 ก้อนเต็มรูปแบบสำหรับทั้ง `th` และ `en`:
      1. `hero`: `titleLine1`, `description`, `backgroundImage: "/asset/image/bg/ai-hero-bg.webp"`
      2. `solutions`:
         - `results`: `{ title, items: [...] }`
         - `problems`: `{ title, items: [...] }`
         - `targetAudience`: `{ title, items: [{ icon: "/asset/icons/target-1.svg", text }, ...] }`
      3. `examplesDeveloped`: `{ title, items: [] }` (ปล่อย array ว่างไว้ให้ทีมกรอกต่อบน CMS)
    - กำหนด `features: [{ labelTh, labelEn, order }]`
15. **POST to SyaCo Solutions API** — HTTP POST `https://www.syaco.co.th/api/solutions`
    - Auth: Header `Authorization: Bearer $env.SYACO_API_TOKEN` (Role: `admin` หรือ `emp`)
    - Body: `={{ $json.syacoPayload }}` (ส่งเป็น Object JSON ตรงๆ)
    - Response: Entity ของ Solution พร้อม `id` ที่ถูกสร้าง
16. **IF Success:**
    - **UPDATE Postgres** — `status = 'published_as_draft'`, `published_solution_id = $new_id`, `published_at = NOW()`, `error_message = NULL`
    - **Notify Discord** — ส่งข้อความผ่านนิพจน์ n8n:
      `✅ Solution ถูกสร้างเป็น Draft บน syaco.co.th เรียบร้อย (ID: {{ $json.id }}, Link: {{ $json.link }}) — โครงสร้างครบ 3 ส่วน พร้อมให้ทีมใส่ Examples บน CMS`
17. **IF Error:**
    - **UPDATE Postgres** — `status = 'failed'`, `error_message = $error` เพื่อให้สามารถกด Retry ได้
    - **Notify Discord** — ❌ "สร้าง Solution บน syaco.co.th ไม่สำเร็จ: [error]" พร้อมปุ่มสำหรับ Retry

### Postgres Table:
```sql
CREATE TABLE solution_suggestions (
  id SERIAL PRIMARY KEY,
  base_solution_id TEXT,               -- ID โซลูชันเดิมที่นำมาต่อยอด (Adjacent base)
  title_th TEXT NOT NULL,
  title_en TEXT NOT NULL,
  description_th TEXT NOT NULL,
  description_en TEXT NOT NULL,
  rationale TEXT,                      -- เหตุผลและ Pain Point ของตลาด
  features JSONB NOT NULL DEFAULT '[]'::jsonb,   -- รายการฟีเจอร์หลัก [{ labelTh, labelEn }]
  content_ai JSONB NOT NULL DEFAULT '{}'::jsonb, -- ข้อมูลดิบ 3 ก้อน: problems, results, targetAudience ทั้ง th/en
  status TEXT DEFAULT 'pending_review',-- 'pending_review' | 'publishing' | 'published_as_draft' | 'failed' | 'rejected'
  published_solution_id TEXT,          -- ID ที่ได้ตอบกลับมาจาก syaco.co.th เมื่อสร้าง Draft สำเร็จ
  error_message TEXT,                  -- ข้อความ Error ล่าสุด (กรณีล้มเหลว)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);
```

---

## Flow 2 — Content Creator & Publisher (Multi-Platform Auto & Manual)

**Trigger:** Schedule ทุก 24 ชั่วโมง (เช่น 08:00 AM ทุกวัน) — ตรวจจับ solution ใหม่บน `syaco.co.th/api/solutions`
**Goal:** เมื่อพบ solution ที่ยังไม่เคยสร้าง Content → AI สร้าง Content แยกตามลักษณะของแต่ละช่องทาง:
1. **Auto-Post Formats (มี API)**:
   - **Bluesky (`bluesky`)**: ข้อความภาษาไทยสั้นกระชับ (≤ 280-300 ตัวอักษร) พร้อม Link โดยคำนวณ **UTF-8 Byte Offset** สำหรับ Facets
   - **Dev.to (`devto`)**: บทความภาษาไทยเชิงเทคนิค (Markdown) พร้อม tags (สูงสุด 4 แท็ก, sanitize เฉพาะ `a-z0-9`), ไม่ใส่ `canonical_url` มั่วแต่ใส่ลิงก์แนะนำในเนื้อหา
   - **Hashnode (`hashnode`)**: บทความ Markdown เผยแพร่ลง Publication ผ่าน GraphQL API (`publishPost` mutation, ฟิลด์ `originalArticleURL`, tags เป็น `[{ name, slug }]`)
2. **Manual-Post Formats (ไม่มี API / โพสต์มือเอง)**:
   - **Long-form Article (`manual_article`)**: บทความภาษาไทยเชิงเทคนิค (Markdown) พร้อมจัดหัวข้อและแท็ก สำหรับ Blognone, TechTalkThai, Medium หรือ Substack

### Detection & Idempotency Strategy:
- **Seed initial solutions**: ในการติดตั้งครั้งแรก จะมี Seed Script บันทึก solution ปัจจุบันทั้งหมดลง `processed_solutions (status='completed')` เพื่อป้องกันการรันสร้างย้อนหลัง 4 drafts ให้กับของเก่าทั้งหมด
- ใช้ตาราง `processed_solutions` (state: `'processing'` -> `'completed'` / `'failed'`) เพื่อ lock งานระดับ Solution
- **Atomic Lock ปลอดภัย**:
  ```sql
  INSERT INTO processed_solutions (solution_id, solution_title, status)
  VALUES ($1, $2, 'processing')
  ON CONFLICT (solution_id) DO UPDATE 
    SET status = 'processing', updated_at = NOW()
  WHERE processed_solutions.status <> 'completed';
  ```
  *(ป้องกันไม่ให้คำสั่ง ON CONFLICT รีเซ็ตโซลูชันที่ completed ไปแล้วกลับเป็น processing)*
- **Constraint ตาราง `content_drafts`**: มี `UNIQUE (solution_id, platform)` ป้องกันร่างซ้ำ
- แต่ละ Platform มีสถานะแยกกันชัดเจน (`pending_review`, `publishing`, `ready_to_post`, `posted`, `rejected`, `failed`)
- **การบันทึก Drafts ด้วย CTE คำสั่งเดียว (Atomic Multi-Insert)**:
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

### Nodes:
1. **Schedule Trigger** — ทุก 24 ชั่วโมง (08:00 AM)
2. **Get Current Solutions** — HTTP GET `syaco.co.th/api/solutions`
3. **Load Processed IDs** — Postgres: `SELECT solution_id FROM processed_solutions WHERE status = 'completed';`
4. **Filter New/Pending Solutions** — Code node: เปรียบเทียบ IDs เลือกเฉพาะที่ยังไม่ 'completed'
5. **IF No New Solutions** — จบการทำงาน (no-op)
6. **Split In Batches** — ทำทีละ solution (batchSize = 1)
7. **Lock Solution Status** — Postgres (atomic lock WHERE status <> 'completed')
8. **AI Generation (แยก 2 คำขอเพื่อความเสถียร ป้องกัน Output ถูกตัด/JSON พัง)**:
   - **8.1 AI Generate Micro & Medium Post** — HTTP POST Gemini API:
     - `blueskyPost`: ข้อความสั้น ≤ 300 ตัวอักษร
     - `devtoArticle`: บทความ Markdown กระชับสำหรับ dev
   - **8.2 AI Generate Long-form In-depth Article** — HTTP POST Gemini API (แยกยิงอีกรอบ):
     - `hashnodeArticle`: บทความเชิงลึกสถาปัตยกรรมระบบ
     - `manualArticle`: บทความทางการ Enterprise ภาษาไทย
9. **Parse, Sanitize & Normalize Drafts** — Code node:
   - Sanitize Dev.to tags: กรองตัวอักษรไทย/สัญลักษณ์/ช่องว่างออก เหลือเฉพาะ `[a-z0-9]`, ตัดเหลือไม่เกิน 4 แท็ก
   - Format Hashnode tags: แปลงแท็กเป็น array of objects `[{ name: tag, slug: tag.toLowerCase() }]`
   - แตกข้อมูลออกเป็น 4 items สำหรับ 4 แพลตฟอร์ม
10. **Save Drafts & Complete Status (CTE Query)** — Postgres: รัน CTE บันทึกทั้ง 4 แพลตฟอร์มพร้อมอัปเดต processed_solutions เป็น completed
11. **Build Discord Interactive Review Embed** — Code node: 
    - แสดง Preview ของแต่ละ Platform
    - ปุ่ม Action แยก: `🚀 โพสต์ Bluesky`, `🚀 โพสต์ Dev.to`, `🚀 โพสต์ Hashnode`, `📋 รับเนื้อหาโพสต์มือ`, `✏️ Edit`, `❌ Reject`
12. **Discord Draft Review** — POST → `discord-bot:3000/notify`
13. **Webhook: Dispatch Action** — รับ `{ draft_id, action }` (publish | reject | edit) จาก Discord
14. **Handle Action**:
    - **IF action = 'reject'**: UPDATE `content_drafts SET status = 'rejected' WHERE id = $1;` แจ้งเตือน Discord
    - **IF action = 'publish'**:
      - **Atomic Check & Lock Draft**:
        ```sql
        UPDATE content_drafts
        SET status = 'publishing'
        WHERE id = $1 AND status IN ('pending_review', 'failed')
        RETURNING *;
        ```
15. **Platform Router (Switch Node)** — ตรวจสอบ `platform` ของ draft ที่ถูกดึงมา:
    - **Branch 1: `bluesky`**:
      - 15.1.1 **Calculate UTF-8 Byte Offsets & Build Payload** — Code node: คำนวณ `byteStart` และ `byteEnd` ของ URL ในข้อความภาษาไทยด้วย `Buffer.byteLength(text.slice(0, index))` และประกอบ JSON Body สมบูรณ์:
        ```javascript
        const text = $json.content_markdown;
        const link = $json.solution_url;
        const linkIndex = text.indexOf(link);
        const facets = linkIndex >= 0 ? [{
          index: {
            byteStart: Buffer.byteLength(text.slice(0, linkIndex), 'utf8'),
            byteEnd: Buffer.byteLength(text.slice(0, linkIndex + link.length), 'utf8')
          },
          features: [{ "$type": "app.bsky.richtext.facet#link", "uri": link }]
        }] : [];
        const record = {
          "$type": "app.bsky.feed.post",
          text: text,
          createdAt: new Date().toISOString(),
          facets: facets
        };
        return [{ json: { blueskyBody: { repo: $json.did, collection: "app.bsky.feed.post", record } } }];
        ```
      - 15.1.2 **Bluesky Create Session** — HTTP POST `https://bsky.social/xrpc/com.atproto.server.createSession`
      - 15.1.3 **POST Record to Bluesky** — HTTP POST `https://bsky.social/xrpc/com.atproto.repo.createRecord`
        - Body: `={{ $json.blueskyBody }}` (ส่ง JSON Object จาก Code node โดยตรง ป้องกันเครื่องหมายคำพูด/ขึ้นบรรทัดใหม่พัง)
      - 15.1.4 **Success Handler** — UPDATE `status = 'posted'`, บันทึก `posted_url = 'https://bsky.app/profile/' + $handle + '/post/' + $rkey`
    - **Branch 2: `devto`**:
      - 15.2.1 **Build Dev.to Payload in Code Node**:
        ```javascript
        return [{ json: {
          devtoBody: {
            article: {
              title: $json.title_th,
              body_markdown: $json.content_markdown,
              published: true,
              tags: $json.tags // Array of sanitized string tags [a-z0-9]
            }
          }
        }}];
        ```
      - 15.2.2 **POST Article to Dev.to API** — HTTP POST `https://dev.to/api/articles`
        - Headers: `api-key: {{ $env.DEVTO_API_KEY }}`, `Content-Type: application/json`
        - Body: `={{ $json.devtoBody }}`
      - 15.2.3 **Success Handler** — UPDATE `status = 'posted'`, บันทึก `posted_url = $response.url`
    - **Branch 3: `hashnode`**:
      - 15.3.1 **Build Hashnode GraphQL Payload in Code Node**:
        ```javascript
        return [{ json: {
          hashnodeBody: {
            query: `mutation PublishPost($input: PublishPostInput!) {
              publishPost(input: $input) {
                post { id url title }
              }
            }`,
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
      - 15.3.2 **POST to Hashnode GraphQL API** — HTTP POST `https://gql.hashnode.com`
        - Headers: `Authorization: {{ $env.HASHNODE_ACCESS_TOKEN }}`, `Content-Type: application/json`
        - Body: `={{ $json.hashnodeBody }}`
      - 15.3.3 **Success Handler** — UPDATE `status = 'posted'`, บันทึก `posted_url = $response.data.publishPost.post.url`
    - **Branch 4: `manual_article`**:
      - 15.4.1 ส่ง Markdown ฉบับเต็มเข้า Discord channel `#ready-to-post` ให้ทีมคัดลอกได้ทันที
      - 15.4.2 UPDATE `status = 'ready_to_post'`
16. **Global Error Catch / Handler**:
    - หาก Publisher ตัวใดตัวหนึ่งล้มเหลว: อัปเดตเฉพาะ row นั้นเป็น `status = 'failed'`, เก็บ `error_message`, และส่งปุ่ม Retry เข้า Discord โดยไม่กระทบต่อ Platform อื่น

### Postgres Tables:
```sql
-- ติดตาม solution และจัดการ Idempotency
CREATE TABLE processed_solutions (
  solution_id TEXT PRIMARY KEY,
  solution_title TEXT,
  status TEXT DEFAULT 'processing', -- 'processing' | 'completed' | 'failed'
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- draft content ที่ AI สร้าง (รองรับทั้ง Bluesky, Dev.to, Hashnode, Manual)
CREATE TABLE content_drafts (
  id SERIAL PRIMARY KEY,
  solution_id TEXT NOT NULL,
  solution_title TEXT,
  platform TEXT NOT NULL,         -- 'bluesky' | 'devto' | 'hashnode' | 'manual_article'
  title_th TEXT,
  content_markdown TEXT,
  tags TEXT[],
  status TEXT DEFAULT 'pending_review',  -- 'pending_review' | 'publishing' | 'ready_to_post' | 'posted' | 'rejected' | 'failed'
  posted_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  CONSTRAINT uq_solution_platform UNIQUE (solution_id, platform)
);
```

### Discord Message Format (Ready-to-post):
```
📝 BLOGNONE DRAFT READY
━━━━━━━━━━━━━━━━━━━━━━━
🔗 Solution: [title] → syaco.co.th/solutions/...
📌 ชื่อบทความ: [title]
🏷️ แท็ก: [tags]

[full article content — copy-paste ready]

━━━━━━━━━━━━━━━━━━━━━━━
👉 โพสต์ที่: https://www.blognone.com/node/add/blog
✅ Mark done: [webhook URL]
```

---

## Flow 3 — Community Lead Assistant (`/answer` on-demand)

**Trigger:** Discord Slash Command `/answer` (ทีมเปิด Modal กรอก 2 ช่อง: ลิงก์กระทู้ + ข้อความคำถามที่คัดลอกมา)  
**Goal:** แปลงคำถามในกระทู้จริงของลูกค้าไทย (Pantip, Blognone, Blockdit, Facebook Group) ให้เป็น **B2B Lead คุณภาพสูง** โดยใช้ระบบและตารางเดิม `backlink_candidates` 100%

---

### ข้อดีและการควบคุมความเสี่ยง (ตามข้อกำหนด):
1. **Reuse ระบบเดิม 100%**: ใช้ตาราง `backlink_candidates` และโครงสร้างปุ่ม Discord เดิม
2. **Platform-Aware URL Normalization**: ไม่ตัด query string ทิ้งแบบเหมาเข่ง:
   - **Pantip**: ตัดเหลือเฉพาะ canonical format `https://pantip.com/topic/{id}`
   - **Facebook**: รักษาพารามิเตอร์ระบุโพสต์ที่จำเป็น เช่น `story_fbid`, `id`, `post_id` หรือ path `/groups/.../posts/{id}`
   - **Blognone / Blockdit**: ตัด UTM/query tracking ออก เหลือ path บทความจริง
3. **Idempotency ด้วย Normalized URL**: ตรวจสอบ `post_url` (UNIQUE) หากส่งลิงก์เดิมซ้ำ บอตจะตอบกลับว่า "กระทู้นี้อยู่ในระบบแล้ว" พร้อมแสดงการ์ดเดิม ไม่สร้างแถวซ้ำ
4. **จำกัดโควตา 3–5 กระทู้ต่อสัปดาห์ (บังคับด้วย Database Query)**:
   - เมื่อรับคำสั่ง `/answer` จะรันคำนวณจำนวนโพสต์ที่ถูก approve/posted ในช่วง 7 วันที่ผ่านมา:
     ```sql
     SELECT COUNT(*) AS weekly_count 
     FROM backlink_candidates 
     WHERE platform IN ('pantip', 'blognone', 'blockdit', 'facebook_group')
       AND status IN ('pending_review', 'approved', 'posted')
       AND created_at >= NOW() - INTERVAL '7 days';
     ```
   - หากเกิน 5 กระทู้/สัปดาห์: บอตจะแจ้งเตือนว่า "โควตาตอบกระทู้สัปดาห์นี้ครบแล้ว (5/5) เพื่อป้องกันบัญชีถูกมองเป็นสแปม" และหยุดทำงาน
5. **ดึงเฉพาะ Published Solutions**:
   - เรียก HTTP GET `https://www.syaco.co.th/api/solutions` (**ไม่มี `?all=true`**) เพื่อไม่ให้ดึง Draft ที่ AI เพิ่งแนะนำมาอ้างอิง
6. **Lead Fit & Can-Answer Qualification**:
   - คัดกรองว่าเป็นระดับองค์กร/โรงงาน หรือเป็นงานอดิเรก
   - AI ร่างคำตอบโดยอิงจากโซลูชันจริงเท่านั้น **ห้ามแต่งตัวเลขหรือชื่อลูกค้า**
   - ตอบอย่างโปร่งใส พร้อมระบุ Disclosure ชัดเจน และไม่ใส่ Backlink เป็นค่าเริ่มต้น
7. **ปุ่ม Mark Posted สำหรับแพลตฟอร์ม Manual**:
   - เมื่อทีมกด Approve สถานะจะเปลี่ยนเป็น `approved` (รอทีมไปโพสต์มือ)
   - บอตจะแสดงปุ่ม **[✅ Mark Posted]** ให้ทีมกดเมื่อนำคำตอบไป Reply ในกระทู้จริงเรียบร้อยแล้ว เพื่อเปลี่ยนสถานะเป็น `posted` พร้อมบันทึกเวลาจริง

---

### Nodes & Pipeline:
1. **Webhook: `/answer` Command** — รับ payload จาก Discord bot:
   ```json
   {
     "post_url": "https://pantip.com/topic/43000000",
     "question_text": "โรงงานมี PLC หลายยี่ห้อ ต้องการดึงข้อมูลเข้า SAP แบบ Realtime แนะนำ Middleware ตัวไหนดีครับ",
     "platform": "pantip" // pantip | blognone | blockdit | facebook_group
   }
   ```
2. **Platform-Aware Normalize Post URL** — Code node:
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
   const normalizedUrl = normalizeUrl($json.post_url, $json.platform);
   return [{ json: { ...$json, normalized_url: normalizedUrl } }];
   ```
3. **Check Weekly Quota & Existing URL** — Postgres query:
   ```sql
   WITH quota AS (
     SELECT COUNT(*) AS weekly_count 
     FROM backlink_candidates 
     WHERE platform IN ('pantip', 'blognone', 'blockdit', 'facebook_group')
       AND status IN ('pending_review', 'approved', 'posted')
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
4. **Quota & Duplicate Guard** — IF node:
   - หาก `existing_id IS NOT NULL`: แจ้ง Discord ว่า "กระทู้นี้อยู่ในระบบแล้ว (ID: {{ $json.existing_id }}, สถานะ: {{ $json.existing_status }})" → จบการทำงาน
   - หาก `weekly_count >= 5`: แจ้ง Discord ว่า "โควตาตอบกระทู้สัปดาห์นี้เต็มแล้ว ({{ $json.weekly_count }}/5) เพื่อความปลอดภัยของบัญชี" → จบการทำงาน
5. **Fetch Published Solutions Catalog** — HTTP GET `https://www.syaco.co.th/api/solutions` (**เฉพาะ Published**)
6. **Build Lead Qualification & Draft Prompt** — Code node:
   - ตรวจสอบ `lead_fit`: HIGH (Enterprise/B2B/Factory), MEDIUM (SMB/General Tech), LOW (Student/Hobbyist/Gaming)
   - ตรวจสอบ `canAnswer`: Solution ใน SyaCo แก้ปัญหานี้ได้ตรงจุดหรือไม่
   - กำหนดสไตล์น้ำเสียงตามแพลตฟอร์ม:
     - **Pantip**: เป็นกันเอง ให้เกียรติ เน้นแบ่งปันประสบการณ์เชิงวิศวกรรม
     - **Blognone**: กระชับ ตรงประเด็น เชิงเทคนิคและสถาปัตยกรรมระบบ
     - **Blockdit**: ภาษาอ่านง่าย เล่าที่มา ปัญหา และแนวทางแก้ไขเป็นขั้นตอน
     - **Facebook Group**: เป็นมิตร มืออาชีพ ตอบคอมเมนต์สั้นกระชับ
   - **กฎการใส่ Backlink**: ไม่ใส่เป็นค่าเริ่มต้น! ใส่เฉพาะเมื่อจำเป็นและเกี่ยวข้องตรงๆ พร้อมระบุตัวตนจริง ("Disclosure: ผมมาจากทีม SyaCo...") และแนบ UTM: `?utm_source={platform}&utm_medium=community_answer&utm_campaign=lead_gen`
7. **AI Lead Fit & Answer Generation** — HTTP POST Gemini API (Structured Output)
8. **Parse & Decision Filter** — Code node:
   - ตรวจสอบ `lead_fit != 'LOW'` และ `canAnswer == true` และ `matchScore >= 0.75`
   - หากไม่ผ่านเกณฑ์: บันทึกลงตารางด้วย `status = 'skipped'` และแจ้ง Discord เงียบๆ
9. **Save to `backlink_candidates`** — Postgres query (ใช้ตารางเดิม):
   ```sql
   INSERT INTO backlink_candidates
     (post_url, post_title, platform, solution_id, solution_title, solution_url,
      matched_problem, match_score, relevance_reason, answer, link_included,
      link_reason, suggested_anchor, status)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending_review')
   RETURNING *;
   ```
10. **Notify Discord Review Card** — HTTP POST `http://discord-bot:3000/notify` (ส่งการ์ดพร้อมปุ่ม Approve, Edit, Reject)
11. **Webhook: Bot Action (Approve / Mark Posted / Reject)**:
    - **Approve**: อัปเดต `status = 'approved'` และบอตแสดงปุ่ม **[✅ Mark Posted]** ให้ทีม
    - **Mark Posted**: เมื่อทีมนำคำตอบไปโพสต์ในกระทู้จริงแล้วกดปุ่มนี้ → อัปเดต `status = 'posted'`, `posted_at = NOW()`
    - **Reject**: อัปเดต `status = 'rejected'`

---

### การปรับปรุงตาราง `backlink_candidates` (Migration):
```sql
-- เพิ่มค่า platform ใหม่สำหรับชุมชนไทย
-- platform: 'reddit', 'devto', 'bluesky', 'pantip', 'blognone', 'blockdit', 'facebook_group'
-- status: 'pending_review', 'approved', 'posted', 'rejected', 'skipped'
```

---

## Summary: ทีมต้องทำอะไร

| Action | ความถี่ | Platform |
|---|---|---|
| Review & approve solution suggestions | ทุก Monday | Discord |
| Review & กด Approve เพื่อยิง Auto-Post ทันที | ทุกวัน เมื่อตรวจพบ Solution ใหม่ | Discord (ปุ่มแยก: Bluesky, Dev.to, Hashnode) |
| Copy-paste บทความ Manual ฉบับเต็ม | เมื่อต้องการเผยแพร่ | Discord (#ready-to-post) → Blognone / TechTalkThai / Medium |
| พิมพ์คำสั่ง `/answer` เพื่อให้ AI ช่วยร่างคำตอบกระทู้ลูกค้า | เมื่อพบกระทู้ที่น่าสนใจ (On-demand) | Discord (/answer modal) → Pantip / Blognone / Blockdit / FB Group |
| Review & นำคำตอบไป Reply ด้วยบัญชีจริง | หลังผ่านการตรวจทานใน Discord | กระทู้ต้นทาง (จำกัด 3-5 กระทู้/สัปดาห์) |

---

## Verification Plan

- [ ] Test Flow 1: manual trigger → ตรวจสอบการวิเคราะห์ Gap, บันทึก `solution_suggestions` พร้อม JSONB (`features`, `content_ai`), และ Discord notification
- [ ] Test Flow 1 Webhook: ทดสอบกด Approve → ตรวจสอบ Atomic Lock (`status = 'publishing'`) ป้องกันกดซ้ำ และการยิง Admin API ไปยัง syaco.co.th
- [ ] Test Flow 2: ทดสอบรัน Schedule ตรวจจับ solution ใหม่ → ตรวจสอบการสร้างเนื้อหา 4 รูปแบบ (Bluesky, Dev.to, Hashnode, Long-form Manual) และ Idempotency state ใน `processed_solutions`
- [ ] Test Flow 2 Bluesky API: ทดสอบ Webhook Approve Bluesky → ตรวจสอบการสร้าง Session และยิง `createRecord` ขึ้น bsky.app
- [ ] Test Flow 2 Dev.to API: ทดสอบ Webhook Approve Dev.to → ตรวจสอบการยิง `POST /api/articles` ขึ้น dev.to พร้อม canonical URL
- [ ] Test Flow 2 Hashnode API: ทดสอบ Webhook Approve Hashnode → ตรวจสอบการยิง GraphQL `publishPost` ขึ้น Publication
- [ ] Test Flow 3 (/answer): จำลองคำสั่ง `/answer` ด้วย Post URL + คำถาม → ตรวจสอบการคัดกรอง Lead Fit, การคำนวณคะแนน, และการสร้าง Draft คำตอบสไตล์ไทย
- [ ] Test Flow 3 Idempotency: ส่งลิงก์กระทู้เดิมซ้ำ → ตรวจสอบว่าระบบแจ้งเตือนว่ามีแล้ว และไม่บันทึกซ้ำ
- [ ] ตรวจสอบ `discord-bot:3000/notify` สามารถ render buttons (Approve/Edit/Reject) ของตาราง `backlink_candidates` เดิมได้อย่างสมบูรณ์

