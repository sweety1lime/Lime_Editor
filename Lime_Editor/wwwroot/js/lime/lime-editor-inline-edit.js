/* Lime editor inline content editing without full render. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorInlineEdit = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var ws = options.ws || null;
        var getDoc = options.getDoc || function () { return {}; };
        var setDoc = options.setDoc || noop;
        var getCmdStore = options.getCmdStore || function () { return null; };
        var setCmdPrev = options.setCmdPrev || noop;
        var byId = options.byId || function () { return null; };
        var targetBlock = options.targetBlock || function (block) { return block; };
        var setByPath = options.setByPath || noop;
        var setComponentContentOverrideLocal = options.setComponentContentOverrideLocal || noop;
        var beginCheckpointMutation = options.beginCheckpointMutation || noop;
        var commitStyleEdit = options.commitStyleEdit || noop;
        var commitBlockEdit = options.commitBlockEdit || noop;
        var updateHistButtons = options.updateHistButtons || noop;
        var scheduleAutosave = options.scheduleAutosave || noop;
        var markDirty = options.markDirty || noop;
        var nativeSetTimer = win.setTimeout || (typeof setTimeout !== "undefined" ? setTimeout : function (fn) { fn(); return 0; });
        var nativeClearTimer = win.clearTimeout || (typeof clearTimeout !== "undefined" ? clearTimeout : noop);
        var editDebounce;
        var editTxn = false;
        var editTxnKey = null;

        function setTimer(fn, ms) {
            return nativeSetTimer.call(win, fn, ms);
        }

        function clearTimer(id) {
            if (id == null) return;
            nativeClearTimer.call(win, id);
        }

        function clearPending() {
            clearTimer(editDebounce);
            editDebounce = null;
        }

        function commitInlineEdit() {
            clearPending();
            var cmdStore = getCmdStore();
            if (!editTxn || !cmdStore) return;
            cmdStore.commit("inline-content");
            editTxn = false;
            editTxnKey = null;
            var nextDoc = cmdStore.getDoc();
            setDoc(nextDoc);
            setCmdPrev(JSON.stringify(nextDoc));
            updateHistButtons();
            scheduleAutosave();
        }

        function handleInput(e) {
            var target = e && e.target;
            var f = target && target.closest && target.closest("[data-field]");
            if (!f) return;
            var sec = f.closest(".lime-block");
            if (!sec) return;
            var b = byId(sec.getAttribute("data-block-id"));
            if (!b) return;
            var field = f.getAttribute("data-field");
            var value = f.textContent;
            var doc = getDoc();
            var directBlock = targetBlock(b) === b;
            var componentInstance = b.type === "component" && doc.components && doc.components[b.ref];
            var cmdStore = getCmdStore();
            if (cmdStore && (directBlock || componentInstance)) {
                commitStyleEdit();
                commitBlockEdit();
                var key = b.id + ":" + field;
                if (editTxn && editTxnKey !== key) commitInlineEdit();
                if (!editTxn) {
                    cmdStore.begin("inline-content");
                    editTxn = true;
                    editTxnKey = key;
                }
                var commandType = componentInstance ? "setComponentContentOverride" : "setContent";
                if (cmdStore.dispatch(commandType, { id: b.id, field: field, value: value })) {
                    setDoc(cmdStore.getDoc());
                    clearPending();
                    editDebounce = setTimer(commitInlineEdit, 600);
                    return;
                }
                cmdStore.cancel();
                editTxn = false;
                editTxnKey = null;
            } else {
                beginCheckpointMutation();
            }
            if (componentInstance) setComponentContentOverrideLocal(b, field, value, false);
            else setByPath(targetBlock(b).content, field, value);
            clearPending();
            editDebounce = setTimer(markDirty, 600);
        }

        if (ws && ws.addEventListener) ws.addEventListener("input", handleInput);

        return {
            clearPending: clearPending,
            commitInlineEdit: commitInlineEdit,
            handleInput: handleInput,
            isEditing: function () { return editTxn; }
        };
    }

    return { create: create };
});
