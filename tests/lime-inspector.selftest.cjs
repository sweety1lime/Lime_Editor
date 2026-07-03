"use strict";

// Самотест inspector view. e2e (Stage 5) проверяет бейджи через UI на паре сценариев —
// здесь напрямую: curStyle (класс/hover/bp), sectionSource (own/tablet/base/class/instance-own),
// ownOverrideProps (пересечение multi), renderStyleSections (core/adv «Дополнительно»),
// refreshInspector (empty-state, шапка, вкладки, баннер компонента, multi-баннер).

const path = require("path");
const Inspector = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-inspector.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

function makeEnv(opts) {
    opts = opts || {};
    const blocks = opts.blocks || {};
    const inspectorEl = {
        innerHTML: "",
        querySelector: () => null,
        querySelectorAll: () => []
    };
    const api = Inspector.create({
        window: {},
        inspectorEl,
        L: { isContainer: t => t === "container" || t === "columns", resolvedDesign: () => ({ layout: {} }) },
        escapeText: s => String(s == null ? "" : s),
        ico: n => "[i:" + n + "]",
        getDoc: () => opts.doc || { components: {} },
        getSelectedId: () => opts.selectedId || null,
        getCurrentClass: () => opts.currentClass || null,
        getCurrentState: () => opts.currentState || "normal",
        getCurrentBp: () => opts.currentBp || "base",
        getCurrentInspectorTab: () => "style",
        byId: id => blocks[id] || null,
        findBlock: id => (blocks[id] ? { block: blocks[id], parentBlock: opts.parentBlock || null } : null),
        targetBlock: b => b,
        readStyles: b => (b && b.styles) || {},
        findClassDef: cls => (opts.classDefs || {})[cls] || null,
        effectiveClassStyles: () => opts.clsStyles || {},
        componentRecord: ref => (ref === "comp" ? { name: "Карточка" } : null),
        syncInspectorShell: () => {},
        v2SelectionIds: () => opts.multiIds || (opts.selectedId ? [opts.selectedId] : []),
        multiStyleModel: () => ({ values: { color: "#111" }, mixed: { margin: true } }),
        styleRegistry: opts.registry || [
            { title: "Цвет", props: ["color"] },
            { title: "Тень", props: ["boxShadow"], adv: true }
        ],
        hasOwn: (o, p) => Object.prototype.hasOwnProperty.call(o, p),
        registryProps: item => item.props,
        renderControl: item => "<ctl:" + item.title + ">",
        section: (t, b) => "[" + t + "]" + b,
        classEditBanner: () => "<class-banner>",
        classesSection: () => "<classes>",
        componentPropsSection: () => "",
        componentVariantControls: () => "<variants>",
        v2LayoutInspector: () => "<layout>",
        bindingSection: () => "",
        contentExtras: () => "",
        bgInspector: () => "<bg>",
        fxInspector: () => "<fx>",
        animInspector: () => "<anim>",
        motionInspector: () => "<motion>",
        sceneInspector: () => "<scene>",
        layersInspector: () => "<lyr>",
        populateCollectionPickers: () => {}
    });
    return { api, inspectorEl, blocks };
}

// --- curStyle: блок / hover / класс ---
{
    const b = { id: "b", styles: { base: { color: "red" }, mobile: { color: "green" }, hover: { color: "blue" } } };
    const { api } = makeEnv({ blocks: { b } });
    check("curStyle: base-бакет блока", api.curStyle(b).color === "red");
    const { api: apiM } = makeEnv({ blocks: { b }, currentBp: "mobile" });
    check("curStyle: mobile-бакет", apiM.curStyle(b).color === "green");
    const { api: apiH } = makeEnv({ blocks: { b }, currentState: "hover" });
    check("curStyle: hover-бакет", apiH.curStyle(b).color === "blue");
    const { api: apiC } = makeEnv({ currentClass: "hero", classDefs: { hero: { styles: { base: { color: "#fff" } } } } });
    check("curStyle: режим класса читает класс, не блок", apiC.curStyle(b).color === "#fff");
}

