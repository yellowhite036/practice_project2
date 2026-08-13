const { test, expect } = require('@playwright/test');
const { pool, seedE2EData, clearE2EData } = require('../utils/db');

const ADMIN_ID = 'E2E-ADMIN';

async function login(request) {
  const response = await request.post('/api/auth/login', {
    data: { user_id: ADMIN_ID },
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

async function apiJson(request, method, path, tokenHeaders, data) {
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

  return { response, body };
}

async function createWorkOrder(request, tokenHeaders, overrides = {}) {
  const payload = {
    work_order_id: overrides.work_order_id || 'E2E-WO-DEFAULT',
    product_id: overrides.product_id || 'E2E-PRD-CREATE',
    quantity: overrides.quantity || 5,
    line: overrides.line || 'L1',
    mold_id: overrides.mold_id || 'E2E-MOLD-CREATE',
    creator_user_id: ADMIN_ID,
    creator_name: ADMIN_ID,
  };

  const result = await apiJson(request, 'post', '/api/work-orders', tokenHeaders, payload);
  return { ...result, payload };
}

async function getMaterialStock(materialId) {
  const { rows } = await pool.query(
    'SELECT stock FROM materials WHERE material_id = $1',
    [materialId]
  );

  return Number(rows[0].stock);
}

async function getProductStock(productId) {
  const { rows } = await pool.query(
    'SELECT stock FROM products WHERE product_id = $1',
    [productId]
  );

  return Number(rows[0].stock);
}

async function getMoldStatus(moldId) {
  const { rows } = await pool.query(
    'SELECT status FROM molds WHERE mold_id = $1',
    [moldId]
  );

  return rows[0].status;
}

async function getInventoryTransactions(workOrderId, transactionType) {
  const { rows } = await pool.query(
    `SELECT
       transaction_id,
       work_order_id,
       material_id,
       product_id,
       transaction_type,
       quantity
     FROM inventory_transactions
     WHERE work_order_id = $1
       AND transaction_type = $2
     ORDER BY transaction_id`,
    [workOrderId, transactionType]
  );

  return rows;
}

test.describe.serial('Issue #15 Playwright production line E2E', () => {
  test.beforeEach(async () => {
    await clearE2EData();
    await seedE2EData();
  });

  test.afterEach(async () => {
    await clearE2EData();
  });

  test.afterAll(async () => {
    try {
      await clearE2EData();
    } finally {
      await pool.end();
    }
  });

  test('1. frontend shell is reachable and authenticates through nginx API', async ({ page, request }) => {
    const pageResponse = await page.goto('/');
    expect(pageResponse.status()).toBeLessThan(400);

    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    await expect(health).toBeOK();

    await login(request);
  });

  test('2. work order creation consumes material, writes negative consume transaction, and locks mold', async ({ request }) => {
    const tokenHeaders = await login(request);
    const { response, body } = await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-CREATE',
      product_id: 'E2E-PRD-CREATE',
      quantity: 5,
      mold_id: 'E2E-MOLD-CREATE',
    });

    expect(response.status()).toBe(201);
    expect(body.status).toBe('Pending');

    expect(await getMaterialStock('E2E-MAT-CREATE')).toBe(90);
    expect(await getMoldStatus('E2E-MOLD-CREATE')).toBe('In_Use');

    const consumeTransactions = await getInventoryTransactions('E2E-WO-CREATE', 'consume');
    expect(consumeTransactions).toHaveLength(1);
    expect(Number(consumeTransactions[0].quantity)).toBe(-10);
    expect(consumeTransactions[0].material_id).toBe('E2E-MAT-CREATE');
    expect(consumeTransactions[0].product_id).toBeNull();
  });

  test('3. pending work order transitions to In_Progress', async ({ request }) => {
    const tokenHeaders = await login(request);
    await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-START',
      product_id: 'E2E-PRD-START',
      quantity: 5,
      mold_id: 'E2E-MOLD-START',
    });

    const { response, body } = await apiJson(
      request,
      'put',
      '/api/work-orders/E2E-WO-START',
      tokenHeaders,
      { action: 'start' }
    );

    expect(response.status()).toBe(200);
    expect(body.status).toBe('In_Progress');
  });

  test('4. in-progress work order completes, increases product stock, writes produce transaction, and releases mold', async ({ request }) => {
    const tokenHeaders = await login(request);
    await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-COMPLETE',
      product_id: 'E2E-PRD-COMPLETE',
      quantity: 7,
      mold_id: 'E2E-MOLD-COMPLETE',
    });
    await apiJson(request, 'put', '/api/work-orders/E2E-WO-COMPLETE', tokenHeaders, { action: 'start' });

    const { response, body } = await apiJson(
      request,
      'put',
      '/api/work-orders/E2E-WO-COMPLETE',
      tokenHeaders,
      { action: 'complete' }
    );

    expect(response.status()).toBe(200);
    expect(body.status).toBe('Completed');
    expect(await getProductStock('E2E-PRD-COMPLETE')).toBe(7);
    expect(await getMoldStatus('E2E-MOLD-COMPLETE')).toBe('Idle');

    const produceTransactions = await getInventoryTransactions('E2E-WO-COMPLETE', 'produce');
    expect(produceTransactions).toHaveLength(1);
    expect(Number(produceTransactions[0].quantity)).toBe(7);
    expect(produceTransactions[0].product_id).toBe('E2E-PRD-COMPLETE');
    expect(produceTransactions[0].material_id).toBeNull();
  });

  test('5. reject rolls material stock back, writes restock transaction without product_id, and does not change product stock', async ({ request }) => {
    const tokenHeaders = await login(request);
    await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-REJECT',
      product_id: 'E2E-PRD-REJECT',
      quantity: 6,
      mold_id: 'E2E-MOLD-REJECT',
    });

    expect(await getMaterialStock('E2E-MAT-REJECT')).toBe(88);
    expect(await getProductStock('E2E-PRD-REJECT')).toBe(0);

    const { response, body } = await apiJson(
      request,
      'put',
      '/api/work-orders/E2E-WO-REJECT',
      tokenHeaders,
      { action: 'reject' }
    );

    expect(response.status()).toBe(200);
    expect(body.status).toBe('Rejected');
    expect(await getMaterialStock('E2E-MAT-REJECT')).toBe(100);
    expect(await getProductStock('E2E-PRD-REJECT')).toBe(0);
    expect(await getMoldStatus('E2E-MOLD-REJECT')).toBe('Idle');

    const restockTransactions = await getInventoryTransactions('E2E-WO-REJECT', 'restock');
    expect(restockTransactions).toHaveLength(1);
    expect(Number(restockTransactions[0].quantity)).toBe(12);
    expect(restockTransactions[0].material_id).toBe('E2E-MAT-REJECT');
    expect(restockTransactions[0].product_id).toBeNull();
  });

  test('6. mold in use blocks work order creation without changing stock', async ({ request }) => {
    const tokenHeaders = await login(request);
    const initialStock = await getMaterialStock('E2E-MAT-BUSY');

    const { response, body } = await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-BUSY',
      product_id: 'E2E-PRD-BUSY',
      quantity: 3,
      mold_id: 'E2E-MOLD-BUSY',
    });

    expect(response.status()).toBe(409);
    expect(body.error).toContain('Mold is currently in use');
    expect(await getMaterialStock('E2E-MAT-BUSY')).toBe(initialStock);

    const { rows } = await pool.query(
      'SELECT work_order_id FROM work_orders WHERE work_order_id = $1',
      ['E2E-WO-BUSY']
    );
    expect(rows).toHaveLength(0);
  });

  test('7. insufficient material stock blocks work order creation without writing transactions', async ({ request }) => {
    const tokenHeaders = await login(request);
    const initialStock = await getMaterialStock('E2E-MAT-LOW');

    const { response, body } = await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-LOW',
      product_id: 'E2E-PRD-LOW',
      quantity: 1,
      mold_id: 'E2E-MOLD-LOW',
    });

    expect(response.status()).toBe(409);
    expect(body.error).toContain('Insufficient stock for material E2E-MAT-LOW');
    expect(await getMaterialStock('E2E-MAT-LOW')).toBe(initialStock);

    const txRows = await getInventoryTransactions('E2E-WO-LOW', 'consume');
    expect(txRows).toHaveLength(0);
  });

  test('8. invalid work order state transition is rejected', async ({ request }) => {
    const tokenHeaders = await login(request);
    await createWorkOrder(request, tokenHeaders, {
      work_order_id: 'E2E-WO-INVALID',
      product_id: 'E2E-PRD-INVALID',
      quantity: 4,
      mold_id: 'E2E-MOLD-INVALID',
    });
    await apiJson(request, 'put', '/api/work-orders/E2E-WO-INVALID', tokenHeaders, { action: 'complete' });

    const { response, body } = await apiJson(
      request,
      'put',
      '/api/work-orders/E2E-WO-INVALID',
      tokenHeaders,
      { action: 'start' }
    );

    expect(response.status()).toBe(409);
    expect(body.error).toContain('Cannot start work order');
  });
});
