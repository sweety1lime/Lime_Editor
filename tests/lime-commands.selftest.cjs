/*
 * Node self-test движка команд lime-commands.js (этап D2, on-ramp Editor V2).
 * Запуск: node tests/lime-commands.selftest.cjs
 * Проверяет: команды → обратные патчи, undo/redo симметрию, транзакции/cancel, очистку redo,
 * вложенность children и инвариант «документ остаётся валидным для lime-doc.js».
 */
"use strict";

const path = require("path");
const C = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-commands.js"));
const L = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function freshDoc() {
    return {
        version: 1,
        theme: { classes: [] },
        components: {},
        pages: [{
            id: "p0", slug: "", title: "Главная", blocks: [
                { id: "b1", type: "heading", content: { text: "Один" } },
                { id: "b2", type: "text", content: { text: "Два" } },
                {
                    id: "box", type: "container", content: {}, children: [
                        { id: "k1", type: "text", content: { text: "Вложенный" } }
                    ]
                }
            ]
        }]
    };
}
const blocks = (s) => s.getDoc().pages[0].blocks;

// --- node metadata: lock/hide/rename/z-order валидируются отдельными командами ---
{
    const s = C.createStore(freshDoc());
    check("node lock: boolean-only", s.dispatch("setNodeLocked", { id: "b1", value: "yes" }) === false);
    s.dispatch("setNodeLocked", { id: "b1", value: true });
    check("node lock: флаг установлен", blocks(s)[0].locked === true);
    check("node lock: повтор — no-op", s.dispatch("setNodeLocked", { id: "b1", value: true }) === false);
    s.undo();
    check("node lock: undo удалил additive-флаг", !("locked" in blocks(s)[0]));

    s.dispatch("setNodeHidden", { id: "b2", value: true });
    check("node hidden: флаг установлен", blocks(s)[1].hidden === true);
    s.dispatch("setNodeHidden", { id: "b2", value: false });
    check("node hidden: false нормализуется удалением", !("hidden" in blocks(s)[1]));

    s.dispatch("renameNode", { id: "b1", name: "  Hero title  " });
    check("node rename: trim + сохранение", blocks(s)[0].name === "Hero title");
    check("node rename: слишком длинное имя запрещено", s.dispatch("renameNode", { id: "b1", name: "x".repeat(121) }) === false);
    s.dispatch("renameNode", { id: "b1", name: "" });
    check("node rename: пустое имя возвращает type-label", !("name" in blocks(s)[0]));

    s.dispatch("setNodeZIndex", { id: "b1", breakpoint: "mobile", value: 3 });
    check("node z-order: breakpoint zIndex записан", blocks(s)[0].design.mobile.zIndex === 3);
    check("node z-order: дробное значение запрещено", s.dispatch("setNodeZIndex", { id: "b1", value: 1.5 }) === false);
    s.undo();
    check("node z-order: undo чистит design-ветку", !blocks(s)[0].design);
}

// --- setContent: правка + undo/redo round-trip, создание content при отсутствии ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setContent", { id: "b1", field: "text", value: "Изменён" });
    check("setContent: значение применено", blocks(s)[0].content.text === "Изменён");
    check("setContent: одна запись undo", s.depth().undo === 1);
    s.undo();
    check("setContent: undo вернул старое", blocks(s)[0].content.text === "Один");
    s.redo();
    check("setContent: redo вернул новое", blocks(s)[0].content.text === "Изменён");

    // блок без content — content создаётся, undo полностью убирает
    s.dispatch("setContent", { id: "box", field: "title", value: "T" });
    check("setContent: content создан на блоке без него", blocks(s)[2].content.title === "T");
    s.undo();
    check("setContent: undo убрал созданное поле (title)", !("title" in blocks(s)[2].content));

    s.dispatch("setContent", { id: "b1", field: "plans.0.name", value: "Старт" });
    check("setContent: dotted path создаёт массив/объект", blocks(s)[0].content.plans[0].name === "Старт");
    s.undo();
    check("setContent: undo dotted path убирает созданную ветку", !("plans" in blocks(s)[0].content));

    s.dispatch("setContent", { id: "b1", field: "bg.videoSrc", value: "video.mp4" });
    s.dispatch("setContent", { id: "b1", field: "bg.videoSrc", remove: true });
    check("setContent: remove dotted path чистит только пустую ветку", blocks(s)[0].content.text === "Изменён" && !("bg" in blocks(s)[0].content));
    s.undo();
    check("setContent: undo remove восстанавливает ветку", blocks(s)[0].content.bg.videoSrc === "video.mp4");
}

