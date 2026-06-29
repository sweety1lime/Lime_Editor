/* Lime editor shadow builder (1.2: многослойные box-shadow — парсинг, UI-билдер, сборка CSS). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorShadow = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // box-shadow — список слоёв через запятую; пишем готовую CSS-строку в styles[bucket].boxShadow
    // (движок не трогаем). Цвет храним как hex + альфа → собираем в rgba(), чтобы тени были мягкими.
    // shadowBuilder отдаётся в inspector-controls (kind "shadow"); composeShadow/addShadow/delShadow
    // дёргает обработчик инспектора. Изменяемое состояние (selectedId) — геттером.
    function create(options) {
        options = options || {};
        var inspectorEl = options.inspectorEl;
        var toHex = options.toHex || function (c) { return c; };
        var setStyle = options.setStyle || function () {};
        var curStyle = options.curStyle || function () { return {}; };
        var byId = options.byId || function () { return null; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var refreshInspector = options.refreshInspector || function () {};

        function hexToRgba(hex, a) {
            var h = (hex || "#000000").replace("#", "");
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), bl = parseInt(h.slice(4, 6), 16);
            return "rgba(" + r + "," + g + "," + bl + "," + (a == null ? 1 : a) + ")";
        }
        function splitTopShadows(s) { // делит по запятым верхнего уровня (вне скобок rgba())
            var out = [], depth = 0, cur = "";
            for (var i = 0; i < s.length; i++) {
                var ch = s[i];
                if (ch === "(") depth++; else if (ch === ")") depth--;
                if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
            }
            if (cur.trim()) out.push(cur);
            return out;
        }
        function parseOneShadow(str) {
            str = (" " + str + " ").replace(/\s+inset\s+/i, " "); // вырезаем inset, запоминаем
            var inset = /\binset\b/i.test(arguments[0]);
            var color = "#000000", alpha = 0.25;
            var m = str.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/i);
            if (m) {
                var c = m[0]; str = str.replace(c, " ");
                var am = c.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i);
                alpha = am ? parseFloat(am[1]) : 1;
                color = toHex(c);
            }
            var nums = str.trim().split(/\s+/).filter(Boolean).map(function (n) { return parseInt(n, 10) || 0; });
            return { x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, color: color, alpha: alpha, inset: inset };
        }
        function parseShadows(v) {
            if (!v || v === "none") return [];
            return splitTopShadows(v).map(parseOneShadow);
        }
        function shadowCss(sh) {
            return (sh.inset ? "inset " : "") + sh.x + "px " + sh.y + "px " + sh.blur + "px " + sh.spread + "px " + hexToRgba(sh.color, sh.alpha);
        }
        function shRng(i, k, label, min, max, step, val, unit) {
            return '<div class="lime-inspector__hint" style="margin:4px 0 0;">' + label + '</div>' +
                '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-shadow="' + i + '" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="lime-range__val">' + val + unit + '</span></div>';
        }
        function shadowBuilder(cur) {
            var list = parseShadows(cur);
            var cards = list.map(function (sh, i) {
                var head = '<div class="lime-flex" style="justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                    '<b style="font-size:var(--text-xs);">Тень ' + (i + 1) + (sh.inset ? " · внутр." : "") + '</b>' +
                    '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-shadow-del="' + i + '" title="Убрать">✕</button></div>';
                var body = shRng(i, "x", "Сдвиг X", -50, 50, 1, sh.x, "px") +
                    shRng(i, "y", "Сдвиг Y", -50, 50, 1, sh.y, "px") +
                    shRng(i, "blur", "Размытие", 0, 100, 1, sh.blur, "px") +
                    shRng(i, "spread", "Растяжение", -50, 50, 1, sh.spread, "px") +
                    shRng(i, "alpha", "Прозрачность", 0, 1, 0.05, sh.alpha, "") +
                    '<div class="lime-color-row" style="margin-top:4px;">' +
                        '<input type="color" class="lime-color-input" data-doc-shadow="' + i + '" data-k="color" value="' + toHex(sh.color) + '">' +
                        '<label style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:var(--text-xs);"><input type="checkbox" data-doc-shadow="' + i + '" data-k="inset"' + (sh.inset ? " checked" : "") + '>внутренняя</label>' +
                    '</div>';
                return '<div class="lime-layer-card">' + head + body + '</div>';
            }).join("");
            return cards + '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-shadow-add style="width:100%;margin-top:6px;">＋ слой тени</button>';
        }
        // Сборка строки box-shadow из всех контролов билдера (паттерн composeGradient: без ре-рендера).
        function composeShadow() {
            var inputs = inspectorEl.querySelectorAll("[data-doc-shadow]");
            var byLayer = {};
            for (var i = 0; i < inputs.length; i++) {
                var el = inputs[i];
                var idx = el.getAttribute("data-doc-shadow");
                var k = el.getAttribute("data-k");
                if (!byLayer[idx]) byLayer[idx] = { x: 0, y: 0, blur: 0, spread: 0, color: "#000000", alpha: 0.25, inset: false };
                if (k === "inset") byLayer[idx].inset = el.checked;
                else if (k === "color") byLayer[idx].color = el.value;
                else if (k === "alpha") byLayer[idx].alpha = parseFloat(el.value);
                else byLayer[idx][k] = parseInt(el.value, 10) || 0;
            }
            var list = Object.keys(byLayer).sort(function (a, b) { return a - b; }).map(function (k) { return byLayer[k]; });
            setStyle("boxShadow", list.length ? list.map(shadowCss).join(", ") : "");
        }
        function addShadow() {
            var list = parseShadows(curStyle(byId(getSelectedId())).boxShadow);
            list.push({ x: 0, y: 8, blur: 24, spread: 0, color: "#000000", alpha: 0.25, inset: false });
            setStyle("boxShadow", list.map(shadowCss).join(", "));
            refreshInspector();
        }
        function delShadow(i) {
            var list = parseShadows(curStyle(byId(getSelectedId())).boxShadow);
            list.splice(i, 1);
            setStyle("boxShadow", list.length ? list.map(shadowCss).join(", ") : "");
            refreshInspector();
        }

        return {
            shadowBuilder: shadowBuilder,
            composeShadow: composeShadow,
            addShadow: addShadow,
            delShadow: delShadow
        };
    }

    return { create: create };
});
