"use strict";

const path = require("path");
const AiPipeline = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-ai-pipeline.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// ---- collectTextBlocks: pure flattening logic ----
{
    const tree = [
        {
            id: "navbar1", type: "navbar",
            content: {
                brand: "NOVA//LORE",
                width: "boxed", // служебное — исключается
                links: [{ label: "Lore" }, { label: "Factions" }],
                cta: "Join"
            }
        },
        {
            id: "embed1", type: "embed",
            content: {
                provider: "sketchfab", // служебное
                embedUrl: "https://sketchfab.com/models/x/embed", // URL — исключается
                poster: "https://media.sketchfab.com/x.jpg", // служебное/URL
                fallbackTitle: "Hero scene", // прозаический текст — остаётся
                fallbackText: "Loading…"
            }
        },
        {
            id: "container1", type: "container",
            content: { __slot: "hero-scene", width: "boxed" }, // только служебные/приватные -> нет записи
            children: [
                { id: "child1", type: "text", content: { text: "Nested child text" } }
            ]
        },
        {
            id: "faq1", type: "accordion",
            content: { items: [{ q: "Q1?", a: "A1." }, { q: "Q2?", a: "A2." }] }
        }
    ];

    const out = AiPipeline.create({}).collectTextBlocks(tree);
    const byId = {}; out.forEach((b) => { byId[b.id] = b; });

    check("navbar: top-level strings kept, width excluded", byId.navbar1
        && byId.navbar1.content.brand === "NOVA//LORE"
        && byId.navbar1.content.cta === "Join"
        && byId.navbar1.content.width === undefined);
    check("navbar: array-of-objects flattened to dotted-index keys", byId.navbar1
        && byId.navbar1.content["links.0.label"] === "Lore"
        && byId.navbar1.content["links.1.label"] === "Factions");
    check("embed: URL-ish/config fields excluded, fallback copy kept", byId.embed1
        && byId.embed1.content.fallbackTitle === "Hero scene"
        && byId.embed1.content.fallbackText === "Loading…"
        && byId.embed1.content.embedUrl === undefined
        && byId.embed1.content.poster === undefined
        && byId.embed1.content.provider === undefined);
    check("container with only __slot/width -> no entry emitted (nothing to fill)", byId.container1 === undefined);
    check("recurses into children", byId.child1 && byId.child1.content.text === "Nested child text");
    check("array items with multiple string sub-fields (q/a) flattened correctly", byId.faq1
        && byId.faq1.content["items.0.q"] === "Q1?" && byId.faq1.content["items.0.a"] === "A1."
        && byId.faq1.content["items.1.q"] === "Q2?" && byId.faq1.content["items.1.a"] === "A2.");
    check("non-string values (numbers/objects) are ignored, not crash", (() => {
        const weird = [{ id: "w1", type: "columns", content: { cols: 3, bg: { overlay: "x" }, title: "Kept" } }];
        const r = AiPipeline.create({}).collectTextBlocks(weird);
        return r.length === 1 && r[0].content.title === "Kept" && r[0].content.cols === undefined && r[0].content.bg === undefined;
    })());
}

