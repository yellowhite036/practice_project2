const API_BASE_URL = "/api";

// ============================================================
// JWT TOKEN MANAGEMENT
// ============================================================

function getToken() {
  return sessionStorage.getItem("jwt_token");
}

function setToken(token) {
  sessionStorage.setItem("jwt_token", token);
}

function clearToken() {
  sessionStorage.removeItem("jwt_token");
  sessionStorage.removeItem("jwt_user");
}

function getStoredUser() {
  try {
    const raw = sessionStorage.getItem("jwt_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredUser(user) {
  sessionStorage.setItem("jwt_user", JSON.stringify(user));
}

function decodeJwtRole(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role || "operator";
  } catch {
    return "operator";
  }
}

// ============================================================
// STATE
// ============================================================

function createEmptyState() {
  return {
    role: "operator",
    activeView: "workorders",
    materials: [],
    molds: [],
    products: [],
    bomTable: [],
    workOrders: [],
    lastAutomation: null,
    logs: [],
    loading: false,
    error: null
  };
}

let state = createEmptyState();

// ============================================================
// CONSTANTS / UI HELPERS
// ============================================================

const viewTitles = {
  workorders: "工單派發",
  materials: "物料庫存",
  molds: "模具狀態",
  products: "產品 BOM",
  logs: "系統紀錄"
};

const roleNotes = {
  operator: "可建立工單、執行自動化、查詢現場狀態",
  manager: "可建立工單、修改物料模具產品 BOM",
  admin: "完整管理：修改模具、配置模具並追蹤異常事件"
};

const automationTemplate = [
  ["讀取 BOM", "依產品主檔查詢單位用料並乘以工單數量"],
  ["檢查 WMS 庫存", "比對可用庫存是否滿足需求量"],
  ["查詢模具狀態", "確認所綁定模具可用，並鎖定指定產線位"],
  ["扣庫入帳", "寫入庫存事務並原子扣帳（PostgreSQL Transaction）"],
  ["建立 MES 工單", "生成工單編號，更新現場看板狀態"]
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// ============================================================
// API REQUEST (JWT-AUTHENTICATED)
// ============================================================

async function apiRequest(method, path, body = null) {
  const token = getToken();
  const options = {
    method,
    headers: { Accept: "application/json" }
  };

  if (token) {
    options.headers["Authorization"] = `Bearer ${token}`;
  }

  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new Error("無法連線到後端，請確認 Express API 是否已啟動");
  }

  if (response.status === 401) {
    if (path !== "/auth/login") {
      clearToken();
      renderLoginScreen();
      throw new Error("認證失敗，請重新登入");
    }
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const fallback = {
      400: "資料格式不正確，請檢查輸入內容",
      401: "認證失敗，請重新登入",
      403: "您的角色無此操作權限",
      404: "找不到指定資源",
      409: "資料衝突（版本衝突或約束違反），請重新整理",
      500: "後端伺服器內部錯誤，請稍後重試",
      503: "後端連接資料庫失敗"
    }[response.status] || "API 請求失敗";
    throw new Error(data && data.error ? data.error : fallback);
  }

  return data;
}

// ============================================================
// LOGIN
// ============================================================

async function doLogin(userId) {
  const data = await apiRequest("POST", "/auth/login", { user_id: userId });
  setToken(data.token);
  setStoredUser(data.user);
  state.role = data.user.role;
  return data.user;
}

// ============================================================
// DATA MAPPERS
// ============================================================

function mapMaterial(row) {
  return {
    id: row.material_id,
    name: row.name,
    unit: row.unit,
    stock: Number(row.stock ?? 0),
    capacity: row.capacity === null || row.capacity === undefined ? 0 : Number(row.capacity),
    safety: Number(row.safety_stock ?? 0),
    location: row.location || "",
    version: row.version || 1
  };
}

function toApiMaterial(material) {
  return {
    material_id: material.id,
    name: material.name,
    unit: material.unit,
    stock: material.stock,
    capacity: material.capacity || null,
    safety_stock: material.safety,
    location: material.location || null,
    version: material.version
  };
}

function mapProduct(row) {
  return {
    id: row.product_id,
    name: row.name,
    cycleMinutes: Number(row.cycle_minutes),
    moldId: row.mold_id,
    stock: Number(row.stock ?? 0),
    version: row.version || 1
  };
}

function mapMold(row) {
  return {
    id: row.mold_id,
    name: row.name,
    status: row.status,
    line: row.line || "-",
    eta: row.eta || "-",
    productId: row.product_id || "",
    version: row.version || 1
  };
}

function mapBom(row) {
  return {
    bomId: row.bom_id,
    productId: row.product_id,
    materialId: row.material_id,
    amountPerUnit: Number(row.amount_per_unit),
    version: row.version || 1
  };
}

function mapWorkOrder(row) {
  return {
    id: row.work_order_id,
    productId: row.product_id,
    quantity: Number(row.quantity),
    line: row.line,
    moldId: row.mold_id,
    status: row.status,
    creator: row.creator_name || row.creator_user_id || "-"
  };
}

function mapLog(row) {
  return {
    type: row.level,
    message: row.message,
    time: row.created_at ? new Date(row.created_at).toLocaleTimeString("zh-TW", { hour12: false }) : nowTime()
  };
}

// ============================================================
// DATA FETCHING
// ============================================================

async function fetchBackendState() {
  const canReadLogs = ["admin", "manager"].includes(state.role);
  const requests = [
    apiRequest("GET", "/materials"),
    apiRequest("GET", "/products"),
    apiRequest("GET", "/molds"),
    apiRequest("GET", "/bom"),
    apiRequest("GET", "/work-orders")
  ];
  if (canReadLogs) {
    requests.push(apiRequest("GET", "/logs"));
  }
  const results = await Promise.all(requests);
  const [materials, products, molds, bomTable, workOrders] = results;
  const logs = canReadLogs ? results[5] : [];
  return {
    materials: materials.map(mapMaterial),
    products: products.map(mapProduct),
    molds: molds.map(mapMold),
    bomTable: bomTable.map(mapBom),
    workOrders: workOrders.map(mapWorkOrder),
    logs: logs.map(mapLog)
  };
}

async function refreshStateFromApi() {
  const currentRole = state.role;
  const currentView = state.activeView;
  const data = await fetchBackendState();
  state = {
    ...createEmptyState(),
    ...data,
    role: currentRole,
    activeView: currentView
  };
}

// ============================================================
// UTILITIES
// ============================================================

function formatAmount(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : Number(value).toFixed(2);
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
    name: getMaterial(row.materialId)?.name || row.materialId,
    unit: getMaterial(row.materialId)?.unit || "",
    stock: getMaterial(row.materialId)?.stock ?? 0
  }));
}

