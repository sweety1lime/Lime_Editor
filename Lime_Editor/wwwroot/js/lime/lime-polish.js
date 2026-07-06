/*
 * Lime Polish (Фаза 4) — лёгкий «сигнатурный» лоск опубликованной страницы.
 * Без GSAP: подключается на КАЖДОЙ публичной странице (в редакторе не грузится).
 * Сейчас — индикатор прогресса скролла в цветах палитры сайта. Page-load fade,
 * smooth-scroll и hover-lift — чистый CSS (см. constructor.css, scope .lime-published).
 *
 * Премиум-слой: сюда же — инерционный скролл (Lenis, по data-lime-smooth), кастомный
 * курсор (data-lime-cursor) и «магнитные» кнопки (.lime-fx-magnetic). Всё уважает
 * prefers-reduced-motion и не активируется на тач-устройствах.
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
    var fancyPointer = !mq("(prefers-reduced-motion: reduce)") && !mq("(hover: none)");
    if (fancyPointer) {
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

    // Инерционный скролл (Премиум-слой A3): theme.motion.smooth → data-lime-smooth на корне,
    // publish подключает vendor/lenis.min.js. Синхронизируем ScrollTrigger, если он на странице
    // (pin/scrub-сцены). CSS scroll-behavior:smooth глушится классом .lenis (constructor.css).
    if (fancyPointer && window.Lenis && document.querySelector("[data-lime-smooth]")) {
        var lenis = new Lenis();
        if (window.ScrollTrigger) lenis.on("scroll", function () { window.ScrollTrigger.update(); });
        (function raf(time) { lenis.raf(time); requestAnimationFrame(raf); })(0);
    }

    // Кастомный курсор (Премиум-слой A5): точка следует мгновенно, кольцо — с лагом (lerp).
    // Над интерактивами кольцо растёт. Нативный курсор прячет CSS по html[data-lime-cursor-on].
    if (fancyPointer && document.querySelector("[data-lime-cursor]")) {
        var dot = document.createElement("div");
        dot.className = "lime-cursor-dot";
        var ring = document.createElement("div");
        ring.className = "lime-cursor-ring";
        document.body.appendChild(ring);
        document.body.appendChild(dot);
        var cx = -100, cy = -100, rx = -100, ry = -100, loopStarted = false;
        function cursorRaf() {
            rx += (cx - rx) * 0.16;
            ry += (cy - ry) * 0.16;
            ring.style.transform = "translate(" + rx.toFixed(1) + "px," + ry.toFixed(1) + "px)";
            dot.style.transform = "translate(" + cx + "px," + cy + "px)";
            requestAnimationFrame(cursorRaf);
        }
        document.addEventListener("mousemove", function (e) {
            cx = e.clientX; cy = e.clientY;
            document.documentElement.setAttribute("data-lime-cursor-on", "1");
            if (!loopStarted) {
                loopStarted = true;
                rx = cx; ry = cy;
                cursorRaf();
            }
        }, { passive: true });
        var HOT = "a, button, input, textarea, select, summary, label, [data-lime-modal-open]";
        document.addEventListener("mouseover", function (e) {
            var hot = e.target.closest && e.target.closest(HOT);
            ring.classList.toggle("is-hot", !!hot);
            dot.classList.toggle("is-hot", !!hot);
        });
        // Курсор ушёл за пределы окна — прячем свой, чтобы не «замирал» у края.
        document.addEventListener("mouseleave", function () {
            document.documentElement.removeAttribute("data-lime-cursor-on");
        });
    }

    // «Магнитные» кнопки (Премиум-слой A7): в секции .lime-fx-magnetic ссылки/кнопки тянутся
    // к курсору в радиусе притяжения и пружинят обратно (transition в constructor.css).
    if (fancyPointer) {
        var magnetSecs = document.querySelectorAll(".lime-fx-magnetic");
        Array.prototype.forEach.call(magnetSecs, function (sec) {
            var magnets = sec.querySelectorAll("a, button");
            if (!magnets.length) return;
            sec.addEventListener("mousemove", function (e) {
                Array.prototype.forEach.call(magnets, function (m) {
                    var r = m.getBoundingClientRect();
                    var mx = r.left + r.width / 2, my = r.top + r.height / 2;
                    var dx = e.clientX - mx, dy = e.clientY - my;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    var radius = Math.max(r.width, 90);
                    if (dist < radius) {
                        var pull = (1 - dist / radius) * 0.4;
                        m.style.transform = "translate(" + (dx * pull).toFixed(1) + "px," + (dy * pull).toFixed(1) + "px)";
                        m.classList.add("is-magnet");
                    } else if (m.classList.contains("is-magnet")) {
                        m.style.transform = "";
                        m.classList.remove("is-magnet");
                    }
                });
            });
            sec.addEventListener("mouseleave", function () {
                Array.prototype.forEach.call(magnets, function (m) {
                    m.style.transform = "";
                    m.classList.remove("is-magnet");
                });
            });
        });
    }
})();
