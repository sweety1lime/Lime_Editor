/* Lime editor Stage 7 performance instrumentation. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorPerf = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var loc = options.location || win.location || { search: "" };
        // doc — геттером: main переприсваивает doc на undo/redo/restore, прямая ссылка протухает.
        var getDoc = options.getDoc || function () { return {}; };
        var getActive = options.getActive || function () { return 0; };
        var setSelectedId = options.setSelectedId || noop;
        var pageBlocks = options.pageBlocks || function () { return []; };
        var rid = options.rid || function (prefix) { return (prefix || "id") + Math.random().toString(36).slice(2, 9); };
        var render = options.render || noop;
        var patchBlockDom = options.patchBlockDom || noop;
        var resetCommandStore = options.resetCommandStore || noop;
        var enabled = /[?&]perf=1\b/.test(loc.search || "") || !!win.__LIME_PERF_ON__;
        var stat = { full: { n: 0, ms: 0 }, inc: { n: 0, ms: 0 } };

        function now() {
            return (win.performance && win.performance.now) ? win.performance.now() : Date.now();
        }

        function record(kind, t0) {
            if (!enabled || !stat[kind]) return;
            stat[kind].n++;
            stat[kind].ms += now() - t0;
        }

        function reset() {
            stat.full = { n: 0, ms: 0 };
            stat.inc = { n: 0, ms: 0 };
        }

        function report() {
            var row = function (b) { return { calls: b.n, totalMs: +b.ms.toFixed(1), avgMs: b.n ? +(b.ms / b.n).toFixed(2) : 0 }; };
            var out = { "full render": row(stat.full), "incremental": row(stat.inc) };
            if (win.console && win.console.table) win.console.table(out);
            else if (win.console && win.console.log) win.console.log(JSON.stringify(out));
            return out;
        }

        function bench(reps) {
            reps = reps || 5;
            var leaf = null;
            var top = pageBlocks();
            for (var i = 0; i < top.length && !leaf; i++) {
                if (top[i].children && top[i].children.length) leaf = top[i].children[0];
            }
            if (!leaf) leaf = top[0];
            var full = 0, inc = 0, k;
            for (k = 0; k < reps; k++) { var a = now(); render(); full += now() - a; }
            for (k = 0; k < reps; k++) { var b = now(); patchBlockDom(leaf.id); inc += now() - b; }
            var fm = full / reps;
            var im = inc / reps;
            reset();
            if (win.console && win.console.log) {
                win.console.log("[LIME PERF] bench(" + reps + "): full render " + fm.toFixed(1) + "ms vs incremental patch " + im.toFixed(2) + "ms -> x" + (fm / im).toFixed(1) + " faster");
            }
            return { fullMs: +fm.toFixed(1), incMs: +im.toFixed(2), speedup: +(fm / im).toFixed(1) };
        }

        function load(n) {
            n = n || 500;
            var blocks = [], made = 0;
            while (made < n) {
                var kids = [], kc = Math.min(6, n - made);
                for (var i = 0; i < kc; i++) {
                    made++;
                    kids.push({ id: rid("b"), type: "text", content: { text: "Node " + made }, styles: { base: { color: "#222", fontSize: "16px" } } });
                }
                made++;
                blocks.push({ id: rid("b"), type: "container", content: {}, children: kids });
            }
            getDoc().pages[getActive()].blocks = blocks;
            setSelectedId(null);
            resetCommandStore();
            reset();
            var t0 = now();
            render();
            var dt = now() - t0;
            var total = blocks.length + blocks.reduce(function (a, b) { return a + b.children.length; }, 0);
            reset();
            if (win.console && win.console.log) {
                win.console.log("[LIME PERF] load(" + n + "): open render " + dt.toFixed(1) + "ms, ~" + total + " nodes. Make edits and call __LIME_PERF__.report()");
            }
            return { nodes: total, openMs: +dt.toFixed(1) };
        }

        if (enabled) {
            win.__LIME_PERF__ = {
                stat: stat,
                report: report,
                reset: reset,
                bench: bench,
                load: load
            };
        }

        return {
            enabled: enabled,
            stat: stat,
            now: now,
            record: record,
            report: report,
            reset: reset,
            bench: bench,
            load: load
        };
    }

    return { create: create };
});
