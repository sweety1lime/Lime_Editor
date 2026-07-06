/* Lime editor command palette registry and wiring. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory(root);
    else root.LimeEditorCommandRegistry = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this), function (root) {
    "use strict";

    function create(options) {
        options = options || {};
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : root);
        var commandPalette = options.commandPalette || (root && root.LimeEditorCommandPalette) || {};
        if (!doc || !win || !commandPalette.create) return { commands: [] };

        var launcher = doc.querySelector("[data-doc-cmdk]");
        var saveBtn = options.saveBtn || null;
        var themeModal = options.themeModal || null;
        var codeModal = options.codeModal || null;
        var escapeText = options.escapeText || function (s) { return String(s == null ? "" : s); };
        var getSelectedId = options.getSelectedId || function () { return null; };
        var byId = options.byId || function () { return null; };
        var v2SelectionIds = options.v2SelectionIds || function () { return []; };
        var aiOpen = options.aiOpen || function () {};
        var aiSuggest = options.aiSuggest || function () {};
        var aiFillPackText = options.aiFillPackText || function () {};
        var aiRestylePack = options.aiRestylePack || function () {};
        var aiAdaptPackMobile = options.aiAdaptPackMobile || function () {};
        var undo = options.undo || function () {};
        var redo = options.redo || function () {};
        var runBlockOp = options.runBlockOp || function () {};
        var groupSelection = options.groupSelection || function () {};
        var ungroupBlock = options.ungroupBlock || function () {};
        var makeComponent = options.makeComponent || function () {};

        function triggerClick(selector) {
            var el = doc.querySelector(selector);
            if (el) el.click();
        }
        function openSidebarPanel(name) {
            if (win.__LIME_SIDEBAR__ && win.__LIME_SIDEBAR__.open) win.__LIME_SIDEBAR__.open(name);
        }
        function selectedBlock() {
            var id = getSelectedId();
            return id ? byId(id) : null;
        }
        function canRunSelected() { return !!selectedBlock(); }

        var commands = [
            { id: "insert-cover", title: "Вставить обложку", keywords: "hero cover блок секция", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="cover"]'); } },
            { id: "insert-heading", title: "Вставить заголовок", keywords: "heading title текст блок", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="heading"]'); } },
            { id: "insert-text", title: "Вставить текст", keywords: "paragraph copy block", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="text"]'); } },
            { id: "insert-columns", title: "Вставить колонки", keywords: "columns grid layout", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); triggerClick('[data-doc-add="columns"]'); } },
            { id: "show-insert", title: "Открыть вставку", keywords: "blocks блоки add sidebar", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("insert"); } },
            { id: "show-layers", title: "Открыть слои", keywords: "layers outline порядок дерево", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("layers"); } },
            { id: "show-components", title: "Открыть компоненты", keywords: "components reusable reuse", shortcut: "", when: function () { return true; }, run: function () { openSidebarPanel("components"); } },
            { id: "device-desktop", title: "Переключить на desktop", keywords: "breakpoint desktop экран", shortcut: "", when: function () { return true; }, run: function () { triggerClick('[data-doc-bp="base"]'); } },
            { id: "device-tablet", title: "Переключить на tablet", keywords: "breakpoint tablet планшет", shortcut: "", when: function () { return true; }, run: function () { triggerClick('[data-doc-bp="tablet"]'); } },
            { id: "device-mobile", title: "Переключить на mobile", keywords: "breakpoint mobile телефон адаптив", shortcut: "", when: function () { return true; }, run: function () { triggerClick('[data-doc-bp="mobile"]'); } },
            { id: "open-theme", title: "Открыть тему сайта", keywords: "theme palette colors шрифт", shortcut: "", when: function () { return !!themeModal; }, run: function () { if (themeModal) themeModal.classList.add("is-open"); } },
            { id: "open-code", title: "Открыть код сайта", keywords: "css head custom code", shortcut: "", when: function () { return !!codeModal; }, run: function () { triggerClick("[data-doc-code-open]"); } },
            { id: "open-ai", title: "AI: сгенерировать страницу", keywords: "ai generate prompt создать", shortcut: "", when: function () { return true; }, run: aiOpen },
            { id: "ai-edit", title: "AI: поправить выбранный блок", keywords: "rewrite suggest ai selected", shortcut: "", when: canRunSelected, run: function () { aiSuggest(getSelectedId()); } },
            { id: "fill-pack-text", title: "AI: заполнить текстом пака", keywords: "ai fill text заполнить пак brief", shortcut: "", when: function () { return true; }, run: aiFillPackText },
            { id: "restyle-pack", title: "AI: сменить оформление (тема+motion)", keywords: "ai theme motion restyle тема мотион оформление вайб", shortcut: "", when: function () { return true; }, run: aiRestylePack },
            { id: "adapt-pack-mobile", title: "AI: адаптировать пак под mobile", keywords: "ai mobile responsive pack мобайл адаптив пак", shortcut: "", when: function () { return true; }, run: aiAdaptPackMobile },
            { id: "undo", title: "Отменить", keywords: "history назад", shortcut: "Ctrl+Z", when: function () { return true; }, run: undo },
            { id: "redo", title: "Вернуть", keywords: "history вперед", shortcut: "Ctrl+Shift+Z", when: function () { return true; }, run: redo },
            { id: "duplicate", title: "Дублировать выбранный блок", keywords: "copy clone duplicate", shortcut: "Ctrl+D", when: canRunSelected, run: function () { runBlockOp("dup"); } },
            { id: "group", title: "Сгруппировать выделение", keywords: "group multi selection", shortcut: "", when: function () { return v2SelectionIds().length >= 2; }, run: groupSelection },
            { id: "ungroup", title: "Разгруппировать блок", keywords: "ungroup group", shortcut: "", when: function () { var b = selectedBlock(); return b && b.type === "group"; }, run: ungroupBlock },
            { id: "component", title: "Сделать компонентом", keywords: "component reusable", shortcut: "", when: function () { var b = selectedBlock(); return b && b.type !== "component"; }, run: makeComponent },
            { id: "delete", title: "Удалить выбранный блок", keywords: "remove delete", shortcut: "Del", when: canRunSelected, run: function () { runBlockOp("del"); } },
            { id: "save", title: "Опубликовать / обновить сайт", keywords: "publish save сохранить", shortcut: "", when: function () { return !!saveBtn; }, run: function () { if (saveBtn) saveBtn.click(); } }
        ];

        win.__LIME_COMMANDS__ = commands;
        commandPalette.create({
            commands: commands,
            launcher: launcher,
            escapeText: escapeText,
            document: doc,
            window: win
        });
        return { commands: commands };
    }

    return { create: create };
});
