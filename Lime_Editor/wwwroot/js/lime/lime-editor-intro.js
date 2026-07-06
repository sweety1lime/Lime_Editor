/* Lime editor intro overlay (стартовый промпт для пустого документа). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorIntro = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Оверлей с промптом на пустом новом документе: ввод → AI-генерация (runGenerate),
    // чипы-подсказки, Ctrl/Cmd+Enter, плюс вторичная панель Experience Packs (Milestone 1
    // experience-builder-plan.md) — applyPack(key) вместо навигации на ?template=key.
    // Внешние зависимости инжектятся: totalBlocks (пуст ли документ), runGenerate (запуск
    // генерации), packs (LimeExperiencePacks), applyPack (применить пак по key). Возвращает
    // { hide } — чтобы onboarding-тур мог спрятать оверлей при форсе (?tour=1).
    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var totalBlocks = options.totalBlocks || function () { return 0; };
        var runGenerate = options.runGenerate || function () {};
        var packs = options.packs || { LIST: [], resolve: function () { return null; } };
        var applyPack = options.applyPack || function () {};

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

        // Документ перестал быть пустым мимо intro (палитра/DnD/командная палитра/шаблон) —
        // оверлей обязан уйти сам, иначе холст с новым блоком остаётся накрыт.
        function maybeHide() {
            if (introEl && introEl.classList.contains("is-on") && totalBlocks() > 0) hide();
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

            // Experience Packs: вторичная панель "или начни с готового пака" — applyPack(key)
            // применяет тему+секции мгновенно на холсте, без ?template=key и перезагрузки.
            var introPacks = doc.getElementById("lime-doc-intro-packs");
            if (introPacks && packs.LIST && packs.LIST.length) {
                introPacks.innerHTML = packs.LIST.map(function (p) {
                    var full = packs.resolve(p.key);
                    if (!full) return "";
                    var grad = "linear-gradient(135deg," + full.theme.accent + "," + full.theme.accent2 + ")";
                    return '<button type="button" class="lime-le-pack-tile" data-doc-pack="' + p.key + '">' +
                        '<span class="lime-le-pack-tile__swatch" style="background:' + grad + '"></span>' +
                        '<span class="lime-le-pack-tile__body">' +
                        '<span class="lime-le-pack-tile__name">' + full.name + '</span>' +
                        '<span class="lime-le-pack-tile__preview">' + full.preview + '</span>' +
                        '</span></button>';
                }).join("");
                introPacks.addEventListener("click", function (e) {
                    var btn = e.target.closest("[data-doc-pack]");
                    if (!btn) return;
                    applyPack(btn.getAttribute("data-doc-pack"));
                    hide();
                });
            }

            // Показываем только на пустом новом документе.
            if (totalBlocks() === 0) {
                introEl.classList.add("is-on");
                if (introPrompt) setTimeout(function () { introPrompt.focus(); }, 100);
            }
        }

        return { hide: hide, dismiss: dismiss, maybeHide: maybeHide };
    }

    return { create: create };
});
