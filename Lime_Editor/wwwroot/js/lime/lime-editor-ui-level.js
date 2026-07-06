/*
 * Lime UI Levels (план experience-builder-plan.md, Milestone 2) — прогрессивное раскрытие
 * инспектора: Basic -> Design -> Motion -> Pro. Не paywall — просто дефолтная плотность UI;
 * всё, что выше текущего уровня, сворачивается в «Дополнительно», а не пропадает насовсем.
 * Браузер-онли (window.LimeEditorUiLevel).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorUiLevel = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var KEY = "lime-ui-level";
    // Должен совпадать с TOUR_KEY в lime-editor-onboarding.js — по нему решаем дефолт уровня.
    var TOUR_KEY = "lime-onboarding-seen";
    var ORDER = ["basic", "design", "motion", "pro"];

    function rank(level) {
        var i = ORDER.indexOf(level);
        return i < 0 ? 0 : i; // неизвестный/отсутствующий tier — считаем Basic
    }
    function atOrBelow(itemTier, level) {
        return rank(itemTier || "basic") <= rank(level);
    }

    // Первая сессия в редакторе (тур ещё не видели) -> Basic, чтобы не перегружать новичка.
    // Уже опытный пользователь -> Pro, чтобы ничего не пропало без объяснения (=как сегодня).
    function get(win) {
        win = win || (typeof window !== "undefined" ? window : null);
        if (!win) return "pro";
        try {
            var v = win.localStorage.getItem(KEY);
            if (v && ORDER.indexOf(v) >= 0) return v;
        } catch (e) { /* приватный режим */ }
        try {
            return win.localStorage.getItem(TOUR_KEY) ? "pro" : "basic";
        } catch (e) { return "pro"; /* приватный режим — не рискуем прятать контролы */ }
    }
    function set(win, level) {
        win = win || (typeof window !== "undefined" ? window : null);
        if (!win || ORDER.indexOf(level) < 0) return;
        try { win.localStorage.setItem(KEY, level); } catch (e) { /* приватный режим */ }
    }

    function applyChrome(doc, level) {
        if (!doc) return;
        var pro = doc.querySelectorAll("[data-doc-ui-pro]");
        for (var i = 0; i < pro.length; i++) pro[i].hidden = !atOrBelow("pro", level);
        var motion = doc.querySelectorAll("[data-doc-ui-motion]");
        for (var j = 0; j < motion.length; j++) motion[j].hidden = !atOrBelow("motion", level);
    }

    // Сегментированный тумблер уровня в topbar-more меню: красит is-active, применяет chrome
    // (Pro/Motion-only пункты меню) и на клике зовёт options.onChange(level) — персист и
    // refreshInspector остаются на стороне вызывающего (как в lime-editor-site-code.js).
    function wireToggle(options) {
        options = options || {};
        var doc = options.document;
        var level = options.initialLevel || "pro";
        var onChange = options.onChange || function () {};
        if (!doc) return { setLevel: function () {} };

        var toggle = doc.querySelector("[data-ui-level-toggle]");
        applyChrome(doc, level);

        function paint() {
            if (!toggle) return;
            var btns = toggle.querySelectorAll("[data-ui-level]");
            for (var i = 0; i < btns.length; i++) {
                var isActive = btns[i].getAttribute("data-ui-level") === level;
                if (btns[i].classList) btns[i].classList.toggle("is-active", isActive);
            }
        }
        paint();

        if (toggle) {
            toggle.addEventListener("click", function (e) {
                var btn = e.target.closest ? e.target.closest("[data-ui-level]") : null;
                if (!btn) return;
                level = btn.getAttribute("data-ui-level");
                paint();
                applyChrome(doc, level);
                onChange(level);
            });
        }

        return { setLevel: function (l) { level = l; paint(); applyChrome(doc, level); } };
    }

    return { ORDER: ORDER, rank: rank, atOrBelow: atOrBelow, get: get, set: set, applyChrome: applyChrome, wireToggle: wireToggle };
});
