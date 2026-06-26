/**
 * Auth setup: создаёт (или находит) test-юзера, логинится, сохраняет cookie state.
 *
 * Создаёт три файла:
 *  - playwright/.auth/user.json       — обычный юзер в dark теме
 *  - playwright/.auth/user-light.json — тот же юзер с lime_theme=light cookie
 *  - playwright/.auth/admin.json      — админ (если креды заданы в env)
 *
 * Скопировать в `tests/auth.setup.ts`.
 */
import { test as setup, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const USER = process.env.LIME_TEST_USER || "playwright_tester";
const PASS = process.env.LIME_TEST_PASSWORD || "PlaywrightTest1!";
const EMAIL = process.env.LIME_TEST_EMAIL || "playwright@test.local";
const FALLBACK_SUFFIX = (process.env.LIME_TEST_RUN_ID || Date.now().toString(36)).replace(/[^a-z0-9_]/gi, "").slice(-10);

const ADMIN = process.env.LIME_TEST_ADMIN;
const ADMIN_PASS = process.env.LIME_TEST_ADMIN_PASSWORD;

const authDir = "playwright/.auth";
fs.mkdirSync(authDir, { recursive: true });

type Credentials = { user: string; pass: string; email: string };
let cachedUser: Credentials | null = null;

async function tryLogin(page: Page, login: string, password: string): Promise<boolean> {
  await page.goto("/Home/SignIn", { waitUntil: "domcontentloaded" });
  if (/\/Home\/MySites/.test(page.url())) return true;
  await page.fill('input[name="Login"]', login);
  await page.fill('input[name="Password"]', password);
  await page.locator('button[type="submit"]').click();
  return await page
    .waitForURL(/\/Home\/MySites/, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
}

async function trySignUp(page: Page, login: string, password: string, email: string): Promise<boolean> {
  await page.goto("/Home/SignUp", { waitUntil: "domcontentloaded" });
  if (/\/Home\/MySites/.test(page.url())) return true;
  await page.fill('input[name="Email"]', email);
  await page.fill('input[name="Login"]', login);
  await page.fill('input[name="Password"]', password);
  await page.fill("#signup-confirm", password);
  await page.locator('button[type="submit"]').click();
  return await page
    .waitForURL(/\/Home\/SignIn/, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

async function ensureTestUser(page: Page): Promise<Credentials> {
  if (cachedUser && await tryLogin(page, cachedUser.user, cachedUser.pass)) return cachedUser;

  const primary = { user: USER, pass: PASS, email: EMAIL };
  if (await tryLogin(page, primary.user, primary.pass)) {
    cachedUser = primary;
    return primary;
  }

  if (await trySignUp(page, primary.user, primary.pass, primary.email)) {
    const after = await tryLogin(page, primary.user, primary.pass);
    if (after) {
      cachedUser = primary;
      return primary;
    }
  }

  if (process.env.LIME_TEST_USER) {
    throw new Error(
      `Cannot authenticate LIME_TEST_USER="${USER}". Check LIME_TEST_PASSWORD or clean the test DB user.`
    );
  }

  const fallback = {
    user: `playwright_${FALLBACK_SUFFIX}`,
    pass: PASS,
    email: `playwright_${FALLBACK_SUFFIX}@test.local`,
  };
  const created = await trySignUp(page, fallback.user, fallback.pass, fallback.email);
  expect(created, `Cannot create fallback Playwright user "${fallback.user}"`).toBe(true);
  const loggedIn = await tryLogin(page, fallback.user, fallback.pass);
  expect(loggedIn, `Cannot login as fallback Playwright user "${fallback.user}"`).toBe(true);
  cachedUser = fallback;
  return fallback;
}

setup("authenticate as test user", async ({ page }) => {
  await ensureTestUser(page);
  await expect(page).toHaveURL(/\/Home\/MySites/);
  await page.context().storageState({ path: path.join(authDir, "user.json") });
});

setup("authenticate as test user (light theme)", async ({ context, page }) => {
  // Поставим cookie темы ДО первого goto — first paint будет уже light
  await context.addCookies([
    {
      name: "lime_theme",
      value: "light",
      domain: "localhost",
      path: "/",
      sameSite: "Lax",
    },
  ]);
  await ensureTestUser(page);
  await expect(page).toHaveURL(/\/Home\/MySites/);
  await page.context().storageState({ path: path.join(authDir, "user-light.json") });
});

setup("authenticate as admin user", async ({ page }) => {
  if (!ADMIN || !ADMIN_PASS) {
    // Skip — нет admin кредов. Тесты под admin-project'ом будут falling без state.
    console.warn(
      "[auth.setup] LIME_TEST_ADMIN / LIME_TEST_ADMIN_PASSWORD не заданы — admin-state не создан"
    );
    return;
  }
  const ok = await tryLogin(page, ADMIN, ADMIN_PASS);
  expect(ok, `Cannot login as admin "${ADMIN}". Создай юзера и назначь роль Admin вручную.`).toBe(true);
  await expect(page).toHaveURL(/\/Home\/MySites/);
  await page.context().storageState({ path: path.join(authDir, "admin.json") });
});
