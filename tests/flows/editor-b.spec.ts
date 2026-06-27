/**
 * Движок B (Трек B) — критичный путь нового редактора (authed).
 * Покрывает: добавление блоков, вложенность в контейнер, undo, грипы DnD,
 * AI-модалку, сохранение и переоткрытие через «✦ Движок B».
 */
import { test, expect } from "@playwright/test";

const topBlocks = "#lime-doc-workspace .lime-doc-page > .lime-block";
const nestedBlocks = "#lime-doc-workspace .lime-block .lime-block";

test("editor-v2 D2: command flag keeps structural and checkpoint history coherent (@flow)", async ({ page }) => {
  // cmd-only on-ramp (без canvas) — исходный режим D2; canvas=0 отключает V2-вьюпорт при дефолте-ON.
  await page.goto("/Home/EditDoc?cmd=1&canvas=0");
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

test("editor-v2 Stage 9.1: align toolbar aligns and distributes free-siblings in one undo (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  const kids = container.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block");
  await page.locator('[data-doc-add="heading"]').click();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-add="text"]').click();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-doc-add="text"]').click();
  const ids = await kids.evaluateAll(els => els.map(e => e.getAttribute("data-block-id")));
  expect(ids.length).toBe(3);

  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);
  await page.locator('[data-v2-layout-mode="free"]').click();
  await expect(kids.first()).toHaveCSS("position", "absolute");

  // Сдвигаем средний ребёнок вправо, чтобы выравнивание по левому краю было наблюдаемым.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), ids[1]);
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  const shifted = await kids.nth(1).boundingBox();
  const anchor = await kids.first().boundingBox();
  expect(shifted!.x).toBeGreaterThan(anchor!.x + 5);

  // Мульти-выбор → плавающая панель с 6 align + 2 distribute (т.к. узлов 3).
  await page.evaluate(list => (window as any).__LIME_SELECTION__.replace(list), ids);
  await expect(page.locator(".lime-align-toolbar")).toBeVisible();
  await expect(page.locator(".lime-align-toolbar [data-align-op]")).toHaveCount(8);

  await page.locator('.lime-align-toolbar [data-align-op="left"]').click();
  const alignedMid = await kids.nth(1).boundingBox();
  const alignedFirst = await kids.first().boundingBox();
  expect(alignedMid!.x).toBeCloseTo(alignedFirst!.x, 0);

  await page.locator("[data-doc-undo]").click(); // align — одна транзакция
  const restoredMid = await kids.nth(1).boundingBox();
  expect(restoredMid!.x).toBeCloseTo(shifted!.x, 0);

  // Distribute по вертикали остаётся одной транзакцией и обратим одним undo.
  await page.evaluate(list => (window as any).__LIME_SELECTION__.replace(list), ids);
  const beforeMidY = (await kids.nth(1).boundingBox())!.y;
  await page.locator('.lime-align-toolbar [data-align-op="dist-v"]').click();
  await page.locator("[data-doc-undo]").click();
  const afterUndoMidY = (await kids.nth(1).boundingBox())!.y;
  expect(afterUndoMidY).toBeCloseTo(beforeMidY, 0);
});

test("editor-v2 Stage 9.2: local draft restores unsaved work after reload (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  // Чистый старт: убираем возможный черновик прошлого прогона и баннер, если успел появиться.
  await page.evaluate(() => localStorage.removeItem("lime-doc-draft-new"));
  await page.locator("[data-doc-recovery]").evaluateAll(els => els.forEach(e => e.remove()));

  await page.locator('[data-doc-add="heading"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(1);
  // Черновик пишется с debounce 800мс — дожидаемся записи в localStorage.
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem("lime-doc-draft-new"))).toBeTruthy();

  // Имитация краша: перезагрузка теряет несохранённый (siteId отсутствует) документ.
  await page.reload();
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  await expect(page.locator(topBlocks)).toHaveCount(0); // свежий пустой документ
  const banner = page.locator("[data-doc-recovery]");
  await expect(banner).toBeVisible();

  await banner.locator("[data-recovery-restore]").click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(topBlocks)).toHaveCount(1); // восстановленный heading

  // Повторная перезагрузка после «Отклонить» больше не предлагает восстановление.
  await page.reload();
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  const banner2 = page.locator("[data-doc-recovery]");
  await expect(banner2).toBeVisible();
  await banner2.locator("[data-recovery-dismiss]").click();
  await page.reload();
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  await expect(page.locator("[data-doc-recovery]")).toHaveCount(0);
});

test("editor-v2 Stage 9.3: single-block context toolbar runs quick actions (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(1);
  const headingId = await page.locator(topBlocks).first().getAttribute("data-block-id");
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), headingId);

  // Одиночный выбор → плавающий toolbar над блоком (top-level: 5 действий, без «вынести наружу»).
  const toolbar = page.locator(".lime-block-toolbar.is-visible");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator("[data-block-op]")).toHaveCount(5);

  await toolbar.locator('[data-block-op="dup"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(2); // дубликат
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(1);

  await page.locator(".lime-block-toolbar.is-visible").locator('[data-block-op="del"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(0);
  await expect(page.locator(".lime-block-toolbar")).toHaveCount(0); // нет выбора — нет toolbar
});

test("editor-v2 Stage 9.4: empty-state placeholder offers quick actions (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  // Пустой холст → богатое empty-состояние с заголовком, подсказкой и быстрыми действиями.
  const empty = page.locator("[data-doc-empty]");
  await expect(empty).toBeVisible();
  await expect(empty.locator(".lime-workspace__placeholder-title")).toBeVisible();
  await expect(empty.locator(".lime-workspace__placeholder-hint")).toBeVisible();
  await expect(empty.locator("[data-doc-empty-add]")).toBeVisible();
  await expect(empty.locator("[data-doc-empty-ai]")).toBeVisible();

  // Кнопка AI открывает модалку генерации.
  await empty.locator("[data-doc-empty-ai]").click();
  await expect(page.locator("#lime-doc-ai-modal")).toHaveClass(/is-open/);
  await page.locator("[data-doc-ai-close]").click();
  await expect(page.locator("#lime-doc-ai-modal")).not.toHaveClass(/is-open/);

  // Кнопка «Добавить обложку» добавляет блок и убирает empty-состояние.
  await page.locator("[data-doc-empty-add='cover']").click();
  await expect(page.locator(topBlocks)).toHaveCount(1);
  await expect(page.locator("[data-doc-empty]")).toHaveCount(0);
});

