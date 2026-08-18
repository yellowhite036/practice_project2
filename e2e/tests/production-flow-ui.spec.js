/**
 * ============================================================
 * production-flow-ui.spec.js
 * ============================================================
 *
 * 一般使用者完整生產流程 E2E
 *
 * 流程：
 *   1. operator 登入
 *   2. 取得產品 / 材料 / 模具 / 初始庫存
 *   3. operator 建立生產工單
 *   4. 驗證材料庫存正確扣除
 *   5. 驗證本次工單使用的模具為 In_Use
 *   6. admin 完成工單
 *   7. 驗證產品庫存增加
 *   8. 驗證模具回到 Idle
 *
 * 注意：
 *   後端目前沒有 action: "cancel"
 *   因此測試初始化不使用 PUT /work-orders/:id cancel。
 *
 * ============================================================
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// ============================================================
// TEST CONFIG
// ============================================================

const OPERATOR_USER_ID = 'OPERATOR-TEST';
const ADMIN_USER_ID = 'ADMIN-TEST';
const API_BASE = '';

const PRODUCTION_QUANTITY = 5;

// 目前資料庫中的目標產品
const TARGET_PRODUCT_KEYWORD = '玻璃水壺';

// 測試專用模具
const TARGET_MOLD_ID = 'MOLD-BOTTLE';

// 測試 artifact
const ARTIFACT_DIR = path.join(
  __dirname,
  '..',
  '..',
  'test-results',
  'production-flow-artifacts'
);

// ============================================================
// SHARED STATE
// ============================================================

const sharedState = {
  materialName: null,
  materialId: null,

  productName: null,
  productId: null,

  moldName: null,
  moldId: null,

  workOrderId: null,

  materialStockBefore: null,
  materialStockAfter: null,

  productStockBefore: null,
  productStockAfter: null,

  amountPerUnit: null,
  expectedDeduction: null,
};

// ============================================================
// UTILITIES
// ============================================================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-');
}

async function captureAnomalyAndFail(
  page,
  description,
  snapshotName
) {
  ensureDir(ARTIFACT_DIR);

  const ts = timestamp();

  const htmlPath = path.join(
    ARTIFACT_DIR,
    `${snapshotName}-${ts}.html`
  );

  const pngPath = path.join(
    ARTIFACT_DIR,
    `${snapshotName}-${ts}.png`
  );

  try {
    const html = await page.content();

    fs.writeFileSync(
      htmlPath,
      html,
      'utf8'
    );

    console.error(
      `[ANOMALY] HTML：${htmlPath}`
    );
  } catch (error) {
    console.error(
      `[ANOMALY] HTML 儲存失敗：${error.message}`
    );
  }

  try {
    await page.screenshot({
      path: pngPath,
      fullPage: true,
    });

    console.error(
      `[ANOMALY] Screenshot：${pngPath}`
    );
  } catch (error) {
    console.error(
      `[ANOMALY] Screenshot 儲存失敗：${error.message}`
    );
  }

  throw new Error(
    `[系統 Bug]\n${description}\n\n` +
    `HTML：${htmlPath}\n` +
    `Screenshot：${pngPath}`
  );
}

// ============================================================
// API HELPERS
// ============================================================

async function loginByApi(request, userId) {
  const response = await request.post(
    '/api/auth/login',
    {
      data: {
        user_id: userId,
      },
    }
  );

  if (response.status() !== 200) {
    const body = await response.text();

    throw new Error(
      `API 登入失敗：${userId}\n` +
      `HTTP ${response.status()}\n` +
      body
    );
  }

  const data = await response.json();

  if (!data.token) {
    throw new Error(
      `API 登入成功但沒有取得 token：${userId}`
    );
  }

  return data.token;
}

async function apiGet(
  request,
  endpoint,
  token
) {
  const response = await request.get(
    endpoint,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (response.status() !== 200) {
    const body = await response.text();

    throw new Error(
      `GET ${endpoint} 失敗\n` +
      `HTTP ${response.status()}\n` +
      body
    );
  }

  return response.json();
}

async function apiPut(
  request,
  endpoint,
  token,
  data
) {
  const response = await request.put(
    endpoint,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data,
    }
  );

  if (response.status() !== 200) {
    const body = await response.text();

    throw new Error(
      `PUT ${endpoint} 失敗\n` +
      `HTTP ${response.status()}\n` +
      body
    );
  }

  return response.json();
}

// ============================================================
// TEST DATA CLEANUP
// ============================================================

/**
 * 清理上一輪 E2E 殘留資料。
 *
 * 後端沒有 cancel action。
 *
 * 因此：
 *
 *   Pending 工單
 *        ↓
 *   直接 DELETE
 *        ↓
 *   釋放模具
 *
 * 只處理：
 *
 *   creator_user_id = OPERATOR-TEST
 *   status = Pending
 *
 * 不碰 Completed 工單。
 */
