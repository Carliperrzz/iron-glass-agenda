const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const dayjs = require("dayjs");
const isBetween = require("dayjs/plugin/isBetween");
dayjs.extend(isBetween);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");
const DEFAULT_COMMISSION_RATE = Number(process.env.DEFAULT_COMMISSION_RATE || 7);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "iron-glass-agenda-secret",
  resave: false,
  saveUninitialized: false,
}));
app.use((req,res,next)=>{
  res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma","no-cache");
  res.setHeader("Expires","0");
  next();
});
app.use(express.static(path.join(__dirname, "public"), { etag: false, lastModified: false, maxAge: 0 }));

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}
function loadDb() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  db.config = { commissionRate: DEFAULT_COMMISSION_RATE, ...db.config };
  db.users = (db.users || []).map((u) => ({
    commissionRate: Number(u.commissionRate ?? db.config.commissionRate ?? DEFAULT_COMMISSION_RATE),
    commissionDiscountRate: Number(u.commissionDiscountRate ?? db.config.commissionDiscountRate ?? 0),
    commissionDiscountFixed: Number(u.commissionDiscountFixed ?? 0),
    active: u.active !== false,
    ...u,
  }));
  db.sales = (db.sales || []).map((s) => {
    const commissionRate = Number(s.commissionRate ?? db.config.commissionRate ?? DEFAULT_COMMISSION_RATE);
    const commissionDiscountRate = Number(s.commissionDiscountRate ?? db.config.commissionDiscountRate ?? 0);
    const commissionDiscountFixed = Number(s.commissionDiscountFixed ?? 0);
    const saleValue = Number(s.saleValue || 0);
    const commissionGross = Number(s.commissionGross ?? (saleValue * commissionRate / 100));
    const commissionDiscount = Number(s.commissionDiscount ?? ((commissionGross * commissionDiscountRate / 100) + commissionDiscountFixed));
    const commissionNet = Number(s.commissionNet ?? Math.max(0, commissionGross - commissionDiscount));
    return {
      commissionRate,
      commissionDiscountRate,
      commissionDiscountFixed,
      commissionGross,
      commissionDiscount,
      commissionNet,
      receptionNotes: s.receptionNotes || "",
      receptionIssueType: s.receptionIssueType || "",
      receptionPhoto: s.receptionPhoto || "",
      receptionPhotoName: s.receptionPhotoName || "",
      ...s,
    };
  });
  return db;
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}
function computeCommissionSnapshot(sourceSale, config, sellerUser) {
  const saleValue = Number(sourceSale.saleValue || 0);
  const commissionRate = Number(sourceSale.commissionRate ?? sellerUser?.commissionRate ?? config.commissionRate ?? DEFAULT_COMMISSION_RATE);
  const commissionDiscountRate = Number(sourceSale.commissionDiscountRate ?? sellerUser?.commissionDiscountRate ?? config.commissionDiscountRate ?? 0);
  const commissionDiscountFixed = Number(sourceSale.commissionDiscountFixed ?? sellerUser?.commissionDiscountFixed ?? 0);
  const commissionGross = Number((saleValue * commissionRate / 100).toFixed(2));
  const commissionDiscount = Number(((commissionGross * commissionDiscountRate / 100) + commissionDiscountFixed).toFixed(2));
  const commissionNet = Number(Math.max(0, commissionGross - commissionDiscount).toFixed(2));
  return { commissionRate, commissionDiscountRate, commissionDiscountFixed, commissionGross, commissionDiscount, commissionNet };
}
function sanitizeUser(input, db, current) {
  const user = current ? { ...current } : { id: crypto.randomBytes(4).toString("hex") };
  user.name = String(input.name || user.name || "").trim();
  user.username = String(input.username || user.username || "").trim();
  user.role = input.role || user.role || "viewer";
  user.active = input.active === undefined ? (user.active !== false) : [true, "true", "on", "1", 1].includes(input.active);
  user.commissionRate = Number(input.commissionRate ?? user.commissionRate ?? db.config.commissionRate ?? DEFAULT_COMMISSION_RATE);
  user.commissionDiscountRate = Number(input.commissionDiscountRate ?? user.commissionDiscountRate ?? db.config.commissionDiscountRate ?? 0);
  user.commissionDiscountFixed = Number(input.commissionDiscountFixed ?? user.commissionDiscountFixed ?? 0);
  if (input.password) user.passwordHash = hashPassword(input.password);
  return user;
}
function userPublic(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active !== false,
    commissionRate: Number(user.commissionRate ?? DEFAULT_COMMISSION_RATE),
    commissionDiscountRate: Number(user.commissionDiscountRate ?? 0),
    commissionDiscountFixed: Number(user.commissionDiscountFixed ?? 0),
  };
}
function sanitizeSale(sale, config, sellerUser) {
  const defaultExit = sale.entryDate
    ? dayjs(sale.entryDate).add(config.defaultStayDays, "day").format("YYYY-MM-DD")
    : dayjs().add(config.defaultStayDays, "day").format("YYYY-MM-DD");
  const commission = computeCommissionSnapshot(sale, config, sellerUser);
  return {
    id: sale.id || crypto.randomBytes(4).toString("hex"),
    seller: sale.seller || "",
    client: sale.client || "",
    phone: sale.phone || "",
    car: sale.car || "",
    plate: sale.plate || "",
    product: sale.product || "",
    saleValue: Number(sale.saleValue || 0),
    deposit: Number(sale.deposit || 0),
    paymentMethod: sale.paymentMethod || "",
    paymentStatus: sale.paymentStatus || "PENDIENTE",
    origin: sale.origin || "",
    saleDate: sale.saleDate || dayjs().format("YYYY-MM-DD"),
    entryDate: sale.entryDate || dayjs().format("YYYY-MM-DD"),
    exitDate: sale.exitDate || defaultExit,
    entryTime: sale.entryTime || "09:00",
    receivedAt: sale.receivedAt || null,
    receivedBy: sale.receivedBy || "",
    workStartedAt: sale.workStartedAt || null,
    workFinishedAt: sale.workFinishedAt || null,
    deliveredAt: sale.deliveredAt || null,
    status: sale.status || "scheduled",
    commissionRate: commission.commissionRate,
    commissionDiscountRate: commission.commissionDiscountRate,
    commissionDiscountFixed: commission.commissionDiscountFixed,
    commissionGross: commission.commissionGross,
    commissionDiscount: commission.commissionDiscount,
    commissionNet: commission.commissionNet,
    notes: sale.notes || "",
    receptionNotes: sale.receptionNotes || "",
    receptionIssueType: sale.receptionIssueType || "",
    receptionPhoto: sale.receptionPhoto || "",
    receptionPhotoName: sale.receptionPhotoName || "",
  };
}
function roleAllowed(user, roles) {
  return user && roles.includes(user.role);
}
function computeAutoStatus(sale, config, now = dayjs()) {
  if (sale.deliveredAt) return "delivered";
  if (sale.workFinishedAt) return "ready_delivery";
  if (sale.workStartedAt) return "in_progress";
  if (sale.receivedAt) return "received";
  if (!sale.entryDate) return sale.status || "sold";
  const entryDay = dayjs(sale.entryDate);
  const warning = dayjs(`${sale.entryDate}T${config.warningHour}:00`);
  const critical = dayjs(`${sale.entryDate}T${config.criticalHour}:00`);
  if (sale.status === "no_show") return "no_show";
  if (entryDay.isAfter(now, "day")) return "scheduled";
  if (entryDay.isSame(now, "day")) {
    if (now.isAfter(critical)) return "critical_missing";
    if (now.isAfter(warning)) return "warning_missing";
    return "scheduled_today";
  }
  if (entryDay.isBefore(now, "day") && !sale.receivedAt) return "no_show";
  return sale.status || "scheduled";
}
function statusLabel(status) {
  return {
    sold: "Vendido",
    scheduled: "Agendado",
    scheduled_today: "Agendado hoje",
    warning_missing: "Pendente de entrada",
    critical_missing: "Não chegou / contatar",
    received: "Recebido",
    in_progress: "Em produção",
    ready_delivery: "Listo para entrega",
    delivered: "Entregado",
    no_show: "No ingresó",
  }[status] || status;
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "No autenticado" });
  next();
}
function requireRoles(roles) {
  return (req, res, next) => {
    if (!roleAllowed(req.session.user, roles)) return res.status(403).json({ error: "Sin permiso" });
    next();
  };
}
function getVisibleSales(db, user) {
  let sales = db.sales.map((s) => ({ ...s, autoStatus: computeAutoStatus(s, db.config, dayjs()) }));
  if (user.role === "seller") sales = sales.filter((s) => s.seller === user.name);
  return sales;
}
function buildCommissions(sales, rateDefault) {
  const delivered = sales.filter((s) => s.deliveredAt);
  const base = delivered.length ? delivered : sales;
  const totalSalesValue = sales.reduce((sum, s) => sum + Number(s.saleValue || 0), 0);
  const totalGross = base.reduce((sum, s) => sum + Number(s.commissionGross ?? ((Number(s.saleValue || 0) * Number(s.commissionRate || rateDefault || DEFAULT_COMMISSION_RATE)) / 100)), 0);
  const totalDiscount = base.reduce((sum, s) => sum + Number(s.commissionDiscount || 0), 0);
  const totalNet = base.reduce((sum, s) => sum + Number(s.commissionNet ?? Math.max(0, Number(s.commissionGross || 0) - Number(s.commissionDiscount || 0))), 0);
  return {
    totalSalesValue,
    totalCommission: totalNet,
    totalGross,
    totalDiscount,
    totalNet,
    salesCount: sales.length,
    deliveredCount: delivered.length,
    commissionBase: delivered.length ? "entregues" : "vendidos",
  };
}