test("editor-v2 Stage 9.5: onboarding tour steps through key areas once (@flow)", async ({ page }) => {
  // Чистый флаг, затем форсим тур через ?tour=1 (детерминированно, независимо от localStorage).
  await page.goto("/Home/EditDoc?canvas=1&cmd=1&tour=1");
  await page.evaluate(() => localStorage.removeItem("lime-onboarding-seen"));
  await page.reload();
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  const tour = page.locator("[data-doc-tour]");
  await expect(tour).toBeVisible();
  await expect(tour.locator(".lime-tour-card__step")).toHaveText("Шаг 1 из 4");
  await expect(page.locator(".lime-tour-spot")).toHaveCount(1); // подсвечена текущая зона

  // Проходим все шаги до «Готово».
  await tour.locator("[data-tour-next]").click(); // 2
  await expect(tour.locator(".lime-tour-card__step")).toHaveText("Шаг 2 из 4");
  await tour.locator("[data-tour-next]").click(); // 3
  await tour.locator("[data-tour-next]").click(); // 4
  await expect(tour.locator("[data-tour-next]")).toHaveText("Готово");
  await tour.locator("[data-tour-next]").click(); // finish

  await expect(page.locator("[data-doc-tour]")).toHaveCount(0);
  await expect(page.locator(".lime-tour-spot")).toHaveCount(0); // подсветка снята
  expect(await page.evaluate(() => localStorage.getItem("lime-onboarding-seen"))).toBe("1");

  // Повторный заход без ?tour=1 — тур больше не показывается (флаг установлен).
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  await expect(page.locator("[data-doc-tour]")).toHaveCount(0);
});

test("editor-v2 Stage 9.6: layers tree is an accessible, keyboard-navigable tree (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  await page.locator('[data-doc-add="text"]').click();
  const ids = await page.locator(topBlocks).evaluateAll(els => els.map(e => e.getAttribute("data-block-id")));
  expect(ids.length).toBe(3);

  // Контейнер дерева — role=tree, фокусируемый, помечен.
  const layers = page.locator("#lime-doc-layers");
  await expect(layers).toHaveAttribute("role", "tree");
  await expect(layers).toHaveAttribute("aria-label", "Слои страницы");
  await expect(layers).toHaveAttribute("tabindex", "0");
  await expect(layers.locator('[role="treeitem"]')).toHaveCount(3);

  // Выбор отражается в aria-selected и aria-activedescendant.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), ids[0]);
  await expect(layers).toHaveAttribute("aria-activedescendant", "lime-layer-" + ids[0]);
  await expect(page.locator("#lime-layer-" + ids[0])).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#lime-layer-" + ids[1])).toHaveAttribute("aria-selected", "false");

  // Клавиатура: ↓ к следующему, End к последнему, Home к первому.
  await layers.focus();
  await page.keyboard.press("ArrowDown");
  await expect(layers).toHaveAttribute("aria-activedescendant", "lime-layer-" + ids[1]);
  await page.keyboard.press("End");
  await expect(layers).toHaveAttribute("aria-activedescendant", "lime-layer-" + ids[2]);
  await page.keyboard.press("ArrowUp");
  await expect(layers).toHaveAttribute("aria-activedescendant", "lime-layer-" + ids[1]);
  await page.keyboard.press("Home");
  await expect(layers).toHaveAttribute("aria-activedescendant", "lime-layer-" + ids[0]);

  // Иконочные кнопки строки и холст помечены для скринридеров.
  await expect(page.locator("#lime-layer-" + ids[0] + " [data-node-rename]")).toHaveAttribute("aria-label", "Переименовать");
  await expect(page.locator("#lime-canvas-viewport")).toHaveAttribute("aria-label", "Холст редактора");
});

test("editor-v2 Stage 10.1: AI command pipeline previews, applies as one undo, rejects garbage (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const heading = page.locator(topBlocks).first();
  const id = await heading.getAttribute("data-block-id");
  expect(id).toBeTruthy();

  const cmds = [
    { type: "setContent", payload: { id, field: "text", value: "ИИ-заголовок" } },
    { type: "setStyle", payload: { id, prop: "color", value: "rgb(200, 0, 0)" } }
  ];

  // Применение показывает preview, но НЕ трогает документ до подтверждения.
  await page.evaluate(list => (window as any).__LIME_AI__.apply(list), cmds);
  const bar = page.locator("[data-doc-ai-preview]");
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-ai-count]")).toHaveText("2");
  await expect(page.locator(".lime-ai-affected")).toHaveCount(1);
  await expect(heading).not.toContainText("ИИ-заголовок");

  await bar.locator("[data-ai-apply]").click();
  await expect(page.locator("[data-doc-ai-preview]")).toHaveCount(0);
  await expect(page.locator(".lime-ai-affected")).toHaveCount(0);
  await expect(heading).toContainText("ИИ-заголовок");

  // Один undo откатывает всю AI-правку.
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(topBlocks).first()).not.toContainText("ИИ-заголовок");

  // Мусорный/чужой список отклоняется без preview и без мутации.
  const reason = await page.evaluate(() =>
    (window as any).__LIME_AI__.apply([{ type: "renameNode", payload: { id: "x", name: "y" } }]));
  expect(reason).toBe("none-valid");
  await expect(page.locator("[data-doc-ai-preview]")).toHaveCount(0);

  // Отмена preview не меняет документ.
  await page.evaluate(list => (window as any).__LIME_AI__.apply(list), cmds);
  await expect(page.locator("[data-doc-ai-preview]")).toBeVisible();
  await page.locator("[data-doc-ai-preview] [data-ai-cancel]").click();
  await expect(page.locator("[data-doc-ai-preview]")).toHaveCount(0);
  await expect(page.locator(topBlocks).first()).not.toContainText("ИИ-заголовок");
});

