/*
 * Lime Assets (Фаза 1) — курируемая библиотека «арта» для конструктора.
 *
 * Пока — готовые фоновые пресеты (BG_PRESETS): значения CSS background-image
 * (линейные/mesh-градиенты, опц. с грейн-текстурой). Применяются как стиль-проп
 * backgroundImage выбранного блока — рендерер их не трогает (едут через styleDecls),
 * поэтому работают и в превью, и на публикации без изменений движка.
 *
 * Браузер-онли (window.LimeAssets) — это данные редактора, в Jint не исполняется.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeAssets = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Тонкий грейн как data-URI (feTurbulence) — кладётся первым слоем поверх градиента,
    // придаёт «дорогую» матовость. Не требует бинарных файлов.
    var GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")";

    function mesh(stops, base) {
        return stops.join(", ") + ", " + base;
    }

    // Каждый пресет — { name, css }. css идёт прямо в backgroundImage.
    var BG_PRESETS = [
        { name: "Aurora", css: "linear-gradient(135deg, #84cc16 0%, #38bdf8 100%)" },
        { name: "Spring", css: "linear-gradient(135deg, #c5f24e 0%, #2dd4bf 100%)" },
        { name: "Dusk", css: "linear-gradient(160deg, #6366f1 0%, #ec4899 100%)" },
        { name: "Ember", css: "linear-gradient(135deg, #fb7185 0%, #fbbf24 100%)" },
        { name: "Deep", css: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)" },
        {
            name: "Violet Mesh", css: mesh([
                "radial-gradient(at 18% 24%, #a78bfa 0px, transparent 50%)",
                "radial-gradient(at 82% 16%, #38bdf8 0px, transparent 50%)",
                "radial-gradient(at 46% 84%, #fb7185 0px, transparent 48%)"
            ], "#0d0b1a")
        },
        {
            name: "Lime Mesh", css: mesh([
                "radial-gradient(at 22% 20%, #c5f24e 0px, transparent 50%)",
                "radial-gradient(at 78% 30%, #2dd4bf 0px, transparent 50%)",
                "radial-gradient(at 50% 90%, #84cc16 0px, transparent 48%)"
            ], "#0b0e0a")
        },
        {
            name: "Sunset Mesh", css: mesh([
                "radial-gradient(at 16% 18%, #fb7185 0px, transparent 50%)",
                "radial-gradient(at 84% 22%, #fbbf24 0px, transparent 50%)",
                "radial-gradient(at 50% 88%, #a78bfa 0px, transparent 50%)"
            ], "#1a0f12")
        },
        {
            name: "Ocean Mesh", css: mesh([
                "radial-gradient(at 20% 25%, #2dd4bf 0px, transparent 50%)",
                "radial-gradient(at 80% 18%, #38bdf8 0px, transparent 50%)",
                "radial-gradient(at 55% 85%, #6366f1 0px, transparent 50%)"
            ], "#07171a")
        },
        {
            name: "Royal Grain", css: GRAIN + ", " + mesh([
                "radial-gradient(at 20% 20%, #6366f1 0px, transparent 50%)",
                "radial-gradient(at 80% 25%, #ec4899 0px, transparent 50%)"
            ], "#0a0a1f")
        },
        {
            name: "Ink Grain", css: GRAIN + ", linear-gradient(160deg, #11150f 0%, #0b0e0a 100%)"
        },
        {
            name: "Cream Grain", css: GRAIN + ", linear-gradient(160deg, #faf6ef 0%, #efe7d8 100%)"
        }
    ];

    return { BG_PRESETS: BG_PRESETS, GRAIN: GRAIN };
});
