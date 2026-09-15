const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

if (!html.includes('id="lineCards"')) {
  html = html.replace(
    /<section id="molds" class="view" aria-labelledby="moldsTitle">\s*<div class="panel table-panel">\s*<div class="panel-heading">\s*<div>\s*<p class="eyebrow">MES Mold Scheduler<\/p>\s*<h3 id="moldsTitle">Ê®°ÂÖ∑?íÁ?<\/h3>\s*<\/div>/,
    `<section id="molds" class="view" aria-labelledby="moldsTitle">
        <div class="panel table-panel" style="margin-bottom: 20px;">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Factory Lines</p>
              <h3>?¢Á?ÁÆ°Á?</h3>
            </div>
            <div style="display:flex; gap:8px;">
              <button id="addLineButton" class="primary-action admin-only" type="button">?∞Â??¢Á?</button>
            </div>
          </div>
          <div id="lineCards" class="mold-grid"></div>
        </div>

        <div class="panel table-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">MES Mold Scheduler</p>
              <h3 id="moldsTitle">Ê®°ÂÖ∑?íÁ?</h3>
            </div>
            <div style="display:flex; gap:8px;">
              <button id="addMoldButton" class="primary-action admin-only" type="button">?∞Â?Ê®°ÂÖ∑</button>`
  );

  const modals = `
  <!-- Mold Modal -->
  <div id="moldModal" class="modal-overlay" style="display: none;">
    <div class="modal">
      <div class="modal-header">
        <h3 id="moldModalTitle">?∞Â?Ê®°ÂÖ∑</h3>
        <button class="close-modal-btn" aria-label="?úÈ?">??/button>
      </div>
      <form id="moldForm" class="modal-body">
        <label>Ê®°ÂÖ∑‰ª?? (ID) <span style="color:var(--danger)">*</span>
          <input type="text" id="moldIdInput" name="mold_id" required>
        </label>
        <label>Ê®°ÂÖ∑?çÁ®± <span style="color:var(--danger)">*</span>
          <input type="text" id="moldNameInput" name="name" required>
        </label>
        <div class="modal-footer" style="margin-top: 16px;">
          <button type="submit" class="primary-action">?≤Â?</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Line Modal -->
  <div id="lineModal" class="modal-overlay" style="display: none;">
    <div class="modal">
      <div class="modal-header">
        <h3 id="lineModalTitle">?∞Â??¢Á?</h3>
        <button class="close-modal-btn" aria-label="?úÈ?">??/button>
      </div>
      <form id="lineForm" class="modal-body">
        <label>?¢Á?‰ª?? (ID) <span style="color:var(--danger)">*</span>
          <input type="text" id="lineIdInput" name="line_id" required>
        </label>
        <label>?¢Á??çÁ®± <span style="color:var(--danger)">*</span>
          <input type="text" id="lineNameInput" name="name" required>
        </label>
        <div class="modal-footer" style="margin-top: 16px;">
          <button type="submit" class="primary-action">?≤Â?</button>
        </div>
      </form>
    </div>
  </div>
  `;
  html = html.replace(/<script src=".\/app\.js\?v=\d+"><\/script>/, modals + '\n  <script src="app.js"></script>');
  html = html.replace(/<div style="display:flex; gap:16px; margin:12px 14px; align-items:center;">\s*<label style="margin:0; flex:1;">?¢Á??çÁΩÆ[\s\S]*?<\/label>\s*<\/div>/, '');

  if (!html.includes('id="addAutoOrderRowBtn"')) {
    html = html.replace(
      /<!-- Â§öÁî¢?ÅË??ÆËº∏?•Â? -->\s*<div style="display:flex; gap:16px; margin:12px 14px; align-items:center;">\s*<label style="margin:0; flex:2;">Ë®ÇÂñÆ?¢Â?\s*<select id="autoOrderProduct" required><\/select>\s*<\/label>\s*<label style="margin:0; flex:1;">‰∏ãÂñÆ?∏È?\s*<input id="autoOrderQuantity" type="number" min="1" step="1" placeholder="‰æãÂ? 5000" required>\s*<\/label>\s*<\/div>/,
      `<!-- Â§öÁî¢?ÅË??ÆËº∏?•Â? -->
          <div id="autoOrderRowsContainer" style="display:flex; flex-direction:column; gap:10px; margin-bottom:12px;">
            <div class="auto-order-row" data-row="0" style="display:flex; align-items:center; gap:10px; background:var(--surface-2,rgba(255,255,255,0.04)); border-radius:8px; padding:10px 14px;">
              <label style="flex:2; margin:0;">Ë®ÇÂñÆ?¢Â?
                <select class="auto-order-row-product" name="autoOrderProduct[]" required></select>
              </label>
              <label style="flex:1; margin:0;">‰∏ãÂñÆ?∏È?
                <input class="auto-order-row-qty" name="autoOrderQuantity[]" type="number" min="1" step="1" placeholder="‰æãÂ? 5000" required>
              </label>
              <label style="flex:1; margin:0;">?üÈ? (EDD)
                <input class="auto-order-row-due" name="autoOrderDue[]" type="date" required>
              </label>
              <button type="button" class="remove-auto-order-row danger-action" style="margin-top:20px; padding:4px 10px; font-size:13px; display:none;" aria-label="ÁßªÈô§Ê≠§Ë???>??/button>
            </div>
          </div>
          <div style="text-align:center; margin-bottom:12px;">
            <button type="button" id="addAutoOrderRowBtn" class="secondary-action">Ôº??∞Â??¢Â?</button>
          </div>`
    );
  }
  fs.writeFileSync('index.html', html, 'utf8');
}


