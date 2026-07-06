import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.LIME_E2E_BASE_URL || "https://localhost:5001";
const hasAdminAuth = !!process.env.LIME_TEST_ADMIN && !!process.env.LIME_TEST_ADMIN_PASSWORD;

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
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
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
    // Authed light: только smoke. Продукт dark-only (deep-ink редизайн) — visual в light
    // снимал байт-в-байт те же скриншоты, что dark, вдвое раздувая прогон и набор бейзлайнов.
    {
      name: "chromium-light",
      testMatch: [/smoke\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/user-light.json",
      },
      dependencies: ["setup"],
    },
    // Admin — включается только когда есть креды; иначе полный `playwright test`
    // падал до выполнения тестов из-за отсутствующего playwright/.auth/admin.json.
    ...(hasAdminAuth ? [{
      name: "chromium-admin",
      testMatch: /flows\/admin\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "playwright/.auth/admin.json",
      },
      dependencies: ["setup"],
    }] : []),
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
    command: `dotnet run --project Lime_Editor --urls=${baseURL} --no-launch-profile`,
    url: `${baseURL}/health`,
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
