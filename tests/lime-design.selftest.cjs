"use strict";

const path = require("path");
const fixtures = require("./fixtures/editor-v2-layouts.json");
const D = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-design.js"));
const Doc = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-doc.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

for (const fixture of fixtures) {
    const errors = D.validateDoc(fixture.doc);
    check("fixture valid: " + fixture.name, errors.length === 0);
}

{
    const design = {
        base: { layout: { mode: "stack", gap: 24, padding: { left: 32, right: 32 } }, tags: ["base"] },
        tablet: { layout: { gap: 16, padding: { left: 24 } }, tags: ["tablet"] },
        mobile: { layout: { padding: { left: 12, right: 12 } } }
    };
    const mobile = D.resolveDesign(design, "mobile");
    check("inheritance: scalar override", mobile.layout.gap === 16);
    check("inheritance: nested deep merge", mobile.layout.padding.left === 12 && mobile.layout.padding.right === 12);
    check("inheritance: arrays replace", mobile.tags.length === 1 && mobile.tags[0] === "tablet");
    check("inheritance: source not mutated", design.base.layout.padding.left === 32);
    check("inheritance: renderer resolver parity", JSON.stringify(mobile) === JSON.stringify(Doc.resolvedDesign(design, "mobile")));
}

{
    const doc = fixtures.find(f => f.name === "hero-free").doc;
    const built = D.buildIndex(doc);
    check("index: all hero nodes indexed", Object.keys(built.index).length === 3);
    check("index: runtime parentId derived", built.index["hero-title"].parentId === "free-hero");
    check("index: canonical path", built.index["hero-title"].path.join(".") === "pages.0.blocks.0.children.0");
}

function tiny(block) {
    return { version: 2, theme: {}, components: {}, pages: [{ id: "p", slug: "", title: "T", blocks: [block] }] };
}

{
    const bad = tiny({ id: "x", type: "container", parentId: "persisted", content: {}, design: { base: { layout: { mode: "absolute-magic" } } } });
    const codes = D.validateDoc(bad).map(e => e.code);
    check("validator: persisted parentId rejected", codes.includes("persisted_parent_id"));
    check("validator: unknown layout rejected", codes.includes("invalid_layout_mode"));
}

{
    const bad = tiny({ id: "stack-bad", type: "container", content: {}, design: { base: { layout: {
        mode: "stack", direction: "diagonal", align: "somewhere", justify: "random", wrap: "yes", columns: 0
    } } } });
    const codes = D.validateDoc(bad).map(e => e.code);
    check("validator: stack direction/align/justify/wrap rejected", ["invalid_direction", "invalid_align", "invalid_justify", "invalid_wrap"].every(c => codes.includes(c)));
    check("validator: invalid columns rejected", codes.includes("invalid_columns"));
    const good = tiny({ id: "stack-good", type: "container", content: {}, design: { base: { layout: {
        mode: "stack", direction: "horizontal", align: "center", justify: "space-between", wrap: true,
        padding: { top: 8, right: 16, bottom: 8, left: 16 }
    } } } });
    check("validator: full stack contract accepted", D.validateDoc(good).length === 0);
    const unitGood = tiny({ id: "stack-unit", type: "container", content: {}, design: { base: {
        size: { width: { mode: "fixed", value: "20rem", max: "80%" } },
        layout: { mode: "stack", gap: "2rem", padding: { top: "1rem", right: "5%", bottom: "1rem", left: "5%" } }
    } } });
    check("validator: unit-flex px/rem/% lengths accepted", D.validateDoc(unitGood).length === 0);
    const unitBad = tiny({ id: "stack-unit-bad", type: "container", content: {}, design: { base: {
        layout: { mode: "stack", gap: "2vw" }
    } } });
    check("validator: unsupported length unit rejected", D.validateDoc(unitBad).some(e => e.code === "invalid_length"));
}

{
    const bad = tiny({ id: "free", type: "container", content: {}, design: { base: { layout: { mode: "free" }, size: { height: { mode: "hug" } } } }, children: [
        { id: "child", type: "text", content: { text: "x" } }
    ] });
    const codes = D.validateDoc(bad).map(e => e.code);
    check("validator: child of free requires frame", codes.includes("frame_required"));
    check("validator: free hug rejected", codes.includes("free_hug_forbidden"));
}

{
    const bad = tiny({ id: "same", type: "container", content: {}, children: [
        { id: "same", type: "text", content: { text: "duplicate" } }
    ] });
    check("validator: duplicate ids rejected", D.validateDoc(bad).some(e => e.code === "duplicate_id"));
}

{
    const bad = tiny({ id: "instance", type: "component", ref: "card", design: { base: { layout: { mode: "grid" }, frame: { x: 0, y: 0, width: 100, height: 60 } } } });
    check("validator: component instance accepts geometry only", D.validateDoc(bad).some(e => e.code === "invalid_instance_design"));
}

{
    // Grid contract: child column/row span + auto columns + explicit auto rows.
    const good = tiny({ id: "grid", type: "container", content: {}, design: { base: { layout: {
        mode: "grid", columns: { mode: "auto", min: 240, max: 480, fill: true }, gap: 16, autoRows: 120
    } } } });
    good.pages[0].blocks[0].children = [
        { id: "g-child", type: "text", content: { text: "x" }, design: { base: { span: 2, rowSpan: 2 } } }
    ];
    check("validator: complete grid placement contract accepted", D.validateDoc(good).length === 0);

    const bad = tiny({ id: "grid2", type: "container", content: {}, design: { base: { layout: {
        mode: "grid", columns: { mode: "auto", min: 240, fill: "yes" }, autoRows: -1
    } } } });
    bad.pages[0].blocks[0].children = [
        { id: "g2-child", type: "text", content: { text: "x" }, design: { base: { span: 1.5, rowSpan: 1.5, order: 0.5 } } }
    ];
    const codes = D.validateDoc(bad).map(e => e.code);
    check("validator: grid fill non-boolean rejected", codes.includes("invalid_columns_fill"));
    check("validator: fractional span rejected", codes.includes("invalid_span"));
    check("validator: fractional row span rejected", codes.includes("invalid_row_span"));
    check("validator: fractional order rejected", codes.includes("invalid_order"));
    check("validator: negative auto rows rejected", codes.includes("invalid_number"));
}

{
    const blocks = [];
    for (let i = 0; i < 1000; i++) blocks.push({ id: "perf-" + i, type: "text", content: { text: "Node " + i } });
    const doc = { version: 2, theme: {}, components: {}, pages: [{ id: "perf-page", slug: "", title: "Perf", blocks }] };
    const started = Date.now();
    const errors = D.validateDoc(doc);
    const elapsed = Date.now() - started;
    check("performance fixture: 1000 nodes valid", errors.length === 0);
    check("performance fixture: validator under 1000ms", elapsed < 1000);
}

if (failed) {
    console.error("\nDESIGN-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nDESIGN-OK (Stage 0): fixtures, inheritance, runtime index, validation limits — зелёные");
