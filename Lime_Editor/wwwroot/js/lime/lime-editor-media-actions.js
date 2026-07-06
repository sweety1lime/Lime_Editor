/*
 * Lime editor media actions: gallery item edits, media picker binding,
 * video/embed prompts and background/layer media application.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorMediaActions = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
    function noop() {}

    function create(deps) {
        deps = deps || {};
        var win = deps.window || (typeof window !== "undefined" ? window : {});
        var document = deps.document || win.document;
        var ws = deps.ws || null;
        var EditorMediaPicker = deps.EditorMediaPicker || win.LimeEditorMediaPicker || {};
        var csrfToken = deps.csrfToken || function () { return ""; };
        var byId = deps.byId || function () { return null; };
        var targetBlock = deps.targetBlock || function (block) { return block; };
        var getDoc = deps.getDoc || function () { return null; };
        var setContentValue = deps.setContentValue || noop;
        var setByPath = deps.setByPath || noop;
        var hasCmdStore = deps.hasCmdStore || function () { return false; };
        var getCurrentBp = deps.getCurrentBp || function () { return "base"; };
        var runCommands = deps.runCommands || function () { return false; };
        var patchBlockDom = deps.patchBlockDom || function () { return false; };
        var render = deps.render || noop;
        var markDirty = deps.markDirty || noop;
        var scheduleAutosave = deps.scheduleAutosave || noop;
        var mediaPicker = EditorMediaPicker.create ? EditorMediaPicker.create({
            csrfToken: csrfToken,
            document: document,
            fetch: win.fetch ? win.fetch.bind(win) : null,
            onPick: applyPickedMedia,
            window: win
        }) : null;

        function blockOf(el) {
            var sec = el && el.closest && el.closest(".lime-block");
            return sec ? byId(sec.getAttribute("data-block-id")) : null;
        }

        function openMediaPicker(blockId, field, target) {
            if (!mediaPicker || !mediaPicker.open) return;
            mediaPicker.open({ blockId: blockId, field: field, target: target || "content" });
        }

        function applyPickedMedia(pickCtx, url) {
            var b = pickCtx && byId(pickCtx.blockId);
            if (!b || !url) return;
            var tb = targetBlock(b);
            if (pickCtx.target === "bgimage") {
                if (hasCmdStore() && tb === b) {
                    var bgChanged = runCommands([
                        { type: "setStyle", payload: { id: b.id, breakpoint: getCurrentBp(), prop: "backgroundImage", value: "url('" + url + "')" } },
                        { type: "setContent", payload: { id: b.id, field: "bgMode", value: "image" } }
                    ], "pick-background");
                    patchBlockDom(b.id, { allowChildren: true, refreshDesign: true });
                    if (bgChanged) scheduleAutosave();
                } else {
                    if (!tb.styles) tb.styles = {};
                    if (!tb.styles[getCurrentBp()]) tb.styles[getCurrentBp()] = {};
                    tb.styles[getCurrentBp()].backgroundImage = "url('" + url + "')";
                    if (!tb.content) tb.content = {};
                    tb.content.bgMode = "image";
                    if (tb === b) patchBlockDom(b.id, { allowChildren: true, refreshDesign: true });
                    else render();
                    markDirty();
                }
            } else if (pickCtx.target === "blockpath") {
                setByPath(tb, pickCtx.field, url);
                if (tb === b) patchBlockDom(b.id, { allowChildren: true, refreshDesign: true });
                else render();
                markDirty();
            } else {
                setContentValue(b, pickCtx.field, url, false);
            }
        }

        function promptVideo(blockId) {
            var url = win.prompt("Ссылка YouTube (https://youtube.com/watch?v=... или https://youtu.be/...)");
            if (!url) return;
            var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/);
            if (!m) {
                win.alert("Не распознал ссылку YouTube.");
                return;
            }
            var b = byId(blockId);
            if (!b) return;
            setContentValue(b, "youtubeId", m[1], false);
        }

        function providerKeys(providers) {
            var keys = [];
            providers = providers || {};
            for (var k in providers) if (Object.prototype.hasOwnProperty.call(providers, k) && k !== "embed") keys.push(k);
            keys.sort();
            return keys;
        }
        function providerExample(provider) {
            var map = {
                spline: "https://my.spline.design/scene/",
                rive: "https://rive.app/s/scene/",
                lottie: "https://lottie.host/animation.json",
                youtube: "https://www.youtube.com/embed/VIDEO_ID",
                vimeo: "https://vimeo.com/123456789",
                sketchfab: "https://sketchfab.com/models/MODEL_ID/embed",
                figma: "https://www.figma.com/embed?embed_host=share&url=https://www.figma.com/file/FILE_ID"
            };
            return map[provider] || "https://";
        }

        function promptEmbed(blockId) {
            var b = byId(blockId);
            if (!b) return;
            var current = (targetBlock(b).content || {});
            var L = win.LimeDoc || {};
            var providers = L.EMBED_PROVIDERS || {
                spline: { label: "Spline", aspect: "4/5" },
                rive: { label: "Rive", aspect: "16/9" },
                lottie: { label: "Lottie", aspect: "1/1" },
                youtube: { label: "YouTube", aspect: "16/9" },
                vimeo: { label: "Vimeo", aspect: "16/9" },
                sketchfab: { label: "Sketchfab", aspect: "16/9" },
                figma: { label: "Figma", aspect: "16/9" },
                embed: { label: "Embed", aspect: "16/9" }
            };
            var keys = providerKeys(providers);
            var provider = win.prompt("Провайдер embed (" + keys.join(" / ") + "):", current.provider || "spline");
            if (provider == null) return;
            provider = String(provider).trim().toLowerCase();
            if (!provider) provider = "embed";
            if (provider !== "embed" && providers[provider] == null) {
                win.alert("Неизвестный провайдер. Доступны: " + keys.join(", ") + ".");
                return;
            }
            var preset = providers[provider] || providers.embed || { label: "Embed", aspect: "16/9" };
            // Milestone 4 (experience-builder-plan.md): если это embed-слот пака (content.__slot),
            // подсказываем требование к нему прямо в промпте — не paywall, а обучающая подсказка.
            var slotHint = "";
            var Packs = win.LimeExperiencePacks;
            var docNow = getDoc();
            if (current.__slot && Packs && docNow && docNow.pack) {
                var full = Packs.resolve(docNow.pack);
                var slot = full && full.assetSlots && full.assetSlots.filter(function (s) { return s.slot === current.__slot; })[0];
                if (slot) slotHint = " (" + slot.hint + ")";
            }
            var url = win.prompt("Ссылка на " + (preset.label || "embed") + slotHint + ":", current.embedUrl || providerExample(provider));
            if (url == null) return;
            url = url.trim();
            if (!/^https:\/\//i.test(url)) {
                win.alert("Нужна ссылка, начинающаяся с https://");
                return;
            }
            // Host-allowlist — та же проверка, что и в рендере/publish (LimeDoc.isAllowedEmbedUrl):
            // валидируем на вводе, чтобы пользователь узнал сразу, а не по пустому блоку на публикации.
            if (L.isAllowedEmbedUrl && !L.isAllowedEmbedUrl(url)) {
                win.alert("Этот хост не поддерживается. Разрешены: " + ((L.EMBED_HOSTS || []).join(", ")) + ".");
                return;
            }
            if (L.normalizeEmbedProvider) provider = L.normalizeEmbedProvider(provider, url);
            preset = providers[provider] || preset;
            setContentValue(b, "embedUrl", url, false);
            setContentValue(b, "provider", provider, false);
            setContentValue(b, "aspect", preset.aspect || "16/9", false);
            setContentValue(b, "fallbackTitle", (preset.label || "Embed") + " scene", false);
            setContentValue(b, "fallbackText", "Loading interactive scene.", false);
        }

        function init() {
            if (!ws) return;
            ws.addEventListener("click", function (e) {
                var el;
                if ((el = e.target.closest("[data-doc-gallery-del]"))) {
                    e.stopPropagation();
                    var b = blockOf(el);
                    if (b) {
                        var items = clone((targetBlock(b).content && targetBlock(b).content.items) || []);
                        items.splice(parseInt(el.getAttribute("data-doc-gallery-del"), 10), 1);
                        setContentValue(b, "items", items, false);
                    }
                    return;
                }
                if ((el = e.target.closest("[data-doc-gallery-add]"))) {
                    var b2 = blockOf(el);
                    if (b2) {
                        var t = targetBlock(b2);
                        var nextItems = clone((t.content && t.content.items) || []);
                        nextItems.push({ src: "", alt: "" });
                        setContentValue(b2, "items", nextItems, false);
                    }
                    return;
                }
                if ((el = e.target.closest("[data-doc-pick]"))) {
                    var b3 = blockOf(el);
                    if (b3) openMediaPicker(b3.id, el.getAttribute("data-doc-pick"));
                    return;
                }
                if ((el = e.target.closest("[data-doc-video]"))) {
                    var b4 = blockOf(el);
                    if (b4) promptVideo(b4.id);
                    return;
                }
                if ((el = e.target.closest("[data-doc-embed]"))) {
                    var b5 = blockOf(el);
                    if (b5) promptEmbed(b5.id);
                }
            });
        }

        init();

        return {
            openMediaPicker: openMediaPicker,
            applyPickedMedia: applyPickedMedia,
            promptVideo: promptVideo,
            promptEmbed: promptEmbed
        };
    }

    return { create: create };
});
