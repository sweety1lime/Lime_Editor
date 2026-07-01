/* Lime editor pages manager: tabs, page modal and page metadata. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorPages = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var document = options.document || win.document || null;
        var getDoc = options.getDoc || function () { return { pages: [] }; };
        var getActive = options.getActive || function () { return 0; };
        var setActive = options.setActive || noop;
        var setSelectedId = options.setSelectedId || noop;
        var getCollections = options.getCollections || function () { return null; };
        var escapeText = options.escapeText || function (value) { return String(value == null ? "" : value); };
        var rid = options.rid || function (prefix) { return (prefix || "id") + Math.random().toString(36).slice(2); };
        var reid = options.reid || noop;
        var beginCheckpointMutation = options.beginCheckpointMutation || noop;
        var render = options.render || noop;
        var markDirty = options.markDirty || noop;
        var refreshInspector = options.refreshInspector || noop;

        if (!document) return {
            refreshPages: noop,
            renderPagesList: noop,
            addPage: noop,
            switchPage: noop,
            duplicatePage: noop,
            deletePage: noop,
            setPageTitle: noop,
            setPageSlug: noop,
            openPagesModal: noop
        };

        function pages() {
            var doc = getDoc();
            if (!doc.pages) doc.pages = [];
            return doc.pages;
        }

        function slugify(value) {
            return String(value || "").toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "");
        }

        function refreshPages() {
            var list = pages();
            var active = getActive();
            var box = document.getElementById("lime-doc-pages");
            if (!box) return;
            box.innerHTML = list.map(function (p, i) {
                return '<button type="button" class="lime-doc-page-tab' + (i === active ? " is-active" : "") +
                    '" data-doc-page="' + i + '" title="Двойной клик - управление страницами">' +
                    escapeText(p.title || "Стр.") + '</button>';
            }).join("") +
                '<button type="button" class="lime-doc-page-tab lime-doc-page-add" data-doc-page-add title="Добавить страницу">+</button>' +
                '<button type="button" class="lime-doc-page-tab lime-doc-page-manage" data-doc-pages-open title="Управление страницами">⚙</button>';
        }

        function uniqueSlug(base, exceptIdx) {
            var s = slugify(base) || "page";
            var taken = {};
            pages().forEach(function (p, i) { if (i !== exceptIdx) taken[p.slug || ""] = 1; });
            var out = s, n = 2;
            while (taken[out]) out = s + "-" + (n++);
            return out;
        }

        function addPage() {
            var list = pages();
            beginCheckpointMutation();
            list.push({ id: rid("p"), slug: uniqueSlug("page" + (list.length + 1)), title: "Страница " + (list.length + 1), blocks: [] });
            setActive(list.length - 1);
            setSelectedId(null);
            refreshPages();
            render();
            markDirty();
            renderPagesList();
        }

        function switchPage(index) {
            var list = pages();
            if (index < 0 || index >= list.length) return;
            setActive(index);
            setSelectedId(null);
            refreshPages();
            render();
        }

        function duplicatePage(index) {
            var list = pages();
            var src = list[index];
            if (!src) return;
            beginCheckpointMutation();
            var copy = JSON.parse(JSON.stringify(src));
            copy.id = rid("p");
            copy.title = (src.title || "Страница") + " (копия)";
            copy.slug = uniqueSlug(copy.title, -1);
            (copy.blocks || []).forEach(function (block) { reid(block); });
            list.splice(index + 1, 0, copy);
            setActive(index + 1);
            setSelectedId(null);
            refreshPages();
            render();
            markDirty();
            renderPagesList();
        }

        function deletePage(index) {
            var list = pages();
            if (list.length <= 1) { win.alert && win.alert("Нельзя удалить единственную страницу."); return; }
            var title = list[index] && list[index].title || "";
            if (win.confirm && !win.confirm("Удалить страницу \"" + title + "\" со всеми блоками?")) return;
            beginCheckpointMutation();
            list.splice(index, 1);
            if (getActive() >= list.length) setActive(list.length - 1);
            if (list[0]) list[0].slug = "";
            setSelectedId(null);
            refreshPages();
            render();
            markDirty();
            renderPagesList();
        }

        function setPageTitle(index, value) {
            var page = pages()[index];
            if (!page) return;
            beginCheckpointMutation();
            page.title = value;
            var tabs = document.querySelectorAll('#lime-doc-pages [data-doc-page="' + index + '"]');
            for (var i = 0; i < tabs.length; i++) tabs[i].textContent = value || "Стр.";
            markDirty();
        }

        function setPageSlug(index, value) {
            var page = pages()[index];
            if (!page || index === 0) return;
            beginCheckpointMutation();
            page.slug = uniqueSlug(value || page.title || "page", index);
            markDirty();
            renderPagesList();
        }

        function renderPagesList() {
            var list = pages();
            var active = getActive();
            var collections = getCollections();
            var box = document.getElementById("lime-doc-pages-list");
            if (!box) return;
            box.innerHTML = list.map(function (p, i) {
                var isHome = i === 0;
                var slugField = isHome
                    ? '<span class="lime-text-muted" style="font-size:var(--text-xs);">главная (/)</span>'
                    : '<input type="text" class="lime-input lime-input--sm" data-doc-page-slug="' + i + '" value="' + escapeText(p.slug || "") + '" placeholder="slug" style="width:140px;">';
                var tmplField = (!isHome && collections && collections.length)
                    ? '<select class="lime-select lime-input--sm" data-doc-page-collection="' + i + '" title="Страница-шаблон записи коллекции" style="width:150px;">' +
                        '<option value="">обычная</option>' +
                        collections.map(function (c) {
                            return '<option value="' + escapeText(c.slug) + '"' + ((p.collection || "") === c.slug ? " selected" : "") + ">📄 " + escapeText(c.name) + "</option>";
                        }).join("") + "</select>"
                    : "";
                return '<div style="margin-bottom: var(--space-3);">' +
                    '<div class="lime-doc-page-row' + (i === active ? " is-active" : "") + '">' +
                    '<button type="button" class="lime-doc-page-row__open" data-doc-page-goto="' + i + '" title="Открыть страницу">' + (isHome ? "🏠" : "▦") + '</button>' +
                    '<input type="text" class="lime-input lime-input--sm" data-doc-page-title="' + i + '" value="' + escapeText(p.title || "") + '" style="flex:1;">' +
                    slugField + tmplField +
                    '<button type="button" class="lime-block-toolbar__btn" data-doc-page-dup="' + i + '" title="Дублировать">⎘</button>' +
                    (list.length > 1 ? '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-page-del="' + i + '" title="Удалить">✕</button>' : '') +
                    '</div>' +
                    '<input type="text" class="lime-input lime-input--sm" data-doc-page-desc="' + i + '" value="' + escapeText(p.description || "") + '" maxlength="300" placeholder="SEO-описание страницы (для поиска и соцсетей)" style="width:100%; margin-top:4px;">' +
                    '</div>';
            }).join("");
        }

        function openPagesModal() {
            var modal = document.getElementById("lime-doc-pages-modal");
            if (!modal) return;
            renderPagesList();
            modal.classList.add("is-open");
        }

        function wireUi() {
            var pagesBox = document.getElementById("lime-doc-pages");
            var pagesModal = document.getElementById("lime-doc-pages-modal");
            if (pagesBox) {
                pagesBox.addEventListener("click", function (event) {
                    if (event.target.closest("[data-doc-pages-open]")) { openPagesModal(); return; }
                    if (event.target.closest("[data-doc-page-add]")) { addPage(); return; }
                    var tab = event.target.closest("[data-doc-page]");
                    if (tab) switchPage(parseInt(tab.getAttribute("data-doc-page"), 10));
                });
                pagesBox.addEventListener("dblclick", function (event) {
                    if (event.target.closest("[data-doc-page]")) openPagesModal();
                });
            }
            if (!pagesModal) return;
            pagesModal.addEventListener("click", function (event) {
                var el;
                if (event.target.closest("[data-doc-pages-close]")) { pagesModal.classList.remove("is-open"); return; }
                if (event.target.closest("[data-doc-page-add-modal]")) { addPage(); return; }
                if ((el = event.target.closest("[data-doc-page-goto]"))) { switchPage(parseInt(el.dataset.docPageGoto, 10)); renderPagesList(); return; }
                if ((el = event.target.closest("[data-doc-page-dup]"))) { duplicatePage(parseInt(el.dataset.docPageDup, 10)); return; }
                if ((el = event.target.closest("[data-doc-page-del]"))) { deletePage(parseInt(el.dataset.docPageDel, 10)); return; }
            });
            pagesModal.addEventListener("input", function (event) {
                var el;
                if ((el = event.target.closest("[data-doc-page-title]"))) { setPageTitle(parseInt(el.dataset.docPageTitle, 10), el.value); return; }
                if ((el = event.target.closest("[data-doc-page-desc]"))) {
                    var index = parseInt(el.dataset.docPageDesc, 10);
                    var page = pages()[index];
                    if (page) {
                        beginCheckpointMutation();
                        if (el.value) page.description = el.value; else delete page.description;
                        markDirty();
                    }
                }
            });
            pagesModal.addEventListener("change", function (event) {
                var el;
                if ((el = event.target.closest("[data-doc-page-slug]"))) { setPageSlug(parseInt(el.dataset.docPageSlug, 10), el.value); return; }
                if ((el = event.target.closest("[data-doc-page-collection]"))) {
                    var index = parseInt(el.dataset.docPageCollection, 10);
                    var page = pages()[index];
                    if (page) {
                        beginCheckpointMutation();
                        if (el.value) page.collection = el.value; else delete page.collection;
                        render();
                        markDirty();
                        if (index === getActive()) refreshInspector();
                    }
                }
            });
        }

        wireUi();

        return {
            refreshPages: refreshPages,
            renderPagesList: renderPagesList,
            addPage: addPage,
            switchPage: switchPage,
            duplicatePage: duplicatePage,
            deletePage: deletePage,
            setPageTitle: setPageTitle,
            setPageSlug: setPageSlug,
            openPagesModal: openPagesModal
        };
    }

    return { create: create };
});
