/* Lime editor onboarding coachmark tour (этап 9.4). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorOnboarding = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var TOUR_KEY = "lime-onboarding-seen";
    var TOUR_STEPS = [
        { sel: ".lime-editor__sidebar", title: "Блоки", text: "Кликай блок в этой панели — он добавится на холст. Перетаскиванием меняешь порядок." },
        { sel: "#lime-doc-workspace", title: "Холст", text: "Выбирай элемент кликом, двигай и меняй размер мышью. Ctrl+Z отменяет любое действие." },
        { sel: "#lime-doc-inspector", title: "Инспектор", text: "Здесь правишь стили выбранного блока: цвета, отступы, типографику — без кода." },
        { sel: "[data-doc-save]", title: "Публикация", text: "Готово? Нажми эту кнопку, чтобы опубликовать сайт. Изменения автосохраняются по ходу." }
    ];

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : null);
        if (!doc || !win) return { run: function () {}, maybeAutoRun: function () {} };

        function seen() {
            try { return !!win.localStorage.getItem(TOUR_KEY); } catch (e) { return false; /* приватный режим */ }
        }

        function run() {
            var step = 0, spot = null;
            var card = doc.createElement("div");
            card.className = "lime-tour-card";
            card.setAttribute("data-doc-tour", "");
            card.setAttribute("role", "dialog");
            card.setAttribute("aria-label", "Знакомство с редактором");
            doc.body.appendChild(card);
            function clearSpot() { if (spot) { spot.classList.remove("lime-tour-spot"); spot = null; } }
            function finish() {
                clearSpot();
                card.remove();
                try { win.localStorage.setItem(TOUR_KEY, "1"); } catch (e) { /* приватный режим */ }
            }
            function show() {
                clearSpot();
                var s = TOUR_STEPS[step];
                spot = doc.querySelector(s.sel);
                if (spot) {
                    spot.classList.add("lime-tour-spot");
                    spot.scrollIntoView({ block: "nearest", inline: "nearest" });
                }
                var last = step === TOUR_STEPS.length - 1;
                card.innerHTML =
                    '<div class="lime-tour-card__step">Шаг ' + (step + 1) + " из " + TOUR_STEPS.length + '</div>' +
                    '<div class="lime-tour-card__title">' + s.title + '</div>' +
                    '<div class="lime-tour-card__text">' + s.text + '</div>' +
                    '<div class="lime-tour-card__actions">' +
                        '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-tour-skip>Пропустить</button>' +
                        '<button type="button" class="lime-btn lime-btn--primary lime-btn--sm" data-tour-next>' + (last ? "Готово" : "Далее") + '</button>' +
                    '</div>';
            }
            card.addEventListener("click", function (e) {
                if (e.target.closest("[data-tour-skip]")) { finish(); return; }
                if (e.target.closest("[data-tour-next]")) {
                    if (step >= TOUR_STEPS.length - 1) { finish(); return; }
                    step++; show();
                }
            });
            show();
        }

        // Авто-показ один раз. forced (?tour=1) игнорирует флаг «уже видел». hasContent —
        // документ не пуст (иначе тур перехватывает intro-оверлей). onForce — скрыть intro при форсе.
        function maybeAutoRun(opts) {
            opts = opts || {};
            if (opts.forced || (!seen() && opts.hasContent)) {
                if (opts.forced && typeof opts.onForce === "function") opts.onForce();
                run();
            }
        }

        return { run: run, maybeAutoRun: maybeAutoRun };
    }

    return { create: create };
});