function buildCommissionBreakdown(db, user) {
  const visibleSales = getVisibleSales(db, user);
  const grouped = new Map();
  for (const sale of visibleSales) {
    const sellerName = sale.seller || "Sin vendedor";
    if (!grouped.has(sellerName)) {
      const sellerUser = db.users.find((u) => u.name === sellerName && u.role === "seller");
      grouped.set(sellerName, {
        seller: sellerName,
        commissionRate: Number(sellerUser?.commissionRate ?? sale.commissionRate ?? db.config.commissionRate ?? DEFAULT_COMMISSION_RATE),
        commissionDiscountRate: Number(sellerUser?.commissionDiscountRate ?? sale.commissionDiscountRate ?? db.config.commissionDiscountRate ?? 0),
        commissionDiscountFixed: Number(sellerUser?.commissionDiscountFixed ?? 0),
        salesCount: 0,
        deliveredCount: 0,
        totalSalesValue: 0,
        totalGross: 0,
        totalDiscount: 0,
        totalNet: 0,
        sales: [],
      });
    }
    const row = grouped.get(sellerName);
    row.salesCount += 1;
    if (sale.deliveredAt) row.deliveredCount += 1;
    row.totalSalesValue += Number(sale.saleValue || 0);
    row.totalGross += Number(sale.commissionGross || 0);
    row.totalDiscount += Number(sale.commissionDiscount || 0);
    row.totalNet += Number(sale.commissionNet || 0);
    row.sales.push({
      id: sale.id,
      client: sale.client,
      car: sale.car,
      product: sale.product,
      saleValue: Number(sale.saleValue || 0),
      commissionRate: Number(sale.commissionRate || 0),
      commissionDiscountRate: Number(sale.commissionDiscountRate || 0),
      commissionDiscountFixed: Number(sale.commissionDiscountFixed || 0),
      commissionGross: Number(sale.commissionGross || 0),
      commissionDiscount: Number(sale.commissionDiscount || 0),
      commissionNet: Number(sale.commissionNet || 0),
      status: sale.status,
      deliveredAt: sale.deliveredAt,
      saleDate: sale.saleDate,
    });
  }
  return Array.from(grouped.values()).sort((a, b) => b.totalNet - a.totalNet || a.seller.localeCompare(b.seller));
}

