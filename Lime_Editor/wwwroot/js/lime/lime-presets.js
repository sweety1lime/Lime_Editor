/*
 * Lime Presets (Фаза 3.1) — курируемые готовые секции «в один клик».
 *
 * Каждый пресет — массив блок-спеков (тот же формат, что у AI-materialize):
 *   { type, content, styles, css, anim, animDelay, parallax, marquee, layers, children }
 * Вставляются через blockFromSpec() редактора (общий путь с AI). Стили/анимация/слои
 * уже зашиты — не-дизайнер получает «дорогую» секцию и правит только текст/картинки.
 *
 * Браузер-онли (window.LimePresets) — данные редактора, в Jint не исполняются.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimePresets = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // ----- мелкие конструкторы повторяющихся карточек -----
    function pricingCard(title, price, desc, cta, featured) {
        return {
            type: "container",
            styles: {
                base: {
                    backgroundColor: featured ? "var(--lt-accent)" : "var(--lt-bg)",
                    color: featured ? "#0b0e0a" : "var(--lt-fg)",
                    padding: "32px 24px", borderRadius: "20px", textAlign: "center",
                    border: featured ? "none" : "1px solid rgba(127,127,127,0.18)",
                    boxShadow: featured ? "0 18px 50px rgba(0,0,0,.30)" : "none"
                }
            },
            children: [
                { type: "heading", content: { text: title }, styles: { base: { fontSize: "20px", textAlign: "center" } } },
                { type: "heading", content: { text: price }, styles: { base: { fontSize: "44px", textAlign: "center" } } },
                { type: "text", content: { text: desc }, styles: { base: { textAlign: "center", opacity: "0.8" } } },
                { type: "buttonGroup", content: { primary: cta, secondary: "" } }
            ]
        };
    }
    function testimonialCard(quote, author) {
        return {
            type: "container",
            styles: { base: { backgroundColor: "var(--lt-bg)", padding: "28px 24px", borderRadius: "18px", border: "1px solid rgba(127,127,127,0.16)" } },
            children: [
                { type: "text", content: { text: quote }, styles: { base: { fontSize: "18px", lineHeight: "1.5" } } },
                { type: "text", content: { text: author }, styles: { base: { fontSize: "14px", opacity: "0.7", fontWeight: "700" } } }
            ]
        };
    }
    function teamCard(name, role) {
        return {
            type: "container",
            styles: { base: { textAlign: "center", padding: "16px" } },
            children: [
                { type: "image", content: { src: "", alt: name }, styles: { base: { borderRadius: "18px" } } },
                { type: "heading", content: { text: name }, styles: { base: { fontSize: "20px", textAlign: "center", padding: "12px 0 2px" } } },
                { type: "text", content: { text: role }, styles: { base: { textAlign: "center", opacity: "0.7" } } }
            ]
        };
    }
    function qa(q, a) {
        return {
            type: "container",
            styles: { base: { padding: "18px 0", borderBottom: "1px solid rgba(127,127,127,0.16)" } },
            children: [
                { type: "heading", content: { text: q }, styles: { base: { fontSize: "20px" } } },
                { type: "text", content: { text: a }, styles: { base: { opacity: "0.8" } } }
            ]
        };
    }
    function sectionHeading(text) {
        return { type: "heading", content: { text: text }, styles: { base: { textAlign: "center", fontSize: "40px", padding: "56px 24px 8px" } }, anim: "fade-up" };
    }

    var PRESETS = {
        hero: [{
            type: "cover",
            content: {
                uptitle: "НОВИНКА 2026", title: "Запусти продукт, который полюбят",
                desc: "Соберите красивый сайт за вечер — без кода и без дизайнера.", cta: "Начать бесплатно →",
                bg: { overlay: "rgba(8,10,7,0.40)" }
            },
            styles: {
                base: { backgroundImage: "linear-gradient(135deg, var(--lt-accent) 0%, var(--lt-accent2) 100%)", color: "#ffffff", padding: "120px 48px", minHeight: "560px", textAlign: "center", borderRadius: "24px" },
                mobile: { padding: "64px 20px", minHeight: "420px", fontSize: "32px" }
            },
            anim: "fade-up", animDuration: "0.9",
            layers: [
                { kind: "shape", shape: "blob", color: "rgba(255,255,255,0.12)", x: 70, y: 6, w: 340, z: 0, depth: 0.4, blur: 8 },
                { kind: "shape", shape: "circle", color: "rgba(167,139,250,0.30)", x: 4, y: 58, w: 240, z: 0, depth: 0.25, blur: 36 }
            ]
        }],

        features: [
            sectionHeading("Почему выбирают нас"),
            { type: "features", styles: { base: { padding: "16px 24px 64px" } }, anim: "fade-up", animDelay: "150" }
        ],

        stats: [{
            type: "stats",
            styles: { base: { backgroundImage: "linear-gradient(135deg, var(--lt-accent) 0%, var(--lt-accent2) 100%)", color: "#ffffff", padding: "64px 32px", borderRadius: "24px" } },
            anim: "zoom"
        }],

        pricing: [
            sectionHeading("Простые тарифы"),
            { type: "pricing", content: { width: "boxed" }, styles: { base: { padding: "8px 24px 72px" } }, anim: "fade-up" }
        ],

        testimonials: [
            sectionHeading("Нам доверяют"),
            { type: "testimonials", content: { width: "boxed" }, styles: { base: { padding: "8px 24px 72px" } }, anim: "fade-up" }
        ],

        team: [
            sectionHeading("Команда"),
            {
                type: "columns", content: { cols: 3 }, styles: { base: { padding: "16px 24px 64px" } }, anim: "fade-up",
                children: [teamCard("Имя Фамилия", "CEO"), teamCard("Имя Фамилия", "Дизайн"), teamCard("Имя Фамилия", "Разработка")]
            }
        ],

        faq: [
            sectionHeading("Частые вопросы"),
            { type: "accordion", styles: { base: { padding: "8px 24px 72px" } }, anim: "fade-up" }
        ],

        cta: [{
            type: "cta",
            content: { title: "Готовы начать?", desc: "Присоединяйтесь к тысячам команд уже сегодня.", btn: "Создать сайт →" },
            styles: {
                base: {
                    backgroundImage: "radial-gradient(at 20% 20%, var(--lt-accent2) 0px, transparent 50%), radial-gradient(at 80% 30%, var(--lt-accent) 0px, transparent 50%), var(--lt-fg)",
                    color: "var(--lt-bg)", padding: "88px 32px", textAlign: "center", borderRadius: "24px"
                }
            },
            anim: "fade-up"
        }],

        footer: [
            { type: "footer", styles: { base: { padding: "56px 32px", backgroundColor: "var(--lt-bg)" } } }
        ],

        // ----- новые секции (Фаза 7): на выделенных блоках 6.1 + макет/эффекты -----
        navbar: [
            { type: "navbar", styles: { base: { padding: "16px 32px" } }, sticky: true, fx: ["glass"] }
        ],

        steps: [
            sectionHeading("Как это работает"),
            { type: "steps", content: { width: "boxed" }, styles: { base: { padding: "8px 24px 72px" } }, anim: "fade-up" }
        ],

        logos: [
            { type: "logos", styles: { base: { padding: "44px 24px" } }, anim: "fade-in" }
        ],

        split: [
            { type: "imageText", content: { width: "boxed", title: "Ключевая ценность", text: "Опиши, чем продукт полезен клиенту — в паре предложений." }, styles: { base: { padding: "64px 24px" } }, anim: "fade-up" }
        ],

        contact: [
            sectionHeading("Свяжитесь с нами"),
            { type: "form", styles: { base: { padding: "8px 24px 72px" } }, anim: "fade-up" }
        ]
    };

    // Метаданные для плиток сайдбара (иконка + подпись + порядок).
    var META = [
        { key: "navbar", icon: "≣", label: "Навбар" },
        { key: "hero", icon: "★", label: "Hero" },
        { key: "logos", icon: "◫", label: "Логотипы" },
        { key: "features", icon: "✦", label: "Фичи" },
        { key: "stats", icon: "#", label: "Цифры" },
        { key: "steps", icon: "⇉", label: "Шаги" },
        { key: "split", icon: "◧", label: "Картинка+текст" },
        { key: "pricing", icon: "₽", label: "Тарифы" },
        { key: "testimonials", icon: "❝", label: "Отзывы" },
        { key: "team", icon: "☺", label: "Команда" },
        { key: "faq", icon: "?", label: "FAQ" },
        { key: "contact", icon: "✉", label: "Контакты" },
        { key: "cta", icon: "◉", label: "Призыв" },
        { key: "footer", icon: "▭", label: "Подвал" }
    ];

    return { PRESETS: PRESETS, META: META };
});
