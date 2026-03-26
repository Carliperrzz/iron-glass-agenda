const app = document.getElementById("app");
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyState = () => ({
  user: null,
  users: [],
  sales: [],
  config: {},
  dashboard: {},
  commissions: {},
  commissionBreakdown: [],
  selectedCommissionSeller: "",
  view: "dashboard",
  capacity: [],
  selectedDate: todayISO(),
  agendaMonth: todayISO().slice(0, 7),
  statistics: null,
  statsFilters: { start: todayISO().slice(0, 8) + "01", end: todayISO(), seller: "", product: "", brand: "" },
});
let state = emptyState();
window.state = state;

const roleLabel = {
  admin: "Administrador",
  seller: "Vendedor",
  coordinator: "Coordinador",
  reception: "Recepción",
  operator: "Operario",
  accounting: "Contabilidad",
  viewer: "Consulta",
};

const money = (v) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(v || 0));
const fmtDate = (v) => (v ? new Date(v + "T00:00:00").toLocaleDateString("es-AR") : "-");
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString("es-AR") : "-");
const can = (...roles) => state.user && roles.includes(state.user.role);
const canSeeFinancial = () => can("admin", "seller", "coordinator", "accounting");
const canEditFinancial = () => can("admin", "coordinator");
const canViewSales = () => can("admin", "seller", "coordinator", "accounting", "reception");
const canCreateSale = () => can("admin", "seller", "coordinator", "reception");

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Error inesperado" }));
    throw new Error(err.error || "Error inesperado");
  }
  return res.json().catch(() => ({}));
}

async function applyStatsFilters(e) {
  e.preventDefault();
  state.statsFilters = { ...state.statsFilters, ...Object.fromEntries(new FormData(e.target).entries()) };
  await loadStatistics();
  renderApp();
}
async function resetStatsFilters() {
  state.statsFilters = { start: todayISO().slice(0, 8) + "01", end: todayISO(), seller: "", product: "", brand: "" };
  await loadStatistics();
  renderApp();
}
function exportStatsExcel() {
  const params = new URLSearchParams(state.statsFilters || {});
  window.open(`/api/statistics/export?${params.toString()}`, "_blank");
}

async function loadSession() {
  const data = await api("/api/session");
  if (data.user) {
    state.user = data.user;
    await refresh();
  } else {
    renderLogin();
  }
  window.state = state;
}

async function refresh() {
  const data = await api("/api/bootstrap");
  state = { ...state, ...data };
  window.state = state;
  if (!state.selectedDate.startsWith(state.agendaMonth)) state.selectedDate = `${state.agendaMonth}-01`;
  await loadCapacity();
  if (can("admin", "accounting")) await loadStatistics();
  renderApp();
}

async function loadCapacity() {
  const month = state.agendaMonth || todayISO().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const data = await api(`/api/capacity?start=${toISO(start)}&end=${toISO(end)}`);
  state.capacity = data.days || [];
}

async function loadStatistics() {
  if (!can("admin", "accounting")) return;
  const params = new URLSearchParams(state.statsFilters || {});
  const data = await api(`/api/statistics?${params.toString()}`);
  state.statistics = data;
  state.statsFilters = { ...state.statsFilters, ...(data.filters || {}) };
}
function statsGrowthLabel(v) {
  if (v === null || v === undefined) return "Sin base";
  return `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
}

function toISO(date) { return date.toISOString().slice(0, 10); }
function plusDays(baseISO, days) { const d = new Date(baseISO + "T00:00:00"); d.setDate(d.getDate() + Number(days || 0)); return toISO(d); }
function monthLabel(month) { return new Date(month + "-01T00:00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" }); }
function plusMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function statusClass(s) { return `status-${s.autoStatus}`; }
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function effectiveEntryDate(s) { return s.entryDate || (s.receivedAt ? String(s.receivedAt).slice(0,10) : ""); }
function effectiveExitDate(s) { return s.exitDate || effectiveEntryDate(s); }
function daySales(date) {
  return state.sales.filter((s) => {
    if (["no_show", "cancelled"].includes(s.status)) return false;
    const start = effectiveEntryDate(s);
    const end = effectiveExitDate(s);
    if (!start || !end) return false;
    if (s.deliveredAt && String(s.deliveredAt).slice(0,10) <= date) return false;
    return start <= date && end >= date;
  });
}
function dayEntries(date) { return state.sales.filter((s) => s.entryDate === date); }
function dayExits(date) { return state.sales.filter((s) => s.exitDate === date); }
function dailyCapacityFor(date) {
  return state.capacity.find((d) => d.date === date) || { date, occupancy: daySales(date).length, free: Math.max(0, Number(state.config.dailyCapacity || 0) - daySales(date).length) };
}
function sellerOptions(selected) {
  const sellers = (state.users || []).filter((u) => u.role === "seller" && u.active !== false);
  const names = sellers.map((u) => u.name);
  if (selected && !names.includes(selected)) names.unshift(selected);
  if (!names.length) names.push("");
  return names.map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name || "Sin asignar")}</option>`).join("");
}
function monthStats() {
  const month = state.agendaMonth;
  const today = todayISO();
  const monthSales = state.sales.filter((s) => (s.entryDate || "").startsWith(month));
  const incoming = monthSales.length;
  const pendingIncoming = monthSales.filter((s) => (s.entryDate || "") >= today && !s.receivedAt).length;
  const inProgress = state.sales.filter((s) => ["received", "in_progress"].includes(s.autoStatus)).length;
  const completed = state.sales.filter((s) => {
    const doneDate = s.deliveredAt || s.workFinishedAt;
    return doneDate && String(doneDate).slice(0, 7) === month;
  }).length;
  return { incoming, pendingIncoming, inProgress, completed };
}

function renderStatsRowCells(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}
function statsOptions(options = [], selected = "") {
  const rows = ['<option value="">Todos</option>', ...options.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>` )];
  return rows.join("");
}


function detailSection(title, chip, notes, hasPhoto, photoType, saleId, compact = false) {
  if (!chip && !notes && !hasPhoto) return "";
  const parts = [`<div class="detail-section-title">${escapeHtml(title)}</div>`];
  if (chip) parts.push(`<div class="reception-chip">${escapeHtml(chip)}</div>`);
  if (notes) parts.push(`<div class="muted ${compact ? "tiny" : ""}">${escapeHtml(notes)}</div>`);
  if (hasPhoto) parts.push(`<button class="secondary small" onclick="openGenericPhotoModal('${saleId}','${photoType}')">Ver foto</button>`);
  return `<div class="reception-details">${parts.join("")}</div>`;
}
function receptionDetailHtml(s, compact = false) {
  return [
    detailSection("Recepción", s.receptionIssueType, s.receptionNotes, !!s.receptionPhoto, "reception", s.id, compact),
    detailSection("Inicio trabajo", s.workStartIssueType, s.workStartNotes, !!s.workStartPhoto, "workstart", s.id, compact),
    detailSection("Entrega", "", s.deliveryNotes, !!s.deliveryPhoto, "delivery", s.id, compact)
  ].join("");
}

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <div class="login-hero">
          <div class="login-logo-shell">
            <img class="login-logo" src="/escudo-iron-glass.jpeg?v=1" alt="Escudo Iron Glass" />
          </div>
          <div class="eyebrow login-eyebrow">Iron Glass</div>
          <h1>Agenda inteligente</h1>
          <p class="login-subtitle">Control visual del taller, recepción y entregas en una sola pantalla.</p>
          <div class="login-security-note">Acceso exclusivo para usuarios autorizados.</div>
        </div>
        <form id="loginForm" class="stacked-form login-form">
          <div class="login-field">
            <label for="username">Usuario</label>
            <input id="username" name="username" placeholder="Ingresa tu usuario" autocomplete="username" required />
          </div>
          <div class="login-field">
            <label for="password">Contraseña</label>
            <input id="password" name="password" type="password" placeholder="Ingresa tu contraseña" autocomplete="current-password" required />
          </div>
          <button class="primary login-submit">Entrar</button>
        </form>
      </div>
    </div>`;
  document.getElementById("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await api("/api/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) });
      state.user = data.user;
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };
}

