-- One row per successful /api/match request.
-- By design there is NO column for the job description or CV text.
CREATE TABLE IF NOT EXISTS match_runs (
  id                uuid        PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now(),
  score             smallint    NOT NULL CHECK (score BETWEEN 0 AND 100),
  requirement_count integer     NOT NULL CHECK (requirement_count >= 0),
  ungrounded_count  integer     NOT NULL CHECK (ungrounded_count >= 0),
  latency_ms        integer     NOT NULL CHECK (latency_ms >= 0),
  model             text        NOT NULL,
  -- Filled in later by /api/feedback. NULL means "no feedback yet".
  helpful           boolean,
  feedback_at       timestamptz
);
