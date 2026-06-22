/**
 * Движок B (Трек B) — критичный путь нового редактора (authed).
 * Покрывает: добавление блоков, вложенность в контейнер, undo, грипы DnD,
 * AI-модалку, сохранение и переоткрытие через «✦ Движок B».
 */
import { test, expect } from "@playwright/test";

const topBlocks = "#lime-doc-workspace .lime-doc-page > .lime-block";
const nestedBlocks = "#lime-doc-workspace .lime-block .lime-block";

test("editor-v2 D2: command flag keeps structural and checkpoint history coherent (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?cmd=1");
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();

  // Структурные правки уже идут точечными командами.
  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(2);

  const firstId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const secondId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();

  await page.locator(`[data-doc-layer="${firstId}"]`).click();
  await page.locator('[data-doc-op="down"]').click();
  await expect(page.locator(topBlocks).nth(0)).toHaveAttribute("data-block-id", secondId!);
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(topBlocks).nth(0)).toHaveAttribute("data-block-id", firstId!);
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(topBlocks).nth(0)).toHaveAttribute("data-block-id", secondId!);

  await page.locator(`[data-doc-layer="${firstId}"]`).click();
  await page.locator('[data-doc-op="dup"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(3);
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(2);
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Inline-текст коммитится debounce-транзакцией: сколько угодно input → один undo.
  const editable = page.locator(`${topBlocks} [contenteditable][data-field]`).first();
  const originalText = await editable.textContent();
  await editable.fill("Текст через смешанную историю");
  await page.waitForTimeout(700); // commit inline-транзакции

  // Content-флаг колонок — ещё одна точечная команда.
  await page.locator('[data-doc-add="columns"]').click();
  const columnsId = await page.locator(topBlocks).last().getAttribute("data-block-id");
  await page.locator('[data-doc-cols="3"]').click();
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).toHaveAttribute("data-cols", "3");

  // Sticky и parallax-range уже top-level op/gesture-команды.
  await page.locator('[data-doc-insp-tab="motion"]').click();
  await page.locator('[data-doc-sticky="1"]').click();
  await expect(page.locator(`[data-block-id="${columnsId}"][data-sticky]`)).toHaveCount(1);
  await page.locator('[data-doc-motion="parallax"]').fill("0.4");
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).toHaveAttribute("data-parallax", "0.4");
  await page.waitForTimeout(500); // parallax — debounce-жест (400мс): ждём коммита в историю до следующего шага

  // Overlay — content gesture-команда.
  await page.locator('[data-doc-insp-tab="style"]').click();
  await page.locator('[data-doc-overlay="alpha"]').fill("0.4");
  await expect(page.locator(`[data-block-id="${columnsId}"] .lime-block__overlay`)).toHaveCount(1);

  // Reusable class пока остаётся state-checkpoint. Создаём его внутри открытого overlay-debounce окна:
  // document-level boundary обязан сначала закоммитить gesture, сохранив хронологию mixed history.
  page.once("dialog", dialog => dialog.accept("D2 smoke class"));
  await page.locator('[data-doc-class-new]').click();
  const classWithReusable = await page.locator(`[data-block-id="${columnsId}"]`).getAttribute("class");
  const reusableClass = classWithReusable?.split(/\s+/).find(c => c.startsWith("lime-c-"));
  expect(reusableClass).toBeTruthy();
  // columns — контейнер: при выбранном контейнере блок из сайдбара добавляется ВНУТРЬ него.
  // Снимаем выбор, чтобы следующая вставка была top-level op-командой (иначе остаётся 4).
  await page.keyboard.press("Escape");
  await page.locator('[data-doc-add="text"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(5);

  await page.locator("[data-doc-undo]").click(); // op: insertBlock
  await expect(page.locator(topBlocks)).toHaveCount(4);
  await page.locator("[data-doc-undo]").click(); // state: reusable class
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).not.toHaveClass(new RegExp(`\\b${reusableClass}\\b`));
  await page.locator("[data-doc-undo]").click(); // op gesture: overlay
  await expect(page.locator(`[data-block-id="${columnsId}"] .lime-block__overlay`)).toHaveCount(0);
  await page.locator("[data-doc-undo]").click(); // op gesture: parallax range
  await expect(page.locator(`[data-block-id="${columnsId}"][data-parallax]`)).toHaveCount(0);
  await page.locator("[data-doc-undo]").click(); // op: sticky
  await expect(page.locator(`[data-block-id="${columnsId}"][data-sticky]`)).toHaveCount(0);
  await page.locator("[data-doc-undo]").click(); // op: columns 2 → 3
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).toHaveAttribute("data-cols", "2");
  await page.locator("[data-doc-undo]").click(); // op: insert columns
  await expect(page.locator(topBlocks)).toHaveCount(3);
  await page.locator("[data-doc-undo]").click(); // op transaction: inline edit
  await expect(page.locator(`${topBlocks} [contenteditable][data-field]`).first()).toHaveText(originalText || "");
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(`${topBlocks} [contenteditable][data-field]`).first()).toHaveText("Текст через смешанную историю");
  await page.locator("[data-doc-redo]").click();
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).toHaveAttribute("data-cols", "3");
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(`[data-block-id="${columnsId}"][data-sticky]`)).toHaveCount(1);
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).toHaveAttribute("data-parallax", "0.4");
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(`[data-block-id="${columnsId}"] .lime-block__overlay`)).toHaveCount(1);
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(`[data-block-id="${columnsId}"]`)).toHaveClass(new RegExp(`\\b${reusableClass}\\b`));
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(5);
});

