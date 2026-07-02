/* Lime editor breakpoint switcher and animation preview wiring. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorBreakpoints = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var ws = options.ws || null;
        var setCurrentBp = options.setCurrentBp || function () {};
        var applyPreviewStyles = options.applyPreviewStyles || function () {};
        var refreshInspector = options.refreshInspector || function () {};
        if (!doc) return { switchBreakpoint: function () {} };

        var bpBtns = doc.querySelectorAll("[data-doc-bp]");
        function switchBreakpoint(bp) {
            setCurrentBp(bp);
            for (var k = 0; k < bpBtns.length; k++) {
                bpBtns[k].classList.toggle("is-active", bpBtns[k].dataset.docBp === bp);
            }
            if (ws) ws.setAttribute("data-device", bp === "base" ? "desktop" : bp);
            applyPreviewStyles();
            refreshInspector();
        }
        for (var i = 0; i < bpBtns.length; i++) {
            bpBtns[i].addEventListener("click", function () { switchBreakpoint(this.dataset.docBp); });
        }

        var animPreviewBtn = doc.querySelector("[data-doc-anim-preview]");
        if (animPreviewBtn) animPreviewBtn.addEventListener("click", function () {
            if (win.LimeAnim && win.LimeAnim.play) win.LimeAnim.play(ws);
        });

        return { switchBreakpoint: switchBreakpoint };
    }

    return { create: create };
});
