-- A mold is a shared resource. This table only declares which lines may use it;
-- it never creates one mold per line.
CREATE TABLE IF NOT EXISTS line_mold_options (
  line_id INTEGER NOT NULL REFERENCES production_lines(id),
  mold_id TEXT NOT NULL REFERENCES molds(mold_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, mold_id)
);

CREATE INDEX IF NOT EXISTS idx_line_mold_options_mold ON line_mold_options(mold_id);
