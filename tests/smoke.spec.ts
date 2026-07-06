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
      // Хиро-заголовок после deep-ink редизайна: <h1 class="reveal"> с градиент-спаном.
      await expect(p.locator("h1 .lime-hero__grad")).toBeVisible();
    },
  },
  {
    name: "agents",
    path: "/agents", // публичный MCP-лендинг — доступен и анониму, и залогиненному
    assert: async (p) => {
      await expect(p.locator("h1")).toContainText("AI-агент");
      await expect(p.locator('a[href="/Home/ApiTokens"]')).toBeVisible();
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
      await expect(p.locator(".lime-dash-hi")).toBeVisible();
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

// Deep-ink редизайн: продукт dark-only, тумблер темы из UI убран. Инвариант вместо
// старого «toggle persists»: тема жёстко dark и никакого тумблера в разметке нет.
test("theme is dark-only, no toggle rendered (@smoke)", async ({ page }) => {
  await page.goto("/");
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme).toEqual("dark");
  await expect(page.locator("[data-lime-theme-toggle]")).toHaveCount(0);
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
