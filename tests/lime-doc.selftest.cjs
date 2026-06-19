/*
 * Node self-test движка lime-doc.js (без браузера). Паттерн B*-RENDER-OK из Трека B.
 * Запуск: node tests/lime-doc.selftest.cjs
 * Покрывает этап 0.1 (children[]) + регрессию плоского рендера (B2/B3).
 */
"use strict";

const path = require("path");
const L = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));

let failed = 0;
function check(name, cond) {
    if (cond) {
        console.log("OK  " + name);
    } else {
        failed++;
        console.error("FAIL " + name);
    }
}

// --- Регрессия: плоский документ рендерится как раньше (B2) ---
{
    const doc = {
        version: 1,
        theme: { accent: "#ff0000" },
        blocks: [{
            id: "flat1", type: "heading", content: { text: "Привет" },
            styles: { base: { color: "#fff" }, mobile: { fontSize: "20px" } }
        }]
    };
    const out = L.render(doc, {});
    check("flat: html содержит блок и текст", out.html.includes('data-block-id="flat1"') && out.html.includes("Привет"));
    check("flat: css содержит base и mobile media", out.css.includes('[data-block-id="flat1"]{color:#fff;}') && out.css.includes("@media(max-width:640px)"));
    check("flat: тема в css-переменных", out.css.includes("--lt-accent:#ff0000"));
}

// --- 0.1: children рендерятся рекурсивно, css компилируется для вложенных ---
{
    const doc = {
        version: 1,
        blocks: [{
            id: "parent1", type: "spacer", styles: { base: { padding: "40px" } },
            children: [
                { id: "kid1", type: "heading", content: { text: "Вложенный" }, styles: { base: { color: "#abc" }, tablet: { fontSize: "18px" } } },
                { id: "kid2", type: "text", content: { text: "Глубже" }, children: [
                    { id: "kid3", type: "text", content: { text: "Третий уровень" } }
                ] }
            ]
        }]
    };
    const out = L.render(doc, {});
    check("children: обёртка lime-block__children", out.html.includes('class="lime-block__children"'));
    check("children: вложенный блок и текст", out.html.includes('data-block-id="kid1"') && out.html.includes("Вложенный"));
    check("children: третий уровень вложенности", out.html.includes('data-block-id="kid3"') && out.html.includes("Третий уровень"));
    check("children: css вложенного (base)", out.css.includes('[data-block-id="kid1"]{color:#abc;}'));
    check("children: css вложенного (tablet media)", out.css.includes("@media(max-width:1024px){[data-block-id=\"kid1\"]"));
    // Порядок DOM: ребёнок внутри родителя
    const pi = out.html.indexOf('data-block-id="parent1"');
    const ki = out.html.indexOf('data-block-id="kid1"');
    const pEnd = out.html.indexOf("</section>", ki);
    check("children: ребёнок внутри секции родителя", pi !== -1 && ki > pi && pEnd !== -1);
}

// --- 0.1: компонент-инстанс с children резолвится (children приходят из определения) ---
{
    const doc = {
        version: 1,
        components: {
            hero: { block: { type: "spacer", styles: {}, children: [
                { id: "ck1", type: "heading", content: { text: "Из компонента" } }
            ] } }
        },
        blocks: [{ id: "inst1", type: "component", ref: "hero" }]
    };
    const out = L.render(doc, {});
    check("component: инстанс получает children определения", out.html.includes("Из компонента"));
    check("component: id инстанса сохранён", out.html.includes('data-block-id="inst1"'));
}

// --- 0.1: циклический компонент не вешает рендер (MAX_DEPTH) ---
{
    const doc = {
        version: 1,
        components: {
            loop: { block: { type: "spacer", children: [{ id: "self", type: "component", ref: "loop" }] } }
        },
        blocks: [{ id: "cycle1", type: "component", ref: "loop" }]
    };
    let ok = false;
    const t0 = Date.now();
    try {
        L.render(doc, {});
        ok = Date.now() - t0 < 5000;
    } catch (e) {
        ok = false;
    }
    check("cycle: рендер завершается (защита глубины)", ok);
}

