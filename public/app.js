const state = {
	token: localStorage.getItem("restaurant_token") || "",
	me: null,
	settings: null,
	users: [],
	products: [],
	tables: [],
	orders: [],
	tableLocks: [],
	audit: [],
	report: null,
	view: "waiter",
	login: { username: "", password: "" },
	table: "",
	selectedOrderId: "",
	takeAway: false,
	takeAwayNewOrder: false,
	orderNotes: "",
	cart: [],
	orderSubmission: readOrderSubmission(),
	orderSending: false,
	search: "",
	category: "",
	managerWaiterFilter: "all",
	reportDate: new Date().toISOString().slice(0, 10),
	payment: {
		method: "cash",
		discount: 0,
		amountReceived: "",
		tip: 0,
		note: "",
	},
	productForm: {
		id: "",
		name: "",
		category: "Pizza",
		price: "",
		available: true,
		sort: 999,
	},
	waiterForm: { id: "", name: "", username: "", password: "", active: true },
	tableForm: { name: "", section: "Tables" },
	orderEdits: {},
	closeDay: { countedCash: "", note: "" },
	toast: "",
	ordersRevision: 0,
	audioReady: localStorage.getItem("restaurant_alerts_enabled") === "true",
	audioContext: null,
};

function readOrderSubmission() {
	try {
		return JSON.parse(localStorage.getItem("restaurant_order_submission") || "null");
	} catch (error) {
		localStorage.removeItem("restaurant_order_submission");
		return null;
	}
}

function saveOrderSubmission(submission) {
	state.orderSubmission = submission;
	if (submission) localStorage.setItem("restaurant_order_submission", JSON.stringify(submission));
	else localStorage.removeItem("restaurant_order_submission");
}

function restoreOrderSubmission() {
	const submission = state.orderSubmission;
	if (!submission) return;
	if (!state.me || submission.userId !== state.me.id || !submission.payload) {
		saveOrderSubmission(null);
		return;
	}
	state.table = submission.payload.takeAway ? "" : submission.payload.table;
	state.takeAway = submission.payload.takeAway === true;
	state.takeAwayNewOrder = submission.payload.forceNew === true;
	state.orderNotes = submission.payload.notes || "";
	state.cart = (submission.payload.items || []).map((item) => ({ ...item }));
}

function orderDraftLocked() {
	return state.orderSending;
}

function newRequestKey() {
	if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const app = document.getElementById("app");
let refreshInFlight = false;

function tableSectionGroups() {
	const groups = [];
	for (const table of state.tables) {
		let group = groups.find((item) => item.title === table.section);
		if (!group) {
			group = { title: table.section, tables: [] };
			groups.push(group);
		}
		group.tables.push(table.name);
	}
	return groups;
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
	"Drinks and coctails",
];

function money(value) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: (state.settings && state.settings.currency) || "EUR",
	}).format(Number(value || 0));
}

function escapeHtml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function toast(message) {
	state.toast = message;
	render();
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => {
		state.toast = "";
		render();
	}, 3000);
}

function ensureAudio() {
	const AudioContext = window.AudioContext || window.webkitAudioContext;
	if (!AudioContext) return null;
	if (!state.audioContext) state.audioContext = new AudioContext();
	if (state.audioContext.state === "suspended") state.audioContext.resume();
	state.audioReady = true;
	localStorage.setItem("restaurant_alerts_enabled", "true");
	return state.audioContext;
}

function playTone(kind) {
	const audio = ensureAudio();
	if (!audio || audio.state === "suspended") return;
	const tones = kind === "ready"
		? [392, 523, 659, 784, 1046, 784]
		: [330, 440, 554, 740, 554];
	tones.forEach((frequency, index) => {
		const oscillator = audio.createOscillator();
		const gain = audio.createGain();
		const start = audio.currentTime + index * 0.18;
		oscillator.type = "square";
		oscillator.frequency.value = frequency;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.34, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(start);
		oscillator.stop(start + 0.18);
	});
}

function vibrate(kind) {
	if (!navigator.vibrate) return;
	if (kind === "ready") navigator.vibrate([400, 120, 400, 120, 700]);
	else navigator.vibrate([300, 100, 300, 100, 300]);
}

async function enableAlerts() {
	ensureAudio();
	if ("Notification" in window && Notification.permission === "default") {
		try {
			await Notification.requestPermission();
		} catch (error) {}
	}
	await enablePushNotifications();
	state.audioReady = true;
	localStorage.setItem("restaurant_alerts_enabled", "true");
	render();
}

function urlBase64ToUint8Array(base64String) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
}

async function enablePushNotifications() {
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !state.token) return false;
	if ("Notification" in window && Notification.permission !== "granted") return false;
	try {
		const keyData = await api("/api/push/public-key");
		if (!keyData.publicKey) return false;
		const registration = await navigator.serviceWorker.register("/sw.js");
		const existing = await registration.pushManager.getSubscription();
		const subscription = existing || await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
		});
		await api("/api/push/subscribe", {
			method: "POST",
			body: JSON.stringify(subscription)
		});
		return true;
	} catch (error) {
		console.warn("Push notification setup failed", error);
		return false;
	}
}

function notify(title, body, kind) {
	playTone(kind);
	vibrate(kind);
	if ("Notification" in window && Notification.permission === "granted") {
		try {
			new Notification(title, {
				body,
				tag: `restaurant-${kind}`,
				renotify: true,
				requireInteraction: kind === "ready",
				vibrate: kind === "ready" ? [400, 120, 400, 120, 700] : [300, 100, 300]
			});
		} catch (error) {}
	}
}

async function api(path, options) {
	const response = await fetch(path, {
		headers: {
			"Content-Type": "application/json",
			Authorization: state.token ? `Bearer ${state.token}` : "",
		},
		...options,
	});
	const data = await response.json();
	if (!response.ok) {
		if (response.status === 401) logout(false);
		const error = new Error(data.error || "Request failed");
		error.status = response.status;
		throw error;
	}
	return data;
}

function allowedViews() {
	if (!state.me) return [];
	if (state.me.role === "admin") return ["waiter", "reports", "staff", "tables", "admin"];
	return ["waiter"];
}

async function bootstrap() {
	if (!state.token) {
		render();
		return;
	}
	try {
		const data = await api("/api/bootstrap");
		state.me = data.me;
		state.settings = data.settings;
		state.users = data.users || [];
		state.products = data.products;
		state.tables = data.tables || [];
		state.orders = data.orders;
		state.tableLocks = data.tableLocks || [];
		restoreOrderSubmission();
		if (allowedViews().indexOf(state.view) === -1)
			state.view = allowedViews()[0];
		if (state.view === "reports") await loadReport();
		if (state.view === "admin" || state.view === "staff" || state.view === "tables") await loadAudit();
		render();
	} catch (error) {
		toast(error.message);
		render();
	}
}

