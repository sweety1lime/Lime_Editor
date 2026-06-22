/* Lime Selection — editor-only selection state and geometry for Editor V2. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeSelection = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function uniqueIds(ids) {
        var seen = {}, out = [];
        (ids || []).forEach(function (id) {
            if (typeof id === "string" && id && !seen[id]) { seen[id] = true; out.push(id); }
        });
        return out;
    }
    function createSelection(initialIds) {
        var ids = uniqueIds(initialIds);
        var listeners = [];
        function get() { return { ids: ids.slice(), primaryId: ids.length ? ids[ids.length - 1] : null }; }
        function emit() {
            var state = get();
            listeners.slice().forEach(function (fn) { fn(state); });
            return state;
        }
        function replace(next) {
            next = uniqueIds(next);
            if (next.length === ids.length && next.every(function (id, i) { return id === ids[i]; })) return get();
            ids = next;
            return emit();
        }
        function select(id, options) {
            options = options || {};
            if (typeof id !== "string" || !id) return get();
            if (!options.additive && !options.toggle) return replace([id]);
            var next = ids.slice();
            var i = next.indexOf(id);
            if (options.toggle && i >= 0) next.splice(i, 1);
            else {
                if (i >= 0) next.splice(i, 1);
                next.push(id); // последний выбранный — primary
            }
            return replace(next);
        }
        function remove(id) { return replace(ids.filter(function (x) { return x !== id; })); }
        function clear() { return replace([]); }
        function subscribe(fn) {
            if (typeof fn !== "function") return function () {};
            listeners.push(fn);
            return function () {
                var i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
            };
        }
        return {
            get: get,
            replace: replace,
            select: select,
            remove: remove,
            clear: clear,
            has: function (id) { return ids.indexOf(id) >= 0; },
            subscribe: subscribe
        };
    }

    function normalizeRect(rect) {
        rect = rect || {};
        var x1 = Number(rect.x1 != null ? rect.x1 : rect.x) || 0;
        var y1 = Number(rect.y1 != null ? rect.y1 : rect.y) || 0;
        var x2 = Number(rect.x2 != null ? rect.x2 : x1 + (Number(rect.width) || 0)) || 0;
        var y2 = Number(rect.y2 != null ? rect.y2 : y1 + (Number(rect.height) || 0)) || 0;
        return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
    }
    function candidateRect(candidate) { return normalizeRect(candidate && candidate.rect); }
    function pointIn(rect, point) {
        return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    }
    function intersects(a, b) {
        return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
    }
    function contains(outer, inner) {
        return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
    }
    function usable(c) { return c && c.id && !c.hidden && !c.locked; }

    function hitTest(candidates, point) {
        point = point || { x: 0, y: 0 };
        var hits = (candidates || []).filter(function (c) { return usable(c) && pointIn(candidateRect(c), point); });
        hits.sort(function (a, b) {
            return (Number(b.depth) || 0) - (Number(a.depth) || 0) ||
                (Number(b.zIndex) || 0) - (Number(a.zIndex) || 0) ||
                (Number(b.order) || 0) - (Number(a.order) || 0);
        });
        return hits.length ? hits[0] : null;
    }
    function marquee(candidates, rect, options) {
        var area = normalizeRect(rect);
        var containOnly = options && options.contain;
        return uniqueIds((candidates || []).filter(function (c) {
            if (!usable(c)) return false;
            var r = candidateRect(c);
            return containOnly ? contains(area, r) : intersects(area, r);
        }).map(function (c) { return c.id; }));
    }

    return {
        createSelection: createSelection,
        normalizeRect: normalizeRect,
        hitTest: hitTest,
        marquee: marquee
    };
});
