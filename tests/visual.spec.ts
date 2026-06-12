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
  { name: "editor-new", path: "/Home/EditTemplates" },
  { name: "editor-b", path: "/Home/EditDoc" },
  { name: "community", path: "/Community/Index" },
  { name: "media", path: "/Media/Index" },
];
// editor-b и community добавлены 2026-06-11 — baseline создаётся первым
// прогоном `npx playwright test visual --update-snapshots`.

for (const p of PAGES) {
  test(`visual: ${p.name} (@visual)`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForLoadState("networkidle");

    // Стабилизация: остановить анимации, скрыть динамику
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

    await expect(page).toHaveScreenshot(`${p.name}.png`, {
      fullPage: true,
      mask: [
        // Маскируем динамические элементы (даты, счётчики)
        page.locator(".lime-stat__value"),
      ],
    });
  });
}
