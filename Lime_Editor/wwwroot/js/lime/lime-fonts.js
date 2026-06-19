/*
 * Lime Fonts (1.2) — курируемая библиотека Google Fonts для конструктора.
 *
 * Один источник правды для UI-пикера (тема + пер-блок) и для живой загрузки в редакторе.
 * Каждый шрифт: n=имя, s=CSS font-family стек (идёт в styles.fontFamily / theme.font),
 * p=параметр Google css2 (с реально доступными у шрифта начертаниями), c=категория.
 *
 * Загрузка на публикации — на стороне сервера (PublishedPageBuilder.BuildFontsLink
 * сканирует CSS на имена и подключает <link>). Список ИМЁН там обязан совпадать с этим.
 *
 * UMD: браузер (window.LimeFonts) + node (require) для тестов.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeFonts = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Курируемый список популярных Google Fonts. ВАЖНО: при правке — синхронизируй
    // имена с PublishedPageBuilder.FontFamilies (C#), иначе шрифт не подключится на публикации.
    var FONTS = [
        // — Без засечек —
        { n: "Inter", s: "'Inter', system-ui, sans-serif", p: "Inter:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Roboto", s: "'Roboto', sans-serif", p: "Roboto:wght@400;500;700;900", c: "Без засечек" },
        { n: "Open Sans", s: "'Open Sans', sans-serif", p: "Open+Sans:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Montserrat", s: "'Montserrat', sans-serif", p: "Montserrat:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Poppins", s: "'Poppins', sans-serif", p: "Poppins:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Manrope", s: "'Manrope', sans-serif", p: "Manrope:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Lato", s: "'Lato', sans-serif", p: "Lato:wght@400;700;900", c: "Без засечек" },
        { n: "Nunito", s: "'Nunito', sans-serif", p: "Nunito:wght@400;600;700;800", c: "Без засечек" },
        { n: "Raleway", s: "'Raleway', sans-serif", p: "Raleway:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Work Sans", s: "'Work Sans', sans-serif", p: "Work+Sans:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "DM Sans", s: "'DM Sans', sans-serif", p: "DM+Sans:wght@400;500;700", c: "Без засечек" },
        { n: "Space Grotesk", s: "'Space Grotesk', sans-serif", p: "Space+Grotesk:wght@400;500;600;700", c: "Без засечек" },
        { n: "Onest", s: "'Onest', sans-serif", p: "Onest:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Rubik", s: "'Rubik', sans-serif", p: "Rubik:wght@400;500;600;700;800", c: "Без засечек" },
        { n: "Mulish", s: "'Mulish', sans-serif", p: "Mulish:wght@400;600;700;800", c: "Без засечек" },
        { n: "Plus Jakarta Sans", s: "'Plus Jakarta Sans', sans-serif", p: "Plus+Jakarta+Sans:wght@400;500;600;700;800", c: "Без засечек" },
        // — С засечками —
        { n: "Playfair Display", s: "'Playfair Display', serif", p: "Playfair+Display:wght@400;500;600;700;800", c: "С засечками" },
        { n: "Merriweather", s: "'Merriweather', serif", p: "Merriweather:wght@400;700;900", c: "С засечками" },
        { n: "Lora", s: "'Lora', serif", p: "Lora:wght@400;500;600;700", c: "С засечками" },
        { n: "PT Serif", s: "'PT Serif', serif", p: "PT+Serif:wght@400;700", c: "С засечками" },
        { n: "Cormorant Garamond", s: "'Cormorant Garamond', serif", p: "Cormorant+Garamond:wght@400;500;600;700", c: "С засечками" },
        { n: "EB Garamond", s: "'EB Garamond', serif", p: "EB+Garamond:wght@400;500;600;700", c: "С засечками" },
        { n: "Bitter", s: "'Bitter', serif", p: "Bitter:wght@400;500;600;700;800", c: "С засечками" },
        { n: "Instrument Serif", s: "'Instrument Serif', Georgia, serif", p: "Instrument+Serif:ital@0;1", c: "С засечками" },
        // — Дисплейные —
        { n: "Unbounded", s: "'Unbounded', sans-serif", p: "Unbounded:wght@400;500;600;700;800", c: "Дисплейные" },
        { n: "Bebas Neue", s: "'Bebas Neue', sans-serif", p: "Bebas+Neue", c: "Дисплейные" },
        { n: "Oswald", s: "'Oswald', sans-serif", p: "Oswald:wght@400;500;600;700", c: "Дисплейные" },
        { n: "Archivo", s: "'Archivo', sans-serif", p: "Archivo:wght@400;500;600;700;800", c: "Дисплейные" },
        { n: "Comfortaa", s: "'Comfortaa', sans-serif", p: "Comfortaa:wght@400;500;600;700", c: "Дисплейные" },
        { n: "Righteous", s: "'Righteous', sans-serif", p: "Righteous", c: "Дисплейные" },
        // — Рукописные —
        { n: "Caveat", s: "'Caveat', cursive", p: "Caveat:wght@400;500;600;700", c: "Рукописные" },
        { n: "Dancing Script", s: "'Dancing Script', cursive", p: "Dancing+Script:wght@400;500;600;700", c: "Рукописные" },
        { n: "Pacifico", s: "'Pacifico', cursive", p: "Pacifico", c: "Рукописные" },
        { n: "Lobster", s: "'Lobster', cursive", p: "Lobster", c: "Рукописные" },
        // — Моноширинные —
        { n: "JetBrains Mono", s: "'JetBrains Mono', monospace", p: "JetBrains+Mono:wght@400;500;600;700", c: "Моноширинные" },
        { n: "Fira Code", s: "'Fira Code', monospace", p: "Fira+Code:wght@400;500;600;700", c: "Моноширинные" },
        { n: "IBM Plex Mono", s: "'IBM Plex Mono', monospace", p: "IBM+Plex+Mono:wght@400;500;600;700", c: "Моноширинные" },
        { n: "Space Mono", s: "'Space Mono', monospace", p: "Space+Mono:wght@400;700", c: "Моноширинные" }
    ];

    // Системные стеки — без загрузки (есть на любой ОС).
    var SYSTEM = [
        { n: "Системный", s: "system-ui, -apple-system, sans-serif" },
        { n: "Georgia", s: "Georgia, 'Times New Roman', serif" }
    ];

    var byStack = {}, byName = {};
    FONTS.forEach(function (f) { byStack[f.s] = f; byName[f.n] = f; });

    // Группы для UI-пикера: [{ label, items:[{n,s}] }] в порядке категорий + системные.
    var CATS = ["Без засечек", "С засечками", "Дисплейные", "Рукописные", "Моноширинные"];
    var GROUPS = CATS.map(function (cat) {
        return { label: cat, items: FONTS.filter(function (f) { return f.c === cat; }) };
    });
    GROUPS.push({ label: "Системные", items: SYSTEM });

    function paramOf(name) { return byName[name] ? byName[name].p : null; }

    // URL css2 для набора имён (только реальные Google-шрифты из списка).
    function href(names) {
        var params = [];
        (names || []).forEach(function (n) { var p = paramOf(n); if (p && params.indexOf(p) < 0) params.push(p); });
        if (!params.length) return "";
        return "https://fonts.googleapis.com/css2?family=" + params.join("&family=") + "&display=swap";
    }

    var loaded = {}; // dedupe инъекций в редакторе

    // Подключает <link> для шрифта в head (живое превью). Браузер-онли, идемпотентно.
    function ensure(name) {
        if (typeof document === "undefined") return;
        var f = byName[name];
        if (!f || loaded[name]) return;
        loaded[name] = true;
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=" + f.p + "&display=swap";
        link.setAttribute("data-lime-font", name);
        document.head.appendChild(link);
    }
    // По CSS-стеку (значение fontFamily/theme.font) находит шрифт и грузит его.
    // Сначала точное совпадение стека; иначе — по имени первого семейства (устойчиво к
    // старым докам, где стек мог отличаться хвостом вроде system-ui).
    function ensureFromStack(stack) {
        if (!stack) return;
        var f = byStack[stack];
        if (!f) {
            var m = String(stack).match(/'([^']+)'/) || String(stack).match(/^\s*([^,]+)/);
            if (m) f = byName[m[1].trim()];
        }
        if (f) ensure(f.n);
    }

    return {
        FONTS: FONTS, SYSTEM: SYSTEM, GROUPS: GROUPS,
        paramOf: paramOf, href: href, ensure: ensure, ensureFromStack: ensureFromStack
    };
});
