/* Lime editor media picker modal. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorMediaPicker = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function attr(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : null);
        var fetchImpl = options.fetch || (win && win.fetch ? win.fetch.bind(win) : null);
        var csrfToken = options.csrfToken || function () { return ""; };
        var onPick = options.onPick || function () {};
        var pickCtx = null;
        var uploadWired = false;
        if (!doc || !win) return { close: function () {}, open: function () {} };

        function byId(id) {
            return doc.getElementById(id);
        }

        function gridEl() {
            return byId("lime-media-grid");
        }

        function close() {
            var modal = byId("lime-media-modal");
            if (modal) modal.classList.remove("is-open");
            pickCtx = null;
        }

        function loadMediaList() {
            var grid = gridEl();
            if (!grid) return;
            if (!fetchImpl) {
                grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>';
                return;
            }
            grid.innerHTML = '<div class="lime-text-muted">Загрузка...</div>';
            fetchImpl("/Media/ApiList", { credentials: "same-origin" })
                .then(function (r) { return r.json(); })
                .then(function (items) {
                    if (!items || items.length === 0) {
                        grid.innerHTML = '<div class="lime-picker-empty">Пусто. Загрузи изображения в <a href="/Media/Index" target="_blank" class="lime-text-accent">Медиа</a>.</div>';
                        return;
                    }
                    grid.innerHTML = items.map(function (it) {
                        var url = attr(it.url);
                        var name = attr(it.name || "");
                        return '<div class="lime-picker-item" data-url="' + url + '" title="' + name + '">' +
                            '<img src="' + url + '" alt="' + name + '" loading="lazy">' +
                            '</div>';
                    }).join("");
                })
                .catch(function () {
                    grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>';
                });
        }

        function resetMediaTabs() {
            var tabs = doc.querySelectorAll("[data-media-tab]");
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.toggle("is-active", tabs[i].dataset.mediaTab === "mine");
            }
            var sf = byId("lime-stock-search");
            if (sf) sf.style.display = "none";
        }

        function loadStockList(q) {
            var grid = gridEl();
            if (!grid) return;
            if (!q) { grid.innerHTML = '<div class="lime-text-muted">Введи запрос и нажми «Найти».</div>'; return; }
            if (!fetchImpl) {
                grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>';
                return;
            }
            grid.innerHTML = '<div class="lime-text-muted">Ищу «' + attr(q) + '»…</div>';
            fetchImpl("/Media/Stock?q=" + encodeURIComponent(q), { credentials: "same-origin" })
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
                        var url = attr(it.url);
                        var thumb = attr(it.thumb);
                        var name = attr(it.name || "");
                        return '<div class="lime-picker-item" data-url="' + url + '" title="' + name + '">' +
                            '<img src="' + thumb + '" alt="' + name + '" loading="lazy"></div>';
                    }).join("");
                })
                .catch(function () { grid.innerHTML = '<div class="lime-picker-empty">Ошибка загрузки.</div>'; });
        }

        function wireMediaUpload() {
            if (uploadWired) return;
            var input = byId("lime-media-upload");
            var status = byId("lime-media-status");
            if (!input || !win.FormData || !win.XMLHttpRequest) return;
            uploadWired = true;
            input.addEventListener("change", function () {
                if (!input.files || input.files.length === 0) return;
                var form = new win.FormData();
                form.append("file", input.files[0]);
                if (status) {
                    status.style.display = "block";
                    status.textContent = "Загружаю " + input.files[0].name + "...";
                    status.className = "lime-text-muted";
                }
                var xhr = new win.XMLHttpRequest();
                xhr.open("POST", "/Media/Upload");
                xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
                xhr.onload = function () {
                    if (status) {
                        if (xhr.status === 200 || xhr.status === 302) {
                            status.textContent = "✓ Загружено. Обновляю список...";
                            status.className = "lime-text-success";
                            loadMediaList();
                            win.setTimeout(function () { status.style.display = "none"; }, 1500);
                        } else {
                            status.textContent = "✗ Ошибка загрузки: " + xhr.status;
                            status.className = "lime-text-danger";
                        }
                    } else if (xhr.status === 200 || xhr.status === 302) {
                        loadMediaList();
                    }
                    input.value = "";
                };
                xhr.onerror = function () {
                    if (status) {
                        status.textContent = "✗ Сетевая ошибка";
                        status.className = "lime-text-danger";
                    }
                    input.value = "";
                };
                xhr.send(form);
            });
        }

        function open(ctx) {
            ctx = ctx || {};
            pickCtx = {
                blockId: ctx.blockId,
                field: ctx.field,
                target: ctx.target || "content"
            };
            var modal = byId("lime-media-modal");
            if (!modal) return;
            modal.classList.add("is-open");
            resetMediaTabs();
            loadMediaList();
            wireMediaUpload();
        }

        doc.addEventListener("click", function (e) {
            var tb = e.target.closest("[data-media-tab]");
            if (!tb) return;
            var tabs = doc.querySelectorAll("[data-media-tab]");
            for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("is-active", tabs[i] === tb);
            var sf = byId("lime-stock-search");
            if (tb.dataset.mediaTab === "stock") {
                if (sf) sf.style.display = "block";
                var qi = byId("lime-stock-q");
                loadStockList(qi ? qi.value.trim() : "");
                if (qi) qi.focus();
            } else {
                if (sf) sf.style.display = "none";
                loadMediaList();
            }
        });

        var stockForm = byId("lime-stock-search");
        if (stockForm) stockForm.addEventListener("submit", function (e) {
            e.preventDefault();
            var qi = byId("lime-stock-q");
            loadStockList(qi ? qi.value.trim() : "");
        });

        doc.addEventListener("click", function (e) {
            var item = e.target.closest("#lime-media-grid .lime-picker-item");
            if (item) {
                if (pickCtx && item.dataset.url) onPick(pickCtx, item.dataset.url);
                close();
                return;
            }
            if (e.target.closest("[data-lime-modal-close]")) close();
        });

        return {
            close: close,
            loadMediaList: loadMediaList,
            loadStockList: loadStockList,
            open: open,
            resetMediaTabs: resetMediaTabs,
            wireMediaUpload: wireMediaUpload
        };
    }

    return {
        create: create
    };
});
