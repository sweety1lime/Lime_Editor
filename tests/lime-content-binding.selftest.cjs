"use strict";

// Самотест модуля content/data-binding. editor-v2 CMS-путь (коллекции/collectionList/countdown/
// привязка к записи) не покрывает — проверяем чистые билдеры напрямую: editorCollectionData,
// templateSampleRecord, bindingSection, contentExtras (countdown/form/collectionList) и setContentFlag.

const path = require("path");
const CB = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-content-binding.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function esc(s) { return String(s == null ? "" : s); }
function sec(title, body) { return "[" + title + "]" + body; }
const SCHEMA = [
    { name: "title", label: "Заголовок", type: "text" },
    { name: "cover", label: "Обложка", type: "image" }
];
function cache() { return [{ slug: "posts", name: "Посты", schemaJson: JSON.stringify(SCHEMA) }]; }

// --- editorCollectionData: схема из кэша + 2 пустые записи ---
{
    var api = CB.create({ getCollections: cache, escapeText: esc, section: sec });
    var data = api.editorCollectionData();
    check("editorCollectionData: коллекция есть в карте", !!data && !!data.posts);
    check("editorCollectionData: 2 поля + 2 пустые записи", data.posts.fields.length === 2 && data.posts.records.length === 2);
    var empty = CB.create({ getCollections: function () { return null; } }).editorCollectionData();
    check("editorCollectionData: без кэша → null", empty === null);
}

// --- templateSampleRecord: плейсхолдеры по схеме на странице-шаблоне ---
{
    var api = CB.create({
        getCollections: cache,
        getDoc: function () { return { pages: [{ collection: "posts" }] }; },
        getActive: function () { return 0; },
        escapeText: esc, section: sec
    });
    var rec = api.templateSampleRecord();
    check("templateSampleRecord: текстовое поле → плейсхолдер", rec && rec.title === "Пример: Заголовок");
    check("templateSampleRecord: image-поле → пустая строка", rec && rec.cover === "");
    var none = CB.create({ getCollections: cache, getDoc: function () { return { pages: [{}] }; }, getActive: function () { return 0; } }).templateSampleRecord();
    check("templateSampleRecord: обычная страница → null", none === null);
}

// --- bindingSection: text → bind (текстовые поля), image → bindSrc (image-поля) ---
{
    var api = CB.create({
        getCollections: cache,
        getDoc: function () { return { pages: [{ collection: "posts" }] }; },
        getActive: function () { return 0; },
        escapeText: esc, section: sec
    });
    var textHtml = api.bindingSection({ type: "text", content: {} });
    check("bindingSection text: bind + текстовое поле, без image", textHtml.indexOf('data-doc-bind="bind"') >= 0 && textHtml.indexOf(">Заголовок<") >= 0 && textHtml.indexOf(">Обложка<") < 0);
    var imgHtml = api.bindingSection({ type: "image", content: {} });
    check("bindingSection image: bindSrc + image-поле", imgHtml.indexOf('data-doc-bind="bindSrc"') >= 0 && imgHtml.indexOf(">Обложка<") >= 0);
    check("bindingSection: не шаблон → пусто", CB.create({ getDoc: function () { return { pages: [{}] }; }, getActive: function () { return 0; } }).bindingSection({ type: "text" }) === "");
}

// --- contentExtras: countdown / form / collectionList ---
{
    var api = CB.create({ getCollections: cache, escapeText: esc, section: sec });
    var cd = api.contentExtras({ type: "countdown", content: { target: "2026-01-01T00:00" } });
    check("contentExtras countdown: поле даты с value", cd.indexOf("data-doc-cd-target") >= 0 && cd.indexOf("2026-01-01T00:00") >= 0);
    var form = api.contentExtras({ type: "form" });
    check("contentExtras form: select коллекции", form.indexOf("data-doc-collection") >= 0 && form.indexOf("Записывать в коллекцию") >= 0);
    var cl = api.contentExtras({ type: "collectionList", content: { collection: "posts" } });
    check("contentExtras collectionList: раскладка+лимит+сортировка (поля есть)", cl.indexOf("data-doc-cl-layout") >= 0 && cl.indexOf("data-doc-cl-limit") >= 0 && cl.indexOf("data-doc-cl-sortfield") >= 0);
    check("contentExtras: прочий тип → пусто", api.contentExtras({ type: "text" }) === "");
}

