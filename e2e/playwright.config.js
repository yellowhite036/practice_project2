const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // ────────────────────────────────────────────────────────
    // 顯示瀏覽器 UI，方便觀察測試流程
    // ────────────────────────────────────────────────────────
    launchOptions: {
      headless: false,
    },
  },
  projects: [
    // ── 原有 API / 純 request 測試 ──────────────────────────
    {
      name: 'chromium',
      testMatch: /work-orders\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    // ── 一般使用者生產流程 UI 自動化測試 ─────────────────────
    // 以顯示 UI 的 Chromium 執行；timeout 加長以容納 UI 等待
    {
      name: 'production-flow-ui',
      testMatch: /production-flow-ui\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { headless: false },
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
      },
    },
  ],
});
