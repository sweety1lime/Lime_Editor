/*
 * Lime editor render pipeline (вынос из lime-doc-editor.js).
 *
 * Полный render() активной страницы (empty-state placeholder / L.render) и Stage 7
 * инкрементальная машинерия: patchBlockDom (replace одного узла), insertBlockDom /
 * removeBlockDom(s) / moveBlockDom (точечные вставка/удаление/перенос DOM) с safe-gate'ами
 * (drop-зоны детей, компонент-инстанс, v2 design-блок → полный render), finish*-обвязка
 * (autosave/markDirty), отложенный refresh дерева слоёв (один rAF на пачку), инлайн
 * preview-стилей текущего брейкпоинта (styleBlockEl/applyPreviewStyles/Scoped) и подгрузка
 * шрифтов документа (ensureDocFonts). Изменяемое состояние main — get-инъекциями;
 * initLayerDrag/editorCollectionData/templateSampleRecord/refreshV2SelectionOverlay
 * пробрасываются thunk'ами (их алиасы в main присваиваются позже создания). Браузер-онли.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var document = options.document || win.document || null;
        var ws = options.ws;
        var L = options.L || {};
        var escapeText = options.escapeText || function (s) { return s; };
        var getDoc = options.getDoc || function () { return { pages: [] }; };
        var getActive = options.getActive || function () { return 0; };
        var pageBlocks = options.pageBlocks || function () { return []; };
        var byId = options.byId || function () { return null; };
        var findBlock = options.findBlock || function () { return null; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getCurrentState = options.getCurrentState || function () { return "normal"; };
        var getCurrentClass = options.getCurrentClass || function () { return null; };
        var readStyles = options.readStyles || function () { return {}; };
        var effectiveClassStyles = options.effectiveClassStyles || function () { return {}; };
        var effective = options.effective || function () { return {}; };
        var declsToCss = options.declsToCss || function () { return ""; };
        var findClassDef = options.findClassDef || function () { return null; };
        var isCanvasOn = options.isCanvasOn || function () { return false; };
        var refreshInspector = options.refreshInspector || noop;
        var refreshLayers = options.refreshLayers || noop;
        var initDnD = options.initDnD || noop;
        var initLayerDrag = options.initLayerDrag || noop;
        var refreshV2SelectionOverlay = options.refreshV2SelectionOverlay || noop;
        var editorCollectionData = options.editorCollectionData || function () { return null; };
        var templateSampleRecord = options.templateSampleRecord || function () { return null; };
        var scheduleAutosave = options.scheduleAutosave || noop;
        var markDirty = options.markDirty || noop;
        var perfNow = options.perfNow || function () { return Date.now(); };
        var perfRec = options.perfRec || noop;

        function render() {
            var __pt = perfNow();
            var doc = getDoc();
            if (pageBlocks().length === 0) {
                // Этап 9.4: «пустое состояние» с подсказкой и быстрыми действиями вместо голого текста.
                ws.innerHTML = '<div class="lime-workspace__placeholder" data-doc-empty>' +
                    '<div class="lime-workspace__placeholder-icon">✨</div>' +
                    '<div class="lime-workspace__placeholder-title">Страница «' + escapeText(doc.pages[getActive()].title) + '» пуста</div>' +
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
            var selectedId = getSelectedId();
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
            if (win.requestAnimationFrame) win.requestAnimationFrame(run); else setTimeout(run, 0);
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
            tmp.innerHTML = L.renderOneBlock(r.block, getDoc().components, { editable: true, data: editorCollectionData(), record: templateSampleRecord() });
            var fresh = tmp.firstElementChild;
            // Нет элемента или есть дочерние drop-зоны → безопасный полный путь.
            if (!fresh || (!opts.allowChildren && fresh.querySelector(".lime-block__children"))) { render(); return false; }
            sec.replaceWith(fresh);
            if (id === getSelectedId()) fresh.classList.add("is-selected");
            if (opts.refreshDesign) applyPreviewStyles(); else applyPreviewStylesScoped(fresh);
            if (fresh.querySelector(".lime-block__children")) initDnD();
            initLayerDrag();
            ensureDocFonts();
            if (isCanvasOn()) refreshV2SelectionOverlay();
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
            tmp.innerHTML = L.renderOneBlock(block, getDoc().components, { editable: true, data: editorCollectionData(), record: templateSampleRecord() });
            var fresh = tmp.firstElementChild;
            if (!fresh) return false;
            var items = listEl.querySelectorAll(":scope > .lime-block");
            if (index == null || index >= items.length) listEl.appendChild(fresh);
            else listEl.insertBefore(fresh, items[index]);
            if (block.id === getSelectedId()) fresh.classList.add("is-selected");
            if (opts.refreshDesign) applyPreviewStyles(); else applyPreviewStylesScoped(fresh);
            ensureDocFonts();
            initDnD();        // idempotent: Sortable только для новых вложенных списков fresh
            initLayerDrag();
            if (isCanvasOn()) refreshV2SelectionOverlay();
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
            if (isCanvasOn()) refreshV2SelectionOverlay();
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
            if (isCanvasOn()) refreshV2SelectionOverlay();
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
            if (isCanvasOn()) refreshV2SelectionOverlay();
            scheduleLayersRefresh();
            perfRec("inc", __pt);
            return true;
        }
        function finishMove(id, parentId, index, commandApplied) {
            if (moveBlockDom(id, parentId, index)) refreshInspector(); else render();
            if (commandApplied) scheduleAutosave(); else markDirty();
        }

        // Инлайн эффективных стилей текущего брейкпоинта для ОДНОГО блок-элемента (live preview).
        function styleBlockEl(el) {
            var id = el.getAttribute("data-block-id");
            var b = byId(id);
            if (!b) return;
            var st = readStyles(b); // у инстанса — эффективные (definition ⊕ overrides.styles)
            // Классы — база (0.1), свой стиль блока перебивает их.
            var decls = effectiveClassStyles(b);
            Object.assign(decls, effective(st, getCurrentBp()));
            // При редактировании наведения показываем вид :hover прямо в холсте у выбранного блока.
            if (getCurrentState() === "hover" && id === getSelectedId()) {
                var currentClass = getCurrentClass();
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
            if (isCanvasOn() && L.compilePreviewDesignCss && pageBlocks().length) {
                var designStyle = ws.querySelector("style[data-lime-design-preview]");
                if (!designStyle) {
                    designStyle = document.createElement("style");
                    designStyle.setAttribute("data-lime-design-preview", "");
                    ws.appendChild(designStyle);
                }
                designStyle.textContent = L.compilePreviewDesignCss(pageBlocks(), getDoc().components, getCurrentBp());
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
            if (!win.LimeFonts) return;
            var doc = getDoc();
            var seen = {};
            if (doc.theme && doc.theme.font) seen[doc.theme.font] = 1;
            var json = JSON.stringify(doc), re = /"fontFamily":"((?:[^"\\]|\\.)*)"/g, m;
            while ((m = re.exec(json))) seen[m[1].replace(/\\"/g, '"')] = 1;
            Object.keys(seen).forEach(function (st) { win.LimeFonts.ensureFromStack(st); });
        }

        return {
            render: render,
            scheduleLayersRefresh: scheduleLayersRefresh,
            patchBlockDom: patchBlockDom,
            insertBlockDom: insertBlockDom,
            removeBlockDom: removeBlockDom,
            removeBlocksDom: removeBlocksDom,
            finishInsert: finishInsert,
            finishRemove: finishRemove,
            moveBlockDom: moveBlockDom,
            finishMove: finishMove,
            applyPreviewStyles: applyPreviewStyles,
            applyPreviewStylesScoped: applyPreviewStylesScoped,
            ensureDocFonts: ensureDocFonts
        };
    }

    return { create: create };
});
