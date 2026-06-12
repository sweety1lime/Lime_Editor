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

if (failed) {
    console.error("\nSELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nCHILDREN-RENDER-OK (0.1) + MEDIA-RENDER-OK (0.5) + B2/B3 регрессия зелёные");
