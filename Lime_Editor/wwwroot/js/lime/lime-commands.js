/*
 * Lime Commands — command-system + транзакционная история для Editor V2 (этап D2, on-ramp).
 *
 * Зачем: старый редактор мутирует документ напрямую и хранит undo полными JSON-снапшотами.
 * Здесь КАЖДАЯ мутация идёт через команду, которая возвращает обратный патч → undo/redo
 * транзакциями (а не снапшотами всего документа). Драг из сотен pointermove фиксируется
 * ОДНОЙ транзакцией (begin → … → commit).
 *
 * Границы (по плану «не сломать»): работает на ТОМ ЖЕ v1-документе (pages/blocks), СХЕМУ
 * НЕ меняет, publish/export НЕ трогает. Подключён к старому редактору strangler-переходом за
 * feature-flag `?cmd=1`: переведённые мутации дают op-записи, остальные — state-checkpoint.
 * UMD + node-тестируемо, как lime-doc.js; TS-тулчейн остаётся следующим архитектурным слоем.
 *
 * Модель: forward-операции применяются, applyOp возвращает обратную операцию. Запись истории
 * хранит обратные операции (в порядке для undo). undo/redo симметричны: применение записи
 * порождает обратную запись для противоположного стека.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeCommands = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var HIST_MAX = 100;

    function getAt(rootObj, path) {
        var node = rootObj;
        for (var i = 0; i < path.length; i++) {
            if (node == null) return undefined;
            node = node[path[i]];
        }
        return node;
    }

    // Поиск блока по id с путём в дереве. Возвращает { path, parentPath, index, block } или null.
    function findPath(doc, id) {
        var pages = (doc && doc.pages) || [];
        for (var pi = 0; pi < pages.length; pi++) {
            var r = findInBlocks((pages[pi] && pages[pi].blocks) || [], id, ["pages", pi, "blocks"]);
            if (r) return r;
        }
        return null;
    }
    function findInBlocks(blocks, id, base) {
        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            if (b && b.id === id) return { path: base.concat(i), parentPath: base, index: i, block: b };
            if (b && b.children && b.children.length) {
                var r = findInBlocks(b.children, id, base.concat(i, "children"));
                if (r) return r;
            }
        }
        return null;
    }

    function samePath(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    function startsWithPath(path, prefix) {
        if (!path || !prefix || path.length < prefix.length) return false;
        for (var i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
        return true;
    }
    // После удаления элемента более поздний sibling (и всё его поддерево) сдвигается на -1.
    function pathAfterRemove(path, parentPath, removedIndex) {
        var out = path.slice();
        if (startsWithPath(out, parentPath) && out.length > parentPath.length) {
            var childIndex = out[parentPath.length];
            if (typeof childIndex === "number" && childIndex > removedIndex) out[parentPath.length]--;
        }
        return out;
    }
    function fieldPath(field) {
        return String(field || "").split(".").filter(Boolean).map(function (part) {
            return /^\d+$/.test(part) ? parseInt(part, 10) : part;
        });
    }
    function nodeFlag(doc, c, prop) {
        if (typeof c.value !== "boolean") return [];
        var f = findPath(doc, c.id);
        if (!f) return [];
        var had = Object.prototype.hasOwnProperty.call(f.block, prop);
        if (!c.value) return had ? [{ kind: "unset", path: f.path.concat(prop) }] : [];
        if (f.block[prop] === true) return [];
        return [{ kind: "set", path: f.path.concat(prop), value: true }];
    }

    // Низкоуровневая операция патча. Мутирует state и ВОЗВРАЩАЕТ обратную операцию.
    //  set    — присвоить значение по пути (инверсия: вернуть старое / unset, если ключа не было);
    //  unset  — удалить ключ (инверсия: set прежнего значения);
    //  insert — вставить в массив по индексу (инверсия: remove);
    //  remove — удалить из массива по индексу (инверсия: insert удалённого).
    function applyOp(state, op) {
        if (op.kind === "set") {
            var parent = getAt(state, op.path.slice(0, -1));
            var key = op.path[op.path.length - 1];
            var had = parent && Object.prototype.hasOwnProperty.call(parent, key);
            var old = parent ? parent[key] : undefined;
            parent[key] = op.value;
            return had ? { kind: "set", path: op.path, value: old } : { kind: "unset", path: op.path };
        }
        if (op.kind === "unset") {
            var p = getAt(state, op.path.slice(0, -1));
            var k = op.path[op.path.length - 1];
            var prev = p ? p[k] : undefined;
            if (p) delete p[k];
            return { kind: "set", path: op.path, value: prev };
        }
        if (op.kind === "insert") {
            getAt(state, op.path).splice(op.index, 0, op.value);
            return { kind: "remove", path: op.path, index: op.index };
        }
        if (op.kind === "remove") {
            var removed = getAt(state, op.path).splice(op.index, 1)[0];
            return { kind: "insert", path: op.path, index: op.index, value: removed };
        }
        throw new Error("Unknown op kind: " + op.kind);
    }

    // Команды строят forward-операции из дескриптора. Чистые: не мутируют, только описывают.
    var COMMANDS = {
        setNodeLocked: function (doc, c) { return nodeFlag(doc, c, "locked"); },
        setNodeHidden: function (doc, c) { return nodeFlag(doc, c, "hidden"); },
        renameNode: function (doc, c) {
            if (typeof c.name !== "string") return [];
            var f = findPath(doc, c.id);
            if (!f) return [];
            var name = c.name.trim();
            if (name.length > 120) return [];
            if (!name) {
                return Object.prototype.hasOwnProperty.call(f.block, "name")
                    ? [{ kind: "unset", path: f.path.concat("name") }] : [];
            }
            if (f.block.name === name) return [];
            return [{ kind: "set", path: f.path.concat("name"), value: name }];
        },
        setNodeZIndex: function (doc, c) {
            var breakpoints = { base: 1, tablet: 1, mobile: 1 };
            var bp = c.breakpoint || "base";
            if (!breakpoints[bp] || typeof c.value !== "number" || !isFinite(c.value) || Math.floor(c.value) !== c.value || c.value < -1000 || c.value > 1000) return [];
            var f = findPath(doc, c.id);
            if (!f) return [];
            if (f.block.design && f.block.design[bp] && f.block.design[bp].zIndex === c.value) return [];
            return COMMANDS.setDesign(doc, { id: c.id, breakpoint: bp, field: "zIndex", value: c.value });
        },
        // Editor V2 design bucket. Меняем только крупные валидируемые поля целиком: pointer gesture
        // коммитит один готовый frame/layout, а не сотни промежуточных координат.
        setDesign: function (doc, c) {
            var allowed = { layout: 1, size: 1, frame: 1, constraints: 1, zIndex: 1, overflow: 1, span: 1 };
            var breakpoints = { base: 1, tablet: 1, mobile: 1 };
            var bp = c.breakpoint || "base";
            if (!allowed[c.field] || !breakpoints[bp]) return [];
            var f = findPath(doc, c.id);
            if (!f) return [];
            var ops = [];
            if (c.remove || c.value === undefined) {
                if (!f.block.design || !f.block.design[bp] || !Object.prototype.hasOwnProperty.call(f.block.design[bp], c.field)) return [];
                ops.push({ kind: "unset", path: f.path.concat("design", bp, c.field) });
                if (Object.keys(f.block.design[bp]).length === 1) {
                    ops.push({ kind: "unset", path: f.path.concat("design", bp) });
                    if (Object.keys(f.block.design).length === 1) ops.push({ kind: "unset", path: f.path.concat("design") });
                }
                return ops;
            }
            if (!f.block.design) ops.push({ kind: "set", path: f.path.concat("design"), value: {} });
            if (!f.block.design || !f.block.design[bp]) ops.push({ kind: "set", path: f.path.concat("design", bp), value: {} });
            ops.push({ kind: "set", path: f.path.concat("design", bp, c.field), value: c.value });
            return ops;
        },
        // Ограниченный набор top-level свойств блока (motion/fx/decor). Не даём generic path,
        // чтобы command API оставался валидируемым и не превратился в обход схемы.
        setBlockProp: function (doc, c) {
            var allowed = {
                anim: 1, animDelay: 1, animDuration: 1, sticky: 1, stickyOffset: 1,
                marquee: 1, scene: 1, fx: 1, layers: 1, parallax: 1
            };
            if (!allowed[c.prop]) return [];
            var f = findPath(doc, c.id);
            if (!f) return [];
            if (c.remove || c.value === undefined) {
                if (!Object.prototype.hasOwnProperty.call(f.block, c.prop)) return [];
                return [{ kind: "unset", path: f.path.concat(c.prop) }];
            }
            return [{ kind: "set", path: f.path.concat(c.prop), value: c.value }];
        },
        // Контент блока: block.content[field] = value (создаёт content при отсутствии).
        setContent: function (doc, c) {
            var f = findPath(doc, c.id);
            if (!f) return [];
            var ops = [];
            var rel = fieldPath(c.field);
            if (!rel.length) return [];
            if (c.remove || c.value === undefined) {
                if (!f.block.content) return [];
                var nodes = [f.block.content];
                var node = f.block.content;
                for (var ri = 0; ri < rel.length - 1; ri++) {
                    if (node == null || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, rel[ri])) return [];
                    node = node[rel[ri]];
                    nodes.push(node);
                }
                var leafParent = nodes[nodes.length - 1];
                var leaf = rel[rel.length - 1];
                if (leafParent == null || !Object.prototype.hasOwnProperty.call(leafParent, leaf)) return [];
                ops.push({ kind: "unset", path: f.path.concat("content", rel) });
                // Чистим опустевшую ветку вверх до content включительно.
                for (var rd = rel.length - 1; rd >= 0; rd--) {
                    var parent = nodes[rd];
                    if (!parent || Object.keys(parent).length !== 1) break;
                    var branchPath = rd === 0
                        ? f.path.concat("content")
                        : f.path.concat("content", rel.slice(0, rd));
                    ops.push({ kind: "unset", path: branchPath });
                }
                return ops;
            }
            var cursor = f.block.content;
            if (!cursor) {
                cursor = {};
                ops.push({ kind: "set", path: f.path.concat("content"), value: cursor });
            }
            var base = f.path.concat("content");
            for (var i = 0; i < rel.length - 1; i++) {
                var key = rel[i];
                if (cursor[key] == null || typeof cursor[key] !== "object") {
                    var child = (typeof rel[i + 1] === "number") ? [] : {};
                    ops.push({ kind: "set", path: base.concat(rel.slice(0, i + 1)), value: child });
                    cursor = child;
                } else cursor = cursor[key];
            }
            ops.push({ kind: "set", path: base.concat(rel), value: c.value });
            return ops;
        },
        // Стиль блока на брейкпоинте: block.styles[bp][prop] = value (создаёт бакеты при отсутствии).
        setStyle: function (doc, c) {
            var f = findPath(doc, c.id);
            if (!f) return [];
            var bp = c.breakpoint || "base";
            var ops = [];
            if (c.remove || c.value === "" || c.value == null) {
                if (!f.block.styles || !f.block.styles[bp] || !Object.prototype.hasOwnProperty.call(f.block.styles[bp], c.prop)) return [];
                ops.push({ kind: "unset", path: f.path.concat("styles", bp, c.prop) });
                if (Object.keys(f.block.styles[bp]).length === 1) {
                    ops.push({ kind: "unset", path: f.path.concat("styles", bp) });
                    if (Object.keys(f.block.styles).length === 1) ops.push({ kind: "unset", path: f.path.concat("styles") });
                }
                return ops;
            }
            if (!f.block.styles) ops.push({ kind: "set", path: f.path.concat("styles"), value: {} });
            if (!f.block.styles || !f.block.styles[bp]) ops.push({ kind: "set", path: f.path.concat("styles", bp), value: {} });
            ops.push({ kind: "set", path: f.path.concat("styles", bp, c.prop), value: c.value });
            return ops;
        },
        // Вставка блока: в children указанного родителя или в конец страницы pageIndex.
        insertBlock: function (doc, c) {
            if (c.parentId) {
                var pf = findPath(doc, c.parentId);
                if (!pf) return [];
                if (!pf.block.children) return [{ kind: "set", path: pf.path.concat("children"), value: [c.block] }];
                var idxC = (c.index != null) ? c.index : pf.block.children.length;
                return [{ kind: "insert", path: pf.path.concat("children"), index: idxC, value: c.block }];
            }
            var parentPath = ["pages", c.pageIndex || 0, "blocks"];
            var arr = getAt(doc, parentPath) || [];
            var idx = (c.index != null) ? c.index : arr.length;
            return [{ kind: "insert", path: parentPath, index: idx, value: c.block }];
        },
        // Удаление блока по id.
        removeBlock: function (doc, c) {
            var f = findPath(doc, c.id);
            if (!f) return [];
            return [{ kind: "remove", path: f.parentPath, index: f.index }];
        },
        // Перестановка блока внутри его родителя: remove + insert одной записью истории.
        // toIndex — ИТОГОВЫЙ индекс блока в массиве после перестановки.
        reorderBlock: function (doc, c) {
            var f = findPath(doc, c.id);
            if (!f || c.toIndex === f.index) return [];
            return [
                { kind: "remove", path: f.parentPath, index: f.index },
                { kind: "insert", path: f.parentPath, index: c.toIndex, value: f.block }
            ];
        },
        // Перенос между страницей/контейнерами. Destination path корректируется с учётом удаления
        // source до вставки — поэтому undo/redo остаются валидными даже для более позднего sibling.
        moveBlock: function (doc, c) {
            var f = findPath(doc, c.id);
            if (!f) return [];
            var destPath, destArr;
            if (c.parentId) {
                var pf = findPath(doc, c.parentId);
                if (!pf || startsWithPath(pf.path, f.path)) return []; // self/descendant → цикл
                destPath = pf.path.concat("children");
                destArr = pf.block.children;
            } else {
                destPath = ["pages", c.pageIndex || 0, "blocks"];
                destArr = getAt(doc, destPath);
            }
            if (!destArr && !c.parentId) return [];
            if (samePath(destPath, f.parentPath)) {
                return COMMANDS.reorderBlock(doc, { id: c.id, toIndex: c.toIndex });
            }

            var adjustedDestPath = pathAfterRemove(destPath, f.parentPath, f.index);
            var idx = c.toIndex == null ? (destArr ? destArr.length : 0) : c.toIndex;
            idx = Math.max(0, Math.min(idx, destArr ? destArr.length : 0));
            var insertOp = destArr
                ? { kind: "insert", path: adjustedDestPath, index: idx, value: f.block }
                : { kind: "set", path: adjustedDestPath, value: [f.block] };
            return [
                { kind: "remove", path: f.parentPath, index: f.index },
                insertOp
            ];
        }
    };

    function createStore(doc) {
        var state = doc || { version: 1, pages: [], components: {}, theme: { classes: [] } };
        var undoStack = [];
        var redoStack = [];
        var txn = null;

        function applyInOrder(ops) {
            var inv = [];
            for (var i = 0; i < ops.length; i++) inv.push(applyOp(state, ops[i]));
            return inv; // обратные операции в ПРЯМОМ порядке применения
        }
        function pushUndo(entry) {
            undoStack.push(entry);
            if (undoStack.length > HIST_MAX) undoStack.shift();
        }
        // Применить набор forward-операций как одну запись истории (или дописать в транзакцию).
        function run(ops, label) {
            var inv = applyInOrder(ops);
            if (txn) {
                for (var i = 0; i < inv.length; i++) txn.inv.push(inv[i]);
            } else if (inv.length) {
                pushUndo({ kind: "ops", label: label, ops: inv.slice().reverse() }); // undo = обратные в обратном порядке
                redoStack.length = 0;
            }
            return inv;
        }

        return {
            getDoc: function () { return state; },
            canUndo: function () { return undoStack.length > 0; },
            canRedo: function () { return redoStack.length > 0; },
            depth: function () { return { undo: undoStack.length, redo: redoStack.length }; },

            // Выполнить команду по имени. c — дескриптор { id, ... }. false — команда no-op.
            dispatch: function (type, c) {
                var build = COMMANDS[type];
                if (!build) throw new Error("Unknown command: " + type);
                var ops = build(state, c || {});
                if (!ops || !ops.length) return false;
                run(ops, (c && c.label) || type);
                return true;
            },

            // Транзакция: несколько dispatch → одна запись undo (драг/составные правки).
            begin: function (label) { txn = { label: label || "txn", inv: [] }; },
            commit: function (label) {
                if (!txn) return;
                if (txn.inv.length) {
                    pushUndo({ kind: "ops", label: label || txn.label, ops: txn.inv.slice().reverse() });
                    redoStack.length = 0;
                }
                txn = null;
            },

            // Снимок-чекпоинт (мост на время strangler'а): запись истории, хранящая JSON документа
            // до/после изменения. Позволяет вести единый стек истории, пока часть мутаций ещё не
            // переведена в точечные команды. before/after — строки JSON. Совпадение → no-op.
            recordState: function (before, after, label) {
                if (txn || before === after) return false;
                pushUndo({ kind: "state", label: label || "edit", before: before, after: after });
                redoStack.length = 0;
                return true;
            },
            // Откат незакоммиченной транзакции (например, Esc во время драга).
            cancel: function () {
                if (!txn) return;
                for (var i = txn.inv.length - 1; i >= 0; i--) applyOp(state, txn.inv[i]);
                txn = null;
            },

            undo: function () {
                if (txn || !undoStack.length) return false;
                var e = undoStack.pop();
                if (e.kind === "state") { state = JSON.parse(e.before); redoStack.push(e); return true; }
                var inv = applyInOrder(e.ops);
                redoStack.push({ kind: "ops", label: e.label, ops: inv.slice().reverse() });
                return true;
            },
            redo: function () {
                if (txn || !redoStack.length) return false;
                var e = redoStack.pop();
                if (e.kind === "state") { state = JSON.parse(e.after); undoStack.push(e); return true; }
                var inv = applyInOrder(e.ops);
                undoStack.push({ kind: "ops", label: e.label, ops: inv.slice().reverse() });
                return true;
            }
        };
    }

    return {
        createStore: createStore,
        findPath: findPath,
        COMMANDS: COMMANDS,
        _applyOp: applyOp // экспонируем для тестов
    };
});
