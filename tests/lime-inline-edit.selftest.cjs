"use strict";

const path = require("path");
const InlineEdit = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-inline-edit.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function editable(field, value, blockId) {
    const sec = {
        getAttribute(name) {
            return name === "data-block-id" ? blockId : "";
        }
    };
    return {
        textContent: value,
        getAttribute(name) {
            return name === "data-field" ? field : "";
        },
        closest(selector) {
            if (selector === "[data-field]") return this;
            if (selector === ".lime-block") return sec;
            return null;
        }
    };
}

function makeTimers() {
    const timers = [];
    const cleared = [];
    return {
        timers,
        cleared,
        win: {
            setTimeout(fn, ms) {
                timers.push({ fn, ms });
                return timers.length;
            },
            clearTimeout(id) {
                cleared.push(id);
            }
        }
    };
}

let listener = null;
const ws = {
    addEventListener(type, handler) {
        if (type === "input") listener = handler;
    }
};

let doc = { components: {}, pages: [] };
let cmdPrev = "";
const calls = [];
const block = { id: "b1", type: "text", content: { text: "Old" } };
const commandDoc = { components: {}, pages: [], changed: true };
const timers1 = makeTimers();
const cmdStore = {
    begin(label) { calls.push("begin:" + label); },
    dispatch(type, payload) {
        calls.push("dispatch:" + type + ":" + payload.field + ":" + payload.value);
        return true;
    },
    commit(label) { calls.push("commit:" + label); },
    getDoc() { return commandDoc; },
    cancel() { calls.push("cancel"); }
};

const api = InlineEdit.create({
    window: timers1.win,
    ws,
    getDoc: () => doc,
    setDoc(value) { doc = value; calls.push("setDoc"); },
    getCmdStore: () => cmdStore,
    setCmdPrev(value) { cmdPrev = value; },
    byId: id => id === "b1" ? block : null,
    targetBlock: b => b,
    setByPath(obj, field, value) { obj[field] = value; calls.push("setByPath"); },
    beginCheckpointMutation() { calls.push("checkpoint"); },
    commitStyleEdit() { calls.push("commitStyle"); },
    commitBlockEdit() { calls.push("commitBlock"); },
    updateHistButtons() { calls.push("hist"); },
    scheduleAutosave() { calls.push("autosave"); },
    markDirty() { calls.push("dirty"); }
});

listener({ target: editable("text", "New text", "b1") });
check("command path starts inline transaction", calls.includes("begin:inline-content"));
check("command path dispatches setContent", calls.includes("dispatch:setContent:text:New text"));
check("command path updates doc from store", doc === commandDoc);
check("command path schedules commit", api.isEditing() && timers1.timers[0].ms === 600);
api.commitInlineEdit();
check("commit finalizes history state", calls.includes("commit:inline-content") && calls.includes("hist") && calls.includes("autosave"));
check("commit updates cmdPrev", cmdPrev === JSON.stringify(commandDoc));
check("commit clears pending timer", timers1.cleared.includes(1));

const timers2 = makeTimers();
let localDoc = { components: {}, pages: [] };
const fallbackBlock = { id: "b2", type: "text", content: { title: "Old" } };
let fallbackListener = null;
InlineEdit.create({
    window: timers2.win,
    ws: { addEventListener(type, handler) { if (type === "input") fallbackListener = handler; } },
    getDoc: () => localDoc,
    getCmdStore: () => null,
    byId: id => id === "b2" ? fallbackBlock : null,
    targetBlock: b => b,
    setByPath(obj, field, value) { obj[field] = value; },
    beginCheckpointMutation() { calls.push("fallbackCheckpoint"); },
    markDirty() { calls.push("fallbackDirty"); }
});
fallbackListener({ target: editable("title", "Fallback", "b2") });
check("fallback writes content locally", fallbackBlock.content.title === "Fallback");
timers2.timers[0].fn();
check("fallback schedules dirty mark", calls.includes("fallbackCheckpoint") && calls.includes("fallbackDirty"));

const componentDoc = { components: { c1: { id: "c1" } }, pages: [] };
const compBlock = { id: "cmp", type: "component", ref: "c1", content: {} };
let override = null;
const compApi = InlineEdit.create({
    window: makeTimers().win,
    getDoc: () => componentDoc,
    getCmdStore: () => null,
    byId: id => id === "cmp" ? compBlock : null,
    targetBlock: b => ({ id: "definition", type: "text", content: {} }),
    setComponentContentOverrideLocal(inst, field, value, remove) { override = { id: inst.id, field, value, remove }; },
    markDirty() {}
});
compApi.handleInput({ target: editable("headline", "Override", "cmp") });
check("component fallback writes override", override && override.id === "cmp" && override.field === "headline" && override.value === "Override" && override.remove === false);

let commits = 0;
const switchStore = {
    begin() {},
    dispatch() { return true; },
    commit() { commits++; },
    getDoc() { return { components: {}, pages: [] }; }
};
const switchApi = InlineEdit.create({
    window: makeTimers().win,
    getDoc: () => ({ components: {}, pages: [] }),
    setDoc() {},
    getCmdStore: () => switchStore,
    setCmdPrev() {},
    byId: id => ({ id, type: "text", content: {} }),
    targetBlock: b => b,
    updateHistButtons() {},
    scheduleAutosave() {},
    markDirty() {}
});
switchApi.handleInput({ target: editable("text", "A", "a") });
switchApi.handleInput({ target: editable("title", "B", "a") });
check("field switch commits previous inline transaction", commits === 1 && switchApi.isEditing());

if (failed) {
    console.error("INLINE-EDIT-FAIL " + failed);
    process.exit(1);
}
console.log("INLINE-EDIT-OK");
