/* Lime Layout — pure frame/resize/constraint math for Editor V2. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeLayout = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
    function copyFrame(frame) {
        frame = frame || {};
        return {
            x: num(frame.x, 0), y: num(frame.y, 0),
            width: Math.max(0, num(frame.width, 0)), height: Math.max(0, num(frame.height, 0)),
            rotation: num(frame.rotation, 0)
        };
    }
    function axisLimits(spec) {
        spec = spec || {};
        var min = Math.max(8, num(spec.min, 8));
        var max = Math.max(min, num(spec.max, Infinity));
        return { min: min, max: max };
    }
    function clampSize(value, spec) {
        var l = axisLimits(spec);
        return clamp(num(value, l.min), l.min, l.max);
    }

    function moveFrame(frame, dx, dy) {
        var out = copyFrame(frame);
        out.x += num(dx, 0);
        out.y += num(dy, 0);
        return out;
    }

    function normalizeAngle(value) {
        value = num(value, 0) % 360;
        if (value >= 180) value -= 360;
        if (value < -180) value += 360;
        return value;
    }
    function pointAngle(center, point) {
        center = center || {}; point = point || {};
        return Math.atan2(num(point.y, 0) - num(center.y, 0), num(point.x, 0) - num(center.x, 0)) * 180 / Math.PI;
    }
    function rotateFrame(frame, startPoint, currentPoint, options) {
        var out = copyFrame(frame);
        options = options || {};
        var center = { x: out.x + out.width / 2, y: out.y + out.height / 2 };
        var delta = normalizeAngle(pointAngle(center, currentPoint) - pointAngle(center, startPoint));
        var rotation = out.rotation + delta;
        var increment = Math.max(0, num(options.increment, 15));
        if (options.snap && increment > 0) rotation = Math.round(rotation / increment) * increment;
        out.rotation = normalizeAngle(rotation);
        return out;
    }

    function frameBounds(frames) {
        var list = (frames || []).map(copyFrame);
        if (!list.length) return copyFrame();
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        list.forEach(function (frame) {
            minX = Math.min(minX, frame.x); minY = Math.min(minY, frame.y);
            maxX = Math.max(maxX, frame.x + frame.width); maxY = Math.max(maxY, frame.y + frame.height);
        });
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
    }

    // Выравнивание группы фреймов по краю/центру общего bounding box.
    // edge: left | hcenter | right | top | vcenter | bottom. Источник иммутабелен,
    // порядок результата совпадает с входным.
    function alignFrames(frames, edge) {
        var list = (frames || []).map(copyFrame);
        if (list.length < 2) return list;
        var b = frameBounds(list);
        return list.map(function (f) {
            var out = copyFrame(f);
            if (edge === "left") out.x = b.x;
            else if (edge === "right") out.x = b.x + b.width - out.width;
            else if (edge === "hcenter") out.x = b.x + (b.width - out.width) / 2;
            else if (edge === "top") out.y = b.y;
            else if (edge === "bottom") out.y = b.y + b.height - out.height;
            else if (edge === "vcenter") out.y = b.y + (b.height - out.height) / 2;
            return out;
        });
    }

    // Равномерное распределение фреймов вдоль оси: крайние остаются на месте,
    // зазоры между соседними рёбрами уравниваются (учитывает разные размеры).
    // axis: horizontal | vertical. Нужно ≥3 фрейма, иначе no-op. Порядок сохраняется.
    function distributeFrames(frames, axis) {
        var list = (frames || []).map(copyFrame);
        if (list.length < 3) return list;
        var horiz = axis !== "vertical";
        var pos = horiz ? "x" : "y";
        var dim = horiz ? "width" : "height";
        var idx = list.map(function (_, i) { return i; });
        idx.sort(function (a, c) { return list[a][pos] - list[c][pos]; });
        var first = idx[0], last = idx[idx.length - 1];
        var span = (list[last][pos] + list[last][dim]) - list[first][pos];
        var sumSize = 0;
        idx.forEach(function (i) { sumSize += list[i][dim]; });
        var gap = (span - sumSize) / (idx.length - 1);
        var cursor = list[first][pos];
        var out = list.map(copyFrame);
        idx.forEach(function (i) { out[i][pos] = cursor; cursor += list[i][dim] + gap; });
        return out;
    }

    function resizeFrames(frames, handle, delta, options) {
        var list = (frames || []).map(copyFrame);
        var start = frameBounds(list);
        options = options || {};
        var itemMin = Math.max(0, num(options.itemMin, 8));
        var minScaleX = 0, minScaleY = 0;
        list.forEach(function (frame) {
            minScaleX = Math.max(minScaleX, itemMin / Math.max(1, frame.width));
            minScaleY = Math.max(minScaleY, itemMin / Math.max(1, frame.height));
        });
        var next = resizeFrame(start, handle, delta, {
            shift: !!options.shift, alt: !!options.alt,
            width: { min: start.width * minScaleX }, height: { min: start.height * minScaleY }
        });
        var sx = next.width / Math.max(1, start.width), sy = next.height / Math.max(1, start.height);
        return {
            start: start,
            bounds: next,
            frames: list.map(function (frame) {
                return {
                    x: next.x + (frame.x - start.x) * sx,
                    y: next.y + (frame.y - start.y) * sy,
                    width: frame.width * sx, height: frame.height * sy,
                    rotation: frame.rotation
                };
            })
        };
    }

    function resizeFrame(frame, handle, delta, options) {
        var start = copyFrame(frame);
        options = options || {};
        delta = delta || {};
        var dx = num(delta.x, 0), dy = num(delta.y, 0);
        var west = String(handle || "").indexOf("w") >= 0;
        var east = String(handle || "").indexOf("e") >= 0;
        var north = String(handle || "").indexOf("n") >= 0;
        var south = String(handle || "").indexOf("s") >= 0;
        var horizontal = west || east, vertical = north || south;
        if (!horizontal && !vertical) return start;

        var width = start.width + (east ? dx : 0) - (west ? dx : 0);
        var height = start.height + (south ? dy : 0) - (north ? dy : 0);
        if (options.alt) {
            if (horizontal) width = start.width + (east ? 2 * dx : -2 * dx);
            if (vertical) height = start.height + (south ? 2 * dy : -2 * dy);
        }

        var ratio = start.height > 0 ? start.width / start.height : 1;
        if (options.shift && ratio > 0) {
            if (horizontal && vertical) {
                var relW = Math.abs(width - start.width) / Math.max(1, start.width);
                var relH = Math.abs(height - start.height) / Math.max(1, start.height);
                if (relW >= relH) height = width / ratio; else width = height * ratio;
            } else if (horizontal) height = width / ratio;
            else width = height * ratio;
        }

        width = clampSize(width, options.width);
        height = clampSize(height, options.height);
        if (options.shift && ratio > 0) {
            // Повторный ratio pass после clamp; более строгая ось определяет итоговый scale.
            var scale = Math.min(width / Math.max(1, start.width), height / Math.max(1, start.height));
            width = clampSize(start.width * scale, options.width);
            height = clampSize(width / ratio, options.height);
            width = clampSize(height * ratio, options.width);
        }

        var out = copyFrame(start);
        out.width = width; out.height = height;
        var cx = start.x + start.width / 2, cy = start.y + start.height / 2;
        if (options.alt || (options.shift && !horizontal)) out.x = cx - width / 2;
        else if (west) out.x = start.x + start.width - width;
        if (options.alt || (options.shift && !vertical)) out.y = cy - height / 2;
        else if (north) out.y = start.y + start.height - height;
        return out;
    }

    function applyParentResize(frame, oldParent, newParent, constraints, size) {
        var out = copyFrame(frame);
        oldParent = oldParent || {}; newParent = newParent || {}; constraints = constraints || {}; size = size || {};
        var oldW = Math.max(0, num(oldParent.width, 0)), oldH = Math.max(0, num(oldParent.height, 0));
        var newW = Math.max(0, num(newParent.width, oldW)), newH = Math.max(0, num(newParent.height, oldH));
        var h = constraints.horizontal || "left", v = constraints.vertical || "top";

        if (h === "right") out.x = newW - (oldW - out.x - out.width) - out.width;
        else if (h === "center") out.x = newW / 2 + (out.x + out.width / 2 - oldW / 2) - out.width / 2;
        else if (h === "stretch") {
            var right = oldW - out.x - out.width;
            out.width = clampSize(newW - out.x - right, size.width);
        }
        if (v === "bottom") out.y = newH - (oldH - out.y - out.height) - out.height;
        else if (v === "center") out.y = newH / 2 + (out.y + out.height / 2 - oldH / 2) - out.height / 2;
        else if (v === "stretch") {
            var bottom = oldH - out.y - out.height;
            out.height = clampSize(newH - out.y - bottom, size.height);
        }
        return out;
    }

    return {
        moveFrame: moveFrame,
        frameBounds: frameBounds,
        alignFrames: alignFrames,
        distributeFrames: distributeFrames,
        resizeFrames: resizeFrames,
        resizeFrame: resizeFrame,
        rotateFrame: rotateFrame,
        normalizeAngle: normalizeAngle,
        applyParentResize: applyParentResize,
        copyFrame: copyFrame
    };
});
