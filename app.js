const STORAGE_KEY = "wms-mes-demo-state-v23";

const initialMaterials = [
  { id: "MAT-STEEL", name: "鋼鐵", unit: "kg", stock: 1500, capacity: 2000, safety: 300, location: "A-01-01" },
  { id: "MAT-PLASTIC", name: "塑膠", unit: "kg", stock: 1200, capacity: 2000, safety: 400, location: "A-01-02" },
  { id: "MAT-WOOD", name: "木材", unit: "kg", stock: 800, capacity: 1500, safety: 200, location: "B-01-01" },
  { id: "MAT-GLASS", name: "玻璃", unit: "kg", stock: 600, capacity: 1000, safety: 150, location: "B-01-02" }
];

const initialMolds = [
  { id: "MOLD-TUBE", name: "長管塑型模具", status: "Idle", line: "-", eta: "-", productId: "" },
  { id: "MOLD-BOTTLE", name: "水壺模具", status: "Idle", line: "-", eta: "-", productId: "" },
  { id: "MOLD-BOX", name: "方塊模具", status: "Idle", line: "-", eta: "-", productId: "" },
  { id: "MOLD-PLATE", name: "平板模具", status: "Idle", line: "-", eta: "-", productId: "" }
];

const productNames = {
  "MAT-STEEL_MOLD-TUBE": "鋼管",
  "MAT-PLASTIC_MOLD-TUBE": "塑膠管",
  "MAT-STEEL_MOLD-BOTTLE": "鐵水壺",
  "MAT-PLASTIC_MOLD-BOTTLE": "水壺",
};

const initialProducts = [];
initialMaterials.forEach(mat => {
  initialMolds.forEach(mold => {
    const key = `${mat.id}_${mold.id}`;
    let pName = productNames[key];
    if (!pName) {
      const shortMat = mat.name.replace("鋼鐵", "鐵").replace("木材", "木");
      const shortMold = mold.name.replace("模具", "").replace("塑型", "");
      pName = `${shortMat}${shortMold}`;
    }
    const productId = `PRD-${mat.id.split('-')[1]}-${mold.id.split('-')[1]}`;
    if (!mold.productId) mold.productId = productId;

    initialProducts.push({
      id: productId,
      name: pName,
      cycleMinutes: 20 + ((mat.id.length + mold.id.length) % 4) * 10,
      moldId: mold.id,
      stock: 0
    });
  });
});

const initialBomTable = [];
let _bomSeq = 1;
initialProducts.forEach(product => {
  const matId = product.id.includes("STEEL") ? "MAT-STEEL" : product.id.includes("PLASTIC") ? "MAT-PLASTIC" : product.id.includes("WOOD") ? "MAT-WOOD" : "MAT-GLASS";
  initialBomTable.push({
    bomId: `BOM-${String(_bomSeq++).padStart(4, "0")}`,
    productId: product.id,
    materialId: matId,
    amountPerUnit: matId === "MAT-STEEL" ? 2.5 : 1.5
  });
});

const seedState = {
  role: "operator",
  activeView: "workorders",
  materials: initialMaterials,
  molds: initialMolds,
  products: initialProducts,
  bomTable: initialBomTable,
  workOrders: [
    { id: "WO-260804-001", productId: "PRD-STEEL-TUBE", quantity: 100, line: "L1", moldId: "MOLD-TUBE", status: "已完工", creator: "管理員" }
  ],
  lastAutomation: null,
  logs: [
    { type: "INFO", message: "系統初始化：載入材料、模具與產品主資料。", time: "08:00:00" }
  ]
};

// ─────────────────────────────────────────────
// DATABASE CONSTRAINT LAYER
// Mirrors SQL-level rules enforced at the data layer:
//   CHECK (stock >= 0)          — material quantity
//   ENUM ('Idle','In_Use')      — mold status
// ─────────────────────────────────────────────

const MOLD_STATUS_ENUM = Object.freeze(["Idle", "In_Use"]);

/**
 * DB CHECK: material stock cannot go below 0.
 * Throws a constraint error string if violated.
 * @param {number} newStock - proposed new stock value
 * @param {string} materialName - for error message
 */
function dbCheckStock(newStock, materialName) {
  if (newStock < 0) {
    throw new Error(`[DB CONSTRAINT] CHECK (stock >= 0) 違反：${materialName} 扣減後庫存為 ${newStock.toFixed(2)}，不可為負數。`);
  }
}