test("editor-v2 Stage 10.3: AI preview lists each pending change (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const id = await page.locator(topBlocks).first().getAttribute("data-block-id");

  await page.evaluate(blockId => (window as any).__LIME_AI__.apply([
    { type: "setContent", payload: { id: blockId, field: "text", value: "Новый текст AI" } },
    { type: "setStyle", payload: { id: blockId, prop: "color", value: "#ff0000" } },
    { type: "setStyle", payload: { id: "не-существует", prop: "color", value: "#000" } } // no-op
  ]), id);

  const bar = page.locator("[data-doc-ai-preview]");
  await expect(bar).toBeVisible();
  // Счётчик и список показывают только реально применимые правки (no-op исключён).
  await expect(bar.locator("[data-ai-count]")).toHaveText("2");
  const items = bar.locator("[data-ai-list] > li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Новый текст AI");
  await expect(items.nth(1)).toContainText("color");

  await bar.locator("[data-ai-apply]").click();
  await expect(page.locator("[data-doc-ai-preview]")).toHaveCount(0);
  await expect(page.locator(topBlocks).first()).toContainText("Новый текст AI");
});

test("editor-v2 Stage 10.4: AI can insert a whole section as one undo (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(1);

  // AI предлагает добавить целую секцию через insertBlock.
  await page.evaluate(() => (window as any).__LIME_AI__.apply([
    { type: "insertBlock", payload: { block: { type: "cta", content: { title: "AI секция", btn: "Жми" } } } }
  ]));
  const bar = page.locator("[data-doc-ai-preview]");
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-ai-list] > li")).toContainText("добавить блок");

  await bar.locator("[data-ai-apply]").click();
  await expect(page.locator(topBlocks)).toHaveCount(2); // секция добавлена в конец страницы
  await expect(page.locator(topBlocks).last()).toContainText("AI секция");

  await page.locator("[data-doc-undo]").click(); // вставка секции — один undo
  await expect(page.locator(topBlocks)).toHaveCount(1);
});

test("editor-v2 Stage 10.5: responsive AI edits are labelled and apply to mobile only (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const id = await page.locator(topBlocks).first().getAttribute("data-block-id");

  // Адаптация мобилки = setStyle на breakpoint=mobile; diff помечает «(mobile)».
  await page.evaluate(blockId => (window as any).__LIME_AI__.apply([
    { type: "setStyle", payload: { id: blockId, prop: "font-size", value: "18px", breakpoint: "mobile" } }
  ]), id);
  const bar = page.locator("[data-doc-ai-preview]");
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-ai-list] > li")).toContainText("(mobile)");

  await bar.locator("[data-ai-apply]").click();
  await expect(page.locator("[data-doc-ai-preview]")).toHaveCount(0);
  await expect(page.locator(topBlocks)).toHaveCount(1); // блок на месте, mobile-правка применена
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
  await expect(text).toHaveCSS("border-top-left-radius", "36px");
  // Stage 6.6: стиль-правка инстанса теперь ЛОКАЛЬНА (overrides.styles), а не в definition →
  // вторая копия (НЕ выбрана) остаётся нетронутой (раньше менялись все копии через определение).
  await expect(secondComponent).toHaveCSS("border-top-left-radius", "0px");

  // Один undo откатывает обе правки группы (firstComponent override + text) одной транзакцией.
  await page.locator("[data-doc-undo]").click();
  await expect(firstComponent).toHaveCSS("border-top-left-radius", "0px");
  await expect(text).toHaveCSS("border-top-left-radius", "0px");
  await expect(secondComponent).toHaveCSS("border-top-left-radius", "0px");
});

test("editor-v2 Stage 6.2: component text and visibility overrides stay local (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const original = page.locator(`${topBlocks} [contenteditable][data-field="text"]`).first();
  await original.evaluate(el => {
    el.textContent = "Shared title";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  page.once("dialog", dialog => dialog.accept("Shared heading"));
  await page.locator('[data-doc-op="comp"]').click();
  await expect(page.locator("#lime-doc-components [data-doc-insert-comp]")).toHaveCount(1);
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();

  const firstComponentId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const secondComponentId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(firstComponentId && secondComponentId).toBeTruthy();
  const firstComponent = page.locator(`[data-block-id="${firstComponentId}"]`);
  const secondComponent = page.locator(`[data-block-id="${secondComponentId}"]`);
  const firstText = firstComponent.locator('[contenteditable][data-field="text"]').first();
  const secondText = secondComponent.locator('[contenteditable][data-field="text"]').first();

  await firstText.evaluate(el => {
    el.textContent = "Local title";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(700);
  await expect(firstText).toHaveText("Local title");
  await expect(secondText).toHaveText("Shared title");

  await page.locator("[data-doc-undo]").click();
  await expect(firstText).toHaveText("Shared title");
  await expect(secondText).toHaveText("Shared title");
  await page.locator("[data-doc-redo]").click();
  await expect(firstText).toHaveText("Local title");
  await expect(secondText).toHaveText("Shared title");

  const firstLayer = page.locator(`[data-doc-layer="${firstComponentId}"]`);
  await firstLayer.locator("[data-node-toggle-hidden]").click();
  await expect(firstComponent).toHaveAttribute("hidden", "");
  await expect(secondComponent).not.toHaveAttribute("hidden", "");
  await page.locator("[data-doc-undo]").click();
  await expect(firstComponent).not.toHaveAttribute("hidden", "");

  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), firstComponentId);
  await expect(page.locator('[data-doc-op="detach"]')).toBeVisible();
  await page.locator('[data-doc-op="detach"]').click();
  await expect(page.locator('[data-doc-op="detach"]')).toHaveCount(0);
  await expect(page.locator('[data-doc-op="comp"]')).toBeVisible();
  await expect(firstText).toHaveText("Local title");
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator('[data-doc-op="detach"]')).toBeVisible();
});