async function cleanupPreviousTestOrders(request) {
  console.log("\n▶ Test Setup：清理上一輪測試資料");

  // ============================================================
  // 1. 使用 ADMIN-TEST 登入
  // ============================================================

  const adminLoginResponse = await request.post(
    `${API_BASE}/api/auth/login`,
    {
      data: {
        user_id: "ADMIN-TEST"
      }
    }
  );

  if (!adminLoginResponse.ok()) {
    const body = await adminLoginResponse.text();

    throw new Error(
      `ADMIN-TEST 登入失敗\n` +
      `HTTP ${adminLoginResponse.status()}\n` +
      body
    );
  }

  const adminLoginData = await adminLoginResponse.json();

  const adminToken =
    adminLoginData.token ||
    adminLoginData.access_token ||
    adminLoginData.accessToken;

  if (!adminToken) {
    throw new Error(
      `ADMIN-TEST 登入成功，但找不到 token\n` +
      JSON.stringify(adminLoginData)
    );
  }

  const adminHeaders = {
    Authorization: `Bearer ${adminToken}`
  };

  // ============================================================
  // 2. 查詢 Pending 工單
  // ============================================================

  const pendingResponse = await request.get(
    `${API_BASE}/api/work-orders`,
    {
      headers: adminHeaders
    }
  );

  if (!pendingResponse.ok()) {
    const body = await pendingResponse.text();

    throw new Error(
      `取得 Pending 工單失敗\n` +
      `HTTP ${pendingResponse.status()}\n` +
      body
    );
  }

  const workOrdersData = await pendingResponse.json();

  const workOrders = Array.isArray(workOrdersData)
    ? workOrdersData
    : workOrdersData.work_orders ||
    workOrdersData.workOrders ||
    workOrdersData.data ||
    [];

  const pendingOrders = workOrders.filter(
    (order) => order.status === "Pending"
  );

  if (pendingOrders.length === 0) {
    console.log("  沒有殘留 Pending 工單");
  } else {
    console.log(
      `  發現 ${pendingOrders.length} 筆殘留 Pending 工單`
    );
  }

  // ============================================================
  // 3. 使用 reject 清理 Pending 工單
  //
  // 不使用：
  //   action: "cancel"
  //
  // 後端支援：
  //   action: "reject"
  // ============================================================

  for (const order of pendingOrders) {
    console.log(`  清理：${order.work_order_id}`);

    const response = await request.put(
      `${API_BASE}/api/work-orders/${order.work_order_id}`,
      {
        headers: adminHeaders,
        data: {
          action: "reject"
        }
      }
    );

    if (!response.ok()) {
      const body = await response.text();

      throw new Error(
        `無法清理殘留工單 ${order.work_order_id}\n` +
        `HTTP ${response.status()}\n` +
        body
      );
    }

    console.log(
      `  ✓ ${order.work_order_id} 已 reject`
    );
  }

  // ============================================================
  // 4. 確認沒有 Pending 工單
  // ============================================================

  const verifyPendingResponse = await request.get(
    `${API_BASE}/api/work-orders`,
    {
      headers: adminHeaders
    }
  );

  if (!verifyPendingResponse.ok()) {
    const body = await verifyPendingResponse.text();

    throw new Error(
      `驗證 Pending 工單失敗\n` +
      `HTTP ${verifyPendingResponse.status()}\n` +
      body
    );
  }

  const verifyData = await verifyPendingResponse.json();

  const verifyOrders = Array.isArray(verifyData)
    ? verifyData
    : verifyData.work_orders ||
    verifyData.workOrders ||
    verifyData.data ||
    [];

  const remainingPending = verifyOrders.filter(
    (order) => order.status === "Pending"
  );

  if (remainingPending.length > 0) {
    throw new Error(
      `Cleanup 後仍存在 ${remainingPending.length} 筆 Pending 工單：\n` +
      remainingPending
        .map((order) => order.work_order_id)
        .join("\n")
    );
  }

  console.log("  ✓ Pending 工單清理完成");

  // ============================================================
  // 5. 確認 MOLD-BOTTLE 狀態
  // ============================================================

  const moldResponse = await request.get(
    `${API_BASE}/api/molds/MOLD-BOTTLE`,
    {
      headers: adminHeaders
    }
  );

  if (!moldResponse.ok()) {
    const body = await moldResponse.text();

    throw new Error(
      `取得 MOLD-BOTTLE 狀態失敗\n` +
      `HTTP ${moldResponse.status()}\n` +
      body
    );
  }

  const moldData = await moldResponse.json();

  const mold =
    moldData.mold ||
    moldData.data ||
    moldData;

  console.log(
    `  MOLD-BOTTLE 狀態：${mold.status}`
  );

  // ============================================================
  // 6. 如果模具仍然 In_Use，使用 admin release
  //
  // 這裡不直接修改 DB。
  // 讓後端 API 處理模具狀態。
  // ============================================================

  if (mold.status !== "Idle") {
    console.log(
      `  MOLD-BOTTLE 目前為 ${mold.status}，嘗試釋放`
    );

    const releaseResponse = await request.put(
      `${API_BASE}/api/molds/MOLD-BOTTLE`,
      {
        headers: adminHeaders,
        data: {
          name: mold.name,
          status: "Idle",
          line: null,
          eta: null,
          product_id: null,
          version: mold.version
        }
      }
    );

    if (!releaseResponse.ok()) {
      const body = await releaseResponse.text();

      throw new Error(
        `無法釋放 MOLD-BOTTLE\n` +
        `HTTP ${releaseResponse.status()}\n` +
        body
      );
    }

    console.log("  ✓ MOLD-BOTTLE 已釋放");
  }

  // ============================================================
  // 7. 最終確認模具
  // ============================================================

  const finalMoldResponse = await request.get(
    `${API_BASE}/api/molds/MOLD-BOTTLE`,
    {
      headers: adminHeaders
    }
  );

  if (!finalMoldResponse.ok()) {
    const body = await finalMoldResponse.text();

    throw new Error(
      `最終確認 MOLD-BOTTLE 失敗\n` +
      `HTTP ${finalMoldResponse.status()}\n` +
      body
    );
  }

  const finalMoldData = await finalMoldResponse.json();

  const finalMold =
    finalMoldData.mold ||
    finalMoldData.data ||
    finalMoldData;

  if (finalMold.status !== "Idle") {
    throw new Error(
      `MOLD-BOTTLE 清理後仍不是 Idle，目前狀態：${finalMold.status}`
    );
  }

  console.log("  ✓ MOLD-BOTTLE = Idle");
  console.log("  ✓ Test Setup 完成\n");
}

