# Design Spec: Flow 2 Pending Drafts Reminder & Discord Management

**Date:** 2026-11-20  
**Status:** In Review  
**Topic:** flow2-pending-drafts-reminder  

---

## 1. Problem Statement & Root Cause

### Problem
When Flow 2 (Content Creator & Publisher) runs on its schedule or via manual webhook, it generates multi-platform drafts for new enterprise solutions and posts review cards to Discord. However, if the reviewer overlooks or misses the Discord cards and does not click confirm or reject, Flow 2 never alerts or re-sends them again on subsequent runs. Unreviewed drafts remain stalled indefinitely in `content_drafts` as `status = 'pending_review'`.

### Root Cause
1. **Premature Completion in DB:** When Flow 2 saves drafts, node `Save Drafts & Complete Status (CTE)` immediately executes:
   ```sql
   UPDATE processed_solutions SET status = 'completed', updated_at = NOW() WHERE solution_id = $1
   ```
   even though no human reviewer has approved or published the drafts in Discord.
2. **Exclusion on Subsequent Runs:** Flow 2's `Load Processed IDs` queries:
   ```sql
   SELECT solution_id FROM processed_solutions WHERE status = 'completed'
   ```
   and `Filter New Solutions` excludes all solutions present in that list. Consequently, any solution that had drafts generated is permanently ignored.
3. **No Reminder or On-Demand Access:** Discord bot does not remind users of unreviewed drafts, and the `/status pending` command only inspects Flow 3 (`backlink_candidates`), with no `/drafts` command available.

---

## 2. Architecture & Design

```
[Flow 2 Trigger (Schedule 11:30 AM / Webhook)]
       │
       ├──> [Get Current Solutions] (Fetch Syaco web solutions)
       │
       └──> [Load Processed IDs] (Query solutions where ALL drafts are finalized)
                 │
                 ▼
       [Filter & Classify Solutions]
                 │
       ┌─────────┴─────────────────────────────────┐
       ▼                                           ▼
[Case A: Brand New Solution]             [Case B: Has Pending Drafts]
       │                                           │
       ▼                                           │ (Bypass AI entirely)
[Call Gemini AI Call A & B]                        │
       │                                           │
       ▼                                           │
[Save Drafts into DB]                              │
       │                                           │
       └───────────────────┬───────────────────────┘
                           │
                           ▼
              [Notify Discord Review Cards]
```

### 2.1 Flow 2 (n8n Workflow) Modifications

#### A. Node: `Load Processed IDs`
Update SQL query so a solution is considered "completed" ONLY if all its drafts have been reviewed:
```sql
SELECT solution_id 
FROM processed_solutions 
WHERE status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM content_drafts 
    WHERE content_drafts.solution_id = processed_solutions.solution_id 
      AND content_drafts.status = 'pending_review'
  )
UNION ALL
SELECT '__INIT__'
WHERE NOT EXISTS (
  SELECT 1 FROM processed_solutions 
  WHERE status = 'completed'
);
```

#### B. Node: `Filter New Solutions` (or Classification)
Update JavaScript logic:
- Check if solution already has pending drafts in `content_drafts` (or flag `needsAiGeneration`).
- If drafts already exist: set `isReminder: true`.
- If completely new: set `isReminder: false`.

#### C. AI Bypass Logic (`If Needs AI Generation`)
- If `isReminder === false`: Proceed to `Lock Solution Status` -> `Build AI Prompts` -> `Call Gemini AI A & B` -> `Save Drafts & Complete Status (CTE)`.
- If `isReminder === true`: Bypass AI nodes directly to `Notify Discord Review Cards` with `{ type: 'flow2_drafts', solution_id, solution_title }`.
- **Benefit:** 0 additional Gemini AI token usage, instant execution, zero rate-limit risk.

---

### 2.2 Discord Bot Modifications

#### A. New Slash Command: `/drafts`
- Command structure: `/drafts [view: pending|all] [limit: 5]`
- Displays all `content_drafts WHERE status = 'pending_review'`.
- Sends interactive cards using `buildFlow2Card(d, solution_title)` with buttons:
  - `flow2_publish_<id>` (Publish / Ready)
  - `flow2_reject_<id>` (Reject)
  - `flow2_copy_<id>` (Copy full Markdown)
- Reviewers can view and approve pending drafts anytime on-demand.

#### B. Upgrade Existing Command: `/status view:pending`
- Currently only queries `backlink_candidates`.
- Update to query both:
  1. `backlink_candidates WHERE status = 'pending_review'` (Flow 3)
  2. `content_drafts WHERE status = 'pending_review'` (Flow 2)
- Gives administrators a complete birds-eye view of all pending items across the entire platform.

---

## 3. Data Integrity & Edge Cases

1. **Idempotency:**
   Drafts in `content_drafts` have unique constraint `(solution_id, platform)`. Re-notifying does not alter database state or duplicate rows.
2. **Review State Synchronization:**
   Once a reviewer clicks "Approve" or "Reject", draft status transitions to `posted`, `ready_to_post`, or `rejected`.
   On the very next run, `NOT EXISTS (SELECT 1 FROM content_drafts WHERE status = 'pending_review')` evaluates to true, so the solution is marked fully processed and won't be sent again.
3. **No Infinite AI Loops:**
   Because AI generation is bypassed for solutions that already have drafts in `content_drafts`, no redundant API calls to Google Gemini occur.

---

## 4. Verification Plan

1. **Unit Tests:**
   - Test `/drafts` command logic and `/status` updates in `test-commands.js`.
   - Test SQL query behavior for pending vs completed drafts.
2. **Workflow Syntax & Validation:**
   - Run `node scripts/test-workflow-syntax.js` to ensure JavaScript in Code nodes is valid.
   - Sync workflow to n8n SQLite via `python scripts/sync-workflows.py`.
3. **End-to-End Simulation:**
   - Verify with existing pending drafts in DB (e.g. Solution 90).
   - Trigger Flow 2 webhook or test script and confirm Discord bot sends the review cards for Solution 90 without calling Gemini AI.
