/**
 * Media manager flow (authed) + media-picker integration в конструкторе.
 * Скопировать в `tests/flows/media.spec.ts`.
 *
 * Фикстура: положи валидный jpg/png ~50KB в tests/fixtures/sample.png
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const FIXTURE = path.join("tests", "fixtures", "sample.png");

test.beforeAll(() => {
  if (!fs.existsSync(FIXTURE)) {
    throw new Error(
      `Missing fixture: ${FIXTURE}. Положи валидный PNG ~50KB в tests/fixtures/sample.png`
    );
  }
});

test("media: upload → grid → delete (@flow)", async ({ page }) => {
  await page.goto("/Media/Index");
  await expect(page.locator(".lime-uploader")).toBeVisible();

  // setInputFiles на скрытом input
  await page.setInputFiles('input[name="file"]', FIXTURE);
  await expect(page.locator("#media-filename")).not.toBeEmpty();
  await expect(page.locator("#media-submit")).toBeEnabled();

  await page.locator("#media-submit").click();
  await page.waitForLoadState("networkidle");

  // Картинка появилась в grid
  const cards = page.locator(".lime-media-card");
  await expect(cards.first()).toBeVisible();
  const url = await cards.first().locator("code").textContent();
  expect(url).toMatch(/\/media\/\d+\/[a-f0-9]+\.(jpg|jpeg|png|webp)/i);

  // Прямая ссылка отдаёт файл (image)
  const res = await page.request.get(url!.trim());
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\//);

  // Удаляем первую карточку
  page.on("dialog", (d) => d.accept());
  const initialCount = await cards.count();
  await cards.first().locator('button:has-text("Удалить")').click();
  await page.waitForLoadState("networkidle");
  const afterCount = await page.locator(".lime-media-card").count();
  expect(afterCount).toBe(initialCount - 1);

  // Прямая ссылка теперь 404
  const res2 = await page.request.get(url!.trim(), { failOnStatusCode: false });
  expect(res2.status()).toBe(404);
});

test("media: ApiList returns JSON for current user (@flow)", async ({ request }) => {
  const r = await request.get("/Media/ApiList");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/^application\/json/);
  const items = await r.json();
  expect(Array.isArray(items)).toBe(true);
});

test("constructor: media picker inserts image into gallery block (@flow)", async ({ page }) => {
  // Сначала загружаем хотя бы одну картинку (если её нет)
  await page.goto("/Media/Index");
  const mediaCount = await page.locator(".lime-media-card").count();
  if (mediaCount === 0) {
    await page.setInputFiles('input[name="file"]', FIXTURE);
    await page.locator("#media-submit").click();
    await page.waitForLoadState("networkidle");
  }

  // В конструктор → добавляем галерею
  await page.goto("/Home/EditDoc");
  await page.locator('[data-add-block="gallery"]').click();

  const firstSlot = page.locator(".lime-block__gallery-item").first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  // Модал открылся
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);

  // Кликаем по первому изображению
  await page.locator("#lime-media-grid .lime-picker-item").first().click();

  // Модал закрылся, в первой плитке появилось img
  await expect(page.locator("#lime-media-modal")).not.toHaveClass(/is-open/);
  await expect(firstSlot.locator("img")).toBeVisible();
});

test("media: rejects non-image (@flow)", async ({ page }) => {
  await page.goto("/Media/Index");
  // Создаём временный .txt файл
  const tmp = path.join("test-results", `fake_${Date.now()}.txt`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, "not an image");

  // accept на input — только .jpg/png/gif/webp, но обойдём через прямой setInputFiles
  await page.setInputFiles('input[name="file"]', tmp);
  // Submit может быть disabled из-за accept-фильтра; форсируем
  await page.locator("#media-submit").evaluate((b: HTMLButtonElement) => b.removeAttribute("disabled"));
  await page.locator("#media-submit").click();
  await page.waitForLoadState("networkidle");

  // Должны увидеть warning
  await expect(page.locator(".lime-alert--warn")).toBeVisible();
});
