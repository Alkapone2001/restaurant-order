const crypto = require("crypto");
const webPush = require("web-push");
const { query, rawQuery, withTransaction } = require("./db");
const { money, nowIso, uid, makePassword, verifyPasswordAsync } = require("./security");

const SESSION_TTL_MS = 1000 * 60 * 60 * 14;
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || "Europe/Budapest";

function toNumber(value) {
  return Number(value || 0);
}

function json(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
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

function rowUser(row) {
  return row && {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    active: row.active,
    password: row.password,
    createdAt: row.created_at && row.created_at.toISOString ? row.created_at.toISOString() : row.created_at
  };
}

function rowProduct(row) {
  return row && {
    id: row.id,
    name: row.name,
    category: row.category,
    price: toNumber(row.price),
    available: row.available,
    sort: row.sort
  };
}

function rowOrder(row, waiterName) {
  if (!row) return null;
  const order = {
    id: row.id,
    number: row.number,
    table: row.table_name,
    waiterId: row.waiter_id,
    waiterName: waiterName || row.waiter_name || "Unknown waiter",
    paymentStatus: row.payment_status,
    items: row.items || [],
    notes: row.notes || "",
    discount: toNumber(row.discount),
    tax: toNumber(row.tax),
    service: toNumber(row.service),
    payment: row.payment,
    businessDate: row.business_date,
    createdAt: dateIso(row.created_at),
    updatedAt: dateIso(row.updated_at),
    paidAt: dateIso(row.paid_at),
    canceledAt: dateIso(row.canceled_at),
    canceledReason: row.canceled_reason || "",
    history: row.history || []
  };
  order.subtotal = orderSubtotal(order);
  order.total = orderTotal(order);
  return order;
}

function dateIso(value) {
  if (!value) return null;
  return value.toISOString ? value.toISOString() : value;
}

function orderSubtotal(order) {
  return money((order.items || []).reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.quantity), 0));
}

function orderTotal(order) {
  return money(orderSubtotal(order) - toNumber(order.discount) + toNumber(order.tax) + toNumber(order.service));
}

const productCategories = [
  "Pizza",
  "Soups",
  "Rissoto",
  "Pasta",
  "Grill",
  "Mix grill",
  "Fish",
  "Mix fish",
  "Salads",
  "Side dish",
  "Drinks and coctails"
];

const allowedTables = new Set(
  Array.from({ length: 18 }, (_, index) => String(index + 1))
    .concat(["Terasa 1", "Terasa 2", "Salla 1", "Salla 2", "Salla 3", "Salla 4", "Me Veti"])
);

function normalizeTableName(value) {
  const table = String(value || "").trim().replace(/\s+/g, " ");
  if (table.toLowerCase() === "me veti") return "Me Veti";
  const matched = Array.from(allowedTables).find(item => item.toLowerCase() === table.toLowerCase());
  return matched || table;
}

function requireAllowedTable(table) {
  if (allowedTables.has(table)) return;
  throw new Error("Choose one of the available tables.");
}

function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configurePush() {
  if (!pushConfigured()) return false;
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

function businessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function millisecondsUntilNextBusinessDay(now = Date.now()) {
  const currentDate = businessDate(new Date(now));
  let low = now;
  let high = now + (27 * 60 * 60 * 1000);
  while (high - low > 1000) {
    const middle = Math.floor((low + high) / 2);
    if (businessDate(new Date(middle)) === currentDate) low = middle;
    else high = middle;
  }
  return Math.max(1000, high - now + 1000);
}

function calculateCharges(items, settings) {
  const subtotal = money((items || []).reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.quantity), 0));
  return {
    tax: money(subtotal * money(settings.taxRate || 0)),
    service: money(subtotal * money(settings.serviceRate || 0))
  };
}

async function audit(user, action, details, run = query) {
  await run(
    "INSERT INTO audit (id, action, user_id, user_name, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [uid("a"), action, user ? user.id : "system", user ? user.name : "System", json(details, {}), nowIso()]
  );
}

