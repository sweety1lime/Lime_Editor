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
    function neoText(text, size, opacity) {
        return {
            type: "text",
            content: { text: text },
            styles: { base: { fontSize: size || "17px", lineHeight: "1.65", opacity: opacity || "0.78", margin: "0" } }
        };
    }
    function neoHeading(text, size) {
        return {
            type: "heading",
            content: { text: text },
            styles: { base: { fontSize: size || "34px", lineHeight: "1.02", margin: "0", letterSpacing: "0" }, mobile: { fontSize: "30px" } },
            fx: ["gradient-text"]
        };
    }
    function neoCard(title, text, tag) {
        return {
            type: "container",
            styles: {
                base: {
                    backgroundColor: "rgba(255,255,255,.065)",
                    border: "1px solid rgba(255,255,255,.14)",
                    borderRadius: "18px",
                    padding: "26px",
                    minHeight: "280px",
                    boxShadow: "0 22px 70px rgba(0,0,0,.22)"
                }
            },
            css: ">.lime-block__inner>.lime-block__children{display:flex;flex-direction:column;gap:14px;height:100%}.lime-block__heading{font-size:28px;line-height:1.05;margin:0}.lime-block__text{margin:0}",
            fx: ["neon-border"],
            children: [
                { type: "text", content: { text: tag }, styles: { base: { color: "var(--lt-accent)", fontSize: "12px", fontWeight: "800", letterSpacing: ".16em", textTransform: "uppercase", margin: "0" } } },
                { type: "heading", content: { text: title }, styles: { base: { fontSize: "28px", lineHeight: "1.05", margin: "0" } } },
                neoText(text, "16px", "0.74")
            ]
        };
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
        ],

        "neo-navbar": [
            {
                type: "navbar",
                content: {
                    brand: "NOVA//LORE",
                    links: [{ label: "Lore" }, { label: "Factions" }, { label: "Forge" }, { label: "Drop" }],
                    cta: "Join"
                },
                styles: {
                    base: {
                        color: "#f6fbff",
                        backgroundColor: "rgba(8,10,14,.76)",
                        borderBottom: "1px solid rgba(255,255,255,.12)",
                        padding: "16px 28px"
                    },
                    mobile: { padding: "12px 16px" }
                },
                css: ">.lime-block__inner{max-width:1180px;margin:0 auto}.lime-block__navbar-brand{letter-spacing:.16em}.lime-block__navbar-links{justify-content:center}.lime-block__cta-btn{background:var(--lt-accent);color:#07100b;border-radius:999px}",
                sticky: true,
                stickyOffset: 0
            }
        ],

        "neo-hero": [
            {
                type: "container",
                content: { width: "boxed", bg: { overlay: "linear-gradient(180deg, rgba(8,10,14,.08), rgba(8,10,14,.48))" } },
                styles: {
                    base: {
                        color: "#f6fbff",
                        backgroundColor: "#080a0e",
                        backgroundImage: "linear-gradient(135deg, rgba(66,255,163,.18), transparent 32%), linear-gradient(315deg, rgba(255,71,145,.16), transparent 30%), linear-gradient(180deg, #080a0e, #11141c)",
                        padding: "96px 34px 80px",
                        minHeight: "720px",
                        overflow: "hidden"
                    },
                    mobile: { padding: "64px 18px 54px", minHeight: "620px" }
                },
                css: ">.lime-block__inner{max-width:1180px;margin:0 auto}.lime-block__children{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:46px;align-items:center}.lime-block__cover-title{font-size:56px;line-height:.96;letter-spacing:0;margin:10px 0 18px}.lime-block__cover-desc{max-width:680px;font-size:20px;line-height:1.55}.lime-block__cover-uptitle{letter-spacing:.18em;color:var(--lt-accent);font-weight:800}.lime-block__cover-cta{border-radius:999px;background:var(--lt-accent);color:#06100b}.lime-block__embed{aspect-ratio:4/5;border-radius:28px;background:linear-gradient(145deg, rgba(66,255,163,.14), rgba(255,71,145,.10))}.lime-block__embed iframe{background:#0b0f16}",
                layers: [
                    { kind: "shape", shape: "square", color: "rgba(66,255,163,.16)", x: 2, y: 18, w: 260, z: 0, depth: 0.18, blur: 18, opacity: 0.75 },
                    { kind: "shape", shape: "square", color: "rgba(255,71,145,.14)", x: 76, y: 8, w: 300, z: 0, depth: 0.28, blur: 22, opacity: 0.72 },
                    { kind: "shape", shape: "square", color: "rgba(255,255,255,.10)", x: 60, y: 72, w: 180, z: 0, depth: 0.16, blur: 8, opacity: 0.55 }
                ],
                anim: "fade-up",
                animDuration: "0.9",
                children: [
                    {
                        type: "cover",
                        content: {
                            uptitle: "CURATED DROP 01",
                            title: "A living lore site for a neon clan launch",
                            desc: "A cinematic starter page for game, web3 and creator drops: story first, asset slots ready, motion already wired.",
                            cta: "Enter the drop"
                        },
                        styles: { base: { padding: "0", backgroundColor: "transparent", color: "inherit" } },
                        fx: ["gradient-text"]
                    },
                    {
                        type: "embed",
                        content: {
                            provider: "spline",
                            aspect: "4/5",
                            embedUrl: "https://my.spline.design/neo-lore-drop-placeholder/",
                            fallbackTitle: "Hero scene slot",
                            fallbackText: "Replace with a Spline hero scene or keep the animated poster fallback for v1."
                        },
                        styles: { base: { padding: "12px", backgroundColor: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.16)", borderRadius: "34px", boxShadow: "0 28px 90px rgba(0,0,0,.34)" } }
                    }
                ]
            }
        ],

        "neo-lore-intro": [
            {
                type: "container",
                content: { width: "boxed" },
                styles: {
                    base: {
                        color: "#f6fbff",
                        backgroundColor: "#101219",
                        padding: "82px 32px",
                        borderTop: "1px solid rgba(255,255,255,.10)",
                        borderBottom: "1px solid rgba(255,255,255,.10)"
                    },
                    mobile: { padding: "58px 18px" }
                },
                css: ">.lime-block__inner{max-width:1040px;margin:0 auto}.lime-block__children{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:42px;align-items:start}.lime-block__text:first-child{color:var(--lt-accent);font-size:12px;text-transform:uppercase;letter-spacing:.16em;font-weight:800}",
                anim: "fade-up",
                children: [
                    { type: "container", children: [
                        { type: "text", content: { text: "LORE CORE" } },
                        neoHeading("The city chooses its mask before sunrise", "44px")
                    ] },
                    { type: "container", css: ">.lime-block__inner>.lime-block__children{display:flex;flex-direction:column;gap:18px}", children: [
                        neoText("NOVA//LORE is a fictional launch vertical for crews, collectors and story-led brands. The structure keeps the first screen cinematic while every paragraph, image slot and scene can be swapped by a real creator.", "18px", "0.82"),
                        neoText("The current engine carries this with additive document fields only: reusable sections, decorative layers, reveal motion, horizontal scenes and a sandboxed embed slot.", "17px", "0.72")
                    ] }
                ]
            }
        ],

        "neo-factions": [
            {
                type: "columns",
                content: { cols: 3, width: "boxed" },
                styles: {
                    base: {
                        color: "#f6fbff",
                        backgroundColor: "#080a0e",
                        padding: "92px 32px",
                        overflow: "hidden"
                    },
                    mobile: { padding: "58px 18px" }
                },
                css: ">.lime-block__inner{max-width:1180px;margin:0 auto}.lime-block__children{align-items:stretch}.lime-block__children--scene>.lime-block{max-width:460px}.lime-block__heading{margin-bottom:0}",
                scene: { mode: "horizontal", length: 3 },
                layers: [
                    { kind: "shape", shape: "square", color: "rgba(66,255,163,.10)", x: 8, y: 20, w: 220, z: 0, depth: 0.22, blur: 20 },
                    { kind: "shape", shape: "square", color: "rgba(73,188,255,.10)", x: 70, y: 65, w: 280, z: 0, depth: 0.30, blur: 28 }
                ],
                children: [
                    neoCard("Chrome Kites", "Signal runners who map rooftop routes, carry launch rumors and turn every skyline into a distribution channel.", "Faction 01"),
                    neoCard("Glass Choir", "Archivists with mirrored masks. They translate founder myths into rituals, patches and public proof.", "Faction 02"),
                    neoCard("Low Orbit", "Builders who keep the drop practical: wallet flows, merch links, mobile fallbacks and the second-week roadmap.", "Faction 03")
                ]
            }
        ],

        "neo-vision": [
            {
                type: "container",
                content: { width: "boxed", layout: "bento" },
                styles: {
                    base: {
                        color: "#f6fbff",
                        backgroundColor: "#131720",
                        padding: "86px 32px"
                    },
                    mobile: { padding: "56px 18px" }
                },
                css: ">.lime-block__inner{max-width:1120px;margin:0 auto}.lime-block__children>.lime-block{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.12)}.lime-block__heading{font-size:26px;line-height:1.08}.lime-block__text{font-size:16px;line-height:1.6}",
                anim: "fade-up",
                children: [
                    neoCard("Asset first", "Hero character, logo, poster, decor and scene URL are explicit slots, not hidden assumptions.", "01"),
                    neoCard("Motion with exits", "Reveal, marquee, parallax and horizontal scenes degrade to readable static content on small screens.", "02"),
                    neoCard("Publish clean", "The output keeps editor-only controls out of public HTML and keeps embeds inside the shared allowlist.", "03"),
                    neoCard("Creator editable", "All copy is normal content. The advanced look comes from scoped styles and existing block settings.", "04")
                ]
            }
        ],

        "neo-customizer": [
            {
                type: "container",
                content: { width: "boxed" },
                styles: {
                    base: {
                        color: "#f6fbff",
                        backgroundColor: "#080a0e",
                        padding: "92px 32px"
                    },
                    mobile: { padding: "58px 18px" }
                },
                css: ">.lime-block__inner{max-width:1180px;margin:0 auto}.lime-block__children{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:40px;align-items:center}.lime-block__embed{aspect-ratio:16/10;border-radius:24px}.lime-block__heading{font-size:38px;line-height:1.04}",
                children: [
                    { type: "container", css: ">.lime-block__inner>.lime-block__children{display:flex;flex-direction:column;gap:16px}", children: [
                        { type: "text", content: { text: "CUSTOMIZER SLOT" }, styles: { base: { color: "var(--lt-accent)", fontSize: "12px", fontWeight: "800", letterSpacing: ".16em", textTransform: "uppercase", margin: "0" } } },
                        neoHeading("Swap the scene, keep the stage", "46px"),
                        neoText("The embed block is intentionally replaceable. A creator can paste a Spline, Rive, Lottie, YouTube, Vimeo, Sketchfab or Figma URL from the trusted host list and keep the rest of the page intact.", "17px", "0.76"),
                        { type: "buttonGroup", content: { primary: "Replace scene", secondary: "Asset brief" } }
                    ] },
                    {
                        type: "embed",
                        content: {
                            provider: "spline",
                            aspect: "16/10",
                            embedUrl: "https://my.spline.design/neo-lore-drop-placeholder/",
                            fallbackTitle: "Customizer scene slot",
                            fallbackText: "Paste a trusted Spline, Rive, Lottie, YouTube, Vimeo, Sketchfab or Figma URL."
                        },
                        styles: { base: { padding: "12px", backgroundColor: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.16)", borderRadius: "30px" } }
                    }
                ]
            }
        ],

        "neo-team": [
            sectionHeading("Drop operators"),
            {
                type: "testimonials",
                content: {
                    items: [
                        { quote: "Creative direction", author: "Mira Vale", role: "World and copy" },
                        { quote: "Scene production", author: "Ion Crew", role: "3D and motion" },
                        { quote: "Launch systems", author: "Northbase", role: "Community ops" }
                    ]
                },
                styles: { base: { color: "#f6fbff", backgroundColor: "#101219", padding: "12px 32px 82px" }, mobile: { padding: "8px 18px 58px" } },
                css: ">.lime-block__inner{max-width:1040px;margin:0 auto}.lime-block__testimonial{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.12)}",
                anim: "fade-up"
            }
        ],

        "neo-faq": [
            sectionHeading("Launch notes"),
            {
                type: "accordion",
                content: {
                    items: [
                        { q: "Can this ship without custom code?", a: "Yes. This spike uses existing blocks, scoped styles, layers, motion fields and sandboxed embed rendering." },
                        { q: "Where do real assets enter?", a: "Logo, hero character, poster/background, decor and scene URL are the next asset-slot pass from the plan." },
                        { q: "What happens on mobile?", a: "Horizontal scenes fall back to a readable stacked layout; heavy embeds remain lazy-loaded." }
                    ]
                },
                styles: { base: { color: "#f6fbff", backgroundColor: "#080a0e", padding: "12px 32px 80px" }, mobile: { padding: "8px 18px 58px" } },
                css: ">.lime-block__inner{max-width:900px;margin:0 auto}.lime-block__accordion-item{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.12)}",
                anim: "fade-up"
            }
        ],

        "neo-discord": [
            {
                type: "cta",
                content: { title: "Open the drop room", desc: "Use this as a Discord, waitlist or mint CTA. The copy is plain content; the stage is the reusable part.", btn: "Join community" },
                styles: {
                    base: {
                        color: "#07100b",
                        backgroundImage: "linear-gradient(135deg, #42ffa3 0%, #49bcff 46%, #ff4791 100%)",
                        padding: "92px 32px",
                        textAlign: "center"
                    },
                    mobile: { padding: "64px 18px" }
                },
                css: ">.lime-block__inner{max-width:920px;margin:0 auto}.lime-block__cta h3{font-size:40px;line-height:1.04;margin:0 0 12px}.lime-block__cta p{font-size:18px;opacity:.82}.lime-block__cta-btn{background:#07100b;color:#f6fbff;border-radius:999px}",
                anim: "zoom"
            }
        ],

        "neo-footer": [
            {
                type: "footer",
                content: {
                    brand: "NOVA//LORE",
                    tagline: "Fictional showcase pack for Lime Builder.",
                    columns: [
                        { title: "Drop", links: [{ label: "Lore" }, { label: "Factions" }, { label: "Scene" }] },
                        { title: "Ops", links: [{ label: "Discord" }, { label: "Roadmap" }, { label: "Press" }] }
                    ],
                    copyright: "2026 NOVA//LORE. Demo content."
                },
                styles: { base: { color: "#f6fbff", backgroundColor: "#080a0e", padding: "54px 32px" }, mobile: { padding: "42px 18px" } },
                css: ">.lime-block__inner{max-width:1180px;margin:0 auto}.lime-block__footer{border-top:1px solid rgba(255,255,255,.12);padding-top:32px}"
            }
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
        { key: "neo-lore-intro", icon: "N1", label: "Neo lore" },
        { key: "neo-factions", icon: "N2", label: "Neo factions" },
        { key: "neo-vision", icon: "N3", label: "Neo vision" },
        { key: "neo-customizer", icon: "N4", label: "Neo embed" },
        { key: "footer", icon: "▭", label: "Подвал" }
    ];

    return { PRESETS: PRESETS, META: META };
});
