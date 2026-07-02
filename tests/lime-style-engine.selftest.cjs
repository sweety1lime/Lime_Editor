"use strict";

// Самотест gesture-движка стилей. editor-v2 покрывает пути через UI (Stage 5 тесты),
// но не granular-инварианты транзакций — проверяем напрямую: склейку серии правок в один
// begin/commit, коммит при смене ключа жеста, no-op dispatch без snapshot-fallback,
// multi-select fan-out (блок + инстанс), reset-транзакцию, запись класса и legacy fallback.

const path = require("path");
const Engine = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-style-engine.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// --- стаб command-store: пишет журнал begin/dispatch/commit/cancel ---
function makeStore() {
    const log = [];
    return {
        log,
        rejectNext: false,
        begin(label) { log.push("begin:" + label); },
        dispatch(type, payload) {
            if (this.rejectNext) { this.rejectNext = false; log.push("reject:" + type); return false; }
            log.push("dispatch:" + type + ":" + (payload.prop || payload.field || payload.prop) + "=" + payload.value + (payload.remove ? ":rm" : ""));
            return true;
        },
        commit(label) { log.push("commit:" + label); },
        cancel() { log.push("cancel"); },
        getDoc() { return { fake: true }; }
    };
}

function makeEnv(opts) {
    opts = opts || {};
    const state = {
        store: opts.store === null ? null : (opts.store || makeStore()),
        doc: { components: {} },
        cmdPrev: null,
        selectedId: opts.selectedId || "b1",
        currentClass: opts.currentClass || null,
        currentState: opts.currentState || "normal",
        currentBp: opts.currentBp || "base",
        calls: []
    };
    const blocks = opts.blocks || { b1: { id: "b1", type: "text", styles: {} } };
    const classDefs = opts.classDefs || {};
    const engine = Engine.create({
        window: opts.window || {},
        getCmdStore: () => state.store,
        setDoc(v) { state.doc = v; },
        setCmdPrev(v) { state.cmdPrev = v; },
        getSelectedId: () => state.selectedId,
        getCurrentClass: () => state.currentClass,
        getCurrentState: () => state.currentState,
        getCurrentBp: () => state.currentBp,
        byId: id => blocks[id] || null,
        targetBlock: b => b,
        readStyles: b => (b && b.styles) || {},
        findClassDef: cls => classDefs[cls] || null,
        componentRecord: ref => ref === "comp" ? { id: "comp" } : null,
        setComponentStyleOverrideLocal(inst, bucket, prop, val, remove) { state.calls.push("ovrLocal:" + inst.id + ":" + prop + "=" + val + (remove ? ":rm" : "")); },
        beginCheckpointMutation() { state.calls.push("checkpoint"); },
        updateHistButtons() { state.calls.push("hist"); },
        scheduleAutosave() { state.calls.push("autosave"); },
        markDirty() { state.calls.push("dirty"); },
        refreshInspector() { state.calls.push("refresh"); },
        applyPreviewStyles() { state.calls.push("preview"); },
        commitInlineEdit() { state.calls.push("inlineCommit"); }
    });
    return { engine, state, blocks };
}

// --- жест: серия правок одного контрола = один begin, commit по commitStyleEdit ---
{
    const { engine, state } = makeEnv();
    engine.setStyle("color", "#111");
    engine.setStyle("color", "#222");
    engine.setStyle("color", "#333");
    const begins = state.store.log.filter(l => l === "begin:style-gesture").length;
    check("серия правок одного пропа = один begin", begins === 1);
    check("каждая правка диспатчится", state.store.log.filter(l => l.startsWith("dispatch:setStyle:color")).length === 3);
    engine.commitStyleEdit();
    check("commit закрывает жест и синкает doc/hist/autosave", state.store.log.includes("commit:style-gesture") && state.doc.fake === true && state.cmdPrev === JSON.stringify({ fake: true }) && state.calls.includes("hist") && state.calls.includes("autosave"));
    engine.commitStyleEdit();
    check("повторный commit без транзакции — no-op", state.store.log.filter(l => l === "commit:style-gesture").length === 1);
}

// --- смена ключа жеста (другой проп) коммитит предыдущий ---
{
    const { engine, state } = makeEnv();
    engine.setStyle("color", "#111");
    engine.setStyle("fontSize", "20px");
    const log = state.store.log;
    check("смена пропа коммитит предыдущий жест", log.indexOf("commit:style-gesture") > log.indexOf("dispatch:setStyle:color=#111") && log.indexOf("commit:style-gesture") < log.indexOf("dispatch:setStyle:fontSize=20px"));
    check("на новый проп открыт второй begin", log.filter(l => l === "begin:style-gesture").length === 2);
}

