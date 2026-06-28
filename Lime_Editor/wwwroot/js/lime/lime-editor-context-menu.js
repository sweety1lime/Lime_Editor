/* Lime editor block context menu. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorContextMenu = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : null);
        var iconHtml = options.iconHtml || function () { return ""; };
        var onRun = options.onRun || function () {};
        var menuEl = null;
        if (!doc || !win) return { close: function () {}, open: function () {} };

        function close() {
            if (menuEl) {
                menuEl.remove();
                menuEl = null;
            }
        }

        function menuItems(state) {
            state = state || {};
            var items = [
                { op: "dup", icon: "duplicate", text: "Дублировать", hint: "Ctrl+D" },
                { op: "copy", icon: "copy", text: "Копировать", hint: "Ctrl+C" },
                { op: "paste", icon: "paste", text: "Вставить", hint: "Ctrl+V", disabled: !state.hasClip },
                { sep: true },
                { op: "up", icon: "up", text: "Поднять" },
                { op: "down", icon: "down", text: "Опустить" }
            ];
            if (state.nested) items.push({ op: "unwrap", icon: "out", text: "Вынести наружу" });
            items.push({ sep: true });
            items.push({ op: "aiedit", icon: "features", text: "AI: переписать" });
            items.push({ op: "aisuggest", icon: "features", text: "AI: изменить по описанию" });
            items.push({ op: "aimobile", icon: "phone", text: "AI: адаптировать мобилку" });
            items.push({ sep: true });
            items.push({ op: "del", icon: "trash", text: "Удалить", danger: true, hint: "Del" });
            return items;
        }

        function itemHtml(it) {
            if (it.sep) return '<div class="lime-ctx-menu__sep"></div>';
            return '<button type="button" class="lime-ctx-menu__item' + (it.danger ? " is-danger" : "") + '"' +
                (it.disabled ? " disabled" : "") + ' data-ctx-op="' + it.op + '">' +
                '<span class="lime-ctx-menu__label">' + iconHtml(it.icon) + '<span>' + it.text + '</span></span>' +
                (it.hint ? '<kbd>' + it.hint + '</kbd>' : "") + '</button>';
        }

        function open(state) {
            state = state || {};
            close();
            menuEl = doc.createElement("div");
            menuEl.className = "lime-ctx-menu";
            menuEl.innerHTML = menuItems(state).map(itemHtml).join("");
            doc.body.appendChild(menuEl);

            var w = menuEl.offsetWidth;
            var h = menuEl.offsetHeight;
            var x = typeof state.x === "number" ? state.x : 0;
            var y = typeof state.y === "number" ? state.y : 0;
            menuEl.style.left = Math.min(x, win.innerWidth - w - 8) + "px";
            menuEl.style.top = Math.min(y, win.innerHeight - h - 8) + "px";
            menuEl.addEventListener("click", function (e) {
                var btn = e.target.closest("[data-ctx-op]");
                if (!btn || btn.disabled) return;
                onRun(btn.getAttribute("data-ctx-op"));
                close();
            });
        }

        doc.addEventListener("click", function (e) {
            if (menuEl && !e.target.closest(".lime-ctx-menu")) close();
        });
        doc.addEventListener("scroll", close, true);

        return {
            close: close,
            open: open,
            menuItems: menuItems
        };
    }

    return {
        create: create
    };
});