// --- setStyle: вложенный путь styles[bp][prop] + undo ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setStyle", { id: "b1", breakpoint: "mobile", prop: "fontSize", value: "20px" });
    check("setStyle: вложенный бакет создан и заполнен", blocks(s)[0].styles.mobile.fontSize === "20px");
    s.undo();
    check("setStyle: undo убрал стиль (бакет styles удалён)", !blocks(s)[0].styles);

    s.dispatch("setStyle", { id: "b1", breakpoint: "base", prop: "color", value: "red" });
    s.dispatch("setStyle", { id: "b1", breakpoint: "base", prop: "color", remove: true });
    check("setStyle: remove чистит пустые bucket/styles", !blocks(s)[0].styles);
    s.undo();
    check("setStyle: undo remove возвращает стиль", blocks(s)[0].styles.base.color === "red");
}

// --- setBlockProp: ограниченные top-level motion/fx поля ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setBlockProp", { id: "b1", prop: "sticky", value: true });
    check("setBlockProp: top-level значение применено", blocks(s)[0].sticky === true);
    s.undo();
    check("setBlockProp: undo убрал созданное поле", !("sticky" in blocks(s)[0]));
    s.redo();
    s.dispatch("setBlockProp", { id: "b1", prop: "sticky", remove: true });
    check("setBlockProp: remove удаляет поле", !("sticky" in blocks(s)[0]));
    s.undo();
    check("setBlockProp: undo remove возвращает поле", blocks(s)[0].sticky === true);
    check("setBlockProp: произвольное поле запрещено", s.dispatch("setBlockProp", { id: "b1", prop: "unknown", value: 1 }) === false);
}

// --- setDesign: v2 breakpoint bucket одной обратимой командой ---
{
    const s = C.createStore(freshDoc());
    const frame = { x: 12, y: 24, width: 320, height: 180, rotation: 0 };
    s.dispatch("setDesign", { id: "b1", breakpoint: "mobile", field: "frame", value: frame });
    check("setDesign: создаёт design/breakpoint/frame", blocks(s)[0].design.mobile.frame.width === 320);
    check("setDesign: одна запись undo", s.depth().undo === 1);
    s.undo();
    check("setDesign: undo чистит созданную ветку", !blocks(s)[0].design);
    s.redo();
    check("setDesign: redo возвращает frame", blocks(s)[0].design.mobile.frame.x === 12);
    s.dispatch("setDesign", { id: "b1", breakpoint: "mobile", field: "frame", remove: true });
    check("setDesign: remove чистит пустые buckets", !blocks(s)[0].design);
    check("setDesign: неизвестное поле запрещено", s.dispatch("setDesign", { id: "b1", field: "anything", value: {} }) === false);
}

{
    const s = C.createStore(freshDoc());
    s.begin("grid-placement");
    s.dispatch("setDesign", { id: "b1", breakpoint: "base", field: "span", value: 2 });
    s.dispatch("setDesign", { id: "b1", breakpoint: "base", field: "rowSpan", value: 3 });
    s.dispatch("setDesign", { id: "b1", breakpoint: "base", field: "order", value: 4 });
    s.commit("grid-placement");
    check("setDesign placement: span/rowSpan/order accepted", blocks(s)[0].design.base.span === 2 && blocks(s)[0].design.base.rowSpan === 3 && blocks(s)[0].design.base.order === 4);
    check("setDesign placement: one transaction", s.depth().undo === 1);
    s.undo();
    check("setDesign placement: undo clears all fields", !blocks(s)[0].design);
}

{
    const doc = freshDoc();
    doc.components.card = { block: { type: "text", content: { text: "Shared" }, design: { base: { zIndex: 1 } } } };
    doc.pages[0].blocks.push({ id: "card-instance", type: "component", ref: "card" });
    const s = C.createStore(doc);
    s.dispatch("setDesign", { id: "card-instance", breakpoint: "base", field: "frame", value: { x: 20, y: 30, width: 120, height: 60 } });
    check("setDesign instance: geometry stored on instance", blocks(s)[3].design.base.frame.x === 20);
    check("setDesign instance: component definition untouched", !s.getDoc().components.card.block.design.base.frame);
    s.undo();
    check("setDesign instance: undo removes only override", !blocks(s)[3].design && s.getDoc().components.card.block.design.base.zIndex === 1);
}

