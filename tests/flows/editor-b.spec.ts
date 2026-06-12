/**
 * Движок B (Трек B) — критичный путь нового редактора (authed).
 * Покрывает: добавление блоков, вложенность в контейнер, undo, грипы DnD,
 * AI-модалку, сохранение и переоткрытие через «✦ Движок B».
 */
import { test, expect } from "@playwright/test";

const topBlocks = "#lime-doc-workspace .lime-doc-page > .lime-block";
const nestedBlocks = "#lime-doc-workspace .lime-block .lime-block";

test("editor-b: blocks + container nesting + undo + save/reopen (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();
  await expect(page.locator(".lime-workspace__placeholder")).toBeVisible();

  // Три блока верхнего уровня
  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  await page.locator('[data-doc-add="container"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Контейнер выбран → следующий блок добавляется ВНУТРЬ него
  await expect(page.locator(".lime-doc-comp-banner")).toContainText(/Контейнер выбран/);
  await page.locator('[data-doc-add="text"]').click();
  await expect(page.locator(nestedBlocks)).toHaveCount(1);
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Undo откатывает вложенный блок (кнопка ↶, этап 0.4)
  await expect(page.locator("[data-doc-undo]")).toBeEnabled();
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(nestedBlocks)).toHaveCount(0);
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Грипы drag-and-drop отрендерены у блоков (display:none до hover — проверяем наличие в DOM)
  expect(await page.locator("#lime-doc-workspace .lime-block-grip").count()).toBeGreaterThanOrEqual(3);

  // Пустой контейнер показывает подсказку-дропзону
  await expect(page.locator(".lime-doc-drop-hint")).toBeVisible();

  // Сохраняем (новый сайт) → MySites
  await page.locator("[data-doc-save]").click();
  await page.waitForURL(/\/Home\/MySites/);

  // Последняя карточка — наш сайт движка B, открываем через «✦ Движок B»
  const lastCard = page.locator(".lime-site-card").last();
  await lastCard.locator('a:has-text("Движок B")').click();
  await page.waitForURL(/\/Home\/EditDoc\?siteId=/);

  // Блоки на месте после переоткрытия
  await expect(page.locator(topBlocks)).toHaveCount(3);
});

test("editor-b: breakpoint switcher changes preview device (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.locator('[data-doc-add="heading"]').click();

  await page.locator('[data-doc-bp="mobile"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "mobile");
  await page.locator('[data-doc-bp="base"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "desktop");
});

test("editor-b: AI modal opens and reports quota/config status (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.locator("[data-doc-ai-open]").click();
  await expect(page.locator("#lime-doc-ai-modal")).toHaveClass(/is-open/);
  // Статус заполняется ответом /Ai/Quota: либо остаток квоты, либо «не настроен» —
  // оба валидны для локального окружения без AI_API_KEY.
  await expect(page.locator("#lime-doc-ai-status")).toContainText(/Осталось генераций|не настроен/i, { timeout: 5000 });
  await page.locator("[data-doc-ai-close]").click();
  await expect(page.locator("#lime-doc-ai-modal")).not.toHaveClass(/is-open/);
});

test("editor-b: media block shows picker placeholder (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.locator('[data-doc-add="image"]').click();
  // Пустой image-блок рендерит кликабельный плейсхолдер выбора изображения
  await expect(page.locator("[data-doc-pick]")).toBeVisible();
  await page.locator("[data-doc-pick]").click();
  // Открылась медиа-модалка (та же, что в legacy: /Media/ApiList)
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);
  await page.locator("[data-lime-modal-close]").click();
  await expect(page.locator("#lime-media-modal")).not.toHaveClass(/is-open/);
});