async function getSettings() {
  const result = await query("SELECT data FROM settings WHERE id = 1");
  return result.rows[0].data;
}

async function listUsers() {
  const result = await query("SELECT * FROM users ORDER BY role, name");
  return result.rows.map(rowUser);
}

async function listProducts() {
  const result = await query("SELECT * FROM products ORDER BY sort, name");
  return result.rows.map(rowProduct);
}

async function findUserByUsername(username) {
  const result = await query("SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND active = TRUE", [username]);
  return rowUser(result.rows[0]);
}

async function findUserById(id) {
  const result = await query("SELECT * FROM users WHERE id = $1", [id]);
  return rowUser(result.rows[0]);
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)", [token, user.id, expiresAt]);
  await audit(user, "login", {});
  return { token, user: cleanUser(user) };
}

async function deleteSession(token) {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

async function currentUser(token) {
  if (!token) return null;
  const result = await query(
    `SELECT u.*, s.expires_at AS session_expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.active = TRUE`,
    [token]
  );
  const user = rowUser(result.rows[0]);
  if (user && new Date(result.rows[0].session_expires_at).getTime() < Date.now() + (SESSION_TTL_MS / 2)) {
    await query(
      "UPDATE sessions SET expires_at = $2 WHERE token = $1 AND expires_at < NOW() + INTERVAL '7 hours'",
      [token, new Date(Date.now() + SESSION_TTL_MS).toISOString()]
    );
  }
  return user;
}

async function login(username, password) {
  await query("DELETE FROM sessions WHERE expires_at <= NOW()");
  const user = await findUserByUsername(String(username || "").trim());
  if (!user || !(await verifyPasswordAsync(password || "", user))) {
    const error = new Error("Invalid username or password.");
    error.status = 401;
    throw error;
  }
  return createSession(user);
}

function requireRole(user, roles) {
  if (!roles || !roles.length || user.role === "admin" || roles.indexOf(user.role) !== -1) return;
  const error = new Error("You do not have permission for this action.");
  error.status = 403;
  throw error;
}

async function listOrders(user) {
  const params = [];
  let where = "WHERE o.payment_status = 'open'";
  if (user.role === "waiter") {
    params.push(user.id);
    where = "WHERE o.payment_status = 'open' AND o.waiter_id = $1";
  }
  const result = await query(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     ${where}
     ORDER BY o.created_at DESC, o.number DESC`,
    params
  );
  return result.rows.map(row => rowOrder(row));
}

async function listTableLocks() {
  const result = await query(
    `SELECT o.id, o.number, o.table_name, o.waiter_id, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE o.payment_status = 'open'
       AND LOWER(o.table_name) <> LOWER('Me Veti')
     ORDER BY o.created_at ASC`
  );
  return result.rows.map(row => ({
    orderId: row.id,
    number: row.number,
    table: row.table_name,
    waiterId: row.waiter_id,
    waiterName: row.waiter_name || "Unknown waiter"
  }));
}

async function getOrder(id, run = query, forUpdate = false) {
  const result = await run(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE o.id = $1
     ${forUpdate ? "FOR UPDATE OF o" : ""}`,
    [id]
  );
  return rowOrder(result.rows[0]);
}

async function nextOrderNumber(date, run = query) {
  const result = await run(
    "SELECT COALESCE(MAX(number), 0) + 1 AS number FROM orders WHERE business_date = $1",
    [date]
  );
  return Number(result.rows[0].number);
}

async function findOrderRequest(userId, requestKey, run = query) {
  if (!requestKey) return null;
  const result = await run(
    `SELECT o.*, u.name AS waiter_name, r.appended, r.added_item_quantity
     FROM order_requests r
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE r.user_id = $1 AND r.request_key = $2`,
    [userId, requestKey]
  );
  if (!result.rows[0]) return null;
  const order = rowOrder(result.rows[0]);
  order.appendedToExisting = result.rows[0].appended;
  order.addedItemQuantity = result.rows[0].added_item_quantity;
  return order;
}

async function rememberOrderRequest(userId, requestKey, order, run = query) {
  if (!requestKey) return;
  await run(
    `INSERT INTO order_requests (user_id, request_key, order_id, appended, added_item_quantity)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, requestKey, order.id, order.appendedToExisting === true, Number(order.addedItemQuantity || 0)]
  );
}

async function closeOrdersBeforeBusinessDate(date, run = query) {
  await run("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`order:rollover:${date}`]);
  const result = await run(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE o.payment_status = 'open' AND o.business_date < $1
     FOR UPDATE OF o`,
    [date]
  );
  const canceledAt = nowIso();
  for (const row of result.rows) {
    const order = rowOrder(row);
    const history = (order.history || []).concat({
      status: "canceled",
      label: "Automatically closed at end of day",
      userId: "system",
      userName: "System",
      at: canceledAt
    });
    await run(
      `UPDATE orders
       SET payment_status = 'void', canceled_at = $2,
           canceled_reason = $3, history = $4, updated_at = $2
       WHERE id = $1`,
      [order.id, canceledAt, "Automatically closed at end of day", json(history, [])]
    );
    await audit(null, "order.auto-close", { orderId: order.id, number: order.number, businessDate: order.businessDate }, run);
  }
  return result.rowCount;
}

async function runDailyRollover() {
  const date = businessDate();
  return withTransaction(run => closeOrdersBeforeBusinessDate(date, run));
}

async function findOpenTableOrder(table, user, run = query, lockRow = false) {
  const result = await run(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE LOWER(o.table_name) = LOWER($1)
       AND o.waiter_id = $2
       AND o.payment_status = 'open'
     ORDER BY o.created_at ASC
     LIMIT 1
     ${lockRow ? "FOR UPDATE OF o" : ""}`,
    [table, user.id]
  );
  return rowOrder(result.rows[0]);
}

async function findOpenTableOrderForAnyWaiter(table, run = query, lockRow = false) {
  const result = await run(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE LOWER(o.table_name) = LOWER($1)
       AND o.payment_status = 'open'
     ORDER BY o.created_at ASC
     LIMIT 1
     ${lockRow ? "FOR UPDATE OF o" : ""}`,
    [table]
  );
  return rowOrder(result.rows[0]);
}

async function appendItemsToOrder(order, items, payload, user, settings, run = query) {
  const updatedAt = nowIso();
  const destination = order.table === "Me Veti" ? "Me Veti" : "table";
  const nextItems = order.items.concat(items);
  const charges = calculateCharges(nextItems, settings);
  const extraNote = String(payload.notes || "").trim().slice(0, 500);
  const notes = extraNote
    ? [order.notes, extraNote].filter(Boolean).join("\n")
    : order.notes;
  const history = (order.history || []).concat({
    status: "sent",
    label: `Added ${items.reduce((sum, item) => sum + item.quantity, 0)} item(s) to ${destination}`,
    userId: user.id,
    userName: user.name,
    at: updatedAt
  });

  await run(
    `UPDATE orders
     SET items = $2, notes = $3, tax = $4, service = $5, history = $6, updated_at = $7
     WHERE id = $1`,
    [order.id, json(nextItems, []), notes, charges.tax, charges.service, json(history, []), updatedAt]
  );
  await audit(user, "order.append", { orderId: order.id, number: order.number, addedItems: items.length }, run);
  const updatedResult = await run(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE o.id = $1`,
    [order.id]
  );
  const updated = rowOrder(updatedResult.rows[0]);
  updated.appendedToExisting = true;
  updated.addedItemQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  return updated;
}

async function createOrder(payload, user) {
  requireRole(user, ["waiter"]);
  const requestKey = String(payload.requestKey || "").trim().slice(0, 128);
  const previousRequest = await findOrderRequest(user.id, requestKey);
  if (previousRequest) return previousRequest;
  const takeAway = payload.takeAway === true;
  const table = takeAway ? "Me Veti" : normalizeTableName(payload.table);
  const forceNew = takeAway && payload.forceNew === true;
  if (!table) throw new Error("Enter a table number or customer name.");
  requireAllowedTable(table);
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  const productIds = requestedItems.map(item => item.productId);
  const productsResult = await query("SELECT * FROM products WHERE id = ANY($1) AND available = TRUE", [productIds]);
  const products = productsResult.rows.map(rowProduct);
  let items = requestedItems.map(item => {
    const product = products.find(candidate => candidate.id === item.productId);
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    return {
      productId: product.id,
      name: product.name,
      category: product.category,
      quantity,
      note: String(item.note || "").trim().slice(0, 240)
    };
  }).filter(Boolean);
  if (!items.length) throw new Error("Add at least one available product.");

  const settings = await getSettings();
  return withTransaction(async run => {
    if (requestKey) {
      await run("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`order:request:${user.id}:${requestKey}`]);
      const repeatedRequest = await findOrderRequest(user.id, requestKey, run);
      if (repeatedRequest) return repeatedRequest;
    }
    const date = businessDate();
    await closeOrdersBeforeBusinessDate(date, run);
    const lockKey = takeAway ? `order:takeaway:${user.id}` : `order:table:${table.toLowerCase()}`;
    await run("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [lockKey]);

    if (!takeAway) {
      const occupiedOrder = await findOpenTableOrderForAnyWaiter(table, run, true);
      if (occupiedOrder && occupiedOrder.waiterId !== user.id) {
        throw new Error(`${table} is already open by ${occupiedOrder.waiterName}.`);
      }
    }
    const openOrder = forceNew ? null : await findOpenTableOrder(table, user, run, true);
    if (openOrder) {
      const appendedOrder = await appendItemsToOrder(openOrder, items, payload, user, settings, run);
      await rememberOrderRequest(user.id, requestKey, appendedOrder, run);
      return appendedOrder;
    }

    await run("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`order:number:${date}`]);
    const createdAt = nowIso();
    const charges = calculateCharges(items, settings);
    const order = {
      id: uid("o"),
      number: await nextOrderNumber(date, run),
      businessDate: date,
      table,
      waiterId: user.id,
      paymentStatus: "open",
      items,
      notes: String(payload.notes || "").trim().slice(0, 500),
      discount: 0,
      tax: charges.tax,
      service: charges.service,
      payment: null,
      history: [{ status: "sent", label: "Order sent", userId: user.id, userName: user.name, at: createdAt }]
    };
    await run(
      `INSERT INTO orders (id, number, business_date, table_name, waiter_id, payment_status, items, notes, discount, tax, service, payment, history, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [order.id, order.number, order.businessDate, order.table, order.waiterId, order.paymentStatus, json(order.items, []), order.notes, order.discount, order.tax, order.service, json(order.payment, null), json(order.history, []), createdAt]
    );
    await audit(user, "order.create", { orderId: order.id, number: order.number, total: orderTotal(order) }, run);
    const result = await run(
      `SELECT o.*, u.name AS waiter_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.waiter_id
       WHERE o.id = $1`,
      [order.id]
    );
    const createdOrder = rowOrder(result.rows[0]);
    await rememberOrderRequest(user.id, requestKey, createdOrder, run);
    return createdOrder;
  });
}

