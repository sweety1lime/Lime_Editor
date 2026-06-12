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
 *           "mobile": { "fontSize": "24px" }
 *         },
 *         "css": "h2 { letter-spacing: 1px }", // опц. свой CSS (auto-scoped к блоку)
 *         "children": []                      // опц. вложенные блоки (контейнеры, этап 0.1/1.1)
 *       }
 *     ]
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

    function themeCss(theme) {
        var t = {};
        Object.assign(t, DEFAULT_THEME, theme || {});
        return ":root{" +
            "--lt-accent:" + t.accent + ";--lt-accent2:" + t.accent2 + ";" +
            "--lt-bg:" + t.bg + ";--lt-fg:" + t.fg + ";--lt-muted:" + t.muted + ";" +
            "--lt-font:" + t.font + ";}" +
            ".lime-doc-page{background:var(--lt-bg);color:var(--lt-fg);font-family:var(--lt-font);}";
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
        var s = block.styles || {};
        var css = "";
        if (s.base) css += sel + "{" + styleDecls(s.base) + "}";
        if (s.tablet) css += "@media(max-width:" + BREAKPOINTS.tablet + "px){" + sel + "{" + styleDecls(s.tablet) + "}}";
        if (s.mobile) css += "@media(max-width:" + BREAKPOINTS.mobile + "px){" + sel + "{" + styleDecls(s.mobile) + "}}";
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
        divider: function () { return '<div class="lime-block__divider"><span></span></div>'; },
        spacer: function () { return '<div class="lime-block__spacer"></div>'; },
        // --- Медиа-блоки (этап 0.5). data-doc-pick/data-doc-video — хуки редактора,
        // на публикации (editable=false) они не рендерятся вовсе.
        image: function (b, o) {
            var c = b.content || {};
            var editable = o && o.editable;
            var inner = "";
            if (c.src) {
                inner = '<img src="' + escAttr(c.src) + '" alt="' + escAttr(c.alt || "") + '" loading="lazy">' +
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
                        '<img src="' + escAttr(it.src) + '" alt="' + escAttr(it.alt || "") + '" loading="lazy">' + del +
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
        divider: {},
        spacer: {},
        image: { src: "", alt: "", caption: "" },
        gallery: { items: [{ src: "", alt: "" }, { src: "", alt: "" }, { src: "", alt: "" }] },
        video: { youtubeId: "" },
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

    function renderBlock(block, opts, components, depth) {
        var anim = "";
        if (block.anim) {
            anim = ' data-anim="' + escAttr(block.anim) + '"';
            if (block.animDelay) anim += ' data-anim-delay="' + escAttr(block.animDelay) + '"';
            if (block.animDuration) anim += ' data-anim-duration="' + escAttr(block.animDuration) + '"';
        }
        var kids = "";
        var hasKids = block.children && block.children.length;
        // В редакторе обёртка children рендерится у контейнеров ВСЕГДА (даже пустых) —
        // это зона дропа для drag-and-drop. В publish пустая обёртка не нужна.
        var wantWrapper = (hasKids || (opts && opts.editable && isContainer(block.type))) && (depth || 0) < MAX_DEPTH;
        if (wantWrapper) {
            kids = '<div class="lime-block__children">' + (block.children || []).map(function (ch) {
                return renderBlock(resolve(ch, components), opts, components, (depth || 0) + 1);
            }).join("") + "</div>";
        }
        // Колонки: число колонок уходит в data-cols, сетку рисует CSS (на мобиле — одна).
        var cols = (block.type === "columns" && block.content && block.content.cols)
            ? ' data-cols="' + escAttr(block.content.cols) + '"' : "";
        // Грип перетаскивания — только в редакторе.
        var grip = (opts && opts.editable) ? '<span class="lime-block-grip" title="Перетащить">⠿</span>' : "";
        return '<section class="lime-block" data-block-type="' + escAttr(block.type) + '" data-block-id="' + escAttr(block.id) + '"' + cols + anim + ">" +
            grip +
            '<div class="lime-block__inner">' + renderInner(block, opts) + kids + "</div>" +
            "</section>";
    }

    // Резолв компонента-инстанса: подставляет блок из doc.components, но с id инстанса
    // (стили/контент общие — правка компонента отражается на всех копиях).
    function resolve(block, components) {
        if (block && block.type === "component" && components && components[block.ref]) {
            var c = (components[block.ref] && components[block.ref].block) || {};
            return { id: block.id, type: c.type, content: c.content, styles: c.styles, css: c.css, anim: c.anim, children: c.children };
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
        var css = themeCss(doc.theme) + "\n" + r.css;
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
        var r = renderBlocks(page.blocks, doc.components || {}, {});
        var css = themeCss(doc.theme) + "\n" + r.css;
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
            var css1 = themeCss(doc.theme) + "\n" + one.css;
            return '<style data-lime-doc-css>' + css1 + "</style>\n<div class=\"lime-doc-page\">" + one.html + "</div>";
        }

        var cssParts = [themeCss(doc.theme)];
        var nav = '<nav class="lime-doc-nav">' + pages.map(function (p) {
            return '<a href="#' + escAttr(p.slug) + '" data-lime-page-link="' + escAttr(p.slug) + '">' + escHtml(p.title || p.slug || "Стр.") + "</a>";
        }).join("") + "</nav>";
        var wraps = pages.map(function (p, i) {
            var r = renderBlocks(p.blocks, comps, {});
            cssParts.push(r.css);
            return '<div class="lime-doc-page lime-doc-page-wrap" data-lime-page="' + escAttr(p.slug) + '"' + (i > 0 ? " hidden" : "") + ">" + r.html + "</div>";
        }).join("\n");
        return '<style data-lime-doc-css>' + cssParts.join("\n") + "</style>\n" +
            '<div data-lime-pages>' + nav + wraps + "</div>";
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
        scopeCss: scopeCss,
        styleDecls: styleDecls
    };
});
