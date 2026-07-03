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
    const json = JSON.stringify(realPage);
    check("neo-lore-drop has embed, scene and decorative layers", json.includes('"type":"embed"') && json.includes('"mode":"horizontal"') && json.includes('"layers"'));
    const pub = LimeDoc.render({ version: 2, theme: realDoc.theme, blocks: realPage }, {});
    const editorOnly = ["contenteditable", "data-field", "data-doc-embed", "data-layer-id", "lime-block-grip", "lime-doc-media-swap"];
    check("neo-lore-drop publish renders allowlisted embed iframe", pub.html.includes("<iframe") && pub.html.includes("https://my.spline.design/neo-lore-drop-placeholder/"));
    check("neo-lore-drop publish renders motion/layers markers", pub.html.includes('data-scene="horizontal"') && pub.html.includes("lime-block__layers") && pub.html.includes('data-parallax='));
    check("neo-lore-drop publish stays clean of editor-only hooks", editorOnly.every(m => pub.html.indexOf(m) === -1));
    check("neo-lore-drop scoped CSS compiled", pub.css.includes("grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))") && pub.css.includes("lime-block__cover-title"));
}

if (failed) {
    console.error("\nPRESETS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nPRESETS-OK");
