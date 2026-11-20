# Flow 2 Pending Drafts Reminder & Discord Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Flow 2 and Discord bot to re-notify and manage unreviewed content drafts daily and on-demand without redundant Gemini AI generation.

**Architecture:** 
1. In Flow 2 (`workflows/flow2-content-publisher.json`), update `Load Processed IDs` SQL query so solutions are only marked completed when no drafts with `status = 'pending_review'` remain.
2. In Flow 2, update `Filter New Solutions` and route solutions with existing pending drafts directly to `Notify Discord Review Cards` (bypassing AI call nodes).
3. In Discord Bot (`discord-bot/commands.js` & `index.js`), register the `/drafts` slash command with review buttons and update `/status view:pending` to display pending content drafts alongside backlink candidates.
4. Verify with automated unit tests and Docker end-to-end testing.

**Tech Stack:** Node.js, discord.js v14, PostgreSQL (pg), n8n workflow JSON (SQLite sync), Docker.

## Global Constraints
- Zero redundant AI cost: Never call Google Gemini API if drafts already exist in `content_drafts`.
- Safe Idempotency: `(solution_id, platform)` unique constraint in PostgreSQL must be respected.
- All code nodes in n8n workflows must be validated with `scripts/test-workflow-syntax.js`.
- Sync workflow JSON to n8n SQLite (`n8n_data/database.sqlite`) via `python scripts/sync-workflows.py`.

---

### Task 1: Update Flow 2 Workflow for Draft Re-Notification and AI Bypass

**Files:**
- Modify: `workflows/flow2-content-publisher.json`
- Test: `scripts/test-flow2.js`
- Test: `scripts/test-workflow-syntax.js`

**Interfaces:**
- Consumes: `processed_solutions` and `content_drafts` tables in PostgreSQL.
- Produces: Flow 2 workflow execution that routes `isReminder === true` items directly to `Notify Discord Review Cards` and `isReminder === false` items through Gemini AI.

- [ ] **Step 1: Write the failing unit test for solution filter and classification in `scripts/test-flow2.js`**

Add tests for detecting solutions with pending drafts vs completely new solutions vs completed solutions:
```javascript
// Test 4: Pending drafts reminder vs new solution classification
const pendingDraftRows = [
  { solution_id: '90', has_pending: true }
];
const completedDbRows = [
  { solution_id: '89', has_pending: false }
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-flow2.js`
Expected: FAIL due to missing classification logic.

- [ ] **Step 3: Update `workflows/flow2-content-publisher.json`**

1. Update node `Load Processed IDs` query:
```sql
SELECT solution_id, 
       EXISTS (
         SELECT 1 FROM content_drafts 
         WHERE content_drafts.solution_id = processed_solutions.solution_id 
           AND content_drafts.status = 'pending_review'
       ) AS has_pending
FROM processed_solutions 
WHERE status = 'completed'
UNION ALL
SELECT '__INIT__', false
WHERE NOT EXISTS (SELECT 1 FROM processed_solutions WHERE status = 'completed');
```

2. Update node `Filter New Solutions` (`f2-node-filter-new`):
- Match solutions from `Get Current Solutions` against `Load Processed IDs`.
- If `has_pending === true`: mark `isReminder: true`, skip AI.
- If not in DB: mark `isReminder: false`, run AI.
- If in DB and `has_pending === false`: completed, exclude.

3. Update Flow 2 node branching:
- After `Split In Batches`, insert an `If Needs AI Generation` (`isReminder === false` -> `Lock Solution Status`, `isReminder === true` -> `Notify Discord Review Cards`).

- [ ] **Step 4: Verify workflow syntax and run `test-flow2.js`**

Run:
```bash
node scripts/test-flow2.js
node scripts/test-workflow-syntax.js
```
Expected: PASS with 0 syntax errors.

- [ ] **Step 5: Sync workflow to n8n SQLite database**

Run: `python scripts/sync-workflows.py`
Expected: Database updated successfully.

