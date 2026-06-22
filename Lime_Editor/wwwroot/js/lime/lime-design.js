/* Lime Design — pure schema helpers for Editor V2 (resolver/index/validator). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeDesign = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var MAX_DOC_NODES = 5000;
    var MAX_PAGE_NODES = 1000;
    var MAX_DEPTH = 20;
    var MODES = { stack: 1, grid: 1, free: 1 };
    var DIRECTIONS = { horizontal: 1, vertical: 1 };
    var ALIGNS = { start: 1, center: 1, end: 1, stretch: 1, baseline: 1 };
    var JUSTIFIES = { start: 1, center: 1, end: 1, "space-between": 1, "space-around": 1, "space-evenly": 1 };
    var SIZE_MODES = { hug: 1, fill: 1, fixed: 1 };
    var H_CONSTRAINTS = { left: 1, right: 1, center: 1, stretch: 1 };
    var V_CONSTRAINTS = { top: 1, bottom: 1, center: 1, stretch: 1 };

    function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
    function clone(v) {
        if (Array.isArray(v)) return v.map(clone);
        if (isObject(v)) {
            var out = {};
            Object.keys(v).forEach(function (k) { out[k] = clone(v[k]); });
            return out;
        }
        return v;
    }
    function deepMerge(base, override) {
        var out = clone(base || {});
        if (!isObject(override)) return out;
        Object.keys(override).forEach(function (k) {
            var v = override[k];
            out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : clone(v);
        });
        return out;
    }

    function resolveDesign(design, breakpoint) {
        design = design || {};
        var out = deepMerge({}, design.base || {});
        if (breakpoint === "tablet" || breakpoint === "mobile") out = deepMerge(out, design.tablet || {});
        if (breakpoint === "mobile") out = deepMerge(out, design.mobile || {});
        return out;
    }

    function buildIndex(doc) {
        var index = {};
        var errors = [];
        var seenObjects = typeof WeakSet !== "undefined" ? new WeakSet() : null;
        function walk(blocks, base, parentId, depth, exactFirstPath) {
            if (!Array.isArray(blocks)) return;
            for (var i = 0; i < blocks.length; i++) {
                var b = blocks[i];
                var path = exactFirstPath && i === 0 ? exactFirstPath : base.concat(i);
                if (!b || typeof b !== "object") continue;
                if (seenObjects) {
                    if (seenObjects.has(b)) {
                        errors.push({ path: path, code: "cycle", message: "Block object occurs more than once" });
                        continue;
                    }
                    seenObjects.add(b);
                }
                if (typeof b.id === "string" && b.id) {
                    if (index[b.id]) errors.push({ path: path.concat("id"), code: "duplicate_id", message: "Duplicate id: " + b.id });
                    else index[b.id] = { path: path, parentId: parentId || null, depth: depth, block: b };
                }
                if (depth < MAX_DEPTH && Array.isArray(b.children)) walk(b.children, path.concat("children"), b.id || null, depth + 1);
            }
        }
        ((doc && doc.pages) || []).forEach(function (p, pi) {
            walk((p && p.blocks) || [], ["pages", pi, "blocks"], null, 1);
        });
        Object.keys((doc && doc.components) || {}).forEach(function (key) {
            var def = doc.components[key] && doc.components[key].block;
            if (def) walk([def], [], null, 1, ["components", key, "block"]);
        });
        return { index: index, errors: errors };
    }

    function validateDoc(doc) {
        var errors = [];
        var total = 0;
        function error(path, code, message) { errors.push({ path: path, code: code, message: message }); }
        function finiteAt(v, path, nonNegative) {
            if (v == null) return;
            if (typeof v !== "number" || !isFinite(v) || (nonNegative && v < 0)) error(path, "invalid_number", "Expected " + (nonNegative ? "non-negative " : "") + "finite number");
        }
        function validateSize(axis, path) {
            if (!isObject(axis)) { error(path, "invalid_size", "Size axis must be an object"); return; }
            if (!SIZE_MODES[axis.mode]) error(path.concat("mode"), "invalid_size_mode", "Unknown size mode");
            if (axis.mode === "fixed" && (typeof axis.value !== "number" || !isFinite(axis.value) || axis.value < 0)) error(path.concat("value"), "fixed_value_required", "Fixed size requires non-negative value");
            finiteAt(axis.min, path.concat("min"), true);
            finiteAt(axis.max, path.concat("max"), true);
        }
        function validateBucket(bucket, path) {
            if (!isObject(bucket)) { error(path, "invalid_bucket", "Design bucket must be an object"); return; }
            var layout = bucket.layout;
            if (layout != null) {
                if (!isObject(layout)) error(path.concat("layout"), "invalid_layout", "Layout must be an object");
                else {
                    if (layout.mode != null && !MODES[layout.mode]) error(path.concat("layout", "mode"), "invalid_layout_mode", "Unknown layout mode");
                    if (layout.direction != null && !DIRECTIONS[layout.direction]) error(path.concat("layout", "direction"), "invalid_direction", "Unknown stack direction");
                    if (layout.align != null && !ALIGNS[layout.align]) error(path.concat("layout", "align"), "invalid_align", "Unknown alignment");
                    if (layout.justify != null && !JUSTIFIES[layout.justify]) error(path.concat("layout", "justify"), "invalid_justify", "Unknown justification");
                    if (layout.wrap != null && typeof layout.wrap !== "boolean") error(path.concat("layout", "wrap"), "invalid_wrap", "Wrap must be boolean");
                    ["gap", "rowGap", "columnGap"].forEach(function (k) { finiteAt(layout[k], path.concat("layout", k), true); });
                    if (layout.columns != null) {
                        if (typeof layout.columns === "number") {
                            if (!isFinite(layout.columns) || Math.floor(layout.columns) !== layout.columns || layout.columns < 1) error(path.concat("layout", "columns"), "invalid_columns", "Columns must be a positive integer");
                        } else if (!isObject(layout.columns) || layout.columns.mode !== "auto" || typeof layout.columns.min !== "number" || !isFinite(layout.columns.min) || layout.columns.min <= 0) {
                            error(path.concat("layout", "columns"), "invalid_columns", "Auto columns require a positive min");
                        } else {
                            if (layout.columns.max != null) finiteAt(layout.columns.max, path.concat("layout", "columns", "max"), true);
                            if (layout.columns.fill != null && typeof layout.columns.fill !== "boolean") error(path.concat("layout", "columns", "fill"), "invalid_columns_fill", "Auto columns fill must be boolean");
                        }
                    }
                    if (layout.padding != null) {
                        if (!isObject(layout.padding)) error(path.concat("layout", "padding"), "invalid_padding", "Padding must be an object");
                        else ["top", "right", "bottom", "left"].forEach(function (k) { finiteAt(layout.padding[k], path.concat("layout", "padding", k), true); });
                    }
                }
            }
            if (bucket.size != null) {
                if (!isObject(bucket.size)) error(path.concat("size"), "invalid_size", "Size must be an object");
                else {
                    if (bucket.size.width != null) validateSize(bucket.size.width, path.concat("size", "width"));
                    if (bucket.size.height != null) validateSize(bucket.size.height, path.concat("size", "height"));
                }
            }
            if (bucket.frame != null) {
                if (!isObject(bucket.frame)) error(path.concat("frame"), "invalid_frame", "Frame must be an object");
                else {
                    finiteAt(bucket.frame.x, path.concat("frame", "x"), false);
                    finiteAt(bucket.frame.y, path.concat("frame", "y"), false);
                    finiteAt(bucket.frame.width, path.concat("frame", "width"), true);
                    finiteAt(bucket.frame.height, path.concat("frame", "height"), true);
                    finiteAt(bucket.frame.rotation, path.concat("frame", "rotation"), false);
                }
            }
            if (bucket.constraints != null) {
                var c = bucket.constraints;
                if (!isObject(c)) error(path.concat("constraints"), "invalid_constraints", "Constraints must be an object");
                else {
                    if (c.horizontal != null && !H_CONSTRAINTS[c.horizontal]) error(path.concat("constraints", "horizontal"), "invalid_constraint", "Unknown horizontal constraint");
                    if (c.vertical != null && !V_CONSTRAINTS[c.vertical]) error(path.concat("constraints", "vertical"), "invalid_constraint", "Unknown vertical constraint");
                }
            }
            finiteAt(bucket.zIndex, path.concat("zIndex"), false);
            if (bucket.overflow != null && bucket.overflow !== "visible" && bucket.overflow !== "hidden") error(path.concat("overflow"), "invalid_overflow", "Overflow must be visible or hidden");
            if (bucket.span != null && (typeof bucket.span !== "number" || !isFinite(bucket.span) || Math.floor(bucket.span) !== bucket.span || bucket.span < 1)) error(path.concat("span"), "invalid_span", "Span must be a positive integer");
        }
        function walk(blocks, base, depth, pageCounter, parentMode, exactFirstPath) {
            if (!Array.isArray(blocks)) { error(base, "invalid_children", "Blocks must be an array"); return; }
            for (var i = 0; i < blocks.length; i++) {
                var b = blocks[i];
                var path = exactFirstPath && i === 0 ? exactFirstPath : base.concat(i);
                total++; pageCounter.count++;
                if (depth > MAX_DEPTH) { error(path, "max_depth", "Tree depth exceeds " + MAX_DEPTH); continue; }
                if (!isObject(b)) { error(path, "invalid_block", "Block must be an object"); continue; }
                if (typeof b.id !== "string" || !b.id) error(path.concat("id"), "invalid_id", "Block id is required");
                if (b.parentId != null) error(path.concat("parentId"), "persisted_parent_id", "parentId is runtime-only in v2");
                if (b.design != null) {
                    if (!isObject(b.design)) error(path.concat("design"), "invalid_design", "Design must be an object");
                    else ["base", "tablet", "mobile"].forEach(function (bp) {
                        if (b.design[bp] == null) return;
                        validateBucket(b.design[bp], path.concat("design", bp));
                        if (b.type === "component" && isObject(b.design[bp])) {
                            var instanceAllowed = { frame: 1, size: 1, constraints: 1, zIndex: 1 };
                            Object.keys(b.design[bp]).forEach(function (field) {
                                if (!instanceAllowed[field]) error(path.concat("design", bp, field), "invalid_instance_design", "Component instance design is geometry-only");
                            });
                        }
                    });
                }
                var resolved = resolveDesign(b.design, "base");
                if (parentMode === "free" && !isObject(resolved.frame)) error(path.concat("design", "base", "frame"), "frame_required", "Child of free layout requires base frame");
                if (resolved.layout && resolved.layout.mode === "free" && resolved.size) {
                    ["width", "height"].forEach(function (axis) {
                        if (resolved.size[axis] && resolved.size[axis].mode === "hug") error(path.concat("design", "base", "size", axis), "free_hug_forbidden", "Free layout cannot hug absolutely positioned children");
                    });
                }
                if (b.children != null) walk(b.children, path.concat("children"), depth + 1, pageCounter, resolved.layout && resolved.layout.mode);
            }
        }

        if (!isObject(doc)) return [{ path: [], code: "invalid_doc", message: "Document must be an object" }];
        if (!Array.isArray(doc.pages)) error(["pages"], "invalid_pages", "pages must be an array");
        else doc.pages.forEach(function (p, pi) {
            var counter = { count: 0 };
            walk((p && p.blocks) || [], ["pages", pi, "blocks"], 1, counter, null);
            if (counter.count > MAX_PAGE_NODES) error(["pages", pi, "blocks"], "max_page_nodes", "Page exceeds " + MAX_PAGE_NODES + " nodes");
        });
        Object.keys(doc.components || {}).forEach(function (key) {
            var def = doc.components[key] && doc.components[key].block;
            if (def) walk([def], [], 1, { count: 0 }, null, ["components", key, "block"]);
        });
        if (total > MAX_DOC_NODES) error([], "max_doc_nodes", "Document exceeds " + MAX_DOC_NODES + " nodes");
        var indexed = buildIndex(doc);
        return errors.concat(indexed.errors);
    }

    return {
        resolveDesign: resolveDesign,
        deepMerge: deepMerge,
        buildIndex: buildIndex,
        validateDoc: validateDoc,
        limits: { maxDocNodes: MAX_DOC_NODES, maxPageNodes: MAX_PAGE_NODES, maxDepth: MAX_DEPTH }
    };
});
