/*
 * Lime Templates (Фаза 3.2) — полные стартовые шаблоны сайтов.
 *
 * Шаблон = палитра/шрифт (theme) + упорядоченный набор готовых секций (ключи из
 * LimePresets). При открытии /Home/EditDoc?template=<key> редактор применяет тему и
 * вставляет эти секции — пользователь получает целый «дорогой» сайт, который правит.
 *
 * Композиция из пресетов (а не дубль огромного doc JSON) — DRY: улучшил секцию —
 * улучшились все шаблоны. Браузер-онли (window.LimeTemplates).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeTemplates = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var TEMPLATES = [
        {
            key: "startup", name: "SaaS / Стартап", desc: "Продукт, тарифы и призыв — для запуска онлайн-сервиса.", style: "Тёмный",
            theme: { accent: "#6366f1", accent2: "#ec4899", bg: "#0a0a1f", fg: "#eef0ff", muted: "#8888aa", font: "'Space Grotesk', system-ui, sans-serif" },
            sections: ["navbar", "hero", "logos", "features", "stats", "pricing", "faq", "contact", "footer"]
        },
        {
            key: "agency", name: "Агентство / Студия", desc: "Услуги, отзывы и команда — для студии или агентства.", style: "Тёмный",
            theme: { accent: "#c5f24e", accent2: "#a78bfa", bg: "#0b0e0a", fg: "#eef1ea", muted: "#828c79", font: "'Unbounded', system-ui, sans-serif" },
            sections: ["navbar", "hero", "features", "split", "testimonials", "team", "cta", "footer"]
        },
        {
            key: "product", name: "Продукт / Бренд", desc: "Витрина возможностей с цифрами и отзывами.", style: "Тёмный",
            theme: { accent: "#2dd4bf", accent2: "#38bdf8", bg: "#07171a", fg: "#e6fbf8", muted: "#7fa7a3", font: "'Manrope', system-ui, sans-serif" },
            sections: ["navbar", "hero", "logos", "features", "stats", "split", "testimonials", "cta", "footer"]
        },
        {
            key: "personal", name: "Личный бренд / Коуч", desc: "О себе, частые вопросы и запись — для эксперта.", style: "Тёмный",
            theme: { accent: "#fb7185", accent2: "#fbbf24", bg: "#1a0f12", fg: "#fdeef0", muted: "#b08a90", font: "'Montserrat', system-ui, sans-serif" },
            sections: ["navbar", "hero", "split", "steps", "faq", "contact", "footer"]
        },
        {
            key: "event", name: "Событие / Конференция", desc: "Цифры, программа и регистрация на мероприятие.", style: "Тёмный",
            theme: { accent: "#a78bfa", accent2: "#38bdf8", bg: "#0d0b1a", fg: "#eceafb", muted: "#8b86a8", font: "'Onest', system-ui, sans-serif" },
            sections: ["navbar", "hero", "stats", "steps", "faq", "contact", "footer"]
        },
        {
            key: "portfolio", name: "Портфолио / Команда", desc: "Команда и отзывы — лёгкая визитка.", style: "Тёмный",
            theme: { accent: "#84cc16", accent2: "#22c55e", bg: "#0a140d", fg: "#eaf5ea", muted: "#7d9180", font: "'Inter', system-ui, sans-serif" },
            sections: ["navbar", "hero", "team", "testimonials", "contact", "footer"]
        },
        {
            key: "web3", name: "Web3 / Неон", desc: "Тёмный неон, стекло и свечение — для крипто/web3-проектов.", style: "Неон",
            theme: { accent: "#c5f24e", accent2: "#a78bfa", bg: "#07060f", fg: "#eef0ff", muted: "#8888aa", font: "'Unbounded', system-ui, sans-serif" },
            sections: ["navbar", "hero", "logos", "features", "stats", "pricing", "faq", "cta", "footer"]
        },
        {
            key: "minimal", name: "Минимализм", desc: "Светлый, чистый, много воздуха — для портфолио и контента.", style: "Светлый",
            theme: { accent: "#111111", accent2: "#6b7280", bg: "#ffffff", fg: "#14180f", muted: "#6b7280", font: "'Inter', system-ui, sans-serif" },
            sections: ["navbar", "hero", "features", "split", "faq", "contact", "footer"]
        },
        {
            key: "shop", name: "Магазин / Товар", desc: "Витрина товара, тарифы и отзывы — для ecommerce.", style: "Светлый",
            theme: { accent: "#b45309", accent2: "#84cc16", bg: "#faf6ef", fg: "#1c1917", muted: "#78716c", font: "'Manrope', system-ui, sans-serif" },
            sections: ["navbar", "hero", "logos", "features", "pricing", "testimonials", "contact", "footer"]
        },
        {
            key: "corporate", name: "Корпоративный", desc: "Строгий деловой стиль с цифрами и процессом.", style: "Деловой",
            theme: { accent: "#2563eb", accent2: "#0891b2", bg: "#0a0f1f", fg: "#eaf0ff", muted: "#8090b0", font: "'Onest', system-ui, sans-serif" },
            sections: ["navbar", "hero", "stats", "features", "steps", "testimonials", "contact", "footer"]
        },
        {
            key: "neo-lore-drop", name: "Neo Lore Drop", desc: "Кинематографичный showcase для крипто/гейм/креатор-дропа: лор, фракции, motion и слот под живую 3D-сцену.", style: "Showcase",
            // Премиум-слой целиком: инерционный скролл + кастомный курсор + прелоадер-счётчик.
            theme: { accent: "#42ffa3", accent2: "#ff4791", bg: "#080a0e", fg: "#f6fbff", muted: "#8f9aa8", font: "'Space Grotesk', 'Inter', system-ui, sans-serif", motion: { smooth: true, cursor: true, loader: "counter" } },
            sections: ["neo-navbar", "neo-hero", "neo-lore-intro", "neo-factions", "neo-vision", "neo-customizer", "neo-team", "neo-faq", "neo-discord", "neo-footer"]
        },
        {
            key: "studio-folio", name: "Studio Folio", desc: "Editorial-портфолио креативной студии: тёплая печатная палитра, бегущая лента клиентов, сменяемый видео-рил.", style: "Портфолио",
            // Editorial-настроение: инерционный скролл + тонкая полоса-прелоадер (без курсора).
            theme: { accent: "#c4531f", accent2: "#2f2c28", bg: "#f6f3ee", fg: "#211f1c", muted: "#8a8175", font: "'Work Sans', sans-serif", motion: { smooth: true, loader: "bar" } },
            sections: ["folio-navbar", "folio-hero", "folio-work", "folio-about", "folio-clients", "folio-reel", "folio-testimonials", "folio-faq", "folio-cta", "folio-footer"]
        }
    ];

    return TEMPLATES;
});
