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
    var EditorCommandPalette = window.LimeEditorCommandPalette || {};
    var EditorInspectorControls = window.LimeEditorInspectorControls || {};
    var EditorLayers = window.LimeEditorLayers || {};
    var EditorContextMenu = window.LimeEditorContextMenu || {};
    var EditorMediaPicker = window.LimeEditorMediaPicker || {};
    var EditorSidebar = window.LimeEditorSidebar || {};
    var EditorOnboarding = window.LimeEditorOnboarding || {};
    var EditorTopbar = window.LimeEditorTopbar || {};
    var EditorIntro = window.LimeEditorIntro || {};
    if (!EditorUtils.escapeText) throw new Error("LimeEditorUtils is required before lime-doc-editor.js");
    if (!EditorComponents.create) throw new Error("LimeEditorComponents is required before lime-doc-editor.js");
    if (!EditorCommandPalette.create) throw new Error("LimeEditorCommandPalette is required before lime-doc-editor.js");
    if (!EditorInspectorControls.create) throw new Error("LimeEditorInspectorControls is required before lime-doc-editor.js");
    if (!EditorLayers.create) throw new Error("LimeEditorLayers is required before lime-doc-editor.js");
    if (!EditorContextMenu.create) throw new Error("LimeEditorContextMenu is required before lime-doc-editor.js");
    if (!EditorMediaPicker.create) throw new Error("LimeEditorMediaPicker is required before lime-doc-editor.js");
    if (!EditorSidebar.create) throw new Error("LimeEditorSidebar is required before lime-doc-editor.js");
    if (!EditorOnboarding.create) throw new Error("LimeEditorOnboarding is required before lime-doc-editor.js");
    if (!EditorTopbar.init) throw new Error("LimeEditorTopbar is required before lime-doc-editor.js");
    if (!EditorIntro.create) throw new Error("LimeEditorIntro is required before lime-doc-editor.js");

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
    var conflicted = false;
    // Crash recovery (этап 9.2): editSeq растёт на каждую правку, savedSeq догоняет при успешном
    // сохранении/автосейве. editSeq !== savedSeq ⇒ есть несохранённые изменения (грязный документ).
    var editSeq = 0, savedSeq = 0;

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
    function newClassId() {
        var cls;
        do { cls = "c" + Math.random().toString(36).slice(2, 8); } while (findClassDef(cls));
        return cls;
    }
    // Список классов целевого блока (у компонента-инстанса — в определении).
    function blockClassList(b) {
        var t = targetBlock(b);
        if (!t) return [];
        if (!t.classes) t.classes = [];
        return t.classes;
    }
    function toggleBlockClass(b, cls) {
        var list = blockClassList(b);
        var i = list.indexOf(cls);
        if (i === -1) list.push(cls); else list.splice(i, 1);
        if (!list.length) delete targetBlock(b).classes; // не плодим пустые массивы
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

    // ===== MEDIA (этап 0.5: image / gallery / video) =====
    var mediaPicker = EditorMediaPicker.create({
        csrfToken: csrfToken,
        document: document,
        fetch: window.fetch ? window.fetch.bind(window) : null,
        onPick: applyPickedMedia,
        window: window
    });

    function blockOf(el) {
        var sec = el.closest(".lime-block");
        return sec ? byId(sec.getAttribute("data-block-id")) : null;
    }

    ws.addEventListener("click", function (e) {
        var el;
        if ((el = e.target.closest("[data-doc-gallery-del]"))) {
            e.stopPropagation();
            var b = blockOf(el);
            if (b) {
                var items = clone((targetBlock(b).content && targetBlock(b).content.items) || []);
                items.splice(parseInt(el.getAttribute("data-doc-gallery-del"), 10), 1);
                setContentValue(b, "items", items, false);
            }
            return;
        }
        if ((el = e.target.closest("[data-doc-gallery-add]"))) {
            var b2 = blockOf(el);
            if (b2) {
                var t = targetBlock(b2);
                var nextItems = clone((t.content && t.content.items) || []);
                nextItems.push({ src: "", alt: "" });
                setContentValue(b2, "items", nextItems, false);
            }
            return;
        }
        if ((el = e.target.closest("[data-doc-pick]"))) {
            var b3 = blockOf(el);
            if (b3) openMediaPicker(b3.id, el.getAttribute("data-doc-pick"));
            return;
        }
        if ((el = e.target.closest("[data-doc-video]"))) {
            var b4 = blockOf(el);
            if (b4) promptVideo(b4.id);
            return;
        }
        if ((el = e.target.closest("[data-doc-embed]"))) {
            var b5 = blockOf(el);
            if (b5) promptEmbed(b5.id);
        }
    });

    function openMediaPicker(blockId, field, target) {
        mediaPicker.open({ blockId: blockId, field: field, target: target || "content" });
    }

    function applyPickedMedia(pickCtx, url) {
        var b = pickCtx && byId(pickCtx.blockId);
        if (!b || !url) return;
        var tb = targetBlock(b);
        if (pickCtx.target === "bgimage") {
            // Фон-картинка секции — это стиль-проп backgroundImage (текущий брейкпоинт).
            if (cmdStore && tb === b) {
                var bgChanged = runCommands([
                    { type: "setStyle", payload: { id: b.id, breakpoint: currentBp, prop: "backgroundImage", value: "url('" + url + "')" } },
                    { type: "setContent", payload: { id: b.id, field: "bgMode", value: "image" } }
                ], "pick-background");
                patchBlockDom(b.id, { allowChildren: true, refreshDesign: true });
                if (bgChanged) scheduleAutosave();
            } else {
                if (!tb.styles) tb.styles = {};
                if (!tb.styles[currentBp]) tb.styles[currentBp] = {};
                tb.styles[currentBp].backgroundImage = "url('" + url + "')";
                if (!tb.content) tb.content = {};
                tb.content.bgMode = "image";
                if (tb === b) patchBlockDom(b.id, { allowChildren: true, refreshDesign: true });
                else render();
                markDirty();
            }
        } else if (pickCtx.target === "blockpath") {
            // Путь относительно самого блока (напр. layers.0.src — картинка декор-слоя).
            setByPath(tb, pickCtx.field, url);
            if (tb === b) patchBlockDom(b.id, { allowChildren: true, refreshDesign: true });
            else render();
            markDirty();
        } else {
            setContentValue(b, pickCtx.field, url, false);
        }
    }

    function promptVideo(blockId) {
        var url = window.prompt("Ссылка YouTube (https://youtube.com/watch?v=... или https://youtu.be/...)");
        if (!url) return;
        var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/);
        if (!m) { alert("Не распознал ссылку YouTube."); return; }
        var b = byId(blockId);
        if (!b) return;
        setContentValue(b, "youtubeId", m[1], false);
    }
    function promptEmbed(blockId) {
        var url = window.prompt("Ссылка на сцену (https — Spline / Rive / Lottie / iframe):", "https://");
        if (url == null) return;
        url = url.trim();
        if (!/^https:\/\//i.test(url)) { alert("Нужна ссылка, начинающаяся с https://"); return; }
        var b = byId(blockId);
        if (!b) return;
        setContentValue(b, "embedUrl", url, false);
    }

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

    // ===== BLOCK OPS (parent-aware: работают и для вложенных блоков) =====
    function moveBlock(dir) {
        var r = findBlock(selectedId);
        if (!r) return;
        var j = r.index + dir;
        if (j < 0 || j >= r.parent.length) return;
        var commandApplied = runCommand("reorderBlock", { id: r.block.id, toIndex: j });
        if (!commandApplied) {
            var tmp = r.parent[r.index]; r.parent[r.index] = r.parent[j]; r.parent[j] = tmp;
        }
        finishMove(r.block.id, r.parentBlock ? r.parentBlock.id : null, j, commandApplied); // Stage 7
    }
    function dupBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        var clone = reid(JSON.parse(JSON.stringify(r.block)));
        var commandApplied = runCommand("insertBlock", {
            block: clone,
            parentId: r.parentBlock ? r.parentBlock.id : null,
            pageIndex: active,
            index: r.index + 1
        });
        if (!commandApplied) r.parent.splice(r.index + 1, 0, clone);
        selectedId = clone.id;
        finishInsert(clone, r.parentBlock ? r.parentBlock.id : null, r.index + 1, commandApplied); // Stage 7
    }
    function delBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        var removedId = r.block.id;
        var commandApplied = runCommand("removeBlock", { id: r.block.id });
        if (!commandApplied) r.parent.splice(r.index, 1);
        selectedId = null;
        finishRemove(removedId, commandApplied); // Stage 7: точечное удаление вместо полного render
    }
    // «Наружу»: вытащить блок из контейнера на уровень самого контейнера (этап 1).
    function unwrapBlock() {
        var r = findBlock(selectedId);
        if (!r || !r.parentBlock) return;
        var rp = findBlock(r.parentBlock.id);
        if (!rp) return;
        var commandApplied = runCommand("moveBlock", {
            id: r.block.id,
            parentId: rp.parentBlock ? rp.parentBlock.id : null,
            pageIndex: active,
            toIndex: rp.index + 1
        });
        if (!commandApplied) {
            r.parent.splice(r.index, 1);
            rp.parent.splice(rp.index + 1, 0, r.block);
        }
        // Stage 7: точечный перенос на уровень родителя контейнера (после самого контейнера).
        finishMove(r.block.id, rp.parentBlock ? rp.parentBlock.id : null, rp.index + 1, commandApplied);
    }
    function selectedSiblingItems(ids) {
        ids = ids || [];
        if (ids.length < 2) return null;
        var seen = {}, parent = null, parentBlock = null, items = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (!id || seen[id]) return null;
            seen[id] = true;
            var r = findBlock(id);
            if (!r) return null;
            if (parent && parent !== r.parent) return null;
            parent = r.parent;
            parentBlock = r.parentBlock;
            items.push(r);
        }
        items.sort(function (a, b) { return a.index - b.index; });
        return { parent: parent, parentBlock: parentBlock, items: items };
    }
    function frameNumber(v, fallback) {
        if (typeof v === "number" && isFinite(v)) return v;
        if (typeof v === "string" && /^-?(?:\d+|\d*\.\d+)/.test(v.trim())) return parseFloat(v);
        return fallback;
    }
    function frameForGroup(block) {
        var d = resolvedBlockDesign(block, currentBp);
        var f = (d && d.frame) || {};
        var out = {
            x: frameNumber(f.x, 0),
            y: frameNumber(f.y, 0),
            width: Math.max(8, frameNumber(f.width, 100)),
            height: Math.max(8, frameNumber(f.height, 100))
        };
        if (typeof f.rotation === "number" && isFinite(f.rotation)) out.rotation = f.rotation;
        return out;
    }
    function parentLayoutIsFree(parentBlock) {
        var t = parentBlock && targetBlock(parentBlock);
        var d = t && L.resolvedDesign(t.design, currentBp);
        return !!(d && d.layout && d.layout.mode === "free");
    }
    function blockWithFrame(block, frame) {
        var out = clone(block);
        if (!out.design) out.design = {};
        if (!out.design[currentBp]) out.design[currentBp] = {};
        out.design[currentBp].frame = frame;
        return out;
    }
    function frameBounds(frames) {
        var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (var i = 0; i < frames.length; i++) {
            var f = frames[i];
            left = Math.min(left, f.x); top = Math.min(top, f.y);
            right = Math.max(right, f.x + f.width); bottom = Math.max(bottom, f.y + f.height);
        }
        return {
            x: Math.round(left), y: Math.round(top),
            width: Math.max(8, Math.round(right - left)), height: Math.max(8, Math.round(bottom - top))
        };
    }
    function buildGroupBlock(selection, freeParent) {
        var group = L.createBlock("group");
        group.name = "Group";
        if (!freeParent) {
            group.children = selection.items.map(function (item) { return item.block; });
            return group;
        }
        var frames = selection.items.map(function (item) { return frameForGroup(item.block); });
        var bounds = frameBounds(frames);
        group.children = selection.items.map(function (item, i) {
            var f = frames[i];
            var next = {
                x: Math.round(f.x - bounds.x),
                y: Math.round(f.y - bounds.y),
                width: Math.max(8, Math.round(f.width)),
                height: Math.max(8, Math.round(f.height))
            };
            if (typeof f.rotation === "number" && f.rotation !== 0) next.rotation = f.rotation;
            return blockWithFrame(item.block, next);
        });
        group.design = {};
        group.design[currentBp] = {
            layout: { mode: "free" },
            size: {
                width: { mode: "fixed", value: bounds.width },
                height: { mode: "fixed", value: bounds.height }
            },
            frame: bounds
        };
        return group;
    }
    function finishGroupDom(group, parentBlock, index, oldIds, commandApplied) {
        var parentId = parentBlock ? parentBlock.id : null;
        var ok = removeBlocksDom(oldIds) &&
            insertBlockDom(group, parentId, index, { allowDesign: true, refreshDesign: true });
        if (ok) refreshInspector(); else render();
        if (commandApplied) scheduleAutosave(); else markDirty();
    }
    function finishUngroupDom(groupId, parentBlock, index, children, commandApplied) {
        var parentId = parentBlock ? parentBlock.id : null;
        var ok = removeBlockDom(groupId);
        for (var i = 0; ok && i < children.length; i++) {
            ok = insertBlockDom(children[i], parentId, index + i, { allowDesign: true, refreshDesign: true });
        }
        if (ok) refreshInspector(); else render();
        if (commandApplied) scheduleAutosave(); else markDirty();
    }
    function groupSelection() {
        var selection = selectedSiblingItems(v2SelectionIds());
        if (!selection) { setStatus("Select sibling blocks to group", "lime-text-danger"); return; }
        var group = buildGroupBlock(selection, parentLayoutIsFree(selection.parentBlock));
        var ids = selection.items.map(function (item) { return item.block.id; });
        var groupIndex = selection.items[0].index;
        var commandApplied = false;
        if (cmdStore) {
            commandApplied = runCommand("groupBlocks", { ids: ids, group: group });
            if (!commandApplied) return;
        } else {
            beginCheckpointMutation();
            for (var i = selection.items.length - 1; i >= 0; i--) selection.parent.splice(selection.items[i].index, 1);
            selection.parent.splice(selection.items[0].index, 0, group);
        }
        selectedId = group.id;
        finishGroupDom(group, selection.parentBlock, groupIndex, ids, commandApplied);
        if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.replace([group.id]);
    }
    function childrenForUngroup(r) {
        var kids = r.block.children || [];
        if (!parentLayoutIsFree(r.parentBlock)) return kids;
        var groupFrame = frameForGroup(r.block);
        return kids.map(function (child) {
            var f = frameForGroup(child);
            var next = {
                x: Math.round(groupFrame.x + f.x),
                y: Math.round(groupFrame.y + f.y),
                width: Math.max(8, Math.round(f.width)),
                height: Math.max(8, Math.round(f.height))
            };
            if (typeof f.rotation === "number" && f.rotation !== 0) next.rotation = f.rotation;
            return blockWithFrame(child, next);
        });
    }
    function ungroupBlock() {
        var r = findBlock(selectedId);
        if (!r || !r.block || r.block.type !== "group" || !r.block.children || !r.block.children.length) return;
        var children = childrenForUngroup(r);
        var childIds = children.map(function (child) { return child.id; });
        var groupId = r.block.id;
        var parentBlock = r.parentBlock;
        var groupIndex = r.index;
        var commandApplied = false;
        if (cmdStore) {
            commandApplied = runCommand("ungroupBlock", { id: r.block.id, children: children });
            if (!commandApplied) return;
        } else {
            beginCheckpointMutation();
            r.parent.splice(r.index, 1);
            for (var i = 0; i < children.length; i++) r.parent.splice(r.index + i, 0, children[i]);
        }
        selectedId = childIds[0] || null;
        finishUngroupDom(groupId, parentBlock, groupIndex, children, commandApplied);
        if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.replace(childIds);
    }

    // ===== COPY / PASTE (этап 0.4) — через localStorage, чтобы вставлять между страницами/сайтами =====
    var CLIP_KEY = "lime-doc-clip";
    var clipboard = null;
    function copyBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        clipboard = JSON.parse(JSON.stringify(r.block));
        try { localStorage.setItem(CLIP_KEY, JSON.stringify(clipboard)); } catch (e) { /* приватный режим */ }
        setStatus("Блок скопирован", "");
    }
    function readClip() {
        if (clipboard) return clipboard;
        try { return JSON.parse(localStorage.getItem(CLIP_KEY)); } catch (e) { return null; }
    }
    function pasteBlock() {
        var data = readClip();
        if (!data) return;
        var clone = reid(JSON.parse(JSON.stringify(data)));
        var r = findBlock(selectedId);
        var commandApplied = runCommand("insertBlock", {
            block: clone,
            parentId: r && r.parentBlock ? r.parentBlock.id : null,
            pageIndex: active,
            index: r ? r.index + 1 : pageBlocks().length
        });
        if (!commandApplied) {
            if (r) r.parent.splice(r.index + 1, 0, clone); // после выбранного
            else pageBlocks().push(clone);                 // или в конец страницы
        }
        selectedId = clone.id;
        finishMutation(commandApplied);
    }

    // ===== ВЫБОР / СНЯТИЕ ВЫБОРА (общая точка для холста, слоёв, контекст-меню) =====
    function selectById(id) {
        selectedId = id; currentState = "normal"; currentClass = null;
        var all = ws.querySelectorAll(".is-selected");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("is-selected");
        var sec = ws.querySelector('[data-block-id="' + id + '"]');
        if (sec) { sec.classList.add("is-selected"); sec.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
        refreshInspector(); refreshLayers();
    }
    function deselect() {
        selectedId = null; currentClass = null;
        var all = ws.querySelectorAll(".is-selected");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("is-selected");
        refreshInspector(); refreshLayers();
    }

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

    // ===== COMPONENTS =====
    function makeComponent() {
        var r = findBlock(selectedId);
        if (!r) return;
        var src = r.block;
        if (src.type === "component") return;
        var name = prompt("Название компонента (например, «Хедер»):", src.type);
        if (name === null) return;
        beginCheckpointMutation();
        var cid = rid("c");
        var def = JSON.parse(JSON.stringify(src));
        delete def.id;
        doc.components[cid] = { name: name || src.type, block: def };
        r.parent[r.index] = { id: rid("b"), type: "component", ref: cid };
        selectedId = r.parent[r.index].id;
        refreshComponents(); render(); markDirty();
    }
    function componentVariantId(comp) {
        var id, variants = (comp && comp.variants) || [];
        do {
            id = rid("v");
            var exists = false;
            for (var i = 0; i < variants.length; i++) {
                if (variants[i] && variants[i].id === id) { exists = true; break; }
            }
        } while (exists);
        return id;
    }
    function clearComponentContentOverride(inst) {
        if (!inst || !inst.overrides || !inst.overrides.content) return;
        delete inst.overrides.content;
        if (!Object.keys(inst.overrides).length) delete inst.overrides;
    }
    function componentVariantSnapshot(inst) {
        var copy = clone(componentSourceBlock(inst) || {});
        if (inst.overrides && inst.overrides.content) {
            copy.content = L.mergeDesign(copy.content || {}, inst.overrides.content);
        }
        delete copy.id;
        return copy;
    }
    function addComponentVariantFromInstance() {
        beginCheckpointMutation();
        var r = findBlock(selectedId);
        if (!r || !r.block || r.block.type !== "component") return;
        var inst = r.block;
        var comp = componentRecord(inst.ref);
        if (!comp) return;
        var defaultName = "Variant " + (((comp.variants && comp.variants.length) || 0) + 1);
        var name = prompt("Variant name:", defaultName);
        if (name === null) return;
        if (!comp.variants) comp.variants = [];
        var vid = componentVariantId(comp);
        comp.variants.push({ id: vid, name: (name.trim() || defaultName), block: componentVariantSnapshot(inst) });
        inst.variant = vid;
        clearComponentContentOverride(inst);
        finishMutation(false);
    }
    function setComponentVariant(value) {
        var r = findBlock(selectedId);
        if (!r || !r.block || r.block.type !== "component") return;
        var inst = r.block;
        var comp = componentRecord(inst.ref);
        if (!comp) return;
        var variant = value || "";
        if (variant && !componentVariantRecord(comp, variant)) return;
        if ((inst.variant || "") === variant) return;
        var commandApplied = runCommand("setComponentVariant", { id: inst.id, variant: variant || null });
        if (!commandApplied) {
            beginCheckpointMutation();
            if (variant) inst.variant = variant; else delete inst.variant;
        }
        finishMutation(commandApplied);
    }
    function detachedComponentBlock(inst) {
        var def = componentSourceBlock(inst);
        var copy = reid(JSON.parse(JSON.stringify(def || {})));
        copy.id = inst.id;
        if (inst.name) copy.name = inst.name;
        if (inst.hidden) copy.hidden = true;
        if (inst.locked) copy.locked = true;
        if (inst.overrides && inst.overrides.content) {
            copy.content = L.mergeDesign(copy.content || {}, inst.overrides.content);
        }
        if (inst.design) copy.design = L.mergeInstanceDesign(copy.design, inst.design);
        return copy;
    }
    function detachComponent() {
        var r = findBlock(selectedId);
        if (!r) return;
        var inst = r.block;
        if (inst.type !== "component" || !doc.components[inst.ref]) return;
        var copy = detachedComponentBlock(inst);
        var commandApplied = runCommand("detachComponent", { id: inst.id, block: copy });
        if (!commandApplied) {
            beginCheckpointMutation();
            r.parent[r.index] = copy;
        }
        finishMutation(commandApplied);
    }
    // Сброс ВСЕХ локальных правок инстанса (content + style overrides) к определению — без detach.
    function resetComponentOverrides() {
        var r = findBlock(selectedId);
        if (!r || !r.block || r.block.type !== "component" || !r.block.overrides) return;
        var commandApplied = runCommand("clearComponentOverrides", { id: r.block.id });
        if (!commandApplied) {
            beginCheckpointMutation();
            delete r.block.overrides;
        }
        finishMutation(commandApplied);
    }
    function insertComponent(cid) {
        if (!doc.components[cid]) return;
        beginCheckpointMutation();
        var inst = { id: rid("b"), type: "component", ref: cid };
        pageBlocks().push(inst);
        selectedId = inst.id;
        finishInsert(inst, null, null, false); // Stage 7: append, checkpoint → markDirty
    }
    function refreshComponents() {
        var box = document.getElementById("lime-doc-components");
        if (!box) return;
        var keys = Object.keys(doc.components);
        if (!keys.length) {
            box.innerHTML = '<p class="lime-text-muted" style="font-size: var(--text-xs); line-height:1.5;">Пока нет. Выбери блок → в инспекторе «⊞ В компонент» — и он появится здесь для переиспользования.</p>';
            return;
        }
        box.innerHTML = keys.map(function (cid) {
            return '<button type="button" class="lime-block-tile" data-doc-insert-comp="' + cid + '"><span class="lime-block-tile__icon">⊞</span><span>' + escapeText(doc.components[cid].name) + '</span></button>';
        }).join("");
    }

    function componentVariantControls(inst) {
        var comp = inst && inst.type === "component" ? componentRecord(inst.ref) : null;
        if (!comp) return "";
        var selected = inst.variant || "";
        var options = '<option value=""' + (!selected ? " selected" : "") + '>Default</option>';
        var variants = comp.variants || [];
        for (var i = 0; i < variants.length; i++) {
            if (!variants[i] || !variants[i].id) continue;
            options += '<option value="' + escapeText(variants[i].id) + '"' + (selected === variants[i].id ? " selected" : "") + '>' + escapeText(variants[i].name || variants[i].id) + '</option>';
        }
        return '<div style="display:flex;gap:6px;width:100%;">' +
            '<select class="lime-select" data-doc-component-variant style="flex:1;">' + options + '</select>' +
            '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-component-variant-add>+ Variant</button>' +
            '</div>';
    }

    // ===== Component properties (минимальный вид) =====
    // Без отдельного surface для правки определения: свойства АВТО-производятся из текстовых
    // top-level content-полей определения. Инстанс правит их локально (overrides.content — путь 6.5),
    // не трогая определение и другие копии. Не-текстовые/конфиг-поля исключены денилистом.
    var PROP_LABELS = { text: "Текст", title: "Заголовок", subtitle: "Подзаголовок", caption: "Подпись", alt: "Alt-текст", quote: "Цитата", author: "Автор", label: "Кнопка", heading: "Заголовок", body: "Текст", name: "Имя" };
    var NON_TEXT_CONTENT = { src: 1, url: 1, youtubeId: 1, embedUrl: 1, bgMode: 1, mode: 1, width: 1, layout: 1, cols: 1, items: 1, collection: 1, href: 1, poster: 1, videoUrl: 1 };
    function attrVal(s) { return escapeText(s).replace(/"/g, "&quot;"); }
    function componentTextProps(inst) {
        if (!inst || inst.type !== "component" || !componentRecord(inst.ref)) return [];
        var def = componentSourceBlock(inst) || {};
        var defContent = def.content || {};
        var ovr = (inst.overrides && inst.overrides.content) || {};
        var out = [];
        Object.keys(defContent).forEach(function (key) {
            if (NON_TEXT_CONTENT[key] || typeof defContent[key] !== "string") return;
            var overridden = hasOwn(ovr, key) && typeof ovr[key] === "string";
            out.push({ key: key, label: PROP_LABELS[key] || key, value: overridden ? ovr[key] : defContent[key], overridden: overridden });
        });
        return out;
    }
    function componentPropsSection(b) {
        var props = componentTextProps(b);
        if (!props.length) return "";
        var rows = props.map(function (p) {
            var badge = p.overridden ? ' <span class="lime-style-override__badge" title="Локально переопределено">●</span>' : '';
            var reset = p.overridden
                ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-prop-reset="' + attrVal(p.key) + '" title="К значению компонента">↺</button>'
                : '';
            return '<label class="lime-v2-field"><span>' + escapeText(p.label) + badge + '</span>' +
                '<input type="text" class="lime-input lime-input--sm" data-doc-prop="' + attrVal(p.key) + '" value="' + attrVal(p.value) + '">' + reset + '</label>';
        }).join("");
        return sec("Свойства компонента", rows);
    }

    // ===== PAGES =====
    function slugify(s) {
        return String(s || "").toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "");
    }
    function refreshPages() {
        var box = document.getElementById("lime-doc-pages");
        if (!box) return;
        box.innerHTML = doc.pages.map(function (p, i) {
            return '<button type="button" class="lime-doc-page-tab' + (i === active ? " is-active" : "") + '" data-doc-page="' + i + '" title="Двойной клик — управление страницами">' + escapeText(p.title || "Стр.") + '</button>';
        }).join("") +
            '<button type="button" class="lime-doc-page-tab lime-doc-page-add" data-doc-page-add title="Добавить страницу">+</button>' +
            '<button type="button" class="lime-doc-page-tab lime-doc-page-manage" data-doc-pages-open title="Управление страницами">⚙</button>';
    }
    // Уникальный непустой слаг (главная — индекс 0 — всегда "").
    function uniqueSlug(base, exceptIdx) {
        var s = slugify(base) || "page";
        var taken = {};
        doc.pages.forEach(function (p, i) { if (i !== exceptIdx) taken[p.slug || ""] = 1; });
        var out = s, n = 2;
        while (taken[out]) { out = s + "-" + (n++); }
        return out;
    }
    function addPage() {
        beginCheckpointMutation();
        doc.pages.push({ id: rid("p"), slug: uniqueSlug("page" + (doc.pages.length + 1)), title: "Страница " + (doc.pages.length + 1), blocks: [] });
        active = doc.pages.length - 1;
        selectedId = null;
        refreshPages(); render(); markDirty();
        renderPagesList();
    }
    function switchPage(i) {
        if (i < 0 || i >= doc.pages.length) return;
        active = i; selectedId = null;
        refreshPages(); render();
    }
    function duplicatePage(i) {
        var src = doc.pages[i];
        beginCheckpointMutation();
        var copy = JSON.parse(JSON.stringify(src));
        copy.id = rid("p");
        copy.title = (src.title || "Страница") + " (копия)";
        copy.slug = uniqueSlug(copy.title, -1);
        (copy.blocks || []).forEach(function (b) { reid(b); }); // уникальные id блоков в документе
        doc.pages.splice(i + 1, 0, copy);
        active = i + 1; selectedId = null;
        refreshPages(); render(); markDirty();
        renderPagesList();
    }
    function deletePage(i) {
        if (doc.pages.length <= 1) { alert("Нельзя удалить единственную страницу."); return; }
        if (!confirm("Удалить страницу «" + (doc.pages[i].title || "") + "» со всеми блоками?")) return;
        beginCheckpointMutation();
        doc.pages.splice(i, 1);
        if (active >= doc.pages.length) active = doc.pages.length - 1;
        // Гарантия: первая страница — главная (slug "").
        if (doc.pages[0]) doc.pages[0].slug = "";
        selectedId = null;
        refreshPages(); render(); markDirty();
        renderPagesList();
    }
    function setPageTitle(i, val) {
        beginCheckpointMutation();
        doc.pages[i].title = val;
        var tabs = document.querySelectorAll('#lime-doc-pages [data-doc-page="' + i + '"]');
        for (var t = 0; t < tabs.length; t++) tabs[t].textContent = val || "Стр.";
        markDirty();
    }
    function setPageSlug(i, val) {
        if (i === 0) return; // главная всегда ""
        beginCheckpointMutation();
        doc.pages[i].slug = uniqueSlug(val || doc.pages[i].title || "page", i);
        markDirty();
        renderPagesList(); // показать нормализованный/уникальный слаг
    }
    // Полноценный менеджер страниц (этап 0.3): список с правкой названия/слага, дубль, удаление.
    function renderPagesList() {
        var box = document.getElementById("lime-doc-pages-list");
        if (!box) return;
        box.innerHTML = doc.pages.map(function (p, i) {
            var isHome = i === 0;
            var slugField = isHome
                ? '<span class="lime-text-muted" style="font-size:var(--text-xs);">главная (/)</span>'
                : '<input type="text" class="lime-input lime-input--sm" data-doc-page-slug="' + i + '" value="' + escapeText(p.slug || "") + '" placeholder="slug" style="width:140px;">';
            // CMS 2.0: не-главную страницу можно сделать шаблоном записи коллекции (динамические /slug/:rec).
            var tmplField = (!isHome && collectionsCache && collectionsCache.length)
                ? '<select class="lime-select lime-input--sm" data-doc-page-collection="' + i + '" title="Страница-шаблон записи коллекции" style="width:150px;">' +
                    '<option value="">обычная</option>' +
                    collectionsCache.map(function (c) {
                        return '<option value="' + escapeText(c.slug) + '"' + ((p.collection || "") === c.slug ? " selected" : "") + ">📄 " + escapeText(c.name) + "</option>";
                    }).join("") + "</select>"
                : "";
            return '<div style="margin-bottom: var(--space-3);">' +
                '<div class="lime-doc-page-row' + (i === active ? " is-active" : "") + '">' +
                '<button type="button" class="lime-doc-page-row__open" data-doc-page-goto="' + i + '" title="Открыть страницу">' + (isHome ? "🏠" : "▦") + '</button>' +
                '<input type="text" class="lime-input lime-input--sm" data-doc-page-title="' + i + '" value="' + escapeText(p.title || "") + '" style="flex:1;">' +
                slugField + tmplField +
                '<button type="button" class="lime-block-toolbar__btn" data-doc-page-dup="' + i + '" title="Дублировать">⎘</button>' +
                (doc.pages.length > 1 ? '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-page-del="' + i + '" title="Удалить">✕</button>' : '') +
                '</div>' +
                // SEO/AEO: описание страницы для поиска/соцсетей (этап 3.6).
                '<input type="text" class="lime-input lime-input--sm" data-doc-page-desc="' + i + '" value="' + escapeText(p.description || "") + '" maxlength="300" placeholder="SEO-описание страницы (для поиска и соцсетей)" style="width:100%; margin-top:4px;">' +
                '</div>';
        }).join("");
    }

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
        shadowBuilder: shadowBuilder,
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

    // ----- Панель «Классы» (этап 0.1): назначение/снятие/создание/правка классов блока -----
    function classesSection(b) {
        var t = targetBlock(b);
        var assigned = (t && t.classes) || [];
        var defs = classDefs();
        var chips = assigned.map(function (cls) {
            var def = findClassDef(cls);
            var nm = def ? (def.name || def.cls) : cls;
            return '<span class="lime-doc-class-chip">' +
                '<button type="button" class="lime-doc-class-chip__edit" data-doc-class-edit="' + escapeText(cls) + '" title="Редактировать класс">' + escapeText(nm) + '</button>' +
                '<button type="button" class="lime-doc-class-chip__x" data-doc-class-remove="' + escapeText(cls) + '" title="Снять с блока">✕</button>' +
                '</span>';
        }).join("");
        var avail = defs.filter(function (d) { return assigned.indexOf(d.cls) === -1; });
        var sel = avail.length
            ? '<select class="lime-select" data-doc-class-add style="flex:1;">' +
                '<option value="">+ применить класс…</option>' +
                avail.map(function (d) { return '<option value="' + escapeText(d.cls) + '">' + escapeText(d.name || d.cls) + '</option>'; }).join("") +
                '</select>'
            : '';
        var body =
            (chips
                ? '<div class="lime-doc-class-chips">' + chips + '</div>'
                : '<div class="lime-inspector__hint">Класс — набор стилей для многих блоков. Меняешь класс — меняются все блоки с ним.</div>') +
            '<div class="lime-flex lime-gap-2" style="margin-top:6px;align-items:center;">' + sel +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-class-new title="Создать класс из текущих стилей блока">＋ Из стилей</button>' +
            '</div>';
        return sec("Классы", body);
    }
    function classEditBanner() {
        var def = findClassDef(currentClass);
        var nm = def ? (def.name || def.cls) : currentClass;
        return sec("Класс «" + escapeText(nm) + "»",
            '<div class="lime-doc-comp-banner">✎ Правишь класс — изменения применяются ко всем блокам с ним.</div>' +
            '<div class="lime-flex lime-gap-2" style="margin-top:6px;align-items:center;">' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-class-rename title="Переименовать">✎ Имя</button>' +
                '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-class-delete title="Удалить класс">🗑</button>' +
                '<button type="button" class="lime-btn lime-btn--sm" data-doc-class-done style="margin-left:auto;">Готово</button>' +
            '</div>');
    }

    // Обход всех блоков документа (страницы + определения компонентов, рекурсивно по children).
    function walkAllBlocks(fn) {
        function rec(arr) {
            for (var i = 0; i < arr.length; i++) {
                fn(arr[i]);
                var t = targetBlock(arr[i]);
                if (t && t.children) rec(t.children);
            }
        }
        doc.pages.forEach(function (p) { rec(p.blocks || []); });
        Object.keys(doc.components).forEach(function (k) {
            var cb = doc.components[k] && doc.components[k].block;
            if (cb) { fn(cb); if (cb.children) rec(cb.children); }
        });
    }
    function stripClassEverywhere(cls) {
        walkAllBlocks(function (b) {
            if (b.classes) {
                var i = b.classes.indexOf(cls);
                if (i !== -1) b.classes.splice(i, 1);
                if (!b.classes.length) delete b.classes;
            }
        });
    }
    function applyClassToBlock(cls) {
        var b = byId(selectedId); if (!b || !cls) return;
        beginCheckpointMutation();
        if (blockClassList(b).indexOf(cls) === -1) toggleBlockClass(b, cls);
        render(); markDirty();
    }
    function removeClassFromBlock(cls) {
        var b = byId(selectedId); if (!b) return;
        beginCheckpointMutation();
        var list = blockClassList(b);
        var i = list.indexOf(cls); if (i !== -1) list.splice(i, 1);
        if (!list.length) delete targetBlock(b).classes;
        render(); markDirty();
    }
    function createClassFromBlock() {
        var b = byId(selectedId); if (!b) return;
        var t = targetBlock(b);
        var name = (window.prompt("Название класса:", "Мой класс") || "").trim();
        if (!name) return;
        beginCheckpointMutation();
        var cls = newClassId();
        // Снимок текущих стилей блока становится стилями класса (Webflow «extract to class»):
        // свои стили блока убираем — теперь вид задаёт класс, и его можно менять для всех.
        var styles = t.styles ? JSON.parse(JSON.stringify(t.styles)) : {};
        classDefs().push({ cls: cls, name: name, styles: styles });
        if (!t.classes) t.classes = [];
        t.classes.push(cls);
        delete t.styles;
        currentClass = cls; currentState = "normal"; // сразу правим созданный класс
        render(); markDirty();
    }
    function editClass(cls) { currentClass = cls; currentState = "normal"; render(); }
    function exitClassEdit() { currentClass = null; render(); }
    function deleteClass(cls) {
        if (!window.confirm("Удалить класс? Он снимется со всех блоков.")) return;
        beginCheckpointMutation();
        var l = classDefs();
        for (var i = 0; i < l.length; i++) if (l[i].cls === cls) { l.splice(i, 1); break; }
        stripClassEverywhere(cls);
        currentClass = null; render(); markDirty();
    }
    function renameClass(cls) {
        var def = findClassDef(cls); if (!def) return;
        var name = (window.prompt("Новое имя класса:", def.name || "") || "").trim();
        if (name) { beginCheckpointMutation(); def.name = name; refreshInspector(); markDirty(); }
    }

    // ----- Многослойные тени (1.2). box-shadow — список слоёв через запятую; пишем
    // готовую CSS-строку в styles[bucket].boxShadow (движок не трогаем). Цвет храним
    // как hex + альфа → собираем в rgba(), чтобы тени были мягкими. -----
    function hexToRgba(hex, a) {
        var h = (hex || "#000000").replace("#", "");
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), bl = parseInt(h.slice(4, 6), 16);
        return "rgba(" + r + "," + g + "," + bl + "," + (a == null ? 1 : a) + ")";
    }
    function splitTopShadows(s) { // делит по запятым верхнего уровня (вне скобок rgba())
        var out = [], depth = 0, cur = "";
        for (var i = 0; i < s.length; i++) {
            var ch = s[i];
            if (ch === "(") depth++; else if (ch === ")") depth--;
            if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
        }
        if (cur.trim()) out.push(cur);
        return out;
    }
    function parseOneShadow(str) {
        str = (" " + str + " ").replace(/\s+inset\s+/i, " "); // вырезаем inset, запоминаем
        var inset = /\binset\b/i.test(arguments[0]);
        var color = "#000000", alpha = 0.25;
        var m = str.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/i);
        if (m) {
            var c = m[0]; str = str.replace(c, " ");
            var am = c.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i);
            alpha = am ? parseFloat(am[1]) : 1;
            color = toHex(c);
        }
        var nums = str.trim().split(/\s+/).filter(Boolean).map(function (n) { return parseInt(n, 10) || 0; });
        return { x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, color: color, alpha: alpha, inset: inset };
    }
    function parseShadows(v) {
        if (!v || v === "none") return [];
        return splitTopShadows(v).map(parseOneShadow);
    }
    function shadowCss(sh) {
        return (sh.inset ? "inset " : "") + sh.x + "px " + sh.y + "px " + sh.blur + "px " + sh.spread + "px " + hexToRgba(sh.color, sh.alpha);
    }
    function shRng(i, k, label, min, max, step, val, unit) {
        return '<div class="lime-inspector__hint" style="margin:4px 0 0;">' + label + '</div>' +
            '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-shadow="' + i + '" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="lime-range__val">' + val + unit + '</span></div>';
    }
    function shadowBuilder(cur) {
        var list = parseShadows(cur);
        var cards = list.map(function (sh, i) {
            var head = '<div class="lime-flex" style="justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<b style="font-size:var(--text-xs);">Тень ' + (i + 1) + (sh.inset ? " · внутр." : "") + '</b>' +
                '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-shadow-del="' + i + '" title="Убрать">✕</button></div>';
            var body = shRng(i, "x", "Сдвиг X", -50, 50, 1, sh.x, "px") +
                shRng(i, "y", "Сдвиг Y", -50, 50, 1, sh.y, "px") +
                shRng(i, "blur", "Размытие", 0, 100, 1, sh.blur, "px") +
                shRng(i, "spread", "Растяжение", -50, 50, 1, sh.spread, "px") +
                shRng(i, "alpha", "Прозрачность", 0, 1, 0.05, sh.alpha, "") +
                '<div class="lime-color-row" style="margin-top:4px;">' +
                    '<input type="color" class="lime-color-input" data-doc-shadow="' + i + '" data-k="color" value="' + toHex(sh.color) + '">' +
                    '<label style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:var(--text-xs);"><input type="checkbox" data-doc-shadow="' + i + '" data-k="inset"' + (sh.inset ? " checked" : "") + '>внутренняя</label>' +
                '</div>';
            return '<div class="lime-layer-card">' + head + body + '</div>';
        }).join("");
        return cards + '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-shadow-add style="width:100%;margin-top:6px;">＋ слой тени</button>';
    }
    // Сборка строки box-shadow из всех контролов билдера (паттерн composeGradient: без ре-рендера).
    function composeShadow() {
        var inputs = inspectorEl.querySelectorAll("[data-doc-shadow]");
        var byLayer = {};
        for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            var idx = el.getAttribute("data-doc-shadow");
            var k = el.getAttribute("data-k");
            if (!byLayer[idx]) byLayer[idx] = { x: 0, y: 0, blur: 0, spread: 0, color: "#000000", alpha: 0.25, inset: false };
            if (k === "inset") byLayer[idx].inset = el.checked;
            else if (k === "color") byLayer[idx].color = el.value;
            else if (k === "alpha") byLayer[idx].alpha = parseFloat(el.value);
            else byLayer[idx][k] = parseInt(el.value, 10) || 0;
        }
        var list = Object.keys(byLayer).sort(function (a, b) { return a - b; }).map(function (k) { return byLayer[k]; });
        setStyle("boxShadow", list.length ? list.map(shadowCss).join(", ") : "");
    }
    function addShadow() {
        var list = parseShadows(curStyle(byId(selectedId)).boxShadow);
        list.push({ x: 0, y: 8, blur: 24, spread: 0, color: "#000000", alpha: 0.25, inset: false });
        setStyle("boxShadow", list.map(shadowCss).join(", "));
        refreshInspector();
    }
    function delShadow(i) {
        var list = parseShadows(curStyle(byId(selectedId)).boxShadow);
        list.splice(i, 1);
        setStyle("boxShadow", list.length ? list.map(shadowCss).join(", ") : "");
        refreshInspector();
    }

    // Editor V2 layout inspector. Он виден только вместе с canvas flag и пишет исключительно
    // design breakpoint buckets; legacy styles/инспектор при выключенном флаге не меняются.
    function v2CanvasEnabled() { return /[?&]canvas=1\b/.test(location.search) && !!L.resolvedDesign; }
    function ownDesignField(source, field) {
        var target = designTarget(source, field);
        return clone(target && target.design && target.design[currentBp] && target.design[currentBp][field]) || {};
    }
    function designFieldSource(source, field) {
        var design = source && source.design || {};
        if (design[currentBp] && Object.prototype.hasOwnProperty.call(design[currentBp], field)) return currentBp;
        if (currentBp === "mobile" && design.tablet && Object.prototype.hasOwnProperty.call(design.tablet, field)) return "tablet";
        if (currentBp !== "base" && design.base && Object.prototype.hasOwnProperty.call(design.base, field)) return "base";
        return "default";
    }
    function inheritedDesignField(source, field) {
        var design = source && source.design || {};
        if (currentBp === "base") return null;
        var inheritedBp = currentBp === "mobile" ? "tablet" : "base";
        var value = L.resolvedDesign(design, inheritedBp);
        return value && value[field] || null;
    }
    function v2SourceRow(source, fields, lockedReset) {
        var unique = [];
        fields.forEach(function (field) { if (unique.indexOf(field) === -1) unique.push(field); });
        return '<div class="lime-v2-sources">' + unique.map(function (field) {
            var origin = designFieldSource(source, field);
            var own = origin === currentBp;
            var resettable = own && currentBp !== "base" && !(lockedReset && lockedReset[field]);
            return '<span><b>' + field + '</b>: ' + origin + (resettable
                ? ' <button type="button" data-v2-design-reset="' + field + '">сбросить</button>' : '') + '</span>';
        }).join("") + '</div>';
    }
    function isCssLengthValue(value) {
        if (typeof value === "number") return isFinite(value);
        return typeof value === "string" && /^-?(?:\d+|\d*\.\d+)(?:px|%|rem)$/.test(value.trim());
    }
    function clampCssLengthValue(value, min) {
        var parsed = splitCssLength(value, "px");
        var n = Math.max(min == null ? -Infinity : min, parsed.num);
        return cssLengthValue(n, parsed.unit || "px");
    }
    function designInputValue(input) {
        var n = parseFloat(input.value);
        if (!isFinite(n)) return null;
        var unit = input.getAttribute("data-v2-unit") || "";
        return unit ? cssLengthValue(n, unit) : n;
    }
    function buildDesignObjectPatch(source, field, path, value) {
        var next = ownDesignField(source, field);
        // Inspector treats a missing layout as the default stack. Persist that mode with the
        // first nested edit; otherwise the renderer sees a partial { direction/gap/... } object
        // without layout.mode and correctly ignores it.
        if (field === "layout" && !next.mode) {
            var resolved = resolvedBlockDesign(source, currentBp);
            next.mode = resolved && resolved.layout && resolved.layout.mode || "stack";
        }
        if (field === "size" && value !== undefined && /^(width|height)\./.test(path)) {
            var sizeAxis = path.split(".")[0];
            if (!next[sizeAxis]) next[sizeAxis] = {};
            if (!next[sizeAxis].mode) {
                var resolvedSize = resolvedBlockDesign(source, currentBp).size || {};
                next[sizeAxis].mode = resolvedSize[sizeAxis] && resolvedSize[sizeAxis].mode || "hug";
            }
        }
        if (value !== undefined) {
            if (field === "layout" && path === "columns" && typeof value === "number") value = Math.max(1, Math.round(value));
            if (field === "layout" && path === "columns.min") value = clampCssLengthValue(value, 40);
            if (field === "layout" && (path === "gap" || path === "rowGap" || path === "columnGap" || path === "autoRows" || /^padding\./.test(path))) value = clampCssLengthValue(value, 0);
            if (field === "frame" && (path === "width" || path === "height")) value = clampCssLengthValue(value, 8);
            if (field === "size" && (/\.value$/.test(path) || /\.(min|max)$/.test(path))) value = clampCssLengthValue(value, 0);
            setByPath(next, path, value);
        } else deleteByPath(next, path);
        if (field === "size" && /^(width|height)\.mode$/.test(path) && value === "fixed") {
            var axis = path.split(".")[0];
            if (!next[axis] || !isCssLengthValue(next[axis].value)) {
                if (!next[axis]) next[axis] = {};
                var blockEl = ws.querySelector('[data-block-id="' + source.id + '"]');
                var scale = ws.offsetWidth ? ws.getBoundingClientRect().width / ws.offsetWidth : 1;
                if (!isFinite(scale) || scale <= 0) scale = 1;
                var rect = blockEl && blockEl.getBoundingClientRect();
                next[axis].value = Math.max(0, Math.round((rect ? rect[axis] : 100) / scale));
            }
        }
        return next;
    }
    function patchDesignObject(source, field, path, value) {
        if (!source || designTarget(source, field) !== source) return;
        var next = buildDesignObjectPatch(source, field, path, value);
        setDesignValue(source, currentBp, field, next, false);
        refreshInspector();
    }
    function v2Number(label, field, path, value, min, units) {
        var parsed = units && units.length ? splitCssLength(value, "px") : { num: (typeof value === "number" && isFinite(value) ? value : 0), unit: "", empty: false };
        var n = parsed.empty ? 0 : parsed.num;
        return '<label class="lime-v2-field"><span class="lime-v2-scrub" data-scrub title="Тяни, чтобы менять (Shift ×10, Alt ×0.1)">' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1"' +
            (min == null ? "" : ' min="' + min + '"') + ' value="' + n + '"' + (units && units.length ? ' data-v2-unit="' + (parsed.unit || "px") + '"' : "") +
            ' data-v2-design-field="' + field + '" data-v2-design-path="' + path + '">' + unitSelectHtml("data-v2-unit-for", path, parsed.unit || "px", units) + '</label>';
    }
    function v2OptionalNumber(label, field, path, value, min, units) {
        var parsed = units && units.length ? splitCssLength(value, "px") : { num: (typeof value === "number" && isFinite(value) ? value : 0), unit: "", empty: value == null };
        var shown = value == null || parsed.empty ? "" : String(parsed.num);
        return '<label class="lime-v2-field"><span class="lime-v2-scrub" data-scrub title="Тяни, чтобы менять">' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1"' +
            (min == null ? "" : ' min="' + min + '"') + ' value="' + shown + '" placeholder="—"' + (units && units.length ? ' data-v2-unit="' + (parsed.unit || "px") + '"' : "") +
            ' data-v2-design-optional data-v2-design-field="' + field + '" data-v2-design-path="' + path + '">' + unitSelectHtml("data-v2-unit-for", path, parsed.unit || "px", units) + '</label>';
    }
    function v2ChildNumber(label, field, value, min) {
        var n = typeof value === "number" && isFinite(value) ? value : (field === "order" ? 0 : 1);
        return '<label class="lime-v2-field"><span class="lime-v2-scrub" data-scrub title="Тяни, чтобы менять">' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1" min="' + min + '" value="' + n + '" data-v2-child-field="' + field + '"></label>';
    }
    function v2Select(label, field, path, value, options) {
        return '<label class="lime-v2-field"><span>' + label + '</span><select class="lime-select" data-v2-design-field="' + field + '" data-v2-design-path="' + path + '">' +
            options.map(function (o) { return '<option value="' + o.v + '"' + (value === o.v ? " selected" : "") + '>' + o.l + '</option>'; }).join("") +
            '</select></label>';
    }
    function v2SizeControls(design) {
        var size = design.size || {};
        var modes = [{ v: "hug", l: "Hug" }, { v: "fill", l: "Fill" }, { v: "fixed", l: "Fixed" }];
        var width = size.width || { mode: "hug" }, height = size.height || { mode: "hug" };
        var body = '<div class="lime-v2-fields">' +
            v2Select("Ширина", "size", "width.mode", width.mode || "hug", modes) +
            v2Select("Высота", "size", "height.mode", height.mode || "hug", modes) + '</div>';
        if (width.mode === "fixed" || height.mode === "fixed") {
            body += '<div class="lime-v2-fields">' +
                (width.mode === "fixed" ? v2Number("W", "size", "width.value", width.value, 0, CSS_UNITS) : "") +
                (height.mode === "fixed" ? v2Number("H", "size", "height.value", height.value, 0, CSS_UNITS) : "") + '</div>';
        }
        body += '<div class="lime-v2-subtitle">Min / Max</div><div class="lime-v2-fields">' +
            v2OptionalNumber("Min W", "size", "width.min", width.min, 0, CSS_UNITS) + v2OptionalNumber("Max W", "size", "width.max", width.max, 0, CSS_UNITS) +
            v2OptionalNumber("Min H", "size", "height.min", height.min, 0, CSS_UNITS) + v2OptionalNumber("Max H", "size", "height.max", height.max, 0, CSS_UNITS) + '</div>';
        return body;
    }
    function v2LayoutInspector(source, found) {
        if (!v2CanvasEnabled() || !source) return "";
        var isInstance = source.type === "component";
        if (!isInstance && targetBlock(source) !== source) return "";
        var design = resolvedBlockDesign(source, currentBp);
        var fields = ["size"];
        var lockedReset = {};
        var out = v2SizeControls(design);
        if (!isInstance && L.isContainer(source.type)) {
            fields.unshift("layout");
            var layout = design.layout || {};
            var mode = layout.mode || "stack";
            out = '<div class="lime-segmented">' + ["stack", "grid", "free"].map(function (m) {
                return '<button type="button" class="' + (mode === m ? "is-active" : "") + '" data-v2-layout-mode="' + m + '">' + m + '</button>';
            }).join("") + '</div>';
            if (mode === "stack") {
                out += '<div class="lime-segmented"><button type="button" class="' + (layout.direction !== "horizontal" ? "is-active" : "") + '" data-v2-layout-direction="vertical">Вертикально</button>' +
                    '<button type="button" class="' + (layout.direction === "horizontal" ? "is-active" : "") + '" data-v2-layout-direction="horizontal">Горизонтально</button></div>';
                out += '<div class="lime-v2-fields">' +
                    v2Select("Align", "layout", "align", layout.align || "stretch", [{ v: "start", l: "Start" }, { v: "center", l: "Center" }, { v: "end", l: "End" }, { v: "stretch", l: "Stretch" }, { v: "baseline", l: "Baseline" }]) +
                    v2Select("Justify", "layout", "justify", layout.justify || "start", [{ v: "start", l: "Start" }, { v: "center", l: "Center" }, { v: "end", l: "End" }, { v: "space-between", l: "Between" }, { v: "space-around", l: "Around" }, { v: "space-evenly", l: "Evenly" }]) + '</div>' +
                    '<div class="lime-segmented"><button type="button" class="' + (!layout.wrap ? "is-active" : "") + '" data-v2-layout-wrap="0">Без переноса</button>' +
                    '<button type="button" class="' + (layout.wrap ? "is-active" : "") + '" data-v2-layout-wrap="1">Wrap</button></div>';
            }
            if (mode === "grid") {
                var colsAuto = layout.columns && typeof layout.columns === "object" && layout.columns.mode === "auto";
                out += '<div class="lime-segmented"><button type="button" class="' + (!colsAuto ? "is-active" : "") + '" data-v2-grid-auto="0">Фикс.</button>' +
                    '<button type="button" class="' + (colsAuto ? "is-active" : "") + '" data-v2-grid-auto="1">Авто</button></div>';
                if (colsAuto) {
                    out += '<div class="lime-v2-fields">' + v2Number("Min", "layout", "columns.min", layout.columns.min || 240, 40, CSS_UNITS) + '</div>' +
                        '<div class="lime-segmented"><button type="button" class="' + (!layout.columns.fill ? "is-active" : "") + '" data-v2-grid-fill="0">Auto-fit</button>' +
                        '<button type="button" class="' + (layout.columns.fill ? "is-active" : "") + '" data-v2-grid-fill="1">Auto-fill</button></div>';
                } else {
                    out += '<div class="lime-v2-fields">' + v2Number("Колонки", "layout", "columns", (typeof layout.columns === "number" ? layout.columns : 2), 1) + '</div>';
                }
                out += '<div class="lime-v2-fields">' + v2OptionalNumber("Auto rows", "layout", "autoRows", layout.autoRows, 1, CSS_UNITS) + '</div>';
            }
            out += '<div class="lime-v2-fields">' +
                (mode !== "free" ? v2Number("Gap", "layout", "gap", layout.gap || 0, 0, CSS_UNITS) : "") + '</div>' + v2SizeControls(design);
            if (mode !== "free") {
                var padding = layout.padding || {};
                out += '<div class="lime-v2-subtitle">Padding</div><div class="lime-v2-fields">' +
                    v2Number("Top", "layout", "padding.top", padding.top || 0, 0, CSS_UNITS) + v2Number("Right", "layout", "padding.right", padding.right || 0, 0, CSS_UNITS) +
                    v2Number("Bottom", "layout", "padding.bottom", padding.bottom || 0, 0, CSS_UNITS) + v2Number("Left", "layout", "padding.left", padding.left || 0, 0, CSS_UNITS) + '</div>';
            }
            if (mode === "free") out += '<div class="lime-inspector__hint">Дети можно двигать и растягивать прямо на холсте. Стрелки: move, Shift: 10px, Ctrl/Cmd: resize.</div>';
            if (mode === "free") lockedReset.size = true;
        }
        var parent = found && found.parentBlock && targetBlock(found.parentBlock);
        var parentDesign = parent && L.resolvedDesign(parent.design, currentBp);
        if (parentDesign && parentDesign.layout && parentDesign.layout.mode === "free") {
            fields.push("frame", "constraints");
            if (!inheritedDesignField(source, "frame")) lockedReset.frame = true;
            var frame = design.frame || { x: 0, y: 0, width: 100, height: 100 };
            var constraints = design.constraints || { horizontal: "left", vertical: "top" };
            out += '<div class="lime-v2-subtitle">Frame</div><div class="lime-v2-fields">' +
                v2Number("X", "frame", "x", frame.x) + v2Number("Y", "frame", "y", frame.y) +
                v2Number("W", "frame", "width", frame.width, 8) + v2Number("H", "frame", "height", frame.height, 8) + '</div>' +
                '<div class="lime-v2-subtitle">Constraints</div><div class="lime-v2-fields">' +
                v2Select("По X", "constraints", "horizontal", constraints.horizontal || "left", [{ v: "left", l: "Left" }, { v: "right", l: "Right" }, { v: "center", l: "Center" }, { v: "stretch", l: "Stretch" }]) +
                v2Select("По Y", "constraints", "vertical", constraints.vertical || "top", [{ v: "top", l: "Top" }, { v: "bottom", l: "Bottom" }, { v: "center", l: "Center" }, { v: "stretch", l: "Stretch" }]) + '</div>';
        }
        if (!isInstance && parentDesign && parentDesign.layout && parentDesign.layout.mode === "stack") {
            fields.push("order");
            out += '<div class="lime-v2-subtitle">Stack child</div><div class="lime-v2-fields">' +
                v2ChildNumber("Order", "order", design.order, -1000) + '</div>';
        }
        // Ребёнок grid-родителя: span по колонкам/строкам. Только для обычного блока,
        // не instance (instance остаётся geometry-only по RFC).
        if (!isInstance && parentDesign && parentDesign.layout && parentDesign.layout.mode === "grid") {
            fields.push("span", "rowSpan");
            var spanVal = (typeof design.span === "number" && design.span > 0) ? Math.floor(design.span) : 1;
            var rowSpanVal = (typeof design.rowSpan === "number" && design.rowSpan > 0) ? Math.floor(design.rowSpan) : 1;
            out += '<div class="lime-v2-subtitle">Grid</div><div class="lime-v2-fields">' +
                v2ChildNumber("Column span", "span", spanVal, 1) + v2ChildNumber("Row span", "rowSpan", rowSpanVal, 1) + '</div>';
        }
        // Overflow: показывать или обрезать содержимое за рамкой блока (не для instance — geometry-only).
        if (!isInstance) {
            fields.push("overflow");
            var ovf = design.overflow === "hidden" ? "hidden" : "visible";
            out += '<div class="lime-v2-subtitle">Overflow</div><div class="lime-segmented">' +
                [["visible", "Видно"], ["hidden", "Обрезать"]].map(function (o) {
                    return '<button type="button" class="' + (ovf === o[0] ? "is-active" : "") + '" data-v2-overflow="' + o[0] + '">' + o[1] + '</button>';
                }).join("") + '</div>';
        }
        return sec("Layout · V2", out + v2SourceRow(source, fields, lockedReset));
    }
    function switchV2LayoutMode(mode) {
        var source = selectedId && byId(selectedId);
        if (!source || targetBlock(source) !== source || !L.isContainer(source.type)) return;
        var effective = L.resolvedDesign(source.design, currentBp);
        if (((effective.layout && effective.layout.mode) || "stack") === mode) return;
        var layout = ownDesignField(source, "layout");
        layout.mode = mode;
        if (mode !== "free") { setDesignValue(source, currentBp, "layout", layout, false); refreshInspector(); return; }

        var children = source.children || [];
        var parentEl = ws.querySelector('[data-block-id="' + source.id + '"]');
        var wrapper = parentEl && parentEl.querySelector(":scope > .lime-block__inner > .lime-block__children");
        var scale = ws.offsetWidth ? ws.getBoundingClientRect().width / ws.offsetWidth : 1;
        if (!isFinite(scale) || scale <= 0) scale = 1;
        var wr = wrapper && wrapper.getBoundingClientRect();
        var pr = parentEl && parentEl.getBoundingClientRect();
        var size = ownDesignField(source, "size");
        if (!size.height || size.height.mode !== "fixed") size.height = { mode: "fixed", value: Math.max(8, Math.round((pr ? pr.height : 320) / scale)) };
        var commands = [
            { type: "setDesign", payload: { id: source.id, breakpoint: currentBp, field: "layout", value: layout } },
            { type: "setDesign", payload: { id: source.id, breakpoint: currentBp, field: "size", value: size } }
        ];
        var frames = [];
        children.forEach(function (child) {
            var childEl = ws.querySelector('[data-block-id="' + child.id + '"]');
            if (!childEl || !wr) return;
            var cr = childEl.getBoundingClientRect();
            var frame = {
                x: Math.round((cr.left - wr.left) / scale), y: Math.round((cr.top - wr.top) / scale),
                width: Math.max(8, Math.round(cr.width / scale)), height: Math.max(8, Math.round(cr.height / scale)), rotation: 0
            };
            frames.push({ child: child, frame: frame });
            commands.push({ type: "setDesign", payload: { id: child.id, breakpoint: currentBp, field: "frame", value: frame } });
        });
        if (cmdStore) {
            var changed = runCommands(commands, "layout-to-free");
            finishMutation(changed);
        } else {
            if (!source.design) source.design = {};
            if (!source.design[currentBp]) source.design[currentBp] = {};
            source.design[currentBp].layout = layout; source.design[currentBp].size = size;
            frames.forEach(function (item) {
                if (!item.child.design) item.child.design = {};
                if (!item.child.design[currentBp]) item.child.design[currentBp] = {};
                item.child.design[currentBp].frame = item.frame;
            });
            finishMutation(false);
        }
    }

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

    // Секция «Анимация появления» — общая на блок (не зависит от брейкпоинта).
    function animInspector(t) {
        var curAnim = (t && t.anim) || "";
        var presets = [
            { v: "", l: "—", t: "Без анимации" }, { v: "fade-up", l: "↑", t: "Появление снизу" },
            { v: "fade-in", l: "◍", t: "Проявление" }, { v: "zoom", l: "⊕", t: "Зум" },
            { v: "slide-left", l: "←", t: "Выезд слева" }, { v: "slide-right", l: "→", t: "Выезд справа" }
        ];
        var presetSeg = '<div class="lime-segmented">' + presets.map(function (o) {
            return '<button type="button" class="' + (curAnim === o.v ? "is-active" : "") + '" data-doc-anim="anim" data-val="' + o.v + '" title="' + o.t + '">' + o.l + '</button>';
        }).join("") + '</div>';
        var extra = curAnim
            ? '<div class="lime-inspector__hint" style="margin:6px 0 2px;">Задержка, мс</div>' + animRng("animDelay", 0, 1000, 50, t.animDelay) +
              '<div class="lime-inspector__hint" style="margin:6px 0 2px;">Длительность, с</div>' + animRng("animDuration", 0.2, 2, 0.1, t.animDuration)
            : "";
        return sec("Анимация появления", presetSeg + extra);
    }

    // Секция «Движение»: параллакс + sticky (+ marquee для контейнеров/колонок).
    function motionInspector(t) {
        var px = t.parallax || "";
        var rows = '<div class="lime-inspector__hint" style="margin:2px 0;">Параллакс (глубина)</div>' +
            '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-motion="parallax" min="0" max="0.8" step="0.05" value="' + (parseFloat(px) || 0) + '"><span class="lime-range__val">' + (px || "0") + '</span></div>' +
            '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Залипание (sticky)</div>' +
            '<div class="lime-segmented">' +
            '<button type="button" class="' + (!t.sticky ? "is-active" : "") + '" data-doc-sticky="0">Нет</button>' +
            '<button type="button" class="' + (t.sticky ? "is-active" : "") + '" data-doc-sticky="1">Sticky</button></div>';
        if (L.isContainer(t.type)) {
            var mq = t.marquee;
            rows += '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Бегущая строка (для содержимого)</div>' +
                '<div class="lime-segmented">' +
                '<button type="button" class="' + (!mq ? "is-active" : "") + '" data-doc-marquee="off">Нет</button>' +
                '<button type="button" class="' + (mq && !mq.reverse ? "is-active" : "") + '" data-doc-marquee="ltr">→</button>' +
                '<button type="button" class="' + (mq && mq.reverse ? "is-active" : "") + '" data-doc-marquee="rtl">←</button></div>';
        }
        return sec("Движение", rows);
    }

    // Секция «Сцена (scroll)» — scrollytelling для контейнеров/колонок (этап 8.2).
    function sceneInspector(t) {
        if (!L.isContainer(t.type)) return "";
        var mode = (t.scene && t.scene.mode) || "";
        var modes = [["", "Нет"], ["horizontal", "Горизонт."], ["steps", "Шаги"], ["pin", "Пин"]];
        var seg = '<div class="lime-segmented">' + modes.map(function (o) {
            return '<button type="button" class="' + (mode === o[0] ? "is-active" : "") + '" data-doc-scene="' + o[0] + '">' + o[1] + '</button>';
        }).join("") + '</div>';
        var len = (t.scene && t.scene.length) || 2;
        var extra = mode
            ? '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Длина, экранов</div>' +
              '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-scene-len min="1" max="4" step="1" value="' + len + '"><span class="lime-range__val">' + len + '</span></div>' +
              '<div class="lime-inspector__hint" style="margin:6px 0;">Эффект виден на опубликованной странице.</div>'
            : "";
        return sec("Сцена (scroll)", seg + extra);
    }
    function setSceneMode(mode) {
        var source = byId(selectedId);
        var b = targetBlock(source);
        if (!b) return;
        var next = mode ? { mode: mode, length: (b.scene && b.scene.length) || 2 } : null;
        setBlockValue(source, "scene", next, !mode);
    }

    // Секция «Декор-слои»: список слоёв с контролами + добавление. Позиция правится драгом по холсту.
    function layerRng(prop, i, min, max, step, cur, label) {
        var n = parseFloat(cur); if (isNaN(n)) n = min;
        return '<div class="lime-inspector__hint" style="margin:4px 0 0;">' + label + '</div>' +
            '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-layer-rng="' + prop + '" data-i="' + i + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"><span class="lime-range__val">' + (cur != null && cur !== "" ? cur : n) + '</span></div>';
    }
    function layersInspector(t) {
        var ls = t.layers || [];
        var list = ls.map(function (l, i) {
            var isImg = l.kind === "image";
            var head = '<div class="lime-flex" style="justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<b style="font-size:var(--text-xs);">Слой ' + (i + 1) + ' · ' + (isImg ? "картинка" : "фигура") + '</b>' +
                '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-layer-del="' + i + '" title="Удалить">✕</button></div>';
            var body = isImg
                ? '<button type="button" class="lime-btn lime-btn--soft lime-btn--sm" data-doc-layer-pick="' + i + '" style="width:100%;">' + (l.src ? "Заменить картинку" : "Выбрать картинку") + '</button>'
                : '<div class="lime-segmented">' + ["circle", "blob", "square"].map(function (sh) {
                    return '<button type="button" class="' + ((l.shape || "circle") === sh ? "is-active" : "") + '" data-doc-layer-shape="' + i + '" data-shape="' + sh + '">' + (sh === "circle" ? "●" : sh === "blob" ? "⬭" : "■") + '</button>';
                }).join("") + '</div><div class="lime-color-row" style="margin-top:4px;"><input type="color" class="lime-color-input" data-doc-layer-color="' + i + '" value="' + toHex(l.color || "#a78bfa") + '"></div>';
            body += layerRng("w", i, 20, 600, 5, l.w, "Размер, px") +
                layerRng("z", i, -1, 3, 1, (l.z != null ? l.z : 0), "Слой (z): −1 за контентом, 2 поверх") +
                layerRng("depth", i, 0, 0.8, 0.05, l.depth, "Параллакс") +
                layerRng("blur", i, 0, 40, 1, l.blur, "Блюр") +
                layerRng("opacity", i, 0.1, 1, 0.05, (l.opacity != null ? l.opacity : 1), "Прозрачность");
            return '<div class="lime-layer-card">' + head + body + '</div>';
        }).join("");
        var add = '<div class="lime-flex lime-gap-2" style="margin-top:6px;">' +
            '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-layer-add="shape" style="flex:1;">＋ Фигура</button>' +
            '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-layer-add="image" style="flex:1;">＋ Картинка</button></div>';
        var hint = ls.length ? '<div class="lime-inspector__hint" style="margin:2px 0 6px;">Перетаскивай слои прямо на холсте.</div>' : "";
        return sec("Декор-слои", hint + list + add);
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

    // Секция «Эффекты и макет» (Фаза 6.2/6.3): fx-чипы + ширина контента + bento.
    function fxInspector(t) {
        var fx = t.fx || [];
        var FX = [["glass", "Стекло"], ["glow", "Свечение"], ["neon-border", "Неон-рамка"], ["gradient-text", "Градиент-текст"], ["tilt", "Наклон"]];
        var chips = '<div class="lime-segmented lime-segmented--wrap">' + FX.map(function (o) {
            return '<button type="button" class="' + (fx.indexOf(o[0]) >= 0 ? "is-active" : "") + '" data-doc-fx="' + o[0] + '">' + o[1] + '</button>';
        }).join("") + '</div>';
        var width = (t.content && t.content.width) || "full";
        var widthSeg = '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Ширина контента</div>' +
            '<div class="lime-segmented">' +
            '<button type="button" class="' + (width !== "boxed" ? "is-active" : "") + '" data-doc-width="full">Во всю</button>' +
            '<button type="button" class="' + (width === "boxed" ? "is-active" : "") + '" data-doc-width="boxed">В колонку</button></div>';
        var bento = "";
        if (L.isContainer(t.type)) {
            var isBento = t.content && t.content.layout === "bento";
            bento = '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Сетка содержимого</div>' +
                '<div class="lime-segmented">' +
                '<button type="button" class="' + (!isBento ? "is-active" : "") + '" data-doc-bento="off">Обычная</button>' +
                '<button type="button" class="' + (isBento ? "is-active" : "") + '" data-doc-bento="on">Bento</button></div>';
        }
        return sec("Эффекты и макет", chips + widthSeg + bento);
    }
    function toggleFx(key) {
        var source = byId(selectedId);
        var b = targetBlock(source);
        if (!b) return;
        var next = clone(b.fx || []);
        var i = next.indexOf(key);
        if (i >= 0) next.splice(i, 1); else next.push(key);
        setBlockValue(source, "fx", next, !next.length);
    }
    function setContentFlag(key, val) {
        var b = byId(selectedId);
        if (!b) return;
        setContentValue(b, key, val, val == null);
    }

    // ----- мутации слоёв -----
    function curBlockWithLayers() {
        var b = targetBlock(byId(selectedId));
        if (!b) return null;
        if (!b.layers) b.layers = [];
        return b;
    }
    function addLayer(kind) {
        var source = byId(selectedId);
        var b = targetBlock(source); if (!b) return;
        var layers = clone(b.layers || []);
        var l = { id: rid("l"), kind: kind, x: 40, y: 28, w: kind === "image" ? 160 : 120, z: 0, depth: 0.2, opacity: 1 };
        if (kind === "shape") { l.shape = "blob"; l.color = "#a78bfa"; }
        layers.push(l);
        setBlockValue(source, "layers", layers, false);
        if (kind === "image") openMediaPicker(selectedId, "layers." + (layers.length - 1) + ".src", "blockpath");
    }
    function delLayer(i) {
        var source = byId(selectedId); var b = targetBlock(source); if (!b) return;
        var layers = clone(b.layers || []); layers.splice(i, 1);
        setBlockValue(source, "layers", layers, !layers.length);
    }
    // Живой апдейт инлайн-стиля слоя без полного ре-рендера (для ползунков/цвета/драга).
    function applyLayerStyle(i) {
        var b = targetBlock(byId(selectedId));
        if (!b || !b.layers || !b.layers[i]) return;
        var l = b.layers[i];
        var secEl = ws.querySelector('[data-block-id="' + selectedId + '"]');
        if (!secEl) return;
        var lyr = secEl.querySelector('[data-layer-id="' + l.id + '"]');
        if (!lyr) { render(); return; }
        lyr.style.left = (l.x || 0) + "%";
        lyr.style.top = (l.y || 0) + "%";
        lyr.style.width = (l.w || 120) + "px";
        lyr.style.zIndex = (l.z != null ? l.z : 0);
        lyr.style.opacity = (l.opacity != null ? l.opacity : 1);
        lyr.style.filter = l.blur ? "blur(" + l.blur + "px)" : "";
        if (l.depth) lyr.setAttribute("data-parallax", l.depth); else lyr.removeAttribute("data-parallax");
        if (l.kind !== "image") lyr.style.background = l.color || "#a78bfa";
    }
    function setLayerRng(i, prop, val) {
        var source = byId(selectedId); var b = targetBlock(source);
        if (!b || !b.layers || !b.layers[i]) return;
        var layers = clone(b.layers); layers[i][prop] = val;
        if (commandBlockGesture(source, "layers", layers, false, "layers:" + i + ":" + prop)) {
            applyLayerStyle(i);
            return;
        }
        b.layers[i][prop] = val;
        applyLayerStyle(i); markDirty();
    }

    // ----- drag слоёв по холсту (только в редакторе) -----
    var dragLayer = null;
    function onLayerDown(e) {
        var lyr = e.currentTarget;
        var secEl = lyr.closest(".lime-block");
        if (!secEl) return;
        var b = byId(secEl.getAttribute("data-block-id"));
        if (!b) return;
        var tb = targetBlock(b);
        var lid = lyr.getAttribute("data-layer-id");
        var idx = -1;
        for (var i = 0; i < (tb.layers || []).length; i++) if (tb.layers[i].id === lid) { idx = i; break; }
        if (idx < 0) return;
        e.preventDefault(); e.stopPropagation();
        var l = tb.layers[idx];
        dragLayer = {
            lyr: lyr, sec: secEl, source: b, target: tb, index: idx,
            startCx: e.clientX, startCy: e.clientY,
            startX: l.x || 0, startY: l.y || 0, x: l.x || 0, y: l.y || 0
        };
        try { lyr.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        lyr.addEventListener("pointermove", onLayerMove);
        lyr.addEventListener("pointerup", onLayerUp);
    }
    function onLayerMove(e) {
        if (!dragLayer) return;
        var r = dragLayer.sec.getBoundingClientRect();
        var dx = ((e.clientX - dragLayer.startCx) / r.width) * 100;
        var dy = ((e.clientY - dragLayer.startCy) / r.height) * 100;
        dragLayer.x = Math.max(0, Math.min(100, Math.round(dragLayer.startX + dx)));
        dragLayer.y = Math.max(0, Math.min(100, Math.round(dragLayer.startY + dy)));
        dragLayer.lyr.style.left = dragLayer.x + "%";
        dragLayer.lyr.style.top = dragLayer.y + "%";
    }
    function onLayerUp(e) {
        if (!dragLayer) return;
        var gesture = dragLayer;
        var lyr = gesture.lyr;
        lyr.removeEventListener("pointermove", onLayerMove);
        lyr.removeEventListener("pointerup", onLayerUp);
        try { lyr.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        dragLayer = null;
        if (gesture.x === gesture.startX && gesture.y === gesture.startY) return;
        var layers = clone(gesture.target.layers || []);
        if (!layers[gesture.index]) return;
        layers[gesture.index].x = gesture.x;
        layers[gesture.index].y = gesture.y;
        setBlockValue(gesture.source, "layers", layers, false);
    }
    function initLayerDrag() {
        var layers = ws.querySelectorAll(".lime-block__layer[data-layer-id]");
        Array.prototype.forEach.call(layers, function (lyr) {
            lyr.addEventListener("pointerdown", onLayerDown);
        });
    }

    function toHex(v) {
        if (!v) return "#000000";
        if (v[0] === "#") return v;
        var m = String(v).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!m) return "#000000";
        var h = function (n) { var x = parseInt(n, 10).toString(16); return x.length < 2 ? "0" + x : x; };
        return "#" + h(m[1]) + h(m[2]) + h(m[3]);
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
    function animAttr(prop) {
        return prop === "anim" ? "data-anim" : prop === "animDelay" ? "data-anim-delay" : "data-anim-duration";
    }
    function setAnim(prop, val, reflectInspector) {
        var source = byId(selectedId);
        var b = targetBlock(source);
        if (!b) return;
        var remove = val === "" || val == null;
        var commanded;
        if (cmdStore && b === source && prop === "anim" && remove) {
            var cleared = runCommands([
                { type: "setBlockProp", payload: { id: source.id, prop: "anim", remove: true } },
                { type: "setBlockProp", payload: { id: source.id, prop: "animDelay", remove: true } },
                { type: "setBlockProp", payload: { id: source.id, prop: "animDuration", remove: true } }
            ], "clear-animation");
            if (cleared) scheduleAutosave();
            commanded = true;
        } else commanded = commandBlockGesture(source, prop, val, remove, prop);
        if (!commanded) {
            if (remove) delete b[prop];
            else b[prop] = val;
        }
        var el = ws.querySelector('[data-block-id="' + selectedId + '"]');
        if (el) {
            var attr = animAttr(prop);
            if (val === "" || val == null) el.removeAttribute(attr);
            else el.setAttribute(attr, val);
            if (prop === "anim" && (val === "" || val == null)) {
                el.removeAttribute("data-anim-delay"); el.removeAttribute("data-anim-duration");
                if (!(cmdStore && b === source)) { delete b.animDelay; delete b.animDuration; }
            }
        }
        if (reflectInspector) refreshInspector();
        if (!commanded) markDirty();
    }
    function animRng(prop, min, max, step, cur) {
        var n = parseFloat(cur); if (isNaN(n)) n = min;
        return '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-anim="' + prop + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"><span class="lime-range__val">' + (cur != null && cur !== "" ? cur : "—") + '</span></div>';
    }

    // ===== ФОН СЕКЦИИ (градиент/картинка — стиль-пропы; затемнение/видео — content.bg) =====
    // Разбор сохранённого linear-gradient(...) обратно на угол + 2 цвета (порт из Движка A).
    function parseGradient(v) {
        var def = { angle: 135, c1: "#a78bfa", c2: "#38bdf8" };
        if (!v || v.indexOf("linear-gradient") < 0) return def;
        var m = v.match(/linear-gradient\(\s*([\d.]+)deg\s*,\s*([^,]+),\s*([^)]+)\)/i);
        if (!m) return def;
        return { angle: parseFloat(m[1]) || 135, c1: toHex(m[2].trim()), c2: toHex(m[3].trim()) };
    }
    function hexToRgba(hex, alpha) {
        var h = String(hex || "#000000").replace("#", "");
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }
    // rgba/#hex → { hex, a } для переоткрытия контролов затемнения.
    function rgbaParts(v) {
        var m = String(v || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
        if (!m) return { hex: toHex(v || "#000000"), a: v ? 1 : 0.5 };
        var toH = function (n) { var x = parseInt(n, 10).toString(16); return x.length < 2 ? "0" + x : x; };
        return { hex: "#" + toH(m[1]) + toH(m[2]) + toH(m[3]), a: m[4] != null ? parseFloat(m[4]) : 1 };
    }
    function setBg(key, val) {
        var b = byId(selectedId);
        if (!b) return;
        setContentValue(b, "bg." + key, val, val === "" || val == null);
    }
    // Собирает linear-gradient из контролов инспектора и пишет в backgroundImage (живое превью).
    function composeGradient() {
        var a = inspectorEl.querySelector('[data-doc-grad="angle"]');
        var c1 = inspectorEl.querySelector('[data-doc-grad="c1"]');
        var c2 = inspectorEl.querySelector('[data-doc-grad="c2"]');
        if (!c1 || !c2) return;
        setStyle("backgroundImage", "linear-gradient(" + (a ? a.value : 135) + "deg, " + c1.value + ", " + c2.value + ")");
    }
    // Живое превью затемнения без полного ре-рендера: пишем в модель и правим/создаём
    // оверлей-элемент прямо в выбранной секции (full render сбрасывал бы фокус ползунка).
    function liveOverlay() {
        var col = inspectorEl.querySelector('[data-doc-overlay="color"]');
        var alEl = inspectorEl.querySelector('[data-doc-overlay="alpha"]');
        if (!col) return;
        var val = hexToRgba(col.value, alEl ? alEl.value : 0.5);
        var source = byId(selectedId);
        var b = targetBlock(source);
        if (!b) return;
        var commanded = commandContentGesture(source, "bg.overlay", val, false, "overlay");
        if (!commanded) {
            if (!b.content) b.content = {};
            if (!b.content.bg) b.content.bg = {};
            b.content.bg.overlay = val;
        }
        var secEl = ws.querySelector('[data-block-id="' + selectedId + '"]');
        if (secEl) {
            var ov = secEl.querySelector(".lime-block__overlay");
            if (!ov || ov.closest(".lime-block") !== secEl) {
                ov = document.createElement("div");
                ov.className = "lime-block__overlay";
                secEl.insertBefore(ov, secEl.firstChild);
            }
            ov.style.background = val;
            if (b.content.bg.blur) ov.style.backdropFilter = "blur(" + b.content.bg.blur + ")";
        }
        if (!commanded) markDirty();
    }
    function switchBgMode(mode) {
        var source = byId(selectedId);
        var b = targetBlock(source);
        if (!b) return;
        if (cmdStore && b === source) {
            var commands = [{ type: "setContent", payload: { id: source.id, field: "bgMode", value: mode } }];
            if (mode === "solid") commands.push({ type: "setStyle", payload: { id: source.id, breakpoint: currentBp, prop: "backgroundImage", remove: true } });
            var changed = runCommands(commands, "background-mode");
            applyPreviewStyles(); refreshInspector();
            if (changed) scheduleAutosave();
            return;
        }
        if (!b.content) b.content = {};
        b.content.bgMode = mode;
        // На сплошном фоне убираем картинку/градиент, чтобы они не перекрывали цвет.
        if (mode === "solid" && b.styles && b.styles[currentBp]) delete b.styles[currentBp].backgroundImage;
        applyPreviewStyles(); refreshInspector(); markDirty();
    }
    function promptBgVideo() {
        var url = window.prompt("Прямая ссылка на видео (.mp4 или .webm):", "");
        if (url == null) return;
        setBg("videoSrc", url.trim());
    }
    // Сетка готовых фон-пресетов (из lime-assets.js). Превью фона навешиваем
    // через style-свойство уже после вставки HTML (в css-значениях есть кавычки/запятые).
    function bgPresetGrid() {
        if (!window.LimeAssets || !window.LimeAssets.BG_PRESETS) return "";
        return '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Готовые фоны</div>' +
            '<div class="lime-bg-presets">' + window.LimeAssets.BG_PRESETS.map(function (p, i) {
                return '<button type="button" class="lime-bg-preset" data-doc-bg-preset="' + i + '" title="' + p.name + '"></button>';
            }).join("") + '</div>';
    }
    function bgInspector(b, s) {
        var t = targetBlock(b);
        var bg = (t.content && t.content.bg) || {};
        var bgImg = s.backgroundImage || "";
        var mode = (t.content && t.content.bgMode) ||
            (bgImg.indexOf("gradient") >= 0 ? "gradient" : (bgImg.indexOf("url(") >= 0 ? "image" : "solid"));
        var tabs = '<div class="lime-segmented" style="margin-bottom:8px;">' +
            [["solid", "Цвет"], ["gradient", "Градиент"], ["image", "Картинка"]].map(function (o) {
                return '<button type="button" class="' + (mode === o[0] ? "is-active" : "") + '" data-doc-bgmode="' + o[0] + '">' + o[1] + '</button>';
            }).join("") + '</div>';
        var body;
        if (mode === "gradient") {
            var g = parseGradient(bgImg);
            body = '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-grad="angle" min="0" max="360" step="5" value="' + g.angle + '"><span class="lime-range__val">' + g.angle + '°</span></div>' +
                '<div class="lime-color-row" style="margin-top:6px;">' +
                '<input type="color" class="lime-color-input" data-doc-grad="c1" value="' + g.c1 + '">' +
                '<input type="color" class="lime-color-input" data-doc-grad="c2" value="' + g.c2 + '"></div>' +
                bgPresetGrid();
        } else if (mode === "image") {
            var hasImg = bgImg.indexOf("url(") >= 0;
            body = '<button type="button" class="lime-btn lime-btn--soft lime-btn--sm" data-doc-bg-pick="image" style="width:100%;">' + (hasImg ? "Заменить изображение" : "Выбрать изображение") + '</button>' +
                (hasImg ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-clear-img style="width:100%;margin-top:4px;">Убрать картинку</button>' +
                    seg("backgroundSize", [{ v: "cover", l: "Cover" }, { v: "contain", l: "Contain" }, { v: "auto", l: "Auto" }], s.backgroundSize) +
                    seg("backgroundPosition", [{ v: "center", l: "Центр" }, { v: "top", l: "Верх" }, { v: "bottom", l: "Низ" }], s.backgroundPosition) : "");
        } else {
            body = colorRow("backgroundColor", s.backgroundColor) + tokenSwatches("backgroundColor");
        }
        // Затемнение + видео-фон — доступны при любом режиме (поверх базового фона).
        var op = rgbaParts(bg.overlay);
        var overlayRow = '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Затемнение поверх</div>' +
            '<div class="lime-color-row"><input type="color" class="lime-color-input" data-doc-overlay="color" value="' + op.hex + '">' +
            '<div class="lime-range-row" style="flex:1;margin-left:8px;"><input type="range" class="lime-range" data-doc-overlay="alpha" min="0" max="1" step="0.05" value="' + op.a + '"><span class="lime-range__val">' + Math.round(op.a * 100) + '%</span></div></div>' +
            (bg.overlay ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-clear-key="overlay" style="width:100%;margin-top:4px;">Убрать затемнение</button>' : "");
        var videoRow = '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-video style="width:100%;margin-top:8px;">' + (bg.videoSrc ? "Заменить видео-фон" : "＋ Видео-фон") + '</button>' +
            (bg.videoSrc ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-clear-key="videoSrc" style="width:100%;margin-top:4px;">Убрать видео</button>' : "");
        return sec("Фон", tabs + body + overlayRow + videoRow);
    }

    function scrubPreviewStyle() {
        var style = ws.querySelector("style[data-lime-design-scrub-preview]");
        if (!style) {
            style = document.createElement("style");
            style.setAttribute("data-lime-design-scrub-preview", "1");
            ws.appendChild(style);
        }
        return style;
    }
    function clearScrubPreview() {
        var style = ws.querySelector("style[data-lime-design-scrub-preview]");
        if (style) style.remove();
    }
    function withTemporaryDesign(source, field, value, fn) {
        var target = designTarget(source, field);
        if (!target) return;
        var before = target.design;
        target.design = clone(before || {});
        if (!target.design[currentBp]) target.design[currentBp] = {};
        if (value === undefined) delete target.design[currentBp][field];
        else target.design[currentBp][field] = value;
        try { fn(); }
        finally { if (before === undefined) delete target.design; else target.design = before; }
    }
    function previewDesignInput(input) {
        var source = selectedId && byId(selectedId);
        var field = input.getAttribute("data-v2-design-field");
        var path = input.getAttribute("data-v2-design-path");
        if (!source || !field || !path || designTarget(source, field) !== source) return;
        if (input.hasAttribute("data-v2-design-optional") && input.value.trim() === "") {
            clearScrubPreview();
            return;
        }
        var value = designInputValue(input);
        if (value == null) return;
        var next = buildDesignObjectPatch(source, field, path, value);
        withTemporaryDesign(source, field, next, function () {
            scrubPreviewStyle().textContent = L.compilePreviewDesignCss(pageBlocks(), doc.components, currentBp);
        });
    }
    function previewChildDesignInput(input) {
        var source = selectedId && byId(selectedId);
        var childField = input.getAttribute("data-v2-child-field");
        if (!source || !childField) return;
        var value = Math.round(parseFloat(input.value));
        if (!isFinite(value)) return;
        if (childField === "span" || childField === "rowSpan") value = Math.max(1, value);
        withTemporaryDesign(source, childField, value, function () {
            scrubPreviewStyle().textContent = L.compilePreviewDesignCss(pageBlocks(), doc.components, currentBp);
        });
    }

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
            var v2Unit = e.target.getAttribute("data-v2-unit-for");
            if (v2Unit) {
                var v2Input = e.target.closest(".lime-v2-field").querySelector("[data-v2-design-field]");
                if (!v2Input) return;
                v2Input.setAttribute("data-v2-unit", e.target.value);
                if (v2Input.value.trim() !== "") v2Input.dispatchEvent(new Event("change", { bubbles: true }));
                return;
            }
            var childField = e.target.getAttribute("data-v2-child-field");
            if (childField) {
                var childSource = selectedId && byId(selectedId);
                var childValue = Math.round(parseFloat(e.target.value));
                if (!isFinite(childValue)) return;
                if (childField === "span" || childField === "rowSpan") childValue = Math.max(1, childValue);
                var removeChildField = currentBp === "base" && ((childField === "order" && childValue === 0) || (childField !== "order" && childValue <= 1));
                if (childSource) setDesignValue(childSource, currentBp, childField, removeChildField ? null : childValue, removeChildField);
                return;
            }
            var field = e.target.getAttribute("data-v2-design-field");
            var path = e.target.getAttribute("data-v2-design-path");
            if (!field || !path) return;
            var source = selectedId && byId(selectedId);
            if (e.target.hasAttribute("data-v2-design-optional") && e.target.value.trim() === "") {
                patchDesignObject(source, field, path, undefined);
                return;
            }
            var value = e.target.type === "number" ? designInputValue(e.target) : e.target.value;
            if (e.target.type === "number" && value == null) return;
            patchDesignObject(source, field, path, value);
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
                var motionSource = byId(selectedId);
                var mb = targetBlock(motionSource);
                if (mb) {
                    var v = t.value;
                    var motionCommanded = commandBlockGesture(motionSource, "parallax", v, parseFloat(v) === 0, "parallax");
                    if (!motionCommanded) { if (parseFloat(v) === 0) delete mb.parallax; else mb.parallax = v; }
                    var msec = ws.querySelector('[data-block-id="' + selectedId + '"]');
                    if (msec) { if (parseFloat(v) === 0) msec.removeAttribute("data-parallax"); else msec.setAttribute("data-parallax", v); }
                    var ml = t.parentNode.querySelector(".lime-range__val"); if (ml) ml.textContent = v;
                    if (!motionCommanded) markDirty();
                }
            } else if (t.hasAttribute("data-doc-layer-rng")) {
                var li = parseInt(t.dataset.i, 10);
                setLayerRng(li, t.dataset.docLayerRng, parseFloat(t.value));
                var ll = t.parentNode.querySelector(".lime-range__val"); if (ll) ll.textContent = t.value;
            } else if (t.hasAttribute("data-doc-layer-color")) {
                var ci = parseInt(t.dataset.docLayerColor, 10);
                setLayerRng(ci, "color", t.value);
            } else if (t.hasAttribute("data-doc-scene-len") && t.type === "range") {
                var sceneSource = byId(selectedId);
                var sb = targetBlock(sceneSource);
                if (sb && sb.scene) {
                    var nextScene = clone(sb.scene); nextScene.length = parseInt(t.value, 10);
                    var sceneCommanded = commandBlockGesture(sceneSource, "scene", nextScene, false, "scene:length");
                    if (!sceneCommanded) sb.scene.length = nextScene.length;
                    var sl = t.parentNode.querySelector(".lime-range__val");
                    if (sl) sl.textContent = t.value;
                    if (!sceneCommanded) markDirty();
                }
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
                var resetSource = selectedId && byId(selectedId);
                if (resetSource) { setDesignValue(resetSource, currentBp, el.dataset.v2DesignReset, null, true); refreshInspector(); }
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
                patchDesignObject(selectedId && byId(selectedId), "layout", "direction", el.dataset.v2LayoutDirection);
                return;
            }
            if ((el = e.target.closest("[data-v2-layout-wrap]"))) {
                patchDesignObject(selectedId && byId(selectedId), "layout", "wrap", el.dataset.v2LayoutWrap === "1");
                return;
            }
            if ((el = e.target.closest("[data-v2-grid-auto]"))) {
                // Фикс./Авто колонки: число (repeat N) ↔ объект { mode:auto, min } (repeat auto-fit/fill).
                patchDesignObject(selectedId && byId(selectedId), "layout", "columns",
                    el.dataset.v2GridAuto === "1" ? { mode: "auto", min: 240 } : 2);
                return;
            }
            if ((el = e.target.closest("[data-v2-grid-fill]"))) {
                patchDesignObject(selectedId && byId(selectedId), "layout", "columns.fill", el.dataset.v2GridFill === "1");
                return;
            }
            if ((el = e.target.closest("[data-v2-overflow]"))) { // hidden → set; visible (дефолт) → убрать
                var ovfSource = selectedId && byId(selectedId);
                var ovfHidden = el.dataset.v2Overflow === "hidden";
                if (ovfSource) { setDesignValue(ovfSource, currentBp, "overflow", ovfHidden ? "hidden" : null, !ovfHidden); refreshInspector(); }
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
                var stickySource = byId(selectedId);
                if (stickySource) setBlockValue(stickySource, "sticky", true, el.dataset.docSticky !== "1");
                return;
            }
            if ((el = e.target.closest("[data-doc-marquee]"))) {
                var marqueeSource = byId(selectedId);
                var qb = targetBlock(marqueeSource);
                if (qb) {
                    var m = el.dataset.docMarquee;
                    setBlockValue(marqueeSource, "marquee", { speed: 40, reverse: m === "rtl" }, m === "off");
                }
                return;
            }
            if ((el = e.target.closest("[data-doc-scene]"))) { setSceneMode(el.dataset.docScene); return; }
            // ----- декор-слои -----
            if ((el = e.target.closest("[data-doc-layer-add]"))) { addLayer(el.dataset.docLayerAdd); return; }
            if ((el = e.target.closest("[data-doc-layer-del]"))) { delLayer(parseInt(el.dataset.docLayerDel, 10)); return; }
            if ((el = e.target.closest("[data-doc-layer-pick]"))) { openMediaPicker(selectedId, "layers." + el.dataset.docLayerPick + ".src", "blockpath"); return; }
            if ((el = e.target.closest("[data-doc-layer-shape]"))) {
                var shapeSource = byId(selectedId); var hb = targetBlock(shapeSource); var hi = parseInt(el.dataset.docLayerShape, 10);
                if (hb && hb.layers && hb.layers[hi]) {
                    var shapeLayers = clone(hb.layers); shapeLayers[hi].shape = el.dataset.shape;
                    setBlockValue(shapeSource, "layers", shapeLayers, false);
                }
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

    // ===== SAVE / AUTOSAVE =====
    function setStatus(text, cls) {
        var el = document.querySelector("[data-doc-status]");
        if (el) { el.textContent = text; el.className = "lime-text-muted" + (cls ? " " + cls : ""); }
    }
    function buildForm(auto) {
        var compiled = L.renderSite(doc); // publish-HTML всего сайта (страницы + hash-роутинг)
        var form = new FormData();
        form.append("html", compiled);
        form.append("documentJson", JSON.stringify(doc));
        form.append("baseVersion", String(docVersion));
        if (siteId) form.append("siteId", siteId);
        if (auto) form.append("auto", "true");
        return form;
    }
    function onConflict() {
        conflicted = true; // дальше не автосохраняем, чтобы не долбить 409
        setStatus("⚠ Изменено в другом окне", "lime-text-danger");
        alert("Документ был сохранён из другого окна или вкладки.\n" +
            "Обнови страницу (F5), чтобы продолжить с актуальной версией — иначе чужие правки будут затёрты.");
    }
    function save() {
        if (totalBlocks() === 0) { alert("На сайте пока нет ни одного блока. Добавь хотя бы один — например, обложку из панели слева."); return; }
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Home/EditTemplatesPost");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            if (xhr.status === 409) onConflict();
            else if (xhr.status >= 200 && xhr.status < 400) { savedSeq = editSeq; clearDraft(); window.location.href = "/Home/MySites"; }
            else { setStatus("Не удалось сохранить", "lime-text-danger"); alert("Не удалось сохранить (код " + xhr.status + "). Изменения сохранены локально в этой вкладке — проверь подключение и попробуй ещё раз."); }
        };
        xhr.onerror = function () { setStatus("Нет сети", "lime-text-danger"); alert("Нет сети — изменения не отправлены на сервер. Они сохранены локально в этой вкладке и не потеряются; попробуй сохранить позже."); };
        xhr.send(buildForm(false));
    }
    if (saveBtn) saveBtn.addEventListener("click", save);

    var autosaveTimer, autosaving = false;
    // Единый сигнал «произошла правка» для обоих путей (legacy markDirty и command-store, который
    // зовёт scheduleAutosave напрямую). Отметка dirty + черновик идут ДО siteId-гарда, чтобы новый
    // несохранённый сайт (siteId == "") тоже получал crash-recovery черновик (этап 9.2).
    function scheduleAutosave() {
        editSeq++;
        scheduleDraft();
        if (!siteId || conflicted) return;
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(runAutosave, 2500);
    }
    function markDirty() {
        commitPendingCommandEdits();
        pushHistory(); // каждое изменение — точка отката (этап 0.4)
        scheduleAutosave();
    }
    function runAutosave() {
        if (!siteId || autosaving || conflicted || totalBlocks() === 0) return;
        autosaving = true;
        var sendSeq = editSeq; // правки во время запроса не считаем сохранёнными
        setStatus("Сохранение…");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Home/EditTemplatesPost");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            autosaving = false;
            if (xhr.status === 409) {
                onConflict();
            } else if (xhr.status >= 200 && xhr.status < 400) {
                // Сервер вернул свежую версию — продолжаем цепочку сохранений с неё.
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (resp && resp.version) docVersion = resp.version;
                } catch (e) { /* не-JSON ответ — версию не трогаем */ }
                savedSeq = sendSeq;
                if (savedSeq === editSeq) clearDraft(); // полностью синхронны — черновик не нужен
                var t = new Date();
                setStatus("Сохранено " + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2));
            } else setStatus("Ошибка автосохранения", "lime-text-danger");
        };
        xhr.onerror = function () { autosaving = false; setStatus("Нет сети", "lime-text-danger"); };
        xhr.send(buildForm(true));
    }

    // ===== CRASH RECOVERY (этап 9.2): локальный черновик + восстановление после перезагрузки =====
    // Черновик пишется в localStorage при каждой правке (debounce) и при выгрузке страницы; на старте,
    // если найден черновик с несохранёнными изменениями на той же серверной версии (или у нового
    // несохранённого сайта), предлагаем восстановить. Успешное сохранение/автосейв чистит черновик.
    // Кросс-таб-конфликт сохранённого сайта по-прежнему ловит серверный 409 (onConflict).
    var DRAFT_KEY = "lime-doc-draft-" + (siteId || "new");
    var draftTimer;
    function isDirty() { return editSeq !== savedSeq; }
    function writeDraft() {
        if (!isDirty()) return;
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify({ json: doc, baseVersion: docVersion, ts: Date.now() }));
        } catch (e) { /* приватный режим / превышена квота — тихо */ }
    }
    function scheduleDraft() {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(writeDraft, 800);
    }
    function clearDraft() {
        clearTimeout(draftTimer);
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* no-op */ }
    }
    function readDraft() {
        try { var raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; }
        catch (e) { return null; }
    }
    function maybeOfferRecovery() {
        var draft = readDraft();
        if (!draft || !draft.json) return;
        // Тот же серверный базис (или новый сайт без siteId) и контент отличается от загруженного
        // ⇒ есть несохранённые правки. Иначе черновик устарел — молча чистим.
        var sameBase = !siteId || draft.baseVersion === docVersion;
        var differs = JSON.stringify(draft.json) !== JSON.stringify(doc);
        if (!sameBase || !differs) { clearDraft(); return; }
        showRecoveryBanner(draft);
    }
    function showRecoveryBanner(draft) {
        var bar = document.createElement("div");
        bar.className = "lime-recovery-banner";
        bar.setAttribute("data-doc-recovery", "");
        bar.setAttribute("role", "alertdialog");
        bar.setAttribute("aria-label", "Восстановление несохранённых изменений");
        var when = new Date(draft.ts || Date.now());
        var time = ("0" + when.getHours()).slice(-2) + ":" + ("0" + when.getMinutes()).slice(-2);
        bar.innerHTML =
            '<span class="lime-recovery-banner__text">Найдены несохранённые изменения (' + time + '). Восстановить?</span>' +
            '<button type="button" class="lime-btn lime-btn--primary lime-btn--sm" data-recovery-restore>Восстановить</button>' +
            '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-recovery-dismiss>Отклонить</button>';
        document.body.appendChild(bar);
        bar.querySelector("[data-recovery-restore]").addEventListener("click", function () {
            doc = L.migrateDoc(draft.json);
            active = 0;
            selectedId = null;
            currentClass = null;
            if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.replace([]);
            refreshPages(); refreshComponents(); render();
            pushHistory();
            scheduleAutosave(); writeDraft(); // помечаем dirty (bump editSeq) и пишем черновик сразу
            bar.remove();
            setStatus("Изменения восстановлены");
        });
        bar.querySelector("[data-recovery-dismiss]").addEventListener("click", function () {
            clearDraft(); bar.remove();
        });
    }
    window.addEventListener("beforeunload", writeDraft);

    // ===== AI (этап 2: генерация страницы + переписать текст) =====
    var aiModal = document.getElementById("lime-doc-ai-modal");
    function aiStatus(text, danger) {
        var el = document.getElementById("lime-doc-ai-status");
        if (el) { el.textContent = text || ""; el.className = "lime-text-muted" + (danger ? " lime-text-danger" : ""); }
    }
    function aiOpen() {
        if (!aiModal) return;
        aiModal.classList.add("is-open");
        aiStatus("…");
        fetch("/Ai/Quota", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (q) {
                if (!q.configured) aiStatus("AI не настроен на сервере (нет ключа провайдера).", true);
                else aiStatus("Осталось генераций в этом месяце: " + Math.max(0, q.limit - q.used) + " из " + q.limit);
            })
            .catch(function () { aiStatus(""); });
    }
    function aiErrorText(status, resp) {
        if (status === 429) return "Бесплатные генерации кончились (" + (resp && resp.limit || "") + "/мес). Тарифы — скоро.";
        if (status === 503) return "AI не настроен на сервере.";
        return "Не получилось сгенерировать. Попробуй ещё раз.";
    }
    // ----- generation choreography (status pill + materialize + toast) -----
    function reduceMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    var STATUS_STEPS = [
        "Разбираю запрос…", "Подбираю структуру…", "Собираю палитру и шрифты…",
        "Пишу тексты под бренд…", "Материализую блоки…"
    ];
    function leStatus(text, opts) {
        opts = opts || {};
        var bar = document.getElementById("lime-doc-le-status");
        var txt = document.getElementById("lime-doc-le-status-text");
        var sp = document.getElementById("lime-doc-le-spinner");
        if (!bar) return;
        if (opts.hide) { bar.classList.remove("is-on"); return; }
        if (text && txt) txt.textContent = text;
        if (sp) sp.style.display = opts.done ? "none" : "";
        bar.classList.add("is-on");
    }
    function leToast() {
        var t = document.getElementById("lime-doc-le-toast");
        if (!t) return;
        t.classList.add("is-on");
        setTimeout(function () { t.classList.remove("is-on"); }, 3200);
    }
    // Добавляет сгенерированные блоки по одному с входной анимацией и sweep-вспышкой.
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

    function materialize(specs) {
        var bl = pageBlocks();
        var i = 0;
        function step() {
            if (i >= specs.length) {
                selectedId = null; render(); markDirty();
                leStatus("Сайт собран", { done: true });
                setTimeout(function () { leStatus("", { hide: true }); leToast(); }, 900);
                return;
            }
            var spec = specs[i++];
            var b = blockFromSpec(spec);
            bl.push(b);
            render();
            var el = ws.querySelector('[data-block-id="' + b.id + '"]');
            if (el && !reduceMotion()) {
                el.classList.add("is-entering");
                var sweep = document.createElement("div");
                sweep.className = "lime-sweep";
                el.appendChild(sweep);
                setTimeout(function () { if (sweep.parentNode) sweep.parentNode.removeChild(sweep); }, 750);
                el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            setTimeout(step, reduceMotion() ? 0 : 300);
        }
        step();
    }
    // Общий запуск генерации (модалка «AI заново» и стартовый intro-оверлей).
    function runGenerate(promptText, opts) {
        opts = opts || {};
        var prompt = (promptText || "").trim();
        if (!prompt) { if (opts.onError) opts.onError("Опиши бизнес — хотя бы пару предложений."); return; }
        if (opts.btn) opts.btn.disabled = true;
        var si = 0;
        leStatus(STATUS_STEPS[0]);
        var iv = setInterval(function () {
            si = Math.min(si + 1, STATUS_STEPS.length - 1);
            leStatus(STATUS_STEPS[si]);
        }, 750);
        var form = new FormData();
        form.append("prompt", prompt);
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Ai/Generate");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            clearInterval(iv);
            if (opts.btn) opts.btn.disabled = false;
            var resp = null;
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* no-op */ }
            if (xhr.status >= 200 && xhr.status < 300 && resp && resp.blocks) {
                leStatus("Материализую блоки…");
                if (opts.onSuccess) opts.onSuccess();
                materialize(resp.blocks);
            } else {
                leStatus("", { hide: true });
                if (opts.onError) opts.onError(aiErrorText(xhr.status, resp));
            }
        };
        xhr.onerror = function () {
            clearInterval(iv);
            if (opts.btn) opts.btn.disabled = false;
            leStatus("", { hide: true });
            if (opts.onError) opts.onError("Сетевая ошибка.");
        };
        xhr.send(form);
    }
    function aiGenerate() {
        var ta = document.getElementById("lime-doc-ai-prompt");
        var btn = document.querySelector("[data-doc-ai-generate]");
        runGenerate(ta ? ta.value : "", {
            btn: btn,
            onError: function (m) { aiStatus(m, true); },
            onSuccess: function () { if (aiModal) aiModal.classList.remove("is-open"); }
        });
    }
    function aiRewrite() {
        var r = findBlock(selectedId);
        if (!r) return;
        var t = targetBlock(r.block);
        if (!t || !t.content || typeof t.content.text !== "string") return;
        var instruction = prompt("Как переписать этот текст? (короче / продающе / официальнее / на английском…)", "сделай продающим и короче");
        if (!instruction) return;
        var form = new FormData();
        form.append("text", t.content.text);
        form.append("instruction", instruction);
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Ai/Rewrite");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            var resp = null;
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* no-op */ }
            if (xhr.status >= 200 && xhr.status < 300 && resp && resp.text) {
                setContentValue(r.block, "text", resp.text, false);
            } else {
                alert(aiErrorText(xhr.status, resp));
            }
        };
        xhr.onerror = function () { alert("Сетевая ошибка."); };
        xhr.send(form);
    }
    // «✨ AI: переписать» для всей выделенной секции/блока (этап 2.1). Шлём поддерево
    // (content + children), получаем его же с переписанными текстами, применяем с undo.
    function aiEditBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        var t = targetBlock(r.block); // у компонента-инстанса правим общее определение
        if (!t) return;
        var instruction = prompt("Как переписать тексты этой секции? (смелее / под SaaS / короче / на английском…)", "сделай тексты смелее и под SaaS");
        if (!instruction) return;
        var payload = JSON.stringify({ content: t.content, children: t.children });
        if (payload.length > 18000) { alert("Секция слишком большая для AI-правки за один раз. Разбей её."); return; }
        var form = new FormData();
        form.append("block", payload);
        form.append("instruction", instruction);
        leStatus("AI переписывает секцию…");
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Ai/EditBlock");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            var resp = null;
            try { resp = JSON.parse(xhr.responseText); } catch (e) { /* no-op */ }
            if (xhr.status >= 200 && xhr.status < 300 && resp && resp.block) {
                if (resp.block.content) t.content = resp.block.content;
                if (resp.block.children) t.children = resp.block.children;
                render(); markDirty(); // markDirty → pushHistory: правка откатывается через Ctrl+Z
                leStatus("Готово", { done: true });
                setTimeout(function () { leStatus("", { hide: true }); }, 900);
            } else {
                leStatus("", { hide: true });
                alert(xhr.status === 422 ? "В этой секции нечего переписывать." : aiErrorText(xhr.status, resp));
            }
        };
        xhr.onerror = function () { leStatus("", { hide: true }); alert("Сетевая ошибка."); };
        xhr.send(form);
    }
    // ===== AI COMMAND PIPELINE (этап 10.1): безопасное применение списка команд =====
    // AI отдаёт список команд → валидируем (allowlist/лимит/форма) → dry-run на клоне для preview →
    // показываем, что изменится, и применяем ОДНОЙ undo-транзакцией только по подтверждению.
    // Инвариант: невалидный или неподтверждённый ответ не трогает сохранённый документ.
    var aiPreviewBar = null;
    function clearAiHighlight() {
        var hi = ws.querySelectorAll(".lime-ai-affected");
        for (var i = 0; i < hi.length; i++) hi[i].classList.remove("lime-ai-affected");
    }
    function closeAiPreview() {
        clearAiHighlight();
        if (aiPreviewBar) { aiPreviewBar.remove(); aiPreviewBar = null; }
    }
    // rawList — массив { type, payload }. Возвращает строку-причину при отказе либо null при успехе.
    function applyAiCommands(rawList) {
        if (!cmdStore || !window.LimeCommands) return "no-cmd";
        var v = window.LimeCommands.validateAiCommands(rawList, { max: 40 });
        if (!v.ok) { leToastMsg("AI прислал некорректную правку — ничего не менял."); return v.reason; }
        // Новым секциям (insertBlock) выдаём свежие id — чтобы блок был уникален и выбираем
        // (этап 10.4). reid рекурсивно и для детей.
        v.commands.forEach(function (c) {
            if (c.type === "insertBlock" && c.payload && c.payload.block) reid(c.payload.block);
        });
        var dry = window.LimeCommands.dryRunAiCommands(doc, v.commands);
        if (!dry.applied) { leToastMsg("AI не нашёл, что изменить."); return "no-change"; }

        closeAiPreview();
        // Подсветка затронутых блоков — лёгкий preview-дифф без мутации документа.
        dry.affected.forEach(function (id) {
            var el = ws.querySelector('[data-block-id="' + id + '"]');
            if (el) el.classList.add("lime-ai-affected");
        });
        var changes = dry.appliedCommands.map(describeAiChange);
        var SHOWN = 6;
        var listHtml = '<ul class="lime-ai-preview__list" data-ai-list>' +
            changes.slice(0, SHOWN).map(function (ch) {
                return '<li><span class="lime-ai-preview__where">' + escapeText(ch.where) + '</span> ' + escapeText(ch.what) + '</li>';
            }).join("") +
            (changes.length > SHOWN ? '<li class="lime-ai-preview__more">…и ещё ' + (changes.length - SHOWN) + '</li>' : '') +
            '</ul>';
        aiPreviewBar = document.createElement("div");
        aiPreviewBar.className = "lime-ai-preview";
        aiPreviewBar.setAttribute("data-doc-ai-preview", "");
        aiPreviewBar.setAttribute("role", "alertdialog");
        aiPreviewBar.setAttribute("aria-label", "Предпросмотр правки AI");
        var word = dry.applied === 1 ? "изменение" : (dry.applied < 5 ? "изменения" : "изменений");
        aiPreviewBar.innerHTML =
            '<div class="lime-ai-preview__head"><span class="lime-ai-preview__text">AI предлагает <b data-ai-count>' + dry.applied + '</b> ' + word +
            (v.rejected.length ? ' (' + v.rejected.length + ' отклонено)' : '') + '</span></div>' +
            listHtml +
            '<div class="lime-ai-preview__actions">' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-ai-cancel>Отменить</button>' +
                '<button type="button" class="lime-btn lime-btn--primary lime-btn--sm" data-ai-apply>Применить</button>' +
            '</div>';
        document.body.appendChild(aiPreviewBar);
        aiPreviewBar.querySelector("[data-ai-apply]").addEventListener("click", function () {
            // Применяем только реально изменяющие команды одной транзакцией → один undo. Документ
            // меняется только здесь, после явного подтверждения.
            runCommands(dry.appliedCommands, "ai-edit");
            closeAiPreview();
            render();
            scheduleAutosave();
            leToastMsg("Готово. Ctrl+Z отменит правку.");
        });
        aiPreviewBar.querySelector("[data-ai-cancel]").addEventListener("click", closeAiPreview);
        return null;
    }
    // Человекочитаемое описание одной команды для diff-списка preview: где (блок) и что меняется.
    function describeAiChange(c) {
        var p = c.payload || {};
        var b = (p.id && byId(p.id)) || (p.parentId && byId(p.parentId));
        var where = b ? blockLabel(b) : "страница";
        var what;
        if (c.type === "setContent") what = "текст «" + (p.field || "") + "» → «" + aiTrunc(p.value) + "»";
        else if (c.type === "setStyle") what = (p.prop || "стиль") + ": " + aiTrunc(p.value) + aiBpSuffix(p.breakpoint);
        else if (c.type === "setDesign") what = "раскладка: " + (p.field || "") + aiBpSuffix(p.breakpoint);
        else if (c.type === "setBlockProp") what = "свойство: " + (p.prop || "");
        else if (c.type === "insertBlock") what = "добавить блок" + (p.block && p.block.type ? " (" + p.block.type + ")" : "");
        else if (c.type === "removeBlock") what = "удалить блок";
        else what = "переместить";
        return { where: where, what: what };
    }
    function aiTrunc(v) {
        var s = v == null ? "" : String(v);
        return s.length > 40 ? s.slice(0, 40) + "…" : s;
    }
    function aiBpSuffix(bp) { return bp && bp !== "base" ? " (" + bp + ")" : ""; }
    function leToastMsg(text) {
        var t = document.getElementById("lime-doc-le-toast");
        if (!t) return;
        t.innerHTML = "<b>" + escapeText(text) + "</b>";
        t.classList.add("is-on");
        setTimeout(function () { t.classList.remove("is-on"); }, 3200);
    }
    // Правка выбранного блока по описанию через серверный LLM→команды (этап 10.2).
    // Контекст (поддерево + тема) уходит на /Ai/Suggest; ответ-команды идут в applyAiCommands
    // (валидация + preview + один undo). Живой LLM не тестируется e2e — каждое звено покрыто
    // отдельно (серверный парсер xUnit, applyAiCommands Playwright 10.1).
    function aiSuggest(blockId, opts) {
        opts = opts || {};
        if (!cmdStore) { alert("AI-правки доступны в режиме команд."); return; }
        var r = findBlock(blockId || selectedId);
        if (!r) { alert("Сначала выбери блок."); return; }
        var t = targetBlock(r.block);
        var ctx = JSON.stringify({
            theme: { accent: doc.theme && doc.theme.accent, bg: doc.theme && doc.theme.bg, fg: doc.theme && doc.theme.fg },
            block: { id: r.block.id, type: t.type, content: t.content, styles: t.styles, design: t.design, children: t.children }
        });
        if (ctx.length > 18000) { alert("Секция слишком большая для AI-правки за один раз. Выбери блок поменьше."); return; }
        var instruction = opts.instruction || prompt("Что изменить в этом блоке? (напр. «сделай заголовок крупнее и ярче», «убери лишний абзац»)", "");
        if (!instruction) return;
        var form = new FormData();
        form.append("context", ctx);
        form.append("instruction", instruction);
        if (opts.breakpoint) form.append("breakpoint", opts.breakpoint); // Responsive-AI (этап 10.5)
        leStatus(opts.breakpoint ? "AI адаптирует под мобильные…" : "AI готовит правки…");
        fetch("/Ai/Suggest", { method: "POST", headers: { "X-CSRF-TOKEN": csrfToken() }, body: form, credentials: "same-origin" })
            .then(function (resp) { return resp.json().then(function (j) { return { status: resp.status, j: j }; }); })
            .then(function (res) {
                leStatus("", { hide: true });
                if (res.status >= 200 && res.status < 300 && res.j && res.j.commands) {
                    if (!res.j.commands.length) { leToastMsg("AI не нашёл, что изменить."); return; }
                    applyAiCommands(res.j.commands);
                } else {
                    alert(res.status === 429 ? "Лимит AI-правок исчерпан в этом месяце." :
                        res.status === 503 ? "AI не настроен на сервере." : "Не получилось подготовить правку. Попробуй ещё раз.");
                }
            })
            .catch(function () { leStatus("", { hide: true }); alert("Сетевая ошибка."); });
    }
    // Responsive-AI «адаптировать мобилку» (этап 10.5): переключаемся на mobile (чтобы видеть результат)
    // и просим адаптацию — сервер вернёт только setStyle/setDesign на breakpoint=mobile, десктоп не тронут.
    function aiAdaptMobile(blockId) {
        switchBreakpoint("mobile");
        aiSuggest(blockId, {
            breakpoint: "mobile",
            instruction: "Адаптируй этот блок под мобильный экран: уменьши крупные шрифты, поправь отступы и переносы, при необходимости сложи элементы в столбец, чтобы ничего не вылезало за края. Тексты и десктоп не меняй."
        });
    }
    // Тест/интеграционный шов: даёт скормить список команд (как от LLM) без живого AI-вызова.
    window.__LIME_AI__ = { apply: applyAiCommands, suggest: aiSuggest, adaptMobile: aiAdaptMobile };

    var aiOpenBtn = document.querySelector("[data-doc-ai-open]");
    if (aiOpenBtn) aiOpenBtn.addEventListener("click", aiOpen);
    document.addEventListener("click", function (e) {
        if (aiModal && e.target.closest("[data-doc-ai-close]")) aiModal.classList.remove("is-open");
        if (e.target.closest("[data-doc-ai-generate]")) aiGenerate();
    });

    // ===== ТЕМА (токены сайта) =====
    if (!doc.theme) doc.theme = {};
    var THEME_KEYS = ["accent", "accent2", "bg", "fg", "muted"];
    THEME_KEYS.forEach(function (k) {
        var el = document.getElementById("lime-theme-" + k);
        if (!el) return;
        el.value = doc.theme[k] || L.DEFAULT_THEME[k];
        el.addEventListener("input", function () { beginCheckpointMutation(); doc.theme[k] = el.value; render(); markDirty(); refreshPalettes(); });
    });

    // Курируемые палитры — гардрейл вкуса: один клик задаёт все 5 токенов гармонично.
    var PALETTES = [
        { name: "Lime Ink", accent: "#c5f24e", accent2: "#a78bfa", bg: "#0b0e0a", fg: "#eef1ea", muted: "#828c79" },
        { name: "Violet", accent: "#a78bfa", accent2: "#38bdf8", bg: "#0d0b1a", fg: "#eceafb", muted: "#8b86a8" },
        { name: "Sunset", accent: "#fb7185", accent2: "#fbbf24", bg: "#1a0f12", fg: "#fdeef0", muted: "#b08a90" },
        { name: "Ocean", accent: "#2dd4bf", accent2: "#38bdf8", bg: "#07171a", fg: "#e6fbf8", muted: "#7fa7a3" },
        { name: "Royal", accent: "#6366f1", accent2: "#ec4899", bg: "#0a0a1f", fg: "#eef0ff", muted: "#8888aa" },
        { name: "Forest", accent: "#84cc16", accent2: "#22c55e", bg: "#0a140d", fg: "#eaf5ea", muted: "#7d9180" },
        { name: "Mono", accent: "#111111", accent2: "#6b7280", bg: "#ffffff", fg: "#14180f", muted: "#6b7280" },
        { name: "Cream", accent: "#b45309", accent2: "#84cc16", bg: "#faf6ef", fg: "#1c1917", muted: "#78716c" }
    ];
    function paletteActive(p) {
        return THEME_KEYS.every(function (k) {
            return (doc.theme[k] || L.DEFAULT_THEME[k]).toLowerCase() === p[k].toLowerCase();
        });
    }
    function refreshPalettes() {
        var box = document.getElementById("lime-theme-palettes");
        if (!box) return;
        box.innerHTML = PALETTES.map(function (p, i) {
            var bars = [p.bg, p.accent, p.accent2, p.fg].map(function (c) {
                return '<span style="background:' + c + '"></span>';
            }).join("");
            return '<button type="button" class="lime-palette' + (paletteActive(p) ? " is-active" : "") + '" data-doc-palette="' + i + '" title="' + p.name + '">' +
                '<span class="lime-palette__bar">' + bars + '</span>' +
                '<span class="lime-palette__name">' + p.name + '</span></button>';
        }).join("");
    }
    function applyPalette(p) {
        beginCheckpointMutation();
        THEME_KEYS.forEach(function (k) {
            doc.theme[k] = p[k];
            var el = document.getElementById("lime-theme-" + k);
            if (el) el.value = p[k];
        });
        render(); markDirty(); refreshPalettes();
    }
    var palettesBox = document.getElementById("lime-theme-palettes");
    if (palettesBox) {
        palettesBox.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-doc-palette]");
            if (btn) applyPalette(PALETTES[parseInt(btn.getAttribute("data-doc-palette"), 10)]);
        });
        refreshPalettes();
    }
    var fontSel = document.getElementById("lime-theme-font");
    if (fontSel) {
        var themeFont = doc.theme.font || L.DEFAULT_THEME.font;
        fontSel.innerHTML = fontOptionsHtml(themeFont, false); // полный список Google Fonts
        fontSel.value = themeFont;
        fontSel.addEventListener("input", function () { beginCheckpointMutation(); doc.theme.font = fontSel.value; render(); markDirty(); });
    }
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

    // ===== КОД САЙТА (этап 0.2): глобальный CSS + кастомный head =====
    var codeModal = document.getElementById("lime-doc-code-modal");
    var cssArea = document.getElementById("lime-doc-custom-css");
    var headArea = document.getElementById("lime-doc-custom-head");
    var codeOpen = document.querySelector("[data-doc-code-open]");
    if (codeOpen && codeModal) {
        codeOpen.addEventListener("click", function () {
            if (cssArea) cssArea.value = doc.customCss || "";
            if (headArea) headArea.value = doc.head || "";
            codeModal.classList.add("is-open");
        });
    }
    // CSS правим живьём — render() обновляет холст; head только сохраняем (на холст не влияет).
    if (cssArea) cssArea.addEventListener("input", function () {
        beginCheckpointMutation();
        doc.customCss = cssArea.value;
        if (!doc.customCss) delete doc.customCss;
        render(); markDirty();
    });
    if (headArea) headArea.addEventListener("input", function () {
        beginCheckpointMutation();
        doc.head = headArea.value;
        if (!doc.head) delete doc.head;
        markDirty();
    });
    document.addEventListener("click", function (e) {
        if (codeModal && e.target.closest("[data-doc-code-close]")) codeModal.classList.remove("is-open");
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

    // ===== PAGES / COMPONENTS UI =====
    var pagesBox = document.getElementById("lime-doc-pages");
    var pagesModal = document.getElementById("lime-doc-pages-modal");
    function openPagesModal() { if (pagesModal) { renderPagesList(); pagesModal.classList.add("is-open"); } }
    if (pagesBox) {
        pagesBox.addEventListener("click", function (e) {
            if (e.target.closest("[data-doc-pages-open]")) { openPagesModal(); return; }
            if (e.target.closest("[data-doc-page-add]")) { addPage(); return; }
            var tab = e.target.closest("[data-doc-page]");
            if (tab) switchPage(parseInt(tab.getAttribute("data-doc-page"), 10));
        });
        pagesBox.addEventListener("dblclick", function (e) {
            if (e.target.closest("[data-doc-page]")) openPagesModal();
        });
    }
    if (pagesModal) {
        pagesModal.addEventListener("click", function (e) {
            var el;
            if (e.target.closest("[data-doc-pages-close]")) { pagesModal.classList.remove("is-open"); return; }
            if (e.target.closest("[data-doc-page-add-modal]")) { addPage(); return; }
            if ((el = e.target.closest("[data-doc-page-goto]"))) { switchPage(parseInt(el.dataset.docPageGoto, 10)); renderPagesList(); return; }
            if ((el = e.target.closest("[data-doc-page-dup]"))) { duplicatePage(parseInt(el.dataset.docPageDup, 10)); return; }
            if ((el = e.target.closest("[data-doc-page-del]"))) { deletePage(parseInt(el.dataset.docPageDel, 10)); return; }
        });
        pagesModal.addEventListener("input", function (e) {
            var el;
            if ((el = e.target.closest("[data-doc-page-title]"))) { setPageTitle(parseInt(el.dataset.docPageTitle, 10), el.value); return; }
            // SEO/AEO: описание страницы (этап 3.6) — без ре-рендера холста, только в doc + autosave.
            if ((el = e.target.closest("[data-doc-page-desc]"))) {
                var pi = parseInt(el.dataset.docPageDesc, 10);
                if (doc.pages[pi]) {
                    beginCheckpointMutation();
                    if (el.value) doc.pages[pi].description = el.value; else delete doc.pages[pi].description;
                    markDirty();
                }
            }
        });
        // Слаг нормализуем по уходу из поля (на каждый ввод дёргать uniqueSlug мешает печатать).
        pagesModal.addEventListener("change", function (e) {
            var el;
            if ((el = e.target.closest("[data-doc-page-slug]"))) { setPageSlug(parseInt(el.dataset.docPageSlug, 10), el.value); return; }
            // CMS 2.0: привязка страницы к коллекции (шаблон записи) / снятие привязки.
            if ((el = e.target.closest("[data-doc-page-collection]"))) {
                var pi = parseInt(el.dataset.docPageCollection, 10);
                if (doc.pages[pi]) {
                    beginCheckpointMutation();
                    if (el.value) doc.pages[pi].collection = el.value; else delete doc.pages[pi].collection;
                    render(); markDirty();
                    if (pi === active) refreshInspector();
                }
            }
        });
    }
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

    function initV2Selection(stage, viewport, isViewportPanning) {
        if (!window.LimeSelection) return;
        var overlay = document.getElementById("lime-selection-overlay");
        if (!overlay) return;
        var boxes = overlay.querySelector("[data-selection-boxes]");
        var hoverBox = overlay.querySelector("[data-selection-hover]");
        var marqueeBox = overlay.querySelector("[data-selection-marquee]");
        var selection = window.LimeSelection.createSelection();
        var hoverId = null;
        var marqueeDrag = null;
        var suppressClick = false;
        var activeResize = null;
        var activeMove = null;
        var activeRotate = null;
        var activeGridSpan = null;
        var bodyDragPending = null; // DnD B: ожидание порога для перемещения free-блока за тело
        var freeMoveEl = null;      // DnD B: блок с курсором move (подсказка перетаскивания)
        var guides = overlay.querySelector("[data-selection-guides]");
        var gesturePerf = { move: [], resize: [], rotate: [] };
        window.__LIME_V2_PERF__ = gesturePerf;
        function recordGesturePerf(kind, started) {
            var samples = gesturePerf[kind];
            if (!samples) return;
            samples.push(performance.now() - started);
            if (samples.length > 240) samples.shift();
        }
        if (!guides) {
            guides = document.createElement("div");
            guides.setAttribute("data-selection-guides", "");
            overlay.insertBefore(guides, boxes);
        }

        function freeInfo(id) {
            if (!window.LimeLayout || !L.resolvedDesign) return null;
            var found = findBlock(id);
            if (!found || !found.parentBlock) return null;
            if (found.block.hidden || found.block.locked) return null;
            var parent = targetBlock(found.parentBlock);
            var parentDesign = L.resolvedDesign(parent && parent.design, currentBp);
            var childDesign = resolvedBlockDesign(found.block, currentBp);
            if (!parentDesign.layout || parentDesign.layout.mode !== "free" || !childDesign.frame) return null;
            return { source: found.block, frame: clone(childDesign.frame), size: childDesign.size || {}, siblings: found.parent };
        }
        function freeGroup(state) {
            if (!state || state.ids.length < 2) return null;
            var items = [], siblings = null;
            for (var i = 0; i < state.ids.length; i++) {
                var info = freeInfo(state.ids[i]);
                if (!info || (siblings && info.siblings !== siblings)) return null;
                siblings = info.siblings;
                items.push({ id: state.ids[i], info: info });
            }
            return { items: items, siblings: siblings, primaryId: state.primaryId };
        }
        function gridInfo(id) {
            var found = findBlock(id);
            if (!found || !found.parentBlock || found.block.hidden || found.block.locked || found.block.type === "component") return null;
            var parent = targetBlock(found.parentBlock);
            var parentDesign = L.resolvedDesign(parent && parent.design, currentBp);
            if (!parentDesign.layout || parentDesign.layout.mode !== "grid") return null;
            var childDesign = resolvedBlockDesign(found.block, currentBp);
            return {
                source: found.block,
                span: Math.max(1, Math.floor(childDesign.span || 1)),
                rowSpan: Math.max(1, Math.floor(childDesign.rowSpan || 1))
            };
        }

        function localRect(el) {
            var sr = stage.getBoundingClientRect();
            var r = el.getBoundingClientRect();
            var left = r.left - sr.left, top = r.top - sr.top;
            // x/y дублируют left/top: LimeSelection.normalizeRect (hit-test/marquee) читает rect.x/.y,
            // а place()/unionRects — .left/.top. Без x/y normalizeRect схлопывает прямоугольник в (0,0)
            // → клик/рамка не попадают ни в один блок (баг был не виден: self-test модуля даёт x/y-rect'ы).
            return { x: left, y: top, left: left, top: top, right: r.right - sr.left, bottom: r.bottom - sr.top, width: r.width, height: r.height };
        }
        function place(el, r) {
            el.style.left = r.left + "px";
            el.style.top = r.top + "px";
            el.style.width = Math.max(0, r.width) + "px";
            el.style.height = Math.max(0, r.height) + "px";
        }
        function unionRects(rects) {
            var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            rects.forEach(function (r) {
                left = Math.min(left, r.left); top = Math.min(top, r.top);
                right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
            });
            return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
        }
        function addTransformHandles(box, allowRotate) {
            if (allowRotate) {
                var stem = document.createElement("span");
                stem.className = "lime-rotate-stem";
                box.appendChild(stem);
                var rotate = document.createElement("span");
                rotate.className = "lime-rotate-handle";
                rotate.setAttribute("data-rotate-handle", "");
                rotate.setAttribute("title", "Rotate (Shift: 15°)");
                box.appendChild(rotate);
            }
            var move = document.createElement("span");
            move.className = "lime-move-handle";
            move.setAttribute("data-move-handle", "");
            move.setAttribute("title", "Move");
            move.textContent = "\u2725";
            box.appendChild(move);
            ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (handle) {
                var h = document.createElement("span");
                h.className = "lime-resize-handle";
                h.setAttribute("data-handle", handle);
                box.appendChild(h);
            });
        }
        // Stage 9.1: плавающая панель действий над выделением (≥2 free-siblings).
        // Align (6) всегда; distribute (2) — только при ≥3 узлах.
        var ALIGN_OPS = [
            { op: "left", glyph: "⇤", label: "Выровнять по левому краю" },
            { op: "hcenter", glyph: "↔", label: "Выровнять по центру (гор.)" },
            { op: "right", glyph: "⇥", label: "Выровнять по правому краю" },
            { op: "top", glyph: "⤒", label: "Выровнять по верху" },
            { op: "vcenter", glyph: "↕", label: "Выровнять по центру (верт.)" },
            { op: "bottom", glyph: "⤓", label: "Выровнять по низу" }
        ];
        var DISTRIBUTE_OPS = [
            { op: "dist-h", glyph: "⇿", label: "Распределить по горизонтали" },
            { op: "dist-v", glyph: "⇳", label: "Распределить по вертикали" }
        ];
        function alignButton(spec) {
            return '<button type="button" class="lime-align-toolbar__btn" data-align-op="' + spec.op +
                '" title="' + spec.label + '" aria-label="' + spec.label + '">' + spec.glyph + '</button>';
        }
        function buildAlignToolbar(rect, count) {
            var bar = document.createElement("div");
            bar.className = "lime-align-toolbar";
            bar.setAttribute("role", "toolbar");
            bar.setAttribute("aria-label", "Выравнивание и распределение");
            var html = ALIGN_OPS.map(alignButton).join("");
            if (count >= 3) html += '<span class="lime-align-toolbar__sep"></span>' + DISTRIBUTE_OPS.map(alignButton).join("");
            bar.innerHTML = html;
            bar.style.left = rect.left + "px";
            bar.style.top = Math.max(0, rect.top - 40) + "px";
            // Не даём pointerdown всплыть в stage: иначе он стартует marquee и забирает
            // pointer-capture, что глотает последующий клик по кнопке.
            bar.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
            return bar;
        }
        function alignSelection(op) {
            if (!window.LimeLayout) return;
            var group = freeGroup(selection.get());
            if (!group) return;
            var frames = group.items.map(function (item) { return item.info.frame; });
            var next;
            if (op === "dist-h") next = window.LimeLayout.distributeFrames(frames, "horizontal");
            else if (op === "dist-v") next = window.LimeLayout.distributeFrames(frames, "vertical");
            else next = window.LimeLayout.alignFrames(frames, op);
            var items = group.items.map(function (item, i) {
                return { id: item.id, source: item.info.source, start: item.info.frame, next: next[i] };
            }).filter(function (item) { return item.start.x !== item.next.x || item.start.y !== item.next.y; });
            if (!items.length) { refresh(); return; }
            commitFrameItems(items, op.indexOf("dist") === 0 ? "distribute-selection" : "align-selection");
        }
        boxes.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-align-op]");
            if (!btn) return;
            e.preventDefault(); e.stopPropagation();
            alignSelection(btn.getAttribute("data-align-op"));
        });
        // Stage 9.3: контекстный toolbar быстрых действий над одиночным выбранным блоком.
        // Дополняет ПКМ-меню (та же единая точка runBlockOp). Правый край бокса, над ним —
        // не пересекается с центрированными move/rotate-хэндлами.
        function buildBlockToolbar(rect, found) {
            var nested = !!(found && found.parentBlock);
            var ops = [
                { op: "dup", icon: "duplicate", label: "Дублировать (Ctrl+D)" },
                { op: "up", icon: "up", label: "Поднять" },
                { op: "down", icon: "down", label: "Опустить" }
            ];
            if (nested) ops.push({ op: "unwrap", icon: "out", label: "Вынести наружу" });
            ops.push({ op: "aiedit", icon: "features", label: "AI: переписать" });
            ops.push({ op: "del", icon: "trash", label: "Удалить (Del)", danger: true });
            // Переиспользуем готовый компонент дизайн-системы .lime-block-toolbar (is-visible).
            var bar = document.createElement("div");
            bar.className = "lime-block-toolbar is-visible";
            bar.setAttribute("role", "toolbar");
            bar.setAttribute("aria-label", "Действия над блоком");
            bar.innerHTML = ops.map(function (o) {
                return '<button type="button" class="lime-block-toolbar__btn' + (o.danger ? " lime-block-toolbar__btn--danger" : "") +
                    '" data-block-op="' + o.op + '" title="' + o.label + '" aria-label="' + o.label + '">' + ico(o.icon) + '</button>';
            }).join("");
            bar.style.left = rect.right + "px";
            bar.style.top = Math.max(0, rect.top - 38) + "px";
            bar.style.transform = "translateX(-100%)"; // правый край toolbar к правому краю бокса
            bar.style.pointerEvents = "auto"; // overlay — pointer-events:none, кнопкам нужен клик
            bar.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
            return bar;
        }
        boxes.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-block-op]");
            if (!btn) return;
            e.preventDefault(); e.stopPropagation();
            runBlockOp(btn.getAttribute("data-block-op"));
        });
        function addGridSpanHandle(box) {
            var handle = document.createElement("span");
            handle.className = "lime-grid-span-handle";
            handle.setAttribute("data-grid-span-handle", "");
            handle.setAttribute("title", "Изменить span колонок и строк");
            handle.textContent = "↘";
            box.appendChild(handle);
        }
        function candidates() {
            var out = [];
            var nodes = ws.querySelectorAll(".lime-block[data-block-id]");
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                var model = byId(el.getAttribute("data-block-id"));
                var depth = 1, p = el.parentElement;
                while (p && p !== ws) { if (p.classList && p.classList.contains("lime-block")) depth++; p = p.parentElement; }
                out.push({ id: el.getAttribute("data-block-id"), rect: localRect(el), depth: depth, zIndex: parseInt(getComputedStyle(el).zIndex, 10) || 0, order: i,
                    hidden: !!(model && model.hidden), locked: !!(model && model.locked), el: el });
            }
            return out;
        }
        function syncLegacy(state) {
            var old = ws.querySelectorAll(".is-selected");
            for (var i = 0; i < old.length; i++) old[i].classList.remove("is-selected");
            selectedId = state.primaryId;
            if (selectedId) {
                var primary = ws.querySelector('[data-block-id="' + selectedId + '"]');
                if (primary) primary.classList.add("is-selected");
            }
            currentClass = null;
            refreshInspector(); refreshLayers();
        }
        function refresh() {
            var state = selection.get();
            var valid = state.ids.filter(function (id) { return !!ws.querySelector('[data-block-id="' + id + '"]'); });
            if (valid.length !== state.ids.length) { selection.replace(valid); return; }
            boxes.innerHTML = "";
            if (freeMoveEl) { freeMoveEl.classList.remove("is-free-move"); freeMoveEl = null; }
            var group = freeGroup(state);
            state.ids.forEach(function (id) {
                var el = ws.querySelector('[data-block-id="' + id + '"]');
                var model = byId(id);
                if (!el || (model && model.hidden)) return;
                var box = document.createElement("div");
                box.className = "lime-selection-box" + (id === state.primaryId ? " is-primary" : "");
                box.setAttribute("data-selection-id", id);
                place(box, localRect(el));
                if (!group && id === state.primaryId) {
                    if (freeInfo(id)) { addTransformHandles(box, true); el.classList.add("is-free-move"); freeMoveEl = el; }
                    else if (gridInfo(id)) addGridSpanHandle(box);
                }
                boxes.appendChild(box);
            });
            if (group) {
                var groupRects = group.items.map(function (item) {
                    return localRect(ws.querySelector('[data-block-id="' + item.id + '"]'));
                });
                var groupBox = document.createElement("div");
                groupBox.className = "lime-selection-box is-primary is-group";
                groupBox.setAttribute("data-selection-group", "");
                var groupRect = unionRects(groupRects);
                place(groupBox, groupRect);
                addTransformHandles(groupBox, false);
                boxes.appendChild(groupBox);
                boxes.appendChild(buildAlignToolbar(groupRect, group.items.length));
            }
            if (!group && state.ids.length === 1 && state.primaryId) {
                var soleEl = ws.querySelector('[data-block-id="' + state.primaryId + '"]');
                var soleModel = byId(state.primaryId);
                if (soleEl && !(soleModel && soleModel.hidden)) {
                    boxes.appendChild(buildBlockToolbar(localRect(soleEl), findBlock(state.primaryId)));
                }
            }
            var hoverEl = hoverId && !selection.has(hoverId) ? ws.querySelector('[data-block-id="' + hoverId + '"]') : null;
            if (hoverEl) { place(hoverBox, localRect(hoverEl)); hoverBox.hidden = false; }
            else hoverBox.hidden = true;
        }
        refreshV2SelectionOverlay = refresh;
        selection.subscribe(function (state) { syncLegacy(state); refresh(); });
        viewport.subscribe(refresh);
        window.addEventListener("resize", refresh);

        function localPoint(e) {
            var r = stage.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        stage.addEventListener("click", function (e) {
            if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
            var point = localPoint(e);
            var hit = window.LimeSelection.hitTest(candidates(), point);
            if (hit) selection.select(hit.id, { additive: e.shiftKey, toggle: e.shiftKey });
            else if (e.target === stage || e.target === ws || e.target.closest(".lime-workspace__placeholder")) selection.clear();
        });
        stage.addEventListener("pointermove", function (e) {
            if (marqueeDrag) {
                var p = localPoint(e);
                marqueeDrag.x2 = p.x; marqueeDrag.y2 = p.y;
                var r = window.LimeSelection.normalizeRect(marqueeDrag);
                place(marqueeBox, { left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top });
                return;
            }
            if (isViewportPanning()) return;
            var hit = window.LimeSelection.hitTest(candidates(), localPoint(e));
            var nextHover = hit ? hit.id : null;
            if (nextHover !== hoverId) { hoverId = nextHover; refresh(); }
        });
        stage.addEventListener("pointerleave", function () { if (!marqueeDrag) { hoverId = null; refresh(); } });
        stage.addEventListener("pointerdown", function (e) {
            // Интерактивные контролы в холсте (кнопки пустого состояния и т.п.) не должны стартовать
            // marquee: его e.preventDefault() подавил бы их click (этап 9.4).
            if (e.button !== 0 || isViewportPanning() || e.target.closest(".lime-block, button, a, input, textarea, select")) return;
            var p = localPoint(e);
            marqueeDrag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, additive: e.shiftKey };
            marqueeBox.hidden = false;
            place(marqueeBox, { left: p.x, top: p.y, width: 0, height: 0 });
            try { stage.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            e.preventDefault();
        });
        stage.addEventListener("pointerup", function (e) {
            if (!marqueeDrag) return;
            var drag = marqueeDrag;
            marqueeDrag = null;
            marqueeBox.hidden = true;
            try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            var moved = Math.abs(drag.x2 - drag.x1) + Math.abs(drag.y2 - drag.y1) > 4;
            if (moved) {
                var ids = window.LimeSelection.marquee(candidates(), drag);
                selection.replace(drag.additive ? selection.get().ids.concat(ids) : ids);
                suppressClick = true;
            }
        });
        document.addEventListener("click", function (e) {
            var row = e.target.closest("[data-doc-layer]");
            if (row) selection.select(row.getAttribute("data-doc-layer"), { additive: e.shiftKey, toggle: e.shiftKey });
        });
        function moveTargets(info, excluded) {
            var out = [];
            (info.siblings || []).forEach(function (sibling) {
                if (!sibling || (excluded && excluded[sibling.id])) return;
                var siblingDesign = resolvedBlockDesign(sibling, currentBp);
                if (!siblingDesign.frame) return;
                out.push({ id: sibling.id, rect: clone(siblingDesign.frame), hidden: !!sibling.hidden, locked: !!sibling.locked });
            });
            return out;
        }
        function anchorValue(r, axis, kind) {
            if (axis === "x") {
                if (kind === "right") return r.right;
                if (kind === "center") return r.left + r.width / 2;
                return r.left;
            }
            if (kind === "bottom") return r.bottom;
            if (kind === "center") return r.top + r.height / 2;
            return r.top;
        }
        function showGuides(gesture, hits) {
            guides.innerHTML = "";
            if (!hits || !hits.length) return;
            var parentRect = localRect(gesture.blockEl.parentElement);
            var movingRect = localRect(gesture.blockEl);
            hits.forEach(function (hit) {
                var targetEl = hit.targetId && ws.querySelector('[data-block-id="' + hit.targetId + '"]');
                var targetRect = targetEl ? localRect(targetEl) : movingRect;
                var kind = targetEl ? hit.target : hit.moving;
                var value = anchorValue(targetRect, hit.axis, kind);
                var line = document.createElement("span");
                line.className = "lime-snap-guide is-" + hit.axis;
                if (hit.axis === "x") {
                    line.style.left = value + "px";
                    line.style.top = parentRect.top + "px";
                    line.style.height = parentRect.height + "px";
                } else {
                    line.style.left = parentRect.left + "px";
                    line.style.top = value + "px";
                    line.style.width = parentRect.width + "px";
                }
                guides.appendChild(line);
            });
        }
        function pointerInParent(e, blockEl) {
            var r = blockEl.parentElement.getBoundingClientRect();
            var zoom = viewport.get().zoom || 1;
            return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
        }
        function resizeDelta(start, handle, next) {
            handle = String(handle || "");
            return {
                x: handle.indexOf("w") >= 0 ? next.x - start.x : handle.indexOf("e") >= 0 ? (next.x + next.width) - (start.x + start.width) : 0,
                y: handle.indexOf("n") >= 0 ? next.y - start.y : handle.indexOf("s") >= 0 ? (next.y + next.height) - (start.y + start.height) : 0
            };
        }
        overlay.addEventListener("pointerdown", function (e) {
            var gridSpanHandle = e.target.closest("[data-grid-span-handle]");
            if (gridSpanHandle) {
                var gridBox = gridSpanHandle.closest("[data-selection-id]");
                var gridId = gridBox && gridBox.getAttribute("data-selection-id");
                var grid = gridId && gridInfo(gridId);
                var gridEl = gridId && ws.querySelector('[data-block-id="' + gridId + '"]');
                var gridParent = gridEl && gridEl.parentElement;
                if (!grid || !gridEl || !gridParent) return;
                var gridStyle = getComputedStyle(gridParent);
                var tracks = String(gridStyle.gridTemplateColumns || "").trim().split(/\s+/).filter(Boolean);
                var columnCount = Math.max(1, tracks.length);
                var columnGap = parseFloat(gridStyle.columnGap) || 0;
                var parentWidth = gridParent.getBoundingClientRect().width;
                var columnStep = Math.max(1, (parentWidth - columnGap * (columnCount - 1)) / columnCount + columnGap);
                var rowGap = parseFloat(gridStyle.rowGap) || 0;
                var explicitRow = parseFloat(gridStyle.gridAutoRows);
                var rowStep = isFinite(explicitRow) && explicitRow > 0
                    ? explicitRow * (viewport.get().zoom || 1) + rowGap
                    : Math.max(1, gridEl.getBoundingClientRect().height / grid.rowSpan + rowGap);
                activeGridSpan = {
                    id: gridId, source: grid.source, pointerId: e.pointerId, blockEl: gridEl, box: gridBox,
                    clientX: e.clientX, clientY: e.clientY, columnStep: columnStep, rowStep: rowStep,
                    maxColumns: columnCount, startSpan: grid.span, startRowSpan: grid.rowSpan,
                    nextSpan: grid.span, nextRowSpan: grid.rowSpan
                };
                try { gridSpanHandle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var rotateHandle = e.target.closest("[data-rotate-handle]");
            if (rotateHandle) {
                var rotateBox = rotateHandle.closest("[data-selection-id]");
                var rotateId = rotateBox && rotateBox.getAttribute("data-selection-id");
                var rotateInfo = rotateId && freeInfo(rotateId);
                var rotateEl = rotateId && ws.querySelector('[data-block-id="' + rotateId + '"]');
                if (!rotateInfo || !rotateEl) return;
                activeRotate = {
                    id: rotateId, source: rotateInfo.source, start: rotateInfo.frame, next: rotateInfo.frame,
                    startPoint: pointerInParent(e, rotateEl), pointerId: e.pointerId, blockEl: rotateEl, box: rotateBox
                };
                try { rotateHandle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var moveHandle = e.target.closest("[data-move-handle]");
            if (moveHandle) {
                var moveBox = moveHandle.closest("[data-selection-id]");
                var moveGroupBox = moveHandle.closest("[data-selection-group]");
                var moveId = moveGroupBox ? selection.get().primaryId : moveBox && moveBox.getAttribute("data-selection-id");
                var moveInfo = moveId && freeInfo(moveId);
                var moveEl = moveId && ws.querySelector('[data-block-id="' + moveId + '"]');
                if (!moveInfo || !moveEl || !window.LimeSnap) return;
                var selected = selection.get().ids;
                var moveItems = [];
                selected.forEach(function (selectedId) {
                    var selectedInfo = freeInfo(selectedId);
                    var selectedEl = ws.querySelector('[data-block-id="' + selectedId + '"]');
                    var selectedBox = boxes.querySelector('[data-selection-id="' + selectedId + '"]');
                    if (selectedInfo && selectedInfo.siblings === moveInfo.siblings && selectedEl && selectedBox) {
                        moveItems.push({ id: selectedId, source: selectedInfo.source, start: selectedInfo.frame, next: selectedInfo.frame, blockEl: selectedEl, box: selectedBox });
                    }
                });
                // Смешанный selection из разных parents не двигаем частично: жест остаётся single-primary.
                if (moveItems.length !== selected.length) {
                    moveItems = [{ id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame, blockEl: moveEl, box: moveBox }];
                }
                var excluded = {};
                moveItems.forEach(function (item) { excluded[item.id] = true; });
                activeMove = {
                    id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame,
                    items: moveItems, targets: moveTargets(moveInfo, excluded), pointerId: e.pointerId,
                    clientX: e.clientX, clientY: e.clientY, blockEl: moveEl, box: moveBox,
                    groupBox: moveGroupBox
                };
                try { moveHandle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var handle = e.target.closest("[data-handle]");
            if (!handle) return;
            var resizeGroupBox = handle.closest("[data-selection-group]");
            if (resizeGroupBox) {
                var groupState = freeGroup(selection.get());
                if (!groupState) return;
                var groupItems = groupState.items.map(function (item) {
                    var groupEl = ws.querySelector('[data-block-id="' + item.id + '"]');
                    return { id: item.id, source: item.info.source, start: item.info.frame, next: item.info.frame, blockEl: groupEl,
                        box: boxes.querySelector('[data-selection-id="' + item.id + '"]') };
                });
                var groupStart = window.LimeLayout.frameBounds(groupItems.map(function (item) { return item.start; }));
                activeResize = {
                    group: true, items: groupItems, start: groupStart, next: groupStart,
                    handle: handle.getAttribute("data-handle"), pointerId: e.pointerId,
                    clientX: e.clientX, clientY: e.clientY, box: resizeGroupBox, blockEl: groupItems[0].blockEl,
                    targets: moveTargets(groupState.items[0].info, groupState.items.reduce(function (out, item) { out[item.id] = true; return out; }, {}))
                };
                try { handle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var box = handle.closest("[data-selection-id]");
            var id = box && box.getAttribute("data-selection-id");
            var info = id && freeInfo(id);
            var blockEl = id && ws.querySelector('[data-block-id="' + id + '"]');
            if (!info || !blockEl) return;
            activeResize = {
                id: id, source: info.source, start: info.frame, size: info.size,
                handle: handle.getAttribute("data-handle"), pointerId: e.pointerId,
                clientX: e.clientX, clientY: e.clientY, blockEl: blockEl, box: box, next: info.frame,
                targets: moveTargets(info, (function () { var out = {}; out[id] = true; return out; })())
            };
            try { handle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            e.preventDefault(); e.stopPropagation();
        });
        // ===== DnD B: перемещение free-блока за его тело (не только за move-handle) =====
        // Текст остаётся редактируемым: на pointerdown НЕ зовём preventDefault (клик ставит каретку),
        // а move стартует только после порога 5px. Двигаем уже активный (primary) free-блок; жест
        // переиспользует ту же машинерию activeMove (snap/guides/commit), капчёр — на selection-box.
        function endBodyDragPending() {
            bodyDragPending = null;
            window.removeEventListener("pointermove", onBodyDragMove, true);
            window.removeEventListener("pointerup", endBodyDragPending, true);
            window.removeEventListener("pointercancel", endBodyDragPending, true);
        }
        function beginBodyMove(moveId, e) {
            var moveInfo = freeInfo(moveId);
            var moveEl = ws.querySelector('[data-block-id="' + moveId + '"]');
            var moveBox = boxes.querySelector('[data-selection-id="' + moveId + '"]');
            if (!moveInfo || !moveEl || !moveBox || !window.LimeSnap) return false;
            var selected = selection.get().ids;
            var moveItems = [];
            selected.forEach(function (sid) {
                var si = freeInfo(sid);
                var sEl = ws.querySelector('[data-block-id="' + sid + '"]');
                var sBox = boxes.querySelector('[data-selection-id="' + sid + '"]');
                if (si && si.siblings === moveInfo.siblings && sEl && sBox) {
                    moveItems.push({ id: sid, source: si.source, start: si.frame, next: si.frame, blockEl: sEl, box: sBox });
                }
            });
            if (moveItems.length !== selected.length) {
                moveItems = [{ id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame, blockEl: moveEl, box: moveBox }];
            }
            var excluded = {};
            moveItems.forEach(function (item) { excluded[item.id] = true; });
            activeMove = {
                id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame,
                items: moveItems, targets: moveTargets(moveInfo, excluded), pointerId: e.pointerId,
                clientX: e.clientX, clientY: e.clientY, blockEl: moveEl, box: moveBox, groupBox: null
            };
            try { moveBox.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            return true;
        }
        function onBodyDragMove(e) {
            if (!bodyDragPending || e.pointerId !== bodyDragPending.pointerId) return;
            if (Math.abs(e.clientX - bodyDragPending.x0) + Math.abs(e.clientY - bodyDragPending.y0) < 5) return;
            var id = bodyDragPending.id;
            endBodyDragPending();
            if (activeMove || activeResize || activeRotate) return;
            if (beginBodyMove(id, e)) {
                var sel = window.getSelection && window.getSelection();
                if (sel && sel.removeAllRanges) sel.removeAllRanges();
                e.preventDefault();
            }
        }
        ws.addEventListener("pointerdown", function (e) {
            if (e.button !== 0 || isViewportPanning() || activeMove || activeResize || activeRotate) return;
            var blockEl = e.target.closest(".lime-block[data-block-id]");
            if (!blockEl) return;
            var id = blockEl.getAttribute("data-block-id");
            if (selection.get().primaryId !== id) return; // телом двигаем только активный блок
            if (!freeInfo(id)) return;                     // только free-ребёнок
            bodyDragPending = { id: id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
            window.addEventListener("pointermove", onBodyDragMove, true);
            window.addEventListener("pointerup", endBodyDragPending, true);
            window.addEventListener("pointercancel", endBodyDragPending, true);
        });
        document.addEventListener("pointermove", function (e) {
            if (activeRotate && activeRotate.pointerId === e.pointerId) {
                var rotatePerfStarted = performance.now();
                activeRotate.next = window.LimeLayout.rotateFrame(activeRotate.start, activeRotate.startPoint, pointerInParent(e, activeRotate.blockEl), {
                    snap: e.shiftKey, increment: 15
                });
                activeRotate.blockEl.style.transform = activeRotate.next.rotation ? "rotate(" + activeRotate.next.rotation + "deg)" : "";
                place(activeRotate.box, localRect(activeRotate.blockEl));
                recordGesturePerf("rotate", rotatePerfStarted);
            }
            if (activeGridSpan && activeGridSpan.pointerId === e.pointerId) {
                activeGridSpan.nextSpan = Math.max(1, Math.min(activeGridSpan.maxColumns,
                    activeGridSpan.startSpan + Math.round((e.clientX - activeGridSpan.clientX) / activeGridSpan.columnStep)));
                activeGridSpan.nextRowSpan = Math.max(1, Math.min(12,
                    activeGridSpan.startRowSpan + Math.round((e.clientY - activeGridSpan.clientY) / activeGridSpan.rowStep)));
                activeGridSpan.blockEl.style.gridColumn = "span " + activeGridSpan.nextSpan;
                activeGridSpan.blockEl.style.gridRow = "span " + activeGridSpan.nextRowSpan;
                place(activeGridSpan.box, localRect(activeGridSpan.blockEl));
            }
        }, true);
        overlay.addEventListener("pointermove", function (e) {
            var perfStarted = performance.now();
            if (activeMove && activeMove.pointerId === e.pointerId) {
                var moveZoom = viewport.get().zoom || 1;
                var moveDx = (e.clientX - activeMove.clientX) / moveZoom;
                var moveDy = (e.clientY - activeMove.clientY) / moveZoom;
                if (e.shiftKey) {
                    if (Math.abs(moveDx) >= Math.abs(moveDy)) moveDy = 0; else moveDx = 0;
                }
                var moved = window.LimeLayout.moveFrame(activeMove.start, moveDx, moveDy);
                var snapped = e.altKey ? { rect: moved, guides: [] } : window.LimeSnap.snapMove(moved, activeMove.targets, { threshold: 6 / moveZoom });
                activeMove.next = {
                    x: snapped.rect.x, y: snapped.rect.y, width: moved.width, height: moved.height, rotation: moved.rotation
                };
                var appliedX = activeMove.next.x - activeMove.start.x;
                var appliedY = activeMove.next.y - activeMove.start.y;
                activeMove.items.forEach(function (item) {
                    item.next = window.LimeLayout.moveFrame(item.start, appliedX, appliedY);
                    var moveStyle = item.blockEl.style;
                    moveStyle.position = "absolute";
                    moveStyle.left = item.next.x + "px"; moveStyle.top = item.next.y + "px";
                    place(item.box, localRect(item.blockEl));
                });
                if (activeMove.groupBox) {
                    place(activeMove.groupBox, unionRects(activeMove.items.map(function (item) { return localRect(item.blockEl); })));
                }
                showGuides(activeMove, snapped.guides);
                recordGesturePerf("move", perfStarted);
                return;
            }
            if (!activeResize || activeResize.pointerId !== e.pointerId) return;
            var zoom = viewport.get().zoom || 1;
            var dx = (e.clientX - activeResize.clientX) / zoom;
            var dy = (e.clientY - activeResize.clientY) / zoom;
            if (activeResize.group) {
                var groupResult = window.LimeLayout.resizeFrames(activeResize.items.map(function (item) { return item.start; }), activeResize.handle, { x: dx, y: dy }, {
                    shift: e.shiftKey, alt: e.altKey, itemMin: 8
                });
                if (!e.shiftKey && !e.altKey && window.LimeSnap && window.LimeSnap.snapResize) {
                    var groupSnap = window.LimeSnap.snapResize(groupResult.bounds, activeResize.handle, activeResize.targets, { threshold: 6 / zoom });
                    var groupDelta = resizeDelta(activeResize.start, activeResize.handle, groupSnap.rect);
                    groupResult = window.LimeLayout.resizeFrames(activeResize.items.map(function (item) { return item.start; }), activeResize.handle, groupDelta, { itemMin: 8 });
                    showGuides(activeResize, groupSnap.guides);
                } else guides.innerHTML = "";
                activeResize.next = groupResult.bounds;
                activeResize.items.forEach(function (item, index) {
                    item.next = groupResult.frames[index];
                    var groupStyle = item.blockEl.style;
                    groupStyle.position = "absolute";
                    groupStyle.left = item.next.x + "px"; groupStyle.top = item.next.y + "px";
                    groupStyle.width = item.next.width + "px"; groupStyle.height = item.next.height + "px";
                    groupStyle.transform = item.next.rotation ? "rotate(" + item.next.rotation + "deg)" : "";
                    place(item.box, localRect(item.blockEl));
                });
                place(activeResize.box, unionRects(activeResize.items.map(function (item) { return localRect(item.blockEl); })));
                recordGesturePerf("resize", perfStarted);
                return;
            }
            var next = window.LimeLayout.resizeFrame(activeResize.start, activeResize.handle, { x: dx, y: dy }, {
                shift: e.shiftKey, alt: e.altKey,
                width: activeResize.size.width, height: activeResize.size.height
            });
            if (!e.shiftKey && !e.altKey && window.LimeSnap && window.LimeSnap.snapResize) {
                var resizeSnap = window.LimeSnap.snapResize(next, activeResize.handle, activeResize.targets, { threshold: 6 / zoom });
                next = window.LimeLayout.resizeFrame(activeResize.start, activeResize.handle, resizeDelta(activeResize.start, activeResize.handle, resizeSnap.rect), {
                    width: activeResize.size.width, height: activeResize.size.height
                });
                showGuides(activeResize, resizeSnap.guides);
            } else guides.innerHTML = "";
            activeResize.next = next;
            var style = activeResize.blockEl.style;
            style.position = "absolute";
            style.left = next.x + "px"; style.top = next.y + "px";
            style.width = next.width + "px"; style.height = next.height + "px";
            style.transform = next.rotation ? "rotate(" + next.rotation + "deg)" : "";
            place(activeResize.box, localRect(activeResize.blockEl));
            recordGesturePerf("resize", perfStarted);
        });
        function commitFrameItems(items, label) {
            if (items.length === 1) {
                setDesignValue(items[0].source, currentBp, "frame", items[0].next, false);
                return;
            }
            if (cmdStore) {
                var commands = items.map(function (item) {
                    return { type: "setDesign", payload: { id: item.id, breakpoint: currentBp, field: "frame", value: item.next } };
                });
                finishMutation(runCommands(commands, label));
                return;
            }
            items.forEach(function (item) {
                if (!item.source.design) item.source.design = {};
                if (!item.source.design[currentBp]) item.source.design[currentBp] = {};
                item.source.design[currentBp].frame = item.next;
            });
            finishMutation(false);
        }
        function finishResize(e, cancel) {
            if (!activeResize || activeResize.pointerId !== e.pointerId) return;
            var gesture = activeResize;
            activeResize = null;
            guides.innerHTML = "";
            if (cancel) { render(); return; }
            if (gesture.group) {
                var resizedItems = gesture.items.filter(function (item) {
                    return item.start.x !== item.next.x || item.start.y !== item.next.y || item.start.width !== item.next.width || item.start.height !== item.next.height;
                });
                if (!resizedItems.length) { refresh(); return; }
                commitFrameItems(resizedItems, "resize-selection");
                return;
            }
            var a = gesture.start, b = gesture.next;
            if (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation) { refresh(); return; }
            setDesignValue(gesture.source, currentBp, "frame", b, false);
        }
        function finishMove(e, cancel) {
            if (!activeMove || activeMove.pointerId !== e.pointerId) return;
            var gesture = activeMove;
            activeMove = null;
            guides.innerHTML = "";
            if (cancel) { render(); return; }
            var changedItems = gesture.items.filter(function (item) { return item.start.x !== item.next.x || item.start.y !== item.next.y; });
            if (!changedItems.length) { refresh(); return; }
            commitFrameItems(changedItems, "move-selection");
        }
        function finishRotate(e, cancel) {
            if (!activeRotate || activeRotate.pointerId !== e.pointerId) return;
            var gesture = activeRotate;
            activeRotate = null;
            if (cancel) { render(); return; }
            if (gesture.start.rotation === gesture.next.rotation) { refresh(); return; }
            setDesignValue(gesture.source, currentBp, "frame", gesture.next, false);
        }
        function finishGridSpan(e, cancel) {
            if (!activeGridSpan || activeGridSpan.pointerId !== e.pointerId) return;
            var gesture = activeGridSpan;
            activeGridSpan = null;
            if (cancel) { render(); return; }
            var spanChanged = gesture.startSpan !== gesture.nextSpan;
            var rowChanged = gesture.startRowSpan !== gesture.nextRowSpan;
            if (!spanChanged && !rowChanged) { refresh(); return; }
            var changes = [];
            function addChange(field, value) {
                var remove = currentBp === "base" && value <= 1;
                changes.push({ type: "setDesign", payload: { id: gesture.id, breakpoint: currentBp, field: field, value: remove ? null : value, remove: remove } });
            }
            if (spanChanged) addChange("span", gesture.nextSpan);
            if (rowChanged) addChange("rowSpan", gesture.nextRowSpan);
            if (cmdStore) { finishMutation(runCommands(changes, "grid-span-resize")); return; }
            beginCheckpointMutation();
            if (!gesture.source.design) gesture.source.design = {};
            if (!gesture.source.design[currentBp]) gesture.source.design[currentBp] = {};
            changes.forEach(function (change) {
                var field = change.payload.field;
                if (change.payload.remove) delete gesture.source.design[currentBp][field];
                else gesture.source.design[currentBp][field] = change.payload.value;
            });
            finishMutation(false);
        }
        document.addEventListener("pointerup", function (e) { finishRotate(e, false); finishGridSpan(e, false); }, true);
        document.addEventListener("pointercancel", function (e) { finishRotate(e, true); finishGridSpan(e, true); }, true);
        overlay.addEventListener("pointerup", function (e) { finishMove(e, false); finishResize(e, false); finishRotate(e, false); finishGridSpan(e, false); });
        overlay.addEventListener("pointercancel", function (e) { finishMove(e, true); finishResize(e, true); finishRotate(e, true); finishGridSpan(e, true); });
        document.addEventListener("keydown", function (e) {
            if (/^Arrow(Left|Right|Up|Down)$/.test(e.key) && !isTextField(e) && !activeMove && !activeResize) {
                var keyboardState = selection.get();
                var keyboardGroup = freeGroup(keyboardState);
                var keyboardInfos = keyboardGroup ? keyboardGroup.items : (keyboardState.primaryId && freeInfo(keyboardState.primaryId) ? [{ id: keyboardState.primaryId, info: freeInfo(keyboardState.primaryId) }] : []);
                if (keyboardInfos.length) {
                    var step = e.shiftKey ? 10 : 1;
                    var kx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                    var ky = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
                    var keyboardItems = keyboardInfos.map(function (item) {
                        return { id: item.id, source: item.info.source, start: item.info.frame, next: item.info.frame };
                    });
                    if (e.ctrlKey || e.metaKey) {
                        if (keyboardItems.length > 1) {
                            var keyboardResize = window.LimeLayout.resizeFrames(keyboardItems.map(function (item) { return item.start; }), "se", { x: kx, y: ky }, { itemMin: 8 });
                            keyboardItems.forEach(function (item, index) { item.next = keyboardResize.frames[index]; });
                        } else {
                            keyboardItems[0].next = window.LimeLayout.resizeFrame(keyboardItems[0].start, "se", { x: kx, y: ky });
                        }
                        commitFrameItems(keyboardItems, "keyboard-resize");
                    } else {
                        keyboardItems.forEach(function (item) { item.next = window.LimeLayout.moveFrame(item.start, kx, ky); });
                        commitFrameItems(keyboardItems, "keyboard-move");
                    }
                    e.preventDefault();
                    return;
                }
            }
            if (e.key !== "Escape") return;
            if (activeMove) { guides.innerHTML = ""; render(); activeMove = null; }
            if (activeResize) { render(); activeResize = null; }
            if (activeRotate) { render(); activeRotate = null; }
            if (activeGridSpan) { render(); activeGridSpan = null; }
            selection.clear();
        });
        // ===== DnD A: перетаскивание из палитры с дропом в конкретную точку холста =====
        // Клик по плитке по-прежнему добавляет блок в конец (fallback). Drag (>5px) включает
        // призрак у курсора и индикатор места вставки: линия — для потока (stack/grid), рамка —
        // для free-контейнера (блок ляжет по координатам курсора).
        function childrenListEl(blockEl) {
            return blockEl && blockEl.querySelector(":scope > .lime-block__inner > .lime-block__children");
        }
        function layoutModeOf(block) {
            var t = targetBlock(block);
            var d = t && L.resolvedDesign && L.resolvedDesign(t.design, currentBp);
            return (d && d.layout && d.layout.mode) || "stack";
        }
        function freeFrameAt(containerEl, clientX, clientY) {
            var listEl = childrenListEl(containerEl) || containerEl;
            var r = listEl.getBoundingClientRect();
            var zoom = viewport.get().zoom || 1;
            var w = 200, h = 100;
            return {
                x: Math.max(0, Math.round((clientX - r.left) / zoom - w / 2)),
                y: Math.max(0, Math.round((clientY - r.top) / zoom - h / 2)),
                width: w, height: h, rotation: 0
            };
        }
        function indexAmong(listEl, clientY) {
            var kids = listEl.querySelectorAll(":scope > .lime-block");
            for (var i = 0; i < kids.length; i++) {
                var r = kids[i].getBoundingClientRect();
                if (clientY < r.top + r.height / 2) return i;
            }
            return kids.length;
        }
        function isOverCanvas(x, y) {
            var sr = stage.getBoundingClientRect();
            return x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom;
        }
        function paletteDropTarget(clientX, clientY) {
            if (!isOverCanvas(clientX, clientY)) return null;
            var prevPE = overlay.style.pointerEvents;
            overlay.style.pointerEvents = "none";
            var el = document.elementFromPoint(clientX, clientY);
            overlay.style.pointerEvents = prevPE;
            var blockEl = el && el.closest(".lime-block[data-block-id]");
            if (!blockEl) return { parentId: null, index: pageBlocks().length, free: false };
            var found = findBlock(blockEl.getAttribute("data-block-id"));
            if (!found) return { parentId: null, index: pageBlocks().length, free: false };
            var blk = found.block, t = targetBlock(blk);
            // Навели на контейнер → кладём ВНУТРЬ него.
            if (t && L.isContainer(t.type) && t.type !== "component" && !blk.locked) {
                if (layoutModeOf(blk) === "free") {
                    return { parentId: blk.id, index: (t.children && t.children.length) || 0, free: true, frame: freeFrameAt(blockEl, clientX, clientY) };
                }
                var listEl = childrenListEl(blockEl);
                return { parentId: blk.id, index: listEl ? indexAmong(listEl, clientY) : ((t.children && t.children.length) || 0), free: false };
            }
            // Иначе — как сосед в родительском списке.
            var parentBlock = found.parentBlock;
            var parentId = parentBlock ? parentBlock.id : null;
            if (parentBlock && layoutModeOf(parentBlock) === "free") {
                var pEl = ws.querySelector('[data-block-id="' + parentBlock.id + '"]');
                return { parentId: parentId, index: (found.parent && found.parent.length) || 0, free: true, frame: freeFrameAt(pEl, clientX, clientY) };
            }
            var br = blockEl.getBoundingClientRect();
            return { parentId: parentId, index: found.index + (clientY > br.top + br.height / 2 ? 1 : 0), free: false };
        }
        function dropLineRect(t, clientY) {
            var listEl = t.parentId
                ? childrenListEl(ws.querySelector('[data-block-id="' + t.parentId + '"]'))
                : ws.querySelector(".lime-doc-page");
            if (!listEl) { var wr = ws.getBoundingClientRect(); return { left: wr.left, top: clientY, width: wr.width }; }
            var lr = listEl.getBoundingClientRect();
            var kids = listEl.querySelectorAll(":scope > .lime-block");
            var top;
            if (!kids.length) top = lr.top + 4;
            else if (t.index >= kids.length) top = kids[kids.length - 1].getBoundingClientRect().bottom;
            else top = kids[t.index].getBoundingClientRect().top;
            return { left: lr.left, top: top, width: lr.width };
        }
        function dropBlockAt(type, t) {
            var b = L.createBlock(type);
            if (t.free && t.frame) { b.design = {}; b.design[currentBp] = { frame: t.frame }; }
            var commandApplied = runCommand("insertBlock", { block: b, parentId: t.parentId, pageIndex: active, index: t.index });
            if (!commandApplied) {
                if (t.parentId) { var pb = byId(t.parentId); if (pb) { if (!pb.children) pb.children = []; pb.children.splice(t.index, 0, b); } }
                else pageBlocks().splice(t.index, 0, b);
            }
            selectedId = b.id;
            finishInsert(b, t.parentId, t.index, commandApplied);
            selection.replace([b.id]);
        }
        function initPaletteDrag() {
            var tiles = document.querySelectorAll("[data-doc-add]");
            var drag = null, ghost = null, ind = null;
            function cleanup() {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                if (ghost) { ghost.remove(); ghost = null; }
                if (ind) { ind.remove(); ind = null; }
                document.body.classList.remove("is-palette-dragging");
            }
            function begin() {
                drag.started = true;
                ghost = document.createElement("div");
                ghost.className = "lime-palette-ghost";
                ghost.textContent = (drag.tile.textContent || drag.type).trim();
                document.body.appendChild(ghost);
                ind = document.createElement("div");
                ind.className = "lime-drop-ind";
                overlay.appendChild(ind);
                document.body.classList.add("is-palette-dragging");
            }
            function paint(t, x, y) {
                if (!ind) return;
                ind.className = "lime-drop-ind";
                if (!t) { ind.style.display = "none"; return; }
                ind.style.display = "block";
                var sr = stage.getBoundingClientRect();
                if (t.free && t.frame) {
                    var zoom = viewport.get().zoom || 1, w = t.frame.width * zoom, h = t.frame.height * zoom;
                    ind.classList.add("is-frame");
                    ind.style.left = (x - sr.left - w / 2) + "px";
                    ind.style.top = (y - sr.top - h / 2) + "px";
                    ind.style.width = w + "px";
                    ind.style.height = h + "px";
                } else {
                    var pos = dropLineRect(t, y);
                    ind.classList.add("is-line");
                    ind.style.left = (pos.left - sr.left) + "px";
                    ind.style.top = (pos.top - sr.top) + "px";
                    ind.style.width = pos.width + "px";
                    ind.style.height = "";
                }
            }
            function onMove(e) {
                if (!drag) return;
                if (!drag.started) {
                    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 5) return;
                    begin();
                }
                ghost.style.left = e.clientX + "px";
                ghost.style.top = e.clientY + "px";
                drag.target = paletteDropTarget(e.clientX, e.clientY);
                paint(drag.target, e.clientX, e.clientY);
                e.preventDefault();
            }
            function onUp(e) {
                var d = drag; drag = null;
                cleanup();
                if (!d || !d.started) return; // обычный клик — обработает существующий click-хендлер
                paletteJustDragged = true; // гасим парный click по плитке
                if (d.target) dropBlockAt(d.type, d.target);
            }
            for (var i = 0; i < tiles.length; i++) {
                tiles[i].addEventListener("pointerdown", function (e) {
                    if (e.button !== 0) return;
                    drag = { type: this.getAttribute("data-doc-add"), tile: this, x0: e.clientX, y0: e.clientY, started: false, target: null };
                    window.addEventListener("pointermove", onMove, true);
                    window.addEventListener("pointerup", onUp, true);
                    window.addEventListener("pointercancel", onUp, true);
                });
            }
        }
        initPaletteDrag();

        window.__LIME_SELECTION__ = selection;
        refresh();
    }

    // ===== EDITOR V2 VIEWPORT (Stage 2, feature flag ?canvas=1) =====
    function initV2Viewport() {
        if (!canvasOn || !window.LimeViewport) return;
        var stage = document.getElementById("lime-canvas-viewport");
        var canvas = ws.closest(".lime-editor__canvas");
        if (!stage || !canvas) return;
        canvas.classList.add("is-v2-viewport");
        var controls = document.querySelector("[data-canvas-controls]");
        if (controls) controls.hidden = false;

        var viewport = window.LimeViewport.createViewport({ x: 48, y: 72, zoom: 0.9, minZoom: 0.1, maxZoom: 4 });
        var label = document.querySelector("[data-canvas-zoom-label]");
        function applyViewport(s) {
            ws.style.transform = "translate(" + s.x + "px," + s.y + "px) scale(" + s.zoom + ")";
            if (label) {
                label.textContent = Math.round(s.zoom * 100) + "%";
                label.title = "Сбросить масштаб до 100%";
            }
        }
        viewport.subscribe(applyViewport);
        applyViewport(viewport.get());

        function localPoint(e) {
            var r = stage.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        stage.addEventListener("wheel", function (e) {
            e.preventDefault();
            var factor = Math.exp(-e.deltaY * 0.0015);
            viewport.zoomBy(localPoint(e), factor);
        }, { passive: false });

        var spaceDown = false;
        var pan = null;
        document.addEventListener("keydown", function (e) {
            if (e.code !== "Space" || isTextField(e)) return;
            spaceDown = true;
            stage.classList.add("is-panning");
            e.preventDefault();
        });
        document.addEventListener("keyup", function (e) {
            if (e.code !== "Space") return;
            spaceDown = false;
            if (!pan) stage.classList.remove("is-panning");
        });
        stage.addEventListener("pointerdown", function (e) {
            if (!(spaceDown || e.button === 1)) return;
            e.preventDefault(); e.stopPropagation();
            pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
            stage.classList.add("is-panning");
            try { stage.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        }, true);
        stage.addEventListener("pointermove", function (e) {
            if (!pan || pan.id !== e.pointerId) return;
            var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
            pan.x = e.clientX; pan.y = e.clientY;
            viewport.panBy(dx, dy);
        });
        function endPan(e) {
            if (!pan || pan.id !== e.pointerId) return;
            try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            pan = null;
            if (!spaceDown) stage.classList.remove("is-panning");
        }
        stage.addEventListener("pointerup", endPan);
        stage.addEventListener("pointercancel", endPan);

        function centerPoint() { return { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }; }
        function fit() {
            viewport.fitBounds(
                { x: 0, y: 0, width: Math.max(1, ws.offsetWidth), height: Math.max(1, ws.scrollHeight) },
                { width: stage.clientWidth, height: stage.clientHeight },
                48
            );
        }
        var zoomIn = document.querySelector("[data-canvas-zoom-in]");
        var zoomOut = document.querySelector("[data-canvas-zoom-out]");
        var fitBtn = document.querySelector("[data-canvas-fit]");
        if (zoomIn) zoomIn.addEventListener("click", function () { viewport.zoomBy(centerPoint(), 1.2); });
        if (zoomOut) zoomOut.addEventListener("click", function () { viewport.zoomBy(centerPoint(), 1 / 1.2); });
        if (label) label.addEventListener("click", function () { viewport.zoomAt(centerPoint(), 1); });
        if (fitBtn) fitBtn.addEventListener("click", fit);
        initV2Selection(stage, viewport, function () { return !!(spaceDown || pan); });
        window.__LIME_VIEWPORT__ = viewport; // временный debug/test seam, не часть document JSON
        setTimeout(fit, 0);
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
