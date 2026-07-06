/* Lime editor theme tokens (токены сайта: 5 цветов + шрифт + курируемые палитры). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorTheme = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Панель темы: инпуты accent/accent2/bg/fg/muted, селект шрифта и курируемые палитры
    // (один клик = все 5 токенов гармонично). Зависимости редактора инжектятся: doc (мутируем
    // doc.theme), defaultTheme (фолбэк-значения), beginCheckpointMutation/render/markDirty
    // (история+перерисовка+флаг изменений), fontOptionsHtml (полный список Google Fonts).
    // Модальный тоггл темы НЕ здесь — он остаётся в основном файле (на него ссылается command palette).
    function create(options) {
        options = options || {};
        var doc = options.doc;
        var document = options.document || (typeof window !== "undefined" ? window.document : null);
        var defaultTheme = options.defaultTheme || {};
        var beginCheckpointMutation = options.beginCheckpointMutation || function () {};
        var render = options.render || function () {};
        var markDirty = options.markDirty || function () {};
        var fontOptionsHtml = options.fontOptionsHtml || function () { return ""; };

        if (!doc || !document) return { refreshPalettes: function () {}, refreshInputs: function () {} };
        if (!doc.theme) doc.theme = {};

        var THEME_KEYS = ["accent", "accent2", "bg", "fg", "muted"];
        THEME_KEYS.forEach(function (k) {
            var el = document.getElementById("lime-theme-" + k);
            if (!el) return;
            el.value = doc.theme[k] || defaultTheme[k];
            el.addEventListener("input", function () { beginCheckpointMutation(); doc.theme[k] = el.value; render(); markDirty(); refreshPalettes(); });
        });

        // Синхронизация инпутов с doc.theme — зовётся при открытии модалки: тема могла
        // смениться ПОСЛЕ create() (применение пака/шаблона мутирует doc.theme напрямую).
        function refreshInputs() {
            THEME_KEYS.forEach(function (k) {
                var el = document.getElementById("lime-theme-" + k);
                if (el) el.value = doc.theme[k] || defaultTheme[k];
            });
            renderCustomFonts(); // до value: optgroup «Свои шрифты» должен существовать
            var fontEl = document.getElementById("lime-theme-font");
            if (fontEl) fontEl.value = doc.theme.font || defaultTheme.font;
            var m = doc.theme.motion || {};
            var sm = document.getElementById("lime-theme-motion-smooth");
            if (sm) sm.checked = !!m.smooth;
            var cu = document.getElementById("lime-theme-motion-cursor");
            if (cu) cu.checked = !!m.cursor;
            var lo = document.getElementById("lime-theme-motion-loader");
            if (lo) lo.value = m.loader === "bar" || m.loader === "counter" ? m.loader : "";
            refreshPalettes();
        }

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
                return (doc.theme[k] || defaultTheme[k]).toLowerCase() === p[k].toLowerCase();
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
            var themeFont = doc.theme.font || defaultTheme.font;
            fontSel.innerHTML = fontOptionsHtml(themeFont, false); // полный список Google Fonts
            appendCustomFontOptions();
            fontSel.value = themeFont;
            fontSel.addEventListener("input", function () { beginCheckpointMutation(); doc.theme.font = fontSel.value; render(); markDirty(); });
        }

        // ===== Свои шрифты файлом (медиа-волна): theme.customFonts = [{name, url}] =====
        // Аплоад .woff2/.woff идёт в /Media/ApiUpload (XHR + CSRF-meta); @font-face эмитит
        // сам движок (customFontFaces в lime-doc.js) — после render() шрифт живёт и в превью,
        // и на публикации. Удаление из темы файл в медиатеке не трогает.
        function customFonts() { return doc.theme.customFonts || []; }
        function fontStack(name) { return "'" + name + "', system-ui, sans-serif"; }

        function appendCustomFontOptions() {
            if (!fontSel) return;
            var old = fontSel.querySelector('optgroup[data-custom-fonts]');
            if (old) old.remove();
            var list = customFonts();
            if (!list.length) return;
            var og = document.createElement("optgroup");
            og.label = "Свои шрифты";
            og.setAttribute("data-custom-fonts", "1");
            list.forEach(function (f) {
                var opt = document.createElement("option");
                opt.value = fontStack(f.name);
                opt.textContent = f.name;
                og.appendChild(opt);
            });
            fontSel.appendChild(og);
        }

        function renderCustomFonts() {
            var box = document.getElementById("lime-theme-customfonts");
            if (!box) return;
            var list = customFonts();
            box.innerHTML = list.map(function (f, i) {
                var isActive = (doc.theme.font || "") === fontStack(f.name);
                return '<div class="lime-flex lime-items-center" style="justify-content:space-between;gap:8px;margin-bottom:6px;">' +
                    '<span style="font-size:var(--text-sm);font-family:' + fontStack(f.name).replace(/"/g, "&quot;") + ';">' + f.name + '</span>' +
                    '<span class="lime-flex lime-gap-2">' +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm' + (isActive ? " is-active" : "") + '" data-theme-font-use="' + i + '">' + (isActive ? "Шрифт сайта ✓" : "Сделать шрифтом сайта") + '</button>' +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-theme-font-del="' + i + '" title="Убрать из темы (файл останется в медиа)">✕</button>' +
                    '</span></div>';
            }).join("");
            appendCustomFontOptions();
        }

        var fontsBox = document.getElementById("lime-theme-customfonts");
        if (fontsBox) {
            fontsBox.addEventListener("click", function (e) {
                var use = e.target.closest("[data-theme-font-use]");
                if (use) {
                    var f = customFonts()[parseInt(use.getAttribute("data-theme-font-use"), 10)];
                    if (!f) return;
                    beginCheckpointMutation();
                    doc.theme.font = fontStack(f.name);
                    if (fontSel) fontSel.value = doc.theme.font;
                    render(); markDirty(); renderCustomFonts();
                    return;
                }
                var del = e.target.closest("[data-theme-font-del]");
                if (del) {
                    var idx = parseInt(del.getAttribute("data-theme-font-del"), 10);
                    if (!customFonts()[idx]) return;
                    beginCheckpointMutation();
                    doc.theme.customFonts.splice(idx, 1);
                    if (!doc.theme.customFonts.length) delete doc.theme.customFonts;
                    render(); markDirty(); renderCustomFonts();
                }
            });
            renderCustomFonts();
        }

        // Имя семейства из имени файла: только [A-Za-z0-9 _-] (тот же whitelist, что у эмиссии).
        function fontNameFromFile(fileName) {
            var base = String(fileName || "").replace(/\.(woff2?|WOFF2?)$/, "").replace(/[^A-Za-z0-9 _-]/g, " ").replace(/\s+/g, " ").trim();
            return (base || "Custom Font").slice(0, 60);
        }

        var fontFile = document.getElementById("lime-theme-font-file");
        var fontUploadBtn = document.getElementById("lime-theme-font-upload");
        var fontStatus = document.getElementById("lime-theme-font-status");
        if (fontFile && fontUploadBtn && typeof XMLHttpRequest !== "undefined") {
            fontUploadBtn.addEventListener("click", function () { fontFile.click(); });
            fontFile.addEventListener("change", function () {
                if (!fontFile.files || !fontFile.files.length) return;
                var file = fontFile.files[0];
                var form = new FormData();
                form.append("file", file);
                if (fontStatus) fontStatus.textContent = "Загружаю…";
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "/Media/ApiUpload");
                var meta = document.querySelector('meta[name="X-CSRF-TOKEN"]');
                xhr.setRequestHeader("X-CSRF-TOKEN", meta ? meta.content : "");
                xhr.onload = function () {
                    fontFile.value = "";
                    var resp = null;
                    try { resp = JSON.parse(xhr.responseText); } catch (e) { /* не JSON */ }
                    if (xhr.status !== 200 || !resp || !resp.ok) {
                        if (fontStatus) fontStatus.textContent = (resp && resp.error) || "Не удалось загрузить.";
                        return;
                    }
                    var name = fontNameFromFile(resp.name);
                    // Дедуп имени: второй "Inter Custom" станет "Inter Custom 2".
                    var names = customFonts().map(function (f) { return f.name; });
                    var unique = name, n = 2;
                    while (names.indexOf(unique) >= 0) unique = name + " " + (n++);
                    beginCheckpointMutation();
                    if (!doc.theme.customFonts) doc.theme.customFonts = [];
                    doc.theme.customFonts.push({ name: unique, url: resp.url });
                    render(); markDirty(); renderCustomFonts();
                    if (fontStatus) fontStatus.textContent = "Добавлен: " + unique;
                };
                xhr.onerror = function () {
                    fontFile.value = "";
                    if (fontStatus) fontStatus.textContent = "Сеть недоступна.";
                };
                xhr.send(form);
            });
        }

        // Моушн сайта (Премиум-слой): theme.motion = { smooth, cursor, loader }. Эффекты живут
        // на опубликованной странице (lime-doc.js эмитит data-lime-* только в publish-путях);
        // здесь только модель + автосейв, превью в холсте не меняется.
        function setMotion(key, value) {
            beginCheckpointMutation();
            if (!doc.theme.motion) doc.theme.motion = {};
            if (value) doc.theme.motion[key] = value;
            else delete doc.theme.motion[key];
            if (!Object.keys(doc.theme.motion).length) delete doc.theme.motion;
            markDirty();
        }
        var motion = doc.theme.motion || {};
        var smoothCb = document.getElementById("lime-theme-motion-smooth");
        if (smoothCb) {
            smoothCb.checked = !!motion.smooth;
            smoothCb.addEventListener("change", function () { setMotion("smooth", smoothCb.checked); });
        }
        var cursorCb = document.getElementById("lime-theme-motion-cursor");
        if (cursorCb) {
            cursorCb.checked = !!motion.cursor;
            cursorCb.addEventListener("change", function () { setMotion("cursor", cursorCb.checked); });
        }
        var loaderSel = document.getElementById("lime-theme-motion-loader");
        if (loaderSel) {
            loaderSel.value = motion.loader === "bar" || motion.loader === "counter" ? motion.loader : "";
            loaderSel.addEventListener("input", function () { setMotion("loader", loaderSel.value); });
        }

        return { refreshPalettes: refreshPalettes, refreshInputs: refreshInputs };
    }

    return { create: create };
});
