/**
 * Admin flow — требует storageState=admin.json (см. auth.setup.ts).
 * Скопировать в `tests/flows/admin.spec.ts`.
 *
 * В playwright.config admin-project уже настроен:
 *   testMatch: /flows\/admin\.spec\.ts/
 *   storageState: "playwright/.auth/admin.json"
 */
import { test, expect } from "@playwright/test";

test("admin dashboard shows 4 stat cards (@flow @admin)", async ({ page }) => {
  await page.goto("/Admin/Index");
  await expect(page.locator(".lime-admin-stats .lime-card")).toHaveCount(4);
  // Тексты стат-плиток
  await expect(page.locator(".lime-admin-stats")).toContainText(/Пользователей/);
  await expect(page.locator(".lime-admin-stats")).toContainText(/Сайтов/);
  await expect(page.locator(".lime-admin-stats")).toContainText(/Опубликовано/);
  await expect(page.locator(".lime-admin-stats")).toContainText(/Админов/);
});

test("admin users table shows current admin with Admin badge (@flow @admin)", async ({ page }) => {
  await page.goto("/Admin/Users");
  const rows = page.locator(".lime-table tbody tr");
  await expect(rows.first()).toBeVisible();

  // Должна быть хотя бы одна строка с бейджем Admin
  await expect(page.locator(".lime-badge--warn:has-text('Admin')").first()).toBeVisible();
});

test("admin cannot demote self → warning shown (@flow @admin)", async ({ page }) => {
  await page.goto("/Admin/Users");

  // Найти строку текущего админа (имя в навбаре)
  const myName = await page.locator(".lime-dropdown__trigger span").last().textContent();
  expect(myName).toBeTruthy();
  const myRow = page.locator(".lime-table tbody tr", { has: page.locator(`td:has-text("${myName!.trim()}")`) });
  await expect(myRow).toBeVisible();

  // Снять Admin с себя
  await myRow.locator('button:has-text("Снять Admin")').click();
  await page.waitForLoadState("networkidle");

  // Жёлтое предупреждение
  await expect(page.locator(".lime-alert--warn")).toContainText(/Нельзя снять с себя/i);
});

test("admin sites list shows all sites with owners (@flow @admin)", async ({ page }) => {
  await page.goto("/Admin/Sites");
  await expect(page.locator(".lime-table")).toBeVisible();
  // Столбец "Владелец" есть
  await expect(page.locator(".lime-table thead")).toContainText(/Владелец/);
});

test("non-admin link is hidden for regular users — sanity (@flow)", async ({ browser }) => {
  // Тест выполняется СВЕЖЕЙ сессией под обычным юзером — переопределяем storageState на user.json.
  // НО если LIME_TEST_USER и LIME_TEST_ADMIN — один аккаунт (типичная dev-конфигурация когда
  // тестовому юзеру выдана Admin-роль), тест семантически невалиден: user.json содержит куку
  // того же юзера, и для него линк "Админка" будет виден. Skip.
  const adminUser = process.env.LIME_TEST_ADMIN ?? "playwright_admin";
  const regularUser = process.env.LIME_TEST_USER ?? "playwright_tester";
  if (adminUser === regularUser) {
    test.skip(true, "LIME_TEST_USER == LIME_TEST_ADMIN — нужен отдельный non-admin юзер для этого теста");
    return;
  }

  const context = await browser.newContext({ storageState: "playwright/.auth/user.json" });
  const userPage = await context.newPage();
  await userPage.goto("/Home/MySites");
  await expect(userPage.locator('a:has-text("Админка")')).toHaveCount(0);

  // И /Admin/Index — доступ запрещён, Identity редиректит на AccessDeniedPath
  await userPage.goto("/Admin/Index", { waitUntil: "domcontentloaded" });
  expect(userPage.url()).not.toContain("/Admin");
  await context.close();
});
