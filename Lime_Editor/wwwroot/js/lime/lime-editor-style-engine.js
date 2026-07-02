/*
 * Lime editor style/block gesture engine (вынос из lime-doc-editor.js).
 *
 * Запись стилей и block/content-пропов через command-store с gesture-транзакциями:
 * серия правок одного контрола (ползунок/инпут) склеивается в ОДИН undo (begin →
 * dispatch* → debounce 400ms → commit), смена контрола/цели коммитит предыдущий жест.
 * Пути: обычный блок (setStyle), инстанс компонента (локальный override — definition
 * не трогаем), multi-select fan-out одной транзакцией, reset override'ов бакета,
 * правка класса (checkpoint, не command). Без cmdStore — legacy snapshot fallback.
 * Изменяемое состояние main (cmdStore/doc/cmdPrev/selectedId/currentBp/currentClass/
 * currentState) — через get/set-инъекции: актуальное на момент вызова. Браузер-онли.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorStyleEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var getCmdStore = options.getCmdStore || function () { return null; };
        var setDoc = options.setDoc || noop;
        var setCmdPrev = options.setCmdPrev || noop;
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCurrentClass = options.getCurrentClass || function () { return null; };
        var getCurrentState = options.getCurrentState || function () { return "normal"; };
        var getCurrentBp = options.getCurrentBp || function () { return "base"; };
        var byId = options.byId || function () { return null; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        var readStyles = options.readStyles || function () { return {}; };
        var findClassDef = options.findClassDef || function () { return null; };
        var componentRecord = options.componentRecord || function () { return null; };
        var setComponentStyleOverrideLocal = options.setComponentStyleOverrideLocal || noop;
        var beginCheckpointMutation = options.beginCheckpointMutation || noop;
        var updateHistButtons = options.updateHistButtons || noop;
        var scheduleAutosave = options.scheduleAutosave || noop;
        var markDirty = options.markDirty || noop;
        var refreshInspector = options.refreshInspector || noop;
        var applyPreviewStyles = options.applyPreviewStyles || noop;
        var commitInlineEdit = options.commitInlineEdit || noop;

        // Коммит жеста: забрать свежий doc из store в main и синхронизировать history-курсор.
        function syncDocAfterCommit(cs) {
            var d = cs.getDoc();
            setDoc(d);
            setCmdPrev(JSON.stringify(d));
            updateHistButtons();
            scheduleAutosave();
        }

        var styleDebounce;
        var styleTxn = false;
        var styleTxnKey = null;
        function commitStyleEdit() {
            clearTimeout(styleDebounce);
            var cs = getCmdStore();
            if (!styleTxn || !cs) return;
            cs.commit("style-gesture");
            styleTxn = false;
            styleTxnKey = null;
            syncDocAfterCommit(cs);
        }
        // Оседание стиль-жеста (debounce-конец): коммитим и на НЕ-base брейкпоинте (single-select,
        // обычное состояние) перерисовываем инспектор — чтобы появилась/исчезла кнопка «сбросить»
        // override. На base/мульти/hover — без лишнего ре-рендера (не теряем фокус контролов).
        function settleStyleGesture() {
            commitStyleEdit();
            var selectedId = getSelectedId();
            var sb = selectedId ? byId(selectedId) : null;
            var singleInst = sb && sb.type === "component" && componentRecord(sb.ref) && v2SelectionIds().length < 2;
            if (!getCurrentClass() && getCurrentState() === "normal" && (getCurrentBp() !== "base" || singleInst)) refreshInspector();
        }
        function commandStyle(b, bucket, prop, val) {
            var cs = getCmdStore();
            if (!cs || targetBlock(b) !== b) return false;
            commitInlineEdit();
            commitBlockEdit();
            var key = b.id + ":" + bucket + ":" + prop;
            if (styleTxn && styleTxnKey !== key) commitStyleEdit();
            if (!styleTxn) {
                cs.begin("style-gesture");
                styleTxn = true;
                styleTxnKey = key;
            }
            if (!cs.dispatch("setStyle", {
                id: b.id,
                breakpoint: bucket,
                prop: prop,
                value: val,
                remove: val === "" || val == null
            })) {
                cs.cancel();
                styleTxn = false;
                styleTxnKey = null;
                return true; // поддержанная no-op-команда: не проваливаемся в snapshot fallback
            }
            setDoc(cs.getDoc());
            clearTimeout(styleDebounce);
            styleDebounce = setTimeout(settleStyleGesture, 400);
            return true;
        }
        // Локальный style-override инстанса компонента: тот же gesture-txn, что commandStyle, но цель —
        // overrides.styles[bucket][prop] (не definition). Один undo на жест; debounce → settle/refresh.
        function commandStyleOverride(inst, bucket, prop, val) {
            var cs = getCmdStore();
            if (!cs) return false;
            commitInlineEdit();
            commitBlockEdit();
            var key = inst.id + ":ovr:" + bucket + ":" + prop;
            if (styleTxn && styleTxnKey !== key) commitStyleEdit();
            if (!styleTxn) {
                cs.begin("style-gesture");
                styleTxn = true;
                styleTxnKey = key;
            }
            if (!cs.dispatch("setComponentStyleOverride", {
                id: inst.id, breakpoint: bucket, prop: prop, value: val, remove: val === "" || val == null
            })) {
                cs.cancel();
                styleTxn = false;
                styleTxnKey = null;
                return true; // поддержанная no-op-команда: не проваливаемся в snapshot fallback
            }
            setDoc(cs.getDoc());
            clearTimeout(styleDebounce);
            styleDebounce = setTimeout(settleStyleGesture, 400);
            return true;
        }
        // Stage 5 multi-select: id'шники V2-выбора (≥1). Один блок — обычный путь, несколько —
        // fan-out стилевых правок на все как одна undo-транзакция.
        function v2SelectionIds() {
            if (win.__LIME_SELECTION__) {
                var ids = win.__LIME_SELECTION__.get().ids;
                if (ids.length) return ids;
            }
            var selectedId = getSelectedId();
            return selectedId ? [selectedId] : [];
        }
        // Модель стилевых значений мульти-выбора различает три состояния свойства:
        // common (одно явное значение), mixed (значения/наличие расходятся), unset (нет у всех).
        function multiStyleModel(ids, bucketName) {
            var buckets = ids.map(function (id) {
                return readStyles(byId(id))[bucketName] || {}; // у инстанса — эффективные стили
            });
            var props = {}, values = {}, mixed = {};
            buckets.forEach(function (bk) { Object.keys(bk).forEach(function (p) { props[p] = 1; }); });
            Object.keys(props).forEach(function (prop) {
                var has0 = Object.prototype.hasOwnProperty.call(buckets[0], prop);
                var v0 = buckets[0][prop];
                var common = buckets.every(function (bk) {
                    return Object.prototype.hasOwnProperty.call(bk, prop) === has0 && (!has0 || bk[prop] === v0);
                });
                if (common && has0) values[prop] = v0;
                else if (!common) mixed[prop] = true;
            });
            return { values: values, mixed: mixed };
        }
        // Стилевая gesture-команда на НЕСКОЛЬКО узлов: одна транзакция, по dispatch на каждый target.
        function commandStyleMulti(ids, bucket, prop, val) {
            var cs = getCmdStore();
            if (!cs) return false;
            var seen = {}, targets = [];
            for (var i = 0; i < ids.length; i++) {
                var source = byId(ids[i]);
                if (!source) return false;
                var isInst = source.type === "component" && componentRecord(source.ref);
                // Обычный блок адресуем напрямую; компонент-инстанс — через локальный style-override.
                // Определение компонента (target !== source и не инстанс) command engine пока не трогает.
                if (!isInst && targetBlock(source) !== source) return false;
                if (!seen[source.id]) { seen[source.id] = true; targets.push({ id: source.id, inst: !!isInst }); }
            }
            if (!targets.length) return false;
            commitInlineEdit(); commitBlockEdit();
            var key = "multi:" + targets.map(function (t) { return t.id; }).join(",") + ":" + bucket + ":" + prop;
            if (styleTxn && styleTxnKey !== key) commitStyleEdit();
            if (!styleTxn) { cs.begin("style-gesture"); styleTxn = true; styleTxnKey = key; }
            var rm = val === "" || val == null;
            targets.forEach(function (t) {
                if (t.inst) cs.dispatch("setComponentStyleOverride", { id: t.id, breakpoint: bucket, prop: prop, value: val, remove: rm });
                else cs.dispatch("setStyle", { id: t.id, breakpoint: bucket, prop: prop, value: val, remove: rm });
            });
            setDoc(cs.getDoc());
            clearTimeout(styleDebounce);
            styleDebounce = setTimeout(settleStyleGesture, 400);
            return true;
        }
        function setStyle(prop, val) {
            if (getCurrentClass()) { setClassStyle(prop, val); return; } // правим класс, не блок (0.1)
            var cs = getCmdStore();
            var ids = v2SelectionIds();
            var bucket = getCurrentState() === "hover" ? "hover" : getCurrentBp();
            if (ids.length >= 2) { // multi-select fan-out (Stage 5)
                if (cs && commandStyleMulti(ids, bucket, prop, val)) { applyPreviewStyles(); return; }
                commitStyleEdit();
                beginCheckpointMutation();
                var changedTargets = [];
                ids.forEach(function (id) {
                    var src = byId(id);
                    if (!src) return;
                    // Компонент-инстанс — локальный style-override (не трогаем определение/копии).
                    if (src.type === "component" && componentRecord(src.ref)) {
                        if (changedTargets.indexOf(src) !== -1) return;
                        changedTargets.push(src);
                        setComponentStyleOverrideLocal(src, bucket, prop, val, val === "" || val == null);
                        return;
                    }
                    var mb = targetBlock(src);
                    if (!mb || changedTargets.indexOf(mb) !== -1) return;
                    changedTargets.push(mb);
                    if (!mb.styles) mb.styles = {};
                    if (!mb.styles[bucket]) mb.styles[bucket] = {};
                    if (val === "" || val == null) delete mb.styles[bucket][prop]; else mb.styles[bucket][prop] = val;
                    if (!Object.keys(mb.styles[bucket]).length) delete mb.styles[bucket];
                });
                applyPreviewStyles();
                markDirty();
                return;
            }
            var source = byId(getSelectedId());
            if (!source) return;
            // Компонент-инстанс (single-select): стиль-правка локальна (overrides.styles), как текст/медиа.
            if (source.type === "component" && componentRecord(source.ref)) {
                if (cs && commandStyleOverride(source, bucket, prop, val)) { applyPreviewStyles(); return; }
                commitStyleEdit();
                beginCheckpointMutation();
                setComponentStyleOverrideLocal(source, bucket, prop, val, val === "" || val == null);
                applyPreviewStyles();
                markDirty();
                return;
            }
            var b = targetBlock(source);
            if (!b) return;
            if (commandStyle(source, bucket, prop, val)) {
                applyPreviewStyles();
                return;
            }
            commitStyleEdit();
            if (!b.styles) b.styles = {};
            if (!b.styles[bucket]) b.styles[bucket] = {};
            if (val === "" || val == null) delete b.styles[bucket][prop];
            else b.styles[bucket][prop] = val;
            if (!Object.keys(b.styles[bucket]).length) delete b.styles[bucket]; // не плодим пустые бакеты
            applyPreviewStyles();
            markDirty();
        }
        // Stage 5 reset override: снять переопределения секции на текущем бакете → значение наследуется
        // с base/tablet. Одна транзакция на все пропы секции (и все выбранные узлы), затем re-render.
        function resetStyleProps(props) {
            if (!props || !props.length || getCurrentClass()) return;
            commitStyleEdit();
            var cs = getCmdStore();
            var ids = v2SelectionIds();
            var bucket = getCurrentState() === "hover" ? "hover" : getCurrentBp();
            var isInst = function (src) { return src && src.type === "component" && componentRecord(src.ref); };
            if (cs) {
                cs.begin("style-reset");
                ids.forEach(function (id) {
                    var src = byId(id);
                    if (!src) return;
                    // Инстанс — снимаем локальный override (к компоненту); обычный блок — свой стиль.
                    if (isInst(src)) {
                        props.forEach(function (p) { cs.dispatch("setComponentStyleOverride", { id: src.id, breakpoint: bucket, prop: p, remove: true }); });
                    } else {
                        var t = targetBlock(src);
                        if (t) props.forEach(function (p) { cs.dispatch("setStyle", { id: t.id, breakpoint: bucket, prop: p, value: "", remove: true }); });
                    }
                });
                cs.commit("style-reset");
                syncDocAfterCommit(cs);
            } else {
                ids.forEach(function (id) {
                    var src = byId(id);
                    if (!src) return;
                    if (isInst(src)) {
                        props.forEach(function (p) { setComponentStyleOverrideLocal(src, bucket, p, "", true); });
                        return;
                    }
                    var t = targetBlock(src);
                    if (!t || !t.styles || !t.styles[bucket]) return;
                    props.forEach(function (p) { delete t.styles[bucket][p]; });
                    if (!Object.keys(t.styles[bucket]).length) delete t.styles[bucket];
                });
                markDirty();
            }
            applyPreviewStyles();
            refreshInspector();
        }
        // Запись стиля в определение класса (0.1): живое превью через applyPreviewStyles
        // обновит ВСЕ блоки с этим классом без полного ре-рендера (ползунок не теряет фокус).
        function setClassStyle(prop, val) {
            var def = findClassDef(getCurrentClass());
            if (!def) return;
            beginCheckpointMutation();
            if (!def.styles) def.styles = {};
            var bucket = getCurrentState() === "hover" ? "hover" : getCurrentBp();
            if (!def.styles[bucket]) def.styles[bucket] = {};
            if (val === "" || val == null) delete def.styles[bucket][prop];
            else def.styles[bucket][prop] = val;
            if (!Object.keys(def.styles[bucket]).length) delete def.styles[bucket];
            applyPreviewStyles();
            markDirty();
        }

        // Block/content-жесты: setBlockProp/setContent того же транзакционного семейства
        // (anim/motion-ползунки, поля контента) — один undo на серию правок одного контрола.
        var blockDebounce;
        var blockTxn = false;
        var blockTxnKey = null;
        function commitBlockEdit() {
            clearTimeout(blockDebounce);
            var cs = getCmdStore();
            if (!blockTxn || !cs) return;
            cs.commit("block-gesture");
            blockTxn = false;
            blockTxnKey = null;
            syncDocAfterCommit(cs);
        }
        function commandBlockGesture(source, prop, value, remove, gestureKey) {
            var cs = getCmdStore();
            if (!cs || targetBlock(source) !== source) return false;
            commitInlineEdit();
            commitStyleEdit();
            var key = source.id + ":" + (gestureKey || prop);
            if (blockTxn && blockTxnKey !== key) commitBlockEdit();
            if (!blockTxn) {
                cs.begin("block-gesture");
                blockTxn = true;
                blockTxnKey = key;
            }
            if (!cs.dispatch("setBlockProp", {
                id: source.id, prop: prop, value: value, remove: !!remove
            })) {
                cs.cancel();
                blockTxn = false;
                blockTxnKey = null;
                return true;
            }
            setDoc(cs.getDoc());
            clearTimeout(blockDebounce);
            blockDebounce = setTimeout(commitBlockEdit, 400);
            return true;
        }
        function commandContentGesture(source, field, value, remove, gestureKey) {
            var cs = getCmdStore();
            if (!cs || targetBlock(source) !== source) return false;
            commitInlineEdit();
            commitStyleEdit();
            var key = source.id + ":content:" + (gestureKey || field);
            if (blockTxn && blockTxnKey !== key) commitBlockEdit();
            if (!blockTxn) {
                cs.begin("content-gesture");
                blockTxn = true;
                blockTxnKey = key;
            }
            if (!cs.dispatch("setContent", {
                id: source.id, field: field, value: value, remove: !!remove
            })) {
                cs.cancel();
                blockTxn = false;
                blockTxnKey = null;
                return true;
            }
            setDoc(cs.getDoc());
            clearTimeout(blockDebounce);
            blockDebounce = setTimeout(commitBlockEdit, 400);
            return true;
        }

        return {
            commitStyleEdit: commitStyleEdit,
            settleStyleGesture: settleStyleGesture,
            v2SelectionIds: v2SelectionIds,
            multiStyleModel: multiStyleModel,
            setStyle: setStyle,
            resetStyleProps: resetStyleProps,
            setClassStyle: setClassStyle,
            commitBlockEdit: commitBlockEdit,
            commandBlockGesture: commandBlockGesture,
            commandContentGesture: commandContentGesture
        };
    }

    return { create: create };
});
