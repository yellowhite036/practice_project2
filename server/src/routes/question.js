const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// ============================================================
// 設定：本地 Ollama 服務位址與使用的模型
// 跟 agent.py 裡的 LLM_MODEL 保持一致，方便對照
// ============================================================
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct-q4_K_M";
const OLLAMA_TIMEOUT_MS = 60_000; // 逾時保護，避免 Ollama 卡住時前端一直轉圈

// ============================================================
// 即時查詢資料庫，組成給 LLM 看的 context 文字
// 這裡先簡化成「每次都撈全部相關表」（方案 1），
// 表名/欄位名請依你實際的資料表結構調整。
// ============================================================
async function buildContextFromDatabase(pool) {
  const [materials, molds, products, bom, workOrders] = await Promise.all([
    pool.query(`SELECT material_id, name, unit, stock, capacity, safety_stock, location
                FROM materials ORDER BY material_id`),
    pool.query(`SELECT mold_id, name, status, line, eta, product_id
                FROM molds ORDER BY mold_id`),
    pool.query(`SELECT product_id, name, cycle_minutes, mold_id, stock
                FROM products ORDER BY product_id`),
    pool.query(`SELECT bom_id, product_id, material_id, amount_per_unit
                FROM bom_table ORDER BY bom_id`),
    // 工單表可能會持續累積，先只撈最近 100 筆，避免 prompt 過長
    pool.query(`SELECT work_order_id, product_id, quantity, line, mold_id, status,
                       COALESCE(creator_name, creator_user_id) AS creator
                FROM work_orders
                ORDER BY created_at DESC, work_order_id DESC
                LIMIT 100`),
  ]);

  const materialLines = materials.rows
    .map(m => `- ${m.material_id} ${m.name}：庫存 ${m.stock}${m.unit}，安全庫存 ${m.safety_stock}${m.unit}，容量上限 ${m.capacity ?? "無"}，儲位 ${m.location}`)
    .join("\n") || "(無物料資料)";

  const moldLines = molds.rows
    .map(m => `- ${m.mold_id} ${m.name}：狀態 ${m.status}，產線 ${m.line ?? "-"}，預計放開 ${m.eta ?? "-"}，綁定產品 ${m.product_id ?? "無"}`)
    .join("\n") || "(無模具資料)";

  const productLines = products.rows
    .map(p => `- ${p.product_id} ${p.name}：週期 ${p.cycle_minutes} 分鐘/件，使用模具 ${p.mold_id}，目前庫存 ${p.stock}`)
    .join("\n") || "(無產品資料)";

  const bomLines = bom.rows
    .map(b => `- ${b.bom_id}：產品 ${b.product_id} 需要材料 ${b.material_id} × ${b.amount_per_unit}/件`)
    .join("\n") || "(無 BOM 資料)";

  const workOrderLines = workOrders.rows
    .map(w => `- ${w.work_order_id}：產品 ${w.product_id}，數量 ${w.quantity}，產線 ${w.line}，模具 ${w.mold_id}，狀態 ${w.status}，建立者 ${w.creator}`)
    .join("\n") || "(無工單資料，或目前沒有近期工單)";

  return `【物料庫存】
${materialLines}

【模具狀態】
${moldLines}

【產品主檔】
${productLines}

【產品 BOM】
${bomLines}

【近期工單（最多 100 筆，依工單編號新到舊排序）】
${workOrderLines}`;
}

// ============================================================
// 呼叫本地 Ollama /api/chat
// ============================================================
async function askOllama(question, contextText) {
  const prompt = `你是一個工廠 WMS+MES 系統的問答助手。請根據下方【系統目前資料】回答使用者的問題。
規則：
1. 只能根據提供的資料回答，不要捏造資料裡沒有的內容。
2. 如果資料不足以回答，請明確說「目前資料不足以回答」。
3. 用繁體中文回答，簡潔清楚即可。

【系統目前資料】
${contextText}

【使用者問題】
${question}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama 回應狀態碼異常: ${response.status}`);
    }

    const data = await response.json();
    const answer = data?.message?.content;
    if (!answer) {
      throw new Error("Ollama 回應格式不符，沒有取得 message.content");
    }
    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = function createQuestionRouter(pool) {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    requireRole(["admin", "manager", "operator"]),
    asyncRoute(async (req, res) => {
      const { question } = req.body;
      const trimmed = typeof question === "string" ? question.trim() : "";
      if (!trimmed) {
        throw createHttpError(400, "A valid question string is required");
      }

      let contextText;
      try {
        contextText = await buildContextFromDatabase(pool);
      } catch (dbError) {
        console.error("[question] 查詢資料庫失敗:", dbError);
        throw createHttpError(503, "查詢資料庫失敗，請稍後再試");
      }

      let answer;
      try {
        answer = await askOllama(trimmed, contextText);
      } catch (llmError) {
        console.error("[question] 呼叫本地模型失敗:", llmError);
        throw createHttpError(503, "本地模型服務目前無法回應，請確認 Ollama 是否已啟動");
      }

      res.json({ answer });
    })
  );

  return router;
};