// --- contentExtras: slot-hint (Milestone 4 experience-builder-plan.md) ---
{
    var fakePacks = {
        resolve: function (key) {
            if (key !== "neo-lore-drop") return null;
            return { assetSlots: [{ slot: "hero-scene", label: "Hero scene", hint: "Spline/Rive/Sketchfab embed URL" }] };
        }
    };
    var api = CB.create({
        window: { LimeExperiencePacks: fakePacks },
        getDoc: function () { return { pack: "neo-lore-drop" }; },
        getCollections: cache, escapeText: esc, section: sec
    });
    var withSlot = api.contentExtras({ type: "embed", content: { __slot: "hero-scene" } });
    check("contentExtras: known slot renders its hint", withSlot.indexOf("Требования к ассету") >= 0 && withSlot.indexOf("Spline/Rive/Sketchfab embed URL") >= 0);

    // Milestone 5, Фаза C: кнопка «✦ Промпт для ассета» + пустой result-контейнер рядом с хинтом.
    check("contentExtras: slot-hint кнопка присутствует", withSlot.indexOf("data-doc-ai-asset-prompt") >= 0);
    check("contentExtras: кнопка несёт label/hint слота в data-*", withSlot.indexOf('data-slot-label="Hero scene"') >= 0
        && withSlot.indexOf('data-slot-hint="Spline/Rive/Sketchfab embed URL"') >= 0);
    check("contentExtras: пустой result-контейнер рядом с кнопкой", withSlot.indexOf("data-ai-asset-result") >= 0);

    check("contentExtras: no __slot on the block → no-op", api.contentExtras({ type: "embed", content: {} }) === "");

    var noPackDoc = CB.create({
        window: { LimeExperiencePacks: fakePacks },
        getDoc: function () { return {}; }, // старый документ без doc.pack
        getCollections: cache, escapeText: esc, section: sec
    });
    check("contentExtras: __slot present but doc.pack unset → no-op (old documents)",
        noPackDoc.contentExtras({ type: "embed", content: { __slot: "hero-scene" } }) === "");

    var unknownPackDoc = CB.create({
        window: { LimeExperiencePacks: fakePacks },
        getDoc: function () { return { pack: "startup" }; }, // не Experience Pack
        getCollections: cache, escapeText: esc, section: sec
    });
    check("contentExtras: doc.pack resolves to null (plain template) → no-op",
        unknownPackDoc.contentExtras({ type: "embed", content: { __slot: "hero-scene" } }) === "");

    var unknownSlotDoc = CB.create({
        window: { LimeExperiencePacks: fakePacks },
        getDoc: function () { return { pack: "neo-lore-drop" }; },
        getCollections: cache, escapeText: esc, section: sec
    });
    check("contentExtras: __slot doesn't match any of the pack's assetSlots → no-op",
        unknownSlotDoc.contentExtras({ type: "embed", content: { __slot: "no-such-slot" } }) === "");

    var noWindowDoc = CB.create({ getDoc: function () { return { pack: "neo-lore-drop" }; }, getCollections: cache, escapeText: esc, section: sec });
    check("contentExtras: no LimeExperiencePacks injected at all → no-op, doesn't throw",
        noWindowDoc.contentExtras({ type: "embed", content: { __slot: "hero-scene" } }) === "");

    check("contentExtras: slot hint is prepended to countdown's own section (not replacing it)",
        api.contentExtras({ type: "countdown", content: { __slot: "hero-scene", target: "" } }).indexOf("Обратный отсчёт") >= 0);
}

// --- setContentFlag: пишет через setContentValue, null → remove ---
{
    var captured = null;
    var api = CB.create({
        byId: function () { return { id: "b1" }; },
        getSelectedId: function () { return "b1"; },
        setContentValue: function (b, key, val, remove) { captured = { key: key, val: val, remove: remove }; }
    });
    api.setContentFlag("collection", "posts");
    check("setContentFlag: значение → remove=false", captured && captured.key === "collection" && captured.val === "posts" && captured.remove === false);
    api.setContentFlag("collection", null);
    check("setContentFlag: null → remove=true", captured && captured.remove === true);
    var noSel = CB.create({ byId: function () { return null; }, getSelectedId: function () { return null; }, setContentValue: function () { throw new Error("не должно вызваться"); } });
    noSel.setContentFlag("x", "y");
    check("setContentFlag: нет блока → тихо (без записи)", true);
}

if (failed) { console.error("\n" + failed + " FAILED"); process.exit(1); }
console.log("\nвсе проверки пройдены");
