/**
 * Сообщество (этап 3) — полный цикл: публикация → галерея → лайк →
 * «использовать как шаблон» → скрытие из галереи.
 *
 * Свежий юзер на ФАЙЛ (создаётся один раз в beforeAll, storageState в файл):
 * общий playwright_tester копит сайты и упирается в MaxSites free-плана (403),
 * а регистрация на каждый тест упирается в rate-limiter «auth».
 * Аноним-тест — в своём describe с пустым storageState: в @playwright/test даже
 * browser.newContext() наследует use-опции проекта — «анонимный» контекст без
 * явного override получал куки (так родился ложный баг «аноним видит Как шаблон»).
 */
import { test, expect, type Browser } from "@playwright/test";
import * as path from "path";

const PASS = "PlaywrightLaunch1!";
const STATE = path.join("test-results", ".auth-community-user.json");

async function signUpFreshUser(browser: Browser, prefix: string, statePath: string): Promise<void> {
  const user = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
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
  await ctx.storageState({ path: statePath });
  await ctx.close();
}

test.describe("community authed flow", () => {
  test.beforeAll(async ({ browser }) => {
    await signUpFreshUser(browser, "comm", STATE);
  });
  test.use({ storageState: STATE });

  test("community: publish → gallery card → like → clone → hide (@flow)", async ({ page }) => {
    // Латиница в имени: дефолтный HtmlEncoder Razor кодирует кириллицу в сущности,
    // и has-text по сырому имени её бы не нашёл.
    const name = `E2E Community ${Date.now()}`;

    // 1. Минимальный сайт на движке B. Кнопка сейва в редакторе — одношаговая
    // публикация: на MySites сайт приезжает УЖЕ опубликованным.
    await page.goto("/Home/EditDoc");
    if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
    await page.locator('[data-doc-add="cover"]').click();
    await page.locator("[data-doc-save]").click();
    await page.waitForURL(/\/Home\/MySites/);

    // 2. Переименовываем карточку (у свежего юзера она единственная), чтобы найти её в галерее.
    // На MySites карточки — .lime-site (не .lime-site-card, это класс карточек галереи).
    const firstSite = page.locator(".lime-site:not(.lime-site--new)").first();
    await firstSite.locator(".lime-site__name-input").fill(name);
    await firstSite.locator('button[title="Сохранить имя"]').click();
    await page.waitForLoadState("domcontentloaded");

    const myCard = page.locator(`.lime-site:has(.lime-site__name-input[value="${name}"])`);
    await expect(myCard).toBeVisible();
    await expect(myCard.locator(".lime-badge--success")).toContainText(/Опубликован/);

    // 3. Галерея показывает карточку с автором и ✦-бейджем движка B
    await page.goto("/Community/Index");
    const galleryCard = page.locator(`.lime-site-card:has-text("${name}")`);
    await expect(galleryCard).toBeVisible();
    await expect(galleryCard.locator(".lime-badge--accent")).toBeVisible();

    // 4. Лайк-тоггл: ♥ 0 → ♥ 1 → ♥ 0
    await galleryCard.locator('button:has-text("♥")').click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(`.lime-site-card:has-text("${name}") button:has-text("♥")`)).toContainText("♥ 1");
    await page.locator(`.lime-site-card:has-text("${name}") button:has-text("♥")`).click();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(`.lime-site-card:has-text("${name}") button:has-text("♥")`)).toContainText("♥ 0");

    // 5. «⭐ Как шаблон» клонирует сайт к себе черновиком (кастомный confirm-модал, не native dialog)
    await page.locator(`.lime-site-card:has-text("${name}") button:has-text("Как шаблон")`).click();
    await page.locator("[data-lime-confirm-submit]").click();
    await page.waitForURL(/\/Home\/MySites/);
    const cloneCard = page.locator(`.lime-site:has(.lime-site__name-input[value="${name} (копия)"])`);
    await expect(cloneCard).toBeVisible();
    // Клон — черновик: строка «не опубликован» вместо публичного URL
    await expect(cloneCard.locator(".lime-site__url--off")).toContainText(/не опубликован/);

    // 6. Скрываем оригинал из галереи (пункт в меню «Ещё») — карточка пропадает из /Community
    const origCard = page.locator(`.lime-site:has(.lime-site__name-input[value="${name}"])`);
    await origCard.locator(".lime-action-menu summary").click();
    // Карточки MySites живут под .reveal-анимацией: обычный клик вечно ждёт «стабильности»,
    // force-клик бьёт по устаревшим координатам едущего элемента. Нативный el.click()
    // через evaluate — честная активация с submit'ом формы, координаты не участвуют.
    // Ждём именно ответ ToggleGallery: waitForLoadState мгновенно резолвится на текущем
    // документе, и следующий goto обгонял POST — скрытие не успевало примениться.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/Community/ToggleGallery") && r.status() < 400),
      origCard.locator('button:has-text("Скрыть из галереи")').evaluate((b: HTMLButtonElement) => b.click()),
    ]);
    await page.waitForLoadState("domcontentloaded");

    await page.goto("/Community/Index");
    await expect(page.locator(`.lime-site-card:has-text("${name}")`)).toHaveCount(0);
  });
});

test.describe("community anonymous", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("community: gallery is reachable for anonymous visitors (@flow)", async ({ page }) => {
    await page.goto("/Community/Index");
    await expect(page.locator('a[href*="sort=popular"]')).toBeVisible();
    await expect(page.locator('button:has-text("Как шаблон")')).toHaveCount(0);
  });
});
