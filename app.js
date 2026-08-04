const STORAGE_KEY = "wms-mes-demo-state";

const seedState = {
  role: "operator",
  activeView: "workorders",
  materials: [
    { id: "MAT-ABS", name: "ABS 塑料粒", unit: "kg", stock: 860, capacity: 1200, safety: 260, location: "A-01-03" },
    { id: "MAT-SCREW", name: "M3 螺絲", unit: "pcs", stock: 3200, capacity: 5000, safety: 1000, location: "B-12-01" },
    { id: "MAT-PCB", name: "控制板 PCB", unit: "pcs", stock: 460, capacity: 800, safety: 180, location: "E-02-09" },
    { id: "MAT-LABEL", name: "序號標籤", unit: "pcs", stock: 1900, capacity: 3000, safety: 600, location: "P-04-02" }
  ],
  molds: [
    { id: "MOLD-A17", name: "上蓋射出模", status: "available", line: "-", eta: "-", productId: "PRD-A100" },
    { id: "MOLD-B08", name: "底座射出模", status: "available", line: "-", eta: "-", productId: "PRD-B220" },
    { id: "MOLD-C31", name: "面板沖壓模", status: "maintenance", line: "保養室", eta: "16:30", productId: "PRD-C310" }
  ],
  products: [
    {
      id: "PRD-A100",
      name: "智慧感測盒 A100",
      cycleMinutes: 36,
      moldId: "MOLD-A17",
      bom: [
        { materialId: "MAT-ABS", amount: 0.42 },
        { materialId: "MAT-SCREW", amount: 6 },
        { materialId: "MAT-PCB", amount: 1 },
        { materialId: "MAT-LABEL", amount: 1 }
      ]
    },
    {
      id: "PRD-B220",
      name: "馬達控制器 B220",
      cycleMinutes: 52,
      moldId: "MOLD-B08",
      bom: [
        { materialId: "MAT-ABS", amount: 0.65 },
        { materialId: "MAT-SCREW", amount: 8 },
        { materialId: "MAT-PCB", amount: 1 },
        { materialId: "MAT-LABEL", amount: 1 }
      ]
    },
    {
      id: "PRD-C310",
      name: "工業面板 C310",
      cycleMinutes: 48,
      moldId: "MOLD-C31",
      bom: [
        { materialId: "MAT-ABS", amount: 0.38 },
        { materialId: "MAT-SCREW", amount: 4 },
        { materialId: "MAT-LABEL", amount: 1 }
      ]
    }
  ],
  workOrders: [
    { id: "WO-260804-001", productId: "PRD-B220", quantity: 60, line: "L2", moldId: "MOLD-B08", status: "已完工", creator: "管理員" }
  ],
  lastAutomation: null,
  logs: [
    { type: "INFO", message: "系統初始化：載入材料、模具與產品主資料。", time: "08:00:00" }
  ]
};

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
  if (!saved) return structuredClone(seedState);

  try {
    return { ...structuredClone(seedState), ...JSON.parse(saved) };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return structuredClone(seedState);
  }
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

function calculateRequirements(productId, quantity) {
  const product = getProduct(productId);
  return product.bom.map((item) => {
    const material = getMaterial(item.materialId);
    return {
      ...item,
      name: material.name,
      unit: material.unit,
      stock: material.stock,
      required: item.amount * quantity,
      afterStock: material.stock - item.amount * quantity
    };
  });
}