test("editor-v2 Stage 6.3: component variants reuse instance snapshots (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const original = page.locator(`${topBlocks} [contenteditable][data-field="text"]`).first();
  await original.evaluate(el => {
    el.textContent = "Shared title";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  page.once("dialog", dialog => dialog.accept("Shared heading"));
  await page.locator('[data-doc-op="comp"]').click();
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();

  const firstComponentId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const secondComponentId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(firstComponentId && secondComponentId).toBeTruthy();
  const firstComponent = page.locator(`[data-block-id="${firstComponentId}"]`);
  const secondComponent = page.locator(`[data-block-id="${secondComponentId}"]`);
  const firstText = firstComponent.locator('[contenteditable][data-field="text"]').first();
  const secondText = secondComponent.locator('[contenteditable][data-field="text"]').first();

  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), firstComponentId);
  await firstText.evaluate(el => {
    el.textContent = "Alt title";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  page.once("dialog", dialog => dialog.accept("Alt"));
  await page.locator("[data-doc-component-variant-add]").click();
  await expect(firstText).toHaveText("Alt title");
  await expect(secondText).toHaveText("Shared title");
  await expect(page.locator("[data-doc-component-variant]")).toContainText("Alt");

  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), secondComponentId);
  await page.locator("[data-doc-component-variant]").selectOption({ label: "Alt" });
  await expect(secondText).toHaveText("Alt title");

  await page.locator("[data-doc-undo]").click();
  await expect(secondText).toHaveText("Shared title");
  await page.locator("[data-doc-redo]").click();
  await expect(secondText).toHaveText("Alt title");
});

test("editor-v2 Stage 6.5: component media override stays local (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  // Без ?canvas=1: кликаем РЕАЛЬНЫЕ canvas-кнопки (video placeholder) — без canvas-overlay они доступны.
  await page.goto("/Home/EditDoc?cmd=1&canvas=0");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  // Медиа-тайлы лежат в свёрнутых <details>.lime-tile-group — раскрываем, иначе тайл не кликается.
  await page.evaluate(() => document.querySelectorAll(".lime-tile-group").forEach((d: any) => { d.open = true; }));

  // Видео-блок с общим youtubeId → компонент → второй инстанс (оба видят определение).
  await page.locator('[data-doc-add="video"]').click();
  page.once("dialog", dialog => dialog.accept("https://youtu.be/SHARED01"));
  await page.locator(`${topBlocks} [data-doc-video]`).first().click();
  await expect(page.locator(`${topBlocks} iframe[src*="embed/SHARED01"]`)).toHaveCount(1);

  page.once("dialog", dialog => dialog.accept("Видео"));
  await page.locator('[data-doc-op="comp"]').click();
  await expect(page.locator("#lime-doc-components [data-doc-insert-comp]")).toHaveCount(1);
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();

  const firstId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const secondId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(firstId && secondId).toBeTruthy();
  const first = page.locator(`[data-block-id="${firstId}"]`);
  const second = page.locator(`[data-block-id="${secondId}"]`);
  await expect(first.locator('iframe[src*="embed/SHARED01"]')).toHaveCount(1);
  await expect(second.locator('iframe[src*="embed/SHARED01"]')).toHaveCount(1);

  // Локальная замена видео на первом инстансе → overrides.content; второй остаётся на определении.
  page.once("dialog", dialog => dialog.accept("https://youtu.be/LOCAL02"));
  await first.locator("[data-doc-video]").click();
  await expect(first.locator('iframe[src*="embed/LOCAL02"]')).toHaveCount(1);
  await expect(second.locator('iframe[src*="embed/SHARED01"]')).toHaveCount(1);

  await page.locator("[data-doc-undo]").click();
  await expect(first.locator('iframe[src*="embed/SHARED01"]')).toHaveCount(1);
  await expect(second.locator('iframe[src*="embed/SHARED01"]')).toHaveCount(1);
  await page.locator("[data-doc-redo]").click();
  await expect(first.locator('iframe[src*="embed/LOCAL02"]')).toHaveCount(1);
});

test("editor-v2 Stage 6.6: component style override stays local (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  page.once("dialog", dialog => dialog.accept("Стиль-компонент"));
  await page.locator('[data-doc-op="comp"]').click();
  await expect(page.locator("#lime-doc-components [data-doc-insert-comp]")).toHaveCount(1);
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();

  const firstId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const secondId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(firstId && secondId).toBeTruthy();
  const first = page.locator(`[data-block-id="${firstId}"]`);
  const second = page.locator(`[data-block-id="${secondId}"]`);
  const radius = () => page.locator('[data-doc-style="borderRadius"]');
  const setRadius = (v: number) => radius().evaluate((el, val) => {
    (el as HTMLInputElement).value = String(val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);

  // Радиус на первом инстансе → локальный overrides.styles; второй остаётся на определении (0px).
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), firstId);
  await setRadius(24);
  await expect(first).toHaveCSS("border-top-left-radius", "24px");
  await expect(second).toHaveCSS("border-top-left-radius", "0px");
  await page.waitForTimeout(500); // коммит gesture-транзакции

  // Один undo откатывает локальный override; второй инстанс не затронут. Redo возвращает.
  await page.locator("[data-doc-undo]").click();
  await expect(first).toHaveCSS("border-top-left-radius", "0px");
  await expect(second).toHaveCSS("border-top-left-radius", "0px");
  await page.locator("[data-doc-redo]").click();
  await expect(first).toHaveCSS("border-top-left-radius", "24px");
});