async function login() {
	try {
		const data = await api("/api/auth/login", {
			method: "POST",
			body: JSON.stringify(state.login),
		});
		state.token = data.token;
		localStorage.setItem("restaurant_token", state.token);
		if (state.audioReady) ensureAudio();
		state.me = data.user;
		state.view = "waiter";
		await bootstrap();
		if (state.audioReady) enablePushNotifications();
		toast(`Logged in as ${data.user.name}`);
	} catch (error) {
		toast(error.message);
	}
}

async function logout(callApi = true) {
	if (callApi && state.token) {
		try {
			await api("/api/auth/logout", { method: "POST" });
		} catch (error) {}
	}
	localStorage.removeItem("restaurant_token");
	state.token = "";
	state.me = null;
	state.orders = [];
	render();
}

async function refreshOrders(silent) {
	if (!state.token || refreshInFlight) return false;
	refreshInFlight = true;
	const revision = state.ordersRevision;
	try {
		const [orders, tableLocks] = await Promise.all([
			api("/api/orders"),
			api("/api/table-locks"),
		]);
		const changed = orders.length !== state.orders.length
			|| orders.some((order, index) => !state.orders[index]
				|| order.id !== state.orders[index].id
				|| order.updatedAt !== state.orders[index].updatedAt)
			|| tableLocks.length !== state.tableLocks.length
			|| tableLocks.some((lock, index) => !state.tableLocks[index]
				|| lock.orderId !== state.tableLocks[index].orderId
				|| lock.waiterId !== state.tableLocks[index].waiterId);
		const nextOrders = orders;
		state.tableLocks = tableLocks;
		if (revision !== state.ordersRevision) return false;
		state.orders = nextOrders;
		if (!silent) render();
		return changed;
	} catch (error) {
		if (!silent) toast(error.message);
		return false;
	} finally {
		refreshInFlight = false;
	}
}

async function loadReport() {
	state.report = await api(
		`/api/reports/day?date=${encodeURIComponent(state.reportDate)}`,
	);
}

async function loadAudit() {
	state.audit = await api("/api/audit");
}

function shouldPatchWaiterOrders() {
	return state.view === "waiter";
}

function categories() {
	return ["", "all"].concat(
		Array.from(
			new Set(productCategories.concat(state.products.map((product) => product.category))),
		).filter(Boolean),
	);
}

function menuProducts(includeUnavailable) {
	const query = state.search.trim().toLowerCase();
	if (!query && !state.category) return [];
	return state.products.filter((product) => {
		if (!includeUnavailable && product.available === false) return false;
		if (state.category && state.category !== "all" && product.category !== state.category)
			return false;
		return !query || product.name.toLowerCase().indexOf(query) > -1;
	});
}

function cartTotal() {
	return state.cart.reduce((sum, item) => {
		const product = state.products.find(
			(candidate) => candidate.id === item.productId,
		);
		return sum + (product ? product.price * item.quantity : 0);
	}, 0);
}

function canSendOrder() {
	if (state.orderSending) return false;
	if (state.orderSubmission) return true;
	if (!state.cart.length) return false;
	if (state.takeAway) return true;
	if (!state.table) return false;
	const lock = tableLock(state.table);
	return !lock || lock.waiterId === state.me.id;
}

function addProduct(productId) {
	if (orderDraftLocked()) return;
	const product = state.products.find((item) => item.id === productId);
	if (!product || product.available === false) return;
	const existing = state.cart.find((item) => item.productId === productId);
	if (existing) existing.quantity += 1;
	else state.cart.push({ productId, quantity: 1, note: "" });
	render();
}

function updateCart(productId, amount) {
	if (orderDraftLocked()) return;
	const item = state.cart.find(
		(candidate) => candidate.productId === productId,
	);
	if (!item) return;
	item.quantity += amount;
	if (item.quantity < 1)
		state.cart = state.cart.filter(
			(candidate) => candidate.productId !== productId,
		);
	render();
}

async function sendOrder() {
	if (state.orderSending) return;
	if (!state.orderSubmission) {
		const table = state.takeAway ? "Me Veti" : state.table;
		saveOrderSubmission({
			userId: state.me.id,
			payload: {
				requestKey: newRequestKey(),
				table,
				takeAway: state.takeAway,
				forceNew: state.takeAway && state.takeAwayNewOrder,
				notes: state.orderNotes,
				items: state.cart.map((item) => ({ ...item })),
			},
		});
	}
	state.orderSending = true;
	render();
	try {
		const order = await api("/api/orders", {
			method: "POST",
			body: JSON.stringify(state.orderSubmission.payload),
		});
		const existing = state.orders.some((item) => item.id === order.id);
		state.orders = existing
			? state.orders.map((item) => (item.id === order.id ? order : item))
			: [order].concat(state.orders);
		state.ordersRevision += 1;
		state.selectedOrderId = order.id;
		state.table = order.table;
		state.takeAwayNewOrder = false;
		state.orderNotes = "";
		state.cart = [];
		saveOrderSubmission(null);
		toast(order.appendedToExisting ? `Added to order #${order.number} (${order.table})` : `Order #${order.number} sent`);
	} catch (error) {
		if (error.status) saveOrderSubmission(null);
		toast(error.status ? error.message : "Connection interrupted. Tap Send order to retry the same ticket.");
	} finally {
		state.orderSending = false;
		render();
	}
}

async function payOrder(orderId) {
	try {
		const order = await api(`/api/orders/${orderId}/paid`, {
			method: "PATCH",
			body: JSON.stringify(state.payment),
		});
		replaceOrder(order);
		state.payment = {
			method: "cash",
			discount: 0,
			amountReceived: "",
			tip: 0,
			note: "",
		};
		toast(`Order #${order.number} paid`);
	} catch (error) {
		toast(error.message);
	}
}

async function cancelOrder(orderId) {
	const reason = prompt("Cancel reason");
	if (!reason) return;
	try {
		const order = await api(`/api/orders/${orderId}/cancel`, {
			method: "PATCH",
			body: JSON.stringify({ reason }),
		});
		replaceOrder(order);
		toast(`Order #${order.number} canceled`);
	} catch (error) {
		toast(error.message);
	}
}

function beginEditOrder(orderId) {
	const order = state.orders.find((item) => item.id === orderId);
	if (!order || !state.me || state.me.role !== "admin" || order.paymentStatus !== "open") return;
	state.orderEdits[orderId] = {
		table: order.table,
		notes: order.notes || "",
		items: order.items.map((item) => ({
			quantity: item.quantity,
			price: item.price,
			note: item.note || "",
			removed: false,
		})),
		addProductId: "",
		addedItems: [],
	};
	render();
}

function cancelEditOrder(orderId) {
	delete state.orderEdits[orderId];
	render();
}