async function updateActiveOrder(id, payload, user) {
  requireRole(user, ["admin"]);
  const order = await getOrder(id);
  if (!order) throw notFound("Order not found.");
  if (order.paymentStatus !== "open") throw new Error("Only active orders can be edited.");
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  const requestedAddedItems = Array.isArray(payload.addedItems) ? payload.addedItems : [];
  const updatedAt = nowIso();
  const keptItems = order.items.map((item, index) => {
    const requested = requestedItems[index] || {};
    if (requested.removed === true) return null;
    const quantity = Number(requested.quantity === undefined ? item.quantity : requested.quantity);
    const price = money(requested.price === undefined ? item.price : requested.price);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("Item quantity must be between 1 and 99.");
    }
    if (!(price >= 0)) throw new Error("Item price must be zero or higher.");
    return {
      ...item,
      quantity,
      price,
      note: String(requested.note === undefined ? item.note || "" : requested.note || "").trim().slice(0, 240)
    };
  }).filter(Boolean);

  const addedProductIds = requestedAddedItems.map(item => item && item.productId).filter(Boolean);
  const addedProductsResult = addedProductIds.length
    ? await query("SELECT * FROM products WHERE id = ANY($1)", [addedProductIds])
    : { rows: [] };
  const addedProducts = addedProductsResult.rows.map(rowProduct);
  const addedItems = requestedAddedItems.map(item => {
    const product = addedProducts.find(candidate => candidate.id === item.productId);
    const quantity = Number(item.quantity);
    const price = money(item.price === undefined ? product && product.price : item.price);
    if (!product || item.removed === true) return null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("Added item quantity must be between 1 and 99.");
    }
    if (!(price >= 0)) throw new Error("Added item price must be zero or higher.");
    return {
      productId: product.id,
      name: product.name,
      category: product.category,
      price,
      quantity,
      note: String(item.note || "").trim().slice(0, 240),
      managerAdded: true,
      batchId: updatedAt
    };
  }).filter(Boolean);
  const items = keptItems.concat(addedItems);
  if (!items.length) throw new Error("Active orders must keep at least one item.");
  const table = normalizeTableName(payload.table === undefined ? order.table : payload.table);
  if (!table) throw new Error("Enter a table number or customer name.");
  requireAllowedTable(table);
  const notes = String(payload.notes === undefined ? order.notes || "" : payload.notes || "").trim().slice(0, 500);
  const settings = await getSettings();
  const charges = calculateCharges(items, settings);
  const history = (order.history || []).concat({
    status: "edited",
    label: "Active order edited by admin",
    userId: user.id,
    userName: user.name,
    at: updatedAt
  });

  await query(
    `UPDATE orders
     SET table_name = $2, items = $3, notes = $4, tax = $5, service = $6, history = $7, updated_at = $8
     WHERE id = $1`,
    [order.id, table, json(items, []), notes, charges.tax, charges.service, json(history, []), updatedAt]
  );
  await audit(user, "order.edit", { orderId: order.id, number: order.number, itemCount: items.length, total: money(items.reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.quantity), 0)) });
  return getOrder(order.id);
}

