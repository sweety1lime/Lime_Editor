/* Lime Viewport — pure pan/zoom state and coordinate math for Editor V2 canvas. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeViewport = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function finite(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }
    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function createViewport(options) {
        options = options || {};
        var minZoom = Math.max(0.01, finite(options.minZoom, 0.1));
        var maxZoom = Math.max(minZoom, finite(options.maxZoom, 4));
        var state = {
            x: finite(options.x, 0),
            y: finite(options.y, 0),
            zoom: clamp(finite(options.zoom, 1), minZoom, maxZoom)
        };
        var listeners = [];

        function snapshot() { return { x: state.x, y: state.y, zoom: state.zoom }; }
        function emit() {
            var next = snapshot();
            listeners.slice().forEach(function (fn) { fn(next); });
            return next;
        }
        function set(next) {
            next = next || {};
            var x = finite(next.x, state.x);
            var y = finite(next.y, state.y);
            var zoom = clamp(finite(next.zoom, state.zoom), minZoom, maxZoom);
            if (x === state.x && y === state.y && zoom === state.zoom) return snapshot();
            state.x = x; state.y = y; state.zoom = zoom;
            return emit();
        }
        function canvasToScreen(point) {
            return { x: state.x + finite(point && point.x, 0) * state.zoom, y: state.y + finite(point && point.y, 0) * state.zoom };
        }
        function screenToCanvas(point) {
            return { x: (finite(point && point.x, 0) - state.x) / state.zoom, y: (finite(point && point.y, 0) - state.y) / state.zoom };
        }
        function panBy(dx, dy) { return set({ x: state.x + finite(dx, 0), y: state.y + finite(dy, 0) }); }
        function zoomAt(screenPoint, nextZoom) {
            var anchor = screenToCanvas(screenPoint || { x: 0, y: 0 });
            var z = clamp(finite(nextZoom, state.zoom), minZoom, maxZoom);
            return set({
                zoom: z,
                x: finite(screenPoint && screenPoint.x, 0) - anchor.x * z,
                y: finite(screenPoint && screenPoint.y, 0) - anchor.y * z
            });
        }
        function zoomBy(screenPoint, factor) {
            factor = finite(factor, 1);
            return zoomAt(screenPoint, state.zoom * factor);
        }
        function fitBounds(bounds, viewport, padding) {
            bounds = bounds || {};
            viewport = viewport || {};
            padding = Math.max(0, finite(padding, 32));
            var bw = Math.max(1, finite(bounds.width, 1));
            var bh = Math.max(1, finite(bounds.height, 1));
            var vw = Math.max(1, finite(viewport.width, 1) - padding * 2);
            var vh = Math.max(1, finite(viewport.height, 1) - padding * 2);
            var z = clamp(Math.min(vw / bw, vh / bh), minZoom, maxZoom);
            var bx = finite(bounds.x, 0), by = finite(bounds.y, 0);
            return set({
                zoom: z,
                x: (finite(viewport.width, 1) - bw * z) / 2 - bx * z,
                y: (finite(viewport.height, 1) - bh * z) / 2 - by * z
            });
        }
        function subscribe(fn) {
            if (typeof fn !== "function") return function () {};
            listeners.push(fn);
            return function () {
                var i = listeners.indexOf(fn);
                if (i >= 0) listeners.splice(i, 1);
            };
        }

        return {
            get: snapshot,
            set: set,
            panBy: panBy,
            zoomAt: zoomAt,
            zoomBy: zoomBy,
            fitBounds: fitBounds,
            canvasToScreen: canvasToScreen,
            screenToCanvas: screenToCanvas,
            subscribe: subscribe,
            limits: { minZoom: minZoom, maxZoom: maxZoom }
        };
    }

    return { createViewport: createViewport };
});