async function saveEditOrder(orderId) {
	const edit = state.orderEdits[orderId];
	if (!edit) return;
	try {
		const order = await api(`/api/orders/${orderId}`, {
			method: "PATCH",
			body: JSON.stringify(edit),
		});
		delete state.orderEdits[orderId];
		replaceOrder(order);
		toast(`Order #${order.number} updated`);
	} catch (error) {
		toast(error.message);
	}
}

function replaceOrder(order) {
	state.orders = state.orders.map((item) =>
		item.id === order.id ? order : item,
	);
	state.ordersRevision += 1;
	render();
}

async function saveProduct() {
	try {
		const payload = {
			name: state.productForm.name,
			category: state.productForm.category,
			price: Number(state.productForm.price),
			available: state.productForm.available,
			sort: Number(state.productForm.sort || 999),
		};
		const path = state.productForm.id
			? `/api/products/${state.productForm.id}`
			: "/api/products";
		const method = state.productForm.id ? "PATCH" : "POST";
		const product = await api(path, { method, body: JSON.stringify(payload) });
		const exists = state.products.some((item) => item.id === product.id);
		state.products = exists
			? state.products.map((item) => (item.id === product.id ? product : item))
			: state.products.concat(product);
		resetProductForm();
		await loadAudit();
		toast("Menu saved");
	} catch (error) {
		toast(error.message);
	}
}

function editProduct(id) {
	const product = state.products.find((item) => item.id === id);
	if (!product) return;
	state.productForm = { ...product };
	render();
}

async function deleteProduct(id) {
	const product = state.products.find((item) => item.id === id);
	if (!product || !confirm(`Delete ${product.name} from the menu?`)) return;
	try {
		const updated = await api(`/api/products/${id}`, { method: "DELETE" });
		state.products = state.products.filter((item) => item.id !== updated.id);
		if (state.productForm.id === id) resetProductForm();
		await loadAudit();
		toast(`${updated.name} removed from menu`);
	} catch (error) {
		toast(error.message);
	}
}

async function saveTable() {
	try {
		const table = await api("/api/tables", {
			method: "POST",
			body: JSON.stringify(state.tableForm),
		});
		state.tables = state.tables.concat(table);
		state.tableForm = { name: "", section: table.section };
		await loadAudit();
		toast(`${table.name} added`);
	} catch (error) {
		toast(error.message);
	}
}

async function deleteTable(name) {
	if (!confirm(`Remove table ${name}?`)) return;
	try {
		const removed = await api(`/api/tables/${encodeURIComponent(name)}`, { method: "DELETE" });
		state.tables = state.tables.filter((table) => table.name !== removed.name);
		if (state.table === removed.name) state.table = "";
		await loadAudit();
		toast(`${removed.name} removed`);
	} catch (error) {
		toast(error.message);
	}
}

function resetProductForm() {
	state.productForm = {
		id: "",
		name: "",
		category: "Pizza",
		price: "",
		available: true,
		sort: 999,
	};
}

async function saveWaiter() {
	try {
		const payload = {
			name: state.waiterForm.name,
			username: state.waiterForm.username,
			password: state.waiterForm.password,
			active: state.waiterForm.active,
		};
		const path = state.waiterForm.id
			? `/api/users/waiters/${state.waiterForm.id}`
			: "/api/users/waiters";
		const method = state.waiterForm.id ? "PATCH" : "POST";
		const waiter = await api(path, {
			method,
			body: JSON.stringify(payload),
		});
		state.users = state.users.some((user) => user.id === waiter.id)
			? state.users.map((user) => (user.id === waiter.id ? waiter : user))
			: state.users.concat(waiter);
		resetWaiterForm();
		await loadAudit();
		toast(`Waiter ${waiter.name} saved`);
	} catch (error) {
		toast(error.message);
	}
}

function editWaiter(id) {
	const waiter = state.users.find(
		(user) => user.id === id && user.role === "waiter",
	);
	if (!waiter) return;
	state.waiterForm = {
		id: waiter.id,
		name: waiter.name,
		username: waiter.username,
		password: "",
		active: waiter.active,
	};
	render();
}

function resetWaiterForm() {
	state.waiterForm = {
		id: "",
		name: "",
		username: "",
		password: "",
		active: true,
	};
}

async function removeWaiter(id) {
	const waiter = state.users.find((user) => user.id === id);
	if (!waiter || !confirm(`Remove waiter ${waiter.name}?`)) return;
	try {
		const updated = await api(`/api/users/waiters/${id}`, { method: "DELETE" });
		state.users = state.users.map((user) =>
			user.id === updated.id ? updated : user,
		);
		await loadAudit();
		toast(`Waiter ${updated.name} removed`);
	} catch (error) {
		toast(error.message);
	}
}

async function closeDay() {
	try {
		const closure = await api("/api/reports/close-day", {
			method: "POST",
			body: JSON.stringify({
				date: state.reportDate,
				countedCash: state.closeDay.countedCash,
				note: state.closeDay.note,
			}),
		});
		state.closeDay = { countedCash: "", note: "" };
		await loadReport();
		toast(`Day closed. Expected cash: ${money(closure.expectedCash)}`);
	} catch (error) {
		toast(error.message);
	}
}

function activeOrders() {
	return state.orders.filter((order) => order.paymentStatus === "open");
}

function isTakeAwayTable(table) {
	return String(table || "").trim().toLowerCase() === "me veti";
}

function tableLock(table) {
	const normalized = String(table || "").trim().toLowerCase();
	return state.tableLocks.find((lock) => String(lock.table || "").trim().toLowerCase() === normalized);
}

function orderForTable(table) {
	const normalized = String(table || "").trim().toLowerCase();
	return activeOrders().find((order) => String(order.table || "").trim().toLowerCase() === normalized && order.waiterId === state.me.id);
}

function selectedActiveOrder() {
	if (state.selectedOrderId) {
		const byId = activeOrders().find((order) => order.id === state.selectedOrderId);
		if (byId) return byId;
	}
	if (state.table) return orderForTable(state.table);
	return null;
}

function waiterOwnActiveOrders() {
	if (!state.me) return [];
	return activeOrders().filter((order) => order.waiterId === state.me.id);
}

function visibleActiveOrders() {
	const orders = activeOrders();
	if (state.me && state.me.role === "admin") {
		if (state.managerWaiterFilter === "all") return orders;
		return orders.filter((order) => order.waiterId === state.managerWaiterFilter);
	}
	return orders;
}

function closedOrders() {
	return state.orders.filter((order) => order.paymentStatus !== "open");
}

function waiterNameFor(id, fallback) {
	const waiter = state.users.find((user) => user.id === id);
	return waiter ? waiter.name : fallback;
}

function groupedActiveOrders() {
	return visibleActiveOrders().reduce((groups, order) => {
		const key = order.waiterId || "unknown";
		if (!groups[key]) groups[key] = { waiterId: key, waiterName: waiterNameFor(order.waiterId, order.waiterName), orders: [] };
		groups[key].orders.push(order);
		return groups;
	}, {});
}

