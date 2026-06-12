/*
 * Lime multipage runtime (Трек B, B3) — hash-роутинг для многостраничных сайтов.
 *
 * Многостраничный сайт компилируется в одну HTML-страницу: <div data-lime-pages> с навигацией
 * и блоками-обёртками <div data-lime-page="slug">. Этот рантайм показывает страницу,
 * совпадающую с location.hash (#slug), остальные прячет. Подключается на публичной странице
 * только когда в контенте есть data-lime-pages (см. WrapCustomHtml).
 */
(function () {
    "use strict";

    function apply() {
        var root = document.querySelector("[data-lime-pages]");
        if (!root) return;
        var slug = (location.hash || "").replace(/^#/, "");
        var wraps = root.querySelectorAll("[data-lime-page]");
        if (!wraps.length) return;

        // Есть ли страница с таким slug? Если нет — показываем первую.
        var match = null;
        for (var i = 0; i < wraps.length; i++) {
            if (wraps[i].getAttribute("data-lime-page") === slug) { match = wraps[i]; break; }
        }
        var active = match || wraps[0];
        var activeSlug = active.getAttribute("data-lime-page");

        for (var j = 0; j < wraps.length; j++) {
            wraps[j].hidden = wraps[j] !== active;
        }
        var links = root.querySelectorAll("[data-lime-page-link]");
        for (var k = 0; k < links.length; k++) {
            links[k].classList.toggle("is-active", links[k].getAttribute("data-lime-page-link") === activeSlug);
        }
        try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
    }

    window.addEventListener("hashchange", apply);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply);
    } else {
        apply();
    }
})();