test("editor-v2 Stage 2: canvas flag enables zoom and Space-pan without document mutation (@flow)", async ({ page }) => {
  // Канвас не клипается и тянется выше 900px — берём высокий вьюпорт, чтобы блоки/оверлей были на экране.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1");
  await expect(page.locator("[data-canvas-controls]")).toBeVisible();
  await expect(page.locator(".lime-editor__canvas")).toHaveClass(/is-v2-viewport/);
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator("[data-canvas-zoom-label]").click();
  await expect(page.locator("[data-canvas-zoom-label]")).toHaveText("100%");
  const before = await page.evaluate(() => (window as any).__LIME_VIEWPORT__.get());

  const stage = page.locator("#lime-canvas-viewport");
  const box = await stage.boundingBox();
  expect(box).toBeTruthy();
  // Канвас тянется за пределы вьюпорта (его top бывает < 0), поэтому box.y+200 может уйти за
  // экран — Playwright тогда не доставит мышь, и pan не стартует. Берём заведомо видимую точку.
  const px = box!.x + 200;
  const py = 220;
  await page.keyboard.down("Space");
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 60, py + 35, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  const after = await page.evaluate(() => (window as any).__LIME_VIEWPORT__.get());
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(35, 0);
  expect(after.zoom).toBe(before.zoom);

  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  const canvasBlocks = page.locator(topBlocks);
  await canvasBlocks.nth(0).click({ position: { x: 12, y: 12 } });
  await expect(page.locator("[data-selection-id]")).toHaveCount(1);
  await canvasBlocks.nth(1).click({ position: { x: 12, y: 12 }, modifiers: ["Shift"] });
  await expect(page.locator("[data-selection-id]")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-selection-id]")).toHaveCount(0);
});

