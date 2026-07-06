/**
 * Visual regression — baseline скриншоты ключевых экранов.
 * Скопировать в `tests/visual.spec.ts`.
 *
 * Первый запуск: `npx playwright test visual --update-snapshots`
 * Последующие: `npx playwright test visual` — сравнение с baseline.
 */
import { test, expect } from "@playwright/test";

const PAGES = [
  { name: "landing", path: "/" },
  { name: "signin", path: "/Home/SignIn" },
  { name: "signup", path: "/Home/SignUp" },
  { name: "mysites", path: "/Home/MySites" },
  { name: "templates", path: "/Home/Templates" },
  { name: "profile", path: "/Home/Profile" },
  // Editor V2 — дефолт после раскатки; визуальные бейзлайны снимаем со старого редактора (fallback).
  { name: "editor-new", path: "/Home/EditDoc?classic=1" },
  { name: "editor-b", path: "/Home/EditDoc?classic=1" },
  { name: "community", path: "/Community/Index" },
  { name: "media", path: "/Media/Index" },
];
// editor-b и community добавлены 2026-06-11 — baseline создаётся первым
// прогоном `npx playwright test visual --update-snapshots`.

// Стабилизация: остановить анимации, скрыть динамику
async function stabilize(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      .lime-aurora::before, .lime-aurora::after { animation: none !important; }
    `,
  });
  await page.waitForTimeout(500);
}

for (const p of PAGES) {
  test(`visual: ${p.name} (@visual)`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForLoadState("networkidle");
    await stabilize(page);

    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      mask: [
        // Маскируем динамические элементы (даты, счётчики)
        page.locator(".lime-stat__value"),
      ],
    });
  });
}

// ===== Editor V2 (дефолт после раскатки) — бейзлайны нового редактора =====

// Пустой новый документ: интро-оверлей (промпт + тайлы Experience Packs).
test("visual: editor-v2-intro (@visual)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#lime-doc-intro")).toHaveClass(/is-on/);
  await stabilize(page);
  await expect(page).toHaveScreenshot("editor-v2-intro.png", { fullPage: true });
});

// V2-канвас с детерминированным контентом стартового шаблона (13 блоков, интро не показывается).
test("visual: editor-v2-canvas (@visual)", async ({ page }) => {
  await page.goto("/Home/EditDoc?template=startup");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#lime-doc-workspace .lime-block").first()).toBeVisible();
  await stabilize(page);
  await expect(page).toHaveScreenshot("editor-v2-canvas.png", { fullPage: true });
});

// Showcase Experience Pack на канвасе (Test Plan experience-builder-plan.md):
// выбор пака через интро-тайл — тот же путь, что у пользователя.
test("visual: showcase-pack-canvas (@visual)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.waitForLoadState("networkidle");
  await page.locator('[data-doc-pack="neo-lore-drop"]').click();
  await expect(page.locator("#lime-doc-workspace .lime-block").first()).toBeVisible();
  await stabilize(page);
  await expect(page).toHaveScreenshot("showcase-pack-canvas.png", { fullPage: true });
});
