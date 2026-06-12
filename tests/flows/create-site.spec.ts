/**
 * Create site from template (authed).
 * Скопировать в `tests/flows/create-site.spec.ts`.
 */
import { test, expect } from "@playwright/test";

test("Templates → Use Template_1 → savePage → MySites shows new site (@flow)", async ({ page }) => {
  await page.goto("/Home/Templates");

  // Должны быть видны три публичных шаблона (Ruby/Sublime/ComingSoon).
  const cards = page.locator(".lime-tpl-card");
  await expect(cards.first()).toBeVisible();
  const cardsCount = await cards.count();
  expect(cardsCount).toBeGreaterThanOrEqual(3);

  // Запоминаем количество сайтов до
  await page.goto("/Home/MySites");
  const beforeCount = await page.locator(".lime-site-card").count();

  // Идём в Template_1 через "Использовать"
  await page.goto("/Home/Templates");
  await cards.first().locator('a:has-text("Использовать")').click();
  await page.waitForLoadState("networkidle");

  // Должны быть на Template_1
  expect(page.url()).toContain("/Template/Template_1");

  // Нажимаем "Сохранить" на шаблоне — это <a id="del" onclick="savPage()">
  // savPage() делает XHR на /Home/SavetoUser и показывает alert.
  page.on("dialog", (dialog) => {
    // Принимаем alert "200"
    dialog.accept();
  });
  await page.locator("#del").click();
  await page.waitForTimeout(2000); // дать XHR пройти

  // Идём обратно на MySites
  await page.goto("/Home/MySites");
  const afterCount = await page.locator(".lime-site-card").count();
  expect(afterCount).toBe(beforeCount + 1);

  // На последней карточке бейдж "Черновик"
  const lastCard = page.locator(".lime-site-card").last();
  await expect(lastCard.locator(".lime-badge--muted")).toContainText(/Черновик/i);
});

test("Templates filters out Custom (Id=4) (@flow)", async ({ page }) => {
  await page.goto("/Home/Templates");
  // Custom не должен быть в публичной галерее
  const names = await page.locator(".lime-tpl-card__name").allTextContents();
  expect(names).not.toContain("Custom");
});

test("ChangeName form updates site name inline (@flow)", async ({ page }) => {
  await page.goto("/Home/MySites");
  const first = page.locator(".lime-site-card").first();
  await expect(first).toBeVisible();

  const newName = `Renamed_${Date.now().toString(36).slice(-4)}`;
  await first.locator('input.lime-site-card__name').fill(newName);
  await first.locator('form[asp-action="ChangeName"], button[type="submit"][title*="имя"]').first().click();

  await page.waitForLoadState("networkidle");
  await page.goto("/Home/MySites");

  // Имя обновилось — нужно найти карточку с новым именем
  await expect(page.locator(`input.lime-site-card__name[value="${newName}"]`).first()).toBeVisible();
});
