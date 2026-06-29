"use strict";

// Самотест модуля box-shadow. editor-v2 тени не покрывает, поэтому проверяем здесь напрямую:
// shadowBuilder (parse → UI), add/del (parse → compose round-trip) и composeShadow (контролы → CSS).

const path = require("path");
const Shadow = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-shadow.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// toHex-стаб: #hex пропускаем, остальное (rgba/...) → #000000 (альфа парсится отдельно из rgba).
function toHex(c) {
    if (typeof c === "string" && c[0] === "#") return c.slice(0, 7);
    return "#000000";
}

// --- shadowBuilder: рендер контролов ---
{
    var api = Shadow.create({ toHex: toHex });
    var empty = api.shadowBuilder("");
    check("shadowBuilder пусто: только кнопка добавления, 0 карточек", empty.indexOf("data-doc-shadow-add") >= 0 && empty.indexOf("data-doc-shadow=") < 0);
    var one = api.shadowBuilder("0px 8px 24px 0px rgba(0,0,0,0.25)");
    check("shadowBuilder 1 тень: карточка + контролы", one.indexOf("Тень 1") >= 0 && one.indexOf('data-doc-shadow="0"') >= 0 && one.indexOf('data-k="blur"') >= 0);
}

// --- addShadow / delShadow: parse → compose round-trip через setStyle ---
{
    var captured = null;
    var style = { boxShadow: "" };
    var api = Shadow.create({
        toHex: toHex,
        byId: function () { return {}; },
        getSelectedId: function () { return "x"; },
        curStyle: function () { return style; },
        setStyle: function (prop, val) { captured = { prop: prop, val: val }; },
        refreshInspector: function () {}
    });

    api.addShadow();
    check("addShadow на пустом: один дефолтный слой", captured && captured.prop === "boxShadow" && captured.val === "0px 8px 24px 0px rgba(0,0,0,0.25)");

    style.boxShadow = "0px 8px 24px 0px rgba(0,0,0,0.25)";
    captured = null;
    api.addShadow();
    check("addShadow поверх существующего: два слоя через запятую", captured && captured.val.split(", ").length === 2);
    check("addShadow round-trip: существующий слой не исказился", captured && captured.val.indexOf("0px 8px 24px 0px rgba(0,0,0,0.25)") === 0);

    style.boxShadow = "0px 8px 24px 0px rgba(0,0,0,0.25)";
    captured = null;
    api.delShadow(0);
    check("delShadow последнего: пустая строка", captured && captured.val === "");
}

// --- composeShadow: контролы инспектора → CSS-строка ---
{
    var captured = null;
    function input(idx, k, value, checked) {
        return { getAttribute: function (n) { return n === "data-doc-shadow" ? idx : n === "data-k" ? k : null; }, value: value, checked: !!checked };
    }
    var inputs = [
        input("0", "x", "1"), input("0", "y", "2"), input("0", "blur", "3"), input("0", "spread", "4"),
        input("0", "color", "#ff0000"), input("0", "alpha", "0.5"), input("0", "inset", "", false)
    ];
    var api = Shadow.create({
        toHex: toHex,
        inspectorEl: { querySelectorAll: function () { return inputs; } },
        setStyle: function (prop, val) { captured = { prop: prop, val: val }; }
    });
    api.composeShadow();
    check("composeShadow: контролы собраны в rgba-тень", captured && captured.val === "1px 2px 3px 4px rgba(255,0,0,0.5)");
}

if (failed) {
    console.error("\nSHADOW-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nSHADOW-OK: shadowBuilder/add/del/composeShadow — зелёные");
