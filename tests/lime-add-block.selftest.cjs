"use strict";

const path = require("path");
const AddBlock = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-add-block.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function makeButton(type) {
    return {
        dataset: { docAdd: type },
        listeners: {},
        addEventListener(name, handler) { this.listeners[name] = handler; },
        click() { this.listeners.click.call(this, { stopPropagation() { calls.push("stop:" + type); } }); }
    };
}

function makeClosest(kind, value) {
    return {
        closest(selector) {
            if (selector === kind) return this;
            return null;
        },
        getAttribute() { return value; }
    };
}

const calls = [];
const headingBtn = makeButton("heading");
const textBtn = makeButton("text");
const ws = {
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; }
};
const documentStub = {
    querySelectorAll(selector) {
        return selector === "[data-doc-add]" ? [headingBtn, textBtn] : [];
    },
    querySelector(selector) {
        return selector === '[data-doc-add="heading"]' ? headingBtn : null;
    }
};
const page = [];
const container = { id: "container", type: "container", children: [] };
let selectedId = null;
let paletteJustDragged = false;
let nextCommandResult = false;
const commandPayloads = [];
const finished = [];
const selectionStore = [];
const L = {
    createBlock(type) { return { id: type + "-" + (page.length + container.children.length + 1), type, content: {} }; },
    isContainer(type) { return type === "container"; }
};
const win = {
    __LIME_SELECTION__: { replace(ids) { selectionStore.push(ids.join(",")); } }
};

AddBlock.create({
    document: documentStub,
    window: win,
    L,
    ws,
    getPaletteJustDragged: () => paletteJustDragged,
    setPaletteJustDragged(value) { paletteJustDragged = value; },
    getSelectedId: () => selectedId,
    setSelectedId(value) { selectedId = value; },
    getActive: () => 2,
    pageBlocks: () => page,
    findBlock(id) {
        if (id === "container") return { block: container, parent: page, index: 0, parentBlock: null };
        return null;
    },
    targetBlock: block => block,
    runCommand(type, payload) {
        commandPayloads.push({ type, payload });
        return nextCommandResult;
    },
    finishInsert(block, parentId, index, commandApplied) {
        finished.push({ id: block.id, parentId, index, commandApplied });
    },
    aiOpen() { calls.push("ai"); }
});

headingBtn.click();
check("palette click inserts top-level block", page.length === 1 && page[0].type === "heading");
check("top-level command payload is correct", commandPayloads[0].payload.pageIndex === 2 && commandPayloads[0].payload.parentId === null && commandPayloads[0].payload.index === 0);
check("selection and finish are synced", selectedId === page[0].id && selectionStore.includes(page[0].id) && finished[0].parentId === null);

selectedId = "container";
textBtn.click();
check("selected container receives new block", container.children.length === 1 && container.children[0].type === "text");
check("container command payload uses parent id", commandPayloads[1].payload.parentId === "container" && commandPayloads[1].payload.index === 0);

paletteJustDragged = true;
const beforeDragSuppressed = page.length + container.children.length;
headingBtn.click();
check("paletteJustDragged suppresses duplicate click", !paletteJustDragged && page.length + container.children.length === beforeDragSuppressed);

selectedId = null;
ws.listeners.click({
    target: makeClosest("[data-doc-empty-add]", "heading"),
    stopPropagation() { calls.push("empty-stop"); }
});
check("empty add delegates to palette tile", page.length === 2 && calls.includes("empty-stop"));

ws.listeners.click({
    target: makeClosest("[data-doc-empty-ai]"),
    stopPropagation() { calls.push("ai-stop"); }
});
check("empty AI delegates to aiOpen", calls.includes("ai-stop") && calls.includes("ai"));

if (failed) {
    console.error("\nADD-BLOCK-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nADD-BLOCK-OK");
