"use strict";

const path = require("path");
const Packs = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-experience-packs.js"));
const Templates = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-templates.js"));
const Intro = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-intro.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// ---- LimeExperiencePacks.LIST / resolve ----
const neo = Packs.LIST.find((p) => p.key === "neo-lore-drop");
check("LIST has neo-lore-drop with category/level/assetSlots/motionProfile", !!neo
    && neo.category === "showcase"
    && neo.level === "pro"
    && Array.isArray(neo.assetSlots) && neo.assetSlots.length > 0
    && Array.isArray(neo.motionProfile) && neo.motionProfile.length > 0);

const resolved = Packs.resolve("neo-lore-drop", Templates);
const tpl = Templates.find((t) => t.key === "neo-lore-drop");
check("resolve() merges name/theme/sections from LimeTemplates", !!resolved
    && resolved.name === tpl.name
    && resolved.theme === tpl.theme
    && resolved.sections === tpl.sections
    && resolved.category === "showcase");
check("resolve() keeps pack-only fields (assetSlots/motionProfile/preview)", !!resolved
    && Array.isArray(resolved.assetSlots)
    && Array.isArray(resolved.motionProfile)
    && typeof resolved.preview === "string" && resolved.preview.length > 0);

check("resolve() returns null for unknown key", Packs.resolve("no-such-key", Templates) === null);
check("resolve() returns null when pack has no matching template", Packs.resolve("neo-lore-drop", []) === null);

// ---- Второй пак: studio-folio (portfolio/creative studio) ----
check("LIST has exactly 2 packs now", Packs.LIST.length === 2);
const folio = Packs.LIST.find((p) => p.key === "studio-folio");
check("LIST has studio-folio with category/level/assetSlots/motionProfile", !!folio
    && folio.category === "portfolio"
    && folio.level === "pro"
    && Array.isArray(folio.assetSlots) && folio.assetSlots.length === 3
    && Array.isArray(folio.motionProfile) && folio.motionProfile.length > 0);

const folioResolved = Packs.resolve("studio-folio", Templates);
const folioTpl = Templates.find((t) => t.key === "studio-folio");
check("resolve(studio-folio) merges name/theme/sections from LimeTemplates", !!folioResolved
    && folioResolved.name === folioTpl.name
    && folioResolved.theme === folioTpl.theme
    && folioResolved.sections === folioTpl.sections
    && folioResolved.category === "portfolio");
check("studio-folio theme is genuinely distinct from neo-lore-drop (light vs dark bg)", folioTpl.theme.bg !== tpl.theme.bg
    && folioTpl.theme.bg.toLowerCase() === "#f6f3ee");

// ---- lime-editor-intro.js: pack tiles render + click applies + hides ----
function classListStub() {
    const set = new Set();
    return {
        add() { Array.prototype.forEach.call(arguments, (c) => set.add(c)); },
        remove() { Array.prototype.forEach.call(arguments, (c) => set.delete(c)); },
        contains(c) { return set.has(c); }
    };
}
function elStub() {
    return {
        value: "",
        textContent: "",
        innerHTML: "",
        classList: classListStub(),
        handlers: {},
        addEventListener(type, fn) { this.handlers[type] = fn; },
        focus() {}
    };
}

const introEl = elStub();
const introPrompt = elStub();
const introMsg = elStub();
const introGo = elStub();
const introSkip = elStub();
const introChips = elStub();
const introPacks = elStub();
const elMap = {
    "lime-doc-intro": introEl,
    "lime-doc-intro-prompt": introPrompt,
    "lime-doc-intro-msg": introMsg,
    "lime-doc-intro-go": introGo,
    "lime-doc-intro-skip": introSkip,
    "lime-doc-intro-chips": introChips,
    "lime-doc-intro-packs": introPacks
};
const documentStub = { getElementById: (id) => elMap[id] || null };

const appliedKeys = [];
const api = Intro.create({
    document: documentStub,
    totalBlocks: () => 0,
    runGenerate: () => {},
    packs: { LIST: Packs.LIST, resolve: (key) => Packs.resolve(key, Templates) },
    applyPack: (key) => appliedKeys.push(key)
});

check("intro shows on empty document", introEl.classList.contains("is-on"));
check("pack tiles rendered into #lime-doc-intro-packs", introPacks.innerHTML.indexOf('data-doc-pack="neo-lore-drop"') !== -1
    && introPacks.innerHTML.indexOf(tpl.name) !== -1);
check("second pack tile (studio-folio) also renders — no singular-pack assumption", introPacks.innerHTML.indexOf('data-doc-pack="studio-folio"') !== -1
    && introPacks.innerHTML.indexOf(folioTpl.name) !== -1);

// Simulate a click on the rendered pack tile via the delegated handler.
const clickHandler = introPacks.handlers.click;
check("click handler registered on packs container", typeof clickHandler === "function");
const fakeEvent = {
    target: {
        closest(sel) {
            return sel === "[data-doc-pack]" ? { getAttribute: (a) => (a === "data-doc-pack" ? "neo-lore-drop" : null) } : null;
        }
    }
};
clickHandler(fakeEvent);
check("clicking a pack tile calls applyPack with the right key", appliedKeys[0] === "neo-lore-drop");
check("clicking a pack tile hides the intro (is-hidden set)", introEl.classList.contains("is-hidden"));

check("api exposes hide/dismiss", typeof api.hide === "function" && typeof api.dismiss === "function");

if (failed) {
    console.error("\nEXPERIENCE-PACKS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nEXPERIENCE-PACKS-OK");
