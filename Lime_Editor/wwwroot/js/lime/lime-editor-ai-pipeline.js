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
            var v = win.LimeCommands.validateAiCommands(rawList, { max: 40 });
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

        return { applyAiCommands: applyAiCommands, aiSuggest: aiSuggest, aiAdaptMobile: aiAdaptMobile };
    }

    return { create: create };
});
