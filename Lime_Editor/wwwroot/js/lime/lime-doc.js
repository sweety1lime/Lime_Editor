/*
 * Lime Document Engine (Трек B, B1) — ядро нового конструктора.
 *
 * Источник правды страницы — JSON-документ:
 *   {
 *     "version": 1,
 *     "blocks": [
 *       {
 *         "id": "b1",
 *         "type": "heading",
 *         "content": { "text": "Заголовок" },
 *         "styles": {                       // стили по брейкпоинтам (раскрывает B2)
 *           "base":   { "color": "#fff", "fontSize": "40px" },
 *           "tablet": { "fontSize": "32px" },
 *           "mobile": { "fontSize": "24px" },
 *           "hover":  { "color": "#84cc16" }  // опц. стили на :hover (1.2), вне брейкпоинтов
 *         },
 *         "css": "h2 { letter-spacing: 1px }", // опц. свой CSS (auto-scoped к блоку)
 *         "classes": ["c1ab2cd"],             // опц. переиспользуемые style-классы (этап 0.1)
 *         "children": []                      // опц. вложенные блоки (контейнеры, этап 0.1/1.1)
 *       }
 *     ],
 *     "theme": {                              // токены сайта (этап 0.1):
 *       "accent": "#84cc16", "palette": ["#..."],   // палитра → --lt-c1..cN
 *       "classes": [ { "cls": "c1ab2cd", "name": "Кнопка", "styles": { "base": {...}, "hover": {...} } } ]
 *     }
 *   }
 *
 * Один рендерер используется и для превью в редакторе (opts.editable), и для
 * компиляции в HTML при сохранении/публикации (compile-on-save). Стили блока
 * компилируются в <style> с media-queries — это и есть основа адаптива по брейкпоинтам.
 *
 * UMD: работает и в браузере (window.LimeDoc), и в node (require) — для тестов.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeDoc = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Брейкпоинты контента (макс-ширина). desktop = base (без media).
    var BREAKPOINTS = { tablet: 1024, mobile: 640 };

    // Потолок вложенности children — защита от циклических компонентов.
    var MAX_DEPTH = 20;

    // Белый список универсальных эффектов (Фаза 6.3): только эти ключи превращаются
    // в классы lime-fx-* на секции — защита от инъекции произвольных классов из документа.
    var FX_KEYS = { glass: 1, glow: 1, "neon-border": 1, "gradient-text": 1, tilt: 1 };

    // Тема сайта — токены как CSS-переменные (--lt-*, чтобы не конфликтовать с чужими).
    // Меняешь токен один раз → обновляется везде, где блоки на него ссылаются (var(--lt-...)).
    var DEFAULT_THEME = {
        accent: "#84cc16",
        accent2: "#a78bfa",
        bg: "#ffffff",
        fg: "#14180f",
        muted: "#6b7280",
        font: "'Inter', system-ui, sans-serif"
    };
    var THEME_TOKENS = [
        { key: "accent", label: "Акцент", var: "--lt-accent" },
        { key: "accent2", label: "Акцент 2", var: "--lt-accent2" },
        { key: "bg", label: "Фон", var: "--lt-bg" },
        { key: "fg", label: "Текст", var: "--lt-fg" },
        { key: "muted", label: "Приглушённый", var: "--lt-muted" }
    ];

    // Фиксированные шкалы дизайн-системы (этап 0.1): спейсинг и типографика как CSS-переменные,
    // чтобы классы/блоки/AI ссылались на var(--lt-space-*) / var(--lt-text-*), а не на «магические px».
    var SPACE_SCALE = { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "24px", 6: "32px", 7: "48px", 8: "64px", 9: "96px" };
    var TEXT_SCALE = { xs: ".75rem", sm: ".875rem", base: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "2rem", "4xl": "2.5rem", "5xl": "3.25rem" };

    function scaleVars(prefix, scale) {
        return Object.keys(scale).map(function (k) { return "--lt-" + prefix + "-" + k + ":" + scale[k] + ";"; }).join("");
    }

    function themeCss(theme) {
        var t = {};
        Object.assign(t, DEFAULT_THEME, theme || {});
        // Дополнительная палитра (этап 0.1): theme.palette = ["#hex", ...] → --lt-c1..cN.
        var palette = "";
        if (t.palette && t.palette.length) {
            for (var pi = 0; pi < t.palette.length; pi++) palette += "--lt-c" + (pi + 1) + ":" + t.palette[pi] + ";";
        }
        return ":root{" +
            "--lt-accent:" + t.accent + ";--lt-accent2:" + t.accent2 + ";" +
            "--lt-bg:" + t.bg + ";--lt-fg:" + t.fg + ";--lt-muted:" + t.muted + ";" +
            "--lt-font:" + t.font + ";" + palette +
            scaleVars("space", SPACE_SCALE) + scaleVars("text", TEXT_SCALE) + "}" +
            ".lime-doc-page{background:var(--lt-bg);color:var(--lt-fg);font-family:var(--lt-font);}";
    }

    // CSS-идентификатор класса должен быть безопасен (документ может быть подделан) —
    // пропускаем только [A-Za-z0-9_-], как whitelist FX. Имя класса для показа хранится
    // отдельно (theme.classes[].name), а ссылки идут по theme.classes[].cls.
    function safeCls(cls) {
        return (typeof cls === "string" && /^[A-Za-z0-9_-]+$/.test(cls)) ? cls : null;
    }

    // Стили по бакетам (base + media tablet/mobile + hover) для произвольного селектора —
    // общая логика блока и переиспользуемого класса (этап 0.1).
    function bucketsCss(sel, s) {
        var css = "";
        if (s.base) css += sel + "{" + styleDecls(s.base) + "}";
        if (s.tablet) css += "@media(max-width:" + BREAKPOINTS.tablet + "px){" + sel + "{" + styleDecls(s.tablet) + "}}";
        if (s.mobile) css += "@media(max-width:" + BREAKPOINTS.mobile + "px){" + sel + "{" + styleDecls(s.mobile) + "}}";
        // Состояние наведения (1.2): отдельный бакет styles.hover, вне брейкпоинтов.
        if (s.hover && Object.keys(s.hover).length) {
            css += sel + "{transition:all .2s ease;}";
            css += sel + ":hover{" + styleDecls(s.hover) + "}";
        }
        return css;
    }

    // Переиспользуемые style-классы сайта (этап 0.1, аналог Webflow classes): один набор
    // стилей, на который ссылаются много блоков (block.classes:["cls"]). Меняешь класс —
    // меняются все блоки с ним. Эмитится ПОСЛЕ темы и ДО per-block css, чтобы свой стиль
    // блока перебивал класс при равной специфичности.
    function classesCss(theme) {
        var list = (theme && theme.classes) || [];
        var css = "";
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            var cls = c && safeCls(c.cls);
            if (!cls || !c.styles) continue;
            css += bucketsCss(".lime-c-" + cls, c.styles);
        }
        return css;
    }

    // Глобальный CSS сайта (этап 0.2): сырой CSS владельца, применяется ко всему сайту.
    // Идёт ПОСЛЕДНИМ в style-блоке → может перебить любой блок (escape hatch). Единственная
    // защита — нельзя закрыть <style> изнутри (вырезаем последовательность "</style").
    function customCssOf(doc) {
        var c = doc && doc.customCss;
        if (typeof c !== "string" || !c) return "";
        return "\n" + c.replace(/<\/style/gi, "");
    }

    function escHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function escAttr(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    }
    function camelToKebab(k) {
        return k.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); });
    }

    // {fontSize:'40px', color:'#fff'} -> "font-size:40px;color:#fff;"
    function styleDecls(obj) {
        if (!obj) return "";
        return Object.keys(obj).map(function (k) {
            return camelToKebab(k) + ":" + obj[k] + ";";
        }).join("");
    }

    // Ограничивает пользовательский CSS селектором блока (flat-правила; @-правила не трогаем).
    function scopeCss(css, sel) {
        if (!css) return "";
        if (css.indexOf("{") === -1) return sel + "{" + css + "}";
        return css.replace(/([^{}]+)\{([^{}]*)\}/g, function (whole, selectors, body) {
            if (selectors.trim().charAt(0) === "@") return whole;
            var scoped = selectors.split(",").map(function (one) {
                one = one.trim();
                return one ? sel + " " + one : "";
            }).filter(Boolean).join(",");
            return scoped + "{" + body + "}";
        });
    }

    // CSS блока: base + media(tablet) + media(mobile) + свой scoped css + рекурсивно children.
    function compileBlockCss(block, components, depth) {
        var sel = '[data-block-id="' + block.id + '"]';
        var css = bucketsCss(sel, block.styles || {});
        if (block.css) css += scopeCss(block.css, sel);
        if ((depth || 0) < MAX_DEPTH) {
            (block.children || []).forEach(function (ch) {
                css += compileBlockCss(resolve(ch, components), components, (depth || 0) + 1);
            });
        }
        return css;
    }

    // ----- рендереры внутренностей блока по типу (content-driven) -----
    // opts.editable=true добавляет contenteditable + data-field для редактора.
    function ed(opts, field, text, tag, cls) {
        tag = tag || "div";
        var attrs = (cls ? ' class="' + cls + '"' : "") +
            (opts && opts.editable ? ' contenteditable="true" data-field="' + field + '"' : "");
        return "<" + tag + attrs + ">" + escHtml(text) + "</" + tag + ">";
    }
    // Строка атрибутов contenteditable+data-field (для inline-правки) — только в редакторе.
    function edattr(opts, field) {
        return (opts && opts.editable) ? ' contenteditable="true" data-field="' + field + '"' : "";
    }

    var RENDERERS = {
        heading: function (b, o) {
            return ed(o, "text", b.content && b.content.text || "Раздел", "h2", "lime-block__heading");
        },
        text: function (b, o) {
            return ed(o, "text", b.content && b.content.text || "Текст абзаца.", "p", "lime-block__text");
        },
        cover: function (b, o) {
            var c = b.content || {};
            return '<div class="lime-block__cover">' +
                ed(o, "uptitle", c.uptitle || "Your brand", "div", "lime-block__cover-uptitle") +
                ed(o, "title", c.title || "Заголовок страницы", "h1", "lime-block__cover-title") +
                ed(o, "desc", c.desc || "Короткое описание.", "p", "lime-block__cover-desc") +
                '<a href="#" class="lime-block__cover-cta"' + (o && o.editable ? ' contenteditable="true" data-field="cta"' : "") + ">" +
                    escHtml(c.cta || "Начать →") + "</a>" +
                "</div>";
        },
        cta: function (b, o) {
            var c = b.content || {};
            return '<div class="lime-block__cta">' +
                ed(o, "title", c.title || "Готов начать?", "h3") +
                ed(o, "desc", c.desc || "Опиши предложение.", "p") +
                '<a href="#" class="lime-block__cta-btn"' + (o && o.editable ? ' contenteditable="true" data-field="btn"' : "") + ">" +
                    escHtml(c.btn || "Действие →") + "</a>" +
                "</div>";
        },
        buttonGroup: function (b, o) {
            var c = b.content || {};
            return '<div class="lime-block__btn-group">' +
                '<a href="#" class="lime-block__cta-btn"' + (o && o.editable ? ' contenteditable="true" data-field="primary"' : "") + ">" + escHtml(c.primary || "Основное действие") + "</a>" +
                '<a href="#" class="lime-block__btn-ghost"' + (o && o.editable ? ' contenteditable="true" data-field="secondary"' : "") + ">" + escHtml(c.secondary || "Вторично") + "</a>" +
                "</div>";
        },
        stats: function (b, o) {
            var items = (b.content && b.content.items) || [
                { num: "10K+", label: "Пользователей" }, { num: "99.9%", label: "Аптайм" }, { num: "24/7", label: "Поддержка" }
            ];
            return '<div class="lime-block__stats">' + items.map(function (it, i) {
                return '<div class="lime-block__stat">' +
                    '<div class="lime-block__stat-num"' + (o && o.editable ? ' contenteditable="true" data-field="items.' + i + '.num"' : "") + ">" + escHtml(it.num) + "</div>" +
                    '<div class="lime-block__stat-label"' + (o && o.editable ? ' contenteditable="true" data-field="items.' + i + '.label"' : "") + ">" + escHtml(it.label) + "</div>" +
                    "</div>";
            }).join("") + "</div>";
        },
        features: function (b, o) {
            var items = (b.content && b.content.items) || [
                { icon: "⚡", title: "Быстро", desc: "Запуск за минуты." },
                { icon: "🎨", title: "Стильно", desc: "Современные шаблоны." },
                { icon: "🔒", title: "Надёжно", desc: "Шифрование и бэкапы." }
            ];
            return '<div class="lime-block__features">' + items.map(function (it, i) {
                return '<div class="lime-block__feature">' +
                    '<div class="lime-block__feature-icon">' + escHtml(it.icon) + "</div>" +
                    '<h4 class="lime-block__feature-title"' + (o && o.editable ? ' contenteditable="true" data-field="items.' + i + '.title"' : "") + ">" + escHtml(it.title) + "</h4>" +
                    '<p class="lime-block__feature-desc"' + (o && o.editable ? ' contenteditable="true" data-field="items.' + i + '.desc"' : "") + ">" + escHtml(it.desc) + "</p>" +
                    "</div>";
            }).join("") + "</div>";
        },
        // --- Структура страницы и контентные блоки (Фаза 6.1: широта) ---
        navbar: function (b, o) {
            var c = b.content || {};
            var links = c.links || [{ label: "Главная" }, { label: "О нас" }, { label: "Цены" }];
            return '<nav class="lime-block__navbar">' +
                ed(o, "brand", c.brand || "Brand", "div", "lime-block__navbar-brand") +
                '<div class="lime-block__navbar-links">' + links.map(function (l, i) {
                    return '<a href="#" class="lime-block__navbar-link"' + edattr(o, "links." + i + ".label") + ">" + escHtml(l.label) + "</a>";
                }).join("") + "</div>" +
                '<a href="#" class="lime-block__cta-btn"' + edattr(o, "cta") + ">" + escHtml(c.cta || "Начать") + "</a>" +
                "</nav>";
        },
        footer: function (b, o) {
            var c = b.content || {};
            var cols = c.columns || [{ title: "Продукт", links: [{ label: "Цены" }] }];
            return '<div class="lime-block__footer">' +
                '<div class="lime-block__footer-brand">' +
                    ed(o, "brand", c.brand || "Brand", "div", "lime-block__footer-name") +
                    ed(o, "tagline", c.tagline || "Короткий слоган.", "p", "lime-block__footer-tagline") +
                "</div>" +
                '<div class="lime-block__footer-cols">' + cols.map(function (col, ci) {
                    return '<div class="lime-block__footer-col"><h5' + edattr(o, "columns." + ci + ".title") + ">" + escHtml(col.title) + "</h5>" +
                        (col.links || []).map(function (l, li) {
                            return '<a href="#"' + edattr(o, "columns." + ci + ".links." + li + ".label") + ">" + escHtml(l.label) + "</a>";
                        }).join("") + "</div>";
                }).join("") + "</div>" +
                '<div class="lime-block__footer-copy"' + edattr(o, "copyright") + ">" + escHtml(c.copyright || "© 2026 Brand") + "</div>" +
                "</div>";
        },
        accordion: function (b, o) {
            var items = (b.content && b.content.items) || [{ q: "Вопрос?", a: "Ответ." }];
            return '<div class="lime-block__accordion">' + items.map(function (it, i) {
                return '<details class="lime-block__accordion-item"' + (i === 0 ? " open" : "") + ">" +
                    '<summary' + edattr(o, "items." + i + ".q") + ">" + escHtml(it.q) + "</summary>" +
                    '<div class="lime-block__accordion-a"' + edattr(o, "items." + i + ".a") + ">" + escHtml(it.a) + "</div>" +
                    "</details>";
            }).join("") + "</div>";
        },
        pricing: function (b, o) {
            var plans = (b.content && b.content.plans) || [{ name: "План", price: "0₽", period: "/мес", features: ["Фича"], cta: "Выбрать" }];
            return '<div class="lime-block__pricing">' + plans.map(function (p, i) {
                return '<div class="lime-block__plan' + (p.featured ? " is-featured" : "") + '">' +
                    '<div class="lime-block__plan-name"' + edattr(o, "plans." + i + ".name") + ">" + escHtml(p.name) + "</div>" +
                    '<div class="lime-block__plan-price"><span' + edattr(o, "plans." + i + ".price") + ">" + escHtml(p.price) + "</span><small" + edattr(o, "plans." + i + ".period") + ">" + escHtml(p.period || "") + "</small></div>" +
                    '<ul class="lime-block__plan-features">' + (p.features || []).map(function (f, fi) {
                        return "<li" + edattr(o, "plans." + i + ".features." + fi) + ">" + escHtml(f) + "</li>";
                    }).join("") + "</ul>" +
                    '<a href="#" class="lime-block__cta-btn"' + edattr(o, "plans." + i + ".cta") + ">" + escHtml(p.cta || "Выбрать") + "</a>" +
                    "</div>";
            }).join("") + "</div>";
        },
        testimonials: function (b, o) {
            var items = (b.content && b.content.items) || [{ quote: "Отзыв.", author: "Имя", role: "Роль" }];
            return '<div class="lime-block__testimonials">' + items.map(function (it, i) {
                return '<figure class="lime-block__testimonial">' +
                    "<blockquote" + edattr(o, "items." + i + ".quote") + ">" + escHtml(it.quote) + "</blockquote>" +
                    '<figcaption><b' + edattr(o, "items." + i + ".author") + ">" + escHtml(it.author) + "</b><span" + edattr(o, "items." + i + ".role") + ">" + escHtml(it.role || "") + "</span></figcaption>" +
                    "</figure>";
            }).join("") + "</div>";
        },
        logos: function (b, o) {
            var items = (b.content && b.content.items) || [{ label: "LOGO" }];
            return '<div class="lime-block__logos">' + items.map(function (it, i) {
                return '<span class="lime-block__logo"' + edattr(o, "items." + i + ".label") + ">" + escHtml(it.label) + "</span>";
            }).join("") + "</div>";
        },
        steps: function (b, o) {
            var items = (b.content && b.content.items) || [{ title: "Шаг", desc: "Описание." }];
            return '<div class="lime-block__steps">' + items.map(function (it, i) {
                return '<div class="lime-block__step"><div class="lime-block__step-num">' + (i + 1) + "</div>" +
                    "<h4" + edattr(o, "items." + i + ".title") + ">" + escHtml(it.title) + "</h4>" +
                    "<p" + edattr(o, "items." + i + ".desc") + ">" + escHtml(it.desc) + "</p></div>";
            }).join("") + "</div>";
        },
        imageText: function (b, o) {
            var c = b.content || {};
            var editable = o && o.editable;
            var img = c.src
                ? '<img src="' + escAttr(c.src) + '" alt="' + escAttr(c.alt || "") + '" loading="lazy" decoding="async">' + (editable ? '<button type="button" class="lime-doc-media-swap" data-doc-pick="src">Заменить</button>' : "")
                : (editable ? '<div class="lime-block__image-placeholder" data-doc-pick="src">+ выбрать изображение</div>' : "");
            return '<div class="lime-block__imagetext' + (c.reverse ? " is-reverse" : "") + '">' +
                '<div class="lime-block__imagetext-media">' + img + "</div>" +
                '<div class="lime-block__imagetext-body">' +
                    ed(o, "title", c.title || "Заголовок секции", "h3") +
                    ed(o, "text", c.text || "Описание в пару предложений.", "p") +
                "</div></div>";
        },
        socials: function (b, o) {
            var items = (b.content && b.content.items) || [{ platform: "Telegram", url: "#" }];
            return '<div class="lime-block__socials">' + items.map(function (it, i) {
                return '<a href="' + escAttr(it.url || "#") + '" class="lime-block__social"' + edattr(o, "items." + i + ".platform") + ">" + escHtml(it.platform) + "</a>";
            }).join("") + "</div>";
        },
        form: function (b, o) {
            var c = b.content || {};
            var fields = c.fields || [{ type: "text", label: "Имя", name: "name" }];
            var editable = o && o.editable;
            var inner = fields.map(function (f, i) {
                var label = '<label class="lime-block__form-label"' + edattr(o, "fields." + i + ".label") + ">" + escHtml(f.label) + "</label>";
                var input = f.type === "textarea"
                    ? '<textarea class="lime-block__form-input" name="' + escAttr(f.name || ("field" + i)) + '" rows="4"' + (editable ? " disabled" : "") + "></textarea>"
                    : '<input class="lime-block__form-input" type="' + escAttr(f.type || "text") + '" name="' + escAttr(f.name || ("field" + i)) + '"' + (editable ? " disabled" : "") + ">";
                return '<div class="lime-block__form-row">' + label + input + "</div>";
            }).join("");
            // data-lime-form → на публикации сервер проставит action=/Form/Submit + __siteId (InjectFormEndpoints).
            // content.collection (slug) → скрытое __collection: FormController запишет заявку в коллекцию данных.
            var coll = c.collection ? '<input type="hidden" name="__collection" value="' + escAttr(c.collection) + '">' : "";
            return '<form class="lime-block__form" data-lime-form>' + coll + inner +
                '<input type="text" name="lime_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">' +
                '<button type="submit" class="lime-block__cta-btn"' + edattr(o, "submitLabel") + ">" + escHtml(c.submitLabel || "Отправить") + "</button>" +
                "</form>";
        },
        // Список из коллекции (фуллстак, B3): читает записи из opts.data[slug] = { fields, records }.
        // На публикации данные подаёт сервер (per-request из БД); в редакторе — превью схемы.
        collectionList: function (b, o) {
            var c = b.content || {};
            var slug = c.collection || "";
            var editable = o && o.editable;
            var ds = (o && o.data && o.data[slug]) || null;
            var fields = (ds && ds.fields) || [];
            var records = (ds && ds.records) || [];
            if (!slug) {
                return editable ? '<div class="lime-doc-drop-hint">Список из коллекции — выбери источник в инспекторе («Источник — коллекция»). Коллекции создаются в разделе «Данные».</div>' : "";
            }
            if (!records.length && !editable) return ""; // публикация: пусто
            var cards = records.map(function (rec) {
                var inner = fields.map(function (f) {
                    var v = rec[f.name];
                    if (f.type === "image") {
                        return v ? '<img class="lime-cl-img" src="' + escAttr(v) + '" alt="" loading="lazy" decoding="async">' : '<div class="lime-cl-img lime-cl-img--ph"></div>';
                    }
                    var text = (v == null || v === "") ? (editable ? "—" : "") : v;
                    return '<div class="lime-cl-row"><span class="lime-cl-key">' + escHtml(f.label || f.name) + "</span><span class=\"lime-cl-val\">" + escHtml(text) + "</span></div>";
                }).join("");
                return '<div class="lime-cl-card">' + inner + "</div>";
            }).join("");
            var note = editable ? '<div class="lime-doc-drop-hint">Превью схемы коллекции «' + escHtml(slug) + '». Реальные записи появятся на опубликованной странице.</div>' : "";
            return '<div class="lime-block__collection">' + cards + "</div>" + note;
        },
        divider: function () { return '<div class="lime-block__divider"><span></span></div>'; },
        spacer: function () { return '<div class="lime-block__spacer"></div>'; },
        // --- Медиа-блоки (этап 0.5). data-doc-pick/data-doc-video — хуки редактора,
        // на публикации (editable=false) они не рендерятся вовсе.
        image: function (b, o) {
            var c = b.content || {};
            var editable = o && o.editable;
            var inner = "";
            if (c.src) {
                inner = '<img src="' + escAttr(c.src) + '" alt="' + escAttr(c.alt || "") + '" loading="lazy" decoding="async">' +
                    (editable ? '<button type="button" class="lime-doc-media-swap" data-doc-pick="src">Заменить</button>' : "");
            } else if (editable) {
                inner = '<div class="lime-block__image-placeholder" data-doc-pick="src">+ выбрать изображение</div>';
            }
            var cap = "";
            if (editable || c.caption) {
                cap = ed(o, "caption", c.caption || "", "figcaption", "lime-block__image-caption");
            }
            return '<figure class="lime-block__image">' + inner + cap + "</figure>";
        },
        gallery: function (b, o) {
            var items = (b.content && b.content.items) || [];
            var editable = o && o.editable;
            var cells = items.map(function (it, i) {
                var del = editable ? '<button type="button" class="lime-doc-gallery-del" data-doc-gallery-del="' + i + '" title="Убрать">×</button>' : "";
                if (it && it.src) {
                    return '<div class="lime-block__gallery-item"' + (editable ? ' data-doc-pick="items.' + i + '.src"' : "") + '>' +
                        '<img src="' + escAttr(it.src) + '" alt="' + escAttr(it.alt || "") + '" loading="lazy" decoding="async">' + del +
                        "</div>";
                }
                return editable
                    ? '<div class="lime-block__gallery-item" data-doc-pick="items.' + i + '.src">+ фото' + del + "</div>"
                    : "";
            }).join("");
            var add = editable ? '<div class="lime-block__gallery-item lime-doc-gallery-add" data-doc-gallery-add>+ слот</div>' : "";
            return '<div class="lime-block__gallery">' + cells + add + "</div>";
        },
        video: function (b, o) {
            var c = b.content || {};
            var editable = o && o.editable;
            var inner = "";
            if (c.youtubeId) {
                inner = '<iframe src="https://www.youtube.com/embed/' + escAttr(c.youtubeId) +
                    '" title="Видео" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>' +
                    (editable ? '<button type="button" class="lime-doc-media-swap" data-doc-video>Заменить</button>' : "");
            } else if (editable) {
                inner = '<div class="lime-block__video-placeholder" data-doc-video>▶ Вставить YouTube-видео</div>';
            }
            return '<div class="lime-block__video">' + inner + "</div>";
        },
        // Embed/3D (Фаза 8.1): готовая сцена по https-ссылке в sandbox-iframe (Spline/Rive/Lottie/iframe).
        // Принимаем ТОЛЬКО https — защита от javascript:/data: и подмешивания протокола.
        embed: function (b, o) {
            var c = b.content || {};
            var editable = o && o.editable;
            var safe = /^https:\/\//i.test(c.embedUrl || "") ? c.embedUrl : "";
            if (safe) {
                return '<div class="lime-block__embed">' +
                    '<iframe src="' + escAttr(safe) + '" sandbox="allow-scripts allow-same-origin allow-popups" loading="lazy" allowfullscreen title="Встроенная сцена"></iframe>' +
                    (editable ? '<button type="button" class="lime-doc-media-swap" data-doc-embed>Заменить</button>' : "") +
                    "</div>";
            }
            return editable
                ? '<div class="lime-block__embed"><div class="lime-block__embed-placeholder" data-doc-embed>◈ Вставить 3D/сцену (Spline · Rive · Lottie · iframe)</div></div>'
                : "";
        },
        // --- Структурные блоки (этап 1): сами не рисуют контент, их смысл — children.
        // Пустые в редакторе показывают подсказку; в publish пустой контейнер невидим.
        container: function (b, o) {
            if (o && o.editable && (!b.children || !b.children.length)) {
                return '<div class="lime-doc-drop-hint">Пустой контейнер — перетащи блок за ⠿ сюда или выбери контейнер и добавляй из сайдбара</div>';
            }
            return "";
        },
        columns: function (b, o) {
            if (o && o.editable && (!b.children || !b.children.length)) {
                return '<div class="lime-doc-drop-hint">Пустые колонки — перетащи блоки за ⠿ сюда: каждый занимает следующую колонку</div>';
            }
            return "";
        }
    };

    // Контейнерные типы: новые блоки из сайдбара добавляются ВНУТРЬ выбранного контейнера.
    var CONTAINER_TYPES = { container: true, columns: true };
    function isContainer(type) { return !!CONTAINER_TYPES[type]; }

    // Дефолтный контент по типу — материализуется в block.content при создании,
    // чтобы inline-правка (особенно списков items) не ломала рендер.
    var DEFAULTS = {
        heading: { text: "Раздел" },
        text: { text: "Здесь история, описание услуги, абзац о компании. Кликни и редактируй." },
        cover: { uptitle: "Your brand", title: "Заголовок страницы", desc: "Короткое описание о том, чем вы помогаете клиентам.", cta: "Начать →" },
        cta: { title: "Готов начать?", desc: "Опиши предложение в одной строке.", btn: "Действие →" },
        buttonGroup: { primary: "Основное действие", secondary: "Вторично" },
        stats: { items: [
            { num: "10K+", label: "Пользователей" }, { num: "99.9%", label: "Аптайм" },
            { num: "24/7", label: "Поддержка" }, { num: "4.9★", label: "Рейтинг" }
        ] },
        features: { items: [
            { icon: "⚡", title: "Быстро", desc: "Запуск за минуты, не за дни." },
            { icon: "🎨", title: "Стильно", desc: "Современные шаблоны на любой вкус." },
            { icon: "🔒", title: "Надёжно", desc: "Шифрование, бэкапы, доступность 24/7." }
        ] },
        navbar: { brand: "Brand", links: [{ label: "Главная" }, { label: "О нас" }, { label: "Цены" }, { label: "Контакты" }], cta: "Начать" },
        footer: {
            brand: "Brand", tagline: "Короткий слоган о продукте.",
            columns: [
                { title: "Продукт", links: [{ label: "Возможности" }, { label: "Цены" }, { label: "Обновления" }] },
                { title: "Компания", links: [{ label: "О нас" }, { label: "Блог" }, { label: "Контакты" }] }
            ],
            copyright: "© 2026 Brand. Все права защищены."
        },
        accordion: { items: [
            { q: "Как это работает?", a: "Собираешь сайт из готовых блоков и публикуешь в один клик." },
            { q: "Есть бесплатный тариф?", a: "Да, стартовый тариф бесплатен навсегда." },
            { q: "Можно подключить свой домен?", a: "Да, на платных тарифах." }
        ] },
        pricing: { plans: [
            { name: "Старт", price: "0₽", period: "/мес", features: ["1 сайт", "Базовые блоки", "Поддомен"], cta: "Начать", featured: false },
            { name: "Про", price: "990₽", period: "/мес", features: ["Безлимит сайтов", "Все блоки и эффекты", "Свой домен", "Приоритетная поддержка"], cta: "Выбрать Про", featured: true },
            { name: "Бизнес", price: "2990₽", period: "/мес", features: ["Команда", "Аналитика", "SLA"], cta: "Связаться", featured: false }
        ] },
        testimonials: { items: [
            { quote: "Собрали лендинг за вечер — выглядит дорого.", author: "Анна К.", role: "Основатель" },
            { quote: "Сэкономили недели работы дизайнера.", author: "Игорь П.", role: "Маркетолог" },
            { quote: "Лучший конструктор, что я пробовал.", author: "Мария Л.", role: "Фрилансер" }
        ] },
        logos: { items: [{ label: "LOGO" }, { label: "BRAND" }, { label: "ACME" }, { label: "NOVA" }, { label: "ORBIT" }] },
        steps: { items: [
            { title: "Опиши идею", desc: "Пара предложений о проекте." },
            { title: "Собери блоки", desc: "Шаблоны, секции, эффекты." },
            { title: "Опубликуй", desc: "Готовый сайт по ссылке." }
        ] },
        imageText: { src: "", alt: "", title: "Заголовок секции", text: "Расскажи о ключевой ценности продукта в паре предложений.", reverse: false },
        socials: { items: [{ platform: "Telegram", url: "#" }, { platform: "VK", url: "#" }, { platform: "Instagram", url: "#" }, { platform: "YouTube", url: "#" }] },
        form: {
            fields: [
                { type: "text", label: "Имя", name: "name" },
                { type: "email", label: "Email", name: "email" },
                { type: "textarea", label: "Сообщение", name: "message" }
            ],
            submitLabel: "Отправить"
        },
        divider: {},
        spacer: {},
        image: { src: "", alt: "", caption: "" },
        gallery: { items: [{ src: "", alt: "" }, { src: "", alt: "" }, { src: "", alt: "" }] },
        video: { youtubeId: "" },
        embed: { embedUrl: "", provider: "" },
        collectionList: { collection: "", layout: "cards", limit: 12 },
        container: {},
        columns: { cols: 2 }
    };

    var idSeq = 0;
    function uid() {
        return "b" + Date.now().toString(36).slice(-4) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function createBlock(type) {
        var def = DEFAULTS[type] || {};
        var b = {
            id: uid(),
            type: type,
            content: JSON.parse(JSON.stringify(def)),
            styles: {}
        };
        if (isContainer(type)) b.children = [];
        return b;
    }

    function renderInner(block, opts) {
        var r = RENDERERS[block.type];
        return r ? r(block, opts) : '<p class="lime-block__text">Неизвестный блок: ' + escHtml(block.type) + "</p>";
    }

    // Фон-слои секции (видео + затемнение). content.bg = { videoSrc, poster, overlay, blur }.
    // Рендерятся ВСЕГДА (и в редакторе, и в publish) как прямые дети <section>, поэтому
    // перекрывают и паддинги блока. Базовый фон (цвет/градиент/картинка) — это стиль-пропы
    // самого блока (background*), их рендерер не трогает. Чистая сборка строк — Jint-safe.
    function bgLayersHtml(block) {
        var c = block.content || {};
        var bg = c.bg;
        if (!bg) return "";
        var out = "";
        if (bg.videoSrc) {
            out += '<video class="lime-block__bgvideo" autoplay muted loop playsinline' +
                (bg.poster ? ' poster="' + escAttr(bg.poster) + '"' : "") + ">" +
                '<source src="' + escAttr(bg.videoSrc) + '"></video>';
        }
        if (bg.overlay) {
            var st = "background:" + bg.overlay + ";";
            if (bg.blur) st += "backdrop-filter:blur(" + bg.blur + ");-webkit-backdrop-filter:blur(" + bg.blur + ");";
            out += '<div class="lime-block__overlay" style="' + escAttr(st) + '"></div>';
        }
        return out;
    }

    // Декоративные плавающие слои секции (block.layers[]). Абсолютно спозиционированы
    // в % от секции; z-index решает, перед контентом слой или за ним; data-parallax —
    // глубина для скролл-параллакса (рантайм lime-animate.js). Рендерятся всегда; в
    // редакторе несут data-layer-id для drag-позиционирования. Чистая сборка строк.
    function layersHtml(block, opts) {
        var ls = block.layers;
        if (!ls || !ls.length) return "";
        var editable = opts && opts.editable;
        var out = '<div class="lime-block__layers">';
        for (var i = 0; i < ls.length; i++) {
            var l = ls[i] || {};
            var st = "left:" + (l.x || 0) + "%;top:" + (l.y || 0) + "%;width:" + (l.w || 120) + "px;";
            if (l.z != null) st += "z-index:" + l.z + ";";
            if (l.opacity != null) st += "opacity:" + l.opacity + ";";
            if (l.blur) st += "filter:blur(" + l.blur + "px);";
            var inner = "";
            var cls = "lime-block__layer";
            if (l.kind === "image" && l.src) {
                inner = '<img src="' + escAttr(l.src) + '" alt="" loading="lazy" decoding="async">';
            } else {
                st += "background:" + (l.color || "#a78bfa") + ";aspect-ratio:1;";
                cls += " lime-block__layer--" + (l.shape || "circle");
            }
            var dp = l.depth ? ' data-parallax="' + escAttr(l.depth) + '"' : "";
            var lid = editable ? ' data-layer-id="' + escAttr(l.id) + '"' : "";
            out += '<div class="' + cls + '" style="' + escAttr(st) + '"' + dp + lid + ">" + inner + "</div>";
        }
        return out + "</div>";
    }

    function renderBlock(block, opts, components, depth) {
        var anim = "";
        if (block.anim) {
            anim = ' data-anim="' + escAttr(block.anim) + '"';
            if (block.animDelay) anim += ' data-anim-delay="' + escAttr(block.animDelay) + '"';
            if (block.animDuration) anim += ' data-anim-duration="' + escAttr(block.animDuration) + '"';
        }
        // Движение секции (этап 2): параллакс + sticky. Marquee живёт на children-обёртке
        // (ниже), а не на секции — чтобы reveal-анимация и бегущая строка не дрались за transform.
        var motion = "";
        if (block.parallax) motion += ' data-parallax="' + escAttr(block.parallax) + '"';
        if (block.sticky) {
            motion += ' data-sticky="1"';
            if (block.stickyOffset) motion += ' data-sticky-offset="' + escAttr(block.stickyOffset) + '"';
        }
        // Scrollytelling (этап 8.2): закреплённая сцена, анимируемая по прогрессу скролла.
        if (block.scene && block.scene.mode) {
            motion += ' data-scene="' + escAttr(block.scene.mode) + '"';
            if (block.scene.length) motion += ' data-scene-length="' + escAttr(block.scene.length) + '"';
        }
        var kids = "";
        var hasKids = block.children && block.children.length;
        // В редакторе обёртка children рендерится у контейнеров ВСЕГДА (даже пустых) —
        // это зона дропа для drag-and-drop. В publish пустая обёртка не нужна.
        var wantWrapper = (hasKids || (opts && opts.editable && isContainer(block.type))) && (depth || 0) < MAX_DEPTH;
        if (wantWrapper) {
            var kidsCls = "lime-block__children";
            var kidsAttr = "";
            // Бегущая строка — на самой обёртке (рантайм дублирует ряд и крутит его).
            if (block.marquee) {
                kidsCls += " lime-block__children--marquee";
                kidsAttr = ' data-marquee="' + escAttr(block.marquee.speed || 40) + '"' +
                    (block.marquee.reverse ? ' data-marquee-reverse="1"' : "");
            }
            // Горизонтальная сцена: дети в ряд, рантайм пинит секцию и едет по X (этап 8.2).
            if (block.scene && block.scene.mode === "horizontal") kidsCls += " lime-block__children--scene";
            kids = '<div class="' + kidsCls + '"' + kidsAttr + ">" + (block.children || []).map(function (ch) {
                return renderBlock(resolve(ch, components), opts, components, (depth || 0) + 1);
            }).join("") + "</div>";
        }
        // Колонки: число колонок уходит в data-cols, сетку рисует CSS (на мобиле — одна).
        var cols = (block.type === "columns" && block.content && block.content.cols)
            ? ' data-cols="' + escAttr(block.content.cols) + '"' : "";
        // Универсальные эффекты (Фаза 6.3): классы lime-fx-* по белому списку (тяжёлый CSS — в constructor.css).
        var fxCls = "";
        if (block.fx && block.fx.length) {
            for (var fi = 0; fi < block.fx.length; fi++) {
                if (FX_KEYS[block.fx[fi]]) fxCls += " lime-fx-" + block.fx[fi];
            }
        }
        // Переиспользуемые style-классы (этап 0.1): lime-c-* по белому списку safeCls.
        var userCls = "";
        if (block.classes && block.classes.length) {
            for (var uci = 0; uci < block.classes.length; uci++) {
                var sc = safeCls(block.classes[uci]);
                if (sc) userCls += " lime-c-" + sc;
            }
        }
        // Макет (Фаза 6.2): boxed — контент в колонку по центру (фон остаётся full-bleed); bento — плотная сетка.
        var layout = "";
        if (block.content) {
            if (block.content.width === "boxed") layout += ' data-width="boxed"';
            if (block.content.layout === "bento") layout += ' data-bento="1"';
        }
        // Грип перетаскивания — только в редакторе.
        var grip = (opts && opts.editable) ? '<span class="lime-block-grip" title="Перетащить">⠿</span>' : "";
        return '<section class="lime-block' + fxCls + userCls + '" data-block-type="' + escAttr(block.type) + '" data-block-id="' + escAttr(block.id) + '"' + cols + anim + motion + layout + ">" +
            bgLayersHtml(block) +
            layersHtml(block, opts) +
            grip +
            '<div class="lime-block__inner">' + renderInner(block, opts) + kids + "</div>" +
            "</section>";
    }

    // Резолв компонента-инстанса: подставляет блок из doc.components, но с id инстанса
    // (стили/контент общие — правка компонента отражается на всех копиях).
    function resolve(block, components) {
        if (block && block.type === "component" && components && components[block.ref]) {
            var c = (components[block.ref] && components[block.ref].block) || {};
            return {
                id: block.id, type: c.type, content: c.content, styles: c.styles, css: c.css,
                anim: c.anim, animDelay: c.animDelay, animDuration: c.animDuration,
                parallax: c.parallax, sticky: c.sticky, stickyOffset: c.stickyOffset,
                marquee: c.marquee, scene: c.scene, layers: c.layers, fx: c.fx,
                classes: c.classes, children: c.children
            };
        }
        return block;
    }

    function renderBlocks(blocks, components, opts) {
        var resolved = (blocks || []).map(function (b) { return resolve(b, components); });
        return {
            css: resolved.map(function (b) { return compileBlockCss(b, components); }).join("\n"),
            html: resolved.map(function (b) { return renderBlock(b, opts, components); }).join("\n")
        };
    }

    // Рендер одной страницы (для превью в редакторе). body = <style> + .lime-doc-page.
    function render(doc, opts) {
        doc = doc || {};
        var r = renderBlocks(doc.blocks || [], doc.components || {}, opts);
        var css = themeCss(doc.theme) + "\n" + classesCss(doc.theme) + "\n" + r.css + customCssOf(doc);
        var html = '<div class="lime-doc-page">' + r.html + "</div>";
        return { css: css, html: html, body: '<style data-lime-doc-css>' + css + "</style>\n" + html };
    }

    // Список страниц (с обратной совместимостью: старый doc.blocks → одна страница).
    function pagesOf(doc) {
        if (doc && doc.pages && doc.pages.length) return doc.pages;
        return [{ slug: "", title: "Главная", blocks: (doc && doc.blocks) || [] }];
    }

    // Рендер ОДНОЙ страницы сайта с реальными URL в навигации (этап 0.3).
    // Используется сервером: /u/{user}/{slug}/{page} отдаёт только нужную страницу.
    // opts.baseUrl — корень сайта ("/u/user/slug"); главная (slug="") живёт на нём,
    // остальные — на baseUrl + "/" + slug. Возвращает { title, body } или null,
    // если страницы с таким slug нет (→ 404 на сервере).
    function renderPage(doc, pageSlug, opts) {
        doc = doc || {};
        opts = opts || {};
        var pages = pagesOf(doc);
        var slug = pageSlug || "";
        var page = null;
        for (var i = 0; i < pages.length; i++) {
            if ((pages[i].slug || "") === slug) { page = pages[i]; break; }
        }
        // Главная без явного slug — первая страница.
        if (!page && slug === "") page = pages[0];
        if (!page) return null;

        var base = opts.baseUrl || "";
        var nav = "";
        if (pages.length > 1) {
            nav = '<nav class="lime-doc-nav">' + pages.map(function (p) {
                var href = (p.slug || "") === "" ? (base || "/") : base + "/" + p.slug;
                var active = p === page ? ' class="is-active"' : "";
                return '<a href="' + escAttr(href) + '"' + active + ">" + escHtml(p.title || p.slug || "Стр.") + "</a>";
            }).join("") + "</nav>";
        }
        // Прокидываем данные коллекций (opts.data) в рендереры блоков (collectionList).
        var r = renderBlocks(page.blocks, doc.components || {}, { data: opts.data });
        var css = themeCss(doc.theme) + "\n" + classesCss(doc.theme) + "\n" + r.css + customCssOf(doc);
        return {
            title: page.title || "",
            body: '<style data-lime-doc-css>' + css + "</style>\n" + nav +
                '<div class="lime-doc-page">' + r.html + "</div>"
        };
    }

    // Компиляция всего сайта в publish-HTML. Одна страница → как render. Несколько →
    // навигация + все страницы в одном HTML с hash-роутингом (рантайм lime-pages.js).
    function renderSite(doc) {
        doc = doc || {};
        var comps = doc.components || {};
        var pages = pagesOf(doc);

        if (pages.length <= 1) {
            var one = renderBlocks(pages[0] ? pages[0].blocks : [], comps, {});
            var css1 = themeCss(doc.theme) + "\n" + classesCss(doc.theme) + "\n" + one.css + customCssOf(doc);
            return '<style data-lime-doc-css>' + css1 + "</style>\n<div class=\"lime-doc-page\">" + one.html + "</div>";
        }

        var cssParts = [themeCss(doc.theme), classesCss(doc.theme)];
        var nav = '<nav class="lime-doc-nav">' + pages.map(function (p) {
            return '<a href="#' + escAttr(p.slug) + '" data-lime-page-link="' + escAttr(p.slug) + '">' + escHtml(p.title || p.slug || "Стр.") + "</a>";
        }).join("") + "</nav>";
        var wraps = pages.map(function (p, i) {
            var r = renderBlocks(p.blocks, comps, {});
            cssParts.push(r.css);
            if (i === pages.length - 1) cssParts.push(customCssOf(doc)); // глобальный CSS — после всех блоков
            return '<div class="lime-doc-page lime-doc-page-wrap" data-lime-page="' + escAttr(p.slug) + '"' + (i > 0 ? " hidden" : "") + ">" + r.html + "</div>";
        }).join("\n");
        return '<style data-lime-doc-css>' + cssParts.join("\n") + "</style>\n" +
            '<div data-lime-pages>' + nav + wraps + "</div>";
    }

    // Весь CSS документа одним куском (тема + стили всех блоков всех страниц, рекурсивно) —
    // для экспорта в Next.js-проект (идиоматичный режим): компоненты статичны, а стили реальны.
    function compileDocCss(doc) {
        doc = doc || {};
        var comps = doc.components || {};
        var pages = pagesOf(doc);
        var css = themeCss(doc.theme) + "\n" + classesCss(doc.theme);
        pages.forEach(function (p) {
            (p.blocks || []).forEach(function (b) {
                css += "\n" + compileBlockCss(resolve(b, comps), comps);
            });
        });
        css += customCssOf(doc); // глобальный CSS сайта — и в Next-экспорт (этап 0.2)
        return css;
    }

    return {
        BREAKPOINTS: BREAKPOINTS,
        RENDERERS: RENDERERS,
        DEFAULTS: DEFAULTS,
        DEFAULT_THEME: DEFAULT_THEME,
        THEME_TOKENS: THEME_TOKENS,
        createBlock: createBlock,
        isContainer: isContainer,
        render: render,
        renderSite: renderSite,
        renderPage: renderPage,
        pagesOf: pagesOf,
        renderBlock: renderBlock,
        compileBlockCss: compileBlockCss,
        compileDocCss: compileDocCss,
        themeCss: themeCss,
        classesCss: classesCss,
        safeCls: safeCls,
        scopeCss: scopeCss,
        styleDecls: styleDecls
    };
});
