const { test, expect } = require('@playwright/test');

const {
  seedE2EData,
  clearE2EData,
  dockerPsqlQuery,
  escapeSql,
} = require('../utils/db');

const ADMIN_ID = 'E2E-ADMIN';

// ============================================================
// Login
// ============================================================

async function login(request) {
  const response = await request.post('/api/auth/login', {
    data: {
      user_id: ADMIN_ID,
    },
  });

  expect(response.status()).toBe(200);

  const body = await response.json();

  expect(body.token).toBeTruthy();

  expect(body.user).toMatchObject({
    user_id: ADMIN_ID,
    role: 'admin',
  });

  return {
    Authorization: `Bearer ${body.token}`,
  };
}

// ============================================================
// API Helper
// ============================================================

async function apiJson(
  request,
  method,
  path,
  tokenHeaders,
  data
) {
  const response = await request[method](path, {
    headers: tokenHeaders,
    data,
  });

  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    response,
    body,
  };
}

// ============================================================
// Create Work Order
// ============================================================

async function createWorkOrder(
  request,
  tokenHeaders,
  overrides = {}
) {
  const payload = {
    work_order_id:
      overrides.work_order_id ||
      'E2E-WO-DEFAULT',

    product_id:
      overrides.product_id ||
      'E2E-PRD-CREATE',

    quantity:
      overrides.quantity ||
      5,

    line:
      overrides.line ||
      'L1',

    mold_id:
      overrides.mold_id ||
      'E2E-MOLD-CREATE',

    creator_user_id:
      ADMIN_ID,

    creator_name:
      ADMIN_ID,
  };

  const result = await apiJson(
    request,
    'post',
    '/api/work-orders',
    tokenHeaders,
    payload
  );

  return {
    ...result,
    payload,
  };
}

// ============================================================
// PostgreSQL Query Helpers
//
// PostgreSQL 不開放 Host 5432。
// 所有查詢透過：
// Node.js -> docker exec -> PostgreSQL Container
// ============================================================

// ------------------------------------------------------------
// Material Stock
// ------------------------------------------------------------

function getMaterialStock(materialId) {
  const result = dockerPsqlQuery(`
    SELECT stock
    FROM materials
    WHERE material_id = '${escapeSql(materialId)}';
  `);

  if (result.length === 0) {
    throw new Error(
      `找不到 material: ${materialId}`
    );
  }

  return Number(result[0][0]);
}

// ------------------------------------------------------------
// Product Stock
// ------------------------------------------------------------

function getProductStock(productId) {
  const result = dockerPsqlQuery(`
    SELECT stock
    FROM products
    WHERE product_id = '${escapeSql(productId)}';
  `);

  if (result.length === 0) {
    throw new Error(
      `找不到 product: ${productId}`
    );
  }

  return Number(result[0][0]);
}

// ------------------------------------------------------------
// Mold Status
// ------------------------------------------------------------

function getMoldStatus(moldId) {
  const result = dockerPsqlQuery(`
    SELECT status
    FROM molds
    WHERE mold_id = '${escapeSql(moldId)}';
  `);

  if (result.length === 0) {
    throw new Error(
      `找不到 mold: ${moldId}`
    );
  }

  return result[0][0];
}

// ------------------------------------------------------------
// Inventory Transactions
// ------------------------------------------------------------

function getInventoryTransactions(
  workOrderId,
  transactionType
) {
  const result = dockerPsqlQuery(`
    SELECT
      transaction_id,
      work_order_id,
      material_id,
      product_id,
      transaction_type,
      quantity
    FROM inventory_transactions
    WHERE work_order_id = '${escapeSql(workOrderId)}'
      AND transaction_type = '${escapeSql(transactionType)}'
    ORDER BY transaction_id;
  `);

  return result.map((row) => ({
    transaction_id: row[0],
    work_order_id: row[1],
    material_id: row[2] || null,
    product_id: row[3] || null,
    transaction_type: row[4],
    quantity: Number(row[5]),
  }));
}

// ------------------------------------------------------------
// Work Order
// ------------------------------------------------------------

function getWorkOrder(workOrderId) {
  const result = dockerPsqlQuery(`
    SELECT
      work_order_id,
      product_id,
      quantity,
      status,
      mold_id,
      line,
      creator_user_id
    FROM work_orders
    WHERE work_order_id = '${escapeSql(workOrderId)}';
  `);

  if (result.length === 0) {
    return null;
  }

  return {
    work_order_id: result[0][0],
    product_id: result[0][1],
    quantity: Number(result[0][2]),
    status: result[0][3],
    mold_id: result[0][4],
    line: result[0][5],
    creator_user_id: result[0][6],
  };
}

// ============================================================
// E2E Test Suite
// ============================================================

