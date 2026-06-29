/* Lime editor inspector control rendering helpers. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorInspectorControls = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var CSS_UNITS = ["px", "rem", "%"];
    var CSS_UNITS_NO_PERCENT = ["px", "rem"];
    var WEIGHTS = [{ v: "400", l: "Об." }, { v: "600", l: "П/ж" }, { v: "700", l: "Ж" }, { v: "800", l: "Чёрн." }];
    var ALIGN = [{ v: "left", l: "◀" }, { v: "center", l: "≡" }, { v: "right", l: "▶" }];
    var TRANSFORM = [{ v: "none", l: "Aa" }, { v: "uppercase", l: "AA" }, { v: "lowercase", l: "aa" }, { v: "capitalize", l: "Abc" }];
    var BLEND = [{ v: "normal", l: "Норм." }, { v: "multiply", l: "Multiply" }, { v: "screen", l: "Screen" }, { v: "overlay", l: "Overlay" }, { v: "difference", l: "Diff" }];
    var BORDER_STYLE = [{ v: "none", l: "Нет" }, { v: "solid", l: "—" }, { v: "dashed", l: "- -" }];

    var STYLE_REGISTRY = [
        { title: "Шрифт", kind: "font", prop: "fontFamily" },
        { title: "Цвет текста", kind: "color", prop: "color", tokens: true },
        { title: "Размер текста", kind: "range", prop: "fontSize", min: 12, max: 80, step: 1, unit: "px", units: CSS_UNITS },
        { title: "Жирность", kind: "seg", prop: "fontWeight", options: WEIGHTS },
        { title: "Межстрочный", kind: "range", prop: "lineHeight", min: 1, max: 2.4, step: 0.05, unit: "" },
        { title: "Трекинг (межбуквенный)", kind: "range", prop: "letterSpacing", min: -2, max: 12, step: 0.5, unit: "px", units: CSS_UNITS_NO_PERCENT, adv: true },
        { title: "Регистр", kind: "seg", prop: "textTransform", options: TRANSFORM, adv: true },
        { title: "Выравнивание текста", kind: "seg", prop: "textAlign", options: ALIGN },
        { title: "Внутренние отступы", kind: "seg", prop: "padding", options: "PAD" },
        { title: "Внешние отступы (↑ / ↓)", kind: "ranges", items: [
            { prop: "marginTop", min: 0, max: 200, step: 2, unit: "px", units: CSS_UNITS },
            { prop: "marginBottom", min: 0, max: 200, step: 2, unit: "px", units: CSS_UNITS }
        ] },
        { title: "Граница", kind: "group", adv: true, parts: [
            { kind: "range", prop: "borderWidth", min: 0, max: 12, step: 1, unit: "px", units: CSS_UNITS_NO_PERCENT },
            { kind: "seg", prop: "borderStyle", options: BORDER_STYLE },
            { kind: "color", prop: "borderColor" }
        ] },
        { title: "Скругление", kind: "range", prop: "borderRadius", min: 0, max: 64, step: 1, unit: "px", units: CSS_UNITS },
        { title: "Тень", kind: "shadow", prop: "boxShadow", adv: true },
        { title: "Прозрачность", kind: "range", prop: "opacity", min: 0, max: 1, step: 0.05, unit: "", adv: true },
        { title: "Смешивание (blend)", kind: "seg", prop: "mixBlendMode", options: BLEND, adv: true },
        { title: "Мин. высота", kind: "range", prop: "minHeight", min: 0, max: 800, step: 10, unit: "px", units: CSS_UNITS, adv: true }
    ];

    function hasOwn(o, k) {
        return !!o && Object.prototype.hasOwnProperty.call(o, k);
    }

    function numText(n) {
        n = parseFloat(n);
        if (!isFinite(n)) return "0";
        return String(Math.round(n * 1000) / 1000);
    }

    function splitCssLength(value, fallbackUnit) {
        if (typeof value === "number" && isFinite(value)) return { num: value, unit: fallbackUnit || "px", empty: false };
        if (typeof value === "string") {
            var trimmed = value.trim();
            var m = trimmed.match(/^(-?(?:\d+|\d*\.\d+))(px|%|rem)$/);
            if (m) return { num: parseFloat(m[1]), unit: m[2], empty: false };
            var plain = parseFloat(trimmed);
            if (isFinite(plain)) return { num: plain, unit: fallbackUnit || "", empty: false };
        }
        return { num: 0, unit: fallbackUnit || "", empty: true };
    }

    function cssLengthValue(num, unit) {
        return unit === "px" ? parseFloat(numText(num)) : numText(num) + unit;
    }

    function create(options) {
        options = options || {};
        var escapeText = options.escapeText || function (s) { return String(s == null ? "" : s); };
        var toHex = options.toHex || function (s) { return s || "#000000"; };
        var themeTokens = options.themeTokens || [];
        var fontGroups = options.fontGroups || [];
        var shadowBuilder = options.shadowBuilder || function () { return ""; };
        var pads = options.pads || {};

        function unitSelectHtml(kind, prop, unit, units) {
            if (!units || !units.length) return "";
            if (units.indexOf(unit) === -1) unit = units[0];
            return '<select class="lime-unit-select" ' + kind + '="' + prop + '">' + units.map(function (u) {
                return '<option value="' + u + '"' + (u === unit ? " selected" : "") + '>' + u + '</option>';
            }).join("") + '</select>';
        }

        function rangeRow(prop, min, max, step, unit, cur, isMixed, units) {
            var parsed = splitCssLength(cur, unit);
            var n = parsed.empty ? min : parsed.num;
            var activeUnit = units && units.length ? (parsed.unit || units[0]) : unit;
            return '<div class="lime-range-row' + (isMixed ? ' is-mixed' : '') + '"' + (isMixed ? ' data-style-mixed="' + prop + '"' : '') + '><input type="range" class="lime-range" data-doc-style="' + prop + '" data-unit="' + activeUnit + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"' + (isMixed ? ' data-mixed="true" aria-label="Разные значения"' : '') + '><span class="lime-range__val">' + (isMixed ? "Разные" : (cur || "—")) + '</span>' + unitSelectHtml("data-doc-style-unit", prop, activeUnit, units) + '</div>';
        }

        function tokenSwatches(prop) {
            return '<div class="lime-color-row__swatches">' + themeTokens.map(function (t) {
                return '<button type="button" class="lime-color-swatch" data-doc-style="' + prop + '" data-val="var(' + t.var + ')" style="background:var(' + t.var + ')" title="' + t.label + '"></button>';
            }).join("") + '</div>';
        }

        function section(title, body) {
            return '<div class="lime-inspector__section"><div class="lime-inspector__section-title">' + title + '</div>' + body + '</div>';
        }

        function colorRow(prop, cur, isMixed) {
            return '<div class="lime-color-row' + (isMixed ? ' is-mixed' : '') + '"' + (isMixed ? ' data-style-mixed="' + prop + '"' : '') + '>' +
                '<input type="color" class="lime-color-input" data-doc-style="' + prop + '" value="' + toHex(cur) + '"' + (isMixed ? ' data-mixed="true" aria-label="Разные значения"' : '') + '>' +
                '<button type="button" class="lime-color-clear" data-doc-clear="' + prop + '" title="Убрать"></button>' +
                (isMixed ? '<span class="lime-mixed-label">Разные</span>' : '') +
                '</div>';
        }

        function selectRow(prop, options, cur, isMixed) {
            return '<select class="lime-select' + (isMixed ? ' is-mixed' : '') + '" data-doc-style="' + prop + '" style="width:100%;"' + (isMixed ? ' data-mixed="true" data-style-mixed="' + prop + '"' : '') + '>' +
                (isMixed ? '<option value="__lime_mixed__" disabled selected>— Разные —</option>' : '') + options.map(function (o) {
                return '<option value="' + escapeText(o.v) + '"' + (!isMixed && (cur || "") === o.v ? " selected" : "") + '>' + o.l + '</option>';
            }).join("") + '</select>';
        }

        function fontOptionsHtml(cur, withDefault, isMixed) {
            var opts = isMixed ? '<option value="__lime_mixed__" disabled selected>— Разные —</option>' : "";
            opts += withDefault ? '<option value=""' + (!isMixed && !cur ? " selected" : "") + ">По умолчанию (тема)</option>" : "";
            fontGroups.forEach(function (g) {
                opts += '<optgroup label="' + g.label + '">' + g.items.map(function (f) {
                    return '<option value="' + escapeText(f.s) + '"' + (!isMixed && cur === f.s ? " selected" : "") + ">" + escapeText(f.n) + "</option>";
                }).join("") + "</optgroup>";
            });
            return opts;
        }

        function fontSelect(prop, cur, withDefault, isMixed) {
            return '<select class="lime-select' + (isMixed ? ' is-mixed' : '') + '" data-doc-style="' + prop + '" style="width:100%;"' + (isMixed ? ' data-mixed="true" data-style-mixed="' + prop + '"' : '') + '>' + fontOptionsHtml(cur, withDefault, isMixed) + "</select>";
        }

        function segmented(prop, opts, cur, isMixed) {
            return '<div class="lime-segmented' + (isMixed ? ' is-mixed' : '') + '"' + (isMixed ? ' data-style-mixed="' + prop + '"' : '') + '>' + opts.map(function (o) {
                return '<button type="button" class="' + (!isMixed && cur === o.v ? "is-active" : "") + '" data-doc-style="' + prop + '" data-val="' + o.v + '">' + o.l + '</button>';
            }).join("") + (isMixed ? '<span class="lime-mixed-label">Разные</span>' : '') + '</div>';
        }

        function padSegOpts() {
            return Object.keys(pads).map(function (v) { return { v: v, l: pads[v] }; });
        }

        function renderControl(c, s, mixed) {
            mixed = mixed || {};
            var isMixed = !!(c.prop && mixed[c.prop]);
            switch (c.kind) {
                case "select": return selectRow(c.prop, c.options, s[c.prop], isMixed);
                case "font": return fontSelect(c.prop, s[c.prop], true, isMixed);
                case "range": return rangeRow(c.prop, c.min, c.max, c.step, c.unit, s[c.prop], isMixed, c.units);
                case "ranges": return c.items.map(function (it) { return rangeRow(it.prop, it.min, it.max, it.step, it.unit, s[it.prop], !!mixed[it.prop], it.units); }).join("");
                case "seg": return segmented(c.prop, c.options === "PAD" ? padSegOpts() : c.options, s[c.prop], isMixed);
                case "color": return colorRow(c.prop, s[c.prop], isMixed) + (c.tokens ? tokenSwatches(c.prop) : "");
                case "shadow": return (isMixed ? '<div class="lime-mixed-note" data-style-mixed="' + c.prop + '">Разные значения</div>' : '') + shadowBuilder(s[c.prop]);
                case "group": return c.parts.map(function (p) { return renderControl(p, s, mixed); }).join("");
                default: return "";
            }
        }

        function registryProps(item) {
            if (item.prop) return [item.prop];
            if (item.items) return item.items.map(function (i) { return i.prop; });
            if (item.parts) return item.parts.map(function (p) { return p.prop; }).filter(Boolean);
            return [];
        }

        return {
            CSS_UNITS: CSS_UNITS,
            CSS_UNITS_NO_PERCENT: CSS_UNITS_NO_PERCENT,
            STYLE_REGISTRY: STYLE_REGISTRY,
            colorRow: colorRow,
            cssLengthValue: cssLengthValue,
            fontOptionsHtml: fontOptionsHtml,
            hasOwn: hasOwn,
            registryProps: registryProps,
            renderControl: renderControl,
            section: section,
            segmented: segmented,
            splitCssLength: splitCssLength,
            tokenSwatches: tokenSwatches,
            unitSelectHtml: unitSelectHtml
        };
    }

    return {
        CSS_UNITS: CSS_UNITS,
        CSS_UNITS_NO_PERCENT: CSS_UNITS_NO_PERCENT,
        create: create,
        cssLengthValue: cssLengthValue,
        hasOwn: hasOwn,
        splitCssLength: splitCssLength
    };
});
