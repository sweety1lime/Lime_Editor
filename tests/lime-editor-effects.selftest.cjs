"use strict";

const path = require("path");
const Effects = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-effects.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

let idSeq = 0;
function makeEnv(opts) {
    opts = opts || {};
    const blocks = opts.blocks || {};
    const setCalls = [];
    const runCommandsCalls = [];
    let renderCalls = 0, markDirtyCalls = 0, refreshCalls = 0;
    const api = Effects.create({
        L: { isContainer: (t) => t === "container" || t === "columns" },
        ws: null,
        getSelectedId: () => opts.selectedId || null,
        getCmdStore: () => (opts.cmdStore !== undefined ? opts.cmdStore : null),
        byId: (id) => blocks[id] || null,
        targetBlock: (b) => b,
        clone: (v) => JSON.parse(JSON.stringify(v)),
        rid: (prefix) => (prefix || "id") + "-" + (++idSeq),
        sec: (title, body) => "[" + title + "]" + body,
        setBlockValue: (source, prop, value, remove) => { setCalls.push({ id: source && source.id, prop, value, remove }); },
        commandBlockGesture: () => false,
        runCommands: (items, label) => { runCommandsCalls.push({ items, label }); return true; },
        openMediaPicker: () => {},
        scheduleAutosave: () => {},
        markDirty: () => { markDirtyCalls++; },
        refreshInspector: () => { refreshCalls++; },
        render: () => { renderCalls++; }
    });
    return {
        api, blocks, setCalls, runCommandsCalls,
        renderCalls: () => renderCalls, markDirtyCalls: () => markDirtyCalls, refreshCalls: () => refreshCalls
    };
}

// ---- human presets: closest-match active state (via rendered HTML) ----
{
    const { api } = makeEnv({});
    const html = api.motionInspector({ type: "text" });
    check("parallax preset: unset -> Нет (0) active", html.indexOf('is-active" data-doc-parallax-preset="0"') >= 0);
}
{
    const { api } = makeEnv({});
    const html = api.motionInspector({ type: "text", parallax: 0.29 });
    // 0.29 ближе к 0.35 (Средний), чем к 0.15 (Лёгкий, diff .14) или 0.6 (diff .31) — closest = 0.35.
    check("parallax 0.29 snaps to closest preset (0.35 Средний)", html.indexOf('is-active" data-doc-parallax-preset="0.35"') >= 0);
}
{
    const { api } = makeEnv({});
    const html = api.sceneInspector({ type: "container", scene: { mode: "horizontal", length: 3 } });
    check("scene length 3 shows Длинно as active", html.indexOf('is-active" data-doc-scene-len-preset="3"') >= 0);
}
{
    const { api } = makeEnv({});
    const html = api.sceneInspector({ type: "text" });
    check("sceneInspector hidden for non-container", html === "");
}
{
    const { api } = makeEnv({});
    const htmlNoMarquee = api.motionInspector({ type: "container" });
    check("marquee speed preset hidden when marquee is off", htmlNoMarquee.indexOf("data-doc-marquee-speed") === -1);
    const htmlMarquee = api.motionInspector({ type: "container", marquee: { speed: 20, reverse: false } });
    check("marquee speed preset shown + correct active when marquee is on", htmlMarquee.indexOf('is-active" data-doc-marquee-speed="20"') >= 0);
}

// ---- recipesInspector: container-gating ----
{
    const { api } = makeEnv({});
    const htmlContainer = api.recipesInspector({ type: "container" });
    ["pinned-hero", "horizontal-cards", "marquee-strip", "reveal-sequence", "layered-parallax"].forEach((k) => {
        check("container sees recipe: " + k, htmlContainer.indexOf('data-doc-recipe="' + k + '"') >= 0);
    });
    const htmlText = api.recipesInspector({ type: "text" });
    check("non-container only sees layered-parallax", htmlText.indexOf('data-doc-recipe="layered-parallax"') >= 0
        && htmlText.indexOf('data-doc-recipe="pinned-hero"') === -1
        && htmlText.indexOf('data-doc-recipe="reveal-sequence"') === -1);
}

// ---- applyRecipe: with cmdStore -> runCommands + refreshInspector ----
{
    const b = { id: "sec1", type: "container" };
    const env = makeEnv({ blocks: { sec1: b }, selectedId: "sec1", cmdStore: {} });
    env.api.applyRecipe("horizontal-cards");
    check("horizontal-cards: one runCommands batch", env.runCommandsCalls.length === 1);
    const items = env.runCommandsCalls[0].items;
    check("horizontal-cards: sets scene {horizontal,3} on the container", items.length === 1
        && items[0].payload.id === "sec1" && items[0].payload.prop === "scene"
        && items[0].payload.value.mode === "horizontal" && items[0].payload.value.length === 3);
    check("applyRecipe (cmdStore path) always re-renders canvas + inspector", env.refreshCalls() === 1 && env.renderCalls() === 1);
}

// ---- applyRecipe: reveal-sequence batches container + all children ----
{
    const children = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    const b = { id: "sec2", type: "container", children };
    const env = makeEnv({ blocks: { sec2: b }, selectedId: "sec2", cmdStore: {} });
    env.api.applyRecipe("reveal-sequence");
    const items = env.runCommandsCalls[0].items;
    check("reveal-sequence: 3 children x 3 props = 9 commands", items.length === 9);
    const delays = children.map((c, i) => items.find((it) => it.payload.id === c.id && it.payload.prop === "animDelay").payload.value);
    check("reveal-sequence: staggered delays 0/120/240", delays[0] === 0 && delays[1] === 120 && delays[2] === 240);
}

// ---- applyRecipe: layered-parallax appends 2 layers to existing ones ----
{
    const b = { id: "sec3", type: "text", layers: [{ id: "existing", kind: "shape" }] };
    const env = makeEnv({ blocks: { sec3: b }, selectedId: "sec3", cmdStore: {} });
    env.api.applyRecipe("layered-parallax");
    const items = env.runCommandsCalls[0].items;
    const layersItem = items.find((it) => it.payload.prop === "layers");
    const parallaxItem = items.find((it) => it.payload.prop === "parallax");
    check("layered-parallax: parallax set to 0.3", parallaxItem && parallaxItem.payload.value === 0.3);
    check("layered-parallax: keeps existing layer + adds 2 new", layersItem && layersItem.payload.value.length === 3
        && layersItem.payload.value[0].id === "existing");
}

// ---- applyRecipe: no cmdStore -> direct mutation + render + markDirty ----
{
    const b = { id: "sec4", type: "container" };
    const env = makeEnv({ blocks: { sec4: b }, selectedId: "sec4", cmdStore: null });
    env.api.applyRecipe("marquee-strip");
    check("no cmdStore: mutates block directly", b.marquee && b.marquee.speed === 30 && b.marquee.reverse === false);
    check("no cmdStore: mutates directly, then still re-renders + marks dirty", env.renderCalls() === 1 && env.markDirtyCalls() === 1 && env.refreshCalls() === 1);
}

// ---- applyRecipe: unknown key / no selection are safe no-ops ----
{
    const env = makeEnv({});
    env.api.applyRecipe("not-a-real-recipe");
    check("unknown recipe key is a no-op", env.runCommandsCalls.length === 0 && env.renderCalls() === 0);
}

if (failed) {
    console.error("\nEFFECTS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nEFFECTS-OK");