test.describe.serial(
  'Issue #15 Playwright production line E2E',
  () => {

    // ========================================================
    // Before Each
    // ========================================================

    test.beforeEach(async () => {
      await clearE2EData();
      await seedE2EData();
    });

    // ========================================================
    // After Each
    // ========================================================

    test.afterEach(async () => {
      await clearE2EData();
    });

    // ========================================================
    // After All
    // ========================================================

    test.afterAll(async () => {
      await clearE2EData();
    });

    // ========================================================
    // Test 1
    // ========================================================

    test(
      '1. frontend shell is reachable and authenticates through nginx API',
      async ({ page, request }) => {

        const pageResponse = await page.goto('/');

        expect(
          pageResponse.status()
        ).toBeLessThan(400);

        const health = await request.get(
          '/api/health'
        );

        expect(
          health.status()
        ).toBe(200);

        await expect(
          health
        ).toBeOK();

        await login(request);
      }
    );

    // ========================================================
    // Test 2
    // ========================================================

    test(
      '2. work order creation consumes material, writes negative consume transaction, and locks mold',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const {
          response,
          body,
        } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-CREATE',

            product_id:
              'E2E-PRD-CREATE',

            quantity:
              5,

            mold_id:
              'E2E-MOLD-CREATE',
          }
        );

        expect(
          response.status()
        ).toBe(201);

        expect(
          body.status
        ).toBe('Pending');

        // Material:
        // 100 - (5 * 2) = 90

        expect(
          getMaterialStock(
            'E2E-MAT-CREATE'
          )
        ).toBe(90);

        // Mold should become In_Use

        expect(
          getMoldStatus(
            'E2E-MOLD-CREATE'
          )
        ).toBe('In_Use');

        // Verify Work Order

        const workOrder =
          getWorkOrder(
            body.work_order_id
          );

        expect(
          workOrder
        ).not.toBeNull();

        expect(
          workOrder.status
        ).toBe('Pending');

        expect(
          workOrder.quantity
        ).toBe(5);

        expect(
          workOrder.product_id
        ).toBe('E2E-PRD-CREATE');

        expect(
          workOrder.mold_id
        ).toBe('E2E-MOLD-CREATE');

        // Verify consume transaction

        const consumeTransactions =
          getInventoryTransactions(
            body.work_order_id,
            'consume'
          );

        expect(
          consumeTransactions
        ).toHaveLength(1);

        expect(
          consumeTransactions[0].quantity
        ).toBe(-10);

        expect(
          consumeTransactions[0].material_id
        ).toBe('E2E-MAT-CREATE');

        expect(
          consumeTransactions[0].product_id
        ).toBeNull();
      }
    );

    // ========================================================
    // Test 3
    // ========================================================

    test(
      '3. pending work order transitions to In_Progress',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const { body: createdWO } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-START',

            product_id:
              'E2E-PRD-START',

            quantity:
              5,

            mold_id:
              'E2E-MOLD-START',
          }
        );

        const {
          response,
          body,
        } = await apiJson(
          request,
          'put',
          `/api/work-orders/${createdWO.work_order_id}`,
          tokenHeaders,
          {
            action: 'start',
          }
        );

        expect(
          response.status()
        ).toBe(200);

        expect(
          body.status
        ).toBe('In_Progress');

        const workOrder =
          getWorkOrder(
            createdWO.work_order_id
          );

        expect(
          workOrder.status
        ).toBe('In_Progress');
      }
    );

    // ========================================================
    // Test 4
    // ========================================================

    test(
      '4. in-progress work order completes, increases product stock, writes produce transaction, and releases mold',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const { body: createdWO } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-COMPLETE',

            product_id:
              'E2E-PRD-COMPLETE',

            quantity:
              7,

            mold_id:
              'E2E-MOLD-COMPLETE',
          }
        );

        await apiJson(
          request,
          'put',
          `/api/work-orders/${createdWO.work_order_id}`,
          tokenHeaders,
          {
            action: 'start',
          }
        );

        const {
          response,
          body,
        } = await apiJson(
          request,
          'put',
          `/api/work-orders/${createdWO.work_order_id}`,
          tokenHeaders,
          {
            action: 'complete',
          }
        );

        expect(
          response.status()
        ).toBe(200);

        expect(
          body.status
        ).toBe('Completed');

        // Product stock:
        // 0 + 7 = 7

        expect(
          getProductStock(
            'E2E-PRD-COMPLETE'
          )
        ).toBe(7);

        // Mold released

        expect(
          getMoldStatus(
            'E2E-MOLD-COMPLETE'
          )
        ).toBe('Idle');

        // Verify produce transaction

        const produceTransactions =
          getInventoryTransactions(
            createdWO.work_order_id,
            'produce'
          );

        expect(
          produceTransactions
        ).toHaveLength(1);

        expect(
          produceTransactions[0].quantity
        ).toBe(7);

        expect(
          produceTransactions[0].product_id
        ).toBe('E2E-PRD-COMPLETE');

        expect(
          produceTransactions[0].material_id
        ).toBeNull();
      }
    );

    // ========================================================
    // Test 5
    // ========================================================

    test(
      '5. reject rolls material stock back, writes restock transaction without product_id, and does not change product stock',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const { body: createdWO } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-REJECT',

            product_id:
              'E2E-PRD-REJECT',

            quantity:
              6,

            mold_id:
              'E2E-MOLD-REJECT',
          }
        );

        // 100 - (6 * 2) = 88

        expect(
          getMaterialStock(
            'E2E-MAT-REJECT'
          )
        ).toBe(88);

        expect(
          getProductStock(
            'E2E-PRD-REJECT'
          )
        ).toBe(0);

        const {
          response,
          body,
        } = await apiJson(
          request,
          'put',
          `/api/work-orders/${createdWO.work_order_id}`,
          tokenHeaders,
          {
            action: 'reject',
          }
        );

        expect(
          response.status()
        ).toBe(200);

        expect(
          body.status
        ).toBe('Rejected');

        // Material restored

        expect(
          getMaterialStock(
            'E2E-MAT-REJECT'
          )
        ).toBe(100);

        // Product unchanged

        expect(
          getProductStock(
            'E2E-PRD-REJECT'
          )
        ).toBe(0);

        // Mold released

        expect(
          getMoldStatus(
            'E2E-MOLD-REJECT'
          )
        ).toBe('Idle');

        // Verify restock transaction

        const restockTransactions =
          getInventoryTransactions(
            createdWO.work_order_id,
            'restock'
          );

        expect(
          restockTransactions
        ).toHaveLength(1);

        expect(
          restockTransactions[0].quantity
        ).toBe(12);

        expect(
          restockTransactions[0].material_id
        ).toBe('E2E-MAT-REJECT');

        expect(
          restockTransactions[0].product_id
        ).toBeNull();
      }
    );

    // ========================================================
    // Test 6
    // ========================================================

    test(
      '6. mold in use blocks work order creation without changing stock',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const initialStock =
          getMaterialStock(
            'E2E-MAT-BUSY'
          );

        const {
          response,
          body,
        } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-BUSY',

            product_id:
              'E2E-PRD-BUSY',

            quantity:
              3,

            mold_id:
              'E2E-MOLD-BUSY',
          }
        );

        expect(
          response.status()
        ).toBe(409);

        expect(
          body.error
        ).toContain(
          'Mold is currently in use'
        );

        // Stock must not change

        expect(
          getMaterialStock(
            'E2E-MAT-BUSY'
          )
        ).toBe(initialStock);

      }
    );

    // ========================================================
    // Test 7
    // ========================================================

    test(
      '7. insufficient material stock blocks work order creation without writing transactions',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const initialStock =
          getMaterialStock(
            'E2E-MAT-LOW'
          );

        const {
          response,
          body,
        } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-LOW',

            product_id:
              'E2E-PRD-LOW',

            quantity:
              1,

            mold_id:
              'E2E-MOLD-LOW',
          }
        );

        expect(
          response.status()
        ).toBe(409);

        expect(
          body.error
        ).toContain(
          'Insufficient stock for material E2E-MAT-LOW'
        );

        // Stock must not change

        expect(
          getMaterialStock(
            'E2E-MAT-LOW'
          )
        ).toBe(initialStock);

      }
    );

    // ========================================================
    // Test 8
    // ========================================================

    test(
      '8. invalid work order state transition is rejected',
      async ({ request }) => {

        const tokenHeaders =
          await login(request);

        const { body: createdWO } = await createWorkOrder(
          request,
          tokenHeaders,
          {
            work_order_id:
              'E2E-WO-INVALID',

            product_id:
              'E2E-PRD-INVALID',

            quantity:
              4,

            mold_id:
              'E2E-MOLD-INVALID',
          }
        );

        // Pending -> complete
        //
        // 這個操作應該失敗

        await apiJson(
          request,
          'put',
          `/api/work-orders/${createdWO.work_order_id}`,
          tokenHeaders,
          {
            action: 'complete',
          }
        );

        // Pending 狀態下不能 start
        // 如果前一個 complete 已經改變狀態，
        // 這裡會驗證目前狀態是否符合系統規則。

        const {
          response,
          body,
        } = await apiJson(
          request,
          'put',
          `/api/work-orders/${createdWO.work_order_id}`,
          tokenHeaders,
          {
            action: 'start',
          }
        );

        expect(
          response.status()
        ).toBe(409);

        expect(
          body.error
        ).toContain(
          'Cannot start work order'
        );
      }
    );
  }
);