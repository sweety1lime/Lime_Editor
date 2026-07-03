"use strict";

// Самотест DnD-модуля. Playwright дёргает DnD только реальным drag'ом — инварианты модели
// проверяем напрямую: reorder в одном списке, move между списками, защита от вложения
// контейнера в собственное поддерево, legacy splice-fallback, design-блок → полный finishMutation,
// идемпотентность initDnD (destroy выпавших, не трогаем живые).

const path = require("path");
const Dnd = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-dnd.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// Мини-DOM: узел списка с classList/closest. parentBlockEl задаёт ".lime-block"-предка.
function listEl(kind, parentBlockEl) {
    return {
        classList: { contains: c => kind === "page" && c === "lime-doc-page" },
        closest: sel => (sel === ".lime-block" ? parentBlockEl || null : null)
    };
}
function blockEl(id) { return { getAttribute: () => id }; }

function makeEnv(opts) {
    opts = opts || {};
    const page = opts.page || [];
    const blocks = opts.blocks || {};
    const state = { selectedId: null, calls: [], commands: [] };
    const engine = Dnd.create({
        window: opts.window || {},
        ws: opts.ws,
        pageBlocks: () => page,
        byId: id => blocks[id] || null,
        targetBlock: b => b,
        runCommand(type, payload) { state.commands.push(type + ":" + payload.id + "→" + payload.toIndex); return !!opts.cmdOk; },
        finishMutation(applied) { state.calls.push("finish:" + applied); },
        getActive: () => 0,
        setSelectedId(v) { state.selectedId = v; },
        render() { state.calls.push("render"); },
        applyPreviewStyles() { state.calls.push("preview"); },
        refreshInspector() { state.calls.push("inspector"); },
        isCanvasOn: () => false,
        refreshV2SelectionOverlay() { state.calls.push("overlay"); },
        scheduleLayersRefresh() { state.calls.push("layers"); },
        scheduleAutosave() { state.calls.push("autosave"); },
        markDirty() { state.calls.push("dirty"); },
        perfNow: () => 0,
        perfRec() {}
    });
    return { engine, state, page, blocks };
}

// --- reorder в одном списке (legacy fallback: splice) ---
{
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    const { engine, state, page } = makeEnv({ page: [a, b, c] });
    const pl = listEl("page");
    engine.onDragEnd({ from: pl, to: pl, oldIndex: 0, newIndex: 2 });
    check("reorder fallback: порядок массива обновлён", page.map(x => x.id).join(",") === "b,c,a");
    check("reorder: выбор — перемещённый блок, dirty", state.selectedId === "a" && state.calls.includes("dirty"));
    check("reorder: команда reorderBlock предложена store", state.commands[0] === "reorderBlock:a→2");
}

// --- команда принята store: модель НЕ мутируется вручную, autosave ---
{
    const a = { id: "a" }, b = { id: "b" };
    const { engine, state, page } = makeEnv({ page: [a, b], cmdOk: true });
    const pl = listEl("page");
    engine.onDragEnd({ from: pl, to: pl, oldIndex: 0, newIndex: 1 });
    check("command-путь: массив не тронут (store сам применил)", page.map(x => x.id).join(",") === "a,b");
    check("command-путь: autosave вместо dirty", state.calls.includes("autosave") && !state.calls.includes("dirty"));
}

// --- move между списками: в children контейнера ---
{
    const cont = { id: "cont", children: [] };
    const a = { id: "a" };
    const { engine, state, page } = makeEnv({ page: [a, cont], blocks: { cont } });
    const pl = listEl("page");
    const kids = listEl("children", blockEl("cont"));
    engine.onDragEnd({ from: pl, to: kids, oldIndex: 0, newIndex: 0 });
    check("move fallback: блок ушёл из page в children", page.length === 1 && cont.children[0] === a);
    check("move: команда moveBlock с parentId", state.commands[0].startsWith("moveBlock:a"));
}

// --- защита от цикла: контейнер нельзя бросить в собственное поддерево ---
{
    const inner = { id: "inner", children: [] };
    const outer = { id: "outer", children: [{ id: "mid", children: [inner] }] };
    const { engine, state, page } = makeEnv({ page: [outer], blocks: { inner } });
    check("subtreeOwnsArray видит вложенный массив", engine.subtreeOwnsArray(outer, inner.children) === true);
    const pl = listEl("page");
    const innerList = listEl("children", blockEl("inner"));
    engine.onDragEnd({ from: pl, to: innerList, oldIndex: 0, newIndex: 0 });
    check("цикл отклонён: модель не тронута + render-откат", page[0] === outer && inner.children.length === 0 && state.calls.includes("render"));
}

// --- design-блок: полный finishMutation вместо точечного UI-обновления ---
{
    const d = { id: "d", design: { base: {} } }, b = { id: "b" };
    const { engine, state } = makeEnv({ page: [d, b] });
    const pl = listEl("page");
    engine.onDragEnd({ from: pl, to: pl, oldIndex: 0, newIndex: 1 });
    check("design-блок → finishMutation, без точечного preview", state.calls.includes("finish:false") && !state.calls.includes("preview"));
}

// --- no-op drag (та же позиция) — ничего не делаем ---
{
    const a = { id: "a" };
    const { engine, state } = makeEnv({ page: [a] });
    const pl = listEl("page");
    engine.onDragEnd({ from: pl, to: pl, oldIndex: 0, newIndex: 0 });
    check("no-op drag: ни команд, ни рендера", state.commands.length === 0 && state.calls.length === 0);
}

// --- initDnD: идемпотентность (create для новых, destroy для выпавших, живые не трогаем) ---
{
    const created = [], destroyed = [];
    function fakeList(inWs) { return { __inWs: inWs, querySelector: () => null, querySelectorAll: () => [] }; }
    const pageList = { __inWs: true };
    const ws = {
        contains: el => !!el.__inWs,
        querySelector: sel => (sel === ".lime-doc-page" ? pageList : null),
        querySelectorAll: () => []
    };
    function Sortable(el) {
        this.el = el;
        created.push(el);
        this.destroy = () => destroyed.push(el);
    }
    const { engine } = makeEnv({ ws, window: { Sortable } });
    engine.initDnD();
    check("initDnD: Sortable создан для страницы", created.length === 1 && pageList.__limeDnd);
    engine.initDnD();
    check("initDnD идемпотентен: повторный вызов не создаёт дубль", created.length === 1 && destroyed.length === 0);
    pageList.__inWs = false; // список выпал из DOM (полный render)
    const detached = created[0];
    ws.querySelector = () => null;
    engine.initDnD();
    check("initDnD: выпавший список destroy + снята метка", destroyed[0] === detached.el || destroyed.length === 1);
}

if (failed) { console.error("\n" + failed + " FAILED"); process.exit(1); }
console.log("\nвсе проверки пройдены");
