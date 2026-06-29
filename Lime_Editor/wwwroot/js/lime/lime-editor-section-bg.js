/* Lime editor section background (фон секции: цвет/градиент/картинка + затемнение + видео-фон). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorSectionBg = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Панель «Фон» в инспекторе секции: сегменты режима (цвет/градиент/картинка), контролы
    // градиента и затемнения с живым превью (без полного ре-рендера, чтобы не сбрасывать фокус
    // ползунка), видео-фон, сетка готовых фон-пресетов. Изменяемое состояние редактора
    // (selectedId/currentBp/cmdStore) инжектится ГЕТТЕРАМИ — на момент вызова нужно актуальное
    // значение, а не снимок. Остальное (DOM-узлы, doc-операции, билдеры контролов) — функциями.
    function create(options) {
        options = options || {};
        var document = options.document || (typeof window !== "undefined" ? window.document : null);
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var inspectorEl = options.inspectorEl;
        var ws = options.ws;

        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getCmdStore = options.getCmdStore || function () { return null; };

        var byId = options.byId;
        var setContentValue = options.setContentValue;
        var setStyle = options.setStyle;
        var targetBlock = options.targetBlock;
        var commandContentGesture = options.commandContentGesture;
        var runCommands = options.runCommands;
        var markDirty = options.markDirty || function () {};
        var applyPreviewStyles = options.applyPreviewStyles || function () {};
        var refreshInspector = options.refreshInspector || function () {};
        var scheduleAutosave = options.scheduleAutosave || function () {};
        var toHex = options.toHex || function (c) { return c; };
        var seg = options.seg;
        var colorRow = options.colorRow;
        var tokenSwatches = options.tokenSwatches;
        var sec = options.sec;

        // Разбор сохранённого linear-gradient(...) обратно на угол + 2 цвета (порт из Движка A).
        function parseGradient(v) {
            var def = { angle: 135, c1: "#a78bfa", c2: "#38bdf8" };
            if (!v || v.indexOf("linear-gradient") < 0) return def;
            var m = v.match(/linear-gradient\(\s*([\d.]+)deg\s*,\s*([^,]+),\s*([^)]+)\)/i);
            if (!m) return def;
            return { angle: parseFloat(m[1]) || 135, c1: toHex(m[2].trim()), c2: toHex(m[3].trim()) };
        }
        function hexToRgba(hex, alpha) {
            var h = String(hex || "#000000").replace("#", "");
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
            return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
        }
        // rgba/#hex → { hex, a } для переоткрытия контролов затемнения.
        function rgbaParts(v) {
            var m = String(v || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
            if (!m) return { hex: toHex(v || "#000000"), a: v ? 1 : 0.5 };
            var toH = function (n) { var x = parseInt(n, 10).toString(16); return x.length < 2 ? "0" + x : x; };
            return { hex: "#" + toH(m[1]) + toH(m[2]) + toH(m[3]), a: m[4] != null ? parseFloat(m[4]) : 1 };
        }
        function setBg(key, val) {
            var b = byId(getSelectedId());
            if (!b) return;
            setContentValue(b, "bg." + key, val, val === "" || val == null);
        }
        // Собирает linear-gradient из контролов инспектора и пишет в backgroundImage (живое превью).
        function composeGradient() {
            var a = inspectorEl.querySelector('[data-doc-grad="angle"]');
            var c1 = inspectorEl.querySelector('[data-doc-grad="c1"]');
            var c2 = inspectorEl.querySelector('[data-doc-grad="c2"]');
            if (!c1 || !c2) return;
            setStyle("backgroundImage", "linear-gradient(" + (a ? a.value : 135) + "deg, " + c1.value + ", " + c2.value + ")");
        }
        // Живое превью затемнения без полного ре-рендера: пишем в модель и правим/создаём
        // оверлей-элемент прямо в выбранной секции (full render сбрасывал бы фокус ползунка).
        function liveOverlay() {
            var col = inspectorEl.querySelector('[data-doc-overlay="color"]');
            var alEl = inspectorEl.querySelector('[data-doc-overlay="alpha"]');
            if (!col) return;
            var val = hexToRgba(col.value, alEl ? alEl.value : 0.5);
            var selectedId = getSelectedId();
            var source = byId(selectedId);
            var b = targetBlock(source);
            if (!b) return;
            var commanded = commandContentGesture(source, "bg.overlay", val, false, "overlay");
            if (!commanded) {
                if (!b.content) b.content = {};
                if (!b.content.bg) b.content.bg = {};
                b.content.bg.overlay = val;
            }
            var secEl = ws.querySelector('[data-block-id="' + selectedId + '"]');
            if (secEl) {
                var ov = secEl.querySelector(".lime-block__overlay");
                if (!ov || ov.closest(".lime-block") !== secEl) {
                    ov = document.createElement("div");
                    ov.className = "lime-block__overlay";
                    secEl.insertBefore(ov, secEl.firstChild);
                }
                ov.style.background = val;
                if (b.content.bg.blur) ov.style.backdropFilter = "blur(" + b.content.bg.blur + ")";
            }
            if (!commanded) markDirty();
        }
        function switchBgMode(mode) {
            var source = byId(getSelectedId());
            var b = targetBlock(source);
            if (!b) return;
            var cmdStore = getCmdStore();
            var currentBp = getCurrentBp();
            if (cmdStore && b === source) {
                var commands = [{ type: "setContent", payload: { id: source.id, field: "bgMode", value: mode } }];
                if (mode === "solid") commands.push({ type: "setStyle", payload: { id: source.id, breakpoint: currentBp, prop: "backgroundImage", remove: true } });
                var changed = runCommands(commands, "background-mode");
                applyPreviewStyles(); refreshInspector();
                if (changed) scheduleAutosave();
                return;
            }
            if (!b.content) b.content = {};
            b.content.bgMode = mode;
            // На сплошном фоне убираем картинку/градиент, чтобы они не перекрывали цвет.
            if (mode === "solid" && b.styles && b.styles[currentBp]) delete b.styles[currentBp].backgroundImage;
            applyPreviewStyles(); refreshInspector(); markDirty();
        }
        function promptBgVideo() {
            var url = win.prompt("Прямая ссылка на видео (.mp4 или .webm):", "");
            if (url == null) return;
            setBg("videoSrc", url.trim());
        }
        // Сетка готовых фон-пресетов (из lime-assets.js). Превью фона навешиваем
        // через style-свойство уже после вставки HTML (в css-значениях есть кавычки/запятые).
        function bgPresetGrid() {
            if (!win.LimeAssets || !win.LimeAssets.BG_PRESETS) return "";
            return '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Готовые фоны</div>' +
                '<div class="lime-bg-presets">' + win.LimeAssets.BG_PRESETS.map(function (p, i) {
                    return '<button type="button" class="lime-bg-preset" data-doc-bg-preset="' + i + '" title="' + p.name + '"></button>';
                }).join("") + '</div>';
        }
        function bgInspector(b, s) {
            var t = targetBlock(b);
            var bg = (t.content && t.content.bg) || {};
            var bgImg = s.backgroundImage || "";
            var mode = (t.content && t.content.bgMode) ||
                (bgImg.indexOf("gradient") >= 0 ? "gradient" : (bgImg.indexOf("url(") >= 0 ? "image" : "solid"));
            var tabs = '<div class="lime-segmented" style="margin-bottom:8px;">' +
                [["solid", "Цвет"], ["gradient", "Градиент"], ["image", "Картинка"]].map(function (o) {
                    return '<button type="button" class="' + (mode === o[0] ? "is-active" : "") + '" data-doc-bgmode="' + o[0] + '">' + o[1] + '</button>';
                }).join("") + '</div>';
            var body;
            if (mode === "gradient") {
                var g = parseGradient(bgImg);
                body = '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-grad="angle" min="0" max="360" step="5" value="' + g.angle + '"><span class="lime-range__val">' + g.angle + '°</span></div>' +
                    '<div class="lime-color-row" style="margin-top:6px;">' +
                    '<input type="color" class="lime-color-input" data-doc-grad="c1" value="' + g.c1 + '">' +
                    '<input type="color" class="lime-color-input" data-doc-grad="c2" value="' + g.c2 + '"></div>' +
                    bgPresetGrid();
            } else if (mode === "image") {
                var hasImg = bgImg.indexOf("url(") >= 0;
                body = '<button type="button" class="lime-btn lime-btn--soft lime-btn--sm" data-doc-bg-pick="image" style="width:100%;">' + (hasImg ? "Заменить изображение" : "Выбрать изображение") + '</button>' +
                    (hasImg ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-clear-img style="width:100%;margin-top:4px;">Убрать картинку</button>' +
                        seg("backgroundSize", [{ v: "cover", l: "Cover" }, { v: "contain", l: "Contain" }, { v: "auto", l: "Auto" }], s.backgroundSize) +
                        seg("backgroundPosition", [{ v: "center", l: "Центр" }, { v: "top", l: "Верх" }, { v: "bottom", l: "Низ" }], s.backgroundPosition) : "");
            } else {
                body = colorRow("backgroundColor", s.backgroundColor) + tokenSwatches("backgroundColor");
            }
            // Затемнение + видео-фон — доступны при любом режиме (поверх базового фона).
            var op = rgbaParts(bg.overlay);
            var overlayRow = '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Затемнение поверх</div>' +
                '<div class="lime-color-row"><input type="color" class="lime-color-input" data-doc-overlay="color" value="' + op.hex + '">' +
                '<div class="lime-range-row" style="flex:1;margin-left:8px;"><input type="range" class="lime-range" data-doc-overlay="alpha" min="0" max="1" step="0.05" value="' + op.a + '"><span class="lime-range__val">' + Math.round(op.a * 100) + '%</span></div></div>' +
                (bg.overlay ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-clear-key="overlay" style="width:100%;margin-top:4px;">Убрать затемнение</button>' : "");
            var videoRow = '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-video style="width:100%;margin-top:8px;">' + (bg.videoSrc ? "Заменить видео-фон" : "＋ Видео-фон") + '</button>' +
                (bg.videoSrc ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-bg-clear-key="videoSrc" style="width:100%;margin-top:4px;">Убрать видео</button>' : "");
            return sec("Фон", tabs + body + overlayRow + videoRow);
        }

        return {
            bgInspector: bgInspector,
            composeGradient: composeGradient,
            liveOverlay: liveOverlay,
            switchBgMode: switchBgMode,
            promptBgVideo: promptBgVideo,
            setBg: setBg
        };
    }

    return { create: create };
});
