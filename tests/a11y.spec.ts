/**
 * Accessibility — axe-core injection + checkA11y на каждой странице.
 * Скопировать в `tests/a11y.spec.ts`.
 *
 * Требует: npm install -D @axe-core/playwright
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  { name: "landing", path: "/" },
  { name: "signin", path: "/Home/SignIn" },
  { name: "signup", path: "/Home/SignUp" },
  { name: "mysites", path: "/Home/MySites" },
  { name: "templates", path: "/Home/Templates" },
  { name: "profile", path: "/Home/Profile" },
  // Редактор V2 (с интро-оверлеем на пустом документе).
  { name: "editor-v2", path: "/Home/EditDoc" },
  { name: "community", path: "/Community/Index" },
  { name: "media", path: "/Media/Index" },
];

for (const p of PAGES) {
  test(`a11y: ${p.name} has no critical violations (@a11y)`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      // disable правил, которые ложно срабатывают на полупрозрачных glassmorphism-фонах
      .disableRules(["color-contrast"])
      .analyze();

    const critical = results.violations.filter((v) => v.impact === "critical");
    if (critical.length > 0) {
      console.error(`[a11y/${p.name}] critical:`, JSON.stringify(critical, null, 2));
    }

    expect(critical, `${p.name} has critical a11y violations`).toHaveLength(0);

    // Сохраним предупреждения отдельно для отчёта
    if (results.violations.length > 0) {
      console.warn(
        `[a11y/${p.name}] ${results.violations.length} violations (non-critical):`,
        results.violations.map((v) => `${v.id} (${v.impact}) — ${v.nodes.length} elements`)
      );
    }
  });
}
