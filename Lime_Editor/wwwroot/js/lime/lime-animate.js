/*
 * Lime scroll-анимации (GSAP + ScrollTrigger).
 *
 * Один файл на двух поверхностях:
 *  - Опубликованная страница (/u/...): авто-reveal блоков по скроллу (initScroll).
 *  - Редактор (.lime-editor на странице): авто-старт НЕ происходит; кнопка «▶ Превью»
 *    вызывает LimeAnim.play(workspace) для одноразового проигрывания.
 *
 * Анимация блока задаётся data-атрибутами на <section class="lime-block">:
 *   data-anim="fade-up|fade-in|zoom|slide-left|slide-right|split-lines|split-words|split-chars"
 *   data-anim-delay="<мс>"      (необязательно)
 *   data-anim-duration="<сек>"  (необязательно)
 *   data-anim-stagger="<сек>"   (на контейнере: дети проявляются каскадом одной timeline)
 *
 * split-* разбивает заголовок блока через SplitType (vendor, шипится по маркеру) и проявляет
 * по строкам/словам/буквам; без SplitType деградирует в обычный fade-up.
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
    // Split-типографика: режим → SplitType-типы и шаг каскада (сек между частями).
    var SPLIT_MODES = {
        "split-lines": { types: "lines", stagger: 0.12 },
        "split-words": { types: "words", stagger: 0.05 },
        "split-chars": { types: "words,chars", stagger: 0.018 }
    };

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
    // Прямой ребёнок с классом — вместо :scope-селекторов (Jint/старые браузеры не при чём,
    // но так дешевле и однозначно берём именно СВОЮ обёртку, а не вложенного контейнера).
    function directChild(el, cls) {
        for (var i = 0; i < el.children.length; i++) {
            if (el.children[i].classList.contains(cls)) return el.children[i];
        }
        return null;
    }

    // Split-типографика (Премиум-слой A1): разбиваем заголовок блока на строки/слова/буквы
    // и проявляем каскадом. Возвращает true, если блок обработан; false → вызывающий код
    // деградирует в обычный reveal (нет SplitType, нет текста, split упал).
    function initSplit(el) {
        var mode = SPLIT_MODES[el.getAttribute("data-anim")];
        if (!mode || !window.SplitType) return false;
        var inner = directChild(el, "lime-block__inner") || el;
        var t = inner.querySelector(".lime-block__heading, .lime-block__cover-title, h1, h2, h3") ||
            inner.querySelector(".lime-block__text");
        if (!t || !t.textContent || !t.textContent.trim()) return false;
        var label = t.textContent;
        var split, parts;
        try {
            split = new SplitType(t, { types: mode.types });
            parts = mode.types === "lines" ? split.lines : (mode.types === "words" ? split.words : split.chars);
        } catch (e) { return false; }
        if (!parts || !parts.length) return false;
        // Доступность: скринридер читает целый текст из aria-label, спаны-осколки скрыты.
        t.setAttribute("aria-label", label);
        for (var i = 0; i < t.children.length; i++) t.children[i].setAttribute("aria-hidden", "true");
        t.classList.add("lime-split");
        gsap.from(parts, {
            yPercent: 110, opacity: 0,
            duration: durOf(el),
            delay: delayOf(el),
            ease: "power3.out",
            stagger: mode.stagger,
            scrollTrigger: { trigger: el, start: "top 85%", once: true }
        });
        return true;
    }

    // Каскад-группы (Премиум-слой A2): контейнер с data-anim-stagger проявляет ПРЯМЫХ детей
    // одной timeline с шагом. Пресет — data-anim контейнера (сам контейнер при этом не
    // reveal-ится, его anim описывает детей); дети теряют личный data-anim, чтобы не дублировать.
    function initStagger() {
        Array.prototype.forEach.call(document.querySelectorAll("[data-anim-stagger]"), function (sec) {
            if (sec.getAttribute("data-scene")) return; // сцены сами хореографят детей
            var inner = directChild(sec, "lime-block__inner");
            var wrap = inner && directChild(inner, "lime-block__children");
            if (!wrap || !wrap.children.length) return;
            var step = parseFloat(sec.getAttribute("data-anim-stagger")) || 0.08;
            var preset = PRESETS[sec.getAttribute("data-anim")] || PRESETS["fade-up"];
            var items = [];
            for (var i = 0; i < wrap.children.length; i++) {
                wrap.children[i].removeAttribute("data-anim");
                items.push(wrap.children[i]);
            }
            sec.removeAttribute("data-anim");
            gsap.from(items, Object.assign({}, preset, {
                duration: durOf(sec),
                delay: delayOf(sec),
                ease: EASE,
                stagger: step,
                scrollTrigger: { trigger: sec, start: "top 80%", once: true }
            }));
        });
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
        initStagger(); // до одиночных reveal: снимает data-anim с каскадящихся детей
        animEls(document).forEach(function (el) {
            var anim = el.getAttribute("data-anim");
            if (SPLIT_MODES[anim] && initSplit(el)) return;
            // split-* без SplitType (не подгрузился) — деградация в fade-up.
            var from = fromVars(el) || (SPLIT_MODES[anim] ? PRESETS["fade-up"] : null);
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
    // split-* здесь проигрывается как fade-up: SplitType в редактор не грузим, чтобы
    // не мутировать DOM холста (contenteditable-текст порезался бы на спаны).
    function play(scope) {
        if (!window.gsap || reduced()) return;
        animEls(scope).forEach(function (el, i) {
            var from = fromVars(el) || (SPLIT_MODES[el.getAttribute("data-anim")] ? PRESETS["fade-up"] : null);
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
    // При включённом прелоадере (data-lime-loader) ждём "lime:loader-done" от lime-loader.js,
    // чтобы hero-хореография сыграла после подъёма шторки (страховочный таймаут — если лоадер
    // не отработал, reveal всё равно стартует и контент не остаётся спрятанным).
    var autoStarted = false;
    function startOnce() {
        if (autoStarted) return;
        autoStarted = true;
        initScroll();
    }
    function autoStart() {
        if (document.querySelector("[data-lime-loader]") && !window.__limeLoaderDone) {
            document.addEventListener("lime:loader-done", startOnce, { once: true });
            setTimeout(startOnce, 6000);
        } else {
            startOnce();
        }
    }
    if (!document.querySelector(".lime-editor")) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", autoStart);
        } else {
            autoStart();
        }
    }
})();
