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
    lines: [],
    lineMoldOptions: [],
    molds: [],
    products: [],
    bomTable: [],
    workOrders: [],
    autoOrderProposals: [],
    autoOrderSources: [],
    lastAutomation: null,
    moldQueues: {},
    logs: [],
    loading: false,
    error: null
  };
}

let state = createEmptyState();
const workOrderActionInProgress = new Set();
let autoOrderBusy = false; // prevents double-submit during WO creation

// ============================================================
// MOLD MANAGEMENT
// ============================================================

function showMoldModal() {
  const modal = $("#moldModal");
  if (!modal) return;
  modal.showModal();
  $("#moldIdInput").value = "";
  $("#moldNameInput").value = "";
  $("#moldTypeInput").value = "";

  // Build product-type list from existing products, deduplicated by mold
  const typeSelect = $("#moldProductTypeInput");
  if (typeSelect) {
    const typeMap = new Map();
    for (const p of state.products) {
      const moldId = p.moldId || p.mold_id;
      if (!moldId || typeMap.has(moldId)) continue;
      const materialPrefixes = ["玻璃", "鐵", "木頭", "木", "塑膠"];
      let label = p.name;
      for (const prefix of materialPrefixes) {
        if (label.startsWith(prefix)) { label = label.slice(prefix.length); break; }
      }
      typeMap.set(moldId, { moldId, label });
    }
    const options = [...typeMap.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
    typeSelect.innerHTML = '<option value="">（請選擇）</option>' +
      options.map(t => `<option value="${escapeHtml(t.moldId)}">${escapeHtml(t.label)}</option>`).join("");
    typeSelect.value = "";
  }
}

async function saveMold(e) {
  e.preventDefault();
  const id = $("#moldIdInput").value.trim();
  const name = $("#moldNameInput").value.trim();
  const moldType = $("#moldTypeInput").value.trim() || null;
  const selectedMoldId = ($("#moldProductTypeInput") && $("#moldProductTypeInput").value) || null;
  const matchedProduct = selectedMoldId
    ? state.products.find(p => (p.moldId || p.mold_id) === selectedMoldId)
    : null;
  const productId = matchedProduct ? matchedProduct.id : null;

  if (!id || !name) return;

  try {
    await apiRequest("POST", "/molds", { mold_id: id, name, product_id: productId, mold_type: moldType, status: "Idle" });
    addLog("INFO", `已新增模具 ${id} (${name})`);
    closeModals();
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", `新增模具失敗: ${error.message}`);
  }
}

async function deleteMold(id) {
  if (!confirm(`確定要刪除模具 ${id} 嗎？`)) return;
  try {
    await apiRequest("DELETE", `/molds/${id}`);
    addLog("INFO", `已刪除模具 ${id}`);
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", `刪除模具失敗: ${error.message}`);
  }
}

// ============================================================
// CONSTANTS / UI HELPERS
// ============================================================

function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const viewTitles = {
  workorders: "工單派發",
  materials: "物料庫存",
  autoorders: "自動下單",
  molds: "產線與模具管理",
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
    code: row.code || "",
    moldType: row.mold_type || "",
    isActive: row.is_active !== false,
    version: row.version || 1
  };
}

function mapLine(row) { return { id: Number(row.id), name: row.name, isActive: row.is_active !== false, createdAt: row.created_at }; }
function mapLineRate(row) { return { lineId: Number(row.line_id), productId: row.product_id, unitsPerHour: Number(row.units_per_hour) }; }
function mapItemMoldOption(row) { return { productId: row.product_id, moldId: row.mold_id, preferred: Boolean(row.is_preferred) }; }
function mapLineMoldOption(row) { return { lineId: Number(row.line_id), moldId: row.mold_id }; }

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
    apiRequest("GET", "/work-orders"),
    apiRequest("GET", "/lines")
  ];
  if (canReadLogs) {
    requests.push(apiRequest("GET", "/logs"));
  }
  const results = await Promise.all(requests);
  const [materials, products, molds, bomTable, workOrders, lines] = results;
  const logs = canReadLogs ? results[6] : [];
  const lineMolds = await apiRequest("GET", "/lines/molds");
  return {
    materials: materials.map(mapMaterial),
    products: products.map(mapProduct),
    molds: molds.map(mapMold),
    bomTable: bomTable.map(mapBom),
    workOrders: workOrders.map(mapWorkOrder),
    lines: lines.map(mapLine),
    lineMoldOptions: lineMolds.map(mapLineMoldOption),
    logs: logs.map(mapLog)
  };
}

function setLoading(isLoading) {
  state.loading = isLoading;
  const el = $("#globalLoading");
  if (el) el.style.display = isLoading ? "block" : "none";
}

async function refreshStateFromApi() {
  const currentRole = state.role;
  const currentView = state.activeView;
  setLoading(true);
  try {
    const data = await fetchBackendState();
    state = {
      ...createEmptyState(),
      ...data,
      role: currentRole,
      activeView: currentView
    };
  } finally {
    setLoading(false);
  }
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
  renderLineOptions();
  renderMoldOptions();
  renderCombinedProduct();
  renderPreview();
  renderAutomationSteps(state.lastAutomation);
  renderWorkOrders();
  renderMaterials();
  renderAutoOrders();
  renderProductionManagement();
  renderMolds();
  renderProducts();
  renderLogs();
}

