/* Lime editor reusable style classes panel and actions. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorClasses = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var getDoc = options.getDoc || function () { return { pages: [], components: {}, theme: {} }; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        var byId = options.byId || function () { return null; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentClass = options.getCurrentClass || function () { return null; };
        var setCurrentClass = options.setCurrentClass || function () {};
        var setCurrentState = options.setCurrentState || function () {};
        var classDefs = options.classDefs || function () { return []; };
        var findClassDef = options.findClassDef || function () { return null; };
        var beginCheckpointMutation = options.beginCheckpointMutation || function () {};
        var render = options.render || function () {};
        var markDirty = options.markDirty || function () {};
        var refreshInspector = options.refreshInspector || function () {};
        var sec = options.sec || function (title, body) { return "<div>" + title + body + "</div>"; };
        var escapeText = options.escapeText || function (s) {
            return String(s == null ? "" : s);
        };

        function newClassId() {
            var cls;
            do { cls = "c" + Math.random().toString(36).slice(2, 8); } while (findClassDef(cls));
            return cls;
        }

        function blockClassList(b) {
            var t = targetBlock(b);
            if (!t) return [];
            if (!t.classes) t.classes = [];
            return t.classes;
        }

        function toggleBlockClass(b, cls) {
            var list = blockClassList(b);
            var i = list.indexOf(cls);
            if (i === -1) list.push(cls); else list.splice(i, 1);
            var t = targetBlock(b);
            if (t && !list.length) delete t.classes;
        }

        function classesSection(b) {
            var t = targetBlock(b);
            var assigned = (t && t.classes) || [];
            var defs = classDefs();
            var chips = assigned.map(function (cls) {
                var def = findClassDef(cls);
                var nm = def ? (def.name || def.cls) : cls;
                return '<span class="lime-doc-class-chip">' +
                    '<button type="button" class="lime-doc-class-chip__edit" data-doc-class-edit="' + escapeText(cls) + '" title="Редактировать класс">' + escapeText(nm) + '</button>' +
                    '<button type="button" class="lime-doc-class-chip__x" data-doc-class-remove="' + escapeText(cls) + '" title="Снять с блока">✕</button>' +
                    '</span>';
            }).join("");
            var avail = defs.filter(function (d) { return assigned.indexOf(d.cls) === -1; });
            var sel = avail.length
                ? '<select class="lime-select" data-doc-class-add style="flex:1;">' +
                    '<option value="">+ применить класс…</option>' +
                    avail.map(function (d) { return '<option value="' + escapeText(d.cls) + '">' + escapeText(d.name || d.cls) + '</option>'; }).join("") +
                    '</select>'
                : '';
            var body =
                (chips
                    ? '<div class="lime-doc-class-chips">' + chips + '</div>'
                    : '<div class="lime-inspector__hint">Класс — набор стилей для многих блоков. Меняешь класс — меняются все блоки с ним.</div>') +
                '<div class="lime-flex lime-gap-2" style="margin-top:6px;align-items:center;">' + sel +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-class-new title="Создать класс из текущих стилей блока">＋ Из стилей</button>' +
                '</div>';
            return sec("Классы", body);
        }

        function classEditBanner() {
            var currentClass = getCurrentClass();
            var def = findClassDef(currentClass);
            var nm = def ? (def.name || def.cls) : currentClass;
            return sec("Класс «" + escapeText(nm) + "»",
                '<div class="lime-doc-comp-banner">✎ Правишь класс — изменения применяются ко всем блокам с ним.</div>' +
                '<div class="lime-flex lime-gap-2" style="margin-top:6px;align-items:center;">' +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-class-rename title="Переименовать">✎ Имя</button>' +
                    '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-class-delete title="Удалить класс">🗑</button>' +
                    '<button type="button" class="lime-btn lime-btn--sm" data-doc-class-done style="margin-left:auto;">Готово</button>' +
                '</div>');
        }

        function walkAllBlocks(fn) {
            function rec(arr) {
                for (var i = 0; i < arr.length; i++) {
                    fn(arr[i]);
                    var t = targetBlock(arr[i]);
                    if (t && t.children) rec(t.children);
                }
            }
            var doc = getDoc();
            (doc.pages || []).forEach(function (p) { rec(p.blocks || []); });
            Object.keys(doc.components || {}).forEach(function (k) {
                var cb = doc.components[k] && doc.components[k].block;
                if (cb) { fn(cb); if (cb.children) rec(cb.children); }
            });
        }

        function stripClassEverywhere(cls) {
            walkAllBlocks(function (b) {
                if (b.classes) {
                    var i = b.classes.indexOf(cls);
                    if (i !== -1) b.classes.splice(i, 1);
                    if (!b.classes.length) delete b.classes;
                }
            });
        }

        function applyClassToBlock(cls) {
            var b = byId(getSelectedId());
            if (!b || !cls) return;
            beginCheckpointMutation();
            if (blockClassList(b).indexOf(cls) === -1) toggleBlockClass(b, cls);
            render();
            markDirty();
        }

        function removeClassFromBlock(cls) {
            var b = byId(getSelectedId());
            if (!b) return;
            beginCheckpointMutation();
            var list = blockClassList(b);
            var i = list.indexOf(cls);
            if (i !== -1) list.splice(i, 1);
            var t = targetBlock(b);
            if (t && !list.length) delete t.classes;
            render();
            markDirty();
        }

        function createClassFromBlock() {
            var b = byId(getSelectedId());
            if (!b) return;
            var t = targetBlock(b);
            var name = (win.prompt("Название класса:", "Мой класс") || "").trim();
            if (!name) return;
            beginCheckpointMutation();
            var cls = newClassId();
            var styles = t.styles ? JSON.parse(JSON.stringify(t.styles)) : {};
            classDefs().push({ cls: cls, name: name, styles: styles });
            if (!t.classes) t.classes = [];
            t.classes.push(cls);
            delete t.styles;
            setCurrentClass(cls);
            setCurrentState("normal");
            render();
            markDirty();
        }

        function editClass(cls) {
            setCurrentClass(cls);
            setCurrentState("normal");
            render();
        }

        function exitClassEdit() {
            setCurrentClass(null);
            render();
        }

        function deleteClass(cls) {
            if (!win.confirm("Удалить класс? Он снимется со всех блоков.")) return;
            beginCheckpointMutation();
            var list = classDefs();
            for (var i = 0; i < list.length; i++) {
                if (list[i].cls === cls) {
                    list.splice(i, 1);
                    break;
                }
            }
            stripClassEverywhere(cls);
            setCurrentClass(null);
            render();
            markDirty();
        }

        function renameClass(cls) {
            var def = findClassDef(cls);
            if (!def) return;
            var name = (win.prompt("Новое имя класса:", def.name || "") || "").trim();
            if (name) {
                beginCheckpointMutation();
                def.name = name;
                refreshInspector();
                markDirty();
            }
        }

        return {
            applyClassToBlock: applyClassToBlock,
            classEditBanner: classEditBanner,
            classesSection: classesSection,
            createClassFromBlock: createClassFromBlock,
            deleteClass: deleteClass,
            editClass: editClass,
            exitClassEdit: exitClassEdit,
            removeClassFromBlock: removeClassFromBlock,
            renameClass: renameClass
        };
    }

    return { create: create };
});
