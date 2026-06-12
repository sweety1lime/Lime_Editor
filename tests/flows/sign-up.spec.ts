/**
 * Sign-up flow. Анонимный — НЕ требует storageState.
 * Скопировать в `tests/flows/sign-up.spec.ts` и в playwright.config переименовать
 * шаблон файла в .anonymous.spec.ts если хочешь запускать в anonymous project.
 */
import { test, expect } from "@playwright/test";

// Без storage — каждый тест свежая сессия
test.use({ storageState: { cookies: [], origins: [] } });

test("happy path: sign up → redirect to SignIn → login → MySites (@flow @anonymous)", async ({ page }) => {
  const suffix = Date.now().toString(36).slice(-6);
  const login = `flowuser_${suffix}`;
  const email = `${login}@test.local`;
  const password = "TestPassword1!";

  await page.goto("/Home/SignUp");
  await expect(page.locator(".lime-auth__title")).toContainText(/Создай аккаунт/i);

  await page.fill('input[name="Email"]', email);
  await page.fill('input[name="Login"]', login);
  await page.fill('input[name="Password"]', password);
  await page.fill("#signup-confirm", password);
  await page.locator('button[type="submit"]').click();

  // SignUp success → SignIn
  await expect(page).toHaveURL(/\/Home\/SignIn/);

  // Login с теми же кредами
  await page.fill('input[name="Login"]', login);
  await page.fill('input[name="Password"]', password);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/Home\/MySites/);
  await expect(page.locator(".lime-dashboard__welcome")).toContainText(login);
});

test("password mismatch shows inline warning (@flow @anonymous)", async ({ page }) => {
  await page.goto("/Home/SignUp");
  await page.fill('input[name="Password"]', "secret123");
  await page.fill("#signup-confirm", "different");
  await page.waitForTimeout(150);
  await expect(page.locator("#signup-confirm-msg")).toContainText(/не совпадают/i);
});

test("invalid email shows server validation (@flow @anonymous)", async ({ page }) => {
  // domcontentloaded — после предыдущего sign-up БД ещё может быть в транзакции, "load" иногда тайматет.
  await page.goto("/Home/SignUp", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="Email"]', "not-an-email");
  await page.fill('input[name="Login"]', "validlogin");
  await page.fill('input[name="Password"]', "secret123");
  await page.fill("#signup-confirm", "secret123");
  await page.locator('button[type="submit"]').click();
  // Браузерная валидация HTML5 type="email" должна остановить отправку. Если нет — серверная.
  await expect(page).toHaveURL(/\/Home\/SignUp/);
});

test("invalid login: existing user shows error (@flow @anonymous)", async ({ page }) => {
  await page.goto("/Home/SignIn");
  await page.fill('input[name="Login"]', "definitely_not_a_user_xyz");
  await page.fill('input[name="Password"]', "wrong");
  await page.locator('button[type="submit"]').click();
  await expect(page.locator(".lime-alert--danger")).toBeVisible();
});
