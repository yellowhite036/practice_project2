const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// ============================================================
// 設定：本地 Ollama 服務位址與使用的模型
// ============================================================
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct-q4_K_M";
const OLLAMA_TIMEOUT_MS = 60_000;

// ============================================================
// 分塊設定
// 小模型面對長列表容易看漏/看錯，所以把工單切成小塊分別處理，
// 而不是一次塞 100 筆進同一個 prompt。
// ============================================================
const WORK_ORDER_CHUNK_SIZE = 20; // 每塊幾筆工單，可依模型表現調整
const WORK_ORDER_FETCH_LIMIT = 100; // 資料庫最多撈幾筆

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function formatWorkOrderRow(w) {
  return `- ${w.work_order_id}：產品 ${w.product_id}，數量 ${w.quantity}，產線 ${w.line}，模具 ${w.mold_id}，狀態 ${w.status}，建立者 ${w.creator}`;
}

// ============================================================
// 撈取靜態資料（物料/模具/產品/BOM），這幾張表通常筆數不多，
// 先不分塊，直接組成文字。
// ============================================================
async function buildStaticContext(pool) {
  const [materials, molds, products, bom] = await Promise.all([
    pool.query(`SELECT material_id, name, unit, stock, capacity, safety_stock, location
                FROM materials ORDER BY material_id`),
    pool.query(`SELECT mold_id, name, status, line, eta, product_id
                FROM molds ORDER BY mold_id`),
    pool.query(`SELECT product_id, name, cycle_minutes, mold_id, stock
                FROM products ORDER BY product_id`),
    pool.query(`SELECT bom_id, product_id, material_id, amount_per_unit
                FROM bom_table ORDER BY bom_id`),
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

  return `【物料庫存】
${materialLines}

【模具狀態】
${moldLines}

【產品主檔】
${productLines}

【產品 BOM】
${bomLines}`;
}

// ============================================================
// 撈取工單並切塊，回傳「陣列的陣列」（每個子陣列是一塊）
// 依 created_at DESC 排序，所以第一塊一定包含最新的工單。
// ============================================================
async function fetchWorkOrderChunks(pool) {
  const { rows } = await pool.query(
    `SELECT work_order_id, product_id, quantity, line, mold_id, status,
            COALESCE(creator_name, creator_user_id) AS creator
     FROM work_orders
     ORDER BY created_at DESC, work_order_id DESC
     LIMIT ${WORK_ORDER_FETCH_LIMIT}`
  );
  return chunkArray(rows, WORK_ORDER_CHUNK_SIZE);
}

// ============================================================
// 呼叫本地 Ollama /api/chat（共用函式）
// ============================================================
async function callOllama(prompt) {
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
    return answer.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Map 階段：針對「每一塊」工單，個別問一次 LLM，
// 讓它只從這一小塊裡找答案，降低看漏/看錯的機率。
// 塊數太多時可考慮改成 Promise.all 平行呼叫，但要注意
// Ollama 是否能承受同時多個請求（多半是單一模型序列處理）。
// ============================================================
async function mapWorkOrderChunk(question, chunkRows, chunkIndex, totalChunks) {
  const chunkText = chunkRows.map(formatWorkOrderRow).join("\n");

  const prompt = `你是一個工廠 WMS+MES 系統的問答助手，正在分批檢視工單資料（第 ${chunkIndex + 1}/${totalChunks} 塊，本塊由新到舊排序）。
規則：
1. 只根據下方這一塊工單資料判斷，不要參考你自己的猜測或其他資料。
2. 如果這一塊裡面沒有跟問題直接相關的工單，請只回覆「本塊無相關資料」，不要編造。
3. 如果有相關資料，請條列列出相關的工單原始資訊（工單編號、產品、數量、產線、模具、狀態、建立者），不要加其他分析或結論。
4. 用繁體中文回答。

【本塊工單資料】
${chunkText}

【使用者問題】
${question}`;

  return callOllama(prompt);
}

// ============================================================
// Reduce 階段：把每一塊的回答彙整起來，做最終回答。
// ============================================================
async function reduceWorkOrderAnswers(question, staticContext, mapResults) {
  const relevantParts = mapResults
    .map((r, i) => `【第 ${i + 1} 塊結果】\n${r}`)
    .filter(part => !part.includes("本塊無相關資料") || mapResults.every(r => r.includes("本塊無相關資料")))
    .join("\n\n");

  const prompt = `你是一個工廠 WMS+MES 系統的問答助手。以下是系統的靜態資料，以及針對使用者問題，從「近期工單」分批檢視後蒐集到的相關資訊。請根據這些內容統整出最終答案。

規則：
1. 只能根據下方提供的資料回答，不要捏造資料裡沒有的內容。
2. 如果所有分塊都顯示「本塊無相關資料」，請明確說「目前資料不足以回答」。
3. 各分塊結果如果有工單編號重複或跨塊需要排序（例如「最新」「前N筆」類問題），請你自行依工單編號或建立時間邏輯排序後再回答。
4. 用繁體中文回答，簡潔清楚即可。

【系統靜態資料】
${staticContext}

【分批檢視工單後蒐集到的相關資訊】
${relevantParts || "(所有分塊皆無相關資料)"}

【使用者問題】
${question}`;

  return callOllama(prompt);
}

// ============================================================
// 規則式短路（保留原本邏輯）
// ============================================================
const LATEST_WORK_ORDER_KEYWORDS = ["最新", "最近", "最新的", "剛建立", "剛剛建立", "最後一筆", "最後一張"];
const WORK_ORDER_KEYWORDS = ["工單", "work order", "work_order"];

function isLatestWorkOrderQuestion(question) {
  const hasLatestKeyword = LATEST_WORK_ORDER_KEYWORDS.some(k => question.includes(k));
  const hasWorkOrderKeyword = WORK_ORDER_KEYWORDS.some(k => question.toLowerCase().includes(k.toLowerCase()));
  return hasLatestKeyword && hasWorkOrderKeyword;
}

async function answerLatestWorkOrderDirectly(pool) {
  const { rows } = await pool.query(
    `SELECT work_order_id, product_id, quantity, line, mold_id, status,
            COALESCE(creator_name, creator_user_id) AS creator, created_at
     FROM work_orders
     ORDER BY created_at DESC, work_order_id DESC
     LIMIT 1`
  );

  if (rows.length === 0) {
    return "目前資料庫裡沒有任何工單資料。";
  }

  const wo = rows[0];
  return `目前最新的工單是 ${wo.work_order_id}（產品：${wo.product_id}，數量：${wo.quantity}，產線：${wo.line}，模具：${wo.mold_id}，狀態：${wo.status}，建立者：${wo.creator}）。\n（此答案直接查詢資料庫最新紀錄，未經 LLM 生成，保證與資料庫一致）`;
}

// 新增：規則式短路「列出前N筆工單」
const LIST_WORK_ORDER_PATTERN = /(列出|顯示|給我).{0,4}(前|最近|最新)\s*(\d+)\s*(筆|張|個).{0,4}工單/;

function extractListWorkOrderCount(question) {
  const match = question.match(LIST_WORK_ORDER_PATTERN);
  return match ? parseInt(match[3], 10) : null;
}

async function answerWorkOrderListDirectly(pool, count) {
  const limit = Math.min(Math.max(count, 1), 50);
  const { rows } = await pool.query(
    `SELECT work_order_id, product_id, quantity, line, mold_id, status,
            COALESCE(creator_name, creator_user_id) AS creator
     FROM work_orders
     ORDER BY created_at DESC, work_order_id DESC
     LIMIT $1`,
    [limit]
  );

  if (rows.length === 0) {
    return "目前資料庫裡沒有任何工單資料。";
  }

  const lines = rows.map((w, i) => `${i + 1}. ${w.work_order_id}：產品 ${w.product_id}，數量 ${w.quantity}，產線 ${w.line}，模具 ${w.mold_id}，狀態 ${w.status}，建立者 ${w.creator}`).join("\n");

  return `依建立時間由新到舊，前 ${rows.length} 筆工單如下：\n${lines}\n（此答案直接查詢資料庫，未經 LLM 生成，保證與資料庫一致）`;
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

      // 規則式短路 1：最新工單
      if (isLatestWorkOrderQuestion(trimmed)) {
        try {
          const answer = await answerLatestWorkOrderDirectly(pool);
          return res.json({ answer });
        } catch (dbError) {
          console.error("[question] 規則式查詢最新工單失敗:", dbError);
          throw createHttpError(503, "查詢資料庫失敗，請稍後再試");
        }
      }

      // 規則式短路 2：列出前N筆工單
      const listCount = extractListWorkOrderCount(trimmed);
      if (listCount !== null) {
        try {
          const answer = await answerWorkOrderListDirectly(pool, listCount);
          return res.json({ answer });
        } catch (dbError) {
          console.error("[question] 規則式查詢工單清單失敗:", dbError);
          throw createHttpError(503, "查詢資料庫失敗，請稍後再試");
        }
      }

      // 其餘問題：走分塊 Map-Reduce 流程
      let staticContext;
      let workOrderChunks;
      try {
        [staticContext, workOrderChunks] = await Promise.all([
          buildStaticContext(pool),
          fetchWorkOrderChunks(pool),
        ]);
      } catch (dbError) {
        console.error("[question] 查詢資料庫失敗:", dbError);
        throw createHttpError(503, "查詢資料庫失敗，請稍後再試");
      }

      let answer;
      try {
        if (workOrderChunks.length === 0) {
          // 沒有工單資料時，直接用靜態資料問一次即可
          answer = await callOllama(
            `你是一個工廠 WMS+MES 系統的問答助手。請根據下方資料回答問題，若資料不足請明確說「目前資料不足以回答」。用繁體中文回答。\n\n【系統靜態資料】\n${staticContext}\n\n（目前沒有任何工單資料）\n\n【使用者問題】\n${trimmed}`
          );
        } else {
          // Map 階段：依序（或平行）處理每一塊
          const mapResults = [];
          for (let i = 0; i < workOrderChunks.length; i++) {
            const result = await mapWorkOrderChunk(trimmed, workOrderChunks[i], i, workOrderChunks.length);
            mapResults.push(result);
          }
          // Reduce 階段：彙整所有分塊結果
          answer = await reduceWorkOrderAnswers(trimmed, staticContext, mapResults);
        }
      } catch (llmError) {
        console.error("[question] 呼叫本地模型失敗:", llmError);
        throw createHttpError(503, "本地模型服務目前無法回應，請確認 Ollama 是否已啟動");
      }

      res.json({ answer });
    })
  );

  return router;
};