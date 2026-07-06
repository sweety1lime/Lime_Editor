/* Lime editor persistence: save, autosave, status and crash recovery drafts. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorPersistence = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function noop() {}

    function create(options) {
        options = options || {};
        var win = options.window || (typeof window !== "undefined" ? window : {});
        var document = options.document || win.document || null;
        var L = options.L || {};
        var getDoc = options.getDoc || function () { return {}; };
        var getDocVersion = options.getDocVersion || function () { return 0; };
        var setDocVersion = options.setDocVersion || noop;
        var siteId = options.siteId || "";
        var saveBtn = options.saveBtn || null;
        var csrfToken = options.csrfToken || function () { return ""; };
        var totalBlocks = options.totalBlocks || function () { return 0; };
        var commitPendingCommandEdits = options.commitPendingCommandEdits || noop;
        var pushHistory = options.pushHistory || noop;
        var restoreDraftDocument = options.restoreDraftDocument || noop;
        var editSeq = 0;
        var savedSeq = 0;
        var conflicted = false;
        var autosaveTimer = null;
        var autosaving = false;
        var draftTimer = null;
        var DRAFT_KEY = "lime-doc-draft-" + (siteId || "new");

        function setStatus(text, cls) {
            if (!document) return;
            var el = document.querySelector("[data-doc-status]");
            if (el) {
                el.textContent = text;
                el.className = "lime-text-muted" + (cls ? " " + cls : "");
            }
        }

        function buildForm(auto) {
            var doc = getDoc();
            var compiled = L.renderSite ? L.renderSite(doc) : "";
            var form = new win.FormData();
            form.append("html", compiled);
            form.append("documentJson", JSON.stringify(doc));
            form.append("baseVersion", String(getDocVersion()));
            if (siteId) form.append("siteId", siteId);
            if (auto) form.append("auto", "true");
            return form;
        }

        function onConflict() {
            conflicted = true;
            setStatus("⚠ Изменено в другом окне", "lime-text-danger");
            if (win.alert) {
                win.alert("Документ был сохранён из другого окна или вкладки.\n" +
                    "Обнови страницу (F5), чтобы продолжить с актуальной версией - иначе чужие правки будут затёрты.");
            }
        }

        function clearDraft() {
            clearTimeout(draftTimer);
            if (!win.localStorage) return;
            try { win.localStorage.removeItem(DRAFT_KEY); } catch (e) { /* no-op */ }
        }

        function save() {
            if (totalBlocks() === 0) {
                if (win.alert) win.alert("На сайте пока нет ни одного блока. Добавь хотя бы один - например, обложку из панели слева.");
                return;
            }
            var xhr = new win.XMLHttpRequest();
            xhr.open("POST", "/Home/EditTemplatesPost");
            xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
            xhr.onload = function () {
                if (xhr.status === 409) onConflict();
                else if (xhr.status >= 200 && xhr.status < 400) {
                    savedSeq = editSeq;
                    clearDraft();
                    win.location.href = "/Home/MySites";
                } else if (xhr.status === 403 && /site_limit/.test(xhr.responseText || "")) {
                    // Лимит сайтов тарифа: сервер сайт НЕ создал. Драфт не трогаем.
                    setStatus("Лимит сайтов тарифа", "lime-text-danger");
                    if (win.alert) win.alert("Достигнут лимит сайтов текущего тарифа - сайт не сохранён на сервере.\nЧерновик остался в этой вкладке. Удали ненужный сайт в «Мои сайты» или загляни в «Тарифы».");
                } else {
                    setStatus("Не удалось сохранить", "lime-text-danger");
                    if (win.alert) win.alert("Не удалось сохранить (код " + xhr.status + "). Изменения сохранены локально в этой вкладке - проверь подключение и попробуй ещё раз.");
                }
            };
            xhr.onerror = function () {
                setStatus("Нет сети", "lime-text-danger");
                if (win.alert) win.alert("Нет сети - изменения не отправлены на сервер. Они сохранены локально в этой вкладке и не потеряются; попробуй сохранить позже.");
            };
            xhr.send(buildForm(false));
        }

        function isDirty() {
            return editSeq !== savedSeq;
        }

        function writeDraft() {
            if (!win.localStorage || !isDirty()) return;
            try {
                win.localStorage.setItem(DRAFT_KEY, JSON.stringify({ json: getDoc(), baseVersion: getDocVersion(), ts: Date.now() }));
            } catch (e) { /* private mode / quota exceeded */ }
        }

        function scheduleDraft() {
            clearTimeout(draftTimer);
            draftTimer = setTimeout(writeDraft, 800);
        }

        function scheduleAutosave() {
            editSeq++;
            scheduleDraft();
            if (!siteId || conflicted) return;
            clearTimeout(autosaveTimer);
            autosaveTimer = setTimeout(runAutosave, 2500);
        }

        function markDirty() {
            commitPendingCommandEdits();
            pushHistory();
            scheduleAutosave();
        }

        function runAutosave() {
            if (!siteId || autosaving || conflicted || totalBlocks() === 0) return;
            autosaving = true;
            var sendSeq = editSeq;
            setStatus("Сохранение...");
            var xhr = new win.XMLHttpRequest();
            xhr.open("POST", "/Home/EditTemplatesPost");
            xhr.setRequestHeader("X-CSRF-TOKEN", csrfToken());
            xhr.onload = function () {
                autosaving = false;
                if (xhr.status === 409) {
                    onConflict();
                } else if (xhr.status >= 200 && xhr.status < 400) {
                    try {
                        var resp = JSON.parse(xhr.responseText);
                        if (resp && resp.version) setDocVersion(resp.version);
                    } catch (e) { /* non-JSON response */ }
                    savedSeq = sendSeq;
                    if (savedSeq === editSeq) clearDraft();
                    var t = new Date();
                    setStatus("Сохранено " + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2));
                } else {
                    setStatus("Ошибка автосохранения", "lime-text-danger");
                }
            };
            xhr.onerror = function () {
                autosaving = false;
                setStatus("Нет сети", "lime-text-danger");
            };
            xhr.send(buildForm(true));
        }

        function readDraft() {
            if (!win.localStorage) return null;
            try {
                var raw = win.localStorage.getItem(DRAFT_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) { return null; }
        }

        function maybeOfferRecovery() {
            var draft = readDraft();
            if (!draft || !draft.json) return;
            var sameBase = !siteId || draft.baseVersion === getDocVersion();
            var differs = JSON.stringify(draft.json) !== JSON.stringify(getDoc());
            if (!sameBase || !differs) { clearDraft(); return; }
            showRecoveryBanner(draft);
        }

        function showRecoveryBanner(draft) {
            if (!document) return;
            var bar = document.createElement("div");
            bar.className = "lime-recovery-banner";
            bar.setAttribute("data-doc-recovery", "");
            bar.setAttribute("role", "alertdialog");
            bar.setAttribute("aria-label", "Восстановление несохранённых изменений");
            var when = new Date(draft.ts || Date.now());
            var time = ("0" + when.getHours()).slice(-2) + ":" + ("0" + when.getMinutes()).slice(-2);
            bar.innerHTML =
                '<span class="lime-recovery-banner__text">Найдены несохранённые изменения (' + time + '). Восстановить?</span>' +
                '<button type="button" class="lime-btn lime-btn--primary lime-btn--sm" data-recovery-restore>Восстановить</button>' +
                '<button type="button" class="lime-btn lime-btn--ghost lime-btn--sm" data-recovery-dismiss>Отклонить</button>';
            document.body.appendChild(bar);
            bar.querySelector("[data-recovery-restore]").addEventListener("click", function () {
                restoreDraftDocument(draft.json);
                scheduleAutosave();
                writeDraft();
                bar.remove();
                setStatus("Изменения восстановлены");
            });
            bar.querySelector("[data-recovery-dismiss]").addEventListener("click", function () {
                clearDraft();
                bar.remove();
            });
        }

        if (saveBtn) saveBtn.addEventListener("click", save);
        if (win.addEventListener) win.addEventListener("beforeunload", writeDraft);

        return {
            setStatus: setStatus,
            save: save,
            scheduleAutosave: scheduleAutosave,
            markDirty: markDirty,
            maybeOfferRecovery: maybeOfferRecovery,
            writeDraft: writeDraft,
            clearDraft: clearDraft
        };
    }

    return { create: create };
});
