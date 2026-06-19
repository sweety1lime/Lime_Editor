/*
 * Lime Polish (Фаза 4) — лёгкий «сигнатурный» лоск опубликованной страницы.
 * Без GSAP: подключается на КАЖДОЙ публичной странице (в редакторе не грузится).
 * Сейчас — индикатор прогресса скролла в цветах палитры сайта. Page-load fade,
 * smooth-scroll и hover-lift — чистый CSS (см. constructor.css, scope .lime-published).
 */
(function () {
    "use strict";

    // Полоса прогресса скролла (тонкая, сверху, в акцентном градиенте темы).
    var wrap = document.createElement("div");
    wrap.className = "lime-scroll-progress";
    var fill = document.createElement("div");
    fill.className = "lime-scroll-progress__fill";
    wrap.appendChild(fill);
    document.body.appendChild(wrap);

    var ticking = false;
    function update() {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        var top = h.scrollTop || window.pageYOffset || 0;
        var p = max > 0 ? top / max : 0;
        fill.style.transform = "scaleX(" + Math.min(1, Math.max(0, p)) + ")";
        ticking = false;
    }
    window.addEventListener("scroll", function () {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener("resize", update);
    update();

    // Наклон карточек .lime-fx-tilt по движению мыши (Фаза 6.3). Только указатель с hover,
    // уважает prefers-reduced-motion. На тач-устройствах эффект не навешивается.
    function mq(q) { return window.matchMedia && window.matchMedia(q).matches; }
    if (!mq("(prefers-reduced-motion: reduce)") && !mq("(hover: none)")) {
        var tilts = document.querySelectorAll(".lime-fx-tilt");
        Array.prototype.forEach.call(tilts, function (el) {
            el.addEventListener("mousemove", function (e) {
                var r = el.getBoundingClientRect();
                var px = (e.clientX - r.left) / r.width - 0.5;
                var py = (e.clientY - r.top) / r.height - 0.5;
                el.style.transform = "perspective(800px) rotateY(" + (px * 8).toFixed(2) + "deg) rotateX(" + (-py * 8).toFixed(2) + "deg)";
            });
            el.addEventListener("mouseleave", function () { el.style.transform = ""; });
        });
    }
})();