// --- insert / remove блока + undo ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("insertBlock", { block: { id: "nb", type: "text", content: { text: "Новый" } }, index: 1 });
    check("insertBlock: вставлен по индексу", blocks(s)[1].id === "nb" && blocks(s).length === 4);
    s.undo();
    check("insertBlock: undo удалил", blocks(s).length === 3 && !blocks(s).some(b => b.id === "nb"));

    s.dispatch("removeBlock", { id: "b2" });
    check("removeBlock: удалён", blocks(s).length === 2 && !blocks(s).some(b => b.id === "b2"));
    s.undo();
    check("removeBlock: undo вернул на место и по индексу", blocks(s)[1].id === "b2" && blocks(s).length === 3);
}

// --- reorderBlock: перестановка одной записью + undo восстанавливает порядок ---
{
    const s = C.createStore(freshDoc());
    const before = blocks(s).map(b => b.id).join(",");
    s.dispatch("reorderBlock", { id: "b1", toIndex: 2 }); // b1 в конец
    check("reorder: новый порядок", blocks(s).map(b => b.id).join(",") === "b2,box,b1");
    check("reorder: одна запись undo (remove+insert вместе)", s.depth().undo === 1);
    s.undo();
    check("reorder: undo восстановил исходный порядок", blocks(s).map(b => b.id).join(",") === before);
    check("reorder: no-op при toIndex==index", s.dispatch("reorderBlock", { id: "b2", toIndex: 1 }) === false);
}

// --- moveBlock: reparent между уровнями, включая сдвиг path после удаления source ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("moveBlock", { id: "b1", parentId: "box", toIndex: 1 });
    check("move: top-level перенесён в более поздний container", blocks(s).map(b => b.id).join(",") === "b2,box" && blocks(s)[1].children.map(b => b.id).join(",") === "k1,b1");
    check("move: одна запись undo", s.depth().undo === 1);
    s.undo();
    check("move: undo восстановил оба parent", blocks(s).map(b => b.id).join(",") === "b1,b2,box" && blocks(s)[2].children.map(b => b.id).join(",") === "k1");
    s.redo();
    check("move: redo повторил reparent", blocks(s)[1].children.map(b => b.id).join(",") === "k1,b1");

    s.dispatch("moveBlock", { id: "k1", pageIndex: 0, toIndex: 0 });
    check("move: nested вынесен на страницу", blocks(s)[0].id === "k1" && blocks(s)[2].children.map(b => b.id).join(",") === "b1");
    s.undo();
    check("move: undo вернул nested в container", blocks(s)[1].children.map(b => b.id).join(",") === "k1,b1");
}

// --- moveBlock: создаёт children и запрещает цикл ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("moveBlock", { id: "b2", parentId: "b1", toIndex: 0 });
    check("move: destination без children поддержан", blocks(s).map(b => b.id).join(",") === "b1,box" && blocks(s)[0].children[0].id === "b2");
    s.undo();
    check("move: undo удалил созданный children", !("children" in blocks(s)[0]) && blocks(s)[1].id === "b2");

    check("move: нельзя перенести parent в descendant", s.dispatch("moveBlock", { id: "box", parentId: "k1", toIndex: 0 }) === false);
    check("move: запрет цикла не пишет history", s.depth().undo === 0);
}

// --- вложенность: команда работает на блоке внутри children ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setContent", { id: "k1", field: "text", value: "Глубокий" });
    check("nested: правка вложенного блока", blocks(s)[2].children[0].content.text === "Глубокий");
    s.undo();
    check("nested: undo вложенного", blocks(s)[2].children[0].content.text === "Вложенный");
}

// --- вложенная вставка: add в выбранный контейнер остаётся точечной командой ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("insertBlock", { parentId: "box", index: 1, block: { id: "k2", type: "text", content: { text: "Ещё" } } });
    check("nested insert: ребёнок добавлен в container", blocks(s)[2].children.map(b => b.id).join(",") === "k1,k2");
    s.undo();
    check("nested insert: undo удалил только нового ребёнка", blocks(s)[2].children.map(b => b.id).join(",") === "k1");

    s.dispatch("insertBlock", { parentId: "b1", block: { id: "first-child", type: "text", content: { text: "Первый" } } });
    check("nested insert: создаёт отсутствующий children", blocks(s)[0].children[0].id === "first-child");
    s.undo();
    check("nested insert: undo убирает созданный children", !("children" in blocks(s)[0]));
}