function calculateRequirements(productId, quantity) {
  const bomRows = getBomForProduct(productId);
  return bomRows.map((row) => {
    const material = getMaterial(row.materialId);
    if (!material) return null;
    return {
      ...row,
      name: material.name,
      unit: material.unit,
      stock: material.stock,
      required: row.amountPerUnit * quantity,
      afterStock: material.stock - row.amountPerUnit * quantity
    };
  }).filter(Boolean);
}

function translateMoldStatus(status) {
  return { Idle: "閒置", In_Use: "使用中" }[status] || status;
}

function canWrite() {
  return ["admin", "manager"].includes(state.role);
}

// ============================================================
// RENDER - LOGIN SCREEN
// ============================================================

function renderLoginScreen() {
  const loginOverlay = document.getElementById("loginOverlay");
  const mainContent = document.getElementById("mainContent");
  if (loginOverlay) loginOverlay.style.display = "flex";
  if (mainContent) mainContent.style.display = "none";
}

function renderMainScreen() {
  const loginOverlay = document.getElementById("loginOverlay");
  const mainContent = document.getElementById("mainContent");
  if (loginOverlay) loginOverlay.style.display = "none";
  if (mainContent) mainContent.style.display = "";
}

// ============================================================
// RENDER - MAIN APP
// ============================================================

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
}

