/*
 * Lime интерактивные блоки (этап 1.2) — лёгкий рантайм без зависимостей.
 *
 * Оживляет блоки на ОПУБЛИКОВАННОЙ странице (и в экспортном проекте):
 *   - [data-lime-tabs]      — вкладки: клик по [data-lime-tab=i] показывает [data-lime-tabpanel=i].
 *   - [data-lime-carousel]  — слайдер: prev/next + точки + опц. автопрокрутка (data-lime-autoplay=сек).
 *   - [data-lime-lightbox]  — клик по [data-lime-lightbox-src] открывает картинку в оверлее.
 *
 * В РЕДАКТОРЕ не запускается (там блоки рендерятся развёрнутыми для правки, data-lime-* не эмитятся).
 * Уважает prefers-reduced-motion: автопрокрутка карусели отключается.
 */
(function () {
    "use strict";

    function reduced() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    function all(scope, sel) {
        return Array.prototype.slice.call((scope || document).querySelectorAll(sel));
    }

    // ===== Вкладки =====
    function initTabs(scope) {
        all(scope, "[data-lime-tabs]").forEach(function (root) {
            if (root.getAttribute("data-lime-init") === "1") return;
            root.setAttribute("data-lime-init", "1");
            var tabs = all(root, "[data-lime-tab]");
            var panels = all(root, "[data-lime-tabpanel]");
            function activate(idx) {
                tabs.forEach(function (t) { t.classList.toggle("is-active", t.getAttribute("data-lime-tab") === String(idx)); });
                panels.forEach(function (p) {
                    var on = p.getAttribute("data-lime-tabpanel") === String(idx);
                    p.classList.toggle("is-active", on);
                    if (on) p.removeAttribute("hidden"); else p.setAttribute("hidden", "");
                });
            }
            tabs.forEach(function (t) {
                t.addEventListener("click", function () { activate(t.getAttribute("data-lime-tab")); });
            });
        });
    }

    // ===== Карусель =====
    function initCarousels(scope) {
        all(scope, "[data-lime-carousel]").forEach(function (root) {
            if (root.getAttribute("data-lime-init") === "1") return;
            root.setAttribute("data-lime-init", "1");
            var track = root.querySelector(".lime-carousel__track");
            var slides = all(root, ".lime-carousel__slide");
            if (!track || slides.length === 0) return;
            var idx = 0, timer = null;
            function go(i) {
                idx = (i + slides.length) % slides.length;
                track.style.transform = "translateX(" + (-idx * 100) + "%)";
                all(root, "[data-lime-dot]").forEach(function (d) {
                    d.classList.toggle("is-active", d.getAttribute("data-lime-dot") === String(idx));
                });
            }
            var prev = root.querySelector("[data-lime-carousel-prev]");
            var next = root.querySelector("[data-lime-carousel-next]");
            if (prev) prev.addEventListener("click", function () { go(idx - 1); stop(); });
            if (next) next.addEventListener("click", function () { go(idx + 1); stop(); });

            // Точки-индикаторы строим в рантайме (разметку не раздуваем).
            if (slides.length > 1) {
                var dots = document.createElement("div");
                dots.className = "lime-carousel__dots";
                slides.forEach(function (s, i) {
                    var d = document.createElement("button");
                    d.type = "button";
                    d.className = "lime-carousel__dot" + (i === 0 ? " is-active" : "");
                    d.setAttribute("data-lime-dot", i);
                    d.setAttribute("aria-label", "Слайд " + (i + 1));
                    d.addEventListener("click", function () { go(i); stop(); });
                    dots.appendChild(d);
                });
                root.appendChild(dots);
            }

            function stop() { if (timer) { clearInterval(timer); timer = null; } }
            var sec = parseFloat(root.getAttribute("data-lime-autoplay"));
            if (sec > 0 && slides.length > 1 && !reduced()) {
                timer = setInterval(function () { go(idx + 1); }, sec * 1000);
                root.addEventListener("mouseenter", stop);
            }
            go(0);
        });
    }

    // ===== Лайтбокс =====
    var lbOverlay = null;
    function closeLightbox() {
        if (lbOverlay) { lbOverlay.parentNode && lbOverlay.parentNode.removeChild(lbOverlay); lbOverlay = null; }
    }
    function openLightbox(src, alt) {
        closeLightbox();
        lbOverlay = document.createElement("div");
        lbOverlay.className = "lime-lightbox-overlay";
        var img = document.createElement("img");
        img.src = src; img.alt = alt || "";
        lbOverlay.appendChild(img);
        lbOverlay.addEventListener("click", closeLightbox);
        document.body.appendChild(lbOverlay);
    }
    function initLightbox(scope) {
        all(scope, "[data-lime-lightbox]").forEach(function (root) {
            if (root.getAttribute("data-lime-init") === "1") return;
            root.setAttribute("data-lime-init", "1");
            root.addEventListener("click", function (e) {
                var cell = e.target.closest ? e.target.closest("[data-lime-lightbox-src]") : null;
                if (!cell) return;
                var img = cell.querySelector("img");
                openLightbox(cell.getAttribute("data-lime-lightbox-src"), img ? img.alt : "");
            });
        });
        if (!document.__limeLbEsc) {
            document.__limeLbEsc = true;
            document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLightbox(); });
        }
    }

    function init(scope) {
        initTabs(scope);
        initCarousels(scope);
        initLightbox(scope);
    }

    window.LimeInteractions = { init: init, initTabs: initTabs, initCarousels: initCarousels, initLightbox: initLightbox };

    // Авто-старт только вне редактора (на публичной странице .lime-editor отсутствует).
    if (!document.querySelector(".lime-editor")) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function () { init(document); });
        } else {
            init(document);
        }
    }
})();