test("editor-v2 Stage 3: layers control node name, lock, visibility and z-order (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const block = page.locator(topBlocks).last();
  const id = await block.getAttribute("data-block-id");
  expect(id).toBeTruthy();
  const row = page.locator(`[data-doc-layer="${id}"]`);
  await expect(row.locator("[data-node-toggle-hidden]"), "canvas layers expose node controls").toBeVisible();

  page.once("dialog", dialog => dialog.accept("Hero title"));
  await row.locator("[data-node-rename]").click();
  await expect(row.locator(".lime-doc-layer__name")).toHaveText("Hero title");

  await row.locator("[data-node-toggle-locked]").click();
  await expect(block).toHaveAttribute("data-node-locked", "1");
  await expect(block.locator(".lime-block-grip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const lockedBox = await block.boundingBox();
  expect(lockedBox).toBeTruthy();
  await page.mouse.click(lockedBox!.x + 12, lockedBox!.y + 12);
  await expect(page.locator("[data-selection-id]"), "locked node is skipped by canvas hit-test").toHaveCount(0);
  await row.locator(".lime-doc-layer__name").click();
  await expect(page.locator(`[data-selection-id="${id}"]`), "locked node remains selectable from layers").toHaveCount(1);

  await row.locator('[data-node-z="1"]').click();
  await row.locator('[data-node-z="1"]').click();
  await expect(row.locator(".lime-doc-layer__z")).toHaveText("2");
  await expect(block).toHaveCSS("z-index", "2");

  await row.locator("[data-node-toggle-hidden]").click();
  await expect(block).toHaveAttribute("hidden", "");
  await expect(row).toHaveClass(/is-node-hidden/);

  await page.locator("[data-doc-undo]").click(); // visibility
  await expect(block).not.toHaveAttribute("hidden", "");
  await page.locator("[data-doc-undo]").click(); // z: 2 → 1
  await expect(row.locator(".lime-doc-layer__z")).toHaveText("1");
  await page.locator("[data-doc-undo]").click(); // z: 1 → inherited 0
  await expect(row.locator(".lime-doc-layer__z")).toHaveText("0");
  await page.locator("[data-doc-undo]").click(); // unlock
  await expect(block).not.toHaveAttribute("data-node-locked", "1");
  await expect(block.locator(".lime-block-grip")).toHaveCount(1);
  await page.locator("[data-doc-undo]").click(); // rename
  await expect(row.locator(".lime-doc-layer__name")).toHaveText("Заголовок");
});

test("editor-v2 Stage 3: rotate handle and resize snapping commit one frame (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  await page.locator('[data-doc-add="heading"]').click();
  const first = container.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block").first();
  const firstId = await first.getAttribute("data-block-id");
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-add="text"]').click();
  const second = container.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block").nth(1);
  const secondId = await second.getAttribute("data-block-id");
  expect(containerId && firstId && secondId).toBeTruthy();

  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-v2-layout-mode="free"]').click();

  // Rotate from the north handle to the east side of the frame: +90°.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), firstId);
  const rotate = await page.locator("[data-rotate-handle]").boundingBox();
  const firstBeforeRotate = await first.boundingBox();
  expect(rotate && firstBeforeRotate).toBeTruthy();
  const centerX = firstBeforeRotate!.x + firstBeforeRotate!.width / 2;
  const centerY = firstBeforeRotate!.y + firstBeforeRotate!.height / 2;
  await page.mouse.move(rotate!.x + rotate!.width / 2, rotate!.y + rotate!.height / 2);
  await page.mouse.down();
  await page.mouse.move(centerX + firstBeforeRotate!.width / 2 + 30, centerY, { steps: 20 });
  await page.mouse.up();
  await expect(first).not.toHaveCSS("transform", "none");
  await page.locator("[data-doc-undo]").click();
  await expect(first).toHaveCSS("transform", "none");

  // Move sibling aside, then resize first edge within snap threshold of sibling.left.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), secondId);
  const move = await page.locator("[data-move-handle]").boundingBox();
  expect(move).toBeTruthy();
  await page.keyboard.down("Alt");
  await page.mouse.move(move!.x + move!.width / 2, move!.y + move!.height / 2);
  await page.mouse.down();
  await page.mouse.move(move!.x + move!.width / 2 + 220, move!.y + move!.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const target = await second.boundingBox();
  expect(target).toBeTruthy();

  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), firstId);
  const beforeResize = await first.boundingBox();
  const east = await page.locator('[data-handle="e"]').boundingBox();
  expect(beforeResize && east).toBeTruthy();
  await page.mouse.move(east!.x + east!.width / 2, east!.y + east!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x - 2, east!.y + east!.height / 2, { steps: 20 });
  await expect(page.locator("[data-selection-guides] .lime-snap-guide.is-x")).toHaveCount(1);
  await page.mouse.up();
  const snapped = await first.boundingBox();
  expect(snapped).toBeTruthy();
  expect(snapped!.x + snapped!.width).toBeCloseTo(target!.x, 0);
  await page.locator("[data-doc-undo]").click();
  const restored = await first.boundingBox();
  expect(restored!.width).toBeCloseTo(beforeResize!.width, 0);

  const perf = await page.evaluate(() => {
    const all = (window as any).__LIME_V2_PERF__;
    const summarize = (values: number[]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return { samples: sorted.length, p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0 };
    };
    return { rotate: summarize(all.rotate), resize: summarize(all.resize) };
  });
  expect(perf.rotate.samples).toBeGreaterThanOrEqual(10);
  expect(perf.resize.samples).toBeGreaterThanOrEqual(10);
  expect(perf.rotate.p95, "rotate pointermove p95 budget").toBeLessThanOrEqual(16);
  expect(perf.resize.p95, "resize pointermove p95 budget").toBeLessThanOrEqual(16);
});

