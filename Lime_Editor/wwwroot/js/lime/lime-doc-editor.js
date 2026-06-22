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

    var ws = document.getElementById("lime-doc-workspace");
    if (!ws) return;
    var inspectorEl = document.getElementById("lime-doc-inspector");
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

    // Версия документа для optimistic concurrency (этап 0.4): Site.UpdatedAt.Ticks.
    // Шлём с каждым сохранением; 409 = документ сохранили из другого окна.
    var docVersion = window.__LIME_DOC_VERSION__ || 0;
    var conflicted = false;

    function pageBlocks() { return doc.pages[active].blocks; }

    // Старт с шаблона (Фаза 3.2): ?template=key на пустом новом документе.
    // applyTemplateByKey/blockFromSpec — function declarations (подняты), doc/active готовы.
    if (window.__LIME_TEMPLATE__ && pageBlocks().length === 0) {
        applyTemplateByKey(window.__LIME_TEMPLATE__);
    }
    function totalBlocks() {
        return doc.pages.reduce(function (n, p) { return n + p.blocks.length; }, 0);
    }
    // Цель правки: для компонента-инстанса — общий блок из doc.components (правка → все копии).
    function targetBlock(b) {
        if (b && b.type === "component" && doc.components[b.ref]) return doc.components[b.ref].block;
        return b;
    }
    var INSTANCE_DESIGN_FIELDS = { frame: 1, size: 1, constraints: 1, zIndex: 1 };
    function designTarget(b, field) {
        if (b && b.type === "component" && INSTANCE_DESIGN_FIELDS[field]) return b;
        return targetBlock(b);
    }
    function rawBlockDesign(b) {
        if (b && b.type === "component" && doc.components[b.ref]) {
            var definition = doc.components[b.ref].block || {};
            return L.mergeInstanceDesign ? L.mergeInstanceDesign(definition.design, b.design) : (b.design || definition.design || {});
        }
        return b && b.design || {};
    }
    function resolvedBlockDesign(b, breakpoint) { return L.resolvedDesign(rawBlockDesign(b), breakpoint); }
    function escapeText(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function rid(p) { return (p || "b") + Math.random().toString(36).slice(2, 9); }

    function csrfToken() {
        var m = document.querySelector('meta[name="X-CSRF-TOKEN"]');
        return m ? m.content : "";
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
    function setByPath(obj, path, val) {
        var parts = path.split(".");
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            var k = parts[i];
            if (cur[k] == null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
            cur = cur[k];
        }
        cur[parts[parts.length - 1]] = val;
    }
    function deleteByPath(obj, path) {
        var parts = path.split(".");
        var nodes = [obj];
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            if (cur == null || typeof cur !== "object" || !(parts[i] in cur)) return false;
            cur = cur[parts[i]];
            nodes.push(cur);
        }
        if (cur == null || !Object.prototype.hasOwnProperty.call(cur, parts[parts.length - 1])) return false;
        delete cur[parts[parts.length - 1]];
        for (var j = nodes.length - 1; j > 0; j--) {
            if (Object.keys(nodes[j]).length) break;
            delete nodes[j - 1][parts[j - 1]];
        }
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

    // ===== HISTORY (этап 0.4: undo/redo на снапшотах JSON-документа) =====
    var HIST_MAX = 50;
    var hist = [];
    var histPos = -1;

    // Editor V2 (этап D2): за флагом ?cmd=1 (или window.__LIME_CMD__) бэкендом истории становится
    // lime-commands. Переведённые мутации пишут точечные op-записи, остальные продолжают писать
    // state-чекпоинты в тот же стек. Флаг OFF по умолчанию → старое поведение не меняется.
    var cmdOn = (/[?&]cmd=1\b/.test(location.search) || window.__LIME_CMD__) && !!window.LimeCommands;
    var canvasOn = /[?&]canvas=1\b/.test(location.search);
    var cmdStore = cmdOn ? window.LimeCommands.createStore(doc) : null;
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
    // Частый шов для media/content-инспектора. Component definitions пока намеренно идут
    // snapshot fallback: command engine ищет только реальные блоки в pages.
    function setContentValue(source, field, value, remove) {
        var target = targetBlock(source);
        if (!target) return false;
        if (cmdStore && target === source) {
            var changed = runCommand("setContent", {
                id: source.id, field: field, value: value, remove: !!remove
            });
            render();
            if (changed) scheduleAutosave();
            return true;
        }
        beginCheckpointMutation();
        if (!target.content) target.content = {};
        if (remove) deleteByPath(target.content, field);
        else setByPath(target.content, field, value);
        render(); markDirty();
        return true;
    }
    function setBlockValue(source, prop, value, remove) {
        var target = targetBlock(source);
        if (!target) return false;
        if (cmdStore && target === source) {
            var changed = runCommand("setBlockProp", {
                id: source.id, prop: prop, value: value, remove: !!remove
            });
            render();
            if (changed) scheduleAutosave();
            return true;
        }
        beginCheckpointMutation();
        if (remove) delete target[prop]; else target[prop] = value;
        render(); markDirty();
        return true;
    }
    function setDesignValue(source, breakpoint, field, value, remove) {
        var target = designTarget(source, field);
        if (!target) return false;
        if (cmdStore && target === source) {
            var changed = runCommand("setDesign", {
                id: source.id, breakpoint: breakpoint, field: field, value: value, remove: !!remove
            });
            render();
            if (changed) scheduleAutosave();
            return true;
        }
        beginCheckpointMutation();
        if (!target.design) target.design = {};
        if (!target.design[breakpoint]) target.design[breakpoint] = {};
        if (remove) delete target.design[breakpoint][field]; else target.design[breakpoint][field] = value;
        render(); markDirty();
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
        if (pageBlocks().length === 0) {
            ws.innerHTML = '<div class="lime-workspace__placeholder">' +
                '<div class="lime-workspace__placeholder-icon">✨</div>' +
                '<div>Страница «' + escapeText(doc.pages[active].title) + '» пуста. Выбери блок слева.</div></div>';
        } else {
            // Рендерим только активную страницу (тема и компоненты — общие на сайт).
            // data — превью схемы коллекций для блока collectionList (реальные записи — на публикации).
            ws.innerHTML = L.render({ theme: doc.theme, components: doc.components, blocks: pageBlocks() }, { editable: true, data: editorCollectionData() }).body;
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
        finishMutation(commandApplied);
    }
    function initDnD() {
        if (!window.Sortable) return;
        for (var i = 0; i < sortables.length; i++) {
            try { sortables[i].destroy(); } catch (e) { /* DOM уже выброшен */ }
        }
        sortables = [];
        var lists = [];
        var page = ws.querySelector(".lime-doc-page");
        if (page) lists.push(page);
        var kids = ws.querySelectorAll(".lime-block__children");
        for (var k = 0; k < kids.length; k++) lists.push(kids[k]);
        for (var j = 0; j < lists.length; j++) {
            sortables.push(new window.Sortable(lists[j], {
                group: "lime-doc",
                handle: ".lime-block-grip",
                draggable: ".lime-block",
                animation: 160,
                fallbackOnBody: true,
                invertSwap: true,
                ghostClass: "sortable-ghost",
                onEnd: onDragEnd
            }));
        }
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
        for (var i = 0; i < blocks.length; i++) {
            var el = blocks[i];
            var id = el.getAttribute("data-block-id");
            var b = byId(id);
            if (!b) continue;
            var st = targetBlock(b).styles;
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
        if (cmdStore && directBlock) {
            commitStyleEdit();
            commitBlockEdit();
            var key = b.id + ":" + field;
            if (editTxn && editTxnKey !== key) commitInlineEdit();
            if (!editTxn) {
                cmdStore.begin("inline-content");
                editTxn = true;
                editTxnKey = key;
            }
            if (cmdStore.dispatch("setContent", { id: b.id, field: field, value: value })) {
                doc = cmdStore.getDoc();
                clearTimeout(editDebounce);
                editDebounce = setTimeout(commitInlineEdit, 600);
                return;
            }
            cmdStore.cancel();
            editTxn = false;
            editTxnKey = null;
        } else beginCheckpointMutation();
        setByPath(targetBlock(b).content, field, value);
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
    }

    // Контекстное меню блока (ПКМ, этап 0.4)
    ws.addEventListener("contextmenu", function (e) {
        var sec = e.target.closest(".lime-block");
        if (!sec) return;
        e.preventDefault();
        showCtxMenu(sec.getAttribute("data-block-id"), e.clientX, e.clientY);
    });

    // ===== MEDIA (этап 0.5: image / gallery / video) =====
    var pickCtx = null; // { blockId, field } — куда писать выбранный url

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
        pickCtx = { blockId: blockId, field: field, target: target || "content" };
        var modal = document.getElementById("lime-media-modal");
        if (!modal) return;
        modal.classList.add("is-open");
        resetMediaTabs();
        loadMediaList();
        wireMediaUpload();
    }
    function closeMediaPicker() {
        var modal = document.getElementById("lime-media-modal");
        if (modal) modal.classList.remove("is-open");
        pickCtx = null;
    }
    function loadMediaList() {
        var grid = document.getElementById("lime-media-grid");
        if (!grid) return;
        grid.innerHTML = '<div class="lime-text-muted">Загрузка...</div>';
        fetch("/Media/ApiList", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (items) {
                if (!items || items.length === 0) {
                    grid.innerHTML = '<div class="lime-picker-empty">Пусто. Загрузи изображения в <a href="/Media/Index" target="_blank" class="lime-text-accent">Медиа</a>.</div>';
                    return;
                }
                grid.innerHTML = items.map(function (it) {
                    return '<div class="lime-picker-item" data-url="' + it.url + '" title="' + (it.name || "") + '">' +
                        '<img src="' + it.url + '" alt="' + (it.name || "") + '" loading="lazy">' +
                        '</div>';
                }).join("");
            })
            .catch(function () {
                grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>';
            });
    }
    // ----- Сток-вкладка медиа-пикера (Фаза 1.2) -----
    function resetMediaTabs() {
        var tabs = document.querySelectorAll("[data-media-tab]");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle("is-active", tabs[i].dataset.mediaTab === "mine");
        }
        var sf = document.getElementById("lime-stock-search");
        if (sf) sf.style.display = "none";
    }
    function loadStockList(q) {
        var grid = document.getElementById("lime-media-grid");
        if (!grid) return;
        if (!q) { grid.innerHTML = '<div class="lime-text-muted">Введи запрос и нажми «Найти».</div>'; return; }
        grid.innerHTML = '<div class="lime-text-muted">Ищу «' + q + '»…</div>';
        fetch("/Media/Stock?q=" + encodeURIComponent(q), { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.configured) {
                    grid.innerHTML = '<div class="lime-picker-empty">Сток не настроен на сервере (нет ключа Pexels). Можно загрузить свои в <a href="/Media/Index" target="_blank" class="lime-text-accent">Медиа</a>.</div>';
                    return;
                }
                if (!res.items || !res.items.length) {
                    grid.innerHTML = '<div class="lime-picker-empty">Ничего не найдено.</div>';
                    return;
                }
                grid.innerHTML = res.items.map(function (it) {
                    return '<div class="lime-picker-item" data-url="' + it.url + '" title="' + (it.name || "") + '">' +
                        '<img src="' + it.thumb + '" alt="' + (it.name || "") + '" loading="lazy"></div>';
                }).join("");
            })
            .catch(function () { grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>'; });
    }
    document.addEventListener("click", function (e) {
        var tb = e.target.closest("[data-media-tab]");
        if (!tb) return;
        var tabs = document.querySelectorAll("[data-media-tab]");
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("is-active", tabs[i] === tb);
        var sf = document.getElementById("lime-stock-search");
        if (tb.dataset.mediaTab === "stock") {
            if (sf) sf.style.display = "block";
            var qi = document.getElementById("lime-stock-q");
            loadStockList(qi ? qi.value.trim() : "");
            if (qi) qi.focus();
        } else {
            if (sf) sf.style.display = "none";
            loadMediaList();
        }
    });
    var stockForm = document.getElementById("lime-stock-search");
    if (stockForm) stockForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var qi = document.getElementById("lime-stock-q");
        loadStockList(qi ? qi.value.trim() : "");
    });

    var mediaUploadWired = false;
    function wireMediaUpload() {
        if (mediaUploadWired) return;
        var input = document.getElementById("lime-media-upload");
        var status = document.getElementById("lime-media-status");
        if (!input) return;
        mediaUploadWired = true;
        input.addEventListener("change", function () {
            if (!input.files || input.files.length === 0) return;
            var form = new FormData();
            form.append("file", input.files[0]);
            status.style.display = "block";
            status.textContent = "Загружаю " + input.files[0].name + "...";
            status.className = "lime-text-muted";
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/Media/Upload");
            xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
            xhr.onload = function () {
                if (xhr.status === 200 || xhr.status === 302) {
                    status.textContent = "✓ Загружено. Обновляю список...";
                    status.className = "lime-text-success";
                    loadMediaList();
                    setTimeout(function () { status.style.display = "none"; }, 1500);
                } else {
                    status.textContent = "✗ Ошибка загрузки: " + xhr.status;
                    status.className = "lime-text-danger";
                }
                input.value = "";
            };
            xhr.onerror = function () {
                status.textContent = "✗ Сетевая ошибка";
                status.className = "lime-text-danger";
                input.value = "";
            };
            xhr.send(form);
        });
    }
    document.addEventListener("click", function (e) {
        var item = e.target.closest("#lime-media-grid .lime-picker-item");
        if (item) {
            if (pickCtx && item.dataset.url) {
                var b = byId(pickCtx.blockId);
                if (b) {
                    var tb = targetBlock(b);
                    if (pickCtx.target === "bgimage") {
                        // Фон-картинка секции — это стиль-проп backgroundImage (текущий брейкпоинт).
                        if (cmdStore && tb === b) {
                            var bgChanged = runCommands([
                                { type: "setStyle", payload: { id: b.id, breakpoint: currentBp, prop: "backgroundImage", value: "url('" + item.dataset.url + "')" } },
                                { type: "setContent", payload: { id: b.id, field: "bgMode", value: "image" } }
                            ], "pick-background");
                            render(); if (bgChanged) scheduleAutosave();
                        } else {
                            if (!tb.styles) tb.styles = {};
                            if (!tb.styles[currentBp]) tb.styles[currentBp] = {};
                            tb.styles[currentBp].backgroundImage = "url('" + item.dataset.url + "')";
                            if (!tb.content) tb.content = {};
                            tb.content.bgMode = "image";
                            render(); markDirty();
                        }
                    } else if (pickCtx.target === "blockpath") {
                        // Путь относительно самого блока (напр. layers.0.src — картинка декор-слоя).
                        setByPath(tb, pickCtx.field, item.dataset.url);
                        render(); markDirty();
                    } else {
                        setContentValue(b, pickCtx.field, item.dataset.url, false);
                    }
                }
            }
            closeMediaPicker();
            return;
        }
        if (e.target.closest("[data-lime-modal-close]")) closeMediaPicker();
    });
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
            finishMutation(commandApplied);
            // V2 (canvas): держим selection-store в синхроне с legacy. Иначе add-block двигает
            // только legacy selectedId, V2-стор застревает на прежнем блоке, и повторный выбор
            // того же узла через стор становится no-op (replace при равенстве не эмитит) →
            // инспектор/overlay не обновляются. Guard: в legacy-режиме (без canvas) ничего не меняется.
            if (window.__LIME_SELECTION__) window.__LIME_SELECTION__.replace([b.id]);
        });
    }

    // Поиск блоков (Итерация 3): фильтр плиток по подписи; при поиске раскрываем все группы,
    // прячем группы без совпадений.
    var blockSearch = document.getElementById("lime-block-search");
    if (blockSearch) {
        blockSearch.addEventListener("input", function () {
            var q = blockSearch.value.trim().toLowerCase();
            var sidebar = document.querySelector(".lime-editor__sidebar");
            var tiles = sidebar.querySelectorAll(".lime-tile-group [data-doc-add]");
            for (var i = 0; i < tiles.length; i++) {
                var label = tiles[i].textContent.toLowerCase();
                tiles[i].classList.toggle("is-hidden", !!q && label.indexOf(q) < 0);
            }
            var groups = sidebar.querySelectorAll(".lime-tile-group");
            for (var g = 0; g < groups.length; g++) {
                if (q) {
                    groups[g].open = true;
                    var visible = groups[g].querySelectorAll("[data-doc-add]:not(.is-hidden)").length;
                    groups[g].classList.toggle("is-hidden", visible === 0);
                } else {
                    groups[g].classList.remove("is-hidden");
                }
            }
        });
    }

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
        finishMutation(commandApplied);
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
        finishMutation(commandApplied);
    }
    function delBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        var commandApplied = runCommand("removeBlock", { id: r.block.id });
        if (!commandApplied) r.parent.splice(r.index, 1);
        selectedId = null;
        finishMutation(commandApplied);
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
        finishMutation(commandApplied);
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
    var TYPE_LABELS = {
        heading: "Заголовок", text: "Текст", cover: "Обложка", cta: "Призыв", buttonGroup: "Кнопки",
        stats: "Цифры", features: "Фичи", navbar: "Навбар", footer: "Подвал", accordion: "FAQ",
        pricing: "Тарифы", testimonials: "Отзывы", logos: "Логотипы", steps: "Шаги", imageText: "Картинка+текст",
        socials: "Соцсети", form: "Форма", image: "Картинка", gallery: "Галерея", video: "Видео", embed: "Embed",
        collectionList: "Список", container: "Контейнер", columns: "Колонки", divider: "Разделитель", spacer: "Отступ"
    };
    function blockLabel(b) {
        if (b.name) return b.name;
        if (b.type === "component") return "⊞ " + (doc.components[b.ref] ? doc.components[b.ref].name : "компонент");
        return TYPE_LABELS[b.type] || b.type;
    }
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
        function rows(arr, depth) {
            return arr.map(function (b) {
                var t = targetBlock(b);
                var isCont = t && L.isContainer(t.type);
                var kids = (t && t.children && t.children.length) ? rows(t.children, depth + 1) : "";
                var stateCls = (b.hidden ? " is-node-hidden" : "") + (b.locked ? " is-node-locked" : "");
                var z = resolvedBlockDesign(b, currentBp).zIndex;
                z = typeof z === "number" && isFinite(z) ? Math.round(z) : 0;
                var controls = canvasOn ? '<span class="lime-doc-layer__controls">' +
                    '<button type="button" data-node-toggle-hidden title="' + (b.hidden ? "Показать" : "Скрыть") + '">' + (b.hidden ? "◌" : "●") + '</button>' +
                    '<button type="button" data-node-toggle-locked title="' + (b.locked ? "Разблокировать" : "Заблокировать") + '">' + (b.locked ? "◆" : "◇") + '</button>' +
                    '<button type="button" data-node-rename title="Переименовать">✎</button>' +
                    '<button type="button" data-node-z="-1" title="Опустить">−</button>' +
                    '<span class="lime-doc-layer__z" title="z-index">' + z + '</span>' +
                    '<button type="button" data-node-z="1" title="Поднять">+</button></span>' : "";
                return '<div class="lime-doc-layer' + stateCls + (b.id === selectedId ? " is-active" : "") + '" data-doc-layer="' + b.id + '" style="padding-left:' + (8 + depth * 14) + 'px;">' +
                    '<span class="lime-doc-layer__ico">' + (isCont ? "▣" : "▪") + '</span>' +
                    '<span class="lime-doc-layer__name">' + escapeText(blockLabel(b)) + '</span>' + controls + '</div>' + kids;
            }).join("");
        }
        box.innerHTML = pageBlocks().length
            ? rows(pageBlocks(), 0)
            : '<p class="lime-text-muted" style="font-size:var(--text-xs);">Страница пуста.</p>';
    }

    // ===== КОНТЕКСТНОЕ МЕНЮ блока (ПКМ, этап 0.4) =====
    var ctxEl = null;
    function hideCtxMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
    function showCtxMenu(id, x, y) {
        hideCtxMenu();
        selectById(id);
        var r = findBlock(id);
        var nested = !!(r && r.parentBlock);
        var hasClip = !!readClip();
        var items = [
            { op: "dup", label: "⎘ Дублировать", hint: "Ctrl+D" },
            { op: "copy", label: "⧉ Копировать", hint: "Ctrl+C" },
            { op: "paste", label: "📋 Вставить", hint: "Ctrl+V", disabled: !hasClip },
            { sep: true },
            { op: "up", label: "↑ Поднять" },
            { op: "down", label: "↓ Опустить" }
        ];
        if (nested) items.push({ op: "unwrap", label: "⬅ Вынести наружу" });
        items.push({ sep: true });
        items.push({ op: "aiedit", label: "✨ AI: переписать" });
        items.push({ sep: true });
        items.push({ op: "del", label: "✕ Удалить", danger: true, hint: "Del" });

        ctxEl = document.createElement("div");
        ctxEl.className = "lime-ctx-menu";
        ctxEl.innerHTML = items.map(function (it) {
            if (it.sep) return '<div class="lime-ctx-menu__sep"></div>';
            return '<button type="button" class="lime-ctx-menu__item' + (it.danger ? " is-danger" : "") + '"' +
                (it.disabled ? " disabled" : "") + ' data-ctx-op="' + it.op + '">' +
                '<span>' + it.label + '</span>' + (it.hint ? '<kbd>' + it.hint + '</kbd>' : "") + '</button>';
        }).join("");
        document.body.appendChild(ctxEl);
        // Не вылезаем за вьюпорт.
        var w = ctxEl.offsetWidth, h = ctxEl.offsetHeight;
        ctxEl.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
        ctxEl.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
        ctxEl.addEventListener("click", function (e) {
            var b = e.target.closest("[data-ctx-op]");
            if (!b || b.disabled) return;
            runBlockOp(b.getAttribute("data-ctx-op"));
            hideCtxMenu();
        });
    }
    document.addEventListener("click", function (e) { if (ctxEl && !e.target.closest(".lime-ctx-menu")) hideCtxMenu(); });
    document.addEventListener("scroll", hideCtxMenu, true);

    // Единая точка операций над выбранным блоком (контекст-меню + горячие клавиши).
    function runBlockOp(op) {
        if (!selectedId) return;
        if (op === "dup") dupBlock();
        else if (op === "copy") copyBlock();
        else if (op === "paste") pasteBlock();
        else if (op === "aiedit") aiEditBlock();
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
    function detachComponent() {
        var r = findBlock(selectedId);
        if (!r) return;
        var inst = r.block;
        if (inst.type !== "component" || !doc.components[inst.ref]) return;
        beginCheckpointMutation();
        var copy = reid(JSON.parse(JSON.stringify(doc.components[inst.ref].block)));
        copy.id = inst.id;
        r.parent[r.index] = copy;
        render(); markDirty();
    }
    function insertComponent(cid) {
        if (!doc.components[cid]) return;
        beginCheckpointMutation();
        var inst = { id: rid("b"), type: "component", ref: cid };
        pageBlocks().push(inst);
        selectedId = inst.id;
        render(); markDirty();
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
            return '<div class="lime-doc-page-row' + (i === active ? " is-active" : "") + '">' +
                '<button type="button" class="lime-doc-page-row__open" data-doc-page-goto="' + i + '" title="Открыть страницу">' + (isHome ? "🏠" : "▦") + '</button>' +
                '<input type="text" class="lime-input lime-input--sm" data-doc-page-title="' + i + '" value="' + escapeText(p.title || "") + '" style="flex:1;">' +
                slugField +
                '<button type="button" class="lime-block-toolbar__btn" data-doc-page-dup="' + i + '" title="Дублировать">⎘</button>' +
                (doc.pages.length > 1 ? '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-page-del="' + i + '" title="Удалить">✕</button>' : '') +
                '</div>';
        }).join("");
    }

    // ===== BREAKPOINTS =====
    var bpBtns = document.querySelectorAll("[data-doc-bp]");
    for (var bp = 0; bp < bpBtns.length; bp++) {
        bpBtns[bp].addEventListener("click", function () {
            currentBp = this.dataset.docBp;
            for (var k = 0; k < bpBtns.length; k++) bpBtns[k].classList.toggle("is-active", bpBtns[k] === this);
            ws.setAttribute("data-device", currentBp === "base" ? "desktop" : currentBp);
            applyPreviewStyles();
            refreshInspector();
        });
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
        var t = targetBlock(b);
        if (!t.styles) return {};
        return (currentState === "hover" ? t.styles.hover : t.styles[currentBp]) || {};
    }

    function bpLabel() {
        return currentBp === "base" ? "Десктоп" : currentBp === "tablet" ? "Планшет" : "Мобайл";
    }

    function seg(prop, opts, cur, isMixed) {
        return '<div class="lime-segmented' + (isMixed ? ' is-mixed' : '') + '"' + (isMixed ? ' data-style-mixed="' + prop + '"' : '') + '>' + opts.map(function (o) {
            return '<button type="button" class="' + (!isMixed && cur === o.v ? "is-active" : "") + '" data-doc-style="' + prop + '" data-val="' + o.v + '">' + o.l + '</button>';
        }).join("") + (isMixed ? '<span class="lime-mixed-label">Разные</span>' : '') + '</div>';
    }
    function rng(prop, min, max, step, unit, cur, isMixed) {
        var n = parseFloat(cur); if (isNaN(n)) n = min;
        return '<div class="lime-range-row' + (isMixed ? ' is-mixed' : '') + '"' + (isMixed ? ' data-style-mixed="' + prop + '"' : '') + '><input type="range" class="lime-range" data-doc-style="' + prop + '" data-unit="' + unit + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"' + (isMixed ? ' data-mixed="true" aria-label="Разные значения"' : '') + '><span class="lime-range__val">' + (isMixed ? "Разные" : (cur || "—")) + '</span></div>';
    }
    function tokenSwatches(prop) {
        return '<div class="lime-color-row__swatches">' + L.THEME_TOKENS.map(function (t) {
            return '<button type="button" class="lime-color-swatch" data-doc-style="' + prop + '" data-val="var(' + t.var + ')" style="background:var(' + t.var + ')" title="' + t.label + '"></button>';
        }).join("") + '</div>';
    }
    function sec(title, body) {
        return '<div class="lime-inspector__section"><div class="lime-inspector__section-title">' + title + '</div>' + body + '</div>';
    }
    function colorRow(prop, cur, isMixed) {
        return '<div class="lime-color-row' + (isMixed ? ' is-mixed' : '') + '"' + (isMixed ? ' data-style-mixed="' + prop + '"' : '') + '>' +
            '<input type="color" class="lime-color-input" data-doc-style="' + prop + '" value="' + toHex(cur) + '"' + (isMixed ? ' data-mixed="true" aria-label="Разные значения"' : '') + '>' +
            '<button type="button" class="lime-color-clear" data-doc-clear="' + prop + '" title="Убрать"></button>' +
            (isMixed ? '<span class="lime-mixed-label">Разные</span>' : '') +
            '</div>';
    }

    // <select> для стиль-пропа (data-doc-style → общий input-обработчик; "" = сбросить override).
    function selectRow(prop, options, cur, isMixed) {
        return '<select class="lime-select' + (isMixed ? ' is-mixed' : '') + '" data-doc-style="' + prop + '" style="width:100%;"' + (isMixed ? ' data-mixed="true" data-style-mixed="' + prop + '"' : '') + '>' +
            (isMixed ? '<option value="__lime_mixed__" disabled selected>— Разные —</option>' : '') + options.map(function (o) {
            return '<option value="' + escapeText(o.v) + '"' + (!isMixed && (cur || "") === o.v ? " selected" : "") + '>' + o.l + '</option>';
        }).join("") + '</select>';
    }

    // Пикер шрифта с группами по категориям (1.2), данные — из LimeFonts. Значение опции =
    // CSS-стек (идёт прямо в styles.fontFamily). withDefault → «По умолчанию (тема)» ("" = сброс).
    function fontOptionsHtml(cur, withDefault, isMixed) {
        var groups = (window.LimeFonts && window.LimeFonts.GROUPS) || [];
        var opts = isMixed ? '<option value="__lime_mixed__" disabled selected>— Разные —</option>' : "";
        opts += withDefault ? '<option value=""' + (!isMixed && !cur ? " selected" : "") + ">По умолчанию (тема)</option>" : "";
        groups.forEach(function (g) {
            opts += '<optgroup label="' + g.label + '">' + g.items.map(function (f) {
                return '<option value="' + escapeText(f.s) + '"' + (!isMixed && cur === f.s ? " selected" : "") + ">" + escapeText(f.n) + "</option>";
            }).join("") + "</optgroup>";
        });
        return opts;
    }
    function fontSelect(prop, cur, withDefault, isMixed) {
        return '<select class="lime-select' + (isMixed ? ' is-mixed' : '') + '" data-doc-style="' + prop + '" style="width:100%;"' + (isMixed ? ' data-mixed="true" data-style-mixed="' + prop + '"' : '') + '>' + fontOptionsHtml(cur, withDefault, isMixed) + "</select>";
    }

    // Наборы значений для seg-контролов реестра.
    var WEIGHTS = [{ v: "400", l: "Об." }, { v: "600", l: "П/ж" }, { v: "700", l: "Ж" }, { v: "800", l: "Чёрн." }];
    var ALIGN = [{ v: "left", l: "◀" }, { v: "center", l: "≡" }, { v: "right", l: "▶" }];
    var TRANSFORM = [{ v: "none", l: "Aa" }, { v: "uppercase", l: "AA" }, { v: "lowercase", l: "aa" }, { v: "capitalize", l: "Abc" }];
    var BLEND = [{ v: "normal", l: "Норм." }, { v: "multiply", l: "Multiply" }, { v: "screen", l: "Screen" }, { v: "overlay", l: "Overlay" }, { v: "difference", l: "Diff" }];
    var BORDER_STYLE = [{ v: "none", l: "Нет" }, { v: "solid", l: "—" }, { v: "dashed", l: "- -" }];
    function padSegOpts() { return Object.keys(PADS).map(function (v) { return { v: v, l: PADS[v] }; }); }

    // Декларативный реестр контролов панели «Стиль» (1.2): один источник правды.
    // Каждый пункт — секция инспектора; контролы рисует общий renderControl, поэтому
    // добавить настройку = добавить строку сюда (а не дописывать инлайн в refreshInspector).
    // Все значения пишутся в block.styles[breakpoint][prop] → проходят и в живое превью,
    // и в publish-компиляцию (lime-doc.js) без изменений в движке.
    var STYLE_REGISTRY = [
        { title: "Шрифт", kind: "font", prop: "fontFamily" },
        { title: "Цвет текста", kind: "color", prop: "color", tokens: true },
        { title: "Размер текста", kind: "range", prop: "fontSize", min: 12, max: 80, step: 1, unit: "px" },
        { title: "Жирность", kind: "seg", prop: "fontWeight", options: WEIGHTS },
        { title: "Межстрочный", kind: "range", prop: "lineHeight", min: 1, max: 2.4, step: 0.05, unit: "" },
        { title: "Трекинг (межбуквенный)", kind: "range", prop: "letterSpacing", min: -2, max: 12, step: 0.5, unit: "px" },
        { title: "Регистр", kind: "seg", prop: "textTransform", options: TRANSFORM },
        { title: "Выравнивание текста", kind: "seg", prop: "textAlign", options: ALIGN },
        { title: "Внутренние отступы", kind: "seg", prop: "padding", options: "PAD" },
        { title: "Внешние отступы (↑ / ↓)", kind: "ranges", items: [
            { prop: "marginTop", min: 0, max: 200, step: 2, unit: "px" },
            { prop: "marginBottom", min: 0, max: 200, step: 2, unit: "px" }
        ] },
        { title: "Граница", kind: "group", parts: [
            { kind: "range", prop: "borderWidth", min: 0, max: 12, step: 1, unit: "px" },
            { kind: "seg", prop: "borderStyle", options: BORDER_STYLE },
            { kind: "color", prop: "borderColor" }
        ] },
        { title: "Скругление", kind: "range", prop: "borderRadius", min: 0, max: 64, step: 1, unit: "px" },
        { title: "Тень", kind: "shadow", prop: "boxShadow" },
        { title: "Прозрачность", kind: "range", prop: "opacity", min: 0, max: 1, step: 0.05, unit: "" },
        { title: "Смешивание (blend)", kind: "seg", prop: "mixBlendMode", options: BLEND },
        { title: "Мин. высота", kind: "range", prop: "minHeight", min: 0, max: 800, step: 10, unit: "px" }
    ];

    function renderControl(c, s, mixed) {
        mixed = mixed || {};
        var isMixed = !!(c.prop && mixed[c.prop]);
        switch (c.kind) {
            case "select": return selectRow(c.prop, c.options, s[c.prop], isMixed);
            case "font": return fontSelect(c.prop, s[c.prop], true, isMixed);
            case "range": return rng(c.prop, c.min, c.max, c.step, c.unit, s[c.prop], isMixed);
            case "ranges": return c.items.map(function (it) { return rng(it.prop, it.min, it.max, it.step, it.unit, s[it.prop], !!mixed[it.prop]); }).join("");
            case "seg": return seg(c.prop, c.options === "PAD" ? padSegOpts() : c.options, s[c.prop], isMixed);
            case "color": return colorRow(c.prop, s[c.prop], isMixed) + (c.tokens ? tokenSwatches(c.prop) : "");
            case "shadow": return (isMixed ? '<div class="lime-mixed-note" data-style-mixed="' + c.prop + '">Разные значения</div>' : '') + shadowBuilder(s[c.prop]);
            case "group": return c.parts.map(function (p) { return renderControl(p, s, mixed); }).join("");
            default: return "";
        }
    }
    function renderStyleSections(s, mixed) {
        return STYLE_REGISTRY.map(function (item) { return sec(item.title, renderControl(item, s, mixed)); }).join("");
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
    function patchDesignObject(source, field, path, value) {
        if (!source || designTarget(source, field) !== source) return;
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
            if (field === "layout" && path === "columns.min") value = Math.max(40, Math.round(value));
            if (field === "layout" && (path === "gap" || path === "rowGap" || path === "columnGap" || path === "autoRows" || /^padding\./.test(path))) value = Math.max(0, value);
            if (field === "frame" && (path === "width" || path === "height")) value = Math.max(8, value);
            if (field === "size" && (/\.value$/.test(path) || /\.(min|max)$/.test(path))) value = Math.max(0, value);
            setByPath(next, path, value);
        } else deleteByPath(next, path);
        if (field === "size" && /^(width|height)\.mode$/.test(path) && value === "fixed") {
            var axis = path.split(".")[0];
            if (!next[axis] || typeof next[axis].value !== "number" || !isFinite(next[axis].value)) {
                if (!next[axis]) next[axis] = {};
                var blockEl = ws.querySelector('[data-block-id="' + source.id + '"]');
                var scale = ws.offsetWidth ? ws.getBoundingClientRect().width / ws.offsetWidth : 1;
                if (!isFinite(scale) || scale <= 0) scale = 1;
                var rect = blockEl && blockEl.getBoundingClientRect();
                next[axis].value = Math.max(0, Math.round((rect ? rect[axis] : 100) / scale));
            }
        }
        setDesignValue(source, currentBp, field, next, false);
    }
    function v2Number(label, field, path, value, min) {
        var n = typeof value === "number" && isFinite(value) ? value : 0;
        return '<label class="lime-v2-field"><span>' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1"' +
            (min == null ? "" : ' min="' + min + '"') + ' value="' + n + '" data-v2-design-field="' + field + '" data-v2-design-path="' + path + '"></label>';
    }
    function v2OptionalNumber(label, field, path, value, min) {
        var shown = typeof value === "number" && isFinite(value) ? String(value) : "";
        return '<label class="lime-v2-field"><span>' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1"' +
            (min == null ? "" : ' min="' + min + '"') + ' value="' + shown + '" placeholder="—" data-v2-design-optional data-v2-design-field="' + field + '" data-v2-design-path="' + path + '"></label>';
    }
    function v2ChildNumber(label, field, value, min) {
        var n = typeof value === "number" && isFinite(value) ? value : (field === "order" ? 0 : 1);
        return '<label class="lime-v2-field"><span>' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1" min="' + min + '" value="' + n + '" data-v2-child-field="' + field + '"></label>';
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
                (width.mode === "fixed" ? v2Number("W", "size", "width.value", width.value, 0) : "") +
                (height.mode === "fixed" ? v2Number("H", "size", "height.value", height.value, 0) : "") + '</div>';
        }
        body += '<div class="lime-v2-subtitle">Min / Max</div><div class="lime-v2-fields">' +
            v2OptionalNumber("Min W", "size", "width.min", width.min, 0) + v2OptionalNumber("Max W", "size", "width.max", width.max, 0) +
            v2OptionalNumber("Min H", "size", "height.min", height.min, 0) + v2OptionalNumber("Max H", "size", "height.max", height.max, 0) + '</div>';
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
                    out += '<div class="lime-v2-fields">' + v2Number("Min, px", "layout", "columns.min", layout.columns.min || 240, 40) + '</div>' +
                        '<div class="lime-segmented"><button type="button" class="' + (!layout.columns.fill ? "is-active" : "") + '" data-v2-grid-fill="0">Auto-fit</button>' +
                        '<button type="button" class="' + (layout.columns.fill ? "is-active" : "") + '" data-v2-grid-fill="1">Auto-fill</button></div>';
                } else {
                    out += '<div class="lime-v2-fields">' + v2Number("Колонки", "layout", "columns", (typeof layout.columns === "number" ? layout.columns : 2), 1) + '</div>';
                }
                out += '<div class="lime-v2-fields">' + v2OptionalNumber("Auto rows, px", "layout", "autoRows", layout.autoRows, 1) + '</div>';
            }
            out += '<div class="lime-v2-fields">' +
                (mode !== "free" ? v2Number("Gap", "layout", "gap", layout.gap || 0, 0) : "") + '</div>' + v2SizeControls(design);
            if (mode !== "free") {
                var padding = layout.padding || {};
                out += '<div class="lime-v2-subtitle">Padding</div><div class="lime-v2-fields">' +
                    v2Number("Top", "layout", "padding.top", padding.top || 0, 0) + v2Number("Right", "layout", "padding.right", padding.right || 0, 0) +
                    v2Number("Bottom", "layout", "padding.bottom", padding.bottom || 0, 0) + v2Number("Left", "layout", "padding.left", padding.left || 0, 0) + '</div>';
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
        return sec("Layout · V2", out + v2SourceRow(source, fields, lockedReset));
    }
    function switchV2LayoutMode(mode) {
        var source = selectedId && byId(selectedId);
        if (!source || targetBlock(source) !== source || !L.isContainer(source.type)) return;
        var effective = L.resolvedDesign(source.design, currentBp);
        if (((effective.layout && effective.layout.mode) || "stack") === mode) return;
        var layout = ownDesignField(source, "layout");
        layout.mode = mode;
        if (mode !== "free") { setDesignValue(source, currentBp, "layout", layout, false); return; }

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
        if (!b) {
            inspectorEl.innerHTML = '<div class="lime-inspector__empty">Выбери блок в холсте, чтобы редактировать его стили.</div>';
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
        var multiBanner = multiSel
            ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner" data-multi-select>▣ Выбрано узлов: ' + multiIds.length + ' — стили применяются ко всем; различия отмечены как «Разные».</div></div>'
            : '';
        var isComp = b.type === "component";
        var compName = (isComp && doc.components[b.ref]) ? doc.components[b.ref].name : "";
        var banner = isComp
            ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner">⊞ Компонент «' + escapeText(compName) + '» — правки применяются ко всем копиям. <button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="detach">Отвязать</button></div></div>'
            : '';
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

        var headHtml =
            '<div class="lime-inspector__head">' +
                '<div class="lime-inspector__title">' + (isComp ? "компонент" : b.type) +
                    '<small>Стили для: <b>' + bpLabel() + '</b>' + (currentBp === "base" ? "" : " (override)") + '</small></div>' +
                '<div class="lime-flex lime-gap-2">' +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-op="up" title="Вверх">↑</button>' +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-op="down" title="Вниз">↓</button>' +
                    (nested ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="unwrap" title="Вытащить из контейнера">⬅</button>' : "") +
                    (t && t.content && typeof t.content.text === "string"
                        ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="ai" title="Переписать текст (AI)">✨</button>' : "") +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-op="dup" title="Дублировать">⎘</button>' +
                    (isComp ? "" : '<button type="button" class="lime-block-toolbar__btn" data-doc-op="comp" title="Сделать компонентом">⊞</button>') +
                    '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-op="del" title="Удалить">✕</button>' +
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
            styleBody = classEditBanner() + stateSeg + renderStyleSections(styleSecBucket, styleMixed);
        } else if (currentState === "hover") {
            styleBody = classesSection(b) + stateSeg + renderStyleSections(styleSecBucket, styleMixed);
        } else {
            styleBody = v2LayoutInspector(b, found) + classesSection(b) + containerHint + colsSec + contentExtras(t) + bgInspector(b, s) + stateSeg + renderStyleSections(styleSecBucket, styleMixed);
        }
        var fxBody = fxInspector(t) + animInspector(t);
        var motionBody = motionInspector(t) + sceneInspector(t) + layersInspector(t);

        inspectorEl.innerHTML =
            '<div class="lime-insp-sticky">' + headHtml + banner + multiBanner + tabsBar + '</div>' +
            panel("style", styleBody) + panel("fx", fxBody) + panel("motion", motionBody);

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

    // Привязка к данным (фуллстак): форма пишет в коллекцию, collectionList читает из неё.
    // Select наполняется асинхронно после рендера (см. populateCollectionPickers).
    function contentExtras(t) {
        if (t.type !== "form" && t.type !== "collectionList") return "";
        var label = t.type === "form" ? "Записывать в коллекцию" : "Источник — коллекция";
        return sec(label,
            '<select class="lime-select" data-doc-collection style="width:100%;"><option value="">— нет —</option></select>' +
            '<div class="lime-inspector__hint" style="margin-top:6px;">Коллекции создаются в разделе «Данные» (кабинет → твой сайт).</div>');
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
        styleDebounce = setTimeout(commitStyleEdit, 400);
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
            var t = targetBlock(byId(id));
            return (t && t.styles && t.styles[bucketName]) || {};
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
            var target = targetBlock(source);
            // Определения компонентов пока не адресуются command engine: вся группа должна
            // перейти на единый state-checkpoint, иначе часть selection молча не изменится.
            if (!source || !target || target !== source) return false;
            if (!seen[source.id]) { seen[source.id] = true; targets.push(source.id); }
        }
        if (!targets.length) return false;
        commitInlineEdit(); commitBlockEdit();
        var key = "multi:" + targets.join(",") + ":" + bucket + ":" + prop;
        if (styleTxn && styleTxnKey !== key) commitStyleEdit();
        if (!styleTxn) { cmdStore.begin("style-gesture"); styleTxn = true; styleTxnKey = key; }
        targets.forEach(function (id) {
            cmdStore.dispatch("setStyle", { id: id, breakpoint: bucket, prop: prop, value: val, remove: val === "" || val == null });
        });
        doc = cmdStore.getDoc();
        clearTimeout(styleDebounce);
        styleDebounce = setTimeout(commitStyleEdit, 400);
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
                var mb = targetBlock(byId(id));
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

    if (inspectorEl) {
        inspectorEl.addEventListener("change", function (e) {
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
            var value = e.target.type === "number" ? parseFloat(e.target.value) : e.target.value;
            if (e.target.type === "number" && !isFinite(value)) return;
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
            } else if (t.hasAttribute("data-doc-collection")) {
                setContentFlag("collection", t.value || null);
            } else if (t.hasAttribute("data-doc-class-add")) {
                if (t.value) applyClassToBlock(t.value); // <select> применить класс (0.1)
            }
        });
        inspectorEl.addEventListener("click", function (e) {
            var el;
            if ((el = e.target.closest("[data-v2-design-reset]"))) {
                var resetSource = selectedId && byId(selectedId);
                if (resetSource) setDesignValue(resetSource, currentBp, el.dataset.v2DesignReset, null, true);
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
            if ((el = e.target.closest("[data-doc-op]"))) {
                var op = el.dataset.docOp;
                if (op === "up") moveBlock(-1);
                else if (op === "down") moveBlock(1);
                else if (op === "unwrap") unwrapBlock();
                else if (op === "ai") aiRewrite();
                else if (op === "dup") dupBlock();
                else if (op === "comp") makeComponent();
                else if (op === "detach") detachComponent();
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
        if (totalBlocks() === 0) { alert("Добавь хотя бы один блок."); return; }
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/Home/EditTemplatesPost");
        xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
        xhr.onload = function () {
            if (xhr.status === 409) onConflict();
            else if (xhr.status >= 200 && xhr.status < 400) window.location.href = "/Home/MySites";
            else alert("Ошибка сохранения: " + xhr.status);
        };
        xhr.onerror = function () { alert("Сетевая ошибка."); };
        xhr.send(buildForm(false));
    }
    if (saveBtn) saveBtn.addEventListener("click", save);

    var autosaveTimer, autosaving = false;
    function scheduleAutosave() {
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
                var t = new Date();
                setStatus("Сохранено " + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2));
            } else setStatus("Ошибка автосохранения", "lime-text-danger");
        };
        xhr.onerror = function () { autosaving = false; setStatus("Нет сети", "lime-text-danger"); };
        xhr.send(buildForm(true));
    }

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
            if ((el = e.target.closest("[data-doc-page-title]"))) setPageTitle(parseInt(el.dataset.docPageTitle, 10), el.value);
        });
        // Слаг нормализуем по уходу из поля (на каждый ввод дёргать uniqueSlug мешает печатать).
        pagesModal.addEventListener("change", function (e) {
            var el;
            if ((el = e.target.closest("[data-doc-page-slug]"))) setPageSlug(parseInt(el.dataset.docPageSlug, 10), el.value);
        });
    }
    var compBox = document.getElementById("lime-doc-components");
    if (compBox) {
        compBox.addEventListener("click", function (e) {
            var b = e.target.closest("[data-doc-insert-comp]");
            if (b) { e.stopPropagation(); insertComponent(b.getAttribute("data-doc-insert-comp")); }
        });
    }

    // ===== INTRO OVERLAY (стартовый промпт для пустого документа) =====
    var introEl = document.getElementById("lime-doc-intro");
    if (introEl) {
        var introPrompt = document.getElementById("lime-doc-intro-prompt");
        var introMsg = document.getElementById("lime-doc-intro-msg");
        var introGo = document.getElementById("lime-doc-intro-go");
        var introSkip = document.getElementById("lime-doc-intro-skip");
        var introChips = document.getElementById("lime-doc-intro-chips");
        var hideIntro = function () {
            introEl.classList.add("is-hidden");
            setTimeout(function () { introEl.classList.remove("is-on", "is-hidden"); }, 480);
        };
        var introRun = function () {
            if (introMsg) { introMsg.textContent = ""; introMsg.classList.remove("is-error"); }
            runGenerate(introPrompt ? introPrompt.value : "", {
                btn: introGo,
                onError: function (m) { if (introMsg) { introMsg.textContent = m; introMsg.classList.add("is-error"); } },
                onSuccess: hideIntro
            });
        };
        if (introGo) introGo.addEventListener("click", introRun);
        if (introSkip) introSkip.addEventListener("click", hideIntro);
        if (introChips) introChips.addEventListener("click", function (e) {
            var c = e.target.closest(".lime-le-chip");
            if (c && introPrompt) { introPrompt.value = c.textContent.trim(); introPrompt.focus(); }
        });
        if (introPrompt) introPrompt.addEventListener("keydown", function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); introRun(); }
        });
        // Показываем только на пустом новом документе.
        if (totalBlocks() === 0) {
            introEl.classList.add("is-on");
            if (introPrompt) setTimeout(function () { introPrompt.focus(); }, 100);
        }
    }

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
                    if (freeInfo(id)) addTransformHandles(box, true);
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
                place(groupBox, unionRects(groupRects));
                addTransformHandles(groupBox, false);
                boxes.appendChild(groupBox);
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
            if (e.button !== 0 || isViewportPanning() || e.target.closest(".lime-block")) return;
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
