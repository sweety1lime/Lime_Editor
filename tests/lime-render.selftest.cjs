"use strict";

// Самотест render-пайплайна. Full render / инкрементальные пути Stage 7 проверяются e2e через UI,
// здесь — safe-gates и обвязка, которые e2e не изолирует: fallback на полный render (нет узла,
// дочерние drop-зоны, design-блок, компонент-родитель, пустая страница), finish* → autosave/dirty,
// batch rAF у scheduleLayersRefresh, инлайн hover-превью только у выбранного блока.

const path = require("path");
const Render = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-render.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// Мини-DOM: элемент с атрибутами/детьми, достаточный для селекторов модуля.
function el(tag) {
    return {
        tag, children: [], attrs: {}, cls: {}, innerHTML: "", textContent: "",
        firstElementChild: null,
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
        classList: { add: c => {}, },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        appendChild(c) { this.children.push(c); },
        replaceWith() {},
        remove() {}
    };
}

function makeEnv(opts) {
    opts = opts || {};
    const state = { calls: [], rafQueue: [] };
    const ws = opts.ws || el("ws");
    const doc = opts.doc || { pages: [{ title: "Главная", blocks: [] }], components: {}, theme: {} };
    const blocks = opts.blocks || {};
    const api = Render.create({
        window: {
            requestAnimationFrame: fn => state.rafQueue.push(fn),
            LimeFonts: { ensureFromStack(st) { state.calls.push("font:" + st); } }
        },
        document: { createElement: () => el("div") },
        ws,
        L: opts.L || {
            render: () => ({ body: "<rendered>" }),
            renderOneBlock: () => "<block>"
        },
        escapeText: s => String(s == null ? "" : s),
        getDoc: () => doc,
        getActive: () => 0,
        pageBlocks: () => doc.pages[0].blocks,
        byId: id => blocks[id] || null,
        findBlock: id => (blocks[id] ? { block: blocks[id] } : null),
        getSelectedId: () => opts.selectedId || null,
        getCurrentBp: () => "base",
        getCurrentState: () => opts.currentState || "normal",
        getCurrentClass: () => null,
        readStyles: b => (b && b.styles) || {},
        effectiveClassStyles: () => ({}),
        effective: (st, bp) => (st && st[bp]) || {},
        declsToCss: d => Object.keys(d).map(k => k + ":" + d[k]).join(";"),
        findClassDef: () => null,
        isCanvasOn: () => false,
        refreshInspector() { state.calls.push("inspector"); },
        refreshLayers() { state.calls.push("layers"); },
        initDnD() { state.calls.push("dnd"); },
        initLayerDrag() { state.calls.push("layerDrag"); },
        refreshV2SelectionOverlay() { state.calls.push("overlay"); },
        editorCollectionData: () => null,
        templateSampleRecord: () => null,
        scheduleAutosave() { state.calls.push("autosave"); },
        markDirty() { state.calls.push("dirty"); },
        perfNow: () => 0,
        perfRec(kind) { state.calls.push("perf:" + kind); }
    });
    return { api, state, ws, doc, blocks };
}

// --- render: пустая страница → placeholder, иначе L.render ---
{
    const { api, ws, state } = makeEnv();
    api.render();
    check("render пустой страницы — placeholder с названием", ws.innerHTML.includes("data-doc-empty") && ws.innerHTML.includes("Главная"));
    check("render дёргает весь вспомогательный UI", ["inspector", "layers", "dnd", "layerDrag", "overlay"].every(c => state.calls.includes(c)));
    check("render учтён как full в perf", state.calls.includes("perf:full"));
    const env2 = makeEnv({ doc: { pages: [{ title: "x", blocks: [{ id: "a" }] }], components: {}, theme: {} } });
    env2.api.render();
    check("render непустой страницы — тело движка", env2.ws.innerHTML === "<rendered>");
}

// --- patchBlockDom: нет узла/блока → полный render (false) ---
{
    const { api, state } = makeEnv();
    const ok = api.patchBlockDom("missing");
    check("patch без узла → false + полный render", ok === false && state.calls.includes("perf:full"));
}

// --- insertBlockDom: компонент-родитель и design-блок → false (полный путь) ---
{
    const comp = { id: "c1", type: "component" };
    const { api } = makeEnv({ blocks: { c1: comp } });
    check("insert в компонент-инстанс → false", api.insertBlockDom({ id: "n" }, "c1", 0) === false);
    const { api: api2, ws } = makeEnv();
    ws.querySelector = sel => (sel === ".lime-doc-page" ? el("page") : null);
    check("insert design-блока → false (CSS в общем style)", api2.insertBlockDom({ id: "n", design: {} }, null, 0) === false);
}

// --- removeBlockDom: пустая страница → false (нужен placeholder) ---
{
    const { api } = makeEnv();
    check("remove на опустевшей странице → false", api.removeBlockDom("a") === false);
}

// --- finishInsert/finishRemove: fallback на render + autosave/dirty по commandApplied ---
{
    const { api, state } = makeEnv();
    api.finishInsert({ id: "n" }, "nope", 0, true);
    check("finishInsert: insert не удался → render, autosave по команде", state.calls.includes("perf:full") && state.calls.includes("autosave"));
    const { api: api2, state: state2 } = makeEnv();
    api2.finishRemove("ghost", false);
    check("finishRemove: без команды → markDirty", state2.calls.includes("dirty"));
}

// --- scheduleLayersRefresh: пачка правок = один rAF/refreshLayers ---
{
    const { api, state } = makeEnv();
    api.scheduleLayersRefresh();
    api.scheduleLayersRefresh();
    api.scheduleLayersRefresh();
    check("батч: один rAF на серию", state.rafQueue.length === 1);
    state.rafQueue[0]();
    check("после rAF — один refreshLayers", state.calls.filter(c => c === "layers").length === 1);
    api.scheduleLayersRefresh();
    check("после сброса флага можно снова", state.rafQueue.length === 2);
}

// --- applyPreviewStyles/styleBlockEl: hover-превью только у выбранного ---
{
    const b1 = el("div"); b1.attrs["data-block-id"] = "sel";
    const b2 = el("div"); b2.attrs["data-block-id"] = "other";
    const blocks = {
        sel: { id: "sel", styles: { base: { color: "red" }, hover: { color: "blue" } } },
        other: { id: "other", styles: { base: { color: "red" }, hover: { color: "blue" } } }
    };
    const ws = el("ws");
    ws.querySelectorAll = sel => (sel === ".lime-block" ? [b1, b2] : []);
    const { api } = makeEnv({ ws, blocks, selectedId: "sel", currentState: "hover" });
    api.applyPreviewStyles();
    check("hover-превью у выбранного блока", b1.attrs.style === "color:blue");
    check("у остальных — обычный стиль", b2.attrs.style === "color:red");
}

// --- ensureDocFonts: тема + fontFamily из стилей, без дублей ---
{
    const doc = {
        pages: [{ title: "x", blocks: [{ id: "a", styles: { base: { fontFamily: "'Inter', sans-serif" } } }] }],
        components: {}, theme: { font: "'Unbounded', system-ui" }
    };
    const { api, state } = makeEnv({ doc });
    api.ensureDocFonts();
    const fonts = state.calls.filter(c => c.startsWith("font:"));
    check("ensureDocFonts: тема + fontFamily из документа", fonts.length === 2 && fonts.some(f => f.includes("Unbounded")) && fonts.some(f => f.includes("Inter")));
}

if (failed) { console.error("\n" + failed + " FAILED"); process.exit(1); }
console.log("\nвсе проверки пройдены");