test("editor-v2 Stage 3: layout inspector converts stack to free atomically (@flow)", async ({ page }) => {
  // Канвас не клипается и тянется выше 900px — высокий вьюпорт держит нижние resize-хэндлы группы
  // на экране (иначе Playwright не доставит туда мышь), не трогая авто-fit и геометрию move.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  await page.locator('[data-doc-add="heading"]').click(); // selected container receives the child
  const child = container.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block").first();
  const childId = await child.getAttribute("data-block-id");
  expect(childId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-add="text"]').click();
  const secondChild = container.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block").nth(1);
  const secondChildId = await secondChild.getAttribute("data-block-id");
  expect(secondChildId).toBeTruthy();

  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await expect(page.locator('[data-v2-layout-mode="stack"]')).toBeVisible();
  await page.locator('[data-v2-layout-mode="free"]').click();
  await expect(child).toHaveCSS("position", "absolute");

  await page.evaluate(ids => (window as any).__LIME_SELECTION__.replace(ids), [childId, secondChildId]);
  await expect(page.locator("[data-move-handle]")).toBeVisible();
  await expect(page.locator('[data-v2-design-field="frame"]')).toHaveCount(4);

  const beforeFirst = await child.boundingBox();
  const beforeSecond = await secondChild.boundingBox();
  const handle = await page.locator("[data-move-handle]").boundingBox();
  expect(beforeFirst && beforeSecond && handle).toBeTruthy();
  await page.keyboard.down("Alt"); // deterministic move without sibling snapping
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 40, handle!.y + handle!.height / 2 + 20, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const movedFirst = await child.boundingBox();
  const movedSecond = await secondChild.boundingBox();
  expect(movedFirst!.x - beforeFirst!.x).toBeCloseTo(40, 0);
  expect(movedSecond!.x - beforeSecond!.x).toBeCloseTo(40, 0);

  await page.locator("[data-doc-undo]").click(); // one transaction restores both selected frames
  const restoredFirst = await child.boundingBox();
  const restoredSecond = await secondChild.boundingBox();
  expect(restoredFirst!.x).toBeCloseTo(beforeFirst!.x, 0);
  expect(restoredSecond!.x).toBeCloseTo(beforeSecond!.x, 0);

  const resizeHandle = await page.locator('[data-selection-group] [data-handle="se"]').boundingBox();
  expect(resizeHandle).toBeTruthy();
  await page.mouse.move(resizeHandle!.x + resizeHandle!.width / 2, resizeHandle!.y + resizeHandle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeHandle!.x + resizeHandle!.width / 2 + 50, resizeHandle!.y + resizeHandle!.height / 2 + 30, { steps: 3 });
  await page.mouse.up();
  const resizedFirst = await child.boundingBox();
  const resizedSecond = await secondChild.boundingBox();
  expect(resizedFirst!.width).toBeGreaterThan(beforeFirst!.width);
  expect(resizedSecond!.width).toBeGreaterThan(beforeSecond!.width);

  await page.locator("[data-doc-undo]").click(); // group resize is also one transaction
  const unscaledFirst = await child.boundingBox();
  const unscaledSecond = await secondChild.boundingBox();
  expect(unscaledFirst!.width).toBeCloseTo(beforeFirst!.width, 0);
  expect(unscaledSecond!.width).toBeCloseTo(beforeSecond!.width, 0);

  const keyboardZoom = await page.evaluate(() => (window as any).__LIME_VIEWPORT__.get().zoom);
  await page.keyboard.press("Shift+ArrowRight");
  const nudgedFirst = await child.boundingBox();
  const nudgedSecond = await secondChild.boundingBox();
  expect(nudgedFirst!.x - beforeFirst!.x).toBeCloseTo(10 * keyboardZoom, 0);
  expect(nudgedSecond!.x - beforeSecond!.x).toBeCloseTo(10 * keyboardZoom, 0);
  await page.locator("[data-doc-undo]").click();

  await page.keyboard.press("Control+Shift+ArrowRight");
  const keyboardResizedFirst = await child.boundingBox();
  const keyboardResizedSecond = await secondChild.boundingBox();
  expect(keyboardResizedFirst!.width).toBeGreaterThan(beforeFirst!.width);
  expect(keyboardResizedSecond!.width).toBeGreaterThan(beforeSecond!.width);
  await page.locator("[data-doc-undo]").click();

  await page.locator("[data-doc-undo]").click(); // the whole conversion is one command transaction
  await expect(child).not.toHaveCSS("position", "absolute");
});