test("editor-v2 Stage 6.7: instance override reset returns to component (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  page.once("dialog", dialog => dialog.accept("Reset-компонент"));
  await page.locator('[data-doc-op="comp"]').click();
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();

  const firstId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  expect(firstId).toBeTruthy();
  const first = page.locator(`[data-block-id="${firstId}"]`);
  const radius = () => page.locator('[data-doc-style="borderRadius"]');
  const setRadius = (v: number) => radius().evaluate((el, val) => {
    (el as HTMLInputElement).value = String(val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);

  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), firstId);
  await setRadius(24);
  await expect(first).toHaveCSS("border-top-left-radius", "24px");
  await page.waitForTimeout(600); // settle → инспектор показывает «↺ к компоненту»

  // Секционный reset: «↺ к компоненту» снимает локальный style-override → значение из определения (0).
  await expect(page.locator("[data-doc-style-reset]").first()).toBeVisible();
  await page.locator("[data-doc-style-reset]").first().click();
  await expect(first).toHaveCSS("border-top-left-radius", "0px");

  // Снова override → банер-кнопка «Сбросить правки» снимает все локальные правки разом.
  await setRadius(18);
  await expect(first).toHaveCSS("border-top-left-radius", "18px");
  await page.waitForTimeout(600);
  await expect(page.locator('[data-doc-op="reset-overrides"]')).toBeVisible();
  await page.locator('[data-doc-op="reset-overrides"]').click();
  await expect(first).toHaveCSS("border-top-left-radius", "0px");
});

test("editor-v2 Stage 6.8: component property edits stay local (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  page.once("dialog", dialog => dialog.accept("Props-компонент"));
  await page.locator('[data-doc-op="comp"]').click();
  await page.locator("#lime-doc-components [data-doc-insert-comp]").click();

  const firstId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const secondId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(firstId && secondId).toBeTruthy();
  const first = page.locator(`[data-block-id="${firstId}"]`);
  const second = page.locator(`[data-block-id="${secondId}"]`);

  // Выбор первого инстанса → секция «Свойства компонента» с авто-полем «Текст».
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), firstId);
  const prop = page.locator('[data-doc-prop="text"]');
  await expect(prop).toBeVisible();

  // Правка свойства → локальный override; второй инстанс не меняется.
  await prop.fill("Локальный заголовок");
  await prop.evaluate(el => el.dispatchEvent(new Event("change", { bubbles: true })));
  await expect(first).toContainText("Локальный заголовок");
  await expect(second).not.toContainText("Локальный заголовок");

  // Свойство переопределено → reset «↺» возвращает значение из компонента.
  await expect(page.locator('[data-doc-prop-reset="text"]')).toBeVisible();
  await page.locator('[data-doc-prop-reset="text"]').click();
  await expect(first).not.toContainText("Локальный заголовок");
});

test("editor-v2 Stage 7: content edit patches only the affected node (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  // Без ?canvas=1: кликаем реальную canvas-кнопку (video placeholder) — без overlay она доступна.
  await page.goto("/Home/EditDoc?cmd=1&canvas=0");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  // Медиа-тайлы в свёрнутых <details>.lime-tile-group — раскрываем для кликабельности.
  await page.evaluate(() => document.querySelectorAll(".lime-tile-group").forEach((d: any) => { d.open = true; }));

  await page.locator('[data-doc-add="video"]').click();
  await page.locator('[data-doc-add="video"]').click();
  const aId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const bId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  expect(aId && bId).toBeTruthy();
  const a = page.locator(`[data-block-id="${aId}"]`);
  const b = page.locator(`[data-block-id="${bId}"]`);

  // Метим узел B DOM-атрибутом, которого НЕТ в модели — он переживёт только точечный патч.
  await b.evaluate(el => el.setAttribute("data-perf-mark", "kept"));

  // Правка контента узла A (setContentValue → patchBlockDom). Полный render() стёр бы метку B.
  page.once("dialog", dialog => dialog.accept("https://youtu.be/AAAAAA1"));
  await a.locator("[data-doc-video]").click();
  await expect(a.locator('iframe[src*="embed/AAAAAA1"]')).toHaveCount(1);

  // Узел B не пересобирался → метка на месте: доказательство точечного обновления, не полного render.
  await expect(b).toHaveAttribute("data-perf-mark", "kept");
});

test("editor-v2 Stage 7: structural edits patch DOM without full rebuild (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const aId = await page.locator(topBlocks).nth(0).getAttribute("data-block-id");
  const a = page.locator(`[data-block-id="${aId}"]`);
  // Метим узел A — он переживёт только точечные структурные правки (insert/dup/delete соседей).
  await a.evaluate(el => el.setAttribute("data-perf-mark", "kept"));

  // INSERT: добавляем второй блок → A не пересобирается.
  await page.locator('[data-doc-add="text"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(2);
  await expect(a).toHaveAttribute("data-perf-mark", "kept");

  // DUPLICATE: дублируем A (вставка по индексу) → A не пересобирается, всего 3.
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), aId);
  await page.locator('[data-doc-op="dup"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(3);
  await expect(a).toHaveAttribute("data-perf-mark", "kept");

  // DELETE: удаляем соседний блок → A не пересобирается, всего 2.
  const midId = await page.locator(topBlocks).nth(1).getAttribute("data-block-id");
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), midId);
  page.once("dialog", dialog => dialog.accept());
  await page.locator('[data-doc-op="del"]').click();
  await expect(page.locator(topBlocks)).toHaveCount(2);
  await expect(a).toHaveAttribute("data-perf-mark", "kept");

  // MOVE: двигаем A вниз (кнопочный move → относительный перенос DOM-узла, не пересборка).
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), aId);
  await page.locator('[data-doc-op="down"]').click();
  await expect(a).toHaveAttribute("data-perf-mark", "kept");
  await expect(page.locator(topBlocks).nth(1)).toHaveAttribute("data-block-id", aId!);
});

