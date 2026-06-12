/**
 * Inspector (right panel) — applies inline styles to selected block, persist across save+reopen.
 */
import { test, expect } from "@playwright/test";

test("inspector: bg color + padding + align — apply, save, reopen, persist (@flow)", async ({ page }) => {
  await page.goto("/Home/EditTemplates");

  // Inspector в начальном состоянии — empty hint
  await expect(page.locator(".lime-editor__inspector")).toContainText(/выбери блок/i);

  // Добавляем CTA блок
  await page.locator('[data-add-block="cta"]').click();
  const ctaBlock = page.locator("#lime-workspace .lime-block").first();
  await expect(ctaBlock).toBeVisible();
  await expect(ctaBlock).toHaveClass(/is-selected/);

  // Inspector теперь должен показать controls
  await expect(page.locator(".lime-inspector__title")).toContainText(/свойства/i);

  // Применяем bg цвет через swatch (берём первый — фиолетовый #a78bfa)
  await page.locator('.lime-color-row__swatches [data-swatch="bg"][data-val="#a78bfa"]').first().click();
  await expect(ctaBlock).toHaveAttribute("style", /background.*#a78bfa|background.*rgb\(167,\s*139,\s*250\)/i);

  // Padding XL
  await page.locator('.lime-segmented [data-prop="padding"][data-val="80px"]').click();
  await expect(ctaBlock).toHaveAttribute("style", /padding.*80px/i);

  // Align right — контрол лежит в свёрнутой секции "Типографика"
  await page.locator('.lime-inspector__details:has-text("Типографика") summary').click();
  await page.locator('.lime-segmented [data-prop="textAlign"][data-val="right"]').click();
  await expect(ctaBlock).toHaveAttribute("style", /text-align.*right/i);

  // Сохраняем
  await page.locator("[data-save-action]").click();
  await page.waitForURL(/\/Home\/MySites/);

  // Открываем сайт обратно
  const lastCard = page.locator(".lime-site-card").last();
  await lastCard.locator('button:has-text("Редактировать")').click();
  await page.waitForURL(/\/Home\/EditTemplates\?siteId=/);

  // Блок должен быть на месте с теми же inline-стилями
  const reopenedBlock = page.locator("#lime-workspace .lime-block").first();
  const styleAttr = await reopenedBlock.getAttribute("style");
  expect(styleAttr).toMatch(/background.*(?:#a78bfa|rgb\(167,\s*139,\s*250\))/i);
  expect(styleAttr).toMatch(/padding.*80px/);
  expect(styleAttr).toMatch(/text-align.*right/);
});

test("inspector: reset button clears all inline styles (@flow)", async ({ page }) => {
  page.on("dialog", (d) => d.accept()); // confirm для reset

  await page.goto("/Home/EditTemplates");
  await page.locator('[data-add-block="heading"]').click();
  const block = page.locator("#lime-workspace .lime-block").first();

  // Применяем что-нибудь
  await page.locator('.lime-color-row__swatches [data-swatch="bg"][data-val="#f87171"]').first().click();
  await expect(block).toHaveAttribute("style", /background/);

  // Reset
  await page.locator('[data-inspector-action="reset"]').first().click();
  await expect(block).not.toHaveAttribute("style", /background/);
});