test("editor-v2 Stage 4: stack inspector controls layout and responsive override (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  await page.locator('[data-doc-add="heading"]').click();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-add="text"]').click();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);

  const children = container.locator(":scope > .lime-block__inner > .lime-block__children");
  const field = (path: string) => page.locator(`[data-v2-design-field="layout"][data-v2-design-path="${path}"]`);
  const setNumber = async (path: string, value: number) => {
    const input = field(path);
    await input.fill(String(value));
    await input.press("Tab");
  };

  await page.locator('[data-v2-layout-direction="horizontal"]').click();
  await field("align").selectOption("center");
  await field("justify").selectOption("space-between");
  await page.locator('[data-v2-layout-wrap="1"]').click();
  await setNumber("gap", 24);
  await setNumber("padding.top", 8);
  await setNumber("padding.right", 16);
  await setNumber("padding.bottom", 12);
  await setNumber("padding.left", 20);

  await expect(children).toHaveCSS("flex-direction", "row");
  await expect(children).toHaveCSS("align-items", "center");
  await expect(children).toHaveCSS("justify-content", "space-between");
  await expect(children).toHaveCSS("flex-wrap", "wrap");
  await expect(children).toHaveCSS("gap", "24px");
  await expect(children).toHaveCSS("padding-top", "8px");
  await expect(children).toHaveCSS("padding-right", "16px");
  await expect(children).toHaveCSS("padding-bottom", "12px");
  await expect(children).toHaveCSS("padding-left", "20px");

  const firstStackChild = children.locator(":scope > .lime-block").first();
  const firstStackChildId = await firstStackChild.getAttribute("data-block-id");
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), firstStackChildId);
  const orderInput = page.locator('[data-v2-child-field="order"]');
  await orderInput.fill("2");
  await orderInput.press("Tab");
  const maxWidthInput = page.locator('[data-v2-design-field="size"][data-v2-design-path="width.max"]');
  await maxWidthInput.fill("420");
  await maxWidthInput.press("Tab");
  await expect(firstStackChild).toHaveCSS("order", "2");
  await expect(firstStackChild).toHaveCSS("max-width", "420px");

  await page.locator("[data-doc-undo]").click();
  await expect(firstStackChild).toHaveCSS("max-width", "none");
  await page.locator("[data-doc-redo]").click();
  await expect(firstStackChild).toHaveCSS("max-width", "420px");

  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-bp="mobile"]').click();
  await page.locator('[data-v2-layout-direction="vertical"]').click();
  await expect(children).toHaveCSS("flex-direction", "column");
  await page.locator('[data-v2-design-reset="layout"]').click();
  await expect(children).toHaveCSS("flex-direction", "row");
});

