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
