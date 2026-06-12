/*
 * Theme toggle. Запускается ДО <body> чтобы не было FOUC.
 * Источник правды: cookie lime_theme (читается серверно в Layout) + localStorage (для in-session).
 */
(function () {
    var KEY = "lime_theme";
    var html = document.documentElement;

    function apply(theme) {
        html.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    }

    function getStored() {
        try {
            var ls = localStorage.getItem(KEY);
            if (ls === "light" || ls === "dark") return ls;
        } catch (e) { /* приватный режим */ }
        var m = document.cookie.match(/(?:^|;\s*)lime_theme=(light|dark)/);
        if (m) return m[1];
        if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
        return "dark";
    }

    function persist(theme) {
        try { localStorage.setItem(KEY, theme); } catch (e) { /* приватный режим */ }
        var oneYear = 60 * 60 * 24 * 365;
        document.cookie = "lime_theme=" + theme + "; path=/; max-age=" + oneYear + "; samesite=lax";
    }

    apply(getStored());

    window.LimeTheme = {
        get: function () { return html.getAttribute("data-theme") || "dark"; },
        set: function (t) { apply(t); persist(t); },
        toggle: function () {
            var next = this.get() === "dark" ? "light" : "dark";
            this.set(next);
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll("[data-lime-theme-toggle]").forEach(function (el) {
            el.addEventListener("click", function () { window.LimeTheme.toggle(); });
        });

        // Dropdown toggle
        document.addEventListener("click", function (e) {
            var trigger = e.target.closest("[data-lime-dropdown]");
            if (trigger) {
                e.preventDefault();
                var dd = trigger.closest(".lime-dropdown");
                if (dd) {
                    document.querySelectorAll(".lime-dropdown.is-open").forEach(function (d) {
                        if (d !== dd) d.classList.remove("is-open");
                    });
                    dd.classList.toggle("is-open");
                }
                return;
            }
            // Click outside — close all
            if (!e.target.closest(".lime-dropdown__panel")) {
                document.querySelectorAll(".lime-dropdown.is-open").forEach(function (d) {
                    d.classList.remove("is-open");
                });
            }
        });
    });
})();
