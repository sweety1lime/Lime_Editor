/* Lime editor layer tree rendering helpers. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorLayers = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var ROW_HEIGHT = 30;
    var OVERSCAN = 8;
    var TYPE_LABELS = {
        heading: "Заголовок", text: "Текст", cover: "Обложка", cta: "Призыв", buttonGroup: "Кнопки",
        stats: "Цифры", features: "Фичи", navbar: "Навбар", footer: "Подвал", accordion: "FAQ",
        pricing: "Тарифы", testimonials: "Отзывы", logos: "Логотипы", steps: "Шаги", imageText: "Картинка+текст",
        socials: "Соцсети", form: "Форма", image: "Картинка", gallery: "Галерея", video: "Видео", embed: "Embed",
        tabs: "Вкладки", carousel: "Слайдер", lightbox: "Лайтбокс", countdown: "Отсчёт", modal: "Окно",
        collectionList: "Список", container: "Контейнер", columns: "Колонки", group: "Group", divider: "Разделитель", spacer: "Отступ"
    };

    function create(options) {
        options = options || {};
        var escapeText = options.escapeText || function (s) { return String(s == null ? "" : s); };
        var getComponents = options.getComponents || function () { return {}; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var isCanvasOn = options.isCanvasOn || function () { return false; };
        var isContainer = options.isContainer || function () { return false; };
        var resolvedBlockDesign = options.resolvedBlockDesign || function () { return {}; };
        var targetBlock = options.targetBlock || function (b) { return b; };

        function blockLabel(b) {
            if (!b) return "";
            if (b.name) return b.name;
            if (b.type === "component") {
                var components = getComponents() || {};
                return "⊞ " + (components[b.ref] ? components[b.ref].name : "компонент");
            }
            return TYPE_LABELS[b.type] || b.type;
        }

        function flattenRows(arr, depth, out) {
            out = out || [];
            arr = arr || [];
            for (var i = 0; i < arr.length; i++) {
                var b = arr[i];
                out.push({ block: b, depth: depth || 0 });
                var t = targetBlock(b);
                if (t && t.children && t.children.length) flattenRows(t.children, (depth || 0) + 1, out);
            }
            return out;
        }

        function rowHtml(item) {
            var b = item.block;
            var t = targetBlock(b);
            var isCont = t && isContainer(t.type);
            var selectedId = getSelectedId();
            var stateCls = (b.hidden ? " is-node-hidden" : "") + (b.locked ? " is-node-locked" : "");
            var z = resolvedBlockDesign(b, getCurrentBp()).zIndex;
            z = typeof z === "number" && isFinite(z) ? Math.round(z) : 0;
            var hideLbl = b.hidden ? "Показать" : "Скрыть";
            var lockLbl = b.locked ? "Разблокировать" : "Заблокировать";
            var controls = isCanvasOn() ? '<span class="lime-doc-layer__controls">' +
                '<button type="button" data-node-toggle-hidden title="' + hideLbl + '" aria-label="' + hideLbl + '">' + (b.hidden ? "◌" : "●") + '</button>' +
                '<button type="button" data-node-toggle-locked title="' + lockLbl + '" aria-label="' + lockLbl + '">' + (b.locked ? "◆" : "◇") + '</button>' +
                '<button type="button" data-node-rename title="Переименовать" aria-label="Переименовать">✎</button>' +
                '<button type="button" data-node-z="-1" title="Опустить" aria-label="Опустить (z-index)">−</button>' +
                '<span class="lime-doc-layer__z" title="z-index">' + z + '</span>' +
                '<button type="button" data-node-z="1" title="Поднять" aria-label="Поднять (z-index)">+</button></span>' : "";
            var state = (b.hidden ? " (скрыт)" : "") + (b.locked ? " (заблокирован)" : "");
            return '<div class="lime-doc-layer' + stateCls + (b.id === selectedId ? " is-active" : "") + '" data-doc-layer="' + b.id + '"' +
                ' id="lime-layer-' + b.id + '" role="treeitem" aria-level="' + (item.depth + 1) + '" aria-selected="' + (b.id === selectedId ? "true" : "false") + '"' +
                ' aria-label="' + escapeText(blockLabel(b)) + state + '" style="padding-left:' + (8 + item.depth * 14) + 'px;">' +
                '<span class="lime-doc-layer__ico" aria-hidden="true">' + (isCont ? "▣" : "▪") + '</span>' +
                '<span class="lime-doc-layer__name">' + escapeText(blockLabel(b)) + '</span>' + controls + '</div>';
        }

        function renderViewport(box, rows, keepSelectionVisible) {
            if (!box) return;
            var selectedId = getSelectedId();
            box.setAttribute("role", "tree");
            box.setAttribute("aria-label", "Слои страницы");
            if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "0");
            if (selectedId && rows && rows.length) box.setAttribute("aria-activedescendant", "lime-layer-" + selectedId);
            else box.removeAttribute("aria-activedescendant");
            if (!rows || !rows.length) {
                box.innerHTML = '<p class="lime-text-muted" style="font-size:var(--text-xs);">Пока нет блоков — добавь первый из панели слева.</p>';
                box.removeAttribute("data-layer-total");
                box.removeAttribute("data-layer-rendered");
                return;
            }
            var viewportH = box.clientHeight || 240;
            var scrollTop = box.scrollTop || 0;
            if (keepSelectionVisible && selectedId) {
                var selectedIndex = -1;
                for (var i = 0; i < rows.length; i++) {
                    if (rows[i].block.id === selectedId) { selectedIndex = i; break; }
                }
                if (selectedIndex >= 0) {
                    var firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
                    var lastVisible = Math.floor((scrollTop + viewportH) / ROW_HEIGHT);
                    if (selectedIndex < firstVisible || selectedIndex > lastVisible) {
                        scrollTop = Math.max(0, (selectedIndex - 2) * ROW_HEIGHT);
                        box.scrollTop = scrollTop;
                    }
                }
            }
            var start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
            var visible = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2;
            var end = Math.min(rows.length, start + visible);
            var html = '<div class="lime-doc-layer-spacer" style="height:' + (start * ROW_HEIGHT) + 'px"></div>';
            for (var r = start; r < end; r++) html += rowHtml(rows[r]);
            html += '<div class="lime-doc-layer-spacer" style="height:' + ((rows.length - end) * ROW_HEIGHT) + 'px"></div>';
            box.dataset.layerTotal = String(rows.length);
            box.dataset.layerRendered = String(end - start);
            box.innerHTML = html;
        }

        return {
            blockLabel: blockLabel,
            flattenRows: flattenRows,
            renderViewport: renderViewport,
            rowHtml: rowHtml
        };
    }

    return {
        create: create,
        ROW_HEIGHT: ROW_HEIGHT,
        OVERSCAN: OVERSCAN,
        TYPE_LABELS: TYPE_LABELS
    };
});
