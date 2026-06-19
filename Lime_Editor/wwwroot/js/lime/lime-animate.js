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

    // Параллакс: секции и декор-слои с data-parallax едут по скроллу на свою глубину.
    function initParallax() {
        if (!window.gsap || !window.ScrollTrigger || reduced()) return;
        Array.prototype.forEach.call(document.querySelectorAll("[data-parallax]"), function (el) {
            var depth = parseFloat(el.getAttribute("data-parallax")) || 0;
            if (!depth) return;
            var trigger = el.closest(".lime-block") || el;
            gsap.to(el, {
                yPercent: -depth * 100,
                ease: "none",
                scrollTrigger: { trigger: trigger, start: "top bottom", end: "bottom top", scrub: true }
            });
        });
    }

    // Бегущая строка: дублируем ряд и крутим бесконечно. data-marquee="<px/сек>".
    function initMarquee(scope) {
        if (!window.gsap || reduced()) return;
        var root = scope || document;
        Array.prototype.forEach.call(root.querySelectorAll("[data-marquee]"), function (el) {
            if (el.getAttribute("data-marquee-init") === "1") return;
            el.setAttribute("data-marquee-init", "1");
            var speed = parseFloat(el.getAttribute("data-marquee")) || 40;
            var reverse = el.getAttribute("data-marquee-reverse") === "1";
            el.innerHTML = el.innerHTML + el.innerHTML; // вторая копия для бесшовной петли
            var dist = el.scrollWidth / 2;
            if (!dist) return;
            gsap.fromTo(el, { x: reverse ? -dist : 0 }, {
                x: reverse ? 0 : -dist, duration: dist / speed, ease: "none", repeat: -1
            });
        });
    }

    // Sticky — это CSS (position:sticky), JS лишь проставляет смещение сверху.
    function initSticky() {
        Array.prototype.forEach.call(document.querySelectorAll("[data-sticky]"), function (el) {
            var off = parseFloat(el.getAttribute("data-sticky-offset"));
            if (!isNaN(off)) el.style.top = off + "px";
        });
    }

    // Scrollytelling (этап 8.2): закреплённые сцены, анимируемые по прогрессу скролла.
    // horizontal — пин секции + горизонтальный проезд внутреннего ряда; steps — пошаговое
    // появление детей; pin — просто пин на N экранов, пока играют reveal'ы.
    function initScenes() {
        if (!window.gsap || !window.ScrollTrigger || reduced()) return;
        Array.prototype.forEach.call(document.querySelectorAll("[data-scene]"), function (sec) {
            var mode = sec.getAttribute("data-scene");
            var len = Math.max(1, parseFloat(sec.getAttribute("data-scene-length")) || 2);
            if (mode === "horizontal") {
                var track = sec.querySelector(".lime-block__children--scene");
                if (!track) return;
                var dist = track.scrollWidth - sec.clientWidth;
                if (dist <= 0) return;
                gsap.to(track, {
                    x: -dist, ease: "none",
                    scrollTrigger: { trigger: sec, start: "top top", end: "+=" + (dist), scrub: true, pin: true, anticipatePin: 1 }
                });
            } else if (mode === "steps") {
                var kids = sec.querySelectorAll(".lime-block__children > .lime-block");
                if (!kids.length) return;
                gsap.set(kids, { opacity: 0.25, y: 30 });
                var tl = gsap.timeline({
                    scrollTrigger: { trigger: sec, start: "top top", end: "+=" + (len * window.innerHeight), scrub: true, pin: true, anticipatePin: 1 }
                });
                Array.prototype.forEach.call(kids, function (k) {
                    tl.to(k, { opacity: 1, y: 0, duration: 1 });
                });
            } else { // pin
                ScrollTrigger.create({ trigger: sec, start: "top top", end: "+=" + (len * window.innerHeight), pin: true, anticipatePin: 1 });
            }
        });
    }

    // Публичная страница: reveal каждого блока при входе в вьюпорт (одноразово) + движение.
    function initScroll() {
        initSticky(); // не зависит от gsap
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
        initParallax();
        initMarquee(document);
        initScenes();
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

    window.LimeAnim = {
        PRESETS: PRESETS, initScroll: initScroll, play: play,
        initParallax: initParallax, initMarquee: initMarquee, initSticky: initSticky, initScenes: initScenes
    };

    // Авто-старт reveal только вне редактора (на публичной странице .lime-editor отсутствует).
    if (!document.querySelector(".lime-editor")) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initScroll);
        } else {
            initScroll();
        }
    }
})();