- [ ] **Step 6: Commit**

```bash
git add workflows/flow2-content-publisher.json scripts/test-flow2.js
git commit -m "feat(flow2): add pending drafts re-notification with AI bypass logic"
```

---

### Task 2: Implement `/drafts` Slash Command & Update `/status view:pending` in Discord Bot

**Files:**
- Modify: `discord-bot/commands.js`
- Modify: `discord-bot/index.js`
- Test: `discord-bot/test-commands.js`

**Interfaces:**
- Consumes: `content_drafts` table, `buildFlow2Card` helper function.
- Produces: `/drafts` SlashCommandBuilder, updated `handleCommand` handler, and integrated `/status view:pending`.

- [ ] **Step 1: Write failing unit test in `discord-bot/test-commands.js`**

Add test verifying:
1. `commands` array includes `drafts` command with optional `limit` and `view` options.
2. `handleCommand` responds to `commandName === 'drafts'` by querying `content_drafts WHERE status = 'pending_review'`.
3. `/status view:pending` queries both `backlink_candidates` and `content_drafts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node discord-bot/test-commands.js`
Expected: FAIL with "drafts command must exist".

- [ ] **Step 3: Implement `/drafts` and update `/status` in `discord-bot/commands.js`**

1. In `commands` array:
```javascript
new SlashCommandBuilder()
  .setName('drafts')
  .setDescription('ดูรายการดราฟต์บทความ Flow 2 ที่รอการตรวจสอบ (Pending Review)')
  .addIntegerOption(opt =>
    opt.setName('limit')
      .setDescription('จำนวนดราฟต์ที่ต้องการดู (ค่าเริ่มต้น: 5)')
      .setRequired(false)
  )
```

2. Export `buildFlow2Card` or implement card builder in `commands.js`.
3. In `handleCommand`:
- Handle `commandName === 'drafts'`:
  - Query `SELECT * FROM content_drafts WHERE status = 'pending_review' ORDER BY created_at DESC LIMIT $1`.
  - If empty: reply with friendly message.
  - If found: reply with overview and follow-up cards with action buttons.
- Update `commandName === 'status'` when `view === 'pending'`:
  - Fetch pending `backlink_candidates` AND pending `content_drafts`.
  - Display unified summary embed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node discord-bot/test-commands.js`
Expected: ALL TESTS PASS.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/commands.js discord-bot/test-commands.js
git commit -m "feat(discord): add /drafts command and integrate pending drafts into /status"
```

---

### Task 3: Discord Bot `/notify` Verification & Container Restart

**Files:**
- Modify: `discord-bot/index.js`
- Test: `discord-bot/test-flow2-publisher.js`

**Interfaces:**
- Consumes: HTTP POST `/notify` with `{ type: 'flow2_drafts', solution_id, solution_title }`.
- Produces: Discord channel cards sent with `flow2_publish_<id>`, `flow2_reject_<id>`, and `flow2_copy_<id>` buttons.

- [ ] **Step 1: Verify `/notify` endpoint behavior with existing pending draft (Solution 90)**

Ensure `POST /notify` with `{ type: 'flow2_drafts', solution_id: '90' }` correctly fetches and sends all 3 platform cards.

- [ ] **Step 2: Run all unit test suites**

Run:
```bash
node discord-bot/test-commands.js
node discord-bot/test-flow2-publisher.js
node discord-bot/test_unit_filters.js
node scripts/test-workflow-syntax.js
node scripts/test-flow2.js
```
Expected: All suites exit 0 with 100% pass.

- [ ] **Step 3: Restart Discord Bot container**

Run: `docker compose restart discord-bot` (BypassSandbox: true)
Check logs: `docker logs --tail 30 n8n-sandbox-discord-bot-1` (BypassSandbox: true)
Expected: Clean startup, Guild Slash Commands registered.

- [ ] **Step 4: Commit**

```bash
git add discord-bot/index.js
git commit -m "feat(discord): finalize /notify handler and discord bot slash command registration"
```