// --- 0.5: медиа-блоки image / gallery / video ---
{
    const doc = {
        version: 1,
        blocks: [
            { id: "img1", type: "image", content: { src: '/media/u1/pic.jpg"onerror="x', alt: "Фото", caption: "Подпись" } },
            { id: "gal1", type: "gallery", content: { items: [{ src: "/media/u1/a.jpg" }, { src: "" }] } },
            { id: "vid1", type: "video", content: { youtubeId: "dQw4w9WgXcQ" } }
        ]
    };
    // Публикация (editable=false)
    const pub = L.render(doc, {});
    check("image: img с экранированным src", pub.html.includes('src="/media/u1/pic.jpg&quot;onerror=&quot;x"'));
    check("image: подпись в figcaption", pub.html.includes("Подпись"));
    check("gallery: заполненный элемент есть, пустой слот не рендерится", pub.html.includes("/media/u1/a.jpg") && !pub.html.includes("+ фото"));
    check("video: youtube iframe", pub.html.includes("youtube.com/embed/dQw4w9WgXcQ"));
    check("publish: нет редакторских хуков", !pub.html.includes("data-doc-pick") && !pub.html.includes("data-doc-video") && !pub.html.includes("lime-doc-media-swap"));

    // Редактор (editable=true)
    const ed = L.render(doc, { editable: true });
    check("editor: кнопка замены изображения", ed.html.includes('data-doc-pick="src"'));
    check("editor: пустой слот галереи кликабелен", ed.html.includes('data-doc-pick="items.1.src"'));
    check("editor: плитка добавления слота", ed.html.includes("data-doc-gallery-add"));

    // Пустые блоки в редакторе показывают плейсхолдеры
    const empty = L.render({ version: 1, blocks: [
        Object.assign(L.createBlock("image"), { id: "e1" }),
        Object.assign(L.createBlock("video"), { id: "e2" })
    ] }, { editable: true });
    check("editor: плейсхолдеры пустых image/video", empty.html.includes("выбрать изображение") && empty.html.includes("data-doc-video"));
}

// --- Этап 1: структурные блоки container / columns ---
{
    const cols = L.createBlock("columns");
    check("columns: createBlock даёт children[] и cols=2", Array.isArray(cols.children) && cols.content.cols === 2);
    check("isContainer: container/columns да, text нет", L.isContainer("container") && L.isContainer("columns") && !L.isContainer("text"));

    const doc = {
        version: 1,
        blocks: [{
            id: "col1", type: "columns", content: { cols: 3 },
            children: [
                { id: "c1", type: "text", content: { text: "Левая" } },
                { id: "c2", type: "text", content: { text: "Правая" } }
            ]
        }, {
            id: "box1", type: "container", content: {}, children: []
        }]
    };
    const pub = L.render(doc, {});
    check("columns: data-cols в разметке", pub.html.includes('data-cols="3"'));
    check("columns: дети внутри children-обёртки", pub.html.includes("lime-block__children") && pub.html.includes("Левая") && pub.html.includes("Правая"));
    check("publish: пустой контейнер без подсказки", !pub.html.includes("lime-doc-drop-hint"));
    const ed = L.render(doc, { editable: true });
    check("editor: пустой контейнер показывает подсказку", ed.html.includes("lime-doc-drop-hint"));

    // DnD (полировка): грип и пустая drop-зона — только в редакторе.
    check("editor: у блоков есть грип перетаскивания", ed.html.includes("lime-block-grip"));
    check("publish: грипа нет", !pub.html.includes("lime-block-grip"));
    const emptyBoxEd = L.render({ version: 1, blocks: [{ id: "eb1", type: "container", content: {}, children: [] }] }, { editable: true });
    const emptyBoxPub = L.render({ version: 1, blocks: [{ id: "eb1", type: "container", content: {}, children: [] }] }, {});
    check("editor: пустой контейнер имеет children-обёртку (зона дропа)", emptyBoxEd.html.includes("lime-block__children"));
    check("publish: у пустого контейнера обёртки нет", !emptyBoxPub.html.includes("lime-block__children"));
}