test("editor-v2 Stage 4: grid inspector controls columns, child span and auto (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  await page.locator('[data-doc-add="heading"]').click();
  const firstChild = container.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block").first();
  const firstChildId = await firstChild.getAttribute("data-block-id");
  expect(firstChildId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-add="text"]').click();

  const children = container.locator(":scope > .lime-block__inner > .lime-block__children");

  // Контейнер → grid, фиксированные 3 колонки.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-v2-layout-mode="grid"]').click();
  await expect(children).toHaveCSS("display", "grid");
  const colInput = page.locator('[data-v2-design-field="layout"][data-v2-design-path="columns"]');
  await colInput.fill("3");
  await colInput.press("Tab");
  const tracks = await children.evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
  expect(tracks).toBe(3);
  const autoRowsInput = page.locator('[data-v2-design-field="layout"][data-v2-design-path="autoRows"]');
  await autoRowsInput.fill("80");
  await autoRowsInput.press("Tab");
  await expect(children).toHaveCSS("grid-auto-rows", "80px");

  // Ребёнок grid: span 2 по колонкам и строкам.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), firstChildId);
  const spanInput = page.locator('[data-v2-child-field="span"]');
  const rowSpanInput = page.locator('[data-v2-child-field="rowSpan"]');
  await expect(spanInput).toBeVisible();
  await spanInput.fill("2");
  await spanInput.press("Tab");
  await rowSpanInput.fill("2");
  await rowSpanInput.press("Tab");
  await expect(firstChild).toHaveCSS("grid-column-start", "span 2");
  await expect(firstChild).toHaveCSS("grid-row-start", "span 2");

  // Два обычных поля — две команды; возвращаемся к 1×1 перед canvas-жестом.
  await page.locator("[data-doc-undo]").click();
  await expect(firstChild).not.toHaveCSS("grid-row-start", "span 2");
  await page.locator("[data-doc-undo]").click();
  await expect(firstChild).not.toHaveCSS("grid-column-start", "span 2");

  // Canvas handle меняет оба span одной атомарной транзакцией.
  const spanHandle = page.locator("[data-grid-span-handle]");
  await expect(spanHandle).toBeVisible();
  const handleBox = await spanHandle.boundingBox();
  const gridBox = await children.boundingBox();
  expect(handleBox && gridBox).toBeTruthy();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + gridBox!.width / 3 + 8, handleBox!.y + handleBox!.height / 2 + 90, { steps: 4 });
  await page.mouse.up();
  await expect(firstChild).toHaveCSS("grid-column-start", "span 2");
  await expect(firstChild).toHaveCSS("grid-row-start", "span 2");
  await page.locator("[data-doc-undo]").click();
  await expect(firstChild).not.toHaveCSS("grid-column-start", "span 2");
  await expect(firstChild).not.toHaveCSS("grid-row-start", "span 2");

  // Авто-колонки: переключение показывает auto-fit/fill и сохраняет grid.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-v2-grid-auto="1"]').click();
  await expect(page.locator('[data-v2-grid-fill="1"]')).toBeVisible();
  await expect(children).toHaveCSS("display", "grid");
  await page.locator('[data-v2-grid-fill="1"]').click();
  await expect(page.locator('[data-v2-grid-fill="1"]')).toHaveClass(/is-active/);
});

