/* Lime editor component actions: make/insert/detach/variants and inspector snippets. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorComponentActions = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}
    function hasOwn(obj, key) {
        return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
    }

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var document = options.document || win.document || null;
        var L = options.L || {};
        var getDoc = options.getDoc || function () { return { components: {} }; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var setSelectedId = options.setSelectedId || noop;
        var pageBlocks = options.pageBlocks || function () { return []; };
        var findBlock = options.findBlock || function () { return null; };
        var componentRecord = options.componentRecord || function () { return null; };
        var componentVariantRecord = options.componentVariantRecord || function () { return null; };
        var componentSourceBlock = options.componentSourceBlock || function () { return null; };
        var rid = options.rid || function (prefix) { return (prefix || "id") + Math.random().toString(36).slice(2); };
        var reid = options.reid || function (block) { return block; };
        var clone = options.clone || function (value) { return value == null ? value : JSON.parse(JSON.stringify(value)); };
        var escapeText = options.escapeText || function (value) { return String(value == null ? "" : value); };
        var beginCheckpointMutation = options.beginCheckpointMutation || noop;
        var runCommand = options.runCommand || function () { return false; };
        var finishMutation = options.finishMutation || noop;
        var finishInsert = options.finishInsert || noop;
        var render = options.render || noop;
        var markDirty = options.markDirty || noop;
        var section = options.section || function (title, body) { return "<section><h3>" + title + "</h3>" + body + "</section>"; };

        var PROP_LABELS = {
            text: "Текст", title: "Заголовок", subtitle: "Подзаголовок", caption: "Подпись",
            alt: "Alt-текст", quote: "Цитата", author: "Автор", label: "Кнопка",
            heading: "Заголовок", body: "Текст", name: "Имя"
        };
        var NON_TEXT_CONTENT = {
            src: 1, url: 1, youtubeId: 1, embedUrl: 1, provider: 1, aspect: 1, bgMode: 1, mode: 1, width: 1,
            layout: 1, cols: 1, items: 1, collection: 1, href: 1, poster: 1, videoUrl: 1
        };

        function doc() {
            var current = getDoc();
            if (!current.components) current.components = {};
            return current;
        }

        function attrVal(value) {
            return escapeText(value).replace(/"/g, "&quot;");
        }

        function makeComponent() {
            var selectedId = getSelectedId();
            var found = findBlock(selectedId);
            if (!found) return;
            var src = found.block;
            if (src.type === "component") return;
            var name = win.prompt ? win.prompt("Название компонента (например, \"Хедер\"):", src.type) : src.type;
            if (name === null) return;
            beginCheckpointMutation();
            var cid = rid("c");
            var def = clone(src);
            delete def.id;
            doc().components[cid] = { name: name || src.type, block: def };
            found.parent[found.index] = { id: rid("b"), type: "component", ref: cid };
            setSelectedId(found.parent[found.index].id);
            refreshComponents();
            render();
            markDirty();
        }

        function componentVariantId(comp) {
            var id, variants = (comp && comp.variants) || [];
            do {
                id = rid("v");
                var exists = false;
                for (var i = 0; i < variants.length; i++) {
                    if (variants[i] && variants[i].id === id) { exists = true; break; }
                }
            } while (exists);
            return id;
        }

        function clearComponentContentOverride(inst) {
            if (!inst || !inst.overrides || !inst.overrides.content) return;
            delete inst.overrides.content;
            if (!Object.keys(inst.overrides).length) delete inst.overrides;
        }

        function componentVariantSnapshot(inst) {
            var copy = clone(componentSourceBlock(inst) || {});
            if (inst.overrides && inst.overrides.content && L.mergeDesign) {
                copy.content = L.mergeDesign(copy.content || {}, inst.overrides.content);
            }
            delete copy.id;
            return copy;
        }

        function addComponentVariantFromInstance() {
            beginCheckpointMutation();
            var found = findBlock(getSelectedId());
            if (!found || !found.block || found.block.type !== "component") return;
            var inst = found.block;
            var comp = componentRecord(inst.ref);
            if (!comp) return;
            var defaultName = "Variant " + (((comp.variants && comp.variants.length) || 0) + 1);
            var name = win.prompt ? win.prompt("Variant name:", defaultName) : defaultName;
            if (name === null) return;
            if (!comp.variants) comp.variants = [];
            var vid = componentVariantId(comp);
            comp.variants.push({ id: vid, name: (name.trim() || defaultName), block: componentVariantSnapshot(inst) });
            inst.variant = vid;
            clearComponentContentOverride(inst);
            finishMutation(false);
        }

        function setComponentVariant(value) {
            var found = findBlock(getSelectedId());
            if (!found || !found.block || found.block.type !== "component") return;
            var inst = found.block;
            var comp = componentRecord(inst.ref);
            if (!comp) return;
            var variant = value || "";
            if (variant && !componentVariantRecord(comp, variant)) return;
            if ((inst.variant || "") === variant) return;
            var commandApplied = runCommand("setComponentVariant", { id: inst.id, variant: variant || null });
            if (!commandApplied) {
                beginCheckpointMutation();
                if (variant) inst.variant = variant; else delete inst.variant;
            }
            finishMutation(commandApplied);
        }

        function detachedComponentBlock(inst) {
            var def = componentSourceBlock(inst);
            var copy = reid(clone(def || {}));
            copy.id = inst.id;
            if (inst.name) copy.name = inst.name;
            if (inst.hidden) copy.hidden = true;
            if (inst.locked) copy.locked = true;
            if (inst.overrides && inst.overrides.content && L.mergeDesign) {
                copy.content = L.mergeDesign(copy.content || {}, inst.overrides.content);
            }
            if (inst.design && L.mergeInstanceDesign) copy.design = L.mergeInstanceDesign(copy.design, inst.design);
            return copy;
        }

        function detachComponent() {
            var found = findBlock(getSelectedId());
            if (!found) return;
            var inst = found.block;
            if (inst.type !== "component" || !doc().components[inst.ref]) return;
            var copy = detachedComponentBlock(inst);
            var commandApplied = runCommand("detachComponent", { id: inst.id, block: copy });
            if (!commandApplied) {
                beginCheckpointMutation();
                found.parent[found.index] = copy;
            }
            finishMutation(commandApplied);
        }

        function resetComponentOverrides() {
            var found = findBlock(getSelectedId());
            if (!found || !found.block || found.block.type !== "component" || !found.block.overrides) return;
            var commandApplied = runCommand("clearComponentOverrides", { id: found.block.id });
            if (!commandApplied) {
                beginCheckpointMutation();
                delete found.block.overrides;
            }
            finishMutation(commandApplied);
        }

        function insertComponent(cid) {
            if (!doc().components[cid]) return;
            beginCheckpointMutation();
            var inst = { id: rid("b"), type: "component", ref: cid };
            pageBlocks().push(inst);
            setSelectedId(inst.id);
            finishInsert(inst, null, null, false);
        }

        function refreshComponents() {
            if (!document) return;
            var box = document.getElementById("lime-doc-components");
            if (!box) return;
            var components = doc().components;
            var keys = Object.keys(components);
            if (!keys.length) {
                box.innerHTML = '<p class="lime-text-muted" style="font-size: var(--text-xs); line-height:1.5;">Пока нет. Выбери блок → в инспекторе \"⊞ В компонент\" - и он появится здесь для переиспользования.</p>';
                return;
            }
            box.innerHTML = keys.map(function (cid) {
                return '<button type="button" class="lime-block-tile" data-doc-insert-comp="' + cid + '"><span class="lime-block-tile__icon">⊞</span><span>' + escapeText(components[cid].name) + '</span></button>';
            }).join("");
        }

        function componentVariantControls(inst) {
            var comp = inst && inst.type === "component" ? componentRecord(inst.ref) : null;
            if (!comp) return "";
            var selected = inst.variant || "";
            var options = '<option value=""' + (!selected ? " selected" : "") + '>Default</option>';
            var variants = comp.variants || [];
            for (var i = 0; i < variants.length; i++) {
                if (!variants[i] || !variants[i].id) continue;
                options += '<option value="' + escapeText(variants[i].id) + '"' + (selected === variants[i].id ? " selected" : "") + ">" +
                    escapeText(variants[i].name || variants[i].id) + "</option>";
            }
            return '<div style="display:flex;gap:6px;width:100%;">' +
                '<select class="lime-select" data-doc-component-variant style="flex:1;">' + options + '</select>' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-component-variant-add>+ Variant</button>' +
                '</div>';
        }

        function componentTextProps(inst) {
            if (!inst || inst.type !== "component" || !componentRecord(inst.ref)) return [];
            var def = componentSourceBlock(inst) || {};
            var defContent = def.content || {};
            var ovr = (inst.overrides && inst.overrides.content) || {};
            var out = [];
            Object.keys(defContent).forEach(function (key) {
                if (NON_TEXT_CONTENT[key] || typeof defContent[key] !== "string") return;
                var overridden = hasOwn(ovr, key) && typeof ovr[key] === "string";
                out.push({ key: key, label: PROP_LABELS[key] || key, value: overridden ? ovr[key] : defContent[key], overridden: overridden });
            });
            return out;
        }

        function componentPropsSection(block) {
            var props = componentTextProps(block);
            if (!props.length) return "";
            var rows = props.map(function (prop) {
                var badge = prop.overridden ? ' <span class="lime-style-override__badge" title="Локально переопределено">●</span>' : "";
                var reset = prop.overridden
                    ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-prop-reset="' + attrVal(prop.key) + '" title="К значению компонента">↺</button>'
                    : "";
                return '<label class="lime-v2-field"><span>' + escapeText(prop.label) + badge + "</span>" +
                    '<input type="text" class="lime-input lime-input--sm" data-doc-prop="' + attrVal(prop.key) + '" value="' + attrVal(prop.value) + '">' + reset + "</label>";
            }).join("");
            return section("Свойства компонента", rows);
        }

        return {
            makeComponent: makeComponent,
            addComponentVariantFromInstance: addComponentVariantFromInstance,
            setComponentVariant: setComponentVariant,
            detachComponent: detachComponent,
            resetComponentOverrides: resetComponentOverrides,
            insertComponent: insertComponent,
            refreshComponents: refreshComponents,
            componentVariantControls: componentVariantControls,
            componentPropsSection: componentPropsSection
        };
    }

    return { create: create };
});
