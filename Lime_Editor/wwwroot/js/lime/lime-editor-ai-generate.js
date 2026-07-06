/*
 * Lime editor AI generate workflow: modal, quota, generation materialization,
 * rewrite/edit-block requests and lightweight status UI.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorAiGenerate = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
    "use strict";

    function noop() {}

    function create(deps) {
        deps = deps || {};
        var win = deps.window || (typeof window !== "undefined" ? window : {});
        var document = deps.document || win.document;
        var aiModal = deps.aiModal || (document && document.getElementById("lime-doc-ai-modal"));
        var ws = deps.ws || null;
        var statusSteps = deps.statusSteps || [
            "Разбираю запрос…", "Подбираю структуру…", "Собираю палитру и шрифты…",
            "Пишу тексты под бренд…", "Материализую блоки…"
        ];
        var getSelectedId = deps.getSelectedId || function () { return null; };
        var setSelectedId = deps.setSelectedId || noop;
        var findBlock = deps.findBlock || function () { return null; };
        var targetBlock = deps.targetBlock || function (block) { return block; };
        var pageBlocks = deps.pageBlocks || function () { return []; };
        var blockFromSpec = deps.blockFromSpec || function () { return null; };
        var setContentValue = deps.setContentValue || noop;
        var render = deps.render || noop;
        var markDirty = deps.markDirty || noop;
        var csrfToken = deps.csrfToken || function () { return ""; };
        var getDoc = deps.getDoc || function () { return null; };

        function aiStatus(text, danger) {
            if (!document) return;
            var el = document.getElementById("lime-doc-ai-status");
            if (el) {
                el.textContent = text || "";
                el.className = "lime-text-muted" + (danger ? " lime-text-danger" : "");
            }
        }

        function aiOpen() {
            if (!aiModal || !win.fetch) return;
            aiModal.classList.add("is-open");
            aiStatus("…");
            win.fetch("/Ai/Quota", { credentials: "same-origin" })
                .then(function (r) { return r.json(); })
                .then(function (q) {
                    if (!q.configured) aiStatus("AI не настроен на сервере (нет ключа провайдера).", true);
                    else aiStatus("Осталось генераций в этом месяце: " + Math.max(0, q.limit - q.used) + " из " + q.limit);
                })
                .catch(function () { aiStatus(""); });
        }

        function aiErrorText(status, resp) {
            if (status === 429) return "Бесплатные генерации кончились (" + (resp && resp.limit || "") + "/мес). Тарифы — скоро.";
            if (status === 503) return "AI не настроен на сервере.";
            return "Не получилось сгенерировать. Попробуй ещё раз.";
        }

        function reduceMotion() {
            return win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
        }

        function leStatus(text, opts) {
            if (!document) return;
            opts = opts || {};
            var bar = document.getElementById("lime-doc-le-status");
            var txt = document.getElementById("lime-doc-le-status-text");
            var sp = document.getElementById("lime-doc-le-spinner");
            if (!bar) return;
            if (opts.hide) {
                bar.classList.remove("is-on");
                return;
            }
            if (text && txt) txt.textContent = text;
            if (sp) sp.style.display = opts.done ? "none" : "";
            bar.classList.add("is-on");
        }

        function leToast() {
            if (!document) return;
            var t = document.getElementById("lime-doc-le-toast");
            if (!t) return;
            t.classList.add("is-on");
            win.setTimeout(function () { t.classList.remove("is-on"); }, 3200);
        }

        function materialize(specs) {
            var bl = pageBlocks();
            var i = 0;
            function step() {
                if (i >= specs.length) {
                    setSelectedId(null);
                    render();
                    markDirty();
                    leStatus("Сайт собран", { done: true });
                    win.setTimeout(function () { leStatus("", { hide: true }); leToast(); }, 900);
                    return;
                }
                var spec = specs[i++];
                var b = blockFromSpec(spec);
                if (!b) {
                    win.setTimeout(step, 0);
                    return;
                }
                bl.push(b);
                render();
                var el = ws && ws.querySelector('[data-block-id="' + b.id + '"]');
                if (el && !reduceMotion()) {
                    el.classList.add("is-entering");
                    var sweep = document.createElement("div");
                    sweep.className = "lime-sweep";
                    el.appendChild(sweep);
                    win.setTimeout(function () { if (sweep.parentNode) sweep.parentNode.removeChild(sweep); }, 750);
                    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
                win.setTimeout(step, reduceMotion() ? 0 : 300);
            }
            step();
        }

        function runGenerate(promptText, opts) {
            opts = opts || {};
            var prompt = (promptText || "").trim();
            if (!prompt) {
                if (opts.onError) opts.onError("Опиши бизнес — хотя бы пару предложений.");
                return;
            }
            if (opts.btn) opts.btn.disabled = true;
            var si = 0;
            leStatus(statusSteps[0]);
            var iv = win.setInterval(function () {
                si = Math.min(si + 1, statusSteps.length - 1);
                leStatus(statusSteps[si]);
            }, 750);
            var form = new win.FormData();
            form.append("prompt", prompt);
            var xhr = new win.XMLHttpRequest();
            xhr.open("POST", "/Ai/Generate");
            xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
            xhr.onload = function () {
                win.clearInterval(iv);
                if (opts.btn) opts.btn.disabled = false;
                var resp = null;
                try { resp = JSON.parse(xhr.responseText); } catch (e) { /* no-op */ }
                if (xhr.status >= 200 && xhr.status < 300 && resp && resp.blocks) {
                    leStatus("Материализую блоки…");
                    // Промпт → doc.meta.aiPrompt: сервер выведет из него имя сайта при сохранении
                    // (SiteNaming.FromDocument), вместо очередного «Новый сайт».
                    var doc = getDoc();
                    if (doc) {
                        doc.meta = doc.meta || {};
                        doc.meta.aiPrompt = prompt.slice(0, 200);
                    }
                    if (opts.onSuccess) opts.onSuccess();
                    materialize(resp.blocks);
                } else {
                    leStatus("", { hide: true });
                    if (opts.onError) opts.onError(aiErrorText(xhr.status, resp));
                }
            };
            xhr.onerror = function () {
                win.clearInterval(iv);
                if (opts.btn) opts.btn.disabled = false;
                leStatus("", { hide: true });
                if (opts.onError) opts.onError("Сетевая ошибка.");
            };
            xhr.send(form);
        }

        function aiGenerate() {
            if (!document) return;
            var ta = document.getElementById("lime-doc-ai-prompt");
            var btn = document.querySelector("[data-doc-ai-generate]");
            runGenerate(ta ? ta.value : "", {
                btn: btn,
                onError: function (m) { aiStatus(m, true); },
                onSuccess: function () { if (aiModal) aiModal.classList.remove("is-open"); }
            });
        }

        function aiRewrite() {
            var r = findBlock(getSelectedId());
            if (!r) return;
            var t = targetBlock(r.block);
            if (!t || !t.content || typeof t.content.text !== "string") return;
            var instruction = win.prompt("Как переписать этот текст? (короче / продающе / официальнее / на английском…)", "сделай продающим и короче");
            if (!instruction) return;
            var form = new win.FormData();
            form.append("text", t.content.text);
            form.append("instruction", instruction);
            var xhr = new win.XMLHttpRequest();
            xhr.open("POST", "/Ai/Rewrite");
            xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
            xhr.onload = function () {
                var resp = null;
                try { resp = JSON.parse(xhr.responseText); } catch (e) { /* no-op */ }
                if (xhr.status >= 200 && xhr.status < 300 && resp && resp.text) {
                    setContentValue(r.block, "text", resp.text, false);
                } else {
                    win.alert(aiErrorText(xhr.status, resp));
                }
            };
            xhr.onerror = function () { win.alert("Сетевая ошибка."); };
            xhr.send(form);
        }

        function aiEditBlock() {
            var r = findBlock(getSelectedId());
            if (!r) return;
            var t = targetBlock(r.block);
            if (!t) return;
            var instruction = win.prompt("Как переписать тексты этой секции? (смелее / под SaaS / короче / на английском…)", "сделай тексты смелее и под SaaS");
            if (!instruction) return;
            var payload = JSON.stringify({ content: t.content, children: t.children });
            if (payload.length > 18000) {
                win.alert("Секция слишком большая для AI-правки за один раз. Разбей её.");
                return;
            }
            var form = new win.FormData();
            form.append("block", payload);
            form.append("instruction", instruction);
            leStatus("AI переписывает секцию…");
            var xhr = new win.XMLHttpRequest();
            xhr.open("POST", "/Ai/EditBlock");
            xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
            xhr.onload = function () {
                var resp = null;
                try { resp = JSON.parse(xhr.responseText); } catch (e) { /* no-op */ }
                if (xhr.status >= 200 && xhr.status < 300 && resp && resp.block) {
                    if (resp.block.content) t.content = resp.block.content;
                    if (resp.block.children) t.children = resp.block.children;
                    render();
                    markDirty();
                    leStatus("Готово", { done: true });
                    win.setTimeout(function () { leStatus("", { hide: true }); }, 900);
                } else {
                    leStatus("", { hide: true });
                    win.alert(xhr.status === 422 ? "В этой секции нечего переписывать." : aiErrorText(xhr.status, resp));
                }
            };
            xhr.onerror = function () {
                leStatus("", { hide: true });
                win.alert("Сетевая ошибка.");
            };
            xhr.send(form);
        }

        function init() {
            if (!document) return;
            var aiOpenBtn = document.querySelector("[data-doc-ai-open]");
            if (aiOpenBtn) aiOpenBtn.addEventListener("click", aiOpen);
            document.addEventListener("click", function (e) {
                if (aiModal && e.target.closest("[data-doc-ai-close]")) aiModal.classList.remove("is-open");
                if (e.target.closest("[data-doc-ai-generate]")) aiGenerate();
            });
        }

        init();

        return {
            aiStatus: aiStatus,
            aiOpen: aiOpen,
            aiErrorText: aiErrorText,
            leStatus: leStatus,
            leToast: leToast,
            materialize: materialize,
            runGenerate: runGenerate,
            aiGenerate: aiGenerate,
            aiRewrite: aiRewrite,
            aiEditBlock: aiEditBlock
        };
    }

    return { create: create };
});
