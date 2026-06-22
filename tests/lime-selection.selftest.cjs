"use strict";

const path = require("path");
const S = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-selection.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

{
    const s = S.createSelection();
    let emits = 0;
    s.subscribe(() => emits++);
    s.select("a");
    s.select("b", { additive: true });
    check("selection: additive + primary", s.get().ids.join(",") === "a,b" && s.get().primaryId === "b");
    s.select("a", { toggle: true });
    check("selection: toggle removes", s.get().ids.join(",") === "b");
    s.select("b"); // no-op
    check("selection: no-op does not emit", emits === 3);
    s.clear();
    check("selection: clear", s.get().ids.length === 0 && s.get().primaryId === null);
}

const candidates = [
    { id: "parent", rect: { x: 0, y: 0, width: 200, height: 200 }, depth: 1, zIndex: 0, order: 0 },
    { id: "child-back", rect: { x: 20, y: 20, width: 80, height: 80 }, depth: 2, zIndex: 0, order: 1 },
    { id: "child-front", rect: { x: 20, y: 20, width: 80, height: 80 }, depth: 2, zIndex: 2, order: 2 },
    { id: "locked", rect: { x: 20, y: 20, width: 80, height: 80 }, depth: 3, zIndex: 9, locked: true },
    { id: "outside", rect: { x: 250, y: 250, width: 20, height: 20 }, depth: 1 }
];

{
    const hit = S.hitTest(candidates, { x: 30, y: 30 });
    check("hitTest: deepest/frontmost wins", hit && hit.id === "child-front");
    check("hitTest: outside returns null", S.hitTest(candidates, { x: 500, y: 500 }) === null);
}

{
    const normalized = S.normalizeRect({ x1: 100, y1: 80, x2: 10, y2: 20 });
    check("marquee: reverse drag normalized", normalized.left === 10 && normalized.top === 20 && normalized.right === 100 && normalized.bottom === 80);
    const intersecting = S.marquee(candidates, { x: 10, y: 10, width: 110, height: 110 });
    check("marquee: intersects and skips locked", intersecting.join(",") === "parent,child-back,child-front");
    const contained = S.marquee(candidates, { x: 10, y: 10, width: 110, height: 110 }, { contain: true });
    check("marquee: contain mode", contained.join(",") === "child-back,child-front");
}

if (failed) {
    console.error("\nSELECTION-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nSELECTION-OK (Stage 2): state, multi-select, hit-test, marquee — зелёные");
