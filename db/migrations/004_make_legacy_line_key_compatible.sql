-- Legacy deployments require a text line_id primary key. Keep it populated so
-- the new /lines API can create lines without special-casing database versions.
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS line_id TEXT;
UPDATE production_lines SET line_id = name WHERE line_id IS NULL;
ALTER TABLE production_lines ALTER COLUMN line_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS production_lines_line_id_unique_idx ON production_lines(line_id);
