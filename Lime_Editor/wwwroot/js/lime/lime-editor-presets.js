/* Lime editor presets, startup templates and block specs. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorPresets = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var document = options.document || win.document || null;
        var L = options.L || {};
        var ws = options.ws || null;
        // doc — геттером: main переприсваивает doc на undo/redo/restore, прямая ссылка протухает.
        var getDoc = options.getDoc || function () { return {}; };
        var pageBlocks = options.pageBlocks || function () { return []; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var setSelectedId = options.setSelectedId || function () {};
        var findBlock = options.findBlock || function () { return null; };
        var targetBlock = options.targetBlock || function (block) { return block; };
        var rid = options.rid || function (prefix) { return (prefix || "id") + Math.random().toString(36).slice(2, 9); };
        var render = options.render || function () {};
        var markDirty = options.markDirty || function () {};

        function blockFromSpec(spec) {
            if (!spec || !spec.type || !L.createBlock) return null;
            var b = L.createBlock(spec.type);
            if (spec.content) Object.keys(spec.content).forEach(function (k) { b.content[k] = clone(spec.content[k]); });
            if (spec.styles) b.styles = clone(spec.styles);
            if (spec.css) b.css = spec.css;
            ["anim", "animDelay", "animDuration", "parallax", "sticky", "stickyOffset", "marquee", "scene", "layers", "fx"].forEach(function (k) {
                if (spec[k] != null) b[k] = clone(spec[k]);
            });
            if (b.layers) b.layers.forEach(function (l) { l.id = rid("l"); });
            if (spec.children && spec.children.length) b.children = spec.children.map(blockFromSpec);
            return b;
        }

        function insertPreset(key) {
            var lib = win.LimePresets && win.LimePresets.PRESETS;
            var specs = lib && lib[key];
            if (!specs || !specs.length) return false;
            var selectedId = getSelectedId();
            var sel = selectedId ? findBlock(selectedId) : null;
            var t = sel ? targetBlock(sel.block) : null;
            var target = (t && L.isContainer && L.isContainer(t.type)) ? (t.children || (t.children = [])) : pageBlocks();
            var firstId = null;
            specs.forEach(function (spec) {
                var b = blockFromSpec(spec);
                if (!b) return;
                if (!firstId) firstId = b.id;
                target.push(b);
            });
            setSelectedId(null);
            render();
            markDirty();
            var el = firstId && ws && ws.querySelector && ws.querySelector('[data-block-id="' + firstId + '"]');
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            return true;
        }

        function applyTemplateByKey(key) {
            var list = win.LimeTemplates || [];
            var tpl = null;
            for (var i = 0; i < list.length; i++) if (list[i].key === key) { tpl = list[i]; break; }
            if (!tpl) return false;
            var doc = getDoc();
            // Milestone 4 (experience-builder-plan.md): штамп для asset-slot требований в
            // инспекторе — какой пак/шаблон построил документ. Для обычных шаблонов (не Experience
            // Pack) безвреден — LimeExperiencePacks.resolve(key) просто вернёт null.
            doc.pack = key;
            if (!doc.theme) doc.theme = {};
            if (tpl.theme) Object.keys(tpl.theme).forEach(function (k) { doc.theme[k] = tpl.theme[k]; });
            var lib = win.LimePresets && win.LimePresets.PRESETS;
            (tpl.sections || []).forEach(function (secKey) {
                var specs = lib && lib[secKey];
                if (specs) specs.forEach(function (spec) {
                    var b = blockFromSpec(spec);
                    if (b) pageBlocks().push(b);
                });
            });
            return true;
        }

        function renderPresetTiles() {
            if (!document) return;
            var presetsBox = document.getElementById("lime-doc-presets");
            if (!presetsBox || !win.LimePresets || !win.LimePresets.META) return;
            presetsBox.innerHTML = win.LimePresets.META.map(function (m) {
                return '<button type="button" class="lime-block-tile" data-doc-preset="' + m.key + '">' +
                    '<span class="lime-block-tile__icon">' + m.icon + '</span><span>' + m.label + '</span></button>';
            }).join("");
            presetsBox.addEventListener("click", function (e) {
                var btn = e.target.closest("[data-doc-preset]");
                if (btn) {
                    e.stopPropagation();
                    insertPreset(btn.dataset.docPreset);
                }
            });
        }

        renderPresetTiles();

        return {
            applyTemplateByKey: applyTemplateByKey,
            blockFromSpec: blockFromSpec,
            insertPreset: insertPreset,
            renderPresetTiles: renderPresetTiles
        };
    }

    return { create: create };
});
