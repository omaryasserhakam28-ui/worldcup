-- ================================================================
-- WCPL 2026 — Reset All Penalties to 1 Strike at -3 pts
-- Run in Supabase SQL Editor
-- ================================================================

-- Step 1: Keep only the oldest penalty record per user, delete all extras
DELETE FROM penalties
WHERE id NOT IN (
  SELECT MIN(id) FROM penalties GROUP BY username
);

-- Step 2: Set all remaining penalty records to -3 pts
UPDATE penalties SET pts = -3;

-- Step 3: Recalculate total_pts for every player from scratch
UPDATE players p
SET total_pts =
  COALESCE((SELECT SUM(pts_earned) FROM match_predictions WHERE username = p.username), 0)
  + COALESCE((SELECT SUM(pts)       FROM penalties           WHERE username = p.username), 0)
  + COALESCE((SELECT SUM(pts_earned) FROM knockout_extras    WHERE username = p.username), 0)
  + COALESCE(p.manual_pts_adjustment, 0);

-- ================================================================
-- Done. Every penalized player now has exactly 1 strike = -3 pts.
-- ================================================================