function canPayOrder(order) {
	if (!state.me || order.paymentStatus !== "open") return false;
	if (state.me.role === "admin") return true;
	return order.waiterId === state.me.id;
}

function canCancelOrder(order) {
	if (!state.me || order.paymentStatus !== "open") return false;
	return state.me.role === "admin";
}

function canEditOrder(order, context) {
	return state.me && state.me.role === "admin" && context === "waiter" && order.paymentStatus === "open";
}

function renderOrderEditItems(order, edit) {
	const existingItems = order.items
		.map((item, index) => {
			const row = edit.items[index] || {};
			return `
    <li class="edit-order-line ${row.removed ? "muted-row" : ""}">
      <span><strong>${escapeHtml(item.name)}</strong></span>
      <input class="input compact" type="number" min="1" max="99" step="1" data-action="edit-order-quantity" data-id="${order.id}" data-index="${index}" value="${escapeHtml(row.quantity)}" ${row.removed ? "disabled" : ""}>
      <input class="input compact" type="number" min="0" step="0.01" data-action="edit-order-price" data-id="${order.id}" data-index="${index}" value="${escapeHtml(row.price)}" ${row.removed ? "disabled" : ""}>
      <input class="input compact edit-note" data-action="edit-order-note" data-id="${order.id}" data-index="${index}" value="${escapeHtml(row.note)}" placeholder="Note" ${row.removed ? "disabled" : ""}>
      <button class="small-action ${row.removed ? "" : "danger"}" data-action="toggle-edit-item" data-id="${order.id}" data-index="${index}">${row.removed ? "Undo" : "Remove"}</button>
    </li>
  `;
		})
		.join("");
	const addedItems = (edit.addedItems || [])
		.map((item, index) => `
    <li class="edit-order-line">
      <span><strong>${escapeHtml(item.name)}</strong><small>Added</small></span>
      <input class="input compact" type="number" min="1" max="99" step="1" data-action="edit-added-quantity" data-id="${order.id}" data-index="${index}" value="${escapeHtml(item.quantity)}">
      <input class="input compact" type="number" min="0" step="0.01" data-action="edit-added-price" data-id="${order.id}" data-index="${index}" value="${escapeHtml(item.price)}">
      <input class="input compact edit-note" data-action="edit-added-note" data-id="${order.id}" data-index="${index}" value="${escapeHtml(item.note)}" placeholder="Note">
      <button class="small-action danger" data-action="remove-added-item" data-id="${order.id}" data-index="${index}">Remove</button>
    </li>
  `)
		.join("");
	return existingItems + addedItems;
}

function renderOrderEditProductPicker(order, edit) {
	return `
    <div class="edit-add-product">
      <select class="select compact" data-action="edit-add-product-select" data-id="${order.id}">
        <option value="">Add product</option>
        ${state.products.map((product) => `<option value="${escapeHtml(product.id)}" ${edit.addProductId === product.id ? "selected" : ""}>${escapeHtml(product.name)} - ${money(product.price)}</option>`).join("")}
      </select>
      <button class="small-action" data-action="add-product-to-edit" data-id="${order.id}" ${edit.addProductId ? "" : "disabled"}>Add</button>
    </div>
  `;
}

function orderCard(order, context) {
	const edit = canEditOrder(order, context) ? state.orderEdits[order.id] : null;
	const items = edit ? renderOrderEditItems(order, edit) : order.items
		.map(
			(item) => `
    <li>
      <span><strong>${item.quantity}x ${escapeHtml(item.name)}</strong>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</span>
      <strong>${money(item.price * item.quantity)}</strong>
    </li>
  `,
		)
		.join("");
	const closedLabel = order.paymentStatus === "paid" ? "Paid" : order.paymentStatus === "void" ? "Canceled" : "";

	return `
    <article class="order-card ${order.paymentStatus !== "open" ? "closed" : ""}">
      <div class="order-card-header">
        <div>
          <h3>#${order.number} - ${edit ? `<input class="input compact" data-action="edit-order-table" data-id="${order.id}" value="${escapeHtml(edit.table)}">` : escapeHtml(order.table)}</h3>
          <p>${escapeHtml(order.waiterName)} - ${new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        ${closedLabel ? `<span class="status ${order.paymentStatus}">${closedLabel}</span>` : ""}
      </div>
      <div class="order-card-body">
        <ul class="line-items">${items}</ul>
        ${edit ? renderOrderEditProductPicker(order, edit) : ""}
        ${edit ? `<textarea class="textarea" data-action="edit-order-notes" data-id="${order.id}" placeholder="Order note">${escapeHtml(edit.notes)}</textarea>` : order.notes ? `<p><strong>Note:</strong> ${escapeHtml(order.notes)}</p>` : ""}
        ${order.discount ? `<div class="line"><span>Discount</span><strong>-${money(order.discount)}</strong></div>` : ""}
        <div class="total-row"><span>Total</span><span>${money(order.total)}</span></div>
        ${order.payment ? `<p>Payment: ${escapeHtml(order.payment.method)}${order.payment.tip ? `, tip ${money(order.payment.tip)}` : ""}</p>` : ""}
        ${order.paymentStatus === "void" ? `<p>Canceled: ${escapeHtml(order.canceledReason)}</p>` : ""}
        ${orderActions(order, context)}
      </div>
    </article>
  `;
}

function orderActions(order, context) {
	if (order.paymentStatus !== "open") return "";
	const edit = state.orderEdits[order.id];
	if (canEditOrder(order, context) && edit) {
		return `
    <div class="order-actions">
      <button class="small-action ready" data-action="save-order-edit" data-id="${order.id}">Save edits</button>
      <button class="small-action" data-action="cancel-order-edit" data-id="${order.id}">Cancel edit</button>
    </div>
  `;
	}
	return `
    <div class="payment-box">
      ${canEditOrder(order, context) ? `<button class="small-action" data-action="edit-order" data-id="${order.id}">Edit order</button>` : ""}
      <select class="select compact" data-action="pay-method">
        ${["cash", "card", "mixed", "other"].map((method) => `<option value="${method}" ${state.payment.method === method ? "selected" : ""}>${method}</option>`).join("")}
      </select>
      <input class="input compact" type="number" step="0.01" data-action="pay-discount" value="${escapeHtml(state.payment.discount)}" placeholder="Discount">
      <input class="input compact" type="number" step="0.01" data-action="pay-tip" value="${escapeHtml(state.payment.tip)}" placeholder="Tip">
      <button class="small-action ready" data-action="paid" data-id="${order.id}" ${canPayOrder(order) ? "" : "disabled"}>Paid</button>
      ${canCancelOrder(order) ? `<button class="small-action danger" data-action="cancel" data-id="${order.id}">Void</button>` : ""}
    </div>
  `;
}

