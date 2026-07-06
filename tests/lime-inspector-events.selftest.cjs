"use strict";

// Самотест inspector-events. e2e бьёт по обработчикам через реальный UI (scrub/override/вкладки),
// здесь — маршрутизация напрямую: input → setStyle с юнитом + сброс mixed, CMS-поля → setContentFlag,
// click-диспетчер (reset стилей, вкладки, hover-state, data-doc-op тулбара, bg-preset через
// command-store), change (юниты стиля, component prop), скраб: pointerdown→move→up = один change.

const path = require("path");
const Events = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-inspector-events.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// Мини-DOM: узел с атрибутами; closest ищет по предкам, совпадение — по предикату из карты attrs.
function node(attrs, parent, tag) {
    const n = {
        tagName: tag || "DIV", dataset: {}, parent: parent || null, cls: new Set(),
        attrs: attrs || {},
        value: "", type: "",
        classList: {
            add: c => n.cls.add(c), remove: c => n.cls.delete(c),
            toggle: (c, on) => { if (on) n.cls.add(c); else n.cls.delete(c); }
        },
        hasAttribute: a => a in n.attrs,
        getAttribute: a => (a in n.attrs ? n.attrs[a] : null),
        removeAttribute: a => { delete n.attrs[a]; },
        closest(sel) {
            const attr = sel.replace(/[\[\]]/g, "");
            let cur = n;
            while (cur) { if (cur.hasAttribute && cur.hasAttribute(attr)) return cur; cur = cur.parent; }
            return null;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        parentNode: { querySelector: () => null },
        setPointerCapture() {}, releasePointerCapture() {},
        dispatchEvent(ev) { n.dispatched = (n.dispatched || []).concat(ev.type); handlers[ev.type] && handlers[ev.type]({ target: n }); }
    };
    // dataset из data-* атрибутов (camelCase).
    Object.keys(n.attrs).forEach(a => {
        if (a.startsWith("data-")) {
            const key = a.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
            n.dataset[key] = n.attrs[a];
        }
    });
    return n;
}

let handlers = {};
function makeEnv(opts) {
    opts = opts || {};
    handlers = {};
    const calls = [];
    const rec = name => (...args) => { calls.push(name + ":" + args.map(a => (typeof a === "object" && a !== null) ? (a.id || JSON.stringify(a)) : String(a)).join(",")); return opts.returns && name in opts.returns ? opts.returns[name] : undefined; };
    const inspectorEl = {
        addEventListener(type, fn) { handlers[type] = fn; },
        querySelectorAll: () => []
    };
    const state = { currentState: "normal", tab: "style" };
    const blocks = opts.blocks || { b1: { id: "b1", type: "text" } };
    const api = Events.create({
        window: { confirm: () => true, LimeAssets: { BG_PRESETS: [{ css: "linear-gradient(red,blue)" }] } },
        inspectorEl,
        L: { isContainer: () => false, resolvedDesign: () => ({ layout: {} }) },
        getSelectedId: () => opts.selectedId || "b1",
        getCurrentBp: () => "base",
        getCurrentClass: () => opts.currentClass || null,
        setCurrentState: v => { state.currentState = v; calls.push("state:" + v); },
        getCurrentInspectorTab: () => state.tab,
        setCurrentInspectorTab: v => { state.tab = v; calls.push("tab:" + v); },
        getCmdStore: () => opts.cmdStore || null,
        byId: id => blocks[id] || null,
        findBlock: id => (blocks[id] ? { block: blocks[id] } : null),
        targetBlock: b => b,
        setStyle: rec("setStyle"),
        resetStyleProps: rec("resetStyleProps"),
        setContentValue: rec("setContentValue"),
        setContentFlag: rec("setContentFlag"),
        runCommands: (items, label) => { calls.push("runCommands:" + label + ":" + items.length); return true; },
        applyPreviewStyles: rec("preview"),
        refreshInspector: rec("refresh"),
        scheduleAutosave: rec("autosave"),
        ensureDocFonts: rec("fonts"),
        previewDesignInput: rec("previewDesign"),
        previewChildDesignInput: rec("previewChild"),
        clearScrubPreview: rec("clearScrub"),
        applyV2UnitChange: () => false,
        applyV2ChildDesignInput: () => false,
        applyV2DesignInput: () => false,
        resetV2DesignField: rec("resetV2"),
        switchV2LayoutMode: rec("switchMode"),
        setV2LayoutDirection: rec("dir"),
        setV2LayoutWrap: rec("wrap"),
        setV2GridAuto: rec("gridAuto"),
        setV2GridFill: rec("gridFill"),
        setV2Overflow: rec("overflow"),
        applyClassToBlock: rec("classAdd"),
        editClass: rec("classEdit"),
        removeClassFromBlock: rec("classRemove"),
        createClassFromBlock: rec("classNew"),
        exitClassEdit: rec("classDone"),
        deleteClass: rec("classDelete"),
        renameClass: rec("classRename"),
        setAnim: rec("setAnim"),
        toggleFx: rec("toggleFx"),
        setSticky: rec("setSticky"),
        setMarquee: rec("setMarquee"),
        setSceneMode: rec("setSceneMode"),
        setSceneLength: rec("setSceneLength"),
        setMotionParallax: rec("parallax"),
        addLayer: rec("addLayer"),
        delLayer: rec("delLayer"),
        pickLayerImage: rec("pickLayer"),
        setLayerShape: rec("layerShape"),
        setLayerRng: rec("layerRng"),
        composeShadow: rec("composeShadow"),
        addShadow: rec("addShadow"),
        delShadow: rec("delShadow"),
        composeGradient: rec("composeGradient"),
        liveOverlay: rec("liveOverlay"),
        switchBgMode: rec("switchBgMode"),
        promptBgVideo: rec("bgVideo"),
        setBg: rec("setBg"),
        openMediaPicker: rec("mediaPicker"),
        moveBlock: rec("moveBlock"),
        unwrapBlock: rec("unwrap"),
        dupBlock: rec("dup"),
        delBlock: rec("del"),
        groupSelection: rec("group"),
        ungroupBlock: rec("ungroup"),
        makeComponent: rec("makeComp"),
        detachComponent: rec("detach"),
        resetComponentOverrides: rec("resetOverrides"),
        setComponentVariant: rec("variant"),
        addComponentVariantFromInstance: rec("variantAdd"),
        aiRewrite: rec("aiRewrite"),
        aiSuggestAssetPrompt: rec("aiAssetPrompt")
    });
    api.bind();
    return { calls, state, blocks };
}

// --- input: data-doc-style → setStyle со значением+юнитом; mixed сброшен; fontFamily → fonts ---
{
    const { calls } = makeEnv();
    const t = node({ "data-doc-style": "", "data-mixed": "" });
    t.dataset.docStyle = "fontFamily"; t.dataset.unit = ""; t.value = "'Inter'";
    handlers.input({ target: t });
    check("input style: setStyle(prop, value+unit)", calls.includes("setStyle:fontFamily,'Inter'"));
    check("input style: mixed-атрибут сброшен", !t.hasAttribute("data-mixed"));
    check("input fontFamily: шрифт подгружен", calls.includes("fonts:"));
}

// --- input: CMS-поля → setContentFlag; collection дополнительно перерисовывает инспектор ---
{
    const { calls } = makeEnv();
    const t = node({ "data-doc-collection": "" }); t.value = "posts";
    handlers.input({ target: t });
    check("input collection: setContentFlag + refresh", calls.includes("setContentFlag:collection,posts") && calls.includes("refresh:"));
    const t2 = node({ "data-doc-cl-limit": "" }); t2.value = "24";
    handlers.input({ target: t2 });
    check("input cl-limit: число парсится", calls.includes("setContentFlag:limit,24"));
}

// --- click: reset стилей / вкладка / hover-состояние ---
{
    const { calls, state } = makeEnv();
    handlers.click({ target: node({ "data-doc-style-reset": "color,margin" }) });
    check("click style-reset: props разбиты", calls.includes('resetStyleProps:["color","margin"]'));
    handlers.click({ target: node({ "data-doc-insp-tab": "motion" }) });
    check("click вкладки: setCurrentInspectorTab", state.tab === "motion");
    handlers.click({ target: node({ "data-doc-state": "hover" }) });
    check("click hover: state + refresh + preview", state.currentState === "hover" && calls.includes("refresh:") && calls.includes("preview:"));
}

// --- click: data-doc-op тулбара ---
{
    const { calls } = makeEnv();
    const mk = op => { const n = node({ "data-doc-op": op }); n.dataset.docOp = op; return n; };
    handlers.click({ target: mk("up") });
    handlers.click({ target: mk("dup") });
    handlers.click({ target: mk("del") });
    handlers.click({ target: mk("ai") });
    check("op up → moveBlock(-1)", calls.includes("moveBlock:-1"));
    check("op dup/del/ai маршрутизированы", calls.includes("dup:") && calls.includes("del:") && calls.includes("aiRewrite:"));
}

// --- click: data-doc-ai-asset-prompt (Milestone 5, Фаза C) → aiSuggestAssetPrompt(el) ---
{
    const { calls } = makeEnv();
    const btn = node({ "data-doc-ai-asset-prompt": "" });
    handlers.click({ target: btn });
    check("asset-prompt click маршрутизирован в aiSuggestAssetPrompt", calls.some(c => c.indexOf("aiAssetPrompt:") === 0));
}

// --- click: bg-preset через command-store = runCommands + autosave ---
{
    const { calls } = makeEnv({ cmdStore: {} });
    const n = node({ "data-doc-bg-preset": "0" }); n.dataset.docBgPreset = "0";
    handlers.click({ target: n });
    check("bg-preset: одна транзакция из 2 команд + autosave + refresh", calls.includes("runCommands:background-preset:2") && calls.includes("autosave:") && calls.includes("refresh:"));
}

// --- change: component prop → setContentValue + refresh ---
{
    const { calls, blocks } = makeEnv();
    const t = node({ "data-doc-prop": "title" }); t.value = "Hi";
    handlers.change({ target: t });
    check("change prop: setContentValue(block, prop, value)", calls.includes("setContentValue:b1,title,Hi,false"));
}

// --- скраб: pointerdown → move (шаг ×3px) → up диспатчит один change ---
{
    const { calls } = makeEnv();
    const input = node({ "data-v2-design-field": "" }, null, "INPUT");
    input.type = "number"; input.value = "10"; input.step = "1"; input.min = "";
    const field = node({});
    field.attrs["class"] = "lime-v2-field";
    // closest(".lime-v2-field") ищет класс — подменяем на прямое поле.
    const label = node({ "data-scrub": "" }, field);
    label.closest = sel => (sel === "[data-scrub]" ? label : (sel === ".lime-v2-field" ? field : null));
    field.querySelector = sel => (sel === 'input[type="number"]' ? input : null);
    handlers.pointerdown({ target: { closest: s => (s === "[data-scrub]" ? label : null) }, pointerId: 1, clientX: 100, preventDefault() {} });
    handlers.pointermove({ pointerId: 1, clientX: 130, shiftKey: false, altKey: false });
    check("скраб: значение выросло на delta (30px/3=10)", input.value === "20");
    check("скраб: live-превью design-поля", calls.includes("previewDesign:[object Object]") || calls.some(c => c.startsWith("previewDesign")));
    handlers.pointerup({ pointerId: 1 });
    check("скраб: на отпускании один change + очистка превью", (input.dispatched || []).length === 1 && calls.some(c => c.startsWith("clearScrub")));
}

if (failed) { console.error("\n" + failed + " FAILED"); process.exit(1); }
console.log("\nвсе проверки пройдены");