function render() {
  renderRole();
  renderNavigation();
  renderMetrics();
  renderProductOptions();
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

  $$(".admin-only").forEach((button) => {
    button.disabled = state.role !== "admin";
    button.title = state.role === "admin" ? "" : "此操作限管理員";
  });
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

function renderProductOptions() {
  const select = $("#productSelect");
  const currentValue = select.value || state.products[0].id;
  select.innerHTML = state.products
    .map((product) => `<option value="${product.id}">${product.name}</option>`)
    .join("");
  select.value = state.products.some((product) => product.id === currentValue) ? currentValue : state.products[0].id;
}

function renderPreview() {
  const product = getProduct($("#productSelect").value || state.products[0].id);
  const quantity = Number($("#quantityInput").value || 0);
  const requirements = calculateRequirements(product.id, Math.max(quantity, 0));
  const mold = getMold(product.moldId);
  const rows = requirements
    .map((item) => {
      const warning = item.afterStock < 0 ? "bad" : item.afterStock < getMaterial(item.materialId).safety ? "warn" : "ok";
      return `<div><strong>${item.name}</strong> 需求 ${formatAmount(item.required)} ${item.unit} <span class="status-pill ${warning}">餘量 ${formatAmount(item.afterStock)}</span></div>`;
    })
    .join("");

  $("#calculationPreview").innerHTML = `
    <div><strong>綁定模具：</strong>${mold.name} <span class="status-pill ${mold.status === "available" ? "ok" : "warn"}">${mold.status}</span></div>
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
        </article>
      `;
    })
    .join("");
}

function renderMolds() {
  $("#moldCards").innerHTML = state.molds
    .map((mold) => {
      const locked = mold.status !== "available";
      const product = getProduct(mold.productId);
      return `
        <article class="mold-card ${locked ? "locked" : ""}">
          <div class="card-top">
            <div>
              <h4>${mold.name}</h4>
              <p>${mold.id} · 綁定 ${product.name}</p>
            </div>
            <span class="status-pill ${mold.status === "available" ? "ok" : "warn"}">${translateMoldStatus(mold.status)}</span>
          </div>
          <p>目前位置：${mold.line}</p>
          <p>預計釋放：${mold.eta}</p>
        </article>
      `;
    })
    .join("");
}

function renderProducts() {
  $("#productCards").innerHTML = state.products
    .map((product) => {
      const mold = getMold(product.moldId);
      const bom = product.bom
        .map((item) => {
          const material = getMaterial(item.materialId);
          return `<p>${material.name}: ${formatAmount(item.amount)} ${material.unit}/件</p>`;
        })
        .join("");

      return `
        <article class="product-card">
          <div class="card-top">
            <div>
              <h4>${product.name}</h4>
              <p>${product.id} · 標準節拍 ${product.cycleMinutes} 分鐘</p>
            </div>
            <span class="status-pill ${mold.status === "available" ? "ok" : "warn"}">${mold.id}</span>
          </div>
          ${bom}
        </article>
      `;
    })
    .join("");
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
    available: "可用",
    scheduled: "已排程",
    maintenance: "保養中"
  }[status];
}

function submitWorkOrder(event) {
  event.preventDefault();

  const productId = $("#productSelect").value;
  const quantity = Number($("#quantityInput").value);
  const line = $("#lineSelect").value;
  const product = getProduct(productId);
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

  if (mold.status !== "available") {
    addLog("WARN", `工單暫停：${mold.name} 目前${translateMoldStatus(mold.status)}，無法綁定到 ${line}。`);
    state.lastAutomation = { failedAt: 2, success: false };
    render();
    return;
  }

  requirements.forEach((item) => {
    const material = getMaterial(item.materialId);
    material.stock = Number((material.stock - item.required).toFixed(2));
  });

  mold.status = "scheduled";
  mold.line = line;
  mold.eta = estimateEta(product.cycleMinutes, quantity);

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
    if (mold.status !== "scheduled") return mold;
    count += 1;
    return { ...mold, status: "available", line: "-", eta: "-" };
  });
  addLog("INFO", `管理員已釋放 ${count} 組已排程模具。`);
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

  $("#productSelect").addEventListener("change", renderPreview);
  $("#quantityInput").addEventListener("input", renderPreview);
  $("#workOrderForm").addEventListener("submit", submitWorkOrder);
  $("#restockButton").addEventListener("click", restockMaterials);
  $("#releaseMoldsButton").addEventListener("click", releaseScheduledMolds);
  $("#resetButton").addEventListener("click", resetState);
}

bindEvents();
render();
