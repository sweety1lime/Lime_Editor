"use strict";

const path = require("path");
const Registry = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-command-registry.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function clickable(name, sink) {
    return {
        click() { sink.push(name); },
        classList: { add(cls) { sink.push(name + ":" + cls); } }
    };
}

const clicked = [];
const elements = {
    "[data-doc-cmdk]": clickable("cmdk", clicked),
    '[data-doc-add="heading"]': clickable("add-heading", clicked),
    '[data-doc-bp="mobile"]': clickable("bp-mobile", clicked),
    "[data-doc-code-open]": clickable("code-open", clicked)
};
const documentStub = {
    querySelector(selector) {
        return elements[selector] || null;
    }
};
const sidebarOpened = [];
const win = {
    __LIME_SIDEBAR__: { open(name) { sidebarOpened.push(name); } }
};
let selectedId = null;
let selectionIds = [];
const calls = [];
let paletteOptions = null;
const commandPalette = {
    create(options) {
        paletteOptions = options;
        return {};
    }
};
const themeModal = clickable("theme", clicked);
const saveBtn = clickable("save", clicked);

const registry = Registry.create({
    document: documentStub,
    window: win,
    commandPalette,
    saveBtn,
    themeModal,
    codeModal: {},
    escapeText: String,
    getSelectedId: () => selectedId,
    byId: id => id === "group" ? { id, type: "group" } : (id ? { id, type: "heading" } : null),
    v2SelectionIds: () => selectionIds,
    aiOpen: () => calls.push("aiOpen"),
    aiSuggest: id => calls.push("aiSuggest:" + id),
    undo: () => calls.push("undo"),
    redo: () => calls.push("redo"),
    runBlockOp: op => calls.push("block:" + op),
    groupSelection: () => calls.push("group"),
    ungroupBlock: () => calls.push("ungroup"),
    makeComponent: () => calls.push("component")
});

const commands = registry.commands;
const byCommand = id => commands.find(command => command.id === id);

check("registry exposes commands", commands.length >= 20 && win.__LIME_COMMANDS__ === commands);
check("palette is created with launcher", paletteOptions && paletteOptions.launcher === elements["[data-doc-cmdk]"]);
check("selected commands disabled without selection", byCommand("ai-edit").when() === false && byCommand("duplicate").when() === false);

byCommand("insert-heading").run();
check("insert command opens sidebar and clicks tile", sidebarOpened[0] === "insert" && clicked.includes("add-heading"));

byCommand("device-mobile").run();
check("breakpoint command clicks matching control", clicked.includes("bp-mobile"));

byCommand("open-theme").run();
byCommand("open-code").run();
check("modal commands run through injected DOM", clicked.includes("theme:is-open") && clicked.includes("code-open"));

selectedId = "b1";
byCommand("ai-edit").run();
byCommand("duplicate").run();
byCommand("delete").run();
check("selected commands read current selected id", calls.includes("aiSuggest:b1") && calls.includes("block:dup") && calls.includes("block:del"));

selectionIds = ["a", "b"];
check("group command requires multi-selection", byCommand("group").when() === true);
byCommand("group").run();
selectedId = "group";
check("ungroup command requires group block", byCommand("ungroup").when() === true);
byCommand("ungroup").run();

byCommand("component").run();
byCommand("save").run();
check("action commands delegate correctly", calls.includes("group") && calls.includes("ungroup") && calls.includes("component") && clicked.includes("save"));

if (failed) {
    console.error("\nCOMMAND-REGISTRY-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nCOMMAND-REGISTRY-OK");
