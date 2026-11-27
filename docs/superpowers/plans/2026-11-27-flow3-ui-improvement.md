# Flow 3 UI Improvement Implementation Plan

> **User Prompt:** อยากให้ปรับปรุงหน้า ui flow 3 หน่อยให้เอาพวก "ปุ่มร่าง" ออกไป และ มีข้อความแจ้งว่า "ขอคำแนะนำเพิ่มพิม /find" (เปลี่ยนคำให้ดูดี: "💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find")  
> **Spec File:** [2026-11-27-flow3-ui-improvement-design.md](file:///c:/Users/dYflyTaxi/Desktop/n8n-sandbox/docs/superpowers/specs/2026-11-27-flow3-ui-improvement-design.md)  
> **Date:** 2026-11-27

---

## 1. Overview & Scope

Remove the 5 quick action buttons (`[⚡ ร่างข้อ 1]` through `[⚡ ร่างข้อ 5]`) from the Flow 3 Daily Thread Radar embeds in `discord-bot/commands.js`, retain the dropdown Select Menu for clean interactive selection, and add the approved hint message:
`💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find`
to the daily broadcast routine in `discord-bot/index.js`.

---

## 2. File Decomposition & Boundaries

| File | Primary Responsibility |
|---|---|
| `discord-bot/commands.js` | Modifies `buildRadarEmbedsAndMenu` to eliminate `quickButtons` and update instructional copy |
| `discord-bot/index.js` | Modifies `runDailyRadarTask` broadcast messages to incorporate the hint text |
| `discord-bot/test-ui-flow3.js` | Unit test suite to verify component structure, copy changes, and absence of draft buttons |

---

## 3. Step-by-Step Tasks

### Task 1: Write Unit Test for Radar UI (`discord-bot/test-ui-flow3.js`)

**Files to touch:**
- Create: `discord-bot/test-ui-flow3.js`

**Test Specification:**
- Call `buildRadarEmbedsAndMenu(mockThreads, mockSolutions)`
- Assert `components.length === 1` (Only Select Menu row)
- Assert `components[0].components[0].data.type === 3` (String Select Menu)
- Assert no components have `customId` starting with `lead_draft_`
- Assert embed description includes `🎯 **วิธีสั่งงาน:** เลือกกระทู้จากเมนูดรอปดาวน์ด้านล่างเพื่อสั่ง AI ร่างคำตอบทันที`
- Assert select menu placeholder is `🎯 เลือกกระทู้ที่ต้องการให้ AI ช่วยตอบจากเมนูนี้...`

**Expected Outcome before Task 2:**
- Test fails because `quickButtons` are currently present (`components.length === 2`).

---

### Task 2: Implement UI Changes in `discord-bot/commands.js`

**Files to touch:**
- Modify: `discord-bot/commands.js`

**Implementation Details:**
1. In `buildRadarEmbedsAndMenu`:
   - Remove lines 525–534 (`quickButtons` logic).
   - In Embed 0 description (line 497), replace `⚡ **วิธีสั่งงานด่วน:** แตะปุ่ม **[⚡ ร่างข้อ X]** ด้านล่าง หรือเลือกจากดรอปดาวน์เพื่อสั่ง AI ร่างคำตอบทันที` with:
     ```text
     🎯 **วิธีสั่งงาน:** เลือกกระทู้จากเมนูดรอปดาวน์ด้านล่างเพื่อสั่ง AI ร่างคำตอบทันที
     ```
   - In `selectMenu.setPlaceholder` (line 553), replace with:
     ```javascript
     .setPlaceholder('🎯 เลือกกระทู้ที่ต้องการให้ AI ช่วยตอบจากเมนูนี้...')
     ```
2. Run `node discord-bot/test-ui-flow3.js` to ensure the test passes.

---

### Task 3: Update Daily Radar Broadcast in `discord-bot/index.js`

**Files to touch:**
- Modify: `discord-bot/index.js`

**Implementation Details:**
1. In `runDailyRadarTask()` (around line 400):
   - For `<= 2` embeds, update `content`:
     ```javascript
     content: `🌅 **สวัสดีตอนเช้าครับทีมงาน! เรดาร์กระทู้/โพสต์น่าสนใจประจำวันพร้อมแล้ว (${savedRows.length} รายการ)**\n` +
              `💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find\n` +
              `👇 เลือกกระทู้จากเมนูด้านล่างเพื่อให้ AI ร่างคำตอบได้ทันทีครับ:`,
     ```
   - For `> 2` embeds, update second message `content`:
     ```javascript
     content: `(ส่วนที่ 2/2) 👇 **เลือกกระทู้ที่ต้องการให้ AI ช่วยร่างคำตอบจากเมนูด้านล่างได้ทันทีครับ**\n` +
              `💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find`,
     ```

---

### Task 4: Regression Testing & Docker Container Deployment

**Steps:**
1. Run `node discord-bot/test_unit_filters.js` (Verify search filters & Facebook Option 1)
2. Run `node discord-bot/test-commands.js` (Verify all 14 slash command tests)
3. Run `node discord-bot/test-ui-flow3.js` (Verify new UI requirements)
4. Build updated Docker image: `docker compose build discord-bot`
5. Restart service: `docker compose restart discord-bot`
6. Verify logs: `docker compose logs --tail 20 discord-bot`