async function markPaid(id, payload, user) {
  requireRole(user, ["waiter", "admin"]);
  const order = await getOrder(id);
  if (!order) throw notFound("Order not found.");
  if (user.role === "waiter" && order.waiterId !== user.id) {
    throw forbidden("Waiters can only close their own orders.");
  }
  if (order.paymentStatus !== "open") throw new Error("Order is already closed.");
  const method = String(payload.method || "cash");
  if (["cash", "card", "mixed", "other"].indexOf(method) === -1) throw new Error("Choose a valid payment method.");
  const discount = money(payload.discount || 0);
  if (discount < 0 || discount > orderSubtotal(order)) throw new Error("Discount cannot be negative or higher than the subtotal.");
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
  await query(
    "UPDATE orders SET payment_status = 'paid', discount = $2, payment = $3, history = $4, paid_at = $5, updated_at = $5 WHERE id = $1",
    [id, order.discount, json(order.payment, null), json(order.history, []), order.paidAt]
  );
  await audit(user, "order.paid", { orderId: id, total: orderTotal(order), method });
  return getOrder(id);
}

async function cancelOrder(id, payload, user) {
  requireRole(user, ["admin"]);
  const order = await getOrder(id);
  if (!order) throw notFound("Order not found.");
  if (order.paymentStatus === "paid") throw new Error("Paid orders cannot be canceled.");
  const canceledAt = nowIso();
  const reason = String(payload.reason || "Canceled").trim().slice(0, 240);
  order.history.push({ status: "canceled", label: reason, userId: user.id, userName: user.name, at: canceledAt });
  await query(
    "UPDATE orders SET payment_status = 'void', canceled_at = $2, canceled_reason = $3, history = $4, updated_at = $2 WHERE id = $1",
    [id, canceledAt, reason, json(order.history, [])]
  );
  await audit(user, "order.cancel", { orderId: id, reason });
  return getOrder(id);
}