// ---- collectMotionBlocks: pure flattening logic (Milestone 5, Фаза B) ----
{
    const L = { isContainer: (t) => t === "container" };
    const tree = [
        {
            id: "hero1", type: "cover", scene: { mode: "pin", length: 2 }, anim: "fade-up",
            fx: { glow: true }, layers: [{ id: "l1", kind: "shape" }]
        },
        { id: "text1", type: "text" }, // ни одного motion-поля — минимальная запись
        {
            id: "box1", type: "container", parallax: 0.3, marquee: { speed: 30, reverse: false },
            children: [{ id: "child1", type: "text", sticky: true, stickyOffset: 12 }]
        }
    ];
    const out = AiPipeline.create({ L: L }).collectMotionBlocks(tree);
    const byId = {}; out.forEach((b) => { byId[b.id] = b; });

    check("collectMotionBlocks: не-контейнер помечен container:false", byId.hero1 && byId.hero1.container === false);
    check("collectMotionBlocks: контейнер помечен container:true", byId.box1 && byId.box1.container === true);
    check("collectMotionBlocks: present motion-поля собраны (scene/anim)", byId.hero1
        && JSON.stringify(byId.hero1.scene) === JSON.stringify({ mode: "pin", length: 2 })
        && byId.hero1.anim === "fade-up");
    check("collectMotionBlocks: fx/layers НИКОГДА не собираются (риск стереть decor)", byId.hero1
        && byId.hero1.fx === undefined && byId.hero1.layers === undefined);
    check("collectMotionBlocks: блок без motion-полей — минимальная запись (id/type/container)", byId.text1
        && Object.keys(byId.text1).sort().join(",") === "container,id,type");
    check("collectMotionBlocks: parallax/marquee собраны на контейнере", byId.box1
        && byId.box1.parallax === 0.3 && JSON.stringify(byId.box1.marquee) === JSON.stringify({ speed: 30, reverse: false }));
    check("collectMotionBlocks: рекурсия в children (sticky/stickyOffset)", byId.child1
        && byId.child1.sticky === true && byId.child1.stickyOffset === 12);

    // Без инъекции L (дефолт) — isContainer всегда false, но не падает.
    const outNoL = AiPipeline.create({}).collectMotionBlocks([{ id: "x1", type: "container" }]);
    check("collectMotionBlocks: без L падает мягко на container:false", outNoL[0].container === false);
}

// ---- collectMobileBlocks: pack-level context for Milestone 5, Phase D ----
{
    const L = { isContainer: (t) => t === "container" || t === "cover" };
    const tree = [
        {
            id: "hero1", type: "cover", scene: { mode: "pin", length: 2 }, css: ">.x{display:grid}",
            content: { title: "Very large cinematic title", embedUrl: "https://example.test/embed", __slot: "hero-scene" },
            styles: { base: { padding: "120px 32px" }, mobile: { padding: "64px 18px" } },
            design: { mobile: { layout: { columns: 1 } } },
            children: [
                {
                    id: "embed1", type: "embed",
                    content: { provider: "sketchfab", aspect: "4/5", poster: "https://media.test/poster.jpg", fallbackTitle: "Scene" }
                }
            ]
        }
    ];
    const out = AiPipeline.create({ L: L }).collectMobileBlocks(tree);
    const byId = {}; out.forEach((b) => { byId[b.id] = b; });

    check("collectMobileBlocks: includes responsive styles/design and scene", byId.hero1
        && byId.hero1.container === true
        && JSON.stringify(byId.hero1.scene) === JSON.stringify({ mode: "pin", length: 2 })
        && byId.hero1.styles.mobile.padding === "64px 18px"
        && byId.hero1.design.mobile.layout.columns === 1);
    check("collectMobileBlocks: content hints keep slot/text and exclude URLs", byId.hero1
        && byId.hero1.content.slot === "hero-scene"
        && byId.hero1.content.title === "Very large cinematic title"
        && byId.hero1.content.embedUrl === undefined);
    check("collectMobileBlocks: recurses into embed and captures safe embed metadata", byId.embed1
        && byId.embed1.parentId === "hero1"
        && byId.embed1.embed.provider === "sketchfab"
        && byId.embed1.embed.aspect === "4/5"
        && byId.embed1.embed.hasPoster === true);
    check("collectMobileBlocks: marks scoped CSS without copying CSS text", byId.hero1 && byId.hero1.scopedCss === true && byId.hero1.css === undefined);
}

