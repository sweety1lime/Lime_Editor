/*
 * Lime scroll-анимации (GSAP + ScrollTrigger).
 *
 * Один файл на двух поверхностях:
 *  - Опубликованная страница (/u/...): авто-reveal блоков по скроллу (initScroll).
 *  - Редактор (.lime-editor на странице): авто-старт НЕ происходит; кнопка «▶ Превью»
 *    вызывает LimeAnim.play(workspace) для одноразового проигрывания.
 *
 * Анимация блока задаётся data-атрибутами на <section class="lime-block">:
 *   data-anim="fade-up|fade-in|zoom|slide-left|slide-right"
 *   data-anim-delay="<мс>"      (необязательно)
 *   data-anim-duration="<сек>"  (необязательно)
 *
 * Уважает prefers-reduced-motion: при reduce анимации не запускаются (контент виден сразу).
 */
(function () {
    "use strict";

    var PRESETS = {
        "fade-up": { opacity: 0, y: 40 },
        "fade-in": { opacity: 0 },
        "zoom": { opacity: 0, scale: 0.85 },
        "slide-left": { opacity: 0, x: 60 },
        "slide-right": { opacity: 0, x: -60 }
    };
    var EASE = "power2.out";

    function reduced() {
        return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    function animEls(scope) {
        return Array.prototype.slice.call((scope || document).querySelectorAll("[data-anim]"));
    }
    function fromVars(el) {
        var p = PRESETS[el.getAttribute("data-anim")];
        if (!p) return null;
        var v = {};
        if (p.opacity != null) v.opacity = p.opacity;
        if (p.x != null) v.x = p.x;
        if (p.y != null) v.y = p.y;
        if (p.scale != null) v.scale = p.scale;
        return v;
    }
    function durOf(el) {
        var d = parseFloat(el.getAttribute("data-anim-duration"));
        return isNaN(d) ? 0.7 : d;
    }
    function delayOf(el) {
        var d = parseFloat(el.getAttribute("data-anim-delay"));
        return isNaN(d) ? 0 : d / 1000;
    }

    // Публичная страница: reveal каждого блока при входе в вьюпорт (одноразово).
    function initScroll() {
        if (!window.gsap || !window.ScrollTrigger) return;
        gsap.registerPlugin(ScrollTrigger);
        if (reduced()) return;
        animEls(document).forEach(function (el) {
            var from = fromVars(el);
            if (!from) return;
            var vars = Object.assign({}, from, {
                duration: durOf(el),
                delay: delayOf(el),
                ease: EASE,
                scrollTrigger: { trigger: el, start: "top 85%", once: true }
            });
            gsap.from(el, vars);
        });
    }

    // Редактор: одноразовое превью всех анимаций в области (со ступенчатым стартом).
    function play(scope) {
        if (!window.gsap || reduced()) return;
        animEls(scope).forEach(function (el, i) {
            var from = fromVars(el);
            if (!from) return;
            gsap.fromTo(el, from, {
                opacity: 1, x: 0, y: 0, scale: 1,
                duration: durOf(el),
                delay: i * 0.08 + delayOf(el),
                ease: EASE,
                clearProps: "transform,opacity"
            });
        });
    }

    window.LimeAnim = { PRESETS: PRESETS, initScroll: initScroll, play: play };

    // Авто-старт reveal только вне редактора (на публичной странице .lime-editor отсутствует).
    if (!document.querySelector(".lime-editor")) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initScroll);
        } else {
            initScroll();
        }
    }
})();
