/* Lime editor V2 canvas viewport, selection, handles and palette drag. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorV2Canvas = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var window = win;
        var document = options.document || win.document || {};
        var performance = win.performance || { now: function () { return Date.now(); } };
        var L = options.L || {};
        var ws = options.ws || null;
        var isCanvasOn = options.isCanvasOn || function () { return false; };
        var findBlock = options.findBlock || function () { return null; };
        var byId = options.byId || function () { return null; };
        var targetBlock = options.targetBlock || function (block) { return block; };
        var resolvedBlockDesign = options.resolvedBlockDesign || function (block) {
            return L.resolvedDesign ? L.resolvedDesign((block && block.design) || {}, state.currentBp) : {};
        };
        var clone = options.clone || function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
        var refreshInspector = options.refreshInspector || noop;
        var refreshLayers = options.refreshLayers || noop;
        var runBlockOp = options.runBlockOp || noop;
        var ico = options.ico || function () { return ""; };
        var isTextField = options.isTextField || function () { return false; };
        var render = options.render || noop;
        var runCommands = options.runCommands || function () { return false; };
        var finishMutation = options.finishMutation || noop;
        var setDesignValue = options.setDesignValue || noop;
        var beginCheckpointMutation = options.beginCheckpointMutation || noop;
        var pageBlocks = options.pageBlocks || function () { return []; };
        var runCommand = options.runCommand || function () { return false; };
        var finishInsert = options.finishInsert || noop;
        var state = {};
        var refreshSelectionOverlay = noop;

        function defineState(name, getter, setter) {
            Object.defineProperty(state, name, {
                enumerable: true,
                get: getter || function () { return undefined; },
                set: setter || noop
            });
        }

        defineState("currentBp", options.getCurrentBp || function () { return "base"; });
        defineState("active", options.getActivePageIndex || function () { return 0; });
        defineState("cmdStore", options.getCmdStore || function () { return null; });
        defineState("selectedId", options.getSelectedId || function () { return null; }, options.setSelectedId || noop);
        defineState("currentClass", options.getCurrentClass || function () { return null; }, options.setCurrentClass || noop);
        defineState("paletteJustDragged", options.getPaletteJustDragged || function () { return false; }, options.setPaletteJustDragged || noop);
    function initV2Selection(stage, viewport, isViewportPanning) {
        if (!window.LimeSelection) return;
        var overlay = document.getElementById("lime-selection-overlay");
        if (!overlay) return;
        var boxes = overlay.querySelector("[data-selection-boxes]");
        var hoverBox = overlay.querySelector("[data-selection-hover]");
        var marqueeBox = overlay.querySelector("[data-selection-marquee]");
        var selection = window.LimeSelection.createSelection();
        var hoverId = null;
        var marqueeDrag = null;
        var suppressClick = false;
        var activeResize = null;
        var activeMove = null;
        var activeRotate = null;
        var activeGridSpan = null;
        var bodyDragPending = null; // DnD B: ожидание порога для перемещения free-блока за тело
        var freeMoveEl = null;      // DnD B: блок с курсором move (подсказка перетаскивания)
        var guides = overlay.querySelector("[data-selection-guides]");
        var gesturePerf = { move: [], resize: [], rotate: [] };
        window.__LIME_V2_PERF__ = gesturePerf;
        function recordGesturePerf(kind, started) {
            var samples = gesturePerf[kind];
            if (!samples) return;
            samples.push(performance.now() - started);
            if (samples.length > 240) samples.shift();
        }
        if (!guides) {
            guides = document.createElement("div");
            guides.setAttribute("data-selection-guides", "");
            overlay.insertBefore(guides, boxes);
        }

        function freeInfo(id) {
            if (!window.LimeLayout || !L.resolvedDesign) return null;
            var found = findBlock(id);
            if (!found || !found.parentBlock) return null;
            if (found.block.hidden || found.block.locked) return null;
            var parent = targetBlock(found.parentBlock);
            var parentDesign = L.resolvedDesign(parent && parent.design, state.currentBp);
            var childDesign = resolvedBlockDesign(found.block, state.currentBp);
            if (!parentDesign.layout || parentDesign.layout.mode !== "free" || !childDesign.frame) return null;
            return { source: found.block, frame: clone(childDesign.frame), size: childDesign.size || {}, siblings: found.parent };
        }
        function freeGroup(state) {
            if (!state || state.ids.length < 2) return null;
            var items = [], siblings = null;
            for (var i = 0; i < state.ids.length; i++) {
                var info = freeInfo(state.ids[i]);
                if (!info || (siblings && info.siblings !== siblings)) return null;
                siblings = info.siblings;
                items.push({ id: state.ids[i], info: info });
            }
            return { items: items, siblings: siblings, primaryId: state.primaryId };
        }
        function gridInfo(id) {
            var found = findBlock(id);
            if (!found || !found.parentBlock || found.block.hidden || found.block.locked || found.block.type === "component") return null;
            var parent = targetBlock(found.parentBlock);
            var parentDesign = L.resolvedDesign(parent && parent.design, state.currentBp);
            if (!parentDesign.layout || parentDesign.layout.mode !== "grid") return null;
            var childDesign = resolvedBlockDesign(found.block, state.currentBp);
            return {
                source: found.block,
                span: Math.max(1, Math.floor(childDesign.span || 1)),
                rowSpan: Math.max(1, Math.floor(childDesign.rowSpan || 1))
            };
        }

        function localRect(el) {
            var sr = stage.getBoundingClientRect();
            var r = el.getBoundingClientRect();
            var left = r.left - sr.left, top = r.top - sr.top;
            // x/y дублируют left/top: LimeSelection.normalizeRect (hit-test/marquee) читает rect.x/.y,
            // а place()/unionRects — .left/.top. Без x/y normalizeRect схлопывает прямоугольник в (0,0)
            // → клик/рамка не попадают ни в один блок (баг был не виден: self-test модуля даёт x/y-rect'ы).
            return { x: left, y: top, left: left, top: top, right: r.right - sr.left, bottom: r.bottom - sr.top, width: r.width, height: r.height };
        }
        function place(el, r) {
            el.style.left = r.left + "px";
            el.style.top = r.top + "px";
            el.style.width = Math.max(0, r.width) + "px";
            el.style.height = Math.max(0, r.height) + "px";
        }
        function unionRects(rects) {
            var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            rects.forEach(function (r) {
                left = Math.min(left, r.left); top = Math.min(top, r.top);
                right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
            });
            return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
        }
        function addTransformHandles(box, allowRotate) {
            if (allowRotate) {
                var stem = document.createElement("span");
                stem.className = "lime-rotate-stem";
                box.appendChild(stem);
                var rotate = document.createElement("span");
                rotate.className = "lime-rotate-handle";
                rotate.setAttribute("data-rotate-handle", "");
                rotate.setAttribute("title", "Rotate (Shift: 15°)");
                box.appendChild(rotate);
            }
            var move = document.createElement("span");
            move.className = "lime-move-handle";
            move.setAttribute("data-move-handle", "");
            move.setAttribute("title", "Move");
            move.textContent = "\u2725";
            box.appendChild(move);
            ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(function (handle) {
                var h = document.createElement("span");
                h.className = "lime-resize-handle";
                h.setAttribute("data-handle", handle);
                box.appendChild(h);
            });
        }
        // Stage 9.1: плавающая панель действий над выделением (≥2 free-siblings).
        // Align (6) всегда; distribute (2) — только при ≥3 узлах.
        var ALIGN_OPS = [
            { op: "left", glyph: "⇤", label: "Выровнять по левому краю" },
            { op: "hcenter", glyph: "↔", label: "Выровнять по центру (гор.)" },
            { op: "right", glyph: "⇥", label: "Выровнять по правому краю" },
            { op: "top", glyph: "⤒", label: "Выровнять по верху" },
            { op: "vcenter", glyph: "↕", label: "Выровнять по центру (верт.)" },
            { op: "bottom", glyph: "⤓", label: "Выровнять по низу" }
        ];
        var DISTRIBUTE_OPS = [
            { op: "dist-h", glyph: "⇿", label: "Распределить по горизонтали" },
            { op: "dist-v", glyph: "⇳", label: "Распределить по вертикали" }
        ];
        function alignButton(spec) {
            return '<button type="button" class="lime-align-toolbar__btn" data-align-op="' + spec.op +
                '" title="' + spec.label + '" aria-label="' + spec.label + '">' + spec.glyph + '</button>';
        }
        function buildAlignToolbar(rect, count) {
            var bar = document.createElement("div");
            bar.className = "lime-align-toolbar";
            bar.setAttribute("role", "toolbar");
            bar.setAttribute("aria-label", "Выравнивание и распределение");
            var html = ALIGN_OPS.map(alignButton).join("");
            if (count >= 3) html += '<span class="lime-align-toolbar__sep"></span>' + DISTRIBUTE_OPS.map(alignButton).join("");
            bar.innerHTML = html;
            bar.style.left = rect.left + "px";
            bar.style.top = Math.max(0, rect.top - 40) + "px";
            // Не даём pointerdown всплыть в stage: иначе он стартует marquee и забирает
            // pointer-capture, что глотает последующий клик по кнопке.
            bar.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
            return bar;
        }
        function alignSelection(op) {
            if (!window.LimeLayout) return;
            var group = freeGroup(selection.get());
            if (!group) return;
            var frames = group.items.map(function (item) { return item.info.frame; });
            var next;
            if (op === "dist-h") next = window.LimeLayout.distributeFrames(frames, "horizontal");
            else if (op === "dist-v") next = window.LimeLayout.distributeFrames(frames, "vertical");
            else next = window.LimeLayout.alignFrames(frames, op);
            var items = group.items.map(function (item, i) {
                return { id: item.id, source: item.info.source, start: item.info.frame, next: next[i] };
            }).filter(function (item) { return item.start.x !== item.next.x || item.start.y !== item.next.y; });
            if (!items.length) { refresh(); return; }
            commitFrameItems(items, op.indexOf("dist") === 0 ? "distribute-selection" : "align-selection");
        }
        boxes.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-align-op]");
            if (!btn) return;
            e.preventDefault(); e.stopPropagation();
            alignSelection(btn.getAttribute("data-align-op"));
        });
        // Stage 9.3: контекстный toolbar быстрых действий над одиночным выбранным блоком.
        // Дополняет ПКМ-меню (та же единая точка runBlockOp). Правый край бокса, над ним —
        // не пересекается с центрированными move/rotate-хэндлами.
        function buildBlockToolbar(rect, found) {
            var nested = !!(found && found.parentBlock);
            var ops = [
                { op: "dup", icon: "duplicate", label: "Дублировать (Ctrl+D)" },
                { op: "up", icon: "up", label: "Поднять" },
                { op: "down", icon: "down", label: "Опустить" }
            ];
            if (nested) ops.push({ op: "unwrap", icon: "out", label: "Вынести наружу" });
            ops.push({ op: "aiedit", icon: "features", label: "AI: переписать" });
            ops.push({ op: "del", icon: "trash", label: "Удалить (Del)", danger: true });
            // Переиспользуем готовый компонент дизайн-системы .lime-block-toolbar (is-visible).
            var bar = document.createElement("div");
            bar.className = "lime-block-toolbar is-visible";
            bar.setAttribute("role", "toolbar");
            bar.setAttribute("aria-label", "Действия над блоком");
            bar.innerHTML = ops.map(function (o) {
                return '<button type="button" class="lime-block-toolbar__btn' + (o.danger ? " lime-block-toolbar__btn--danger" : "") +
                    '" data-block-op="' + o.op + '" title="' + o.label + '" aria-label="' + o.label + '">' + ico(o.icon) + '</button>';
            }).join("");
            bar.style.left = rect.right + "px";
            bar.style.top = Math.max(0, rect.top - 38) + "px";
            bar.style.transform = "translateX(-100%)"; // правый край toolbar к правому краю бокса
            bar.style.pointerEvents = "auto"; // overlay — pointer-events:none, кнопкам нужен клик
            bar.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
            return bar;
        }
        boxes.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-block-op]");
            if (!btn) return;
            e.preventDefault(); e.stopPropagation();
            runBlockOp(btn.getAttribute("data-block-op"));
        });
        function addGridSpanHandle(box) {
            var handle = document.createElement("span");
            handle.className = "lime-grid-span-handle";
            handle.setAttribute("data-grid-span-handle", "");
            handle.setAttribute("title", "Изменить span колонок и строк");
            handle.textContent = "↘";
            box.appendChild(handle);
        }
        function candidates() {
            var out = [];
            var nodes = ws.querySelectorAll(".lime-block[data-block-id]");
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                var model = byId(el.getAttribute("data-block-id"));
                var depth = 1, p = el.parentElement;
                while (p && p !== ws) { if (p.classList && p.classList.contains("lime-block")) depth++; p = p.parentElement; }
                out.push({ id: el.getAttribute("data-block-id"), rect: localRect(el), depth: depth, zIndex: parseInt(getComputedStyle(el).zIndex, 10) || 0, order: i,
                    hidden: !!(model && model.hidden), locked: !!(model && model.locked), el: el });
            }
            return out;
        }
        function syncLegacy(selectionState) {
            var old = ws.querySelectorAll(".is-selected");
            for (var i = 0; i < old.length; i++) old[i].classList.remove("is-selected");
            state.selectedId = selectionState.primaryId;
            if (state.selectedId) {
                var primary = ws.querySelector('[data-block-id="' + state.selectedId + '"]');
                if (primary) primary.classList.add("is-selected");
            }
            state.currentClass = null;
            refreshInspector(); refreshLayers();
        }
        function refresh() {
            var state = selection.get();
            var valid = state.ids.filter(function (id) { return !!ws.querySelector('[data-block-id="' + id + '"]'); });
            if (valid.length !== state.ids.length) { selection.replace(valid); return; }
            boxes.innerHTML = "";
            if (freeMoveEl) { freeMoveEl.classList.remove("is-free-move"); freeMoveEl = null; }
            var group = freeGroup(state);
            state.ids.forEach(function (id) {
                var el = ws.querySelector('[data-block-id="' + id + '"]');
                var model = byId(id);
                if (!el || (model && model.hidden)) return;
                var box = document.createElement("div");
                box.className = "lime-selection-box" + (id === state.primaryId ? " is-primary" : "");
                box.setAttribute("data-selection-id", id);
                place(box, localRect(el));
                if (!group && id === state.primaryId) {
                    if (freeInfo(id)) { addTransformHandles(box, true); el.classList.add("is-free-move"); freeMoveEl = el; }
                    else if (gridInfo(id)) addGridSpanHandle(box);
                }
                boxes.appendChild(box);
            });
            if (group) {
                var groupRects = group.items.map(function (item) {
                    return localRect(ws.querySelector('[data-block-id="' + item.id + '"]'));
                });
                var groupBox = document.createElement("div");
                groupBox.className = "lime-selection-box is-primary is-group";
                groupBox.setAttribute("data-selection-group", "");
                var groupRect = unionRects(groupRects);
                place(groupBox, groupRect);
                addTransformHandles(groupBox, false);
                boxes.appendChild(groupBox);
                boxes.appendChild(buildAlignToolbar(groupRect, group.items.length));
            }
            if (!group && state.ids.length === 1 && state.primaryId) {
                var soleEl = ws.querySelector('[data-block-id="' + state.primaryId + '"]');
                var soleModel = byId(state.primaryId);
                if (soleEl && !(soleModel && soleModel.hidden)) {
                    boxes.appendChild(buildBlockToolbar(localRect(soleEl), findBlock(state.primaryId)));
                }
            }
            var hoverEl = hoverId && !selection.has(hoverId) ? ws.querySelector('[data-block-id="' + hoverId + '"]') : null;
            if (hoverEl) { place(hoverBox, localRect(hoverEl)); hoverBox.hidden = false; }
            else hoverBox.hidden = true;
        }
        refreshSelectionOverlay = refresh;
        selection.subscribe(function (state) { syncLegacy(state); refresh(); });
        viewport.subscribe(refresh);
        window.addEventListener("resize", refresh);

        function localPoint(e) {
            var r = stage.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        stage.addEventListener("click", function (e) {
            if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
            var point = localPoint(e);
            var hit = window.LimeSelection.hitTest(candidates(), point);
            if (hit) selection.select(hit.id, { additive: e.shiftKey, toggle: e.shiftKey });
            else if (e.target === stage || e.target === ws || e.target.closest(".lime-workspace__placeholder")) selection.clear();
        });
        stage.addEventListener("pointermove", function (e) {
            if (marqueeDrag) {
                var p = localPoint(e);
                marqueeDrag.x2 = p.x; marqueeDrag.y2 = p.y;
                var r = window.LimeSelection.normalizeRect(marqueeDrag);
                place(marqueeBox, { left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top });
                return;
            }
            if (isViewportPanning()) return;
            var hit = window.LimeSelection.hitTest(candidates(), localPoint(e));
            var nextHover = hit ? hit.id : null;
            if (nextHover !== hoverId) { hoverId = nextHover; refresh(); }
        });
        stage.addEventListener("pointerleave", function () { if (!marqueeDrag) { hoverId = null; refresh(); } });
        stage.addEventListener("pointerdown", function (e) {
            // Интерактивные контролы в холсте (кнопки пустого состояния и т.п.) не должны стартовать
            // marquee: его e.preventDefault() подавил бы их click (этап 9.4).
            if (e.button !== 0 || isViewportPanning() || e.target.closest(".lime-block, button, a, input, textarea, select")) return;
            var p = localPoint(e);
            marqueeDrag = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, additive: e.shiftKey };
            marqueeBox.hidden = false;
            place(marqueeBox, { left: p.x, top: p.y, width: 0, height: 0 });
            try { stage.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            e.preventDefault();
        });
        stage.addEventListener("pointerup", function (e) {
            if (!marqueeDrag) return;
            var drag = marqueeDrag;
            marqueeDrag = null;
            marqueeBox.hidden = true;
            try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            var moved = Math.abs(drag.x2 - drag.x1) + Math.abs(drag.y2 - drag.y1) > 4;
            if (moved) {
                var ids = window.LimeSelection.marquee(candidates(), drag);
                selection.replace(drag.additive ? selection.get().ids.concat(ids) : ids);
                suppressClick = true;
            }
        });
        document.addEventListener("click", function (e) {
            var row = e.target.closest("[data-doc-layer]");
            if (row) selection.select(row.getAttribute("data-doc-layer"), { additive: e.shiftKey, toggle: e.shiftKey });
        });
        function moveTargets(info, excluded) {
            var out = [];
            (info.siblings || []).forEach(function (sibling) {
                if (!sibling || (excluded && excluded[sibling.id])) return;
                var siblingDesign = resolvedBlockDesign(sibling, state.currentBp);
                if (!siblingDesign.frame) return;
                out.push({ id: sibling.id, rect: clone(siblingDesign.frame), hidden: !!sibling.hidden, locked: !!sibling.locked });
            });
            return out;
        }
        function anchorValue(r, axis, kind) {
            if (axis === "x") {
                if (kind === "right") return r.right;
                if (kind === "center") return r.left + r.width / 2;
                return r.left;
            }
            if (kind === "bottom") return r.bottom;
            if (kind === "center") return r.top + r.height / 2;
            return r.top;
        }
        function showGuides(gesture, hits) {
            guides.innerHTML = "";
            if (!hits || !hits.length) return;
            var parentRect = localRect(gesture.blockEl.parentElement);
            var movingRect = localRect(gesture.blockEl);
            hits.forEach(function (hit) {
                var targetEl = hit.targetId && ws.querySelector('[data-block-id="' + hit.targetId + '"]');
                var targetRect = targetEl ? localRect(targetEl) : movingRect;
                var kind = targetEl ? hit.target : hit.moving;
                var value = anchorValue(targetRect, hit.axis, kind);
                var line = document.createElement("span");
                line.className = "lime-snap-guide is-" + hit.axis;
                if (hit.axis === "x") {
                    line.style.left = value + "px";
                    line.style.top = parentRect.top + "px";
                    line.style.height = parentRect.height + "px";
                } else {
                    line.style.left = parentRect.left + "px";
                    line.style.top = value + "px";
                    line.style.width = parentRect.width + "px";
                }
                guides.appendChild(line);
            });
        }
        function pointerInParent(e, blockEl) {
            var r = blockEl.parentElement.getBoundingClientRect();
            var zoom = viewport.get().zoom || 1;
            return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
        }
        function resizeDelta(start, handle, next) {
            handle = String(handle || "");
            return {
                x: handle.indexOf("w") >= 0 ? next.x - start.x : handle.indexOf("e") >= 0 ? (next.x + next.width) - (start.x + start.width) : 0,
                y: handle.indexOf("n") >= 0 ? next.y - start.y : handle.indexOf("s") >= 0 ? (next.y + next.height) - (start.y + start.height) : 0
            };
        }
        overlay.addEventListener("pointerdown", function (e) {
            var gridSpanHandle = e.target.closest("[data-grid-span-handle]");
            if (gridSpanHandle) {
                var gridBox = gridSpanHandle.closest("[data-selection-id]");
                var gridId = gridBox && gridBox.getAttribute("data-selection-id");
                var grid = gridId && gridInfo(gridId);
                var gridEl = gridId && ws.querySelector('[data-block-id="' + gridId + '"]');
                var gridParent = gridEl && gridEl.parentElement;
                if (!grid || !gridEl || !gridParent) return;
                var gridStyle = getComputedStyle(gridParent);
                var tracks = String(gridStyle.gridTemplateColumns || "").trim().split(/\s+/).filter(Boolean);
                var columnCount = Math.max(1, tracks.length);
                var columnGap = parseFloat(gridStyle.columnGap) || 0;
                var parentWidth = gridParent.getBoundingClientRect().width;
                var columnStep = Math.max(1, (parentWidth - columnGap * (columnCount - 1)) / columnCount + columnGap);
                var rowGap = parseFloat(gridStyle.rowGap) || 0;
                var explicitRow = parseFloat(gridStyle.gridAutoRows);
                var rowStep = isFinite(explicitRow) && explicitRow > 0
                    ? explicitRow * (viewport.get().zoom || 1) + rowGap
                    : Math.max(1, gridEl.getBoundingClientRect().height / grid.rowSpan + rowGap);
                activeGridSpan = {
                    id: gridId, source: grid.source, pointerId: e.pointerId, blockEl: gridEl, box: gridBox,
                    clientX: e.clientX, clientY: e.clientY, columnStep: columnStep, rowStep: rowStep,
                    maxColumns: columnCount, startSpan: grid.span, startRowSpan: grid.rowSpan,
                    nextSpan: grid.span, nextRowSpan: grid.rowSpan
                };
                try { gridSpanHandle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var rotateHandle = e.target.closest("[data-rotate-handle]");
            if (rotateHandle) {
                var rotateBox = rotateHandle.closest("[data-selection-id]");
                var rotateId = rotateBox && rotateBox.getAttribute("data-selection-id");
                var rotateInfo = rotateId && freeInfo(rotateId);
                var rotateEl = rotateId && ws.querySelector('[data-block-id="' + rotateId + '"]');
                if (!rotateInfo || !rotateEl) return;
                activeRotate = {
                    id: rotateId, source: rotateInfo.source, start: rotateInfo.frame, next: rotateInfo.frame,
                    startPoint: pointerInParent(e, rotateEl), pointerId: e.pointerId, blockEl: rotateEl, box: rotateBox
                };
                try { rotateHandle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var moveHandle = e.target.closest("[data-move-handle]");
            if (moveHandle) {
                var moveBox = moveHandle.closest("[data-selection-id]");
                var moveGroupBox = moveHandle.closest("[data-selection-group]");
                var moveId = moveGroupBox ? selection.get().primaryId : moveBox && moveBox.getAttribute("data-selection-id");
                var moveInfo = moveId && freeInfo(moveId);
                var moveEl = moveId && ws.querySelector('[data-block-id="' + moveId + '"]');
                if (!moveInfo || !moveEl || !window.LimeSnap) return;
                var selected = selection.get().ids;
                var moveItems = [];
                selected.forEach(function (selectedId) {
                    var selectedInfo = freeInfo(selectedId);
                    var selectedEl = ws.querySelector('[data-block-id="' + selectedId + '"]');
                    var selectedBox = boxes.querySelector('[data-selection-id="' + selectedId + '"]');
                    if (selectedInfo && selectedInfo.siblings === moveInfo.siblings && selectedEl && selectedBox) {
                        moveItems.push({ id: selectedId, source: selectedInfo.source, start: selectedInfo.frame, next: selectedInfo.frame, blockEl: selectedEl, box: selectedBox });
                    }
                });
                // Смешанный selection из разных parents не двигаем частично: жест остаётся single-primary.
                if (moveItems.length !== selected.length) {
                    moveItems = [{ id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame, blockEl: moveEl, box: moveBox }];
                }
                var excluded = {};
                moveItems.forEach(function (item) { excluded[item.id] = true; });
                activeMove = {
                    id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame,
                    items: moveItems, targets: moveTargets(moveInfo, excluded), pointerId: e.pointerId,
                    clientX: e.clientX, clientY: e.clientY, blockEl: moveEl, box: moveBox,
                    groupBox: moveGroupBox
                };
                try { moveHandle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var handle = e.target.closest("[data-handle]");
            if (!handle) return;
            var resizeGroupBox = handle.closest("[data-selection-group]");
            if (resizeGroupBox) {
                var groupState = freeGroup(selection.get());
                if (!groupState) return;
                var groupItems = groupState.items.map(function (item) {
                    var groupEl = ws.querySelector('[data-block-id="' + item.id + '"]');
                    return { id: item.id, source: item.info.source, start: item.info.frame, next: item.info.frame, blockEl: groupEl,
                        box: boxes.querySelector('[data-selection-id="' + item.id + '"]') };
                });
                var groupStart = window.LimeLayout.frameBounds(groupItems.map(function (item) { return item.start; }));
                activeResize = {
                    group: true, items: groupItems, start: groupStart, next: groupStart,
                    handle: handle.getAttribute("data-handle"), pointerId: e.pointerId,
                    clientX: e.clientX, clientY: e.clientY, box: resizeGroupBox, blockEl: groupItems[0].blockEl,
                    targets: moveTargets(groupState.items[0].info, groupState.items.reduce(function (out, item) { out[item.id] = true; return out; }, {}))
                };
                try { handle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
                e.preventDefault(); e.stopPropagation();
                return;
            }
            var box = handle.closest("[data-selection-id]");
            var id = box && box.getAttribute("data-selection-id");
            var info = id && freeInfo(id);
            var blockEl = id && ws.querySelector('[data-block-id="' + id + '"]');
            if (!info || !blockEl) return;
            activeResize = {
                id: id, source: info.source, start: info.frame, size: info.size,
                handle: handle.getAttribute("data-handle"), pointerId: e.pointerId,
                clientX: e.clientX, clientY: e.clientY, blockEl: blockEl, box: box, next: info.frame,
                targets: moveTargets(info, (function () { var out = {}; out[id] = true; return out; })())
            };
            try { handle.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            e.preventDefault(); e.stopPropagation();
        });
        // ===== DnD B: перемещение free-блока за его тело (не только за move-handle) =====
        // Текст остаётся редактируемым: на pointerdown НЕ зовём preventDefault (клик ставит каретку),
        // а move стартует только после порога 5px. Двигаем уже активный (primary) free-блок; жест
        // переиспользует ту же машинерию activeMove (snap/guides/commit), капчёр — на selection-box.
        function endBodyDragPending() {
            bodyDragPending = null;
            window.removeEventListener("pointermove", onBodyDragMove, true);
            window.removeEventListener("pointerup", endBodyDragPending, true);
            window.removeEventListener("pointercancel", endBodyDragPending, true);
        }
        function beginBodyMove(moveId, e) {
            var moveInfo = freeInfo(moveId);
            var moveEl = ws.querySelector('[data-block-id="' + moveId + '"]');
            var moveBox = boxes.querySelector('[data-selection-id="' + moveId + '"]');
            if (!moveInfo || !moveEl || !moveBox || !window.LimeSnap) return false;
            var selected = selection.get().ids;
            var moveItems = [];
            selected.forEach(function (sid) {
                var si = freeInfo(sid);
                var sEl = ws.querySelector('[data-block-id="' + sid + '"]');
                var sBox = boxes.querySelector('[data-selection-id="' + sid + '"]');
                if (si && si.siblings === moveInfo.siblings && sEl && sBox) {
                    moveItems.push({ id: sid, source: si.source, start: si.frame, next: si.frame, blockEl: sEl, box: sBox });
                }
            });
            if (moveItems.length !== selected.length) {
                moveItems = [{ id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame, blockEl: moveEl, box: moveBox }];
            }
            var excluded = {};
            moveItems.forEach(function (item) { excluded[item.id] = true; });
            activeMove = {
                id: moveId, source: moveInfo.source, start: moveInfo.frame, next: moveInfo.frame,
                items: moveItems, targets: moveTargets(moveInfo, excluded), pointerId: e.pointerId,
                clientX: e.clientX, clientY: e.clientY, blockEl: moveEl, box: moveBox, groupBox: null
            };
            try { moveBox.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            return true;
        }
        function onBodyDragMove(e) {
            if (!bodyDragPending || e.pointerId !== bodyDragPending.pointerId) return;
            if (Math.abs(e.clientX - bodyDragPending.x0) + Math.abs(e.clientY - bodyDragPending.y0) < 5) return;
            var id = bodyDragPending.id;
            endBodyDragPending();
            if (activeMove || activeResize || activeRotate) return;
            if (beginBodyMove(id, e)) {
                var sel = window.getSelection && window.getSelection();
                if (sel && sel.removeAllRanges) sel.removeAllRanges();
                e.preventDefault();
            }
        }
        ws.addEventListener("pointerdown", function (e) {
            if (e.button !== 0 || isViewportPanning() || activeMove || activeResize || activeRotate) return;
            var blockEl = e.target.closest(".lime-block[data-block-id]");
            if (!blockEl) return;
            var id = blockEl.getAttribute("data-block-id");
            if (selection.get().primaryId !== id) return; // телом двигаем только активный блок
            if (!freeInfo(id)) return;                     // только free-ребёнок
            bodyDragPending = { id: id, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId };
            window.addEventListener("pointermove", onBodyDragMove, true);
            window.addEventListener("pointerup", endBodyDragPending, true);
            window.addEventListener("pointercancel", endBodyDragPending, true);
        });
        document.addEventListener("pointermove", function (e) {
            if (activeRotate && activeRotate.pointerId === e.pointerId) {
                var rotatePerfStarted = performance.now();
                activeRotate.next = window.LimeLayout.rotateFrame(activeRotate.start, activeRotate.startPoint, pointerInParent(e, activeRotate.blockEl), {
                    snap: e.shiftKey, increment: 15
                });
                activeRotate.blockEl.style.transform = activeRotate.next.rotation ? "rotate(" + activeRotate.next.rotation + "deg)" : "";
                place(activeRotate.box, localRect(activeRotate.blockEl));
                recordGesturePerf("rotate", rotatePerfStarted);
            }
            if (activeGridSpan && activeGridSpan.pointerId === e.pointerId) {
                activeGridSpan.nextSpan = Math.max(1, Math.min(activeGridSpan.maxColumns,
                    activeGridSpan.startSpan + Math.round((e.clientX - activeGridSpan.clientX) / activeGridSpan.columnStep)));
                activeGridSpan.nextRowSpan = Math.max(1, Math.min(12,
                    activeGridSpan.startRowSpan + Math.round((e.clientY - activeGridSpan.clientY) / activeGridSpan.rowStep)));
                activeGridSpan.blockEl.style.gridColumn = "span " + activeGridSpan.nextSpan;
                activeGridSpan.blockEl.style.gridRow = "span " + activeGridSpan.nextRowSpan;
                place(activeGridSpan.box, localRect(activeGridSpan.blockEl));
            }
        }, true);
        overlay.addEventListener("pointermove", function (e) {
            var perfStarted = performance.now();
            if (activeMove && activeMove.pointerId === e.pointerId) {
                var moveZoom = viewport.get().zoom || 1;
                var moveDx = (e.clientX - activeMove.clientX) / moveZoom;
                var moveDy = (e.clientY - activeMove.clientY) / moveZoom;
                if (e.shiftKey) {
                    if (Math.abs(moveDx) >= Math.abs(moveDy)) moveDy = 0; else moveDx = 0;
                }
                var moved = window.LimeLayout.moveFrame(activeMove.start, moveDx, moveDy);
                var snapped = e.altKey ? { rect: moved, guides: [] } : window.LimeSnap.snapMove(moved, activeMove.targets, { threshold: 6 / moveZoom });
                activeMove.next = {
                    x: snapped.rect.x, y: snapped.rect.y, width: moved.width, height: moved.height, rotation: moved.rotation
                };
                var appliedX = activeMove.next.x - activeMove.start.x;
                var appliedY = activeMove.next.y - activeMove.start.y;
                activeMove.items.forEach(function (item) {
                    item.next = window.LimeLayout.moveFrame(item.start, appliedX, appliedY);
                    var moveStyle = item.blockEl.style;
                    moveStyle.position = "absolute";
                    moveStyle.left = item.next.x + "px"; moveStyle.top = item.next.y + "px";
                    place(item.box, localRect(item.blockEl));
                });
                if (activeMove.groupBox) {
                    place(activeMove.groupBox, unionRects(activeMove.items.map(function (item) { return localRect(item.blockEl); })));
                }
                showGuides(activeMove, snapped.guides);
                recordGesturePerf("move", perfStarted);
                return;
            }
            if (!activeResize || activeResize.pointerId !== e.pointerId) return;
            var zoom = viewport.get().zoom || 1;
            var dx = (e.clientX - activeResize.clientX) / zoom;
            var dy = (e.clientY - activeResize.clientY) / zoom;
            if (activeResize.group) {
                var groupResult = window.LimeLayout.resizeFrames(activeResize.items.map(function (item) { return item.start; }), activeResize.handle, { x: dx, y: dy }, {
                    shift: e.shiftKey, alt: e.altKey, itemMin: 8
                });
                if (!e.shiftKey && !e.altKey && window.LimeSnap && window.LimeSnap.snapResize) {
                    var groupSnap = window.LimeSnap.snapResize(groupResult.bounds, activeResize.handle, activeResize.targets, { threshold: 6 / zoom });
                    var groupDelta = resizeDelta(activeResize.start, activeResize.handle, groupSnap.rect);
                    groupResult = window.LimeLayout.resizeFrames(activeResize.items.map(function (item) { return item.start; }), activeResize.handle, groupDelta, { itemMin: 8 });
                    showGuides(activeResize, groupSnap.guides);
                } else guides.innerHTML = "";
                activeResize.next = groupResult.bounds;
                activeResize.items.forEach(function (item, index) {
                    item.next = groupResult.frames[index];
                    var groupStyle = item.blockEl.style;
                    groupStyle.position = "absolute";
                    groupStyle.left = item.next.x + "px"; groupStyle.top = item.next.y + "px";
                    groupStyle.width = item.next.width + "px"; groupStyle.height = item.next.height + "px";
                    groupStyle.transform = item.next.rotation ? "rotate(" + item.next.rotation + "deg)" : "";
                    place(item.box, localRect(item.blockEl));
                });
                place(activeResize.box, unionRects(activeResize.items.map(function (item) { return localRect(item.blockEl); })));
                recordGesturePerf("resize", perfStarted);
                return;
            }
            var next = window.LimeLayout.resizeFrame(activeResize.start, activeResize.handle, { x: dx, y: dy }, {
                shift: e.shiftKey, alt: e.altKey,
                width: activeResize.size.width, height: activeResize.size.height
            });
            if (!e.shiftKey && !e.altKey && window.LimeSnap && window.LimeSnap.snapResize) {
                var resizeSnap = window.LimeSnap.snapResize(next, activeResize.handle, activeResize.targets, { threshold: 6 / zoom });
                next = window.LimeLayout.resizeFrame(activeResize.start, activeResize.handle, resizeDelta(activeResize.start, activeResize.handle, resizeSnap.rect), {
                    width: activeResize.size.width, height: activeResize.size.height
                });
                showGuides(activeResize, resizeSnap.guides);
            } else guides.innerHTML = "";
            activeResize.next = next;
            var style = activeResize.blockEl.style;
            style.position = "absolute";
            style.left = next.x + "px"; style.top = next.y + "px";
            style.width = next.width + "px"; style.height = next.height + "px";
            style.transform = next.rotation ? "rotate(" + next.rotation + "deg)" : "";
            place(activeResize.box, localRect(activeResize.blockEl));
            recordGesturePerf("resize", perfStarted);
        });
        function commitFrameItems(items, label) {
            if (items.length === 1) {
                setDesignValue(items[0].source, state.currentBp, "frame", items[0].next, false);
                return;
            }
            if (state.cmdStore) {
                var commands = items.map(function (item) {
                    return { type: "setDesign", payload: { id: item.id, breakpoint: state.currentBp, field: "frame", value: item.next } };
                });
                finishMutation(runCommands(commands, label));
                return;
            }
            items.forEach(function (item) {
                if (!item.source.design) item.source.design = {};
                if (!item.source.design[state.currentBp]) item.source.design[state.currentBp] = {};
                item.source.design[state.currentBp].frame = item.next;
            });
            finishMutation(false);
        }
        function finishResize(e, cancel) {
            if (!activeResize || activeResize.pointerId !== e.pointerId) return;
            var gesture = activeResize;
            activeResize = null;
            guides.innerHTML = "";
            if (cancel) { render(); return; }
            if (gesture.group) {
                var resizedItems = gesture.items.filter(function (item) {
                    return item.start.x !== item.next.x || item.start.y !== item.next.y || item.start.width !== item.next.width || item.start.height !== item.next.height;
                });
                if (!resizedItems.length) { refresh(); return; }
                commitFrameItems(resizedItems, "resize-selection");
                return;
            }
            var a = gesture.start, b = gesture.next;
            if (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation) { refresh(); return; }
            setDesignValue(gesture.source, state.currentBp, "frame", b, false);
        }
        function finishMove(e, cancel) {
            if (!activeMove || activeMove.pointerId !== e.pointerId) return;
            var gesture = activeMove;
            activeMove = null;
            guides.innerHTML = "";
            if (cancel) { render(); return; }
            var changedItems = gesture.items.filter(function (item) { return item.start.x !== item.next.x || item.start.y !== item.next.y; });
            if (!changedItems.length) { refresh(); return; }
            commitFrameItems(changedItems, "move-selection");
        }
        function finishRotate(e, cancel) {
            if (!activeRotate || activeRotate.pointerId !== e.pointerId) return;
            var gesture = activeRotate;
            activeRotate = null;
            if (cancel) { render(); return; }
            if (gesture.start.rotation === gesture.next.rotation) { refresh(); return; }
            setDesignValue(gesture.source, state.currentBp, "frame", gesture.next, false);
        }
        function finishGridSpan(e, cancel) {
            if (!activeGridSpan || activeGridSpan.pointerId !== e.pointerId) return;
            var gesture = activeGridSpan;
            activeGridSpan = null;
            if (cancel) { render(); return; }
            var spanChanged = gesture.startSpan !== gesture.nextSpan;
            var rowChanged = gesture.startRowSpan !== gesture.nextRowSpan;
            if (!spanChanged && !rowChanged) { refresh(); return; }
            var changes = [];
            function addChange(field, value) {
                var remove = state.currentBp === "base" && value <= 1;
                changes.push({ type: "setDesign", payload: { id: gesture.id, breakpoint: state.currentBp, field: field, value: remove ? null : value, remove: remove } });
            }
            if (spanChanged) addChange("span", gesture.nextSpan);
            if (rowChanged) addChange("rowSpan", gesture.nextRowSpan);
            if (state.cmdStore) { finishMutation(runCommands(changes, "grid-span-resize")); return; }
            beginCheckpointMutation();
            if (!gesture.source.design) gesture.source.design = {};
            if (!gesture.source.design[state.currentBp]) gesture.source.design[state.currentBp] = {};
            changes.forEach(function (change) {
                var field = change.payload.field;
                if (change.payload.remove) delete gesture.source.design[state.currentBp][field];
                else gesture.source.design[state.currentBp][field] = change.payload.value;
            });
            finishMutation(false);
        }
        document.addEventListener("pointerup", function (e) { finishRotate(e, false); finishGridSpan(e, false); }, true);
        document.addEventListener("pointercancel", function (e) { finishRotate(e, true); finishGridSpan(e, true); }, true);
        overlay.addEventListener("pointerup", function (e) { finishMove(e, false); finishResize(e, false); finishRotate(e, false); finishGridSpan(e, false); });
        overlay.addEventListener("pointercancel", function (e) { finishMove(e, true); finishResize(e, true); finishRotate(e, true); finishGridSpan(e, true); });
        document.addEventListener("keydown", function (e) {
            if (/^Arrow(Left|Right|Up|Down)$/.test(e.key) && !isTextField(e) && !activeMove && !activeResize) {
                var keyboardState = selection.get();
                var keyboardGroup = freeGroup(keyboardState);
                var keyboardInfos = keyboardGroup ? keyboardGroup.items : (keyboardState.primaryId && freeInfo(keyboardState.primaryId) ? [{ id: keyboardState.primaryId, info: freeInfo(keyboardState.primaryId) }] : []);
                if (keyboardInfos.length) {
                    var step = e.shiftKey ? 10 : 1;
                    var kx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                    var ky = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
                    var keyboardItems = keyboardInfos.map(function (item) {
                        return { id: item.id, source: item.info.source, start: item.info.frame, next: item.info.frame };
                    });
                    if (e.ctrlKey || e.metaKey) {
                        if (keyboardItems.length > 1) {
                            var keyboardResize = window.LimeLayout.resizeFrames(keyboardItems.map(function (item) { return item.start; }), "se", { x: kx, y: ky }, { itemMin: 8 });
                            keyboardItems.forEach(function (item, index) { item.next = keyboardResize.frames[index]; });
                        } else {
                            keyboardItems[0].next = window.LimeLayout.resizeFrame(keyboardItems[0].start, "se", { x: kx, y: ky });
                        }
                        commitFrameItems(keyboardItems, "keyboard-resize");
                    } else {
                        keyboardItems.forEach(function (item) { item.next = window.LimeLayout.moveFrame(item.start, kx, ky); });
                        commitFrameItems(keyboardItems, "keyboard-move");
                    }
                    e.preventDefault();
                    return;
                }
            }
            if (e.key !== "Escape") return;
            if (activeMove) { guides.innerHTML = ""; render(); activeMove = null; }
            if (activeResize) { render(); activeResize = null; }
            if (activeRotate) { render(); activeRotate = null; }
            if (activeGridSpan) { render(); activeGridSpan = null; }
            selection.clear();
        });
        // ===== DnD A: перетаскивание из палитры с дропом в конкретную точку холста =====
        // Клик по плитке по-прежнему добавляет блок в конец (fallback). Drag (>5px) включает
        // призрак у курсора и индикатор места вставки: линия — для потока (stack/grid), рамка —
        // для free-контейнера (блок ляжет по координатам курсора).
        function childrenListEl(blockEl) {
            return blockEl && blockEl.querySelector(":scope > .lime-block__inner > .lime-block__children");
        }
        function layoutModeOf(block) {
            var t = targetBlock(block);
            var d = t && L.resolvedDesign && L.resolvedDesign(t.design, state.currentBp);
            return (d && d.layout && d.layout.mode) || "stack";
        }
        function freeFrameAt(containerEl, clientX, clientY) {
            var listEl = childrenListEl(containerEl) || containerEl;
            var r = listEl.getBoundingClientRect();
            var zoom = viewport.get().zoom || 1;
            var w = 200, h = 100;
            return {
                x: Math.max(0, Math.round((clientX - r.left) / zoom - w / 2)),
                y: Math.max(0, Math.round((clientY - r.top) / zoom - h / 2)),
                width: w, height: h, rotation: 0
            };
        }
        function indexAmong(listEl, clientY) {
            var kids = listEl.querySelectorAll(":scope > .lime-block");
            for (var i = 0; i < kids.length; i++) {
                var r = kids[i].getBoundingClientRect();
                if (clientY < r.top + r.height / 2) return i;
            }
            return kids.length;
        }
        function isOverCanvas(x, y) {
            var sr = stage.getBoundingClientRect();
            return x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom;
        }
        function paletteDropTarget(clientX, clientY) {
            if (!isOverCanvas(clientX, clientY)) return null;
            var prevPE = overlay.style.pointerEvents;
            overlay.style.pointerEvents = "none";
            var el = document.elementFromPoint(clientX, clientY);
            overlay.style.pointerEvents = prevPE;
            var blockEl = el && el.closest(".lime-block[data-block-id]");
            if (!blockEl) return { parentId: null, index: pageBlocks().length, free: false };
            var found = findBlock(blockEl.getAttribute("data-block-id"));
            if (!found) return { parentId: null, index: pageBlocks().length, free: false };
            var blk = found.block, t = targetBlock(blk);
            // Навели на контейнер → кладём ВНУТРЬ него.
            if (t && L.isContainer(t.type) && t.type !== "component" && !blk.locked) {
                if (layoutModeOf(blk) === "free") {
                    return { parentId: blk.id, index: (t.children && t.children.length) || 0, free: true, frame: freeFrameAt(blockEl, clientX, clientY) };
                }
                var listEl = childrenListEl(blockEl);
                return { parentId: blk.id, index: listEl ? indexAmong(listEl, clientY) : ((t.children && t.children.length) || 0), free: false };
            }
            // Иначе — как сосед в родительском списке.
            var parentBlock = found.parentBlock;
            var parentId = parentBlock ? parentBlock.id : null;
            if (parentBlock && layoutModeOf(parentBlock) === "free") {
                var pEl = ws.querySelector('[data-block-id="' + parentBlock.id + '"]');
                return { parentId: parentId, index: (found.parent && found.parent.length) || 0, free: true, frame: freeFrameAt(pEl, clientX, clientY) };
            }
            var br = blockEl.getBoundingClientRect();
            return { parentId: parentId, index: found.index + (clientY > br.top + br.height / 2 ? 1 : 0), free: false };
        }
        function dropLineRect(t, clientY) {
            var listEl = t.parentId
                ? childrenListEl(ws.querySelector('[data-block-id="' + t.parentId + '"]'))
                : ws.querySelector(".lime-doc-page");
            if (!listEl) { var wr = ws.getBoundingClientRect(); return { left: wr.left, top: clientY, width: wr.width }; }
            var lr = listEl.getBoundingClientRect();
            var kids = listEl.querySelectorAll(":scope > .lime-block");
            var top;
            if (!kids.length) top = lr.top + 4;
            else if (t.index >= kids.length) top = kids[kids.length - 1].getBoundingClientRect().bottom;
            else top = kids[t.index].getBoundingClientRect().top;
            return { left: lr.left, top: top, width: lr.width };
        }
        function dropBlockAt(type, t) {
            var b = L.createBlock(type);
            if (t.free && t.frame) { b.design = {}; b.design[state.currentBp] = { frame: t.frame }; }
            var commandApplied = runCommand("insertBlock", { block: b, parentId: t.parentId, pageIndex: state.active, index: t.index });
            if (!commandApplied) {
                if (t.parentId) { var pb = byId(t.parentId); if (pb) { if (!pb.children) pb.children = []; pb.children.splice(t.index, 0, b); } }
                else pageBlocks().splice(t.index, 0, b);
            }
            state.selectedId = b.id;
            finishInsert(b, t.parentId, t.index, commandApplied);
            selection.replace([b.id]);
        }
        function initPaletteDrag() {
            var tiles = document.querySelectorAll("[data-doc-add]");
            var drag = null, ghost = null, ind = null;
            function cleanup() {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("pointercancel", onUp, true);
                if (ghost) { ghost.remove(); ghost = null; }
                if (ind) { ind.remove(); ind = null; }
                document.body.classList.remove("is-palette-dragging");
            }
            function begin() {
                drag.started = true;
                ghost = document.createElement("div");
                ghost.className = "lime-palette-ghost";
                ghost.textContent = (drag.tile.textContent || drag.type).trim();
                document.body.appendChild(ghost);
                ind = document.createElement("div");
                ind.className = "lime-drop-ind";
                overlay.appendChild(ind);
                document.body.classList.add("is-palette-dragging");
            }
            function paint(t, x, y) {
                if (!ind) return;
                ind.className = "lime-drop-ind";
                if (!t) { ind.style.display = "none"; return; }
                ind.style.display = "block";
                var sr = stage.getBoundingClientRect();
                if (t.free && t.frame) {
                    var zoom = viewport.get().zoom || 1, w = t.frame.width * zoom, h = t.frame.height * zoom;
                    ind.classList.add("is-frame");
                    ind.style.left = (x - sr.left - w / 2) + "px";
                    ind.style.top = (y - sr.top - h / 2) + "px";
                    ind.style.width = w + "px";
                    ind.style.height = h + "px";
                } else {
                    var pos = dropLineRect(t, y);
                    ind.classList.add("is-line");
                    ind.style.left = (pos.left - sr.left) + "px";
                    ind.style.top = (pos.top - sr.top) + "px";
                    ind.style.width = pos.width + "px";
                    ind.style.height = "";
                }
            }
            function onMove(e) {
                if (!drag) return;
                if (!drag.started) {
                    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 5) return;
                    begin();
                }
                ghost.style.left = e.clientX + "px";
                ghost.style.top = e.clientY + "px";
                drag.target = paletteDropTarget(e.clientX, e.clientY);
                paint(drag.target, e.clientX, e.clientY);
                e.preventDefault();
            }
            function onUp(e) {
                var d = drag; drag = null;
                cleanup();
                if (!d || !d.started) return; // обычный клик — обработает существующий click-хендлер
                state.paletteJustDragged = true; // гасим парный click по плитке
                if (d.target) dropBlockAt(d.type, d.target);
            }
            for (var i = 0; i < tiles.length; i++) {
                tiles[i].addEventListener("pointerdown", function (e) {
                    if (e.button !== 0) return;
                    drag = { type: this.getAttribute("data-doc-add"), tile: this, x0: e.clientX, y0: e.clientY, started: false, target: null };
                    window.addEventListener("pointermove", onMove, true);
                    window.addEventListener("pointerup", onUp, true);
                    window.addEventListener("pointercancel", onUp, true);
                });
            }
        }
        initPaletteDrag();

        window.__LIME_SELECTION__ = selection;
        refresh();
    }

    // ===== EDITOR V2 VIEWPORT (Stage 2, feature flag ?canvas=1) =====
    function initV2Viewport() {
        if (!isCanvasOn() || !window.LimeViewport) return;
        var stage = document.getElementById("lime-canvas-viewport");
        var canvas = ws.closest(".lime-editor__canvas");
        if (!stage || !canvas) return;
        canvas.classList.add("is-v2-viewport");
        var controls = document.querySelector("[data-canvas-controls]");
        if (controls) controls.hidden = false;

        var viewport = window.LimeViewport.createViewport({ x: 48, y: 72, zoom: 0.9, minZoom: 0.1, maxZoom: 4 });
        var label = document.querySelector("[data-canvas-zoom-label]");
        function applyViewport(s) {
            ws.style.transform = "translate(" + s.x + "px," + s.y + "px) scale(" + s.zoom + ")";
            if (label) {
                label.textContent = Math.round(s.zoom * 100) + "%";
                label.title = "Сбросить масштаб до 100%";
            }
        }
        viewport.subscribe(applyViewport);
        applyViewport(viewport.get());

        function localPoint(e) {
            var r = stage.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        stage.addEventListener("wheel", function (e) {
            e.preventDefault();
            var factor = Math.exp(-e.deltaY * 0.0015);
            viewport.zoomBy(localPoint(e), factor);
        }, { passive: false });

        var spaceDown = false;
        var pan = null;
        document.addEventListener("keydown", function (e) {
            if (e.code !== "Space" || isTextField(e)) return;
            spaceDown = true;
            stage.classList.add("is-panning");
            e.preventDefault();
        });
        document.addEventListener("keyup", function (e) {
            if (e.code !== "Space") return;
            spaceDown = false;
            if (!pan) stage.classList.remove("is-panning");
        });
        stage.addEventListener("pointerdown", function (e) {
            if (!(spaceDown || e.button === 1)) return;
            e.preventDefault(); e.stopPropagation();
            pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
            stage.classList.add("is-panning");
            try { stage.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
        }, true);
        stage.addEventListener("pointermove", function (e) {
            if (!pan || pan.id !== e.pointerId) return;
            var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
            pan.x = e.clientX; pan.y = e.clientY;
            viewport.panBy(dx, dy);
        });
        function endPan(e) {
            if (!pan || pan.id !== e.pointerId) return;
            try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            pan = null;
            if (!spaceDown) stage.classList.remove("is-panning");
        }
        stage.addEventListener("pointerup", endPan);
        stage.addEventListener("pointercancel", endPan);

        function centerPoint() { return { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }; }
        function fit() {
            viewport.fitBounds(
                { x: 0, y: 0, width: Math.max(1, ws.offsetWidth), height: Math.max(1, ws.scrollHeight) },
                { width: stage.clientWidth, height: stage.clientHeight },
                48
            );
        }
        var zoomIn = document.querySelector("[data-canvas-zoom-in]");
        var zoomOut = document.querySelector("[data-canvas-zoom-out]");
        var fitBtn = document.querySelector("[data-canvas-fit]");
        if (zoomIn) zoomIn.addEventListener("click", function () { viewport.zoomBy(centerPoint(), 1.2); });
        if (zoomOut) zoomOut.addEventListener("click", function () { viewport.zoomBy(centerPoint(), 1 / 1.2); });
        if (label) label.addEventListener("click", function () { viewport.zoomAt(centerPoint(), 1); });
        if (fitBtn) fitBtn.addEventListener("click", fit);
        initV2Selection(stage, viewport, function () { return !!(spaceDown || pan); });
        window.__LIME_VIEWPORT__ = viewport; // временный debug/test seam, не часть document JSON
        setTimeout(fit, 0);
    }


        return {
            initViewport: initV2Viewport,
            refreshSelectionOverlay: function () { refreshSelectionOverlay(); }
        };
    }

    return { create: create };
});
