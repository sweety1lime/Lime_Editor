import { test, expect, type Page } from "@playwright/test";

const TOP_BLOCKS = "#lime-doc-workspace .lime-doc-page > .lime-block";

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

async function openMoreMenu(page: Page): Promise<void> {
  const menu = page.locator(".lime-topbar-more__menu");
  if (await menu.isHidden()) {
    await page.locator("[data-topbar-more-toggle]").click();
  }
  await expect(menu).toBeVisible();
}

async function selectUiLevel(page: Page, level: "basic" | "design" | "motion" | "pro"): Promise<void> {
  await openMoreMenu(page);
  const button = page.locator(`[data-ui-level="${level}"]`);
  await button.click();
  await openMoreMenu(page);
  await expect(button).toHaveClass(/is-active/);
}

test("showcase progressive UI: Basic stays focused, Motion/Pro reveal advanced controls (@flow @showcase)", async ({ page }) => {
  const jsErrors = watchJsErrors(page);

  await page.addInitScript(() => {
    if (sessionStorage.getItem("lime-ui-level-cleaned")) return;
    localStorage.removeItem("lime-ui-level");
    localStorage.removeItem("lime-onboarding-seen");
    localStorage.removeItem("lime-doc-draft-new");
    sessionStorage.setItem("lime-ui-level-cleaned", "1");
  });

  await page.goto("/Home/EditDoc?classic=1&template=neo-lore-drop", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();
  await expect(page.locator(TOP_BLOCKS).first()).toBeVisible();

  await page.locator(TOP_BLOCKS).first().click({ position: { x: 24, y: 24 } });
  await expect(page.locator("#lime-doc-inspector")).toHaveAttribute("aria-hidden", "false");

  await openMoreMenu(page);
  await expect(page.locator('[data-ui-level="basic"]')).toHaveClass(/is-active/);
  await expect(page.locator("[data-doc-code-open]")).toBeHidden();
  await expect(page.locator("[data-doc-anim-preview]")).toBeHidden();
  await expect(page.locator('[data-doc-insp-tab="style"]')).toBeVisible();
  await expect(page.locator('[data-doc-insp-tab="fx"]')).toHaveCount(0);
  await expect(page.locator('[data-doc-insp-tab="motion"]')).toHaveCount(0);
  await expect(page.locator(".lime-inspector__adv")).toBeVisible();

  await selectUiLevel(page, "design");
  await expect(page.locator("[data-doc-code-open]")).toBeHidden();
  await expect(page.locator("[data-doc-anim-preview]")).toBeHidden();
  await expect(page.locator('[data-doc-insp-tab="fx"]')).toHaveCount(0);
  await expect(page.locator('[data-doc-insp-tab="motion"]')).toHaveCount(0);

  await selectUiLevel(page, "motion");
  await expect(page.locator("[data-doc-code-open]")).toBeHidden();
  await expect(page.locator("[data-doc-anim-preview]")).toBeVisible();
  await expect(page.locator('[data-doc-insp-tab="fx"]')).toBeVisible();
  await expect(page.locator('[data-doc-insp-tab="motion"]')).toBeVisible();
  await page.locator('[data-doc-insp-tab="motion"]').click();
  await expect(page.locator('[data-insp-tab="motion"]')).toBeVisible();
  await expect(page.locator(".lime-recipe-tile").first()).toBeVisible();

  await selectUiLevel(page, "pro");
  await expect(page.locator("[data-doc-code-open]")).toBeVisible();
  await expect(page.locator("[data-doc-anim-preview]")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await openMoreMenu(page);
  await expect(page.locator('[data-ui-level="pro"]')).toHaveClass(/is-active/);
  await expect(page.locator("[data-doc-code-open]")).toBeVisible();

  expect(jsErrors(), `Editor JS errors:\n${jsErrors().join("\n")}`).toHaveLength(0);
});