function menuButton(view, label) {
  return `<button type="button" data-view="${view}" onclick="navigateView('${view}')" class="${state.view === view ? "active" : ""}">${label}</button>`;
}
function viewTitle() {
  return {
    dashboard: "Panel general",
    agenda: "Agenda mensual",
    sales: can("seller") ? "Mis ventas" : "Ventas",
    reception: "Recepción",
    production: "Producción",
    delivery: "Entrega",
    commissions: "Comisiones",
    stats: "Estadísticas",
    config: "Configuración",
  }[state.view] || "Iron Glass";
}

function renderTopbar() {
  const month = monthStats();
  const newSaleVisible = canCreateSale() && ["agenda", "sales", "dashboard"].includes(state.view);
  return `
    <div class="topbar-shell">
      <div class="topbar main-card">
        <div>
          <div class="eyebrow">${monthLabel(state.agendaMonth)}</div>
          <h1>${viewTitle()}</h1>
          <div class="muted">Más visual, más amigable y más fácil de leer.</div>
        </div>
        <div class="topbar-actions">
          <div class="pill-counter soft-green"><span>Terminados</span><strong>${month.completed}</strong></div>
          <div class="pill-counter soft-orange"><span>En proceso</span><strong>${month.inProgress}</strong></div>
          <div class="pill-counter soft-blue"><span>Ingresan este mes</span><strong>${month.incoming}</strong></div>
          ${newSaleVisible ? `<button class="primary" id="newSaleBtn">+ Nuevo registro</button>` : ""}
        </div>
      </div>
    </div>`;
}