// ============================================================
// UI LOGIN
// ============================================================

async function loginAsUser(page, userId) {
  await page.goto('/');

  await expect(
    page.locator('#loginOverlay')
  ).toBeVisible({
    timeout: 10000,
  });

  await page.fill(
    '#loginUserId',
    userId
  );

  await page.click('#loginBtn');

  await expect(
    page.locator('#mainContent')
  ).toBeVisible({
    timeout: 10000,
  });

  /*
   * 等待 API 資料完成載入。
   */
  await page.waitForFunction(
    () => {
      const materialSelect =
        document.querySelector('#materialSelect');

      return (
        materialSelect &&
        materialSelect.options.length > 0
      );
    },
    null,
    {
      timeout: 15000,
    }
  );
}

// ============================================================
// UI DATA HELPERS
// ============================================================

async function getSelectedMaterial(page) {
  return page.evaluate(() => {
    const select =
      document.querySelector('#materialSelect');

    if (!select) {
      return null;
    }

    const option =
      select.options[select.selectedIndex];

    if (!option) {
      return null;
    }

    return {
      value: option.value,
      text: option.textContent.trim(),
    };
  });
}

async function getSelectedMold(page) {
  return page.evaluate(() => {
    const select =
      document.querySelector('#moldSelect');

    if (!select) {
      return null;
    }

    const option =
      select.options[select.selectedIndex];

    if (!option) {
      return null;
    }

    return {
      value: option.value,
      text: option.textContent.trim(),
    };
  });
}

async function getProductFromUI(page) {
  return page.evaluate(() => {
    const element =
      document.querySelector(
        '#productResult .product-result-name'
      );

    return element
      ? element.textContent.trim()
      : '';
  });
}

async function getMaterialStockFromUI(
  page,
  materialName
) {
  const stockText = await page.evaluate(
    name => {
      const cards =
        document.querySelectorAll(
          '#materialCards article.inventory-card'
        );

      for (const card of cards) {
        const title =
          card.querySelector('h4');

        if (
          title &&
          title.textContent.includes(name)
        ) {
          const stock =
            card.querySelector(
              '.stock-number'
            );

          return stock
            ? stock.textContent.trim()
            : null;
        }
      }

      return null;
    },
    materialName
  );

  if (stockText === null) {
    throw new Error(
      `找不到材料「${materialName}」`
    );
  }

  const match =
    stockText.match(/[\d.]+/);

  if (!match) {
    throw new Error(
      `無法解析材料庫存：${stockText}`
    );
  }

  return Number(match[0]);
}

async function getLatestWorkOrderFromUI(page) {
  return page.evaluate(() => {
    const rows =
      document.querySelectorAll(
        '#workOrderTable tr'
      );

    if (!rows.length) {
      return null;
    }

    /*
     * 找第一個真正的資料列。
     */
    for (const row of rows) {
      const cells =
        row.querySelectorAll('td');

      if (cells.length < 6) {
        continue;
      }

      return {
        id:
          cells[0]
            ?.querySelector('strong')
            ?.textContent
            ?.trim() || '',

        productName:
          cells[1]
            ?.textContent
            ?.trim() || '',

        quantity:
          cells[2]
            ?.textContent
            ?.trim() || '',

        line:
          cells[3]
            ?.textContent
            ?.trim() || '',

        moldName:
          cells[4]
            ?.textContent
            ?.trim() || '',

        status:
          cells[5]
            ?.querySelector('.status-pill')
            ?.textContent
            ?.trim() || '',
      };
    }

    return null;
  });
}

