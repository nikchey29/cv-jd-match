-- The score leaves unverified requirements out of its denominator. When every
-- requirement is unverified there is nothing to score, so the score is NULL.
ALTER TABLE match_runs ALTER COLUMN score DROP NOT NULL;

-- From this migration on, ungrounded_count means "quotes still not found in
-- the CV after the repair pass". Older rows counted quotes before any repair.
COMMENT ON COLUMN match_runs.ungrounded_count IS
  'Evidence or rewrite quotes still not found in the CV after the repair pass';
COMMENT ON COLUMN match_runs.score IS
  '0-100 over met, partly met and not met requirements; NULL when none could be scored';
