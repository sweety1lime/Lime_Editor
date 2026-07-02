"use strict";

const path = require("path");
const Breakpoints = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-breakpoints.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function button(bp) {
    return {
        dataset: { docBp: bp },
        active: false,
        listeners: {},
        classList: {
            toggle(cls, value) {
                if (cls === "is-active") this.host.active = !!value;
            }
        },
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        }
    };
}

const base = button("base");
const tablet = button("tablet");
const mobile = button("mobile");
base.classList.host = base;
tablet.classList.host = tablet;
mobile.classList.host = mobile;

const animPreview = {
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; }
};
const ws = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; }
};
const calls = [];
let currentBp = "base";
const documentStub = {
    querySelectorAll(selector) {
        return selector === "[data-doc-bp]" ? [base, tablet, mobile] : [];
    },
    querySelector(selector) {
        return selector === "[data-doc-anim-preview]" ? animPreview : null;
    }
};
const win = {
    LimeAnim: { play(target) { calls.push(target === ws ? "play-ws" : "play-other"); } }
};

const api = Breakpoints.create({
    document: documentStub,
    window: win,
    ws,
    setCurrentBp(value) { currentBp = value; calls.push("bp:" + value); },
    applyPreviewStyles() { calls.push("preview"); },
    refreshInspector() { calls.push("inspector"); }
});

api.switchBreakpoint("tablet");
check("switch updates state", currentBp === "tablet" && calls.includes("bp:tablet"));
check("switch toggles active button", !base.active && tablet.active && !mobile.active);
check("switch updates workspace device", ws.attrs["data-device"] === "tablet");
check("switch refreshes preview and inspector", calls.includes("preview") && calls.includes("inspector"));

base.listeners.click.call(base);
check("click handler switches to desktop device", currentBp === "base" && ws.attrs["data-device"] === "desktop" && base.active);

animPreview.listeners.click();
check("animation preview delegates to LimeAnim", calls.includes("play-ws"));

if (failed) {
    console.error("\nBREAKPOINTS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nBREAKPOINTS-OK");