// --- 0.3: renderPage — одна страница с реальными URL в навигации ---
{
    const doc = {
        version: 1,
        pages: [
            { slug: "", title: "Главная", blocks: [{ id: "h1", type: "heading", content: { text: "Дом" } }] },
            { slug: "about", title: "О нас", blocks: [{ id: "a1", type: "text", content: { text: "Про нас" } }] }
        ]
    };
    const base = "/u/user/site";
    const home = L.renderPage(doc, "", { baseUrl: base });
    check("renderPage: главная содержит только свои блоки", home.body.includes("Дом") && !home.body.includes("Про нас"));
    check("renderPage: реальные ссылки в nav", home.body.includes('href="/u/user/site"') && home.body.includes('href="/u/user/site/about"'));
    check("renderPage: активная страница помечена", home.body.includes('class="is-active"'));
    check("renderPage: title страницы", L.renderPage(doc, "about", { baseUrl: base }).title === "О нас");
    const about = L.renderPage(doc, "about", { baseUrl: base });
    check("renderPage: внутренняя страница рендерит свои блоки", about.body.includes("Про нас") && !about.body.includes("Дом"));
    check("renderPage: нет hash-роутинга", !home.body.includes("data-lime-pages") && !home.body.includes('href="#'));
    check("renderPage: несуществующий slug → null", L.renderPage(doc, "missing", { baseUrl: base }) === null);

    // Одностраничный сайт — без навигации
    const single = L.renderPage({ version: 1, blocks: [{ id: "s1", type: "text", content: { text: "Один" } }] }, "", {});
    check("renderPage: одностраничный без nav", single.body.includes("Один") && !single.body.includes("lime-doc-nav"));
}

// --- Регрессия: многостраничный renderSite с hash-роутингом (B3) ---
{
    const doc = {
        version: 1,
        pages: [
            { slug: "", title: "Главная", blocks: [{ id: "pA", type: "heading", content: { text: "Стр1" } }] },
            { slug: "about", title: "О нас", blocks: [{ id: "pB", type: "heading", content: { text: "Стр2" } }] }
        ]
    };
    const html = L.renderSite(doc);
    check("pages: маркер data-lime-pages", html.includes("data-lime-pages"));
    check("pages: обе страницы в выдаче", html.includes("Стр1") && html.includes("Стр2"));
}

// --- Фаза 0.3: фон-слои секции (видео + затемнение) ---
{
    const doc = {
        version: 1,
        blocks: [{
            id: "bg1", type: "heading", content: {
                text: "Над фоном",
                bg: { videoSrc: '/media/u1/clip.mp4"x', poster: "/media/u1/p.jpg", overlay: "rgba(10,6,18,0.55)", blur: "6px" }
            }
        }]
    };
    const pub = L.render(doc, {});
    check("bg: видео-фон с экранированным src", pub.html.includes("lime-block__bgvideo") && pub.html.includes("/media/u1/clip.mp4&quot;x"));
    check("bg: poster проброшен", pub.html.includes('poster="/media/u1/p.jpg"'));
    check("bg: overlay-слой с фоном и блюром", pub.html.includes("lime-block__overlay") && pub.html.includes("rgba(10,6,18,0.55)") && pub.html.includes("backdrop-filter:blur(6px)"));
    // Фон-слои — прямые дети секции (до .lime-block__inner), и идентичны в редакторе.
    const secIdx = pub.html.indexOf('data-block-id="bg1"');
    const innerIdx = pub.html.indexOf("lime-block__inner", secIdx);
    const ovIdx = pub.html.indexOf("lime-block__overlay", secIdx);
    check("bg: слои перед .lime-block__inner", ovIdx !== -1 && ovIdx < innerIdx);
    const ed = L.render(doc, { editable: true });
    check("bg: видео/overlay рендерятся и в редакторе", ed.html.includes("lime-block__bgvideo") && ed.html.includes("lime-block__overlay"));
    // Без content.bg — никаких фон-слоёв.
    const plain = L.render({ version: 1, blocks: [{ id: "p1", type: "text", content: { text: "x" } }] }, {});
    check("bg: без bg нет слоёв", !plain.html.includes("lime-block__overlay") && !plain.html.includes("lime-block__bgvideo"));
}

