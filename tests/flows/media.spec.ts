/**
 * Media manager flow + media-picker в конструкторе (движок B).
 *
 * Свежий юзер на ФАЙЛ (beforeAll → storageState): у него медиатека пуста, счётчики
 * детерминированы (0 → 1 → 0), нет накопления между прогонами, и нет упора в
 * rate-limiter «auth» (регистрация одна, а не на каждый тест).
 * Удаление идёт через кастомный confirm-модал ([data-lime-confirm-submit]),
 * НЕ через native dialog. Конструктор — editor-b: [data-doc-add], не легаси-селекторы
 * (классический редактор удалён).
 */
import { test, expect, type Browser } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

// sample.jpg — настоящий JPEG. (Лежащий рядом sample.png — тот же JPEG, переименованный
// в .png: сигнатурная проверка сервера его честно режет, из-за этого флоу годами был красным.)
const FIXTURE = path.join("tests", "fixtures", "sample.jpg");
const PASS = "PlaywrightLaunch1!";
const STATE = path.join("test-results", ".auth-media-user.json");

test.use({ storageState: STATE });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  if (!fs.existsSync(FIXTURE)) {
    throw new Error(`Missing fixture: ${FIXTURE}. Положи валидный JPEG ~50KB в tests/fixtures/sample.jpg`);
  }
  const user = `med_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: "https://localhost:5001", storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/Home/SignUp", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="Email"]', `${user}@test.local`);
  await page.fill('input[name="Login"]', user);
  await page.fill('input[name="Password"]', PASS);
  await page.fill("#signup-confirm", PASS);
  await page.locator('button[type="submit"]').click();
  // Регистрация уводит на SignIn («подтвердите почту») — входим сразу, confirmation не обязателен.
  if (!/\/Home\/MySites/.test(page.url())) {
    await page.waitForURL(/\/Home\/SignIn/, { timeout: 15_000 });
    await page.fill('input[name="Login"]', user);
    await page.fill('input[name="Password"]', PASS);
    await page.locator('button[type="submit"]').click();
  }
  await page.waitForURL(/\/Home\/MySites/, { timeout: 15_000 });
  await ctx.storageState({ path: STATE });
  await ctx.close();
});

test("media: upload → grid → delete (@flow)", async ({ page }) => {
  await page.goto("/Media/Index");
  await expect(page.locator(".lime-uploader")).toBeVisible();
  await expect(page.locator(".lime-media-card")).toHaveCount(0); // свежий юзер — пусто

  // setInputFiles на скрытом input
  await page.setInputFiles('input[name="file"]', FIXTURE);
  await expect(page.locator("#media-filename")).not.toBeEmpty();
  await expect(page.locator("#media-submit")).toBeEnabled();

  await page.locator("#media-submit").click();
  await page.waitForLoadState("networkidle");

  // Картинка появилась в grid — ровно одна
  const cards = page.locator(".lime-media-card");
  await expect(cards).toHaveCount(1);
  const url = await cards.first().locator("code").textContent();
  expect(url).toMatch(/\/media\/\d+\/[a-f0-9]+\.(jpg|jpeg|png|webp)/i);

  // Прямая ссылка отдаёт файл (image)
  const res = await page.request.get(url!.trim());
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\//);

  // Удаляем: форма с data-lime-confirm открывает кастомный модал — подтверждаем в нём
  await cards.first().locator('button:has-text("Удалить")').click();
  await page.locator("[data-lime-confirm-submit]").click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".lime-media-card")).toHaveCount(0);

  // Прямая ссылка теперь 404
  const res2 = await page.request.get(url!.trim(), { failOnStatusCode: false });
  expect(res2.status()).toBe(404);
});

test("media: ApiList returns JSON for current user (@flow)", async ({ page }) => {
  const r = await page.request.get("/Media/ApiList");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/^application\/json/);
  const items = await r.json();
  expect(Array.isArray(items)).toBe(true);
});

test("editor-b: media picker inserts image into gallery block (@flow)", async ({ page }) => {
  // Загружаем картинку (медиатека пуста: upload-тест выше подчистил за собой)
  await page.goto("/Media/Index");
  await page.setInputFiles('input[name="file"]', FIXTURE);
  await page.locator("#media-submit").click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".lime-media-card")).toHaveCount(1);

  // В конструктор (движок B) → добавляем галерею
  await page.goto("/Home/EditDoc");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  await page.evaluate(() => document.querySelectorAll("details.lime-tile-group").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator('[data-doc-add="gallery"]').click();

  // Пустой слот галереи открывает медиа-пикер
  const firstSlot = page.locator('.lime-block__gallery-item[data-doc-pick]').first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);

  // Кликаем по загруженной картинке
  await page.locator("#lime-media-grid .lime-picker-item").first().click();

  // Модал закрылся, в первой плитке появилось img
  await expect(page.locator("#lime-media-modal")).not.toHaveClass(/is-open/);
  await expect(page.locator(".lime-block__gallery-item img").first()).toBeVisible();
});

test("media: rejects non-image (@flow)", async ({ page }) => {
  await page.goto("/Media/Index");
  // Создаём временный .txt файл
  const tmp = path.join("test-results", `fake_${Date.now()}.txt`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, "not an image");

  // accept на input — только медиа-расширения, но обойдём через прямой setInputFiles
  await page.setInputFiles('input[name="file"]', tmp);
  // Submit может быть disabled из-за accept-фильтра; форсируем
  await page.locator("#media-submit").evaluate((b: HTMLButtonElement) => b.removeAttribute("disabled"));
  await page.locator("#media-submit").click();
  await page.waitForLoadState("networkidle");

  // Должны увидеть warning
  await expect(page.locator(".lime-alert--warn")).toBeVisible();
});