function renderLogin() {
	return `
    <main class="login-screen">
      <section class="login-card">
        <div class="brand big"><div class="brand-mark">R</div><div><h1>Rigera</h1><span>Secure staff access</span></div></div>
        <div class="field"><label>Username</label><input class="input" data-action="login-username" value="${escapeHtml(state.login.username)}"></div>
        <div class="field"><label>Password</label><input class="input" type="password" data-action="login-password" value="${escapeHtml(state.login.password)}"></div>
        <button class="primary" data-action="login">Log in</button>
        <p class="empty">Use the username and password given by the admin.</p>
      </section>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </main>
  `;
}

function renderTableSelector() {
	const sections = tableSectionGroups().map((section) => `
    <div class="table-section">
      <h3>${escapeHtml(section.title)}</h3>
      <div class="table-grid">
        ${section.tables.map((table) => {
					const lock = tableLock(table);
					const ownOrder = orderForTable(table);
					const occupiedByOther = lock && lock.waiterId !== state.me.id;
					const active = state.table === table && !state.takeAway;
					const free = !lock && !ownOrder;
					const label = /^\d+$/.test(table) ? table : table.replace(" ", "\u00a0");
					const meta = occupiedByOther ? escapeHtml(lock.waiterName) : ownOrder ? `#${ownOrder.number}` : "";
					return `
          <button class="table-button ${free ? "free" : ""} ${active ? "active" : ""} ${ownOrder ? "own" : ""} ${occupiedByOther ? "occupied" : ""}" data-action="select-table" data-table="${escapeHtml(table)}" ${occupiedByOther || orderDraftLocked() ? "disabled" : ""}>
            <strong>${escapeHtml(label)}</strong>
            ${meta ? `<span>${meta}</span>` : ""}
          </button>
        `;
				}).join("")}
      </div>
    </div>
  `).join("");
	return `
    <div data-waiter-table-controls>
    <div class="take-away-row">
      <button class="choice-button ${state.takeAway ? "active" : ""}" data-action="toggle-take-away" type="button" ${orderDraftLocked() ? "disabled" : ""}>Me Veti</button>
      ${state.takeAway ? `<label class="check"><input type="checkbox" data-action="take-away-new-order" ${state.takeAwayNewOrder ? "checked" : ""} ${orderDraftLocked() ? "disabled" : ""}> Separate order</label>` : ""}
    </div>
    <div class="table-legend">
      <span><i class="legend-dot free"></i>Free</span>
      <span><i class="legend-dot selected"></i>Selected</span>
      <span><i class="legend-dot mine"></i>Mine</span>
      <span><i class="legend-dot occupied"></i>Occupied</span>
    </div>
    <div class="table-selector ${state.takeAway ? "muted-row" : ""}" data-table-selector>
    ${sections || `<p class="empty">No tables yet. An admin can add them under Tables.</p>`}
  `;
}

function renderSelectedTableSummary() {
	if (state.takeAway) {
		return `<p class="empty">Me Veti selected. New items will go to your open Me Veti order unless Separate order is checked.</p>`;
	}
	if (!state.table) return `<p class="empty">Choose a table before sending the order.</p>`;
	const order = orderForTable(state.table);
	return order
		? `<p class="empty">Adding items to your active order #${order.number} for ${escapeHtml(state.table)}.</p>`
		: `<p class="empty">Starting a new order for ${escapeHtml(state.table)}.</p>`;
}

function renderActiveTableTiles(orders) {
	if (!orders.length) return `<p class="empty">No active tables.</p>`;
	return `<div class="active-table-grid">${orders.map((order) => `
    <button class="active-table-card ${selectedActiveOrder() && selectedActiveOrder().id === order.id ? "active" : ""}" data-action="select-active-order" data-id="${order.id}">
      <strong>${escapeHtml(order.table)}</strong>
      <span>#${order.number} - ${escapeHtml(order.waiterName)}</span>
      <small>${money(order.total)}</small>
    </button>
  `).join("")}</div>`;
}

function renderWaiterActiveOrders() {
	const filterEnabled = state.me && state.me.role === "admin";
	if (!filterEnabled) {
		const orders = waiterOwnActiveOrders();
		const selected = selectedActiveOrder();
		return `
      ${renderActiveTableTiles(orders)}
      <div class="selected-order-detail" data-selected-order>
        ${selected ? orderCard(selected, "waiter") : `<p class="empty">Select one of your active tables to see the order.</p>`}
      </div>
    `;
	}
	const groups = groupedActiveOrders();
	const waiterOptions = Object.entries(groups).map(([id, group]) => [id, group.waiterName]);
	const selector = `
    <div class="field compact-field">
      <label>Waiter</label>
      <select class="select compact" data-action="manager-waiter-filter">
        <option value="all" ${state.managerWaiterFilter === "all" ? "selected" : ""}>All waiters</option>
        ${waiterOptions.map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.managerWaiterFilter === id ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
      </select>
    </div>
  `;
	const sections = Object.values(groups)
		.sort((a, b) => a.waiterName.localeCompare(b.waiterName))
		.map((group) => `
      <div class="waiter-order-group">
        <h3>${escapeHtml(group.waiterName)}</h3>
        ${group.orders.map((order) => orderCard(order, "waiter")).join("")}
      </div>
    `)
		.join("");
	return selector + (sections || `<p class="empty">No active orders.</p>`);
}

function patchWaiterActiveOrders() {
	if (Object.keys(state.orderEdits).length) return true;
	reconcileWaiterSelection();
	const controls = app.querySelector("[data-waiter-table-controls]");
	if (controls) controls.outerHTML = renderTableSelector();
	const summary = app.querySelector("[data-order-target-summary]");
	if (summary) summary.innerHTML = renderSelectedTableSummary();
	const list = app.querySelector("[data-active-orders]");
	if (!list) return false;
	list.innerHTML = renderWaiterActiveOrders();
	return true;
}

function reconcileWaiterSelection() {
	if (!state.me) return;
	if (state.selectedOrderId && !activeOrders().some((order) => order.id === state.selectedOrderId)) {
		state.selectedOrderId = "";
	}
	if (!state.takeAway && state.table) {
		const lock = tableLock(state.table);
		if (lock && lock.waiterId !== state.me.id) {
			state.table = "";
			state.selectedOrderId = "";
		}
	}
}

