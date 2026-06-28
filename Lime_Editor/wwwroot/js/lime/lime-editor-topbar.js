/* Lime editor topbar overflow menu («⋯» — вторичные действия). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorTopbar = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Выпадашка вторичных действий (AI/Тема/Код/Превью). Кнопки сохранили свои data-doc-* хуки —
    // их обработчики живут в основном файле и находят кнопки querySelector'ом. Здесь — только
    // открытие/закрытие меню (клик, клик-вне, Escape). Зависимостей от состояния редактора нет.
    function init(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        if (!doc) return;

        var more = doc.querySelector("[data-topbar-more]");
        if (!more) return;
        var toggle = more.querySelector("[data-topbar-more-toggle]");
        var menu = more.querySelector(".lime-topbar-more__menu");
        if (!toggle || !menu) return;

        function setOpen(open) {
            menu.hidden = !open;
            toggle.setAttribute("aria-expanded", open ? "true" : "false");
        }

        toggle.addEventListener("click", function (e) {
            e.stopPropagation();
            setOpen(menu.hidden);
        });
        // Клик по пункту выполняет действие (его навешенный обработчик) и закрывает меню.
        menu.addEventListener("click", function () { setOpen(false); });
        doc.addEventListener("click", function (e) {
            if (!menu.hidden && !more.contains(e.target)) setOpen(false);
        });
        doc.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !menu.hidden) { setOpen(false); toggle.focus(); }
        });
    }

    return { init: init };
});