// --- транзакция: несколько dispatch → одна запись undo ---
{
    const s = C.createStore(freshDoc());
    s.begin("drag");
    s.dispatch("setContent", { id: "b1", field: "text", value: "A" });
    s.dispatch("setContent", { id: "b2", field: "text", value: "B" });
    s.commit();
    check("txn: обе правки применены", blocks(s)[0].content.text === "A" && blocks(s)[1].content.text === "B");
    check("txn: ровно одна запись undo", s.depth().undo === 1);
    s.undo();
    check("txn: один undo откатил обе", blocks(s)[0].content.text === "Один" && blocks(s)[1].content.text === "Два");
    s.redo();
    check("txn: один redo вернул обе", blocks(s)[0].content.text === "A" && blocks(s)[1].content.text === "B");
}

// --- cancel: незакоммиченная транзакция полностью откатывается ---
{
    const s = C.createStore(freshDoc());
    s.begin();
    s.dispatch("setContent", { id: "b1", field: "text", value: "X" });
    s.dispatch("removeBlock", { id: "b2" });
    s.cancel();
    check("cancel: состояние восстановлено", blocks(s)[0].content.text === "Один" && blocks(s).length === 3);
    check("cancel: история пуста", s.depth().undo === 0);
}

// --- новый dispatch очищает redo-стек ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setContent", { id: "b1", field: "text", value: "A" });
    s.undo();
    check("redo доступен после undo", s.canRedo());
    s.dispatch("setContent", { id: "b2", field: "text", value: "B" });
    check("redo очищен новым действием", !s.canRedo());
}

// --- no-op команды и отсутствующий блок ---
{
    const s = C.createStore(freshDoc());
    check("dispatch несуществующего блока → false", s.dispatch("setContent", { id: "nope", field: "text", value: "x" }) === false);
    check("no-op не создаёт запись истории", s.depth().undo === 0);
}

// --- ИНВАРИАНТ: документ после команд/undo остаётся валидным для рендера lime-doc.js ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setContent", { id: "b1", field: "text", value: "Рендер-тест" });
    s.dispatch("reorderBlock", { id: "b1", toIndex: 2 });
    const html1 = L.renderSite(s.getDoc());
    check("invariant: документ рендерится после команд", html1.includes("Рендер-тест") && html1.includes("lime-doc-page"));
    s.undo(); s.undo();
    const html2 = L.renderSite(s.getDoc());
    check("invariant: рендерится и после undo (схема цела)", html2.includes("Один") && html2.includes("Вложенный"));
}

// --- state-чекпоинты: мост strangler'а (snapshot-записи в общем стеке) ---
{
    const docObj = { version: 1, pages: [{ id: "p0", slug: "", title: "Г", blocks: [{ id: "b1", type: "text", content: { text: "A" } }] }] };
    const s = C.createStore(docObj);
    const strA = JSON.stringify(docObj);
    docObj.pages[0].blocks[0].content.text = "B"; // редактор мутировал документ in-place
    const strB = JSON.stringify(docObj);
    s.recordState(strA, strB);
    check("state: запись создана", s.depth().undo === 1);
    s.undo();
    check("state: undo вернул A", s.getDoc().pages[0].blocks[0].content.text === "A");
    s.redo();
    check("state: redo вернул B", s.getDoc().pages[0].blocks[0].content.text === "B");
    check("state: no-op при before===after", s.recordState(strB, strB) === false);
}

// --- смешанный стек: op-запись + state-запись остаются связными ---
{
    const s = C.createStore(freshDoc());
    s.dispatch("setContent", { id: "b1", field: "text", value: "X" });          // op-запись
    const before = JSON.stringify(s.getDoc());
    s.getDoc().pages[0].blocks[1].content.text = "Y";                            // внешняя мутация
    s.recordState(before, JSON.stringify(s.getDoc()));                           // state-запись
    check("mixed: обе применены", blocks(s)[0].content.text === "X" && blocks(s)[1].content.text === "Y");
    s.undo();
    check("mixed: undo state-записи", blocks(s)[1].content.text === "Два" && blocks(s)[0].content.text === "X");
    s.undo();
    check("mixed: undo op-записи после state (пути валидны)", blocks(s)[0].content.text === "Один");
}

if (failed) {
    console.error("\nCOMMANDS-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nCOMMANDS-OK (D2): команды/обратные патчи, undo/redo, транзакции/cancel, вложенность, state-чекпоинты, смешанный стек, инвариант рендера — зелёные");
