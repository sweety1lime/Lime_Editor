"use strict";

const path = require("path");
const Perf = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-perf.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

const quiet = Perf.create({
    window: {},
    location: { search: "" }
});
quiet.record("full", quiet.now());
check("disabled mode does not count records", quiet.stat.full.n === 0);

let times = [];
let fallbackTime = 0;
const logs = [];
const win = {
    __LIME_PERF_ON__: true,
    performance: {
        now() {
            if (times.length) return times.shift();
            fallbackTime += 1;
            return fallbackTime;
        }
    },
    console: {
        log(msg) { logs.push(msg); },
        table(obj) { logs.push(JSON.stringify(obj)); }
    }
};
let doc = { pages: [{ blocks: [] }] };
let selectedId = "old";
let renderCalls = 0;
const patched = [];
let resetStoreCalls = 0;
let nextId = 0;

const api = Perf.create({
    window: win,
    location: { search: "?perf=1" },
    getDoc: () => doc,
    getActive: () => 0,
    setSelectedId(value) { selectedId = value; },
    pageBlocks: () => doc.pages[0].blocks,
    rid(prefix) { return prefix + "-" + (++nextId); },
    render() { renderCalls++; },
    patchBlockDom(id) { patched.push(id); },
    resetCommandStore() { resetStoreCalls++; }
});

check("enabled mode exposes window hook", api.enabled && !!win.__LIME_PERF__);
times = [10, 17];
const t0 = api.now();
api.record("full", t0);
const report = api.report();
check("record updates report", report["full render"].calls === 1 && report["full render"].totalMs === 7);
api.reset();
check("reset clears counters", api.stat.full.n === 0 && api.stat.inc.n === 0);

times = [100, 135];
const loaded = win.__LIME_PERF__.load(13);
check("load creates synthetic document", loaded.nodes >= 13 && doc.pages[0].blocks.length > 0);
check("load clears selection", selectedId === null);
check("load resets command store and renders", resetStoreCalls === 1 && renderCalls === 1);
check("load does not leave perf counters dirty", api.stat.full.n === 0 && api.stat.inc.n === 0);

// Регрессия stale-doc: main переприсваивает doc на undo/redo — load обязан писать
// в АКТУАЛЬНЫЙ doc через getDoc, а не в захваченный при create.
const swapped = { pages: [{ blocks: [] }] };
doc = swapped;
win.__LIME_PERF__.load(7);
check("load writes into live doc after doc swap", swapped.pages[0].blocks.length > 0);

times = [0, 20, 20, 40, 40, 45, 45, 50];
const bench = win.__LIME_PERF__.bench(2);
check("bench compares render and patch", bench.fullMs === 20 && bench.incMs === 5 && bench.speedup === 4);
check("bench calls patch for leaf blocks", patched.length === 2 && /^b-/.test(patched[0]));
check("bench resets counters", api.stat.full.n === 0 && api.stat.inc.n === 0);

if (failed) {
    console.error("PERF-FAIL " + failed);
    process.exit(1);
}
console.log("PERF-OK");
