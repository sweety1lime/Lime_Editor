/*
 * Lime editor inspector events (вынос из lime-doc-editor.js).
 *
 * Делегированные обработчики панели инспектора: drag-to-adjust скраб числовых полей
 * (Shift ×10 / Alt ×0.1, один change на отпускании → один undo), change (юниты/V2-design/
 * component prop/variant), input (стили/анимация/градиент/overlay/motion/слои/тень/CMS-поля/
 * классы) и click-диспетчер (reset'ы, вкладки, состояние hover, классы, фон, эффекты,
 * движение, декор-слои, тулбар data-doc-op). Модуль только маршрутизирует события в
 * инъектированные экшены — сами правки живут в style-engine/effects/section-bg/… .
 * Изменяемое состояние main (selectedId/currentBp/currentClass/currentState/
 * currentInspectorTab/cmdStore) — через get/set-инъекции. Браузер-онли.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorInspectorEvents = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var inspectorEl = options.inspectorEl;
        var L = options.L || {};
        // Состояние main.
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getCurrentClass = options.getCurrentClass || function () { return null; };
        var setCurrentState = options.setCurrentState || noop;
        var getCurrentInspectorTab = options.getCurrentInspectorTab || function () { return "style"; };
        var setCurrentInspectorTab = options.setCurrentInspectorTab || noop;
        var getCmdStore = options.getCmdStore || function () { return null; };
        // Документ/выбор.
        var byId = options.byId || function () { return null; };
        var findBlock = options.findBlock || function () { return null; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        // Правки.
        var setStyle = options.setStyle || noop;
        var resetStyleProps = options.resetStyleProps || noop;
        var setContentValue = options.setContentValue || noop;
        var setContentFlag = options.setContentFlag || noop;
        var runCommands = options.runCommands || function () { return false; };
        var applyPreviewStyles = options.applyPreviewStyles || noop;
        var refreshInspector = options.refreshInspector || noop;
        var scheduleAutosave = options.scheduleAutosave || noop;
        var ensureDocFonts = options.ensureDocFonts || noop;
        // V2 layout.
        var previewDesignInput = options.previewDesignInput || noop;
        var previewChildDesignInput = options.previewChildDesignInput || noop;
        var clearScrubPreview = options.clearScrubPreview || noop;
        var applyV2UnitChange = options.applyV2UnitChange || function () { return false; };
        var applyV2ChildDesignInput = options.applyV2ChildDesignInput || function () { return false; };
        var applyV2DesignInput = options.applyV2DesignInput || function () { return false; };
        var resetV2DesignField = options.resetV2DesignField || noop;
        var switchV2LayoutMode = options.switchV2LayoutMode || noop;
        var setV2LayoutDirection = options.setV2LayoutDirection || noop;
        var setV2LayoutWrap = options.setV2LayoutWrap || noop;
        var setV2GridAuto = options.setV2GridAuto || noop;
        var setV2GridFill = options.setV2GridFill || noop;
        var setV2Overflow = options.setV2Overflow || noop;
        // Классы (0.1).
        var applyClassToBlock = options.applyClassToBlock || noop;
        var editClass = options.editClass || noop;
        var removeClassFromBlock = options.removeClassFromBlock || noop;
        var createClassFromBlock = options.createClassFromBlock || noop;
        var exitClassEdit = options.exitClassEdit || noop;
        var deleteClass = options.deleteClass || noop;
        var renameClass = options.renameClass || noop;
        // Эффекты/движение/слои/тень.
        var setAnim = options.setAnim || noop;
        var toggleFx = options.toggleFx || noop;
        var setSticky = options.setSticky || noop;
        var setMarquee = options.setMarquee || noop;
        var setSceneMode = options.setSceneMode || noop;
        var setSceneLength = options.setSceneLength || noop;
        var setMotionParallax = options.setMotionParallax || noop;
        var addLayer = options.addLayer || noop;
        var delLayer = options.delLayer || noop;
        var pickLayerImage = options.pickLayerImage || noop;
        var setLayerShape = options.setLayerShape || noop;
        var setLayerRng = options.setLayerRng || noop;
        var composeShadow = options.composeShadow || noop;
        var addShadow = options.addShadow || noop;
        var delShadow = options.delShadow || noop;
        // Фон секции.
        var composeGradient = options.composeGradient || noop;
        var liveOverlay = options.liveOverlay || noop;
        var switchBgMode = options.switchBgMode || noop;
        var promptBgVideo = options.promptBgVideo || noop;
        var setBg = options.setBg || noop;
        var openMediaPicker = options.openMediaPicker || noop;
        // Блок-операции тулбара / компоненты / AI.
        var moveBlock = options.moveBlock || noop;
        var unwrapBlock = options.unwrapBlock || noop;
        var dupBlock = options.dupBlock || noop;
        var delBlock = options.delBlock || noop;
        var groupSelection = options.groupSelection || noop;
        var ungroupBlock = options.ungroupBlock || noop;
        var makeComponent = options.makeComponent || noop;
        var detachComponent = options.detachComponent || noop;
        var resetComponentOverrides = options.resetComponentOverrides || noop;
        var setComponentVariant = options.setComponentVariant || noop;
        var addComponentVariantFromInstance = options.addComponentVariantFromInstance || noop;
        var aiRewrite = options.aiRewrite || noop;

        function bind() {
            if (!inspectorEl) return;
            // Stage 5 drag-to-adjust: тянешь подпись числового поля → значение скрабится (Shift ×10,
            // Alt ×0.1). На отпускании шлём один `change` → существующий commit-путь (один undo).
            // Превью блока обновляется на отпускании (live-превью design-полей — отдельный инкремент).
            var scrub = null;
            inspectorEl.addEventListener("pointerdown", function (e) {
                var label = e.target.closest("[data-scrub]");
                if (!label) return;
                var field = label.closest(".lime-v2-field");
                var input = field && field.querySelector('input[type="number"]');
                if (!input) return;
                var startVal = parseFloat(input.value); if (!isFinite(startVal)) startVal = 0;
                scrub = {
                    input: input, label: label, pointerId: e.pointerId, startX: e.clientX, startVal: startVal,
                    step: parseFloat(input.step) || 1, min: input.min !== "" ? parseFloat(input.min) : -Infinity, changed: false
                };
                try { label.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault();
            });
            inspectorEl.addEventListener("pointermove", function (e) {
                if (!scrub || scrub.pointerId !== e.pointerId) return;
                var mod = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
                var delta = Math.round((e.clientX - scrub.startX) / 3) * scrub.step * mod;
                if (!delta) return;
                var dec = scrub.step < 1 ? 2 : 0;
                var val = Math.max(scrub.min, parseFloat((scrub.startVal + delta).toFixed(dec)));
                if (String(val) !== scrub.input.value) {
                    scrub.input.value = String(val);
                    scrub.changed = true;
                    if (scrub.input.hasAttribute("data-v2-design-field")) previewDesignInput(scrub.input);
                    else if (scrub.input.hasAttribute("data-v2-child-field")) previewChildDesignInput(scrub.input);
                }
            });
            function endScrub(e) {
                if (!scrub || scrub.pointerId !== e.pointerId) return;
                try { scrub.label.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                if (scrub.changed) scrub.input.dispatchEvent(new Event("change", { bubbles: true }));
                clearScrubPreview();
                scrub = null;
            }
            inspectorEl.addEventListener("pointerup", endScrub);
            inspectorEl.addEventListener("pointercancel", endScrub);
            inspectorEl.addEventListener("change", function (e) {
                if (e.target.hasAttribute("data-doc-component-variant")) {
                    setComponentVariant(e.target.value);
                    return;
                }
                // Component property (минимальный вид): коммит на blur/Enter → локальный content-override.
                if (e.target.hasAttribute("data-doc-prop")) {
                    var selectedId = getSelectedId();
                    var propSource = selectedId && byId(selectedId);
                    if (propSource) { setContentValue(propSource, e.target.getAttribute("data-doc-prop"), e.target.value, false); refreshInspector(); }
                    return;
                }
                var styleUnit = e.target.getAttribute("data-doc-style-unit");
                if (styleUnit) {
                    var styleInput = e.target.closest(".lime-range-row").querySelector("[data-doc-style]");
                    if (!styleInput) return;
                    styleInput.dataset.unit = e.target.value;
                    setStyle(styleUnit, styleInput.value === "" ? "" : styleInput.value + e.target.value);
                    var styleLabel = styleInput.parentNode.querySelector(".lime-range__val");
                    if (styleLabel) styleLabel.textContent = styleInput.value + e.target.value;
                    return;
                }
                if (applyV2UnitChange(e.target)) return;
                if (applyV2ChildDesignInput(e.target)) return;
                if (applyV2DesignInput(e.target)) return;
            });
            inspectorEl.addEventListener("input", function (e) {
                var t = e.target;
                if (t.hasAttribute("data-doc-style")) {
                    if (t.hasAttribute("data-mixed")) {
                        t.removeAttribute("data-mixed");
                        t.removeAttribute("aria-label");
                        t.classList.remove("is-mixed");
                        var mixedHost = t.closest("[data-style-mixed]");
                        if (mixedHost) {
                            mixedHost.classList.remove("is-mixed");
                            mixedHost.removeAttribute("data-style-mixed");
                            var mixedLabel = mixedHost.querySelector(".lime-mixed-label");
                            if (mixedLabel) mixedLabel.remove();
                        }
                    }
                    var unit = t.dataset.unit || "";
                    setStyle(t.dataset.docStyle, t.value === "" ? "" : t.value + unit);
                    if (t.dataset.docStyle === "fontFamily") ensureDocFonts(); // подгрузить шрифт для превью
                    if (t.type === "range") {
                        var lbl = t.parentNode.querySelector(".lime-range__val");
                        if (lbl) lbl.textContent = t.value + unit;
                    }
                } else if (t.hasAttribute("data-doc-anim") && t.type === "range") {
                    setAnim(t.dataset.docAnim, t.value, false);
                    var al = t.parentNode.querySelector(".lime-range__val");
                    if (al) al.textContent = t.value;
                } else if (t.hasAttribute("data-doc-grad")) {
                    composeGradient();
                    if (t.type === "range") {
                        var gl = t.parentNode.querySelector(".lime-range__val");
                        if (gl) gl.textContent = t.value + "°";
                    }
                } else if (t.hasAttribute("data-doc-overlay")) {
                    liveOverlay();
                    if (t.type === "range") {
                        var ol = t.parentNode.querySelector(".lime-range__val");
                        if (ol) ol.textContent = Math.round(parseFloat(t.value) * 100) + "%";
                    }
                } else if (t.hasAttribute("data-doc-motion") && t.type === "range") {
                    // Параллакс секции: пишем модель + DOM-атрибут (визуально едет только на публикации).
                    setMotionParallax(t.value);
                    var ml = t.parentNode.querySelector(".lime-range__val"); if (ml) ml.textContent = t.value;
                } else if (t.hasAttribute("data-doc-layer-rng")) {
                    var li = parseInt(t.dataset.i, 10);
                    setLayerRng(li, t.dataset.docLayerRng, parseFloat(t.value));
                    var ll = t.parentNode.querySelector(".lime-range__val"); if (ll) ll.textContent = t.value;
                } else if (t.hasAttribute("data-doc-layer-color")) {
                    var ci = parseInt(t.dataset.docLayerColor, 10);
                    setLayerRng(ci, "color", t.value);
                } else if (t.hasAttribute("data-doc-scene-len") && t.type === "range") {
                    setSceneLength(t.value);
                    var sl = t.parentNode.querySelector(".lime-range__val");
                    if (sl) sl.textContent = t.value;
                } else if (t.hasAttribute("data-doc-shadow")) {
                    composeShadow();
                    if (t.type === "range") {
                        var shl = t.parentNode.querySelector(".lime-range__val");
                        if (shl) shl.textContent = t.value + (t.dataset.k === "alpha" ? "" : "px");
                    }
                } else if (t.hasAttribute("data-doc-cd-target")) {
                    setContentFlag("target", t.value || null); // дата окончания отсчёта
                } else if (t.hasAttribute("data-doc-bind")) {
                    setContentFlag(t.getAttribute("data-doc-bind"), t.value || null); // привязка блока к полю записи
                } else if (t.hasAttribute("data-doc-collection")) {
                    setContentFlag("collection", t.value || null);
                    refreshInspector(); // перезаполнить поля карточки/сортировки под новую коллекцию
                } else if (t.hasAttribute("data-doc-cl-limit")) {
                    var clLim = parseInt(t.value, 10);
                    setContentFlag("limit", clLim > 0 ? clLim : null);
                } else if (t.hasAttribute("data-doc-cl-sortfield")) {
                    setContentFlag("sortField", t.value || null);
                } else if (t.hasAttribute("data-doc-cl-sortdir")) {
                    setContentFlag("sortDir", t.value === "asc" ? "asc" : null);
                } else if (t.hasAttribute("data-doc-cl-filterfield")) {
                    setContentFlag("filterField", t.value || null);
                } else if (t.hasAttribute("data-doc-cl-filterval")) {
                    setContentFlag("filterValue", t.value || null);
                } else if (t.hasAttribute("data-doc-cl-imagefield")) {
                    setContentFlag("imageField", t.value || null);
                } else if (t.hasAttribute("data-doc-cl-titlefield")) {
                    setContentFlag("titleField", t.value || null);
                } else if (t.hasAttribute("data-doc-cl-descfield")) {
                    setContentFlag("descField", t.value || null);
                } else if (t.hasAttribute("data-doc-class-add")) {
                    if (t.value) applyClassToBlock(t.value); // <select> применить класс (0.1)
                }
            });
            inspectorEl.addEventListener("click", function (e) {
                var el;
                var selectedId = getSelectedId();
                if ((el = e.target.closest("[data-v2-design-reset]"))) {
                    resetV2DesignField(el.dataset.v2DesignReset);
                    return;
                }
                if ((el = e.target.closest("[data-doc-style-reset]"))) { // Stage 5: сброс override стиля
                    resetStyleProps(el.getAttribute("data-doc-style-reset").split(","));
                    return;
                }
                if ((el = e.target.closest("[data-doc-prop-reset]"))) { // 6.8: сброс свойства к значению компонента
                    var propResetSource = selectedId && byId(selectedId);
                    if (propResetSource) { setContentValue(propResetSource, el.getAttribute("data-doc-prop-reset"), "", true); refreshInspector(); }
                    return;
                }
                if ((el = e.target.closest("[data-v2-layout-mode]"))) { switchV2LayoutMode(el.dataset.v2LayoutMode); return; }
                if ((el = e.target.closest("[data-v2-layout-direction]"))) {
                    setV2LayoutDirection(el.dataset.v2LayoutDirection);
                    return;
                }
                if ((el = e.target.closest("[data-v2-layout-wrap]"))) {
                    setV2LayoutWrap(el.dataset.v2LayoutWrap === "1");
                    return;
                }
                if ((el = e.target.closest("[data-v2-grid-auto]"))) {
                    // Фикс./Авто колонки: число (repeat N) ↔ объект { mode:auto, min } (repeat auto-fit/fill).
                    setV2GridAuto(el.dataset.v2GridAuto === "1");
                    return;
                }
                if ((el = e.target.closest("[data-v2-grid-fill]"))) {
                    setV2GridFill(el.dataset.v2GridFill === "1");
                    return;
                }
                if ((el = e.target.closest("[data-v2-overflow]"))) { // hidden → set; visible (дефолт) → убрать
                    setV2Overflow(el.dataset.v2Overflow);
                    return;
                }
                if ((el = e.target.closest("[data-doc-insp-tab]"))) {
                    setCurrentInspectorTab(el.dataset.docInspTab);
                    var currentInspectorTab = getCurrentInspectorTab();
                    var tb = inspectorEl.querySelectorAll("[data-doc-insp-tab]");
                    for (var ti = 0; ti < tb.length; ti++) tb[ti].classList.toggle("is-active", tb[ti] === el);
                    var pn = inspectorEl.querySelectorAll("[data-insp-tab]");
                    for (var pj = 0; pj < pn.length; pj++) pn[pj].hidden = (pn[pj].getAttribute("data-insp-tab") !== currentInspectorTab);
                    return;
                }
                if ((el = e.target.closest("[data-doc-state]"))) {
                    setCurrentState(el.dataset.docState === "hover" ? "hover" : "normal");
                    refreshInspector();
                    applyPreviewStyles(); // показать/убрать вид наведения в холсте
                    return;
                }
                // Классы (0.1)
                if ((el = e.target.closest("[data-doc-class-edit]"))) { editClass(el.dataset.docClassEdit); return; }
                if ((el = e.target.closest("[data-doc-class-remove]"))) { removeClassFromBlock(el.dataset.docClassRemove); return; }
                if (e.target.closest("[data-doc-class-new]")) { createClassFromBlock(); return; }
                if (e.target.closest("[data-doc-class-done]")) { exitClassEdit(); return; }
                if (e.target.closest("[data-doc-class-delete]")) { deleteClass(getCurrentClass()); return; }
                if (e.target.closest("[data-doc-class-rename]")) { renameClass(getCurrentClass()); return; }
                if (e.target.closest("[data-doc-shadow-add]")) { addShadow(); return; }
                if ((el = e.target.closest("[data-doc-shadow-del]"))) { delShadow(parseInt(el.dataset.docShadowDel, 10)); return; }
                if ((el = e.target.closest("[data-doc-style]")) && el.tagName === "BUTTON") {
                    setStyle(el.dataset.docStyle, el.dataset.val);
                    refreshInspector();
                    return;
                }
                if ((el = e.target.closest("[data-doc-anim]")) && el.tagName === "BUTTON") {
                    setAnim("anim", el.dataset.val, true);
                    return;
                }
                if ((el = e.target.closest("[data-doc-clear]"))) {
                    setStyle(el.dataset.docClear, "");
                    refreshInspector();
                    return;
                }
                if ((el = e.target.closest("[data-doc-bgmode]"))) { switchBgMode(el.dataset.docBgmode); return; }
                if (e.target.closest("[data-doc-bg-pick]")) { openMediaPicker(selectedId, "backgroundImage", "bgimage"); return; }
                if (e.target.closest("[data-doc-bg-video]")) { promptBgVideo(); return; }
                if (e.target.closest("[data-doc-bg-clear-img]")) { setStyle("backgroundImage", ""); refreshInspector(); return; }
                if ((el = e.target.closest("[data-doc-bg-clear-key]"))) { setBg(el.dataset.docBgClearKey, ""); return; }
                if ((el = e.target.closest("[data-doc-bg-preset]"))) {
                    var bp = win.LimeAssets && win.LimeAssets.BG_PRESETS[parseInt(el.dataset.docBgPreset, 10)];
                    if (bp) {
                        var presetSource = byId(selectedId);
                        var bb = targetBlock(presetSource);
                        var cmdStore = getCmdStore();
                        if (cmdStore && bb === presetSource) {
                            var presetChanged = runCommands([
                                { type: "setContent", payload: { id: presetSource.id, field: "bgMode", value: "gradient" } },
                                { type: "setStyle", payload: { id: presetSource.id, breakpoint: getCurrentBp(), prop: "backgroundImage", value: bp.css } }
                            ], "background-preset");
                            applyPreviewStyles(); if (presetChanged) scheduleAutosave();
                        } else {
                            if (bb) { if (!bb.content) bb.content = {}; bb.content.bgMode = "gradient"; }
                            setStyle("backgroundImage", bp.css);
                        }
                        refreshInspector();
                    }
                    return;
                }
                // ----- эффекты и макет -----
                if ((el = e.target.closest("[data-doc-fx]"))) { toggleFx(el.dataset.docFx); return; }
                if ((el = e.target.closest("[data-doc-width]"))) { setContentFlag("width", el.dataset.docWidth === "boxed" ? "boxed" : null); return; }
                if ((el = e.target.closest("[data-doc-bento]"))) { setContentFlag("layout", el.dataset.docBento === "on" ? "bento" : null); return; }
                if ((el = e.target.closest("[data-doc-cl-layout]"))) { setContentFlag("layout", el.dataset.docClLayout === "cards" ? null : el.dataset.docClLayout); refreshInspector(); return; }
                // ----- движение -----
                if ((el = e.target.closest("[data-doc-sticky]"))) {
                    setSticky(el.dataset.docSticky === "1");
                    return;
                }
                if ((el = e.target.closest("[data-doc-marquee]"))) {
                    setMarquee(el.dataset.docMarquee);
                    return;
                }
                if ((el = e.target.closest("[data-doc-scene]"))) { setSceneMode(el.dataset.docScene); return; }
                // ----- декор-слои -----
                if ((el = e.target.closest("[data-doc-layer-add]"))) { addLayer(el.dataset.docLayerAdd); return; }
                if ((el = e.target.closest("[data-doc-layer-del]"))) { delLayer(parseInt(el.dataset.docLayerDel, 10)); return; }
                if ((el = e.target.closest("[data-doc-layer-pick]"))) { pickLayerImage(parseInt(el.dataset.docLayerPick, 10)); return; }
                if ((el = e.target.closest("[data-doc-layer-shape]"))) {
                    setLayerShape(parseInt(el.dataset.docLayerShape, 10), el.dataset.shape);
                    return;
                }
                if ((el = e.target.closest("[data-doc-cols]"))) {
                    var cb = findBlock(selectedId);
                    if (cb) {
                        setContentValue(cb.block, "cols", parseInt(el.dataset.docCols, 10), false);
                        refreshInspector();
                    }
                    return;
                }
                if ((el = e.target.closest("[data-doc-component-variant-add]"))) {
                    addComponentVariantFromInstance();
                    return;
                }
                if ((el = e.target.closest("[data-doc-op]"))) {
                    var op = el.dataset.docOp;
                    if (op === "up") moveBlock(-1);
                    else if (op === "down") moveBlock(1);
                    else if (op === "unwrap") unwrapBlock();
                    else if (op === "group") groupSelection();
                    else if (op === "ungroup") ungroupBlock();
                    else if (op === "ai") aiRewrite();
                    else if (op === "dup") dupBlock();
                    else if (op === "comp") makeComponent();
                    else if (op === "detach") detachComponent();
                    else if (op === "reset-overrides") resetComponentOverrides();
                    else if (op === "free-toggle") { // DnD C: тумблер free ⇄ stack для контейнера
                        var fb = selectedId && byId(selectedId), ft = fb && targetBlock(fb);
                        if (ft && L.isContainer(ft.type)) {
                            var fm = ((L.resolvedDesign(ft.design, getCurrentBp()).layout || {}).mode) || "stack";
                            switchV2LayoutMode(fm === "free" ? "stack" : "free");
                        }
                    }
                    else if (op === "del") { if (win.confirm("Удалить блок?")) delBlock(); }
                }
            });
        }

        return { bind: bind };
    }

    return { create: create };
});