function renderWaiter() {
	const products = menuProducts(false)
		.map(
			(product) => `
    <button class="product" data-action="add-product" data-id="${product.id}" ${orderDraftLocked() ? "disabled" : ""}>
      <strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)}</span><span class="price">${money(product.price)}</span>
    </button>
  `,
		)
		.join("");
	const cart = state.cart
		.map((item) => {
			const product = state.products.find(
				(candidate) => candidate.id === item.productId,
			);
			if (!product) return "";
			return `
      <div class="cart-item">
        <div><h3>${escapeHtml(product.name)}</h3><p>${money(product.price)} each</p><input class="input" data-action="cart-note" data-id="${product.id}" value="${escapeHtml(item.note)}" placeholder="Note" ${orderDraftLocked() ? "disabled" : ""}></div>
        <div class="quantity"><button class="icon-button" data-action="cart-minus" data-id="${product.id}" ${orderDraftLocked() ? "disabled" : ""}>-</button><strong>${item.quantity}</strong><button class="icon-button" data-action="cart-plus" data-id="${product.id}" ${orderDraftLocked() ? "disabled" : ""}>+</button></div>
      </div>
    `;
		})
		.join("");
	return `
    <div class="workspace">
      <section class="panel"><div class="panel-header"><div><h2>New order</h2><p>${escapeHtml(state.me.name)} is taking this order.</p></div></div>
        <div class="panel-body">
          <div class="field-grid">
            <div class="field full"><label>Table</label>${renderTableSelector()}</div>
            <div class="field"><label>Search</label><input class="input" data-action="search" value="${escapeHtml(state.search)}" placeholder="Menu item"></div>
            <div class="field"><label>Category</label><select class="select" data-action="category">${categories()
							.map(
								(category) =>
									`<option value="${category}" ${state.category === category ? "selected" : ""}>${category === "" ? "Choose category" : category === "all" ? "All categories" : escapeHtml(category)}</option>`,
							)
							.join("")}</select></div>
            <div class="field full"><label>Order note</label><textarea class="textarea" data-action="order-notes" ${orderDraftLocked() ? "disabled" : ""}>${escapeHtml(state.orderNotes)}</textarea></div>
          </div>
          <div class="order-target-summary" data-order-target-summary>${renderSelectedTableSummary()}</div>
          <div class="product-grid">${products || `<p class="empty">${state.search.trim() || state.category ? "No available products." : "Search or choose a category to show products."}</p>`}</div>
        </div>
      </section>
      <aside class="panel"><div class="panel-header"><div><h2>Ticket</h2><p>${state.cart.length} item${state.cart.length === 1 ? "" : "s"}</p></div></div>
        <div class="panel-body"><div class="cart-list">${cart || `<p class="empty">Tap products to add them.</p>`}</div><div class="cart-footer"><div class="total-row"><span>Total</span><span>${money(cartTotal())}</span></div><button class="primary" data-action="send-order" ${canSendOrder() ? "" : "disabled"}>${state.orderSending ? "Sending..." : state.orderSubmission ? "Retry send" : "Send order"}</button></div></div>
      </aside>
      <section class="panel span"><div class="panel-header"><div><h2>My active orders</h2><p>Orders stay here until they are paid or canceled.</p></div></div><div class="panel-body"><div class="order-list" data-active-orders>${renderWaiterActiveOrders()}</div></div></section>
    </div>
  `;
}

function renderReports() {
	const report = state.report || {
		total: 0,
		orderCount: 0,
		voidCount: 0,
		discounts: 0,
		tips: 0,
		byWaiter: [],
		byMethod: [],
		orders: [],
		voidOrders: [],
	};
	const paidOrdersByWaiter = report.byWaiter
		.map((waiter) => ({
			...waiter,
			orders: report.orders.filter((order) => order.waiterId === waiter.waiterId),
		}))
		.filter((waiter) => waiter.orders.length > 0);
	return `
    <section class="report-grid">
      <aside class="panel"><div class="panel-header"><div><h2>End of day</h2><p>Paid sales, voids, and cash control.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Date</label><input class="input" type="date" data-action="report-date" value="${escapeHtml(state.reportDate)}"></div>
          <div class="metric"><span>Total sales</span><strong>${money(report.total)}</strong></div>
          <div class="metric"><span>Paid orders</span><strong>${report.orderCount}</strong></div>
          <div class="metric"><span>Voids</span><strong>${report.voidCount}</strong></div>
          <div class="field"><label>Counted cash</label><input class="input" type="number" step="0.01" data-action="close-cash" value="${escapeHtml(state.closeDay.countedCash)}"></div>
          <div class="field"><label>Closing note</label><textarea class="textarea" data-action="close-note">${escapeHtml(state.closeDay.note)}</textarea></div>
          <button class="primary" data-action="close-day">Close day</button>
        </div>
      </aside>
      <section class="panel"><div class="panel-header"><div><h2>Report</h2><p>Breakdown for ${escapeHtml(report.date || state.reportDate)}.</p></div></div>
        <div class="panel-body">
          <div class="metrics-row"><div class="metric"><span>Subtotal</span><strong>${money(report.subtotal)}</strong></div><div class="metric"><span>Discounts</span><strong>${money(report.discounts)}</strong></div><div class="metric"><span>Tips</span><strong>${money(report.tips)}</strong></div></div>
          <h3 class="section-title">Payment methods</h3><div class="report-list">${report.byMethod.map((row) => `<div class="report-row"><span>${escapeHtml(row.method)} (${row.orders})</span><strong>${money(row.total)}</strong></div>`).join("")}</div>
          <h3 class="section-title">Waiters</h3><div class="report-list waiter-report-list">${paidOrdersByWaiter.map((waiter) => `
            <details class="waiter-report-group">
              <summary>
                <span>${escapeHtml(waiter.waiterName)} (${waiter.orders.length})</span>
                <strong>${money(waiter.total)}</strong>
              </summary>
              <div class="order-list">${waiter.orders.map((order) => orderCard(order, "report")).join("")}</div>
            </details>
          `).join("") || `<p class="empty">No paid orders.</p>`}</div>
        </div>
      </section>
    </section>
  `;
}

