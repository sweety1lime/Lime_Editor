/*
 * Lime editor inspector view (вынос из lime-doc-editor.js).
 *
 * Сборка панели инспектора: curStyle (класс/hover/брейкпоинт-бакет), провенанс стилевых
 * секций (own/tablet/base/class/instance-own → бейдж + «сбросить»), core/adv-группировка
 * секций STYLE_REGISTRY и refreshInspector — шапка с тулбаром, баннеры компонента/multi,
 * вкладки Стиль/Эффекты/Движение и склейка секций из модулей (classes/v2-layout/binding/
 * bg/effects). Пишет только UI; правки стилей идут через data-doc-* хуки в обработчиках
 * main. bindingSection/contentExtras/bgInspector/populateCollectionPickers — thunk'и (их
 * алиасы в main присваиваются позже создания). inspectorAdvOpen (развёрнутость группы
 * «Дополнительно») — приватное состояние модуля. Браузер-онли.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorInspector = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() { return ""; }

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var inspectorEl = options.inspectorEl;
        var L = options.L || {};
        var escapeText = options.escapeText || function (s) { return s; };
        var ico = options.ico || noop;
        var getDoc = options.getDoc || function () { return { components: {} }; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentClass = options.getCurrentClass || function () { return null; };
        var getCurrentState = options.getCurrentState || function () { return "normal"; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var getCurrentInspectorTab = options.getCurrentInspectorTab || function () { return "style"; };
        // UI-уровни (Milestone 2 experience-builder-plan.md): дефолт "pro" — если уровень не
        // инжектнут (напр. старые тесты), поведение как раньше — ничего не сворачивается.
        var getCurrentUiLevel = options.getCurrentUiLevel || function () { return "pro"; };
        var UiLevel = options.uiLevel || (win && win.LimeEditorUiLevel) || { atOrBelow: function () { return true; } };
        var byId = options.byId || function () { return null; };
        var findBlock = options.findBlock || function () { return null; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        var readStyles = options.readStyles || function () { return {}; };
        var findClassDef = options.findClassDef || function () { return null; };
        var effectiveClassStyles = options.effectiveClassStyles || function () { return {}; };
        var componentRecord = options.componentRecord || function () { return null; };
        var syncInspectorShell = options.syncInspectorShell || function () {};
        var v2SelectionIds = options.v2SelectionIds || function () { return []; };
        var multiStyleModel = options.multiStyleModel || function () { return { values: {}, mixed: {} }; };
        // Контролы стилевых секций (inspector-controls).
        var STYLE_REGISTRY = options.styleRegistry || [];
        var hasOwn = options.hasOwn || function (o, p) { return Object.prototype.hasOwnProperty.call(o, p); };
        var registryProps = options.registryProps || function () { return []; };
        var renderControl = options.renderControl || noop;
        var sec = options.section || function (t, b) { return b; };
        // Секции-модули. binding/extras/bg/pickers — thunk'и (алиасы main присваиваются позже).
        var classEditBanner = options.classEditBanner || noop;
        var classesSection = options.classesSection || noop;
        var componentPropsSection = options.componentPropsSection || noop;
        var componentVariantControls = options.componentVariantControls || noop;
        var v2LayoutInspector = options.v2LayoutInspector || noop;
        var bindingSection = options.bindingSection || noop;
        var contentExtras = options.contentExtras || noop;
        var bgInspector = options.bgInspector || noop;
        var fxInspector = options.fxInspector || noop;
        var animInspector = options.animInspector || noop;
        var motionInspector = options.motionInspector || noop;
        var sceneInspector = options.sceneInspector || noop;
        var layersInspector = options.layersInspector || noop;
        var recipesInspector = options.recipesInspector || noop;
        var populateCollectionPickers = options.populateCollectionPickers || function () {};

        // Развёрнутость группы «Дополнительно» переживает перерисовки инспектора (redesign фаза 2).
        var inspectorAdvOpen = false;

        function curStyle(b) {
            // Режим правки класса (0.1): инспектор читает/пишет стили класса, а не блока.
            var currentClass = getCurrentClass();
            if (currentClass) {
                var def = findClassDef(currentClass);
                var cs = (def && def.styles) || {};
                return (getCurrentState() === "hover" ? cs.hover : cs[getCurrentBp()]) || {};
            }
            var st = readStyles(b); // у инстанса — эффективные (definition ⊕ overrides.styles)
            return (getCurrentState() === "hover" ? st.hover : st[getCurrentBp()]) || {};
        }

        function bpLabel() {
            var currentBp = getCurrentBp();
            return currentBp === "base" ? "Десктоп" : currentBp === "tablet" ? "Планшет" : "Мобайл";
        }

        // Пропы секции, переопределённые на бакете bp у ВСЕХ выбранных узлов (для multi-reset).
        function ownOverrideProps(ids, bp) {
            var buckets = ids.map(function (id) { var t = targetBlock(byId(id)); return (t && t.styles && t.styles[bp]) || {}; });
            if (!buckets.length) return {};
            var out = {};
            Object.keys(buckets[0]).forEach(function (p) {
                if (buckets.every(function (bk) { return hasOwn(bk, p); })) out[p] = true;
            });
            return out;
        }
        // Источник значения секции: "own" (переопределено здесь → reset), "tablet"/"base" (унаследовано
        // с нижнего бр.), "class" (значение из класса) или null (значение блока на base / ничего).
        function sectionSource(props, info) {
            if (!info) return null;
            // Инстанс компонента: единственная ось — локальный override относительно определения
            // (на любом бакете, включая base). Bp-каскад определения для инстанса не показываем —
            // его reset правил бы определение, а не копию.
            if (info.instance) return props.some(function (p) { return hasOwn(info.instOwn, p); }) ? "instance-own" : null;
            if (info.bp !== "base" && props.some(function (p) { return hasOwn(info.own, p); })) return "own";
            if (info.bp === "mobile" && props.some(function (p) { return hasOwn(info.tablet, p); })) return "tablet";
            if (info.bp !== "base" && props.some(function (p) { return hasOwn(info.base, p); })) return "base";
            if (props.some(function (p) { return hasOwn(info.cls, p) && !hasOwn(info.own, p) && !hasOwn(info.tablet, p) && !hasOwn(info.base, p); })) return "class";
            return null;
        }
        // редизайн редактора (фаза 2 инспектора) + Milestone 2 (UI-уровни): секции с tier
        // не выше текущего UI-уровня показываем сразу, всё, что выше — сворачиваем в одну
        // группу «Дополнительно» (не убираем совсем — раскрытие обучающее, не paywall).
        // Сами контролы и их data-doc-* хуки не меняются.
        function styleSectionHtml(item, s, mixed, sourceInfo) {
            var body = renderControl(item, s, mixed);
            var props = registryProps(item);
            var src = sectionSource(props, sourceInfo);
            if (src === "instance-own") {
                var instOv = props.filter(function (p) { return hasOwn(sourceInfo.instOwn, p); });
                body = '<div class="lime-style-override"><span class="lime-style-override__badge" title="Переопределено в этой копии компонента">●</span>' +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-style-reset="' + instOv.join(",") + '">↺ к компоненту</button></div>' + body;
            } else if (src === "own") {
                var ov = props.filter(function (p) { return hasOwn(sourceInfo.own, p); });
                body = '<div class="lime-style-override"><span class="lime-style-override__badge" title="Переопределено на этом брейкпоинте">●</span>' +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-style-reset="' + ov.join(",") + '">↺ сбросить</button></div>' + body;
            } else if (src === "tablet" || src === "base") {
                body = '<div class="lime-style-override lime-style-override--inherited"><span class="lime-style-override__src" data-style-src="' + src + '">← ' +
                    (src === "tablet" ? "планшет" : "десктоп") + '</span></div>' + body;
            } else if (src === "class") {
                body = '<div class="lime-style-override lime-style-override--inherited"><span class="lime-style-override__src" data-style-src="class">← класс</span></div>' + body;
            }
            return sec(item.title, body);
        }
        // Общий бакетинг по UI-уровню: chunks — [{tier, html}], пустые html отфильтровываются
        // (иначе, например, componentPropsSection на не-компоненте создал бы пустую запись в
        // «Дополнительно»). Используется и для STYLE_REGISTRY, и для секций-модулей (Layout·V2,
        // Классы, пропсы компонента) — один общий fold, а не несколько подряд.
        function tieredSections(level, chunks) {
            var core = [], adv = [];
            chunks.forEach(function (c) {
                if (!c || !c.html) return;
                (UiLevel.atOrBelow(c.tier, level) ? core : adv).push(c.html);
            });
            var out = core.join("");
            if (adv.length) {
                out += '<details class="lime-inspector__adv"' + (inspectorAdvOpen ? " open" : "") + '>' +
                    '<summary class="lime-inspector__adv-summary">Дополнительно</summary>' +
                    '<div class="lime-inspector__adv-body">' + adv.join("") + '</div>' +
                    '</details>';
            }
            return out;
        }
        function renderStyleSections(s, mixed, sourceInfo, level) {
            return tieredSections(level, STYLE_REGISTRY.map(function (item) {
                return { tier: item.tier, html: styleSectionHtml(item, s, mixed, sourceInfo) };
            }));
        }

        function refreshInspector() {
            if (!inspectorEl) return;
            var doc = getDoc();
            var selectedId = getSelectedId();
            var currentClass = getCurrentClass();
            var currentState = getCurrentState();
            var currentBp = getCurrentBp();
            var currentInspectorTab = getCurrentInspectorTab();
            var b = selectedId ? byId(selectedId) : null;
            // редизайн: в V2 инспектор скрыт, пока ничего не выбрано — холст шире, меньше шума.
            // В legacy (?classic=1) инспектор остаётся постоянным.
            syncInspectorShell(!!b);
            if (!b) {
                inspectorEl.innerHTML = '<div class="lime-inspector__empty">' + ico("cta") +
                    '<p>Выбери блок в холсте, чтобы редактировать стили, раскладку и контент.</p></div>';
                return;
            }
            var s = curStyle(b);
            // Stage 5 multi-select: стилевые секции читают синтетический мульти-бакет (общее/Mixed),
            // правки разветвляются на все выбранные узлы. Layout/fx/фон остаются на primary.
            var multiIds = v2SelectionIds();
            var multiSel = multiIds.length >= 2 && !currentClass;
            var multiStyles = multiSel ? multiStyleModel(multiIds, currentState === "hover" ? "hover" : currentBp) : null;
            var styleSecBucket = multiStyles ? multiStyles.values : s;
            var styleMixed = multiStyles ? multiStyles.mixed : {};
            // Stage 5 source/reset: секция показывает провенанс — own (переопределено здесь → «сбросить»),
            // tablet/base (унаследовано), class (из класса). Multi: reset, когда все выбранные переопределены
            // на этом бр. (own = пересечение); inherited/class-бейджи для multi не показываем (гетерогенно).
            var singleInstance = !multiSel && b.type === "component" && componentRecord(b.ref);
            var styleSourceInfo = (!currentClass && currentState === "normal")
                ? (multiSel
                    ? { bp: currentBp, own: currentBp !== "base" ? ownOverrideProps(multiIds, currentBp) : {}, tablet: {}, base: {}, cls: {} }
                    : singleInstance
                        // Инстанс: ось «локальный override → к компоненту» (на текущем бакете, в т.ч. base).
                        ? { bp: currentBp, instance: true,
                            instOwn: (b.overrides && b.overrides.styles && b.overrides.styles[currentBp]) || {} }
                        : { bp: currentBp,
                            own: (currentBp !== "base" && targetBlock(b).styles && targetBlock(b).styles[currentBp]) || {},
                            tablet: (targetBlock(b).styles && targetBlock(b).styles.tablet) || {},
                            base: (targetBlock(b).styles && targetBlock(b).styles.base) || {},
                            cls: effectiveClassStyles(b) })
                : null;
            var multiBanner = multiSel
                ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner" data-multi-select>Selected nodes: ' + multiIds.length + ' — style edits apply to all. <button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="group">Group</button></div></div>'
                : '';
            var isComp = b.type === "component";
            var compName = (isComp && doc.components[b.ref]) ? doc.components[b.ref].name : "";
            var resetOverridesBtn = (isComp && b.overrides)
                ? '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="reset-overrides" title="Снять все локальные правки этой копии">↺ Сбросить правки</button> '
                : '';
            var banner = isComp
                ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner">⊞ Компонент «' + escapeText(compName) + '» — правки текста/медиа/стиля локальны для этой копии. ' + resetOverridesBtn + '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-op="detach">Отвязать</button></div></div>'
                : '';
            if (isComp) banner = banner.replace("</div></div>", componentVariantControls(b) + "</div></div>");
            var found = findBlock(selectedId);
            var nested = !!(found && found.parentBlock); // вложен в контейнер → доступно «Наружу»
            var t = targetBlock(b);
            var colsSec = (t && t.type === "columns")
                ? sec("Колонки", '<div class="lime-segmented">' + [2, 3].map(function (n) {
                    return '<button type="button" class="' + ((t.content && t.content.cols) == n ? "is-active" : "") + '" data-doc-cols="' + n + '">' + n + '</button>';
                }).join("") + '</div>')
                : "";
            var containerHint = (t && L.isContainer(t.type))
                ? '<div class="lime-inspector__section"><div class="lime-doc-comp-banner">▣ Контейнер выбран — блоки из сайдбара добавятся внутрь него.</div></div>'
                : "";

            // DnD C: режим раскладки контейнера → заметный тумблер «Свободно ⇄ Поток» в шапке.
            // Делает free-режим (перемещение блоков как в Figma) видимым, а не спрятанным в Layout·V2.
            var contMode = (t && L.isContainer(t.type) && t.type !== "component" && L.resolvedDesign)
                ? ((L.resolvedDesign(t.design, currentBp).layout || {}).mode || "stack") : "";
            var freeToggleBtn = contMode
                ? '<button type="button" class="lime-block-toolbar__btn' + (contMode === "free" ? " is-active" : "") +
                    '" data-doc-op="free-toggle' +
                    '" title="' + (contMode === "free" ? "Вернуть блоки в поток" : "Свободное размещение — двигай блоки как в Figma") +
                    '" aria-label="Свободное размещение"><svg class="lime-ico"><use href="#i-free"/></svg></button>'
                : "";
            var headHtml =
                '<div class="lime-inspector__head">' +
                    '<div class="lime-inspector__title">' + (isComp ? "компонент" : b.type) +
                        '<small>Стили для: <b>' + bpLabel() + '</b>' + (currentBp === "base" ? "" : " (override)") + '</small></div>' +
                    '<div class="lime-flex lime-gap-2" role="toolbar" aria-label="Действия над блоком">' +
                        freeToggleBtn +
                        '<button type="button" class="lime-block-toolbar__btn" data-doc-op="up" title="Вверх" aria-label="Поднять блок">' + ico("up") + '</button>' +
                        '<button type="button" class="lime-block-toolbar__btn" data-doc-op="down" title="Вниз" aria-label="Опустить блок">' + ico("down") + '</button>' +
                        (nested ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="unwrap" title="Вытащить из контейнера" aria-label="Вытащить из контейнера">' + ico("out") + '</button>' : "") +
                        (t && t.content && typeof t.content.text === "string"
                            ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="ai" title="Переписать текст (AI)" aria-label="Переписать текст с помощью AI">' + ico("features") + '</button>' : "") +
                        '<button type="button" class="lime-block-toolbar__btn" data-doc-op="dup" title="Дублировать" aria-label="Дублировать блок">' + ico("duplicate") + '</button>' +
                        (b.type === "group" ? '<button type="button" class="lime-block-toolbar__btn" data-doc-op="ungroup" title="Ungroup" aria-label="Разгруппировать">' + ico("ungroup") + '</button>' : "") +
                        (isComp ? "" : '<button type="button" class="lime-block-toolbar__btn" data-doc-op="comp" title="Сделать компонентом" aria-label="Сделать компонентом">' + ico("grid") + '</button>') +
                        '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-op="del" title="Удалить" aria-label="Удалить блок">' + ico("trash") + '</button>' +
                    '</div>' +
                '</div>';

            // Вкладки инспектора (Фаза удобства): режут длинный скролл втрое. FX/Движение —
            // Motion-tier и выше (Milestone 2): ниже уровня они просто не показываются в баре,
            // раскрыть — один клик по тумблеру уровня в topbar-more, не paywall.
            var uiLevel = getCurrentUiLevel();
            var allTabs = [["style", "Стиль"], ["fx", "Эффекты"], ["motion", "Движение"]];
            var tabs = allTabs.filter(function (o) { return o[0] === "style" || UiLevel.atOrBelow("motion", uiLevel); });
            var effectiveTab = tabs.some(function (o) { return o[0] === currentInspectorTab; }) ? currentInspectorTab : "style";
            var tabsBar = '<div class="lime-insp-tabs">' + tabs.map(function (o) {
                return '<button type="button" class="lime-insp-tab-btn' + (effectiveTab === o[0] ? " is-active" : "") + '" data-doc-insp-tab="' + o[0] + '">' + o[1] + '</button>';
            }).join("") + '</div>';
            function panel(name, body) {
                return '<div class="lime-insp-panel" data-insp-tab="' + name + '"' + (effectiveTab === name ? "" : " hidden") + '>' + body + '</div>';
            }

            // Переключатель состояния (1.2): «Обычное / Наведение». В hover-режиме правим только
            // стиль-пропсы (контент/фон/колонки скрыты — они не зависят от состояния).
            var stateSeg = sec("Состояние", '<div class="lime-segmented">' +
                '<button type="button" class="' + (currentState === "normal" ? "is-active" : "") + '" data-doc-state="normal">Обычное</button>' +
                '<button type="button" class="' + (currentState === "hover" ? "is-active" : "") + '" data-doc-state="hover">Наведение</button>' +
                '</div>' + (currentState === "hover" ? '<div class="lime-inspector__hint" style="margin-top:6px;">Стили применяются при наведении курсора. В холсте показан вид наведения.</div>' : ''));
            var styleBody;
            if (currentClass) {
                // Режим правки класса: только баннер + переключатель состояния + стили (контент/фон/колонки — это про блок).
                styleBody = classEditBanner() + stateSeg + renderStyleSections(styleSecBucket, styleMixed, styleSourceInfo, uiLevel);
            } else if (currentState === "hover") {
                styleBody = classesSection(b) + stateSeg + renderStyleSections(styleSecBucket, styleMixed, styleSourceInfo, uiLevel);
            } else {
                // Design-tier секции (пропсы компонента/Layout·V2/Классы) и STYLE_REGISTRY делят
                // один общий fold «Дополнительно» — иначе на Basic/Design было бы два подряд.
                var registryChunks = STYLE_REGISTRY.map(function (item) {
                    return { tier: item.tier, html: styleSectionHtml(item, styleSecBucket, styleMixed, styleSourceInfo) };
                });
                var tieredBody = tieredSections(uiLevel, [
                    { tier: "design", html: componentPropsSection(b) },
                    { tier: "design", html: v2LayoutInspector(b, found) },
                    { tier: "design", html: classesSection(b) }
                ].concat(registryChunks));
                styleBody = containerHint + colsSec + bindingSection(t) + contentExtras(t) + bgInspector(b, s) + stateSeg + tieredBody;
            }
            var fxBody = fxInspector(t) + animInspector(t);
            var motionBody = recipesInspector(t) + motionInspector(t) + sceneInspector(t) + layersInspector(t);

            inspectorEl.innerHTML =
                '<div class="lime-insp-sticky">' + headHtml + banner + multiBanner + tabsBar + '</div>' +
                panel("style", styleBody) + panel("fx", fxBody) + panel("motion", motionBody);

            // Запоминаем развёрнутость группы «Дополнительно» между перерисовками инспектора.
            var advEl = inspectorEl.querySelector(".lime-inspector__adv");
            if (advEl) advEl.addEventListener("toggle", function () { inspectorAdvOpen = advEl.open; });

            // Превью фон-пресетов — через style (в css-значениях кавычки/запятые, в атрибут не вставить).
            if (win.LimeAssets && win.LimeAssets.BG_PRESETS) {
                var pbtns = inspectorEl.querySelectorAll("[data-doc-bg-preset]");
                for (var pi = 0; pi < pbtns.length; pi++) {
                    var pp = win.LimeAssets.BG_PRESETS[parseInt(pbtns[pi].getAttribute("data-doc-bg-preset"), 10)];
                    if (pp) pbtns[pi].style.backgroundImage = pp.css;
                }
            }
            populateCollectionPickers(t);
        }

        return {
            refreshInspector: refreshInspector,
            curStyle: curStyle,
            bpLabel: bpLabel,
            renderStyleSections: renderStyleSections,
            sectionSource: sectionSource,
            ownOverrideProps: ownOverrideProps
        };
    }

    return { create: create };
});
