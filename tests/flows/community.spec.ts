/**
 * Сообщество (этап 3) — полный цикл: публикация → галерея → лайк →
 * «использовать как шаблон» → скрытие из галереи (authed).
 */
import { test, expect } from "@playwright/test";

test("community: publish → gallery card → like → clone → hide (@flow)", async ({ page }) => {
  // Латиница в имени: дефолтный HtmlEncoder Razor кодирует кириллицу в сущности,
  // и has-text по сырому имени её бы не нашёл.
  const name = `E2E Community ${Date.now()}`;

  // 1. Минимальный сайт на движке B
  await page.goto("/Home/EditDoc");
  await page.locator('[data-doc-add="cover"]').click();
  await page.locator("[data-doc-save]").click();
  await page.waitForURL(/\/Home\/MySites/);

  // 2. Переименовываем последнюю карточку, чтобы найти её в галерее
  const lastCard = page.locator(".lime-site-card").last();
  await lastCard.locator('input[name="site"]').fill(name);
  await lastCard.locator('button[title="Сохранить имя"]').click();
  await page.waitForLoadState("domcontentloaded");

  const myCard = page.locator(`.lime-site-card:has(input[value="${name}"])`);
  await expect(myCard).toBeVisible();

  // 3. Публикуем — сайт автоматически попадает в галерею
  await myCard.locator('button:has-text("Опубликовать")').click();
  await page.waitForLoadState("domcontentloaded");
  await expect(myCard.locator(".lime-badge--success")).toContainText(/Опубликован/);
  await expect(myCard.locator('button:has-text("В галерее")')).toBeVisible();

  // 4. Галерея показывает карточку с автором и ✦-бейджем движка B
  await page.goto("/Community/Index");
  const galleryCard = page.locator(`.lime-site-card:has-text("${name}")`);
  await expect(galleryCard).toBeVisible();
  await expect(galleryCard.locator(".lime-badge--accent")).toBeVisible();

  // 5. Лайк-тоггл: ♥ 0 → ♥ 1 → ♥ 0
  await galleryCard.locator('button:has-text("♥")').click();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(`.lime-site-card:has-text("${name}") button:has-text("♥")`)).toContainText("♥ 1");
  await page.locator(`.lime-site-card:has-text("${name}") button:has-text("♥")`).click();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(`.lime-site-card:has-text("${name}") button:has-text("♥")`)).toContainText("♥ 0");

  // 6. «⭐ Как шаблон» клонирует сайт к себе черновиком
  page.on("dialog", (d) => d.accept());
  await page.locator(`.lime-site-card:has-text("${name}") button:has-text("Как шаблон")`).click();
  await page.waitForURL(/\/Home\/MySites/);
  await expect(page.locator(`.lime-site-card:has(input[value="${name} (копия)"])`)).toBeVisible();
  // Клон — черновик, не опубликован
  await expect(
    page.locator(`.lime-site-card:has(input[value="${name} (копия)"]) .lime-badge--muted`)
  ).toContainText(/Черновик/);

  // 7. Скрываем оригинал из галереи — карточка пропадает из /Community
  await page.locator(`.lime-site-card:has(input[value="${name}"]) button:has-text("В галерее")`).click();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(`.lime-site-card:has(input[value="${name}"]) button:has-text("Скрыт")`)).toBeVisible();

  await page.goto("/Community/Index");
  await expect(page.locator(`.lime-site-card:has-text("${name}")`)).toHaveCount(0);
});

test("community: gallery is reachable for anonymous visitors (@flow)", async ({ browser }) => {
  // Свежий контекст без auth-куки — галерея публичная, лайк-кнопок нет.
  // baseURL указываем явно: browser.newContext() не наследует use.baseURL из конфига.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: "https://localhost:5001" });
  const page = await context.newPage();
  await page.goto("/Community/Index");
  await expect(page.locator('a[href*="sort=popular"]')).toBeVisible();
  await expect(page.locator('button:has-text("Как шаблон")')).toHaveCount(0);
  await context.close();
});
