"use strict";

const path = require("path");
const MediaActions = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-media-actions.js"));
const LimeDoc = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function makeHarness(answers, opts) {
    opts = opts || {};
    const block = { id: "e1", type: "embed", content: opts.content || {} };
    const calls = [];
    const alerts = [];
    const prompts = [];
    const win = {
        LimeDoc,
        LimeExperiencePacks: opts.experiencePacks,
        prompt(msg) { prompts.push(msg); return answers.shift(); },
        alert(msg) { alerts.push(msg); }
    };
    const api = MediaActions.create({
        window: win,
        document: null,
        ws: null,
        byId(id) { return id === "e1" ? block : null; },
        targetBlock(b) { return b; },
        getDoc: opts.getDoc || function () { return null; },
        setContentValue(b, field, value, remove) {
            calls.push({ field, value, remove: !!remove });
            if (!b.content) b.content = {};
            if (remove) delete b.content[field];
            else b.content[field] = value;
        }
    });
    return { api, block, calls, alerts, prompts };
}

{
    const h = makeHarness(["spline", "https://my.spline.design/scene"]);
    h.api.promptEmbed("e1");
    check("promptEmbed stores URL/provider/aspect", h.block.content.embedUrl === "https://my.spline.design/scene" && h.block.content.provider === "spline" && h.block.content.aspect === "4/5");
    check("promptEmbed stores fallback copy", h.block.content.fallbackTitle === "Spline scene" && h.block.content.fallbackText === "Loading interactive scene.");
    check("promptEmbed uses setContentValue for each field", ["embedUrl", "provider", "aspect", "fallbackTitle", "fallbackText"].every(k => h.calls.some(c => c.field === k)));
    check("promptEmbed happy path has no alert", h.alerts.length === 0);
}

{
    const h = makeHarness(["unknown"]);
    h.api.promptEmbed("e1");
    check("promptEmbed rejects unknown provider", h.calls.length === 0 && h.alerts.length === 1);
}

{
    const h = makeHarness(["rive", "https://evil.example.com/scene"]);
    h.api.promptEmbed("e1");
    check("promptEmbed rejects URL outside allowlist", h.calls.length === 0 && h.alerts.length === 1);
}

// --- Milestone 4 (experience-builder-plan.md): slot-aware prompt copy ---
{
    const fakePacks = {
        resolve(key) {
            if (key !== "neo-lore-drop") return null;
            return { assetSlots: [{ slot: "hero-scene", label: "Hero scene", hint: "Spline/Rive/Sketchfab embed URL" }] };
        }
    };
    const h = makeHarness(["spline", "https://my.spline.design/scene"], {
        content: { __slot: "hero-scene" },
        getDoc: () => ({ pack: "neo-lore-drop" }),
        experiencePacks: fakePacks
    });
    h.api.promptEmbed("e1");
    check("promptEmbed: known slot appends its hint to the URL prompt", h.prompts[1].indexOf("Spline/Rive/Sketchfab embed URL") >= 0);
}
{
    // Тот же блок, но документ не помечен как пак (doc.pack не резолвится) — промпт как раньше.
    const fakePacks = { resolve: () => null };
    const h = makeHarness(["spline", "https://my.spline.design/scene"], {
        content: { __slot: "hero-scene" },
        getDoc: () => ({ pack: "startup" }),
        experiencePacks: fakePacks
    });
    h.api.promptEmbed("e1");
    check("promptEmbed: unresolved pack -> unchanged prompt text, no crash", h.prompts[1] === "Ссылка на Spline:");
}
{
    // Обычный embed без __slot — поведение не меняется вообще.
    const h = makeHarness(["spline", "https://my.spline.design/scene"]);
    h.api.promptEmbed("e1");
    check("promptEmbed: no __slot on the block -> unchanged prompt text", h.prompts[1] === "Ссылка на Spline:");
}

if (failed) {
    console.error("\nMEDIA-ACTIONS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nMEDIA-ACTIONS-OK");
