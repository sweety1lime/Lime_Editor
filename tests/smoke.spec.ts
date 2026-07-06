/**
 * Smoke tests — каждая страница рендерится без JS-ошибок, скриншот saved.
 * Скопировать в `tests/smoke.spec.ts`.
 */
import { test, expect, type Page } from "@playwright/test";

type Screen = {
  name: string;
  path: string;
  authed?: boolean;          // нужен залогиненный — anonymous project skip-ит
  anonymousOnly?: boolean;   // только без логина — authed projects skip-ят, т.к. сервер редиректит на MySites
  // Optional assertion после goto — проверка ключевого селектора
  assert?: (page: Page) => Promise<void>;
};

const SCREENS: Screen[] = [
  {
    name: "landing",
    path: "/",
    anonymousOnly: true,
    assert: async (p) => {
      await expect(p.locator(".lime-hero__title")).toBeVisible();
    },
  },
  {
    name: "signin",
    path: "/Home/SignIn",
    anonymousOnly: true,
    assert: async (p) => {
      await expect(p.locator('input[name="Login"]')).toBeVisible();
    },
  },
  {
    name: "signup",
    path: "/Home/SignUp",
    anonymousOnly: true, // залогиненного SignUp теперь уводит на MySites (как SignIn)
    assert: async (p) => {
      await expect(p.locator('input[name="Email"]')).toBeVisible();
    },
  },
  {
    name: "mysites",
    path: "/Home/MySites",
    authed: true,
    assert: async (p) => {
      await expect(p.locator(".lime-dashboard__welcome")).toBeVisible();
    },
  },
  {
    name: "templates",
    path: "/Home/Templates",
    authed: true,
    assert: async (p) => {
      await expect(p.locator(".lime-tpl-grid, .lime-empty")).toBeVisible();
    },
  },
  {
    name: "profile",
    path: "/Home/Profile",
    authed: true,
    assert: async (p) => {
      await expect(p.locator('input[name="Email"]')).toBeVisible();
    },
  },
  {
    name: "editor-new",
    path: "/Home/EditDoc",
    authed: true,
    assert: async (p) => {
      await expect(p.locator("#lime-workspace")).toBeVisible();
      await expect(p.locator(".lime-editor__sidebar")).toBeVisible();
    },
  },
  {
    name: "media",
    path: "/Media/Index",
    authed: true,
    assert: async (p) => {
      await expect(p.locator(".lime-uploader")).toBeVisible();
    },
  },
  {
    // Редактор движка B (Трек B): JSON-документ, контейнеры, медиа-блоки, AI.
    name: "editor-b",
    path: "/Home/EditDoc",
    authed: true,
    assert: async (p) => {
      await expect(p.locator("#lime-doc-workspace")).toBeVisible();
      await expect(p.locator('[data-doc-add="container"]')).toBeVisible();
      // редизайн: вторичные действия (включая «AI заново») переехали в overflow «⋯»;
      // на виду — кнопка меню и командная палитра.
      await expect(p.locator("[data-topbar-more-toggle]")).toBeVisible();
      await expect(p.locator("[data-doc-cmdk]")).toBeVisible();
      await expect(p.locator("[data-doc-undo]")).toBeVisible();
    },
  },
  {
    // Публичная галерея сообщества (этап 3) — доступна и гостю, и залогиненному.
    name: "community",
    path: "/Community/Index",
    assert: async (p) => {
      await expect(p.locator('a[href*="sort=popular"]')).toBeVisible();
    },
  },
];

// Splits based on storageState configured in playwright.config.ts projects
test.describe("smoke", () => {
  for (const screen of SCREENS) {
    test(`renders ${screen.name} (@smoke)`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
      });

      const response = await page.goto(screen.path);
      const finalUrl = response?.url() ?? page.url();

      // Authed-страницы при anonymous-project отрендерят 302 → /Home/SignIn — пропускаем.
      if (screen.authed && finalUrl.includes("/Home/SignIn")) {
        test.skip(true, "authed screen — пропускаем в anonymous project");
        return;
      }

      // Anonymous-only страницы (landing, signin) при authed-project редиректятся на MySites — пропускаем.
      if (screen.anonymousOnly && finalUrl.includes("/Home/MySites")) {
        test.skip(true, "anonymous-only screen — пропускаем в authed project");
        return;
      }

      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);

      if (screen.assert) await screen.assert(page);

      await page.screenshot({
        path: `test-results/screenshots/${screen.name}.png`,
        fullPage: true,
      });

      expect(
        errors,
        `JS errors on ${screen.name}: ${errors.join("\n")}`
      ).toHaveLength(0);
    });
  }
});

test("theme toggle persists across reload (@smoke)", async ({ page, context }) => {
  await page.goto("/");
  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator("[data-lime-theme-toggle]").first().click();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toEqual(initial);

  const cookies = await context.cookies();
  const themeCookie = cookies.find((c) => c.name === "lime_theme");
  expect(themeCookie?.value).toEqual(after);

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  const reloaded = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(reloaded).toEqual(after);
});

test("anonymous /Home/MySites redirects to SignIn (@smoke)", async ({ page, context }) => {
  // Чистая сессия без cookie auth
  await context.clearCookies();
  const response = await page.goto("/Home/MySites", { waitUntil: "domcontentloaded" });
  expect(page.url()).toMatch(/\/Home\/SignIn/);
});

test("health endpoint returns Healthy (@smoke)", async ({ request }) => {
  const r = await request.get("/health");
  expect(r.status()).toBe(200);
  expect(await r.text()).toBe("Healthy");
});
