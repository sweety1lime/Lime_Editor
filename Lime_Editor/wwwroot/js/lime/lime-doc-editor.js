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

    // ===== STATE =====
    var doc = { version: 1, pages: [], components: {}, theme: {} };
    if (window.__LIME_DOC__ && typeof window.__LIME_DOC__ === "object") {
        doc = window.__LIME_DOC__;
    }
    if (!doc.version) doc.version = 1;
    if (!doc.components) doc.components = {};
    if (!doc.theme) doc.theme = {};
    if (!doc.theme.classes) doc.theme.classes = []; // переиспользуемые style-классы (0.1)
    // Нормализация в pages-модель (старый doc.blocks → одна страница «Главная»).
    if (!doc.pages || !doc.pages.length) {
        doc.pages = [{ id: "p0", slug: "", title: "Главная", blocks: (doc.blocks || []) }];
    }
    delete doc.blocks;

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

    function snapshot() { return JSON.stringify({ doc: doc, active: active }); }
    function pushHistory() {
        var snap = snapshot();
        if (histPos >= 0 && hist[histPos] === snap) return; // состояние не изменилось
        hist = hist.slice(0, histPos + 1);
        hist.push(snap);
        if (hist.length > HIST_MAX) hist.shift();
        histPos = hist.length - 1;
        updateHistButtons();
    }
    function restoreSnapshot(snap) {
        clearTimeout(editDebounce);
        var s = JSON.parse(snap);
        doc = s.doc;
        active = Math.min(s.active, doc.pages.length - 1);
        selectedId = null;
        refreshPages(); refreshComponents(); render();
        markDirty(); // откат — тоже изменение, его надо автосохранить
    }
    function undo() {
        if (histPos <= 0) return;
        histPos--;
        restoreSnapshot(hist[histPos]);
        updateHistButtons();
    }
    function redo() {
        if (histPos >= hist.length - 1) return;
        histPos++;
        restoreSnapshot(hist[histPos]);
        updateHistButtons();
    }
    function updateHistButtons() {
        var u = document.querySelector("[data-doc-undo]");
        var r = document.querySelector("[data-doc-redo]");
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
        fromArr.splice(evt.oldIndex, 1);
        toArr.splice(Math.min(evt.newIndex, toArr.length), 0, moved);
        selectedId = moved.id;
        render(); markDirty();
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
    ws.addEventListener("input", function (e) {
        var f = e.target.closest("[data-field]");
        if (!f) return;
        var sec = f.closest(".lime-block");
        if (!sec) return;
        var b = byId(sec.getAttribute("data-block-id"));
        if (!b) return;
        setByPath(targetBlock(b).content, f.getAttribute("data-field"), f.textContent);
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
            if (row) selectById(row.getAttribute("data-doc-layer"));
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
                var items = targetBlock(b).content.items || [];
                items.splice(parseInt(el.getAttribute("data-doc-gallery-del"), 10), 1);
                render(); markDirty();
            }
            return;
        }
        if ((el = e.target.closest("[data-doc-gallery-add]"))) {
            var b2 = blockOf(el);
            if (b2) {
                var t = targetBlock(b2);
                if (!t.content.items) t.content.items = [];
                t.content.items.push({ src: "", alt: "" });
                render(); markDirty();
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
                        if (!tb.styles) tb.styles = {};
                        if (!tb.styles[currentBp]) tb.styles[currentBp] = {};
                        tb.styles[currentBp].backgroundImage = "url('" + item.dataset.url + "')";
                        if (!tb.content) tb.content = {};
                        tb.content.bgMode = "image";
                    } else if (pickCtx.target === "blockpath") {
                        // Путь относительно самого блока (напр. layers.0.src — картинка декор-слоя).
                        setByPath(tb, pickCtx.field, item.dataset.url);
                    } else {
                        setByPath(tb.content, pickCtx.field, item.dataset.url);
                    }
                    render(); markDirty();
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
        targetBlock(b).content.youtubeId = m[1];
        render(); markDirty();
    }
    function promptEmbed(blockId) {
        var url = window.prompt("Ссылка на сцену (https — Spline / Rive / Lottie / iframe):", "https://");
        if (url == null) return;
        url = url.trim();
        if (!/^https:\/\//i.test(url)) { alert("Нужна ссылка, начинающаяся с https://"); return; }
        var b = byId(blockId);
        if (!b) return;
        targetBlock(b).content.embedUrl = url;
        render(); markDirty();
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
            if (t && L.isContainer(t.type)) {
                if (!t.children) t.children = [];
                t.children.push(b);
            } else {
                pageBlocks().push(b);
            }
            selectedId = b.id;
            render();
            markDirty();
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
        var tmp = r.parent[r.index]; r.parent[r.index] = r.parent[j]; r.parent[j] = tmp;
        render(); markDirty();
    }
    function dupBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        var clone = reid(JSON.parse(JSON.stringify(r.block)));
        r.parent.splice(r.index + 1, 0, clone);
        selectedId = clone.id;
        render(); markDirty();
    }
    function delBlock() {
        var r = findBlock(selectedId);
        if (!r) return;
        r.parent.splice(r.index, 1);
        selectedId = null;
        render(); markDirty();
    }
    // «Наружу»: вытащить блок из контейнера на уровень самого контейнера (этап 1).
    function unwrapBlock() {
        var r = findBlock(selectedId);
        if (!r || !r.parentBlock) return;
        var rp = findBlock(r.parentBlock.id);
        if (!rp) return;
        r.parent.splice(r.index, 1);
        rp.parent.splice(rp.index + 1, 0, r.block);
        render(); markDirty();
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
        if (r) r.parent.splice(r.index + 1, 0, clone); // после выбранного
        else pageBlocks().push(clone);                 // или в конец страницы
        selectedId = clone.id;
        render(); markDirty();
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
        if (b.type === "component") return "⊞ " + (doc.components[b.ref] ? doc.components[b.ref].name : "компонент");
        return TYPE_LABELS[b.type] || b.type;
    }
    function refreshLayers() {
        var box = document.getElementById("lime-doc-layers");
        if (!box) return;
        function rows(arr, depth) {
            return arr.map(function (b) {
                var t = targetBlock(b);
                var isCont = t && L.isContainer(t.type);
                var kids = (t && t.children && t.children.length) ? rows(t.children, depth + 1) : "";
                return '<div class="lime-doc-layer' + (b.id === selectedId ? " is-active" : "") + '" data-doc-layer="' + b.id + '" style="padding-left:' + (8 + depth * 14) + 'px;">' +
                    '<span class="lime-doc-layer__ico">' + (isCont ? "▣" : "▪") + '</span>' +
                    '<span class="lime-doc-layer__name">' + escapeText(blockLabel(b)) + '</span></div>' + kids;
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
        var copy = reid(JSON.parse(JSON.stringify(doc.components[inst.ref].block)));
        copy.id = inst.id;
        r.parent[r.index] = copy;
        render(); markDirty();
    }
    function insertComponent(cid) {
        if (!doc.components[cid]) return;
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
        doc.pages.splice(i, 1);
        if (active >= doc.pages.length) active = doc.pages.length - 1;
        // Гарантия: первая страница — главная (slug "").
        if (doc.pages[0]) doc.pages[0].slug = "";
        selectedId = null;
        refreshPages(); render(); markDirty();
        renderPagesList();
    }
    function setPageTitle(i, val) {
        doc.pages[i].title = val;
        var tabs = document.querySelectorAll('#lime-doc-pages [data-doc-page="' + i + '"]');
        for (var t = 0; t < tabs.length; t++) tabs[t].textContent = val || "Стр.";
        markDirty();
    }
    function setPageSlug(i, val) {
        if (i === 0) return; // главная всегда ""
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

    function seg(prop, opts, cur) {
        return '<div class="lime-segmented">' + opts.map(function (o) {
            return '<button type="button" class="' + (cur === o.v ? "is-active" : "") + '" data-doc-style="' + prop + '" data-val="' + o.v + '">' + o.l + '</button>';
        }).join("") + '</div>';
    }
    function rng(prop, min, max, step, unit, cur) {
        var n = parseFloat(cur); if (isNaN(n)) n = min;
        return '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-style="' + prop + '" data-unit="' + unit + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"><span class="lime-range__val">' + (cur || "—") + '</span></div>';
    }
    function tokenSwatches(prop) {
        return '<div class="lime-color-row__swatches">' + L.THEME_TOKENS.map(function (t) {
            return '<button type="button" class="lime-color-swatch" data-doc-style="' + prop + '" data-val="var(' + t.var + ')" style="background:var(' + t.var + ')" title="' + t.label + '"></button>';
        }).join("") + '</div>';
    }
    function sec(title, body) {
        return '<div class="lime-inspector__section"><div class="lime-inspector__section-title">' + title + '</div>' + body + '</div>';
    }
    function colorRow(prop, cur) {
        return '<div class="lime-color-row">' +
            '<input type="color" class="lime-color-input" data-doc-style="' + prop + '" value="' + toHex(cur) + '">' +
            '<button type="button" class="lime-color-clear" data-doc-clear="' + prop + '" title="Убрать"></button>' +
            '</div>';
    }

    // <select> для стиль-пропа (data-doc-style → общий input-обработчик; "" = сбросить override).
    function selectRow(prop, options, cur) {
        return '<select class="lime-select" data-doc-style="' + prop + '" style="width:100%;">' + options.map(function (o) {
            return '<option value="' + escapeText(o.v) + '"' + ((cur || "") === o.v ? " selected" : "") + '>' + o.l + '</option>';
        }).join("") + '</select>';
    }

    // Пикер шрифта с группами по категориям (1.2), данные — из LimeFonts. Значение опции =
    // CSS-стек (идёт прямо в styles.fontFamily). withDefault → «По умолчанию (тема)» ("" = сброс).
    function fontOptionsHtml(cur, withDefault) {
        var groups = (window.LimeFonts && window.LimeFonts.GROUPS) || [];
        var opts = withDefault ? '<option value=""' + (!cur ? " selected" : "") + ">По умолчанию (тема)</option>" : "";
        groups.forEach(function (g) {
            opts += '<optgroup label="' + g.label + '">' + g.items.map(function (f) {
                return '<option value="' + escapeText(f.s) + '"' + (cur === f.s ? " selected" : "") + ">" + escapeText(f.n) + "</option>";
            }).join("") + "</optgroup>";
        });
        return opts;
    }
    function fontSelect(prop, cur, withDefault) {
        return '<select class="lime-select" data-doc-style="' + prop + '" style="width:100%;">' + fontOptionsHtml(cur, withDefault) + "</select>";
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

    function renderControl(c, s) {
        switch (c.kind) {
            case "select": return selectRow(c.prop, c.options, s[c.prop]);
            case "font": return fontSelect(c.prop, s[c.prop], true);
            case "range": return rng(c.prop, c.min, c.max, c.step, c.unit, s[c.prop]);
            case "ranges": return c.items.map(function (it) { return rng(it.prop, it.min, it.max, it.step, it.unit, s[it.prop]); }).join("");
            case "seg": return seg(c.prop, c.options === "PAD" ? padSegOpts() : c.options, s[c.prop]);
            case "color": return colorRow(c.prop, s[c.prop]) + (c.tokens ? tokenSwatches(c.prop) : "");
            case "shadow": return shadowBuilder(s[c.prop]);
            case "group": return c.parts.map(function (p) { return renderControl(p, s); }).join("");
            default: return "";
        }
    }
    function renderStyleSections(s) {
        return STYLE_REGISTRY.map(function (item) { return sec(item.title, renderControl(item, s)); }).join("");
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
        if (blockClassList(b).indexOf(cls) === -1) toggleBlockClass(b, cls);
        render(); markDirty();
    }
    function removeClassFromBlock(cls) {
        var b = byId(selectedId); if (!b) return;
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
        var l = classDefs();
        for (var i = 0; i < l.length; i++) if (l[i].cls === cls) { l.splice(i, 1); break; }
        stripClassEverywhere(cls);
        currentClass = null; render(); markDirty();
    }
    function renameClass(cls) {
        var def = findClassDef(cls); if (!def) return;
        var name = (window.prompt("Новое имя класса:", def.name || "") || "").trim();
        if (name) { def.name = name; refreshInspector(); markDirty(); }
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

    function refreshInspector() {
        if (!inspectorEl) return;
        var b = selectedId ? byId(selectedId) : null;
        if (!b) {
            inspectorEl.innerHTML = '<div class="lime-inspector__empty">Выбери блок в холсте, чтобы редактировать его стили.</div>';
            return;
        }
        var s = curStyle(b);
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
            styleBody = classEditBanner() + stateSeg + renderStyleSections(s);
        } else if (currentState === "hover") {
            styleBody = classesSection(b) + stateSeg + renderStyleSections(s);
        } else {
            styleBody = classesSection(b) + containerHint + colsSec + contentExtras(t) + bgInspector(b, s) + stateSeg + renderStyleSections(s);
        }
        var fxBody = fxInspector(t) + animInspector(t);
        var motionBody = motionInspector(t) + sceneInspector(t) + layersInspector(t);

        inspectorEl.innerHTML =
            '<div class="lime-insp-sticky">' + headHtml + banner + tabsBar + '</div>' +
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
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!mode) delete b.scene;
        else { if (!b.scene) b.scene = {}; b.scene.mode = mode; if (!b.scene.length) b.scene.length = 2; }
        render(); markDirty();
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
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!b.fx) b.fx = [];
        var i = b.fx.indexOf(key);
        if (i >= 0) b.fx.splice(i, 1); else b.fx.push(key);
        if (!b.fx.length) delete b.fx;
        render(); markDirty();
    }
    function setContentFlag(key, val) {
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!b.content) b.content = {};
        if (val == null) delete b.content[key]; else b.content[key] = val;
        render(); markDirty();
    }

    // ----- мутации слоёв -----
    function curBlockWithLayers() {
        var b = targetBlock(byId(selectedId));
        if (!b) return null;
        if (!b.layers) b.layers = [];
        return b;
    }
    function addLayer(kind) {
        var b = curBlockWithLayers(); if (!b) return;
        var l = { id: rid("l"), kind: kind, x: 40, y: 28, w: kind === "image" ? 160 : 120, z: 0, depth: 0.2, opacity: 1 };
        if (kind === "shape") { l.shape = "blob"; l.color = "#a78bfa"; }
        b.layers.push(l);
        render(); markDirty();
        if (kind === "image") openMediaPicker(selectedId, "layers." + (b.layers.length - 1) + ".src", "blockpath");
    }
    function delLayer(i) { var b = curBlockWithLayers(); if (!b) return; b.layers.splice(i, 1); render(); markDirty(); }
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
        var b = curBlockWithLayers(); if (!b || !b.layers[i]) return;
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
        dragLayer = { lyr: lyr, sec: secEl, l: l, startCx: e.clientX, startCy: e.clientY, startX: l.x || 0, startY: l.y || 0 };
        try { lyr.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        lyr.addEventListener("pointermove", onLayerMove);
        lyr.addEventListener("pointerup", onLayerUp);
    }
    function onLayerMove(e) {
        if (!dragLayer) return;
        var r = dragLayer.sec.getBoundingClientRect();
        var dx = ((e.clientX - dragLayer.startCx) / r.width) * 100;
        var dy = ((e.clientY - dragLayer.startCy) / r.height) * 100;
        dragLayer.l.x = Math.max(0, Math.min(100, Math.round(dragLayer.startX + dx)));
        dragLayer.l.y = Math.max(0, Math.min(100, Math.round(dragLayer.startY + dy)));
        dragLayer.lyr.style.left = dragLayer.l.x + "%";
        dragLayer.lyr.style.top = dragLayer.l.y + "%";
    }
    function onLayerUp(e) {
        if (!dragLayer) return;
        var lyr = dragLayer.lyr;
        lyr.removeEventListener("pointermove", onLayerMove);
        lyr.removeEventListener("pointerup", onLayerUp);
        try { lyr.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        dragLayer = null; markDirty();
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

    function setStyle(prop, val) {
        if (currentClass) { setClassStyle(prop, val); return; } // правим класс, не блок (0.1)
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!b.styles) b.styles = {};
        var bucket = currentState === "hover" ? "hover" : currentBp;
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
    function animAttr(prop) {
        return prop === "anim" ? "data-anim" : prop === "animDelay" ? "data-anim-delay" : "data-anim-duration";
    }
    function setAnim(prop, val, reflectInspector) {
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (val === "" || val == null) delete b[prop];
        else b[prop] = val;
        var el = ws.querySelector('[data-block-id="' + selectedId + '"]');
        if (el) {
            var attr = animAttr(prop);
            if (val === "" || val == null) el.removeAttribute(attr);
            else el.setAttribute(attr, val);
            if (prop === "anim" && (val === "" || val == null)) {
                el.removeAttribute("data-anim-delay"); el.removeAttribute("data-anim-duration");
                delete b.animDelay; delete b.animDuration;
            }
        }
        if (reflectInspector) refreshInspector();
        markDirty();
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
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!b.content) b.content = {};
        if (!b.content.bg) b.content.bg = {};
        if (val === "" || val == null) delete b.content.bg[key];
        else b.content.bg[key] = val;
        if (!Object.keys(b.content.bg).length) delete b.content.bg;
        render(); markDirty();
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
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!b.content) b.content = {};
        if (!b.content.bg) b.content.bg = {};
        b.content.bg.overlay = val;
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
        markDirty();
    }
    function switchBgMode(mode) {
        var b = targetBlock(byId(selectedId));
        if (!b) return;
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
        inspectorEl.addEventListener("input", function (e) {
            var t = e.target;
            if (t.hasAttribute("data-doc-style")) {
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
                var mb = targetBlock(byId(selectedId));
                if (mb) {
                    var v = t.value;
                    if (parseFloat(v) === 0) delete mb.parallax; else mb.parallax = v;
                    var msec = ws.querySelector('[data-block-id="' + selectedId + '"]');
                    if (msec) { if (parseFloat(v) === 0) msec.removeAttribute("data-parallax"); else msec.setAttribute("data-parallax", v); }
                    var ml = t.parentNode.querySelector(".lime-range__val"); if (ml) ml.textContent = v;
                    markDirty();
                }
            } else if (t.hasAttribute("data-doc-layer-rng")) {
                var li = parseInt(t.dataset.i, 10);
                setLayerRng(li, t.dataset.docLayerRng, parseFloat(t.value));
                var ll = t.parentNode.querySelector(".lime-range__val"); if (ll) ll.textContent = t.value;
            } else if (t.hasAttribute("data-doc-layer-color")) {
                var ci = parseInt(t.dataset.docLayerColor, 10);
                setLayerRng(ci, "color", t.value);
            } else if (t.hasAttribute("data-doc-scene-len") && t.type === "range") {
                var sb = targetBlock(byId(selectedId));
                if (sb && sb.scene) {
                    sb.scene.length = parseInt(t.value, 10);
                    var sl = t.parentNode.querySelector(".lime-range__val");
                    if (sl) sl.textContent = t.value;
                    markDirty();
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
                    var bb = targetBlock(byId(selectedId));
                    if (bb) { if (!bb.content) bb.content = {}; bb.content.bgMode = "gradient"; }
                    setStyle("backgroundImage", bp.css);
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
                var sb = targetBlock(byId(selectedId));
                if (sb) { if (el.dataset.docSticky === "1") sb.sticky = true; else delete sb.sticky; render(); markDirty(); }
                return;
            }
            if ((el = e.target.closest("[data-doc-marquee]"))) {
                var qb = targetBlock(byId(selectedId));
                if (qb) {
                    var m = el.dataset.docMarquee;
                    if (m === "off") delete qb.marquee;
                    else qb.marquee = { speed: 40, reverse: m === "rtl" };
                    render(); markDirty();
                }
                return;
            }
            if ((el = e.target.closest("[data-doc-scene]"))) { setSceneMode(el.dataset.docScene); return; }
            // ----- декор-слои -----
            if ((el = e.target.closest("[data-doc-layer-add]"))) { addLayer(el.dataset.docLayerAdd); return; }
            if ((el = e.target.closest("[data-doc-layer-del]"))) { delLayer(parseInt(el.dataset.docLayerDel, 10)); return; }
            if ((el = e.target.closest("[data-doc-layer-pick]"))) { openMediaPicker(selectedId, "layers." + el.dataset.docLayerPick + ".src", "blockpath"); return; }
            if ((el = e.target.closest("[data-doc-layer-shape]"))) {
                var hb = curBlockWithLayers(); var hi = parseInt(el.dataset.docLayerShape, 10);
                if (hb && hb.layers[hi]) { hb.layers[hi].shape = el.dataset.shape; render(); markDirty(); }
                return;
            }
            if ((el = e.target.closest("[data-doc-cols]"))) {
                var cb = findBlock(selectedId);
                if (cb) {
                    var ct = targetBlock(cb.block);
                    if (!ct.content) ct.content = {};
                    ct.content.cols = parseInt(el.dataset.docCols, 10);
                    render(); markDirty(); refreshInspector();
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
    function markDirty() {
        pushHistory(); // каждое изменение — точка отката (этап 0.4)
        if (!siteId || conflicted) return;
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(runAutosave, 2500);
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
                t.content.text = resp.text;
                render(); markDirty();
            } else {
                alert(aiErrorText(xhr.status, resp));
            }
        };
        xhr.onerror = function () { alert("Сетевая ошибка."); };
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
        el.addEventListener("input", function () { doc.theme[k] = el.value; render(); markDirty(); refreshPalettes(); });
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
        fontSel.addEventListener("input", function () { doc.theme.font = fontSel.value; render(); markDirty(); });
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
        doc.customCss = cssArea.value;
        if (!doc.customCss) delete doc.customCss;
        render(); markDirty();
    });
    if (headArea) headArea.addEventListener("input", function () {
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

    // ===== INIT =====
    refreshPages();
    refreshComponents();
    render();
    pushHistory(); // стартовое состояние — дно стека undo

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
