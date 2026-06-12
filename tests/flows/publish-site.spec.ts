/**
 * Publish + public URL + sanitizer (authed).
 * Скопировать в `tests/flows/publish-site.spec.ts`.
 */
import { test, expect } from "@playwright/test";

test("publish → public URL renders → unpublish → 404 (@flow)", async ({ page, context }) => {
  await page.goto("/Home/MySites");

  // Найти карточку черновика (либо создать через flow в beforeAll, но тут полагаемся что
  // уже что-то создано — иначе тест зависит от create-site.spec.ts)
  let draftCard = page.locator(".lime-site-card").filter({
    has: page.locator(".lime-badge--muted"),
  }).first();

  if ((await draftCard.count()) === 0) {
    test.skip(true, "Нет черновика для публикации. Запусти create-site.spec.ts первым.");
    return;
  }

  // Публикуем
  await draftCard.locator('button:has-text("Опубликовать")').click();
  await page.waitForURL(/\/Home\/MySites/);

  // Найти ту же карточку — теперь с бейджем Опубликован и ссылкой
  const publishedCard = page.locator(".lime-site-card").filter({
    has: page.locator(".lime-badge--success"),
  }).first();
  await expect(publishedCard).toBeVisible();

  const publicLink = publishedCard.locator(".lime-site-card__url");
  const publicHref = await publicLink.getAttribute("href");
  expect(publicHref).toMatch(/^\/u\/[^/]+\/[^/]+$/);

  // Открываем публичный URL в новой странице.
  // waitUntil: "domcontentloaded" — лендинг Google Fonts может висеть и заваливать "load".
  const page2 = await context.newPage();
  await page2.goto(publicHref!, { waitUntil: "domcontentloaded" });

  // На публичной странице НЕТ редакторских кнопок
  expect(await page2.locator("#del").count()).toBe(0);
  expect(await page2.locator("#del1").count()).toBe(0);
  expect(await page2.locator('script[src*="saveTemplate.js"]').count()).toBe(0);

  // Снимаем с публикации
  await page.goto("/Home/MySites");
  const unpubBtn = publishedCard.locator('button:has-text("Снять")');
  await unpubBtn.click();
  await page.waitForURL(/\/Home\/MySites/);

  // Публичный URL теперь 404
  const res = await page2.goto(publicHref!, { waitUntil: "domcontentloaded" });
  expect(res?.status()).toBe(404);

  await page2.close();
});

test("anonymous /u/nobody/foo → 404 (@flow @anonymous)", async ({ request }) => {
  const r = await request.get("/u/no_such_user_xyz/some-slug", { failOnStatusCode: false });
  expect(r.status()).toBe(404);
});