test("editor-v2 Stage 7: perf instrument shows edits avoid full render on 300 nodes (@flow)", async ({ page }) => {
  test.slow(); // тяжёлый: load(500)+bench; под нагрузкой полного прогона сервер может отвечать медленнее
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1&perf=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  // Заливаем ~300 узлов и меряем open-render (бюджет открытия — щедрая страховка).
  const open = await page.evaluate(() => (window as any).__LIME_PERF__.load(300));
  console.log("[perf] open(300 nodes):", JSON.stringify(open));
  expect(open.nodes).toBeGreaterThanOrEqual(300);
  expect(open.openMs).toBeLessThan(3000);
  const layerWindow = await page.evaluate(async () => {
    const box = document.getElementById("lime-doc-layers") as HTMLElement;
    const before = box.querySelectorAll("[data-doc-layer]").length;
    const total = Number(box.dataset.layerTotal || "0");
    box.scrollTop = box.scrollHeight;
    box.dispatchEvent(new Event("scroll"));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return {
      total,
      before,
      after: box.querySelectorAll("[data-doc-layer]").length,
      rendered: Number(box.dataset.layerRendered || "0"),
    };
  });
  console.log("[perf] layers virtual window:", JSON.stringify(layerWindow));
  expect(layerWindow.total).toBeGreaterThanOrEqual(300);
  expect(layerWindow.before).toBeLessThan(80);
  expect(layerWindow.after).toBeLessThan(80);

  // Сбрасываем счётчики и делаем частые структурные правки — должны идти точечно, без полного render.
  await page.evaluate(() => (window as any).__LIME_PERF__.reset());
  await page.locator('[data-doc-add="text"]').click();            // insert → incremental
  const newId = await page.locator(topBlocks).last().getAttribute("data-block-id");
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), newId);
  page.once("dialog", dialog => dialog.accept());
  await page.locator('[data-doc-op="del"]').click();             // remove → incremental

  const stat = await page.evaluate(() => (window as any).__LIME_PERF__.report());
  console.log("[perf] after add+delete on 300 nodes:", JSON.stringify(stat));
  expect(stat["incremental"].calls).toBeGreaterThanOrEqual(2); // обе правки точечные
  expect(stat["full render"].calls).toBe(0);                   // ни одной полной пересборки

  // Прямое сравнение на 500 узлах: полный render() против точечного patch одного leaf-узла.
  const bench = await page.evaluate(() => { (window as any).__LIME_PERF__.load(500); return (window as any).__LIME_PERF__.bench(5); });
  console.log("[perf] bench(500 nodes): full vs incremental:", JSON.stringify(bench));
  expect(bench.speedup).toBeGreaterThan(1.5); // точечный заметно быстрее полной пересборки

  await page.evaluate(() => (window as any).__LIME_PERF__.load(500));
  await page.locator('[data-doc-add="text"]').click();
  const undo = await page.evaluate(() => {
    const btn = document.querySelector("[data-doc-undo]") as HTMLButtonElement;
    const t0 = performance.now();
    btn.click();
    return { ms: +(performance.now() - t0).toFixed(1) };
  });
  console.log("[perf] undo after add on 500 nodes:", JSON.stringify(undo));
  expect(undo.ms).toBeLessThan(150);

  // Реальный pointermove-профиль поверх тяжёлого документа: первый видимый контейнер из
  // 500-node fixture переводим в free-layout, resize-хэндл должен оставаться в 60fps бюджете.
  await page.evaluate(() => {
    const perf = (window as any).__LIME_V2_PERF__;
    if (perf) { perf.move.length = 0; perf.resize.length = 0; perf.rotate.length = 0; }
  });
  const perfContainer = page.locator(`${topBlocks}[data-block-type="container"]`).first();
  const perfContainerId = await perfContainer.getAttribute("data-block-id");
  expect(perfContainerId).toBeTruthy();
  const perfChild = perfContainer.locator(":scope > .lime-block__inner > .lime-block__children > .lime-block").first();
  const perfChildId = await perfChild.getAttribute("data-block-id");
  expect(perfChildId).toBeTruthy();
  await perfContainer.scrollIntoViewIfNeeded();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), perfContainerId);
  await page.locator('[data-v2-layout-mode="free"]').click();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), perfChildId);

  const resizeBefore = await perfChild.boundingBox();
  const perfChildBox = page.locator(`[data-selection-id="${perfChildId}"]`);
  await expect(perfChildBox).toBeVisible();
  expect(resizeBefore).toBeTruthy();
  const pointerPerf = await page.evaluate((childId) => {
    const perf = (window as any).__LIME_V2_PERF__;
    if (perf) { perf.resize.length = 0; }
    const overlay = document.getElementById("lime-selection-overlay") as HTMLElement;
    const escaped = (window as any).CSS?.escape ? (window as any).CSS.escape(childId) : childId;
    const box = document.querySelector(`[data-selection-id="${escaped}"]`) as HTMLElement;
    const handle = box?.querySelector('[data-handle="e"]') as HTMLElement;
    if (!overlay || !handle) return { samples: 0, p95: 0, missing: true };
    const r = handle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, pointerId: 777, pointerType: "mouse", isPrimary: true };
    handle.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: x, clientY: y, buttons: 1 }));
    for (let i = 1; i <= 20; i++) {
      overlay.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: x + i * 6, clientY: y, buttons: 1 }));
    }
    overlay.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: x + 120, clientY: y, buttons: 0 }));
    const values = ((window as any).__LIME_V2_PERF__?.resize || []) as number[];
    const sorted = values.slice().sort((a, b) => a - b);
    return { samples: sorted.length, p95: +(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0).toFixed(2) };
  }, perfChildId);
  console.log("[perf] resize pointermove on 500 nodes:", JSON.stringify(pointerPerf));
  expect(pointerPerf.samples).toBeGreaterThanOrEqual(10);
  expect(pointerPerf.p95).toBeLessThanOrEqual(16);
});

