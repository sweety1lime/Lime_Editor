/*
 * Lime Experience Packs (план experience-builder-plan.md, Milestone 1) — тонкий слой
 * поверх `LimeTemplates`: пак хранит ТОЛЬКО новые поля (category/level/assetSlots/
 * motionProfile/preview), а name/theme/sections резолвятся из совпадающего по `key`
 * шаблона в LimeTemplates. Не дублируем данные — улучшил шаблон, улучшился пак.
 * Браузер-онли (window.LimeExperiencePacks).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeExperiencePacks = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var LIST = [
        {
            key: "neo-lore-drop",
            category: "showcase",
            level: "pro",
            preview: "Cinematic creator/Web3/game drop with a real embedded 3D scene.",
            assetSlots: [
                { slot: "hero-scene", label: "Hero scene", hint: "Spline/Rive/Sketchfab embed URL" },
                { slot: "logo", label: "Logo", hint: "SVG/PNG, transparent background" },
                { slot: "customizer-scene", label: "Customizer scene", hint: "Swap-scene demo embed" }
            ],
            motionProfile: ["reveal", "horizontal-scene", "parallax-layers"]
        },
        {
            key: "studio-folio",
            category: "portfolio",
            level: "pro",
            preview: "Editorial creative-studio portfolio with a warm palette and a swappable reel embed.",
            assetSlots: [
                { slot: "hero-portrait", label: "Портрет/фото студии", hint: "Квадрат или 4:5, чёткий фокус, ≥1000px по короткой стороне" },
                { slot: "reel-embed", label: "Демо-рил", hint: "YouTube/Vimeo embed URL — короткое видео с примерами работ" },
                { slot: "logo", label: "Логотип", hint: "SVG/PNG, прозрачный фон, для навбара" }
            ],
            motionProfile: ["reveal", "marquee-strip", "parallax-layers"]
        }
    ];

    // Смотрит LimeTemplates (передаётся явно — на случай, если в тестовом окружении нет
    // global window) и мёржит name/desc/theme/sections в объект пака. null для чужого key.
    function resolve(key, templates) {
        var list = templates || (typeof window !== "undefined" ? window.LimeTemplates : null) || [];
        var pack = null;
        for (var i = 0; i < LIST.length; i++) {
            if (LIST[i].key === key) { pack = LIST[i]; break; }
        }
        if (!pack) return null;
        var tpl = null;
        for (var j = 0; j < list.length; j++) {
            if (list[j].key === key) { tpl = list[j]; break; }
        }
        if (!tpl) return null;
        var out = {};
        for (var k in pack) if (Object.prototype.hasOwnProperty.call(pack, k)) out[k] = pack[k];
        out.name = tpl.name;
        out.desc = tpl.desc;
        out.theme = tpl.theme;
        out.sections = tpl.sections;
        return out;
    }

    return { LIST: LIST, resolve: resolve };
});
