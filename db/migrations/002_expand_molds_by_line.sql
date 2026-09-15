-- 每一種基礎模具在 L1、L2、L3 各保有一副獨立模具。
-- 原始模具保留原 ID 與既有外鍵關聯；只補上尚未配置的產線副本。
INSERT INTO molds (
  mold_id,
  name,
  status,
  line,
  eta,
  product_id
)
SELECT
  base.mold_id || '-' || target.line,
  base.name || '（' || target.line || '）',
  'Idle',
  target.line,
  NULL,
  base.product_id
FROM molds AS base
CROSS JOIN (VALUES ('L1'), ('L2'), ('L3')) AS target(line)
WHERE base.mold_id IN ('MOLD-BOTTLE', 'MOLD-BOX', 'MOLD-PLATE', 'MOLD-TUBE')
  AND base.line IS DISTINCT FROM target.line
  AND NOT EXISTS (
    SELECT 1
    FROM molds AS existing
    WHERE existing.mold_id = base.mold_id || '-' || target.line
  );