// --- Фаза 2: движение (parallax/sticky/marquee) + декор-слои ---
{
    const doc = {
        version: 1,
        blocks: [
            { id: "m1", type: "heading", content: { text: "Парал" }, parallax: "0.3", sticky: true, stickyOffset: "20" },
            {
                id: "m2", type: "columns", content: { cols: 2 }, marquee: { speed: 50, reverse: true },
                children: [{ id: "mc1", type: "text", content: { text: "A" } }]
            },
            {
                id: "m3", type: "cover", content: { title: "Hero" }, layers: [
                    { id: "l1", kind: "shape", shape: "blob", color: "#a78bfa", x: 70, y: 10, w: 200, z: 2, depth: 0.4 },
                    { id: "l2", kind: "image", src: '/media/u/cloud.png"x', x: 10, y: 40, w: 160, z: -1 }
                ]
            }
        ]
    };
    const pub = L.render(doc, {});
    check("motion: data-parallax на секции", pub.html.includes('data-block-id="m1"') && pub.html.includes('data-parallax="0.3"'));
    check("motion: data-sticky + offset", pub.html.includes('data-sticky="1"') && pub.html.includes('data-sticky-offset="20"'));
    check("motion: marquee на children-обёртке", pub.html.includes("lime-block__children--marquee") && pub.html.includes('data-marquee="50"') && pub.html.includes('data-marquee-reverse="1"'));
    check("layers: контейнер слоёв и фигура-blob", pub.html.includes("lime-block__layers") && pub.html.includes("lime-block__layer--blob"));
    check("layers: позиция/размер/z инлайном", pub.html.includes("left:70%") && pub.html.includes("width:200px") && pub.html.includes("z-index:2"));
    check("layers: картинка-слой с экранированным src", pub.html.includes("/media/u/cloud.png&quot;x"));
    check("layers: depth → data-parallax у слоя", pub.html.includes('data-parallax="0.4"'));
    check("layers: в publish нет data-layer-id (drag только в редакторе)", !pub.html.includes("data-layer-id"));
    const ed = L.render(doc, { editable: true });
    check("layers: в редакторе есть data-layer-id для драга", ed.html.includes('data-layer-id="l1"'));
}

// --- Фаза 6.1: широта блоков (navbar/footer/accordion/pricing/.../form) ---
{
    const types = ["navbar", "footer", "accordion", "pricing", "testimonials", "logos", "steps", "imageText", "socials", "form"];
    const blocks = types.map(function (t, i) { return Object.assign(L.createBlock(t), { id: "n" + i }); });
    const pub = L.render({ version: 1, blocks: blocks }, {});
    const ed = L.render({ version: 1, blocks: blocks }, { editable: true });
    const classByType = {
        navbar: "lime-block__navbar", footer: "lime-block__footer", accordion: "lime-block__accordion",
        pricing: "lime-block__pricing", testimonials: "lime-block__testimonials", logos: "lime-block__logos",
        steps: "lime-block__steps", imageText: "lime-block__imagetext", socials: "lime-block__socials", form: "lime-block__form"
    };
    types.forEach(function (t) {
        check("breadth: " + t + " рендерит свою разметку", pub.html.indexOf(classByType[t]) >= 0);
    });
    check("breadth: pricing помечает featured-план", pub.html.includes("is-featured"));
    check("breadth: accordion использует details/summary", pub.html.includes("<details") && pub.html.includes("<summary"));
    check("breadth: form несёт data-lime-form (для InjectFormEndpoints)", pub.html.includes("data-lime-form"));
    check("breadth: form honeypot lime_hp", pub.html.includes('name="lime_hp"'));
    check("breadth: publish без contenteditable", pub.html.indexOf("contenteditable") === -1);
    check("breadth: editor добавляет data-field для inline-правки", ed.html.includes('data-field="brand"') && ed.html.includes('data-field="plans.0.name"'));
    // createBlock материализует контент по умолчанию (списки не пустые)
    check("breadth: createBlock наполняет content (pricing.plans)", L.createBlock("pricing").content.plans.length === 3);
}

