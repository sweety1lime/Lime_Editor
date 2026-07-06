/*
 * Lime WebGL (Премиум-слой B) — курируемые WebGL-эффекты опубликованной страницы.
 * Без three.js и произвольного пользовательского JS: только ДВА параметризуемых эффекта,
 * параметры приходят data-атрибутами из JSON-документа (числа/цвет, санитизированы рендером).
 *
 *  1. Частицы (data-gl-particles на декор-слое): дрейфующее поле точек в цвет темы,
 *     мягко разбегается от курсора. Слой растянут на секцию (lime-doc.js layersHtml).
 *  2. Искажение картинок (.lime-fx-gl-distort на секции): волновой ripple по ховеру
 *     поверх <img>; исходный <img> остаётся в DOM (доступность/SEO/фолбэк).
 *
 * Деградация: нет WebGL / prefers-reduced-motion / тач — эффекты просто не включаются,
 * страница остаётся полностью рабочей. Рендер-циклы останавливаются вне вьюпорта
 * (IntersectionObserver) и на скрытой вкладке. DPR зажат до 1.75 — бюджет производительности.
 */
(function () {
    "use strict";

    function mq(q) { return window.matchMedia && window.matchMedia(q).matches; }
    if (document.querySelector(".lime-editor")) return; // только публичная страница
    if (mq("(prefers-reduced-motion: reduce)")) return;

    var DPR = Math.min(window.devicePixelRatio || 1, 1.75);

    function createGl(canvas) {
        try {
            return canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true }) || null;
        } catch (e) { return null; }
    }

    function compile(gl, type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
        return sh;
    }

    function program(gl, vsSrc, fsSrc) {
        var vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
        var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        var p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
        return p;
    }

    function hexToRgb(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
        if (!m) return [0.77, 0.95, 0.31]; // дефолт — lime-акцент
        var n = parseInt(m[1], 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    // Акцент темы из CSS-переменной --lt-accent (тема эмитит hex в :root).
    function themeAccent() {
        try {
            var v = getComputedStyle(document.documentElement).getPropertyValue("--lt-accent");
            return v ? v.trim() : "";
        } catch (e) { return ""; }
    }

    // Общий каркас рендер-цикла: играет только когда элемент видим и вкладка активна.
    function loopWhileVisible(el, frame) {
        var visible = false, rafId = 0;
        function loop(t) {
            if (!visible || document.hidden) { rafId = 0; return; }
            frame(t);
            rafId = requestAnimationFrame(loop);
        }
        function kick() { if (!rafId && visible && !document.hidden) rafId = requestAnimationFrame(loop); }
        if (window.IntersectionObserver) {
            new IntersectionObserver(function (entries) {
                visible = entries[0].isIntersecting;
                kick();
            }, { rootMargin: "80px" }).observe(el);
        } else { visible = true; kick(); }
        document.addEventListener("visibilitychange", kick);
        return kick;
    }

    /* ============================ 1. Частицы ============================ */

    var PARTICLE_VS =
        "attribute vec4 a_seed;" + // x,y — базовая позиция (0..1); z — фаза; w — размер
        "uniform float u_time; uniform vec2 u_res; uniform vec2 u_mouse; uniform float u_speed;" +
        "varying float v_alpha;" +
        "void main(){" +
        "  vec2 p = a_seed.xy;" +
        "  p.x += sin(u_time*0.06*u_speed + a_seed.z*6.283)*0.035;" +
        "  p.y = fract(p.y + u_time*0.008*u_speed*(0.4+a_seed.w*0.6));" +
        "  vec2 px = p*u_res;" +
        "  vec2 d = px - u_mouse;" +
        "  float dist = length(d);" +
        "  float r = 140.0;" +
        "  if (dist < r && dist > 0.5) { px += normalize(d)*(1.0-dist/r)*34.0; }" +
        "  vec2 clip = (px/u_res)*2.0-1.0;" +
        "  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);" +
        "  gl_PointSize = (1.5 + a_seed.w*2.5) * " + DPR.toFixed(2) + ";" +
        "  v_alpha = 0.25 + a_seed.w*0.55;" +
        "}";
    var PARTICLE_FS =
        "precision mediump float; uniform vec3 u_color; varying float v_alpha;" +
        "void main(){" +
        "  float d = length(gl_PointCoord - vec2(0.5));" +
        "  if (d > 0.5) discard;" +
        "  float a = smoothstep(0.5, 0.15, d) * v_alpha;" +
        "  gl_FragColor = vec4(u_color*a, a);" + // premultiplied
        "}";

    function initParticles(layer) {
        var count = Math.max(10, Math.min(300, parseFloat(layer.getAttribute("data-gl-count")) || 80));
        var speed = Math.max(0.1, Math.min(4, parseFloat(layer.getAttribute("data-gl-speed")) || 1));
        var color = hexToRgb(layer.getAttribute("data-gl-color") || themeAccent());

        var canvas = document.createElement("canvas");
        canvas.className = "lime-gl-canvas";
        layer.appendChild(canvas);
        var gl = createGl(canvas);
        if (!gl) { layer.removeChild(canvas); return; }
        var prog = program(gl, PARTICLE_VS, PARTICLE_FS);
        if (!prog) { layer.removeChild(canvas); return; }

        var seeds = new Float32Array(count * 4);
        for (var i = 0; i < count; i++) {
            seeds[i * 4] = Math.random();
            seeds[i * 4 + 1] = Math.random();
            seeds[i * 4 + 2] = Math.random();
            seeds[i * 4 + 3] = Math.random();
        }
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
        gl.useProgram(prog);
        var aSeed = gl.getAttribLocation(prog, "a_seed");
        gl.enableVertexAttribArray(aSeed);
        gl.vertexAttribPointer(aSeed, 4, gl.FLOAT, false, 0, 0);
        var uTime = gl.getUniformLocation(prog, "u_time");
        var uRes = gl.getUniformLocation(prog, "u_res");
        var uMouse = gl.getUniformLocation(prog, "u_mouse");
        var uSpeed = gl.getUniformLocation(prog, "u_speed");
        gl.uniform3fv(gl.getUniformLocation(prog, "u_color"), color);
        gl.uniform1f(uSpeed, speed);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        var mx = -1000, my = -1000;
        var host = layer.closest(".lime-block") || layer;
        host.addEventListener("mousemove", function (e) {
            var r = layer.getBoundingClientRect();
            mx = (e.clientX - r.left) * DPR;
            my = (e.clientY - r.top) * DPR;
        }, { passive: true });
        host.addEventListener("mouseleave", function () { mx = -1000; my = -1000; });

        function resize() {
            var w = Math.max(1, Math.round(layer.clientWidth * DPR));
            var h = Math.max(1, Math.round(layer.clientHeight * DPR));
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w; canvas.height = h;
                gl.viewport(0, 0, w, h);
            }
        }
        window.addEventListener("resize", resize);

        loopWhileVisible(layer, function (t) {
            resize();
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(uTime, t * 0.001 * 60);
            gl.uniform2f(uRes, canvas.width, canvas.height);
            gl.uniform2f(uMouse, mx, my);
            gl.drawArrays(gl.POINTS, 0, count);
        });
    }

    /* ======================= 2. Искажение картинок ======================= */

    var DISTORT_VS =
        "attribute vec2 a_pos; varying vec2 v_uv;" +
        "void main(){ v_uv = a_pos*0.5+0.5; v_uv.y = 1.0-v_uv.y; gl_Position = vec4(a_pos,0.,1.); }";
    var DISTORT_FS =
        "precision mediump float; uniform sampler2D u_tex; uniform vec2 u_mouse;" +
        "uniform float u_strength; uniform float u_time; varying vec2 v_uv;" +
        "void main(){" +
        "  vec2 d = v_uv - u_mouse;" +
        "  float dist = length(d);" +
        "  float ripple = sin(dist*28.0 - u_time*5.0) * u_strength * smoothstep(0.45, 0.0, dist);" +
        "  vec2 uv = v_uv + normalize(d + 0.0001) * ripple * 0.05;" +
        "  gl_FragColor = texture2D(u_tex, uv);" +
        "}";

    function initDistort(img) {
        if (!img.complete || !img.naturalWidth) {
            img.addEventListener("load", function () { initDistort(img); }, { once: true });
            return;
        }
        // Текстуру берём через CORS-копию: чужой origin без CORS-заголовков не даст безопасно
        // прочитать пиксели — тогда молча оставляем обычный <img> (graceful fallback).
        var src = new Image();
        src.crossOrigin = "anonymous";
        src.onload = function () {
            var wrap = document.createElement("span");
            wrap.className = "lime-gl-imgwrap";
            img.parentNode.insertBefore(wrap, img);
            wrap.appendChild(img);
            var canvas = document.createElement("canvas");
            canvas.className = "lime-gl-canvas";
            wrap.appendChild(canvas);
            var gl = createGl(canvas);
            var prog = gl && program(gl, DISTORT_VS, DISTORT_FS);
            if (!gl || !prog) { wrap.removeChild(canvas); return; }

            gl.useProgram(prog);
            var buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            var aPos = gl.getAttribLocation(prog, "a_pos");
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            } catch (e) { wrap.removeChild(canvas); return; }
            var uMouse = gl.getUniformLocation(prog, "u_mouse");
            var uStrength = gl.getUniformLocation(prog, "u_strength");
            var uTime = gl.getUniformLocation(prog, "u_time");

            var mx = 0.5, my = 0.5, strength = 0, target = 0;
            wrap.addEventListener("mousemove", function (e) {
                var r = wrap.getBoundingClientRect();
                mx = (e.clientX - r.left) / r.width;
                my = (e.clientY - r.top) / r.height;
                target = 1;
                kick();
            }, { passive: true });
            wrap.addEventListener("mouseleave", function () { target = 0; kick(); });

            function resize() {
                var w = Math.max(1, Math.round(wrap.clientWidth * DPR));
                var h = Math.max(1, Math.round(wrap.clientHeight * DPR));
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w; canvas.height = h;
                    gl.viewport(0, 0, w, h);
                }
            }

            var kick = loopWhileVisible(wrap, function (t) {
                strength += (target - strength) * 0.08;
                resize();
                // Канвас показываем только когда эффект реально играет: в покое рендерит <img>.
                var active = strength > 0.01;
                canvas.style.opacity = active ? "1" : "0";
                if (!active) return;
                gl.uniform2f(uMouse, mx, my);
                gl.uniform1f(uStrength, strength);
                gl.uniform1f(uTime, t * 0.001);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            });
        };
        src.onerror = function () { /* фолбэк: остаётся обычный <img> */ };
        src.src = img.currentSrc || img.src;
    }

    function init() {
        Array.prototype.forEach.call(document.querySelectorAll("[data-gl-particles]"), initParticles);
        if (!mq("(hover: none)")) {
            Array.prototype.forEach.call(document.querySelectorAll(".lime-fx-gl-distort"), function (sec) {
                Array.prototype.forEach.call(sec.querySelectorAll(".lime-block__inner img"), initDistort);
            });
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
