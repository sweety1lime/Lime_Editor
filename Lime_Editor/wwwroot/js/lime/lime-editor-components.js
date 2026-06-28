/* Lime editor component access helpers. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorComponents = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var INSTANCE_DESIGN_FIELDS = { frame: 1, size: 1, constraints: 1, zIndex: 1 };

    function create(options) {
        options = options || {};
        var getDoc = options.getDoc || function () { return {}; };
        var L = options.L || {};

        function componentRecord(ref) {
            var doc = getDoc() || {};
            return doc.components && ref ? doc.components[ref] : null;
        }

        function componentVariantRecord(comp, variantId) {
            var variants = (comp && comp.variants) || [];
            if (!variantId) return null;
            for (var i = 0; i < variants.length; i++) {
                if (variants[i] && variants[i].id === variantId && variants[i].block) return variants[i];
            }
            return null;
        }

        function componentSourceBlock(inst) {
            var comp = inst && inst.type === "component" ? componentRecord(inst.ref) : null;
            if (!comp) return null;
            var variant = componentVariantRecord(comp, inst.variant);
            return (variant && variant.block) || comp.block || null;
        }

        function targetBlock(block) {
            if (block && block.type === "component" && componentRecord(block.ref)) return componentSourceBlock(block) || block;
            return block;
        }

        function designTarget(block, field) {
            if (block && block.type === "component" && INSTANCE_DESIGN_FIELDS[field]) return block;
            return targetBlock(block);
        }

        function rawBlockDesign(block) {
            if (block && block.type === "component" && componentRecord(block.ref)) {
                var definition = componentSourceBlock(block) || {};
                return L.mergeInstanceDesign
                    ? L.mergeInstanceDesign(definition.design, block.design)
                    : (block.design || definition.design || {});
            }
            return block && block.design || {};
        }

        function resolvedBlockDesign(block, breakpoint) {
            return L.resolvedDesign(rawBlockDesign(block), breakpoint);
        }

        function readStyles(block) {
            if (block && block.type === "component" && componentRecord(block.ref)) {
                var def = componentSourceBlock(block) || {};
                var ovr = block.overrides && block.overrides.styles;
                return ovr ? L.mergeDesign(def.styles || {}, ovr) : (def.styles || {});
            }
            return (block && block.styles) || {};
        }

        function setComponentStyleOverrideLocal(inst, bucket, prop, val, remove) {
            if (!inst || inst.type !== "component") return false;
            if (!inst.overrides) inst.overrides = {};
            if (!inst.overrides.styles) inst.overrides.styles = {};
            var styles = inst.overrides.styles;
            if (remove || val === "" || val == null) {
                if (styles[bucket]) {
                    delete styles[bucket][prop];
                    if (!Object.keys(styles[bucket]).length) delete styles[bucket];
                }
            } else {
                if (!styles[bucket]) styles[bucket] = {};
                styles[bucket][prop] = val;
            }
            if (!Object.keys(styles).length) delete inst.overrides.styles;
            if (inst.overrides && !Object.keys(inst.overrides).length) delete inst.overrides;
            return true;
        }

        return {
            componentRecord: componentRecord,
            componentVariantRecord: componentVariantRecord,
            componentSourceBlock: componentSourceBlock,
            targetBlock: targetBlock,
            designTarget: designTarget,
            rawBlockDesign: rawBlockDesign,
            resolvedBlockDesign: resolvedBlockDesign,
            readStyles: readStyles,
            setComponentStyleOverrideLocal: setComponentStyleOverrideLocal
        };
    }

    return {
        create: create
    };
});
