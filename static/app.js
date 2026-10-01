(() => {
  "use strict";

  const csrf = document.body.dataset.csrf;
  const mainScreen = document.getElementById("screen-main");
  const paymentScreen = document.getElementById("screen-payment");
  const plateModal = document.getElementById("plate-modal");
  const plateInput = document.getElementById("plate-input");
  const paidCheck = document.getElementById("paid-check");
  const payButton = document.getElementById("btn-pay");
  let current = null;
  let paymentMethod = "cash";
  let statsLoading = false;

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    const data = await response.json().catch(() => ({ success: false, message: "Server javobi noto'g'ri" }));
    if (response.status === 401) {
      window.location.href = "/login";
      throw new Error("Kirish talab qilinadi");
    }
    if (!response.ok || data.success === false) throw new Error(data.message || "So'rov bajarilmadi");
    return data;
  }

  function showToast(message, error = false) {
    const toast = document.getElementById("toast");
    document.getElementById("toast-text").textContent = message;
    document.getElementById("toast-icon").textContent = error ? "!" : "✓";
    toast.classList.toggle("error", error);
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4200);
  }

  function showScreen(target) {
    [mainScreen, paymentScreen].forEach(screen => screen.classList.toggle("hidden", screen !== target));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setClock() {
    const now = new Date();
    document.getElementById("clock").textContent = now.toLocaleTimeString("uz-UZ", { hour12: false });
    document.getElementById("clock-date").textContent = now.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit", year: "numeric", weekday: "short" }).toUpperCase();
  }

  async function loadStats() {
    if (statsLoading) return;
    statsLoading = true;
    try {
      const data = await api("/api/stats/today");
      document.getElementById("today-count").textContent = data.count;
      document.getElementById("today-revenue").textContent = data.total_fmt;
      document.getElementById("current-price-chip").textContent = `Narx: ${Number(data.current_price).toLocaleString("ru-RU")} so'm`;
    } catch (error) {
      console.warn(error);
    } finally {
      statsLoading = false;
    }
  }

  async function checkLocalAgent() {
    const status = document.getElementById("printer-status");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    try {
      const response = await fetch("http://127.0.0.1:17832/health", { signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Printer tayyor emas");
      status.classList.remove("offline");
      status.querySelector("b").textContent = data.printer || "Tayyor";
      document.getElementById("printer-name").textContent = data.printer || "Termal printer";
    } catch (_error) {
      status.classList.add("offline");
      status.querySelector("b").textContent = "Brauzer rejimi";
      document.getElementById("printer-name").textContent = "Brauzer orqali chop etish";
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadRecentPlates() {
    const wrap = document.getElementById("recent-plates");
    try {
      const data = await api("/api/weighings/recent-plates");
      wrap.replaceChildren();
      if (!data.plates.length) {
        const empty = document.createElement("span"); empty.className = "muted"; empty.textContent = "Hali yozuv yo'q"; wrap.append(empty); return;
      }
      data.plates.forEach(plate => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = plate;
        button.addEventListener("click", () => { plateInput.value = plate; validatePlate(); });
        wrap.append(button);
      });
    } catch (_error) {
      wrap.textContent = "Oxirgi raqamlarni olib bo'lmadi";
    }
  }

  function validatePlate() {
    plateInput.value = plateInput.value.toUpperCase().replace(/\s+/g, " ").replace(/[^0-9A-ZА-ЯЁЎҚҒҲ -]/g, "");
    const valid = plateInput.value.trim().length >= 2;
    const badge = document.getElementById("plate-validation");
    badge.classList.toggle("valid", valid);
    badge.lastChild.textContent = valid ? " Format qabul qilindi" : " To'g'ri formatni kiriting";
    return valid;
  }

  function openPlateModal() {
    plateInput.value = "";
    document.getElementById("plate-error").classList.add("hidden");
    validatePlate();
    plateModal.classList.remove("hidden");
    loadRecentPlates();
    setTimeout(() => plateInput.focus(), 80);
  }

  function closePlateModal() { plateModal.classList.add("hidden"); }

  function setReceiptPreview(item) {
    document.getElementById("payment-plate").textContent = item.plate_number;
    document.getElementById("payment-price").textContent = item.price_fmt;
    document.getElementById("payment-time").textContent = item.created_at;
    document.getElementById("payment-receipt-top").textContent = `Chek #${item.receipt_no}`;
    document.getElementById("preview-plate").textContent = item.plate_number;
    document.getElementById("preview-price").textContent = `${item.price_fmt} UZS`;
    document.getElementById("preview-time").textContent = item.created_at;
    document.getElementById("preview-receipt").textContent = item.receipt_no;
    document.getElementById("payment-status-badge").textContent = "Kutilmoqda";
    document.getElementById("receipt-status").textContent = "KUTILMOQDA";
    paidCheck.checked = false;
    payButton.disabled = true;
    paymentMethod = "cash";
    document.querySelectorAll(".payment-method").forEach(button => button.classList.toggle("selected", button.dataset.method === "cash"));
    document.getElementById("receipt-payment-type").textContent = "NAQD PUL";
  }

  async function submitPlate() {
    const button = document.getElementById("btn-submit-plate");
    const errorBox = document.getElementById("plate-error");
    errorBox.classList.add("hidden");
    if (!validatePlate()) {
      errorBox.textContent = "Mashina raqamini to'liq kiriting"; errorBox.classList.remove("hidden"); plateInput.focus(); return;
    }
    button.disabled = true;
    try {
      const data = await api("/api/weighings", { method: "POST", body: JSON.stringify({ plate_number: plateInput.value.trim() }) });
      current = data.weighing;
      closePlateModal();
      setReceiptPreview(current);
      showScreen(paymentScreen);
    } catch (error) {
      errorBox.textContent = error.message; errorBox.classList.remove("hidden");
    } finally {
      button.disabled = false;
    }
  }

  async function cancelCurrent() {
    if (!current) { showScreen(mainScreen); return; }
    const button = document.getElementById("btn-cancel");
    button.disabled = true;
    try {
      await api(`/api/weighings/${current.id}/cancel`, { method: "POST" });
      current = null; showScreen(mainScreen); loadStats(); showToast("Operatsiya bekor qilindi");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function localPrint(receipt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch("http://127.0.0.1:17832/print", { method: "POST", mode: "cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(receipt), signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || "Lokal printer xatosi");
      return data;
    } finally { clearTimeout(timer); }
  }

  async function confirmAndPrint() {
    if (!current || !paidCheck.checked) return;
    const fallback = window.open("about:blank", "tarozi-receipt", "width=520,height=800");
    payButton.disabled = true;
    const original = payButton.textContent;
    payButton.textContent = "To'lov saqlanmoqda...";
    try {
      const data = await api(`/api/weighings/${current.id}/pay`, { method: "POST", body: JSON.stringify({ payment_method: paymentMethod }) });
      document.getElementById("payment-status-badge").textContent = "To'langan";
      document.getElementById("payment-status-badge").className = "badge paid";
      document.getElementById("receipt-status").textContent = "TO'LANGAN";
      payButton.textContent = "Chek chop etilmoqda...";
      try {
        const printed = await localPrint(data.receipt);
        if (fallback) fallback.close();
        showToast(`Chek ${printed.printer || "printer"}ga yuborildi`);
      } catch (_agentError) {
        if (fallback) fallback.location.href = `/receipt/${current.id}?autoprint=1`;
        else window.location.href = `/receipt/${current.id}?autoprint=1`;
        showToast("Lokal agent topilmadi — brauzer chop etish oynasi ochildi");
      }
      current = null;
      setTimeout(() => { showScreen(mainScreen); loadStats(); }, 900);
    } catch (error) {
      if (fallback) fallback.close();
      showToast(error.message, true);
      payButton.disabled = false;
    } finally {
      payButton.textContent = original;
    }
  }

  async function feedPaper() {
    const button = document.getElementById("btn-test-feed");
    button.disabled = true;
    try {
      const response = await fetch("http://127.0.0.1:17832/feed", { method: "POST", mode: "cors", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Agent ulanmagan");
      showToast("Qog'oz surildi");
    } catch (error) { showToast(error.message, true); }
    finally { button.disabled = false; }
  }

  document.getElementById("btn-start").addEventListener("click", openPlateModal);
  document.querySelectorAll("[data-close='plate-modal']").forEach(button => button.addEventListener("click", closePlateModal));
  document.getElementById("plate-clear").addEventListener("click", () => { plateInput.value = ""; validatePlate(); plateInput.focus(); });
  plateInput.addEventListener("input", validatePlate);
  plateInput.addEventListener("keydown", event => { if (event.key === "Enter") submitPlate(); });
  document.getElementById("btn-submit-plate").addEventListener("click", submitPlate);
  document.querySelectorAll(".payment-method").forEach(button => button.addEventListener("click", () => {
    paymentMethod = button.dataset.method;
    document.querySelectorAll(".payment-method").forEach(item => item.classList.toggle("selected", item === button));
    document.getElementById("receipt-payment-type").textContent = { cash: "NAQD PUL", card: "UZCARD / HUMO", bank: "HISOB RAQAM" }[paymentMethod];
  }));
  paidCheck.addEventListener("change", () => { payButton.disabled = !paidCheck.checked; });
  document.getElementById("btn-cancel").addEventListener("click", cancelCurrent);
  document.getElementById("btn-back-payment").addEventListener("click", cancelCurrent);
  payButton.addEventListener("click", confirmAndPrint);
  document.getElementById("btn-test-feed").addEventListener("click", feedPaper);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !plateModal.classList.contains("hidden")) closePlateModal(); });

  setClock(); setInterval(setClock, 1000);
  loadStats(); setInterval(loadStats, 30000);
  checkLocalAgent(); setInterval(checkLocalAgent, 30000);
})();
