/* Lime editor intro overlay (стартовый промпт для пустого документа). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorIntro = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Оверлей с промптом на пустом новом документе: ввод → AI-генерация (runGenerate),
    // чипы-подсказки, Ctrl/Cmd+Enter. Внешние зависимости инжектятся: totalBlocks (пуст ли
    // документ) и runGenerate (запуск генерации). Возвращает { hide } — чтобы onboarding-тур
    // мог спрятать оверлей при форсе (?tour=1).
    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var totalBlocks = options.totalBlocks || function () { return 0; };
        var runGenerate = options.runGenerate || function () {};

        var introEl = doc ? doc.getElementById("lime-doc-intro") : null;

        // Плавное скрытие (skip/успешная генерация): фейд 480 мс, затем снятие классов.
        function hide() {
            if (!introEl) return;
            introEl.classList.add("is-hidden");
            setTimeout(function () { introEl.classList.remove("is-on", "is-hidden"); }, 480);
        }

        // Мгновенное снятие (форс тура ?tour=1): без анимации, иначе тур стартует поверх
        // исчезающего оверлея и перехватывает клики.
        function dismiss() {
            if (introEl) introEl.classList.remove("is-on");
        }

        if (introEl) {
            var introPrompt = doc.getElementById("lime-doc-intro-prompt");
            var introMsg = doc.getElementById("lime-doc-intro-msg");
            var introGo = doc.getElementById("lime-doc-intro-go");
            var introSkip = doc.getElementById("lime-doc-intro-skip");
            var introChips = doc.getElementById("lime-doc-intro-chips");
            var introRun = function () {
                if (introMsg) { introMsg.textContent = ""; introMsg.classList.remove("is-error"); }
                runGenerate(introPrompt ? introPrompt.value : "", {
                    btn: introGo,
                    onError: function (m) { if (introMsg) { introMsg.textContent = m; introMsg.classList.add("is-error"); } },
                    onSuccess: hide
                });
            };
            if (introGo) introGo.addEventListener("click", introRun);
            if (introSkip) introSkip.addEventListener("click", hide);
            if (introChips) introChips.addEventListener("click", function (e) {
                var c = e.target.closest(".lime-le-chip");
                if (c && introPrompt) { introPrompt.value = c.textContent.trim(); introPrompt.focus(); }
            });
            if (introPrompt) introPrompt.addEventListener("keydown", function (e) {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); introRun(); }
            });
            // Показываем только на пустом новом документе.
            if (totalBlocks() === 0) {
                introEl.classList.add("is-on");
                if (introPrompt) setTimeout(function () { introPrompt.focus(); }, 100);
            }
        }

        return { hide: hide, dismiss: dismiss };
    }

    return { create: create };
});