function getEffectiveEntryDay(sale) {
  return sale.entryDate || (sale.receivedAt ? dayjs(sale.receivedAt).format("YYYY-MM-DD") : null);
}
function getEffectiveExitDay(sale) {
  return sale.exitDate || getEffectiveEntryDay(sale);
}
function occupiesDay(sale, isoDay) {
  if (["no_show", "cancelled"].includes(sale.status)) return false;
  const start = getEffectiveEntryDay(sale);
  const end = getEffectiveExitDay(sale);
  if (!start || !end) return false;
  if (sale.deliveredAt && dayjs(sale.deliveredAt).isBefore(dayjs(isoDay), "day")) return false;
  return dayjs(isoDay).isBetween(dayjs(start), dayjs(end), "day", "[]");
}
function overlapsRange(sale, from, to) {
  if (["no_show", "cancelled"].includes(sale.status)) return false;
  const start = getEffectiveEntryDay(sale);
  const end = getEffectiveExitDay(sale);
  if (!start || !end) return false;
  if (sale.deliveredAt && dayjs(sale.deliveredAt).isBefore(from, "day")) return false;
  return !dayjs(end).isBefore(from, "day") && !dayjs(start).isAfter(to, "day");
}
function buildDashboard(db, user) {
  const now = dayjs();
  const sales = getVisibleSales(db, user);
  const start = now.startOf("week");
  const end = now.endOf("week");
  const bookedThisWeek = sales.filter((s) => overlapsRange(s, start, end)).length;
  const today = now.format("YYYY-MM-DD");
  const occupancyToday = sales.filter((s) => occupiesDay(s, today)).length;
  return {
    weeklySlots: db.config.weeklySlots,
    bookedThisWeek,
    freeThisWeek: Math.max(0, db.config.weeklySlots - bookedThisWeek),
    entriesToday: sales.filter((s) => getEffectiveEntryDay(s) === today).length,
    exitsToday: sales.filter((s) => getEffectiveExitDay(s) === today).length,
    inWorkshop: occupancyToday,
    pendingReception: sales.filter((s) => ["warning_missing", "critical_missing"].includes(s.autoStatus)).length,
    readyDelivery: sales.filter((s) => s.autoStatus === "ready_delivery").length,
  };
}
function ensureUniqueUsername(db, username, excludeId) {
  return !db.users.some((u) => u.username.toLowerCase() === username.toLowerCase() && u.id !== excludeId);
}
function getSellerUser(db, sellerName) {
  return db.users.find((u) => u.role === "seller" && u.name === sellerName);
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const db = loadDb();
  const user = db.users.find((u) => u.username === username && u.passwordHash === hashPassword(password));
  if (!user || user.active === false) return res.status(401).json({ error: "Usuario o contraseña inválidos" });
  req.session.user = userPublic(user);
  res.json({ user: req.session.user });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/session", (req, res) => res.json({ user: req.session.user || null }));

app.get("/api/bootstrap", requireAuth, (req, res) => {
  const db = loadDb();
  let sales = getVisibleSales(db, req.session.user).map((s) => ({
    ...s,
    autoStatusLabel: statusLabel(computeAutoStatus(s, db.config)),
  }));
  sales.sort((a, b) => `${a.entryDate || ""} ${a.entryTime || ""}`.localeCompare(`${b.entryDate || ""} ${b.entryTime || ""}`));
  const payload = {
    user: req.session.user,
    config: db.config,
    dashboard: buildDashboard(db, req.session.user),
    commissions: buildCommissions(sales, db.config.commissionRate),
    commissionBreakdown: buildCommissionBreakdown(db, req.session.user),
    sales,
  };
  if (["admin", "accounting"].includes(req.session.user.role)) payload.users = db.users.map(userPublic);
  res.json(payload);
});

app.get("/api/users", requireAuth, requireRoles(["admin"]), (req, res) => {
  const db = loadDb();
  res.json({ users: db.users.map(userPublic) });
});
app.post("/api/users", requireAuth, requireRoles(["admin"]), (req, res) => {
  const db = loadDb();
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "La contraseña es obligatoria" });
  const newUser = sanitizeUser(req.body, db);
  if (!newUser.name || !newUser.username) return res.status(400).json({ error: "Nombre y usuario son obligatorios" });
  if (!ensureUniqueUsername(db, newUser.username)) return res.status(400).json({ error: "Ese usuario ya existe" });
  db.users.push(newUser);
  saveDb(db);
  res.json({ ok: true, user: userPublic(newUser) });
});
app.put("/api/users/:id", requireAuth, requireRoles(["admin"]), (req, res) => {
  const db = loadDb();
  const idx = db.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Usuario no encontrado" });
  const existing = db.users[idx];
  const updated = sanitizeUser(req.body, db, existing);
  if (!updated.name || !updated.username) return res.status(400).json({ error: "Nombre y usuario son obligatorios" });
  if (!ensureUniqueUsername(db, updated.username, updated.id)) return res.status(400).json({ error: "Ese usuario ya existe" });
  db.users[idx] = updated;
  if (existing.role === "seller" || updated.role === "seller") {
    db.sales = db.sales.map((sale) => {
      if (sale.seller !== existing.name) return sale;
      const renamed = { ...sale, seller: updated.role === "seller" ? updated.name : sale.seller };
      if (updated.role === "seller") {
        return sanitizeSale({
          ...renamed,
          commissionRate: updated.commissionRate,
          commissionDiscountRate: updated.commissionDiscountRate,
          commissionDiscountFixed: updated.commissionDiscountFixed,
        }, db.config, updated);
      }
      return renamed;
    });
  }
  if (req.session.user && req.session.user.id === updated.id) {
    req.session.user = userPublic(updated);
  }
  saveDb(db);
  res.json({ ok: true, user: userPublic(updated) });
});

