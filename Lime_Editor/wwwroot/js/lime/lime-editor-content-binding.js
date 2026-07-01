/*
 * Lime editor content/data-binding (вынос из lime-doc-editor.js).
 *
 * Инспектор-секции, связанные с данными: наполнение select'а коллекций CMS, превью-данные
 * для collectionList, привязка text/heading/image к полю записи на странице-шаблоне,
 * настройка источника collectionList (раскладка/лимит/сортировка/фильтр/поля карточки),
 * дата countdown и запись content-флагов. Общий кэш `collectionsCache` остаётся в main —
 * сюда проброшен get/set-инъекцией, т.к. его же читают render() и INIT. Изменяемое состояние
 * (doc/active/selectedId) — через геттеры (актуально на момент async-вызова). Браузер-онли.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorContentBinding = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var document = options.document || (typeof window !== "undefined" ? window.document : null);
        var inspectorEl = options.inspectorEl;
        var siteId = options.siteId || "";
        var getDoc = options.getDoc || function () { return null; };
        var getActive = options.getActive || function () { return 0; };
        var getCollections = options.getCollections || function () { return null; };
        var setCollections = options.setCollections || function () {};
        var escapeText = options.escapeText || function (s) { return s; };
        var sec = options.section || function (t, b) { return b; };
        var byId = options.byId || function () { return null; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var setContentValue = options.setContentValue || function () {};

        function populateCollectionPickers(t) {
            var selEl = inspectorEl.querySelector("[data-doc-collection]");
            if (!selEl || !siteId) return;
            var cur = (t && t.content && t.content.collection) || "";
            var fill = function (list) {
                list.forEach(function (c) {
                    var opt = document.createElement("option");
                    opt.value = c.slug;
                    opt.textContent = c.name + " (" + c.slug + ")";
                    if (c.slug === cur) opt.selected = true;
                    selEl.appendChild(opt);
                });
            };
            var cache = getCollections();
            if (cache) { fill(cache); return; }
            fetch("/Data/ApiList?siteId=" + siteId, { credentials: "same-origin" })
                .then(function (r) { return r.json(); })
                .then(function (list) { setCollections(list || []); fill(getCollections()); })
                .catch(function () { /* нет коллекций / не сохранён — тихо */ });
        }
        // Превью-данные для блока collectionList в редакторе: схема из кэша + 2 пустые записи.
        function editorCollectionData() {
            var cache = getCollections();
            if (!cache) return null;
            var map = {};
            cache.forEach(function (c) {
                var fields = [];
                try { fields = JSON.parse(c.schemaJson || "[]"); } catch (e) { fields = []; }
                map[c.slug] = { fields: fields, records: [{}, {}] };
            });
            return map;
        }
        // Схема полей коллекции из кэша (для биндинг-селектов и sample-записи).
        function collectionFields(slug) {
            var cache = getCollections();
            if (!slug || !cache) return [];
            for (var i = 0; i < cache.length; i++) {
                if (cache[i].slug === slug) {
                    try { return JSON.parse(cache[i].schemaJson || "[]") || []; } catch (e) { return []; }
                }
            }
            return [];
        }
        // Привязка коллекции к активной странице (CMS 2.0): slug или "" (обычная страница).
        function activePageCollection() {
            var doc = getDoc(), active = getActive();
            return (doc.pages[active] && doc.pages[active].collection) || "";
        }
        // Образец записи для превью страницы-шаблона: значения-плейсхолдеры по схеме.
        function templateSampleRecord() {
            var slug = activePageCollection();
            if (!slug) return null;
            var fields = collectionFields(slug);
            if (!fields.length) return null;
            var rec = {};
            fields.forEach(function (f) {
                rec[f.name] = f.type === "image" ? "" : ("Пример: " + (f.label || f.name));
            });
            return rec;
        }

        // CMS 2.0: на странице-шаблоне записи text/heading/image можно привязать к полю записи.
        // text/heading → content.bind (текстовые поля), image → content.bindSrc (image-поля).
        function bindingSection(t) {
            var slug = activePageCollection();
            if (!slug) return "";
            var isText = t.type === "text" || t.type === "heading";
            var isImg = t.type === "image";
            if (!isText && !isImg) return "";
            var key = isImg ? "bindSrc" : "bind";
            var cur = (t.content && t.content[key]) || "";
            var opts = isImg ? '<option value="">— своё изображение —</option>' : '<option value="">— статичный текст —</option>';
            collectionFields(slug).forEach(function (f) {
                var ok = isImg ? f.type === "image" : f.type !== "image";
                if (!ok) return;
                opts += '<option value="' + escapeText(f.name) + '"' + (f.name === cur ? " selected" : "") + ">" + escapeText(f.label || f.name) + "</option>";
            });
            return sec("Привязка к записи",
                '<select class="lime-select" data-doc-bind="' + key + '" style="width:100%;">' + opts + "</select>" +
                '<div class="lime-inspector__hint" style="margin-top:6px;">Страница-шаблон: блок берёт значение из поля текущей записи. Превью — на образце.</div>');
        }

        // Привязка к данным (фуллстак): форма пишет в коллекцию, collectionList читает из неё.
        // Select наполняется асинхронно после рендера (см. populateCollectionPickers).
        function contentExtras(t) {
            // Обратный отсчёт (этап 1.2): дата окончания. Заголовок правится прямо в блоке.
            if (t.type === "countdown") {
                var cdTarget = (t.content && t.content.target) || "";
                return sec("Обратный отсчёт",
                    '<label class="lime-v2-field"><span>Дата окончания</span><input type="datetime-local" class="lime-input" data-doc-cd-target value="' + escapeText(cdTarget) + '"></label>' +
                    '<div class="lime-inspector__hint" style="margin-top:6px;">Таймер обнулится в эту дату. Подпись правится прямо в блоке.</div>');
            }
            if (t.type !== "form" && t.type !== "collectionList") return "";
            var colSelect = '<select class="lime-select" data-doc-collection style="width:100%;"><option value="">— нет —</option></select>';
            if (t.type === "form") {
                return sec("Записывать в коллекцию",
                    colSelect +
                    '<div class="lime-inspector__hint" style="margin-top:6px;">Коллекции создаются в разделе «Данные» (кабинет → твой сайт).</div>');
            }
            // collectionList 2.0: раскладка, лимит, сортировка, фильтр и роли полей карточки.
            var c = t.content || {};
            var curSlug = c.collection || "";
            var fields = [];
            var cache = getCollections();
            if (cache) {
                for (var i = 0; i < cache.length; i++) {
                    if (cache[i].slug === curSlug) {
                        try { fields = JSON.parse(cache[i].schemaJson || "[]") || []; } catch (e) { fields = []; }
                        break;
                    }
                }
            }
            var escA = function (s) { return escapeText(s).replace(/"/g, "&quot;"); };
            var fieldOpts = function (selected, blankLabel) {
                var out = '<option value="">' + escapeText(blankLabel || "—") + "</option>";
                for (var i = 0; i < fields.length; i++) {
                    var f = fields[i];
                    out += '<option value="' + escA(f.name) + '"' + (f.name === selected ? " selected" : "") + ">" + escapeText(f.label || f.name) + "</option>";
                }
                return out;
            };
            var layout = c.layout || "cards";
            var seg = '<div class="lime-segmented">' +
                [["cards", "Карточки"], ["grid", "Сетка"], ["list", "Список"]].map(function (o) {
                    return '<button type="button" class="' + (layout === o[0] ? "is-active" : "") + '" data-doc-cl-layout="' + o[0] + '">' + o[1] + "</button>";
                }).join("") + "</div>";
            var html = colSelect +
                '<div class="lime-inspector__hint" style="margin-top:6px;">Коллекции создаются в разделе «Данные».</div>';
            if (curSlug) {
                html +=
                    '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Раскладка</div>' + seg +
                    '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Сколько показывать</div>' +
                    '<input type="number" min="1" max="200" class="lime-input" data-doc-cl-limit value="' + (parseInt(c.limit, 10) || 12) + '" style="width:100%;">';
                if (fields.length) {
                    html +=
                        '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Сортировка</div>' +
                        '<div class="lime-flex lime-gap-2">' +
                        '<select class="lime-select" data-doc-cl-sortfield style="flex:1;">' + fieldOpts(c.sortField || "", "По дате (новые)") + "</select>" +
                        '<select class="lime-select" data-doc-cl-sortdir style="width:104px;"><option value="desc"' + (c.sortDir !== "asc" ? " selected" : "") + ">↓ убыв.</option><option value=\"asc\"" + (c.sortDir === "asc" ? " selected" : "") + ">↑ возр.</option></select>" +
                        "</div>" +
                        '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Фильтр (содержит)</div>' +
                        '<div class="lime-flex lime-gap-2">' +
                        '<select class="lime-select" data-doc-cl-filterfield style="flex:1;">' + fieldOpts(c.filterField || "", "— без фильтра —") + "</select>" +
                        '<input type="text" class="lime-input" data-doc-cl-filterval placeholder="значение" value="' + escA(c.filterValue || "") + '" style="flex:1;">' +
                        "</div>" +
                        '<div class="lime-inspector__hint" style="margin:10px 0 2px;">Поля карточки (необязательно — иначе авто)</div>' +
                        '<label class="lime-v2-field"><span>Обложка</span><select class="lime-select" data-doc-cl-imagefield>' + fieldOpts(c.imageField || "", "авто") + "</select></label>" +
                        '<label class="lime-v2-field"><span>Заголовок</span><select class="lime-select" data-doc-cl-titlefield>' + fieldOpts(c.titleField || "", "авто") + "</select></label>" +
                        '<label class="lime-v2-field"><span>Описание</span><select class="lime-select" data-doc-cl-descfield>' + fieldOpts(c.descField || "", "авто") + "</select></label>";
                } else {
                    html += '<div class="lime-inspector__hint" style="margin-top:8px;">У коллекции пока нет полей — добавь их в разделе «Данные», чтобы настроить карточку.</div>';
                }
            }
            return sec("Источник — коллекция", html);
        }

        function setContentFlag(key, val) {
            var b = byId(getSelectedId());
            if (!b) return;
            setContentValue(b, key, val, val == null);
        }

        return {
            populateCollectionPickers: populateCollectionPickers,
            editorCollectionData: editorCollectionData,
            templateSampleRecord: templateSampleRecord,
            bindingSection: bindingSection,
            contentExtras: contentExtras,
            setContentFlag: setContentFlag
        };
    }

    return { create: create };
});