let appJs = fs.readFileSync('app.js', 'utf8');
appJs = appJs.replace(/molds: \[\],/, 'molds: [],\n    lines: [],');

if (!appJs.includes('apiRequest("GET", "/lines")')) {
  appJs = appJs.replace(
    /const requests = \[\s*apiRequest\("GET", "\/materials"\),\s*apiRequest\("GET", "\/products"\),\s*apiRequest\("GET", "\/molds"\),\s*apiRequest\("GET", "\/bom"\),\s*apiRequest\("GET", "\/work-orders"\)\s*\];/,
    `const requests = [
    apiRequest("GET", "/materials"),
    apiRequest("GET", "/products"),
    apiRequest("GET", "/molds"),
    apiRequest("GET", "/lines"),
    apiRequest("GET", "/bom"),
    apiRequest("GET", "/work-orders")
  ];`
  );
  appJs = appJs.replace(
    /const \[materials, products, molds, bomTable, workOrders\] = results;\s*const logs = canReadLogs \? results\[5\] : \[\];/,
    `const [materials, products, molds, lines, bomTable, workOrders] = results;\n  const logs = canReadLogs ? results[6] : [];`
  );
  appJs = appJs.replace(
    /molds: molds\.map\(mapMold\),/,
    `molds: molds.map(mapMold),\n    lines: lines,`
  );
}

