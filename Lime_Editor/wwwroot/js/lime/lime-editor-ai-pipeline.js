/* Lime editor AI command pipeline (этап 10.1: безопасное применение списка команд от LLM). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorAiPipeline = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // AI отдаёт список команд → валидируем (allowlist/лимит/форма) → dry-run на клоне для preview →
    // показываем, что изменится, и применяем ОДНОЙ undo-транзакцией только по подтверждению.
    // Инвариант: невалидный или неподтверждённый ответ не трогает сохранённый документ.
    // Изменяемое состояние (cmdStore/selectedId) инжектится геттерами. leStatus остаётся в основном
    // файле (его делит секция генерации) и прокидывается сюда.
    function create(options) {
        options = options || {};
        var document = options.document || (typeof window !== "undefined" ? window.document : null);
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var ws = options.ws;
        var doc = options.doc;
        var L = options.L || { isContainer: function () { return false; } };
        var getCmdStore = options.getCmdStore || function () { return null; };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var reid = options.reid || function () {};
        var escapeText = options.escapeText || function (s) { return s; };
        var runCommands = options.runCommands || function () {};
        var render = options.render || function () {};
        var scheduleAutosave = options.scheduleAutosave || function () {};
        var byId = options.byId || function () { return null; };
        var blockLabel = options.blockLabel || function () { return ""; };
        var findBlock = options.findBlock || function () { return null; };
        var targetBlock = options.targetBlock || function (b) { return b; };
        var csrfToken = options.csrfToken || function () { return ""; };
        var leStatus = options.leStatus || function () {};
        var switchBreakpoint = options.switchBreakpoint || function () {};

        // Milestone 5, Фаза A (experience-builder-plan.md): «заполнить секции пака текстом».
        // Служебные строковые поля (layout/config/URL) не текст для бренда — не отдаём их AI на
        // переписывание, иначе рискуем сломать embed/CMS-привязку/раскладку. Массивы объектов
        // (testimonials.items, faq.items, navbar.links) разворачиваем в плоские пути "items.0.quote" —
        // fieldPath в lime-commands.js уже умеет писать по таким путям (числовой сегмент → индекс).
        var AI_NON_PROSE_FIELDS = {
            width: 1, layout: 1, bgMode: 1, provider: 1, aspect: 1, collection: 1,
            sortField: 1, sortDir: 1, filterField: 1, filterValue: 1,
            imageField: 1, titleField: 1, descField: 1, youtubeId: 1, videoSrc: 1,
            src: 1, poster: 1, embedUrl: 1, autoplay: 1, alt: 1
        };
        function aiLooksLikeUrl(s) { return /^(https?:)?\/\//i.test(s); }
        function collectTextBlocks(blocks, out) {
            out = out || [];
            (blocks || []).forEach(function (b) {
                var fields = {};
                if (b.content) {
                    Object.keys(b.content).forEach(function (k) {
                        if (k.indexOf("__") === 0 || AI_NON_PROSE_FIELDS[k]) return;
                        var v = b.content[k];
                        if (typeof v === "string" && v && !aiLooksLikeUrl(v)) {
                            fields[k] = v;
                        } else if (Array.isArray(v)) {
                            v.forEach(function (item, i) {
                                if (item && typeof item === "object") {
                                    Object.keys(item).forEach(function (sk) {
                                        if (typeof item[sk] === "string" && item[sk] && !aiLooksLikeUrl(item[sk])) {
                                            fields[k + "." + i + "." + sk] = item[sk];
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
                if (Object.keys(fields).length) out.push({ id: b.id, type: b.type, content: fields });
                if (b.children && b.children.length) collectTextBlocks(b.children, out);
            });
            return out;
        }

        // Milestone 5, Фаза B: контекст для AI-подбора темы/motion. fx/layers сознательно НЕ
        // собираем (и не документируем модели) — layers хранит массив декор-фигур, setBlockProp
        // заменяет его целиком, а слепая генерация LLM молча стёрла бы ручную расстановку.
        var MOTION_PROPS = ["anim", "animDelay", "animDuration", "parallax", "marquee", "scene", "sticky", "stickyOffset"];
        function collectMotionBlocks(blocks, out) {
            out = out || [];
            (blocks || []).forEach(function (b) {
                var entry = { id: b.id, type: b.type, container: !!L.isContainer(b.type) };
                MOTION_PROPS.forEach(function (p) { if (b[p] !== undefined) entry[p] = b[p]; });
                out.push(entry);
                if (b.children && b.children.length) collectMotionBlocks(b.children, out);
            });
            return out;
        }

        function aiContextTrunc(value, max) {
            var s = value == null ? "" : String(value);
            max = max || 100;
            return s.length > max ? s.slice(0, max) + "..." : s;
        }
        function pickResponsiveBuckets(src) {
            if (!src || typeof src !== "object") return undefined;
            var out = {};
            ["base", "tablet", "mobile"].forEach(function (bp) {
                if (src[bp] && typeof src[bp] === "object" && Object.keys(src[bp]).length) out[bp] = src[bp];
            });
            return Object.keys(out).length ? out : undefined;
        }
        function mobileContentHint(b) {
            var src = (b && b.content) || null;
            if (!src || typeof src !== "object") return undefined;
            var out = {};
            Object.keys(src).forEach(function (k) {
                var v = src[k];
                if (k === "__slot" && typeof v === "string" && v) { out.slot = v; return; }
                if (k.indexOf("__") === 0) return;
                if (typeof v === "string") {
                    if (!aiLooksLikeUrl(v)) out[k] = aiContextTrunc(v);
                } else if (Array.isArray(v)) {
                    out[k + "Count"] = v.length;
                    if (v.length && v[0] && typeof v[0] === "object") {
                        var sample = {};
                        Object.keys(v[0]).forEach(function (sk) {
                            if (typeof v[0][sk] === "string" && !aiLooksLikeUrl(v[0][sk])) sample[sk] = aiContextTrunc(v[0][sk], 60);
                        });
                        if (Object.keys(sample).length) out[k + "Sample"] = sample;
                    }
                }
            });
            return Object.keys(out).length ? out : undefined;
        }
        function collectMobileBlocks(blocks, out, parentId) {
            out = out || [];
            (blocks || []).forEach(function (b) {
                var entry = {
                    id: b.id,
                    type: b.type,
                    parentId: parentId || null,
                    container: !!L.isContainer(b.type),
                    children: b.children && b.children.length ? b.children.length : 0
                };
                var content = mobileContentHint(b);
                var styles = pickResponsiveBuckets(b.styles);
                var design = pickResponsiveBuckets(b.design);
                if (content) entry.content = content;
                if (styles) entry.styles = styles;
                if (design) entry.design = design;
                MOTION_PROPS.forEach(function (p) { if (b[p] !== undefined) entry[p] = b[p]; });
                if (b.css) entry.scopedCss = true;
                if (b.type === "embed" && b.content) {
                    entry.embed = {
                        provider: b.content.provider || "",
                        aspect: b.content.aspect || "",
                        slot: b.content.__slot || "",
                        hasPoster: !!b.content.poster
                    };
                }
                out.push(entry);
                if (b.children && b.children.length) collectMobileBlocks(b.children, out, b.id);
            });
            return out;
        }

        var aiPreviewBar = null;
        function clearAiHighlight() {
            var hi = ws.querySelectorAll(".lime-ai-affected");
            for (var i = 0; i < hi.length; i++) hi[i].classList.remove("lime-ai-affected");
        }
        function closeAiPreview() {
            clearAiHighlight();
            if (aiPreviewBar) { aiPreviewBar.remove(); aiPreviewBar = null; }
        }
        // rawList — массив { type, payload }. Возвращает строку-причину при отказе либо null при успехе.
        function applyAiCommands(rawList) {
            if (!getCmdStore() || !win.LimeCommands) return "no-cmd";
            // 100 — с запасом над 71 полем, реально собираемым в neo-lore-drop (Фаза A, замерено
            // scratch-скриптом при планировании), а не одно поле выбранного блока.
            var v = win.LimeCommands.validateAiCommands(rawList, { max: 100 });
            if (!v.ok) { leToastMsg("AI прислал некорректную правку — ничего не менял."); return v.reason; }
            // Новым секциям (insertBlock) выдаём свежие id — чтобы блок был уникален и выбираем
            // (этап 10.4). reid рекурсивно и для детей.
            v.commands.forEach(function (c) {
                if (c.type === "insertBlock" && c.payload && c.payload.block) reid(c.payload.block);
            });
            var dry = win.LimeCommands.dryRunAiCommands(doc, v.commands);
            if (!dry.applied) { leToastMsg("AI не нашёл, что изменить."); return "no-change"; }

            closeAiPreview();
            // Подсветка затронутых блоков — лёгкий preview-дифф без мутации документа.
            dry.affected.forEach(function (id) {
                var el = ws.querySelector('[data-block-id="' + id + '"]');
                if (el) el.classList.add("lime-ai-affected");
            });
            var changes = dry.appliedCommands.map(describeAiChange);
            var SHOWN = 6;
            var listHtml = '<ul class="lime-ai-preview__list" data-ai-list>' +
                changes.slice(0, SHOWN).map(function (ch) {
                    return '<li><span class="lime-ai-preview__where">' + escapeText(ch.where) + '</span> ' + escapeText(ch.what) + '</li>';
                }).join("") +
                (changes.length > SHOWN ? '<li class="lime-ai-preview__more">…и ещё ' + (changes.length - SHOWN) + '</li>' : '') +
                '</ul>';
            aiPreviewBar = document.createElement("div");
            aiPreviewBar.className = "lime-ai-preview";
            aiPreviewBar.setAttribute("data-doc-ai-preview", "");
            aiPreviewBar.setAttribute("role", "alertdialog");
            aiPreviewBar.setAttribute("aria-label", "Предпросмотр правки AI");
            var word = dry.applied === 1 ? "изменение" : (dry.applied < 5 ? "изменения" : "изменений");
            aiPreviewBar.innerHTML =
                '<div class="lime-ai-preview__head"><span class="lime-ai-preview__text">AI предлагает <b data-ai-count>' + dry.applied + '</b> ' + word +
                (v.rejected.length ? ' (' + v.rejected.length + ' отклонено)' : '') + '</span></div>' +
                listHtml +
                '<div class="lime-ai-preview__actions">' +
                    '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-ai-cancel>Отменить</button>' +
                    '<button type="button" class="lime-btn lime-btn--primary lime-btn--sm" data-ai-apply>Применить</button>' +
                '</div>';
            document.body.appendChild(aiPreviewBar);
            aiPreviewBar.querySelector("[data-ai-apply]").addEventListener("click", function () {
                // Применяем только реально изменяющие команды одной транзакцией → один undo. Документ
                // меняется только здесь, после явного подтверждения.
                runCommands(dry.appliedCommands, "ai-edit");
                closeAiPreview();
                render();
                scheduleAutosave();
                leToastMsg("Готово. Ctrl+Z отменит правку.");
            });
            aiPreviewBar.querySelector("[data-ai-cancel]").addEventListener("click", closeAiPreview);
            return null;
        }
        // Человекочитаемое описание одной команды для diff-списка preview: где (блок) и что меняется.
        function describeAiChange(c) {
            var p = c.payload || {};
            var b = (p.id && byId(p.id)) || (p.parentId && byId(p.parentId));
            var where = b ? blockLabel(b) : "страница";
            var what;
            if (c.type === "setContent") what = "текст «" + (p.field || "") + "» → «" + aiTrunc(p.value) + "»";
            else if (c.type === "setStyle") what = (p.prop || "стиль") + ": " + aiTrunc(p.value) + aiBpSuffix(p.breakpoint);
            else if (c.type === "setDesign") what = "раскладка: " + (p.field || "") + aiBpSuffix(p.breakpoint);
            else if (c.type === "setBlockProp") what = "свойство: " + (p.prop || "");
            else if (c.type === "setTheme") what = "тема: " + (p.key || "") + " → " + aiTrunc(p.value);
            else if (c.type === "insertBlock") what = "добавить блок" + (p.block && p.block.type ? " (" + p.block.type + ")" : "");
            else if (c.type === "removeBlock") what = "удалить блок";
            else what = "переместить";
            return { where: where, what: what };
        }
        function aiTrunc(v) {
            var s = v == null ? "" : String(v);
            return s.length > 40 ? s.slice(0, 40) + "…" : s;
        }
        function aiBpSuffix(bp) { return bp && bp !== "base" ? " (" + bp + ")" : ""; }
        function leToastMsg(text) {
            var t = document.getElementById("lime-doc-le-toast");
            if (!t) return;
            t.innerHTML = "<b>" + escapeText(text) + "</b>";
            t.classList.add("is-on");
            setTimeout(function () { t.classList.remove("is-on"); }, 3200);
        }
        // Правка выбранного блока по описанию через серверный LLM→команды (этап 10.2).
        // Контекст (поддерево + тема) уходит на /Ai/Suggest; ответ-команды идут в applyAiCommands
        // (валидация + preview + один undo). Живой LLM не тестируется e2e — каждое звено покрыто
        // отдельно (серверный парсер xUnit, applyAiCommands Playwright 10.1).
        function aiSuggest(blockId, opts) {
            opts = opts || {};
            if (!getCmdStore()) { alert("AI-правки доступны в режиме команд."); return; }
            var r = findBlock(blockId || getSelectedId());
            if (!r) { alert("Сначала выбери блок."); return; }
            var t = targetBlock(r.block);
            var ctx = JSON.stringify({
                theme: { accent: doc.theme && doc.theme.accent, bg: doc.theme && doc.theme.bg, fg: doc.theme && doc.theme.fg },
                block: { id: r.block.id, type: t.type, content: t.content, styles: t.styles, design: t.design, children: t.children }
            });
            if (ctx.length > 18000) { alert("Секция слишком большая для AI-правки за один раз. Выбери блок поменьше."); return; }
            var instruction = opts.instruction || prompt("Что изменить в этом блоке? (напр. «сделай заголовок крупнее и ярче», «убери лишний абзац»)", "");
            if (!instruction) return;
            var form = new FormData();
            form.append("context", ctx);
            form.append("instruction", instruction);
            if (opts.breakpoint) form.append("breakpoint", opts.breakpoint); // Responsive-AI (этап 10.5)
            leStatus(opts.breakpoint ? "AI адаптирует под мобильные…" : "AI готовит правки…");
            fetch("/Ai/Suggest", { method: "POST", headers: { "X-CSRF-TOKEN": csrfToken() }, body: form, credentials: "same-origin" })
                .then(function (resp) { return resp.json().then(function (j) { return { status: resp.status, j: j }; }); })
                .then(function (res) {
                    leStatus("", { hide: true });
                    if (res.status >= 200 && res.status < 300 && res.j && res.j.commands) {
                        if (!res.j.commands.length) { leToastMsg("AI не нашёл, что изменить."); return; }
                        applyAiCommands(res.j.commands);
                    } else {
                        alert(res.status === 429 ? "Лимит AI-правок исчерпан в этом месяце." :
                            res.status === 503 ? "AI не настроен на сервере." : "Не получилось подготовить правку. Попробуй ещё раз.");
                    }
                })
                .catch(function () { leStatus("", { hide: true }); alert("Сетевая ошибка."); });
        }
        // Responsive-AI «адаптировать мобилку» (этап 10.5): переключаемся на mobile (чтобы видеть результат)
        // и просим адаптацию — сервер вернёт только setStyle/setDesign на breakpoint=mobile, десктоп не тронут.
        function aiAdaptMobile(blockId) {
            switchBreakpoint("mobile");
            aiSuggest(blockId, {
                breakpoint: "mobile",
                instruction: "Адаптируй этот блок под мобильный экран: уменьши крупные шрифты, поправь отступы и переносы, при необходимости сложи элементы в столбец, чтобы ничего не вылезало за края. Тексты и десктоп не меняй."
            });
        }

        // Milestone 5, Фаза D: pack-level mobile pass для neo-секций. Это всё ещё Responsive-AI:
        // сервер принимает только setStyle/setDesign на breakpoint=mobile, без новой command surface.
        function aiAdaptPackMobile() {
            if (!getCmdStore()) { alert("AI-правки доступны в режиме команд."); return; }
            var packInfo = win.LimeExperiencePacks && win.LimeExperiencePacks.resolve(doc.pack);
            if (!packInfo) { alert("Это работает только для сайтов, собранных из готового пака (Experience Pack)."); return; }
            var allBlocks = [];
            (doc.pages || []).forEach(function (p) { collectMobileBlocks(p.blocks, allBlocks); });
            if (!allBlocks.length) { alert("Не нашёл блоков для мобильной адаптации."); return; }
            var ctx = JSON.stringify({
                viewport: { breakpoint: "mobile", width: 390 },
                theme: { accent: doc.theme && doc.theme.accent, bg: doc.theme && doc.theme.bg, fg: doc.theme && doc.theme.fg },
                pack: {
                    key: packInfo.key,
                    name: packInfo.name,
                    category: packInfo.category,
                    level: packInfo.level,
                    sections: packInfo.sections,
                    assetSlots: packInfo.assetSlots
                },
                blocks: allBlocks
            });
            if (ctx.length > 18000) { alert("Документ слишком большой для AI-адаптации за один раз."); return; }
            switchBreakpoint("mobile");
            var instruction = "Адаптируй Experience Pack под mobile: используй только setStyle/setDesign с breakpoint=mobile. Уменьши шрифты/отступы, сложи сетки/hero/embed, учти horizontal/pinned fallback. Не меняй тексты, структуру и desktop.";
            var form = new FormData();
            form.append("context", ctx);
            form.append("instruction", instruction);
            form.append("breakpoint", "mobile");
            leStatus("AI адаптирует пак под мобильные…");
            fetch("/Ai/Suggest", { method: "POST", headers: { "X-CSRF-TOKEN": csrfToken() }, body: form, credentials: "same-origin" })
                .then(function (resp) { return resp.json().then(function (j) { return { status: resp.status, j: j }; }); })
                .then(function (res) {
                    leStatus("", { hide: true });
                    if (res.status >= 200 && res.status < 300 && res.j && res.j.commands) {
                        if (!res.j.commands.length) { leToastMsg("AI не нашёл, что изменить."); return; }
                        applyAiCommands(res.j.commands);
                    } else {
                        alert(res.status === 429 ? "Лимит AI-правок исчерпан в этом месяце." :
                            res.status === 503 ? "AI не настроен на сервере." : "Не получилось адаптировать мобильную версию. Попробуй ещё раз.");
                    }
                })
                .catch(function () { leStatus("", { hide: true }); alert("Сетевая ошибка."); });
        }

        // Фаза A Milestone 5: «заполнить секции пака текстом» — тот же /Ai/Suggest и та же
        // applyAiCommands (validate → dry-run → preview → один undo), что и aiSuggest для одного
        // блока; отличается только контекст (весь документ, а не поддерево выбранного блока) и
        // инструкция. Ноль новых типов команд/whitelist — только другая сериализация на клиенте.
        function aiFillPackText() {
            if (!getCmdStore()) { alert("AI-правки доступны в режиме команд."); return; }
            // doc.pack штампуется для ЛЮБОГО шаблона (Milestone 4, applyTemplateByKey) — проверять
            // нужно, что он резолвится в НАСТОЯЩИЙ Experience Pack, а не просто что поле не пустое.
            var packInfo = win.LimeExperiencePacks && win.LimeExperiencePacks.resolve(doc.pack);
            if (!packInfo) { alert("Это работает только для сайтов, собранных из готового пака (Experience Pack)."); return; }
            var allBlocks = [];
            (doc.pages || []).forEach(function (p) { collectTextBlocks(p.blocks, allBlocks); });
            if (!allBlocks.length) { alert("Не нашёл текстовых полей для заполнения."); return; }
            var brief = prompt("Опиши бренд/тему в двух словах — AI впишет текст во все секции пака:", "");
            if (!brief) return;
            var ctx = JSON.stringify({
                theme: { accent: doc.theme && doc.theme.accent, bg: doc.theme && doc.theme.bg, fg: doc.theme && doc.theme.fg },
                blocks: allBlocks
            });
            if (ctx.length > 18000) { alert("Документ слишком большой для AI-заполнения за один раз."); return; }
            var instruction = "Заполни текстовые поля под тему: " + brief + ". Сохраняй тон и структуру " +
                "каждой секции, меняй ТОЛЬКО значения текстовых полей у переданных id, не добавляй и не убирай поля. " +
                "Для элементов массива используй те же ключи-пути, что в контексте (например \"items.0.quote\").";
            var form = new FormData();
            form.append("context", ctx);
            form.append("instruction", instruction);
            leStatus("AI заполняет текст…");
            fetch("/Ai/Suggest", { method: "POST", headers: { "X-CSRF-TOKEN": csrfToken() }, body: form, credentials: "same-origin" })
                .then(function (resp) { return resp.json().then(function (j) { return { status: resp.status, j: j }; }); })
                .then(function (res) {
                    leStatus("", { hide: true });
                    if (res.status >= 200 && res.status < 300 && res.j && res.j.commands) {
                        if (!res.j.commands.length) { leToastMsg("AI не нашёл, что изменить."); return; }
                        applyAiCommands(res.j.commands);
                    } else {
                        alert(res.status === 429 ? "Лимит AI-правок исчерпан в этом месяце." :
                            res.status === 503 ? "AI не настроен на сервере." : "Не получилось заполнить текст. Попробуй ещё раз.");
                    }
                })
                .catch(function () { leStatus("", { hide: true }); alert("Сетевая ошибка."); });
        }

        var aiFillTextBtn = document ? document.querySelector("[data-doc-ai-fill-text]") : null;
        if (aiFillTextBtn) aiFillTextBtn.addEventListener("click", aiFillPackText);

        // Фаза B Milestone 5: «подобрать тему + motion под настроение» для пак-документа.
        // Тот же /Ai/Suggest + applyAiCommands (validate → dry-run → preview → один undo).
        // Новое здесь — только setTheme (Фаза B добавила команду в allowlist) и то, что
        // setBlockProp впервые реально документирован модели (раньше был разрешён, но не описан
        // в системном промпте — см. experience-builder-plan.md). Выбор пака НЕ входит в эту фазу:
        // паков сегодня ровно один (neo-lore-drop), выбирать не из чего — решение пользователя.
        function aiRestylePack() {
            if (!getCmdStore()) { alert("AI-правки доступны в режиме команд."); return; }
            var packInfo = win.LimeExperiencePacks && win.LimeExperiencePacks.resolve(doc.pack);
            if (!packInfo) { alert("Это работает только для сайтов, собранных из готового пака (Experience Pack)."); return; }
            var brief = prompt("Опиши настроение/стиль в двух словах — AI подберёт тему и motion:", "");
            if (!brief) return;
            var allBlocks = [];
            (doc.pages || []).forEach(function (p) { collectMotionBlocks(p.blocks, allBlocks); });
            var ctx = JSON.stringify({
                theme: doc.theme,
                motionProfile: packInfo.motionProfile,
                blocks: allBlocks
            });
            if (ctx.length > 18000) { alert("Документ слишком большой для AI-подбора за один раз."); return; }
            var instruction = "Настроение: " + brief + ". setTheme меняет цвет/шрифт темы; setBlockProp " +
                "(id из контекста, prop anim|parallax|marquee|scene|sticky) — motion блоков. Текст и структуру не трогай.";
            var form = new FormData();
            form.append("context", ctx);
            form.append("instruction", instruction);
            leStatus("AI подбирает оформление…");
            fetch("/Ai/Suggest", { method: "POST", headers: { "X-CSRF-TOKEN": csrfToken() }, body: form, credentials: "same-origin" })
                .then(function (resp) { return resp.json().then(function (j) { return { status: resp.status, j: j }; }); })
                .then(function (res) {
                    leStatus("", { hide: true });
                    if (res.status >= 200 && res.status < 300 && res.j && res.j.commands) {
                        if (!res.j.commands.length) { leToastMsg("AI не нашёл, что изменить."); return; }
                        applyAiCommands(res.j.commands);
                    } else {
                        alert(res.status === 429 ? "Лимит AI-правок исчерпан в этом месяце." :
                            res.status === 503 ? "AI не настроен на сервере." : "Не получилось подобрать оформление. Попробуй ещё раз.");
                    }
                })
                .catch(function () { leStatus("", { hide: true }); alert("Сетевая ошибка."); });
        }

        var aiRestyleBtn = document ? document.querySelector("[data-doc-ai-restyle]") : null;
        if (aiRestyleBtn) aiRestyleBtn.addEventListener("click", aiRestylePack);

        var aiMobileBtn = document ? document.querySelector("[data-doc-ai-mobile]") : null;
        if (aiMobileBtn) aiMobileBtn.addEventListener("click", aiAdaptPackMobile);

        // Milestone 5, Фаза C: «✦ Промпт для ассета» — не трогает документ (ни content, ни
        // commands), просто предлагает текст-бриф для внешнего инструмента (Midjourney/Spline/
        // поиск ассетов). Данные слота/пака уже посчитаны один раз в slotHintSection
        // (lime-editor-content-binding.js) и лежат в data-* атрибутах самой кнопки — здесь их
        // просто читаем, а не резолвим повторно. Тема — свежая (doc.theme мог поменять Фаза B).
        function aiSuggestAssetPrompt(el) {
            if (!el) return;
            var resultEl = el.nextElementSibling;
            var ds = el.dataset || {};
            var ctx = JSON.stringify({
                slotLabel: ds.slotLabel || "",
                slotHint: ds.slotHint || "",
                packName: ds.packName || "",
                category: ds.packCategory || "",
                theme: { accent: doc.theme && doc.theme.accent, bg: doc.theme && doc.theme.bg, fg: doc.theme && doc.theme.fg }
            });
            if (resultEl) resultEl.textContent = "AI думает…";
            var form = new FormData();
            form.append("context", ctx);
            fetch("/Ai/SuggestAssetBrief", { method: "POST", headers: { "X-CSRF-TOKEN": csrfToken() }, body: form, credentials: "same-origin" })
                .then(function (resp) { return resp.json().then(function (j) { return { status: resp.status, j: j }; }); })
                .then(function (res) {
                    if (!resultEl) return;
                    if (res.status >= 200 && res.status < 300 && res.j && typeof res.j.text === "string") {
                        resultEl.textContent = res.j.text;
                    } else {
                        resultEl.textContent = res.status === 429 ? "Лимит AI-правок исчерпан в этом месяце." :
                            res.status === 503 ? "AI не настроен на сервере." : "Не получилось получить промпт. Попробуй ещё раз.";
                    }
                })
                .catch(function () { if (resultEl) resultEl.textContent = "Сетевая ошибка."; });
        }

        return {
            applyAiCommands: applyAiCommands, aiSuggest: aiSuggest, aiAdaptMobile: aiAdaptMobile,
            aiAdaptPackMobile: aiAdaptPackMobile, collectMobileBlocks: collectMobileBlocks,
            aiFillPackText: aiFillPackText, collectTextBlocks: collectTextBlocks,
            aiRestylePack: aiRestylePack, collectMotionBlocks: collectMotionBlocks,
            aiSuggestAssetPrompt: aiSuggestAssetPrompt
        };
    }

    return { create: create };
});
