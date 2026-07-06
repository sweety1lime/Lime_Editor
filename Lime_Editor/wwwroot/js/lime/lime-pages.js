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

    // Переход между страницами (Премиум-слой A6): шторка в цвет темы накрывает экран,
    // под ней меняется страница (+ ScrollTrigger пересчитывает pin/scrub-сцены на новой),
    // затем шторка уезжает вверх. Стили — .lime-page-transition в constructor.css.
    // reduced-motion / нет DOM — мгновенное переключение без шторки.
    var veil = null;
    function reduced() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    function ensureVeil() {
        if (veil || !document.body) return veil;
        veil = document.createElement("div");
        veil.className = "lime-page-transition";
        document.body.appendChild(veil);
        return veil;
    }
    var switching = false;
    function applyWithTransition() {
        if (reduced() || !ensureVeil()) { applyAndRefresh(); return; }
        if (switching) return; // повторный hashchange во время шторки: доиграем текущий, apply возьмёт свежий hash
        switching = true;
        veil.classList.add("is-cover");
        setTimeout(function () {
            applyAndRefresh();
            veil.classList.add("is-exit");
            setTimeout(function () {
                veil.classList.remove("is-cover");
                veil.classList.remove("is-exit");
                switching = false;
            }, 450);
        }, 420);
    }
    function applyAndRefresh() {
        apply();
        // Пересчёт scroll-сцен под новую страницу (pin-спейсеры считались, пока она была hidden).
        if (window.ScrollTrigger) { try { window.ScrollTrigger.refresh(); } catch (e) { /* noop */ } }
    }

    window.addEventListener("hashchange", applyWithTransition);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply);
    } else {
        apply();
    }
})();
