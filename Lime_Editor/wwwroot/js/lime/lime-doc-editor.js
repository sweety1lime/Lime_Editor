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
    var EditorAddBlock = window.LimeEditorAddBlock || {};
    var EditorPresets = window.LimeEditorPresets || {};
    var EditorSidebar = window.LimeEditorSidebar || {};
    var EditorPages = window.LimeEditorPages || {};
    var EditorBreakpoints = window.LimeEditorBreakpoints || {};
    var EditorPersistence = window.LimeEditorPersistence || {};
    var EditorOnboarding = window.LimeEditorOnboarding || {};
    var EditorTopbar = window.LimeEditorTopbar || {};
    var EditorIntro = window.LimeEditorIntro || {};
    var EditorCommandRegistry = window.LimeEditorCommandRegistry || {};
    var EditorPerf = window.LimeEditorPerf || {};
    var EditorInlineEdit = window.LimeEditorInlineEdit || {};
    var EditorStyleEngine = window.LimeEditorStyleEngine || {};
    var EditorContentBinding = window.LimeEditorContentBinding || {};
    var EditorDnd = window.LimeEditorDnd || {};
    var EditorRender = window.LimeEditorRender || {};
    var EditorInspector = window.LimeEditorInspector || {};
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
    if (!EditorAddBlock.create) throw new Error("LimeEditorAddBlock is required before lime-doc-editor.js");
    if (!EditorPresets.create) throw new Error("LimeEditorPresets is required before lime-doc-editor.js");
    if (!EditorSidebar.create) throw new Error("LimeEditorSidebar is required before lime-doc-editor.js");
    if (!EditorPages.create) throw new Error("LimeEditorPages is required before lime-doc-editor.js");
    if (!EditorBreakpoints.create) throw new Error("LimeEditorBreakpoints is required before lime-doc-editor.js");
    if (!EditorPersistence.create) throw new Error("LimeEditorPersistence is required before lime-doc-editor.js");
    if (!EditorOnboarding.create) throw new Error("LimeEditorOnboarding is required before lime-doc-editor.js");
    if (!EditorTopbar.init) throw new Error("LimeEditorTopbar is required before lime-doc-editor.js");
    if (!EditorIntro.create) throw new Error("LimeEditorIntro is required before lime-doc-editor.js");
    if (!EditorCommandRegistry.create) throw new Error("LimeEditorCommandRegistry is required before lime-doc-editor.js");
    if (!EditorPerf.create) throw new Error("LimeEditorPerf is required before lime-doc-editor.js");
    if (!EditorInlineEdit.create) throw new Error("LimeEditorInlineEdit is required before lime-doc-editor.js");
    if (!EditorStyleEngine.create) throw new Error("LimeEditorStyleEngine is required before lime-doc-editor.js");
    if (!EditorContentBinding.create) throw new Error("LimeEditorContentBinding is required before lime-doc-editor.js");
    if (!EditorDnd.create) throw new Error("LimeEditorDnd is required before lime-doc-editor.js");
    if (!EditorRender.create) throw new Error("LimeEditorRender is required before lime-doc-editor.js");
    if (!EditorInspector.create) throw new Error("LimeEditorInspector is required before lime-doc-editor.js");
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
    var paletteJustDragged = false; // подавляет click палитры после drag-and-drop из палитры (DnD A)

    // Версия документа для optimistic concurrency (этап 0.4): Site.UpdatedAt.Ticks.
    // Шлём с каждым сохранением; 409 = документ сохранили из другого окна.
    var docVersion = window.__LIME_DOC_VERSION__ || 0;

    function pageBlocks() { return doc.pages[active].blocks; }

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

    // ===== PRESET SECTIONS / STARTUP TEMPLATES — module lime-editor-presets.js =====
    var presetTools = EditorPresets.create({
        document: document,
        window: window,
        L: L,
        ws: ws,
        getDoc: function () { return doc; },
        pageBlocks: pageBlocks,
        getSelectedId: function () { return selectedId; },
        setSelectedId: function (value) { selectedId = value; },
        findBlock: findBlock,
        targetBlock: targetBlock,
        rid: rid,
        render: render,
        markDirty: markDirty
    });
    var blockFromSpec = presetTools.blockFromSpec;
    // Старт с шаблона (Фаза 3.2): ?template=key на пустом новом документе.
    // Применяется до cmdStore/cmdPrev, чтобы история стартовала уже от шаблонного документа.
    if (window.__LIME_TEMPLATE__ && pageBlocks().length === 0) {
        presetTools.applyTemplateByKey(window.__LIME_TEMPLATE__);
    }

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

    // ===== Stage 7 perf-инструмент — module lime-editor-perf.js =====
    var perfTools = EditorPerf.create({
        window: window,
        location: location,
        getDoc: function () { return doc; },
        getActive: function () { return active; },
        setSelectedId: function (value) { selectedId = value; },
        pageBlocks: pageBlocks,
        rid: rid,
        render: render,
        patchBlockDom: patchBlockDom,
        resetCommandStore: function () {
            if (cmdStore && window.LimeCommands) {
                cmdStore = window.LimeCommands.createStore(doc);
                cmdPrev = JSON.stringify(doc);
            }
        }
    });
    function perfNow() { return perfTools.now(); }
    function perfRec(kind, t0) { perfTools.record(kind, t0); }
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
        clearInlineEditPending();
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
        clearInlineEditPending();
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

    // ===== RENDER / STAGE 7 PATCH PIPELINE — module lime-editor-render.js =====
    // Обёртки — function declarations (hoisted): их получают по значению модули, создающиеся
    // раньше и позже (perf/add-block/block-actions/dnd/ai-generate). editorCollectionData/
    // templateSampleRecord/initLayerDrag — thunk'и: их var-алиасы присваиваются НИЖЕ этой точки.
    var renderPipeline = EditorRender.create({
        window: window,
        document: document,
        ws: ws,
        L: L,
        escapeText: escapeText,
        getDoc: function () { return doc; },
        getActive: function () { return active; },
        pageBlocks: pageBlocks,
        byId: byId,
        findBlock: findBlock,
        getSelectedId: function () { return selectedId; },
        getCurrentBp: function () { return currentBp; },
        getCurrentState: function () { return currentState; },
        getCurrentClass: function () { return currentClass; },
        readStyles: readStyles,
        effectiveClassStyles: effectiveClassStyles,
        effective: effective,
        declsToCss: declsToCss,
        findClassDef: findClassDef,
        isCanvasOn: function () { return canvasOn; },
        refreshInspector: refreshInspector,
        refreshLayers: refreshLayers,
        initDnD: initDnD,
        initLayerDrag: function () { initLayerDrag(); },
        refreshV2SelectionOverlay: function () { refreshV2SelectionOverlay(); },
        editorCollectionData: function () { return editorCollectionData(); },
        templateSampleRecord: function () { return templateSampleRecord(); },
        scheduleAutosave: scheduleAutosave,
        markDirty: markDirty,
        perfNow: perfNow,
        perfRec: perfRec
    });
    function render() { renderPipeline.render(); }
    function scheduleLayersRefresh() { renderPipeline.scheduleLayersRefresh(); }
    function patchBlockDom(id, opts) { return renderPipeline.patchBlockDom(id, opts); }
    function insertBlockDom(block, parentId, index, opts) { return renderPipeline.insertBlockDom(block, parentId, index, opts); }
    function removeBlockDom(id) { return renderPipeline.removeBlockDom(id); }
    function removeBlocksDom(ids) { return renderPipeline.removeBlocksDom(ids); }
    function finishInsert(block, parentId, index, commandApplied) { renderPipeline.finishInsert(block, parentId, index, commandApplied); }
    function finishRemove(id, commandApplied) { renderPipeline.finishRemove(id, commandApplied); }
    function finishMove(id, parentId, index, commandApplied) { renderPipeline.finishMove(id, parentId, index, commandApplied); }
    function applyPreviewStyles() { renderPipeline.applyPreviewStyles(); }
    function ensureDocFonts() { renderPipeline.ensureDocFonts(); }

    // ===== DRAG-AND-DROP — module lime-editor-dnd.js =====
    // refreshV2SelectionOverlay — thunk: main переприсваивает её при инициализации canvas ниже.
    var dnd = EditorDnd.create({
        window: window,
        ws: ws,
        pageBlocks: pageBlocks,
        byId: byId,
        targetBlock: targetBlock,
        runCommand: runCommand,
        finishMutation: finishMutation,
        getActive: function () { return active; },
        setSelectedId: function (value) { selectedId = value; },
        render: render,
        applyPreviewStyles: applyPreviewStyles,
        refreshInspector: refreshInspector,
        isCanvasOn: function () { return canvasOn; },
        refreshV2SelectionOverlay: function () { refreshV2SelectionOverlay(); },
        scheduleLayersRefresh: scheduleLayersRefresh,
        scheduleAutosave: scheduleAutosave,
        markDirty: markDirty,
        perfNow: perfNow,
        perfRec: perfRec
    });
    function initDnD() { dnd.initDnD(); }

    // ===== INLINE CONTENT EDIT (без ре-рендера) — module lime-editor-inline-edit.js =====
    var inlineEdit = EditorInlineEdit.create({
        window: window,
        ws: ws,
        getDoc: function () { return doc; },
        setDoc: function (value) { doc = value; },
        getCmdStore: function () { return cmdStore; },
        setCmdPrev: function (value) { cmdPrev = value; },
        byId: byId,
        targetBlock: targetBlock,
        setByPath: setByPath,
        setComponentContentOverrideLocal: setComponentContentOverrideLocal,
        beginCheckpointMutation: beginCheckpointMutation,
        commitStyleEdit: commitStyleEdit,
        commitBlockEdit: commitBlockEdit,
        updateHistButtons: updateHistButtons,
        scheduleAutosave: scheduleAutosave,
        markDirty: markDirty
    });
    function commitInlineEdit() { inlineEdit.commitInlineEdit(); }
    function clearInlineEditPending() { inlineEdit.clearPending(); }

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

    // ===== ADD BLOCK — module lime-editor-add-block.js =====
    EditorAddBlock.create({
        document: document,
        window: window,
        L: L,
        ws: ws,
        getPaletteJustDragged: function () { return paletteJustDragged; },
        setPaletteJustDragged: function (value) { paletteJustDragged = value; },
        getSelectedId: function () { return selectedId; },
        setSelectedId: function (value) { selectedId = value; },
        getActive: function () { return active; },
        pageBlocks: pageBlocks,
        findBlock: findBlock,
        targetBlock: targetBlock,
        runCommand: runCommand,
        finishInsert: finishInsert,
        aiOpen: aiOpen
    });

    EditorSidebar.create({ document: document, window: window });

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
    var layerHelpers = EditorLayers.create({
        document: document,
        window: window,
        escapeText: escapeText,
        byId: byId,
        getComponents: function () { return doc.components || {}; },
        getCurrentBp: function () { return currentBp; },
        getCmdStore: function () { return cmdStore; },
        getPageBlocks: pageBlocks,
        getSelectedId: function () { return selectedId; },
        isCanvasOn: function () { return canvasOn; },
        isContainer: function (type) { return L.isContainer(type); },
        markDirty: markDirty,
        render: render,
        resolvedBlockDesign: resolvedBlockDesign,
        runCommand: runCommand,
        scheduleAutosave: scheduleAutosave,
        selectById: selectById,
        targetBlock: targetBlock
    });
    layerHelpers.bind(document.getElementById("lime-doc-layers"));
    var blockLabel = layerHelpers.blockLabel;
    function refreshLayers() { layerHelpers.refreshLayers(); }

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
    // ===== BREAKPOINTS — module lime-editor-breakpoints.js =====
    var breakpointTools = EditorBreakpoints.create({
        document: document,
        window: window,
        ws: ws,
        setCurrentBp: function (value) { currentBp = value; },
        applyPreviewStyles: applyPreviewStyles,
        refreshInspector: refreshInspector
    });
    function switchBreakpoint(bp) { breakpointTools.switchBreakpoint(bp); }

    // ===== INSPECTOR (breakpoint-aware) =====
    var PADS = { "0": "NONE", "8px": "XS", "16px": "SM", "24px": "MD", "48px": "LG", "80px": "XL" };

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

    // ===== INSPECTOR VIEW — module lime-editor-inspector.js =====
    // curStyle/refreshInspector — hoisted-обёртки: их получают по значению модули, создающиеся
    // раньше (shadow/section-bg/render). binding/extras/bg/pickers — thunk'и (алиасы ниже).
    var inspectorView = EditorInspector.create({
        window: window,
        inspectorEl: inspectorEl,
        L: L,
        escapeText: escapeText,
        ico: ico,
        getDoc: function () { return doc; },
        getSelectedId: function () { return selectedId; },
        getCurrentClass: function () { return currentClass; },
        getCurrentState: function () { return currentState; },
        getCurrentBp: function () { return currentBp; },
        getCurrentInspectorTab: function () { return currentInspectorTab; },
        byId: byId,
        findBlock: findBlock,
        targetBlock: targetBlock,
        readStyles: readStyles,
        findClassDef: findClassDef,
        effectiveClassStyles: effectiveClassStyles,
        componentRecord: componentRecord,
        syncInspectorShell: syncInspectorShell,
        v2SelectionIds: v2SelectionIds,
        multiStyleModel: multiStyleModel,
        styleRegistry: STYLE_REGISTRY,
        hasOwn: hasOwn,
        registryProps: registryProps,
        renderControl: renderControl,
        section: sec,
        classEditBanner: classEditBanner,
        classesSection: classesSection,
        componentPropsSection: componentPropsSection,
        componentVariantControls: componentVariantControls,
        v2LayoutInspector: v2LayoutInspector,
        bindingSection: function (t) { return bindingSection(t); },
        contentExtras: function (t) { return contentExtras(t); },
        bgInspector: function (b, s) { return bgInspector(b, s); },
        fxInspector: fxInspector,
        animInspector: animInspector,
        motionInspector: motionInspector,
        sceneInspector: sceneInspector,
        layersInspector: layersInspector,
        populateCollectionPickers: function (t) { populateCollectionPickers(t); }
    });
    function refreshInspector() { inspectorView.refreshInspector(); }
    function curStyle(b) { return inspectorView.curStyle(b); }

    // Наполняет select коллекций из /Data/ApiList (только для сохранённого сайта). Общий кэш
    // читают также render()/INIT — потому остаётся здесь и проброшен в модуль get/set-инъекцией.
    var collectionsCache = null;
    var contentBinding = EditorContentBinding.create({
        document: document,
        inspectorEl: inspectorEl,
        siteId: siteId,
        getDoc: function () { return doc; },
        getActive: function () { return active; },
        getCollections: function () { return collectionsCache; },
        setCollections: function (list) { collectionsCache = list; },
        escapeText: escapeText,
        section: sec,
        byId: byId,
        getSelectedId: function () { return selectedId; },
        setContentValue: setContentValue
    });
    var populateCollectionPickers = contentBinding.populateCollectionPickers;
    var editorCollectionData = contentBinding.editorCollectionData;
    var templateSampleRecord = contentBinding.templateSampleRecord;
    var bindingSection = contentBinding.bindingSection;
    var contentExtras = contentBinding.contentExtras;
    var setContentFlag = contentBinding.setContentFlag;

    // ===== STYLE/BLOCK GESTURE ENGINE — module lime-editor-style-engine.js =====
    // Обёртки ниже — function declarations (hoisted): их получают ПО ЗНАЧЕНИЮ модули,
    // создающиеся выше этой точки (inline-edit, effects, shadow), и обработчики инспектора.
    var styleEngine = EditorStyleEngine.create({
        window: window,
        getCmdStore: function () { return cmdStore; },
        setDoc: function (value) { doc = value; },
        setCmdPrev: function (value) { cmdPrev = value; },
        getSelectedId: function () { return selectedId; },
        getCurrentClass: function () { return currentClass; },
        getCurrentState: function () { return currentState; },
        getCurrentBp: function () { return currentBp; },
        byId: byId,
        targetBlock: targetBlock,
        readStyles: readStyles,
        findClassDef: findClassDef,
        componentRecord: componentRecord,
        setComponentStyleOverrideLocal: setComponentStyleOverrideLocal,
        beginCheckpointMutation: beginCheckpointMutation,
        updateHistButtons: updateHistButtons,
        scheduleAutosave: scheduleAutosave,
        markDirty: markDirty,
        refreshInspector: refreshInspector,
        applyPreviewStyles: applyPreviewStyles,
        commitInlineEdit: commitInlineEdit
    });
    function commitStyleEdit() { styleEngine.commitStyleEdit(); }
    function commitBlockEdit() { styleEngine.commitBlockEdit(); }
    function v2SelectionIds() { return styleEngine.v2SelectionIds(); }
    function multiStyleModel(ids, bucketName) { return styleEngine.multiStyleModel(ids, bucketName); }
    function setStyle(prop, val) { styleEngine.setStyle(prop, val); }
    function resetStyleProps(props) { styleEngine.resetStyleProps(props); }
    function commandBlockGesture(source, prop, value, remove, gestureKey) { return styleEngine.commandBlockGesture(source, prop, value, remove, gestureKey); }
    function commandContentGesture(source, field, value, remove, gestureKey) { return styleEngine.commandContentGesture(source, field, value, remove, gestureKey); }
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

    // ===== COMMAND PALETTE (Ctrl+K): registry/wiring lives in lime-editor-command-registry.js =====
    EditorCommandRegistry.create({
        document: document,
        window: window,
        commandPalette: EditorCommandPalette,
        saveBtn: saveBtn,
        themeModal: themeModal,
        codeModal: codeModal,
        escapeText: escapeText,
        getSelectedId: function () { return selectedId; },
        byId: byId,
        v2SelectionIds: v2SelectionIds,
        aiOpen: aiOpen,
        aiSuggest: aiSuggest,
        undo: undo,
        redo: redo,
        runBlockOp: runBlockOp,
        groupSelection: groupSelection,
        ungroupBlock: ungroupBlock,
        makeComponent: makeComponent
    });

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
