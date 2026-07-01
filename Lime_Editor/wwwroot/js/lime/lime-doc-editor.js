/*
 * Lime Document Editor (Трек B, B1 срез 2) — новый редактор поверх движка lime-doc.
 *
 * Источник правды — объект `doc` (JSON-документ). DOM рендерится из него (editable-режим).
 * Inline-правка пишет обратно в doc.content по data-field (без ре-рендера, чтобы не терять курсор).
 * Инспектор правит doc.blocks[].styles[breakpoint] — отдельные стили на desktop/tablet/mobile (основа B2).
 * Save шлёт documentJson + скомпилированный publish-HTML в существующий /Home/EditTemplatesPost.
 */
(function () {
    "use strict";

    if (typeof window === "undefined" || !window.LimeDoc) return;
    var L = window.LimeDoc;
    var EditorUtils = window.LimeEditorUtils || {};
    var EditorComponents = window.LimeEditorComponents || {};
    var EditorComponentActions = window.LimeEditorComponentActions || {};
    var EditorBlockActions = window.LimeEditorBlockActions || {};
    var EditorCommandPalette = window.LimeEditorCommandPalette || {};
    var EditorInspectorControls = window.LimeEditorInspectorControls || {};
    var EditorLayers = window.LimeEditorLayers || {};
    var EditorContextMenu = window.LimeEditorContextMenu || {};
    var EditorMediaPicker = window.LimeEditorMediaPicker || {};
    var EditorMediaActions = window.LimeEditorMediaActions || {};
    var EditorSidebar = window.LimeEditorSidebar || {};
    var EditorPages = window.LimeEditorPages || {};
    var EditorPersistence = window.LimeEditorPersistence || {};
    var EditorOnboarding = window.LimeEditorOnboarding || {};
    var EditorTopbar = window.LimeEditorTopbar || {};
    var EditorIntro = window.LimeEditorIntro || {};
    var EditorTheme = window.LimeEditorTheme || {};
    var EditorSiteCode = window.LimeEditorSiteCode || {};
    var EditorSectionBg = window.LimeEditorSectionBg || {};
    var EditorAiGenerate = window.LimeEditorAiGenerate || {};
    var EditorAiPipeline = window.LimeEditorAiPipeline || {};
    var EditorShadow = window.LimeEditorShadow || {};
    var EditorClasses = window.LimeEditorClasses || {};
    var EditorEffects = window.LimeEditorEffects || {};
    var EditorV2Layout = window.LimeEditorV2Layout || {};
    var EditorV2Canvas = window.LimeEditorV2Canvas || {};
    if (!EditorUtils.escapeText) throw new Error("LimeEditorUtils is required before lime-doc-editor.js");
    if (!EditorComponents.create) throw new Error("LimeEditorComponents is required before lime-doc-editor.js");
    if (!EditorComponentActions.create) throw new Error("LimeEditorComponentActions is required before lime-doc-editor.js");
    if (!EditorBlockActions.create) throw new Error("LimeEditorBlockActions is required before lime-doc-editor.js");
    if (!EditorCommandPalette.create) throw new Error("LimeEditorCommandPalette is required before lime-doc-editor.js");
    if (!EditorInspectorControls.create) throw new Error("LimeEditorInspectorControls is required before lime-doc-editor.js");
    if (!EditorLayers.create) throw new Error("LimeEditorLayers is required before lime-doc-editor.js");
    if (!EditorContextMenu.create) throw new Error("LimeEditorContextMenu is required before lime-doc-editor.js");
    if (!EditorMediaPicker.create) throw new Error("LimeEditorMediaPicker is required before lime-doc-editor.js");
    if (!EditorMediaActions.create) throw new Error("LimeEditorMediaActions is required before lime-doc-editor.js");
    if (!EditorSidebar.create) throw new Error("LimeEditorSidebar is required before lime-doc-editor.js");
    if (!EditorPages.create) throw new Error("LimeEditorPages is required before lime-doc-editor.js");
    if (!EditorPersistence.create) throw new Error("LimeEditorPersistence is required before lime-doc-editor.js");
    if (!EditorOnboarding.create) throw new Error("LimeEditorOnboarding is required before lime-doc-editor.js");
    if (!EditorTopbar.init) throw new Error("LimeEditorTopbar is required before lime-doc-editor.js");
    if (!EditorIntro.create) throw new Error("LimeEditorIntro is required before lime-doc-editor.js");
    if (!EditorTheme.create) throw new Error("LimeEditorTheme is required before lime-doc-editor.js");
    if (!EditorSiteCode.create) throw new Error("LimeEditorSiteCode is required before lime-doc-editor.js");
    if (!EditorSectionBg.create) throw new Error("LimeEditorSectionBg is required before lime-doc-editor.js");
    if (!EditorAiGenerate.create) throw new Error("LimeEditorAiGenerate is required before lime-doc-editor.js");
    if (!EditorAiPipeline.create) throw new Error("LimeEditorAiPipeline is required before lime-doc-editor.js");
    if (!EditorShadow.create) throw new Error("LimeEditorShadow is required before lime-doc-editor.js");
    if (!EditorClasses.create) throw new Error("LimeEditorClasses is required before lime-doc-editor.js");
    if (!EditorEffects.create) throw new Error("LimeEditorEffects is required before lime-doc-editor.js");
    if (!EditorV2Layout.create) throw new Error("LimeEditorV2Layout is required before lime-doc-editor.js");
    if (!EditorV2Canvas.create) throw new Error("LimeEditorV2Canvas is required before lime-doc-editor.js");

    var ws = document.getElementById("lime-doc-workspace");
    if (!ws) return;
    var inspectorEl = document.getElementById("lime-doc-inspector");
    var editorRoot = document.querySelector(".lime-editor");
    var saveBtn = document.querySelector("[data-doc-save]");
    var siteId = saveBtn ? (saveBtn.dataset.siteId || "") : "";
    var refreshV2SelectionOverlay = function () {};

    // ===== STATE =====
    var doc = { version: 1, pages: [], components: {}, theme: {} };
    if (window.__LIME_DOC__ && typeof window.__LIME_DOC__ === "object") {
        doc = window.__LIME_DOC__;
    }
    // Нормализация/миграция по version — единая точка в движке (browser/Jint/export/self-test).
    // Поднимает legacy doc.blocks → pages, проставляет дефолты, сохраняет неизвестные поля.
    doc = L.migrateDoc(doc);

    var active = 0;            // индекс активной страницы
    var selectedId = null;
    var currentBp = "base";    // base | tablet | mobile
    var currentState = "normal"; // normal | hover — редактируемое состояние блока (1.2)
    var currentClass = null;   // если задан cls — инспектор правит этот класс, а не блок (0.1)
    var currentInspectorTab = "style"; // style | fx | motion — активная вкладка инспектора
    var inspectorAdvOpen = false; // развёрнута ли группа «Дополнительно» (редизайн редактора, фаза 2)
    var paletteJustDragged = false; // подавляет click палитры после drag-and-drop из палитры (DnD A)

    // Версия документа для optimistic concurrency (этап 0.4): Site.UpdatedAt.Ticks.
    // Шлём с каждым сохранением; 409 = документ сохранили из другого окна.
    var docVersion = window.__LIME_DOC_VERSION__ || 0;

    function pageBlocks() { return doc.pages[active].blocks; }

    // Старт с шаблона (Фаза 3.2): ?template=key на пустом новом документе.
    // applyTemplateByKey/blockFromSpec — function declarations (подняты), doc/active готовы.
    if (window.__LIME_TEMPLATE__ && pageBlocks().length === 0) {
        applyTemplateByKey(window.__LIME_TEMPLATE__);
    }
    function totalBlocks() {
        return doc.pages.reduce(function (n, p) { return n + p.blocks.length; }, 0);
    }
    var componentHelpers = EditorComponents.create({ getDoc: function () { return doc; }, L: L });
    var componentRecord = componentHelpers.componentRecord;
    var componentVariantRecord = componentHelpers.componentVariantRecord;
    var componentSourceBlock = componentHelpers.componentSourceBlock;
    var targetBlock = componentHelpers.targetBlock;
    var designTarget = componentHelpers.designTarget;
    var rawBlockDesign = componentHelpers.rawBlockDesign;
    var resolvedBlockDesign = componentHelpers.resolvedBlockDesign;
    var readStyles = componentHelpers.readStyles;
    var setComponentStyleOverrideLocal = componentHelpers.setComponentStyleOverrideLocal;
    // Цель правки: для компонента-инстанса — общий блок из doc.components (правка → все копии).
    // Стили для ЧТЕНИЯ (инспектор/живое превью): у компонента-инстанса — эффективные
    // (definition.styles ⊕ instance.overrides.styles), у обычного блока — собственные. Запись
    // override идёт отдельным путём (setComponentStyleOverride / setComponentStyleOverrideLocal).
    var escapeText = EditorUtils.escapeText;
    var rid = EditorUtils.rid;
    var csrfToken = EditorUtils.csrfToken;
    // Нормализация цвета в #hex (для инъекции в inspector-controls / shadow / section-bg).
    function toHex(value) {
        if (!value) return "#000000";
        if (value[0] === "#") return value;
        var m = String(value).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!m) return "#000000";
        var h = function (n) { var x = parseInt(n, 10).toString(16); return x.length < 2 ? "0" + x : x; };
        return "#" + h(m[1]) + h(m[2]) + h(m[3]);
    }
    // Глубокий поиск блока (этап 1: блоки бывают вложены в контейнеры/колонки и в
    // children определений компонентов). Возвращает { block, parent: массив-владелец,
    // index, parentBlock: блок-контейнер или null (верхний уровень страницы) }.
    function findIn(arr, id, parentBlock) {
        for (var i = 0; i < arr.length; i++) {
            var b = arr[i];
            if (b.id === id) return { block: b, parent: arr, index: i, parentBlock: parentBlock || null };
            var t = targetBlock(b); // у компонента-инстанса дети живут в определении
            if (t && t.children && t.children.length) {
                var r = findIn(t.children, id, b);
                if (r) return r;
            }
        }
        return null;
    }
    function findBlock(id) { return id ? findIn(pageBlocks(), id, null) : null; }
    function byId(id) {
        var r = findBlock(id);
        return r ? r.block : null;
    }
    // ===== Переиспользуемые style-классы (этап 0.1) =====
    // theme.classes = [{ cls, name, styles:{base,tablet,mobile,hover} }]; блок ссылается
    // block.classes:["cls"]. cls — CSS-безопасный id (генерим), name — для показа.
    function classDefs() {
        if (!doc.theme.classes) doc.theme.classes = [];
        return doc.theme.classes;
    }
    function findClassDef(cls) {
        var l = classDefs();
        for (var i = 0; i < l.length; i++) if (l[i].cls === cls) return l[i];
        return null;
    }
    // Эффективные стили всех классов блока на текущем брейкпоинте (для живого превью —
    // движок на публикации эмитит их через media-queries, а в холсте ширина не меняется).
    function effectiveClassStyles(b) {
        var t = targetBlock(b);
        if (!t || !t.classes || !t.classes.length) return {};
        var acc = {};
        for (var i = 0; i < t.classes.length; i++) {
            var def = findClassDef(t.classes[i]);
            if (def && def.styles) Object.assign(acc, effective(def.styles, currentBp));
        }
        return acc;
    }

    // Новые id для клона и всех его потомков — id обязаны быть уникальны в документе.
    function reid(b) {
        b.id = rid("b");
        if (b.children) for (var i = 0; i < b.children.length; i++) reid(b.children[i]);
        return b;
    }
    var setByPath = EditorUtils.setByPath;
    var deleteByPath = EditorUtils.deleteByPath;
    function setComponentContentOverrideLocal(inst, field, value, remove) {
        if (!inst || inst.type !== "component") return false;
        if (!inst.overrides) inst.overrides = {};
        if (!inst.overrides.content) inst.overrides.content = {};
        if (remove) deleteByPath(inst.overrides.content, field);
        else setByPath(inst.overrides.content, field, value);
        if (inst.overrides.content && !Object.keys(inst.overrides.content).length) delete inst.overrides.content;
        if (inst.overrides && !Object.keys(inst.overrides).length) delete inst.overrides;
        return true;
    }
    function kebab(k) { return k.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); }); }

    // Эффективные стили для превью текущего брейкпоинта (каскад base ⊕ tablet ⊕ mobile).
    function effective(styles, bp) {
        styles = styles || {};
        var out = {};
        Object.assign(out, styles.base);
        if (bp === "tablet" || bp === "mobile") Object.assign(out, styles.tablet);
        if (bp === "mobile") Object.assign(out, styles.mobile);
        return out;
    }
    function declsToCss(obj) {
        return Object.keys(obj).map(function (k) { return kebab(k) + ":" + obj[k]; }).join(";");
    }
    // Единый icon-set: инлайн-SVG по id из спрайта в EditDoc.cshtml (полировка/редизайн редактора).
    function ico(name) { return '<svg class="lime-ico"><use href="#i-' + name + '"/></svg>'; }

    // ===== HISTORY (этап 0.4: undo/redo на снапшотах JSON-документа) =====
    var HIST_MAX = 50;
    var hist = [];
    var histPos = -1;

    // Раскатка Editor V2 (этап «релиз»): новый редактор (command-history + canvas) включён ПО
    // УМОЛЧАНИЮ (сервер-конфиг Editor:V2Default → window.__LIME_V2_DEFAULT__). Старый редактор —
    // fallback по ?classic=1. Явные ?cmd=1/?canvas=1 по-прежнему форсят V2 (для тестов/ссылок).
    var v2Default = window.__LIME_V2_DEFAULT__ !== false && !/[?&]classic=1\b/.test(location.search);
    var cmdOn = !/[?&]cmd=0\b/.test(location.search) && (/[?&]cmd=1\b/.test(location.search) || window.__LIME_CMD__ || v2Default) && !!window.LimeCommands;
    var canvasOn = !/[?&]canvas=0\b/.test(location.search) && (/[?&]canvas=1\b/.test(location.search) || v2Default);
    var calmCanvasOn = !/[?&]classic=1\b/.test(location.search);
    var cmdStore = cmdOn ? window.LimeCommands.createStore(doc) : null;

    function syncInspectorShell(hasSelection) {
        var hidden = calmCanvasOn && !hasSelection;
        editorRoot = editorRoot || document.querySelector(".lime-editor");
        if (editorRoot) editorRoot.classList.toggle("no-inspector", hidden);
        if (inspectorEl) inspectorEl.setAttribute("aria-hidden", hidden ? "true" : "false");
    }

    // ===== Stage 7 perf-инструмент (за ?perf=1, иначе ноль стоимости) =====
    // Считает вызовы полного render() против точечных patch/insert/remove/move и время в каждом.
    // window.__LIME_PERF__.report() — таблица; .load(n) — залить n синтетических узлов и замерить open.
    var perfOn = /[?&]perf=1\b/.test(location.search) || !!window.__LIME_PERF_ON__;
    var perfStat = { full: { n: 0, ms: 0 }, inc: { n: 0, ms: 0 } };
    function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
    function perfRec(kind, t0) { if (perfOn) { perfStat[kind].n++; perfStat[kind].ms += perfNow() - t0; } }
    if (perfOn) {
        window.__LIME_PERF__ = {
            stat: perfStat,
            report: function () {
                var row = function (b) { return { calls: b.n, totalMs: +b.ms.toFixed(1), avgMs: b.n ? +(b.ms / b.n).toFixed(2) : 0 }; };
                var out = { "full render": row(perfStat.full), "incremental": row(perfStat.inc) };
                if (window.console && console.table) console.table(out); else console.log(JSON.stringify(out));
                return out;
            },
            reset: function () { perfStat.full = { n: 0, ms: 0 }; perfStat.inc = { n: 0, ms: 0 }; },
            // Прямое сравнение на ТЕКУЩЕМ документе: полный render() против точечного patch одного
            // leaf-узла. Усредняем по reps. Возвращает {fullMs, incMs, speedup}.
            bench: function (reps) {
                reps = reps || 5;
                var leaf = null, top = pageBlocks();
                for (var i = 0; i < top.length && !leaf; i++) { if (top[i].children && top[i].children.length) leaf = top[i].children[0]; }
                if (!leaf) leaf = top[0];
                var full = 0, inc = 0, k;
                for (k = 0; k < reps; k++) { var a = perfNow(); render(); full += perfNow() - a; }
                for (k = 0; k < reps; k++) { var b = perfNow(); patchBlockDom(leaf.id); inc += perfNow() - b; }
                var fm = full / reps, im = inc / reps;
                this.reset();
                console.log("[LIME PERF] bench(" + reps + "): full render " + fm.toFixed(1) + "ms vs incremental patch " + im.toFixed(2) + "ms → ×" + (fm / im).toFixed(1) + " быстрее");
                return { fullMs: +fm.toFixed(1), incMs: +im.toFixed(2), speedup: +(fm / im).toFixed(1) };
            },
            // Залить n синтетических узлов (контейнеры по ~6 текстов) и замерить open-render.
            load: function (n) {
                n = n || 500;
                var blocks = [], made = 0;
                while (made < n) {
                    var kids = [], kc = Math.min(6, n - made);
                    for (var i = 0; i < kc; i++) { made++; kids.push({ id: rid("b"), type: "text", content: { text: "Node " + made }, styles: { base: { color: "#222", fontSize: "16px" } } }); }
                    made++;
                    blocks.push({ id: rid("b"), type: "container", content: {}, children: kids });
                }
                doc.pages[active].blocks = blocks;
                selectedId = null;
                if (cmdStore && window.LimeCommands) { cmdStore = window.LimeCommands.createStore(doc); cmdPrev = JSON.stringify(doc); }
                this.reset();
                var t0 = perfNow();
                render();
                var dt = perfNow() - t0;
                var total = blocks.length + blocks.reduce(function (a, b) { return a + b.children.length; }, 0);
                this.reset(); // сам load не засчитываем в статистику правок
                console.log("[LIME PERF] load(" + n + "): open render " + dt.toFixed(1) + "ms, ~" + total + " nodes. Делай правки и зови __LIME_PERF__.report()");
                return { nodes: total, openMs: +dt.toFixed(1) };
            }
        };
    }
    var cmdPrev = cmdStore ? JSON.stringify(doc) : null; // doc-снапшот предыдущей точки истории

    function snapshot() { return JSON.stringify({ doc: doc, active: active }); }
    function pushHistory() {
        if (cmdStore) {
            var after = JSON.stringify(doc);
            cmdStore.recordState(cmdPrev, after); // before===after (в т.ч. после undo) → no-op, без петли
            cmdPrev = after;
            updateHistButtons();
            return;
        }
        var snap = snapshot();
        if (histPos >= 0 && hist[histPos] === snap) return; // состояние не изменилось
        hist = hist.slice(0, histPos + 1);
        hist.push(snap);
        if (hist.length > HIST_MAX) hist.shift();
        histPos = hist.length - 1;
        updateHistButtons();
    }
    // Выполнить точечную команду, если command-store активен и понимает эту структуру.
    // После dispatch синхронизируем checkpoint-курсор: следующий markDirty не должен записать
    // поверх op-команды дублирующий полный state-снапшот.
    function commitPendingCommandEdits() {
        commitInlineEdit();
        commitStyleEdit();
        commitBlockEdit();
    }
    // Document-level мутации (class/component/page/theme) пока остаются атомарными state-checkpoint.
    // Барьер ОБЯЗАН вызываться до изменения doc: иначе открытый debounce-жест и следующая
    // snapshot-мутация меняют один объект, а их записи попадают в history в обратном порядке.
    function beginCheckpointMutation() {
        if (!cmdStore) return;
        commitPendingCommandEdits();
        cmdPrev = JSON.stringify(doc);
    }
    function runCommand(type, payload) {
        commitPendingCommandEdits();
        if (!cmdStore || !cmdStore.dispatch(type, payload)) return false;
        doc = cmdStore.getDoc();
        cmdPrev = JSON.stringify(doc);
        updateHistButtons();
        return true;
    }
    function runCommands(items, label) {
        commitPendingCommandEdits();
        if (!cmdStore) return false;
        cmdStore.begin(label || "batch");
        var changed = false;
        for (var i = 0; i < items.length; i++) {
            if (cmdStore.dispatch(items[i].type, items[i].payload)) changed = true;
        }
        cmdStore.commit(label || "batch");
        doc = cmdStore.getDoc();
        cmdPrev = JSON.stringify(doc);
        updateHistButtons();
        return changed;
    }
    // Частый шов для media/content-инспектора (image/gallery/video/embed). У компонента-инстанса
    // content-правки локальны: пишем в overrides.content, не трогая definition и другие копии —
    // тем же путём, что inline-текст (6.2). Это закрывает «overrides изображений» из §8 этап 6.
    function setContentValue(source, field, value, remove) {
        var componentInstance = source && source.type === "component" && componentRecord(source.ref);
        if (componentInstance) {
            if (runCommand("setComponentContentOverride", { id: source.id, field: field, value: value, remove: !!remove })) {
                patchBlockDom(source.id); scheduleAutosave(); // Stage 7: точечно вместо полного render
                return true;
            }
            beginCheckpointMutation();
            setComponentContentOverrideLocal(source, field, value, !!remove);
            patchBlockDom(source.id); markDirty();
            return true;
        }
        var target = targetBlock(source);
        if (!target) return false;
        if (cmdStore && target === source) {
            var changed = runCommand("setContent", {
                id: source.id, field: field, value: value, remove: !!remove
            });
            patchBlockDom(source.id); // Stage 7: точечно вместо полного render
            if (changed) scheduleAutosave();
            return true;
        }
        beginCheckpointMutation();
        if (!target.content) target.content = {};
        if (remove) deleteByPath(target.content, field);
        else setByPath(target.content, field, value);
        patchBlockDom(source.id); markDirty();
        return true;
    }
    function setBlockValue(source, prop, value, remove) {
        var target = targetBlock(source);
        if (!target) return false;
        if (cmdStore && target === source) {
            var changed = runCommand("setBlockProp", {
                id: source.id, prop: prop, value: value, remove: !!remove
            });
            patchBlockDom(source.id, { allowChildren: true, refreshDesign: true });
            if (changed) scheduleAutosave();
            return true;
        }
        beginCheckpointMutation();
        if (remove) delete target[prop]; else target[prop] = value;
        if (target === source) patchBlockDom(source.id, { allowChildren: true, refreshDesign: true });
        else render();
        markDirty();
        return true;
    }
    function setDesignValue(source, breakpoint, field, value, remove) {
        var target = designTarget(source, field);
        if (!target) return false;
        if (cmdStore && target === source) {
            var changed = runCommand("setDesign", {
                id: source.id, breakpoint: breakpoint, field: field, value: value, remove: !!remove
            });
            patchBlockDom(source.id, { allowChildren: true, refreshDesign: true });
            if (changed) scheduleAutosave();
            return true;
        }
        beginCheckpointMutation();
        if (!target.design) target.design = {};
        if (!target.design[breakpoint]) target.design[breakpoint] = {};
        if (remove) delete target.design[breakpoint][field]; else target.design[breakpoint][field] = value;
        if (target === source) patchBlockDom(source.id, { allowChildren: true, refreshDesign: true });
        else render();
        markDirty();
        return true;
    }
    function finishMutation(commandApplied) {
        render();
        if (commandApplied) scheduleAutosave();
        else markDirty();
    }
    function restoreSnapshot(snap) {
        clearTimeout(editDebounce);
        var s = JSON.parse(snap);
        doc = s.doc;
        active = Math.min(s.active, doc.pages.length - 1);
        selectedId = null;
        refreshPages(); refreshComponents(); render();
        if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.clear();
        markDirty(); // откат — тоже изменение, его надо автосохранить
    }
    // Постпроцесс восстановления документа из command-store (D2): rebind doc + перерисовка.
    function afterCmdRestore() {
        clearTimeout(editDebounce);
        doc = cmdStore.getDoc();
        active = Math.min(active, doc.pages.length - 1);
        selectedId = null;
        cmdPrev = JSON.stringify(doc); // markDirty→recordState станет no-op (before===after)
        refreshPages(); refreshComponents(); render();
        // Выделение переживает undo/redo (Figma-like): оставляем только выжившие узлы (удалённые
        // откатом выпадают), затем форсим ре-эмит — subscribe→syncLegacy восстанавливает legacy
        // selectedId/инспектор, а refresh репозиционирует боксы под свежий DOM. Это и устраняет
        // прежний рассинхрон (боксы на старых позициях + пустой legacy), но НЕ теряя выбор.
        if (window.__LIME_SELECTION__) {
            var keepSel = window.__LIME_SELECTION__.get().ids.filter(function (id) {
                return !!ws.querySelector('[data-block-id="' + id + '"]');
            });
            window.__LIME_SELECTION__.replace([]);
            window.__LIME_SELECTION__.replace(keepSel);
        }
        scheduleAutosave();
        updateHistButtons();
    }
    function undo() {
        commitInlineEdit();
        commitStyleEdit();
        commitBlockEdit();
        if (cmdStore) { if (cmdStore.undo()) afterCmdRestore(); return; }
        if (histPos <= 0) return;
        histPos--;
        restoreSnapshot(hist[histPos]);
        updateHistButtons();
    }
    function redo() {
        commitInlineEdit();
        commitStyleEdit();
        commitBlockEdit();
        if (cmdStore) { if (cmdStore.redo()) afterCmdRestore(); return; }
        if (histPos >= hist.length - 1) return;
        histPos++;
        restoreSnapshot(hist[histPos]);
        updateHistButtons();
    }
    function updateHistButtons() {
        var u = document.querySelector("[data-doc-undo]");
        var r = document.querySelector("[data-doc-redo]");
        if (cmdStore) {
            if (u) u.disabled = !cmdStore.canUndo();
            if (r) r.disabled = !cmdStore.canRedo();
            return;
        }
        if (u) u.disabled = histPos <= 0;
        if (r) r.disabled = histPos >= hist.length - 1;
    }
    var undoBtn = document.querySelector("[data-doc-undo]");
    var redoBtn = document.querySelector("[data-doc-redo]");
    if (undoBtn) undoBtn.addEventListener("click", undo);
    if (redoBtn) redoBtn.addEventListener("click", redo);
    // В текстовых полях/contenteditable горячие клавиши блоков не перехватываем (печать важнее).
    function isTextField(e) {
        var t = e.target;
        return !!(t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"));
    }
    document.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        var k = (e.key || "").toLowerCase();
        // Перехватываем и внутри contenteditable: наш стек снапшотов включает текст
        // (фиксация через debounce), нативный undo браузера дал бы рассинхрон с doc.
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
        // Copy/paste/duplicate блока — только когда фокус не в тексте (этап 0.4).
        else if (k === "c" && !isTextField(e) && selectedId) { e.preventDefault(); copyBlock(); }
        else if (k === "v" && !isTextField(e) && readClip()) { e.preventDefault(); pasteBlock(); }
        else if (k === "d" && !isTextField(e) && selectedId) { e.preventDefault(); dupBlock(); }
    });
    // Delete — удалить выбранный блок; Esc — снять выбор / закрыть контекст-меню (этап 0.4).
    document.addEventListener("keydown", function (e) {
        if (e.ctrlKey || e.metaKey || isTextField(e)) return;
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); delBlock(); }
        else if (e.key === "Escape") { hideCtxMenu(); if (selectedId) deselect(); }
    });

    // ===== RENDER =====
    function render() {
        var __pt = perfNow();
        if (pageBlocks().length === 0) {
            // Этап 9.4: «пустое состояние» с подсказкой и быстрыми действиями вместо голого текста.
            ws.innerHTML = '<div class="lime-workspace__placeholder" data-doc-empty>' +
                '<div class="lime-workspace__placeholder-icon">✨</div>' +
                '<div class="lime-workspace__placeholder-title">Страница «' + escapeText(doc.pages[active].title) + '» пуста</div>' +
                '<div class="lime-workspace__placeholder-hint">Добавь блок из панели слева, начни с обложки или сгенерируй страницу с AI.</div>' +
                '<div class="lime-workspace__placeholder-actions">' +
                    '<button type="button" class="lime-btn lime-btn--primary lime-btn--sm" data-doc-empty-add="cover">Добавить обложку</button>' +
                    '<button type="button" class="lime-btn lime-btn--violet lime-btn--sm" data-doc-empty-ai>✨ Сгенерировать с AI</button>' +
                '</div></div>';
        } else {
            // Рендерим только активную страницу (тема и компоненты — общие на сайт).
            // data — превью схемы коллекций для блока collectionList (реальные записи — на публикации).
            ws.innerHTML = L.render({ theme: doc.theme, components: doc.components, blocks: pageBlocks() }, { editable: true, data: editorCollectionData(), record: templateSampleRecord() }).body;
        }
        applyPreviewStyles();
        ensureDocFonts(); // подгрузить шрифты документа (undo/redo, шаблоны, AI, смена страницы)
        if (selectedId) {
            var sel = ws.querySelector('[data-block-id="' + selectedId + '"]');
            if (sel) sel.classList.add("is-selected");
        }
        refreshInspector();
        refreshLayers(); // дерево слоёв синхронно с холстом (этап 0.4)
        initDnD(); // DOM пересобран — пересоздаём sortable-зоны
        initLayerDrag(); // и навешиваем drag на декор-слои
        refreshV2SelectionOverlay();
        perfRec("full", __pt);
    }

    // Отложенный refresh дерева слоёв (Stage 7): серия быстрых правок не перестраивает дерево
    // на каждую — один rAF на пачку. Имя/тип/видимость в слоях не критичны мгновенно.
    var layersRefreshPending = false;
    function scheduleLayersRefresh() {
        if (layersRefreshPending) return;
        layersRefreshPending = true;
        var run = function () { layersRefreshPending = false; refreshLayers(); };
        if (window.requestAnimationFrame) window.requestAnimationFrame(run); else setTimeout(run, 0);
    }

    // Stage 7: точечное обновление DOM одного блока вместо полной пересборки workspace.innerHTML.
    // Применяется к content-правкам (текст/медиа/props), которые НЕ меняют структуру детей.
    // Безопасный gate: если у блока есть дочерняя drop-зона (контейнер), Sortable пришлось бы
    // пересоздавать — тогда откатываемся на полный render(). Делегированные обработчики (на ws)
    // переживают replace; Sortable родителя не трогаем (позиция узла та же).
    function patchBlockDom(id, opts) {
        opts = opts || {};
        var __pt = perfNow();
        var sec = id && ws.querySelector('[data-block-id="' + id + '"]');
        var r = id && findBlock(id);
        if (!sec || !r || !r.block) { render(); return false; }
        var tmp = document.createElement("div");
        tmp.innerHTML = L.renderOneBlock(r.block, doc.components, { editable: true, data: editorCollectionData(), record: templateSampleRecord() });
        var fresh = tmp.firstElementChild;
        // Нет элемента или есть дочерние drop-зоны → безопасный полный путь.
        if (!fresh || (!opts.allowChildren && fresh.querySelector(".lime-block__children"))) { render(); return false; }
        sec.replaceWith(fresh);
        if (id === selectedId) fresh.classList.add("is-selected");
        if (opts.refreshDesign) applyPreviewStyles(); else applyPreviewStylesScoped(fresh);
        if (fresh.querySelector(".lime-block__children")) initDnD();
        initLayerDrag();
        ensureDocFonts();
        if (canvasOn) refreshV2SelectionOverlay();
        scheduleLayersRefresh();
        perfRec("inc", __pt);
        return true;
    }

    // Stage 7: точечная вставка DOM нового блока в список родителя (или страницы) по индексу.
    // false → caller делает полный render() (страховка). Модель уже изменена к этому моменту.
    function insertBlockDom(block, parentId, index, opts) {
        opts = opts || {};
        var __pt = perfNow();
        // В компонент-инстанс (дети резолвятся из определения) точечно не вставляем — полный путь.
        if (parentId) { var pb = byId(parentId); if (!pb || pb.type === "component") return false; }
        // v2 design-блок (frame/layout): его CSS живёт в основном <style>/design-preview, которые
        // точечная вставка не пересобирает → безопаснее полный render (редко: dup free-child и т.п.).
        if (block && block.design && !opts.allowDesign) return false;
        var listEl;
        if (parentId) {
            var ps = ws.querySelector('[data-block-id="' + parentId + '"]');
            listEl = ps ? ps.querySelector(":scope > .lime-block__inner > .lime-block__children") : null;
        } else {
            listEl = ws.querySelector(".lime-doc-page");
        }
        if (!listEl) return false; // пустая страница (placeholder) / список не найден
        var tmp = document.createElement("div");
        tmp.innerHTML = L.renderOneBlock(block, doc.components, { editable: true, data: editorCollectionData(), record: templateSampleRecord() });
        var fresh = tmp.firstElementChild;
        if (!fresh) return false;
        var items = listEl.querySelectorAll(":scope > .lime-block");
        if (index == null || index >= items.length) listEl.appendChild(fresh);
        else listEl.insertBefore(fresh, items[index]);
        if (block.id === selectedId) fresh.classList.add("is-selected");
        if (opts.refreshDesign) applyPreviewStyles(); else applyPreviewStylesScoped(fresh);
        ensureDocFonts();
        initDnD();        // idempotent: Sortable только для новых вложенных списков fresh
        initLayerDrag();
        if (canvasOn) refreshV2SelectionOverlay();
        scheduleLayersRefresh();
        perfRec("inc", __pt);
        return true;
    }
    // Stage 7: точечное удаление DOM узла. false → caller делает полный render().
    function removeBlockDom(id) {
        var __pt = perfNow();
        if (pageBlocks().length === 0) return false; // страница опустела → нужен placeholder
        var el = ws.querySelector('[data-block-id="' + id + '"]');
        if (!el) return false;
        el.remove();
        initDnD();        // idempotent: чистит Sortable выпавшего поддерева
        if (canvasOn) refreshV2SelectionOverlay();
        scheduleLayersRefresh();
        perfRec("inc", __pt);
        return true;
    }
    function removeBlocksDom(ids) {
        var __pt = perfNow();
        if (pageBlocks().length === 0) return false;
        var removed = 0;
        for (var i = 0; i < ids.length; i++) {
            var el = ws.querySelector('[data-block-id="' + ids[i] + '"]');
            if (!el) return false;
            el.remove();
            removed++;
        }
        if (!removed) return false;
        initDnD();
        if (canvasOn) refreshV2SelectionOverlay();
        scheduleLayersRefresh();
        perfRec("inc", __pt);
        return true;
    }
    function finishInsert(block, parentId, index, commandApplied) {
        if (insertBlockDom(block, parentId, index)) refreshInspector(); else render();
        if (commandApplied) scheduleAutosave(); else markDirty();
    }
    function finishRemove(id, commandApplied) {
        if (removeBlockDom(id)) refreshInspector(); else render();
        if (commandApplied) scheduleAutosave(); else markDirty();
    }
    // Stage 7: точечное перемещение СУЩЕСТВУЮЩЕГО DOM-узла в список родителя по индексу (кнопочные
    // move/unwrap; для DnD Sortable уже двигает DOM сам). Поддерево узла переезжает целиком — его
    // вложенные Sortable переживают (списки не пересоздаём). false → caller делает полный render().
    function moveBlockDom(id, parentId, index) {
        var __pt = perfNow();
        if (parentId) { var pb = byId(parentId); if (!pb || pb.type === "component") return false; }
        // v2 design-блок (frame/size зависят от родителя) → его CSS в основном <style> мог измениться;
        // точечный путь его не пересобирает, поэтому безопаснее полный render.
        var blk = byId(id); if (blk && blk.design) return false;
        var el = ws.querySelector('[data-block-id="' + id + '"]');
        if (!el) return false;
        var listEl;
        if (parentId) {
            var ps = ws.querySelector('[data-block-id="' + parentId + '"]');
            listEl = ps ? ps.querySelector(":scope > .lime-block__inner > .lime-block__children") : null;
        } else {
            listEl = ws.querySelector(".lime-doc-page");
        }
        if (!listEl) return false;
        var items = [].slice.call(listEl.querySelectorAll(":scope > .lime-block")).filter(function (x) { return x !== el; });
        if (el.parentNode) el.parentNode.removeChild(el);
        if (index == null || index >= items.length) listEl.appendChild(el);
        else listEl.insertBefore(el, items[index]);
        applyPreviewStyles(); // новый родитель может менять design-preview (free-frame edge)
        if (canvasOn) refreshV2SelectionOverlay();
        scheduleLayersRefresh();
        perfRec("inc", __pt);
        return true;
    }
    function finishMove(id, parentId, index, commandApplied) {
        if (moveBlockDom(id, parentId, index)) refreshInspector(); else render();
        if (commandApplied) scheduleAutosave(); else markDirty();
    }

    // ===== DRAG-AND-DROP (полировка: SortableJS на всех уровнях вложенности) =====
    // Модель — источник правды: Sortable даёт from/to/oldIndex/newIndex, мы переносим
    // блок между массивами документа и перерисовываем всё из модели.
    var sortables = [];

    // DOM-список → массив блоков в документе.
    function arrayOfList(listEl) {
        if (listEl.classList.contains("lime-doc-page")) return pageBlocks();
        var sec = listEl.closest(".lime-block");
        var b = sec && byId(sec.getAttribute("data-block-id"));
        if (!b) return null;
        var t = targetBlock(b);
        if (!t.children) t.children = [];
        return t.children;
    }
    function parentIdOfList(listEl) {
        if (listEl.classList.contains("lime-doc-page")) return null;
        var sec = listEl.closest(".lime-block");
        return sec ? sec.getAttribute("data-block-id") : null;
    }
    // Защита от цикла: нельзя бросить контейнер внутрь его собственного поддерева.
    function subtreeOwnsArray(block, arr) {
        var t = targetBlock(block);
        if (!t || !t.children) return false;
        if (t.children === arr) return true;
        for (var i = 0; i < t.children.length; i++) {
            if (subtreeOwnsArray(t.children[i], arr)) return true;
        }
        return false;
    }
    function onDragEnd(evt) {
        var fromArr = arrayOfList(evt.from);
        var toArr = arrayOfList(evt.to);
        if (!fromArr || !toArr) { render(); return; }
        if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
        var moved = fromArr[evt.oldIndex];
        if (!moved || subtreeOwnsArray(moved, toArr)) { render(); return; }
        var commandApplied = fromArr === toArr
            ? runCommand("reorderBlock", {
                id: moved.id,
                toIndex: Math.min(evt.newIndex, toArr.length - 1)
            })
            : runCommand("moveBlock", {
                id: moved.id,
                parentId: parentIdOfList(evt.to),
                pageIndex: active,
                toIndex: Math.min(evt.newIndex, toArr.length)
            });
        if (!commandApplied) {
            fromArr.splice(evt.oldIndex, 1);
            toArr.splice(Math.min(evt.newIndex, toArr.length), 0, moved);
        }
        selectedId = moved.id;
        // v2 design-блок: CSS frame/size зависит от родителя и живёт в основном <style> → полный render.
        if (moved.design) { finishMutation(commandApplied); return; }
        // Stage 7: Sortable УЖЕ переместил DOM-узел в нужную позицию, модель синхронна → полная
        // пересборка не нужна, только вспомогательный UI (design-preview зависит от нового родителя).
        var __dt = perfNow();
        applyPreviewStyles();
        refreshInspector();
        if (canvasOn) refreshV2SelectionOverlay();
        scheduleLayersRefresh();
        perfRec("inc", __dt);
        if (commandApplied) scheduleAutosave(); else markDirty();
    }
    // Идемпотентно (Stage 7): создаёт Sortable только для НОВЫХ списков, выпавшие из DOM — чистит.
    // Для полного render() поведение прежнее (innerHTML заменил всё → старые списки detached →
    // destroy, новые → create). Для точечных insert/remove пересоздаётся только затронутый список,
    // а не все 500. Метка `__limeDnd` на элементе-списке (не зависим от версии Sortable.get).
    function initDnD() {
        if (!window.Sortable) return;
        var kept = [];
        for (var i = 0; i < sortables.length; i++) {
            var s = sortables[i];
            if (s.el && ws.contains(s.el)) { kept.push(s); continue; }
            try { if (s.el) delete s.el.__limeDnd; s.destroy(); } catch (e) { /* DOM уже выброшен */ }
        }
        sortables = kept;
        var lists = [];
        var page = ws.querySelector(".lime-doc-page");
        if (page) lists.push(page);
        var kids = ws.querySelectorAll(".lime-block__children");
        for (var k = 0; k < kids.length; k++) lists.push(kids[k]);
        for (var j = 0; j < lists.length; j++) {
            if (lists[j].__limeDnd) continue; // уже есть Sortable — не трогаем
            var inst = new window.Sortable(lists[j], {
                group: "lime-doc",
                handle: ".lime-block-grip",
                draggable: ".lime-block",
                animation: 160,
                fallbackOnBody: true,
                invertSwap: true,
                ghostClass: "sortable-ghost",
                onEnd: onDragEnd
            });
            lists[j].__limeDnd = inst;
            sortables.push(inst);
        }
    }

    // Инлайн эффективных стилей текущего брейкпоинта для ОДНОГО блок-элемента (live preview).
    function styleBlockEl(el) {
        var id = el.getAttribute("data-block-id");
        var b = byId(id);
        if (!b) return;
        var st = readStyles(b); // у инстанса — эффективные (definition ⊕ overrides.styles)
        // Классы — база (0.1), свой стиль блока перебивает их.
        var decls = effectiveClassStyles(b);
        Object.assign(decls, effective(st, currentBp));
        // При редактировании наведения показываем вид :hover прямо в холсте у выбранного блока.
        if (currentState === "hover" && id === selectedId) {
            if (currentClass) {
                var cdef = findClassDef(currentClass);
                if (cdef && cdef.styles && cdef.styles.hover) Object.assign(decls, cdef.styles.hover);
            } else if (st && st.hover) {
                Object.assign(decls, st.hover);
            }
        }
        el.setAttribute("style", declsToCss(decls));
    }
    // Инлайним эффективные стили текущего брейкпоинта поверх <style> движка — точное превью без iframe.
    function applyPreviewStyles() {
        if (canvasOn && L.compilePreviewDesignCss && pageBlocks().length) {
            var designStyle = ws.querySelector("style[data-lime-design-preview]");
            if (!designStyle) {
                designStyle = document.createElement("style");
                designStyle.setAttribute("data-lime-design-preview", "");
                ws.appendChild(designStyle);
            }
            designStyle.textContent = L.compilePreviewDesignCss(pageBlocks(), doc.components, currentBp);
        }
        var blocks = ws.querySelectorAll(".lime-block");
        for (var i = 0; i < blocks.length; i++) styleBlockEl(blocks[i]);
    }
    // Точечная версия для Stage 7 patchBlockDom: стили только для свежего поддерева (content-правка
    // не меняет design → перекомпилировать общий design-preview <style> не нужно).
    function applyPreviewStylesScoped(rootEl) {
        styleBlockEl(rootEl);
        var inner = rootEl.querySelectorAll(".lime-block");
        for (var i = 0; i < inner.length; i++) styleBlockEl(inner[i]);
    }

    // Подключает в редакторе <link> для всех шрифтов, реально используемых в документе
    // (тема + любой styles.*.fontFamily) — живое превью. На публикации шрифты грузит сервер.
    function ensureDocFonts() {
        if (!window.LimeFonts) return;
        var seen = {};
        if (doc.theme && doc.theme.font) seen[doc.theme.font] = 1;
        var json = JSON.stringify(doc), re = /"fontFamily":"((?:[^"\\]|\\.)*)"/g, m;
        while ((m = re.exec(json))) seen[m[1].replace(/\\"/g, '"')] = 1;
        Object.keys(seen).forEach(function (st) { window.LimeFonts.ensureFromStack(st); });
    }

    // ===== INLINE CONTENT EDIT (без ре-рендера) =====
    var editDebounce;
    var editTxn = false;
    var editTxnKey = null;
    function commitInlineEdit() {
        clearTimeout(editDebounce);
        if (!editTxn || !cmdStore) return;
        cmdStore.commit("inline-content");
        editTxn = false;
        editTxnKey = null;
        doc = cmdStore.getDoc();
        cmdPrev = JSON.stringify(doc);
        updateHistButtons();
        scheduleAutosave();
    }
    ws.addEventListener("input", function (e) {
        var f = e.target.closest("[data-field]");
        if (!f) return;
        var sec = f.closest(".lime-block");
        if (!sec) return;
        var b = byId(sec.getAttribute("data-block-id"));
        if (!b) return;
        var field = f.getAttribute("data-field");
        var value = f.textContent;
        var directBlock = targetBlock(b) === b; // component definition пока остаётся checkpoint
        var componentInstance = b.type === "component" && doc.components[b.ref];
        if (cmdStore && (directBlock || componentInstance)) {
            commitStyleEdit();
            commitBlockEdit();
            var key = b.id + ":" + field;
            if (editTxn && editTxnKey !== key) commitInlineEdit();
            if (!editTxn) {
                cmdStore.begin("inline-content");
                editTxn = true;
                editTxnKey = key;
            }
            var commandType = componentInstance ? "setComponentContentOverride" : "setContent";
            if (cmdStore.dispatch(commandType, { id: b.id, field: field, value: value })) {
                doc = cmdStore.getDoc();
                clearTimeout(editDebounce);
                editDebounce = setTimeout(commitInlineEdit, 600);
                return;
            }
            cmdStore.cancel();
            editTxn = false;
            editTxnKey = null;
        } else beginCheckpointMutation();
        if (componentInstance) setComponentContentOverrideLocal(b, field, value, false);
        else setByPath(targetBlock(b).content, field, value);
        clearTimeout(editDebounce);
        editDebounce = setTimeout(markDirty, 600);
    });

    // ===== SELECTION =====
    ws.addEventListener("click", function (e) {
        if (e.target.closest("[contenteditable]")) return;
        var sec = e.target.closest(".lime-block");
        if (!sec) return;
        selectedId = sec.getAttribute("data-block-id");
        currentState = "normal"; // редактирование hover включается явно в инспекторе
        currentClass = null;      // выбор блока выходит из режима правки класса (0.1)
        var all = ws.querySelectorAll(".is-selected");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("is-selected");
        sec.classList.add("is-selected");
        refreshInspector();
        refreshLayers(); // подсветить выбранный блок в дереве слоёв (0.4)
    });

    // Дерево слоёв: клик по строке — выбрать соответствующий блок в холсте (0.4).
    var layersBox = document.getElementById("lime-doc-layers");
    if (layersBox) {
        layersBox.addEventListener("click", function (e) {
            var row = e.target.closest("[data-doc-layer]");
            if (!row) return;
            var control = e.target.closest("[data-node-toggle-hidden],[data-node-toggle-locked],[data-node-rename],[data-node-z]");
            if (control) {
                e.preventDefault(); e.stopPropagation();
                runLayerControl(row.getAttribute("data-doc-layer"), control);
                return;
            }
            selectById(row.getAttribute("data-doc-layer"));
        });
        // Клавиатурная навигация по дереву слоёв (этап 9.6): ↑/↓ — соседний узел, Home/End — края.
        layersBox.addEventListener("keydown", function (e) {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
            var rows = layerRowsCache || [];
            if (!rows.length) return;
            e.preventDefault();
            var idx = -1;
            for (var i = 0; i < rows.length; i++) { if (rows[i].block.id === selectedId) { idx = i; break; } }
            var next;
            if (e.key === "Home") next = 0;
            else if (e.key === "End") next = rows.length - 1;
            else if (e.key === "ArrowDown") next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1);
            else next = idx < 0 ? rows.length - 1 : Math.max(0, idx - 1);
            selectById(rows[next].block.id);
        });
        layersBox.addEventListener("scroll", function () {
            if (layerScrollQueued) return;
            layerScrollQueued = true;
            var run = function () {
                layerScrollQueued = false;
                renderLayersViewport(layersBox, layerRowsCache, false);
            };
            if (window.requestAnimationFrame) window.requestAnimationFrame(run); else setTimeout(run, 0);
        }, { passive: true });
    }

    // Контекстное меню блока (ПКМ, этап 0.4)
    ws.addEventListener("contextmenu", function (e) {
        var sec = e.target.closest(".lime-block");
        if (!sec) return;
        e.preventDefault();
        showCtxMenu(sec.getAttribute("data-block-id"), e.clientX, e.clientY);
    });

    // ===== MEDIA (image/gallery/video/embed) — module lime-editor-media-actions.js =====
    var mediaActions = EditorMediaActions.create({
        window: window,
        document: document,
        ws: ws,
        EditorMediaPicker: EditorMediaPicker,
        csrfToken: csrfToken,
        byId: byId,
        targetBlock: targetBlock,
        setContentValue: setContentValue,
        setByPath: setByPath,
        hasCmdStore: function () { return !!cmdStore; },
        getCurrentBp: function () { return currentBp; },
        runCommands: runCommands,
        patchBlockDom: patchBlockDom,
        render: render,
        markDirty: markDirty,
        scheduleAutosave: scheduleAutosave
    });
    function openMediaPicker(blockId, field, target) { mediaActions.openMediaPicker(blockId, field, target); }
    function applyPickedMedia(pickCtx, url) { mediaActions.applyPickedMedia(pickCtx, url); }
    function promptVideo(blockId) { mediaActions.promptVideo(blockId); }
    function promptEmbed(blockId) { mediaActions.promptEmbed(blockId); }

    // ===== ADD BLOCK =====
    // Этап 1: если выбран контейнер/колонки — новый блок добавляется ВНУТРЬ него.
    var addBtns = document.querySelectorAll("[data-doc-add]");
    for (var a = 0; a < addBtns.length; a++) {
        addBtns[a].addEventListener("click", function (e) {
            e.stopPropagation();
            // Если только что был drag-and-drop из палитры — click не дублирует вставку (DnD A).
            if (paletteJustDragged) { paletteJustDragged = false; return; }
            var b = L.createBlock(this.dataset.docAdd);
            var sel = selectedId ? findBlock(selectedId) : null;
            var t = sel ? targetBlock(sel.block) : null;
            var intoContainer = t && L.isContainer(t.type);
            var commandApplied = runCommand("insertBlock", {
                block: b,
                parentId: intoContainer ? sel.block.id : null,
                pageIndex: active,
                index: intoContainer ? ((t.children && t.children.length) || 0) : pageBlocks().length
            });
            if (!commandApplied) {
                if (intoContainer) {
                    if (!t.children) t.children = [];
                    t.children.push(b);
                } else {
                    pageBlocks().push(b);
                }
            }
            selectedId = b.id;
            finishInsert(b, intoContainer ? sel.block.id : null, null, commandApplied); // Stage 7: append
            // V2 (canvas): держим selection-store в синхроне с legacy. Иначе add-block двигает
            // только legacy selectedId, V2-стор застревает на прежнем блоке, и повторный выбор
            // того же узла через стор становится no-op (replace при равенстве не эмитит) →
            // инспектор/overlay не обновляются. Guard: в legacy-режиме (без canvas) ничего не меняется.
            if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.replace([b.id]);
        });
    }

    // Этап 9.4: быстрые действия из пустого состояния холста (делегировано на ws — переживает render).
    ws.addEventListener("click", function (e) {
        var addBtn = e.target.closest("[data-doc-empty-add]");
        if (addBtn) {
            e.stopPropagation();
            var tile = document.querySelector('[data-doc-add="' + addBtn.getAttribute("data-doc-empty-add") + '"]');
            if (tile) tile.click();
            return;
        }
        if (e.target.closest("[data-doc-empty-ai]")) {
            // Гасим всплытие: иначе клик дойдёт до stage/др. обработчиков канваса.
            e.stopPropagation();
            aiOpen();
        }
    });

    EditorSidebar.create({ document: document, window: window });

    // ===== PRESET SECTIONS (Фаза 3.1): готовая красивая секция в один клик =====
    function insertPreset(key) {
        var lib = window.LimePresets && window.LimePresets.PRESETS;
        var specs = lib && lib[key];
        if (!specs || !specs.length) return;
        var sel = selectedId ? findBlock(selectedId) : null;
        var t = sel ? targetBlock(sel.block) : null;
        var target = (t && L.isContainer(t.type)) ? (t.children || (t.children = [])) : pageBlocks();
        var firstId = null;
        specs.forEach(function (spec) {
            var b = blockFromSpec(spec);
            if (!firstId) firstId = b.id;
            target.push(b);
        });
        selectedId = null;
        render(); markDirty();
        var el = firstId && ws.querySelector('[data-block-id="' + firstId + '"]');
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Старт с готового шаблона (Фаза 3.2): тема + набор готовых секций.
    function applyTemplateByKey(key) {
        var list = window.LimeTemplates || [];
        var tpl = null;
        for (var i = 0; i < list.length; i++) if (list[i].key === key) { tpl = list[i]; break; }
        if (!tpl) return false;
        if (tpl.theme) Object.keys(tpl.theme).forEach(function (k) { doc.theme[k] = tpl.theme[k]; });
        var lib = window.LimePresets && window.LimePresets.PRESETS;
        (tpl.sections || []).forEach(function (secKey) {
            var specs = lib && lib[secKey];
            if (specs) specs.forEach(function (spec) { pageBlocks().push(blockFromSpec(spec)); });
        });
        return true;
    }

    // Плитки готовых секций — из LimePresets.META (DRY), клики через делегирование.
    var presetsBox = document.getElementById("lime-doc-presets");
    if (presetsBox && window.LimePresets && window.LimePresets.META) {
        presetsBox.innerHTML = window.LimePresets.META.map(function (m) {
            return '<button type="button" class="lime-block-tile" data-doc-preset="' + m.key + '">' +
                '<span class="lime-block-tile__icon">' + m.icon + '</span><span>' + m.label + '</span></button>';
        }).join("");
        presetsBox.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-doc-preset]");
            if (btn) { e.stopPropagation(); insertPreset(btn.dataset.docPreset); }
        });
    }

    // ===== BLOCK ACTIONS / CLIPBOARD / SELECTION — module lime-editor-block-actions.js =====
    var blockActions = EditorBlockActions.create({
        window: window,
        document: document,
        L: L,
        ws: ws,
        getSelectedId: function () { return selectedId; },
        setSelectedId: function (value) { selectedId = value; },
        setCurrentState: function (value) { currentState = value; },
        setCurrentClass: function (value) { currentClass = value; },
        getCurrentBp: function () { return currentBp; },
        getActive: function () { return active; },
        hasCmdStore: function () { return !!cmdStore; },
        pageBlocks: pageBlocks,
        findBlock: findBlock,
        targetBlock: targetBlock,
        resolvedBlockDesign: resolvedBlockDesign,
        clone: clone,
        reid: reid,
        runCommand: runCommand,
        beginCheckpointMutation: beginCheckpointMutation,
        finishInsert: finishInsert,
        finishRemove: finishRemove,
        finishMove: finishMove,
        finishMutation: finishMutation,
        removeBlocksDom: removeBlocksDom,
        insertBlockDom: insertBlockDom,
        removeBlockDom: removeBlockDom,
        refreshInspector: refreshInspector,
        refreshLayers: refreshLayers,
        render: render,
        scheduleAutosave: scheduleAutosave,
        markDirty: markDirty,
        setStatus: setStatus,
        v2SelectionIds: function () { return v2SelectionIds(); }
    });
    function moveBlock(dir) { blockActions.moveBlock(dir); }
    function dupBlock() { blockActions.dupBlock(); }
    function delBlock() { blockActions.delBlock(); }
    function unwrapBlock() { blockActions.unwrapBlock(); }
    function groupSelection() { blockActions.groupSelection(); }
    function ungroupBlock() { blockActions.ungroupBlock(); }
    function copyBlock() { blockActions.copyBlock(); }
    function readClip() { return blockActions.readClip(); }
    function pasteBlock() { blockActions.pasteBlock(); }
    function selectById(id) { blockActions.selectById(id); }
    function deselect() { blockActions.deselect(); }
    // ===== ДЕРЕВО СЛОЁВ (outline-навигатор, этап 0.4) =====
    var layerRowsCache = [];
    var layerScrollQueued = false;
    var layerHelpers = EditorLayers.create({
        escapeText: escapeText,
        getComponents: function () { return doc.components || {}; },
        getCurrentBp: function () { return currentBp; },
        getSelectedId: function () { return selectedId; },
        isCanvasOn: function () { return canvasOn; },
        isContainer: function (type) { return L.isContainer(type); },
        resolvedBlockDesign: resolvedBlockDesign,
        targetBlock: targetBlock
    });
    var blockLabel = layerHelpers.blockLabel;
    function applyNodeCommand(type, payload, fallback) {
        if (cmdStore) {
            var changed = runCommand(type, payload);
            if (changed) { render(); scheduleAutosave(); }
            return changed;
        }
        fallback();
        render(); markDirty();
        return true;
    }
    function runLayerControl(id, control) {
        var b = byId(id);
        if (!b) return;
        if (control.hasAttribute("data-node-toggle-hidden")) {
            var hidden = !b.hidden;
            applyNodeCommand("setNodeHidden", { id: id, value: hidden }, function () {
                if (hidden) b.hidden = true; else delete b.hidden;
            });
            return;
        }
        if (control.hasAttribute("data-node-toggle-locked")) {
            var locked = !b.locked;
            applyNodeCommand("setNodeLocked", { id: id, value: locked }, function () {
                if (locked) b.locked = true; else delete b.locked;
            });
            return;
        }
        if (control.hasAttribute("data-node-rename")) {
            var name = window.prompt("Имя слоя:", b.name || blockLabel(b));
            if (name == null || name.trim().length > 120) return;
            applyNodeCommand("renameNode", { id: id, name: name }, function () {
                name = name.trim(); if (name) b.name = name; else delete b.name;
            });
            return;
        }
        if (control.hasAttribute("data-node-z")) {
            var delta = parseInt(control.getAttribute("data-node-z"), 10) || 0;
            var current = resolvedBlockDesign(b, currentBp).zIndex;
            current = typeof current === "number" && isFinite(current) ? Math.round(current) : 0;
            var next = Math.max(-1000, Math.min(1000, current + delta));
            applyNodeCommand("setNodeZIndex", { id: id, breakpoint: currentBp, value: next }, function () {
                if (!b.design) b.design = {};
                if (!b.design[currentBp]) b.design[currentBp] = {};
                b.design[currentBp].zIndex = next;
            });
        }
    }
    function refreshLayers() {
        var box = document.getElementById("lime-doc-layers");
        if (!box) return;
        layerRowsCache = layerHelpers.flattenRows(pageBlocks());
        renderLayersViewport(box, layerRowsCache, true);
    }
    function renderLayersViewport(box, rows, keepSelectionVisible) {
        layerHelpers.renderViewport(box, rows, keepSelectionVisible);
    }

    // ===== КОНТЕКСТНОЕ МЕНЮ блока (ПКМ, этап 0.4) =====
    var contextMenu = EditorContextMenu.create({
        document: document,
        iconHtml: ico,
        onRun: runBlockOp,
        window: window
    });
    function hideCtxMenu() { contextMenu.close(); }
    function showCtxMenu(id, x, y) {
        hideCtxMenu();
        selectById(id);
        var r = findBlock(id);
        contextMenu.open({
            hasClip: !!readClip(),
            nested: !!(r && r.parentBlock),
            x: x,
            y: y
        });
    }

    // Единая точка операций над выбранным блоком (контекст-меню + горячие клавиши).
    function runBlockOp(op) {
        if (!selectedId) return;
        if (op === "dup") dupBlock();
        else if (op === "copy") copyBlock();
        else if (op === "paste") pasteBlock();
        else if (op === "aiedit") aiEditBlock();
        else if (op === "aisuggest") aiSuggest();
        else if (op === "aimobile") aiAdaptMobile();
        else if (op === "up") moveBlock(-1);
        else if (op === "down") moveBlock(1);
        else if (op === "unwrap") unwrapBlock();
        else if (op === "del") delBlock();
    }

    // ===== COMPONENTS — module lime-editor-component-actions.js =====
    var componentActions = EditorComponentActions.create({
        window: window,
        document: document,
        L: L,
        getDoc: function () { return doc; },
        getSelectedId: function () { return selectedId; },
        setSelectedId: function (value) { selectedId = value; },
        pageBlocks: pageBlocks,
        findBlock: findBlock,
        componentRecord: componentRecord,
        componentVariantRecord: componentVariantRecord,
        componentSourceBlock: componentSourceBlock,
        rid: rid,
        reid: reid,
        clone: clone,
        escapeText: escapeText,
        beginCheckpointMutation: beginCheckpointMutation,
        runCommand: runCommand,
        finishMutation: finishMutation,
        finishInsert: finishInsert,
        render: render,
        markDirty: markDirty,
        section: function (title, body) { return sec(title, body); }
    });
    function makeComponent() { componentActions.makeComponent(); }
    function addComponentVariantFromInstance() { componentActions.addComponentVariantFromInstance(); }
    function setComponentVariant(value) { componentActions.setComponentVariant(value); }
    function detachComponent() { componentActions.detachComponent(); }
    function resetComponentOverrides() { componentActions.resetComponentOverrides(); }
    function insertComponent(cid) { componentActions.insertComponent(cid); }
    function refreshComponents() { componentActions.refreshComponents(); }
    function componentVariantControls(inst) { return componentActions.componentVariantControls(inst); }
    function componentPropsSection(block) { return componentActions.componentPropsSection(block); }
    // ===== PAGES — module lime-editor-pages.js =====
    var pagesApi = EditorPages.create({
        window: window,
        document: document,
        getDoc: function () { return doc; },
        getActive: function () { return active; },
        setActive: function (value) { active = value; },
        setSelectedId: function (value) { selectedId = value; },
        getCollections: function () { return collectionsCache; },
        escapeText: escapeText,
        rid: rid,
        reid: reid,
        beginCheckpointMutation: beginCheckpointMutation,
        render: render,
        markDirty: markDirty,
        refreshInspector: refreshInspector
    });
    function refreshPages() { pagesApi.refreshPages(); }
    function addPage() { pagesApi.addPage(); }
    function switchPage(index) { pagesApi.switchPage(index); }
    function duplicatePage(index) { pagesApi.duplicatePage(index); }
    function deletePage(index) { pagesApi.deletePage(index); }
    function setPageTitle(index, value) { pagesApi.setPageTitle(index, value); }
    function setPageSlug(index, value) { pagesApi.setPageSlug(index, value); }
    function renderPagesList() { pagesApi.renderPagesList(); }
    // ===== BREAKPOINTS =====
    var bpBtns = document.querySelectorAll("[data-doc-bp]");
    function switchBreakpoint(bp) {
        currentBp = bp;
        for (var k = 0; k < bpBtns.length; k++) bpBtns[k].classList.toggle("is-active", bpBtns[k].dataset.docBp === bp);
        ws.setAttribute("data-device", bp === "base" ? "desktop" : bp);
        applyPreviewStyles();
        refreshInspector();
    }
    for (var bp = 0; bp < bpBtns.length; bp++) {
        bpBtns[bp].addEventListener("click", function () { switchBreakpoint(this.dataset.docBp); });
    }

    // «▶ Превью» — одноразово проигрывает анимации появления в холсте (LimeAnim.play).
    var animPreviewBtn = document.querySelector("[data-doc-anim-preview]");
    if (animPreviewBtn) animPreviewBtn.addEventListener("click", function () {
        if (window.LimeAnim) window.LimeAnim.play(ws);
    });

    // ===== INSPECTOR (breakpoint-aware) =====
    var PADS = { "0": "NONE", "8px": "XS", "16px": "SM", "24px": "MD", "48px": "LG", "80px": "XL" };

    function curStyle(b) {
        // Режим правки класса (0.1): инспектор читает/пишет стили класса, а не блока.
        if (currentClass) {
            var def = findClassDef(currentClass);
            var cs = (def && def.styles) || {};
            return (currentState === "hover" ? cs.hover : cs[currentBp]) || {};
        }
        var st = readStyles(b); // у инстанса — эффективные (definition ⊕ overrides.styles)
        return (currentState === "hover" ? st.hover : st[currentBp]) || {};
    }

    function bpLabel() {
        return currentBp === "base" ? "Десктоп" : currentBp === "tablet" ? "Планшет" : "Мобайл";
    }

    var inspectorControls = EditorInspectorControls.create({
        escapeText: escapeText,
        fontGroups: (window.LimeFonts && window.LimeFonts.GROUPS) || [],
        pads: PADS,
        shadowBuilder: function (cur) { return shadowFx.shadowBuilder(cur); }, // thunk: shadowFx создаётся ниже, зовётся на рендере
        themeTokens: L.THEME_TOKENS,
        toHex: toHex
    });
    var CSS_UNITS = inspectorControls.CSS_UNITS;
    var STYLE_REGISTRY = inspectorControls.STYLE_REGISTRY;
    var colorRow = inspectorControls.colorRow;
    var cssLengthValue = inspectorControls.cssLengthValue;
    var fontOptionsHtml = inspectorControls.fontOptionsHtml;
    var hasOwn = inspectorControls.hasOwn;
    var registryProps = inspectorControls.registryProps;
    var renderControl = inspectorControls.renderControl;
    var sec = inspectorControls.section;
    var seg = inspectorControls.segmented; // сегмент-контрол стиля (data-doc-style/data-val) для bgInspector
    var splitCssLength = inspectorControls.splitCssLength;
    var tokenSwatches = inspectorControls.tokenSwatches;
    var unitSelectHtml = inspectorControls.unitSelectHtml;
    // Пропы секции, переопределённые на бакете bp у ВСЕХ выбранных узлов (для multi-reset).
    function ownOverrideProps(ids, bp) {
        var buckets = ids.map(function (id) { var t = targetBlock(byId(id)); return (t && t.styles && t.styles[bp]) || {}; });
        if (!buckets.length) return {};
        var out = {};
        Object.keys(buckets[0]).forEach(function (p) {
            if (buckets.every(function (bk) { return hasOwn(bk, p); })) out[p] = true;
        });
        return out;
    }
    // Источник значения секции: "own" (переопределено здесь → reset), "tablet"/"base" (унаследовано
    // с нижнего бр.), "class" (значение из класса) или null (значение блока на base / ничего).
    function sectionSource(props, info) {
        if (!info) return null;
        // Инстанс компонента: единственная ось — локальный override относительно определения
        // (на любом бакете, включая base). Bp-каскад определения для инстанса не показываем —
        // его reset правил бы определение, а не копию.
        if (info.instance) return props.some(function (p) { return hasOwn(info.instOwn, p); }) ? "instance-own" : null;
        if (info.bp !== "base" && props.some(function (p) { return hasOwn(info.own, p); })) return "own";
        if (info.bp === "mobile" && props.some(function (p) { return hasOwn(info.tablet, p); })) return "tablet";
        if (info.bp !== "base" && props.some(function (p) { return hasOwn(info.base, p); })) return "base";
        if (props.some(function (p) { return hasOwn(info.cls, p) && !hasOwn(info.own, p) && !hasOwn(info.tablet, p) && !hasOwn(info.base, p); })) return "class";
        return null;
    }
    // редизайн редактора (фаза 2 инспектора): core-секции стиля показываем сразу, а редкие
    // (Трекинг/Регистр/Граница/Тень/Прозрачность/Blend/Мин.высота — флаг adv) сворачиваем
    // в одну группу «Дополнительно». Сами контролы и их data-doc-* хуки не меняются.
    function styleSectionHtml(item, s, mixed, sourceInfo) {
        var body = renderControl(item, s, mixed);
        var props = registryProps(item);
        var src = sectionSource(props, sourceInfo);
        if (src === "instance-own") {
            var instOv = props.filter(function (p) { return hasOwn(sourceInfo.instOwn, p); });
            body = '<div class="lime-style-override"><span class="lime-style-override__badge" title="Переопределено в этой копии компонента">●</span>' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-style-reset="' + instOv.join(",") + '">↺ к компоненту</button></div>' + body;
        } else if (src === "own") {
            var ov = props.filter(function (p) { return hasOwn(sourceInfo.own, p); });
            body = '<div class="lime-style-override"><span class="lime-style-override__badge" title="Переопределено на этом брейкпоинте">●</span>' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-style-reset="' + ov.join(",") + '">↺ сбросить</button></div>' + body;
        } else if (src === "tablet" || src === "base") {
            body = '<div class="lime-style-override lime-style-override--inherited"><span class="lime-style-override__src" data-style-src="' + src + '">← ' +
                (src === "tablet" ? "планшет" : "десктоп") + '</span></div>' + body;
        } else if (src === "class") {
            body = '<div class="lime-style-override lime-style-override--inherited"><span class="lime-style-override__src" data-style-src="class">← класс</span></div>' + body;
        }
        return sec(item.title, body);
    }
    function renderStyleSections(s, mixed, sourceInfo) {
        var core = [], adv = [];
        STYLE_REGISTRY.forEach(function (item) {
            (item.adv ? adv : core).push(styleSectionHtml(item, s, mixed, sourceInfo));
        });
        var out = core.join("");
        if (adv.length) {
            out += '<details class="lime-inspector__adv"' + (inspectorAdvOpen ? " open" : "") + '>' +
                '<summary class="lime-inspector__adv-summary">Дополнительно</summary>' +
                '<div class="lime-inspector__adv-body">' + adv.join("") + '</div>' +
                '</details>';
        }
        return out;
    }

    // ----- Панель «Классы» (этап 0.1) — модуль lime-editor-classes.js. -----
    var classTools = EditorClasses.create({
        window: window,
        getDoc: function () { return doc; },
        targetBlock: targetBlock,
        byId: byId,
        getSelectedId: function () { return selectedId; },
        getCurrentClass: function () { return currentClass; },
        setCurrentClass: function (cls) { currentClass = cls; },
        setCurrentState: function (state) { currentState = state; },
        classDefs: classDefs,
        findClassDef: findClassDef,
        beginCheckpointMutation: beginCheckpointMutation,
        render: render,
        markDirty: markDirty,
        refreshInspector: refreshInspector,
        sec: sec,
        escapeText: escapeText
    });
    var classesSection = classTools.classesSection;
    var classEditBanner = classTools.classEditBanner;
    var applyClassToBlock = classTools.applyClassToBlock;
    var removeClassFromBlock = classTools.removeClassFromBlock;
    var createClassFromBlock = classTools.createClassFromBlock;
    var editClass = classTools.editClass;
    var exitClassEdit = classTools.exitClassEdit;
    var deleteClass = classTools.deleteClass;
    var renameClass = classTools.renameClass;

    // ----- Эффекты, движение и декор-слои — модуль lime-editor-effects.js. -----
    var effectsTools = EditorEffects.create({
        L: L,
        ws: ws,
        getSelectedId: function () { return selectedId; },
        getCmdStore: function () { return cmdStore; },
        byId: byId,
        targetBlock: targetBlock,
        clone: clone,
        rid: rid,
        sec: sec,
        setBlockValue: setBlockValue,
        commandBlockGesture: commandBlockGesture,
        runCommands: runCommands,
        openMediaPicker: openMediaPicker,
        scheduleAutosave: scheduleAutosave,
        markDirty: markDirty,
        refreshInspector: refreshInspector,
        render: render
    });
    var animInspector = effectsTools.animInspector;
    var motionInspector = effectsTools.motionInspector;
    var sceneInspector = effectsTools.sceneInspector;
    var layersInspector = effectsTools.layersInspector;
    var fxInspector = effectsTools.fxInspector;
    var setSceneMode = effectsTools.setSceneMode;
    var toggleFx = effectsTools.toggleFx;
    var setSticky = effectsTools.setSticky;
    var setMarquee = effectsTools.setMarquee;
    var setMotionParallax = effectsTools.setMotionParallax;
    var setSceneLength = effectsTools.setSceneLength;
    var addLayer = effectsTools.addLayer;
    var delLayer = effectsTools.delLayer;
    var setLayerRng = effectsTools.setLayerRng;
    var setLayerShape = effectsTools.setLayerShape;
    var pickLayerImage = effectsTools.pickLayerImage;
    var initLayerDrag = effectsTools.initLayerDrag;
    var setAnim = effectsTools.setAnim;

    // ----- Многослойные тени (1.2) — модуль lime-editor-shadow.js. shadowBuilder отдаётся в
    // inspector-controls через thunk выше (он зовётся на рендере, когда shadowFx уже создан). -----
    var shadowFx = EditorShadow.create({
        inspectorEl: inspectorEl,
        toHex: toHex,
        setStyle: setStyle,
        curStyle: curStyle,
        byId: byId,
        getSelectedId: function () { return selectedId; },
        refreshInspector: refreshInspector
    });
    var composeShadow = shadowFx.composeShadow;
    var addShadow = shadowFx.addShadow;
    var delShadow = shadowFx.delShadow;

    // Editor V2 layout inspector/actions — модуль lime-editor-v2-layout.js.
    var v2LayoutTools = EditorV2Layout.create({
        window: window,
        L: L,
        ws: ws,
        getDoc: function () { return doc; },
        getPageBlocks: pageBlocks,
        getSelectedId: function () { return selectedId; },
        getCurrentBp: function () { return currentBp; },
        getCmdStore: function () { return cmdStore; },
        byId: byId,
        targetBlock: targetBlock,
        designTarget: designTarget,
        resolvedBlockDesign: resolvedBlockDesign,
        clone: clone,
        setByPath: setByPath,
        deleteByPath: deleteByPath,
        setDesignValue: setDesignValue,
        runCommands: runCommands,
        finishMutation: finishMutation,
        refreshInspector: refreshInspector,
        sec: sec,
        splitCssLength: splitCssLength,
        cssLengthValue: cssLengthValue,
        unitSelectHtml: unitSelectHtml,
        CSS_UNITS: CSS_UNITS
    });
    var v2LayoutInspector = v2LayoutTools.v2LayoutInspector;
    var switchV2LayoutMode = v2LayoutTools.switchV2LayoutMode;
    var previewDesignInput = v2LayoutTools.previewDesignInput;
    var previewChildDesignInput = v2LayoutTools.previewChildDesignInput;
    var clearScrubPreview = v2LayoutTools.clearScrubPreview;
    var applyV2UnitChange = v2LayoutTools.applyUnitChange;
    var applyV2ChildDesignInput = v2LayoutTools.applyChildDesignInput;
    var applyV2DesignInput = v2LayoutTools.applyDesignInput;
    var resetV2DesignField = v2LayoutTools.resetDesignField;
    var setV2LayoutDirection = v2LayoutTools.setLayoutDirection;
    var setV2LayoutWrap = v2LayoutTools.setLayoutWrap;
    var setV2GridAuto = v2LayoutTools.setGridAuto;
    var setV2GridFill = v2LayoutTools.setGridFill;
    var setV2Overflow = v2LayoutTools.setOverflow;

    function refreshInspector() {
        if (!inspectorEl) return;
        var b = selectedId ? byId(selectedId) : null;
        // редизайн: в V2 инспектор скрыт, пока ничего не выбрано — холст шире, меньше шума.
        // В legacy (?classic=1) инспектор остаётся постоянным.
        syncInspectorShell(!!b);
        if (!b) {
            inspectorEl.innerHTML = '<div class="lime-inspector__empty">' + ico("cta") +
                '<p>Выбери блок в холсте, чтобы редактировать стили, раскладку и контент.</p></div>';
            return;
        }
        var s = curStyle(b);
        // Stage 5 multi-select: стилевые секции читают синтетический мульти-бакет (общее/Mixed),
        // правки разветвляются на все выбранные узлы. Layout/fx/фон остаются на primary.
        var multiIds = v2SelectionIds();
        var multiSel = multiIds.length >= 2 && !currentClass;
        var multiStyles = multiSel ? multiStyleModel(multiIds, currentState === "hover" ? "hover" : currentBp) : null;
        var styleSecBucket = multiStyles ? multiStyles.values : s;
        var styleMixed = multiStyles ? multiStyles.mixed : {};
        // Stage 5 source/reset: секция показывает провенанс — own (переопределено здесь → «сбросить»),
        // tablet/base (унаследовано), class (из класса). Multi: reset, когда все выбранные переопределены
        // на этом бр. (own = пересечение); inherited/class-бейджи для multi не показываем (гетерогенно).
        var singleInstance = !multiSel && b.type === "component" && componentRecord(b.ref);
        var styleSourceInfo = (!currentClass && currentState === "normal")
            ? (multiSel
                ? { bp: currentBp, own: currentBp !== "base" ? ownOverrideProps(multiIds, currentBp) : {}, tablet: {}, base: {}, cls: {} }
                : singleInstance
                    // Инстанс: ось «локальный override → к компоненту» (на текущем бакете, в т.ч. base).
                    ? { bp: currentBp, instance: true,
                        instOwn: (b.overrides && b.overrides.styles && b.overrides.styles[currentBp]) || {} }
                    : { bp: currentBp,
                        own: (currentBp !== "base" && targetBlock(b).styles && targetBlock(b).styles[currentBp]) || {},
                        tablet: (targetBlock(b).styles && targetBlock(b).styles.tablet) || {},
                        base: (targetBlock(b).styles && targetBlock(b).styles.base) || {},
                        cls: effectiveClassStyles(b) })
            : null;
        var multiBanner = multiSel
            ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner" data-multi-select>Selected nodes: ' + multiIds.length + ' — style edits apply to all. <button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="group">Group</button></div></div>'
            : '';
        var isComp = b.type === "component";
        var compName = (isComp && doc.components[b.ref]) ? doc.components[b.ref].name : "";
        var resetOverridesBtn = (isComp && b.overrides)
            ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="reset-overrides" title="Снять все локальные правки этой копии">↺ Сбросить правки</button> '
            : '';
        var banner = isComp
            ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner">⊞ Компонент «' + escapeText(compName) + '» — правки текста/медиа/стиля локальны для этой копии. ' + resetOverridesBtn + '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="detach">Отвязать</button></div></div>'
            : '';
        if (isComp) banner = banner.replace("</div></div>", componentVariantControls(b) + "</div></div>");
        var found = findBlock(selectedId);
        var nested = !!(found && found.parentBlock); // вложен в контейнер → доступно «Наружу»
        var t = targetBlock(b);
        var colsSec = (t && t.type === "columns")
            ? sec("Колонки", '<div class="lime-segmented">' + [2, 3].map(function (n) {
                return '<button type="button" class="' + ((t.content && t.content.cols) == n ? "is-active" : "") + '" data-doc-cols="' + n + '">' + n + '</button>';
            }).join("") + '</div>')
            : "";
        var containerHint = (t && L.isContainer(t.type))
            ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner">▣ Контейнер выбран — блоки из сайдбара добавятся внутрь него.</div></div>'
            : "";

        // DnD C: режим раскладки контейнера → заметный тумблер «Свободно ⇄ Поток» в шапке.
        // Делает free-режим (перемещение блоков как в Figma) видимым, а не спрятанным в Layout·V2.
        var contMode = (t && L.isContainer(t.type) && t.type !== "component" && L.resolvedDesign)
            ? ((L.resolvedDesign(t.design, currentBp).layout || {}).mode || "stack") : "";
        var freeToggleBtn = contMode
            ? '<button type="button" class="lime-block-toolbar__btn' + (contMode === "free" ? " is-active" : "") +
                '" data-doc-op="free-toggle' +
                '" title="' + (contMode === "free" ? "Вернуть блоки в поток" : "Свободное размещение — двигай блоки как в Figma") +
                '" aria-label="Свободное размещение"><svg class="lime-ico"><use href="#i-free"/></svg></button>'
            : "";
        var headHtml =
            '<div class="lime-inspector__head">' +
                '<div class="lime-inspector__title">' + (isComp ? "компонент" : b.type) +
                    '<small>Стили для: <b>' + bpLabel() + '</b>' + (currentBp === "base" ? "" : " (override)") + '</small></div>' +
                '<div class="lime-flex lime-gap-2" role="toolbar" aria-label="Действия над блоком">' +
                    freeToggleBtn +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-op="up" title="Вверх" aria-label="Поднять блок">' + ico("up") + '</button>' +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-op="down" title="Вниз" aria-label="Опустить блок">' + ico("down") + '</button>' +
                    (nested ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="unwrap" title="Вытащить из контейнера" aria-label="Вытащить из контейнера">' + ico("out") + '</button>' : "") +
                    (t && t.content && typeof t.content.text === "string"
                        ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="ai" title="Переписать текст (AI)" aria-label="Переписать текст с помощью AI">' + ico("features") + '</button>' : "") +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-op="dup" title="Дублировать" aria-label="Дублировать блок">' + ico("duplicate") + '</button>' +
                    (b.type === "group" ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="ungroup" title="Ungroup" aria-label="Разгруппировать">' + ico("ungroup") + '</button>' : "") +
                    (isComp ? "" : '<button type="button" class="lime-block-toolbar__btn" data-doc-op="comp" title="Сделать компонентом" aria-label="Сделать компонентом">' + ico("grid") + '</button>') +
                    '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-op="del" title="Удалить" aria-label="Удалить блок">' + ico("trash") + '</button>' +
                '</div>' +
            '</div>';

        // Вкладки инспектора (Фаза удобства): режут длинный скролл втрое.
        var tabs = [["style", "Стиль"], ["fx", "Эффекты"], ["motion", "Движение"]];
        var tabsBar = '<div class="lime-insp-tabs">' + tabs.map(function (o) {
            return '<button type="button" class="lime-insp-tab-btn' + (currentInspectorTab === o[0] ? " is-active" : "") + '" data-doc-insp-tab="' + o[0] + '">' + o[1] + '</button>';
        }).join("") + '</div>';
        function panel(name, body) {
            return '<div class="lime-insp-panel" data-insp-tab="' + name + '"' + (currentInspectorTab === name ? "" : " hidden") + '>' + body + '</div>';
        }

        // Переключатель состояния (1.2): «Обычное / Наведение». В hover-режиме правим только
        // стиль-пропсы (контент/фон/колонки скрыты — они не зависят от состояния).
        var stateSeg = sec("Состояние", '<div class="lime-segmented">' +
            '<button type="button" class="' + (currentState === "normal" ? "is-active" : "") + '" data-doc-state="normal">Обычное</button>' +
            '<button type="button" class="' + (currentState === "hover" ? "is-active" : "") + '" data-doc-state="hover">Наведение</button>' +
            '</div>' + (currentState === "hover" ? '<div class="lime-inspector__hint" style="margin-top:6px;">Стили применяются при наведении курсора. В холсте показан вид наведения.</div>' : ''));
        var styleBody;
        if (currentClass) {
            // Режим правки класса: только баннер + переключатель состояния + стили (контент/фон/колонки — это про блок).
            styleBody = classEditBanner() + stateSeg + renderStyleSections(styleSecBucket, styleMixed, styleSourceInfo);
        } else if (currentState === "hover") {
            styleBody = classesSection(b) + stateSeg + renderStyleSections(styleSecBucket, styleMixed, styleSourceInfo);
        } else {
            styleBody = componentPropsSection(b) + v2LayoutInspector(b, found) + classesSection(b) + containerHint + colsSec + bindingSection(t) + contentExtras(t) + bgInspector(b, s) + stateSeg + renderStyleSections(styleSecBucket, styleMixed, styleSourceInfo);
        }
        var fxBody = fxInspector(t) + animInspector(t);
        var motionBody = motionInspector(t) + sceneInspector(t) + layersInspector(t);

        inspectorEl.innerHTML =
            '<div class="lime-insp-sticky">' + headHtml + banner + multiBanner + tabsBar + '</div>' +
            panel("style", styleBody) + panel("fx", fxBody) + panel("motion", motionBody);

        // Запоминаем развёрнутость группы «Дополнительно» между перерисовками инспектора.
        var advEl = inspectorEl.querySelector(".lime-inspector__adv");
        if (advEl) advEl.addEventListener("toggle", function () { inspectorAdvOpen = advEl.open; });

        // Превью фон-пресетов — через style (в css-значениях кавычки/запятые, в атрибут не вставить).
        if (window.LimeAssets && window.LimeAssets.BG_PRESETS) {
            var pbtns = inspectorEl.querySelectorAll("[data-doc-bg-preset]");
            for (var pi = 0; pi < pbtns.length; pi++) {
                var pp = window.LimeAssets.BG_PRESETS[parseInt(pbtns[pi].getAttribute("data-doc-bg-preset"), 10)];
                if (pp) pbtns[pi].style.backgroundImage = pp.css;
            }
        }
        populateCollectionPickers(t);
    }

    // Наполняет select коллекций из /Data/ApiList (только для сохранённого сайта).
    var collectionsCache = null;
    function populateCollectionPickers(t) {
        var selEl = inspectorEl.querySelector("[data-doc-collection]");
        if (!selEl || !siteId) return;
        var cur = (t && t.content && t.content.collection) || "";
        var fill = function (list) {
            list.forEach(function (c) {
                var opt = document.createElement("option");
                opt.value = c.slug;
                opt.textContent = c.name + " (" + c.slug + ")";
                if (c.slug === cur) opt.selected = true;
                selEl.appendChild(opt);
            });
        };
        if (collectionsCache) { fill(collectionsCache); return; }
        fetch("/Data/ApiList?siteId=" + siteId, { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (list) { collectionsCache = list || []; fill(collectionsCache); })
            .catch(function () { /* нет коллекций / не сохранён — тихо */ });
    }
    // Превью-данные для блока collectionList в редакторе: схема из кэша + 2 пустые записи.
    function editorCollectionData() {
        if (!collectionsCache) return null;
        var map = {};
        collectionsCache.forEach(function (c) {
            var fields = [];
            try { fields = JSON.parse(c.schemaJson || "[]"); } catch (e) { fields = []; }
            map[c.slug] = { fields: fields, records: [{}, {}] };
        });
        return map;
    }
    // Схема полей коллекции из кэша (для биндинг-селектов и sample-записи).
    function collectionFields(slug) {
        if (!slug || !collectionsCache) return [];
        for (var i = 0; i < collectionsCache.length; i++) {
            if (collectionsCache[i].slug === slug) {
                try { return JSON.parse(collectionsCache[i].schemaJson || "[]") || []; } catch (e) { return []; }
            }
        }
        return [];
    }
    // Привязка коллекции к активной странице (CMS 2.0): slug или "" (обычная страница).
    function activePageCollection() {
        return (doc.pages[active] && doc.pages[active].collection) || "";
    }
    // Образец записи для превью страницы-шаблона: значения-плейсхолдеры по схеме.
    function templateSampleRecord() {
        var slug = activePageCollection();
        if (!slug) return null;
        var fields = collectionFields(slug);
        if (!fields.length) return null;
        var rec = {};
        fields.forEach(function (f) {
            rec[f.name] = f.type === "image" ? "" : ("Пример: " + (f.label || f.name));
        });
        return rec;
    }

    // CMS 2.0: на странице-шаблоне записи text/heading/image можно привязать к полю записи.
    // text/heading → content.bind (текстовые поля), image → content.bindSrc (image-поля).
    function bindingSection(t) {
        var slug = activePageCollection();
        if (!slug) return "";
        var isText = t.type === "text" || t.type === "heading";
        var isImg = t.type === "image";
        if (!isText && !isImg) return "";
        var key = isImg ? "bindSrc" : "bind";
        var cur = (t.content && t.content[key]) || "";
        var opts = isImg ? '<option value="">— своё изображение —</option>' : '<option value="">— статичный текст —</option>';
        collectionFields(slug).forEach(function (f) {
            var ok = isImg ? f.type === "image" : f.type !== "image";
            if (!ok) return;
            opts += '<option value="' + escapeText(f.name) + '"' + (f.name === cur ? " selected" : "") + ">" + escapeText(f.label || f.name) + "</option>";
        });
        return sec("Привязка к записи",
            '<select class="lime-select" data-doc-bind="' + key + '" style="width:100%;">' + opts + "</select>" +
            '<div class="lime-inspector__hint" style="margin-top:6px;">Страница-шаблон: блок берёт значение из поля текущей записи. Превью — на образце.</div>');
    }

    // Привязка к данным (фуллстак): форма пишет в коллекцию, collectionList читает из неё.
    // Select наполняется асинхронно после рендера (см. populateCollectionPickers).
    function contentExtras(t) {
        // Обратный отсчёт (этап 1.2): дата окончания. Заголовок правится прямо в блоке.
        if (t.type === "countdown") {
            var cdTarget = (t.content && t.content.target) || "";
            return sec("Обратный отсчёт",
                '<label class="lime-v2-field"><span>Дата окончания</span><input type="datetime-local" class="lime-input" data-doc-cd-target value="' + escapeText(cdTarget) + '"></label>' +
                '<div class="lime-inspector__hint" style="margin-top:6px;">Таймер обнулится в эту дату. Подпись правится прямо в блоке.</div>');
        }
        if (t.type !== "form" && t.type !== "collectionList") return "";
        var colSelect = '<select class="lime-select" data-doc-collection style="width:100%;"><option value="">— нет —</option></select>';
        if (t.type === "form") {
            return sec("Записывать в коллекцию",
                colSelect +
                '<div class="lime-inspector__hint" style="margin-top:6px;">Коллекции создаются в разделе «Данные» (кабинет → твой сайт).</div>');
        }
        // collectionList 2.0: раскладка, лимит, сортировка, фильтр и роли полей карточки.
        var c = t.content || {};
        var curSlug = c.collection || "";
        var fields = [];
        if (collectionsCache) {
            for (var i = 0; i < collectionsCache.length; i++) {
                if (collectionsCache[i].slug === curSlug) {
                    try { fields = JSON.parse(collectionsCache[i].schemaJson || "[]") || []; } catch (e) { fields = []; }
                    break;
                }
            }
        }
        var escA = function (s) { return escapeText(s).replace(/"/g, "&quot;"); };
        var fieldOpts = function (selected, blankLabel) {
            var out = '<option value="">' + escapeText(blankLabel || "—") + "</option>";
            for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                out += '<option value="' + escA(f.name) + '"' + (f.name === selected ? " selected" : "") + ">" + escapeText(f.label || f.name) + "</option>";
            }
            return out;
        };
        var layout = c.layout || "cards";
        var seg = '<div class="lime-segmented">' +
            [["cards", "Карточки"], ["grid", "Сетка"], ["list", "Список"]].map(function (o) {
                return '<button type="button" class="' + (layout === o[0] ? "is-active" : "") + '" data-doc-cl-layout="' + o[0] + '">' + o[1] + "</button>";
            }).join("") + "</div>";
        var html = colSelect +
            '<div class="lime-inspector__hint" style="margin-top:6px;">Коллекции создаются в разделе «Данные».</div>';
        if (curSlug) {
            html +=
                '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Раскладка</div>' + seg +
                '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Сколько показывать</div>' +
                '<input type="number" min="1" max="200" class="lime-input" data-doc-cl-limit value="' + (parseInt(c.limit, 10) || 12) + '" style="width:100%;">';
            if (fields.length) {
                html +=
                    '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Сортировка</div>' +
                    '<div class="lime-flex lime-gap-2">' +
                    '<select class="lime-select" data-doc-cl-sortfield style="flex:1;">' + fieldOpts(c.sortField || "", "По дате (новые)") + "</select>" +
                    '<select class="lime-select" data-doc-cl-sortdir style="width:104px;"><option value="desc"' + (c.sortDir !== "asc" ? " selected" : "") + ">↓ убыв.</option><option value=\"asc\"" + (c.sortDir === "asc" ? " selected" : "") + ">↑ возр.</option></select>" +
                    "</div>" +
                    '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Фильтр (содержит)</div>' +
                    '<div class="lime-flex lime-gap-2">' +
                    '<select class="lime-select" data-doc-cl-filterfield style="flex:1;">' + fieldOpts(c.filterField || "", "— без фильтра —") + "</select>" +
                    '<input type="text" class="lime-input" data-doc-cl-filterval placeholder="значение" value="' + escA(c.filterValue || "") + '" style="flex:1;">' +
                    "</div>" +
                    '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Поля карточки (необязательно — иначе авто)</div>' +
                    '<label class="lime-v2-field"><span>Обложка</span><select class="lime-select" data-doc-cl-imagefield>' + fieldOpts(c.imageField || "", "авто") + "</select></label>" +
                    '<label class="lime-v2-field"><span>Заголовок</span><select class="lime-select" data-doc-cl-titlefield>' + fieldOpts(c.titleField || "", "авто") + "</select></label>" +
                    '<label class="lime-v2-field"><span>Описание</span><select class="lime-select" data-doc-cl-descfield>' + fieldOpts(c.descField || "", "авто") + "</select></label>";
            } else {
                html += '<div class="lime-inspector__hint" style="margin-top:8px;">У коллекции пока нет полей — добавь их в разделе «Данные», чтобы настроить карточку.</div>';
            }
        }
        return sec("Источник — коллекция", html);
    }

    function setContentFlag(key, val) {
        var b = byId(selectedId);
        if (!b) return;
        setContentValue(b, key, val, val == null);
    }

    var styleDebounce;
    var styleTxn = false;
    var styleTxnKey = null;
    function commitStyleEdit() {
        clearTimeout(styleDebounce);
        if (!styleTxn || !cmdStore) return;
        cmdStore.commit("style-gesture");
        styleTxn = false;
        styleTxnKey = null;
        doc = cmdStore.getDoc();
        cmdPrev = JSON.stringify(doc);
        updateHistButtons();
        scheduleAutosave();
    }
    // Оседание стиль-жеста (debounce-конец): коммитим и на НЕ-base брейкпоинте (single-select,
    // обычное состояние) перерисовываем инспектор — чтобы появилась/исчезла кнопка «сбросить»
    // override. На base/мульти/hover — без лишнего ре-рендера (не теряем фокус контролов).
    function settleStyleGesture() {
        commitStyleEdit();
        // На не-base брейкпоинте перерисовываем инспектор после оседания правки, чтобы появились/исчезли
        // индикаторы источника и кнопка «сбросить» (в т.ч. multi-reset, когда все выбранные переопределены).
        // Для одиночного инстанса — рефрешим и на base: ось override «к компоненту» работает на любом бакете.
        var sb = selectedId ? byId(selectedId) : null;
        var singleInst = sb && sb.type === "component" && componentRecord(sb.ref) && v2SelectionIds().length < 2;
        if (!currentClass && currentState === "normal" && (currentBp !== "base" || singleInst)) refreshInspector();
    }
    function commandStyle(b, bucket, prop, val) {
        if (!cmdStore || targetBlock(b) !== b) return false;
        commitInlineEdit();
        commitBlockEdit();
        var key = b.id + ":" + bucket + ":" + prop;
        if (styleTxn && styleTxnKey !== key) commitStyleEdit();
        if (!styleTxn) {
            cmdStore.begin("style-gesture");
            styleTxn = true;
            styleTxnKey = key;
        }
        if (!cmdStore.dispatch("setStyle", {
            id: b.id,
            breakpoint: bucket,
            prop: prop,
            value: val,
            remove: val === "" || val == null
        })) {
            cmdStore.cancel();
            styleTxn = false;
            styleTxnKey = null;
            return true; // поддержанная no-op-команда: не проваливаемся в snapshot fallback
        }
        doc = cmdStore.getDoc();
        clearTimeout(styleDebounce);
        styleDebounce = setTimeout(settleStyleGesture, 400);
        return true;
    }
    // Локальный style-override инстанса компонента: тот же gesture-txn, что commandStyle, но цель —
    // overrides.styles[bucket][prop] (не definition). Один undo на жест; debounce → settle/refresh.
    function commandStyleOverride(inst, bucket, prop, val) {
        if (!cmdStore) return false;
        commitInlineEdit();
        commitBlockEdit();
        var key = inst.id + ":ovr:" + bucket + ":" + prop;
        if (styleTxn && styleTxnKey !== key) commitStyleEdit();
        if (!styleTxn) {
            cmdStore.begin("style-gesture");
            styleTxn = true;
            styleTxnKey = key;
        }
        if (!cmdStore.dispatch("setComponentStyleOverride", {
            id: inst.id, breakpoint: bucket, prop: prop, value: val, remove: val === "" || val == null
        })) {
            cmdStore.cancel();
            styleTxn = false;
            styleTxnKey = null;
            return true; // поддержанная no-op-команда: не проваливаемся в snapshot fallback
        }
        doc = cmdStore.getDoc();
        clearTimeout(styleDebounce);
        styleDebounce = setTimeout(settleStyleGesture, 400);
        return true;
    }
    // Stage 5 multi-select: id'шники V2-выбора (≥1). Один блок — обычный путь, несколько —
    // fan-out стилевых правок на все как одна undo-транзакция.
    function v2SelectionIds() {
        if (window.__LIME_SELECTION__) {
            var ids = window.__LIME_SELECTION__.get().ids;
            if (ids.length) return ids;
        }
        return selectedId ? [selectedId] : [];
    }
    // Модель стилевых значений мульти-выбора различает три состояния свойства:
    // common (одно явное значение), mixed (значения/наличие расходятся), unset (нет у всех).
    function multiStyleModel(ids, bucketName) {
        var buckets = ids.map(function (id) {
            return readStyles(byId(id))[bucketName] || {}; // у инстанса — эффективные стили
        });
        var props = {}, values = {}, mixed = {};
        buckets.forEach(function (bk) { Object.keys(bk).forEach(function (p) { props[p] = 1; }); });
        Object.keys(props).forEach(function (prop) {
            var has0 = Object.prototype.hasOwnProperty.call(buckets[0], prop);
            var v0 = buckets[0][prop];
            var common = buckets.every(function (bk) {
                return Object.prototype.hasOwnProperty.call(bk, prop) === has0 && (!has0 || bk[prop] === v0);
            });
            if (common && has0) values[prop] = v0;
            else if (!common) mixed[prop] = true;
        });
        return { values: values, mixed: mixed };
    }
    // Стилевая gesture-команда на НЕСКОЛЬКО узлов: одна транзакция, по dispatch на каждый target.
    function commandStyleMulti(ids, bucket, prop, val) {
        if (!cmdStore) return false;
        var seen = {}, targets = [];
        for (var i = 0; i < ids.length; i++) {
            var source = byId(ids[i]);
            if (!source) return false;
            var isInst = source.type === "component" && componentRecord(source.ref);
            // Обычный блок адресуем напрямую; компонент-инстанс — через локальный style-override.
            // Определение компонента (target !== source и не инстанс) command engine пока не трогает.
            if (!isInst && targetBlock(source) !== source) return false;
            if (!seen[source.id]) { seen[source.id] = true; targets.push({ id: source.id, inst: !!isInst }); }
        }
        if (!targets.length) return false;
        commitInlineEdit(); commitBlockEdit();
        var key = "multi:" + targets.map(function (t) { return t.id; }).join(",") + ":" + bucket + ":" + prop;
        if (styleTxn && styleTxnKey !== key) commitStyleEdit();
        if (!styleTxn) { cmdStore.begin("style-gesture"); styleTxn = true; styleTxnKey = key; }
        var rm = val === "" || val == null;
        targets.forEach(function (t) {
            if (t.inst) cmdStore.dispatch("setComponentStyleOverride", { id: t.id, breakpoint: bucket, prop: prop, value: val, remove: rm });
            else cmdStore.dispatch("setStyle", { id: t.id, breakpoint: bucket, prop: prop, value: val, remove: rm });
        });
        doc = cmdStore.getDoc();
        clearTimeout(styleDebounce);
        styleDebounce = setTimeout(settleStyleGesture, 400);
        return true;
    }
    function setStyle(prop, val) {
        if (currentClass) { setClassStyle(prop, val); return; } // правим класс, не блок (0.1)
        var ids = v2SelectionIds();
        var bucket = currentState === "hover" ? "hover" : currentBp;
        if (ids.length >= 2) { // multi-select fan-out (Stage 5)
            if (cmdStore && commandStyleMulti(ids, bucket, prop, val)) { applyPreviewStyles(); return; }
            commitStyleEdit();
            beginCheckpointMutation();
            var changedTargets = [];
            ids.forEach(function (id) {
                var src = byId(id);
                if (!src) return;
                // Компонент-инстанс — локальный style-override (не трогаем определение/копии).
                if (src.type === "component" && componentRecord(src.ref)) {
                    if (changedTargets.indexOf(src) !== -1) return;
                    changedTargets.push(src);
                    setComponentStyleOverrideLocal(src, bucket, prop, val, val === "" || val == null);
                    return;
                }
                var mb = targetBlock(src);
                if (!mb || changedTargets.indexOf(mb) !== -1) return;
                changedTargets.push(mb);
                if (!mb.styles) mb.styles = {};
                if (!mb.styles[bucket]) mb.styles[bucket] = {};
                if (val === "" || val == null) delete mb.styles[bucket][prop]; else mb.styles[bucket][prop] = val;
                if (!Object.keys(mb.styles[bucket]).length) delete mb.styles[bucket];
            });
            applyPreviewStyles();
            markDirty();
            return;
        }
        var source = byId(selectedId);
        if (!source) return;
        // Компонент-инстанс (single-select): стиль-правка локальна (overrides.styles), как текст/медиа.
        if (source.type === "component" && componentRecord(source.ref)) {
            if (cmdStore && commandStyleOverride(source, bucket, prop, val)) { applyPreviewStyles(); return; }
            commitStyleEdit();
            beginCheckpointMutation();
            setComponentStyleOverrideLocal(source, bucket, prop, val, val === "" || val == null);
            applyPreviewStyles();
            markDirty();
            return;
        }
        var b = targetBlock(source);
        if (!b) return;
        if (commandStyle(source, bucket, prop, val)) {
            applyPreviewStyles();
            return;
        }
        commitStyleEdit();
        if (!b.styles) b.styles = {};
        if (!b.styles[bucket]) b.styles[bucket] = {};
        if (val === "" || val == null) delete b.styles[bucket][prop];
        else b.styles[bucket][prop] = val;
        if (!Object.keys(b.styles[bucket]).length) delete b.styles[bucket]; // не плодим пустые бакеты
        applyPreviewStyles();
        markDirty();
    }
    // Stage 5 reset override: снять переопределения секции на текущем бакете → значение наследуется
    // с base/tablet. Одна транзакция на все пропы секции (и все выбранные узлы), затем re-render.
    function resetStyleProps(props) {
        if (!props || !props.length || currentClass) return;
        commitStyleEdit();
        var ids = v2SelectionIds();
        var bucket = currentState === "hover" ? "hover" : currentBp;
        var isInst = function (src) { return src && src.type === "component" && componentRecord(src.ref); };
        if (cmdStore) {
            cmdStore.begin("style-reset");
            ids.forEach(function (id) {
                var src = byId(id);
                if (!src) return;
                // Инстанс — снимаем локальный override (к компоненту); обычный блок — свой стиль.
                if (isInst(src)) {
                    props.forEach(function (p) { cmdStore.dispatch("setComponentStyleOverride", { id: src.id, breakpoint: bucket, prop: p, remove: true }); });
                } else {
                    var t = targetBlock(src);
                    if (t) props.forEach(function (p) { cmdStore.dispatch("setStyle", { id: t.id, breakpoint: bucket, prop: p, value: "", remove: true }); });
                }
            });
            cmdStore.commit("style-reset");
            doc = cmdStore.getDoc(); cmdPrev = JSON.stringify(doc); updateHistButtons(); scheduleAutosave();
        } else {
            ids.forEach(function (id) {
                var src = byId(id);
                if (!src) return;
                if (isInst(src)) {
                    props.forEach(function (p) { setComponentStyleOverrideLocal(src, bucket, p, "", true); });
                    return;
                }
                var t = targetBlock(src);
                if (!t || !t.styles || !t.styles[bucket]) return;
                props.forEach(function (p) { delete t.styles[bucket][p]; });
                if (!Object.keys(t.styles[bucket]).length) delete t.styles[bucket];
            });
            markDirty();
        }
        applyPreviewStyles();
        refreshInspector();
    }
    // Запись стиля в определение класса (0.1): живое превью через applyPreviewStyles
    // обновит ВСЕ блоки с этим классом без полного ре-рендера (ползунок не теряет фокус).
    function setClassStyle(prop, val) {
        var def = findClassDef(currentClass);
        if (!def) return;
        beginCheckpointMutation();
        if (!def.styles) def.styles = {};
        var bucket = currentState === "hover" ? "hover" : currentBp;
        if (!def.styles[bucket]) def.styles[bucket] = {};
        if (val === "" || val == null) delete def.styles[bucket][prop];
        else def.styles[bucket][prop] = val;
        if (!Object.keys(def.styles[bucket]).length) delete def.styles[bucket];
        applyPreviewStyles();
        markDirty();
    }

    // Анимация появления — НЕ привязана к брейкпоинту, живёт прямо на блоке
    // (block.anim/animDelay/animDuration). Пишем в DOM-атрибут напрямую, чтобы
    // «▶ Превью» (LimeAnim.play читает data-* с .lime-block) брал свежие значения
    // без полного ре-рендера и потери фокуса ползунка.
    var blockDebounce;
    var blockTxn = false;
    var blockTxnKey = null;
    function commitBlockEdit() {
        clearTimeout(blockDebounce);
        if (!blockTxn || !cmdStore) return;
        cmdStore.commit("block-gesture");
        blockTxn = false;
        blockTxnKey = null;
        doc = cmdStore.getDoc();
        cmdPrev = JSON.stringify(doc);
        updateHistButtons();
        scheduleAutosave();
    }
    function commandBlockGesture(source, prop, value, remove, gestureKey) {
        if (!cmdStore || targetBlock(source) !== source) return false;
        commitInlineEdit();
        commitStyleEdit();
        var key = source.id + ":" + (gestureKey || prop);
        if (blockTxn && blockTxnKey !== key) commitBlockEdit();
        if (!blockTxn) {
            cmdStore.begin("block-gesture");
            blockTxn = true;
            blockTxnKey = key;
        }
        if (!cmdStore.dispatch("setBlockProp", {
            id: source.id, prop: prop, value: value, remove: !!remove
        })) {
            cmdStore.cancel();
            blockTxn = false;
            blockTxnKey = null;
            return true;
        }
        doc = cmdStore.getDoc();
        clearTimeout(blockDebounce);
        blockDebounce = setTimeout(commitBlockEdit, 400);
        return true;
    }
    function commandContentGesture(source, field, value, remove, gestureKey) {
        if (!cmdStore || targetBlock(source) !== source) return false;
        commitInlineEdit();
        commitStyleEdit();
        var key = source.id + ":content:" + (gestureKey || field);
        if (blockTxn && blockTxnKey !== key) commitBlockEdit();
        if (!blockTxn) {
            cmdStore.begin("content-gesture");
            blockTxn = true;
            blockTxnKey = key;
        }
        if (!cmdStore.dispatch("setContent", {
            id: source.id, field: field, value: value, remove: !!remove
        })) {
            cmdStore.cancel();
            blockTxn = false;
            blockTxnKey = null;
            return true;
        }
        doc = cmdStore.getDoc();
        clearTimeout(blockDebounce);
        blockDebounce = setTimeout(commitBlockEdit, 400);
        return true;
    }
    // ===== ФОН СЕКЦИИ (градиент/картинка/затемнение/видео) — модуль lime-editor-section-bg.js =====
    // Изменяемое состояние (selectedId/currentBp/cmdStore) отдаём геттерами — нужно актуальное на
    // момент вызова. bgInspector рендерит панель, остальные методы дёргает обработчик инспектора ниже.
    var sectionBg = EditorSectionBg.create({
        document: document,
        window: window,
        inspectorEl: inspectorEl,
        ws: ws,
        getSelectedId: function () { return selectedId; },
        getCurrentBp: function () { return currentBp; },
        getCmdStore: function () { return cmdStore; },
        byId: byId,
        setContentValue: setContentValue,
        setStyle: setStyle,
        targetBlock: targetBlock,
        commandContentGesture: commandContentGesture,
        runCommands: runCommands,
        markDirty: markDirty,
        applyPreviewStyles: applyPreviewStyles,
        refreshInspector: refreshInspector,
        scheduleAutosave: scheduleAutosave,
        toHex: toHex,
        seg: seg,
        colorRow: colorRow,
        tokenSwatches: tokenSwatches,
        sec: sec
    });
    var bgInspector = sectionBg.bgInspector;
    var composeGradient = sectionBg.composeGradient;
    var liveOverlay = sectionBg.liveOverlay;
    var switchBgMode = sectionBg.switchBgMode;
    var promptBgVideo = sectionBg.promptBgVideo;
    var setBg = sectionBg.setBg;

    if (inspectorEl) {
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
                currentInspectorTab = el.dataset.docInspTab;
                var tb = inspectorEl.querySelectorAll("[data-doc-insp-tab]");
                for (var ti = 0; ti < tb.length; ti++) tb[ti].classList.toggle("is-active", tb[ti] === el);
                var pn = inspectorEl.querySelectorAll("[data-insp-tab]");
                for (var pj = 0; pj < pn.length; pj++) pn[pj].hidden = (pn[pj].getAttribute("data-insp-tab") !== currentInspectorTab);
                return;
            }
            if ((el = e.target.closest("[data-doc-state]"))) {
                currentState = el.dataset.docState === "hover" ? "hover" : "normal";
                refreshInspector();
                applyPreviewStyles(); // показать/убрать вид наведения в холсте
                return;
            }
            // Классы (0.1)
            if ((el = e.target.closest("[data-doc-class-edit]"))) { editClass(el.dataset.docClassEdit); return; }
            if ((el = e.target.closest("[data-doc-class-remove]"))) { removeClassFromBlock(el.dataset.docClassRemove); return; }
            if (e.target.closest("[data-doc-class-new]")) { createClassFromBlock(); return; }
            if (e.target.closest("[data-doc-class-done]")) { exitClassEdit(); return; }
            if (e.target.closest("[data-doc-class-delete]")) { deleteClass(currentClass); return; }
            if (e.target.closest("[data-doc-class-rename]")) { renameClass(currentClass); return; }
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
                var bp = window.LimeAssets && window.LimeAssets.BG_PRESETS[parseInt(el.dataset.docBgPreset, 10)];
                if (bp) {
                    var presetSource = byId(selectedId);
                    var bb = targetBlock(presetSource);
                    if (cmdStore && bb === presetSource) {
                        var presetChanged = runCommands([
                            { type: "setContent", payload: { id: presetSource.id, field: "bgMode", value: "gradient" } },
                            { type: "setStyle", payload: { id: presetSource.id, breakpoint: currentBp, prop: "backgroundImage", value: bp.css } }
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
                        var fm = ((L.resolvedDesign(ft.design, currentBp).layout || {}).mode) || "stack";
                        switchV2LayoutMode(fm === "free" ? "stack" : "free");
                    }
                }
                else if (op === "del") { if (confirm("Удалить блок?")) delBlock(); }
            }
        });
    }

    // ===== SAVE / AUTOSAVE / CRASH RECOVERY — module lime-editor-persistence.js =====
    var persistence = EditorPersistence.create({
        window: window,
        document: document,
        L: L,
        getDoc: function () { return doc; },
        getDocVersion: function () { return docVersion; },
        setDocVersion: function (value) { docVersion = value; },
        siteId: siteId,
        saveBtn: saveBtn,
        csrfToken: csrfToken,
        totalBlocks: totalBlocks,
        commitPendingCommandEdits: commitPendingCommandEdits,
        pushHistory: pushHistory,
        restoreDraftDocument: function (draftJson) {
            doc = L.migrateDoc(draftJson);
            active = 0;
            selectedId = null;
            currentClass = null;
            if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.replace([]);
            refreshPages();
            refreshComponents();
            render();
            pushHistory();
        }
    });
    function setStatus(text, cls) { persistence.setStatus(text, cls); }
    function scheduleAutosave() { persistence.scheduleAutosave(); }
    function markDirty() { persistence.markDirty(); }
    function maybeOfferRecovery() { persistence.maybeOfferRecovery(); }
    // Блок из спека (общее для AI-materialize и готовых пресетов/шаблонов): копирует
    // content + стили/css/анимацию/движение/слои и рекурсивно собирает children.
    // Все id (блока, детей, слоёв) — свежие, чтобы быть уникальными в документе.
    function blockFromSpec(spec) {
        var b = L.createBlock(spec.type);
        if (spec.content) Object.keys(spec.content).forEach(function (k) { b.content[k] = clone(spec.content[k]); });
        if (spec.styles) b.styles = clone(spec.styles);
        if (spec.css) b.css = spec.css;
        ["anim", "animDelay", "animDuration", "parallax", "sticky", "stickyOffset", "marquee", "scene", "layers", "fx"].forEach(function (k) {
            if (spec[k] != null) b[k] = clone(spec[k]);
        });
        if (b.layers) b.layers.forEach(function (l) { l.id = rid("l"); });
        if (spec.children && spec.children.length) b.children = spec.children.map(blockFromSpec);
        return b;
    }
    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

    // ===== AI GENERATE / REWRITE — module lime-editor-ai-generate.js =====
    var aiGenerateFlow = EditorAiGenerate.create({
        window: window,
        document: document,
        aiModal: document.getElementById("lime-doc-ai-modal"),
        ws: ws,
        getSelectedId: function () { return selectedId; },
        setSelectedId: function (value) { selectedId = value; },
        findBlock: findBlock,
        targetBlock: targetBlock,
        pageBlocks: pageBlocks,
        blockFromSpec: blockFromSpec,
        setContentValue: setContentValue,
        render: render,
        markDirty: markDirty,
        csrfToken: csrfToken
    });
    function aiStatus(text, danger) { aiGenerateFlow.aiStatus(text, danger); }
    function aiOpen() { aiGenerateFlow.aiOpen(); }
    function aiErrorText(status, resp) { return aiGenerateFlow.aiErrorText(status, resp); }
    function leStatus(text, opts) { aiGenerateFlow.leStatus(text, opts); }
    function leToast() { aiGenerateFlow.leToast(); }
    function materialize(specs) { aiGenerateFlow.materialize(specs); }
    function runGenerate(promptText, opts) { aiGenerateFlow.runGenerate(promptText, opts); }
    function aiGenerate() { aiGenerateFlow.aiGenerate(); }
    function aiRewrite() { aiGenerateFlow.aiRewrite(); }
    function aiEditBlock() { aiGenerateFlow.aiEditBlock(); }

    // ===== AI COMMAND PIPELINE (этап 10.1) — модуль lime-editor-ai-pipeline.js =====
    // Изменяемое состояние (cmdStore/selectedId) отдаём геттерами; leStatus остаётся в main (его
    // делит секция генерации). Наружу — applyAiCommands/aiSuggest/aiAdaptMobile (ниже идут в
    // window.__LIME_AI__, command palette и op-хендлеры).
    var aiPipeline = EditorAiPipeline.create({
        document: document,
        window: window,
        ws: ws,
        doc: doc,
        getCmdStore: function () { return cmdStore; },
        getSelectedId: function () { return selectedId; },
        reid: reid,
        escapeText: escapeText,
        runCommands: runCommands,
        render: render,
        scheduleAutosave: scheduleAutosave,
        byId: byId,
        blockLabel: blockLabel,
        findBlock: findBlock,
        targetBlock: targetBlock,
        csrfToken: csrfToken,
        leStatus: leStatus,
        switchBreakpoint: switchBreakpoint
    });
    var applyAiCommands = aiPipeline.applyAiCommands;
    var aiSuggest = aiPipeline.aiSuggest;
    var aiAdaptMobile = aiPipeline.aiAdaptMobile;
    // Тест/интеграционный шов: даёт скормить список команд (как от LLM) без живого AI-вызова.
    window.__LIME_AI__ = { apply: applyAiCommands, suggest: aiSuggest, adaptMobile: aiAdaptMobile };

    // ===== ТЕМА (токены сайта) — модуль lime-editor-theme.js =====
    EditorTheme.create({
        document: document,
        doc: doc,
        defaultTheme: L.DEFAULT_THEME,
        beginCheckpointMutation: beginCheckpointMutation,
        render: render,
        markDirty: markDirty,
        fontOptionsHtml: fontOptionsHtml
    });

    // ===== Топбар: overflow-меню «⋯» — модуль lime-editor-topbar.js =====
    EditorTopbar.init({ document: document });

    var themeOpen = document.querySelector("[data-doc-theme-open]");
    var themeModal = document.getElementById("lime-doc-theme-modal");
    if (themeOpen && themeModal) {
        themeOpen.addEventListener("click", function () { themeModal.classList.add("is-open"); });
    }
    document.addEventListener("click", function (e) {
        if (themeModal && e.target.closest("[data-doc-theme-close]")) themeModal.classList.remove("is-open");
    });

    // ===== КОД САЙТА (этап 0.2): глобальный CSS + кастомный head — модуль lime-editor-site-code.js =====
    // codeModal объявлен здесь (на него ссылается command palette ниже), логику ведёт модуль.
    var codeModal = document.getElementById("lime-doc-code-modal");
    EditorSiteCode.create({
        document: document,
        doc: doc,
        codeModal: codeModal,
        beginCheckpointMutation: beginCheckpointMutation,
        render: render,
        markDirty: markDirty
    });

    // ===== COMMAND PALETTE (Ctrl+K): discoverability without permanent chrome =====
    (function () {
        var launcher = document.querySelector("[data-doc-cmdk]");
        function triggerClick(selector) {
            var el = document.querySelector(selector);
            if (el) el.click();
        }
        function openSidebarPanel(name) {
            if (window.__LIME_SIDEBAR__ && window.__LIME_SIDEBAR__.open) window.__LIME_SIDEBAR__.open(name);
        }
        function canRunSelected() { return !!selectedId && !!byId(selectedId); }
        var COMMANDS = [
            { id: "insert-cover", title: "Вставить обложку", keywords: "hero cover блок секция", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="cover"]'); } },
            { id: "insert-heading", title: "Вставить заголовок", keywords: "heading title текст блок", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="heading"]'); } },
            { id: "insert-text", title: "Вставить текст", keywords: "paragraph copy block", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="text"]'); } },
            { id: "insert-columns", title: "Вставить колонки", keywords: "columns grid layout", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="columns"]'); } },
            { id: "show-insert", title: "Открыть вставку", keywords: "blocks блоки add sidebar", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); } },
            { id: "show-layers", title: "Открыть слои", keywords: "layers outline порядок дерево", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("layers"); } },
            { id: "show-components", title: "Открыть компоненты", keywords: "components reusable reuse", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("components"); } },
            { id: "device-desktop", title: "Переключить на desktop", keywords: "breakpoint desktop экран", shortcut: "", when: function () { return true; }, run: function () { triggerClick('[data-doc-bp="base"]'); } },
            { id: "device-tablet", title: "Переключить на tablet", keywords: "breakpoint tablet планшет", shortcut: "", when: function () { return true; }, run: function () { triggerClick('[data-doc-bp="tablet"]'); } },
            { id: "device-mobile", title: "Переключить на mobile", keywords: "breakpoint mobile телефон адаптив", shortcut: "", when: function () { return true; }, run: function () { triggerClick('[data-doc-bp="mobile"]'); } },
            { id: "open-theme", title: "Открыть тему сайта", keywords: "theme palette colors шрифт", shortcut: "", when: function () { return !!themeModal; }, run: function () { if (themeModal) themeModal.classList.add("is-open"); } },
            { id: "open-code", title: "Открыть код сайта", keywords: "css head custom code", shortcut: "", when: function () { return !!codeModal; }, run: function () { triggerClick("[data-doc-code-open]"); } },
            { id: "open-ai", title: "AI: сгенерировать страницу", keywords: "ai generate prompt создать", shortcut: "", when: function () { return true; }, run: aiOpen },
            { id: "ai-edit", title: "AI: поправить выбранный блок", keywords: "rewrite suggest ai selected", shortcut: "", when: canRunSelected, run: function () { aiSuggest(selectedId); } },
            { id: "undo", title: "Отменить", keywords: "history назад", shortcut: "Ctrl+Z", when: function () { return true; }, run: undo },
            { id: "redo", title: "Вернуть", keywords: "history вперед", shortcut: "Ctrl+Shift+Z", when: function () { return true; }, run: redo },
            { id: "duplicate", title: "Дублировать выбранный блок", keywords: "copy clone duplicate", shortcut: "Ctrl+D", when: canRunSelected, run: function () { runBlockOp("dup"); } },
            { id: "group", title: "Сгруппировать выделение", keywords: "group multi selection", shortcut: "", when: function () { return v2SelectionIds().length >= 2; }, run: groupSelection },
            { id: "ungroup", title: "Разгруппировать блок", keywords: "ungroup group", shortcut: "", when: function () { var b = selectedId && byId(selectedId); return b && b.type === "group"; }, run: ungroupBlock },
            { id: "component", title: "Сделать компонентом", keywords: "component reusable", shortcut: "", when: function () { var b = selectedId && byId(selectedId); return b && b.type !== "component"; }, run: makeComponent },
            { id: "delete", title: "Удалить выбранный блок", keywords: "remove delete", shortcut: "Del", when: canRunSelected, run: function () { runBlockOp("del"); } },
            { id: "save", title: "Опубликовать / обновить сайт", keywords: "publish save сохранить", shortcut: "", when: function () { return !!saveBtn; }, run: function () { if (saveBtn) saveBtn.click(); } }
        ];
        window.__LIME_COMMANDS__ = COMMANDS;
        EditorCommandPalette.create({
            commands: COMMANDS,
            launcher: launcher,
            escapeText: escapeText,
            document: document,
            window: window
        });
    })();

    // ===== COMPONENTS UI =====
    var compBox = document.getElementById("lime-doc-components");
    if (compBox) {
        compBox.addEventListener("click", function (e) {
            var b = e.target.closest("[data-doc-insert-comp]");
            if (b) { e.stopPropagation(); insertComponent(b.getAttribute("data-doc-insert-comp")); }
        });
    }

    // ===== INTRO OVERLAY (стартовый промпт для пустого документа) — модуль lime-editor-intro.js =====
    var intro = EditorIntro.create({ document: document, totalBlocks: totalBlocks, runGenerate: runGenerate });

    // ===== ONBOARDING (этап 9.4): coachmark-тур — модуль lime-editor-onboarding.js =====
    // Авто-показ один раз (флаг в localStorage); ?tour=1 форсит. Документ не пуст — иначе
    // показ перехватывает intro-оверлей (поэтому при форсе intro прячем).
    EditorOnboarding.create({ document: document, window: window }).maybeAutoRun({
        forced: /[?&]tour=1\b/.test(location.search),
        hasContent: totalBlocks() > 0,
        onForce: function () { intro.dismiss(); }
    });

    // ===== EDITOR V2 CANVAS (viewport/selection/handles/palette drag) — module lime-editor-v2-canvas.js =====
    var v2Canvas = EditorV2Canvas.create({
        window: window,
        document: document,
        L: L,
        ws: ws,
        isCanvasOn: function () { return canvasOn; },
        getCurrentBp: function () { return currentBp; },
        getActivePageIndex: function () { return active; },
        getCmdStore: function () { return cmdStore; },
        getSelectedId: function () { return selectedId; },
        setSelectedId: function (value) { selectedId = value; },
        getCurrentClass: function () { return currentClass; },
        setCurrentClass: function (value) { currentClass = value; },
        getPaletteJustDragged: function () { return paletteJustDragged; },
        setPaletteJustDragged: function (value) { paletteJustDragged = value; },
        findBlock: findBlock,
        byId: byId,
        targetBlock: targetBlock,
        resolvedBlockDesign: resolvedBlockDesign,
        clone: clone,
        refreshInspector: refreshInspector,
        refreshLayers: refreshLayers,
        runBlockOp: runBlockOp,
        ico: ico,
        isTextField: isTextField,
        render: render,
        runCommands: runCommands,
        finishMutation: finishMutation,
        setDesignValue: setDesignValue,
        beginCheckpointMutation: beginCheckpointMutation,
        pageBlocks: pageBlocks,
        runCommand: runCommand,
        finishInsert: finishInsert
    });
    refreshV2SelectionOverlay = function () { v2Canvas.refreshSelectionOverlay(); };

    function initV2Viewport() {
        v2Canvas.initViewport();
    }
    // ===== INIT =====
    refreshPages();
    refreshComponents();
    render();
    pushHistory(); // стартовое состояние — дно стека undo
    initV2Viewport();
    maybeOfferRecovery(); // этап 9.2: предложить восстановить несохранённый черновик

    // Подгружаем коллекции сайта заранее — чтобы блок collectionList показывал превью схемы.
    if (siteId) {
        fetch("/Data/ApiList?siteId=" + siteId, { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (list) {
                collectionsCache = list || [];
                if (collectionsCache.length) render(); // перерисовать с превью данных
            })
            .catch(function () { /* нет коллекций / не сохранён — тихо */ });
    }
})();
