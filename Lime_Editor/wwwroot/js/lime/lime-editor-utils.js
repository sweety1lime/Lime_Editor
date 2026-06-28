/* Lime editor shared utility helpers. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LimeEditorUtils = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function escapeText(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function rid(prefix) {
        return (prefix || "b") + Math.random().toString(36).slice(2, 9);
    }

    function csrfToken(doc) {
        doc = doc || (typeof document !== "undefined" ? document : null);
        var meta = doc ? doc.querySelector('meta[name="X-CSRF-TOKEN"]') : null;
        return meta ? meta.content : "";
    }

    function setByPath(obj, path, val) {
        var parts = path.split(".");
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            var key = parts[i];
            if (cur[key] == null) cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
            cur = cur[key];
        }
        cur[parts[parts.length - 1]] = val;
    }

    function deleteByPath(obj, path) {
        var parts = path.split(".");
        var nodes = [obj];
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            if (cur == null || typeof cur !== "object" || !(parts[i] in cur)) return false;
            cur = cur[parts[i]];
            nodes.push(cur);
        }
        if (cur == null || !Object.prototype.hasOwnProperty.call(cur, parts[parts.length - 1])) return false;
        delete cur[parts[parts.length - 1]];
        for (var j = nodes.length - 1; j > 0; j--) {
            if (Object.keys(nodes[j]).length) break;
            delete nodes[j - 1][parts[j - 1]];
        }
        return true;
    }

    return {
        escapeText: escapeText,
        rid: rid,
        csrfToken: csrfToken,
        setByPath: setByPath,
        deleteByPath: deleteByPath
    };
});
