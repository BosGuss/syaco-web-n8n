-- SyaCo Content Automation & Backlink Pipeline Schema
-- Mounted into the postgres container via /docker-entrypoint-initdb.d (runs once on first start).

-- ==========================================
-- 1. Table: solution_suggestions (Flow 1)
-- ==========================================
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
  published_at TIMESTAMPTZ,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_solution_suggestions_status ON solution_suggestions (status, created_at DESC);

-- ==========================================
-- 2. Table: processed_solutions (Flow 2 Idempotency)
-- ==========================================
CREATE TABLE IF NOT EXISTS processed_solutions (
  solution_id TEXT PRIMARY KEY,
  solution_title TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 3. Table: content_drafts (Flow 2 Multi-Platform Drafts)
-- ==========================================
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
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  CONSTRAINT uq_solution_platform UNIQUE (solution_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_lookup ON content_drafts (status, platform, created_at DESC);

-- ==========================================
-- 4. Table: backlink_candidates (Flow 3)
-- ==========================================
CREATE TABLE IF NOT EXISTS backlink_candidates (
  id               bigserial PRIMARY KEY,
  review_token     text        NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status           text        NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review', 'approved', 'manual', 'posted', 'rejected', 'failed', 'skipped')),

  solution_id      text,
  solution_title   text,
  solution_url     text,

  platform         text,            -- reddit | devto | bluesky | pantip | blognone | blockdit | facebook_group
  post_title       text,
  post_url         text        NOT NULL,
  search_query     text,
  matched_problem  text,
  match_score      numeric(4, 3),
  relevance_reason text,

  answer           text,
  link_included    boolean,
  link_reason      text,
  suggested_anchor text,

  posted_url       text,
  error_message    text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  posted_at        timestamptz,
  reviewed_by      text
);

CREATE UNIQUE INDEX IF NOT EXISTS backlink_candidates_post_url_key ON backlink_candidates (post_url);
CREATE INDEX IF NOT EXISTS backlink_candidates_status_idx ON backlink_candidates (status, created_at DESC);

-- ==========================================
-- 5. Table: bot_settings (Discord Bot Runtime Settings)
-- ==========================================
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

