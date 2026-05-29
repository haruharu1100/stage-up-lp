/* ==========================================================
   STAGE UP LP — interaction scripts
   - 純粋なバニラJS / 依存なし
   ========================================================== */
(function () {
  "use strict";

  /* ---- ① ヘッダーのスクロール時スタイル ---- */
  var header = document.getElementById("site-header");
  function onScrollHeader() {
    if (!header) return;
    if (window.scrollY > 32) header.classList.add("is-scrolled");
    else header.classList.remove("is-scrolled");
  }
  window.addEventListener("scroll", onScrollHeader, { passive: true });
  onScrollHeader();

  /* ---- ② モバイルメニューの開閉 ---- */
  var toggle = document.getElementById("menu-toggle");
  var menu = document.getElementById("nav-mobile");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      menu.classList.toggle("is-open");
      menu.setAttribute("aria-hidden", String(expanded));
    });
    // クリックで自動的に閉じる
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        toggle.setAttribute("aria-expanded", "false");
        menu.classList.remove("is-open");
        menu.setAttribute("aria-hidden", "true");
      });
    });
  }

  /* ---- ③ FAQ アコーディオン ---- */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var btn = item.querySelector(".faq-q");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var isOpen = item.getAttribute("data-open") === "true";
      // 1つだけ開きたい場合は全部閉じる：
      document.querySelectorAll(".faq-item").forEach(function (other) {
        other.setAttribute("data-open", "false");
        var q = other.querySelector(".faq-q");
        if (q) q.setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.setAttribute("data-open", "true");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---- ④ フローティングバーの表示制御（モバイル） ---- */
  var floatingBar = document.getElementById("floating-bar");
  function onScrollFloating() {
    if (!floatingBar) return;
    if (window.scrollY > 400) floatingBar.classList.add("is-visible");
    else floatingBar.classList.remove("is-visible");
  }
  window.addEventListener("scroll", onScrollFloating, { passive: true });
  onScrollFloating();

  /* ---- ⑤ スクロール出現アニメーション ---- */
  var revealTargets = document.querySelectorAll(
    ".section-head, .card, .case-card, .voice-card, .pricing-card, .future-list > *, .hero-stats > *, .stat-grid > *"
  );
  revealTargets.forEach(function (el) {
    el.classList.add("reveal");
  });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -80px 0px", threshold: 0.1 }
    );
    revealTargets.forEach(function (el) {
      io.observe(el);
    });
  } else {
    // 古いブラウザでは即時表示
    revealTargets.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  /* ---- ⑥ Calendly ポップアップ ---- */
  // ▼ ご自身のCalendly URL に差し替えてください
  var CALENDLY_URL = "https://calendly.com/your-account/30min";
  document.querySelectorAll("[data-calendly]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (window.Calendly && typeof window.Calendly.initPopupWidget === "function") {
        window.Calendly.initPopupWidget({ url: CALENDLY_URL });
      } else {
        // 読み込み前のフォールバック：新しいタブで開く
        window.open(CALENDLY_URL, "_blank", "noopener");
      }
    });
  });

  /* ---- ⑦ 年号を自動表示 ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
