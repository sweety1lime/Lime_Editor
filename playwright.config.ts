import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config для Lime_Editor (ASP.NET Core 8 + PostgreSQL).
 *
 * - webServer = dotnet run, ждёт /health = Healthy
 * - ignoreHTTPSErrors для dev-сертификата localhost
 * - storageState через auth.setup.ts — два project'а (dark + light), оба зависят от setup
 * - Visual snapshots с порогом 2%, animations off
 *
 * Скопируй этот файл в корень репо как `playwright.config.ts`.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // serial — БД одна, чтобы не было гонок при createSite/publish
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "https://localhost:5001",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    // Setup — выполняется первым, создаёт storageState
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    // Анонимные тесты — без storageState (без auth)
    {
      name: "anonymous",
      testMatch: [/.*\.anonymous\.spec\.ts/, /smoke\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    // Authed dark
    {
      name: "chromium-dark",
      testIgnore: [/.*\.anonymous\.spec\.ts/, /.*admin.*/, /.*\.setup\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
    // Authed light (only for visual + smoke — flows гоняем только в dark чтобы экономить)
    {
      name: "chromium-light",
      testMatch: [/visual\.spec\.ts/, /smoke\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/user-light.json",
      },
      dependencies: ["setup"],
    },
    // Admin
    {
      name: "chromium-admin",
      testMatch: /flows\/admin\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/admin.json",
      },
      dependencies: ["setup"],
    },
    // Mobile viewport
    {
      name: "mobile-chrome",
      testMatch: /smoke\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "dotnet run --project Lime_Editor --urls=https://localhost:5001 --no-launch-profile",
    url: "https://localhost:5001/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // .NET cold start: ~30-60s; БД миграции: ещё ~5s
    ignoreHTTPSErrors: true,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Development env активирует User Secrets, где лежит правильная строка PostgreSQL.
      // Без этого --no-launch-profile дефолтит на Production и connect-строка пустая → миграции падают.
      ASPNETCORE_ENVIRONMENT: "Development",
    },
  },
  outputDir: "./test-results",
});