function renderApp() {
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand-wrap">
          <div class="brand-mark">IG</div>
          <div>
            <div class="brand">Iron Glass</div>
            <div class="sub">Agenda inteligente visual</div>
          </div>
        </div>
        <nav class="menu">
          ${menuButton("dashboard", "Dashboard")}
          ${menuButton("agenda", "Agenda")}
          ${canViewSales() ? menuButton("sales", can("seller") ? "Mis ventas" : "Ventas") : ""}
          ${can("admin", "coordinator", "reception") ? menuButton("reception", "Recepción") : ""}
          ${can("admin", "coordinator", "operator") ? menuButton("production", "Producción") : ""}
          ${can("admin", "coordinator", "reception") ? menuButton("delivery", "Entrega") : ""}
          ${can("admin", "accounting") ? menuButton("commissions", "Comisiones") : ""}
          ${can("admin", "accounting") ? menuButton("stats", "Estadísticas") : ""}
          ${can("admin") ? menuButton("config", "Configuración") : ""}
        </nav>
        <div class="foot">
          <div><strong>${escapeHtml(state.user.name)}</strong></div>
          <div>${roleLabel[state.user.role]}</div>
          <button class="secondary small" id="logoutBtn">Salir</button>
        </div>
      </aside>
      <main class="content">${renderTopbar()}${renderCurrentView()}</main>
    </div>
    <div id="modalRoot" class="modal-backdrop"></div>`;

  document.querySelectorAll(".menu button[data-view]").forEach((btn) => btn.onclick = () => { state.view = btn.dataset.view; renderApp(); });
  document.getElementById("logoutBtn").onclick = async () => {
    await api("/api/logout", { method: "POST" });
    state = emptyState();
    renderLogin();
  };
  document.getElementById("newSaleBtn")?.addEventListener("click", () => openSaleModal());
  document.getElementById("configForm")?.addEventListener("submit", saveConfig);
  document.getElementById("newUserBtn")?.addEventListener("click", () => openUserModal());
  document.querySelectorAll("[data-calendar-day]").forEach((el) => el.onclick = () => { state.selectedDate = el.dataset.calendarDay; renderApp(); });
  document.getElementById("monthPrev")?.addEventListener("click", async () => { state.agendaMonth = plusMonth(state.agendaMonth, -1); state.selectedDate = `${state.agendaMonth}-01`; await loadCapacity(); renderApp(); });
  document.getElementById("monthNext")?.addEventListener("click", async () => { state.agendaMonth = plusMonth(state.agendaMonth, 1); state.selectedDate = `${state.agendaMonth}-01`; await loadCapacity(); renderApp(); });
  document.querySelectorAll("[data-edit-user]").forEach((btn) => btn.onclick = () => openUserModal(btn.dataset.editUser));
  document.querySelectorAll("[data-delete-user]").forEach((btn) => btn.onclick = () => deleteUser(btn.dataset.deleteUser));
  document.getElementById("openAgendaBtn")?.addEventListener("click", () => { state.view = "agenda"; window.state = state; renderApp(); });
  document.getElementById("statsFilterForm")?.addEventListener("submit", applyStatsFilters);
  document.getElementById("resetStatsBtn")?.addEventListener("click", resetStatsFilters);
  document.getElementById("exportStatsBtn")?.addEventListener("click", exportStatsExcel);
}
window.renderApp = renderApp;

function renderCurrentView() {
  const map = { dashboard: renderDashboard, agenda: renderAgenda, sales: renderSales, reception: renderReception, production: renderProduction, delivery: renderDelivery, commissions: renderCommissions, stats: renderStats, config: renderConfig };
  return map[state.view]();
}

window.navigateView = (view) => { state.view = view; window.state = state; renderApp(); };

const kpi = (title, value, subtitle = "", tone = "") => `
  <div class="card tone-${tone}">
    <div class="kpi-title">${title}</div>
    <div class="kpi-value">${value ?? 0}</div>
    ${subtitle ? `<div class="muted tiny">${subtitle}</div>` : ""}
  </div>`;

function renderAlerts() {
  const alerts = state.sales.filter((s) => ["critical_missing", "warning_missing", "ready_delivery", "no_show"].includes(s.autoStatus)).slice(0, 8);
  if (!alerts.length) return `<div class="muted">No hay alertas importantes ahora.</div>`;
  return alerts.map((s) => `
    <div class="alert-row">
      <div>
        <strong>${escapeHtml(s.client)}</strong>
        <div class="muted">${escapeHtml(s.car)} · ${escapeHtml(s.seller || "-")}</div>
      </div>
      <span class="badge ${statusClass(s)}">${escapeHtml(s.autoStatusLabel)}</span>
    </div>`).join("");
}

function renderDashboard() {
  const d = state.dashboard || {};
  const c = state.commissions || {};
  const month = monthStats();
  return `
    <section class="cards cards-wide dashboard-cards">
      ${kpi("Cupos semana", `${d.bookedThisWeek || 0}/${d.weeklySlots || 0}`, "cupos usados esta semana", "blue")}
      ${kpi("Libres semana", d.freeThisWeek || 0, "todavía disponibles", "green")}
      ${kpi("Entran hoy", d.entriesToday || 0, "programados para hoy", "orange")}
      ${kpi("Autos dentro", d.inWorkshop || 0, "ocupando lugar", "purple")}
      ${kpi("Se van hoy", d.exitsToday || 0, "salidas programadas", "red")}
      ${kpi("Ya se hicieron", month.completed, "ya salieron este mes", "green")}
      ${kpi("En proceso", month.inProgress, "trabajándose ahora", "orange")}
      ${kpi("Faltan entrar", month.pendingIncoming, "pendientes este mes", "blue")}
      ${canSeeFinancial() ? kpi("Comisiones", money(c.totalCommission), `base: ${c.commissionBase || "ventas"}`, "purple") : ""}
    </section>
    <section class="grid-2">
      <div class="card main-card">
        <div class="panel-title"><h2>Calendario del mes</h2><button class="secondary small" id="openAgendaBtn">Abrir agenda</button></div>
        <div class="legend-row">
          <span><i class="legend-dot ok"></i>Día liviano</span>
          <span><i class="legend-dot busy"></i>Día cargado</span>
          <span><i class="legend-dot full"></i>Día lleno</span>
        </div>
        ${renderCalendarMini()}
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>Alertas rápidas</h2></div>
        ${renderAlerts()}
      </div>
    </section>`;
}

function renderCalendarMini() {
  return `<div class="month-header"><button class="secondary small" id="monthPrev">‹</button><strong>${monthLabel(state.agendaMonth)}</strong><button class="secondary small" id="monthNext">›</button></div>${renderCalendarGrid(true)}`;
}

function renderAgenda() {
  const cap = dailyCapacityFor(state.selectedDate);
  return `
    <section class="grid-agenda">
      <div class="card main-card">
        <div class="panel-title">
          <h2>Calendario del mes</h2>
          <div class="month-header-inline"><button class="secondary small" id="monthPrev">‹ Mes anterior</button><strong>${monthLabel(state.agendaMonth)}</strong><button class="secondary small" id="monthNext">Mes siguiente ›</button></div>
        </div>
        <div class="note">Haz clic en un día para ver entradas, salidas y autos ocupando lugar. El color del día cambia según la carga.</div>
        ${renderCalendarGrid(false)}
      </div>
      <div class="card main-card sticky-card">
        <div class="panel-title"><h2>Detalle del día</h2><span class="badge selected-date">${fmtDate(state.selectedDate)}</span></div>
        <div class="legend-inline muted">Ocupación estimada: <strong>${cap.occupancy}</strong> / ${state.config.dailyCapacity || 0}</div>
        ${renderDayDetail(state.selectedDate)}
      </div>
    </section>`;
}

function renderCalendarGrid(compact = false) {
  const [y, m] = state.agendaMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const startWeekday = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(`<div class="calendar-cell empty"></div>`);
  for (let day = 1; day <= last.getDate(); day++) {
    const date = `${state.agendaMonth}-${String(day).padStart(2, "0")}`;
    const entries = dayEntries(date);
    const exits = dayExits(date);
    const cap = dailyCapacityFor(date);
    const occupancy = cap.occupancy;
    const free = cap.free;
    const limit = Number(state.config.dailyCapacity || 0);
    const levelClass = occupancy >= limit ? "calendar-full" : occupancy >= Math.max(1, Math.ceil(limit * 0.7)) ? "calendar-busy" : "calendar-ok";
    const preview = daySales(date).slice(0, compact ? 2 : 3).map((s) => `<div>• ${escapeHtml(s.client)} <span class="muted">${escapeHtml(s.car)}</span></div>`).join("");
    cells.push(`
      <button class="calendar-cell ${state.selectedDate === date ? "selected" : ""} ${levelClass}" data-calendar-day="${date}">
        <div class="calendar-top"><span>${day}</span><span class="calendar-occupancy">${occupancy}/${limit}</span></div>
        <div class="calendar-tags">
          ${entries.length ? `<span class="tag blue">Entran ${entries.length}</span>` : ""}
          ${exits.length ? `<span class="tag purple">Salen ${exits.length}</span>` : ""}
          ${free <= 0 ? `<span class="tag red">Lleno</span>` : `<span class="tag green">Libres ${free}</span>`}
        </div>
        <div class="calendar-mini-list">${preview || `<div class="muted">Sin movimientos</div>`}</div>
      </button>`);
  }
  return `<div class="calendar-weekdays"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div><div class="calendar-grid ${compact ? "compact" : ""}">${cells.join("")}</div>`;
}

function detailCard(title, body, emptyText) {
  return `<div class="detail-block"><h3>${title}</h3>${body.length ? body.join("") : `<div class="muted">${emptyText}</div>`}</div>`;
}

function detailRow(s, showAction = false) {
  return `
    <div class="day-row">
      <div>
        <strong>${escapeHtml(s.client)}</strong>
        <div class="muted">${escapeHtml(s.car)} · ${escapeHtml(s.seller || "-")}</div>
        <div class="muted">${fmtDate(s.entryDate)} → ${fmtDate(s.exitDate)}</div>
        ${receptionDetailHtml(s, true)}
      </div>
      <div>${showAction ? renderActions(s) : `<span class="badge ${statusClass(s)}">${escapeHtml(s.autoStatusLabel)}</span>`}</div>
    </div>`;
}

function renderDayDetail(date) {
  const entries = dayEntries(date);
  const exits = dayExits(date);
  const occupancy = daySales(date);
  const cap = dailyCapacityFor(date);
  return `
    <div class="day-summary">
      <div class="mini-stat soft-blue"><span class="muted">Entradas</span><strong>${entries.length}</strong></div>
      <div class="mini-stat soft-purple"><span class="muted">Salidas</span><strong>${exits.length}</strong></div>
      <div class="mini-stat soft-orange"><span class="muted">Autos dentro</span><strong>${occupancy.length}</strong><small>${cap.free} libres</small></div>
    </div>
    ${detailCard("Entradas del día", entries.map((s) => detailRow(s, can("admin", "coordinator", "reception"))), "No hay entradas para este día.")}
    ${detailCard("Salidas del día", exits.map((s) => detailRow(s)), "No hay salidas para este día.")}
    ${detailCard("Autos ocupando lugar", occupancy.map((s) => detailRow(s)), "No hay autos ocupando lugar.")}`;
}

function renderSales() {
  const c = state.commissions || {};
  return `
    <section class="grid-2">
      <div class="card main-card">
        <div class="panel-title"><h2>${can("seller") ? "Mis ventas" : "Ventas"}</h2></div>
        ${tableTemplate(state.sales)}
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>${can("seller") ? "Mis comisiones" : "Comisiones"}</h2></div>
        <div class="commission-box">
          <div class="commission-line"><span>Total vendido</span><strong>${money(c.totalSalesValue)}</strong></div>
          <div class="commission-line"><span>Comisión bruta</span><strong>${money(c.totalGross)}</strong></div>
          <div class="commission-line"><span>Descuentos</span><strong>${money(c.totalDiscount)}</strong></div>
          <div class="commission-line"><span>Comisión neta</span><strong>${money(c.totalNet || c.totalCommission)}</strong></div>
          <div class="commission-line"><span>Registros</span><strong>${c.salesCount || 0}</strong></div>
          <div class="commission-line"><span>Entregados</span><strong>${c.deliveredCount || 0}</strong></div>
          <div class="commission-line"><span>Tasa comisión</span><strong>${state.user.role === "seller" ? `${Number(state.user.commissionRate || state.config.commissionRate || 7)}%` : `${Number(state.config.commissionRate || 7)}% default`}</strong></div>
          <div class="commission-line"><span>Descuento comisión</span><strong>${state.user.role === "seller" ? `${Number(state.user.commissionDiscountRate || 0)}% + ${money(state.user.commissionDiscountFixed || 0)}` : `${Number(state.config.commissionDiscountRate || 0)}% default`}</strong></div>
          <div class="muted">${can("seller") ? "Solo ves y editas tus propias ventas." : "El administrador puede ajustar la comisión individual de cada vendedor y el descuento/impuesto."}</div>
        </div>
      </div>
    </section>`;
}


function renderStats() {
  const stats = state.statistics;
  if (!stats) {
    return `<div class="card main-card"><div class="muted">Cargando estadísticas...</div></div>`;
  }
  const cards = stats.cards || {};
  const options = stats.options || { sellers: [], products: [], brands: [] };
  const topProducts = (stats.products || []).slice(0, 6);
  const topSellers = (stats.sellers || []).slice(0, 6);
  const topBrands = (stats.brands || []).slice(0, 6);
  return `
    <section class="card main-card">
      <div class="panel-title"><h2>Filtros de estadísticas</h2><button class="secondary" id="exportStatsBtn">Exportar Excel</button></div>
      <form id="statsFilterForm" class="stats-filter-grid">
        <label><span>Desde</span><input type="date" name="start" value="${escapeHtml(state.statsFilters.start || "")}" /></label>
        <label><span>Hasta</span><input type="date" name="end" value="${escapeHtml(state.statsFilters.end || "")}" /></label>
        <label><span>Vendedor</span><select name="seller">${statsOptions(options.sellers, state.statsFilters.seller)}</select></label>
        <label><span>Producto</span><select name="product">${statsOptions(options.products, state.statsFilters.product)}</select></label>
        <label><span>Marca</span><select name="brand">${statsOptions(options.brands, state.statsFilters.brand)}</select></label>
        <div class="stats-filter-actions">
          <button class="primary" type="submit">Aplicar filtros</button>
          <button class="secondary" type="button" id="resetStatsBtn">Limpiar</button>
        </div>
      </form>
    </section>
    <section class="cards cards-wide dashboard-cards">
      ${kpi("Total de ventas", cards.totalSales || 0, `${escapeHtml(stats.filters.start)} a ${escapeHtml(stats.filters.end)}`, "blue")}
      ${kpi("Total facturado", money(cards.totalRevenue), "según filtros", "green")}
      ${kpi("Ticket promedio", money(cards.avgTicket), "por venta", "orange")}
      ${kpi("Producto líder", escapeHtml(cards.topProduct || "-"), "más vendido", "purple")}
      ${kpi("Vendedor líder", escapeHtml(cards.topSeller || "-"), "más ventas", "blue")}
      ${kpi("Marca líder", escapeHtml(cards.topBrand || "-"), "más frecuente", "green")}
      ${kpi("Crecim. ventas", statsGrowthLabel(cards.growthSalesPct), `vs período anterior (${cards.previousSales || 0})`, "orange")}
      ${kpi("Crecim. facturación", statsGrowthLabel(cards.growthRevenuePct), `base ${money(cards.previousRevenue || 0)}`, "red")}
    </section>
    <section class="grid-2 stats-grid">
      <div class="card main-card">
        <div class="panel-title"><h2>Productos</h2></div>
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Producto</th><th>Ventas</th><th>Facturación</th><th>% participación</th></tr></thead>
            <tbody>${topProducts.map((row) => renderStatsRowCells([escapeHtml(row.product), row.count, money(row.revenue), `${row.share}%`])).join("") || '<tr><td colspan="4" class="muted">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>Iron Glass vs Defender vs Plus</h2></div>
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Producto</th><th>Ventas</th><th>Facturación</th><th>% participación</th></tr></thead>
            <tbody>${(stats.productComparison || []).map((row) => renderStatsRowCells([escapeHtml(row.product), row.count, money(row.revenue), `${row.share}%`])).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>Ventas por vendedor</h2></div>
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Vendedor</th><th>Ventas</th><th>Facturación</th></tr></thead>
            <tbody>${topSellers.map((row) => renderStatsRowCells([escapeHtml(row.seller), row.count, money(row.revenue)])).join("") || '<tr><td colspan="3" class="muted">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>Marcas de auto</h2></div>
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Marca</th><th>Ventas</th><th>Facturación</th></tr></thead>
            <tbody>${topBrands.map((row) => renderStatsRowCells([escapeHtml(row.brand), row.count, money(row.revenue)])).join("") || '<tr><td colspan="3" class="muted">Sin datos</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function renderCommissions() {
  const breakdown = state.commissionBreakdown || [];
  const selectedSeller = state.selectedCommissionSeller && breakdown.some((x) => x.seller === state.selectedCommissionSeller)
    ? state.selectedCommissionSeller
    : (breakdown[0]?.seller || "");
  state.selectedCommissionSeller = selectedSeller;
  const selected = breakdown.find((x) => x.seller === selectedSeller) || null;
  const totals = breakdown.reduce((acc, row) => {
    acc.sales += row.salesCount || 0;
    acc.value += row.totalSalesValue || 0;
    acc.gross += row.totalGross || 0;
    acc.discount += row.totalDiscount || 0;
    acc.net += row.totalNet || 0;
    return acc;
  }, { sales: 0, value: 0, gross: 0, discount: 0, net: 0 });
  return `
    <section class="cards cards-wide dashboard-cards">
      ${kpi("Vendedores", breakdown.length, "con comisiones visibles", "blue")}
      ${kpi("Total vendido", money(totals.value), "según filtro actual", "green")}
      ${kpi("Comisión bruta", money(totals.gross), "antes de descuentos", "orange")}
      ${kpi("Descuentos", money(totals.discount), "impuestos y ajustes", "red")}
      ${kpi("Comisión neta", money(totals.net), "a pagar", "purple")}
    </section>
    <section class="grid-2">
      <div class="card main-card">
        <div class="panel-title"><h2>Resumen por vendedor</h2></div>
        <div class="note">Contabilidad y administrador pueden ver qué autos vendió cada vendedor, su comisión configurada, el descuento/impuesto y el neto final.</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Vendedor</th><th>Autos</th><th>Vendió</th><th>% comisión</th><th>Desc. %</th><th>Neto</th><th></th></tr></thead>
          <tbody>
            ${breakdown.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.seller)}</strong></td>
                <td>${row.salesCount}</td>
                <td>${money(row.totalSalesValue)}</td>
                <td>${Number(row.commissionRate || 0)}%</td>
                <td>${Number(row.commissionDiscountRate || 0)}% + ${money(row.commissionDiscountFixed || 0)}</td>
                <td><strong>${money(row.totalNet)}</strong></td>
                <td><button class="secondary small" onclick="selectCommissionSeller('${escapeHtml(row.seller).replace(/'/g,"&#039;")}')">Ver detalle</button></td>
              </tr>`).join("") || `<tr><td colspan="7" class="muted">Sin vendedores con ventas.</td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>${selected ? `Detalle de ${escapeHtml(selected.seller)}` : "Detalle"}</h2></div>
        ${selected ? `<div class="commission-box">
          <div class="commission-line"><span>Autos vendidos</span><strong>${selected.salesCount}</strong></div>
          <div class="commission-line"><span>Comisión bruta</span><strong>${money(selected.totalGross)}</strong></div>
          <div class="commission-line"><span>Descuento total</span><strong>${money(selected.totalDiscount)}</strong></div>
          <div class="commission-line"><span>Neto a pagar</span><strong>${money(selected.totalNet)}</strong></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Auto</th><th>Venta</th><th>Bruta</th><th>Desc.</th><th>Neta</th></tr></thead>
          <tbody>
            ${selected.sales.map((sale) => `
              <tr>
                <td><strong>${escapeHtml(sale.client || "-")}</strong><br><span class="muted">${escapeHtml(sale.product || "-")}</span></td>
                <td>${escapeHtml(sale.car || "-")}</td>
                <td>${money(sale.saleValue)}</td>
                <td>${money(sale.commissionGross)}</td>
                <td>${money(sale.commissionDiscount)}<br><span class="muted">${Number(sale.commissionDiscountRate || 0)}% + ${money(sale.commissionDiscountFixed || 0)}</span></td>
                <td><strong>${money(sale.commissionNet)}</strong></td>
              </tr>`).join("")}
          </tbody>
        </table></div>` : `<div class="muted">Selecciona un vendedor para ver el detalle.</div>`}
      </div>
    </section>`;
}

window.selectCommissionSeller = (seller) => { state.selectedCommissionSeller = seller; renderApp(); };

function renderReception() {
  const rows = state.sales.filter((s) => ["scheduled_today", "warning_missing", "critical_missing", "scheduled", "no_show"].includes(s.autoStatus) || s.entryDate === todayISO());
  return `<div class="card main-card"><div class="panel-title"><h2>Recepción del día</h2></div><div class="note">Al marcar <strong>Recibido</strong> puedes dejar observaciones, detallar arañones o golpes y subir una foto desde el celular.</div>${taskCards(rows, "reception")}</div>`;
}
function renderProduction() {
  const rows = state.sales.filter((s) => ["received", "in_progress"].includes(s.autoStatus));
  return `<div class="card main-card"><div class="panel-title"><h2>Producción</h2></div><div class="note">Cuando el operario inicia, abre una ficha para dejar observaciones y foto si detecta algún detalle.</div>${taskCards(rows, "production")}</div>`;
}
function renderDelivery() {
  const rows = state.sales.filter((s) => ["ready_delivery", "delivered"].includes(s.autoStatus));
  return `<div class="card main-card"><div class="panel-title"><h2>Entrega</h2></div><div class="note">Antes de entregar, recepción completa un checklist final para confirmar botones, tonalidad, rayones y funcionamiento general.</div>${taskCards(rows, "delivery")}</div>`;
}

function taskCards(rows, mode) {
  if (!rows.length) return `<div class="muted">Sin registros.</div>`;
  return `<div class="task-list">${rows.map((s) => `
    <div class="task-card ${statusClass(s)}">
      <div class="task-head">
        <div>
          <div class="task-title">${escapeHtml(s.client || '-') }</div>
          <div class="task-sub">${escapeHtml(s.car || '-') } · ${escapeHtml(s.plate || '-') }</div>
        </div>
        <span class="badge ${statusClass(s)}">${escapeHtml(s.autoStatusLabel)}</span>
      </div>
      <div class="task-meta">
        <div><strong>Vendedor</strong><span>${escapeHtml(s.seller || '-')}</span></div>
        <div><strong>Entrada</strong><span>${fmtDate(s.entryDate)} ${escapeHtml(s.entryTime || '')}</span></div>
        <div><strong>Salida</strong><span>${fmtDate(s.exitDate)}</span></div>
      </div>
      ${receptionDetailHtml(s, true)}
      <div class="task-actions">${renderActions(s)}</div>
    </div>
  `).join('')}</div>`;
}

function renderConfig() {
  return `
    <section class="grid-2 config-grid">
      <div class="card main-card">
        <div class="panel-title"><h2>Configuración general</h2></div>
        <form id="configForm" class="form-grid">
          <div><label>Cupos semanales</label><input name="weeklySlots" type="number" value="${state.config.weeklySlots || 15}" /></div>
          <div><label>Capacidad diaria</label><input name="dailyCapacity" type="number" value="${state.config.dailyCapacity || 6}" /></div>
          <div><label>Permanencia por defecto</label><input name="defaultStayDays" type="number" value="${state.config.defaultStayDays || 5}" /></div>
          <div><label>Hora alerta</label><input name="warningHour" type="time" value="${state.config.warningHour || "11:00"}" /></div>
          <div><label>Hora crítica</label><input name="criticalHour" type="time" value="${state.config.criticalHour || "12:00"}" /></div>
          <div><label>% comisión default</label><input name="commissionRate" type="number" step="0.1" value="${state.config.commissionRate || 7}" /></div>
          <div><label>% descuento default</label><input name="commissionDiscountRate" type="number" step="0.1" value="${state.config.commissionDiscountRate || 0}" /></div>
          <div class="full"><button class="primary">Guardar configuración</button></div>
        </form>
      </div>
      <div class="card main-card">
        <div class="panel-title"><h2>Usuarios y vendedores</h2><button class="primary small" id="newUserBtn">+ Nuevo usuario</button></div>
        <div class="note">Desde acá el administrador puede agregar o eliminar vendedores, definir comisión, descuento/impuesto y dejar accesos activos o inactivos.</div>
        ${userTable()}
      </div>
    </section>`;
}

function userTable() {
  const rows = state.users || [];
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Comisión</th><th>Desc. %</th><th>Desc. fijo</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>
        ${rows.map((u) => `
          <tr>
            <td><strong>${escapeHtml(u.name)}</strong></td>
            <td>${escapeHtml(u.username)}</td>
            <td>${roleLabel[u.role]}</td>
            <td>${u.role === "seller" ? `${Number(u.commissionRate || 0)}%` : "-"}</td>
            <td>${u.role === "seller" ? `${Number(u.commissionDiscountRate || 0)}%` : "-"}</td>
            <td>${u.role === "seller" ? money(u.commissionDiscountFixed || 0) : "-"}</td>
            <td><span class="badge ${u.active ? "status-received" : "status-no_show"}">${u.active ? "Activo" : "Inactivo"}</span></td>
            <td>
              <div class="actions">
                <button class="secondary small" data-edit-user="${u.id}">Editar</button>
                ${state.user.id !== u.id ? `<button class="danger small" data-delete-user="${u.id}">${u.role === "seller" ? "Eliminar vendedor" : "Eliminar"}</button>` : ""}
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table></div>`;
}

function tableTemplate(rows) {
  const financialCols = canSeeFinancial() ? `<th>Producto</th><th>Valor</th><th>Comisión %</th><th>Neto</th>` : "";
  const cols = canSeeFinancial() ? 10 : 6;
  return `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Auto</th><th>Vendedor</th><th>Entrada</th><th>Salida</th><th>Estado</th>${financialCols}<th>Acciones</th></tr></thead><tbody>${rows.map(rowTemplate).join("") || `<tr><td colspan="${cols}" class="muted">Sin registros.</td></tr>`}</tbody></table></div>`;
}

function rowTemplate(s) {
  const financialCols = canSeeFinancial() ? `<td>${escapeHtml(s.product || "-")}</td><td>${money(s.saleValue)}</td><td>${Number(s.commissionRate || state.config.commissionRate || 7)}%</td><td>${money(s.commissionNet || 0)}</td>` : "";
  return `
    <tr>
      <td><strong>${escapeHtml(s.client)}</strong><br><span class="muted">${escapeHtml(s.phone || "-")}</span>${receptionDetailHtml(s)}</td>
      <td>${escapeHtml(s.car)}<br><span class="muted">${escapeHtml(s.plate || "-")}</span></td>
      <td>${escapeHtml(s.seller || "-")}</td>
      <td>${fmtDate(s.entryDate)}<br><span class="muted">${escapeHtml(s.entryTime || "-")}</span></td>
      <td>${fmtDate(s.exitDate)}</td>
      <td><span class="badge ${statusClass(s)}">${escapeHtml(s.autoStatusLabel)}</span></td>
      ${financialCols}
      <td>${renderActions(s)}</td>
    </tr>`;
}

function renderActions(s) {
  const items = [];
  if (can("admin", "seller", "coordinator")) items.push(`<button class="secondary small" onclick="openSaleModal('${s.id}')">Editar</button>`);
  if (can("admin") && ["scheduled", "scheduled_today", "warning_missing", "critical_missing", "no_show", "received", "in_progress", "ready_delivery"].includes(s.autoStatus)) items.push(`<button class="danger small" onclick="deleteSale('${s.id}')">Eliminar</button>`);
  if (can("admin", "coordinator", "reception") && ["scheduled_today", "warning_missing", "critical_missing", "scheduled", "no_show"].includes(s.autoStatus)) items.push(`<button class="success small" onclick="markAction('${s.id}','receive')">Recibido</button>`);
  if (can("admin", "coordinator", "reception", "seller") && ["warning_missing", "critical_missing", "scheduled_today", "scheduled"].includes(s.autoStatus)) items.push(`<button class="danger small" onclick="markAction('${s.id}','no-show')">No ingresó</button>`);
  if (can("admin", "coordinator", "operator", "reception") && s.autoStatus === "received") items.push(`<button class="primary small" onclick="markAction('${s.id}','start')">Iniciar</button>`);
  if (can("admin", "coordinator", "operator", "reception") && s.autoStatus === "in_progress") items.push(`<button class="secondary small" onclick="markAction('${s.id}','finish')">Finalizar</button>`);
  if (can("admin", "coordinator", "reception") && s.autoStatus === "ready_delivery") items.push(`<button class="success small" onclick="markAction('${s.id}','deliver')">Entregado</button>`);
  return `<div class="actions">${items.join("") || '<span class="muted">-</span>'}</div>`;
}

window.markAction = async (id, action) => {
  try {
    if (action === "receive") {
      openReceptionModal(id);
      return;
    }
    if (action === "start") {
      openWorkStartModal(id);
      return;
    }
    if (action === "deliver") {
      openDeliveryModal(id);
      return;
    }
    await api(`/api/sales/${id}/${action}`, { method: "POST" });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
};

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.readAsDataURL(file);
  });
}

window.openReceptionModal = (id) => {
  const sale = state.sales.find((s) => s.id === id);
  if (!sale) return;
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  root.innerHTML = `
    <div class="modal user-modal">
      <div class="panel-title"><h2>Recepción del vehículo</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <div class="note">Deja una observación si el auto entra con arañón, golpe o cualquier detalle visible.</div>
      <form id="receptionForm" class="form-grid">
        <div><label>Cliente</label><input value="${escapeHtml(sale.client)}" readonly /></div>
        <div><label>Auto</label><input value="${escapeHtml(sale.car)}" readonly /></div>
        <div><label>Placa</label><input value="${escapeHtml(sale.plate || "-")}" readonly /></div>
        <div><label>Tipo de detalle</label><select name="receptionIssueType">${["","Arañón","Golpe","Detalle interior","Vidrio","Botón/traba","Otro"].map((x)=>`<option value="${x}" ${sale.receptionIssueType===x?"selected":""}>${x||"Sin detalle puntual"}</option>`).join("")}</select></div>
        <div class="full"><label>Observaciones de ingreso</label><textarea name="receptionNotes" rows="4" placeholder="Ej.: arañón en puerta delantera izquierda">${escapeHtml(sale.receptionNotes || "")}</textarea></div>
        <div class="full"><label>Foto del detalle</label><input type="file" name="receptionPhotoFile" accept="image/*" /><div class="muted tiny">Opcional. Si ya había una foto cargada y no eliges otra, se conserva.</div>${sale.receptionPhoto ? `<div class="photo-inline-actions"><button class="secondary small" type="button" id="seeExistingPhoto">Ver foto actual</button></div>` : ""}</div>
        <div class="full modal-actions"><button class="primary">Guardar y marcar recibido</button></div>
      </form>
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  document.getElementById("seeExistingPhoto")?.addEventListener("click", () => openPhotoModal(id));
  document.getElementById("receptionForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get("receptionPhotoFile");
    let receptionPhoto = sale.receptionPhoto || "";
    let receptionPhotoName = sale.receptionPhotoName || "";
    if (file && file.size) {
      if (file.size > 6 * 1024 * 1024) {
        alert("La foto es muy grande. Usa una de hasta 6 MB.");
        return;
      }
      receptionPhoto = await readFileAsDataURL(file);
      receptionPhotoName = file.name;
    }
    const payload = {
      receptionIssueType: fd.get("receptionIssueType") || "",
      receptionNotes: fd.get("receptionNotes") || "",
      receptionPhoto,
      receptionPhotoName,
    };
    try {
      await api(`/api/sales/${id}/receive`, { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };
};

window.openPhotoModal = (id) => {
  const sale = state.sales.find((s) => s.id === id);
  if (!sale || !sale.receptionPhoto) return;
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  root.innerHTML = `
    <div class="modal photo-modal">
      <div class="panel-title"><h2>Foto del detalle</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <div class="muted">${escapeHtml(sale.client)} · ${escapeHtml(sale.car)}${sale.receptionPhotoName ? ` · ${escapeHtml(sale.receptionPhotoName)}` : ""}</div>
      ${sale.receptionIssueType ? `<div class="reception-chip">${escapeHtml(sale.receptionIssueType)}</div>` : ""}
      ${sale.receptionNotes ? `<div class="note">${escapeHtml(sale.receptionNotes)}</div>` : ""}
      <img class="detail-photo" src="${sale.receptionPhoto}" alt="Detalle del vehículo" />
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
};

window.openWorkStartModal = (id) => {
  const sale = state.sales.find((s) => s.id === id);
  if (!sale) return;
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  root.innerHTML = `
    <div class="modal">
      <div class="panel-title"><h2>Iniciar trabajo</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <div class="note">Si el operario detecta un detalle al empezar, debe dejarlo asentado acá.</div>
      <form id="workStartForm" class="form-grid">
        <div><label>Cliente</label><input value="${escapeHtml(sale.client)}" readonly /></div>
        <div><label>Auto</label><input value="${escapeHtml(sale.car)}" readonly /></div>
        <div><label>Placa</label><input value="${escapeHtml(sale.plate || "-")}" readonly /></div>
        <div><label>Tipo de detalle</label><select name="workStartIssueType">${["","Arañón","Golpe","Vidrio","Botón/traba","Tonalidad","Otro"].map((x)=>`<option value="${x}" ${sale.workStartIssueType===x?"selected":""}>${x||"Sin detalle puntual"}</option>`).join("")}</select></div>
        <div class="full"><label>Observaciones al iniciar</label><textarea name="workStartNotes" rows="4" placeholder="Ej.: se detecta marca en el vidrio delantero derecho">${escapeHtml(sale.workStartNotes || "")}</textarea></div>
        <div class="full"><label>Foto del detalle</label><input type="file" name="workStartPhotoFile" accept="image/*" />${sale.workStartPhoto ? `<div class="photo-inline-actions"><button class="secondary small" type="button" id="seeExistingWorkPhoto">Ver foto actual</button></div>` : ""}</div>
        <div class="full modal-actions"><button class="primary">Guardar e iniciar trabajo</button></div>
      </form>
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  document.getElementById("seeExistingWorkPhoto")?.addEventListener("click", () => openGenericPhotoModal(id, "workstart"));
  document.getElementById("workStartForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get("workStartPhotoFile");
    let workStartPhoto = sale.workStartPhoto || "";
    let workStartPhotoName = sale.workStartPhotoName || "";
    if (file && file.size) {
      if (file.size > 6 * 1024 * 1024) {
        alert("La foto es muy grande. Usa una de hasta 6 MB.");
        return;
      }
      workStartPhoto = await readFileAsDataURL(file);
      workStartPhotoName = file.name;
    }
    const payload = {
      workStartIssueType: fd.get("workStartIssueType") || "",
      workStartNotes: fd.get("workStartNotes") || "",
      workStartPhoto,
      workStartPhotoName,
    };
    try {
      await api(`/api/sales/${id}/start`, { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };
};

window.openDeliveryModal = (id) => {
  const sale = state.sales.find((s) => s.id === id);
  if (!sale) return;
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  root.innerHTML = `
    <div class="modal">
      <div class="panel-title"><h2>Checklist de entrega</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <div class="note">Recepción debe confirmar que todo quedó funcionando correctamente antes de entregar.</div>
      <form id="deliveryForm" class="form-grid">
        <div><label>Cliente</label><input value="${escapeHtml(sale.client)}" readonly /></div>
        <div><label>Auto</label><input value="${escapeHtml(sale.car)}" readonly /></div>
        <div><label>Placa</label><input value="${escapeHtml(sale.plate || "-")}" readonly /></div>
        <div><label><input type="checkbox" name="deliveryButtonsOk" ${sale.deliveryButtonsOk ? "checked" : ""} /> Botones ok</label></div>
        <div><label><input type="checkbox" name="deliveryToneOk" ${sale.deliveryToneOk ? "checked" : ""} /> Tonalidad ok</label></div>
        <div><label><input type="checkbox" name="deliveryScratchesOk" ${sale.deliveryScratchesOk ? "checked" : ""} /> Sin rayones nuevos</label></div>
        <div><label><input type="checkbox" name="deliveryGlassOk" ${sale.deliveryGlassOk ? "checked" : ""} /> Vidrios ok</label></div>
        <div><label><input type="checkbox" name="deliveryGeneralOk" ${sale.deliveryGeneralOk ? "checked" : ""} /> Funcionamiento general ok</label></div>
        <div class="full"><label>Observaciones finales</label><textarea name="deliveryNotes" rows="4" placeholder="Ej.: todo funcional, sin diferencias de tonalidad">${escapeHtml(sale.deliveryNotes || "")}</textarea></div>
        <div class="full"><label>Foto final opcional</label><input type="file" name="deliveryPhotoFile" accept="image/*" />${sale.deliveryPhoto ? `<div class="photo-inline-actions"><button class="secondary small" type="button" id="seeExistingDeliveryPhoto">Ver foto actual</button></div>` : ""}</div>
        <div class="full modal-actions"><button class="primary">Guardar y entregar</button></div>
      </form>
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  document.getElementById("seeExistingDeliveryPhoto")?.addEventListener("click", () => openGenericPhotoModal(id, "delivery"));
  document.getElementById("deliveryForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = fd.get("deliveryPhotoFile");
    let deliveryPhoto = sale.deliveryPhoto || "";
    let deliveryPhotoName = sale.deliveryPhotoName || "";
    if (file && file.size) {
      if (file.size > 6 * 1024 * 1024) {
        alert("La foto es muy grande. Usa una de hasta 6 MB.");
        return;
      }
      deliveryPhoto = await readFileAsDataURL(file);
      deliveryPhotoName = file.name;
    }
    const payload = {
      deliveryButtonsOk: fd.get("deliveryButtonsOk") === "on",
      deliveryToneOk: fd.get("deliveryToneOk") === "on",
      deliveryScratchesOk: fd.get("deliveryScratchesOk") === "on",
      deliveryGlassOk: fd.get("deliveryGlassOk") === "on",
      deliveryGeneralOk: fd.get("deliveryGeneralOk") === "on",
      deliveryNotes: fd.get("deliveryNotes") || "",
      deliveryPhoto,
      deliveryPhotoName,
    };
    try {
      await api(`/api/sales/${id}/deliver`, { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };
};

window.openGenericPhotoModal = (id, type = "reception") => {
  const sale = state.sales.find((s) => s.id === id);
  if (!sale) return;
  const map = {
    reception: { photo: sale.receptionPhoto, name: sale.receptionPhotoName, title: "Foto recepción", chip: sale.receptionIssueType, notes: sale.receptionNotes },
    workstart: { photo: sale.workStartPhoto, name: sale.workStartPhotoName, title: "Foto inicio trabajo", chip: sale.workStartIssueType, notes: sale.workStartNotes },
    delivery: { photo: sale.deliveryPhoto, name: sale.deliveryPhotoName, title: "Foto entrega", chip: "", notes: sale.deliveryNotes },
  };
  const item = map[type];
  if (!item || !item.photo) return;
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  root.innerHTML = `
    <div class="modal photo-modal">
      <div class="panel-title"><h2>${item.title}</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <div class="muted">${escapeHtml(sale.client)} · ${escapeHtml(sale.car)}${item.name ? ` · ${escapeHtml(item.name)}` : ""}</div>
      ${item.chip ? `<div class="reception-chip">${escapeHtml(item.chip)}</div>` : ""}
      ${item.notes ? `<div class="note">${escapeHtml(item.notes)}</div>` : ""}
      <img class="detail-photo" src="${item.photo}" alt="Detalle del vehículo" />
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
};

window.openPhotoModal = (id) => window.openGenericPhotoModal(id, "reception");

window.deleteSale = async (id) => {
  if (!confirm("¿Seguro que querés borrar este registro de la agenda? Solo lo puede hacer el administrador.")) return;
  try {
    await api(`/api/sales/${id}`, { method: "DELETE" });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
};

async function deleteUser(id) {
  if (!confirm("¿Seguro que querés eliminar este usuario?")) return;
  try {
    await api(`/api/users/${id}`, { method: "DELETE" });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

window.openSaleModal = (id = null) => {
  const editing = !!id;
  const sale = editing
    ? state.sales.find((s) => s.id === id)
    : {
        seller: can("seller") ? state.user.name : ((state.users.find((u) => u.role === "seller" && u.active)?.name) || state.sales.find((s) => s.seller)?.seller || ""),
        client: "", phone: "", car: "", plate: "", product: "", saleValue: "", deposit: "", paymentMethod: "", paymentStatus: "PENDIENTE", origin: "", saleDate: todayISO(), entryDate: todayISO(), exitDate: plusDays(todayISO(), Number(state.config.defaultStayDays || 5)), entryTime: "09:00", notes: "", commissionRate: state.config.commissionRate || 7, commissionDiscountRate: state.config.commissionDiscountRate || 0, commissionDiscountFixed: 0,
      };
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  const sellerUser = state.users.find((u) => u.name === sale.seller && u.role === "seller");
  root.innerHTML = `
    <div class="modal">
      <div class="panel-title"><h2>${editing ? "Editar registro" : "Nuevo registro"}</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <form id="saleForm" class="form-grid">
        <input type="hidden" name="id" value="${sale.id || ""}" />
        <div><label>Vendedor</label>${can("seller") ? `<input name="seller" value="${escapeHtml(sale.seller || state.user.name)}" readonly />` : `<select name="seller">${sellerOptions(sale.seller)}</select>`}</div>
        <div><label>Cliente</label><input name="client" value="${escapeHtml(sale.client || "")}" required /></div>
        <div><label>Teléfono</label><input name="phone" value="${escapeHtml(sale.phone || "")}" /></div>
        <div><label>Auto</label><input name="car" value="${escapeHtml(sale.car || "")}" required /></div>
        <div><label>Placa</label><input name="plate" value="${escapeHtml(sale.plate || "")}" /></div>
        <div><label>Producto</label><input name="product" value="${escapeHtml(sale.product || "")}" /></div>
        ${canSeeFinancial() ? `<div><label>Valor de venta</label><input type="number" step="0.01" name="saleValue" value="${sale.saleValue || ""}" ${canEditFinancial() ? "" : "readonly"} /></div><div><label>Seña</label><input type="number" step="0.01" name="deposit" value="${sale.deposit || ""}" ${canEditFinancial() ? "" : "readonly"} /></div><div><label>% comisión</label><input type="number" step="0.1" name="commissionRate" value="${sale.commissionRate || sellerUser?.commissionRate || state.config.commissionRate || 7}" ${canEditFinancial() ? "" : "readonly"} /></div><div><label>% descuento/impuesto</label><input type="number" step="0.1" name="commissionDiscountRate" value="${sale.commissionDiscountRate || sellerUser?.commissionDiscountRate || state.config.commissionDiscountRate || 0}" ${canEditFinancial() ? "" : "readonly"} /></div><div><label>Descuento fijo</label><input type="number" step="0.01" name="commissionDiscountFixed" value="${sale.commissionDiscountFixed || 0}" ${canEditFinancial() ? "" : "readonly"} /></div><div><label>Forma de pago</label><input name="paymentMethod" value="${escapeHtml(sale.paymentMethod || "")}" ${canEditFinancial() ? "" : "readonly"} /></div><div><label>Estado del pago</label><select name="paymentStatus" ${canEditFinancial() ? "" : "disabled"}>${["PENDIENTE","PARCIAL","PAGO FINALIZADO"].map((x) => `<option ${sale.paymentStatus === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>` : ""}
        <div><label>Origen</label><input name="origin" value="${escapeHtml(sale.origin || "")}" /></div>
        <div><label>Fecha venta</label><input type="date" name="saleDate" value="${sale.saleDate || todayISO()}" /></div>
        <div><label>Fecha entrada</label><input type="date" name="entryDate" value="${sale.entryDate || todayISO()}" required /></div>
        <div><label>Hora entrada</label><input type="time" name="entryTime" value="${sale.entryTime || "09:00"}" /></div>
        <div><label>Fecha salida</label><input type="date" name="exitDate" value="${sale.exitDate || plusDays(todayISO(), 5)}" required /></div>
        <div class="full"><label>Observaciones</label><textarea name="notes" rows="4">${escapeHtml(sale.notes || "")}</textarea></div>
        <div class="full modal-actions"><button class="primary">${editing ? "Guardar cambios" : "Crear registro"}</button>${editing && can("admin") ? `<button type="button" class="danger" id="deleteFromModal">Eliminar de agenda</button>` : ""}</div>
      </form>
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  document.querySelector('[name="seller"]')?.addEventListener("change", (e) => {
    const seller = state.users.find((u) => u.name === e.target.value && u.role === "seller");
    const rateInput = document.querySelector('[name="commissionRate"]');
    const discountRateInput = document.querySelector('[name="commissionDiscountRate"]');
    const discountFixedInput = document.querySelector('[name="commissionDiscountFixed"]');
    if (seller && !editing) {
      if (rateInput) rateInput.value = seller.commissionRate || state.config.commissionRate || 7;
      if (discountRateInput) discountRateInput.value = seller.commissionDiscountRate || state.config.commissionDiscountRate || 0;
      if (discountFixedInput) discountFixedInput.value = seller.commissionDiscountFixed || 0;
    }
  });
  document.getElementById("deleteFromModal")?.addEventListener("click", async () => {
    await deleteSale(id);
    closeModal();
  });
  document.getElementById("saleForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (editing) await api(`/api/sales/${id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api(`/api/sales`, { method: "POST", body: JSON.stringify(data) });
      closeModal();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };
};

window.openUserModal = (id = null) => {
  const user = id ? state.users.find((u) => u.id === id) : { role: "seller", active: true, commissionRate: state.config.commissionRate || 7, commissionDiscountRate: state.config.commissionDiscountRate || 0, commissionDiscountFixed: 0 };
  const editing = !!id;
  const root = document.getElementById("modalRoot");
  root.classList.add("open");
  root.innerHTML = `
    <div class="modal user-modal">
      <div class="panel-title"><h2>${editing ? "Editar usuario" : "Nuevo usuario"}</h2><button class="secondary small" id="closeModalBtn">Cerrar</button></div>
      <form id="userForm" class="form-grid">
        <div><label>Nombre</label><input name="name" value="${escapeHtml(user.name || "")}" required /></div>
        <div><label>Usuario</label><input name="username" value="${escapeHtml(user.username || "")}" required /></div>
        <div><label>Rol</label><select name="role">${Object.keys(roleLabel).map((role) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${roleLabel[role]}</option>`).join("")}</select></div>
        <div><label>Contraseña ${editing ? "(solo si querés cambiarla)" : ""}</label><input type="password" name="password" ${editing ? "" : "required"} /></div>
        <div><label>Comisión %</label><input type="number" step="0.1" name="commissionRate" value="${user.commissionRate || state.config.commissionRate || 7}" /></div>
        <div><label>Desc. / impuesto %</label><input type="number" step="0.1" name="commissionDiscountRate" value="${user.commissionDiscountRate || state.config.commissionDiscountRate || 0}" /></div>
        <div><label>Descuento fijo</label><input type="number" step="0.01" name="commissionDiscountFixed" value="${user.commissionDiscountFixed || 0}" /></div>
        <div><label>Estado</label><select name="active"><option value="true" ${user.active !== false ? "selected" : ""}>Activo</option><option value="false" ${user.active === false ? "selected" : ""}>Inactivo</option></select></div>
        <div class="full modal-actions"><button class="primary">${editing ? "Guardar usuario" : "Crear usuario"}</button>${editing && state.user.id !== user.id ? `<button type="button" class="danger" id="deleteUserBtn">Eliminar usuario</button>` : ""}</div>
      </form>
    </div>`;
  document.getElementById("closeModalBtn").onclick = closeModal;
  root.onclick = (e) => { if (e.target === root) closeModal(); };
  const roleSelect = document.querySelector('#userForm [name="role"]');
  const commissionInput = document.querySelector('#userForm [name="commissionRate"]');
  const discountRateInput = document.querySelector('#userForm [name="commissionDiscountRate"]');
  const discountFixedInput = document.querySelector('#userForm [name="commissionDiscountFixed"]');
  const syncCommissionField = () => {
    const enabled = roleSelect.value === "seller";
    [commissionInput, discountRateInput, discountFixedInput].forEach((input) => { input.disabled = !enabled; input.closest("div").style.opacity = enabled ? "1" : ".55"; });
  };
  roleSelect.addEventListener("change", syncCommissionField);
  syncCommissionField();
  document.getElementById("deleteUserBtn")?.addEventListener("click", async () => {
    await deleteUser(id);
    closeModal();
  });
  document.getElementById("userForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (editing) await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api(`/api/users`, { method: "POST", body: JSON.stringify(data) });
      closeModal();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };
};

function closeModal() {
  const root = document.getElementById("modalRoot");
  root.classList.remove("open");
  root.innerHTML = "";
}

async function saveConfig(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  ["weeklySlots", "dailyCapacity", "defaultStayDays", "commissionRate", "commissionDiscountRate"].forEach((k) => data[k] = Number(data[k] || 0));
  try {
    await api("/api/config", { method: "PUT", body: JSON.stringify(data) });
    await refresh();
    alert("Configuración guardada");
  } catch (err) {
    alert(err.message);
  }
}

loadSession();
