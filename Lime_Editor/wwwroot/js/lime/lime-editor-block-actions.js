/* Lime editor block actions: selection, clipboard, structural ops and grouping. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorBlockActions = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var document = options.document || win.document || null;
        var L = options.L || {};
        var ws = options.ws || null;
        var getSelectedId = options.getSelectedId || function () { return null; };
        var setSelectedId = options.setSelectedId || noop;
        var setCurrentState = options.setCurrentState || noop;
        var setCurrentClass = options.setCurrentClass || noop;
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getActive = options.getActive || function () { return 0; };
        var hasCmdStore = options.hasCmdStore || function () { return false; };
        var pageBlocks = options.pageBlocks || function () { return []; };
        var findBlock = options.findBlock || function () { return null; };
        var targetBlock = options.targetBlock || function (block) { return block; };
        var resolvedBlockDesign = options.resolvedBlockDesign || function () { return {}; };
        var cloneValue = options.clone || function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
        var reid = options.reid || function (block) { return block; };
        var runCommand = options.runCommand || function () { return false; };
        var beginCheckpointMutation = options.beginCheckpointMutation || noop;
        var finishInsert = options.finishInsert || noop;
        var finishRemove = options.finishRemove || noop;
        var finishMove = options.finishMove || noop;
        var finishMutation = options.finishMutation || noop;
        var removeBlocksDom = options.removeBlocksDom || function () { return false; };
        var insertBlockDom = options.insertBlockDom || function () { return false; };
        var removeBlockDom = options.removeBlockDom || function () { return false; };
        var refreshInspector = options.refreshInspector || noop;
        var refreshLayers = options.refreshLayers || noop;
        var render = options.render || noop;
        var scheduleAutosave = options.scheduleAutosave || noop;
        var markDirty = options.markDirty || noop;
        var setStatus = options.setStatus || noop;
        var v2SelectionIds = options.v2SelectionIds || function () { return []; };
        var CLIP_KEY = "lime-doc-clip";
        var clipboard = null;

        function currentBp() { return getCurrentBp(); }

        function moveBlock(dir) {
            var selectedId = getSelectedId();
            var found = findBlock(selectedId);
            if (!found) return;
            var nextIndex = found.index + dir;
            if (nextIndex < 0 || nextIndex >= found.parent.length) return;
            var commandApplied = runCommand("reorderBlock", { id: found.block.id, toIndex: nextIndex });
            if (!commandApplied) {
                var tmp = found.parent[found.index];
                found.parent[found.index] = found.parent[nextIndex];
                found.parent[nextIndex] = tmp;
            }
            finishMove(found.block.id, found.parentBlock ? found.parentBlock.id : null, nextIndex, commandApplied);
        }

        function dupBlock() {
            var found = findBlock(getSelectedId());
            if (!found) return;
            var copy = reid(cloneValue(found.block));
            var commandApplied = runCommand("insertBlock", {
                block: copy,
                parentId: found.parentBlock ? found.parentBlock.id : null,
                pageIndex: getActive(),
                index: found.index + 1
            });
            if (!commandApplied) found.parent.splice(found.index + 1, 0, copy);
            setSelectedId(copy.id);
            finishInsert(copy, found.parentBlock ? found.parentBlock.id : null, found.index + 1, commandApplied);
        }

        function delBlock() {
            var found = findBlock(getSelectedId());
            if (!found) return;
            var removedId = found.block.id;
            var commandApplied = runCommand("removeBlock", { id: found.block.id });
            if (!commandApplied) found.parent.splice(found.index, 1);
            setSelectedId(null);
            finishRemove(removedId, commandApplied);
        }

        function unwrapBlock() {
            var found = findBlock(getSelectedId());
            if (!found || !found.parentBlock) return;
            var parentFound = findBlock(found.parentBlock.id);
            if (!parentFound) return;
            var commandApplied = runCommand("moveBlock", {
                id: found.block.id,
                parentId: parentFound.parentBlock ? parentFound.parentBlock.id : null,
                pageIndex: getActive(),
                toIndex: parentFound.index + 1
            });
            if (!commandApplied) {
                found.parent.splice(found.index, 1);
                parentFound.parent.splice(parentFound.index + 1, 0, found.block);
            }
            finishMove(found.block.id, parentFound.parentBlock ? parentFound.parentBlock.id : null, parentFound.index + 1, commandApplied);
        }

        function selectedSiblingItems(ids) {
            ids = ids || [];
            if (ids.length < 2) return null;
            var seen = {}, parent = null, parentBlock = null, items = [];
            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                if (!id || seen[id]) return null;
                seen[id] = true;
                var found = findBlock(id);
                if (!found) return null;
                if (parent && parent !== found.parent) return null;
                parent = found.parent;
                parentBlock = found.parentBlock;
                items.push(found);
            }
            items.sort(function (a, b) { return a.index - b.index; });
            return { parent: parent, parentBlock: parentBlock, items: items };
        }

        function frameNumber(value, fallback) {
            if (typeof value === "number" && isFinite(value)) return value;
            if (typeof value === "string" && /^-?(?:\d+|\d*\.\d+)/.test(value.trim())) return parseFloat(value);
            return fallback;
        }

        function frameForGroup(block) {
            var design = resolvedBlockDesign(block, currentBp());
            var frame = (design && design.frame) || {};
            var out = {
                x: frameNumber(frame.x, 0),
                y: frameNumber(frame.y, 0),
                width: Math.max(8, frameNumber(frame.width, 100)),
                height: Math.max(8, frameNumber(frame.height, 100))
            };
            if (typeof frame.rotation === "number" && isFinite(frame.rotation)) out.rotation = frame.rotation;
            return out;
        }

        function parentLayoutIsFree(parentBlock) {
            var target = parentBlock && targetBlock(parentBlock);
            var design = target && L.resolvedDesign && L.resolvedDesign(target.design, currentBp());
            return !!(design && design.layout && design.layout.mode === "free");
        }

        function blockWithFrame(block, frame) {
            var out = cloneValue(block);
            if (!out.design) out.design = {};
            if (!out.design[currentBp()]) out.design[currentBp()] = {};
            out.design[currentBp()].frame = frame;
            return out;
        }

        function frameBounds(frames) {
            var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            for (var i = 0; i < frames.length; i++) {
                var frame = frames[i];
                left = Math.min(left, frame.x); top = Math.min(top, frame.y);
                right = Math.max(right, frame.x + frame.width); bottom = Math.max(bottom, frame.y + frame.height);
            }
            return {
                x: Math.round(left), y: Math.round(top),
                width: Math.max(8, Math.round(right - left)),
                height: Math.max(8, Math.round(bottom - top))
            };
        }

        function buildGroupBlock(selection, freeParent) {
            var group = L.createBlock ? L.createBlock("group") : { id: "group", type: "group", children: [] };
            group.name = "Group";
            if (!freeParent) {
                group.children = selection.items.map(function (item) { return item.block; });
                return group;
            }
            var frames = selection.items.map(function (item) { return frameForGroup(item.block); });
            var bounds = frameBounds(frames);
            group.children = selection.items.map(function (item, index) {
                var frame = frames[index];
                var next = {
                    x: Math.round(frame.x - bounds.x),
                    y: Math.round(frame.y - bounds.y),
                    width: Math.max(8, Math.round(frame.width)),
                    height: Math.max(8, Math.round(frame.height))
                };
                if (typeof frame.rotation === "number" && frame.rotation !== 0) next.rotation = frame.rotation;
                return blockWithFrame(item.block, next);
            });
            group.design = {};
            group.design[currentBp()] = {
                layout: { mode: "free" },
                size: {
                    width: { mode: "fixed", value: bounds.width },
                    height: { mode: "fixed", value: bounds.height }
                },
                frame: bounds
            };
            return group;
        }

        function finishGroupDom(group, parentBlock, index, oldIds, commandApplied) {
            var parentId = parentBlock ? parentBlock.id : null;
            var ok = removeBlocksDom(oldIds) &&
                insertBlockDom(group, parentId, index, { allowDesign: true, refreshDesign: true });
            if (ok) refreshInspector(); else render();
            if (commandApplied) scheduleAutosave(); else markDirty();
        }

        function finishUngroupDom(groupId, parentBlock, index, children, commandApplied) {
            var parentId = parentBlock ? parentBlock.id : null;
            var ok = removeBlockDom(groupId);
            for (var i = 0; ok && i < children.length; i++) {
                ok = insertBlockDom(children[i], parentId, index + i, { allowDesign: true, refreshDesign: true });
            }
            if (ok) refreshInspector(); else render();
            if (commandApplied) scheduleAutosave(); else markDirty();
        }

        function groupSelection() {
            var selection = selectedSiblingItems(v2SelectionIds());
            if (!selection) { setStatus("Select sibling blocks to group", "lime-text-danger"); return; }
            var group = buildGroupBlock(selection, parentLayoutIsFree(selection.parentBlock));
            var ids = selection.items.map(function (item) { return item.block.id; });
            var groupIndex = selection.items[0].index;
            var commandApplied = false;
            if (hasCmdStore()) {
                commandApplied = runCommand("groupBlocks", { ids: ids, group: group });
                if (!commandApplied) return;
            } else {
                beginCheckpointMutation();
                for (var i = selection.items.length - 1; i >= 0; i--) selection.parent.splice(selection.items[i].index, 1);
                selection.parent.splice(selection.items[0].index, 0, group);
            }
            setSelectedId(group.id);
            finishGroupDom(group, selection.parentBlock, groupIndex, ids, commandApplied);
            if (win.__LIME_SELECTION__) win.__LIME_SELECTION__.replace([group.id]);
        }

        function childrenForUngroup(found) {
            var kids = found.block.children || [];
            if (!parentLayoutIsFree(found.parentBlock)) return kids;
            var groupFrame = frameForGroup(found.block);
            return kids.map(function (child) {
                var frame = frameForGroup(child);
                var next = {
                    x: Math.round(groupFrame.x + frame.x),
                    y: Math.round(groupFrame.y + frame.y),
                    width: Math.max(8, Math.round(frame.width)),
                    height: Math.max(8, Math.round(frame.height))
                };
                if (typeof frame.rotation === "number" && frame.rotation !== 0) next.rotation = frame.rotation;
                return blockWithFrame(child, next);
            });
        }

        function ungroupBlock() {
            var found = findBlock(getSelectedId());
            if (!found || !found.block || found.block.type !== "group" || !found.block.children || !found.block.children.length) return;
            var children = childrenForUngroup(found);
            var childIds = children.map(function (child) { return child.id; });
            var groupId = found.block.id;
            var parentBlock = found.parentBlock;
            var groupIndex = found.index;
            var commandApplied = false;
            if (hasCmdStore()) {
                commandApplied = runCommand("ungroupBlock", { id: found.block.id, children: children });
                if (!commandApplied) return;
            } else {
                beginCheckpointMutation();
                found.parent.splice(found.index, 1);
                for (var i = 0; i < children.length; i++) found.parent.splice(found.index + i, 0, children[i]);
            }
            setSelectedId(childIds[0] || null);
            finishUngroupDom(groupId, parentBlock, groupIndex, children, commandApplied);
            if (win.__LIME_SELECTION__) win.__LIME_SELECTION__.replace(childIds);
        }

        function copyBlock() {
            var found = findBlock(getSelectedId());
            if (!found) return;
            clipboard = cloneValue(found.block);
            try { win.localStorage.setItem(CLIP_KEY, JSON.stringify(clipboard)); } catch (e) { /* private mode */ }
            setStatus("Блок скопирован", "");
        }

        function readClip() {
            if (clipboard) return clipboard;
            try { return JSON.parse(win.localStorage.getItem(CLIP_KEY)); } catch (e) { return null; }
        }

        function pasteBlock() {
            var data = readClip();
            if (!data) return;
            var copy = reid(cloneValue(data));
            var found = findBlock(getSelectedId());
            var commandApplied = runCommand("insertBlock", {
                block: copy,
                parentId: found && found.parentBlock ? found.parentBlock.id : null,
                pageIndex: getActive(),
                index: found ? found.index + 1 : pageBlocks().length
            });
            if (!commandApplied) {
                if (found) found.parent.splice(found.index + 1, 0, copy);
                else pageBlocks().push(copy);
            }
            setSelectedId(copy.id);
            finishMutation(commandApplied);
        }

        function selectById(id) {
            setSelectedId(id);
            setCurrentState("normal");
            setCurrentClass(null);
            if (ws) {
                var all = ws.querySelectorAll(".is-selected");
                for (var i = 0; i < all.length; i++) all[i].classList.remove("is-selected");
                var blockEl = ws.querySelector('[data-block-id="' + id + '"]');
                if (blockEl) {
                    blockEl.classList.add("is-selected");
                    blockEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            }
            refreshInspector();
            refreshLayers();
        }

        function deselect() {
            setSelectedId(null);
            setCurrentClass(null);
            if (ws) {
                var all = ws.querySelectorAll(".is-selected");
                for (var i = 0; i < all.length; i++) all[i].classList.remove("is-selected");
            }
            refreshInspector();
            refreshLayers();
        }

        return {
            moveBlock: moveBlock,
            dupBlock: dupBlock,
            delBlock: delBlock,
            unwrapBlock: unwrapBlock,
            groupSelection: groupSelection,
            ungroupBlock: ungroupBlock,
            copyBlock: copyBlock,
            readClip: readClip,
            pasteBlock: pasteBlock,
            selectById: selectById,
            deselect: deselect
        };
    }

    return { create: create };
});
