/* Lime editor V2 layout inspector, actions and scrub preview. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorV2Layout = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var L = options.L || {};
        var ws = options.ws || null;
        var isCanvasOn = options.isCanvasOn || function () { return false; };
        var getDoc = options.getDoc || function () { return {}; };
        var getPageBlocks = options.getPageBlocks || function () { return []; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getCmdStore = options.getCmdStore || function () { return null; };
        var byId = options.byId || function () { return null; };
        var targetBlock = options.targetBlock || function (block) { return block; };
        var designTarget = options.designTarget || targetBlock;
        var resolvedBlockDesign = options.resolvedBlockDesign || function (block) {
            return L.resolvedDesign ? L.resolvedDesign((block && block.design) || {}, getCurrentBp()) : {};
        };
        var clone = options.clone || function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
        var setByPath = options.setByPath || function () {};
        var deleteByPath = options.deleteByPath || function () {};
        var setDesignValue = options.setDesignValue || function () {};
        var runCommands = options.runCommands || function () { return false; };
        var finishMutation = options.finishMutation || function () {};
        var refreshInspector = options.refreshInspector || function () {};
        var sec = options.sec || function (title, body) { return "<div>" + title + body + "</div>"; };
        var splitCssLength = options.splitCssLength || function (value, unit) {
            var num = parseFloat(value);
            return { num: isFinite(num) ? num : 0, unit: unit || "px", empty: value == null || value === "" };
        };
        var cssLengthValue = options.cssLengthValue || function (num, unit) { return unit ? String(num) + unit : num; };
        var unitSelectHtml = options.unitSelectHtml || function () { return ""; };
        var CSS_UNITS = options.CSS_UNITS || [];

        function currentBp() {
            return getCurrentBp();
        }

        function selectedSource() {
            var id = getSelectedId();
            return id && byId(id);
        }

        function v2CanvasEnabled() {
            return isCanvasOn() && !!L.resolvedDesign;
        }

        function ownDesignField(source, field) {
            var target = designTarget(source, field);
            var bp = currentBp();
            return clone(target && target.design && target.design[bp] && target.design[bp][field]) || {};
        }

        function designFieldSource(source, field) {
            var design = source && source.design || {};
            var bp = currentBp();
            if (design[bp] && Object.prototype.hasOwnProperty.call(design[bp], field)) return bp;
            if (bp === "mobile" && design.tablet && Object.prototype.hasOwnProperty.call(design.tablet, field)) return "tablet";
            if (bp !== "base" && design.base && Object.prototype.hasOwnProperty.call(design.base, field)) return "base";
            return "default";
        }

        function inheritedDesignField(source, field) {
            var design = source && source.design || {};
            var bp = currentBp();
            if (bp === "base") return null;
            var inheritedBp = bp === "mobile" ? "tablet" : "base";
            var value = L.resolvedDesign ? L.resolvedDesign(design, inheritedBp) : null;
            return value && value[field] || null;
        }

        function v2SourceRow(source, fields, lockedReset) {
            var unique = [];
            fields.forEach(function (field) { if (unique.indexOf(field) === -1) unique.push(field); });
            return '<div class="lime-v2-sources">' + unique.map(function (field) {
                var origin = designFieldSource(source, field);
                var own = origin === currentBp();
                var resettable = own && currentBp() !== "base" && !(lockedReset && lockedReset[field]);
                return '<span><b>' + field + '</b>: ' + origin + (resettable
                    ? ' <button type="button" data-v2-design-reset="' + field + '">сбросить</button>' : '') + '</span>';
            }).join("") + '</div>';
        }

        function isCssLengthValue(value) {
            if (typeof value === "number") return isFinite(value);
            return typeof value === "string" && /^-?(?:\d+|\d*\.\d+)(?:px|%|rem)$/.test(value.trim());
        }

        function clampCssLengthValue(value, min) {
            var parsed = splitCssLength(value, "px");
            var n = Math.max(min == null ? -Infinity : min, parsed.num);
            return cssLengthValue(n, parsed.unit || "px");
        }

        function designInputValue(input) {
            var n = parseFloat(input.value);
            if (!isFinite(n)) return null;
            var unit = input.getAttribute("data-v2-unit") || "";
            return unit ? cssLengthValue(n, unit) : n;
        }

        function buildDesignObjectPatch(source, field, path, value) {
            var next = ownDesignField(source, field);
            if (field === "layout" && !next.mode) {
                var resolved = resolvedBlockDesign(source, currentBp());
                next.mode = resolved && resolved.layout && resolved.layout.mode || "stack";
            }
            if (field === "size" && value !== undefined && /^(width|height)\./.test(path)) {
                var sizeAxis = path.split(".")[0];
                if (!next[sizeAxis]) next[sizeAxis] = {};
                if (!next[sizeAxis].mode) {
                    var resolvedSize = resolvedBlockDesign(source, currentBp()).size || {};
                    next[sizeAxis].mode = resolvedSize[sizeAxis] && resolvedSize[sizeAxis].mode || "hug";
                }
            }
            if (value !== undefined) {
                if (field === "layout" && path === "columns" && typeof value === "number") value = Math.max(1, Math.round(value));
                if (field === "layout" && path === "columns.min") value = clampCssLengthValue(value, 40);
                if (field === "layout" && (path === "gap" || path === "rowGap" || path === "columnGap" || path === "autoRows" || /^padding\./.test(path))) value = clampCssLengthValue(value, 0);
                if (field === "frame" && (path === "width" || path === "height")) value = clampCssLengthValue(value, 8);
                if (field === "size" && (/\.value$/.test(path) || /\.(min|max)$/.test(path))) value = clampCssLengthValue(value, 0);
                setByPath(next, path, value);
            } else deleteByPath(next, path);
            if (field === "size" && /^(width|height)\.mode$/.test(path) && value === "fixed") {
                var axis = path.split(".")[0];
                if (!next[axis] || !isCssLengthValue(next[axis].value)) {
                    if (!next[axis]) next[axis] = {};
                    var blockEl = ws && ws.querySelector('[data-block-id="' + source.id + '"]');
                    var scale = ws && ws.offsetWidth ? ws.getBoundingClientRect().width / ws.offsetWidth : 1;
                    if (!isFinite(scale) || scale <= 0) scale = 1;
                    var rect = blockEl && blockEl.getBoundingClientRect();
                    next[axis].value = Math.max(0, Math.round((rect ? rect[axis] : 100) / scale));
                }
            }
            return next;
        }

        function patchDesignObject(source, field, path, value) {
            if (!source || designTarget(source, field) !== source) return;
            var next = buildDesignObjectPatch(source, field, path, value);
            setDesignValue(source, currentBp(), field, next, false);
            refreshInspector();
        }

        function v2Number(label, field, path, value, min, units) {
            var parsed = units && units.length ? splitCssLength(value, "px") : { num: (typeof value === "number" && isFinite(value) ? value : 0), unit: "", empty: false };
            var n = parsed.empty ? 0 : parsed.num;
            return '<label class="lime-v2-field"><span class="lime-v2-scrub" data-scrub title="Тяни, чтобы менять (Shift ×10, Alt ×0.1)">' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1"' +
                (min == null ? "" : ' min="' + min + '"') + ' value="' + n + '"' + (units && units.length ? ' data-v2-unit="' + (parsed.unit || "px") + '"' : "") +
                ' data-v2-design-field="' + field + '" data-v2-design-path="' + path + '">' + unitSelectHtml("data-v2-unit-for", path, parsed.unit || "px", units) + '</label>';
        }

        function v2OptionalNumber(label, field, path, value, min, units) {
            var parsed = units && units.length ? splitCssLength(value, "px") : { num: (typeof value === "number" && isFinite(value) ? value : 0), unit: "", empty: value == null };
            var shown = value == null || parsed.empty ? "" : String(parsed.num);
            return '<label class="lime-v2-field"><span class="lime-v2-scrub" data-scrub title="Тяни, чтобы менять">' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1"' +
                (min == null ? "" : ' min="' + min + '"') + ' value="' + shown + '" placeholder="—"' + (units && units.length ? ' data-v2-unit="' + (parsed.unit || "px") + '"' : "") +
                ' data-v2-design-optional data-v2-design-field="' + field + '" data-v2-design-path="' + path + '">' + unitSelectHtml("data-v2-unit-for", path, parsed.unit || "px", units) + '</label>';
        }

        function v2ChildNumber(label, field, value, min) {
            var n = typeof value === "number" && isFinite(value) ? value : (field === "order" ? 0 : 1);
            return '<label class="lime-v2-field"><span class="lime-v2-scrub" data-scrub title="Тяни, чтобы менять">' + label + '</span><input class="lime-input lime-input--sm" type="number" step="1" min="' + min + '" value="' + n + '" data-v2-child-field="' + field + '"></label>';
        }

        function v2Select(label, field, path, value, options) {
            return '<label class="lime-v2-field"><span>' + label + '</span><select class="lime-select" data-v2-design-field="' + field + '" data-v2-design-path="' + path + '">' +
                options.map(function (o) { return '<option value="' + o.v + '"' + (value === o.v ? " selected" : "") + '>' + o.l + '</option>'; }).join("") +
                '</select></label>';
        }

        function v2SizeControls(design) {
            var size = design.size || {};
            var modes = [{ v: "hug", l: "Hug" }, { v: "fill", l: "Fill" }, { v: "fixed", l: "Fixed" }];
            var width = size.width || { mode: "hug" }, height = size.height || { mode: "hug" };
            var body = '<div class="lime-v2-fields">' +
                v2Select("Ширина", "size", "width.mode", width.mode || "hug", modes) +
                v2Select("Высота", "size", "height.mode", height.mode || "hug", modes) + '</div>';
            if (width.mode === "fixed" || height.mode === "fixed") {
                body += '<div class="lime-v2-fields">' +
                    (width.mode === "fixed" ? v2Number("W", "size", "width.value", width.value, 0, CSS_UNITS) : "") +
                    (height.mode === "fixed" ? v2Number("H", "size", "height.value", height.value, 0, CSS_UNITS) : "") + '</div>';
            }
            body += '<div class="lime-v2-subtitle">Min / Max</div><div class="lime-v2-fields">' +
                v2OptionalNumber("Min W", "size", "width.min", width.min, 0, CSS_UNITS) + v2OptionalNumber("Max W", "size", "width.max", width.max, 0, CSS_UNITS) +
                v2OptionalNumber("Min H", "size", "height.min", height.min, 0, CSS_UNITS) + v2OptionalNumber("Max H", "size", "height.max", height.max, 0, CSS_UNITS) + '</div>';
            return body;
        }

        function v2LayoutInspector(source, found) {
            if (!v2CanvasEnabled() || !source) return "";
            var isInstance = source.type === "component";
            if (!isInstance && targetBlock(source) !== source) return "";
            var design = resolvedBlockDesign(source, currentBp());
            var fields = ["size"];
            var lockedReset = {};
            var out = v2SizeControls(design);
            if (!isInstance && L.isContainer(source.type)) {
                fields.unshift("layout");
                var layout = design.layout || {};
                var mode = layout.mode || "stack";
                out = '<div class="lime-segmented">' + ["stack", "grid", "free"].map(function (m) {
                    return '<button type="button" class="' + (mode === m ? "is-active" : "") + '" data-v2-layout-mode="' + m + '">' + m + '</button>';
                }).join("") + '</div>';
                if (mode === "stack") {
                    out += '<div class="lime-segmented"><button type="button" class="' + (layout.direction !== "horizontal" ? "is-active" : "") + '" data-v2-layout-direction="vertical">Вертикально</button>' +
                        '<button type="button" class="' + (layout.direction === "horizontal" ? "is-active" : "") + '" data-v2-layout-direction="horizontal">Горизонтально</button></div>';
                    out += '<div class="lime-v2-fields">' +
                        v2Select("Align", "layout", "align", layout.align || "stretch", [{ v: "start", l: "Start" }, { v: "center", l: "Center" }, { v: "end", l: "End" }, { v: "stretch", l: "Stretch" }, { v: "baseline", l: "Baseline" }]) +
                        v2Select("Justify", "layout", "justify", layout.justify || "start", [{ v: "start", l: "Start" }, { v: "center", l: "Center" }, { v: "end", l: "End" }, { v: "space-between", l: "Between" }, { v: "space-around", l: "Around" }, { v: "space-evenly", l: "Evenly" }]) + '</div>' +
                        '<div class="lime-segmented"><button type="button" class="' + (!layout.wrap ? "is-active" : "") + '" data-v2-layout-wrap="0">Без переноса</button>' +
                        '<button type="button" class="' + (layout.wrap ? "is-active" : "") + '" data-v2-layout-wrap="1">Wrap</button></div>';
                }
                if (mode === "grid") {
                    var colsAuto = layout.columns && typeof layout.columns === "object" && layout.columns.mode === "auto";
                    out += '<div class="lime-segmented"><button type="button" class="' + (!colsAuto ? "is-active" : "") + '" data-v2-grid-auto="0">Фикс.</button>' +
                        '<button type="button" class="' + (colsAuto ? "is-active" : "") + '" data-v2-grid-auto="1">Авто</button></div>';
                    if (colsAuto) {
                        out += '<div class="lime-v2-fields">' + v2Number("Min", "layout", "columns.min", layout.columns.min || 240, 40, CSS_UNITS) + '</div>' +
                            '<div class="lime-segmented"><button type="button" class="' + (!layout.columns.fill ? "is-active" : "") + '" data-v2-grid-fill="0">Auto-fit</button>' +
                            '<button type="button" class="' + (layout.columns.fill ? "is-active" : "") + '" data-v2-grid-fill="1">Auto-fill</button></div>';
                    } else {
                        out += '<div class="lime-v2-fields">' + v2Number("Колонки", "layout", "columns", (typeof layout.columns === "number" ? layout.columns : 2), 1) + '</div>';
                    }
                    out += '<div class="lime-v2-fields">' + v2OptionalNumber("Auto rows", "layout", "autoRows", layout.autoRows, 1, CSS_UNITS) + '</div>';
                }
                out += '<div class="lime-v2-fields">' +
                    (mode !== "free" ? v2Number("Gap", "layout", "gap", layout.gap || 0, 0, CSS_UNITS) : "") + '</div>' + v2SizeControls(design);
                if (mode !== "free") {
                    var padding = layout.padding || {};
                    out += '<div class="lime-v2-subtitle">Padding</div><div class="lime-v2-fields">' +
                        v2Number("Top", "layout", "padding.top", padding.top || 0, 0, CSS_UNITS) + v2Number("Right", "layout", "padding.right", padding.right || 0, 0, CSS_UNITS) +
                        v2Number("Bottom", "layout", "padding.bottom", padding.bottom || 0, 0, CSS_UNITS) + v2Number("Left", "layout", "padding.left", padding.left || 0, 0, CSS_UNITS) + '</div>';
                }
                if (mode === "free") out += '<div class="lime-inspector__hint">Дети можно двигать и растягивать прямо на холсте. Стрелки: move, Shift: 10px, Ctrl/Cmd: resize.</div>';
                if (mode === "free") lockedReset.size = true;
            }
            var parent = found && found.parentBlock && targetBlock(found.parentBlock);
            var parentDesign = parent && L.resolvedDesign && L.resolvedDesign(parent.design, currentBp());
            if (parentDesign && parentDesign.layout && parentDesign.layout.mode === "free") {
                fields.push("frame", "constraints");
                if (!inheritedDesignField(source, "frame")) lockedReset.frame = true;
                var frame = design.frame || { x: 0, y: 0, width: 100, height: 100 };
                var constraints = design.constraints || { horizontal: "left", vertical: "top" };
                out += '<div class="lime-v2-subtitle">Frame</div><div class="lime-v2-fields">' +
                    v2Number("X", "frame", "x", frame.x) + v2Number("Y", "frame", "y", frame.y) +
                    v2Number("W", "frame", "width", frame.width, 8) + v2Number("H", "frame", "height", frame.height, 8) + '</div>' +
                    '<div class="lime-v2-subtitle">Constraints</div><div class="lime-v2-fields">' +
                    v2Select("По X", "constraints", "horizontal", constraints.horizontal || "left", [{ v: "left", l: "Left" }, { v: "right", l: "Right" }, { v: "center", l: "Center" }, { v: "stretch", l: "Stretch" }]) +
                    v2Select("По Y", "constraints", "vertical", constraints.vertical || "top", [{ v: "top", l: "Top" }, { v: "bottom", l: "Bottom" }, { v: "center", l: "Center" }, { v: "stretch", l: "Stretch" }]) + '</div>';
            }
            if (!isInstance && parentDesign && parentDesign.layout && parentDesign.layout.mode === "stack") {
                fields.push("order");
                out += '<div class="lime-v2-subtitle">Stack child</div><div class="lime-v2-fields">' +
                    v2ChildNumber("Order", "order", design.order, -1000) + '</div>';
            }
            if (!isInstance && parentDesign && parentDesign.layout && parentDesign.layout.mode === "grid") {
                fields.push("span", "rowSpan");
                var spanVal = (typeof design.span === "number" && design.span > 0) ? Math.floor(design.span) : 1;
                var rowSpanVal = (typeof design.rowSpan === "number" && design.rowSpan > 0) ? Math.floor(design.rowSpan) : 1;
                out += '<div class="lime-v2-subtitle">Grid</div><div class="lime-v2-fields">' +
                    v2ChildNumber("Column span", "span", spanVal, 1) + v2ChildNumber("Row span", "rowSpan", rowSpanVal, 1) + '</div>';
            }
            if (!isInstance) {
                fields.push("overflow");
                var ovf = design.overflow === "hidden" ? "hidden" : "visible";
                out += '<div class="lime-v2-subtitle">Overflow</div><div class="lime-segmented">' +
                    [["visible", "Видно"], ["hidden", "Обрезать"]].map(function (o) {
                        return '<button type="button" class="' + (ovf === o[0] ? "is-active" : "") + '" data-v2-overflow="' + o[0] + '">' + o[1] + '</button>';
                    }).join("") + '</div>';
            }
            return sec("Layout · V2", out + v2SourceRow(source, fields, lockedReset));
        }

        function switchV2LayoutMode(mode) {
            var source = selectedSource();
            if (!source || targetBlock(source) !== source || !L.isContainer(source.type)) return;
            var effective = L.resolvedDesign(source.design, currentBp());
            if (((effective.layout && effective.layout.mode) || "stack") === mode) return;
            var layout = ownDesignField(source, "layout");
            layout.mode = mode;
            if (mode !== "free") {
                setDesignValue(source, currentBp(), "layout", layout, false);
                refreshInspector();
                return;
            }

            var children = source.children || [];
            var parentEl = ws && ws.querySelector('[data-block-id="' + source.id + '"]');
            var wrapper = parentEl && parentEl.querySelector(":scope > .lime-block__inner > .lime-block__children");
            var scale = ws && ws.offsetWidth ? ws.getBoundingClientRect().width / ws.offsetWidth : 1;
            if (!isFinite(scale) || scale <= 0) scale = 1;
            var wr = wrapper && wrapper.getBoundingClientRect();
            var pr = parentEl && parentEl.getBoundingClientRect();
            var size = ownDesignField(source, "size");
            if (!size.height || size.height.mode !== "fixed") size.height = { mode: "fixed", value: Math.max(8, Math.round((pr ? pr.height : 320) / scale)) };
            var commands = [
                { type: "setDesign", payload: { id: source.id, breakpoint: currentBp(), field: "layout", value: layout } },
                { type: "setDesign", payload: { id: source.id, breakpoint: currentBp(), field: "size", value: size } }
            ];
            var frames = [];
            children.forEach(function (child) {
                var childEl = ws && ws.querySelector('[data-block-id="' + child.id + '"]');
                if (!childEl || !wr) return;
                var cr = childEl.getBoundingClientRect();
                var frame = {
                    x: Math.round((cr.left - wr.left) / scale), y: Math.round((cr.top - wr.top) / scale),
                    width: Math.max(8, Math.round(cr.width / scale)), height: Math.max(8, Math.round(cr.height / scale)), rotation: 0
                };
                frames.push({ child: child, frame: frame });
                commands.push({ type: "setDesign", payload: { id: child.id, breakpoint: currentBp(), field: "frame", value: frame } });
            });
            if (getCmdStore()) {
                var changed = runCommands(commands, "layout-to-free");
                finishMutation(changed);
            } else {
                if (!source.design) source.design = {};
                if (!source.design[currentBp()]) source.design[currentBp()] = {};
                source.design[currentBp()].layout = layout; source.design[currentBp()].size = size;
                frames.forEach(function (item) {
                    if (!item.child.design) item.child.design = {};
                    if (!item.child.design[currentBp()]) item.child.design[currentBp()] = {};
                    item.child.design[currentBp()].frame = item.frame;
                });
                finishMutation(false);
            }
        }

        function resetDesignField(field) {
            var source = selectedSource();
            if (source) {
                setDesignValue(source, currentBp(), field, null, true);
                refreshInspector();
            }
        }

        function setLayoutDirection(value) {
            patchDesignObject(selectedSource(), "layout", "direction", value);
        }

        function setLayoutWrap(enabled) {
            patchDesignObject(selectedSource(), "layout", "wrap", !!enabled);
        }

        function setGridAuto(enabled) {
            patchDesignObject(selectedSource(), "layout", "columns", enabled ? { mode: "auto", min: 240 } : 2);
        }

        function setGridFill(enabled) {
            patchDesignObject(selectedSource(), "layout", "columns.fill", !!enabled);
        }

        function setOverflow(value) {
            var source = selectedSource();
            var hidden = value === "hidden";
            if (source) {
                setDesignValue(source, currentBp(), "overflow", hidden ? "hidden" : null, !hidden);
                refreshInspector();
            }
        }

        function applyDesignInput(input) {
            var field = input.getAttribute("data-v2-design-field");
            var path = input.getAttribute("data-v2-design-path");
            if (!field || !path) return false;
            var source = selectedSource();
            if (input.hasAttribute("data-v2-design-optional") && input.value.trim() === "") {
                patchDesignObject(source, field, path, undefined);
                return true;
            }
            var value = input.type === "number" ? designInputValue(input) : input.value;
            if (input.type === "number" && value == null) return true;
            patchDesignObject(source, field, path, value);
            return true;
        }

        function applyChildDesignInput(input) {
            var childField = input.getAttribute("data-v2-child-field");
            if (!childField) return false;
            var source = selectedSource();
            var value = Math.round(parseFloat(input.value));
            if (!isFinite(value)) return true;
            if (childField === "span" || childField === "rowSpan") value = Math.max(1, value);
            var removeChildField = currentBp() === "base" && ((childField === "order" && value === 0) || (childField !== "order" && value <= 1));
            if (source) setDesignValue(source, currentBp(), childField, removeChildField ? null : value, removeChildField);
            return true;
        }

        function applyUnitChange(input) {
            var path = input.getAttribute("data-v2-unit-for");
            if (!path) return false;
            var field = input.closest(".lime-v2-field");
            var designInput = field && field.querySelector("[data-v2-design-field]");
            if (!designInput) return true;
            designInput.setAttribute("data-v2-unit", input.value);
            if (designInput.value.trim() !== "") designInput.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
        }

        function scrubPreviewStyle() {
            if (!ws || !ws.ownerDocument) return null;
            var style = ws.querySelector("style[data-lime-design-scrub-preview]");
            if (!style) {
                style = ws.ownerDocument.createElement("style");
                style.setAttribute("data-lime-design-scrub-preview", "1");
                ws.appendChild(style);
            }
            return style;
        }

        function clearScrubPreview() {
            if (!ws) return;
            var style = ws.querySelector("style[data-lime-design-scrub-preview]");
            if (style) style.remove();
        }

        function withTemporaryDesign(source, field, value, fn) {
            var target = designTarget(source, field);
            if (!target) return;
            var before = target.design;
            target.design = clone(before || {});
            if (!target.design[currentBp()]) target.design[currentBp()] = {};
            if (value === undefined) delete target.design[currentBp()][field];
            else target.design[currentBp()][field] = value;
            try { fn(); }
            finally { if (before === undefined) delete target.design; else target.design = before; }
        }

        function previewDesignInput(input) {
            var source = selectedSource();
            var field = input.getAttribute("data-v2-design-field");
            var path = input.getAttribute("data-v2-design-path");
            if (!source || !field || !path || designTarget(source, field) !== source) return;
            if (input.hasAttribute("data-v2-design-optional") && input.value.trim() === "") {
                clearScrubPreview();
                return;
            }
            var value = designInputValue(input);
            if (value == null) return;
            var next = buildDesignObjectPatch(source, field, path, value);
            withTemporaryDesign(source, field, next, function () {
                var style = scrubPreviewStyle();
                if (style && L.compilePreviewDesignCss) style.textContent = L.compilePreviewDesignCss(getPageBlocks(), (getDoc() || {}).components, currentBp());
            });
        }

        function previewChildDesignInput(input) {
            var source = selectedSource();
            var childField = input.getAttribute("data-v2-child-field");
            if (!source || !childField) return;
            var value = Math.round(parseFloat(input.value));
            if (!isFinite(value)) return;
            if (childField === "span" || childField === "rowSpan") value = Math.max(1, value);
            withTemporaryDesign(source, childField, value, function () {
                var style = scrubPreviewStyle();
                if (style && L.compilePreviewDesignCss) style.textContent = L.compilePreviewDesignCss(getPageBlocks(), (getDoc() || {}).components, currentBp());
            });
        }

        return {
            applyChildDesignInput: applyChildDesignInput,
            applyDesignInput: applyDesignInput,
            applyUnitChange: applyUnitChange,
            clearScrubPreview: clearScrubPreview,
            patchDesignObject: patchDesignObject,
            previewChildDesignInput: previewChildDesignInput,
            previewDesignInput: previewDesignInput,
            resetDesignField: resetDesignField,
            setGridAuto: setGridAuto,
            setGridFill: setGridFill,
            setLayoutDirection: setLayoutDirection,
            setLayoutWrap: setLayoutWrap,
            setOverflow: setOverflow,
            switchV2LayoutMode: switchV2LayoutMode,
            v2LayoutInspector: v2LayoutInspector
        };
    }

    return { create: create };
});
