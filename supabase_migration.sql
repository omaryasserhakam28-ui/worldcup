-- ================================================================
-- WCPL 2026 — Supabase Migration
-- Run this ONCE in your Supabase SQL Editor before deploying
-- ================================================================

-- 1. Knockout Extras Predictions table
--    Stores extra predictions for R32+ matches (ET, pens, HT, who advances)
CREATE TABLE IF NOT EXISTS knockout_extras (
  id              bigserial PRIMARY KEY,
  username        text NOT NULL,
  match_id        text NOT NULL,
  extra_time      text,           -- 'yes' or 'no'
  penalties       text,           -- 'yes' or 'no'
  halftime        text,           -- 'home', 'draw', or 'away'
  advancing_team  text,           -- team name predicted to advance (bracket pick)
  pts_earned      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(username, match_id)
);

-- Enable Row Level Security (keep consistent with your other tables)
ALTER TABLE knockout_extras ENABLE ROW LEVEL SECURITY;

-- Allow anon key full access (same as your other tables)
CREATE POLICY "Allow anon all on knockout_extras"
  ON knockout_extras FOR ALL
  TO anon USING (true) WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ko_extras_username  ON knockout_extras(username);
CREATE INDEX IF NOT EXISTS idx_ko_extras_match_id  ON knockout_extras(match_id);

-- ================================================================
-- IF YOU ALREADY RAN THE MIGRATION BEFORE (table alrea