async function reportForDay(date) {
  const result = await query(
    `SELECT o.*, u.name AS waiter_name
     FROM orders o
     LEFT JOIN users u ON u.id = o.waiter_id
     WHERE o.business_date = $1
       AND o.payment_status IN ('paid', 'void')
     ORDER BY o.updated_at DESC`,
    [date]
  );
  const all = result.rows.map(row => rowOrder(row));
  const paidOrders = all.filter(order => order.paymentStatus === "paid");
  const voidOrders = all.filter(order => order.paymentStatus === "void");
  const users = await listUsers();
  const byWaiter = users.filter(user => user.role === "waiter").map(waiter => {
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
    return { method, orders: methodOrders.length, total: money(methodOrders.reduce((sum, order) => sum + orderTotal(order), 0)) };
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
    orders: paidOrders,
    voidOrders
  };
}

async function closeDay(payload, user) {
  requireRole(user, ["admin"]);
  const date = payload.date || nowIso().slice(0, 10);
  const report = await reportForDay(date);
  const cash = report.byMethod.find(row => row.method === "cash") || { total: 0 };
  const closure = {
    id: uid("close"),
    date,
    expectedCash: money(cash.total),
    countedCash: money(payload.countedCash || 0),
    note: String(payload.note || "").trim().slice(0, 240),
    report,
    closedBy: user.id,
    closedByName: user.name,
    closedAt: nowIso()
  };
  await query(
    `INSERT INTO cash_closures (id, business_date, expected_cash, counted_cash, note, report, closed_by, closed_by_name, closed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [closure.id, closure.date, closure.expectedCash, closure.countedCash, closure.note, json(closure.report, {}), closure.closedBy, closure.closedByName, closure.closedAt]
  );
  await audit(user, "report.close-day", { date, total: report.total });
  return closure;
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "");
}

async function createWaiter(payload, user) {
  requireRole(user, ["admin"]);
  const name = String(payload.name || "").trim();
  const username = normalizeUsername(payload.username || name);
  const password = String(payload.password || "");
  if (!name) throw new Error("Waiter name is required.");
  if (username.length < 3) throw new Error("Waiter username must be at least 3 characters.");
  if (password.length < 6) throw new Error("Waiter password must be at least 6 characters.");
  const waiter = { id: uid("u_waiter"), name: name.slice(0, 100), username: username.slice(0, 60), role: "waiter", active: true, password: makePassword(password) };
  await query(
    "INSERT INTO users (id, name, username, role, active, password, created_at, updated_at) VALUES ($1,$2,$3,'waiter',TRUE,$4,$5,$5)",
    [waiter.id, waiter.name, waiter.username, json(waiter.password, {}), nowIso()]
  );
  await audit(user, "waiter.create", { waiterId: waiter.id, username: waiter.username, name: waiter.name });
  return cleanUser(waiter);
}

async function updateWaiter(id, payload, user) {
  requireRole(user, ["admin"]);
  const existing = await findUserById(id);
  if (!existing || existing.role !== "waiter") throw notFound("Waiter not found.");
  const name = String(payload.name || "").trim();
  const username = normalizeUsername(payload.username || "");
  const password = String(payload.password || "");
  if (!name) throw new Error("Waiter name is required.");
  if (username.length < 3) throw new Error("Waiter username must be at least 3 characters.");
  if (password && password.length < 6) throw new Error("Waiter password must be at least 6 characters.");
  const active = payload.active !== false;
  const passwordValue = password ? makePassword(password) : existing.password;
  const result = await query(
    "UPDATE users SET name = $2, username = $3, active = $4, password = $5, updated_at = $6 WHERE id = $1 AND role = 'waiter' RETURNING *",
    [id, name.slice(0, 100), username.slice(0, 60), active, json(passwordValue, {}), nowIso()]
  );
  if (!active) await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  const waiter = rowUser(result.rows[0]);
  await audit(user, "waiter.update", { waiterId: waiter.id, username: waiter.username, name: waiter.name });
  return cleanUser(waiter);
}

async function removeWaiter(id, user) {
  requireRole(user, ["admin"]);
  const result = await query("UPDATE users SET active = FALSE, updated_at = $2 WHERE id = $1 AND role = 'waiter' RETURNING *", [id, nowIso()]);
  if (!result.rows[0]) throw notFound("Waiter not found.");
  await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  const waiter = rowUser(result.rows[0]);
  await audit(user, "waiter.remove", { waiterId: waiter.id, username: waiter.username, name: waiter.name });
  return cleanUser(waiter);
}

function parseProduct(payload, existing) {
  const name = String(payload.name || "").trim();
  const requestedCategory = String(payload.category || "").trim().toLowerCase();
  const category = productCategories.find(item => item.toLowerCase() === requestedCategory);
  const price = money(payload.price);
  if (!name) throw new Error("Product name is required.");
  if (!category) throw new Error("Choose a valid product category.");
  if (!(price >= 0)) throw new Error("Product price must be zero or higher.");
  return {
    id: existing ? existing.id : uid("p"),
    name: name.slice(0, 120),
    category,
    price,
    available: payload.available !== false,
    sort: Number(payload.sort || (existing && existing.sort) || 999)
  };
}

async function createProduct(payload, user) {
  requireRole(user, ["admin"]);
  const product = parseProduct(payload);
  await query(
    "INSERT INTO products (id, name, category, price, available, sort, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)",
    [product.id, product.name, product.category, product.price, product.available, product.sort, nowIso()]
  );
  await audit(user, "product.create", { productId: product.id, name: product.name });
  return product;
}

async function updateProduct(id, payload, user) {
  requireRole(user, ["admin"]);
  const existingResult = await query("SELECT * FROM products WHERE id = $1", [id]);
  if (!existingResult.rows[0]) throw notFound("Product not found.");
  const product = parseProduct(payload, rowProduct(existingResult.rows[0]));
  const result = await query(
    "UPDATE products SET name = $2, category = $3, price = $4, available = $5, sort = $6, updated_at = $7 WHERE id = $1 RETURNING *",
    [id, product.name, product.category, product.price, product.available, product.sort, nowIso()]
  );
  await audit(user, "product.update", { productId: id, name: product.name });
  return rowProduct(result.rows[0]);
}

async function deleteProduct(id, user) {
  requireRole(user, ["admin"]);
  const result = await query("DELETE FROM products WHERE id = $1 RETURNING *", [id]);
  if (!result.rows[0]) throw notFound("Product not found.");
  const product = rowProduct(result.rows[0]);
  await audit(user, "product.delete", { productId: id, name: product.name });
  return product;
}

async function listAudit() {
  const result = await query("SELECT * FROM audit ORDER BY created_at DESC LIMIT 200");
  return result.rows.map(row => ({
    id: row.id,
    action: row.action,
    userId: row.user_id,
    userName: row.user_name,
    details: row.details,
    at: dateIso(row.created_at)
  }));
}

async function savePushSubscription(user, subscription) {
  if (!subscription || !subscription.endpoint) throw new Error("Push subscription endpoint is required.");
  await query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, subscription, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription, updated_at = EXCLUDED.updated_at`,
    [uid("push"), user.id, subscription.endpoint, json(subscription, {}), nowIso()]
  );
  return { ok: true };
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

module.exports = {
  rawQuery,
  cleanUser,
  login,
  deleteSession,
  currentUser,
  requireRole,
  getSettings,
  listUsers,
  listProducts,
  listOrders,
  listTableLocks,
  createOrder,
  updateActiveOrder,
  markPaid,
  cancelOrder,
  reportForDay,
  closeDay,
  createWaiter,
  updateWaiter,
  removeWaiter,
  createProduct,
  updateProduct,
  deleteProduct,
  listAudit,
  savePushSubscription,
  runDailyRollover,
  millisecondsUntilNextBusinessDay
};
