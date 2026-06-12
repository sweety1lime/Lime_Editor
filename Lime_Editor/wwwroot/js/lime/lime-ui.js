/* ============================================================
   Lime · shared UI behaviours (vanilla, no deps)
   - scroll reveal (visible base; IO + scroll + catch-all)
   - animated stat counters
   - nav avatar dropdown
   - hero mockup typeout loop
   - magnetic primary/violet buttons
   ============================================================ */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- scroll reveal — bulletproof: IO + scroll + catch-all timer.
  function show(el) { el.classList.add("is-in"); }
  function revealPass() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    document.querySelectorAll(".reveal:not(.is-in)").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.95 && r.bottom > -50) show(el);
    });
  }
  try {
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } catch (e) { /* timers below cover it */ }
  revealPass();
  requestAnimationFrame(revealPass);
  ["scroll", "resize", "wheel", "touchmove", "load"].forEach(function (ev) {
    window.addEventListener(ev, revealPass, { passive: true });
  });
  document.addEventListener("scroll", revealPass, { passive: true, capture: true });
  setTimeout(revealPass, 300);
  setTimeout(function () { document.querySelectorAll(".reveal:not(.is-in)").forEach(show); }, 1800);

  // ---- animated counters
  function fmt(n, suffix) { return (Number.isInteger(n) ? n : n.toFixed(1)) + (suffix || ""); }
  function runCounter(el) {
    if (el.dataset.done) return; el.dataset.done = "1";
    var target = parseFloat(el.dataset.count);
    var suffix = el.dataset.suffix || "";
    if (reduce || isNaN(target)) { el.textContent = fmt(isNaN(target) ? 0 : target, suffix); return; }
    var dur = 1300, start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Number.isInteger(target) ? Math.round(target * eased) + suffix : (target * eased).toFixed(1) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(target, suffix);
    }
    requestAnimationFrame(tick);
  }
  function counterPass() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.9 && r.bottom > 0) runCounter(el);
    });
  }
  counterPass();
  ["scroll", "wheel", "touchmove"].forEach(function (ev) { window.addEventListener(ev, counterPass, { passive: true }); });
  document.addEventListener("scroll", counterPass, { passive: true, capture: true });
  setTimeout(counterPass, 500);
  setTimeout(function () { document.querySelectorAll("[data-count]").forEach(runCounter); }, 1800);

  // ---- nav avatar dropdown
  document.querySelectorAll("[data-lime-dropdown]").forEach(function (trigger) {
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var dd = trigger.closest(".lime-dropdown");
      if (dd) dd.classList.toggle("is-open");
    });
  });
  document.addEventListener("click", function () {
    document.querySelectorAll(".lime-dropdown.is-open").forEach(function (d) { d.classList.remove("is-open"); });
  });

  // ---- hero mockup typeout loop
  var typeEl = document.querySelector("[data-typeloop]");
  if (typeEl) {
    var phrases;
    try { phrases = JSON.parse(typeEl.dataset.typeloop); } catch (e) { phrases = []; }
    if (phrases.length) {
      if (reduce) {
        typeEl.textContent = phrases[0];
      } else {
        var pi = 0;
        var runPhrase = function () {
          var full = phrases[pi], i = 0;
          typeEl.innerHTML = '<span class="lime-ty"></span><span class="lime-caret"></span>';
          var span = typeEl.querySelector(".lime-ty");
          var iv = setInterval(function () {
            i++;
            span.textContent = full.slice(0, i);
            if (i >= full.length) {
              clearInterval(iv);
              setTimeout(function () { pi = (pi + 1) % phrases.length; runPhrase(); }, 2400);
            }
          }, 55);
        };
        runPhrase();
      }
    }
  }

  // ---- magnetic primary/violet buttons (subtle)
  if (!reduce) {
    document.querySelectorAll(".lime-btn--primary, .lime-btn--violet").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        var r = btn.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * 0.12;
        var y = (e.clientY - r.top - r.height / 2) * 0.2;
        btn.style.transform = "translate(" + x + "px, " + y + "px) translateY(-2px)";
      });
      btn.addEventListener("mouseleave", function () { btn.style.transform = ""; });
    });
  }
})();
