"use strict";

const path = require("path");
const Presets = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-presets.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

let id = 0;
const L = {
    createBlock(type) {
        return { id: type + "-" + (++id), type, content: {} };
    },
    isContainer(type) { return type === "container"; }
};
let layerId = 0;
const page = [];
const container = { id: "container", type: "container" };
let doc = { theme: {}, pages: [{ blocks: page }] };
let selectedId = null;
const calls = [];
const tileHandlers = [];
const presetsBox = {
    innerHTML: "",
    addEventListener(type, handler) {
        if (type === "click") tileHandlers.push(handler);
    }
};
const documentStub = {
    getElementById(id) {
        return id === "lime-doc-presets" ? presetsBox : null;
    }
};
const scrolled = [];
const ws = {
    querySelector(selector) {
        return {
            scrollIntoView(opts) { scrolled.push({ selector, block: opts.block }); }
        };
    }
};
const win = {
    LimePresets: {
        META: [{ key: "hero", icon: "H", label: "Hero" }],
        PRESETS: {
            hero: [{
                type: "container",
                content: { title: "Hero" },
                styles: { base: { color: "#fff" } },
                css: ".x{}",
                anim: "fade-up",
                layers: [{ id: "old-layer", kind: "shape" }],
                children: [{ type: "text", content: { text: "Child" } }]
            }],
            footer: [{ type: "text", content: { text: "Footer" } }]
        }
    },
    LimeTemplates: [{
        key: "startup",
        theme: { accent: "#123456", font: "Inter" },
        sections: ["hero", "footer"]
    }]
};

const api = Presets.create({
    document: documentStub,
    window: win,
    L,
    ws,
    getDoc: () => doc,
    pageBlocks: () => page,
    getSelectedId: () => selectedId,
    setSelectedId(value) { selectedId = value; calls.push("sel:" + value); },
    findBlock(sel) {
        return sel === "container" ? { block: container, parent: page, index: 0, parentBlock: null } : null;
    },
    targetBlock: block => block,
    rid(prefix) { return prefix + "-" + (++layerId); },
    render() { calls.push("render"); },
    markDirty() { calls.push("dirty"); }
});

const built = api.blockFromSpec(win.LimePresets.PRESETS.hero[0]);
check("blockFromSpec builds root block", built.type === "container" && built.content.title === "Hero");
check("blockFromSpec deep-clones children", built.children.length === 1 && built.children[0].content.text === "Child");
check("blockFromSpec renews layer ids", built.layers[0].id === "l-1" && built.layers[0].id !== "old-layer");
win.LimePresets.PRESETS.hero[0].content.title = "Changed";
check("blockFromSpec clones content independently", built.content.title === "Hero");

check("preset tiles render from META", presetsBox.innerHTML.includes('data-doc-preset="hero"') && tileHandlers.length === 1);
tileHandlers[0]({
    target: { closest: () => ({ dataset: { docPreset: "hero" } }) },
    stopPropagation() { calls.push("tile-stop"); }
});
check("tile click inserts preset", page.length === 1 && page[0].type === "container" && calls.includes("tile-stop"));
check("insertPreset renders, marks dirty and scrolls", calls.includes("render") && calls.includes("dirty") && scrolled.length === 1);

selectedId = "container";
api.insertPreset("footer");
check("selected container receives preset", container.children.length === 1 && container.children[0].content.text === "Footer");
check("insertPreset clears selection", calls.includes("sel:null"));

page.length = 0;
container.children = [];
check("applyTemplateByKey returns false for unknown", api.applyTemplateByKey("missing") === false);
check("applyTemplateByKey applies theme and sections", api.applyTemplateByKey("startup") === true && doc.theme.accent === "#123456" && page.length === 2);
check("applyTemplateByKey stamps doc.pack even for a plain (non-Experience-Pack) template", doc.pack === "startup");

// Регрессия stale-doc: main переприсваивает doc на undo/redo — тема обязана писаться
// в АКТУАЛЬНЫЙ doc через getDoc, а не в захваченный при create (важно для runtime-паков).
const swappedDoc = { pages: [{ blocks: page }] };
doc = swappedDoc;
check("applyTemplateByKey writes theme into live doc after doc swap", api.applyTemplateByKey("startup") === true && swappedDoc.theme && swappedDoc.theme.accent === "#123456");