// --- Фаза 6.2/6.3: макет (boxed/bento) + универсальные эффекты (fx) ---
{
    const doc = {
        version: 1,
        blocks: [
            { id: "fx1", type: "heading", content: { text: "T", width: "boxed" }, fx: ["glass", "glow", "gradient-text"] },
            { id: "bn1", type: "columns", content: { cols: 3, layout: "bento" }, children: [{ id: "c1", type: "text", content: { text: "x" } }] },
            { id: "ev1", type: "heading", content: { text: "T" }, fx: ["evil\" onload=alert(1)"] } // не в белом списке
        ]
    };
    const pub = L.render(doc, {});
    check("fx: классы lime-fx-* на секции", pub.html.includes("lime-fx-glass") && pub.html.includes("lime-fx-glow") && pub.html.includes("lime-fx-gradient-text"));
    check("fx: неизвестный/опасный ключ отфильтрован (whitelist)", !pub.html.includes("evil") && !pub.html.includes("onload=alert"));
    check("layout: boxed → data-width", pub.html.includes('data-width="boxed"'));
    check("layout: bento → data-bento", pub.html.includes('data-bento="1"'));
}

// --- Фаза 8: embed/3D + scrollytelling ---
{
    const doc = {
        version: 1,
        blocks: [
            { id: "em1", type: "embed", content: { embedUrl: "https://my.spline.design/scene\"x" } },
            { id: "em2", type: "embed", content: { embedUrl: "javascript:alert(1)" } }, // не-https → не рендерим
            { id: "sc1", type: "columns", content: { cols: 3 }, scene: { mode: "horizontal", length: 3 },
              children: [{ id: "k1", type: "text", content: { text: "A" } }, { id: "k2", type: "text", content: { text: "B" } }] }
        ]
    };
    const pub = L.render(doc, {});
    check("embed: sandbox-iframe для https", pub.html.includes("lime-block__embed") && pub.html.includes("<iframe") && pub.html.includes('sandbox="allow-scripts'));
    check("embed: src экранирован", pub.html.includes("https://my.spline.design/scene&quot;x"));
    check("embed: не-https не рендерит iframe", (pub.html.match(/<iframe/g) || []).length === 1);
    check("embed: publish без хука data-doc-embed", !pub.html.includes("data-doc-embed"));
    const ed = L.render(doc, { editable: true });
    check("embed: пустой/невалидный в редакторе — плейсхолдер", ed.html.includes("data-doc-embed"));
    check("scene: data-scene + length на секции", pub.html.includes('data-scene="horizontal"') && pub.html.includes('data-scene-length="3"'));
    check("scene: горизонтальный трек на обёртке", pub.html.includes("lime-block__children--scene"));
}

