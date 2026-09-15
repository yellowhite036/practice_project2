-- Give each mold a user-managed classification; name/code remain independently editable.
ALTER TABLE molds ADD COLUMN IF NOT EXISTS mold_type VARCHAR(100);

-- Legacy -L1/-L2/-L3 records are retained for historical work orders, but no
-- longer participate in new scheduling. The base mold becomes the shared mold.
UPDATE molds
SET is_active = FALSE, updated_at = now()
WHERE mold_id ~ '-L[0-9]+$' AND is_active = TRUE;

UPDATE molds
SET line = NULL, updated_at = now()
WHERE is_active = TRUE AND line IS NOT NULL;