// Like render() but preserves scroll position — used during background production
function renderQuiet() {
  const sy = window.scrollY;
  render();
  window.scrollTo({ top: sy, behavior: "instant" });
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

  if (!canWrite() && ["logs", "autoorders"].includes(state.activeView) && state.role === "operator") {
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
  const lineName = $("#lineSelect")?.value;
  const line = state.lines.find(item => item.name === lineName);
  const availableIds = new Set(state.lineMoldOptions.filter(option => option.lineId === line?.id).map(option => option.moldId));
  const molds = state.molds.filter(mold => mold.isActive && availableIds.has(mold.id));
  if (molds.length === 0) {
    select.innerHTML = `<option value="">此產線尚未設定可用模具</option>`;
    return;
  }
  const currentValue = select.value || molds[0].id;
  select.innerHTML = molds
    .map((mold) => `<option value="${mold.id}">${mold.name} (${translateMoldStatus(mold.status)})</option>`)
    .join("");
  select.value = molds.some((mold) => mold.id === currentValue) ? currentValue : molds[0].id;
}

function renderLineOptions() {
  const select = $("#lineSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = state.lines.map(line => `<option value="${escapeHtml(line.name)}">${escapeHtml(line.name)}</option>`).join("");
  select.value = state.lines.some(line => line.name === current) ? current : (state.lines[0]?.name || "");
}

function renderProductionManagement() {
  const container = $("#productionManagement");
  if (!container) return;
  const selectedId = state.selectedManagementLineId || state.lines.find(line => line.isActive)?.id;
  const assignedIds = new Set(state.lineMoldOptions.filter(option => option.lineId === selectedId).map(option => option.moldId));
  const lines = state.lines.map(line => {
    const assigned = state.lineMoldOptions.filter(option => option.lineId === line.id).map(option => getMold(option.moldId)?.name).filter(Boolean);
    return `<li><strong>${escapeHtml(line.name)}</strong> · ${line.isActive ? "啟用" : "停用"} · 可用模具：${assigned.length ? assigned.map(escapeHtml).join("、") : "尚未設定"}
      <button type="button" class="toggle-line-btn secondary-action" data-id="${line.id}" data-active="${line.isActive}">${line.isActive ? "停用" : "啟用"}</button></li>`;
  }).join("") || "<li>尚無產線</li>";
  container.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Shared mold access</p><h4>產線可用模具設定</h4><p>模具是共用資源；同一副模具可同時指派給多條產線，但使用中會由工單鎖定。</p></div></div>
    <form id="addLineForm" class="form-grid"><label>新增產線<input id="newLineName" maxlength="100" placeholder="例如 L4" required></label><button class="primary-action" type="submit">新增產線</button></form>
    <ul>${lines}</ul>
    <form id="lineMoldForm" class="form-grid"><label>產線<select id="managedLineId">${state.lines.filter(line => line.isActive).map(line => `<option value="${line.id}" ${line.id === selectedId ? "selected" : ""}>${escapeHtml(line.name)}</option>`).join("")}</select></label><label>此產線可用的共用模具（可複選）<select id="managedMoldIds" multiple size="4">${state.molds.filter(mold => mold.isActive).map(mold => `<option value="${escapeHtml(mold.id)}" ${assignedIds.has(mold.id) ? "selected" : ""}>${escapeHtml(mold.name)}${mold.moldType ? ` · ${escapeHtml(mold.moldType)}` : ""}</option>`).join("")}</select></label><button class="primary-action" type="submit">儲存模具授權</button></form>`;
}

async function saveLine(event) {
  event.preventDefault();
  const name = $("#newLineName").value.trim();
  try { await apiRequest("POST", "/lines", { name }); await refreshStateFromApi(); render(); }
  catch (error) { addLog("ERR", `新增產線失敗: ${error.message}`); render(); }
}

async function saveLineMolds(event) {
  event.preventDefault();
  const lineId = $("#managedLineId").value;
  const moldIds = [...$("#managedMoldIds").selectedOptions].map(option => option.value);
  try { await apiRequest("PUT", `/lines/${lineId}/molds`, { mold_ids: moldIds }); await refreshStateFromApi(); state.selectedManagementLineId = Number(lineId); render(); }
  catch (error) { addLog("ERR", `儲存產線模具授權失敗: ${error.message}`); render(); }
}

function getDerivedProduct() {
  const matId = $("#materialSelect") ? $("#materialSelect").value : null;
  const moldId = $("#moldSelect") ? $("#moldSelect").value : null;
  if (!matId || !moldId) return null;
  return state.products.find((p) =>
    p.moldId === moldId &&
    (state.bomTable || []).some((b) => b.productId === p.id && b.materialId === matId)
  ) || null;
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

      const showActions = canWrite();
      let actionHtml = "-";
      if (showActions && (order.status === "Pending" || order.status === "In_Progress")) {
        const inProgress = workOrderActionInProgress.has(order.id);
        const btnDisabled = inProgress ? "disabled" : "";
        const btnText = (originalText) => inProgress ? "處理中..." : originalText;

        actionHtml = `<div style="display: flex; gap: 4px;">`;
        if (order.status === "Pending") {
          actionHtml += `<button class="secondary-action wo-action-btn" data-action="start" data-id="${order.id}" style="padding: 4px 8px; font-size: 12px;" ${btnDisabled}>${btnText("開始")}</button>`;
        }
        actionHtml += `<button class="primary-action wo-action-btn" data-action="complete" data-id="${order.id}" style="padding: 4px 8px; font-size: 12px;" ${btnDisabled}>${btnText("完成")}</button>`;
        if (state.role === "admin" || state.role === "manager") {
          actionHtml += `<button class="danger-action wo-action-btn" data-action="reject" data-id="${order.id}" style="padding: 4px 8px; font-size: 12px;" ${btnDisabled}>${btnText("拒絕")}</button>`;
        }
        actionHtml += `</div>`;
      }

      return `
        <tr>
          <td><strong>${order.id}</strong></td>
          <td>${product ? product.name : order.productId}</td>
          <td>${order.quantity}</td>
          <td>${order.line}</td>
          <td>${mold ? mold.name : order.moldId}</td>
          <td><span class="status-pill ${statusClass}">${order.status}</span></td>
          <td>${order.creator}</td>
          <td>${actionHtml}</td>
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
              <p>${mold.id}${mold.moldType ? ` · ${escapeHtml(mold.moldType)}` : ""} · 共用模具</p>
            </div>
            <span class="status-pill ${mold.status === "Idle" ? "ok" : "warn"}">${translateMoldStatus(mold.status)}</span>
          </div>
          <p>適用產線：依產線品項能力自動判定（共用）</p>
          <p>預計放開：${mold.eta}</p>
          <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;">
            ${locked && canWrite() ? `<button class="secondary-action manual-release-mold-btn" data-id="${mold.id}" type="button">手動釋放</button>` : ""}
            ${canWrite() && !locked ? `<button class="danger-action delete-mold-btn admin-only" data-id="${mold.id}" type="button">刪除</button>` : ""}
          </div>
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

  // work_order_id 一律由後端在 PostgreSQL Transaction 內以 SEQUENCE
  // 原子產生，前端不再自行拼字串計算流水號。
  // （舊版用 `state.workOrders.length + 1` 算號碼是非原子操作，
  //   連續點擊或多人併發建單時會算出重複編號，撞上資料庫唯一鍵，
  //   這正是「Database constraint conflict」的成因。）
  const storedUser = getStoredUser();
  const payload = {
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
    const createdWorkOrder = await apiRequest("POST", "/work-orders", payload);
    const workOrderId =
      createdWorkOrder && createdWorkOrder.work_order_id
        ? createdWorkOrder.work_order_id
        : "-";
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

async function handleWorkOrderAction(id, action) {
  if (workOrderActionInProgress.has(id)) return;
  workOrderActionInProgress.add(id);
  render();

  try {
    await apiRequest("PUT", `/work-orders/${id}`, { action });
    addLog("INFO", `工單 ${id} 執行操作: ${action} 成功`);
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", `工單 ${id} 操作失敗: ${error.message}`);
  } finally {
    workOrderActionInProgress.delete(id);
    render();
  }
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

async function restockMaterials() {
  if (!canWrite()) return;

  const lowStock = state.materials.filter((m) => m.stock <= m.safety);
  if (lowStock.length === 0) {
    addLog("INFO", "目前無物料低於安全庫存，無需補料");
    render();
    return;
  }

  const restockable = lowStock.filter((m) => m.capacity > 0);
  const noCapacity = lowStock.filter((m) => !(m.capacity > 0));

  if (noCapacity.length > 0) {
    const names = noCapacity.map((m) => m.name).join("、");
    addLog("WARN", `${names} 未設定容量上限，無法自動判斷補料量，請改用「調整庫存」手動處理`);
  }

  if (restockable.length === 0) {
    render();
    return;
  }

  const summary = restockable
    .map((m) => `${m.name}：${formatAmount(m.stock)} → ${formatAmount(m.capacity)} ${m.unit}`)
    .join("\n");

  if (!confirm(`即將補足以下物料至容量上限：\n\n${summary}\n\n確定執行？`)) {
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const material of restockable) {
    const updated = { ...material, stock: material.capacity };
    try {
      await apiRequest("PUT", `/materials/${encodeURIComponent(material.id)}`, toApiMaterial(updated));
      addLog("INFO", `已補料 ${material.id} (${material.name}) 至 ${formatAmount(material.capacity)} ${material.unit}`);
      successCount++;
    } catch (error) {
      addLog("ERR", `補料失敗 ${material.id} (${material.name})：${error.message}`);
      failCount++;
    }
  }

  await refreshStateFromApi();
  addLog("INFO", `一鍵補料完成：成功 ${successCount} 項，失敗 ${failCount} 項`);
  render();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function renderAutoOrders() {
  const container = $("#autoOrderSuggestions");
  const confirmButton = $("#confirmAutoOrderButton");
  if (!container || !confirmButton) return;

  // 更新每一個多產品行的 select 選項
  const rowSelects = document.querySelectorAll('.auto-order-row-product');
  rowSelects.forEach(sel => {
    const selectedVal = sel.value;
    sel.innerHTML = state.products.map(product =>
      '<option value="' + escapeHtml(product.id) + '">' + escapeHtml(product.name) + ' (' + escapeHtml(product.id) + ')</option>'
    ).join("");
    if (selectedVal && getProduct(selectedVal)) sel.value = selectedVal;
  });

  const proposals = state.autoOrderProposals || [];
  if (proposals.length === 0) {
    container.innerHTML = '<p class="auto-order-empty">輸入產品與訂單數量後，按「產生最佳排程」。</p>';
    if (!autoOrderBusy) confirmButton.disabled = true;
  } else {
    container.innerHTML = proposals.map((item, index) => {
      return '<label class="auto-order-item">' +
        '<input type="checkbox" name="proposalIndex" value="' + index + '" checked>' +
        '<span><strong>' + escapeHtml(item.product_name) + '</strong> <small>' + escapeHtml(item.product_id) + '</small><br>' +
        '<span class="auto-order-detail">建議生產 ' + formatAmount(item.quantity) + ' 件｜產線 ' + escapeHtml(item.line) +
        '｜模具 ' + escapeHtml(item.mold_id) + '。依據：' + escapeHtml(item.reason || "資料庫分析結果") + '</span></span></label>';
    }).join("");
    if (!autoOrderBusy) {
      confirmButton.disabled = false;
      confirmButton.textContent = "建立工單並自動生產";
    }
  }
}


function getCapableMoldIdsForProduct(product) {
  const categoryMoldId = product.moldId || product.mold_id;
  const capableMoldIds = new Set([categoryMoldId]);

  const siblingProductIds = state.products
    .filter(p => (p.moldId || p.mold_id) === categoryMoldId)
    .map(p => p.id);

  for (const mold of state.molds) {
    if (mold.productId && siblingProductIds.includes(mold.productId)) {
      capableMoldIds.add(mold.id);
    }
  }
  return Array.from(capableMoldIds);
}

async function analyzeAutoOrders() {
  const result = $("#autoOrderResult");
  if (result) result.textContent = "";

  // 讀取所有多產品行
  const rows = document.querySelectorAll('.auto-order-row');
  const orderItems = [];
  for (const row of rows) {
    const productId = row.querySelector('.auto-order-row-product')?.value;
    const qty = Number(row.querySelector('.auto-order-row-qty')?.value || 0);
    const dueDate = row.querySelector('.auto-order-row-due')?.value || "9999-12-31";
    const product = getProduct(productId);
    if (!product || !Number.isInteger(qty) || qty <= 0) continue;
    orderItems.push({ product, quantity: qty, dueDate });
  }

  if (orderItems.length === 0) {
    if (result) result.textContent = "請至少輸入一個有效的產品與下單數量。";
    return;
  }

  // 根據 EDD (Earliest Due Date) + ECT (Earliest Completion Time) 進行最佳排程排序
  orderItems.sort((a, b) => {
    // 1. EDD：交期越早越優先
    if (a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    // 2. ECT：若交期相同，預估完成時間 (數量 * 材質速度) 越短越優先 (Shortest Job First)
    const ectA = a.quantity * getMaterialSpeedMs(a.product.id);
    const ectB = b.quantity * getMaterialSpeedMs(b.product.id);
    return ectA - ectB;
  });

  state.autoOrderProposals = [];
  const summaryParts = [];
  const lineUsageCount = {};

  for (const { product, quantity } of orderItems) {
    const optionMoldIds = getCapableMoldIdsForProduct(product);
    const candidateMolds = state.molds.filter(mold => mold.isActive && (mold.status === "Idle" || mold.status === "In_Use") && optionMoldIds.includes(mold.id)).slice(0, 10);
    const capableLines = state.lines.filter(line => line.isActive && state.lineMoldOptions.some(opt => opt.lineId === line.id && optionMoldIds.includes(opt.moldId)));

    if (candidateMolds.length === 0 || capableLines.length === 0) {
      summaryParts.push(`【${product.name}】${candidateMolds.length ? "沒有具備生產能力的啟用產線" : "找不到已啟用的可用模具"}，已略過。`);
      continue;
    }

    capableLines.sort((a, b) => (lineUsageCount[a.id] || 0) - (lineUsageCount[b.id] || 0));

    const slots = Math.min(candidateMolds.length, capableLines.length);
    const base = Math.floor(quantity / slots);
    const remainder = quantity % slots;

    const proposals = candidateMolds.slice(0, slots).map((mold, index) => {
      const assignedQuantity = base + (index < remainder ? 1 : 0);
      const line = capableLines[index];
      lineUsageCount[line.id] = (lineUsageCount[line.id] || 0) + 1;
      const rate = Math.round(3600000 / getMaterialSpeedMs(product.id));
      const moldStatusLabel = mold.status === "In_Use" ? "（使用中，將排隊等待）" : "";
      return {
        product_id: product.id, product_name: product.name, quantity: assignedQuantity,
        line: line.name, mold_id: mold.id,
        reason: `訂單 ${quantity} 件，使用 ${slots} 組產線／模具分配${moldStatusLabel}；${line.name} 速率 ${formatAmount(rate)} 件/小時`
      };
    }).filter(proposal => proposal.quantity > 0);

    state.autoOrderProposals.push(...proposals);
    summaryParts.push(`【${product.name}】${quantity} 件 → ${proposals.length} 條產線`);
  }

  if (result) result.textContent = summaryParts.length > 0
    ? summaryParts.join('；')
    : "沒有可用的排程結果。";
  renderAutoOrders();
}

// ============================================================
// AUTO PRODUCTION SIMULATION
// 速度依材質決定：塑膠=1s、鐵=2s、木頭=3s、玻璃=4s
// ============================================================

/**
 * 依產品的 BOM 材料名稱判斷主要材質，回傳每單位生產的毫秒數。
 * 規則：塑膠→1000ms、鐵→2000ms、木頭→3000ms、玻璃→4000ms，其餘預設1000ms。
 */
function getMaterialSpeedMs(productId) {
  const bomRows = getBomForProduct(productId);
  // 依最大用量的材料決定主材質
  let dominant = null;
  let maxAmount = -1;
  for (const row of bomRows) {
    if (row.amountPerUnit > maxAmount) {
      maxAmount = row.amountPerUnit;
      dominant = row.name || row.materialId;
    }
  }
  if (!dominant) return 1000; // 預設
  const n = dominant.toLowerCase();
  if (n.includes('塑膠') || n.includes('plastic')) return 1000;
  if (n.includes('鐵') || n.includes('iron') || n.includes('steel') || n.includes('metal')) return 2000;
  if (n.includes('木') || n.includes('wood')) return 3000;
  if (n.includes('玻璃') || n.includes('glass')) return 4000;
  return 1000; // 未知材質預設 1 秒
}

// 模擬生產進度：依材質速度 +1，直到 quantity，完成後 complete 工單
async function simulateProduction(workOrderId, productName, quantity, productId) {
  const progressArea = $("#autoProductionProgress");
  const list = $("#autoProductionList");
  if (!progressArea || !list) return;
  progressArea.style.display = "block";

  // 建立此工單的進度條元素
  const itemId = "prod-item-" + workOrderId;
  const item = document.createElement("div");
  item.id = itemId;
  item.style.cssText = "background:var(--surface-2,rgba(255,255,255,0.04)); border-radius:8px; padding:10px 14px; display:flex; flex-direction:column; gap:6px;";
  item.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <span><strong>${escapeHtml(productName)}</strong> <code style="font-size:12px;">${escapeHtml(workOrderId)}</code></span>
      <span class="status-pill ok" id="pill-${escapeHtml(workOrderId)}">生產中</span>
    </div>
    <div style="display:flex; align-items:center; gap:8px;">
      <div style="flex:1; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
        <div id="bar-${escapeHtml(workOrderId)}" style="height:100%; width:0%; background:var(--accent,#7c6ef2); border-radius:4px; transition:width 0.3s;"></div>
      </div>
      <span id="cnt-${escapeHtml(workOrderId)}" style="font-size:12px; min-width:80px; text-align:right;">0 / ${quantity}</span>
    </div>
  `;
  list.prepend(item);

  let produced = 0;
  await new Promise(resolve => {
    const timer = setInterval(() => {
      produced = Math.min(produced + 1, quantity);
      const bar = document.getElementById("bar-" + workOrderId);
      const cnt = document.getElementById("cnt-" + workOrderId);
      if (bar) bar.style.width = ((produced / quantity) * 100).toFixed(1) + "%";
      if (cnt) cnt.textContent = produced + " / " + quantity;
      if (produced >= quantity) {
        clearInterval(timer);
        resolve();
      }
    }, getMaterialSpeedMs(productId));
  });

  // 完成：更新 UI 狀態
  const pill = document.getElementById("pill-" + workOrderId);
  if (pill) { pill.textContent = "完成"; pill.classList.remove("ok"); pill.classList.add("ok"); }
  item.style.opacity = "0.6";

  // 呼叫 complete API
  try {
    await apiRequest("PUT", `/work-orders/${workOrderId}`, { action: "complete" });
    addLog("INFO", `工單 ${workOrderId} (${productName}) 自動生產完成`);
  } catch (err) {
    addLog("ERR", `工單 ${workOrderId} 完成失敗: ${err.message}`);
  }
}

async function saveAutoOrders(event) {
  event.preventDefault();
  const result = $("#autoOrderResult");
  if (!canWrite()) {
    if (result) result.textContent = "建立採購單需要主管或管理員權限。";
    return;
  }
  if (autoOrderBusy) {
    if (result) result.textContent = "正在建立工單中，請稍候…";
    return;
  }

  const selectedIndexes = [...document.querySelectorAll('#autoOrderSuggestions input[name="proposalIndex"]:checked')].map(input => Number(input.value));
  if (selectedIndexes.length === 0) {
    if (result) result.textContent = "請至少勾選一項工單建議。";
    return;
  }
  const user = getStoredUser();
  const selected = selectedIndexes.map(index => state.autoOrderProposals[index]).filter(Boolean);
  if (selected.length === 0) {
    if (result) result.textContent = "沒有有效的排程建議，請重新產生排程。";
    return;
  }

  autoOrderBusy = true;
  const confirmBtn = $("#confirmAutoOrderButton");
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "建立中…"; }

  // ── 步驟 0：自動補料 ──
  if (result) result.textContent = "檢查物料庫存…";
  const materialNeeds = new Map();
  for (const proposal of selected) {
    const bomRows = getBomForProduct(proposal.product_id);
    for (const row of bomRows) {
      const prev = materialNeeds.get(row.materialId) || 0;
      materialNeeds.set(row.materialId, prev + row.amountPerUnit * proposal.quantity);
    }
  }
  const toRestock = [];
  for (const [materialId, required] of materialNeeds) {
    const mat = getMaterial(materialId);
    if (!mat) continue;
    if (mat.stock < required) {
      const targetStock = Math.max(mat.capacity > 0 ? mat.capacity : 0, Math.ceil(required));
      toRestock.push({ mat, targetStock });
    }
  }
  if (toRestock.length > 0) {
    if (result) result.textContent = `物料不足，自動補料中（${toRestock.map(r => r.mat.name).join("、")})…`;
    for (const { mat, targetStock } of toRestock) {
      try {
        await apiRequest("PUT", `/materials/${encodeURIComponent(mat.id)}`, toApiMaterial({ ...mat, stock: targetStock }));
        addLog("INFO", `自動補料：${mat.name} 庫存補至 ${formatAmount(targetStock)} ${mat.unit}`);
      } catch (err) {
        addLog("ERR", `自動補料失敗 ${mat.name}：${err.message}`);
      }
    }
    await refreshStateFromApi();
  }

  // ── 步驟 1：立即建立所有工單 ──
  if (result) result.textContent = "建立工單中，請稍候…";
  const created = [];
  const failed = [];
  for (const proposal of selected) {
    try {
      const workOrder = await apiRequest("POST", "/work-orders", {
        product_id: proposal.product_id, quantity: proposal.quantity, line: proposal.line,
        mold_id: proposal.mold_id, creator_user_id: user?.user_id || null, creator_name: user?.user_id || null
      });
      created.push({ workOrderId: workOrder.work_order_id, productName: proposal.product_name, quantity: proposal.quantity, moldId: proposal.mold_id, productId: proposal.product_id });
      addLog("INFO", `工單 ${workOrder.work_order_id} 已建立並排入佇列（${proposal.product_name} × ${proposal.quantity}）`);
    } catch (error) {
      failed.push(proposal.product_name + "：" + error.message);
      addLog("ERR", `工單建立失敗 ${proposal.product_name}: ${error.message}`);
    }
  }

  // Refresh so kanban shows the new Pending work orders
  await refreshStateFromApi();
  renderQuiet();

  autoOrderBusy = false;
  if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "建立工單並自動生產"; }
  if (result) result.textContent = `已建立 ${created.length} 張工單並排入生產佇列！${failed.length ? "；失敗：" + failed.join("；") : ""}`;

  // ── 步驟 2：依模具推入全域佇列，自動排隊執行 ──
  for (const { workOrderId, productName, quantity, moldId, productId } of created) {
    enqueueMoldTask(moldId, { workOrderId, productName, quantity, productId });
  }
}


// ============================================================
// GLOBAL PER-MOLD PRODUCTION QUEUE
// Persists across multiple saveAutoOrders() calls.
// ============================================================

const moldQueues = new Map();

function enqueueMoldTask(moldId, task) {
  if (!moldQueues.has(moldId)) {
    moldQueues.set(moldId, { queue: [], running: false, currentTask: null });
  }
  moldQueues.get(moldId).queue.push(task);
  renderQueuePanel();
  runMoldQueue(moldId);
}

async function runMoldQueue(moldId) {
  const qs = moldQueues.get(moldId);
  if (!qs || qs.running) return;
  qs.running = true;
  console.log(`[Queue] 模具 ${moldId} 佇列開始，共 ${qs.queue.length} 張`);

  while (qs.queue.length > 0) {
    const task = qs.queue.shift();
    qs.currentTask = task;
    renderQueuePanel();
    updateMoldQueueBadge(moldId, qs.queue.length);
    console.log(`[Queue] 開始處理工單 ${task.workOrderId} (${task.productName})`);
    try {
      // 1. Start work order (backend locks the mold here)
      console.log(`[Queue] PUT start ${task.workOrderId}`);
      await apiRequest("PUT", `/work-orders/${task.workOrderId}`, { action: "start" });
      addLog("INFO", `工單 ${task.workOrderId} 開始生產（${task.productName}）`);
      await refreshStateFromApi();
      renderQuiet();

      // 2. Simulate production (speed depends on material type) then complete
      const speedMs = getMaterialSpeedMs(task.productId);
      console.log(`[Queue] simulateProduction ${task.workOrderId} qty=${task.quantity} speed=${speedMs}ms/unit`);
      await simulateProduction(task.workOrderId, task.productName, task.quantity, task.productId);

      await refreshStateFromApi();
      renderQuiet();
    } catch (err) {
      console.error(`[Queue] 工單 ${task.workOrderId} 失敗:`, err);
      addLog("ERR", `工單 ${task.workOrderId} 執行失敗: ${err.message}`);
    }
    qs.currentTask = null;
    renderQueuePanel();
    updateMoldQueueBadge(moldId, qs.queue.length);
  }

  qs.running = false;
  renderQueuePanel();
}

function updateMoldQueueBadge(moldId, remaining) {
  // Show remaining queue count in the progress area
  const badge = document.getElementById(`mold-queue-${moldId}`);
  if (badge) {
    badge.textContent = remaining > 0 ? `模具 ${moldId} 排隊中：${remaining} 張` : "";
    badge.style.display = remaining > 0 ? "block" : "none";
  }
}

function renderQueuePanel() {
  const panel = document.getElementById("queueStatusPanel");
  if (!panel) return;

  // Check if anything is happening at all
  let totalActive = 0;
  for (const [, qs] of moldQueues) {
    if (qs.currentTask || qs.queue.length > 0) totalActive++;
  }

  if (totalActive === 0) {
    panel.innerHTML = `<p style="color:var(--muted);font-size:13px;margin:0;">目前沒有排程執行中。</p>`;
    return;
  }

  let html = "";
  for (const [moldId, qs] of moldQueues) {
    if (!qs.currentTask && qs.queue.length === 0) continue;

    const moldName = (state.molds.find(m => m.id === moldId) || {}).name || moldId;

    html += `<div class="queue-mold-group" style="margin-bottom:12px; padding:10px; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.1); border-radius:8px;">
      <div class="queue-mold-header" style="margin-bottom:8px;">
        <span class="queue-mold-icon">⚙️</span>
        <strong>${escapeHtml(moldName)}</strong>
        <span class="queue-count-badge" style="margin-left:8px; font-size:12px; color:var(--muted);">共 ${(qs.queue.length + (qs.currentTask ? 1 : 0))} 張</span>
      </div>`;

    // Currently running task
    if (qs.currentTask) {
      const t = qs.currentTask;
      const barEl = document.getElementById(`bar-${t.workOrderId}`);
      const cntEl = document.getElementById(`cnt-${t.workOrderId}`);
      const produced = cntEl ? parseInt(cntEl.textContent) : 0;
      const pct = t.quantity > 0 ? Math.round((produced / t.quantity) * 100) : 0;
      html += `<div class="queue-task running" style="margin-bottom:6px; padding-left:12px; border-left:2px solid var(--ok);">
        <div class="queue-task-header">
          <span class="queue-status-dot running" style="color:var(--ok);">●</span>
          <span class="queue-task-name">${escapeHtml(t.productName)}</span>
          <code class="queue-task-id" style="font-size:11px; margin-left:6px; color:var(--muted);">${escapeHtml(t.workOrderId)}</code>
          <span class="queue-task-tag running" style="font-size:11px; color:var(--ok); margin-left:8px;">生產中</span>
        </div>
        <div class="queue-bar-wrap" style="margin-top:4px;">
          <div class="queue-bar-track" style="width:100%; height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
            <div class="queue-bar-fill" id="qbar-${t.workOrderId}" style="width:${pct}%; height:100%; background:var(--ok); transition:width 1s linear;"></div>
          </div>
          <span class="queue-bar-label" id="qcnt-${t.workOrderId}" style="font-size:11px; color:var(--muted);">${produced} / ${t.quantity} 件</span>
        </div>
      </div>`;
    }

    // Waiting tasks
    qs.queue.forEach((t, idx) => {
      html += `<div class="queue-task waiting" style="margin-bottom:6px; padding-left:12px; border-left:2px solid var(--muted);">
        <div class="queue-task-header">
          <span class="queue-status-dot waiting" style="color:var(--muted);">●</span>
          <span class="queue-task-name">${escapeHtml(t.productName)}</span>
          <code class="queue-task-id" style="font-size:11px; margin-left:6px; color:var(--muted);">${escapeHtml(t.workOrderId)}</code>
          <span class="queue-task-tag waiting" style="font-size:11px; color:var(--warn); margin-left:8px;">等待中 #${idx + 1}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);padding-left:14px;">${t.quantity} 件待生產</div>
      </div>`;
    });

    html += `</div>`;
  }

  panel.innerHTML = html;

  // Sync progress bars from simulateProduction's live DOM elements
  for (const [, qs] of moldQueues) {
    if (!qs.currentTask) continue;
    const t = qs.currentTask;
    const srcBar = document.getElementById(`bar-${t.workOrderId}`);
    const srcCnt = document.getElementById(`cnt-${t.workOrderId}`);
    const dstBar = document.getElementById(`qbar-${t.workOrderId}`);
    const dstCnt = document.getElementById(`qcnt-${t.workOrderId}`);
    if (srcBar && dstBar) dstBar.style.width = srcBar.style.width;
    if (srcCnt && dstCnt) dstCnt.textContent = srcCnt.textContent;
  }
}

// Keep the queue panel in sync with simulateProduction every second
setInterval(renderQueuePanel, 1000);


async function releaseScheduledMolds() {
  if (!canWrite()) return;

  // 根據警告「模具排程放開需透過工單完成/拒絕 API」，
  // 我們必須找出所有正在佔用模具的活躍工單，並透過 API 將其完成。
  const activeWOs = state.workOrders.filter(wo => wo.status === 'Pending' || wo.status === 'In_Progress');

  if (activeWOs.length === 0) {
    addLog("INFO", "目前沒有活躍工單佔用模具");
    render();
    return;
  }

  try {
    for (const wo of activeWOs) {
      await apiRequest("PUT", `/work-orders/${wo.id}`, { action: "complete" });
      addLog("INFO", `已透過完成工單 ${wo.id} 釋放模具`);
    }
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", `釋放模具失敗: ${error.message}`);
    render();
  }
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
  const m3 = $("#moldModal");
  if (m1) m1.close();
  if (m2) m2.close();
  if (m3) m3.close();
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
// QUESTION FEATURE
// ============================================================

function bindQuestionEvents() {
  const questionBtn = document.getElementById('questionButton');
  const questionModal = document.getElementById('questionModal');
  const questionForm = document.getElementById('questionForm');
  const questionInput = document.getElementById('questionInput');
  const questionMessages = document.getElementById('questionMessages');
  const questionMinimizeBtn = document.getElementById('questionMinimizeBtn');

  if (!questionBtn || !questionModal || !questionForm || !questionInput || !questionMessages) {
    // 對應 HTML 元素不存在時直接跳過，避免拋出錯誤影響其他功能
    return;
  }

  function scrollMessagesToBottom() {
    questionMessages.scrollTop = questionMessages.scrollHeight;
  }

  function clearEmptyState() {
    const empty = questionMessages.querySelector('.question-messages-empty');
    if (empty) empty.remove();
  }

  // role: 'user' | 'assistant' | 'pending' | 'error'
  function appendMessage(role, text) {
    clearEmptyState();
    const bubble = document.createElement('div');
    bubble.className = `question-message ${role}`;
    bubble.textContent = text;
    questionMessages.appendChild(bubble);
    scrollMessagesToBottom();
    return bubble;
  }

  // 打開視窗：對話紀錄一律保留（連續對話），只做捲動與聚焦
  questionBtn.addEventListener('click', () => {
    questionModal.showModal();
    scrollMessagesToBottom();
    questionInput.focus();
  });

  // 縮小：只關閉視窗，不清空對話內容，之後點擊 ❓ 會恢復原本的對話
  if (questionMinimizeBtn) {
    questionMinimizeBtn.addEventListener('click', () => {
      questionModal.close();
    });
  }

  // 點擊 modal 外部時視為「縮小」，同樣保留對話內容
  questionModal.addEventListener('click', (e) => {
    if (e.target === questionModal) {
      questionModal.close();
    }
  });

  questionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = questionInput.value.trim();
    if (!question) {
      return;
    }

    appendMessage('user', question);
    questionInput.value = '';
    questionInput.style.height = 'auto';

    const pendingBubble = appendMessage('pending', '思考中…');
    const sendBtn = questionForm.querySelector('.question-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
      // 使用專案既有的 apiRequest()：自動帶 JWT、401 時會自動登出導回登入畫面，
      // 跟其他 API 呼叫（materials、work-orders 等）行為一致。
      const data = await apiRequest('POST', '/question', { question });
      pendingBubble.textContent = data.answer || '無法取得回答';
      pendingBubble.className = 'question-message assistant';
    } catch (err) {
      console.error('Question error:', err);
      // apiRequest 拋出的 Error 已經是可讀的中文訊息（含 401 認證失敗等情況）
      pendingBubble.textContent = err.message || '發生錯誤，請稍後再試';
      pendingBubble.className = 'question-message error';
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      scrollMessagesToBottom();
      questionInput.focus();
    }
  });

  // 按 Enter 送出，Shift+Enter 換行
  questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      questionForm.requestSubmit();
    }
  });
}

// ============================================================
// APP INIT
// ============================================================

async function initializeApp() {
  addLog("INFO", "連線到後端 API…");
  render();

  setLoading(true);
  try {
    await apiRequest("GET", "/health");
    await refreshStateFromApi();
    render();
  } catch (error) {
    state.error = error.message;
    addLog("ERR", `API 連線失敗：${error.message}`);
    render();
  } finally {
    setLoading(false);
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

  const autoOrderForm = $("#autoOrderForm");
  if (autoOrderForm) autoOrderForm.addEventListener("submit", saveAutoOrders);
  const analyzeAutoOrderButton = $("#analyzeAutoOrderButton");
  if (analyzeAutoOrderButton) analyzeAutoOrderButton.addEventListener("click", analyzeAutoOrders);

  // ── 多產品行管理 ──
  const addRowBtn = $("#addAutoOrderRowBtn");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", () => {
      const container = $("#autoOrderRowsContainer");
      if (!container) return;
      const rowCount = container.querySelectorAll('.auto-order-row').length;
      const newRow = document.createElement("div");
      newRow.className = "auto-order-row";
      newRow.dataset.row = rowCount;
      newRow.style.cssText = "display:flex; align-items:center; gap:10px; background:var(--surface-2,rgba(255,255,255,0.04)); border-radius:8px; padding:10px 14px;";
      const productOptions = state.products.map(p =>
        '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + ' (' + escapeHtml(p.id) + ')</option>'
      ).join("");
      newRow.innerHTML = `
        <label style="flex:2; margin:0;">訂單產品
          <select class="auto-order-row-product" name="autoOrderProduct[]" required>${productOptions}</select>
        </label>
        <label style="flex:1; margin:0;">下單數量
          <input class="auto-order-row-qty" name="autoOrderQuantity[]" type="number" min="1" step="1" placeholder="例如 5000" required>
        </label>
        <label style="flex:1; margin:0;">交期 (EDD)
          <input class="auto-order-row-due" name="autoOrderDue[]" type="date" required>
        </label>
        <button type="button" class="remove-auto-order-row danger-action" style="margin-top:20px; padding:4px 10px; font-size:13px;" aria-label="刪除此行">✕</button>
      `;
      container.appendChild(newRow);
      // 顯示所有刪除鈕（超過 1 行時）
      container.querySelectorAll('.remove-auto-order-row').forEach(btn => btn.style.display = "");
    });
  }

  // 刪除行（事件委派）
  const rowsContainer = $("#autoOrderRowsContainer");
  if (rowsContainer) {
    rowsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-auto-order-row")) {
        const row = e.target.closest(".auto-order-row");
        if (row) row.remove();
        // 只剩 1 行時隱藏刪除鈕
        const remaining = rowsContainer.querySelectorAll('.auto-order-row');
        if (remaining.length === 1) {
          remaining[0].querySelector('.remove-auto-order-row').style.display = "none";
        }
      }
    });
  }

  const releaseMoldsBtn = $("#releaseMoldsButton");
  if (releaseMoldsBtn) releaseMoldsBtn.addEventListener("click", releaseScheduledMolds);

  const productionManagement = $("#productionManagement");
  if (productionManagement) {
    productionManagement.addEventListener("submit", (event) => {
      if (event.target.id === "addLineForm") saveLine(event);
      if (event.target.id === "lineRateForm") saveLineRate(event);
      if (event.target.id === "itemMoldForm") saveItemMolds(event);
      if (event.target.id === "lineMoldForm") saveLineMolds(event);
    });
    productionManagement.addEventListener("click", async (event) => {
      const button = event.target.closest(".toggle-line-btn");
      if (!button) return;
      try {
        await apiRequest("PATCH", `/lines/${button.dataset.id}`, { is_active: button.dataset.active !== "true" });
        await refreshStateFromApi(); render();
      } catch (error) { addLog("ERR", `更新產線狀態失敗: ${error.message}`); render(); }
    });
  }

  // 模具管理 (新增 / 刪除)
  const addMoldBtn = $("#addMoldButton");
  if (addMoldBtn) addMoldBtn.addEventListener("click", showMoldModal);

  const moldForm = $("#moldForm");
  if (moldForm) moldForm.addEventListener("submit", saveMold);

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

  const workOrderTable = $("#workOrderTable");
  if (workOrderTable) {
    workOrderTable.addEventListener("click", (e) => {
      if (e.target.classList.contains("wo-action-btn")) {
        const id = e.target.dataset.id;
        const action = e.target.dataset.action;
        handleWorkOrderAction(id, action);
      }
    });
  }

  const moldCards = $("#moldCards");
  if (moldCards) {
    moldCards.addEventListener("click", async (e) => {
      if (e.target.classList.contains("manual-release-mold-btn")) {
        const id = e.target.dataset.id;
        const mold = state.molds.find(m => m.id === id);
        if (!mold) return;
        try {
          e.target.disabled = true;
          e.target.textContent = "處理中...";
          await apiRequest("PUT", `/molds/${id}`, {
            name: mold.name,
            status: "Idle",
            line: mold.line === "-" ? null : mold.line,
            eta: mold.eta === "-" ? null : mold.eta,
            product_id: null,
            code: mold.code || null,
            mold_type: mold.moldType || null,
            is_active: mold.isActive,
            version: mold.version
          });
          addLog("INFO", `已手動強制釋放模具: ${mold.name} (${id})`);
          await refreshStateFromApi();
        } catch (err) {
          addLog("ERR", `手動釋放失敗: ${err.message}`);
          render();
        }
      } else if (e.target.classList.contains("delete-mold-btn")) {
        deleteMold(e.target.dataset.id);
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
      const loginBtn = document.getElementById("loginBtn");
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = "登入";
      }
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
      } finally {
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
  bindQuestionEvents();

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
