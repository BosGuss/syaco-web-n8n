-- Migration: Add reviewed_by and reviewed_at tracking to tables

ALTER TABLE solution_suggestions ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE content_drafts ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE backlink_candidates ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
