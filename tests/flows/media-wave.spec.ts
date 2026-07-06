import { test, expect, type Page } from "@playwright/test";

/**
 * Медиа-волна (после Премиум-слоя): кастомные шрифты файлом (woff2 → @font-face),
 * санитизированный SVG и нативный Lottie-блок (.json из медиатеки, без iframe).
 * Полный путь: аплоады из редактора → publish → живая страница.
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
    // Тестовый woff2 — валидная сигнатура, но не настоящий шрифт: браузер ругается на декод.
    if (/Failed to load resource|net::ERR_|favicon|decode|OTS/i.test(text)) return;
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

// Минимальные валидные полезные нагрузки для аплоадов.
const FAKE_WOFF2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(64, 1)]);
const LOTTIE_JSON = Buffer.from(JSON.stringify({
  v: "5.5.7", fr: 30, ip: 0, op: 30, w: 100, h: 100, nm: "test", ddd: 0, assets: [],
  layers: [{ ddd: 0, ind: 1, ty: 4, nm: "sq", sr: 1, ks: { o: { a: 0, k: 100 }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 } }, shapes: [{ ty: "rc", d: 1, s: { a: 0, k: [40, 40] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } }], ip: 0, op: 30, st: 0 }],
}));
const EVIL_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">' +
  "<script>alert(2)</script><circle cx=\"5\" cy=\"5\" r=\"4\" fill=\"#84cc16\"/></svg>");

test("media wave: font upload -> @font-face, svg sanitized, lottie block live (@flow @media-wave)", async ({ page, context }) => {
  const editorErrors = watchJsErrors(page);
  const id = runId();
  const user = `media_${id}`.slice(0, 32);
  await signUpAndLogin(page, user, `${user}@test.local`);

  await page.evaluate(() => {
    localStorage.setItem("lime-onboarding-seen", "1");
    localStorage.setItem("lime-ui-level", "pro");
    localStorage.removeItem("lime-doc-draft-new");
  });

  await page.goto("/Home/EditDoc", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  // Тайлы блоков живут в сворачиваемых группах — раскрываем все, чтобы клики не били в скрытое.
  await page.evaluate(() => document.querySelectorAll("details.lime-tile-group").forEach((d) => { (d as HTMLDetailsElement).open = true; }));

  // ===== 1. Кастомный шрифт: аплоад в модалке темы → @font-face + шрифт сайта =====
  await page.locator("[data-topbar-more-toggle]").click();
  await page.locator("[data-doc-theme-open]").click();
  await expect(page.locator("#lime-doc-theme-modal")).toHaveClass(/is-open/);
  await page.locator("#lime-theme-font-file").setInputFiles({
    name: "Brand Grotesk.woff2", mimeType: "font/woff2", buffer: FAKE_WOFF2,
  });
  await expect(page.locator("#lime-theme-font-status")).toContainText("Добавлен: Brand Grotesk", { timeout: 10_000 });
  // Появился в списке и в селекте; делаем шрифтом сайта.
  await expect(page.locator('#lime-theme-font optgroup[data-custom-fonts] option')).toHaveCount(1);
  await page.locator('[data-theme-font-use="0"]').click();
  await expect(page.locator('[data-theme-font-use="0"]')).toContainText("Шрифт сайта ✓");
  await page.locator("#lime-doc-theme-modal [data-doc-theme-close]").first().click();

  // ===== 2. Lottie-блок: аплоад .json через пикер → src в блоке =====
  await page.locator('[data-doc-add="lottie"]').click();
  const lottieBlock = page.locator('.lime-block[data-block-type="lottie"]').first();
  await expect(lottieBlock).toBeVisible();
  await lottieBlock.locator("[data-doc-pick]").click();
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);
  await expect(page.locator("#lime-media-upload")).toHaveAttribute("accept", ".json");
  await page.locator("#lime-media-upload").setInputFiles({
    name: "pulse.json", mimeType: "application/json", buffer: LOTTIE_JSON,
  });
  const lottieCard = page.locator("#lime-media-grid .lime-picker-item--file");
  await expect(lottieCard.first()).toBeVisible({ timeout: 10_000 });
  await lottieCard.first().click();
  await expect(lottieBlock.locator("[data-lime-lottie]")).toBeAttached();

  // Превью-CSS редактора уже несёт @font-face (при пустом холсте <style> нет — проверяем после блока).
  const previewCss = await page.evaluate(() => document.querySelector("style[data-lime-doc-css]")?.textContent || "");
  expect(previewCss).toContain("@font-face{font-family:'Brand Grotesk'");

  // ===== 3. SVG: аплоад через пикер картинок → на диске лежит уже санитизированный файл =====
  await page.locator('[data-doc-add="image"]').click();
  const imgBlock = page.locator('.lime-block[data-block-type="image"]').first();
  await imgBlock.locator("[data-doc-pick]").click();
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);
  await expect(page.locator("#lime-media-upload")).toHaveAttribute("accept", /svg/);
  await page.locator("#lime-media-upload").setInputFiles({
    name: "logo.svg", mimeType: "image/svg+xml", buffer: EVIL_SVG,
  });
  const svgCard = page.locator('#lime-media-grid .lime-picker-item[data-url$=".svg"]');
  await expect(svgCard.first()).toBeVisible({ timeout: 10_000 });
  const svgUrl = await svgCard.first().getAttribute("data-url");
  await svgCard.first().click();
  // Скрипты и обработчики вычищены санитайзером, вектор жив; заголовок CSP на месте.
  const svgResp = await page.request.get(svgUrl!);
  expect(svgResp.status()).toBe(200);
  const svgBody = await svgResp.text();
  expect(svgBody).not.toContain("script");
  expect(svgBody).not.toContain("alert");
  expect(svgBody).not.toContain("onload");
  expect(svgBody).toContain("circle");
  expect(svgResp.headers()["content-security-policy"]).toContain("script-src 'none'");

  // ===== 4. Publish → живая страница =====
  await page.locator("[data-doc-save]").click();
  await page.waitForURL(/\/Home\/MySites/, { timeout: 15_000 });
  const publishedCard = page.locator(".lime-site").filter({
    has: page.locator('form[action="/Home/Unpublish"] input[name="idSite"]'),
  }).first();
  const publicHref = await publishedCard.locator(".lime-site__url").getAttribute("href");
  expect(publicHref).toMatch(/^\/u\/[^/]+\/[^/]+$/);

  const live = await context.newPage();
  const liveErrors = watchJsErrors(live);
  const response = await live.goto(publicHref!, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const rawHtml = (await response!.text()) as string;

  expect(rawHtml).toContain("@font-face{font-family:'Brand Grotesk'");
  expect(rawHtml).toContain("lottie_light.min.js");
  expect(rawHtml).toContain("lime-lottie.js");
  expect(rawHtml).toContain("data-lime-lottie");

  // Нативный плеер отрендерил SVG внутри стейджа (fetch JSON same-origin, CSP connect-src 'self').
  await expect(live.locator("[data-lime-lottie] svg")).toBeAttached({ timeout: 10_000 });
  // SVG-картинка блока живёт.
  await expect(live.locator(`img[src="${svgUrl}"]`)).toBeAttached();

  expect(liveErrors(), `Live page JS errors:\n${liveErrors().join("\n")}`).toHaveLength(0);
  await live.close();

  expect(editorErrors(), `Editor JS errors:\n${editorErrors().join("\n")}`).toHaveLength(0);
});