// ---- aiFillPackText: guards + fetch wiring ----
function makeHarness(opts) {
    opts = opts || {};
    const alerts = [];
    const prompts = [];
    const fetchCalls = [];
    let fetchImpl = opts.fetchImpl || (() => Promise.resolve({ status: 200, json: () => Promise.resolve({ commands: [] }) }));
    const validateCalls = [];
    // Источник зовёт голые alert/prompt/fetch (не win.*), опираясь на то, что в браузере это
    // глобальный window.* — в Node это настоящие глобали, которые надо подставить на время вызова.
    global.alert = (m) => alerts.push(m);
    global.prompt = (m) => { prompts.push(m); return opts.brief !== undefined ? opts.brief : "a coffee brand"; };
    global.fetch = (url, init) => { fetchCalls.push({ url, init }); return fetchImpl(url, init); };
    const win = {
        LimeCommands: {
            validateAiCommands: (list, vopts) => { validateCalls.push({ list, vopts }); return { ok: false, reason: "stub-stop", commands: [], rejected: [] }; }
        },
        // doc.pack штампуется для ЛЮБОГО шаблона (Milestone 4) — resolve() имитирует, что только
        // "neo-lore-drop" — настоящий Experience Pack, а "startup" (или что угодно ещё) — нет.
        LimeExperiencePacks: opts.experiencePacks !== undefined ? opts.experiencePacks : {
            resolve: (key) => (key === "neo-lore-drop" ? { key: key, assetSlots: [] } : null)
        }
    };
    const doc = opts.doc !== undefined ? opts.doc : { pack: "neo-lore-drop", theme: { accent: "#42ffa3" }, pages: [{ blocks: [{ id: "b1", type: "text", content: { text: "Placeholder" } }] }] };
    const leStatusCalls = [];
    const switchBpCalls = [];
    const api = AiPipeline.create({
        window: win,
        document: { querySelector: () => null, getElementById: () => null },
        ws: { querySelectorAll: () => [] },
        doc: doc,
        L: opts.L,
        getCmdStore: () => (opts.cmdStore !== undefined ? opts.cmdStore : {}),
        csrfToken: () => "tok",
        leStatus: (msg, o) => leStatusCalls.push({ msg, o }),
        switchBreakpoint: (bp) => switchBpCalls.push(bp)
    });
    return { api, alerts, prompts, fetchCalls, validateCalls, leStatusCalls, switchBpCalls };
}

{
    const h = makeHarness({ cmdStore: null });
    h.api.aiFillPackText();
    check("no cmdStore -> alert, no fetch", h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ doc: { pack: null, theme: {}, pages: [{ blocks: [{ id: "b1", type: "text", content: { text: "x" } }] }] } });
    h.api.aiFillPackText();
    check("no doc.pack -> friendly alert, no fetch", h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    // Реальный баг, найденный при E2E-проверке: doc.pack штампуется для ЛЮБОГО шаблона
    // (Milestone 4), значит "startup" тоже имеет doc.pack="startup" (truthy!) — guard обязан
    // проверять РЕЗОЛВ через LimeExperiencePacks.resolve(), а не голую truthiness doc.pack.
    const h = makeHarness({ doc: { pack: "startup", theme: {}, pages: [{ blocks: [{ id: "b1", type: "text", content: { text: "x" } }] }] } });
    h.api.aiFillPackText();
    check("doc.pack set but resolves to null (plain template, not a real pack) -> friendly alert, no fetch",
        h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ doc: { pack: "neo-lore-drop", theme: {}, pages: [{ blocks: [{ id: "b1", type: "container", content: { width: "boxed" } }] }] } });
    h.api.aiFillPackText();
    check("no collectible text fields -> alert, no fetch", h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ brief: "" });
    h.api.aiFillPackText();
    check("empty brief (dismissed prompt) -> no fetch, no alert", h.alerts.length === 0 && h.fetchCalls.length === 0 && h.prompts.length === 1);
}

