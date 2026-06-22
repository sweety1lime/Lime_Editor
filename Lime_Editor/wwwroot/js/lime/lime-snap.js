/* Lime Snap — pure edge/center/grid snapping for Editor V2 interactions. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeSnap = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }
    function rect(v) {
        v = v || {};
        var x = num(v.x, 0), y = num(v.y, 0), width = Math.max(0, num(v.width, 0)), height = Math.max(0, num(v.height, 0));
        return { x: x, y: y, width: width, height: height, left: x, right: x + width, cx: x + width / 2, top: y, bottom: y + height, cy: y + height / 2 };
    }
    function anchorsX(r) { return [{ kind: "left", value: r.left }, { kind: "center", value: r.cx }, { kind: "right", value: r.right }]; }
    function anchorsY(r) { return [{ kind: "top", value: r.top }, { kind: "center", value: r.cy }, { kind: "bottom", value: r.bottom }]; }
    function better(current, candidate) { return !current || Math.abs(candidate.delta) < Math.abs(current.delta); }

    function snapMove(moving, targets, options) {
        options = options || {};
        var threshold = Math.max(0, num(options.threshold, 6));
        var m = rect(moving);
        var bestX = null, bestY = null;
        (targets || []).forEach(function (target, order) {
            if (!target || target.hidden || target.locked) return;
            var t = rect(target.rect || target);
            anchorsX(m).forEach(function (ma) {
                anchorsX(t).forEach(function (ta) {
                    var c = { delta: ta.value - ma.value, axis: "x", moving: ma.kind, target: ta.kind, value: ta.value, targetId: target.id || null, order: order };
                    if (Math.abs(c.delta) <= threshold && better(bestX, c)) bestX = c;
                });
            });
            anchorsY(m).forEach(function (ma) {
                anchorsY(t).forEach(function (ta) {
                    var c = { delta: ta.value - ma.value, axis: "y", moving: ma.kind, target: ta.kind, value: ta.value, targetId: target.id || null, order: order };
                    if (Math.abs(c.delta) <= threshold && better(bestY, c)) bestY = c;
                });
            });
        });

        var grid = num(options.grid, 0);
        if (grid > 0) {
            var gx = Math.round(m.left / grid) * grid - m.left;
            var gy = Math.round(m.top / grid) * grid - m.top;
            if (Math.abs(gx) <= threshold && better(bestX, { delta: gx })) bestX = { delta: gx, axis: "x", moving: "left", target: "grid", value: m.left + gx, targetId: null };
            if (Math.abs(gy) <= threshold && better(bestY, { delta: gy })) bestY = { delta: gy, axis: "y", moving: "top", target: "grid", value: m.top + gy, targetId: null };
        }

        var dx = bestX ? bestX.delta : 0, dy = bestY ? bestY.delta : 0;
        return {
            rect: { x: m.x + dx, y: m.y + dy, width: m.width, height: m.height },
            delta: { x: dx, y: dy },
            guides: [bestX, bestY].filter(Boolean)
        };
    }

    function snapResize(resizing, handle, targets, options) {
        options = options || {};
        var threshold = Math.max(0, num(options.threshold, 6));
        var m = rect(resizing);
        var h = String(handle || "");
        var west = h.indexOf("w") >= 0, east = h.indexOf("e") >= 0;
        var north = h.indexOf("n") >= 0, south = h.indexOf("s") >= 0;
        var movingX = west ? { kind: "left", value: m.left } : east ? { kind: "right", value: m.right } : null;
        var movingY = north ? { kind: "top", value: m.top } : south ? { kind: "bottom", value: m.bottom } : null;
        var bestX = null, bestY = null;
        (targets || []).forEach(function (target, order) {
            if (!target || target.hidden || target.locked) return;
            var t = rect(target.rect || target);
            if (movingX) anchorsX(t).forEach(function (ta) {
                var c = { delta: ta.value - movingX.value, axis: "x", moving: movingX.kind, target: ta.kind, value: ta.value, targetId: target.id || null, order: order };
                if (Math.abs(c.delta) <= threshold && better(bestX, c)) bestX = c;
            });
            if (movingY) anchorsY(t).forEach(function (ta) {
                var c = { delta: ta.value - movingY.value, axis: "y", moving: movingY.kind, target: ta.kind, value: ta.value, targetId: target.id || null, order: order };
                if (Math.abs(c.delta) <= threshold && better(bestY, c)) bestY = c;
            });
        });
        var grid = num(options.grid, 0);
        if (grid > 0 && movingX) {
            var gx = Math.round(movingX.value / grid) * grid - movingX.value;
            if (Math.abs(gx) <= threshold && better(bestX, { delta: gx })) bestX = { delta: gx, axis: "x", moving: movingX.kind, target: "grid", value: movingX.value + gx, targetId: null };
        }
        if (grid > 0 && movingY) {
            var gy = Math.round(movingY.value / grid) * grid - movingY.value;
            if (Math.abs(gy) <= threshold && better(bestY, { delta: gy })) bestY = { delta: gy, axis: "y", moving: movingY.kind, target: "grid", value: movingY.value + gy, targetId: null };
        }
        var dx = bestX ? bestX.delta : 0, dy = bestY ? bestY.delta : 0;
        var out = { x: m.x, y: m.y, width: m.width, height: m.height, rotation: num(resizing && resizing.rotation, 0) };
        if (west) { out.x += dx; out.width -= dx; } else if (east) out.width += dx;
        if (north) { out.y += dy; out.height -= dy; } else if (south) out.height += dy;
        if (out.width < 8) { out.x = m.x; out.width = m.width; bestX = null; dx = 0; }
        if (out.height < 8) { out.y = m.y; out.height = m.height; bestY = null; dy = 0; }
        return { rect: out, delta: { x: dx, y: dy }, guides: [bestX, bestY].filter(Boolean) };
    }

    function snapValue(value, candidates, threshold) {
        threshold = Math.max(0, num(threshold, 6));
        var best = null;
        (candidates || []).forEach(function (candidate) {
            var v = num(candidate && candidate.value != null ? candidate.value : candidate, NaN);
            if (!isFinite(v)) return;
            var hit = { value: v, delta: v - value, candidate: candidate };
            if (Math.abs(hit.delta) <= threshold && better(best, hit)) best = hit;
        });
        return best || { value: value, delta: 0, candidate: null };
    }

    return { snapMove: snapMove, snapResize: snapResize, snapValue: snapValue, rect: rect };
});
