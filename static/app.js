(() => {
  "use strict";

  const csrf = document.body.dataset.csrf;
  const mainScreen = document.getElementById("screen-main");
  const paymentScreen = document.getElementById("screen-payment");
  const plateModal = document.getElementById("plate-modal");
  const plateInput = document.getElementById("plate-input");
  const paidCheck = document.getElementById("paid-check");
  const payButton = document.getElementById("btn-pay");
  const weightInput = document.getElementById("weight-input");
  const entryService = document.getElementById("service-entry");
  const reloadService = document.getElementById("service-reload");
  let current = null;
  let paymentMethod = "cash";
  let servicePrices = { weighing: 30000, entry: 30000, reload: 30000 };
  let statsLoading = false;
  let lastSyncVersion = null;
  let syncLoading = false;
  let journalDay = "today";
  let journalPage = 1;
  let journalPages = 1;
  let journalRequestId = 0;
  const fmt = value => Number(value || 0).toLocaleString("ru-RU").replace(/\u00a0/g, " ");

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
      servicePrices = { weighing: Number(data.current_price), entry: Number(data.entry_price), reload: Number(data.reload_price) };
      if (current) renderPricing();
    } catch (error) {
      console.warn(error);
    } finally {
      statsLoading = false;
    }
  }

  async function pollSync() {
    if (syncLoading || document.hidden) return;
    syncLoading = true;
    try {
      const data = await api("/api/sync/state");
      if (lastSyncVersion && data.version !== lastSyncVersion) await loadStats();
      lastSyncVersion = data.version;
    } catch (error) {
      console.warn("Sinxronlash vaqtincha mavjud emas", error);
    } finally {
      syncLoading = false;
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

  function journalCell(text, className = "") {
    const cell = document.createElement("td"); cell.textContent = text ?? "—"; if (className) cell.className = className; return cell;
  }

  function journalStatus(status) {
    const span = document.createElement("span"); span.className = `badge ${status}`;
    span.textContent = status === "paid" ? "To'langan" : status === "pending" ? "Kutilmoqda" : "Bekor qilingan";
    return span;
  }

  async function loadOperatorJournal() {
    const requestId = ++journalRequestId;
    const body = document.getElementById("operator-journal-body");
    const loadingRow = document.createElement("tr"); const loadingCell = journalCell("Yuklanmoqda...", "table-empty"); loadingCell.colSpan = 7; loadingRow.append(loadingCell); body.replaceChildren(loadingRow);
    try {
      const params = new URLSearchParams({ day: journalDay, page: journalPage, per_page: document.getElementById("operator-journal-size").value });
      const query = document.getElementById("operator-journal-search").value.trim(); const status = document.getElementById("operator-journal-status").value;
      if (query) params.set("q", query); if (status) params.set("status", status);
      const data = await api(`/api/operator/weighings?${params}`); if (requestId !== journalRequestId) return; journalPages = data.total_pages; body.replaceChildren();
      if (!data.results.length) { const row = document.createElement("tr"); const cell = journalCell("Bu kunda ma'lumot topilmadi", "table-empty"); cell.colSpan = 7; row.append(cell); body.append(row); }
      data.results.forEach(item => {
        const row = document.createElement("tr"); row.append(journalCell(item.receipt_no), journalCell(item.plate_number), journalCell(`${item.weight_fmt} kg`), journalCell(`${item.total_fmt} so'm`), journalCell(item.time));
        const state = document.createElement("td"); state.append(journalStatus(item.status)); row.append(state);
        const action = document.createElement("td");
        if (item.status === "paid") { const link = document.createElement("a"); link.className = "button secondary journal-receipt-link"; link.href = `/receipt/${item.id}`; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Chekni ko'rish"; action.append(link); } else action.textContent = "—";
        row.append(action); body.append(row);
      });
      document.getElementById("operator-journal-date").textContent = `${data.date_label} kungi operatsiyalar`;
      document.getElementById("operator-journal-total").textContent = `${data.total} ta yozuv`;
      document.getElementById("operator-journal-page").textContent = `${data.page} / ${data.total_pages}`;
      document.getElementById("operator-journal-prev").disabled = data.page <= 1;
      document.getElementById("operator-journal-next").disabled = data.page >= data.total_pages;
    } catch (error) {
      if (requestId !== journalRequestId) return;
      const row = document.createElement("tr"); const cell = journalCell(error.message, "table-empty"); cell.colSpan = 7; row.append(cell); body.replaceChildren(row);
    }
  }

  function openOperatorJournal() {
    journalDay = "today"; journalPage = 1;
    document.querySelectorAll("[data-journal-day]").forEach(button => button.classList.toggle("active", button.dataset.journalDay === journalDay));
    document.getElementById("operator-journal-modal").classList.remove("hidden"); loadOperatorJournal();
  }

  async function saveOperatorBackup() {
    const button = document.getElementById("operator-backup"); const original = button.innerHTML; button.disabled = true;
    try {
      let directory = null;
      if ("showDirectoryPicker" in window) directory = await window.showDirectoryPicker({ mode: "readwrite" });
      button.textContent = "Backup tayyorlanmoqda...";
      const response = await fetch("/api/backup/download", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { window.location.href = "/login"; return; }
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || "Backup olinmadi"); }
      const blob = await response.blob(); const now = new Date(); const date = now.toLocaleDateString("uz-UZ").replace(/\//g, "."); const filename = `${date} 00-00 holatiga backup.db`;
      if (directory) {
        const file = await directory.getFileHandle(filename, { create: true }); const writable = await file.createWritable(); await writable.write(blob); await writable.close(); showToast(`Backup tanlangan papkaga saqlandi: ${filename}`);
      } else {
        const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); showToast("Brauzer papka tanlashni qo'llamaydi — backup Downloads papkasiga saqlandi");
      }
    } catch (error) { if (error.name !== "AbortError") showToast(error.message, true); }
    finally { button.disabled = false; button.innerHTML = original; }
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

  function validWeight(showError = false) {
    const value = Number(weightInput.value);
    const valid = Number.isInteger(value) && value >= 1 && value <= 1000000;
    const error = document.getElementById("weight-error");
    error.classList.toggle("error", showError && !valid);
    error.textContent = showError && !valid ? "Vaznni 1–1 000 000 kg oralig'ida kiriting" : "1 dan 1 000 000 kg gacha";
    return valid;
  }

  function updatePayAvailability() {
    payButton.disabled = !(paidCheck.checked && validWeight(false));
  }

  function renderPricing() {
    if (!current) return;
    const base = Number(current.weighing_fee ?? current.price ?? servicePrices.weighing);
    const entry = entryService.checked ? Number(servicePrices.entry) : 0;
    const reload = reloadService.checked ? Number(servicePrices.reload) : 0;
    const total = base + entry + reload;
    const weight = Math.max(0, Number(weightInput.value) || 0);
    document.getElementById("payment-price").textContent = fmt(base);
    document.getElementById("entry-service-price").textContent = fmt(servicePrices.entry);
    document.getElementById("reload-service-price").textContent = fmt(servicePrices.reload);
    document.getElementById("grand-total-value").textContent = fmt(total);
    document.getElementById("preview-weight").textContent = fmt(weight);
    document.getElementById("preview-weighing-fee").textContent = `${fmt(base)} so'm`;
    document.getElementById("preview-entry-fee").textContent = `${fmt(entry)} so'm`;
    document.getElementById("preview-reload-fee").textContent = `${fmt(reload)} so'm`;
    document.getElementById("preview-entry-row").classList.toggle("hidden", !entryService.checked);
    document.getElementById("preview-reload-row").classList.toggle("hidden", !reloadService.checked);
    document.getElementById("preview-price").textContent = `${fmt(total)} so'm`;
    updatePayAvailability();
  }

  function setReceiptPreview(item) {
    document.getElementById("payment-plate").textContent = item.plate_number;
    document.getElementById("payment-time").textContent = item.created_at;
    document.getElementById("payment-receipt-top").textContent = `Chek #${item.receipt_no}`;
    document.getElementById("preview-plate").textContent = item.plate_number;
    document.getElementById("preview-time").textContent = item.created_at;
    document.getElementById("preview-receipt").textContent = item.receipt_no;
    document.getElementById("payment-status-badge").textContent = "Kutilmoqda";
    document.getElementById("payment-status-badge").className = "badge pending";
    document.getElementById("receipt-status").textContent = "KUTILMOQDA";
    paidCheck.checked = false;
    weightInput.value = "";
    entryService.checked = false;
    reloadService.checked = false;
    payButton.disabled = true;
    paymentMethod = "cash";
    document.querySelectorAll(".payment-method").forEach(button => button.classList.toggle("selected", button.dataset.method === "cash"));
    document.getElementById("receipt-payment-type").textContent = "NAQD PUL";
    renderPricing();
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
      if (data.service_prices) servicePrices = data.service_prices;
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
    if (!validWeight(true)) { weightInput.focus(); updatePayAvailability(); return; }
    const fallback = window.open("about:blank", "tarozi-receipt", "width=520,height=800");
    payButton.disabled = true;
    const original = payButton.textContent;
    payButton.textContent = "To'lov saqlanmoqda...";
    try {
      const weighingId = current.id;
      const data = await api(`/api/weighings/${weighingId}/pay`, { method: "POST", body: JSON.stringify({ payment_method: paymentMethod, weight_kg: Number(weightInput.value), entry_service: entryService.checked, reload_service: reloadService.checked }) });
      document.getElementById("payment-status-badge").textContent = "To'langan";
      document.getElementById("payment-status-badge").className = "badge paid";
      document.getElementById("receipt-status").textContent = "TO'LANGAN";
      document.getElementById("preview-weight").textContent = data.receipt.weight_fmt;
      document.getElementById("preview-weighing-fee").textContent = `${data.receipt.weighing_fee_fmt} so'm`;
      document.getElementById("preview-entry-fee").textContent = `${data.receipt.entry_fee_fmt} so'm`;
      document.getElementById("preview-reload-fee").textContent = `${data.receipt.reload_fee_fmt} so'm`;
      document.getElementById("preview-price").textContent = `${data.receipt.total_fmt} so'm`;
      document.getElementById("grand-total-value").textContent = data.receipt.total_fmt;
      if (fallback) fallback.location.href = `/receipt/${weighingId}`;
      payButton.textContent = "Chek chop etilmoqda...";
      try {
        const printed = await localPrint(data.receipt);
        showToast(`Chek ${printed.printer || "printer"}ga yuborildi`);
      } catch (_agentError) {
        if (fallback) fallback.location.href = `/receipt/${weighingId}?autoprint=1`;
        else window.location.href = `/receipt/${weighingId}?autoprint=1`;
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
  document.getElementById("operator-journal-open").addEventListener("click", openOperatorJournal);
  document.getElementById("operator-journal-close").addEventListener("click", () => document.getElementById("operator-journal-modal").classList.add("hidden"));
  document.querySelectorAll("[data-journal-day]").forEach(button => button.addEventListener("click", () => { journalDay = button.dataset.journalDay; journalPage = 1; document.querySelectorAll("[data-journal-day]").forEach(item => item.classList.toggle("active", item === button)); loadOperatorJournal(); }));
  document.getElementById("operator-journal-search-btn").addEventListener("click", () => { journalPage = 1; loadOperatorJournal(); });
  document.getElementById("operator-journal-search").addEventListener("keydown", event => { if (event.key === "Enter") { journalPage = 1; loadOperatorJournal(); } });
  document.getElementById("operator-journal-status").addEventListener("change", () => { journalPage = 1; loadOperatorJournal(); });
  document.getElementById("operator-journal-size").addEventListener("change", () => { journalPage = 1; loadOperatorJournal(); });
  document.getElementById("operator-journal-prev").addEventListener("click", () => { if (journalPage > 1) { journalPage -= 1; loadOperatorJournal(); } });
  document.getElementById("operator-journal-next").addEventListener("click", () => { if (journalPage < journalPages) { journalPage += 1; loadOperatorJournal(); } });
  document.getElementById("operator-backup").addEventListener("click", saveOperatorBackup);
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
  weightInput.addEventListener("input", () => { if (weightInput.value.length > 7) weightInput.value = weightInput.value.slice(0, 7); validWeight(false); renderPricing(); });
  entryService.addEventListener("change", renderPricing);
  reloadService.addEventListener("change", renderPricing);
  paidCheck.addEventListener("change", updatePayAvailability);
  document.getElementById("btn-cancel").addEventListener("click", cancelCurrent);
  document.getElementById("btn-back-payment").addEventListener("click", cancelCurrent);
  payButton.addEventListener("click", confirmAndPrint);
  document.getElementById("btn-test-feed").addEventListener("click", feedPaper);
  document.addEventListener("keydown", event => { if (event.key !== "Escape") return; if (!plateModal.classList.contains("hidden")) closePlateModal(); else document.getElementById("operator-journal-modal").classList.add("hidden"); });

  setClock(); setInterval(setClock, 1000);
  loadStats(); pollSync(); setInterval(pollSync, 12000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollSync(); loadStats(); } });
  checkLocalAgent(); setInterval(checkLocalAgent, 30000);
})();