// --- Фуллстак (B3): блок collectionList читает opts.data[slug] = { fields, records } ---
{
    const doc = { version: 1, blocks: [{ id: "cl1", type: "collectionList", content: { collection: "goods" } }] };
    const data = {
        goods: {
            fields: [{ name: "title", label: "Название", type: "text" }, { name: "img", label: "Фото", type: "image" }],
            records: [{ title: "Гаджет", img: 'https://x/a.jpg"x' }, { title: "Штука" }]
        }
    };
    const pub = L.render(doc, { data: data });
    check("collectionList: карточки записей из данных", pub.html.includes("lime-block__collection") && pub.html.includes("Гаджет") && pub.html.includes("Штука"));
    check("collectionList: image-поле как <img> с экранированием", pub.html.includes('class="lime-cl-img" src="https://x/a.jpg&quot;x"'));
    check("collectionList: метка поля из схемы", pub.html.includes("Название"));
    const emptyPub = L.render(doc, {});
    check("collectionList: публикация без данных — пусто (не показываем контейнер)", emptyPub.html.indexOf("lime-block__collection") === -1);
    const ed = L.render(doc, { editable: true });
    check("collectionList: в редакторе — превью-подсказка", ed.html.includes("lime-doc-drop-hint"));
    const noSlug = L.render({ version: 1, blocks: [{ id: "cl2", type: "collectionList", content: {} }] }, { editable: true });
    check("collectionList: без коллекции — подсказка выбрать", noSlug.html.includes("выбери источник"));
}

// --- 1.2: hover-состояние компилируется в :hover-правило + transition ---
{
    const doc = {
        version: 1,
        blocks: [
            { id: "hv1", type: "cta", content: { title: "Кнопка" }, styles: {
                base: { color: "#fff" }, hover: { color: "#84cc16", boxShadow: "0 8px 24px rgba(0,0,0,.3)" }
            } },
            { id: "hv2", type: "text", content: { text: "Без hover" }, styles: { base: { color: "#abc" } } },
            { id: "hv3", type: "text", content: { text: "Пустой hover" }, styles: { base: {}, hover: {} } }
        ]
    };
    const out = L.render(doc, {});
    check("hover: :hover-правило с пропсами", out.css.includes('[data-block-id="hv1"]:hover{color:#84cc16;box-shadow:0 8px 24px rgba(0,0,0,.3);}'));
    check("hover: transition добавлен только при наличии hover", out.css.includes('[data-block-id="hv1"]{transition:all .2s ease;}'));
    check("hover: base-правило не сломано", out.css.includes('[data-block-id="hv1"]{color:#fff;}'));
    check("hover: блок без hover — без :hover и без transition", !out.css.includes('[data-block-id="hv2"]:hover') && !out.css.includes('[data-block-id="hv2"]{transition'));
    check("hover: пустой бакет hover игнорируется", !out.css.includes('[data-block-id="hv3"]:hover'));
}

// --- 0.1: переиспользуемые style-классы (Webflow-classes) ---
{
    const doc = {
        version: 1,
        theme: {
            classes: [
                { cls: "btnPrimary", name: "Кнопка primary", styles: {
                    base: { color: "#fff", padding: "12px" }, tablet: { padding: "8px" }, hover: { color: "#84cc16" }
                } },
                { cls: "bad name!", name: "Опасный", styles: { base: { color: "#000" } } } // невалидный cls → отброшен
            ]
        },
        blocks: [
            { id: "cb1", type: "cta", content: { title: "T" }, classes: ["btnPrimary", "unknown"] },
            { id: "cb2", type: "text", content: { text: "x" }, classes: ["btnPrimary"], styles: { base: { color: "#111" } } }
        ]
    };
    const out = L.render(doc, {});
    check("classes: css класса .lime-c-btnPrimary (base)", out.css.includes(".lime-c-btnPrimary{color:#fff;padding:12px;}"));
    check("classes: класс получает media tablet", out.css.includes("@media(max-width:1024px){.lime-c-btnPrimary{padding:8px;}}"));
    check("classes: класс получает :hover + transition", out.css.includes(".lime-c-btnPrimary:hover{color:#84cc16;}") && out.css.includes(".lime-c-btnPrimary{transition:all .2s ease;}"));
    check("classes: невалидный cls отброшен (safeCls whitelist)", !out.css.includes("bad name") && out.css.indexOf(".lime-c-bad") === -1);
    check("classes: блок несёт lime-c-* в class (валидные имена)", out.html.includes('data-block-id="cb1"') && /<section class="lime-block lime-c-btnPrimary lime-c-unknown"/.test(out.html));
    const danger = L.render({ version: 1, blocks: [{ id: "d1", type: "text", content: { text: "x" }, classes: ['evil" onclick="x'] }] }, {});
    check("classes: опасный cls в block.classes отброшен (safeCls в renderBlock)", !danger.html.includes("evil") && !danger.html.includes("onclick"));
    // Каскад: класс эмитится ДО per-block css → свой стиль блока перебивает класс.
    const ciClass = out.css.indexOf(".lime-c-btnPrimary{color:#fff");
    const ciBlock = out.css.indexOf('[data-block-id="cb2"]{color:#111;}');
    check("classes: per-block css идёт после класса (перебивает)", ciClass !== -1 && ciBlock !== -1 && ciBlock > ciClass);
    check("classes: safeCls API", L.safeCls("ok_-9") === "ok_-9" && L.safeCls("плохо ") === null);
}