test("editor-v2 Stage 5: multi-select applies style to all and shows mixed (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  const blocks = page.locator(topBlocks);
  const firstId = await blocks.nth(0).getAttribute("data-block-id");
  const secondId = await blocks.nth(1).getAttribute("data-block-id");
  expect(firstId && secondId).toBeTruthy();
  const first = page.locator(`[data-block-id="${firstId}"]`);
  const second = page.locator(`[data-block-id="${secondId}"]`);
  const radius = () => page.locator('[data-doc-style="borderRadius"]');
  const setRadius = (v: number) => radius().evaluate((el, val) => {
    (el as HTMLInputElement).value = String(val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);

  // Только первый блок: радиус 24 — второй не меняется.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), firstId);
  await setRadius(24);
  await expect(first).toHaveCSS("border-top-left-radius", "24px");
  await expect(second).toHaveCSS("border-top-left-radius", "0px");
  await page.waitForTimeout(500); // коммит gesture-транзакции

  // Мульти-выбор обоих: баннер виден, радиус явно помечен как «Разные».
  await page.evaluate(ids => (window as any).__LIME_SELECTION__.replace(ids), [firstId, secondId]);
  await expect(page.locator("[data-multi-select]")).toBeVisible();
  await expect(radius()).toHaveAttribute("data-mixed", "true");
  await expect(radius().locator("xpath=..").locator(".lime-range__val")).toHaveText("Разные");

  // Правка радиуса на мульти-выборе → меняются ОБА.
  await setRadius(40);
  await expect(radius()).not.toHaveAttribute("data-mixed", "true");
  await expect(first).toHaveCSS("border-top-left-radius", "40px");
  await expect(second).toHaveCSS("border-top-left-radius", "40px");
  await page.waitForTimeout(500); // коммит

  // Один undo откатывает обе правки сразу (одна транзакция): первый → 24, второй → 0.
  await page.locator("[data-doc-undo]").click();
  await expect(first).toHaveCSS("border-top-left-radius", "24px");
  await expect(second).toHaveCSS("border-top-left-radius", "0px");
});

test("editor-v2 Stage 5: component multi-select uses one checkpoint (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  page.once("dialog", dialog => dialog.accept("Shared heading"));
  await page.locator('[data-doc-op="comp"]').click();
  await expect(page.locator("#lime-doc-components [data-doc-insert-comp]")).toHaveCount(1);

  const blocks = page.locator(topBlocks);
  const firstComponentId = await blocks.nth(0).getAttribute("data-block-id");
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();
  await page.locator('[data-doc-add="text"]').click();
  await expect(blocks).toHaveCount(3);

  const secondComponentId = await blocks.nth(1).getAttribute("data-block-id");
  const textId = await blocks.nth(2).getAttribute("data-block-id");
  expect(firstComponentId && secondComponentId && textId).toBeTruthy();
  const firstComponent = page.locator(`[data-block-id="${firstComponentId}"]`);
  const secondComponent = page.locator(`[data-block-id="${secondComponentId}"]`);
  const text = page.locator(`[data-block-id="${textId}"]`);

  await page.evaluate(ids => (window as any).__LIME_SELECTION__.replace(ids), [firstComponentId, textId]);
  const radius = page.locator('[data-doc-style="borderRadius"]');
  await radius.evaluate(el => {
    (el as HTMLInputElement).value = "36";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(firstComponent).toHaveCSS("border-top-left-radius", "36px");
  await expect(secondComponent).toHaveCSS("border-top-left-radius", "36px");
  await expect(text).toHaveCSS("border-top-left-radius", "36px");

  await page.locator("[data-doc-undo]").click();
  await expect(firstComponent).toHaveCSS("border-top-left-radius", "0px");
  await expect(secondComponent).toHaveCSS("border-top-left-radius", "0px");
  await expect(text).toHaveCSS("border-top-left-radius", "0px");
});

test("editor-b: blocks + container nesting + undo + save/reopen (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await expect(page.locator("#lime-doc-workspace")).toBeVisible();
  await expect(page.locator(".lime-workspace__placeholder")).toBeVisible();

  // Три блока верхнего уровня
  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  await page.locator('[data-doc-add="container"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Контейнер выбран → следующий блок добавляется ВНУТРЬ него
  await expect(page.locator(".lime-doc-comp-banner")).toContainText(/Контейнер выбран/);
  await page.locator('[data-doc-add="text"]').click();
  await expect(page.locator(nestedBlocks)).toHaveCount(1);
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Undo откатывает вложенный блок (кнопка ↶, этап 0.4)
  await expect(page.locator("[data-doc-undo]")).toBeEnabled();
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(nestedBlocks)).toHaveCount(0);
  await expect(page.locator(topBlocks)).toHaveCount(3);

  // Грипы drag-and-drop отрендерены у блоков (display:none до hover — проверяем наличие в DOM)
  expect(await page.locator("#lime-doc-workspace .lime-block-grip").count()).toBeGreaterThanOrEqual(3);

  // Пустой контейнер показывает подсказку-дропзону
  await expect(page.locator(".lime-doc-drop-hint")).toBeVisible();

  // Сохраняем (новый сайт) → MySites
  await page.locator("[data-doc-save]").click();
  await page.waitForURL(/\/Home\/MySites/);

  // Последняя карточка — наш сайт движка B, открываем через «✦ Движок B»
  const lastCard = page.locator(".lime-site-card").last();
  await lastCard.locator('a:has-text("Движок B")').click();
  await page.waitForURL(/\/Home\/EditDoc\?siteId=/);

  // Блоки на месте после переоткрытия
  await expect(page.locator(topBlocks)).toHaveCount(3);
});

test("editor-b: breakpoint switcher changes preview device (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.locator('[data-doc-add="heading"]').click();

  await page.locator('[data-doc-bp="mobile"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "mobile");
  await page.locator('[data-doc-bp="base"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "desktop");
});

test("editor-b: AI modal opens and reports quota/config status (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.locator("[data-doc-ai-open]").click();
  await expect(page.locator("#lime-doc-ai-modal")).toHaveClass(/is-open/);
  // Статус заполняется ответом /Ai/Quota: либо остаток квоты, либо «не настроен» —
  // оба валидны для локального окружения без AI_API_KEY.
  await expect(page.locator("#lime-doc-ai-status")).toContainText(/Осталось генераций|не настроен/i, { timeout: 5000 });
  await page.locator("[data-doc-ai-close]").click();
  await expect(page.locator("#lime-doc-ai-modal")).not.toHaveClass(/is-open/);
});

test("editor-b: media block shows picker placeholder (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc");
  await page.locator('[data-doc-add="image"]').click();
  // Пустой image-блок рендерит кликабельный плейсхолдер выбора изображения
  await expect(page.locator("[data-doc-pick]")).toBeVisible();
  await page.locator("[data-doc-pick]").click();
  // Открылась медиа-модалка (та же, что в legacy: /Media/ApiList)
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);
  await page.locator("[data-lime-modal-close]").click();
  await expect(page.locator("#lime-media-modal")).not.toHaveClass(/is-open/);
});