function renderRole() {
  const roleNoteEl = $("#roleNote");
  if (roleNoteEl) roleNoteEl.textContent = roleNotes[state.role] || "";
  const permBadge = $("#permissionBadge");
  if (permBadge) {
    permBadge.textContent = state.role === "admin" ? "管理員模式" : state.role === "manager" ? "主管模式" : "作業員模式";
  }

  $$(".nav-button.admin-only").forEach((button) => {
    button.classList.toggle("hidden", state.role !== "admin");
  });

  $$(".admin-only:not(.nav-button)").forEach((button) => {
    const hasAccess = canWrite();
    button.classList.toggle("hidden", !hasAccess);
    button.disabled = !hasAccess;
    button.title = hasAccess ? "" : "此操作需主管或管理員";
  });

  if (!canWrite() && state.activeView === "logs" && state.role === "operator") {
    state.activeView = "workorders";
  }
}

function renderNavigation() {
  const viewTitle = $("#viewTitle");
  if (viewTitle) viewTitle.textContent = viewTitles[state.activeView];
  $$(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
  $$(".view").forEach((view) => {
    view.classList.toggle("active", view.id === state.activeView);
  });
}

function renderMetrics() {
  const healthyMaterials = state.materials.filter((m) => m.stock > m.safety).length;
  const availableMolds = state.molds.filter((mold) => mold.status === "Idle").length;
  const exceptions = state.logs.filter((log) => log.type === "WARN" || log.type === "ERR").length;

  const mhEl = $("#materialHealth");
  if (mhEl) mhEl.textContent = `${healthyMaterials}/${state.materials.length}`;
  const moldEl = $("#moldHealth");
  if (moldEl) moldEl.textContent = `${availableMolds}/${state.molds.length}`;
  const woEl = $("#workOrderCount");
  if (woEl) woEl.textContent = state.workOrders.length;
  const excEl = $("#exceptionCount");
  if (excEl) excEl.textContent = exceptions;
}

function renderMaterialOptions() {
  const select = $("#materialSelect");
  if (!select) return;
  if (state.materials.length === 0) {
    select.innerHTML = `<option value="">載入中…</option>`;
    return;
  }
  const currentValue = select.value || state.materials[0].id;
  select.innerHTML = state.materials
    .map((m) => `<option value="${m.id}">${m.name} (${formatAmount(m.stock)}${m.unit})</option>`)
    .join("");
  select.value = state.materials.some((m) => m.id === currentValue) ? currentValue : state.materials[0].id;
}

function renderMoldOptions() {
  const select = $("#moldSelect");
  if (!select) return;
  if (state.molds.length === 0) {
    select.innerHTML = `<option value="">無模具資料</option>`;
    return;
  }
  const currentValue = select.value || state.molds[0].id;
  select.innerHTML = state.molds
    .map((mold) => `<option value="${mold.id}">${mold.name} (${translateMoldStatus(mold.status)})</option>`)
    .join("");
  select.value = state.molds.some((mold) => mold.id === currentValue) ? currentValue : state.molds[0].id;
}

function getDerivedProduct() {
  const matId = $("#materialSelect") ? $("#materialSelect").value : null;
  const moldId = $("#moldSelect") ? $("#moldSelect").value : null;
  if (!matId || !moldId) return state.products[0] || null;
  return state.products.find((p) =>
    p.moldId === moldId &&
    (state.bomTable || []).some((b) => b.productId === p.id && b.materialId === matId)
  ) || state.products[0] || null;
}

function renderCombinedProduct() {
  const el = $("#productResult");
  if (!el) return;
  const product = getDerivedProduct();
  if (!product) {
    el.innerHTML = `<div class="product-result-none">尚未定義此組合產品</div>`;
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
  const previewEl = $("#calculationPreview");
  if (!product) {
    if (previewEl) previewEl.innerHTML = `<div>請選擇物料、數量與模具</div>`;
    return;
  }
  const quantity = Number($("#quantityInput") ? $("#quantityInput").value || 0 : 0);
  const requirements = calculateRequirements(product.id, Math.max(quantity, 0));
  const mold = getMold(product.moldId);
  const rows = requirements
    .map((item) => {
      const mat = getMaterial(item.materialId);
      const warning = item.afterStock < 0 ? "bad" : item.afterStock < (mat ? mat.safety : 0) ? "warn" : "ok";
      return `<div><strong>${item.name}</strong> 需${formatAmount(item.required)} ${item.unit} <span class="status-pill ${warning}">餘量 ${formatAmount(item.afterStock)}</span></div>`;
    })
    .join("");

  if (previewEl) previewEl.innerHTML = `
    <div><strong>綁定模具：</strong>${mold ? mold.name : '-'} <span class="status-pill ${mold && mold.status === 'Idle' ? 'ok' : 'warn'}">${mold ? translateMoldStatus(mold.status) : '-'}</span></div>
    ${rows}
  `;

  const btn = $("#submitWorkOrderBtn");
  if (btn) {
    const moldBusy = mold && mold.status !== "Idle";
    btn.disabled = !product || moldBusy;
    btn.style.opacity = (!product || moldBusy) ? "0.5" : "1";
    btn.style.cursor = (!product || moldBusy) ? "not-allowed" : "pointer";
  }
}

function renderAutomationSteps(result = null) {
  const el = $("#automationSteps");
  if (!el) return;
  el.innerHTML = automationTemplate
    .map(([title, detail], index) => {
      const stateClass = !result ? "ok" : result.failedAt === index ? "bad" : result.success || result.failedAt > index ? "ok" : "warn";
      const label = !result ? "待命" : result.failedAt === index ? "失敗" : result.success || result.failedAt > index ? "完成" : "未執行";
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
  const tbody = $("#workOrderTable");
  if (!tbody) return;
  if (state.workOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted)">目前無工單資料</td></tr>`;
    return;
  }
  tbody.innerHTML = state.workOrders
    .map((order) => {
      const product = getProduct(order.productId);
      const mold = getMold(order.moldId);
      const statusClass = order.status === "Pending" ? "warn" : order.status === "In_Progress" ? "ok" : order.status === "Completed" ? "ok" : "bad";
      return `
        <tr>
          <td><strong>${order.id}</strong></td>
          <td>${product ? product.name : order.productId}</td>
          <td>${order.quantity}</td>
          <td>${order.line}</td>
          <td>${mold ? mold.name : order.moldId}</td>
          <td><span class="status-pill ${statusClass}">${order.status}</span></td>
          <td>${order.creator}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMaterials() {
  const container = $("#materialCards");
  if (!container) return;
  if (state.materials.length === 0) {
    container.innerHTML = `<div style="color:var(--muted);padding:16px">目前無物料資料</div>`;
    return;
  }
  container.innerHTML = state.materials
    .map((material) => {
      const ratio = material.capacity > 0 ? Math.max(0, Math.min(100, (material.stock / material.capacity) * 100)) : 0;
      const low = material.stock <= material.safety;
      const showActions = canWrite();
      return `
        <article class="inventory-card">
          <div class="card-top">
            <div>
              <h4>${material.name}</h4>
              <p>${material.id} · 位 ${material.location}</p>
            </div>
            <span class="status-pill ${low ? "bad" : "ok"}">${low ? "低於安全量" : "正常"}</span>
          </div>
          <span class="stock-number">${formatAmount(material.stock)} ${material.unit}</span>
          <div class="progress ${low ? "low" : ""}"><span style="width:${ratio}%"></span></div>
          <p>安全量${formatAmount(material.safety)} ${material.unit}，容量${formatAmount(material.capacity)} ${material.unit}</p>
          <div class="card-actions ${showActions ? '' : 'hidden'}">
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
  const container = $("#moldCards");
  if (!container) return;
  if (state.molds.length === 0) {
    container.innerHTML = `<div style="color:var(--muted);padding:16px">目前無模具資料</div>`;
    return;
  }
  container.innerHTML = state.molds
    .map((mold) => {
      const locked = mold.status !== "Idle";
      const product = getProduct(mold.productId);
      return `
        <article class="mold-card ${locked ? "locked" : ""}">
          <div class="card-top">
            <div>
              <h4>${mold.name}</h4>
              <p>${mold.id} · 綁定 ${product ? product.name : "-"}</p>
            </div>
            <span class="status-pill ${mold.status === "Idle" ? "ok" : "warn"}">${translateMoldStatus(mold.status)}</span>
          </div>
          <p>產線位置：${mold.line}</p>
          <p>預計放開：${mold.eta}</p>
        </article>
      `;
    })
    .join("");
}

function renderProducts() {
  const tbody = $("#bomTableBody");
  if (!tbody) return;
  if ((state.bomTable || []).length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--muted)">目前無 BOM 資料</td></tr>`;
    return;
  }
  tbody.innerHTML = (state.bomTable || []).map(row => {
    const product = getProduct(row.productId);
    const mold = product ? getMold(product.moldId) : null;
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
  const container = $("#logList");
  if (!container) return;
  if (!["admin", "manager"].includes(state.role)) {
    container.innerHTML = `<div style="color:var(--muted);padding:16px">作業員無系統日誌查看權限</div>`;
    return;
  }
  if (state.logs.length === 0) {
    container.innerHTML = `<div style="color:var(--muted);padding:16px">目前無日誌記錄</div>`;
    return;
  }
  container.innerHTML = state.logs
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

// ============================================================
// WORK ORDER SUBMISSION (API-DRIVEN)
// ============================================================

async function submitWorkOrder(event) {
  event.preventDefault();

  const product = getDerivedProduct();
  if (!product) {
    addLog("WARN", "請先選擇有效的物料與模具組合");
    render();
    return;
  }

  const quantity = Number($("#quantityInput").value || 0);
  const line = $("#lineSelect") ? $("#lineSelect").value : "L1";
  const mold = getMold(product.moldId);

  if (!mold || mold.status !== "Idle") {
    addLog("WARN", `模具 ${product.moldId} 目前非閒置狀態，無法建立工單`);
    render();
    return;
  }

  if (!quantity || quantity <= 0) {
    addLog("WARN", "生產數量必須大於 0");
    render();
    return;
  }

  const now = new Date();
  const dateStr = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const seq = String(state.workOrders.length + 1).padStart(3, "0");
  const workOrderId = `WO-${dateStr}-${seq}`;

  const storedUser = getStoredUser();
  const payload = {
    work_order_id: workOrderId,
    product_id: product.id,
    quantity,
    line,
    mold_id: product.moldId,
    creator_user_id: storedUser ? storedUser.user_id : null,
    creator_name: storedUser ? storedUser.user_id : null
  };

  state.lastAutomation = { failedAt: -1, success: false };
  renderAutomationSteps(state.lastAutomation);

  const btn = $("#submitWorkOrderBtn");
  if (btn) { btn.disabled = true; btn.textContent = "處理中…"; }

  try {
    await apiRequest("POST", "/work-orders", payload);
    state.lastAutomation = { failedAt: -1, success: true };
    addLog("INFO", `工單 ${workOrderId} 已成功建立 (產品: ${product.name}, 數量: ${quantity})`);
    await refreshStateFromApi();
  } catch (error) {
    state.lastAutomation = { failedAt: 4, success: false };
    addLog("ERR", `工單建立失敗：${error.message}`);
  }

  if (btn) { btn.disabled = false; btn.textContent = "確認派工入模具位"; }
  render();
}

// ============================================================
// ADMIN ACTIONS
// ============================================================

async function resetState() {
  if (!canWrite()) return;
  addLog("INFO", "重新從 API 載入最新資料…");
  try {
    await refreshStateFromApi();
    addLog("INFO", "資料已從資料庫重新整理");
  } catch (error) {
    addLog("ERR", error.message);
  }
  render();
}

function restockMaterials() {
  if (!canWrite()) return;
  addLog("WARN", "一鍵補料功能需透過調整庫存功能操作");
  render();
}

function releaseScheduledMolds() {
  if (!canWrite()) return;
  addLog("WARN", "模具排程放開需透過工單完成/拒絕 API");
  render();
}

// ============================================================
// MATERIAL MODAL (CRUD with optimistic lock version)
// ============================================================

function showMaterialModal(id = null) {
  if (!canWrite()) {
    addLog("WARN", "您的角色無物料修改權限");
    return;
  }
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
      form.dataset.version = material.version;
    }
  } else {
    $("#materialOriginalId").value = "";
    form.dataset.version = "";
  }
  modal.showModal();
}

function showStockModal(id) {
  if (!canWrite()) {
    addLog("WARN", "您的角色無庫存調整權限");
    return;
  }
  const material = getMaterial(id);
  if (!material) return;
  const modal = $("#stockModal");
  const form = $("#stockForm");
  form.reset();

  $("#stockMaterialId").value = material.id;
  $("#stockTargetName").textContent = `${material.id} - ${material.name}`;
  $("#currentStockDisplay").value = `${formatAmount(material.stock)} ${material.unit}`;
  form.dataset.version = material.version;
  modal.showModal();
}

function closeModals() {
  const m1 = $("#materialModal");
  const m2 = $("#stockModal");
  if (m1) m1.close();
  if (m2) m2.close();
}

async function saveMaterial(event) {
  event.preventDefault();
  if (!canWrite()) return;

  const originalId = $("#materialOriginalId").value;
  const newId = $("#materialId").value.trim();
  const form = $("#materialForm");
  const storedVersion = form.dataset.version ? Number(form.dataset.version) : undefined;

  const newMaterial = {
    id: newId,
    name: $("#materialName").value.trim(),
    unit: $("#materialUnit").value.trim(),
    location: $("#materialLocation").value.trim(),
    capacity: Number($("#materialCapacity").value),
    safety: Number($("#materialSafety").value),
    stock: 0,
    version: storedVersion
  };

  try {
    if (originalId) {
      const existing = getMaterial(originalId);
      if (existing) {
        newMaterial.stock = existing.stock;
      }
      await apiRequest("PUT", `/materials/${encodeURIComponent(originalId)}`, toApiMaterial(newMaterial));
      addLog("INFO", `已修改物料 ${newMaterial.id} (${newMaterial.name})`);
    } else {
      await apiRequest("POST", "/materials", toApiMaterial(newMaterial));
      addLog("INFO", `已新增物料 ${newMaterial.id} (${newMaterial.name})`);
    }
    await refreshStateFromApi();
    closeModals();
  } catch (error) {
    alert(error.message);
    addLog("ERR", error.message);
  }

  render();
}

async function deleteMaterial(id) {
  if (!canWrite()) {
    addLog("WARN", "您的角色無物料刪除權限");
    return;
  }
  const material = getMaterial(id);
  if (!material) return;

  const usedProductIds = (state.bomTable || [])
    .filter((item) => item.materialId === id)
    .map((item) => item.productId);
  const usedByProducts = state.products.filter((product) =>
    usedProductIds.includes(product.id)
  );

  if (usedByProducts.length > 0) {
    const names = usedByProducts.map((p) => p.name).join("、");
    alert(`無法刪除：${material.name} 仍被以下產品 BOM 使用 - ${names}`);
    addLog("WARN", `刪除物料失敗：${material.name} 仍被 ${names} 引用`);
    return;
  }

  if (!confirm(`確定要刪除物料 ${material.name}（${material.id}）？此操作無法復原。`)) {
    return;
  }

  try {
    await apiRequest("DELETE", `/materials/${encodeURIComponent(id)}`);
    addLog("INFO", `已刪除物料 ${material.id} (${material.name})`);
    await refreshStateFromApi();
  } catch (error) {
    alert(error.message);
    addLog("ERR", error.message);
  }

  render();
}

async function saveStockAdjustment(event) {
  event.preventDefault();
  if (!canWrite()) return;

  const id = $("#stockMaterialId").value;
  const amount = Number($("#adjustStockAmount").value);
  const material = getMaterial(id);

  if (!material) return;

  const newStock = material.stock + amount;
  if (newStock < 0) {
    addLog("ERR", `[庫存約束] 調整後庫存 ${newStock.toFixed(2)} 將為負數，已拒絕`);
    closeModals();
    render();
    return;
  }

  const updated = { ...material, stock: newStock };

  try {
    await apiRequest("PUT", `/materials/${encodeURIComponent(id)}`, toApiMaterial(updated));
    await refreshStateFromApi();
    addLog("INFO", `已透過 API 調整 ${material.id} 庫存 ${amount > 0 ? '+' : ''}${amount} ${material.unit}`);
    closeModals();
  } catch (error) {
    alert(error.message);
    addLog("ERR", error.message);
  }

  render();
}

// ============================================================
// APP INIT
// ============================================================

async function initializeApp() {
  addLog("INFO", "連線到後端 API…");
  render();

  try {
    await apiRequest("GET", "/health");
    await refreshStateFromApi();
    render();
  } catch (error) {
    state.error = error.message;
    addLog("ERR", `API 連線失敗：${error.message}`);
    render();
  }
}

// ============================================================
// EVENT BINDING
// ============================================================

function bindEvents() {
  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  });

  const materialSelect = $("#materialSelect");
  if (materialSelect) {
    materialSelect.addEventListener("change", () => {
      renderCombinedProduct();
      renderPreview();
    });
  }
  const moldSelect = $("#moldSelect");
  if (moldSelect) {
    moldSelect.addEventListener("change", () => {
      renderCombinedProduct();
      renderPreview();
    });
  }

  const qInput = $("#quantityInput");
  if (qInput) qInput.addEventListener("input", renderPreview);

  const woForm = $("#workOrderForm");
  if (woForm) woForm.addEventListener("submit", submitWorkOrder);

  const restockBtn = $("#restockButton");
  if (restockBtn) restockBtn.addEventListener("click", restockMaterials);

  const releaseMoldsBtn = $("#releaseMoldsButton");
  if (releaseMoldsBtn) releaseMoldsBtn.addEventListener("click", releaseScheduledMolds);

  const resetBtn = $("#resetButton");
  if (resetBtn) resetBtn.addEventListener("click", resetState);

  const addMaterialBtn = $("#addMaterialButton");
  if (addMaterialBtn) addMaterialBtn.addEventListener("click", () => showMaterialModal());

  const materialCards = $("#materialCards");
  if (materialCards) {
    materialCards.addEventListener("click", (e) => {
      if (e.target.classList.contains("edit-material-btn")) {
        showMaterialModal(e.target.dataset.id);
      } else if (e.target.classList.contains("adjust-stock-btn")) {
        showStockModal(e.target.dataset.id);
      } else if (e.target.classList.contains("delete-material-btn")) {
        deleteMaterial(e.target.dataset.id);
      }
    });
  }

  const materialForm = $("#materialForm");
  if (materialForm) materialForm.addEventListener("submit", saveMaterial);

  const stockForm = $("#stockForm");
  if (stockForm) stockForm.addEventListener("submit", saveStockAdjustment);

  $$(".close-modal-btn").forEach(btn => btn.addEventListener("click", closeModals));

  const logoutBtn = $("#logoutButton");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearToken();
      state = createEmptyState();
      renderLoginScreen();
    });
  }

  // Login form
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userId = document.getElementById("loginUserId").value.trim();
      const errorEl = document.getElementById("loginError");
      const loginBtn = document.getElementById("loginBtn");
      if (!userId) return;
      if (errorEl) errorEl.style.display = "none";
      if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = "登入中..."; }
      try {
        await doLogin(userId);
        renderMainScreen();
        await initializeApp();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || "登入失敗，請確認使用者 ID";
          errorEl.style.display = "block";
        }
        if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = "登入"; }
      }
    });
  }
}

// ============================================================
// BOOTSTRAP
// ============================================================

async function startApp() {
  bindEvents();

  const token = getToken();
  if (token) {
    state.role = decodeJwtRole(token);
    renderMainScreen();
    await initializeApp();
  } else {
    renderLoginScreen();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
