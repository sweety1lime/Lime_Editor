/* Lime editor sidebar rail and block search. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorSidebar = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : null);
        if (!doc) return { blockSearch: null, filterBlocks: function () {}, open: function () {} };

        var sidebar = doc.querySelector(".lime-editor__sidebar");
        var blockSearch = doc.getElementById("lime-block-search");

        function filterBlocks(query) {
            var q = (query || "").trim().toLowerCase();
            if (!sidebar) return;
            var tiles = sidebar.querySelectorAll(".lime-tile-group [data-doc-add]");
            for (var i = 0; i < tiles.length; i++) {
                var label = tiles[i].textContent.toLowerCase();
                tiles[i].classList.toggle("is-hidden", !!q && label.indexOf(q) < 0);
            }
            var groups = sidebar.querySelectorAll(".lime-tile-group");
            for (var g = 0; g < groups.length; g++) {
                if (q) {
                    groups[g].open = true;
                    var visible = groups[g].querySelectorAll("[data-doc-add]:not(.is-hidden)").length;
                    groups[g].classList.toggle("is-hidden", visible === 0);
                } else {
                    groups[g].classList.remove("is-hidden");
                }
            }
        }

        function setSidebarPanel(name) {
            if (!sidebar) return;
            var toggles = sidebar.querySelectorAll("[data-sidebar-panel-toggle]");
            var panels = sidebar.querySelectorAll("[data-sidebar-panel]");
            for (var i = 0; i < panels.length; i++) {
                var activePanel = panels[i].getAttribute("data-sidebar-panel") === name;
                panels[i].hidden = !activePanel;
                panels[i].classList.toggle("is-active", activePanel);
            }
            for (var j = 0; j < toggles.length; j++) {
                var activeToggle = toggles[j].getAttribute("data-sidebar-panel-toggle") === name;
                toggles[j].classList.toggle("is-active", activeToggle);
                toggles[j].setAttribute("aria-pressed", activeToggle ? "true" : "false");
            }
        }

        if (blockSearch) {
            blockSearch.addEventListener("input", function () { filterBlocks(blockSearch.value); });
            blockSearch.addEventListener("focus", function () { setSidebarPanel("insert"); });
        }

        if (sidebar) {
            sidebar.addEventListener("click", function (e) {
                var btn = e.target.closest("[data-sidebar-panel-toggle]");
                if (!btn) return;
                setSidebarPanel(btn.getAttribute("data-sidebar-panel-toggle"));
            });
            setSidebarPanel("insert");
        }

        if (win) win.__LIME_SIDEBAR__ = { open: setSidebarPanel };

        return {
            blockSearch: blockSearch,
            filterBlocks: filterBlocks,
            open: setSidebarPanel,
            setSidebarPanel: setSidebarPanel
        };
    }

    return {
        create: create
    };
});
