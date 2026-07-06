/*
 * Lime Loader (Премиум-слой A4) — прелоадер опубликованной страницы.
 *
 * Оверлей (.lime-loader) инжектится СЕРВЕРОМ в начало <body> (PublishedPageBuilder), когда
 * в теме включён theme.motion.loader → data-lime-loader="bar|counter" на корне публикации:
 * инлайн-скрипты запрещены CSP, а вставка из defer-скрипта мигала бы контентом.
 *
 * Этот рантайм ведёт прогресс (лёгкий lerp к 85% до window.load, затем к 100%), снимает
 * оверлей и диспатчит "lime:loader-done" — lime-animate.js ждёт его, чтобы reveal-хореография
 * hero сыграла ПОСЛЕ поднятия шторки, а не под ней. Страховки: prefers-reduced-motion —
 * мгновенное снятие; без JS оверлей прячет чистый CSS (@keyframes lime-loader-autohide).
 */
(function () {
    "use strict";

    var overlay = document.querySelector("[data-lime-loader-overlay]");

    function finish() {
        if (window.__limeLoaderDone) return;
        window.__limeLoaderDone = true;
        if (overlay) {
            overlay.classList.add("is-done");
            // Узел убираем после CSS-транзишена шторки, событие шлём сразу — reveal играет под подъём.
            setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 900);
        }
        try { document.dispatchEvent(new CustomEvent("lime:loader-done")); } catch (e) { /* noop */ }
    }

    if (!overlay) { finish(); return; }
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }

    var bar = overlay.querySelector(".lime-loader__bar i");
    var count = overlay.querySelector(".lime-loader__count");
    var p = 0, target = 0.85, done = false;

    function tick() {
        if (done) return;
        p += (target - p) * 0.08;
        if (bar) bar.style.transform = "scaleX(" + p.toFixed(3) + ")";
        if (count) count.textContent = Math.round(p * 100);
        if (target >= 1 && p > 0.995) {
            done = true;
            if (bar) bar.style.transform = "scaleX(1)";
            if (count) count.textContent = "100";
            finish();
            return;
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    if (document.readyState === "complete") target = 1;
    else window.addEventListener("load", function () { target = 1; });
    // Страховка: сеть зависла — не держим посетителя за шторкой дольше 4с.
    setTimeout(function () { target = 1; }, 4000);
})();
