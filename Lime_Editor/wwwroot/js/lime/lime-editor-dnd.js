/*
 * Lime editor drag-and-drop (вынос из lime-doc-editor.js).
 *
 * SortableJS на всех уровнях вложенности. Модель — источник правды: Sortable даёт
 * from/to/oldIndex/newIndex, мы переносим блок между массивами документа (command-store
 * reorder/move либо legacy splice-fallback) и обновляем UI. initDnD идемпотентен (Stage 7):
 * Sortable создаётся только для новых списков, выпавшие из DOM — чистятся; метка __limeDnd
 * на элементе-списке. Изменяемое состояние main (active/selectedId/canvasOn) — через
 * get/set-инъекции; refreshV2SelectionOverlay — thunk (main переприсваивает её при
 * инициализации canvas). Браузер-онли.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorDnd = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var ws = options.ws;
        var pageBlocks = options.pageBlocks || function () { return []; };
        var byId = options.byId || function () { return null; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        var runCommand = options.runCommand || function () { return false; };
        var finishMutation = options.finishMutation || noop;
        var getActive = options.getActive || function () { return 0; };
        var setSelectedId = options.setSelectedId || noop;
        var render = options.render || noop;
        var applyPreviewStyles = options.applyPreviewStyles || noop;
        var refreshInspector = options.refreshInspector || noop;
        var isCanvasOn = options.isCanvasOn || function () { return false; };
        var refreshV2SelectionOverlay = options.refreshV2SelectionOverlay || noop;
        var scheduleLayersRefresh = options.scheduleLayersRefresh || noop;
        var scheduleAutosave = options.scheduleAutosave || noop;
        var markDirty = options.markDirty || noop;
        var perfNow = options.perfNow || function () { return Date.now(); };
        var perfRec = options.perfRec || noop;

        var sortables = [];

        // DOM-список → массив блоков в документе.
        function arrayOfList(listEl) {
            if (listEl.classList.contains("lime-doc-page")) return pageBlocks();
            var sec = listEl.closest(".lime-block");
            var b = sec && byId(sec.getAttribute("data-block-id"));
            if (!b) return null;
            var t = targetBlock(b);
            if (!t.children) t.children = [];
            return t.children;
        }
        function parentIdOfList(listEl) {
            if (listEl.classList.contains("lime-doc-page")) return null;
            var sec = listEl.closest(".lime-block");
            return sec ? sec.getAttribute("data-block-id") : null;
        }
        // Защита от цикла: нельзя бросить контейнер внутрь его собственного поддерева.
        function subtreeOwnsArray(block, arr) {
            var t = targetBlock(block);
            if (!t || !t.children) return false;
            if (t.children === arr) return true;
            for (var i = 0; i < t.children.length; i++) {
                if (subtreeOwnsArray(t.children[i], arr)) return true;
            }
            return false;
        }
        function onDragEnd(evt) {
            var fromArr = arrayOfList(evt.from);
            var toArr = arrayOfList(evt.to);
            if (!fromArr || !toArr) { render(); return; }
            if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
            var moved = fromArr[evt.oldIndex];
            if (!moved || subtreeOwnsArray(moved, toArr)) { render(); return; }
            var commandApplied = fromArr === toArr
                ? runCommand("reorderBlock", {
                    id: moved.id,
                    toIndex: Math.min(evt.newIndex, toArr.length - 1)
                })
                : runCommand("moveBlock", {
                    id: moved.id,
                    parentId: parentIdOfList(evt.to),
                    pageIndex: getActive(),
                    toIndex: Math.min(evt.newIndex, toArr.length)
                });
            if (!commandApplied) {
                fromArr.splice(evt.oldIndex, 1);
                toArr.splice(Math.min(evt.newIndex, toArr.length), 0, moved);
            }
            setSelectedId(moved.id);
            // v2 design-блок: CSS frame/size зависит от родителя и живёт в основном <style> → полный render.
            if (moved.design) { finishMutation(commandApplied); return; }
            // Stage 7: Sortable УЖЕ переместил DOM-узел в нужную позицию, модель синхронна → полная
            // пересборка не нужна, только вспомогательный UI (design-preview зависит от нового родителя).
            var __dt = perfNow();
            applyPreviewStyles();
            refreshInspector();
            if (isCanvasOn()) refreshV2SelectionOverlay();
            scheduleLayersRefresh();
            perfRec("inc", __dt);
            if (commandApplied) scheduleAutosave(); else markDirty();
        }
        // Идемпотентно (Stage 7): создаёт Sortable только для НОВЫХ списков, выпавшие из DOM — чистит.
        // Для полного render() поведение прежнее (innerHTML заменил всё → старые списки detached →
        // destroy, новые → create). Для точечных insert/remove пересоздаётся только затронутый список,
        // а не все 500. Метка `__limeDnd` на элементе-списке (не зависим от версии Sortable.get).
        function initDnD() {
            if (!win.Sortable) return;
            var kept = [];
            for (var i = 0; i < sortables.length; i++) {
                var s = sortables[i];
                if (s.el && ws.contains(s.el)) { kept.push(s); continue; }
                try { if (s.el) delete s.el.__limeDnd; s.destroy(); } catch (e) { /* DOM уже выброшен */ }
            }
            sortables = kept;
            var lists = [];
            var page = ws.querySelector(".lime-doc-page");
            if (page) lists.push(page);
            var kids = ws.querySelectorAll(".lime-block__children");
            for (var k = 0; k < kids.length; k++) lists.push(kids[k]);
            for (var j = 0; j < lists.length; j++) {
                if (lists[j].__limeDnd) continue; // уже есть Sortable — не трогаем
                var inst = new win.Sortable(lists[j], {
                    group: "lime-doc",
                    handle: ".lime-block-grip",
                    draggable: ".lime-block",
                    animation: 160,
                    fallbackOnBody: true,
                    invertSwap: true,
                    ghostClass: "sortable-ghost",
                    onEnd: onDragEnd
                });
                lists[j].__limeDnd = inst;
                sortables.push(inst);
            }
        }

        return {
            initDnD: initDnD,
            onDragEnd: onDragEnd,
            arrayOfList: arrayOfList,
            subtreeOwnsArray: subtreeOwnsArray
        };
    }

    return { create: create };
});
