const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "store.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 14;
const WRITE_BACKUP_EVERY_MS = 1000 * 60 * 30;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const sessions = new Map();
let lastBackupAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
}

function makePassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPassword(password, salt) };
}

function verifyPassword(password, user) {
  if (!user.password || !user.password.salt || !user.password.hash) {
    return false;
  }

  const expected = Buffer.from(user.password.hash, "hex");
  const actual = Buffer.from(hashPassword(password, user.password.salt), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function seedStore() {
  const adminPass = makePassword("admin123");
  const waiterPass = makePassword("waiter123");
  const kitchenPass = makePassword("kitchen123");

  return {
    version: 2,
    settings: {
      restaurantName: "Restaurant Orders",
      currency: "EUR",
      taxRate: 0,
      serviceRate: 0,
      requireKitchenConfirm: true
    },
    users: [
      { id: "u_admin", name: "Manager", username: "admin", role: "admin", active: true, password: adminPass, createdAt: nowIso() },
      { id: "u_waiter_arta", name: "Arta", username: "arta", role: "waiter", active: true, password: waiterPass, createdAt: nowIso() },
      { id: "u_waiter_jon", name: "Jon", username: "jon", role: "waiter", active: true, password: waiterPass, createdAt: nowIso() },
      { id: "u_kitchen", name: "Kitchen", username: "kitchen", role: "kitchen", active: true, password: kitchenPass, createdAt: nowIso() }
    ],
    products: [
      { id: "p1", name: "Margherita Pizza", category: "Pizza", price: 7.5, available: true, sort: 10 },
      { id: "p2", name: "Prosciutto Pizza", category: "Pizza", price: 9.2, available: true, sort: 20 },
      { id: "p3", name: "Chicken Caesar Salad", category: "Salads", price: 6.8, available: true, sort: 30 },
      { id: "p4", name: "Beef Burger", category: "Grill", price: 8.4, available: true, sort: 40 },
      { id: "p5", name: "Grilled Salmon", category: "Main", price: 13.5, available: true, sort: 50 },
      { id: "p6", name: "Penne Arrabbiata", category: "Pasta", price: 7.9, available: true, sort: 60 },
      { id: "p7", name: "Tiramisu", category: "Dessert", price: 4.2, available: true, sort: 70 },
      { id: "p8", name: "Sparkling Water", category: "Drinks", price: 1.8, available: true, sort: 80 },
      { id: "p9", name: "House Lemonade", category: "Drinks", price: 2.6, available: true, sort: 90 },
      { id: "p10", name: "Espresso", category: "Drinks", price: 1.4, available: true, sort: 100 }
    ],
    orders: [],
    cashClosures: [],
    audit: []
  };
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    writeStore(seedStore(), { skipBackup: true });
  }
}

function migrateStore(store) {
  let changed = false;
  if (!store.version || store.version < 2) {
    const seeded = seedStore();
    const waiters = Array.isArray(store.waiters) ? store.waiters : [];
    const legacyUsers = waiters.map((waiter, index) => ({
      id: waiter.id || uid("u_waiter"),
      name: waiter.name || `Waiter ${index + 1}`,
      username: String(waiter.name || `waiter${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, ""),
      role: "waiter",
      active: true,
      password: makePassword("waiter123"),
      createdAt: nowIso()
    }));

    store = {
      version: 2,
      settings: seeded.settings,
      users: [seeded.users[0]].concat(legacyUsers.length ? legacyUsers : seeded.users.slice(1)),
      products: (store.products || seeded.products).map((product, index) => ({
        id: product.id || uid("p"),
        name: product.name,
        category: product.category || "Menu",
        price: money(product.price),
        available: product.available !== false,
        sort: product.sort || (index + 1) * 10
      })),
      orders: (store.orders || []).map(order => ({
        ...order,
        waiterId: order.waiterId || (legacyUsers[0] && legacyUsers[0].id) || "u_waiter_arta",
        payment: order.payment || null,
        discount: money(order.discount || 0),
        canceledAt: order.canceledAt || null,
        canceledReason: order.canceledReason || ""
      })),
      cashClosures: [],
      audit: []
    };
    changed = true;
  }

  if (!Array.isArray(store.users) || !store.users.some(user => user.role === "kitchen")) {
    store.users = store.users || [];
    store.users.push(seedStore().users.find(user => user.role === "kitchen"));
    changed = true;
  }
  store.products = store.products || [];
  store.orders = store.orders || [];
  store.cashClosures = store.cashClosures || [];
  store.audit = store.audit || [];
  store.settings = store.settings || seedStore().settings;

  if (changed) {
    writeStore(store);
  }
  return store;
}

function readStore() {
  ensureStore();
  return migrateStore(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
}

function writeStore(data, options) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  const json = JSON.stringify(data, null, 2);
  const tmp = `${DATA_FILE}.tmp`;
  if (!options || !options.skipBackup) {
    backupStore();
  }
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, DATA_FILE);
}

function backupStore() {
  if (!fs.existsSync(DATA_FILE)) {
    return;
  }
  const current = Date.now();
  if (current - lastBackupAt < WRITE_BACKUP_EVERY_MS) {
    return;
  }
  lastBackupAt = current;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `store-${stamp}.json`));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1000000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function cleanUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active
  };
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.indexOf("Bearer ") === 0) {
    return header.slice(7);
  }
  return "";
}

function currentUser(req, store) {
  const token = getToken(req);
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  const user = store.users.find(item => item.id === session.userId && item.active);
  if (!user) {
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return user;
}

function requireUser(req, res, store, roles) {
  const user = currentUser(req, store);
  if (!user) {
    sendJson(res, 401, { error: "Please log in." });
    return null;
  }
  if (roles && roles.length && roles.indexOf(user.role) === -1 && user.role !== "admin") {
    sendJson(res, 403, { error: "You do not have permission for this action." });
    return null;
  }
  return user;
}

function audit(store, user, action, details) {
  store.audit.unshift({
    id: uid("a"),
    action,
    userId: user ? user.id : "system",
    userName: user ? user.name : "System",
    details: details || {},
    at: nowIso()
  });
  store.audit = store.audit.slice(0, 1000);
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    available: product.available !== false,
    sort: product.sort || 0
  };
}

function orderSubtotal(order) {
  return money(order.items.reduce((sum, item) => sum + item.price * item.quantity, 0));
}

function orderTotal(order) {
  return money(orderSubtotal(order) - money(order.discount || 0) + money(order.tax || 0) + money(order.service || 0));
}

function publicOrder(order, store) {
  const waiter = store.users.find(user => user.id === order.waiterId);
  return {
    ...order,
    waiterName: waiter ? waiter.name : "Unknown waiter",
    subtotal: orderSubtotal(order),
    total: orderTotal(order)
  };
}

function visibleOrders(store, user) {
  if (user.role === "waiter") {
    return store.orders.filter(order => order.waiterId === user.id);
  }
  return store.orders;
}

function createOrder(payload, store, user) {
  const table = String(payload.table || "").trim();
  if (!table) throw new Error("Enter a table number or customer name.");

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.map(item => {
    const product = store.products.find(candidate => candidate.id === item.productId && candidate.available !== false);
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return null;
    }
    return {
      productId: product.id,
      name: product.name,
      category: product.category,
      price: money(product.price),
      quantity,
      note: String(item.note || "").trim().slice(0, 240)
    };
  }).filter(Boolean);

  if (!items.length) throw new Error("Add at least one available product.");

  const now = nowIso();
  const subtotal = money(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const tax = money(subtotal * money(store.settings.taxRate || 0));
  const service = money(subtotal * money(store.settings.serviceRate || 0));

  return {
    id: uid("o"),
    number: (store.orders.reduce((max, order) => Math.max(max, Number(order.number) || 0), 0) || 0) + 1,
    table,
    waiterId: user.id,
    status: "sent",
    paymentStatus: "open",
    items,
    notes: String(payload.notes || "").trim().slice(0, 500),
    discount: 0,
    tax,
    service,
    payment: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    canceledAt: null,
    canceledReason: "",
    history: [{ status: "sent", label: "Sent to kitchen", userId: user.id, userName: user.name, at: now }]
  };
}

function updateOrderStatus(order, status, user) {
  const transitions = {
    sent: ["received"],
    received: ["preparing", "done"],
    preparing: ["done"],
    done: []
  };
  if (order.paymentStatus !== "open") throw new Error("Closed orders cannot be changed.");
  if (!transitions[order.status] || transitions[order.status].indexOf(status) === -1) {
    throw new Error(`Cannot move order from ${order.status} to ${status}.`);
  }
  order.status = status;
  order.updatedAt = nowIso();
  order.history.push({ status, label: status, userId: user.id, userName: user.name, at: order.updatedAt });
}

function closePaid(order, payload, user) {
  if (order.paymentStatus !== "open") throw new Error("Order is already closed.");
  if (order.status !== "done") throw new Error("Only kitchen-completed orders can be marked paid.");

  const method = String(payload.method || "cash");
  if (["cash", "card", "mixed", "other"].indexOf(method) === -1) {
    throw new Error("Choose a valid payment method.");
  }
  const discount = money(payload.discount || 0);
  if (discount < 0 || discount > orderSubtotal(order)) {
    throw new Error("Discount cannot be negative or higher than the subtotal.");
  }

  order.discount = discount;
  order.paymentStatus = "paid";
  order.paidAt = nowIso();
  order.updatedAt = order.paidAt;
  order.payment = {
    method,
    amountReceived: money(payload.amountReceived || orderTotal(order)),
    tip: money(payload.tip || 0),
    note: String(payload.note || "").trim().slice(0, 240),
    closedBy: user.id
  };
  order.history.push({ status: "paid", label: "Paid and closed", userId: user.id, userName: user.name, at: order.paidAt });
}

function cancelOrder(order, payload, user) {
  if (order.paymentStatus === "paid") throw new Error("Paid orders cannot be canceled.");
  order.paymentStatus = "void";
  order.status = "canceled";
  order.canceledAt = nowIso();
  order.updatedAt = order.canceledAt;
  order.canceledReason = String(payload.reason || "Canceled").trim().slice(0, 240);
  order.history.push({ status: "canceled", label: order.canceledReason, userId: user.id, userName: user.name, at: order.canceledAt });
}

function reportForDay(store, date) {
  const paidOrders = store.orders.filter(order => order.paymentStatus === "paid" && order.paidAt && order.paidAt.slice(0, 10) === date);
  const voidOrders = store.orders.filter(order => order.paymentStatus === "void" && order.canceledAt && order.canceledAt.slice(0, 10) === date);
  const byWaiter = store.users.filter(user => user.role === "waiter").map(waiter => {
    const waiterOrders = paidOrders.filter(order => order.waiterId === waiter.id);
    return {
      waiterId: waiter.id,
      waiterName: waiter.name,
      orders: waiterOrders.length,
      total: money(waiterOrders.reduce((sum, order) => sum + orderTotal(order), 0)),
      tips: money(waiterOrders.reduce((sum, order) => sum + money(order.payment && order.payment.tip), 0))
    };
  });
  const byMethod = ["cash", "card", "mixed", "other"].map(method => {
    const methodOrders = paidOrders.filter(order => order.payment && order.payment.method === method);
    return {
      method,
      orders: methodOrders.length,
      total: money(methodOrders.reduce((sum, order) => sum + orderTotal(order), 0))
    };
  });

  return {
    date,
    orderCount: paidOrders.length,
    voidCount: voidOrders.length,
    total: money(paidOrders.reduce((sum, order) => sum + orderTotal(order), 0)),
    subtotal: money(paidOrders.reduce((sum, order) => sum + orderSubtotal(order), 0)),
    discounts: money(paidOrders.reduce((sum, order) => sum + money(order.discount), 0)),
    tips: money(paidOrders.reduce((sum, order) => sum + money(order.payment && order.payment.tip), 0)),
    byWaiter,
    byMethod,
    orders: paidOrders.map(order => publicOrder(order, store)),
    voidOrders: voidOrders.map(order => publicOrder(order, store))
  };
}

function parseProduct(payload, existing) {
  const name = String(payload.name || "").trim();
  const category = String(payload.category || "Menu").trim();
  const price = money(payload.price);
  if (!name) throw new Error("Product name is required.");
  if (!category) throw new Error("Product category is required.");
  if (!(price >= 0)) throw new Error("Product price must be zero or higher.");

  return {
    id: existing ? existing.id : uid("p"),
    name: name.slice(0, 120),
    category: category.slice(0, 80),
    price,
    available: payload.available !== false,
    sort: Number(payload.sort || (existing && existing.sort) || 999)
  };
}

async function handleApi(req, res, url) {
  const store = readStore();

  try {
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const payload = await readBody(req);
      const username = String(payload.username || "").trim().toLowerCase();
      const user = store.users.find(item => item.username.toLowerCase() === username && item.active);
      if (!user || !verifyPassword(payload.password || "", user)) {
        sendJson(res, 401, { error: "Invalid username or password." });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
      audit(store, user, "login", {});
      writeStore(store);
      sendJson(res, 200, { token, user: cleanUser(user) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      sessions.delete(getToken(req));
      sendJson(res, 200, { ok: true });
      return;
    }

    const user = requireUser(req, res, store);
    if (!user) return;

    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      sendJson(res, 200, {
        me: cleanUser(user),
        settings: store.settings,
        users: user.role === "admin" ? store.users.map(cleanUser) : [],
        products: store.products.map(publicProduct).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
        orders: visibleOrders(store, user).map(order => publicOrder(order, store))
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      sendJson(res, 200, visibleOrders(store, user).map(order => publicOrder(order, store)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const allowed = requireUser(req, res, store, ["waiter"]);
      if (!allowed) return;
      const order = createOrder(await readBody(req), store, allowed);
      store.orders.unshift(order);
      audit(store, allowed, "order.create", { orderId: order.id, number: order.number, total: orderTotal(order) });
      writeStore(store);
      sendJson(res, 201, publicOrder(order, store));
      return;
    }

    const statusMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (req.method === "PATCH" && statusMatch) {
      const kitchen = requireUser(req, res, store, ["kitchen"]);
      if (!kitchen) return;
      const order = store.orders.find(item => item.id === statusMatch[1]);
      if (!order) {
        sendJson(res, 404, { error: "Order not found." });
        return;
      }
      const payload = await readBody(req);
      updateOrderStatus(order, String(payload.status || ""), kitchen);
      audit(store, kitchen, "order.status", { orderId: order.id, status: order.status });
      writeStore(store);
      sendJson(res, 200, publicOrder(order, store));
      return;
    }

    const paidMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/paid$/);
    if (req.method === "PATCH" && paidMatch) {
      const closer = requireUser(req, res, store, ["waiter"]);
      if (!closer) return;
      const order = store.orders.find(item => item.id === paidMatch[1]);
      if (!order) {
        sendJson(res, 404, { error: "Order not found." });
        return;
      }
      if (closer.role === "waiter" && order.waiterId !== closer.id) {
        sendJson(res, 403, { error: "Waiters can only close their own orders." });
        return;
      }
      closePaid(order, await readBody(req), closer);
      audit(store, closer, "order.paid", { orderId: order.id, total: orderTotal(order), method: order.payment.method });
      writeStore(store);
      sendJson(res, 200, publicOrder(order, store));
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (req.method === "PATCH" && cancelMatch) {
      const order = store.orders.find(item => item.id === cancelMatch[1]);
      if (!order) {
        sendJson(res, 404, { error: "Order not found." });
        return;
      }
      if (user.role === "kitchen") {
        sendJson(res, 403, { error: "Kitchen cannot cancel orders." });
        return;
      }
      if (user.role === "waiter" && order.waiterId !== user.id) {
        sendJson(res, 403, { error: "Waiters can only cancel their own orders." });
        return;
      }
      cancelOrder(order, await readBody(req), user);
      audit(store, user, "order.cancel", { orderId: order.id, reason: order.canceledReason });
      writeStore(store);
      sendJson(res, 200, publicOrder(order, store));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/reports/day") {
      const reportUser = requireUser(req, res, store, ["admin"]);
      if (!reportUser) return;
      const date = url.searchParams.get("date") || nowIso().slice(0, 10);
      sendJson(res, 200, reportForDay(store, date));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reports/close-day") {
      const admin = requireUser(req, res, store, ["admin"]);
      if (!admin) return;
      const payload = await readBody(req);
      const date = payload.date || nowIso().slice(0, 10);
      const report = reportForDay(store, date);
      const closure = {
        id: uid("close"),
        date,
        expectedCash: money(report.byMethod.find(row => row.method === "cash").total),
        countedCash: money(payload.countedCash || 0),
        note: String(payload.note || "").trim().slice(0, 240),
        report,
        closedBy: admin.id,
        closedByName: admin.name,
        closedAt: nowIso()
      };
      store.cashClosures.unshift(closure);
      audit(store, admin, "report.close-day", { date, total: report.total });
      writeStore(store);
      sendJson(res, 201, closure);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      const admin = requireUser(req, res, store, ["admin"]);
      if (!admin) return;
      sendJson(res, 200, store.audit.slice(0, 200));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const admin = requireUser(req, res, store, ["admin"]);
      if (!admin) return;
      const product = parseProduct(await readBody(req));
      store.products.push(product);
      audit(store, admin, "product.create", { productId: product.id, name: product.name });
      writeStore(store);
      sendJson(res, 201, publicProduct(product));
      return;
    }

    const productMatch = url.pathname.match(/^\/api\/products\/([^/]+)$/);
    if (productMatch && req.method === "PATCH") {
      const admin = requireUser(req, res, store, ["admin"]);
      if (!admin) return;
      const product = store.products.find(item => item.id === productMatch[1]);
      if (!product) {
        sendJson(res, 404, { error: "Product not found." });
        return;
      }
      const updated = parseProduct(await readBody(req), product);
      Object.assign(product, updated);
      audit(store, admin, "product.update", { productId: product.id, name: product.name });
      writeStore(store);
      sendJson(res, 200, publicProduct(product));
      return;
    }

    sendJson(res, 404, { error: "API route not found." });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(fallback);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

ensureStore();
server.listen(PORT, () => {
  console.log(`Restaurant ordering app running at http://localhost:${PORT}`);
});
