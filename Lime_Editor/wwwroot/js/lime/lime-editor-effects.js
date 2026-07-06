/* Lime editor effects, motion and decorative layer inspector/actions. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorEffects = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var L = options.L || { isContainer: function () { return false; } };
        var ws = options.ws || null;
        var getSelectedId = options.getSelectedId || function () { return null; };
        var getCmdStore = options.getCmdStore || function () { return null; };
        var byId = options.byId || function () { return null; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        var clone = options.clone || function (v) { return JSON.parse(JSON.stringify(v)); };
        var rid = options.rid || function (prefix) { return (prefix || "id") + Math.random().toString(36).slice(2); };
        var sec = options.sec || function (title, body) { return "<div>" + title + body + "</div>"; };
        var setBlockValue = options.setBlockValue || function () {};
        var commandBlockGesture = options.commandBlockGesture || function () { return false; };
        var runCommands = options.runCommands || function () { return false; };
        var openMediaPicker = options.openMediaPicker || function () {};
        var scheduleAutosave = options.scheduleAutosave || function () {};
        var markDirty = options.markDirty || function () {};
        var refreshInspector = options.refreshInspector || function () {};
        var render = options.render || function () {};

        function selectedId() {
            return getSelectedId();
        }

        function selectedSource() {
            return byId(selectedId());
        }

        // Milestone 3 (experience-builder-plan.md): человеческие пресеты вместо голых чисел.
        // Пресет-сег снаппится к БЛИЖАЙШЕМУ значению — если в документе уже лежит нестандартное
        // число (старые шаблоны/neo-lore-drop), кнопка подсвечивается по ближайшему, ничего не
        // ломается, просто визуально округляется до ярлыка.
        var PARALLAX_PRESETS = [{ v: 0, l: "Нет" }, { v: 0.15, l: "Лёгкий" }, { v: 0.35, l: "Средний" }, { v: 0.6, l: "Сильный" }];
        var SCENE_LEN_PRESETS = [{ v: 1, l: "Коротко" }, { v: 2, l: "Средне" }, { v: 3, l: "Длинно" }, { v: 4, l: "Оч. длинно" }];
        var MARQUEE_SPEED_PRESETS = [{ v: 60, l: "Медленно" }, { v: 40, l: "Обычно" }, { v: 20, l: "Быстро" }];

        function closestPreset(value, presets) {
            var n = parseFloat(value);
            if (isNaN(n)) n = 0;
            var best = presets[0].v, bestDiff = Infinity;
            presets.forEach(function (p) {
                var diff = Math.abs(p.v - n);
                if (diff < bestDiff) { bestDiff = diff; best = p.v; }
            });
            return best;
        }
        function presetSeg(presets, cur, dataAttr) {
            return '<div class="lime-segmented">' + presets.map(function (p) {
                return '<button type="button" class="' + (p.v === cur ? "is-active" : "") + '" data-' + dataAttr + '="' + p.v + '">' + p.l + '</button>';
            }).join("") + '</div>';
        }

        function animRng(prop, min, max, step, cur) {
            var n = parseFloat(cur); if (isNaN(n)) n = min;
            return '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-anim="' + prop + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"><span class="lime-range__val">' + (cur != null && cur !== "" ? cur : "—") + '</span></div>';
        }

        function animInspector(t) {
            var curAnim = (t && t.anim) || "";
            var presets = [
                { v: "", l: "—", t: "Без анимации" }, { v: "fade-up", l: "↑", t: "Появление снизу" },
                { v: "fade-in", l: "◍", t: "Проявление" }, { v: "zoom", l: "⊕", t: "Зум" },
                { v: "slide-left", l: "←", t: "Выезд слева" }, { v: "slide-right", l: "→", t: "Выезд справа" }
            ];
            var presetSeg = '<div class="lime-segmented">' + presets.map(function (o) {
                return '<button type="button" class="' + (curAnim === o.v ? "is-active" : "") + '" data-doc-anim="anim" data-val="' + o.v + '" title="' + o.t + '">' + o.l + '</button>';
            }).join("") + '</div>';
            var extra = curAnim
                ? '<div class="lime-inspector__hint" style="margin:6px 0 2px;">Задержка, мс</div>' + animRng("animDelay", 0, 1000, 50, t.animDelay) +
                  '<div class="lime-inspector__hint" style="margin:6px 0 2px;">Длительность, с</div>' + animRng("animDuration", 0.2, 2, 0.1, t.animDuration)
                : "";
            return sec("Анимация появления", presetSeg + extra);
        }

        function motionInspector(t) {
            var curParallax = closestPreset(t.parallax || 0, PARALLAX_PRESETS);
            var rows = '<div class="lime-inspector__hint" style="margin:2px 0;">Параллакс (глубина)</div>' +
                presetSeg(PARALLAX_PRESETS, curParallax, "doc-parallax-preset") +
                '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Залипание (sticky)</div>' +
                '<div class="lime-segmented">' +
                '<button type="button" class="' + (!t.sticky ? "is-active" : "") + '" data-doc-sticky="0">Нет</button>' +
                '<button type="button" class="' + (t.sticky ? "is-active" : "") + '" data-doc-sticky="1">Sticky</button></div>';
            if (L.isContainer(t.type)) {
                var mq = t.marquee;
                rows += '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Бегущая строка (для содержимого)</div>' +
                    '<div class="lime-segmented">' +
                    '<button type="button" class="' + (!mq ? "is-active" : "") + '" data-doc-marquee="off">Нет</button>' +
                    '<button type="button" class="' + (mq && !mq.reverse ? "is-active" : "") + '" data-doc-marquee="ltr">→</button>' +
                    '<button type="button" class="' + (mq && mq.reverse ? "is-active" : "") + '" data-doc-marquee="rtl">←</button></div>';
                if (mq) {
                    rows += '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Скорость ленты</div>' +
                        presetSeg(MARQUEE_SPEED_PRESETS, closestPreset(mq.speed || 40, MARQUEE_SPEED_PRESETS), "doc-marquee-speed");
                }
            }
            return sec("Движение", rows);
        }

        function sceneInspector(t) {
            if (!L.isContainer(t.type)) return "";
            var mode = (t.scene && t.scene.mode) || "";
            var modes = [["", "Нет"], ["horizontal", "Горизонт."], ["steps", "Шаги"], ["pin", "Пин"]];
            var seg = '<div class="lime-segmented">' + modes.map(function (o) {
                return '<button type="button" class="' + (mode === o[0] ? "is-active" : "") + '" data-doc-scene="' + o[0] + '">' + o[1] + '</button>';
            }).join("") + '</div>';
            var len = (t.scene && t.scene.length) || 2;
            var extra = mode
                ? '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Длина, экранов</div>' +
                  presetSeg(SCENE_LEN_PRESETS, closestPreset(len, SCENE_LEN_PRESETS), "doc-scene-len-preset") +
                  '<div class="lime-inspector__hint" style="margin:6px 0;">Эффект виден на опубликованной странице.</div>'
                : "";
            return sec("Сцена (scroll)", seg + extra);
        }

        // Milestone 3: готовые рецепты сцен — один клик применяет пачку motion-настроек на уже
        // ВЫБРАННЫЙ блок (в отличие от LimePresets/Experience Packs, которые вставляют новую
        // секцию). Значения horizontal-cards совпадают с тем, что руками применили к neo-factions
        // в спайке Milestone 0 — не догадка, а проверенная комбинация.
        var RECIPES = [
            {
                key: "pinned-hero", name: "Закреплённый герой", desc: "Секция держится на экране, контент проявляется", containerOnly: true,
                apply: function () { return { scene: { mode: "pin", length: 2 }, anim: "fade-up", animDuration: 1.2 }; }
            },
            {
                key: "horizontal-cards", name: "Горизонтальные карточки", desc: "Карточки едут вбок при скролле", containerOnly: true,
                apply: function () { return { scene: { mode: "horizontal", length: 3 } }; }
            },
            {
                key: "layered-parallax", name: "Слоистый параллакс", desc: "Параллакс секции + декоративные слои на разной глубине", containerOnly: false,
                apply: function (b) {
                    return {
                        parallax: 0.3,
                        layers: (b.layers || []).concat([
                            { id: rid("l"), kind: "shape", shape: "blob", color: "#a78bfa", x: 12, y: 20, w: 220, z: 0, depth: 0.15, blur: 20, opacity: 0.7 },
                            { id: rid("l"), kind: "shape", shape: "circle", color: "#38bdf8", x: 78, y: 65, w: 160, z: 0, depth: 0.35, blur: 12, opacity: 0.6 }
                        ])
                    };
                }
            },
            {
                key: "marquee-strip", name: "Бегущая строка", desc: "Содержимое едет непрерывной лентой", containerOnly: true,
                apply: function () { return { marquee: { speed: 30, reverse: false } }; }
            },
            {
                key: "reveal-sequence", name: "Последовательное появление", desc: "Дети секции проявляются по очереди", containerOnly: true,
                applyChildren: function (children) {
                    return children.map(function (c, i) { return { id: c.id, anim: "fade-up", animDelay: i * 120, animDuration: 0.6 }; });
                }
            }
        ];

        function recipesInspector(t) {
            var isContainer = L.isContainer(t.type);
            var applicable = RECIPES.filter(function (r) { return !r.containerOnly || isContainer; });
            if (!applicable.length) return "";
            var tiles = applicable.map(function (r) {
                return '<button type="button" class="lime-recipe-tile" data-doc-recipe="' + r.key + '">' +
                    '<span class="lime-recipe-tile__name">' + r.name + '</span>' +
                    '<span class="lime-recipe-tile__desc">' + r.desc + '</span></button>';
            }).join("");
            return sec("Рецепты сцен", tiles);
        }

        function findChild(b, id) {
            var kids = (b && b.children) || [];
            for (var i = 0; i < kids.length; i++) if (kids[i].id === id) return kids[i];
            return null;
        }

        function applyRecipe(key) {
            var recipe = null;
            for (var i = 0; i < RECIPES.length; i++) if (RECIPES[i].key === key) { recipe = RECIPES[i]; break; }
            if (!recipe) return;
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b) return;
            var patch = recipe.apply ? recipe.apply(b) : {};
            var items = Object.keys(patch).map(function (prop) {
                return { type: "setBlockProp", payload: { id: source.id, prop: prop, value: patch[prop] } };
            });
            if (recipe.applyChildren && b.children && b.children.length) {
                recipe.applyChildren(b.children).forEach(function (childPatch) {
                    ["anim", "animDelay", "animDuration"].forEach(function (p) {
                        if (childPatch[p] !== undefined) items.push({ type: "setBlockProp", payload: { id: childPatch.id, prop: p, value: childPatch[p] } });
                    });
                });
            }
            if (!items.length) return;
            var cmdStore = getCmdStore();
            if (cmdStore) {
                // runCommands обновляет только модель doc — в отличие от setBlockValue/setAnim,
                // сама не патчит холст (нет единого DOM-атрибута на все возможные prop сразу для
                // пачки из N разных block-id) — поэтому после батча зовём полный render().
                var changed = runCommands(items, "recipe:" + key);
                if (changed) scheduleAutosave();
            } else {
                items.forEach(function (it) {
                    var tgt = it.payload.id === source.id ? b : findChild(b, it.payload.id);
                    if (tgt) tgt[it.payload.prop] = it.payload.value;
                });
                markDirty();
            }
            render();
            refreshInspector();
        }

        function layerRng(prop, i, min, max, step, cur, label) {
            var n = parseFloat(cur); if (isNaN(n)) n = min;
            return '<div class="lime-inspector__hint" style="margin:4px 0 0;">' + label + '</div>' +
                '<div class="lime-range-row"><input type="range" class="lime-range" data-doc-layer-rng="' + prop + '" data-i="' + i + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + n + '"><span class="lime-range__val">' + (cur != null && cur !== "" ? cur : n) + '</span></div>';
        }

        function layersInspector(t) {
            var ls = t.layers || [];
            var list = ls.map(function (l, i) {
                var isImg = l.kind === "image";
                var head = '<div class="lime-flex" style="justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                    '<b style="font-size:var(--text-xs);">Слой ' + (i + 1) + ' · ' + (isImg ? "картинка" : "фигура") + '</b>' +
                    '<button type="button" class="lime-block-toolbar__btn lime-block-toolbar__btn--danger" data-doc-layer-del="' + i + '" title="Удалить">✕</button></div>';
                var body = isImg
                    ? '<button type="button" class="lime-btn lime-btn--soft lime-btn--sm" data-doc-layer-pick="' + i + '" style="width:100%;">' + (l.src ? "Заменить картинку" : "Выбрать картинку") + '</button>'
                    : '<div class="lime-segmented">' + ["circle", "blob", "square"].map(function (sh) {
                        return '<button type="button" class="' + ((l.shape || "circle") === sh ? "is-active" : "") + '" data-doc-layer-shape="' + i + '" data-shape="' + sh + '">' + (sh === "circle" ? "●" : sh === "blob" ? "⬭" : "■") + '</button>';
                    }).join("") + '</div><div class="lime-color-row" style="margin-top:4px;"><input type="color" class="lime-color-input" data-doc-layer-color="' + i + '" value="' + toHex(l.color || "#a78bfa") + '"></div>';
                body += layerRng("w", i, 20, 600, 5, l.w, "Размер, px") +
                    layerRng("z", i, -1, 3, 1, (l.z != null ? l.z : 0), "Слой (z): −1 за контентом, 2 поверх") +
                    layerRng("depth", i, 0, 0.8, 0.05, l.depth, "Параллакс") +
                    layerRng("blur", i, 0, 40, 1, l.blur, "Блюр") +
                    layerRng("opacity", i, 0.1, 1, 0.05, (l.opacity != null ? l.opacity : 1), "Прозрачность");
                return '<div class="lime-layer-card">' + head + body + '</div>';
            }).join("");
            var add = '<div class="lime-flex lime-gap-2" style="margin-top:6px;">' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-layer-add="shape" style="flex:1;">＋ Фигура</button>' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-doc-layer-add="image" style="flex:1;">＋ Картинка</button></div>';
            var hint = ls.length ? '<div class="lime-inspector__hint" style="margin:2px 0 6px;">Перетаскивай слои прямо на холсте.</div>' : "";
            return sec("Декор-слои", hint + list + add);
        }

        function fxInspector(t) {
            var fx = t.fx || [];
            var FX = [["glass", "Стекло"], ["glow", "Свечение"], ["neon-border", "Неон-рамка"], ["gradient-text", "Градиент-текст"], ["tilt", "Наклон"]];
            var chips = '<div class="lime-segmented lime-segmented--wrap">' + FX.map(function (o) {
                return '<button type="button" class="' + (fx.indexOf(o[0]) >= 0 ? "is-active" : "") + '" data-doc-fx="' + o[0] + '">' + o[1] + '</button>';
            }).join("") + '</div>';
            var width = (t.content && t.content.width) || "full";
            var widthSeg = '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Ширина контента</div>' +
                '<div class="lime-segmented">' +
                '<button type="button" class="' + (width !== "boxed" ? "is-active" : "") + '" data-doc-width="full">Во всю</button>' +
                '<button type="button" class="' + (width === "boxed" ? "is-active" : "") + '" data-doc-width="boxed">В колонку</button></div>';
            var bento = "";
            if (L.isContainer(t.type)) {
                var isBento = t.content && t.content.layout === "bento";
                bento = '<div class="lime-inspector__hint" style="margin:8px 0 2px;">Сетка содержимого</div>' +
                    '<div class="lime-segmented">' +
                    '<button type="button" class="' + (!isBento ? "is-active" : "") + '" data-doc-bento="off">Обычная</button>' +
                    '<button type="button" class="' + (isBento ? "is-active" : "") + '" data-doc-bento="on">Bento</button></div>';
            }
            return sec("Эффекты и макет", chips + widthSeg + bento);
        }

        function setSceneMode(mode) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b) return;
            var next = mode ? { mode: mode, length: (b.scene && b.scene.length) || 2 } : null;
            setBlockValue(source, "scene", next, !mode);
        }

        function toggleFx(key) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b) return;
            var next = clone(b.fx || []);
            var i = next.indexOf(key);
            if (i >= 0) next.splice(i, 1); else next.push(key);
            setBlockValue(source, "fx", next, !next.length);
        }

        function setSticky(enabled) {
            var source = selectedSource();
            if (source) setBlockValue(source, "sticky", true, !enabled);
        }

        function setMarquee(mode) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (b) setBlockValue(source, "marquee", { speed: 40, reverse: mode === "rtl" }, mode === "off");
        }

        function setMarqueeSpeed(value) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b || !b.marquee) return;
            var next = clone(b.marquee);
            next.speed = parseInt(value, 10);
            setBlockValue(source, "marquee", next, false);
        }

        function setMotionParallax(value) {
            var id = selectedId();
            var source = byId(id);
            var b = targetBlock(source);
            if (!b) return;
            var remove = parseFloat(value) === 0;
            var commanded = commandBlockGesture(source, "parallax", value, remove, "parallax");
            if (!commanded) {
                if (remove) delete b.parallax;
                else b.parallax = value;
            }
            var el = ws && ws.querySelector('[data-block-id="' + id + '"]');
            if (el) {
                if (remove) el.removeAttribute("data-parallax");
                else el.setAttribute("data-parallax", value);
            }
            if (!commanded) markDirty();
        }

        function setSceneLength(value) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (b && b.scene) {
                var nextScene = clone(b.scene);
                nextScene.length = parseInt(value, 10);
                var commanded = commandBlockGesture(source, "scene", nextScene, false, "scene:length");
                if (!commanded) b.scene.length = nextScene.length;
                if (!commanded) markDirty();
            }
        }

        function addLayer(kind) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b) return;
            var layers = clone(b.layers || []);
            var layer = { id: rid("l"), kind: kind, x: 40, y: 28, w: kind === "image" ? 160 : 120, z: 0, depth: 0.2, opacity: 1 };
            if (kind === "shape") { layer.shape = "blob"; layer.color = "#a78bfa"; }
            layers.push(layer);
            setBlockValue(source, "layers", layers, false);
            if (kind === "image") openMediaPicker(selectedId(), "layers." + (layers.length - 1) + ".src", "blockpath");
        }

        function delLayer(index) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b) return;
            var layers = clone(b.layers || []);
            layers.splice(index, 1);
            setBlockValue(source, "layers", layers, !layers.length);
        }

        function applyLayerStyle(index) {
            var id = selectedId();
            var b = targetBlock(byId(id));
            if (!b || !b.layers || !b.layers[index]) return;
            var layer = b.layers[index];
            var blockEl = ws && ws.querySelector('[data-block-id="' + id + '"]');
            if (!blockEl) return;
            var layerEl = blockEl.querySelector('[data-layer-id="' + layer.id + '"]');
            if (!layerEl) { render(); return; }
            layerEl.style.left = (layer.x || 0) + "%";
            layerEl.style.top = (layer.y || 0) + "%";
            layerEl.style.width = (layer.w || 120) + "px";
            layerEl.style.zIndex = (layer.z != null ? layer.z : 0);
            layerEl.style.opacity = (layer.opacity != null ? layer.opacity : 1);
            layerEl.style.filter = layer.blur ? "blur(" + layer.blur + "px)" : "";
            if (layer.depth) layerEl.setAttribute("data-parallax", layer.depth);
            else layerEl.removeAttribute("data-parallax");
            if (layer.kind !== "image") layerEl.style.background = layer.color || "#a78bfa";
        }

        function setLayerRng(index, prop, value) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b || !b.layers || !b.layers[index]) return;
            var layers = clone(b.layers);
            layers[index][prop] = value;
            if (commandBlockGesture(source, "layers", layers, false, "layers:" + index + ":" + prop)) {
                applyLayerStyle(index);
                return;
            }
            b.layers[index][prop] = value;
            applyLayerStyle(index);
            markDirty();
        }

        function setLayerShape(index, shape) {
            var source = selectedSource();
            var b = targetBlock(source);
            if (!b || !b.layers || !b.layers[index]) return;
            var layers = clone(b.layers);
            layers[index].shape = shape;
            setBlockValue(source, "layers", layers, false);
        }

        function pickLayerImage(index) {
            openMediaPicker(selectedId(), "layers." + index + ".src", "blockpath");
        }

        var dragLayer = null;
        function onLayerDown(e) {
            var layerEl = e.currentTarget;
            var blockEl = layerEl.closest(".lime-block");
            if (!blockEl) return;
            var source = byId(blockEl.getAttribute("data-block-id"));
            if (!source) return;
            var target = targetBlock(source);
            var layerId = layerEl.getAttribute("data-layer-id");
            var index = -1;
            for (var i = 0; i < (target.layers || []).length; i++) if (target.layers[i].id === layerId) { index = i; break; }
            if (index < 0) return;
            e.preventDefault(); e.stopPropagation();
            var layer = target.layers[index];
            dragLayer = {
                lyr: layerEl, sec: blockEl, source: source, target: target, index: index,
                startCx: e.clientX, startCy: e.clientY,
                startX: layer.x || 0, startY: layer.y || 0, x: layer.x || 0, y: layer.y || 0
            };
            try { layerEl.setPointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            layerEl.addEventListener("pointermove", onLayerMove);
            layerEl.addEventListener("pointerup", onLayerUp);
        }

        function onLayerMove(e) {
            if (!dragLayer) return;
            var r = dragLayer.sec.getBoundingClientRect();
            var dx = ((e.clientX - dragLayer.startCx) / r.width) * 100;
            var dy = ((e.clientY - dragLayer.startCy) / r.height) * 100;
            dragLayer.x = Math.max(0, Math.min(100, Math.round(dragLayer.startX + dx)));
            dragLayer.y = Math.max(0, Math.min(100, Math.round(dragLayer.startY + dy)));
            dragLayer.lyr.style.left = dragLayer.x + "%";
            dragLayer.lyr.style.top = dragLayer.y + "%";
        }

        function onLayerUp(e) {
            if (!dragLayer) return;
            var gesture = dragLayer;
            var layerEl = gesture.lyr;
            layerEl.removeEventListener("pointermove", onLayerMove);
            layerEl.removeEventListener("pointerup", onLayerUp);
            try { layerEl.releasePointerCapture(e.pointerId); } catch (_) { /* no-op */ }
            dragLayer = null;
            if (gesture.x === gesture.startX && gesture.y === gesture.startY) return;
            var layers = clone(gesture.target.layers || []);
            if (!layers[gesture.index]) return;
            layers[gesture.index].x = gesture.x;
            layers[gesture.index].y = gesture.y;
            setBlockValue(gesture.source, "layers", layers, false);
        }

        function initLayerDrag() {
            if (!ws) return;
            var layers = ws.querySelectorAll(".lime-block__layer[data-layer-id]");
            Array.prototype.forEach.call(layers, function (layerEl) {
                layerEl.addEventListener("pointerdown", onLayerDown);
            });
        }

        function animAttr(prop) {
            return prop === "anim" ? "data-anim" : prop === "animDelay" ? "data-anim-delay" : "data-anim-duration";
        }

        function setAnim(prop, value, reflectInspector) {
            var id = selectedId();
            var source = byId(id);
            var b = targetBlock(source);
            if (!b) return;
            var remove = value === "" || value == null;
            var commanded;
            var cmdStore = getCmdStore();
            if (cmdStore && b === source && prop === "anim" && remove) {
                var cleared = runCommands([
                    { type: "setBlockProp", payload: { id: source.id, prop: "anim", remove: true } },
                    { type: "setBlockProp", payload: { id: source.id, prop: "animDelay", remove: true } },
                    { type: "setBlockProp", payload: { id: source.id, prop: "animDuration", remove: true } }
                ], "clear-animation");
                if (cleared) scheduleAutosave();
                commanded = true;
            } else commanded = commandBlockGesture(source, prop, value, remove, prop);
            if (!commanded) {
                if (remove) delete b[prop];
                else b[prop] = value;
            }
            var el = ws && ws.querySelector('[data-block-id="' + id + '"]');
            if (el) {
                var attr = animAttr(prop);
                if (value === "" || value == null) el.removeAttribute(attr);
                else el.setAttribute(attr, value);
                if (prop === "anim" && (value === "" || value == null)) {
                    el.removeAttribute("data-anim-delay"); el.removeAttribute("data-anim-duration");
                    if (!(cmdStore && b === source)) { delete b.animDelay; delete b.animDuration; }
                }
            }
            if (reflectInspector) refreshInspector();
            if (!commanded) markDirty();
        }

        function toHex(value) {
            if (!value) return "#000000";
            if (value[0] === "#") return value;
            var m = String(value).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return "#000000";
            var h = function (n) { var x = parseInt(n, 10).toString(16); return x.length < 2 ? "0" + x : x; };
            return "#" + h(m[1]) + h(m[2]) + h(m[3]);
        }

        return {
            addLayer: addLayer,
            animInspector: animInspector,
            applyRecipe: applyRecipe,
            delLayer: delLayer,
            fxInspector: fxInspector,
            initLayerDrag: initLayerDrag,
            layersInspector: layersInspector,
            motionInspector: motionInspector,
            pickLayerImage: pickLayerImage,
            recipesInspector: recipesInspector,
            sceneInspector: sceneInspector,
            setAnim: setAnim,
            setLayerRng: setLayerRng,
            setLayerShape: setLayerShape,
            setMarquee: setMarquee,
            setMarqueeSpeed: setMarqueeSpeed,
            setMotionParallax: setMotionParallax,
            setSceneLength: setSceneLength,
            setSceneMode: setSceneMode,
            setSticky: setSticky,
            toggleFx: toggleFx
        };
    }

    return { create: create };
});
