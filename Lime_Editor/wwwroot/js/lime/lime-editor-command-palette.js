/* Lime editor command palette UI. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorCommandPalette = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function create(options) {
        options = options || {};
        var commands = options.commands || [];
        var escapeText = options.escapeText || function (s) { return String(s == null ? "" : s); };
        var doc = options.document || (typeof document !== "undefined" ? document : null);
        var win = options.window || (typeof window !== "undefined" ? window : null);
        var launcher = options.launcher || null;
        var palette = null, input = null, list = null, lastFocus = null, activeIndex = 0, visibleCommands = [];
        if (!doc || !win) return { open: function () {}, close: function () {}, commands: commands };

        function ensurePalette() {
            if (palette) return;
            palette = doc.createElement("div");
            palette.className = "lime-command-palette";
            palette.setAttribute("role", "dialog");
            palette.setAttribute("aria-modal", "true");
            palette.setAttribute("aria-label", "Командная палитра");
            palette.innerHTML =
                '<div class="lime-command-palette__box">' +
                    '<input class="lime-command-palette__input" data-command-input type="search" autocomplete="off" spellcheck="false" placeholder="Что сделать?">' +
                    '<div class="lime-command-palette__list" data-command-list role="listbox"></div>' +
                '</div>';
            doc.body.appendChild(palette);
            input = palette.querySelector("[data-command-input]");
            list = palette.querySelector("[data-command-list]");
            input.addEventListener("input", function () { renderCommands(input.value); });
            input.addEventListener("keydown", onInputKeydown);
            list.addEventListener("mousemove", function (e) {
                var item = e.target.closest("[data-command-index]");
                if (!item) return;
                setActive(parseInt(item.getAttribute("data-command-index"), 10));
            });
            list.addEventListener("click", function (e) {
                var item = e.target.closest("[data-command-index]");
                if (!item) return;
                runCommandItem(parseInt(item.getAttribute("data-command-index"), 10));
            });
            palette.addEventListener("mousedown", function (e) {
                if (e.target === palette) closePalette();
            });
        }

        function commandMatches(cmd, q) {
            if (!q) return true;
            var hay = (cmd.title + " " + (cmd.keywords || "") + " " + cmd.id).toLowerCase();
            return q.split(/\s+/).every(function (part) { return !part || hay.indexOf(part) >= 0; });
        }

        function renderCommands(query) {
            var q = (query || "").trim().toLowerCase();
            visibleCommands = commands.filter(function (cmd) {
                return (!cmd.when || cmd.when()) && commandMatches(cmd, q);
            });
            activeIndex = Math.min(activeIndex, Math.max(visibleCommands.length - 1, 0));
            if (!visibleCommands.length) {
                list.innerHTML = '<div class="lime-command-palette__empty">Ничего не найдено</div>';
                return;
            }
            list.innerHTML = visibleCommands.map(function (cmd, i) {
                return '<button type="button" class="lime-command-palette__item' + (i === activeIndex ? " is-active" : "") + '" role="option" aria-selected="' + (i === activeIndex ? "true" : "false") + '" data-command-index="' + i + '">' +
                    '<span><span class="lime-command-palette__title">' + escapeText(cmd.title) + '</span>' +
                    '<span class="lime-command-palette__meta">' + escapeText(cmd.keywords || "") + '</span></span>' +
                    (cmd.shortcut ? '<span class="lime-command-palette__shortcut">' + escapeText(cmd.shortcut) + '</span>' : '') +
                '</button>';
            }).join("");
        }

        function setActive(next) {
            if (!visibleCommands.length) return;
            activeIndex = Math.max(0, Math.min(visibleCommands.length - 1, next));
            renderCommands(input.value);
            var active = list.querySelector('[data-command-index="' + activeIndex + '"]');
            if (active) active.scrollIntoView({ block: "nearest" });
        }

        function runCommandItem(index) {
            var cmd = visibleCommands[index];
            if (!cmd) return;
            closePalette();
            cmd.run();
        }

        function onInputKeydown(e) {
            if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIndex + 1); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIndex - 1); return; }
            if (e.key === "Enter") { e.preventDefault(); runCommandItem(activeIndex); }
        }

        function openPalette() {
            ensurePalette();
            lastFocus = doc.activeElement;
            activeIndex = 0;
            palette.classList.add("is-open");
            input.value = "";
            renderCommands("");
            win.setTimeout(function () { input.focus(); }, 0);
        }

        function closePalette() {
            if (!palette || !palette.classList.contains("is-open")) return;
            palette.classList.remove("is-open");
            if (lastFocus && lastFocus.focus) lastFocus.focus();
        }

        if (launcher) launcher.addEventListener("click", openPalette);
        doc.addEventListener("keydown", function (e) {
            if (!(e.ctrlKey || e.metaKey) || (e.key || "").toLowerCase() !== "k") return;
            e.preventDefault();
            if (palette && palette.classList.contains("is-open")) closePalette();
            else openPalette();
        });

        return {
            open: openPalette,
            close: closePalette,
            commands: commands
        };
    }

    return {
        create: create
    };
});