test("editor-v2 Stage 5: breakpoint override shows reset and inherits back (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const block = page.locator(topBlocks).last();
  const blockId = await block.getAttribute("data-block-id");
  expect(blockId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), blockId);

  // На десктопе (base) задаём размер текста — базовое значение для проверки источника.
  const fontSize = page.locator('[data-doc-style="fontSize"]');
  await fontSize.evaluate(el => { (el as HTMLInputElement).value = "40"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(450); // оседание gesture (на base инспектор не рефрешится — это ок)

  // На мобильном брейкпоинте: размер текста не переопределён → секция показывает источник «← десктоп».
  await page.locator('[data-doc-bp="mobile"]').click();
  await expect(page.locator('[data-style-src="base"]').first()).toBeVisible();

  // Радиус задаём на mobile — это override (base остаётся 0).
  const radius = page.locator('[data-doc-style="borderRadius"]');
  await radius.evaluate(el => { (el as HTMLInputElement).value = "30"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(block).toHaveCSS("border-top-left-radius", "30px");
  // После оседания жеста (settle ~400мс) инспектор перерисуется и покажет «сбросить» у секции скругления.
  const reset = page.locator('[data-doc-style-reset="borderRadius"]');
  await expect(reset).toBeVisible();

  // Сброс override → наследуется base (0px), кнопка исчезает.
  await reset.click();
  await expect(block).toHaveCSS("border-top-left-radius", "0px");
  await expect(page.locator('[data-doc-style-reset="borderRadius"]')).toHaveCount(0);

  // Undo восстанавливает override одной транзакцией.
  await page.locator("[data-doc-undo]").click();
  await expect(block).toHaveCSS("border-top-left-radius", "30px");
});

test("editor-v2 Stage 5: drag-to-adjust scrubs number fields (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);

  const children = container.locator(":scope > .lime-block__inner > .lime-block__children");
  const gapInput = () => page.locator('[data-v2-design-field="layout"][data-v2-design-path="gap"]');
  await expect(gapInput()).toHaveValue("0");
  const gapLabel = page.locator('.lime-v2-field:has([data-v2-design-path="gap"]) [data-scrub]');
  await expect(gapLabel).toBeVisible();

  // Скраб: тянем подпись «Gap» вправо на 60px → +20 (60/3 шага × step 1).
  const box = (await gapLabel.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
  await expect(children).toHaveCSS("gap", "20px");
  await expect(gapInput()).toHaveValue("20");
  await page.mouse.up();

  await expect(children).toHaveCSS("gap", "20px");
  await expect(gapInput()).toHaveValue("20");

  // Один undo откатывает весь скраб (один change → одна команда).
  await page.locator("[data-doc-undo]").click();
  await expect(gapInput()).toHaveValue("0");
});

test("editor-v2 Stage 5: unit-flex values render through shared design CSS (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);

  const maxWidthInput = page.locator('[data-v2-design-field="size"][data-v2-design-path="width.max"]');
  const maxWidthUnit = page.locator('.lime-v2-field:has([data-v2-design-path="width.max"]) [data-v2-unit-for="width.max"]');
  await maxWidthUnit.selectOption("rem");
  await maxWidthInput.evaluate(el => {
    (el as HTMLInputElement).value = "20";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(container).toHaveCSS("max-width", "320px");
  await page.locator("[data-doc-undo]").click();
  await expect(container).not.toHaveCSS("max-width", "320px");
});

test("editor-v2 Stage 5: multi-select reset override clears all (@flow)", async ({ page }) => {
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

  // На mobile: мульти-выбор обоих, задаём радиус на оба (override на mobile у обоих).
  await page.locator('[data-doc-bp="mobile"]').click();
  await page.evaluate(ids => (window as any).__LIME_SELECTION__.replace(ids), [firstId, secondId]);
  const radius = page.locator('[data-doc-style="borderRadius"]');
  await radius.evaluate(el => { (el as HTMLInputElement).value = "28"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(first).toHaveCSS("border-top-left-radius", "28px");
  await expect(second).toHaveCSS("border-top-left-radius", "28px");

  // Оба переопределены на mobile → появляется multi-reset; сброс чистит обоих.
  const reset = page.locator('[data-doc-style-reset="borderRadius"]');
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(first).toHaveCSS("border-top-left-radius", "0px");
  await expect(second).toHaveCSS("border-top-left-radius", "0px");

  // Один undo возвращает override обоим (одна транзакция).
  await page.locator("[data-doc-undo]").click();
  await expect(first).toHaveCSS("border-top-left-radius", "28px");
  await expect(second).toHaveCSS("border-top-left-radius", "28px");
});

test("editor-v2 Stage 5: class-sourced value shows class badge (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  const block = page.locator(topBlocks).last();
  const blockId = await block.getAttribute("data-block-id");
  expect(blockId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), blockId);

  // Стиль на base → выносим в класс (createClassFromBlock переносит стили блока в класс).
  const radius = page.locator('[data-doc-style="borderRadius"]');
  await radius.evaluate(el => { (el as HTMLInputElement).value = "18"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(450);
  page.once("dialog", d => d.accept("Стиль-класс"));
  await page.locator('[data-doc-class-new]').click();
  // Выходим из режима правки класса и переселектим блок.
  await page.keyboard.press("Escape");
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), blockId);

  // Скругление теперь приходит из класса → секция показывает «← класс».
  await expect(page.locator('[data-style-src="class"]').first()).toBeVisible();
});

test("editor-v2 Stage 5: overflow control clips block (@flow)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="container"]').click();
  const container = page.locator(topBlocks).last();
  const containerId = await container.getAttribute("data-block-id");
  expect(containerId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.select(id), containerId);

  await expect(container).not.toHaveCSS("overflow-x", "hidden");
  await page.locator('[data-v2-overflow="hidden"]').click();
  await expect(container).toHaveCSS("overflow-x", "hidden");
  await page.locator("[data-doc-undo]").click();
  await expect(container).not.toHaveCSS("overflow-x", "hidden");
});

test("editor-v2 Stage 6.1: group and ungroup siblings through command history (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await page.locator('[data-doc-add="heading"]').click();
  await page.locator('[data-doc-add="text"]').click();
  const blocks = page.locator(topBlocks);
  await expect(blocks).toHaveCount(2);
  const firstId = await blocks.nth(0).getAttribute("data-block-id");
  const secondId = await blocks.nth(1).getAttribute("data-block-id");
  expect(firstId && secondId).toBeTruthy();

  await page.evaluate(ids => (window as any).__LIME_SELECTION__.replace(ids), [firstId, secondId]);
  await expect(page.locator("[data-selection-id]")).toHaveCount(2);
  await expect(page.locator('[data-doc-op="group"]')).toBeVisible();
  await page.locator('[data-doc-op="group"]').click();

  await expect(page.locator(topBlocks)).toHaveCount(1);
  const group = page.locator(topBlocks).first();
  await expect(group).toHaveAttribute("data-block-type", "group");
  await expect(page.locator(`${topBlocks} > .lime-block__inner > .lime-block__children > .lime-block`)).toHaveCount(2);
  const groupId = await group.getAttribute("data-block-id");
  expect(groupId).toBeTruthy();
  await expect(page.locator(`[data-doc-layer="${groupId}"] .lime-doc-layer__name`)).toHaveText("Group");

  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(2);
  await page.locator("[data-doc-redo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(1);

  const redoneGroupId = await page.locator(topBlocks).first().getAttribute("data-block-id");
  expect(redoneGroupId).toBeTruthy();
  await page.evaluate(id => (window as any).__LIME_SELECTION__.replace([id]), redoneGroupId);
  await expect(page.locator('[data-doc-op="ungroup"]')).toBeVisible();
  await page.locator('[data-doc-op="ungroup"]').click();

  await expect(page.locator(topBlocks)).toHaveCount(2);
  await expect(page.locator(topBlocks).nth(0)).toHaveAttribute("data-block-id", firstId!);
  await expect(page.locator(topBlocks).nth(1)).toHaveAttribute("data-block-id", secondId!);
  await page.locator("[data-doc-undo]").click();
  await expect(page.locator(topBlocks)).toHaveCount(1);
  await expect(page.locator(topBlocks).first()).toHaveAttribute("data-block-type", "group");
});

test("editor-v2 rollout: new editor is default, ?classic=1 falls back (@flow)", async ({ page }) => {
  // Раскатка: плоский /Home/EditDoc грузит Editor V2 (канвас-контролы видны).
  await page.goto("/Home/EditDoc");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  await expect(page.locator("[data-canvas-controls]")).toBeVisible();
  await expect(page.locator(".lime-editor__canvas.is-v2-viewport")).toHaveCount(1);

  // ?classic=1 возвращает старый редактор (канвас-контролы скрыты, нет V2-вьюпорта).
  await page.goto("/Home/EditDoc?classic=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();
  await expect(page.locator("[data-canvas-controls]")).toBeHidden();
  await expect(page.locator(".lime-editor__canvas.is-v2-viewport")).toHaveCount(0);
});

test("editor-b: blocks + container nesting + undo + save/reopen (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?classic=1");
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
  await page.goto("/Home/EditDoc?classic=1");
  await page.locator('[data-doc-add="heading"]').click();

  await page.locator('[data-doc-bp="mobile"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "mobile");
  await page.locator('[data-doc-bp="base"]').click();
  await expect(page.locator("#lime-doc-workspace")).toHaveAttribute("data-device", "desktop");
});

test("editor-v2 Calm Canvas: inspector, command palette and rail stay discoverable (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?canvas=1&cmd=1");
  if (await page.locator("#lime-doc-intro-skip").isVisible()) await page.locator("#lime-doc-intro-skip").click();

  await expect(page.locator(".lime-editor")).toHaveClass(/no-inspector/);
  await expect(page.locator("#lime-doc-inspector")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-sidebar-panel="insert"]')).toBeVisible();

  await page.locator('[data-sidebar-panel-toggle="layers"]').click();
  await expect(page.locator('[data-sidebar-panel="layers"]')).toBeVisible();
  await expect(page.locator('[data-sidebar-panel="insert"]')).toBeHidden();
  await page.locator('[data-sidebar-panel-toggle="insert"]').click();
  await expect(page.locator('[data-sidebar-panel="insert"]')).toBeVisible();

  await page.keyboard.press("Control+K");
  await expect(page.locator(".lime-command-palette")).toHaveClass(/is-open/);
  await page.locator("[data-command-input]").fill("heading");
  await expect(page.locator(".lime-command-palette__item").first()).toContainText("Вставить заголовок");
  await page.keyboard.press("Enter");

  await expect(page.locator(".lime-command-palette")).not.toHaveClass(/is-open/);
  await expect(page.locator(topBlocks)).toHaveCount(1);
  await expect(page.locator(".lime-editor")).not.toHaveClass(/no-inspector/);
  await expect(page.locator("#lime-doc-inspector")).toHaveAttribute("aria-hidden", "false");

  await page.locator("[data-doc-cmdk]").click();
  await expect(page.locator(".lime-command-palette")).toHaveClass(/is-open/);
  await page.locator("[data-command-input]").fill("layers");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lime-command-palette")).not.toHaveClass(/is-open/);
  await expect(page.locator("[data-doc-cmdk]")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(".lime-editor")).toHaveClass(/no-inspector/);
});

