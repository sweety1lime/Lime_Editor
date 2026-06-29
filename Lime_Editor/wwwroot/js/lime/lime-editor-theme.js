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

        if (!doc || !document) return { refreshPalettes: function () {} };
        if (!doc.theme) doc.theme = {};

        var THEME_KEYS = ["accent", "accent2", "bg", "fg", "muted"];
        THEME_KEYS.forEach(function (k) {
            var el = document.getElementById("lime-theme-" + k);
            if (!el) return;
            el.value = doc.theme[k] || defaultTheme[k];
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
            fontSel.value = themeFont;
            fontSel.addEventListener("input", function () { beginCheckpointMutation(); doc.theme.font = fontSel.value; render(); markDirty(); });
        }

        return { refreshPalettes: refreshPalettes };
    }

    return { create: create };
});
