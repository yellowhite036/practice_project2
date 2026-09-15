const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct-q4_K_M";
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

async function buildDatabaseContext(pool) {
  const [materials, molds, products, bom, workOrders, lines, rates, moldOptions] = await Promise.all([
    pool.query("SELECT material_id, name, unit, stock, capacity, safety_stock, location FROM materials ORDER BY material_id"),
    pool.query("SELECT mold_id, name, status, line, eta, product_id FROM molds ORDER BY mold_id"),
    pool.query("SELECT product_id, name, cycle_minutes, mold_id, stock FROM products ORDER BY product_id"),
    pool.query("SELECT bom_id, product_id, material_id, amount_per_unit FROM bom_table ORDER BY bom_id"),
    pool.query("SELECT work_order_id, product_id, quantity, line, mold_id, status, created_at FROM work_orders ORDER BY created_at DESC, work_order_id DESC LIMIT 100"),
    pool.query("SELECT id, name FROM production_lines WHERE is_active = TRUE ORDER BY name"),
    pool.query("SELECT lir.line_id, lir.product_id, lir.units_per_hour FROM line_item_rates lir JOIN production_lines pl ON pl.id = lir.line_id WHERE pl.is_active = TRUE"),
    pool.query("SELECT imo.product_id, imo.mold_id, imo.is_preferred FROM item_mold_options imo JOIN molds m ON m.mold_id = imo.mold_id WHERE m.is_active = TRUE")
  ]);
  const context = [
    "【物料庫存】",
    materials.rows.map(row => "- " + row.material_id + " " + row.name + "：庫存 " + row.stock + row.unit + "，安全庫存 " + row.safety_stock + row.unit + "，容量上限 " + (row.capacity ?? "無")).join("\n") || "(無物料資料)",
    "【模具狀態】",
    molds.rows.map(row => "- " + row.mold_id + " " + row.name + "：狀態 " + row.status + "，綁定產品 " + (row.product_id ?? "無")).join("\n") || "(無模具資料)",
    "【產品主檔】",
    products.rows.map(row => "- " + row.product_id + " " + row.name + "：目前庫存 " + row.stock + "，模具 " + row.mold_id).join("\n") || "(無產品資料)",
    "【產品 BOM】",
    bom.rows.map(row => "- " + row.product_id + " 需要 " + row.material_id + " × " + row.amount_per_unit + "/件").join("\n") || "(無 BOM 資料)",
    "【近期工單】",
    workOrders.rows.map(row => "- " + row.work_order_id + "：產品 " + row.product_id + "，數量 " + row.quantity + "，產線 " + row.line + "，模具 " + row.mold_id + "，狀態 " + row.status).join("\n") || "(無工單資料)",
    "【可排程產線能力】",
    rates.rows.map(row => "- 產線 " + (lines.rows.find(line => line.id === row.line_id)?.name || row.line_id) + " 可生產 " + row.product_id + "：" + row.units_per_hour + "/小時").join("\n") || "(尚未設定任何產線能力)",
    "【品項可用模具】",
    moldOptions.rows.map(row => "- " + row.product_id + "：" + row.mold_id + (row.is_preferred ? "（優先）" : "")).join("\n") || "(無模具對應資料)"
  ].join("\n\n");
  return { context, products: products.rows, lines: lines.rows, rates: rates.rows, moldOptions: moldOptions.rows };
}

function extractJsonArray(text) {
  const fence = String.fromCharCode(96).repeat(3);
  const cleaned = text.trim()
    .replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "")
    .replace(new RegExp("\\s*" + fence + "$"), "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("模型未回傳 JSON 陣列");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function askOllama(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: "user", content: prompt }], stream: false, options: { temperature: 0 } }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Ollama HTTP " + response.status);
    const data = await response.json();
    if (!data?.message?.content) throw new Error("Ollama 回應格式不正確");
    return data.message.content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = function createAutoOrdersRouter(pool) {
  const router = Router();
  router.post("/", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const database = await buildDatabaseContext(pool);
    const products = database.products;
    const lineById = new Map(database.lines.map(line => [line.id, line.name]));
    const validLinesByProduct = new Map();
    for (const rate of database.rates) {
      const name = lineById.get(rate.line_id);
      if (!name || Number(rate.units_per_hour) <= 0) continue;
      if (!validLinesByProduct.has(rate.product_id)) validLinesByProduct.set(rate.product_id, new Set());
      validLinesByProduct.get(rate.product_id).add(name);
    }
    const validMoldsByProduct = new Map();
    for (const option of database.moldOptions) {
      if (!validMoldsByProduct.has(option.product_id)) validMoldsByProduct.set(option.product_id, []);
      validMoldsByProduct.get(option.product_id).push(option.mold_id);
    }
    const prompt = [
      "你是製造工單規劃助手。請只依據提供的資料庫資料，找出需要建立的生產工單。",
      "規則：",
      "1. 只能使用產品主檔中存在的 product_id，絕不能自創產品、數量、需求或日期。",
      "2. 只有資料庫具有可明確支持的需求、缺貨或排程資料時才提出工單；資料不足請回傳 []。",
      "3. quantity 必須是正整數；line 必須是該產品在「可排程產線能力」中列出的產線。",
      "4. reason 必須引用資料庫內具體的數字或紀錄。",
      "5. 只回傳 JSON 陣列，不要 Markdown 或說明。",
      "格式：[{\"product_id\":\"產品 ID\",\"quantity\":100,\"line\":\"L1\",\"reason\":\"資料庫中的具體依據\"}]",
      "【資料庫資料】", database.context
    ].join("\n\n");

    let raw;
    try {
      raw = await askOllama(prompt);
    } catch (error) {
      console.error("[auto-orders] Ollama failed:", error);
      throw createHttpError(503, "本地模型服務目前無法回應，請確認 Ollama 是否已啟動");
    }
    let candidates;
    try {
      candidates = extractJsonArray(raw);
    } catch (error) {
      console.error("[auto-orders] Invalid model output:", raw.slice(0, 500));
      throw createHttpError(502, "模型未回傳有效的工單建議格式");
    }
    if (!Array.isArray(candidates)) throw createHttpError(502, "模型未回傳工單建議陣列");

    const productById = new Map(products.map(product => [product.product_id, product]));
    const proposals = candidates.flatMap(candidate => {
      const productId = typeof candidate?.product_id === "string" ? candidate.product_id.trim() : "";
      const quantity = Number(candidate?.quantity);
      const line = typeof candidate?.line === "string" ? candidate.line.trim() : "";
      const product = productById.get(productId);
      if (!product || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100_000 || !validLinesByProduct.get(productId)?.has(line)) return [];
      const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";
      if (!reason) return [];
      return [{
        product_id: productId,
        product_name: product.name,
        quantity,
        line,
        mold_id: validMoldsByProduct.get(productId)?.[0] || product.mold_id,
        reason
      }];
    });
    res.json({ sources: ["materials", "molds", "products", "bom_table", "work_orders", "production_lines", "line_item_rates", "item_mold_options"], proposals });
  }));
  return router;
};