test("editor-b: AI modal opens and reports quota/config status (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?classic=1");
  // Calm Canvas: «AI заново» теперь в overflow-меню «⋯» — сначала раскрываем его.
  await page.locator("[data-topbar-more-toggle]").click();
  await page.locator("[data-doc-ai-open]").click();
  await expect(page.locator("#lime-doc-ai-modal")).toHaveClass(/is-open/);
  // Статус заполняется ответом /Ai/Quota: либо остаток квоты, либо «не настроен» —
  // оба валидны для локального окружения без AI_API_KEY.
  await expect(page.locator("#lime-doc-ai-status")).toContainText(/Осталось генераций|не настроен/i, { timeout: 5000 });
  await page.locator("[data-doc-ai-close]").click();
  await expect(page.locator("#lime-doc-ai-modal")).not.toHaveClass(/is-open/);
});

test("editor-b: media block shows picker placeholder (@flow)", async ({ page }) => {
  await page.goto("/Home/EditDoc?classic=1");
  await page.locator('[data-doc-add="image"]').click();
  // Пустой image-блок рендерит кликабельный плейсхолдер выбора изображения
  await expect(page.locator("[data-doc-pick]")).toBeVisible();
  await page.locator("[data-doc-pick]").click();
  // Открылась медиа-модалка (та же, что в legacy: /Media/ApiList)
  await expect(page.locator("#lime-media-modal")).toHaveClass(/is-open/);
  await page.locator("[data-lime-modal-close]").click();
  await expect(page.locator("#lime-media-modal")).not.toHaveClass(/is-open/);
});
