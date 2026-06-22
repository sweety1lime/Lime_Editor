"use strict";

const path = require("path");
const S = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-snap.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

{
    const out = S.snapMove(
        { x: 98, y: 47, width: 50, height: 50 },
        [{ id: "target", rect: { x: 150, y: 100, width: 100, height: 80 } }],
        { threshold: 5 }
    );
    check("snap: moving right → target left", out.rect.x === 100 && out.delta.x === 2);
    check("snap: moving bottom → target top", out.rect.y === 50 && out.delta.y === 3);
    check("snap: emits x/y guides", out.guides.length === 2 && out.guides.some(g => g.axis === "x" && g.targetId === "target"));
}

{
    const east = S.snapResize(
        { x: 20, y: 20, width: 127, height: 80, rotation: 10 }, "e",
        [{ id: "target", rect: { x: 150, y: 10, width: 100, height: 100 } }], { threshold: 4 }
    );
    check("resize snap east: active edge → target left", east.rect.x === 20 && east.rect.width === 130 && east.rect.rotation === 10);
    check("resize snap east: emits vertical guide", east.guides.length === 1 && east.guides[0].axis === "x" && east.guides[0].target === "left");
    const nw = S.snapResize(
        { x: 102, y: 98, width: 98, height: 102 }, "nw",
        [{ id: "target", rect: { x: 100, y: 100, width: 40, height: 40 } }], { threshold: 3 }
    );
    check("resize snap north-west: opposite edges fixed", nw.rect.x === 100 && nw.rect.y === 100 && nw.rect.x + nw.rect.width === 200 && nw.rect.y + nw.rect.height === 200);
    const locked = S.snapResize({ x: 0, y: 0, width: 49, height: 49 }, "se", [{ locked: true, rect: { x: 50, y: 50, width: 20, height: 20 } }], { threshold: 2 });
    check("resize snap: locked target skipped", locked.guides.length === 0 && locked.rect.width === 49);
}

{
    const out = S.snapMove(
        { x: 151, y: 151, width: 40, height: 40 },
        [{ id: "locked", locked: true, rect: { x: 150, y: 150, width: 40, height: 40 } }],
        { threshold: 4, grid: 10 }
    );
    check("snap: locked target skipped, grid used", out.rect.x === 150 && out.rect.y === 150 && out.guides.every(g => g.target === "grid"));
}

{
    const out = S.snapMove({ x: 10, y: 10, width: 20, height: 20 }, [{ rect: { x: 100, y: 100, width: 20, height: 20 } }], { threshold: 3 });
    check("snap: outside threshold unchanged", out.delta.x === 0 && out.delta.y === 0 && out.guides.length === 0);
}

{
    const hit = S.snapValue(99, [{ value: 90, id: "a" }, { value: 100, id: "b" }], 4);
    check("snapValue: nearest candidate", hit.value === 100 && hit.delta === 1 && hit.candidate.id === "b");
    const miss = S.snapValue(50, [100], 4);
    check("snapValue: miss preserves value", miss.value === 50 && miss.delta === 0 && miss.candidate === null);
}

if (failed) {
    console.error("\nSNAP-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nSNAP-OK (Stage 3): move/resize edge-center-grid snapping and guides — зелёные");
