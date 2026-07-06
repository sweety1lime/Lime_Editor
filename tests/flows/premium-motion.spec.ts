import { test, expect, type Page } from "@playwright/test";

/**
 * Премиум-слой (ChainZoku-волна): пак neo-lore-drop несёт theme.motion (smooth+cursor+loader),
 * split-типографику hero, grain, magnetic и WebGL-частицы. Проверяем полный путь:
 * редактор (тумблеры темы) → publish → живая страница БЕЗ reduced-motion (эффекты играют)
 * и С reduced-motion (мгновенный контент, ничего не мешает).
 */

const PASS = "PlaywrightLaunch1!";

test.use({ storageState: { cookies: [], origins: [] } });

function runId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function watchJsErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR_|favicon/i.test(text)) return;
    errors.push(`[console] ${text}`);
  });
  return () => errors;
}

async function signUpAndLogin(page: Page, user: string, email: string): Promise<void> {
  await page.goto("/Home/SignUp", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="Email"]', email);
  await page.fill('input[name="Login"]', user);
  await page.fill('input[name="Password"]', PASS);
  await page.fill("#signup-confirm", PASS);
  await page.locator('button[type="submit"]').click();

  if (!/\/Home\/MySites/.test(page.url())) {
    await page.waitForURL(/\/Home\/SignIn/, { timeout: 10_000 });
    await page.fill('input[name="Login"]', user);
    await page.fill('input[name="Password"]', PASS);
    await page.locator('button[type="submit"]').click();
  }

  await page.waitForURL(/\/Home\/MySites/, { timeout: 10_000 });
}

test("premium motion: pack theme toggles -> publish -> loader/split/cursor/particles live (@flow @premium)", async ({ page, context }) => {
  const editorErrors = watchJsErrors(page);
  const id = runId();
  const user = `prem_${id}`.slice(0, 32);

  await signUpAndLogin(page, user, `${user}@test.local`);

  await page.evaluate(() => {
    localStorage.setItem("lime-onboarding-seen", "1");
    localStorage.setItem("lime-ui-level", "pro");
    localStorage.removeItem("lime-doc-draft-new");
  });

  await page.goto("/Home/EditDoc", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();
  await page.locator('[data-doc-pack="neo-lore-drop"]').click();
  await expect(page.locator("#lime-doc-workspace .lime-block").first()).toBeVisible();

  // Тумблеры «Моушн сайта» в модалке темы отражают theme.motion пака.
  // Кнопка «Тема сайта» — пункт overflow-меню топбара «⋯».
  await page.locator("[data-topbar-more-toggle]").click();
  await page.locator("[data-doc-theme-open]").click();
  await expect(page.locator("#lime-doc-theme-modal")).toHaveClass(/is-open/);
  await expect(page.locator("#lime-theme-motion-smooth")).toBeChecked();
  await expect(page.locator("#lime-theme-motion-cursor")).toBeChecked();
  await expect(page.locator("#lime-theme-motion-loader")).toHaveValue("counter");
  await page.locator("#lime-doc-theme-modal [data-doc-theme-close]").first().click();

  // Публикация (одношаговая: сохраняет и публикует).
  await page.locator("[data-doc-save]").click();
  await page.waitForURL(/\/Home\/MySites/, { timeout: 15_000 });
  const publishedCard = page.locator(".lime-site").filter({
    has: page.locator('form[action="/Home/Unpublish"] input[name="idSite"]'),
  }).first();
  const publicHref = await publishedCard.locator(".lime-site__url").getAttribute("href");
  expect(publicHref).toMatch(/^\/u\/[^/]+\/[^/]+$/);

  // ===== Живая страница, моушн ВКЛЮЧЁН =====
  const live = await context.newPage();
  const liveErrors = watchJsErrors(live);
  const response = await live.goto(publicHref!, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const rawHtml = (await response!.text()) as string;

  // Серверная сборка: маркеры → скрипты и оверлей прелоадера в исходном HTML.
  expect(rawHtml).toContain("data-lime-smooth");
  expect(rawHtml).toContain("lenis.min.js");
  expect(rawHtml).toContain("split-type.min.js");
  expect(rawHtml).toContain("lime-webgl.js");
  expect(rawHtml).toContain("data-lime-loader-overlay");
  expect(rawHtml).toContain('data-style="counter"');

  // Прелоадер доигрывает и снимается, reveal стартует после него.
  await expect(live.locator(".lime-loader")).toHaveCount(0, { timeout: 15_000 });

  // Split-типографика: заголовок hero разбит на строки, aria-label сохранил исходный текст.
  const splitTitle = live.locator(".lime-split").first();
  await expect(splitTitle).toBeAttached({ timeout: 10_000 });
  expect(await splitTitle.locator(".line").count()).toBeGreaterThan(0);
  expect(await splitTitle.getAttribute("aria-label")).toBeTruthy();

  // Инерционный скролл: Lenis повесил классы на корень.
  await expect(live.locator("html.lenis")).toBeAttached({ timeout: 10_000 });

  // Кастомный курсор: появляется после реального движения мыши.
  await live.mouse.move(400, 300);
  await live.mouse.move(500, 400);
  await expect(live.locator("html[data-lime-cursor-on]")).toBeAttached({ timeout: 5_000 });
  await expect(live.locator(".lime-cursor-dot")).toBeVisible();

  // WebGL-частицы: слой в hero, канвас создан (headless Chrome умеет WebGL через SwiftShader).
  const particlesLayer = live.locator(".lime-block__layer--particles").first();
  await expect(particlesLayer).toBeAttached();
  await expect(particlesLayer.locator("canvas.lime-gl-canvas")).toBeAttached({ timeout: 10_000 });

  // Grain-оверлей на hero.
  await expect(live.locator(".lime-fx-grain").first()).toBeAttached();

  expect(liveErrors(), `Live page JS errors:\n${liveErrors().join("\n")}`).toHaveLength(0);
  await live.close();

  // ===== Та же страница, reduced-motion: контент виден сразу, ни лоадера, ни курсора =====
  const calm = await context.newPage();
  const calmErrors = watchJsErrors(calm);
  await calm.emulateMedia({ reducedMotion: "reduce" });
  await calm.goto(publicHref!, { waitUntil: "domcontentloaded" });
  await calm.waitForTimeout(600);

  await expect(calm.locator(".lime-block").first()).toBeVisible();
  const firstOpacity = await calm.locator(".lime-block").first().evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(firstOpacity).toBeGreaterThan(0.9);
  // Шторка скрыта CSS'ом мгновенно (display:none) — контент не заперт.
  await expect(calm.locator(".lime-loader:visible")).toHaveCount(0);
  await calm.mouse.move(300, 300);
  await calm.waitForTimeout(200);
  await expect(calm.locator("html[data-lime-cursor-on]")).toHaveCount(0);
  // Заголовок не разбит: split не активируется при reduce.
  await expect(calm.locator(".lime-split")).toHaveCount(0);

  expect(calmErrors(), `Reduced-motion page JS errors:\n${calmErrors().join("\n")}`).toHaveLength(0);
  await calm.close();

  expect(editorErrors(), `Editor JS errors:\n${editorErrors().join("\n")}`).toHaveLength(0);
});
