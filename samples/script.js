const countdownEl = document.getElementById("countdown");
if (countdownEl) {
  const key = "morika_lp_offer_deadline";
  const dayMs = 24 * 60 * 60 * 1000;
  let deadline = Number(localStorage.getItem(key));
  const now = Date.now();
  if (!deadline || deadline <= now) {
    deadline = now + dayMs;
    localStorage.setItem(key, String(deadline));
  }

  function tick() {
    const remain = Math.max(0, deadline - Date.now());
    const hours = Math.floor(remain / 3600000);
    const minutes = Math.floor((remain % 3600000) / 60000);
    const seconds = Math.floor((remain % 60000) / 1000);
    countdownEl.textContent = [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  tick();
  setInterval(tick, 1000);
}
