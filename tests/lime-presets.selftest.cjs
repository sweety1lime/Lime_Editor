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

if (failed) {
    console.error("\nPRESETS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nPRESETS-OK");