app.delete("/api/users/:id", requireAuth, requireRoles(["admin"]), (req, res) => {
  const db = loadDb();
  const idx = db.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Usuario no encontrado" });
  const target = db.users[idx];
  if (req.session.user && req.session.user.id === target.id) return res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
  db.users.splice(idx, 1);
  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/sales", requireAuth, requireRoles(["admin", "seller", "coordinator"]), (req, res) => {
  const db = loadDb();
  const sellerName = req.session.user.role === "seller" ? req.session.user.name : req.body.seller;
  const sellerUser = getSellerUser(db, sellerName);
  const sale = sanitizeSale({ ...req.body, seller: sellerName }, db.config, sellerUser);
  db.sales.push(sale);
  saveDb(db);
  res.json({ ok: true, sale });
});
app.put("/api/sales/:id", requireAuth, requireRoles(["admin", "seller", "coordinator", "reception", "operator"]), (req, res) => {
  const db = loadDb();
  const idx = db.sales.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Registro no encontrado" });
  const current = db.sales[idx];
  if (req.session.user.role === "seller") {
    if (current.seller !== req.session.user.name) return res.status(403).json({ error: "Solo puedes editar tus registros" });
    req.body.seller = current.seller;
    delete req.body.commissionRate;
  }
  if (["reception", "operator"].includes(req.session.user.role)) {
    ["seller","commissionRate","saleValue","deposit","paymentMethod","paymentStatus","origin","saleDate","product"].forEach((field) => delete req.body[field]);
  }
  const sellerUser = getSellerUser(db, req.body.seller || current.seller);
  const merged = { ...current, ...req.body };
  db.sales[idx] = sanitizeSale(merged, db.config, sellerUser);
  saveDb(db);
  res.json({ ok: true, sale: db.sales[idx] });
});
app.delete("/api/sales/:id", requireAuth, requireRoles(["admin"]), (req, res) => {
  const db = loadDb();
  const idx = db.sales.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Registro no encontrado" });
  db.sales.splice(idx, 1);
  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/sales/:id/receive", requireAuth, requireRoles(["admin", "coordinator", "reception"]), (req, res) => {
  const db = loadDb();
  const sale = db.sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "Registro no encontrado" });
  const today = dayjs().format("YYYY-MM-DD");
  sale.receivedAt = dayjs().toISOString();
  sale.receivedBy = req.session.user.name;
  sale.status = "received";
  sale.receptionNotes = String(req.body.receptionNotes || sale.receptionNotes || "").trim();
  sale.receptionIssueType = String(req.body.receptionIssueType || sale.receptionIssueType || "").trim();
  sale.receptionPhoto = String(req.body.receptionPhoto || sale.receptionPhoto || "");
  sale.receptionPhotoName = String(req.body.receptionPhotoName || sale.receptionPhotoName || "");
  if (!sale.entryDate || dayjs(sale.entryDate).isAfter(dayjs(today), "day")) sale.entryDate = today;
  if (!sale.exitDate) sale.exitDate = dayjs(today).add(Number(db.config.defaultStayDays || 5), "day").format("YYYY-MM-DD");
  saveDb(db);
  res.json({ ok: true });
});
app.post("/api/sales/:id/no-show", requireAuth, requireRoles(["admin", "coordinator", "reception", "seller"]), (req, res) => {
  const db = loadDb();
  const sale = db.sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "Registro no encontrado" });
  if (req.session.user.role === "seller" && sale.seller !== req.session.user.name) return res.status(403).json({ error: "Solo puedes editar tus registros" });
  sale.status = "no_show";
  saveDb(db);
  res.json({ ok: true });
});
app.post("/api/sales/:id/start", requireAuth, requireRoles(["admin", "coordinator", "operator", "reception"]), (req, res) => {
  const db = loadDb();
  const sale = db.sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "Registro no encontrado" });
  sale.workStartedAt = dayjs().toISOString();
  sale.status = "in_progress";
  saveDb(db);
  res.json({ ok: true });
});
app.post("/api/sales/:id/finish", requireAuth, requireRoles(["admin", "coordinator", "operator", "reception"]), (req, res) => {
  const db = loadDb();
  const sale = db.sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "Registro no encontrado" });
  sale.workFinishedAt = dayjs().toISOString();
  sale.status = "ready_delivery";
  saveDb(db);
  res.json({ ok: true });
});
app.post("/api/sales/:id/deliver", requireAuth, requireRoles(["admin", "coordinator", "reception"]), (req, res) => {
  const db = loadDb();
  const sale = db.sales.find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "Registro no encontrado" });
  sale.deliveredAt = dayjs().toISOString();
  sale.status = "delivered";
  saveDb(db);
  res.json({ ok: true });
});
app.put("/api/config", requireAuth, requireRoles(["admin"]), (req, res) => {
  const db = loadDb();
  db.config = {
    ...db.config,
    ...req.body,
    commissionRate: Number(req.body.commissionRate ?? db.config.commissionRate ?? DEFAULT_COMMISSION_RATE),
    commissionDiscountRate: Number(req.body.commissionDiscountRate ?? db.config.commissionDiscountRate ?? 0),
  };
  saveDb(db);
  res.json({ ok: true, config: db.config });
});
app.get("/api/capacity", requireAuth, (req, res) => {
  const db = loadDb();
  const { start, end } = req.query;
  const from = dayjs(start || dayjs().startOf("week").format("YYYY-MM-DD"));
  const to = dayjs(end || dayjs().endOf("week").format("YYYY-MM-DD"));
  const allSales = req.session.user.role === "seller" ? db.sales.filter((s) => s.seller === req.session.user.name) : db.sales;
  const days = [];
  for (let d = from; d.isBefore(to) || d.isSame(to, "day"); d = d.add(1, "day")) {
    const iso = d.format("YYYY-MM-DD");
    const occupancy = allSales.filter((s) => occupiesDay(s, iso)).length;
    days.push({ date: iso, occupancy, free: Math.max(0, db.config.dailyCapacity - occupancy) });
  }
  res.json({ days });
});
app.post("/api/import-xlsx", requireAuth, requireRoles(["admin"]), (req, res) => {
  try {
    const filePath = path.join(__dirname, "MARZ26.xlsx");
    if (!fs.existsSync(filePath)) return res.status(400).json({ error: "No se encontró MARZ26.xlsx en la raíz del proyecto" });
    const workbook = XLSX.readFile(filePath);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Ventas"], { defval: "" });
    const db = loadDb();
    rows.forEach((row) => {
      const sellerName = row["14"] || row["Vendedor"] || row["VENDEDOR"] || "";
      db.sales.push(sanitizeSale({
        seller: sellerName,
        client: row["Cliente"] || "",
        car: row["Auto"] || "",
        deposit: row["Seña"] || 0,
        saleValue: row["Valor de Venta"] || 0,
        entryDate: formatExcelDate(row["Día Recepción Auto"]),
        exitDate: formatExcelDate(row["Día Entrega"]),
        paymentMethod: row["Forma de Pago"] || "",
        paymentStatus: row["Estado del Pago"] || "PENDIENTE",
        saleDate: formatExcelDate(row["Fecha de Venta"]),
        product: row["Observaciones"] || "",
        origin: row["Origen"] || "",
        notes: `Película: ${row["Película"] || "-"} | Tonalidad: ${row["Tonalidad"] || "-"}`,
      }, db.config, getSellerUser(db, sellerName)));
    });
    saveDb(db);
    res.json({ ok: true, imported: rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
function formatExcelDate(value) {
  if (!value) return "";
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
}

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Iron Glass Agenda v1.3.4 rodando en http://localhost:${PORT}`));
