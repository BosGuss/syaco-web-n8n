# Design Specification: Flow 3 UI Improvement (Daily Radar)

- **Date:** 2026-11-27
- **Status:** Approved
- **Scope:** Discord Bot UI & Notification Formatting (`discord-bot/commands.js`, `discord-bot/index.js`)

---

## 1. Background & Objectives

Currently, when the Flow 3 Daily Thread Radar broadcasts the morning list of potential lead threads (or when threads are presented via `/find`), the UI includes:
1. Five quick action buttons labeled `[⚡ ร่างข้อ 1]` through `[⚡ ร่างข้อ 5]`.
2. A String Select Menu dropdown allowing users to select up to 5 of the top 25 threads for AI answer drafting.
3. Informational text referencing the buttons (`แตะปุ่มด่วน [⚡ ร่างข้อ 1-5] หรือเลือกจากดรอปดาวน์ด้านล่าง...`).

### Goal:
- Clean up the visual clutter in the Discord channel by removing the 5 draft buttons (`[⚡ ร่างข้อ 1-5]`).
- Retain the String Select Menu dropdown for flexible thread selection (up to 25 threads).
- Add a refined, professional prompt in the Daily Radar broadcast:  
  `💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find`
- Update embed descriptions and select menu placeholder texts to reflect the cleaner workflow.

---

## 2. Technical Design & File Changes

### 2.1 `discord-bot/commands.js`

In `buildRadarEmbedsAndMenu(threads, solutionsCovered = [])`:
1. **Remove Quick Action Buttons:**
   - Remove the creation and attachment of `quickButtons` (`lead_draft_${t.id}`) from `components`.
   - The returned `components` array will now contain only the ActionRow with the `StringSelectMenuBuilder` (`select_radar_draft`).
2. **Update Embed Description:**
   - Replace:
     ```text
     ⚡ **วิธีสั่งงานด่วน:** แตะปุ่ม **[⚡ ร่างข้อ X]** ด้านล่าง หรือเลือกจากดรอปดาวน์เพื่อสั่ง AI ร่างคำตอบทันที
     ```
     With:
     ```text
     🎯 **วิธีสั่งงาน:** เลือกกระทู้จากเมนูดรอปดาวน์ด้านล่างเพื่อสั่ง AI ร่างคำตอบทันที
     ```
3. **Update Select Menu Placeholder:**
   - Replace:
     ```javascript
     .setPlaceholder('🎯 เลือกกระทู้เพื่อร่างคำตอบ (หรือแตะปุ่มลัดด้านบน)...')
     ```
     With:
     ```javascript
     .setPlaceholder('🎯 เลือกกระทู้ที่ต้องการให้ AI ช่วยตอบจากเมนูนี้...')
     ```

### 2.2 `discord-bot/index.js`

In `runDailyRadarTask()` (the daily scheduled broadcast at 11:00 AM):
1. **Update Broadcast Messages:**
   - Case A (<= 2 embeds):
     ```javascript
     content: `🌅 **สวัสดีตอนเช้าครับทีมงาน! เรดาร์กระทู้/โพสต์น่าสนใจประจำวันพร้อมแล้ว (${savedRows.length} รายการ)**\n` +
              `💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find\n` +
              `👇 เลือกกระทู้จากเมนูด้านล่างเพื่อให้ AI ร่างคำตอบได้ทันทีครับ:`,
     ```
   - Case B (> 2 embeds - Part 2 message):
     ```javascript
     content: `(ส่วนที่ 2/2) 👇 **เลือกกระทู้ที่ต้องการให้ AI ช่วยร่างคำตอบจากเมนูด้านล่างได้ทันทีครับ**\n` +
              `💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find`,
     ```

### 2.3 Backward Compatibility
- Retain the interaction handler `if (interaction.customId.startsWith('lead_draft_'))` in `discord-bot/index.js` so that if users interact with historical messages that still have the legacy buttons, the bot handles them without crashing or throwing unhandled errors.

---

## 3. Verification & Testing Criteria

1. **Unit Tests:**
   - Run `node discord-bot/test_unit_filters.js` to ensure search filters and Option 1 Facebook logic remain intact.
   - Run `node discord-bot/test-commands.js` to verify slash commands and component handlers execute cleanly.
2. **Component Output Verification:**
   - Verify that `buildRadarEmbedsAndMenu` returns `components` containing only 1 ActionRow (the StringSelectMenu) and 0 ButtonBuilders.
   - Verify that the Daily Radar message string contains the approved phrase: `💡 ต้องการค้นหาเจาะจงหรือดูหัวข้ออื่นเพิ่มเติม พิมพ์ /find`.
3. **Docker Container Deployment:**
   - Rebuild and restart `discord-bot` container (`docker compose build discord-bot && docker compose restart discord-bot`).
