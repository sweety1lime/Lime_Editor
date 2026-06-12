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

const ADMIN = process.env.LIME_TEST_ADMIN;
const ADMIN_PASS = process.env.LIME_TEST_ADMIN_PASSWORD;

const authDir = "playwright/.auth";
fs.mkdirSync(authDir, { recursive: true });

async function tryLogin(page: Page, login: string, password: string): Promise<boolean> {
  await page.goto("/Home/SignIn");
  await page.fill('input[name="Login"]', login);
  await page.fill('input[name="Password"]', password);
  await page.locator('button[type="submit"]').click();
  return await page
    .waitForURL(/\/Home\/MySites/, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
}

async function signUp(page: Page, login: string, password: string, email: string): Promise<void> {
  await page.goto("/Home/SignUp");
  await page.fill('input[name="Email"]', email);
  await page.fill('input[name="Login"]', login);
  await page.fill('input[name="Password"]', password);
  await page.fill("#signup-confirm", password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/Home\/SignIn/, { timeout: 10_000 });
}

setup("authenticate as test user", async ({ page }) => {
  const ok = await tryLogin(page, USER, PASS);
  if (!ok) {
    await signUp(page, USER, PASS, EMAIL);
    const after = await tryLogin(page, USER, PASS);
    expect(after, "Login after SignUp failed").toBe(true);
  }
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
  const ok = await tryLogin(page, USER, PASS);
  if (!ok) {
    // Если первой setup-у юзер не создался (race), пробуем здесь тоже
    await signUp(page, USER, PASS, EMAIL);
    await tryLogin(page, USER, PASS);
  }
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
