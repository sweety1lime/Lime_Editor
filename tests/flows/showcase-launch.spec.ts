import { test, expect, type Page } from "@playwright/test";

const PASS = "PlaywrightLaunch1!";
const HERO_EMBED_URL = "https://www.youtube.com/embed/dQw4w9WgXcQ";

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

test("showcase launch: empty canvas -> pack -> media swap -> mobile/motion -> publish (@flow @showcase)", async ({ page, context }) => {
  const editorErrors = watchJsErrors(page);
  const id = runId();
  const user = `launch_${id}`.slice(0, 32);
  const email = `${user}@test.local`;

  await signUpAndLogin(page, user, email);

  await page.evaluate(() => {
    localStorage.setItem("lime-onboarding-seen", "1");
    localStorage.setItem("lime-ui-level", "pro");
    localStorage.removeItem("lime-doc-draft-new");
  });

  await page.goto("/Home/EditDoc", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();
  await expect(page.locator("#lime-doc-intro")).toHaveClass(/is-on/);

  await page.locator('[data-doc-pack="neo-lore-drop"]').click();
  const editorBlocks = page.locator("#lime-doc-workspace .lime-block");
  await expect(editorBlocks.first()).toBeVisible();
  expect(await editorBlocks.count()).toBeGreaterThan(8);

  const promptAnswers = ["youtube", HERO_EMBED_URL];
  page.on("dialog", async (dialog) => {
    await dialog.accept(promptAnswers.shift() || "");
  });
  const heroEmbedSwap = page.locator("#lime-doc-workspace .lime-doc-media-swap[data-doc-embed]").first();
  await heroEmbedSwap.scrollIntoViewIfNeeded();
  await heroEmbedSwap.click({ force: true });
  await expect(page.locator('#lime-doc-workspace .lime-block__embed iframe[src*="youtube.com/embed/dQw4w9WgXcQ"]').first()).toBeVisible();
  expect(promptAnswers).toHaveLength(0);

  await page.locator("[data-topbar-more-toggle]").click();
  await page.locator('[data-ui-level="motion"]').click();
  await expect(page.locator('[data-ui-level="motion"]')).toHaveClass(/is-active/);

  await page.locator('[data-doc-bp="mobile"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "mobile");

  // Одношаговая публикация: «Опубликовать» в редакторе сохраняет И публикует —
  // на MySites сайт уже живой (success-баннер + карточка с Unpublish в меню «Ещё»).
  await page.locator("[data-doc-save]").click();
  await page.waitForURL(/\/Home\/MySites/, { timeout: 15_000 });
  await expect(page.locator(".lime-alert--success")).toContainText("опубликован");

  const publishedCard = page.locator(".lime-site").filter({
    has: page.locator('form[action="/Home/Unpublish"] input[name="idSite"]'),
  }).first();
  await expect(publishedCard).toBeVisible();

  const siteId = await publishedCard.locator('form[action="/Home/Unpublish"] input[name="idSite"]').getAttribute("value");
  expect(siteId).toMatch(/^\d+$/);

  const publicHref = await publishedCard.locator(".lime-site__url").getAttribute("href");
  expect(publicHref).toMatch(/^\/u\/[^/]+\/[^/]+$/);

  const publicPage = await context.newPage();
  const publicErrors = watchJsErrors(publicPage);
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.emulateMedia({ reducedMotion: "reduce" });
  const response = await publicPage.goto(publicHref!, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await publicPage.waitForTimeout(500);

  await expect(publicPage.locator("body.lime-published")).toBeVisible();
  await expect(publicPage.locator(".lime-block").first()).toBeVisible();
  expect(await publicPage.locator(".lime-block:visible").count()).toBeGreaterThan(5);

  const heroFrame = publicPage.locator(`.lime-block__embed[data-lime-embed] iframe[src="${HERO_EMBED_URL}"]`).first();
  await expect(heroFrame).toBeAttached();
  await expect(heroFrame).toHaveAttribute("loading", "lazy");
  await expect(heroFrame).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(publicPage.locator(".lime-block__embed-fallback").first()).toBeAttached();

  const firstBlockOpacity = await publicPage.locator(".lime-block").first().evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(firstBlockOpacity).toBeGreaterThan(0.9);

  const overflow = await publicPage.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth, body.scrollWidth) - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(8);

  expect(editorErrors(), `Editor JS errors:\n${editorErrors().join("\n")}`).toHaveLength(0);
  expect(publicErrors(), `Published page JS errors:\n${publicErrors().join("\n")}`).toHaveLength(0);

  await publicPage.close();
});
