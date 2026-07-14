"use strict";

// Самотест модуля фона секции. Главное — регрессия на латентный баг: режим «Картинка»
// (фон содержит url(), без gradient) должен рендерить сегмент-контролы backgroundSize/
// backgroundPosition через инжектируемый seg. Раньше seg был undefined на верхнем уровне →
// переключение фона на изображение падало. Здесь проверяем оба конца: с рабочим seg контролы
// есть; без seg — image-режим бросает (фиксируем, что баг был реальным).

const path = require("path");
const Bg = require(path.join(__dirname, "..", "Lime_Editor", "wwwroot", "js", "lime", "lime-editor-section-bg.js"));

let failed = 0;
function check(name, cond) {
    if (cond) console.log("OK  " + name);
    else { failed++; console.error("FAIL " + name); }
}

// Фейк seg, повторяющий контракт inspector-controls.segmented (data-doc-style/data-val).
function seg(prop, opts, cur) {
    return '<div class="lime-segmented">' + opts.map(function (o) {
        return '<button data-doc-style="' + prop + '" data-val="' + o.v + '">' + o.l + '</button>';
    }).join("") + "</div>";
}
function baseDeps(extra) {
    var d = {
        document: {}, window: {},
        targetBlock: function (b) { return b; },
        toHex: function (c) { return c; },
        sec: function (title, body) { return '<sec title="' + title + '">' + body + "</sec>"; },
        colorRow: function (prop) { return '<colorrow prop="' + prop + '"></colorrow>'; },
        tokenSwatches: function () { return ""; }
    };
    for (var k in (extra || {})) d[k] = extra[k];
    return d;
}

var block = { content: {} };

// --- image mode (фон с url, без gradient) с рабочим seg ---
{
    var api = Bg.create(baseDeps({ seg: seg }));
    var html = api.bgInspector(block, { backgroundImage: 'url("/media/1/x.png")' });
    check("image-режим: контрол backgroundSize отрендерен", html.indexOf('data-doc-style="backgroundSize"') >= 0);
    check("image-режим: контрол backgroundPosition отрендерен", html.indexOf('data-doc-style="backgroundPosition"') >= 0);
    check("image-режим: кнопка замены изображения", html.indexOf('data-doc-bg-pick="image"') >= 0);
    check("image-режим: ряд затемнения всегда есть", html.indexOf('data-doc-overlay="alpha"') >= 0);
}

// --- регрессия: без seg image-режим (с уже выбранной картинкой) обязан бросить ---
{
    var apiNoSeg = Bg.create(baseDeps({})); // seg не передан → undefined, как было до фикса
    var threw = false;
    try { apiNoSeg.bgInspector(block, { backgroundImage: 'url("/media/1/x.png")' }); }
    catch (e) { threw = true; }
    check("без seg image-режим падает (баг был реальным)", threw === true);
}

// --- solid / gradient режимы не зависят от seg ---
{
    var api = Bg.create(baseDeps({ seg: seg }));
    var solid = api.bgInspector(block, {});
    check("solid-режим: цвет фона + затемнение", solid.indexOf('colorrow prop="backgroundColor"') >= 0 && solid.indexOf('data-doc-overlay="alpha"') >= 0);
    var grad = api.bgInspector(block, { backgroundImage: "linear-gradient(135deg, #a78bfa, #38bdf8)" });
    check("gradient-режим: угол + 2 цвета", grad.indexOf('data-doc-grad="angle"') >= 0 && grad.indexOf('data-doc-grad="c1"') >= 0);
    check("любой режим: видео-фон доступен", grad.indexOf('data-doc-bg-video') >= 0);
    // Медиа-волна: загрузка видео-файлов появилась — кнопка пикера с точечным путём bg.videoSrc
    // (старую пометку «загрузка не поддерживается» сменил реальный аплоад .mp4/.webm).
    check("видео-фон: кнопка выбора из медиатеки (kind=video)",
        grad.indexOf('data-doc-pick="bg.videoSrc"') >= 0 && grad.indexOf('data-doc-pick-kind="video"') >= 0);
}

if (failed) {
    console.error("\nSECTION-BG-SELFTEST FAILED: " + failed);
    process.exit(1);
}
console.log("\nSECTION-BG-OK: image-режим рендерит size/position-контролы (фикс seg), solid/gradient/overlay/видео — зелёные");
