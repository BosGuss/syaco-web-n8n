# Unified Anti-Spam & Humanizer Shared Prompt Implementation Plan

- **Date:** 2026-11-19
- **Goal:** Consolidate writing, zero-AI-footprint, and humanizer rules from `skills/anti_spam.md` and `skills/humanizer.md` into a single canonical shared block, eliminating duplication in Flow 3 and introducing full anti-spam/humanizer standards into Flow 2.

## Proposed Changes

### 1. Single Source of Truth
- **File:** `skills/shared_persona_rules.js`
  - Defines `SHARED_WRITING_AND_ANTI_SPAM_RULES`
  - Defines `PLATFORM_VOICE_GUIDELINES` (Pantip, LinkedIn, Facebook, Bluesky, Dev.to, Manual Article)
  - Exports prompt generation helpers
- **File:** `skills/shared_persona_rules.md`
  - Markdown documentation detailing the unified guidelines and how they are shared across flows.

### 2. Workflows Update
- **File:** `workflows/flow2-content-publisher.json`
  - Update node `Build AI Prompts for Call A & B` (`f2-node-build-prompts`) with the shared rules and platform voices for Bluesky, Dev.to, and Manual Article.
- **File:** `workflows/flow3-community-lead-assistant.json`
  - Update node `Build Lead Qualification & Draft Prompt` (`f3-node-build-prompt`) to use the exact shared rules.

### 3. Sync & Automation
- **File:** `scripts/sync-workflows.py`
  - Ensure workflows sync seamlessly to SQLite (`n8n_data/database.sqlite`).

### 4. Testing & Verification
- **File:** `scripts/test-flow2.js`
  - Add test verifying that Flow 2 prompt generation includes the unified rules.
- **File:** `scripts/test-flow3.js`
  - Add test verifying that Flow 3 prompt generation includes the unified rules.
- **File:** `scripts/check-node-references.js`
  - Verify all `$('<node>')` references remain intact.

## Verification Plan
1. Run `node scripts/test-flow2.js` -> Must pass.
2. Run `node scripts/test-flow3.js` -> Must pass.
3. Run `node scripts/check-node-references.js` -> Must pass without broken references.
4. Run `python scripts/sync-workflows.py` -> Must update workflow entities in SQLite.
