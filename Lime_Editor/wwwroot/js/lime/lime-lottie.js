/*
 * Lime Lottie (медиа-волна) — нативный проигрыватель Lottie-анимаций опубликованной страницы.
 *
 * Работает поверх self-hosted lottie_light (vendor, SVG-рендерер). Блок эмитит
 * <div data-lime-lottie data-src="/media/..." data-loop data-speed data-mode>:
 *  - mode отсутствует (auto) — автоплей;
 *  - mode="hover"  — играет, пока курсор над анимацией (на тач-устройствах — автоплей);
 *  - mode="scroll" — кадр привязан к прогрессу скролла секции (ScrollTrigger, если он
 *    на странице; без него — деградация в автоплей).
 *
 * src принимается ТОЛЬКО same-origin ("/media/...") — внешние URL остаются embed-блоку
 * (sandbox-iframe); это же держит CSP connect-src 'self'. prefers-reduced-motion —
 * анимация не запускается, показывается статичный первый кадр.
 */
(function () {
    "use strict";

    if (document.querySelector(".lime-editor")) return; // только публичная страница
    if (!window.lottie) return;

    var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var coarse = !!(window.matchMedia && window.matchMedia("(hover: none)").matches);

    function init(el) {
        var src = el.getAttribute("data-src") || "";
        if (src.charAt(0) !== "/" || src.indexOf("//") === 0) return; // только same-origin
        var mode = el.getAttribute("data-mode") || "auto";
        if (coarse && mode === "hover") mode = "auto"; // ховера нет — деградация
        var loop = el.getAttribute("data-loop") === "1";
        var speed = parseFloat(el.getAttribute("data-speed"));

        var anim = window.lottie.loadAnimation({
            container: el,
            renderer: "svg",
            loop: loop,
            autoplay: !reduced && mode === "auto",
            path: src
        });
        if (!isNaN(speed) && speed > 0) anim.setSpeed(speed);

        if (reduced) {
            // Статичный первый кадр вместо движения.
            anim.addEventListener("DOMLoaded", function () { anim.goToAndStop(0, true); });
            return;
        }

        if (mode === "hover") {
            anim.addEventListener("DOMLoaded", function () { anim.goToAndStop(0, true); });
            el.addEventListener("mouseenter", function () { anim.play(); });
            el.addEventListener("mouseleave", function () { anim.pause(); });
            return;
        }

        if (mode === "scroll") {
            if (window.gsap && window.ScrollTrigger) {
                var host = el.closest(".lime-block") || el;
                anim.addEventListener("DOMLoaded", function () {
                    var frames = Math.max(1, anim.totalFrames - 1);
                    window.ScrollTrigger.create({
                        trigger: host,
                        start: "top bottom",
                        end: "bottom top",
                        scrub: true,
                        onUpdate: function (self) {
                            anim.goToAndStop(self.progress * frames, true);
                        }
                    });
                });
            } else {
                anim.play(); // без ScrollTrigger — деградация в автоплей
            }
            return;
        }
    }

    function initAll() {
        Array.prototype.forEach.call(document.querySelectorAll("[data-lime-lottie]"), init);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAll);
    else initAll();
})();
