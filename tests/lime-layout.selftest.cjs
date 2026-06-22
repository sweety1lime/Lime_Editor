"use strict";

const path = require("path");
const L = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-layout.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }

const frame = { x: 10, y: 20, width: 100, height: 50, rotation: 15 };

{
    const moved = L.moveFrame(frame, 12, -4);
    check("move: position changes only", moved.x === 22 && moved.y === 16 && moved.width === 100 && moved.rotation === 15);
    check("move: source immutable", frame.x === 10 && frame.y === 20);
}

{
    const source = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    const quarter = L.rotateFrame(source, { x: 100, y: 50 }, { x: 50, y: 100 });
    check("rotate: pointer angle around center", near(quarter.rotation, 90));
    const snapped = L.rotateFrame(source, { x: 100, y: 50 }, { x: 98, y: 62 }, { snap: true, increment: 15 });
    check("rotate: Shift snap to 15 degrees", snapped.rotation === 15);
    const wrapped = L.rotateFrame({ x: 0, y: 0, width: 100, height: 100, rotation: 170 }, { x: 100, y: 50 }, { x: 0, y: 50 });
    check("rotate: normalized range", wrapped.rotation === -10 && L.normalizeAngle(540) === -180);
    check("rotate: source immutable", source.rotation === 0);
}

{
    const frames = [{ x: 0, y: 0, width: 100, height: 50 }, { x: 200, y: 100, width: 50, height: 100 }];
    const bounds = L.frameBounds(frames);
    check("group bounds: union", bounds.x === 0 && bounds.y === 0 && bounds.width === 250 && bounds.height === 200);
    const out = L.resizeFrames(frames, "se", { x: 250, y: 200 });
    check("group resize: bounds scale", out.bounds.width === 500 && out.bounds.height === 400);
    check("group resize: positions and sizes scale", out.frames[1].x === 400 && out.frames[1].y === 200 && out.frames[1].width === 100 && out.frames[1].height === 200);
    const west = L.resizeFrames(frames, "w", { x: 50, y: 0 });
    check("group resize west: opposite edge fixed", west.bounds.x === 50 && west.bounds.x + west.bounds.width === 250);
    const tiny = L.resizeFrames(frames, "se", { x: -1000, y: -1000 });
    check("group resize: every item respects 8px minimum", tiny.frames.every(f => f.width >= 8 && f.height >= 8));
}

{
    const east = L.resizeFrame(frame, "e", { x: 20, y: 0 });
    check("resize east: width grows", east.x === 10 && east.width === 120);
    const west = L.resizeFrame(frame, "w", { x: 20, y: 0 });
    check("resize west: opposite edge fixed", west.x === 30 && west.width === 80 && west.x + west.width === 110);
    const north = L.resizeFrame(frame, "n", { x: 0, y: 10 });
    check("resize north: bottom fixed", north.y === 30 && north.height === 40 && north.y + north.height === 70);
}

{
    const alt = L.resizeFrame(frame, "e", { x: 10, y: 0 }, { alt: true });
    check("resize Alt: center fixed", alt.x === 0 && alt.width === 120 && near(alt.x + alt.width / 2, 60));
    const shift = L.resizeFrame(frame, "se", { x: 20, y: 1 }, { shift: true });
    check("resize Shift: aspect ratio preserved", near(shift.width / shift.height, 2) && shift.width === 120 && shift.height === 60);
    const both = L.resizeFrame(frame, "nw", { x: -10, y: -5 }, { shift: true, alt: true });
    check("resize Shift+Alt: ratio and center", near(both.width / both.height, 2) && near(both.x + both.width / 2, 60) && near(both.y + both.height / 2, 45));
}

{
    const min = L.resizeFrame(frame, "w", { x: 500, y: 0 });
    check("resize: minimum 8px and anchored edge", min.width === 8 && min.x === 102 && min.x + min.width === 110);
    const limited = L.resizeFrame(frame, "e", { x: 500, y: 0 }, { width: { min: 40, max: 160 } });
    check("resize: explicit max", limited.width === 160);
}

{
    const child = { x: 20, y: 30, width: 100, height: 80 };
    const oldParent = { width: 400, height: 300 };
    const nextParent = { width: 500, height: 420 };
    const leftTop = L.applyParentResize(child, oldParent, nextParent, { horizontal: "left", vertical: "top" });
    check("constraints left/top", leftTop.x === 20 && leftTop.y === 30);
    const rightBottom = L.applyParentResize(child, oldParent, nextParent, { horizontal: "right", vertical: "bottom" });
    check("constraints right/bottom preserve gaps", rightBottom.x === 120 && rightBottom.y === 150);
    const center = L.applyParentResize(child, oldParent, nextParent, { horizontal: "center", vertical: "center" });
    check("constraints center preserve offsets", center.x === 70 && center.y === 90);
    const stretch = L.applyParentResize(child, oldParent, nextParent, { horizontal: "stretch", vertical: "stretch" });
    check("constraints stretch preserve margins", stretch.x === 20 && stretch.y === 30 && stretch.width === 200 && stretch.height === 200);
    const clamped = L.applyParentResize(child, oldParent, { width: 900, height: 300 }, { horizontal: "stretch" }, { width: { max: 240 } });
    check("constraints stretch respects max and left priority", clamped.x === 20 && clamped.width === 240);
}

if (failed) {
    console.error("\nLAYOUT-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nLAYOUT-OK (Stage 3): move, resize, rotate, Shift/Alt, constraints — зелёные");