if (!appJs.includes('function getMaterialSpeedMs')) {
  const materialSpeedFn = `
function getMaterialSpeedMs(productId) {
  const bomRows = getBomForProduct(productId);
  let dominant = null;
  let maxAmount = -1;
  for (const row of bomRows) {
    if (row.amountPerUnit > maxAmount) {
      maxAmount = row.amountPerUnit;
      dominant = row.name || row.materialId;
    }
  }
  if (!dominant) return 1000;
  const n = dominant.toLowerCase();
  if (n.includes('Â°ëË?') || n.includes('plastic')) return 1000;
  if (n.includes('??) || n.includes('iron') || n.includes('steel') || n.includes('metal')) return 2000;
  if (n.includes('??) || n.includes('wood')) return 3000;
  if (n.includes('?ªÁ?') || n.includes('glass')) return 4000;
  return 1000;
}
`;
  appJs = appJs.replace(/\/\/ ============================================================\n\/\/ UI RENDERING/, materialSpeedFn + '\n// ============================================================\n// UI RENDERING');

  appJs = appJs.replace(
    /function renderAutoOrders\(\) \{\s*const productSelect = \$\("#autoOrderProduct"\);\s*if \(\!productSelect\) return;\s*productSelect\.innerHTML = state\.products\s*\.map\(\(p\) => \`<option value="\$\{escapeHtml\(p\.id\)\}">\$\{escapeHtml\(p\.name\)\} \(\$\{escapeHtml\(p\.id\)\}\)<\/option>\`\)\s*\.join\(""\);\s*\}/,
    `function renderAutoOrders() {
  const selects = document.querySelectorAll(".auto-order-row-product");
  if (!selects.length) return;
  const optionsHtml = state.products
    .map(p => \`<option value="\${escapeHtml(p.id)}">\${escapeHtml(p.name)} (\${escapeHtml(p.id)})\</option>\`)
    .join("");
  selects.forEach(select => {
    const val = select.value;
    select.innerHTML = optionsHtml;
    if (val) select.value = val;
  });
}`
  );

  appJs = appJs.replace(
    /async function analyzeAutoOrders\(\) \{[\s\S]*?const summaryParts = \[\];/,
    `async function analyzeAutoOrders() {
  const result = $("#autoOrderResult");
  if (result) result.textContent = "";

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
    if (result) result.textContent = "Ë´ãËá≥Â∞ëËº∏?•‰??ãÊ??àÁ??¢Â??á‰??ÆÊï∏?è„Ä?;
    return;
  }

  const configuredFallbackLines = state.lines.map(l => l.line_id);
  if (configuredFallbackLines.length === 0) configuredFallbackLines.push("L1", "L2", "L3");

  orderItems.sort((a, b) => {
    const dateA = new Date(a.dueDate).getTime();
    const dateB = new Date(b.dueDate).getTime();
    if (dateA !== dateB) return dateA - dateB;

    const ectA = a.quantity * getMaterialSpeedMs(a.product.id);
    const ectB = b.quantity * getMaterialSpeedMs(b.product.id);
    return ectA - ectB;
  });

  state.autoOrderProposals = [];
  const summaryParts = [];`
  );

  appJs = appJs.replace(
    /await simulateProduction\(task\.workOrderId, task\.productName, task\.quantity\);/,
    `const speedMs = getMaterialSpeedMs(task.productId);\n      console.log(\`[Queue] simulateProduction \${task.workOrderId} qty=\${task.quantity} speed=\${speedMs}ms/unit\`);\n      await simulateProduction(task.workOrderId, task.productName, task.quantity, task.productId);`
  );
  
  appJs = appJs.replace(
    /async function simulateProduction\(workOrderId, productName, totalQuantity\) \{[\s\S]*?\} \/\/\s*1000\s*\);/,
    `async function simulateProduction(workOrderId, productName, totalQuantity, productId) {
  return new Promise((resolve) => {
    let count = 0;
    const item = document.getElementById("wo-" + workOrderId);
    const speedMs = getMaterialSpeedMs(productId);
    const timer = setInterval(() => {
      count++;
      if (item) {
        const qtyEl = item.querySelector(".wo-qty-progress");
        if (qtyEl) qtyEl.textContent = \`\${count} / \${totalQuantity}\`;
      }
      if (count >= totalQuantity) {
        clearInterval(timer);
        resolve();
      }
    }, speedMs);
  });
}`
  );
}

if (!appJs.includes('function renderLines')) {
  const lineLogic = `
function showLineModal() {
  const modal = $("#lineModal");
  if (!modal) return;
  modal.style.display = "flex";
  $("#lineIdInput").value = "";
  $("#lineNameInput").value = "";
}

async function saveLine(e) {
  e.preventDefault();
  const id = $("#lineIdInput").value.trim();
  const name = $("#lineNameInput").value.trim();
  
  if (!id || !name) return;
  
  try {
    await apiRequest("POST", "/lines", { line_id: id, name, status: "Active" });
    addLog("INFO", \`Â∑≤Êñ∞Â¢ûÁî¢Á∑?\${id} (\${name})\`);
    closeModals();
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", \`?∞Â??¢Á?Â§±Ê?: \${error.message}\`);
  }
}

async function deleteLine(id) {
  if (!confirm(\`Á¢∫Â?Ë¶ÅÂà™?§Áî¢Á∑?\${id} ?éÔ?\`)) return;
  try {
    await apiRequest("DELETE", \`/lines/\${id}\`);
    addLog("INFO", \`Â∑≤Âà™?§Áî¢Á∑?\${id}\`);
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", \`?™Èô§?¢Á?Â§±Ê?: \${error.message}\`);
  }
}

function showMoldModal() {
  const modal = $("#moldModal");
  if (!modal) return;
  modal.style.display = "flex";
  $("#moldIdInput").value = "";
  $("#moldNameInput").value = "";
}

async function saveMold(e) {
  e.preventDefault();
  const id = $("#moldIdInput").value.trim();
  const name = $("#moldNameInput").value.trim();
  if (!id || !name) return;
  try {
    await apiRequest("POST", "/molds", { mold_id: id, name, status: "Idle", version: 1 });
    addLog("INFO", \`Â∑≤Êñ∞Â¢ûÊ®°??\${id} (\${name})\`);
    closeModals();
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", \`?∞Â?Ê®°ÂÖ∑Â§±Ê?: \${error.message}\`);
  }
}

async function deleteMold(id) {
  if (!confirm(\`Á¢∫Â?Ë¶ÅÂà™?§Ê®°??\${id} ?éÔ?\`)) return;
  try {
    await apiRequest("DELETE", \`/molds/\${id}\`);
    addLog("INFO", \`Â∑≤Âà™?§Ê®°??\${id}\`);
    await refreshStateFromApi();
  } catch (error) {
    addLog("ERR", \`?™Èô§Ê®°ÂÖ∑Â§±Ê?: \${error.message}\`);
  }
}

function renderLines() {
  const container = $("#lineCards");
  if (!container) return;
  if (state.lines.length === 0) {
    container.innerHTML = \`<div style="color:var(--muted);padding:16px">?ÆÂ??°Áî¢Á∑öË???/div>\`;
    return;
  }
  container.innerHTML = state.lines
    .map(line => {
      return \`
        <article class="mold-card">
          <div class="card-top">
            <div>
              <h4>\${line.name}</h4>
              <p>ID: \${line.line_id}</p>
            </div>
            <span class="status-pill ok">\${line.status}</span>
          </div>
          \${canWrite() ? \`<div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;"><button class="danger-action delete-line-btn admin-only" data-id="\${line.line_id}" type="button">?™Èô§</button></div>\` : ""}
        </article>
      \`;
    })
    .join("");
}
`;
  appJs = appJs.replace(/\/\/ ============================================================\n\/\/ UI RENDERING/, lineLogic + '\n// ============================================================\n// UI RENDERING');
  appJs = appJs.replace(/renderMolds\(\);/, 'renderMolds();\n  renderLines();');
}

appJs = appJs.replace(
  /class="manual-release-mold-btn secondary-action admin-only" data-id="\$\{mold\.id\}" type="button">?ãÊîæÊ®°ÂÖ∑<\/button>\s*`/g,
  `class="manual-release-mold-btn secondary-action admin-only" data-id="\${mold.id}" type="button">?ãÊîæÊ®°ÂÖ∑</button>
            <button class="danger-action delete-mold-btn admin-only" data-id="\${mold.id}" type="button">?™Èô§</button>\``
);

if (!appJs.includes('$("#addLineButton")')) {
  const bindings = `
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
      newRow.innerHTML = \`
        <label style="flex:2; margin:0;">Ë®ÇÂñÆ?¢Â?
          <select class="auto-order-row-product" name="autoOrderProduct[]" required>\${productOptions}</select>
        </label>
        <label style="flex:1; margin:0;">‰∏ãÂñÆ?∏È?
          <input class="auto-order-row-qty" name="autoOrderQuantity[]" type="number" min="1" step="1" placeholder="‰æãÂ? 5000" required>
        </label>
        <label style="flex:1; margin:0;">?üÈ? (EDD)
          <input class="auto-order-row-due" name="autoOrderDue[]" type="date" required>
        </label>
        <button type="button" class="remove-auto-order-row danger-action" style="margin-top:20px; padding:4px 10px; font-size:13px;" aria-label="ÁßªÈô§Ê≠§Ë???>??/button>
      \`;
      container.appendChild(newRow);
      container.querySelectorAll('.remove-auto-order-row').forEach(btn => btn.style.display = "");
    });
  }

  const rowsContainer = $("#autoOrderRowsContainer");
  if (rowsContainer) {
    rowsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("remove-auto-order-row")) {
        const row = e.target.closest(".auto-order-row");
        if (row) row.remove();
        const remaining = rowsContainer.querySelectorAll('.auto-order-row');
        if (remaining.length === 1) {
          remaining[0].querySelector('.remove-auto-order-row').style.display = "none";
        }
      }
    });
  }

  const addLineBtn = $("#addLineButton");
  if (addLineBtn) addLineBtn.addEventListener("click", showLineModal);

  const lineForm = $("#lineForm");
  if (lineForm) lineForm.addEventListener("submit", saveLine);

  const lineCards = $("#lineCards");
  if (lineCards) {
    lineCards.addEventListener("click", (e) => {
      if (e.target.classList.contains("delete-line-btn")) {
        deleteLine(e.target.dataset.id);
      }
    });
  }

  const addMoldBtn = $("#addMoldButton");
  if (addMoldBtn) addMoldBtn.addEventListener("click", showMoldModal);

  const moldForm = $("#moldForm");
  if (moldForm) moldForm.addEventListener("submit", saveMold);
`;
  appJs = appJs.replace(/const releaseMoldsBtn = \$\("#releaseMoldsButton"\);/, bindings + '\n  const releaseMoldsBtn = $("#releaseMoldsButton");');
}

appJs = appJs.replace(
  /function closeModals\(\) \{\s*const m1 = \$\("#materialModal"\);\s*const m2 = \$\("#stockModal"\);\s*if \(m1\) m1\.close\(\);\s*if \(m2\) m2\.close\(\);\s*\}/,
  `function closeModals() {
  const m1 = $("#materialModal");
  const m2 = $("#stockModal");
  if (m1) m1.close();
  if (m2) m2.close();
  const m3 = $("#lineModal");
  const m4 = $("#moldModal");
  if (m3) m3.style.display = "none";
  if (m4) m4.style.display = "none";
}`
);

fs.writeFileSync('app.js', appJs, 'utf8');
console.log('Successfully restored app.js and index.html');