// --- sectionSource: провенанс ---
{
    const { api } = makeEnv({});
    check("sectionSource: own на не-base", api.sectionSource(["color"], { bp: "tablet", own: { color: 1 }, tablet: {}, base: {}, cls: {} }) === "own");
    check("sectionSource: mobile наследует с tablet", api.sectionSource(["color"], { bp: "mobile", own: {}, tablet: { color: 1 }, base: {}, cls: {} }) === "tablet");
    check("sectionSource: наследование с base", api.sectionSource(["color"], { bp: "tablet", own: {}, tablet: {}, base: { color: 1 }, cls: {} }) === "base");
    check("sectionSource: значение из класса", api.sectionSource(["color"], { bp: "base", own: {}, tablet: {}, base: {}, cls: { color: 1 } }) === "class");
    check("sectionSource: инстанс — локальный override", api.sectionSource(["color"], { instance: true, instOwn: { color: 1 } }) === "instance-own");
    check("sectionSource: ничего — null", api.sectionSource(["color"], { bp: "base", own: {}, tablet: {}, base: {}, cls: {} }) === null);
}

// --- ownOverrideProps: пересечение по всем выбранным ---
{
    const blocks = {
        a: { id: "a", styles: { mobile: { color: 1, margin: 1 } } },
        b: { id: "b", styles: { mobile: { color: 1 } } }
    };
    const { api } = makeEnv({ blocks });
    const own = api.ownOverrideProps(["a", "b"], "mobile");
    check("ownOverrideProps: только общие пропы", own.color === true && !own.margin);
}

// --- renderStyleSections: core сразу, adv в «Дополнительно» ---
{
    const { api } = makeEnv({});
    const html = api.renderStyleSections({ color: "red" }, {}, null);
    check("core-секция снаружи details", html.indexOf("[Цвет]") >= 0 && html.indexOf("[Цвет]") < html.indexOf("<details"));
    check("adv-секция внутри «Дополнительно»", html.indexOf("<details") < html.indexOf("[Тень]") && html.includes("Дополнительно"));
}

// --- refreshInspector: empty-state / шапка+вкладки / баннеры ---
{
    const { api, inspectorEl } = makeEnv({});
    api.refreshInspector();
    check("без выбора — empty-state", inspectorEl.innerHTML.includes("lime-inspector__empty"));
    const b = { id: "b", type: "text", content: { text: "hi" }, styles: {} };
    const env2 = makeEnv({ blocks: { b }, selectedId: "b" });
    env2.api.refreshInspector();
    const html2 = env2.inspectorEl.innerHTML;
    check("шапка: тип блока + брейкпоинт", html2.includes("Десктоп") && html2.includes('data-doc-op="del"'));
    check("вкладки style/fx/motion", html2.includes('data-doc-insp-tab="style"') && html2.includes('data-doc-insp-tab="motion"'));
    check("AI-кнопка для текстового блока", html2.includes('data-doc-op="ai"'));
    const inst = { id: "i", type: "component", ref: "comp", overrides: { styles: {} } };
    const env3 = makeEnv({ blocks: { i: inst }, selectedId: "i", doc: { components: { comp: { name: "Карточка" } } } });
    env3.api.refreshInspector();
    const html3 = env3.inspectorEl.innerHTML;
    check("баннер компонента: имя + reset + variants", html3.includes("Карточка") && html3.includes("reset-overrides") && html3.includes("<variants>"));
    const m1 = { id: "m1", type: "text", styles: {} }, m2 = { id: "m2", type: "text", styles: {} };
    const env4 = makeEnv({ blocks: { m1, m2 }, selectedId: "m1", multiIds: ["m1", "m2"] });
    env4.api.refreshInspector();
    check("multi-баннер: счётчик + Group", env4.inspectorEl.innerHTML.includes("Selected nodes: 2") && env4.inspectorEl.innerHTML.includes('data-doc-op="group"'));
}

if (failed) { console.error("\n" + failed + " FAILED"); process.exit(1); }
console.log("\nвсе проверки пройдены");