/**
 * DB CHECK: mold status must be one of the defined ENUM values.
 * Throws a constraint error string if violated.
 * @param {string} newStatus - proposed new status
 */
function dbCheckMoldStatus(newStatus) {
  if (!MOLD_STATUS_ENUM.includes(newStatus)) {
    throw new Error(`[DB CONSTRAINT] ENUM ('${MOLD_STATUS_ENUM.join("','")}'}) 違反：模具狀態「${newStatus}」不在允許的 Enum 值中。`);
  }
}

/**
 * Safe wrapper: set material stock with DB constraint check.
 * Returns { ok: true } or { ok: false, error: string }
 */
function setMaterialStock(material, newStock) {
  try {
    dbCheckStock(newStock, material.name);
    material.stock = Number(newStock.toFixed(2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Safe wrapper: set mold status with DB constraint check.
 * Returns { ok: true } or { ok: false, error: string }
 */
function setMoldStatus(mold, newStatus) {
  try {
    dbCheckMoldStatus(newStatus);
    mold.status = newStatus;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

let state = loadState();

const viewTitles = {
  workorders: "工單派發",
  materials: "材料庫存",
  molds: "模具排程",
  products: "產品 BOM",
  logs: "系統紀錄"
};

const roleNotes = {
  operator: "可建立工單、執行自動領料與查看現場狀態。",
  admin: "可補料、釋放模具、重置模擬資料並追蹤異常。"
};

const automationTemplate = [
  ["讀取 BOM", "依產品主檔展開單位用量並乘上工單數量。"],
  ["檢查 WMS 庫存", "比對可用庫存、安全量與領料需求。"],
  ["查詢模具狀態", "確認產品綁定模具可用，並分配到指定產線。"],
  ["扣減材料", "寫入庫存異動並保留扣帳紀錄。"],
  ["建立 MES 工單", "產生工單號碼，更新現場看板與排程。"]
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // 自動修正舊版沒有 bomTable 的問題，或合併資料
      if (!parsed.bomTable) {
        parsed.bomTable = initialBomTable;
      }
      return { ...structuredClone(seedState), ...parsed };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return structuredClone(seedState);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatAmount(value) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function nowTime() {
  return new Date().toLocaleTimeString("zh-TW", { hour12: false });
}

function addLog(type, message) {
  state.logs.unshift({ type, message, time: nowTime() });
  state.logs = state.logs.slice(0, 30);
}

function getProduct(id) {
  return state.products.find((product) => product.id === id);
}

function getMaterial(id) {
  return state.materials.find((material) => material.id === id);
}

function getMold(id) {
  return state.molds.find((mold) => mold.id === id);
}

function getBomForProduct(productId) {
  return (state.bomTable || []).filter(row => row.productId === productId).map(row => ({
    ...row,
    name:  getMaterial(row.materialId)?.name  || row.materialId,
    unit:  getMaterial(row.materialId)?.unit  || "",
    stock: getMaterial(row.materialId)?.stock ?? 0
  }));
}

function calculateRequirements(productId, quantity) {
  const bomRows = getBomForProduct(productId);
  return bomRows.map((row) => {
    const material = getMaterial(row.materialId);
    return {
      ...row,
      name:       material.name,
      unit:       material.unit,
      stock:      material.stock,
      required:   row.amountPerUnit * quantity,
      afterStock: material.stock - row.amountPerUnit * quantity
    };
  });
}

function render() {
  renderRole();
  renderNavigation();
  renderMetrics();
  renderMaterialOptions();
  renderMoldOptions();
  renderCombinedProduct();
  renderPreview();
  renderAutomationSteps(state.lastAutomation);
  renderWorkOrders();
  renderMaterials();
  renderMolds();
  renderProducts();
  renderLogs();
  saveState();
}

function renderRole() {
  $$(".role-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.role === state.role);
  });

  $("#roleNote").textContent = roleNotes[state.role];
  $("#permissionBadge").textContent = state.role === "admin" ? "管理員模式" : "作業員模式";

  $$(".nav-button.admin-only").forEach((button) => {
    button.classList.toggle("hidden", state.role !== "admin");
  });

  $$(".admin-only:not(.nav-button)").forEach((button) => {
    const isAdmin = state.role === "admin";
    button.classList.toggle("hidden", !isAdmin);
    button.disabled = !isAdmin;
    button.title = isAdmin ? "" : "此操作限管理員";
  });

  if (state.role !== "admin" && ["molds", "products", "logs"].includes(state.activeView)) {
    state.activeView = "workorders";
  }
}

function renderNavigation() {
  $("#viewTitle").textContent = viewTitles[state.activeView];
  $$(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  $$(".view").forEach((view) => {
    view.classList.toggle("active", view.id === state.activeView);
  });
}

function renderMetrics() {
  const healthyMaterials = state.materials.filter((material) => material.stock > material.safety).length;
  const availableMolds = state.molds.filter((mold) => mold.status === "available").length;
  const exceptions = state.logs.filter((log) => log.type === "WARN" || log.type === "ERR").length;

  $("#materialHealth").textContent = `${healthyMaterials}/${state.materials.length}`;
  $("#moldHealth").textContent = `${availableMolds}/${state.molds.length}`;
  $("#workOrderCount").textContent = state.workOrders.length;
  $("#exceptionCount").textContent = exceptions;
}

function renderMaterialOptions() {
  const select = $("#materialSelect");
  if (!select) return;
  const currentValue = select.value || state.materials[0].id;
  select.innerHTML = state.materials
    .map((mat) => `<option value="${mat.id}">${mat.name}</option>`)
    .join("");
  select.value = state.materials.some((m) => m.id === currentValue) ? currentValue : state.materials[0].id;
}

function renderMoldOptions() {
  const select = $("#moldSelect");
  if (!select) return;
  const currentValue = select.value || state.molds[0].id;
  select.innerHTML = state.molds
    .map((mold) => `<option value="${mold.id}">${mold.name} (${translateMoldStatus(mold.status)})</option>`)
    .join("");
  select.value = state.molds.some((mold) => mold.id === currentValue) ? currentValue : state.molds[0].id;
}

function getDerivedProduct() {
  const matId = $("#materialSelect") ? $("#materialSelect").value : null;
  const moldId = $("#moldSelect") ? $("#moldSelect").value : null;
  if (!matId || !moldId) return state.products[0];
  return state.products.find((p) => p.bom.some((b) => b.materialId === matId) && p.moldId === moldId) || state.products[0];
}

function renderCombinedProduct() {
  const el = $("#productResult");
  if (!el) return;
  const product = getDerivedProduct();
  if (!product) {
    el.innerHTML = `<div class="product-result-none">⚠️ 此組合尚未定義產品</div>`;
    return;
  }
  const mold = getMold(product.moldId);
  el.innerHTML = `
    <div class="product-result-inner">
      <span class="product-result-label">組合產品</span>
      <span class="product-result-name">${product.name}</span>
      <span class="status-pill ${mold && mold.status === 'Idle' ? 'ok' : 'warn'}">${mold ? translateMoldStatus(mold.status) : '-'}</span>
    </div>
  `;
}

function renderPreview() {
  const product = getDerivedProduct();
  if (!product) {
    $("#calculationPreview").innerHTML = `<div>⚠️ 請選擇有效的材料與模具組合</div>`;
    return;
  }
  const quantity = Number($("#quantityInput") ? $("#quantityInput").value || 0 : 0);
  const requirements = calculateRequirements(product.id, Math.max(quantity, 0));
  const mold = getMold(product.moldId);
  const rows = requirements
    .map((item) => {
      const warning = item.afterStock < 0 ? "bad" : item.afterStock < getMaterial(item.materialId).safety ? "warn" : "ok";
      return `<div><strong>${item.name}</strong> 需求 ${formatAmount(item.required)} ${item.unit} <span class="status-pill ${warning}">餘量 ${formatAmount(item.afterStock)}</span></div>`;
    })
    .join("");

  $("#calculationPreview").innerHTML = `
    <div><strong>綁定模具：</strong>${mold ? mold.name : '-'} <span class="status-pill ${mold && mold.status === 'Idle' ? 'ok' : 'warn'}">${mold ? translateMoldStatus(mold.status) : '-'}</span></div>
    ${rows}
  `;
}

function renderAutomationSteps(result = null) {
  $("#automationSteps").innerHTML = automationTemplate
    .map(([title, detail], index) => {
      const stateClass = !result ? "ok" : result.failedAt === index ? "bad" : result.failedAt > index || result.success ? "ok" : "warn";
      const label = !result ? "待命" : result.failedAt === index ? "阻擋" : result.failedAt > index || result.success ? "完成" : "未執行";
      return `
        <li>
          <span>
            <span class="step-title">${title}</span>
            <span class="step-detail">${detail}</span>
          </span>
          <span class="status-pill ${stateClass}">${label}</span>
        </li>
      `;
    })
    .join("");
}

function renderWorkOrders() {
  $("#workOrderTable").innerHTML = state.workOrders
    .map((order) => {
      const product = getProduct(order.productId);
      const mold = getMold(order.moldId);
      return `
        <tr>
          <td><strong>${order.id}</strong></td>
          <td>${product.name}</td>
          <td>${order.quantity}</td>
          <td>${order.line}</td>
          <td>${mold.name}</td>
          <td><span class="status-pill ok">${order.status}</span></td>
          <td>${order.creator}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMaterials() {
  $("#materialCards").innerHTML = state.materials
    .map((material) => {
      const ratio = Math.max(0, Math.min(100, (material.stock / material.capacity) * 100));
      const low = material.stock <= material.safety;
      return `
        <article class="inventory-card">
          <div class="card-top">
            <div>
              <h4>${material.name}</h4>
              <p>${material.id} · 儲位 ${material.location}</p>
            </div>
            <span class="status-pill ${low ? "bad" : "ok"}">${low ? "低於安全量" : "正常"}</span>
          </div>
          <span class="stock-number">${formatAmount(material.stock)} ${material.unit}</span>
          <div class="progress ${low ? "low" : ""}"><span style="width:${ratio}%"></span></div>
          <p>安全量 ${formatAmount(material.safety)} ${material.unit}，容量 ${formatAmount(material.capacity)} ${material.unit}</p>
          <div class="card-actions ${state.role === 'admin' ? '' : 'hidden'}">
            <button class="secondary-action edit-material-btn" data-id="${material.id}" type="button">編輯</button>
            <button class="secondary-action adjust-stock-btn" data-id="${material.id}" type="button">調整庫存</button>
            <button class="danger-action delete-material-btn" data-id="${material.id}" type="button">刪除</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMolds() {
  $("#moldCards").innerHTML = state.molds
    .map((mold) => {
      const locked = mold.status !== "Idle";
      const product = getProduct(mold.productId);
      return `
        <article class="mold-card ${locked ? "locked" : ""}">
          <div class="card-top">
            <div>
              <h4>${mold.name}</h4>
              <p>${mold.id} · 綁定 ${product.name}</p>
            </div>
            <span class="status-pill ${mold.status === "Idle" ? "ok" : "warn"}">${translateMoldStatus(mold.status)}</span>
          </div>
          <p>目前位置：${mold.line}</p>
          <p>預計釋放：${mold.eta}</p>
        </article>
      `;
    })
    .join("");
}

function renderProducts() {
  const tbody = $("#bomTableBody");
  if (!tbody) return;

  // Simulate SQL JOIN: bom_table JOIN products JOIN molds JOIN materials
  tbody.innerHTML = (state.bomTable || []).map(row => {
    const product  = getProduct(row.productId);
    const mold     = product ? getMold(product.moldId) : null;
    const material = getMaterial(row.materialId);
    if (!product || !material) return "";
    const moldStatus = mold ? mold.status : "-";
    return `
      <tr>
        <td><code>${row.bomId}</code></td>
        <td><code>${row.productId}</code></td>
        <td><strong>${product.name}</strong></td>
        <td><span class="status-pill ok">${formatAmount(product.stock || 0)} 件</span></td>
        <td><code>${product.moldId}</code></td>
        <td><span class="status-pill ${moldStatus === 'Idle' ? 'ok' : 'warn'}">${translateMoldStatus(moldStatus)}</span></td>
        <td><code>${row.materialId}</code></td>
        <td>${material.name}</td>
        <td>${formatAmount(row.amountPerUnit)} ${material.unit}</td>
        <td>${product.cycleMinutes}</td>
      </tr>
    `;
  }).join("");
}

function renderLogs() {
  $("#logList").innerHTML = state.logs
    .map((log) => {
      const tone = log.type === "ERR" ? "bad" : log.type === "WARN" ? "warn" : "ok";
      return `
        <article class="log-item">
          <span class="log-type ${tone}">${log.type}</span>
          <p>${log.message}</p>
          <time>${log.time}</time>
        </article>
      `;
    })
    .join("");
}

function translateMoldStatus(status) {
  return {
    Idle: "閒置",
    In_Use: "使用中"
  }[status] || status;
}

function submitWorkOrder(event) {
  event.preventDefault();

  const product = getDerivedProduct();
  if (!product) {
    addLog("ERR", "工單建立失敗：選取的材料與模具組合無對應產品。");
    state.lastAutomation = { failedAt: 0, success: false };
    render();
    return;
  }
  const productId = product.id;
  const quantity = Number($("#quantityInput").value);
  const line = $("#lineSelect").value;
  const mold = getMold(product.moldId);
  const requirements = calculateRequirements(productId, quantity);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    addLog("ERR", "工單建立失敗：生產數量必須是正整數。");
    state.lastAutomation = { failedAt: 0, success: false };
    render();
    return;
  }

  const shortage = requirements.find((item) => item.afterStock < 0);
  if (shortage) {
    addLog("ERR", `工單建立失敗：${shortage.name} 需求 ${formatAmount(shortage.required)} ${shortage.unit}，庫存不足。`);
    state.lastAutomation = { failedAt: 1, success: false };
    render();
    return;
  }

  if (mold.status !== "Idle") {
    addLog("WARN", `工單暫停：${mold.name} 目前${translateMoldStatus(mold.status)}，無法綁定到 ${line}。`);
    state.lastAutomation = { failedAt: 2, success: false };
    render();
    return;
  }

  // 扣料寫入
  requirements.forEach((item) => {
    const mat = getMaterial(item.materialId);
    mat.stock = mat.stock - item.required;
  });

  // 更新模具狀態
  mold.status = "In_Use";
  mold.line = line;
  mold.eta = estimateEta(product.cycleMinutes, quantity);

  // 增加產品庫存
  product.stock = (product.stock || 0) + quantity;

  const order = {
    id: nextWorkOrderId(),
    productId,
    quantity,
    line,
    moldId: mold.id,
    status: "已派工",
    creator: state.role === "admin" ? "管理員" : "作業員"
  };
  state.workOrders.unshift(order);

  addLog("INFO", `${order.id} 已建立：${product.name} ${quantity} 件，完成自動扣料並綁定 ${mold.name}。`);
  state.lastAutomation = { failedAt: Infinity, success: true };
  render();
}

function estimateEta(cycleMinutes, quantity) {
  const batches = Math.max(1, Math.ceil(quantity / 100));
  const eta = new Date(Date.now() + batches * cycleMinutes * 60 * 1000);
  return eta.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function nextWorkOrderId() {
  const next = state.workOrders.length + 1;
  return `WO-260804-${String(next).padStart(3, "0")}`;
}

function restockMaterials() {
  if (state.role !== "admin") return;
  state.materials = state.materials.map((material) => ({
    ...material,
    stock: material.capacity
  }));
  addLog("INFO", "管理員已執行一鍵補料，所有材料補至容量上限。");
  render();
}

function releaseScheduledMolds() {
  if (state.role !== "admin") return;
  let count = 0;
  state.molds = state.molds.map((mold) => {
    if (mold.status !== "In_Use") return mold;
    count += 1;
    // ── DB CONSTRAINT: ENUM ──
    const result = setMoldStatus(mold, "Idle");
    if (!result.ok) {
      addLog("ERR", result.error);
      return mold;
    }
    return { ...mold, status: "Idle", line: "-", eta: "-" };
  });
  addLog("INFO", `管理員已釋放 ${count} 組使用中模具 → Idle。`);
  render();
}

function resetState() {
  if (state.role !== "admin") return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(seedState);
  state.role = "admin";
  addLog("INFO", "管理員已重置模擬資料。");
  render();
}

function showMaterialModal(id = null) {
  if (state.role !== "admin") return;
  const modal = $("#materialModal");
  const form = $("#materialForm");
  form.reset();

  if (id) {
    const material = getMaterial(id);
    if (material) {
      $("#materialOriginalId").value = material.id;
      $("#materialId").value = material.id;
      $("#materialName").value = material.name;
      $("#materialUnit").value = material.unit;
      $("#materialLocation").value = material.location;
      $("#materialCapacity").value = material.capacity;
      $("#materialSafety").value = material.safety;
    }
  } else {
    $("#materialOriginalId").value = "";
  }
  modal.showModal();
}

function showStockModal(id) {
  if (state.role !== "admin") return;
  const material = getMaterial(id);
  if (!material) return;
  const modal = $("#stockModal");
  const form = $("#stockForm");
  form.reset();

  $("#stockMaterialId").value = material.id;
  $("#stockTargetName").textContent = `${material.id} - ${material.name}`;
  $("#currentStockDisplay").value = `${formatAmount(material.stock)} ${material.unit}`;
  modal.showModal();
}

function closeModals() {
  $("#materialModal").close();
  $("#stockModal").close();
}

function saveMaterial(event) {
  event.preventDefault();
  if (state.role !== "admin") return;

  const originalId = $("#materialOriginalId").value;
  const newId = $("#materialId").value.trim();

  const newMaterial = {
    id: newId,
    name: $("#materialName").value.trim(),
    unit: $("#materialUnit").value.trim(),
    location: $("#materialLocation").value.trim(),
    capacity: Number($("#materialCapacity").value),
    safety: Number($("#materialSafety").value),
    stock: 0
  };

  if (originalId) {
    const index = state.materials.findIndex(m => m.id === originalId);
    if (index > -1) {
      newMaterial.stock = state.materials[index].stock;
      state.materials[index] = newMaterial;
      addLog("INFO", `管理員已修改物料：${newMaterial.id} (${newMaterial.name})`);
    }
  } else {
    if (getMaterial(newId)) {
      alert("物料 ID 已存在！");
      return;
    }
    state.materials.push(newMaterial);
    addLog("INFO", `管理員已新增物料：${newMaterial.id} (${newMaterial.name})`);
  }

  closeModals();
  render();
}

function deleteMaterial(id) {
  if (state.role !== "admin") return;
  const material = getMaterial(id);
  if (!material) return;

  const usedByProducts = state.products.filter((product) =>
    product.bom.some((item) => item.materialId === id)
  );

  if (usedByProducts.length > 0) {
    const names = usedByProducts.map((p) => p.name).join("、");
    alert(`無法刪除：${material.name} 仍被以下產品的 BOM 使用中 - ${names}`);
    addLog("WARN", `刪除物料失敗：${material.name} 仍被 ${names} 引用。`);
    return;
  }

  if (!confirm(`確定要刪除物料「${material.name}」(${material.id}) 嗎？此操作無法復原。`)) {
    return;
  }

  state.materials = state.materials.filter((m) => m.id !== id);
  addLog("INFO", `管理員已刪除物料：${material.id} (${material.name})`);
  render();
}

function saveStockAdjustment(event) {
  event.preventDefault();
  if (state.role !== "admin") return;

  const id = $("#stockMaterialId").value;
  const amount = Number($("#adjustStockAmount").value);
  const material = getMaterial(id);

  if (material) {
    const newStock = material.stock + amount;
    // ── DB CONSTRAINT: CHECK (stock >= 0) ──
    const result = setMaterialStock(material, newStock);
    if (!result.ok) {
      addLog("ERR", result.error);
      closeModals();
      render();
      return;
    }
    addLog("INFO", `管理員已手動調整 ${material.id} 庫存：${amount > 0 ? '+' : ''}${amount} ${material.unit}，目前為 ${formatAmount(material.stock)} ${material.unit}`);
  }

  closeModals();
  render();
}

function bindEvents() {
  $$(".role-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.role = button.dataset.role;
      addLog("INFO", `登入角色切換為${state.role === "admin" ? "管理員" : "作業員"}。`);
      render();
    });
  });

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  });

  const materialSelect = $("#materialSelect");
  const moldSelect = $("#moldSelect");
  if (materialSelect) {
    materialSelect.addEventListener("change", () => {
      renderCombinedProduct();
      renderPreview();
    });
  }
  if (moldSelect) {
    moldSelect.addEventListener("change", () => {
      renderCombinedProduct();
      renderPreview();
    });
  }
  $("#quantityInput").addEventListener("input", renderPreview);
  $("#workOrderForm").addEventListener("submit", submitWorkOrder);
  $("#restockButton").addEventListener("click", restockMaterials);
  $("#releaseMoldsButton").addEventListener("click", releaseScheduledMolds);
  $("#resetButton").addEventListener("click", resetState);

  $("#addMaterialButton").addEventListener("click", () => showMaterialModal());
  $("#materialCards").addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-material-btn")) {
      showMaterialModal(e.target.dataset.id);
    } else if (e.target.classList.contains("adjust-stock-btn")) {
      showStockModal(e.target.dataset.id);
    } else if (e.target.classList.contains("delete-material-btn")) {
      deleteMaterial(e.target.dataset.id);
    }
  });
  $("#materialForm").addEventListener("submit", saveMaterial);
  $("#stockForm").addEventListener("submit", saveStockAdjustment);
  $$(".close-modal-btn").forEach(btn => btn.addEventListener("click", closeModals));
}

bindEvents();
render();