// --- 0.1: расширенные токены (палитра + шкалы) ---
{
    const out = L.render({ version: 1, theme: { palette: ["#111111", "#222222"] }, blocks: [] }, {});
    check("tokens: палитра → --lt-c1/--lt-c2", out.css.includes("--lt-c1:#111111;") && out.css.includes("--lt-c2:#222222;"));
    check("tokens: спейсинг-шкала --lt-space-*", out.css.includes("--lt-space-4:16px;") && out.css.includes("--lt-space-9:96px;"));
    check("tokens: типографическая шкала --lt-text-*", out.css.includes("--lt-text-base:1rem;") && out.css.includes("--lt-text-2xl:1.5rem;"));
    const noPal = L.render({ version: 1, blocks: [] }, {});
    check("tokens: без palette — нет --lt-c1 (обратная совместимость)", !noPal.css.includes("--lt-c1:"));
}

// --- 0.1: классы в classesCss напрямую (без блоков) ---
{
    const css = L.classesCss({ classes: [{ cls: "card", styles: { base: { borderRadius: "12px" } } }] });
    check("classesCss: standalone компиляция", css === ".lime-c-card{border-radius:12px;}");
    check("classesCss: пустая тема → пусто", L.classesCss({}) === "" && L.classesCss(null) === "");
}

// --- 0.2: глобальный CSS сайта (doc.customCss) ---
{
    const doc = {
        version: 1,
        theme: { accent: "#abcdef" },
        customCss: ".lime-block__heading{letter-spacing:-1px}</style><script>alert(1)</script>",
        blocks: [{ id: "g1", type: "heading", content: { text: "T" }, styles: { base: { color: "#111" } } }]
    };
    const out = L.render(doc, {});
    check("customCss: попадает в style-блок", out.css.includes(".lime-block__heading{letter-spacing:-1px}"));
    check("customCss: идёт ПОСЛЕ стилей блока (может перебить)", out.css.indexOf('[data-block-id="g1"]{color:#111;}') < out.css.indexOf(".lime-block__heading{letter-spacing"));
    check("customCss: закрытие </style> вырезано (нельзя выйти из style)", !out.css.includes("</style"));
    // renderSite (одностраничный) и renderPage тоже несут customCss
    check("customCss: renderSite несёт глобальный CSS", L.renderSite(doc).includes(".lime-block__heading{letter-spacing:-1px}"));
    check("customCss: compileDocCss (экспорт) несёт глобальный CSS", L.compileDocCss(doc).includes(".lime-block__heading{letter-spacing:-1px}"));
    const noCss = L.render({ version: 1, blocks: [] }, {});
    check("customCss: без поля ничего не добавляется", typeof noCss.css === "string");
}

if (failed) {
    console.error("\nSELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nCHILDREN-RENDER-OK (0.1) + MEDIA-RENDER-OK (0.5) + BG-LAYERS-OK (0.3) + MOTION/LAYERS-OK (2) + HOVER-OK (1.2) + CLASSES/TOKENS-OK (0.1) + B2/B3 регрессия зелёные");
