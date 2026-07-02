"use strict";

const path = require("path");
const Layers = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-layers.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function control(attrs) {
    attrs = attrs || {};
    return {
        hasAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name);
        },
        getAttribute(name) {
            return attrs[name];
        }
    };
}

function makeBox() {
    const attrs = {};
    return {
        __limeLayersBound: false,
        listeners: {},
        dataset: {},
        clientHeight: 90,
        scrollTop: 0,
        innerHTML: "",
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        },
        setAttribute(name, value) {
            attrs[name] = String(value);
        },
        removeAttribute(name) {
            delete attrs[name];
        },
        hasAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name);
        }
    };
}

function row(id) {
    return {
        getAttribute(name) {
            return name === "data-doc-layer" ? id : "";
        }
    };
}

function eventTarget(layerRow, nodeControl) {
    return {
        closest(selector) {
            if (selector === "[data-doc-layer]") return layerRow;
            if (selector.indexOf("[data-node-") >= 0) return nodeControl;
            return null;
        }
    };
}

const blocks = [
    { id: "a", type: "container", name: "Hero", children: [{ id: "b", type: "text" }] }
];
const box = makeBox();
const dom = {
    getElementById(id) {
        return id === "lime-doc-layers" ? box : null;
    }
};
let selectedId = "a";
let selectedByBind = null;
const api = Layers.create({
    document: dom,
    window: { requestAnimationFrame(fn) { fn(); } },
    escapeText: s => String(s),
    getPageBlocks: () => blocks,
    getSelectedId: () => selectedId,
    isCanvasOn: () => true,
    isContainer: type => type === "container",
    resolvedBlockDesign: block => (block.design && block.design.base) || {},
    selectById(id) { selectedByBind = id; selectedId = id; },
    targetBlock: block => block
});
api.bind(box);
api.refreshLayers();
check("refresh renders layer rows", box.dataset.layerTotal === "2" && box.innerHTML.includes('data-doc-layer="a"') && box.innerHTML.includes('data-doc-layer="b"'));
check("blockLabel prefers custom name", api.blockLabel(blocks[0]) === "Hero");
box.listeners.keydown({ key: "ArrowDown", preventDefault() {} });
check("keyboard bind selects next row", selectedByBind === "b");
box.listeners.click({ target: eventTarget(row("a"), null) });
check("click bind selects layer row", selectedByBind === "a");

const commandCalls = [];
const commandBlock = { id: "cmd", type: "text" };
const commandApi = Layers.create({
    byId: id => id === "cmd" ? commandBlock : null,
    getCmdStore: () => ({}),
    runCommand(type, payload) {
        commandCalls.push({ type, payload });
        return true;
    },
    render() { commandCalls.push("render"); },
    scheduleAutosave() { commandCalls.push("autosave"); }
});
commandApi.runLayerControl("cmd", control({ "data-node-toggle-hidden": "" }));
check("command control dispatches hidden toggle", commandCalls[0].type === "setNodeHidden" && commandCalls[0].payload.value === true);
check("command control refreshes and autosaves", commandCalls.includes("render") && commandCalls.includes("autosave"));

const fallbackCalls = [];
const fallbackBlock = { id: "fb", type: "text", design: { base: { zIndex: 999 } } };
const fallbackApi = Layers.create({
    window: { prompt() { return "  Layer Name  "; } },
    byId: id => id === "fb" ? fallbackBlock : null,
    getCurrentBp: () => "base",
    resolvedBlockDesign: block => block.design.base,
    render() { fallbackCalls.push("render"); },
    markDirty() { fallbackCalls.push("dirty"); }
});
fallbackApi.runLayerControl("fb", control({ "data-node-toggle-locked": "" }));
fallbackApi.runLayerControl("fb", control({ "data-node-rename": "" }));
fallbackApi.runLayerControl("fb", control({ "data-node-z": "5" }));
check("fallback controls mutate local block", fallbackBlock.locked === true && fallbackBlock.name === "Layer Name" && fallbackBlock.design.base.zIndex === 1000);
check("fallback controls render and mark dirty", fallbackCalls.filter(x => x === "render").length === 3 && fallbackCalls.filter(x => x === "dirty").length === 3);

if (failed) {
    console.error("LAYERS-FAIL " + failed);
    process.exit(1);
}
console.log("LAYERS-OK");
