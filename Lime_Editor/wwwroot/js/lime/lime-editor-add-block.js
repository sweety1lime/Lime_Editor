/* Lime editor block insertion from palette and empty canvas actions. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorAddBlock = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var L = options.L || {};
        var ws = options.ws || null;
        var getPaletteJustDragged = options.getPaletteJustDragged || function () { return false; };
        var setPaletteJustDragged = options.setPaletteJustDragged || noop;
        var getSelectedId = options.getSelectedId || function () { return null; };
        var setSelectedId = options.setSelectedId || noop;
        var getActive = options.getActive || function () { return 0; };
        var pageBlocks = options.pageBlocks || function () { return []; };
        var findBlock = options.findBlock || function () { return null; };
        var targetBlock = options.targetBlock || function (block) { return block; };
        var runCommand = options.runCommand || function () { return false; };
        var finishInsert = options.finishInsert || noop;
        var aiOpen = options.aiOpen || noop;
        if (!doc || !L.createBlock) return { insertBlock: noop };

        function insertBlock(type) {
            if (getPaletteJustDragged()) {
                setPaletteJustDragged(false);
                return null;
            }
            var b = L.createBlock(type);
            var selectedId = getSelectedId();
            var sel = selectedId ? findBlock(selectedId) : null;
            var t = sel ? targetBlock(sel.block) : null;
            var intoContainer = t && L.isContainer && L.isContainer(t.type);
            var parentId = intoContainer ? sel.block.id : null;
            var index = intoContainer ? ((t.children && t.children.length) || 0) : pageBlocks().length;
            var commandApplied = runCommand("insertBlock", {
                block: b,
                parentId: parentId,
                pageIndex: getActive(),
                index: index
            });
            if (!commandApplied) {
                if (intoContainer) {
                    if (!t.children) t.children = [];
                    t.children.push(b);
                } else {
                    pageBlocks().push(b);
                }
            }
            setSelectedId(b.id);
            finishInsert(b, parentId, null, commandApplied);
            if (win.__LIME_SELECTION__ && win.__LIME_SELECTION__.replace) win.__LIME_SELECTION__.replace([b.id]);
            return b;
        }

        var addBtns = doc.querySelectorAll("[data-doc-add]");
        for (var i = 0; i < addBtns.length; i++) {
            addBtns[i].addEventListener("click", function (e) {
                if (e && e.stopPropagation) e.stopPropagation();
                insertBlock(this.dataset.docAdd);
            });
        }

        if (ws && ws.addEventListener) {
            ws.addEventListener("click", function (e) {
                var target = e && e.target;
                var addBtn = target && target.closest && target.closest("[data-doc-empty-add]");
                if (addBtn) {
                    if (e.stopPropagation) e.stopPropagation();
                    var tile = doc.querySelector('[data-doc-add="' + addBtn.getAttribute("data-doc-empty-add") + '"]');
                    if (tile && tile.click) tile.click();
                    return;
                }
                if (target && target.closest && target.closest("[data-doc-empty-ai]")) {
                    if (e.stopPropagation) e.stopPropagation();
                    aiOpen();
                }
            });
        }

        return { insertBlock: insertBlock };
    }

    return { create: create };
});