function renderStaff() {
	const waiterRows = state.users
		.filter((user) => user.role === "waiter")
		.map(
			(waiter) => `
    <div class="admin-row ${waiter.active ? "" : "muted-row"}">
      <span><strong>${escapeHtml(waiter.name)}</strong><small>${escapeHtml(waiter.username)} - ${waiter.active ? "active" : "removed"}</small></span>
      <div class="row-actions">
        <button class="small-action" data-action="edit-waiter" data-id="${waiter.id}">Edit</button>
        <button class="small-action danger" data-action="remove-waiter" data-id="${waiter.id}" ${waiter.active ? "" : "disabled"}>Remove</button>
      </div>
    </div>
  `,
		)
		.join("");

	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>${state.waiterForm.id ? "Edit waiter" : "Add waiter"}</h2><p>Create staff login accounts for waiters.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Name</label><input class="input" data-action="waiter-name" value="${escapeHtml(state.waiterForm.name)}" placeholder="Waiter name"></div>
          <div class="field"><label>Username</label><input class="input" data-action="waiter-username" value="${escapeHtml(state.waiterForm.username)}" placeholder="login username"></div>
          <div class="field"><label>Password</label><input class="input" type="password" data-action="waiter-password" value="${escapeHtml(state.waiterForm.password)}" placeholder="${state.waiterForm.id ? "leave empty to keep current" : "minimum 6 characters"}"></div>
          <label class="check"><input type="checkbox" data-action="waiter-active" ${state.waiterForm.active ? "checked" : ""}> Active</label>
          <button class="primary" data-action="save-waiter">${state.waiterForm.id ? "Update waiter" : "Add waiter"}</button>
          <button class="secondary" data-action="reset-waiter">Clear</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Waiter accounts</h2><p>${state.users.filter((user) => user.role === "waiter" && user.active).length} active.</p></div></div><div class="panel-body"><div class="admin-list">${waiterRows || `<p class="empty">No waiters yet.</p>`}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Audit log</h2><p>Latest staff changes.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">No audit entries.</p>`}</div></div></div>
    </section>
  `;
}

function renderAdmin() {
	const rows = state.products
		.map(
			(product) => `
    <div class="admin-row">
      <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)} - ${money(product.price)} - ${product.available ? "available" : "hidden"}</small></span>
      <div class="row-actions">
        <button class="small-action" data-action="edit-product" data-id="${product.id}">Edit</button>
        <button class="small-action danger" data-action="delete-product" data-id="${product.id}" ${product.available ? "" : "disabled"}>Delete</button>
      </div>
    </div>
  `,
		)
		.join("");
	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>Menu management</h2><p>Add products, change prices, hide unavailable items.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Name</label><input class="input" data-action="product-name" value="${escapeHtml(state.productForm.name)}"></div>
          <div class="field"><label>Category</label><select class="select" data-action="product-category">${productCategories.map((category) => `<option value="${escapeHtml(category)}" ${state.productForm.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></div>
          <div class="field-grid"><div class="field"><label>Price</label><input class="input" type="number" step="0.01" data-action="product-price" value="${escapeHtml(state.productForm.price)}"></div><div class="field"><label>Sort</label><input class="input" type="number" data-action="product-sort" value="${escapeHtml(state.productForm.sort)}"></div></div>
          <label class="check"><input type="checkbox" data-action="product-available" ${state.productForm.available ? "checked" : ""}> Available</label>
          <button class="primary" data-action="save-product">${state.productForm.id ? "Update product" : "Add product"}</button>
          <button class="secondary" data-action="reset-product">Clear</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Products</h2><p>${state.products.length} menu items.</p></div></div><div class="panel-body"><div class="admin-list">${rows}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Audit log</h2><p>Latest operational changes.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">No audit entries.</p>`}</div></div></div>
    </section>
  `;
}

function renderTables() {
	const groups = tableSectionGroups();
	const rows = groups
		.map(
			(group) => `
    <h3 class="table-admin-section">${escapeHtml(group.title)}</h3>
    <div class="admin-list">${group.tables
			.map(
				(name) => `
      <div class="admin-row">
        <span><strong>${escapeHtml(name)}</strong></span>
        <div class="row-actions"><button class="small-action danger" data-action="delete-table" data-id="${escapeHtml(name)}">Remove</button></div>
      </div>`,
			)
			.join("")}</div>`,
		)
		.join("");
	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>Add table</h2><p>Tables waiters can select when taking orders.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Table name</label><input class="input" data-action="new-table-name" value="${escapeHtml(state.tableForm.name)}" placeholder="e.g. 1, Terrace 2"></div>
          <div class="field"><label>Section</label><input class="input" data-action="new-table-section" value="${escapeHtml(state.tableForm.section)}" placeholder="e.g. Tables, Terrace"></div>
          <button class="primary" data-action="save-table">Add table</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Tables</h2><p>${state.tables.length} tables.</p></div></div><div class="panel-body"><div class="admin-list">${rows || `<p class="empty">No tables yet.</p>`}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Audit log</h2><p>Latest operational changes.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">No audit entries.</p>`}</div></div></div>
    </section>
  `;
}

function renderShell() {
	const body =
		state.view === "reports"
			? renderReports()
			: state.view === "staff"
				? renderStaff()
				: state.view === "tables"
					? renderTables()
					: state.view === "admin"
						? renderAdmin()
						: renderWaiter();
	const labels = {
		waiter: "Waiter",
		reports: "Reports",
		staff: "Staff",
		tables: "Tables",
		admin: "Menu",
	};
	return `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><div class="brand-mark">R</div><div><h1>${escapeHtml((state.settings && state.settings.restaurantName) || "Rigera")}</h1><span>${escapeHtml(state.me.name)} - ${escapeHtml(state.me.role)}</span></div></div>
        <nav class="tabs">${allowedViews()
					.map(
						(view) =>
							`<button class="tab ${state.view === view ? "active" : ""}" data-view="${view}">${labels[view] || view}</button>`,
					)
					.join(
						"",
					)}<button class="tab" data-action="enable-sound">${state.audioReady ? "Alerts on" : "Enable alerts"}</button><button class="tab" data-action="logout">Logout</button></nav>
      </header>
      <main class="main">${body}</main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
}

function render() {
	const focused = document.activeElement;
	const focusState =
		focused &&
		app.contains(focused) &&
		focused.dataset &&
		focused.dataset.action
			? {
					action: focused.dataset.action,
					id: focused.dataset.id || "",
					start: focused.type === "number" ? null : focused.selectionStart,
					end: focused.type === "number" ? null : focused.selectionEnd,
				}
			: null;
	app.innerHTML = state.me ? renderShell() : renderLogin();
	if (!focusState) return;
	const selector = `[data-action="${focusState.action}"]${focusState.id ? `[data-id="${focusState.id}"]` : ""}`;
	const next = app.querySelector(selector);
	if (!next) return;
	next.focus();
	if (
		next.type !== "number" &&
		typeof focusState.start === "number" &&
		typeof focusState.end === "number" &&
		typeof next.setSelectionRange === "function"
	) {
		next.setSelectionRange(focusState.start, focusState.end);
	}
}

