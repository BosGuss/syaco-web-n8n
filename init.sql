-- SyaCo backlink pipeline: candidate store.
-- Mounted into the postgres container via /docker-entrypoint-initdb.d (runs once, on first start).
-- For an existing database run it by hand:
--   docker compose exec -T postgres psql -U backlinks -d backlinks < db/init.sql

CREATE TABLE IF NOT EXISTS backlink_candidates (
  id               bigserial PRIMARY KEY,
  -- Secret that goes into the Discord review link. Without it the link cannot be used.
  review_token     text        NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status           text        NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review', 'approved', 'manual', 'posted', 'rejected', 'failed', 'skipped')),

  solution_id      text,
  solution_title   text,
  solution_url     text,

  platform         text,            -- reddit | devto | bluesky
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
  posted_at        timestamptz
);

-- One row per thread, ever. This is what stops the daily run from suggesting the same post twice.
CREATE UNIQUE INDEX IF NOT EXISTS backlink_candidates_post_url_key ON backlink_candidates (post_url);
CREATE INDEX IF NOT EXISTS backlink_candidates_status_idx ON backlink_candidates (status, created_at DESC);

-- Status meanings
--   skipped         AI judged the post not relevant (kept so it is not paid for again)
--   pending_review  waiting for a human in Discord
--   approved        approved, Bluesky reply being posted
--   manual          approved, a human must paste it (Reddit, dev.to)
--   posted          live (Bluesky: posted by n8n, others: confirmed with "I posted it")
--   rejected        human said no
--   failed          posting failed, see error_message
