/**
 * Custom constructor flow (authed) — критичный путь Tier 2.
 * Скопировать в `tests/flows/constructor.spec.ts`.
 */
import { test, expect } from "@playwright/test";

test("constructor: add blocks → toolbar → save → reopen → blocks persist (@flow)", async ({ page }) => {
  await page.goto("/Home/EditTemplates");
  await expect(page.locator("#lime-workspace")).toBeVisible();
  await expect(page.locator(".lime-workspace__placeholder")).toBeVisible();

  // Добавляем 3 блока
  await page.locator('[data-add-block="cover"]').click();
  await page.locator('[data-add-block="heading"]').click();
  await page.locator('[data-add-block="cta"]').click();

  // Placeholder исчез
  await expect(page.locator(".lime-workspace__placeholder")).not.toBeVisible();

  // 3 блока в workspace
  const blocks = page.locator("#lime-workspace .lime-block");
  await expect(blocks).toHaveCount(3);

  // Последний (CTA) выбран автоматически (is-selected) и виден toolbar
  await expect(blocks.last()).toHaveClass(/is-selected/);
  await expect(page.locator(".lime-block-toolbar.is-visible")).toBeVisible();

  // Дублируем CTA через toolbar
  await page.locator('.lime-block-toolbar [data-action="duplicate"]').click();
  await expect(blocks).toHaveCount(4);

  // Удаляем последний (дубль)
  page.on("dialog", (d) => d.accept()); // confirm("Удалить блок?")
  await page.locator('.lime-block-toolbar [data-action="delete"]').click();
  await expect(blocks).toHaveCount(3);

  // Меняем текст в Cover (первый блок)
  const coverTitle = blocks.first().locator(".lime-block__cover-title");
  await coverTitle.click();
  await coverTitle.fill("Мой новый сайт");

  // Переключаем preview на mobile
  await page.locator('[data-device="mobile"]').click();
  await expect(page.locator("#lime-workspace")).toHaveAttribute("data-device", "mobile");
  // Workspace схлопывается до 375px. getComputedStyle().maxWidth может вернуть calc(...) для
  // относительных значений, поэтому проверяем реальную видимую ширину через boundingBox.
  // 430 — небольшой запас на padding canvas-обёртки и border.
  const ws = page.locator("#lime-workspace");
  const box = await ws.boundingBox();
  expect(box, "workspace must be visible").toBeTruthy();
  expect(box!.width).toBeLessThanOrEqual(430);

  // Обратно desktop
  await page.locator('[data-device="desktop"]').click();

  // Сохраняем
  await page.locator("[data-save-action]").click();
  await page.waitForURL(/\/Home\/MySites/);

  // Открываем сайт обратно в редакторе
  const lastCard = page.locator(".lime-site-card").last();
  await expect(lastCard).toBeVisible();
  await lastCard.locator('button:has-text("Редактировать")').click();
  await page.waitForURL(/\/Home\/EditTemplates\?siteId=/);

  // Блоки на месте
  await expect(page.locator("#lime-workspace .lime-block")).toHaveCount(3);
  // Cover title сохранился
  await expect(page.locator(".lime-block__cover-title")).toContainText("Мой новый сайт");
  // Badge "Редактирование"
  await expect(page.locator(".lime-badge--muted")).toContainText(/Редактирование/i);
});

test("constructor: sidebar search filters blocks (@flow)", async ({ page }) => {
  await page.goto("/Home/EditTemplates");
  const visible = () => page.locator(".lime-block-tile:not(.is-hidden)");
  const total = await page.locator(".lime-block-tile").count();
  expect(total).toBeGreaterThan(5);

  await page.fill("#lime-block-search", "цен");
  await page.waitForTimeout(150);
  const filtered = await visible().count();
  expect(filtered).toBeLessThan(total);
  // По крайней мере "Цены" должен остаться видимым
  await expect(page.locator(".lime-block-tile:not(.is-hidden)").filter({ hasText: /цены/i })).toBeVisible();

  // Очистка поиска
  await page.fill("#lime-block-search", "");
  await page.waitForTimeout(150);
  expect(await visible().count()).toBe(total);
});

test("constructor: move-up reorders blocks (@flow)", async ({ page }) => {
  await page.goto("/Home/EditTemplates");
  await page.locator('[data-add-block="heading"]').click();
  await page.locator('[data-add-block="text"]').click();

  // Второй блок выбран. Кликаем "вверх" в toolbar.
  await page.locator('.lime-block-toolbar [data-action="up"]').click();

  // Теперь первый блок — text, второй — heading.
  const blocks = page.locator("#lime-workspace .lime-block");
  await expect(blocks.first()).toHaveAttribute("data-block-type", "text");
  await expect(blocks.nth(1)).toHaveAttribute("data-block-type", "heading");
});

test("constructor: theme toggle in topbar works (@flow)", async ({ page }) => {
  await page.goto("/Home/EditTemplates");
  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator("[data-lime-theme-toggle]").click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toEqual(initial);
});