app.addEventListener("click", async (event) => {
	const target = event.target.closest("[data-view], [data-action]");
	if (!target) return;
	if (target.dataset.view) {
		state.view = target.dataset.view;
		if (state.view === "reports") await loadReport();
		if (state.view === "admin" || state.view === "staff" || state.view === "tables") await loadAudit();
		render();
		return;
	}
	const action = target.dataset.action;
	if (orderDraftLocked() && ["add-product", "cart-minus", "cart-plus", "select-table", "select-active-order", "toggle-take-away"].indexOf(action) !== -1) return;
	if (action === "enable-sound") {
		await enableAlerts();
		playTone("ready");
		vibrate("ready");
		toast("Alerts enabled");
		return;
	}
	if (action === "login") login();
	if (action === "logout") logout(true);
	if (action === "add-product") addProduct(target.dataset.id);
	if (action === "cart-minus") updateCart(target.dataset.id, -1);
	if (action === "cart-plus") updateCart(target.dataset.id, 1);
	if (action === "select-table") {
		const table = target.dataset.table || "";
		const lock = tableLock(table);
		if (lock && lock.waiterId !== state.me.id) return;
		state.takeAway = false;
		state.takeAwayNewOrder = false;
		state.table = table;
		const order = orderForTable(table);
		state.selectedOrderId = order ? order.id : "";
		render();
	}
	if (action === "select-active-order") {
		const order = state.orders.find((item) => item.id === target.dataset.id);
		if (!order) return;
		state.takeAway = isTakeAwayTable(order.table);
		state.takeAwayNewOrder = false;
		state.table = state.takeAway ? "" : order.table;
		state.selectedOrderId = order.id;
		render();
	}
	if (action === "toggle-take-away") {
		state.takeAway = !state.takeAway;
		if (state.takeAway) {
			state.table = "";
			const ownTakeAway = waiterOwnActiveOrders().find((order) => isTakeAwayTable(order.table));
			state.selectedOrderId = ownTakeAway ? ownTakeAway.id : "";
		} else {
			state.takeAwayNewOrder = false;
			if (isTakeAwayTable(state.table)) state.table = "";
			state.selectedOrderId = "";
		}
		render();
	}
	if (action === "send-order") sendOrder();
	if (action === "paid") payOrder(target.dataset.id);
	if (action === "cancel") cancelOrder(target.dataset.id);
	if (action === "edit-order") beginEditOrder(target.dataset.id);
	if (action === "save-order-edit") saveEditOrder(target.dataset.id);
	if (action === "cancel-order-edit") cancelEditOrder(target.dataset.id);
	if (action === "toggle-edit-item") {
		const edit = state.orderEdits[target.dataset.id];
		const item = edit && edit.items[Number(target.dataset.index)];
		if (item) item.removed = !item.removed;
		render();
	}
	if (action === "add-product-to-edit") {
		const edit = state.orderEdits[target.dataset.id];
		const product = edit && state.products.find((item) => item.id === edit.addProductId);
		if (edit && product) {
			edit.addedItems.push({
				productId: product.id,
				name: product.name,
				quantity: 1,
				price: product.price,
				note: "",
			});
			edit.addProductId = "";
			render();
		}
	}
	if (action === "remove-added-item") {
		const edit = state.orderEdits[target.dataset.id];
		if (edit) {
			edit.addedItems.splice(Number(target.dataset.index), 1);
			render();
		}
	}
	if (action === "save-table") saveTable();
	if (action === "delete-table") deleteTable(target.dataset.id);
	if (action === "save-product") saveProduct();
	if (action === "edit-product") editProduct(target.dataset.id);
	if (action === "delete-product") deleteProduct(target.dataset.id);
	if (action === "reset-product") {
		resetProductForm();
		render();
	}
	if (action === "save-waiter") saveWaiter();
	if (action === "edit-waiter") editWaiter(target.dataset.id);
	if (action === "remove-waiter") removeWaiter(target.dataset.id);
	if (action === "reset-waiter") {
		resetWaiterForm();
		render();
	}
	if (action === "close-day") closeDay();
});

app.addEventListener("input", (event) => {
	const t = event.target;
	const action = t.dataset.action;
	if (orderDraftLocked() && ["table", "order-notes", "cart-note"].indexOf(action) !== -1) return;
	if (action === "login-username") state.login.username = t.value;
	if (action === "login-password") state.login.password = t.value;
	if (action === "table") state.table = t.value;
	if (action === "order-notes") state.orderNotes = t.value;
	if (action === "search") {
		state.search = t.value;
		render();
	}
	if (action === "cart-note") {
		const item = state.cart.find(
			(candidate) => candidate.productId === t.dataset.id,
		);
		if (item) item.note = t.value;
	}
	if (action === "pay-discount") state.payment.discount = t.value;
	if (action === "pay-tip") state.payment.tip = t.value;
	if (action === "new-table-name") state.tableForm.name = t.value;
	if (action === "new-table-section") state.tableForm.section = t.value;
	if (action === "product-name") state.productForm.name = t.value;
	if (action === "product-category") state.productForm.category = t.value;
	if (action === "product-price") state.productForm.price = t.value;
	if (action === "product-sort") state.productForm.sort = t.value;
	if (action === "waiter-name") state.waiterForm.name = t.value;
	if (action === "waiter-username") state.waiterForm.username = t.value;
	if (action === "waiter-password") state.waiterForm.password = t.value;
	if (action === "edit-order-table" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].table = t.value;
	if (action === "edit-order-notes" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].notes = t.value;
	if (action === "edit-order-quantity" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].items[Number(t.dataset.index)].quantity = t.value;
	if (action === "edit-order-price" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].items[Number(t.dataset.index)].price = t.value;
	if (action === "edit-order-note" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].items[Number(t.dataset.index)].note = t.value;
	if (action === "edit-added-quantity" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].addedItems[Number(t.dataset.index)].quantity = t.value;
	if (action === "edit-added-price" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].addedItems[Number(t.dataset.index)].price = t.value;
	if (action === "edit-added-note" && state.orderEdits[t.dataset.id]) state.orderEdits[t.dataset.id].addedItems[Number(t.dataset.index)].note = t.value;
	if (action === "close-cash") state.closeDay.countedCash = t.value;
	if (action === "close-note") state.closeDay.note = t.value;
});

app.addEventListener("change", async (event) => {
	const t = event.target;
	const action = t.dataset.action;
	if (orderDraftLocked() && action === "take-away-new-order") return;
	if (action === "category") {
		state.category = t.value;
		render();
	}
	if (action === "pay-method") state.payment.method = t.value;
	if (action === "product-available") state.productForm.available = t.checked;
	if (action === "product-category") state.productForm.category = t.value;
	if (action === "waiter-active") state.waiterForm.active = t.checked;
	if (action === "take-away-new-order") {
		state.takeAwayNewOrder = t.checked;
		render();
	}
	if (action === "manager-waiter-filter") {
		state.managerWaiterFilter = t.value;
		render();
	}
	if (action === "edit-add-product-select" && state.orderEdits[t.dataset.id]) {
		state.orderEdits[t.dataset.id].addProductId = t.value;
		render();
	}
	if (action === "report-date") {
		state.reportDate = t.value;
		await loadReport();
		render();
	}
});

bootstrap();
setInterval(async () => {
	if (!state.me || document.visibilityState === "hidden") return;
	const changed = await refreshOrders(true);
	if (!changed) return;
	if (shouldPatchWaiterOrders()) {
		if (!patchWaiterActiveOrders()) render();
		return;
	}
	if (state.view === "reports") return;
	render();
}, 4000);
