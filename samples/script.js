const banner = document.getElementById("cookie-banner");
const accept = document.getElementById("cookie-accept");
const instagramUrl = window.siteConfig && window.siteConfig.instagramUrl;

document.querySelectorAll("[data-instagram-link]").forEach((link) => {
  if (instagramUrl) {
    link.href = instagramUrl;
  } else {
    link.hidden = true;
  }
});

if (banner && accept && localStorage.getItem("morika_cookie_consent") !== "yes") {
  banner.hidden = false;
  accept.addEventListener("click", () => {
    localStorage.setItem("morika_cookie_consent", "yes");
    banner.hidden = true;
  });
}

document.querySelectorAll(".track-link").forEach((link) => {
  link.addEventListener("click", () => {
    const name = link.getAttribute("data-conversion") || "contact";
    if (typeof window.gtag === "function") {
      window.gtag("event", "conversion_click", { method: name });
    }
  });
});
