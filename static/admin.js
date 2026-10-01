(() => {
  "use strict";
  const csrf = document.body.dataset.csrf;
  const role = document.body.dataset.role;
  let weeklyData = [];
  let reportData = [];
  let systemData = [];
  let historyPage = 1;
  let historyPages = 1;
  let searchPage = 1;
  let searchPages = 1;
  let resetUserId = null;
  let selectedDetail = null;
  let monitorTimer = null;

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrf);
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    const data = await response.json().catch(() => ({ success: false, message: "Server javobi noto'g'ri" }));
    if (response.status === 401) { window.location.href = "/login"; throw new Error("Kirish talab qilinadi"); }
    if (!response.ok || data.success === false) throw new Error(data.message || "So'rov bajarilmadi");
    return data;
  }

  function showToast(message, error = false) {
    const toast = document.getElementById("toast");
    document.getElementById("toast-text").textContent = message;
    document.getElementById("toast-icon").textContent = error ? "!" : "✓";
    toast.classList.toggle("error", error); toast.classList.remove("hidden");
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4300);
  }

  function setBusy(button, busy, text = "Bajarilmoqda...") {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy; button.textContent = busy ? text : button.dataset.label;
  }
  const fmt = value => Number(value || 0).toLocaleString("ru-RU").replace(/\u00a0/g, " ");
  const isoDate = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const bytes = value => {
    let n = Number(value || 0); const units = ["B", "KB", "MB", "GB", "TB"]; let index = 0;
    while (n >= 1024 && index < units.length - 1) { n /= 1024; index += 1; }
    return `${n.toFixed(index ? 1 : 0)} ${units[index]}`;
  };
  const uptime = seconds => { const d = Math.floor(seconds / 86400); const h = Math.floor(seconds % 86400 / 3600); const m = Math.floor(seconds % 3600 / 60); return d ? `${d} kun ${h} soat` : h ? `${h} soat ${m} daq` : `${m} daqiqa`; };

  function td(text, className = "") { const cell = document.createElement("td"); cell.textContent = text ?? "—"; if (className) cell.className = className; return cell; }
  function emptyRow(body, columns, text) { body.replaceChildren(); const row = document.createElement("tr"); const cell = td(text, "table-empty"); cell.colSpan = columns; row.append(cell); body.append(row); }
  function badge(status) { const span = document.createElement("span"); span.className = `badge ${status}`; span.textContent = status === "paid" ? "To'langan" : status === "pending" ? "Kutilmoqda" : "Bekor qilingan"; return span; }

  function setClock() { document.getElementById("admin-clock").textContent = new Date().toLocaleTimeString("uz-UZ", { hour12: false }); }
  async function checkAgent() {
    const label = document.getElementById("admin-printer-status"); if (!label) return;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2000);
    try { const response = await fetch("http://127.0.0.1:17832/health", { signal: controller.signal, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(); label.textContent = data.printer || "Tayyor"; label.parentElement.classList.remove("offline"); }
    catch (_error) { label.textContent = "Brauzer rejimi"; label.parentElement.classList.add("offline"); }
    finally { clearTimeout(timer); }
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
  }

  function drawBarChart(canvasId, data, options = {}) {
    const canvas = document.getElementById(canvasId); if (!canvas || !data.length) return;
    const ratio = window.devicePixelRatio || 1; const width = Math.max(320, canvas.clientWidth); const height = Number(canvas.getAttribute("height")) || 280;
    canvas.width = width * ratio; canvas.height = height * ratio; const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
    const pad = { top: 28, right: 18, bottom: 43, left: 40 }; const graphW = width - pad.left - pad.right; const graphH = height - pad.top - pad.bottom;
    const maxCount = Math.max(1, ...data.map(item => Number(item.count || 0))); const maxTotal = Math.max(1, ...data.map(item => Number(item.total || 0)));
    ctx.strokeStyle = "rgba(148,163,184,.13)"; ctx.fillStyle = "#8795a8"; ctx.font = "10px Segoe UI";
    for (let i = 0; i <= 4; i += 1) { const y = pad.top + graphH * i / 4; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); }
    const slot = graphW / data.length; const barWidth = Math.min(50, slot * .52);
    data.forEach((item, index) => {
      const countH = graphH * Number(item.count || 0) / maxCount; const totalH = graphH * Number(item.total || 0) / maxTotal;
      const x = pad.left + slot * index + (slot - barWidth) / 2; const countY = pad.top + graphH - countH; const totalY = pad.top + graphH - totalH;
      const gradient = ctx.createLinearGradient(0, totalY, 0, pad.top + graphH); gradient.addColorStop(0, "#4edea3"); gradient.addColorStop(1, "rgba(16,185,129,.38)"); ctx.fillStyle = gradient; roundRect(ctx, x, totalY, barWidth, Math.max(totalH, 2), 6); ctx.fill();
      ctx.fillStyle = "#0876e8"; roundRect(ctx, x + barWidth * .62, countY, barWidth * .38, Math.max(countH, 2), 4); ctx.fill();
      ctx.textAlign = "center"; ctx.fillStyle = options.highlightLast && index === data.length - 1 ? "#4edea3" : "#9caabd"; ctx.fillText(item.label, x + barWidth / 2, height - 15);
      if (item.count) { ctx.fillStyle = "#dce2f8"; ctx.fillText(String(item.count), x + barWidth / 2, Math.max(12, Math.min(countY, totalY) - 7)); }
    }); ctx.textAlign = "left";
  }

  async function loadDashboard() {
    try {
      const data = await api("/api/admin/dashboard"); weeklyData = data.weekly;
      document.getElementById("d-today-count").textContent = fmt(data.today_count); document.getElementById("d-today-total").textContent = data.today_total_fmt;
      document.getElementById("d-week-count").textContent = fmt(data.week_count); document.getElementById("d-week-total").textContent = data.week_total_fmt;
      drawBarChart("weekly-chart", weeklyData, { highlightLast: true });
    } catch (error) { showToast(error.message, true); }
  }

  function actionButton(text, handler, kind = "secondary") { const button = document.createElement("button"); button.type = "button"; button.className = `button ${kind} table-action`; button.textContent = text; button.addEventListener("click", handler); return button; }
  function buildRow(item, index, page) {
    const row = document.createElement("tr"); row.append(td((page - 1) * 20 + index + 1), td(item.receipt_no, "receipt-id"), td(item.plate_number, "plate-cell"), td(`${item.price_fmt} so'm`));
    const statusCell = document.createElement("td"); statusCell.append(badge(item.status)); row.append(statusCell, td(item.created_at), td(item.operator));
    const action = document.createElement("td"); action.append(actionButton("Ko'rish", () => openDetail(item))); if (item.status === "paid") action.append(actionButton("▤ Chek", event => reprint(item.id, event.currentTarget), "secondary")); row.append(action); return row;
  }

  async function loadHistory() {
    const body = document.getElementById("history-body"); emptyRow(body, 8, "Yuklanmoqda...");
    try { const data = await api(`/api/admin/weighings?page=${historyPage}&per_page=20`); historyPages = data.total_pages; body.replaceChildren(); if (!data.results.length) emptyRow(body, 8, "Ma'lumot topilmadi"); else data.results.forEach((item, i) => body.append(buildRow(item, i, historyPage))); document.getElementById("history-page-info").textContent = `${data.page} / ${data.total_pages}`; document.getElementById("history-prev").disabled = data.page <= 1; document.getElementById("history-next").disabled = data.page >= data.total_pages; }
    catch (error) { emptyRow(body, 8, error.message); }
  }

  function searchParams() {
    const params = new URLSearchParams({ page: searchPage, per_page: 20 });
    const values = { plate: document.getElementById("search-plate").value.trim(), start: document.getElementById("search-start").value, end: document.getElementById("search-end").value, status: document.getElementById("search-status").value };
    Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); }); return params;
  }
  async function doSearch() {
    const body = document.getElementById("search-body"); emptyRow(body, 8, "Qidirilmoqda...");
    try {
      const data = await api(`/api/admin/weighings?${searchParams()}`); searchPages = data.total_pages; body.replaceChildren(); if (!data.results.length) emptyRow(body, 8, "Ma'lumot topilmadi"); else data.results.forEach((item, i) => body.append(buildRow(item, i, searchPage)));
      document.getElementById("search-page-info").textContent = `${data.page} / ${data.total_pages}`; document.getElementById("search-prev").disabled = data.page <= 1; document.getElementById("search-next").disabled = data.page >= data.total_pages;
      document.getElementById("search-total-count").textContent = fmt(data.total); document.getElementById("search-total-sum").textContent = fmt(data.results.filter(i => i.status === "paid").reduce((sum, item) => sum + Number(item.price), 0)); document.getElementById("search-current-page").textContent = data.page; document.getElementById("search-state-label").textContent = document.getElementById("search-status").selectedOptions[0].textContent; document.getElementById("search-count-label").textContent = `${data.total} ta yozuv`;
    } catch (error) { emptyRow(body, 8, error.message); }
  }

  function openDetail(item) {
    selectedDetail = item; document.getElementById("detail-receipt").textContent = item.receipt_no; const body = document.getElementById("detail-body"); body.replaceChildren();
    [["Davlat raqami", item.plate_number], ["Narx", `${item.price_fmt} so'm`], ["Holat", item.status], ["To'lov usuli", item.payment_method], ["Sana va vaqt", item.created_at], ["Operator", item.operator], ["Manba", item.source], ["Chek ID", item.receipt_no]].forEach(([label, value]) => { const box = document.createElement("div"); const small = document.createElement("small"); const strong = document.createElement("strong"); small.textContent = label; strong.textContent = value; box.append(small, strong); body.append(box); });
    document.getElementById("detail-print").classList.toggle("hidden", item.status !== "paid"); document.getElementById("detail-modal").classList.remove("hidden");
  }

  async function localPrint(receipt) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 4000); try { const response = await fetch("http://127.0.0.1:17832/print", { method: "POST", mode: "cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify(receipt), signal: controller.signal }); const data = await response.json().catch(() => ({})); if (!response.ok || !data.success) throw new Error(data.message || "Printer agenti xatosi"); return data; } finally { clearTimeout(timer); } }
  async function reprint(id, button) {
    setBusy(button, true, "..."); const fallback = window.open("about:blank", "tarozi-receipt", "width=520,height=800");
    try { const data = await api(`/api/weighings/${id}/receipt`); try { const printed = await localPrint(data.receipt); if (fallback) fallback.close(); showToast(`Chek ${printed.printer || "printer"}ga yuborildi`); } catch (_error) { if (fallback) fallback.location.href = `/receipt/${id}?autoprint=1`; else window.location.href = `/receipt/${id}?autoprint=1`; showToast("Brauzer chop etish oynasi ochildi"); } }
    catch (error) { if (fallback) fallback.close(); showToast(error.message, true); } finally { setBusy(button, false); }
  }

  function setReportRange(type) {
    const now = new Date(); let start = new Date(now); let end = new Date(now);
    if (type === "yesterday") { start.setDate(start.getDate() - 1); end = new Date(start); }
    if (type === "week") start.setDate(start.getDate() - 6);
    if (type === "month") start = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById("report-start").value = isoDate(start); document.getElementById("report-end").value = isoDate(end);
    document.querySelectorAll("[data-range]").forEach(button => button.classList.toggle("active", button.dataset.range === type));
  }
  async function runReport() {
    const button = document.getElementById("btn-report"); const start = document.getElementById("report-start").value; const end = document.getElementById("report-end").value; if (!start || !end) return showToast("Sana oralig'ini kiriting", true); setBusy(button, true);
    try {
      const data = await api(`/api/admin/report?start=${start}&end=${end}`); reportData = [...data.daily].reverse(); document.getElementById("report-count").textContent = fmt(data.total_count); document.getElementById("report-total").textContent = data.total_fmt; document.getElementById("report-average").textContent = data.daily.length ? Math.round(data.total_count / data.daily.length) : 0;
      const cash = data.payment_methods.cash?.count || 0; const card = data.payment_methods.card?.count || 0; document.getElementById("report-methods").textContent = `${cash} / ${card}`; document.getElementById("report-period-label").textContent = `${start} — ${end}`;
      const body = document.getElementById("report-body"); body.replaceChildren(); if (!data.daily.length) emptyRow(body, 4, "Bu oraliqda ma'lumot yo'q"); else data.daily.forEach(item => { const row = document.createElement("tr"); row.append(td(item.date), td(`${item.count} ta`), td(`${item.total_fmt} so'm`), td(item.count ? `${fmt(Math.round(item.total / item.count))} so'm` : "0")); body.append(row); }); drawBarChart("report-chart", reportData);
    } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
  }

  function exportCsv(source) {
    const params = source === "report" ? new URLSearchParams({ start: document.getElementById("report-start").value, end: document.getElementById("report-end").value }) : searchParams(); params.delete("page"); params.delete("per_page"); window.location.href = `/api/admin/export.csv?${params}`;
  }

  async function importDatabase() {
    const input = document.getElementById("import-file"); const button = document.getElementById("btn-import"); const result = document.getElementById("import-result"); if (!input.files.length) return; const form = new FormData(); form.append("database", input.files[0]); setBusy(button, true, "Import qilinmoqda..."); result.classList.add("hidden");
    try { const data = await api("/api/admin/import-sqlite", { method: "POST", body: form }); result.className = "alert success"; result.textContent = `Jami ${data.total} qator: ${data.inserted} ta import qilindi, ${data.skipped} ta takroriy o'tkazildi.`; showToast("Import muvaffaqiyatli yakunlandi"); loadDashboard(); }
    catch (error) { result.className = "alert error"; result.textContent = error.message; }
    finally { result.classList.remove("hidden"); setBusy(button, false); }
  }

  async function loadMonitor() {
    if (role !== "techadmin") return; const button = document.getElementById("btn-refresh-monitor"); setBusy(button, true, "Tekshirilmoqda...");
    try {
      const data = await api("/api/admin/system-status"); const db = data.database; const server = data.server; systemData = data.activity;
      document.getElementById("monitor-overall").textContent = data.overall_status === "healthy" ? "Barcha tizimlar ishlamoqda" : "Tizim sekin ishlamoqda"; document.getElementById("monitor-checked").textContent = new Date(data.checked_at).toLocaleString("uz-UZ");
      document.getElementById("storage-percent").textContent = `${db.used_percent}%`; document.getElementById("storage-used").textContent = bytes(db.used_bytes); document.getElementById("storage-free").textContent = bytes(db.remaining_bytes); document.getElementById("storage-limit").textContent = bytes(db.limit_bytes); document.getElementById("storage-ring").style.background = `conic-gradient(#4edea3 ${db.used_percent}%, #232a3a 0)`; document.getElementById("storage-progress").style.width = `${db.used_percent}%`;
      document.getElementById("db-latency").textContent = `${db.latency_ms} ms`; document.getElementById("db-connections").textContent = db.connections; document.getElementById("db-rows").textContent = fmt(db.weighing_rows); document.getElementById("active-users").textContent = db.active_users;
      document.getElementById("server-uptime").textContent = uptime(server.uptime_seconds); document.getElementById("server-memory").textContent = bytes(server.memory_bytes); document.getElementById("server-cpu").textContent = `${Number(server.cpu_percent).toFixed(1)}%`; document.getElementById("server-disk").textContent = `${Number(server.disk_used_percent).toFixed(1)}%`;
      document.getElementById("avg-response").textContent = `${server.avg_response_ms} ms`; document.getElementById("p95-response").textContent = `${server.p95_response_ms} ms`; document.getElementById("request-count").textContent = fmt(server.requests); document.getElementById("error-count").textContent = fmt(server.errors);
      document.getElementById("last-import").textContent = data.application.last_import ? `${data.application.last_import.filename} — ${data.application.last_import.inserted}/${data.application.last_import.total} qator` : "Hali import qilinmagan"; document.getElementById("app-version").textContent = data.application.version; document.getElementById("app-environment").textContent = data.application.environment; drawBarChart("system-chart", systemData, { highlightLast: true });
    } catch (error) { showToast(error.message, true); document.getElementById("monitor-overall").textContent = "Monitoring ma'lumoti olinmadi"; }
    finally { setBusy(button, false); }
  }

  async function loadTech() {
    if (role !== "techadmin") return;
    try { const [price, users, tokens] = await Promise.all([api("/api/admin/settings/price"), api("/api/admin/users"), api("/api/admin/backup-tokens")]); document.getElementById("price-input").value = price.price; document.getElementById("current-price-value").textContent = fmt(price.price); renderUsers(users.users); renderTokens(tokens.tokens); }
    catch (error) { showToast(error.message, true); }
  }
  function renderUsers(users) {
    const body = document.getElementById("users-body"); body.replaceChildren(); users.forEach(user => { const row = document.createElement("tr"); row.append(td(user.username), td(user.role)); const state = document.createElement("td"); const stateBadge = badge(user.is_active ? "paid" : "cancelled"); stateBadge.textContent = user.is_active ? "Faol" : "Bloklangan"; state.append(stateBadge); row.append(state, td(user.last_login_at || "Hali kirmagan")); const actions = document.createElement("td"); actions.append(actionButton("Parol", () => openPasswordModal(user)), actionButton(user.is_active ? "Bloklash" : "Faollashtirish", event => toggleUser(user.id, event.currentTarget), "danger-soft")); row.append(actions); body.append(row); });
  }
  function renderTokens(tokens) {
    const body = document.getElementById("tokens-body"); body.replaceChildren(); if (!tokens.length) return emptyRow(body, 5, "Backup token yaratilmagan"); tokens.forEach(token => { const row = document.createElement("tr"); row.append(td(token.name), td(token.created_at), td(token.last_used_at || "Ishlatilmagan")); const state = document.createElement("td"); const stateBadge = badge(token.revoked ? "cancelled" : "paid"); stateBadge.textContent = token.revoked ? "Bekor qilingan" : "Faol"; state.append(stateBadge); row.append(state); const actions = document.createElement("td"); if (!token.revoked) actions.append(actionButton("Bekor qilish", event => revokeToken(token.id, event.currentTarget), "danger-soft")); row.append(actions); body.append(row); });
  }
  async function savePrice() { const button = document.getElementById("btn-save-price"); const price = Number(document.getElementById("price-input").value); setBusy(button, true); try { await api("/api/admin/settings/price", { method: "PUT", body: JSON.stringify({ price }) }); document.getElementById("current-price-value").textContent = fmt(price); showToast("Yangi narx saqlandi"); } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); } }
  async function createUser() { const button = document.getElementById("btn-create-user"); const payload = { username: document.getElementById("new-username").value, password: document.getElementById("new-password").value, role: document.getElementById("new-role").value }; setBusy(button, true); try { await api("/api/admin/users", { method: "POST", body: JSON.stringify(payload) }); document.getElementById("new-username").value = ""; document.getElementById("new-password").value = ""; showToast("Foydalanuvchi yaratildi"); renderUsers((await api("/api/admin/users")).users); } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); } }
  function openPasswordModal(user) { resetUserId = user.id; document.getElementById("password-user").textContent = `${user.username} uchun yangi parol`; document.getElementById("reset-password").value = ""; document.getElementById("password-modal").classList.remove("hidden"); }
  async function resetPassword() { const button = document.getElementById("btn-reset-password"); setBusy(button, true); try { await api(`/api/admin/users/${resetUserId}/reset-password`, { method: "POST", body: JSON.stringify({ password: document.getElementById("reset-password").value }) }); document.getElementById("password-modal").classList.add("hidden"); showToast("Parol yangilandi"); } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); } }
  async function toggleUser(id, button) { setBusy(button, true); try { await api(`/api/admin/users/${id}/toggle`, { method: "POST" }); renderUsers((await api("/api/admin/users")).users); showToast("Foydalanuvchi holati yangilandi"); } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); } }
  async function createToken() { const button = document.getElementById("btn-create-token"); setBusy(button, true); try { const data = await api("/api/admin/backup-tokens", { method: "POST", body: JSON.stringify({ name: document.getElementById("token-name").value.trim() }) }); document.getElementById("new-token-value").textContent = data.token; document.getElementById("new-token-box").classList.remove("hidden"); document.getElementById("token-name").value = ""; renderTokens((await api("/api/admin/backup-tokens")).tokens); showToast("Backup token yaratildi"); } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); } }
  async function revokeToken(id, button) { if (!window.confirm("Bu tokenni bekor qilasizmi?")) return; setBusy(button, true); try { await api(`/api/admin/backup-tokens/${id}/revoke`, { method: "POST" }); renderTokens((await api("/api/admin/backup-tokens")).tokens); showToast("Token bekor qilindi"); } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); } }

  const loaders = { dashboard: loadDashboard, reports: runReport, search: doSearch, history: loadHistory, monitor: loadMonitor, tech: loadTech };
  function activateTab(name) {
    const target = document.getElementById(`tab-${name}`); if (!target) return;
    document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.tab === name)); document.querySelectorAll(".admin-tab").forEach(tab => tab.classList.toggle("hidden", tab !== target));
    clearInterval(monitorTimer); monitorTimer = null; if (loaders[name]) loaders[name](); if (name === "monitor") monitorTimer = setInterval(loadMonitor, 30000); window.scrollTo(0, 0);
  }

  document.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => activateTab(link.dataset.tab)));
  document.querySelectorAll("[data-go]").forEach(button => { if (!document.getElementById(`tab-${button.dataset.go}`)) button.classList.add("hidden"); else button.addEventListener("click", () => activateTab(button.dataset.go)); });
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => document.getElementById(button.dataset.close).classList.add("hidden")));
  document.getElementById("btn-refresh-dashboard").addEventListener("click", loadDashboard);
  document.getElementById("btn-report").addEventListener("click", runReport); document.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click", () => { setReportRange(button.dataset.range); runReport(); }));
  document.getElementById("btn-export-report").addEventListener("click", () => exportCsv("report")); document.getElementById("btn-print-report").addEventListener("click", () => window.print());
  document.getElementById("btn-search").addEventListener("click", () => { searchPage = 1; doSearch(); }); document.getElementById("btn-refresh-search").addEventListener("click", doSearch); document.getElementById("btn-export-search").addEventListener("click", () => exportCsv("search")); document.getElementById("btn-print-table").addEventListener("click", () => window.print());
  document.getElementById("search-plate").addEventListener("keydown", event => { if (event.key === "Enter") { searchPage = 1; doSearch(); } }); document.querySelectorAll("[data-search-sample]").forEach(button => button.addEventListener("click", () => { document.getElementById("search-plate").value = button.dataset.searchSample; searchPage = 1; doSearch(); }));
  document.getElementById("btn-reset-search").addEventListener("click", () => { ["search-plate", "search-start", "search-end"].forEach(id => { document.getElementById(id).value = ""; }); document.getElementById("search-status").value = ""; searchPage = 1; doSearch(); });
  document.getElementById("search-prev").addEventListener("click", () => { if (searchPage > 1) { searchPage -= 1; doSearch(); } }); document.getElementById("search-next").addEventListener("click", () => { if (searchPage < searchPages) { searchPage += 1; doSearch(); } });
  document.getElementById("history-prev").addEventListener("click", () => { if (historyPage > 1) { historyPage -= 1; loadHistory(); } }); document.getElementById("history-next").addEventListener("click", () => { if (historyPage < historyPages) { historyPage += 1; loadHistory(); } }); document.getElementById("btn-refresh-history").addEventListener("click", loadHistory);
  document.getElementById("detail-print").addEventListener("click", event => { if (selectedDetail) reprint(selectedDetail.id, event.currentTarget); });
  document.getElementById("import-file").addEventListener("change", event => { const file = event.target.files[0]; document.getElementById("import-file-name").textContent = file ? `${file.name} (${bytes(file.size)})` : ".db faylni tanlash"; document.getElementById("btn-import").disabled = !file; }); document.getElementById("btn-import").addEventListener("click", importDatabase);
  if (role === "techadmin") { document.getElementById("btn-refresh-monitor").addEventListener("click", loadMonitor); document.getElementById("btn-save-price").addEventListener("click", savePrice); document.getElementById("btn-create-user").addEventListener("click", createUser); document.getElementById("btn-reset-password").addEventListener("click", resetPassword); document.getElementById("btn-create-token").addEventListener("click", createToken); document.getElementById("manual-backup-name").textContent = `${new Date().toLocaleDateString("uz-UZ")} 00-00 holatiga backup.db`; }
  window.addEventListener("resize", () => { if (weeklyData.length) drawBarChart("weekly-chart", weeklyData, { highlightLast: true }); if (reportData.length) drawBarChart("report-chart", reportData); if (systemData.length) drawBarChart("system-chart", systemData, { highlightLast: true }); });
  setClock(); setInterval(setClock, 1000); checkAgent(); setInterval(checkAgent, 30000); setReportRange("week"); loadDashboard();
})();