// ---- aiRestylePack: guards + fetch wiring (Milestone 5, Фаза B) ----
{
    const h = makeHarness({ cmdStore: null });
    h.api.aiRestylePack();
    check("restyle: no cmdStore -> alert, no fetch", h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ doc: { pack: "startup", theme: {}, pages: [{ blocks: [{ id: "b1", type: "text", content: {} }] }] } });
    h.api.aiRestylePack();
    check("restyle: doc.pack resolves to null (plain template) -> friendly alert, no fetch",
        h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ brief: "" });
    h.api.aiRestylePack();
    check("restyle: empty brief (dismissed prompt) -> no fetch, no alert", h.alerts.length === 0 && h.fetchCalls.length === 0 && h.prompts.length === 1);
}

// ---- aiAdaptPackMobile: guards + fetch wiring (Milestone 5, Phase D) ----
{
    const h = makeHarness({ cmdStore: null });
    h.api.aiAdaptPackMobile();
    check("pack mobile: no cmdStore -> alert, no fetch", h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ doc: { pack: "startup", theme: {}, pages: [{ blocks: [{ id: "b1", type: "text", content: {} }] }] } });
    h.api.aiAdaptPackMobile();
    check("pack mobile: doc.pack resolves to null (plain template) -> friendly alert, no fetch",
        h.alerts.length === 1 && h.fetchCalls.length === 0);
}
{
    const h = makeHarness({ doc: { pack: "neo-lore-drop", theme: {}, pages: [{ blocks: [] }] } });
    h.api.aiAdaptPackMobile();
    check("pack mobile: no blocks -> alert, no fetch", h.alerts.length === 1 && h.fetchCalls.length === 0);
}
function tick() { return new Promise((resolve) => setTimeout(resolve, 20)); }