// --- Real showcase pack from docs/experience-builder-plan.md: neo-lore-drop ---
{
    const RealLimePresets = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-presets.js"));
    const RealLimeTemplates = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-templates.js"));
    const LimeDoc = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));
    const realPage = [];
    const realDoc = { version: 2, theme: {}, pages: [{ id: "p1", slug: "", title: "Neo", blocks: realPage }] };
    let realLayerId = 0;
    const realApi = Presets.create({
        window: { LimePresets: RealLimePresets, LimeTemplates: RealLimeTemplates },
        L: LimeDoc,
        getDoc: () => realDoc,
        pageBlocks: () => realPage,
        rid(prefix) { return prefix + "-neo-" + (++realLayerId); }
    });
    const tpl = RealLimeTemplates.find(t => t.key === "neo-lore-drop");
    const allSectionsExist = tpl && tpl.sections.every(key => RealLimePresets.PRESETS[key] && RealLimePresets.PRESETS[key].length);
    check("neo-lore-drop template registered with existing sections", !!allSectionsExist);
    check("neo-lore-drop applies theme and full page", realApi.applyTemplateByKey("neo-lore-drop") === true && realDoc.theme.accent === "#42ffa3" && realPage.length >= 10);
    check("neo-lore-drop stamps doc.pack (Milestone 4 asset-slot linkage)", realDoc.pack === "neo-lore-drop");
    const json = JSON.stringify(realPage);
    check("neo-lore-drop has embed, scene and decorative layers", json.includes('"type":"embed"') && json.includes('"mode":"horizontal"') && json.includes('"layers"'));
    check("neo-lore-drop hero/customizer embeds carry their asset-slot markers", json.includes('"__slot":"hero-scene"') && json.includes('"__slot":"customizer-scene"'));
    const pub = LimeDoc.render({ version: 2, theme: realDoc.theme, blocks: realPage }, {});
    const editorOnly = ["contenteditable", "data-field", "data-doc-embed", "data-layer-id", "lime-block-grip", "lime-doc-media-swap"];
    check("neo-lore-drop publish renders allowlisted embed iframe", pub.html.includes("<iframe") && pub.html.includes("https://sketchfab.com/models/14d2eaa145ee42938e004115871adf6c/embed"));
    check("neo-lore-drop publish renders motion/layers markers", pub.html.includes('data-scene="horizontal"') && pub.html.includes("lime-block__layers") && pub.html.includes('data-parallax='));
    check("neo-lore-drop publish stays clean of editor-only hooks", editorOnly.every(m => pub.html.indexOf(m) === -1));
    check("neo-lore-drop publish never leaks the internal __slot marker", pub.html.indexOf("__slot") === -1 && pub.html.indexOf("hero-scene") === -1);
    check("neo-lore-drop scoped CSS compiled", pub.css.includes("grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))") && pub.css.includes("lime-block__cover-title"));
}

// --- Second showcase pack: studio-folio (portfolio/creative studio) ---
{
    const RealLimePresets = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-presets.js"));
    const RealLimeTemplates = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-templates.js"));
    const LimeDoc = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));
    const folioPage = [];
    const folioDoc = { version: 2, theme: {}, pages: [{ id: "p1", slug: "", title: "Folio", blocks: folioPage }] };
    let folioLayerId = 0;
    const folioApi = Presets.create({
        window: { LimePresets: RealLimePresets, LimeTemplates: RealLimeTemplates },
        L: LimeDoc,
        getDoc: () => folioDoc,
        pageBlocks: () => folioPage,
        rid(prefix) { return prefix + "-folio-" + (++folioLayerId); }
    });
    const folioTpl = RealLimeTemplates.find(t => t.key === "studio-folio");
    const folioSectionsExist = folioTpl && folioTpl.sections.every(key => RealLimePresets.PRESETS[key] && RealLimePresets.PRESETS[key].length);
    check("studio-folio template registered with existing sections", !!folioSectionsExist);
    check("studio-folio applies theme and full page (10 sections)", folioApi.applyTemplateByKey("studio-folio") === true && folioDoc.theme.accent === "#c4531f" && folioPage.length >= 10);
    check("studio-folio stamps doc.pack (Milestone 4 asset-slot linkage)", folioDoc.pack === "studio-folio");
    const folioJson = JSON.stringify(folioPage);
    check("studio-folio has embed, marquee and decorative layers", folioJson.includes('"type":"embed"') && folioJson.includes('"marquee"') && folioJson.includes('"layers"'));
    check("studio-folio hero/reel embeds carry their asset-slot markers", folioJson.includes('"__slot":"hero-portrait"') && folioJson.includes('"__slot":"reel-embed"'));
    check("studio-folio pairs a serif display font over the sans theme font", folioJson.includes("Playfair Display") && folioTpl.theme.font.includes("Work Sans"));
    const folioPub = LimeDoc.render({ version: 2, theme: folioDoc.theme, blocks: folioPage }, {});
    const folioEditorOnly = ["contenteditable", "data-field", "data-doc-embed", "data-layer-id", "lime-block-grip", "lime-doc-media-swap"];
    check("studio-folio publish renders allowlisted YouTube embed iframe", folioPub.html.includes("<iframe") && folioPub.html.includes("https://www.youtube.com/embed/aqz-KE-bpKQ"));
    check("studio-folio publish renders motion markers (marquee/layers)", folioPub.html.includes("lime-block__children--marquee") && folioPub.html.includes("lime-block__layers"));
    check("studio-folio publish stays clean of editor-only hooks", folioEditorOnly.every(m => folioPub.html.indexOf(m) === -1));
    check("studio-folio publish never leaks the internal __slot marker", folioPub.html.indexOf("__slot") === -1 && folioPub.html.indexOf("hero-portrait") === -1);
    check("studio-folio scoped CSS compiled", folioPub.css.includes("Playfair Display") && folioPub.css.includes("lime-block__cover-title"));
}

if (failed) {
    console.error("\nPRESETS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nPRESETS-OK");
