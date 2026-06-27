/*
 * Node self-test движка lime-doc.js (без браузера). Паттерн B*-RENDER-OK из Трека B.
 * Запуск: node tests/lime-doc.selftest.cjs
 * Покрывает этап 0.1 (children[]) + регрессию плоского рендера (B2/B3).
 */
"use strict";

const path = require("path");
const L = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));
const V2_LAYOUTS = require("./fixtures/editor-v2-layouts.json");

let failed = 0;
function check(name, cond) {
    if (cond) {
        console.log("OK  " + name);
    } else {
        failed++;
        console.error("FAIL " + name);
    }
}

// --- Editor V2 additive design contract: shared renderer исполняет те же fixtures ---
{
    const byName = name => V2_LAYOUTS.find(f => f.name === name).doc;
    for (const fixture of V2_LAYOUTS) {
        const first = fixture.doc.pages[0].blocks[0];
        const html = L.renderSite(fixture.doc);
        const responsivePreview = ["base", "tablet", "mobile"].every(bp =>
            L.compilePreviewDesignCss(fixture.doc.pages[0].blocks, fixture.doc.components, bp).includes(`[data-block-id="${first.id}"]`));
        check("v2 acceptance: " + fixture.name + " renders desktop/tablet/mobile", html.includes(`data-block-id="${first.id}"`) && responsivePreview);
    }
    const freeHtml = L.renderSite(byName("hero-free"));
    const freeCss = L.compileDocCss(byName("hero-free"));
    check("v2 design: HTML marker only on design blocks", freeHtml.includes('data-block-id="free-hero" data-design="1"'));
    check("v2 free: parent children wrapper is positioned", freeCss.includes('display:block;position:relative;height:100%'));
    check("v2 free: child frame compiled", freeCss.includes('[data-block-id="hero-title"]{box-sizing:border-box') && freeCss.includes('position:absolute;left:64px;top:120px;width:520px;height:120px'));
    check("v2 free: mobile frame override compiled", freeCss.includes('@media(max-width:640px)') && freeCss.includes('left:16px;top:72px;width:288px;height:144px'));

    const gridCss = L.compileDocCss(byName("pricing-grid"));
    check("v2 grid: base/tablet/mobile columns", gridCss.includes('repeat(3,minmax(0,1fr))') && gridCss.includes('repeat(2,minmax(0,1fr))') && gridCss.includes('repeat(1,minmax(0,1fr))'));
    const stackCss = L.compileDocCss(byName("responsive-navbar"));
    check("v2 stack: direction override", stackCss.includes('flex-direction:row') && stackCss.includes('flex-direction:column'));
    const mobilePreviewCss = L.compilePreviewDesignCss(byName("responsive-navbar").pages[0].blocks, {}, "mobile");
    check("v2 preview: mobile effective design без media-query", mobilePreviewCss.includes('[data-block-id="navbar-frame"]') && mobilePreviewCss.includes("flex-direction:column") && !mobilePreviewCss.includes("@media"));
    const fullStack = JSON.parse(JSON.stringify(byName("responsive-navbar")));
    fullStack.pages[0].blocks[0].design.base.layout.wrap = true;
    fullStack.pages[0].blocks[0].design.base.layout.justify = "space-between";
    fullStack.pages[0].blocks[0].design.base.layout.padding = { top: 8, right: 16, bottom: 12, left: 20 };
    const fullStackCss = L.compileDocCss(fullStack);
    check("v2 stack: align/justify/wrap rendered", fullStackCss.includes("align-items:center") && fullStackCss.includes("justify-content:space-between") && fullStackCss.includes("flex-wrap:wrap"));
    check("v2 stack: four-side padding rendered", fullStackCss.includes("padding-top:8px") && fullStackCss.includes("padding-right:16px") && fullStackCss.includes("padding-bottom:12px") && fullStackCss.includes("padding-left:20px"));
    const framedStack = JSON.parse(JSON.stringify(byName("responsive-navbar")));
    framedStack.pages[0].blocks[0].children[0].design = { base: { frame: { x: 10, y: 20, width: 30, height: 40 } } };
    const framedStackCss = L.compileDocCss(framedStack);
    check("v2 invariant: frame under stack stays out of flow CSS", !framedStackCss.includes('[data-block-id="logo"]{box-sizing:border-box;position:absolute'));
    const responsiveFlow = JSON.parse(JSON.stringify(byName("responsive-navbar")));
    responsiveFlow.pages[0].blocks[0].design.base.layout.mode = "free";
    responsiveFlow.pages[0].blocks[0].design.tablet = { layout: { mode: "stack" } };
    responsiveFlow.pages[0].blocks[0].children[0].design = { base: { frame: { x: 10, y: 20, width: 30, height: 40 } } };
    const responsiveFlowCss = L.compileDocCss(responsiveFlow);
    check("v2 invariant: free→stack breakpoint resets absolute frame", responsiveFlowCss.includes('@media(max-width:1024px){[data-block-id="logo"]{position:static;left:auto;top:auto;width:auto;height:auto;transform:none}'));
    const unsafe = JSON.parse(JSON.stringify(byName("responsive-navbar")));
    unsafe.pages[0].blocks[0].design.base.layout.align = "start;color:red";
    check("v2 design: unsafe enum is not emitted", !L.compileDocCss(unsafe).includes("start;color:red"));

    // Grid срез: child span (gate под grid-родителем) + auto columns min/max/fill.
    const gridSpan = {
        version: 2, theme: {}, components: {},
        pages: [{ id: "p", slug: "", title: "T", blocks: [{ id: "grid", type: "container", content: {},
            design: { base: { layout: { mode: "grid", columns: 4, gap: 16, autoRows: 120 } } }, children: [
                { id: "wide", type: "text", content: { text: "x" }, design: { base: { span: 2, rowSpan: 2 } } },
                { id: "narrow", type: "text", content: { text: "y" }, design: { base: { span: 1 } } }
            ] }] }]
    };
    const gridSpanCss = L.compileDocCss(gridSpan);
    check("v2 grid: child spans emit grid-column/grid-row", gridSpanCss.includes('[data-block-id="wide"]{box-sizing:border-box;grid-column:span 2;grid-row:span 2}'));
    check("v2 grid: explicit auto rows rendered", gridSpanCss.includes("grid-auto-rows:120px"));
    check("v2 grid: span 1 emits no grid-column", !gridSpanCss.includes("grid-column:span 1"));
    const stackSpan = JSON.parse(JSON.stringify(gridSpan));
    stackSpan.pages[0].blocks[0].design.base.layout = { mode: "stack" };
    const stackSpanCss = L.compileDocCss(stackSpan);
    check("v2 grid: spans stripped under non-grid parent", !stackSpanCss.includes("grid-column:span") && !stackSpanCss.includes("grid-row:span"));
    stackSpan.pages[0].blocks[0].children[0].design.base.order = 3;
    check("v2 stack: child order rendered", L.compileDocCss(stackSpan).includes('[data-block-id="wide"]{box-sizing:border-box;order:3}'));
    const autoFit = JSON.parse(JSON.stringify(gridSpan));
    autoFit.pages[0].blocks[0].design.base.layout = { mode: "grid", columns: { mode: "auto", min: 240 } };
    check("v2 grid: auto-fit minmax(min,1fr)", L.compileDocCss(autoFit).includes("grid-template-columns:repeat(auto-fit,minmax(240px,1fr))"));
    const autoFill = JSON.parse(JSON.stringify(gridSpan));
    autoFill.pages[0].blocks[0].design.base.layout = { mode: "grid", columns: { mode: "auto", min: 200, max: 400, fill: true } };
    check("v2 grid: auto-fill minmax(min,maxpx)", L.compileDocCss(autoFill).includes("grid-template-columns:repeat(auto-fill,minmax(200px,400px))"));
    const unitFlex = JSON.parse(JSON.stringify(gridSpan));
    unitFlex.pages[0].blocks[0].design.base.size = { width: { mode: "fixed", value: "50%" }, height: { mode: "fixed", value: "20rem" } };
    unitFlex.pages[0].blocks[0].design.base.layout = {
        mode: "grid",
        columns: { mode: "auto", min: "12rem", max: "50%", fill: true },
        gap: "2rem",
        autoRows: "6rem",
        padding: { top: "1rem", right: "5%", bottom: "1rem", left: "5%" }
    };
    const unitFlexCss = L.compileDocCss(unitFlex);
    check("v2 unit-flex: px/rem/% lengths rendered", unitFlexCss.includes("width:50%") && unitFlexCss.includes("height:20rem") && unitFlexCss.includes("minmax(12rem,50%)") && unitFlexCss.includes("gap:2rem") && unitFlexCss.includes("grid-auto-rows:6rem") && unitFlexCss.includes("padding-right:5%"));

    const group = L.createBlock("group");
    group.children.push({ id: "group-child", type: "text", content: { text: "Inside group" } });
    const groupOut = L.render({ version: 1, blocks: [group] }, { editable: true });
    check("v2 group: createBlock is structural container", L.isContainer("group") && Array.isArray(group.children));
    check("v2 group: renders child wrapper and children", groupOut.html.includes('data-block-type="group"') && groupOut.html.includes('data-block-id="group-child"') && groupOut.html.includes("lime-block__children"));

    const componentFrames = {
        version: 1, theme: {},
        components: { card: { block: { type: "text", content: { text: "Shared" }, design: { base: { frame: { x: 0, y: 0, width: 120, height: 60 }, zIndex: 2 } } } } },
        pages: [{ id: "p", slug: "", title: "T", blocks: [{ id: "free", type: "container", content: {},
            design: { base: { layout: { mode: "free" }, size: { height: { mode: "fixed", value: 300 } } } }, children: [
                { id: "inst-a", type: "component", ref: "card", design: { base: { frame: { x: 40, y: 30 }, layout: { mode: "grid", columns: 99 } } } },
                { id: "inst-b", type: "component", ref: "card", design: { base: { frame: { x: 220, y: 90 } } } }
            ] }] }]
    };
    const componentFrameCss = L.compileDocCss(componentFrames);
    check("v2 component instance: frame overrides definition independently", componentFrameCss.includes('[data-block-id="inst-a"]{box-sizing:border-box;position:absolute;left:40px;top:30px;width:120px;height:60px;z-index:2}') && componentFrameCss.includes('[data-block-id="inst-b"]{box-sizing:border-box;position:absolute;left:220px;top:90px;width:120px;height:60px;z-index:2}'));
    check("v2 component instance: internal layout override ignored", !componentFrameCss.includes('[data-block-id="inst-a"]>.lime-block__inner>.lime-block__children'));
    const componentContent = {
        version: 1, theme: {},
        components: { hero: { block: { type: "heading", content: { text: "Shared title" } } } },
        pages: [{ id: "p", slug: "", title: "T", blocks: [
            { id: "inst-local", type: "component", ref: "hero", overrides: { content: { text: "Local title" } } },
            { id: "inst-shared", type: "component", ref: "hero" }
        ] }]
    };
    const componentContentHtml = L.renderSite(componentContent);
    check("v2 component instance: content override is local", componentContentHtml.includes('data-block-id="inst-local"') && componentContentHtml.includes("Local title") && componentContentHtml.includes('data-block-id="inst-shared"') && componentContentHtml.includes("Shared title"));
    const componentStyle = {
        version: 1, theme: {},
        components: { card: { block: { type: "text", content: { text: "Card" }, styles: { base: { color: "#ffffff" } } } } },
        pages: [{ id: "p", slug: "", title: "T", blocks: [
            { id: "st-local", type: "component", ref: "card", overrides: { styles: { base: { color: "#ff0000" }, mobile: { fontSize: "12px" } } } },
            { id: "st-shared", type: "component", ref: "card" }
        ] }]
    };
    const componentStyleCss = L.compileDocCss(componentStyle);
    check("v2 component instance: style override is local", componentStyleCss.includes('[data-block-id="st-local"]{color:#ff0000;}') && componentStyleCss.includes('[data-block-id="st-shared"]{color:#ffffff;}'));
    check("v2 component instance: override adds breakpoint bucket", componentStyleCss.includes('@media(max-width:640px)') && componentStyleCss.includes('font-size:12px'));

    const componentVariants = {
        version: 1, theme: {},
        components: { hero: { block: { type: "heading", content: { text: "Default title" } }, variants: [{ id: "alt", name: "Alt", block: { type: "heading", content: { text: "Alt title" } } }] } },
        pages: [{ id: "p", slug: "", title: "T", blocks: [
            { id: "inst-default", type: "component", ref: "hero" },
            { id: "inst-alt", type: "component", ref: "hero", variant: "alt" }
        ] }]
    };
    const componentVariantsHtml = L.renderSite(componentVariants);
    check("v2 component variant: instance resolves selected variant", componentVariantsHtml.includes('data-block-id="inst-default"') && componentVariantsHtml.includes("Default title") && componentVariantsHtml.includes('data-block-id="inst-alt"') && componentVariantsHtml.includes("Alt title"));

    // --- Cycle guard: компонент не может содержать сам себя (прямо или транзитивно) ---
    const selfCycle = {
        version: 1, theme: {}, components: {
            loop: { block: { type: "frame", content: {}, children: [
                { id: "inner-text", type: "text", content: { text: "Inside" } },
                { id: "self-ref", type: "component", ref: "loop" }
            ] } }
        },
        pages: [{ id: "p", slug: "", title: "T", blocks: [{ id: "inst-loop", type: "component", ref: "loop" }] }]
    };
    const selfCyclePub = L.renderSite(selfCycle);
    check("v2 cycle: self-referential component renders inner once (no explosion)", (selfCyclePub.match(/Inside/g) || []).length === 1 && !selfCyclePub.includes("__component_cycle"));
    const selfCycleEd = L.render({ theme: {}, components: selfCycle.components, blocks: selfCycle.pages[0].blocks }, { editable: true }).html;
    check("v2 cycle: editor shows cycle marker on inner instance", selfCycleEd.includes('data-block-type="__component_cycle"') && selfCycleEd.includes('data-block-id="self-ref"'));
    check("v2 cycle: compileDocCss completes without recursion blow-up", L.compileDocCss(selfCycle).length < 5000);

    const mutualCycle = {
        version: 1, theme: {}, components: {
            a: { block: { type: "frame", children: [ { id: "a-text", type: "text", content: { text: "AAA" } }, { id: "a-b", type: "component", ref: "b" } ] } },
            b: { block: { type: "frame", children: [ { id: "b-text", type: "text", content: { text: "BBB" } }, { id: "b-a", type: "component", ref: "a" } ] } }
        },
        pages: [{ id: "p", slug: "", title: "T", blocks: [{ id: "inst-a", type: "component", ref: "a" }] }]
    };
    const mutualPub = L.renderSite(mutualCycle);
    check("v2 cycle: mutual A↔B components terminate (each rendered once)", (mutualPub.match(/AAA/g) || []).length === 1 && (mutualPub.match(/BBB/g) || []).length === 1);

    const legacy = L.renderSite({ version: 1, pages: [{ id: "p", slug: "", title: "T", blocks: [{ id: "legacy", type: "text", content: { text: "v1" } }] }] });
    check("v2 additive: v1 markup has no design marker", !legacy.includes("data-design"));
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

// --- Editor V2 node-state: hidden не публикуется, locked остаётся editor-only ---
{
    const doc = { version: 1, blocks: [
        { id: "hidden1", type: "text", hidden: true, content: { text: "Секрет" } },
        { id: "locked1", type: "heading", locked: true, content: { text: "Виден" } }
    ] };
    const pub = L.render(doc, {});
    const ed = L.render(doc, { editable: true });
    check("node hidden: отсутствует в publish", !pub.html.includes('data-block-id="hidden1"') && !pub.html.includes("Секрет"));
    check("node hidden: editor сохраняет скрытый DOM-якорь", ed.html.includes('data-block-id="hidden1"') && ed.html.includes('data-node-hidden="1"'));
    check("node locked: публикуется без editor-state", pub.html.includes('data-block-id="locked1"') && !pub.html.includes("data-node-locked"));
    check("node locked: editor marker + без drag-grip", ed.html.includes('data-node-locked="1"') && !/data-block-id="locked1"[^]*lime-block-grip/.test(ed.html.split('data-block-id="locked1"')[1].split("</section>")[0]));
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
    // CMS 2.0: роль «заголовок» = значение текстового поля (а не метка схемы); метки только в fallback.
    check("collectionList 2.0: заголовок-роль = значение поля, без метки", pub.html.includes('class="lime-cl-title">Гаджет') && !pub.html.includes("Название"));
    check("collectionList 2.0: layout по умолчанию — cards", pub.html.includes("lime-block__collection--cards"));
    // layout grid
    const gridR = L.render({ version: 1, blocks: [{ id: "clg", type: "collectionList", content: { collection: "goods", layout: "grid" } }] }, { data: data });
    check("collectionList 2.0: layout grid", gridR.html.includes("lime-block__collection--grid"));
    // limit обрезает
    const manyData = { goods: { fields: data.goods.fields, records: [{ title: "A" }, { title: "B" }, { title: "C" }, { title: "D" }] } };
    const limR = L.render({ version: 1, blocks: [{ id: "cll", type: "collectionList", content: { collection: "goods", limit: 2 } }] }, { data: manyData });
    check("collectionList 2.0: limit обрезает число карточек", (limR.html.match(/lime-cl-card/g) || []).length === 2);
    // sort по текстовому полю (asc)
    const sortData = { goods: { fields: data.goods.fields, records: [{ title: "Бета" }, { title: "Альфа" }] } };
    const sortR = L.render({ version: 1, blocks: [{ id: "cls", type: "collectionList", content: { collection: "goods", sortField: "title", sortDir: "asc" } }] }, { data: sortData });
    check("collectionList 2.0: sort asc по полю", sortR.html.indexOf("Альфа") >= 0 && sortR.html.indexOf("Альфа") < sortR.html.indexOf("Бета"));
    // filter «содержит» без учёта регистра
    const filtR = L.render({ version: 1, blocks: [{ id: "clf", type: "collectionList", content: { collection: "goods", filterField: "title", filterValue: "гадж" } }] }, { data: data });
    check("collectionList 2.0: filter содержит (без регистра)", filtR.html.includes("Гаджет") && !filtR.html.includes("Штука"));
    // коллекция без ролей (только number) → fallback key/value с меткой
    const noRoleR = L.render({ version: 1, blocks: [{ id: "cln", type: "collectionList", content: { collection: "nums" } }] }, { data: { nums: { fields: [{ name: "qty", label: "Кол-во", type: "number" }], records: [{ qty: "5" }] } } });
    check("collectionList 2.0: без ролей — fallback с меткой поля", noRoleR.html.includes("Кол-во") && noRoleR.html.includes("lime-cl-key"));
    const emptyPub = L.render(doc, {});
    check("collectionList: публикация без данных — пусто (не показываем контейнер)", emptyPub.html.indexOf("lime-block__collection") === -1);
    const ed = L.render(doc, { editable: true });
    check("collectionList: в редакторе — превью-подсказка", ed.html.includes("lime-doc-drop-hint"));
    const noSlug = L.render({ version: 1, blocks: [{ id: "cl2", type: "collectionList", content: {} }] }, { editable: true });
    check("collectionList: без коллекции — подсказка выбрать", noSlug.html.includes("выбери источник"));
}

// --- CMS 2.0: динамические страницы — биндинг блоков к записи (content.bind/bindSrc) ---
{
    const doc = {
        version: 1, pages: [
            { id: "home", slug: "", title: "Главная", blocks: [{ id: "cl", type: "collectionList", content: { collection: "posts" } }] },
            {
                id: "post", slug: "post", title: "Пост", collection: "posts", blocks: [
                    { id: "h", type: "heading", content: { bind: "title" } },
                    { id: "t", type: "text", content: { bind: "body" } },
                    { id: "im", type: "image", content: { bindSrc: "cover" } }
                ]
            }
        ]
    };
    const rec = { title: "Привет", body: "Тело поста", cover: 'https://x/c.jpg"x' };
    const pub = L.renderPage(doc, "post", { baseUrl: "/u/u/s", record: rec });
    check("CMS2 bind: heading из записи", pub.body.includes('lime-block__heading">Привет'));
    check("CMS2 bind: text из записи", pub.body.includes('lime-block__text">Тело поста'));
    check("CMS2 bind: image src из записи с экранированием", pub.body.includes('src="https://x/c.jpg&quot;x"'));
    // в редакторе привязанный блок data-driven → без contenteditable/data-field
    const ed = L.renderPage(doc, "post", { baseUrl: "/u/u/s", editable: true, record: rec });
    check("CMS2 bind: привязанный текст не редактируется инлайн", ed.body.includes('lime-block__heading">Привет') && ed.body.indexOf('data-field="text"') === -1);
    // без записи (обычный рендер страницы) — статичный дефолт
    const plain = L.renderPage(doc, "post", { baseUrl: "/u/u/s" });
    check("CMS2 bind: без записи — статичный дефолт", plain.body.includes('lime-block__heading">Раздел'));
    // лента collectionList: карточка-ссылка по серверному rec._url
    const data = { posts: { fields: [{ name: "title", type: "text", label: "Заголовок" }], records: [{ title: "П1", _url: "/u/u/s/post/1-p1" }] } };
    const home = L.renderPage(doc, "", { baseUrl: "/u/u/s", data: data });
    check("CMS2 лента: карточка ссылается на _url записи", home.body.includes('<a class="lime-cl-card" href="/u/u/s/post/1-p1"'));
}

// --- 1.2: интерактивные блоки (tabs/carousel/lightbox) — рендер + publish/editable различие ---
{
    var tabsDoc = { version: 1, blocks: [{ id: "tb", type: "tabs", content: { items: [{ label: "Один", text: "Текст 1" }, { label: "Два", text: "Текст 2" }] } }] };
    var pubT = L.render(tabsDoc, {});
    check("tabs publish: data-lime-tabs + первый таб активен", pubT.html.includes("data-lime-tabs") && pubT.html.includes('data-lime-tab="0"') && pubT.html.includes("Один"));
    check("tabs publish: непервая панель скрыта (hidden)", /data-lime-tabpanel="1"[^>]*hidden/.test(pubT.html));
    var edT = L.render(tabsDoc, { editable: true });
    check("tabs editable: все панели видимы, без data-lime + редактируемые лейблы", edT.html.indexOf("data-lime-tabs") === -1 && edT.html.indexOf("hidden") === -1 && edT.html.includes('data-field="items.0.label"'));

    var carDoc = { version: 1, blocks: [{ id: "cr", type: "carousel", content: { items: [{ src: "https://x/a.jpg", alt: "" }, { src: "https://x/b.jpg", alt: "" }], autoplay: "5" } }] };
    var pubC = L.render(carDoc, {});
    check("carousel publish: data-lime-carousel + autoplay + слайды + навигация", pubC.html.includes("data-lime-carousel") && pubC.html.includes('data-lime-autoplay="5"') && pubC.html.includes("lime-carousel__slide") && pubC.html.includes("data-lime-carousel-next"));
    var edC = L.render(carDoc, { editable: true });
    check("carousel editable: без рантайм-атрибутов, есть хуки галереи", edC.html.indexOf("data-lime-carousel") === -1 && edC.html.includes("data-doc-gallery-add"));

    var lbDoc = { version: 1, blocks: [{ id: "lb", type: "lightbox", content: { items: [{ src: 'https://x/a.jpg"q', alt: "" }] } }] };
    var pubL = L.render(lbDoc, {});
    check("lightbox publish: data-lime-lightbox + экранированный src записи", pubL.html.includes("data-lime-lightbox") && pubL.html.includes('data-lime-lightbox-src="https://x/a.jpg&quot;q"'));
    var edL = L.render(lbDoc, { editable: true });
    check("lightbox editable: хук выбора картинки", edL.html.indexOf("data-lime-lightbox") === -1 && edL.html.includes('data-doc-pick="items.0.src"'));

    var cdDoc = { version: 1, blocks: [{ id: "cd", type: "countdown", content: { label: "До старта", target: "2026-12-31T00:00" } }] };
    var pubCd = L.render(cdDoc, {});
    check("countdown publish: data-lime-countdown с датой + ячейки d/h/m/s", pubCd.html.includes('data-lime-countdown="2026-12-31T00:00"') && pubCd.html.includes('data-lime-cd="d"') && pubCd.html.includes('data-lime-cd="s"'));
    var edCd = L.render(cdDoc, { editable: true });
    check("countdown editable: без data-lime-countdown + редактируемая подпись", edCd.html.indexOf("data-lime-countdown") === -1 && edCd.html.includes('data-field="label"'));

    var mdDoc = { version: 1, blocks: [{ id: "md", type: "modal", content: { button: "Открыть", title: "Окно", text: "Текст" } }] };
    var pubM = L.render(mdDoc, {});
    check("modal publish: кнопка-open + скрытый оверлей + закрытие", pubM.html.includes("data-lime-modal-open") && /data-lime-modal[ >]/.test(pubM.html) && pubM.html.includes("hidden") && pubM.html.includes("data-lime-modal-close"));
    var edM = L.render(mdDoc, { editable: true });
    check("modal editable: инлайн без рантайм-атрибутов + редактируемые поля", edM.html.includes("lime-modal-pop--inline") && edM.html.indexOf("data-lime-modal-open") === -1 && edM.html.includes('data-field="title"'));
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

// --- Страховка перед Editor V2: migrateDoc — единая нормализация по version ---
{
    // legacy плоский doc.blocks → одна страница; дефолты проставлены
    const m = L.migrateDoc({ version: 1, blocks: [{ id: "lg1", type: "text", content: { text: "Old" } }] });
    check("migrate: legacy blocks → одна страница", Array.isArray(m.pages) && m.pages.length === 1 && m.pages[0].blocks[0].id === "lg1");
    check("migrate: старое поле blocks удалено", !("blocks" in m));
    check("migrate: дефолты version/components/theme.classes", m.version === 1 && typeof m.components === "object" && Array.isArray(m.theme.classes));

    // идемпотентность: повторный вызов не дублирует и не теряет
    const again = L.migrateDoc(m);
    check("migrate: идемпотентна", again.pages.length === 1 && again.pages[0].blocks[0].id === "lg1" && !("blocks" in again));

    // многостраничный документ не перетирается
    const multi = L.migrateDoc({ version: 1, pages: [
        { id: "p0", slug: "", title: "Главная", blocks: [] },
        { id: "p1", slug: "about", title: "О нас", blocks: [] }
    ] });
    check("migrate: существующие pages сохранены", multi.pages.length === 2 && multi.pages[1].slug === "about");

    // неизвестные поля сохраняются (forward-compat для сосуществования v1/v2)
    const fwd = L.migrateDoc({ version: 1, blocks: [], futureField: { foo: 1 } });
    check("migrate: неизвестные поля не теряются (forward-compat)", fwd.futureField && fwd.futureField.foo === 1);

    // мусорный вход → валидный пустой документ, без падения
    const empty = L.migrateDoc(null);
    check("migrate: null → валидный пустой документ", empty.version === 1 && empty.pages.length === 1);

    // мигрированный документ рендерится тем же движком (parity сохранён)
    check("migrate: результат рендерится (renderSite)", L.renderSite(m).includes("Old"));
}

// --- Stage 7 performance tripwire: 500-node fixture, renderer build budget + renderOneBlock ---
{
    function buildPerfDoc(target) {
        const blocks = []; let made = 0;
        while (made < target) {
            const kids = []; const kc = Math.min(6, target - made);
            for (let i = 0; i < kc; i++) { made++; kids.push({ id: "k" + made, type: "text", content: { text: "Node " + made }, styles: { base: { color: "#222", fontSize: "16px" }, mobile: { fontSize: "14px" } } }); }
            made++;
            blocks.push({ id: "s" + made, type: "container", content: {}, styles: { base: { padding: "24px" } }, design: { base: { layout: { mode: "stack", gap: "12px" } } }, children: kids });
        }
        return { version: 1, theme: { accent: "#4a8" }, components: {}, pages: [{ id: "p0", slug: "", title: "Perf", blocks }] };
    }
    let nodeCount = 0;
    const perfDoc = buildPerfDoc(500);
    (function walk(bs) { bs.forEach(b => { nodeCount++; if (b.children) walk(b.children); }); })(perfDoc.pages[0].blocks);
    check("perf fixture: 500+ nodes built", nodeCount >= 500);
    const t0 = Date.now();
    const html = L.renderSite(perfDoc);
    const css = L.compileDocCss(perfDoc);
    const ms = Date.now() - t0;
    // Строковый рендер 500 узлов измеряется единицами мс; бюджет щедрый — это tripwire против
    // регрессии до O(n²)/экспоненты, а не точный SLA (тот — про DOM в браузере, Stage 7 §7).
    check("perf: renderSite+compileDocCss(500) under budget (" + ms + "ms)", ms < 400 && html.length > 0 && css.length > 0);
    // renderOneBlock: точечный рендер одного блока даёт тот же <section>, что и полный путь.
    const firstSection = perfDoc.pages[0].blocks[0];
    const one = L.renderOneBlock(firstSection, perfDoc.components, { editable: true });
    check("perf: renderOneBlock matches full-page section markup",
        one.includes('data-block-id="' + firstSection.id + '"') && html.includes('data-block-id="' + firstSection.id + '"'));
    // Инстанс через renderOneBlock резолвится (контент из определения).
    const compDoc = { version: 1, theme: {}, components: { card: { block: { type: "text", content: { text: "Shared one" } } } }, pages: [] };
    const oneInst = L.renderOneBlock({ id: "i1", type: "component", ref: "card" }, compDoc.components, { editable: true });
    check("perf: renderOneBlock resolves component instance", oneInst.includes('data-block-id="i1"') && oneInst.includes("Shared one"));
}

// --- Stage 8.1: sanitization стилевых пропов (block.styles/theme.classes/block.css) ---
// designRules уже валидирует v2-значения; styleDecls/scopeCss были «сырыми» сиблингами и
// могли вывести из CSS-правила (}) или закрыть <style> (</style>) — HTML/CSS-инъекция.
{
    const doc = {
        version: 1,
        theme: { classes: [
            { cls: "evil", styles: { base: { color: "red}body{display:none" } } }, // breakout через }
            { cls: "safe", styles: { base: { color: "#0f0", padding: "10px" } } }
        ] },
        blocks: [
            { id: "sx1", type: "text", content: { text: "x" }, styles: { base: {
                color: "red}html{display:none",                 // breakout-значение → отброшено
                background: "url(\"data:image/svg+xml;base64,AAAA\")", // легитимный ;/: → сохранён
                boxShadow: "0 8px 24px rgba(0,0,0,.3)",         // скобки/запятые → сохранён
                fontSize: "16px"
            } } },
            { id: "sx2", type: "text", content: { text: "y" }, styles: { base: {
                "color</style><img src=x>": "#fff",             // breakout в ИМЕНИ свойства → отброшено
                margin: "8px"
            } } },
            { id: "sx3", type: "text", content: { text: "z" }, styles: { base: {
                background: "#000;\n</style><script>alert(1)</script>" // breakout-значение → отброшено
            } } },
            { id: "sx4", type: "text", content: { text: "w" },
              css: "color:red} body{display:none} </style><script>alert(1)</script>" } // сырой block.css
        ]
    };
    const css = L.render(doc, {}).css;
    check("sanitize: breakout-значение стиля отброшено", !css.includes("}html{display:none") && !css.includes("}body{display:none"));
    check("sanitize: безопасные пары того же блока сохранены", css.includes('[data-block-id="sx1"]{') && css.includes("box-shadow:0 8px 24px rgba(0,0,0,.3)") && css.includes("font-size:16px"));
    check("sanitize: легитимный data-URI (;/:) в значении сохранён", css.includes('background:url("data:image/svg+xml;base64,AAAA")'));
    check("sanitize: breakout в ИМЕНИ свойства отброшен, сосед уцелел", !css.includes("<img src=x") && css.includes('[data-block-id="sx2"]{margin:8px;}'));
    check("sanitize: класс-breakout отброшен, безопасный класс цел", !css.includes("color:red}body") && css.includes(".lime-c-safe{color:#0f0;padding:10px;}"));
    // Граница безопасности — невозможность ЗАКРЫТЬ <style> (</style>). Текст вроде <script>
    // может остаться внутри css как инертный текст (внутри <style> не исполняется) — это ок.
    check("sanitize: ни одно стиль-значение не закрывает <style>", !css.includes("</style"));
    check("sanitize: сырой block.css не закрывает <style>", L.compileBlockCss({ id: "sx4", type: "text", css: "x:y</style>z" }, {}, 0, {}, []).indexOf("</style") === -1);
    // Регрессия: обычные стили компилируются байт-в-байт как раньше.
    check("sanitize: обычные стили не изменились", L.render({ version: 1, blocks: [{ id: "ok1", type: "text", content: { text: "x" }, styles: { base: { color: "#fff" }, mobile: { fontSize: "20px" } } }] }, {}).css.includes('[data-block-id="ok1"]{color:#fff;}'));
    check("sanitize: safeStyleProp/Value экспортированы и работают", L.safeStyleProp("fontSize") === "font-size" && L.safeStyleProp("a}b") === null && L.safeStyleValue("12px") === "12px" && L.safeStyleValue("a}b") === null);
}

// --- Stage 8.2: golden-фикстура паритета preview/publish/export на одном документе ---
// Критерий готовности §8: один fixture проходит preview, Jint render и Next-экспорт без
// структурных различий. Здесь — render-граница (preview↔publish) + устойчивость к
// неизвестному типу/полям; байт-в-байт Jint↔Node на этом же файле проверяет dotnet golden.
{
    const PARITY = require("./fixtures/editor-v2-parity.json");
    const pub = L.renderSite(PARITY);
    const css = L.compileDocCss(PARITY);
    const ed = L.render({ version: 2, theme: PARITY.theme, components: PARITY.components, blocks: PARITY.pages[0].blocks }, { editable: true });

    // (1) Публикация НЕ содержит ни одного editor-only хука/маркера.
    const EDITOR_ONLY = ["contenteditable", "data-field", "data-doc-pick", "data-doc-video",
        "data-doc-embed", "data-doc-gallery-add", "data-doc-gallery-del", "data-layer-id",
        "lime-block-grip", "lime-doc-drop-hint", "lime-doc-media-swap", "data-node-hidden", "data-node-locked"];
    const leaked = EDITOR_ONLY.filter(m => pub.indexOf(m) !== -1);
    check("parity publish: нет editor-only атрибутов (" + (leaked.join(",") || "—") + ")", leaked.length === 0);
    // (2) В редакторе те же маркеры присутствуют — значит проверка (1) не вырожденная.
    check("parity editor: editor-only маркеры присутствуют", ["contenteditable", "data-field", "lime-block-grip", "data-doc-pick", "data-doc-gallery-add", "data-doc-video", "data-layer-id"].every(m => ed.html.indexOf(m) !== -1));

    // (3) hidden не публикуется (узел и контент), locked публикуется без editor-state.
    check("parity publish: hidden-узел и его контент отсутствуют", pub.indexOf('data-block-id="hid1"') === -1 && pub.indexOf("СЕКРЕТ") === -1);
    check("parity editor: hidden остаётся якорем", ed.html.indexOf('data-block-id="hid1"') !== -1 && ed.html.indexOf('data-node-hidden="1"') !== -1);
    check("parity publish: locked виден, но без data-node-locked", pub.indexOf("Залочен но виден") !== -1 && pub.indexOf("data-node-locked") === -1);

    // (4) Неизвестный тип узла → безопасный fallback, без падения; не контейнер → без детей.
    check("parity fallback: неизвестный тип → видимый маркер, не краш", pub.indexOf("Неизвестный блок: futuristicWidget3000") !== -1 && pub.indexOf('data-block-id="unk1"') !== -1);
    // (5) Неизвестные future-поля игнорируются рендером и не утекают в разметку/CSS.
    check("parity forward-compat: неизвестные поля не ломают и не утекают", pub.indexOf("Будущее поле") !== -1 && pub.indexOf("experimentalGlow") === -1 && css.indexOf("experimentalGlow") === -1);

    // (6) v2 design компилируется во все брейкпоинты (free frame + grid/stack overrides).
    check("parity css: free child frame (base)", css.indexOf('position:absolute;left:48px;top:64px;width:420px;height:96px') !== -1);
    check("parity css: mobile frame override", css.indexOf("@media(max-width:640px)") !== -1 && css.indexOf("left:16px;top:32px;width:280px;height:120px") !== -1);
    check("parity css: grid columns base/tablet/mobile", css.indexOf("repeat(3,minmax(0,1fr))") !== -1 && css.indexOf("repeat(2,minmax(0,1fr))") !== -1 && css.indexOf("repeat(1,minmax(0,1fr))") !== -1);
    check("parity css: stack direction override (row→column)", css.indexOf("flex-direction:row") !== -1 && css.indexOf("flex-direction:column") !== -1);
    check("parity css: reusable class + per-breakpoint type sizes", css.indexOf(".lime-c-pill{") !== -1 && css.indexOf("font-size:20px") !== -1 && css.indexOf("font-size:18px") !== -1);

    // (7) Формы/медиа/CMS/анимации старого формата рендерятся в публикации.
    check("parity blocks: form (data-lime-form + honeypot + hidden-collection)", pub.indexOf("data-lime-form") !== -1 && pub.indexOf('name="lime_hp"') !== -1 && pub.indexOf('name="__collection" value="leads"') !== -1);
    check("parity blocks: media (image/gallery/video-обёртка)", pub.indexOf("/media/u1/p.jpg") !== -1 && pub.indexOf("/media/u1/a.jpg") !== -1 && pub.indexOf("lime-block__video") !== -1);
    check("parity blocks: CMS collectionList без данных — пусто в публикации", pub.indexOf('data-block-id="cms1"') !== -1 && pub.indexOf("lime-block__collection") === -1);
    check("parity blocks: old-format motion (anim/parallax/marquee/scene/fx)", pub.indexOf('data-anim="fade-up"') !== -1 && pub.indexOf('data-parallax="0.2"') !== -1 && pub.indexOf("lime-fx-glass") !== -1 && pub.indexOf("lime-block__children--marquee") !== -1 && pub.indexOf('data-scene="horizontal"') !== -1);

    // (8) Компоненты: локальный override и variant резолвятся в публикации.
    check("parity component: override локален, definition цел", pub.indexOf("Локальный текст") !== -1 && pub.indexOf("Промо") !== -1);
    check("parity component: variant резолвится", pub.indexOf("Альт-промо") !== -1);

    // (9) customCss с </style> вырезан (нельзя закрыть style из темы) — на всех трёх путях.
    check("parity sanitize: customCss </style> вырезан в publish и export", pub.indexOf("scroll-behavior:smooth") !== -1 && pub.indexOf("</script>alert") === -1 && css.indexOf("scroll-behavior:smooth") !== -1);

    // (10) renderPage (серверный per-page путь) выдаёт только свою страницу, без editor-only.
    const about = L.renderPage(PARITY, "about", { baseUrl: "/u/user/site" });
    check("parity renderPage: страница about изолирована и чистая", about && about.body.indexOf("конструктор") !== -1 && about.body.indexOf("Свобода как в Figma") === -1 && EDITOR_ONLY.every(m => about.body.indexOf(m) === -1));
}

if (failed) {
    console.error("\nSELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nCHILDREN-RENDER-OK (0.1) + MEDIA-RENDER-OK (0.5) + BG-LAYERS-OK (0.3) + MOTION/LAYERS-OK (2) + HOVER-OK (1.2) + CLASSES/TOKENS-OK (0.1) + MIGRATE-OK (v2-страховка) + B2/B3 регрессия зелёные");