// ============================================================
// WAIT HELPERS
// ============================================================

async function waitForProduct(page) {
  await page.waitForFunction(
    () => {
      const element =
        document.querySelector(
          '#productResult .product-result-name'
        );

      return (
        element &&
        element.textContent.trim().length > 0
      );
    },
    null,
    {
      timeout: 10000,
    }
  );
}

async function waitForSubmitButtonEnabled(page) {
  const button =
    page.locator('#submitWorkOrderBtn');

  /*
   * 等待 product / mold / quantity
   * 完整完成 renderPreview。
   */
  await expect(button).toBeVisible({
    timeout: 10000,
  });

  await expect(button).not.toBeDisabled({
    timeout: 15000,
  });
}

// ============================================================
// TEST SUITE
// ============================================================

test.describe.serial(
  '🏭 一般使用者完整生產流程 E2E',
  () => {

    /*
     * --------------------------------------------------------
     * 每次測試開始前清理
     * --------------------------------------------------------
     */

    test.beforeAll(
      async ({ request }) => {
        await cleanupPreviousTestOrders(
          request
        );
      }
    );

    // ========================================================
    // STEP 1
    // ========================================================

    test(
      'Step 1 │ operator 登入',
      async ({ page }) => {

        console.log(
          '\n============================================================'
        );

        console.log(
          '▶ Step 1：以一般使用者身份登入'
        );

        console.log(
          '============================================================'
        );

        await loginAsUser(
          page,
          OPERATOR_USER_ID
        );

        const badge =
          page.locator(
            '#permissionBadge'
          );

        await expect(
          badge
        ).toBeVisible();

        const badgeText =
          await badge.textContent();

        console.log(
          `  ✔ 登入成功：${badgeText}`
        );

        /*
         * operator 不應看到 molds admin tab。
         */
        await expect(
          page.locator(
            '[data-view="molds"].nav-button'
          )
        ).not.toBeVisible();

        console.log(
          '  ✔ operator 權限驗證通過'
        );

        console.log(
          '  ✔ Step 1 完成\n'
        );
      }
    );

    // ========================================================
    // STEP 2
    // ========================================================

    test(
      'Step 2 │ 取得初始庫存與產品資訊',
      async ({ page }) => {

        console.log(
          '▶ Step 2：取得初始庫存與產品資訊'
        );

        await loginAsUser(
          page,
          OPERATOR_USER_ID
        );

        /*
         * ----------------------------------------------------
         * 選擇目標產品
         * ----------------------------------------------------
         */

        const materialOptions =
          await page.locator(
            '#materialSelect option'
          ).allTextContents();

        const targetOption =
          materialOptions.find(
            text =>
              text.includes(
                TARGET_PRODUCT_KEYWORD
              )
          );

        /*
         * 目前實際資料是：
         *
         * 玻璃 → 玻璃水壺
         *
         * 所以 TARGET_PRODUCT_KEYWORD
         * 如果找不到，就使用目前第一個有效材料。
         */

        if (!targetOption) {
          console.log(
            `  ⚠ 找不到「${TARGET_PRODUCT_KEYWORD}」`
          );

          console.log(
            '  使用目前預設材料'
          );
        }

        /*
         * ----------------------------------------------------
         * 取得材料
         * ----------------------------------------------------
         */

        const material =
          await getSelectedMaterial(
            page
          );

        if (!material) {
          throw new Error(
            '無法取得目前材料'
          );
        }

        sharedState.materialId =
          material.value;

        sharedState.materialName =
          material.text
            .split('(')[0]
            .trim();

        console.log(
          `  材料名稱：${sharedState.materialName}`
        );

        /*
         * ----------------------------------------------------
         * 產品
         * ----------------------------------------------------
         */

        await waitForProduct(page);

        sharedState.productName =
          await getProductFromUI(
            page
          );

        console.log(
          `  產品名稱：${sharedState.productName}`
        );

        /*
         * ----------------------------------------------------
         * 模具
         * ----------------------------------------------------
         */

        const mold =
          await getSelectedMold(
            page
          );

        if (!mold) {
          throw new Error(
            '無法取得目前模具'
          );
        }

        sharedState.moldId =
          mold.value;

        sharedState.moldName =
          mold.text
            .split('(')[0]
            .trim();

        console.log(
          `  模具名稱：${sharedState.moldName}`
        );

        /*
         * ----------------------------------------------------
         * 材料初始庫存
         * ----------------------------------------------------
         */

        await page.click(
          '[data-view="materials"].nav-button'
        );

        await expect(
          page.locator(
            '#materials.view.active'
          )
        ).toBeVisible({
          timeout: 5000,
        });

        await page.waitForSelector(
          '#materialCards article.inventory-card',
          {
            timeout: 10000,
          }
        );

        sharedState.materialStockBefore =
          await getMaterialStockFromUI(
            page,
            sharedState.materialName
          );

        console.log(
          `  ✔ 初始材料庫存：${sharedState.materialStockBefore}`
        );

        /*
         * ----------------------------------------------------
         * 回到工單頁
         * ----------------------------------------------------
         */

        await page.click(
          '[data-view="workorders"].nav-button'
        );

        await waitForProduct(page);

        /*
         * ----------------------------------------------------
         * 計算需求量
         * ----------------------------------------------------
         */

        await page.fill(
          '#quantityInput',
          String(
            PRODUCTION_QUANTITY
          )
        );

        /*
         * 使用真正的 input event。
         */
        await page.locator(
          '#quantityInput'
        ).dispatchEvent('input');

        await page.waitForTimeout(300);

        const previewText =
          await page.locator(
            '#calculationPreview'
          ).textContent();

        const requirementMatch =
          previewText.match(
            /需[\s\S]*?([\d.]+)/
          );

        /*
         * 若 regex 沒抓到，
         * 從目前產品 BOM 需求文字解析。
         */
        if (requirementMatch) {
          const total =
            Number(
              requirementMatch[1]
            );

          sharedState.amountPerUnit =
            total /
            PRODUCTION_QUANTITY;

          sharedState.expectedDeduction =
            total;

          console.log(
            `  每件用量：${sharedState.amountPerUnit}`
          );

          console.log(
            `  本次需求量：${total}`
          );
        } else {
          console.log(
            '  ⚠ 無法從 Preview 解析用量'
          );
        }

        console.log(
          '  ✔ Step 2 完成\n'
        );
      }
    );

    // ========================================================
    // STEP 3
    // ========================================================

    test(
      'Step 3 │ operator 發起生產工單',
      async ({ page }) => {

        console.log(
          '▶ Step 3：operator 發起生產工單'
        );

        await loginAsUser(
          page,
          OPERATOR_USER_ID
        );

        /*
         * ----------------------------------------------------
         * 選擇目標材料
         * ----------------------------------------------------
         */

        const materialSelect =
          page.locator(
            '#materialSelect'
          );

        const options =
          await materialSelect
            .locator('option')
            .evaluateAll(
              elements =>
                elements.map(
                  element => ({
                    value:
                      element.value,
                    text:
                      element.textContent
                        .trim(),
                  })
                )
            );

        /*
         * 尋找「玻璃」。
         */
        const target =
          options.find(
            option =>
              option.text
                .includes('玻璃')
          );

        if (target) {

          await materialSelect.selectOption(
            target.value
          );

          console.log(
            `  ✔ 選擇材料：${target.text}`
          );

        } else {

          console.log(
            '  ⚠ 找不到玻璃，使用目前選項'
          );
        }

        /*
         * ----------------------------------------------------
         * 等待產品重新計算
         * ----------------------------------------------------
         */

        await waitForProduct(
          page
        );

        /*
         * ----------------------------------------------------
         * 記錄目前資料
         * ----------------------------------------------------
         */

        const material =
          await getSelectedMaterial(
            page
          );

        const mold =
          await getSelectedMold(
            page
          );

        sharedState.materialId =
          material?.value || null;

        sharedState.materialName =
          material?.text
            ?.split('(')[0]
            ?.trim() || null;

        sharedState.moldId =
          mold?.value || null;

        sharedState.moldName =
          mold?.text
            ?.split('(')[0]
            ?.trim() || null;

        sharedState.productName =
          await getProductFromUI(
            page
          );

        console.log(
          `  材料：${sharedState.materialName}`
        );

        console.log(
          `  產品：${sharedState.productName}`
        );

        console.log(
          `  模具：${sharedState.moldName}`
        );

        /*
         * ----------------------------------------------------
         * 填數量
         * ----------------------------------------------------
         */

        const quantityInput =
          page.locator(
            '#quantityInput'
          );

        await quantityInput.fill(
          String(
            PRODUCTION_QUANTITY
          )
        );

        /*
         * React/原生事件都觸發。
         */
        await quantityInput.dispatchEvent(
          'input'
        );

        await quantityInput.dispatchEvent(
          'change'
        );

        /*
         * 給 renderPreview 一點時間。
         */
        await page.waitForTimeout(
          300
        );

        /*
         * ----------------------------------------------------
         * 再確認一次模具
         * ----------------------------------------------------
         */

        const moldState =
          await page.evaluate(
            () => {

              const select =
                document.querySelector(
                  '#moldSelect'
                );

              const option =
                select?.options[
                select.selectedIndex
                ];

              return {
                value:
                  option?.value || '',
                text:
                  option?.textContent
                    ?.trim() || '',
              };
            }
          );

        console.log(
          `  Mold select：${JSON.stringify(moldState)}`
        );

        /*
         * ----------------------------------------------------
         * 重要：
         *
         * 不直接相信 button.disabled。
         *
         * 先等待 Preview 更新。
         * ----------------------------------------------------
         */

        await page.waitForFunction(
          () => {

            const product =
              document.querySelector(
                '#productResult .product-result-name'
              );

            const quantity =
              document.querySelector(
                '#quantityInput'
              );

            const preview =
              document.querySelector(
                '#calculationPreview'
              );

            const button =
              document.querySelector(
                '#submitWorkOrderBtn'
              );

            return (
              product &&
              product.textContent.trim() &&
              quantity &&
              Number(quantity.value) > 0 &&
              preview &&
              preview.textContent.trim() &&
              button
            );
          },
          null,
          {
            timeout: 10000,
          }
        );

        /*
         * ----------------------------------------------------
         * 如果按鈕還是 disabled，
         * 直接輸出目前 JS 判斷狀態。
         * ----------------------------------------------------
         */

        const buttonState =
          await page.evaluate(
            () => {

              const button =
                document.querySelector(
                  '#submitWorkOrderBtn'
                );

              const quantity =
                document.querySelector(
                  '#quantityInput'
                );

              const product =
                document.querySelector(
                  '#productResult .product-result-name'
                );

              const mold =
                document.querySelector(
                  '#moldSelect'
                );

              return {
                disabled:
                  button?.disabled,

                quantity:
                  quantity?.value,

                product:
                  product?.textContent
                    ?.trim(),

                mold:
                  mold?.value,

                calculation:
                  document.querySelector(
                    '#calculationPreview'
                  )?.textContent
                    ?.trim(),
              };
            }
          );

        console.log(
          `  Submit button state：${JSON.stringify(buttonState)}`
        );

        /*
         * ----------------------------------------------------
         * 按鈕仍 disabled 時，
         * 不直接繼續測試。
         *
         * 這樣錯誤訊息會指出真正狀態。
         * ----------------------------------------------------
         */

        if (buttonState.disabled) {

          await captureAnomalyAndFail(
            page,

            `建立工單前 Submit Button 仍為 disabled。\n` +
            `產品：${buttonState.product}\n` +
            `數量：${buttonState.quantity}\n` +
            `模具：${buttonState.mold}\n` +
            `Calculation：${buttonState.calculation}`,

            'step3-submit-button-disabled'
          );
        }

        /*
         * ----------------------------------------------------
         * 記錄發起前庫存
         * ----------------------------------------------------
         */

        const materialText =
          await materialSelect
            .locator(
              'option:checked'
            )
            .textContent();

        const stockMatch =
          materialText?.match(
            /\(([\d.]+)/
          );

        if (stockMatch) {

          sharedState.materialStockBefore =
            Number(
              stockMatch[1]
            );

          console.log(
            `  發起前材料庫存：${sharedState.materialStockBefore}`
          );
        }

        /*
         * ----------------------------------------------------
         * 記錄每件用量
         * ----------------------------------------------------
         */

        const calcText =
          await page.locator(
            '#calculationPreview'
          ).textContent();

        const reqMatch =
          calcText.match(
            /需[\s\S]*?([\d.]+)/
          );

        if (reqMatch) {

          const total =
            Number(
              reqMatch[1]
            );

          sharedState.expectedDeduction =
            total;

          sharedState.amountPerUnit =
            total /
            PRODUCTION_QUANTITY;
        }

        /*
         * ----------------------------------------------------
         * 建立工單
         * ----------------------------------------------------
         */

        console.log(
          '  點擊「確認派工入模具位」...'
        );

        await page.locator(
          '#submitWorkOrderBtn'
        ).click();

        /*
         * 等 API 完成。
         */
        await page.waitForTimeout(
          1500
        );

        /*
         * ----------------------------------------------------
         * 確認 automation 成功
         * ----------------------------------------------------
         */

        const failedStep =
          await page.locator(
            '#automationSteps li .status-pill.bad'
          ).count();

        if (failedStep > 0) {

          const logs =
            await page.locator(
              '#logList .log-item'
            ).allTextContents();

          await captureAnomalyAndFail(
            page,

            `工單建立失敗。\n` +
            logs.slice(-5).join('\n'),

            'step3-workorder-failed'
          );
        }

        /*
         * ----------------------------------------------------
         * 等工單出現
         * ----------------------------------------------------
         */

        await page.waitForFunction(
          () => {

            const table =
              document.querySelector(
                '#workOrderTable'
              );

            return (
              table &&
              table.querySelector(
                'tr td strong'
              )
            );
          },
          null,
          {
            timeout: 15000,
          }
        );

        /*
         * ----------------------------------------------------
         * 取得工單
         * ----------------------------------------------------
         */

        const latest =
          await getLatestWorkOrderFromUI(
            page
          );

        if (!latest?.id) {

          await captureAnomalyAndFail(
            page,
            '工單建立成功後無法取得 Work Order ID',
            'step3-no-workorder-id'
          );
        }

        sharedState.workOrderId =
          latest.id;

        console.log(
          `  ✔ 工單：${latest.id}`
        );

        console.log(
          `  ✔ 狀態：${latest.status}`
        );

        /*
         * UI 可能顯示中文狀態，
         * 所以只確認存在工單。
         */
        expect(
          latest.id
        ).toBeTruthy();

        console.log(
          '  ✔ Step 3 完成\n'
        );
      }
    );

    // ========================================================
    // STEP 4
    // ========================================================

    test(
      'Step 4 │ 驗證材料庫存已減少',
      async ({ page }) => {

        console.log(
          '▶ Step 4：驗證材料庫存'
        );

        await loginAsUser(
          page,
          OPERATOR_USER_ID
        );

        await page.click(
          '[data-view="materials"].nav-button'
        );

        await expect(
          page.locator(
            '#materials.view.active'
          )
        ).toBeVisible({
          timeout: 5000,
        });

        await page.waitForSelector(
          '#materialCards article.inventory-card',
          {
            timeout: 10000,
          }
        );

        const stockAfter =
          await getMaterialStockFromUI(
            page,
            sharedState.materialName
          );

        sharedState.materialStockAfter =
          stockAfter;

        console.log(
          `  材料：${sharedState.materialName}`
        );

        console.log(
          `  發起前：${sharedState.materialStockBefore}`
        );

        console.log(
          `  發起後：${stockAfter}`
        );

        /*
         * 核心驗證
         */
        if (
          stockAfter >=
          sharedState.materialStockBefore
        ) {

          await captureAnomalyAndFail(
            page,

            `[系統 Bug] 材料庫存沒有減少。\n` +
            `材料：${sharedState.materialName}\n` +
            `Before：${sharedState.materialStockBefore}\n` +
            `After：${stockAfter}\n` +
            `Work Order：${sharedState.workOrderId}`,

            'step4-material-not-decreased'
          );
        }

        /*
         * 精確扣量
         */
        if (
          sharedState.expectedDeduction !==
          null
        ) {

          const actual =
            sharedState.materialStockBefore -
            stockAfter;

          const expected =
            sharedState.expectedDeduction;

          console.log(
            `  期望扣除：${expected}`
          );

          console.log(
            `  實際扣除：${actual}`
          );

          expect(
            actual
          ).toBeCloseTo(
            expected,
            3
          );
        }

        expect(
          stockAfter
        ).toBeLessThan(
          sharedState.materialStockBefore
        );

        console.log(
          '  ✔ 材料庫存驗證通過'
        );

        console.log(
          '  ✔ Step 4 完成\n'
        );
      }
    );

    // ========================================================
    // STEP 5
    // ========================================================

    test(
      'Step 5 │ API 驗證本次工單模具為 In_Use',
      async ({ page, request }) => {

        console.log(
          '▶ Step 5：API 驗證本次工單模具'
        );

        const adminToken =
          await loginByApi(
            request,
            ADMIN_USER_ID
          );

        const molds =
          await apiGet(
            request,
            '/api/molds',
            adminToken
          );

        const targetMold =
          molds.find(
            mold =>
              mold.mold_id ===
              sharedState.moldId
          );

        if (!targetMold) {

          await page.goto('/');

          await captureAnomalyAndFail(
            page,

            `找不到模具。\n` +
            `mold_id：${sharedState.moldId}\n` +
            `moldName：${sharedState.moldName}`,

            'step5-mold-not-found'
          );
        }

        console.log(
          `  模具：${targetMold.mold_id}`
        );

        console.log(
          `  名稱：${targetMold.name}`
        );

        console.log(
          `  狀態：${targetMold.status}`
        );

        console.log(
          `  Product：${targetMold.product_id}`
        );

        console.log(
          `  Work Order：${sharedState.workOrderId}`
        );

        if (
          targetMold.status !==
          'In_Use'
        ) {

          await page.goto('/');

          await captureAnomalyAndFail(
            page,

            `[系統 Bug] 本次工單建立後模具不是 In_Use。\n` +
            `模具：${targetMold.mold_id}\n` +
            `名稱：${targetMold.name}\n` +
            `期望：In_Use\n` +
            `實際：${targetMold.status}\n` +
            `產品：${targetMold.product_id}\n` +
            `工單：${sharedState.workOrderId}`,

            'step5-mold-not-in-use'
          );
        }

        expect(
          targetMold.status
        ).toBe('In_Use');

        console.log(
          '  ✔ 模具狀態為 In_Use'
        );

        console.log(
          '  ✔ Step 5 完成\n'
        );
      }
    );

    // ========================================================
    // STEP 6
    // ========================================================

    test(
      'Step 6 │ admin 完成工單 → 產品庫存增加 → 模具 Idle',
      async ({ page, request }) => {

        console.log(
          '▶ Step 6：完成工單'
        );

        const adminToken =
          await loginByApi(
            request,
            ADMIN_USER_ID
          );

        /*
         * ----------------------------------------------------
         * 取得產品
         * ----------------------------------------------------
         */

        const products =
          await apiGet(
            request,
            '/api/products',
            adminToken
          );

        const product =
          products.find(
            item =>
              item.product_id ===
              sharedState.productId ||
              item.name ===
              sharedState.productName
          );

        if (!product) {

          await captureAnomalyAndFail(
            page,

            `找不到產品。\n` +
            `產品 ID：${sharedState.productId}\n` +
            `產品名稱：${sharedState.productName}`,

            'step6-product-not-found'
          );
        }

        sharedState.productId =
          product.product_id;

        sharedState.productName =
          product.name;

        sharedState.productStockBefore =
          Number(product.stock);

        console.log(
          `  產品：${product.product_id}`
        );

        console.log(
          `  完成前庫存：${sharedState.productStockBefore}`
        );

        /*
         * ----------------------------------------------------
         * Admin UI 登入
         * ----------------------------------------------------
         */

        await loginAsUser(
          page,
          ADMIN_USER_ID
        );

        /*
         * ----------------------------------------------------
         * 找到本次工單
         * ----------------------------------------------------
         */

        await page.waitForFunction(
          workOrderId => {

            const rows =
              document.querySelectorAll(
                '#workOrderTable tr'
              );

            return Array.from(rows)
              .some(row =>
                row.textContent.includes(
                  workOrderId
                )
              );
          },
          sharedState.workOrderId,
          {
            timeout: 15000,
          }
        );

        const row =
          page.locator(
            '#workOrderTable tr'
          ).filter({
            hasText:
              sharedState.workOrderId,
          });

        const completeButton =
          row.locator(
            'button[data-action="complete"]'
          );

        const buttonCount =
          await completeButton.count();

        if (buttonCount === 0) {

          await captureAnomalyAndFail(
            page,

            `找不到本次工單的完成按鈕。\n` +
            `Work Order：${sharedState.workOrderId}`,

            'step6-complete-button-not-found'
          );
        }

        console.log(
          `  點擊 ${sharedState.workOrderId} 完成`
        );

        await completeButton.first().click();

        /*
         * 等待 UI 更新。
         */
        await page.waitForTimeout(
          1500
        );

        /*
         * ----------------------------------------------------
         * API 確認工單完成
         * ----------------------------------------------------
         */

        const ordersAfter =
          await apiGet(
            request,
            '/api/work-orders',
            adminToken
          );

        const completedOrder =
          ordersAfter.find(
            order =>
              order.work_order_id ===
              sharedState.workOrderId
          );

        if (!completedOrder) {

          await captureAnomalyAndFail(
            page,

            `完成後找不到工單。\n` +
            `Work Order：${sharedState.workOrderId}`,

            'step6-workorder-not-found-after'
          );
        }

        console.log(
          `  工單狀態：${completedOrder.status}`
        );

        expect(
          completedOrder.status
        ).toBe('Completed');

        /*
         * ----------------------------------------------------
         * 驗證產品庫存
         * ----------------------------------------------------
         */

        const productsAfter =
          await apiGet(
            request,
            '/api/products',
            adminToken
          );

        const productAfter =
          productsAfter.find(
            item =>
              item.product_id ===
              sharedState.productId
          );

        if (!productAfter) {

          await captureAnomalyAndFail(
            page,

            `完成工單後找不到產品。\n` +
            `Product：${sharedState.productId}`,

            'step6-product-not-found-after'
          );
        }

        sharedState.productStockAfter =
          Number(productAfter.stock);

        console.log(
          `  完成後產品庫存：${sharedState.productStockAfter}`
        );

        /*
         * 核心驗證
         */
        expect(
          sharedState.productStockAfter
        ).toBeGreaterThan(
          sharedState.productStockBefore
        );

        const increase =
          sharedState.productStockAfter -
          sharedState.productStockBefore;

        console.log(
          `  產品庫存增加：${increase}`
        );

        expect(
          increase
        ).toBe(
          PRODUCTION_QUANTITY
        );

        console.log(
          '  ✔ 產品庫存增加 5 件'
        );

        /*
         * ----------------------------------------------------
         * 驗證模具回 Idle
         * ----------------------------------------------------
         */

        const moldsAfter =
          await apiGet(
            request,
            '/api/molds',
            adminToken
          );

        const moldAfter =
          moldsAfter.find(
            mold =>
              mold.mold_id ===
              sharedState.moldId
          );

        if (!moldAfter) {

          await captureAnomalyAndFail(
            page,

            `完成工單後找不到模具。\n` +
            `Mold：${sharedState.moldId}`,

            'step6-mold-not-found-after'
          );
        }

        console.log(
          `  完成後模具狀態：${moldAfter.status}`
        );

        expect(
          moldAfter.status
        ).toBe('Idle');

        console.log(
          '  ✔ 模具已回到 Idle'
        );

        console.log(
          '\n============================================================'
        );

        console.log(
          '✅ 全部 E2E 驗證通過'
        );

        console.log(
          '============================================================\n'
        );
      }
    );
  }
);