// --- no-op dispatch (store отклонил): cancel, но НЕ fallback в прямую мутацию ---
{
    const { engine, state, blocks } = makeEnv();
    state.store.rejectNext = true;
    engine.setStyle("color", "#111");
    check("отклонённый dispatch отменяет транзакцию", state.store.log.includes("cancel"));
    check("no-op не мутирует блок напрямую (нет snapshot fallback)", !blocks.b1.styles.base);
    check("превью всё равно обновлено", state.calls.includes("preview"));
}

// --- multi-select fan-out: обычный блок + инстанс компонента одной транзакцией ---
{
    const blocks = {
        b1: { id: "b1", type: "text", styles: {} },
        b2: { id: "b2", type: "component", ref: "comp", styles: {} }
    };
    const win = { __LIME_SELECTION__: { get: () => ({ ids: ["b1", "b2"] }) } };
    const { engine, state } = makeEnv({ blocks, window: win });
    engine.setStyle("color", "#abc");
    const log = state.store.log;
    check("multi: одна транзакция на оба узла", log.filter(l => l === "begin:style-gesture").length === 1);
    check("multi: блок через setStyle, инстанс через override", log.some(l => l.startsWith("dispatch:setStyle:color")) && log.some(l => l.startsWith("dispatch:setComponentStyleOverride:color")));
}

// --- resetStyleProps: одна style-reset транзакция + remove на каждый проп ---
{
    const { engine, state } = makeEnv({ currentBp: "mobile" });
    engine.resetStyleProps(["color", "fontSize"]);
    const log = state.store.log;
    check("reset: begin/commit style-reset", log.includes("begin:style-reset") && log.includes("commit:style-reset"));
    check("reset: remove-dispatch на каждый проп", log.filter(l => l.includes(":rm")).length === 2);
    check("reset: инспектор перерисован", state.calls.includes("refresh"));
}

// --- правка класса: checkpoint-мутация определения, без command-store ---
{
    const classDefs = { hero: { name: "hero", styles: {} } };
    const { engine, state } = makeEnv({ currentClass: "hero", classDefs });
    engine.setStyle("color", "#f00");
    check("класс: пишется в определение класса", classDefs.hero.styles.base && classDefs.hero.styles.base.color === "#f00");
    check("класс: через checkpoint, не через store", state.calls.includes("checkpoint") && !state.store.log.length);
    engine.setStyle("color", "");
    check("класс: пустое значение чистит проп и бакет", !classDefs.hero.styles.base);
}

// --- legacy fallback без cmdStore: прямая мутация блока + markDirty ---
{
    const { engine, state, blocks } = makeEnv({ store: null });
    engine.setStyle("color", "#0f0");
    check("fallback: стиль записан в блок", blocks.b1.styles.base.color === "#0f0");
    check("fallback: markDirty вызван", state.calls.includes("dirty"));
}

// --- block/content-жесты: begin block-gesture, смена цели коммитит ---
{
    const { engine, state, blocks } = makeEnv();
    engine.commandBlockGesture(blocks.b1, "anim", "fade", false);
    engine.commandBlockGesture(blocks.b1, "anim", "zoom", false);
    check("block-жест: один begin на серию", state.store.log.filter(l => l === "begin:block-gesture").length === 1);
    engine.commandContentGesture(blocks.b1, "text", "hi", false);
    check("content-жест коммитит предыдущий block-жест", state.store.log.includes("commit:block-gesture") && state.store.log.includes("begin:content-gesture"));
    engine.commitBlockEdit();
    check("commitBlockEdit закрывает жест", state.store.log.filter(l => l.startsWith("commit:")).length === 2);
}

// --- v2SelectionIds: приоритет V2-стора, fallback на selectedId ---
{
    const win = { __LIME_SELECTION__: { get: () => ({ ids: ["x", "y"] }) } };
    const { engine } = makeEnv({ window: win });
    check("v2SelectionIds: из V2-стора", engine.v2SelectionIds().join(",") === "x,y");
    const { engine: e2 } = makeEnv();
    check("v2SelectionIds: fallback на selectedId", e2.v2SelectionIds().join(",") === "b1");
}

// --- multiStyleModel: common / mixed / unset ---
{
    const blocks = {
        a: { id: "a", styles: { base: { color: "#111", margin: "8px" } } },
        b: { id: "b", styles: { base: { color: "#111", padding: "4px" } } }
    };
    const { engine } = makeEnv({ blocks });
    const m = engine.multiStyleModel(["a", "b"], "base");
    check("multiStyleModel: общее значение — common", m.values.color === "#111");
    check("multiStyleModel: расходящиеся — mixed", m.mixed.margin === true && m.mixed.padding === true && !("margin" in m.values));
}

if (failed) { console.error("\n" + failed + " FAILED"); process.exit(1); }
console.log("\nвсе проверки пройдены");