async function runAsyncChecks() {
    // Happy path: builds context/instruction, calls /Ai/Suggest, on 200 reaches validateAiCommands with the response's commands.
    {
        const h = makeHarness({
            fetchImpl: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ commands: [{ type: "setContent", payload: { id: "b1", field: "text", value: "Zerno coffee" } }] }) })
        });
        h.api.aiFillPackText();
        await tick();
        check("happy path: hits /Ai/Suggest", h.fetchCalls.length === 1 && h.fetchCalls[0].url === "/Ai/Suggest");
        const body = h.fetchCalls[0].init.body;
        check("happy path: FormData carries context+instruction", body instanceof FormData && !!body.get("context") && body.get("instruction").indexOf("a coffee brand") >= 0);
        check("happy path: reaches validateAiCommands with the response commands", h.validateCalls.length === 1
            && h.validateCalls[0].list.length === 1 && h.validateCalls[0].list[0].payload.value === "Zerno coffee");
        check("happy path: leStatus shown then hidden", h.leStatusCalls.length === 2 && h.leStatusCalls[1].o && h.leStatusCalls[1].o.hide === true);
    }

    // Error-status handling (429/503/generic) + network error.
    async function testStatus(status, expectSubstr) {
        const h = makeHarness({ fetchImpl: () => Promise.resolve({ status: status, json: () => Promise.resolve({}) }) });
        h.api.aiFillPackText();
        await tick();
        check("status " + status + " -> alert mentions '" + expectSubstr + "'", h.alerts.some((a) => a.indexOf(expectSubstr) >= 0));
    }
    await testStatus(429, "Лимит");
    await testStatus(503, "не настроен");
    await testStatus(500, "Попробуй");

    // aiRestylePack happy path: builds context (theme+motionProfile+blocks) and instruction, hits /Ai/Suggest.
    {
        const h = makeHarness({
            experiencePacks: { resolve: (key) => (key === "neo-lore-drop" ? { key: key, motionProfile: ["reveal"] } : null) },
            fetchImpl: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ commands: [{ type: "setTheme", payload: { key: "accent", value: "#ff0055" } }] }) })
        });
        h.api.aiRestylePack();
        await tick();
        check("restyle happy path: hits /Ai/Suggest", h.fetchCalls.length === 1 && h.fetchCalls[0].url === "/Ai/Suggest");
        const body = h.fetchCalls[0].init.body;
        const ctx = JSON.parse(body.get("context"));
        check("restyle happy path: context carries theme+motionProfile+blocks", ctx.theme && ctx.theme.accent === "#42ffa3"
            && JSON.stringify(ctx.motionProfile) === JSON.stringify(["reveal"]) && Array.isArray(ctx.blocks) && ctx.blocks.length === 1);
        check("restyle happy path: instruction carries the brief", body.get("instruction").indexOf("a coffee brand") >= 0);
        check("restyle happy path: reaches validateAiCommands with the response commands", h.validateCalls.length === 1
            && h.validateCalls[0].list.length === 1 && h.validateCalls[0].list[0].type === "setTheme");
    }
    async function testRestyleStatus(status, expectSubstr) {
        const h = makeHarness({ fetchImpl: () => Promise.resolve({ status: status, json: () => Promise.resolve({}) }) });
        h.api.aiRestylePack();
        await tick();
        check("restyle status " + status + " -> alert mentions '" + expectSubstr + "'", h.alerts.some((a) => a.indexOf(expectSubstr) >= 0));
    }
    await testRestyleStatus(429, "Лимит");
    await testRestyleStatus(503, "не настроен");
    await testRestyleStatus(500, "Попробуй");
    {
        const h = makeHarness({ fetchImpl: () => Promise.reject(new Error("boom")) });
        h.api.aiRestylePack();
        await tick();
        check("restyle network error -> alert", h.alerts.some((a) => a.indexOf("Сетевая") >= 0));
    }

    // aiAdaptPackMobile happy path: pack-wide responsive context + breakpoint=mobile.
    {
        const h = makeHarness({
            doc: {
                pack: "neo-lore-drop",
                theme: { accent: "#42ffa3", bg: "#080a0e", fg: "#f6fbff" },
                pages: [{
                    blocks: [{
                        id: "hero1", type: "cover", scene: { mode: "horizontal", length: 3 },
                        content: { title: "Oversized cinematic launch", __slot: "hero-scene" },
                        styles: { base: { padding: "120px 32px" }, mobile: { padding: "64px 18px" } },
                        children: [{ id: "embed1", type: "embed", content: { provider: "sketchfab", aspect: "4/5", poster: "https://media.test/x.jpg" } }]
                    }]
                }]
            },
            experiencePacks: {
                resolve: (key) => key === "neo-lore-drop" ? {
                    key: key, name: "Neo Lore Drop", category: "showcase", level: "pro",
                    sections: ["neo-hero"], assetSlots: [{ key: "hero-scene", label: "Hero scene" }]
                } : null
            },
            fetchImpl: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ commands: [{ type: "setStyle", payload: { id: "hero1", prop: "fontSize", value: "36px", breakpoint: "mobile" } }] }) })
        });
        h.api.aiAdaptPackMobile();
        await tick();
        check("pack mobile happy path: switches preview to mobile", h.switchBpCalls[0] === "mobile");
        check("pack mobile happy path: hits /Ai/Suggest with breakpoint=mobile", h.fetchCalls.length === 1
            && h.fetchCalls[0].url === "/Ai/Suggest"
            && h.fetchCalls[0].init.body.get("breakpoint") === "mobile");
        const body = h.fetchCalls[0].init.body;
        const ctx = JSON.parse(body.get("context"));
        check("pack mobile happy path: context carries pack+viewport+blocks", ctx.pack.key === "neo-lore-drop"
            && ctx.viewport.width === 390 && Array.isArray(ctx.blocks) && ctx.blocks.length === 2);
        check("pack mobile happy path: context includes scene/embed hints", ctx.blocks[0].scene.mode === "horizontal"
            && ctx.blocks[1].embed.provider === "sketchfab");
        check("pack mobile happy path: instruction fits AiController 300-char cap", body.get("instruction").length <= 300);
        check("pack mobile happy path: reaches validateAiCommands with response commands", h.validateCalls.length === 1
            && h.validateCalls[0].list[0].payload.breakpoint === "mobile");
    }
    async function testPackMobileStatus(status, expectSubstr) {
        const h = makeHarness({ fetchImpl: () => Promise.resolve({ status: status, json: () => Promise.resolve({}) }) });
        h.api.aiAdaptPackMobile();
        await tick();
        check("pack mobile status " + status + " -> alert mentions '" + expectSubstr + "'", h.alerts.some((a) => a.indexOf(expectSubstr) >= 0));
    }
    await testPackMobileStatus(429, "Лимит");
    await testPackMobileStatus(503, "не настроен");
    await testPackMobileStatus(500, "Попробуй");
    {
        const h = makeHarness({ fetchImpl: () => Promise.reject(new Error("boom")) });
        h.api.aiAdaptPackMobile();
        await tick();
        check("pack mobile network error -> alert", h.alerts.some((a) => a.indexOf("Сетевая") >= 0));
    }

    {
        const h = makeHarness({ fetchImpl: () => Promise.reject(new Error("boom")) });
        h.api.aiFillPackText();
        await tick();
        check("network error -> alert", h.alerts.some((a) => a.indexOf("Сетевая") >= 0));
    }

    // ---- aiSuggestAssetPrompt (Milestone 5, Фаза C): не трогает документ, только текст-бриф ----
    function makeAssetButton() {
        return {
            dataset: { slotLabel: "Hero scene", slotHint: "Spline embed", packName: "Neo Lore Drop", packCategory: "showcase" },
            nextElementSibling: { textContent: "" }
        };
    }
    {
        const h = makeHarness({});
        h.api.aiSuggestAssetPrompt(null);
        check("asset-prompt: no element -> no fetch, no throw", h.fetchCalls.length === 0);
    }
    {
        const h = makeHarness({
            fetchImpl: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ text: "неоновая киберпанк-сцена, мокрый асфальт" }) })
        });
        const el = makeAssetButton();
        h.api.aiSuggestAssetPrompt(el);
        check("asset-prompt: shows loading text synchronously before fetch resolves", el.nextElementSibling.textContent === "AI думает…");
        await tick();
        check("asset-prompt: hits /Ai/SuggestAssetBrief", h.fetchCalls.length === 1 && h.fetchCalls[0].url === "/Ai/SuggestAssetBrief");
        const ctx = JSON.parse(h.fetchCalls[0].init.body.get("context"));
        check("asset-prompt: context carries slot/pack from dataset", ctx.slotLabel === "Hero scene" && ctx.slotHint === "Spline embed"
            && ctx.packName === "Neo Lore Drop" && ctx.category === "showcase");
        check("asset-prompt: context carries live doc.theme (not stale)", ctx.theme && ctx.theme.accent === "#42ffa3");
        check("asset-prompt: result element shows returned text", el.nextElementSibling.textContent === "неоновая киберпанк-сцена, мокрый асфальт");
    }
    async function testAssetPromptStatus(status, expectSubstr) {
        const h = makeHarness({ fetchImpl: () => Promise.resolve({ status: status, json: () => Promise.resolve({}) }) });
        const el = makeAssetButton();
        h.api.aiSuggestAssetPrompt(el);
        await tick();
        check("asset-prompt status " + status + " -> result mentions '" + expectSubstr + "'", el.nextElementSibling.textContent.indexOf(expectSubstr) >= 0);
    }
    await testAssetPromptStatus(429, "Лимит");
    await testAssetPromptStatus(503, "не настроен");
    await testAssetPromptStatus(500, "Попробуй");
    {
        const h = makeHarness({ fetchImpl: () => Promise.reject(new Error("boom")) });
        const el = makeAssetButton();
        h.api.aiSuggestAssetPrompt(el);
        await tick();
        check("asset-prompt network error -> result mentions 'Сетевая'", el.nextElementSibling.textContent.indexOf("Сетевая") >= 0);
    }

    if (failed) { console.error("\nAI-PIPELINE-SELFTEST FAILED: " + failed); process.exit(1); }
    console.log("\nAI-PIPELINE-OK");
}

runAsyncChecks();
