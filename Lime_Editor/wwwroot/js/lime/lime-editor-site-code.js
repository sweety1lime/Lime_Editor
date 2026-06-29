/* Lime editor site code (этап 0.2: глобальный кастомный CSS + вставка в head). */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorSiteCode = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Модалка «Код сайта»: textarea с кастомным CSS (правится живьём → render обновляет холст)
    // и textarea с разметкой в <head> (только сохраняем, на холст не влияет). Открытие/закрытие
    // модалки. Сам элемент codeModal остаётся объявлен в основном файле — на него ссылается
    // command palette; сюда он прокидывается, чтобы не расходиться с тем же DOM-узлом.
    function create(options) {
        options = options || {};
        var doc = options.doc;
        var document = options.document || (typeof window !== "undefined" ? window.document : null);
        if (!doc || !document) return;

        var codeModal = options.codeModal || document.getElementById("lime-doc-code-modal");
        var beginCheckpointMutation = options.beginCheckpointMutation || function () {};
        var render = options.render || function () {};
        var markDirty = options.markDirty || function () {};

        var cssArea = document.getElementById("lime-doc-custom-css");
        var headArea = document.getElementById("lime-doc-custom-head");
        var codeOpen = document.querySelector("[data-doc-code-open]");

        if (codeOpen && codeModal) {
            codeOpen.addEventListener("click", function () {
                if (cssArea) cssArea.value = doc.customCss || "";
                if (headArea) headArea.value = doc.head || "";
                codeModal.classList.add("is-open");
            });
        }
        // CSS правим живьём — render() обновляет холст; head только сохраняем (на холст не влияет).
        if (cssArea) cssArea.addEventListener("input", function () {
            beginCheckpointMutation();
            doc.customCss = cssArea.value;
            if (!doc.customCss) delete doc.customCss;
            render(); markDirty();
        });
        if (headArea) headArea.addEventListener("input", function () {
            beginCheckpointMutation();
            doc.head = headArea.value;
            if (!doc.head) delete doc.head;
            markDirty();
        });
        document.addEventListener("click", function (e) {
            if (codeModal && e.target.closest("[data-doc-code-close]")) codeModal.classList.remove("is-open");
        });
    }

    return { create: create };
});
