"use strict";

const path = require("path");
const V = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-viewport.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }

{
    const v = V.createViewport({ x: 10, y: 20, zoom: 2 });
    const screen = v.canvasToScreen({ x: 5, y: 7 });
    check("coordinates: canvas → screen", screen.x === 20 && screen.y === 34);
    const canvas = v.screenToCanvas(screen);
    check("coordinates: round-trip", canvas.x === 5 && canvas.y === 7);

    v.panBy(15, -5);
    check("panBy", v.get().x === 25 && v.get().y === 15);
}

{
    const v = V.createViewport({ zoom: 1 });
    const anchor = { x: 320, y: 180 };
    const before = v.screenToCanvas(anchor);
    v.zoomAt(anchor, 2.5);
    const after = v.screenToCanvas(anchor);
    check("zoomAt: anchor canvas point preserved", near(before.x, after.x) && near(before.y, after.y));
    check("zoomAt: requested zoom applied", v.get().zoom === 2.5);

    v.zoomAt(anchor, 99);
    check("zoom: max clamp", v.get().zoom === 4);
    v.zoomAt(anchor, 0);
    check("zoom: min clamp", v.get().zoom === 0.1);
}

{
    const v = V.createViewport({ minZoom: 0.05, maxZoom: 8 });
    v.fitBounds({ x: 100, y: 50, width: 800, height: 400 }, { width: 1200, height: 800 }, 100);
    const s = v.get();
    check("fitBounds: limiting axis chosen", near(s.zoom, 1.25));
    const topLeft = v.canvasToScreen({ x: 100, y: 50 });
    const bottomRight = v.canvasToScreen({ x: 900, y: 450 });
    check("fitBounds: bounds centered", near(topLeft.x, 100) && near(bottomRight.x, 1100) && near(topLeft.y, 150) && near(bottomRight.y, 650));
}

{
    const v = V.createViewport();
    let calls = 0;
    const unsubscribe = v.subscribe(() => calls++);
    v.panBy(1, 0);
    v.set(v.get()); // no-op не эмитит
    unsubscribe();
    v.panBy(1, 0);
    check("subscribe: emits changes only and unsubscribes", calls === 1);
}

if (failed) {
    console.error("\nVIEWPORT-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nVIEWPORT-OK (Stage 2): coordinate math, pan, zoom anchor, fit bounds — зелёные");
