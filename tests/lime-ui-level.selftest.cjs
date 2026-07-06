"use strict";

const path = require("path");
const UiLevel = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-ui-level.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// ---- rank / atOrBelow ----
check("rank order basic<design<motion<pro", UiLevel.rank("basic") < UiLevel.rank("design")
    && UiLevel.rank("design") < UiLevel.rank("motion")
    && UiLevel.rank("motion") < UiLevel.rank("pro"));
check("atOrBelow: pro item not visible at basic", UiLevel.atOrBelow("pro", "basic") === false);
check("atOrBelow: basic item visible at pro", UiLevel.atOrBelow("basic", "pro") === true);
check("atOrBelow: same tier is visible", UiLevel.atOrBelow("motion", "motion") === true);
check("atOrBelow: missing/unknown tier treated as basic", UiLevel.atOrBelow(undefined, "basic") === true
    && UiLevel.atOrBelow("nonsense", "basic") === true);

// ---- get()/set() with a fake localStorage ----
function fakeWin(store) {
    return {
        localStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
            setItem: (k, v) => { store[k] = v; }
        }
    };
}
check("get(): no keys at all -> basic (fresh user)", UiLevel.get(fakeWin({})) === "basic");
check("get(): onboarding seen, no explicit level -> pro (existing user, no surprise)",
    UiLevel.get(fakeWin({ "lime-onboarding-seen": "1" })) === "pro");
check("get(): explicit lime-ui-level wins over onboarding flag",
    UiLevel.get(fakeWin({ "lime-onboarding-seen": "1", "lime-ui-level": "design" })) === "design");
check("get(): garbage stored value falls back to onboarding-based default",
    UiLevel.get(fakeWin({ "lime-ui-level": "not-a-real-level" })) === "basic");

{
    const store = {};
    const win = fakeWin(store);
    UiLevel.set(win, "motion");
    check("set() then get() round-trips", UiLevel.get(win) === "motion");
}
{
    const store = {};
    const win = fakeWin(store);
    UiLevel.set(win, "not-a-real-level");
    check("set() ignores invalid level (nothing written)", !Object.prototype.hasOwnProperty.call(store, "lime-ui-level"));
}
check("get()/set() tolerate a missing window", UiLevel.get(null) === "pro"); // без window — не рискуем прятать контролы

// ---- wireToggle(): stub DOM ----
function classListStub() {
    const set = new Set();
    return {
        toggle(cls, on) { if (on) set.add(cls); else set.delete(cls); },
        contains: (cls) => set.has(cls)
    };
}
function btnStub(level) {
    return { _level: level, classList: classListStub(), getAttribute: (a) => (a === "data-ui-level" ? level : null) };
}
function chromeStub() {
    return { hidden: false };
}

const levelButtons = ["basic", "design", "motion", "pro"].map(btnStub);
const toggleHandlers = {};
const toggleEl = {
    querySelectorAll: (sel) => (sel === "[data-ui-level]" ? levelButtons : []),
    addEventListener: (type, fn) => { toggleHandlers[type] = fn; }
};
const proEl = chromeStub();
const motionEl = chromeStub();
const documentStub = {
    querySelector: (sel) => (sel === "[data-ui-level-toggle]" ? toggleEl : null),
    querySelectorAll: (sel) => {
        if (sel === "[data-doc-ui-pro]") return [proEl];
        if (sel === "[data-doc-ui-motion]") return [motionEl];
        return [];
    }
};

let lastChange = null;
const handle = UiLevel.wireToggle({
    document: documentStub,
    initialLevel: "basic",
    onChange: (level) => { lastChange = level; }
});

check("wireToggle: initial paint marks basic active", levelButtons.find((b) => b._level === "basic").classList.contains("is-active")
    && !levelButtons.find((b) => b._level === "pro").classList.contains("is-active"));
check("wireToggle: initial chrome hides pro/motion-only items at basic", proEl.hidden === true && motionEl.hidden === true);

// Simulate clicking the "motion" button.
const fakeEvent = { target: { closest: (sel) => (sel === "[data-ui-level]" ? btnStub("motion") : null) } };
toggleHandlers.click(fakeEvent);

check("wireToggle: click calls onChange with clicked level", lastChange === "motion");
check("wireToggle: chrome updates — motion-only item now visible, pro-only still hidden",
    motionEl.hidden === false && proEl.hidden === true);

// Simulate clicking "pro".
toggleHandlers.click({ target: { closest: (sel) => (sel === "[data-ui-level]" ? btnStub("pro") : null) } });
check("wireToggle: at pro level both chrome groups are visible", proEl.hidden === false && motionEl.hidden === false);

check("wireToggle: returns a setLevel handle", typeof handle.setLevel === "function");

if (failed) {
    console.error("\nUI-LEVEL-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nUI-LEVEL-OK");
