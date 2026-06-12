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
    // Нормализация в pages-модель (старый doc.blocks → одна страница «Главная»).
    if (!doc.pages || !doc.pages.length) {
        doc.pages = [{ id: "p0", slug: "", title: "Главная", blocks: (doc.blocks || []) }];
    }
    delete doc.blocks;

    var active = 0;            // индекс активной страницы
    var selectedId = null;
    var currentBp = "base";    // base | tablet | mobile

    // Версия документа для optimistic concurrency (этап 0.4): Site.UpdatedAt.Ticks.
    // Шлём с каждым сохранением; 409 = документ сохранили из другого окна.
    var docVersion = window.__LIME_DOC_VERSION__ || 0;
    var conflicted = false;

    function pageBlocks() { return doc.pages[active].blocks; }
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
    document.addEventListener("keydown", function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        var k = (e.key || "").toLowerCase();
        // Перехватываем и внутри contenteditable: наш стек снапшотов включает текст
        // (фиксация через debounce), нативный undo браузера дал бы рассинхрон с doc.
        if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    });

    // ===== RENDER =====
    function render() {
        if (pageBlocks().length === 0) {
            ws.innerHTML = '<div class="lime-workspace__placeholder">' +
                '<div class="lime-workspace__placeholder-icon">✨</div>' +
                '<div>Страница «' + escapeText(doc.pages[active].title) + '» пуста. Выбери блок слева.</div></div>';
        } else {
            // Рендерим только активную страницу (тема и компоненты — общие на сайт).
            ws.innerHTML = L.render({ theme: doc.theme, components: doc.components, blocks: pageBlocks() }, { editable: true }).body;
        }
        applyPreviewStyles();
        if (selectedId) {
            var sel = ws.querySelector('[data-block-id="' + selectedId + '"]');
            if (sel) sel.classList.add("is-selected");
        }
        refreshInspector();
        initDnD(); // DOM пересобран — пересоздаём sortable-зоны
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
            var b = byId(el.getAttribute("data-block-id"));
            if (!b) continue;
            el.setAttribute("style", declsToCss(effective(targetBlock(b).styles, currentBp)));
        }
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
        var all = ws.querySelectorAll(".is-selected");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("is-selected");
        sec.classList.add("is-selected");
        refreshInspector();
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
        }
    });

    function openMediaPicker(blockId, field) {
        pickCtx = { blockId: blockId, field: field };
        var modal = document.getElementById("lime-media-modal");
        if (!modal) return;
        modal.classList.add("is-open");
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
                    setByPath(targetBlock(b).content, pickCtx.field, item.dataset.url);
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
            return '<button type="button" class="lime-doc-page-tab' + (i === active ? " is-active" : "") + '" data-doc-page="' + i + '" title="Двойной клик — переименовать/удалить">' + escapeText(p.title || "Стр.") + '</button>';
        }).join("") +
            '<button type="button" class="lime-doc-page-tab lime-doc-page-add" data-doc-page-add title="Добавить страницу">+</button>';
    }
    function addPage() {
        var title = prompt("Название страницы:", "Страница " + (doc.pages.length + 1));
        if (title === null) return;
        doc.pages.push({ id: rid("p"), slug: slugify(title) || ("page" + doc.pages.length), title: title || "Страница", blocks: [] });
        active = doc.pages.length - 1;
        selectedId = null;
        refreshPages(); render(); markDirty();
    }
    function switchPage(i) {
        if (i < 0 || i >= doc.pages.length) return;
        active = i; selectedId = null;
        refreshPages(); render();
    }
    function renameOrDeletePage(i) {
        var nv = prompt("Название страницы (пусто — удалить):", doc.pages[i].title);
        if (nv === null) return;
        if (nv.trim() === "") {
            if (doc.pages.length <= 1) { alert("Нельзя удалить единственную страницу."); return; }
            doc.pages.splice(i, 1);
            if (active >= doc.pages.length) active = doc.pages.length - 1;
            selectedId = null;
        } else {
            doc.pages[i].title = nv;
            doc.pages[i].slug = i === 0 ? "" : slugify(nv);
        }
        refreshPages(); render(); markDirty();
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

    // ===== INSPECTOR (breakpoint-aware) =====
    var PADS = { "0": "NONE", "8px": "XS", "16px": "SM", "24px": "MD", "48px": "LG", "80px": "XL" };

    function curStyle(b) { var t = targetBlock(b); return (t.styles && t.styles[currentBp]) || {}; }

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

    function refreshInspector() {
        if (!inspectorEl) return;
        var b = selectedId ? byId(selectedId) : null;
        if (!b) {
            inspectorEl.innerHTML = '<div class="lime-inspector__empty">Выбери блок в холсте, чтобы редактировать его стили.</div>';
            return;
        }
        var s = curStyle(b);
        var padOpts = Object.keys(PADS).map(function (v) { return { v: v, l: PADS[v] }; });
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

        inspectorEl.innerHTML =
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
            '</div>' +
            banner +
            containerHint +
            colsSec +

            sec("Фон", colorRow("backgroundColor", s.backgroundColor) + tokenSwatches("backgroundColor")) +
            sec("Цвет текста", colorRow("color", s.color) + tokenSwatches("color")) +
            sec("Размер текста", rng("fontSize", 12, 80, 1, "px", s.fontSize)) +
            sec("Жирность", seg("fontWeight", [
                { v: "400", l: "Об." }, { v: "600", l: "П/ж" }, { v: "700", l: "Ж" }, { v: "800", l: "Чёрн." }
            ], s.fontWeight)) +
            sec("Межстрочный", rng("lineHeight", 1, 2.4, 0.05, "", s.lineHeight)) +
            sec("Внутренние отступы", seg("padding", padOpts, s.padding)) +
            sec("Внешние отступы (↑ / ↓)", rng("marginTop", 0, 200, 2, "px", s.marginTop) + rng("marginBottom", 0, 200, 2, "px", s.marginBottom)) +
            sec("Граница", rng("borderWidth", 0, 12, 1, "px", s.borderWidth) +
                seg("borderStyle", [{ v: "none", l: "Нет" }, { v: "solid", l: "—" }, { v: "dashed", l: "- -" }], s.borderStyle) +
                colorRow("borderColor", s.borderColor)) +
            sec("Скругление", rng("borderRadius", 0, 64, 1, "px", s.borderRadius)) +
            sec("Тень", seg("boxShadow", [
                { v: "none", l: "Нет" },
                { v: "0 1px 2px rgba(0,0,0,.12)", l: "S" },
                { v: "0 6px 18px rgba(0,0,0,.18)", l: "M" },
                { v: "0 18px 50px rgba(0,0,0,.30)", l: "L" }
            ], s.boxShadow)) +
            sec("Мин. высота", rng("minHeight", 0, 800, 10, "px", s.minHeight)) +
            sec("Выравнивание текста", seg("textAlign", [
                { v: "left", l: "◀" }, { v: "center", l: "≡" }, { v: "right", l: "▶" }
            ], s.textAlign));
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
        var b = targetBlock(byId(selectedId));
        if (!b) return;
        if (!b.styles) b.styles = {};
        if (!b.styles[currentBp]) b.styles[currentBp] = {};
        if (val === "" || val == null) delete b.styles[currentBp][prop];
        else b.styles[currentBp][prop] = val;
        applyPreviewStyles();
        markDirty();
    }

    if (inspectorEl) {
        inspectorEl.addEventListener("input", function (e) {
            var t = e.target;
            if (t.hasAttribute("data-doc-style")) {
                var unit = t.dataset.unit || "";
                setStyle(t.dataset.docStyle, t.value === "" ? "" : t.value + unit);
                if (t.type === "range") {
                    var lbl = t.parentNode.querySelector(".lime-range__val");
                    if (lbl) lbl.textContent = t.value + unit;
                }
            }
        });
        inspectorEl.addEventListener("click", function (e) {
            var el;
            if ((el = e.target.closest("[data-doc-style]")) && el.tagName === "BUTTON") {
                setStyle(el.dataset.docStyle, el.dataset.val);
                refreshInspector();
                return;
            }
            if ((el = e.target.closest("[data-doc-clear]"))) {
                setStyle(el.dataset.docClear, "");
                refreshInspector();
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
            var b = L.createBlock(spec.type);
            if (spec.content) {
                Object.keys(spec.content).forEach(function (k) { b.content[k] = spec.content[k]; });
            }
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
    ["accent", "accent2", "bg", "fg", "muted"].forEach(function (k) {
        var el = document.getElementById("lime-theme-" + k);
        if (!el) return;
        el.value = doc.theme[k] || L.DEFAULT_THEME[k];
        el.addEventListener("input", function () { doc.theme[k] = el.value; render(); markDirty(); });
    });
    var fontSel = document.getElementById("lime-theme-font");
    if (fontSel) {
        fontSel.value = doc.theme.font || L.DEFAULT_THEME.font;
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

    // ===== PAGES / COMPONENTS UI =====
    var pagesBox = document.getElementById("lime-doc-pages");
    if (pagesBox) {
        pagesBox.addEventListener("click", function (e) {
            if (e.target.closest("[data-doc-page-add]")) { addPage(); return; }
            var tab = e.target.closest("[data-doc-page]");
            if (tab) switchPage(parseInt(tab.getAttribute("data-doc-page"), 10));
        });
        pagesBox.addEventListener("dblclick", function (e) {
            var tab = e.target.closest("[data-doc-page]");
            if (tab) renameOrDeletePage(parseInt(tab.getAttribute("data-doc-page"), 10));
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
})();
