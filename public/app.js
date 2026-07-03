const state = {
	token: localStorage.getItem("restaurant_token") || "",
	me: null,
	settings: null,
	publicSettings: { restaurantName: "Porosite e Restorantit" },
	users: [],
	products: [],
	orders: [],
	audit: [],
	report: null,
	view: "waiter",
	login: { username: "", password: "" },
	table: "",
	orderNotes: "",
	cart: [],
	search: "",
	category: "",
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
	closeDay: { countedCash: "", note: "" },
	toast: "",
	orderSnapshot: {},
	audioReady: localStorage.getItem("restaurant_alerts_enabled") === "true",
	audioContext: null,
};

const app = document.getElementById("app");
const statusLabels = {
	sent: "Derguar",
	received: "Pranuar",
	preparing: "Ne pergatitje",
	done: "Gati",
	paid: "Paguar",
	canceled: "Anuluar",
};
const statusRank = { sent: 1, received: 2, preparing: 3, done: 4 };
const stationLabels = { kitchen: "Kuzhina" };
const roleLabels = { admin: "Admin", waiter: "Kamarier", kitchen: "Kuzhina" };
const paymentLabels = { cash: "Kesh", card: "Karte", mixed: "Te perziera", other: "Tjeter" };
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
const categoryLabels = {
	Pizza: "Pica",
	Soups: "Supa",
	Rissoto: "Rizoto",
	Pasta: "Pasta",
	Grill: "Zgare",
	"Mix grill": "Miks zgare",
	Fish: "Peshk",
	"Mix fish": "Miks peshku",
	Salads: "Sallata",
	"Side dish": "Garniture",
	"Drinks and coctails": "Pije dhe koktejle",
};

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

function appName() {
	return (state.settings && state.settings.restaurantName)
		|| (state.publicSettings && state.publicSettings.restaurantName)
		|| "Porosite e Restorantit";
}

function categoryLabel(category) {
	return categoryLabels[category] || category;
}

function roleLabel(role) {
	return roleLabels[role] || role;
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

function stationForCurrentView() {
	if (!state.me) return "";
	if (state.me.role === "kitchen") return "kitchen";
	if (state.view === "kitchen") return state.view;
	return "";
}

function snapshotOrder(order) {
	const stationStatuses = {};
	Object.keys(order.stationStatuses || {}).forEach((station) => {
		stationStatuses[station] = order.stationStatuses[station].status;
	});
	return {
		status: order.status,
		paymentStatus: order.paymentStatus,
		stationStatuses,
	};
}

function primeOrderSnapshot(orders) {
	state.orderSnapshot = {};
	orders.forEach((order) => {
		state.orderSnapshot[order.id] = snapshotOrder(order);
	});
}

function detectOrderNotifications(nextOrders) {
	if (!state.me) return;
	const previous = state.orderSnapshot || {};
	const station = stationForCurrentView();
	let newStationOrder = false;
	let waiterReadyOrder = false;

	nextOrders.forEach((order) => {
		const before = previous[order.id];
		if (station && order.stationStatuses && order.stationStatuses[station]) {
			const beforeStation = before && before.stationStatuses ? before.stationStatuses[station] : "";
			const nextStation = order.stationStatuses[station].status;
			if ((!beforeStation || (beforeStation !== "sent" && nextStation === "sent")) && order.paymentStatus === "open") newStationOrder = true;
		}
		if (state.me.role === "waiter" && before && before.status !== "done" && order.status === "done" && order.paymentStatus === "open") {
			waiterReadyOrder = true;
		}
	});

	if (newStationOrder) {
		notify("Porosi e re", "Nje porosi e re erdhi ne kuzhine.", "new");
		toast("Porosi e re");
	}
	if (waiterReadyOrder) {
		notify("Porosia eshte gati", "Porosia eshte perfunduar.", "ready");
		toast("Porosia eshte gati");
	}
	primeOrderSnapshot(nextOrders);
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
		throw new Error(data.error || "Kerkesa deshtoi");
	}
	return data;
}

async function loadPublicSettings() {
	try {
		const settings = await api("/api/public-settings");
		state.publicSettings = settings;
		document.title = appName();
	} catch (error) {
		state.publicSettings = { restaurantName: "Porosite e Restorantit" };
	}
}

function allowedViews() {
	if (!state.me) return [];
	if (state.me.role === "admin")
		return ["waiter", "kitchen", "reports", "staff", "admin"];
	if (state.me.role === "kitchen") return ["kitchen"];
	return ["waiter"];
}

function defaultViewForRole(role) {
	if (role === "kitchen") return "kitchen";
	return "waiter";
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
		document.title = appName();
		state.users = data.users || [];
		state.products = data.products;
		state.orders = data.orders;
		if (state.me.role === "kitchen") {
			state.view = defaultViewForRole(state.me.role);
		}
		if (allowedViews().indexOf(state.view) === -1)
			state.view = allowedViews()[0];
		if (state.view === "reports") await loadReport();
		if (state.view === "admin" || state.view === "staff") await loadAudit();
		primeOrderSnapshot(state.orders);
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
		state.view = defaultViewForRole(data.user.role);
		await bootstrap();
		if (state.audioReady) enablePushNotifications();
		toast(`U kyce si ${data.user.name}`);
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
	state.orderSnapshot = {};
	render();
}

async function refreshOrders(silent) {
	if (!state.token) return;
	try {
		const orders = await api("/api/orders");
		if (silent) detectOrderNotifications(orders);
		else primeOrderSnapshot(orders);
		state.orders = orders;
		if (!silent) render();
	} catch (error) {
		if (!silent) toast(error.message);
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

function addProduct(productId) {
	const product = state.products.find((item) => item.id === productId);
	if (!product || product.available === false) return;
	const existing = state.cart.find((item) => item.productId === productId);
	if (existing) existing.quantity += 1;
	else state.cart.push({ productId, quantity: 1, note: "" });
	render();
}

function updateCart(productId, amount) {
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
	try {
		const order = await api("/api/orders", {
			method: "POST",
			body: JSON.stringify({
				table: state.table,
				notes: state.orderNotes,
				items: state.cart,
			}),
		});
		const existing = state.orders.some((item) => item.id === order.id);
		state.orders = existing
			? state.orders.map((item) => (item.id === order.id ? order : item))
			: [order].concat(state.orders);
		state.orderSnapshot[order.id] = snapshotOrder(order);
		state.table = "";
		state.orderNotes = "";
		state.cart = [];
		toast(`Porosia #${order.number} u dergua`);
	} catch (error) {
		toast(error.message);
	}
}

async function setStatus(orderId, status, station) {
	try {
		const path = station
			? `/api/orders/${orderId}/stations/${station}/status`
			: `/api/orders/${orderId}/status`;
		const order = await api(path, {
			method: "PATCH",
			body: JSON.stringify({ status }),
		});
		replaceOrder(order);
		toast(`Porosia #${order.number}: ${station ? `${stationLabels[station]} ` : ""}${statusLabels[status]}`);
	} catch (error) {
		toast(error.message);
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
		toast(`Porosia #${order.number} u pagua`);
	} catch (error) {
		toast(error.message);
	}
}

async function cancelOrder(orderId) {
	const reason = prompt("Arsyeja e anulimit");
	if (!reason) return;
	try {
		const order = await api(`/api/orders/${orderId}/cancel`, {
			method: "PATCH",
			body: JSON.stringify({ reason }),
		});
		replaceOrder(order);
		toast(`Porosia #${order.number} u anulua`);
	} catch (error) {
		toast(error.message);
	}
}

function replaceOrder(order) {
	state.orders = state.orders.map((item) =>
		item.id === order.id ? order : item,
	);
	state.orderSnapshot[order.id] = snapshotOrder(order);
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
		toast("Menuja u ruajt");
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
	if (!product || !confirm(`Te fshihet ${product.name} nga menuja?`)) return;
	try {
		const updated = await api(`/api/products/${id}`, { method: "DELETE" });
		state.products = state.products.filter((item) => item.id !== updated.id);
		if (state.productForm.id === id) resetProductForm();
		await loadAudit();
		toast(`${updated.name} u hoq nga menuja`);
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
		toast(`Kamarieri ${waiter.name} u ruajt`);
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
	if (!waiter || !confirm(`Te hiqet kamarieri ${waiter.name}?`)) return;
	try {
		const updated = await api(`/api/users/waiters/${id}`, { method: "DELETE" });
		state.users = state.users.map((user) =>
			user.id === updated.id ? updated : user,
		);
		await loadAudit();
		toast(`Kamarieri ${updated.name} u hoq`);
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
		toast(`Dita u mbyll. Kesh i pritur: ${money(closure.expectedCash)}`);
	} catch (error) {
		toast(error.message);
	}
}

function activeOrders() {
	return state.orders.filter((order) => order.paymentStatus === "open");
}

function closedOrders() {
	return state.orders.filter((order) => order.paymentStatus !== "open");
}

function orderCard(order, context) {
	const status = order.paymentStatus === "paid" ? "paid" : order.status;
	const station = context && context.indexOf("station:") === 0 ? context.split(":")[1] : "";
	const stationContext = Boolean(station);
	const displayItems = station
		? order.items.filter((item) => item.station === station)
		: order.items;
	const items = displayItems
		.map(
			(item) => `
    <li>
      <span><strong>${item.quantity}x ${escapeHtml(item.name)}</strong><small>${stationContext ? "" : escapeHtml(stationLabels[item.station] || item.station || "")}${item.note ? `${stationContext ? "" : " - "}${escapeHtml(item.note)}` : ""}</small></span>
      ${stationContext ? "" : `<strong>${money(item.price * item.quantity)}</strong>`}
    </li>
  `,
		)
		.join("");
	const stationSummary = order.stationStatuses
		? Object.keys(order.stationStatuses)
				.map((key) => `<span class="status ${order.stationStatuses[key].status}">${stationLabels[key] || key}: ${statusLabels[order.stationStatuses[key].status]}</span>`)
				.join("")
		: "";

	return `
    <article class="order-card ${order.paymentStatus !== "open" ? "closed" : ""}">
      <div class="order-card-header">
        <div>
          <h3>#${order.number} - ${escapeHtml(order.table)}</h3>
          <p>${escapeHtml(order.waiterName)} - ${new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <span class="status ${status}">${statusLabels[status] || status}</span>
      </div>
      <div class="order-card-body ${stationContext ? "station-card-body" : ""}">
        ${order.paymentStatus === "open" ? `<div class="station-summary">${stationSummary}</div>` : ""}
        <ul class="line-items">${items}</ul>
        ${order.notes ? `<p class="${stationContext ? "station-order-note" : ""}"><strong>Shenim:</strong> ${escapeHtml(order.notes)}</p>` : ""}
        ${!stationContext && order.discount ? `<div class="line"><span>Zbritje</span><strong>-${money(order.discount)}</strong></div>` : ""}
        ${stationContext ? "" : `<div class="total-row"><span>Totali</span><span>${money(order.total)}</span></div>`}
        ${!stationContext && order.payment ? `<p>Pagesa: ${escapeHtml(paymentLabels[order.payment.method] || order.payment.method)}${order.payment.tip ? `, bakshish ${money(order.payment.tip)}` : ""}</p>` : ""}
        ${!stationContext && order.paymentStatus === "void" ? `<p>Anuluar: ${escapeHtml(order.canceledReason)}</p>` : ""}
        ${orderActions(order, context)}
      </div>
    </article>
  `;
}

function orderActions(order, context) {
	if (order.paymentStatus !== "open") return "";
	if (context && context.indexOf("station:") === 0) {
		const station = context.split(":")[1];
		const stationStatus = order.stationStatuses && order.stationStatuses[station] ? order.stationStatuses[station].status : "";
		return `
      <div class="order-actions">
        <button class="small-action" data-action="status" data-id="${order.id}" data-station="${station}" data-status="received" ${stationStatus !== "sent" ? "disabled" : ""}>Prano</button>
        <button class="small-action" data-action="status" data-id="${order.id}" data-station="${station}" data-status="preparing" ${stationStatus !== "received" ? "disabled" : ""}>Pergatit</button>
        <button class="small-action ready" data-action="status" data-id="${order.id}" data-station="${station}" data-status="done" ${["received", "preparing"].indexOf(stationStatus) === -1 ? "disabled" : ""}>Gati</button>
      </div>
    `;
	}
	return `
    <div class="payment-box">
      <select class="select compact" data-action="pay-method">
        ${["cash", "card", "mixed", "other"].map((method) => `<option value="${method}" ${state.payment.method === method ? "selected" : ""}>${paymentLabels[method]}</option>`).join("")}
      </select>
      <input class="input compact" type="number" step="0.01" data-action="pay-discount" value="${escapeHtml(state.payment.discount)}" placeholder="Zbritje">
      <input class="input compact" type="number" step="0.01" data-action="pay-tip" value="${escapeHtml(state.payment.tip)}" placeholder="Bakshish">
      <button class="small-action ready" data-action="paid" data-id="${order.id}" ${order.status !== "done" ? "disabled" : ""}>Paguar</button>
      <button class="small-action danger" data-action="cancel" data-id="${order.id}">Anulo</button>
    </div>
  `;
}

function renderLogin() {
	return `
    <main class="login-screen">
      <section class="login-card">
        <div class="brand big"><div class="brand-mark">RO</div><div><h1>${escapeHtml(appName())}</h1><span>Hyrje per stafin</span></div></div>
        <div class="field"><label>Perdoruesi</label><input class="input" data-action="login-username" value="${escapeHtml(state.login.username)}"></div>
        <div class="field"><label>Fjalekalimi</label><input class="input" type="password" data-action="login-password" value="${escapeHtml(state.login.password)}"></div>
        <button class="primary" data-action="login">Kycu</button>
        <p class="empty">Perdor hyrjen e caktuar per stafin.</p>
      </section>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </main>
  `;
}

function renderWaiter() {
	const products = menuProducts(false)
		.map(
			(product) => `
    <button class="product" data-action="add-product" data-id="${product.id}">
      <strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(categoryLabel(product.category))}</span><span class="price">${money(product.price)}</span>
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
        <div><h3>${escapeHtml(product.name)}</h3><p>${money(product.price)} secila</p><input class="input" data-action="cart-note" data-id="${product.id}" value="${escapeHtml(item.note)}" placeholder="Shenim per kuzhinen"></div>
        <div class="quantity"><button class="icon-button" data-action="cart-minus" data-id="${product.id}">-</button><strong>${item.quantity}</strong><button class="icon-button" data-action="cart-plus" data-id="${product.id}">+</button></div>
      </div>
    `;
		})
		.join("");
	return `
    <div class="workspace">
      <section class="panel"><div class="panel-header"><div><h2>Porosi e re</h2><p>${escapeHtml(state.me.name)} po e merr kete porosi.</p></div></div>
        <div class="panel-body">
          <div class="field-grid">
            <div class="field"><label>Tavolina</label><input class="input" data-action="table" value="${escapeHtml(state.table)}" placeholder="Tavolina 4"></div>
            <div class="field"><label>Kerko</label><input class="input" data-action="search" value="${escapeHtml(state.search)}" placeholder="Artikull menuje"></div>
            <div class="field"><label>Kategoria</label><select class="select" data-action="category">${categories()
							.map(
								(category) =>
									`<option value="${category}" ${state.category === category ? "selected" : ""}>${category === "" ? "Zgjidh kategorine" : category === "all" ? "Te gjitha kategorite" : escapeHtml(categoryLabel(category))}</option>`,
							)
							.join("")}</select></div>
            <div class="field full"><label>Shenim porosie</label><textarea class="textarea" data-action="order-notes">${escapeHtml(state.orderNotes)}</textarea></div>
          </div>
          <div class="product-grid">${products || `<p class="empty">${state.search.trim() || state.category ? "Nuk ka produkte te disponueshme." : "Kerko ose zgjidh nje kategori per te shfaqur produktet."}</p>`}</div>
        </div>
      </section>
      <aside class="panel"><div class="panel-header"><div><h2>Fatura</h2><p>${state.cart.length} artikull${state.cart.length === 1 ? "" : "e"}</p></div></div>
        <div class="panel-body"><div class="cart-list">${cart || `<p class="empty">Prek produktet per t'i shtuar.</p>`}</div><div class="cart-footer"><div class="total-row"><span>Totali</span><span>${money(cartTotal())}</span></div><button class="primary" data-action="send-order" ${state.cart.length ? "" : "disabled"}>Dergo porosine</button></div></div>
      </aside>
      <section class="panel span"><div class="panel-header"><div><h2>Porosite e mia aktive</h2><p>Mbylli porosite vetem pasi kuzhina i shenon gati.</p></div></div><div class="panel-body"><div class="order-list">${
				activeOrders()
					.map((order) => orderCard(order, "waiter"))
					.join("") || `<p class="empty">Nuk ka porosi aktive.</p>`
			}</div></div></section>
    </div>
  `;
}

function renderStation(station) {
	const columns = [
		{ title: "Te reja", statuses: ["sent"] },
		{ title: "Ne pergatitje", statuses: ["received", "preparing"] },
		{ title: "Gati", statuses: ["done"] },
	];
	return `<section class="station-board"><div class="panel station-hero"><div class="panel-header"><div><h2>Porosite e ${stationLabels[station]}</h2><p>Prano dhe perfundo porosite qe vijne.</p></div></div></div><div class="kitchen-grid">${columns
		.map((column) => {
			const orders = activeOrders().filter(
				(order) => order.stationStatuses && order.stationStatuses[station] && column.statuses.indexOf(order.stationStatuses[station].status) > -1,
			);
			return `<div class="column"><h2>${stationLabels[station]} - ${column.title}</h2><div class="order-list">${orders.map((order) => orderCard(order, `station:${station}`)).join("") || `<p class="empty">Asgje ketu.</p>`}</div></div>`;
		})
		.join("")}</div></section>`;
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
	return `
    <section class="report-grid">
      <aside class="panel"><div class="panel-header"><div><h2>Mbyllja e dites</h2><p>Shitjet e paguara, anulimet dhe kontrolli i keshit.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Data</label><input class="input" type="date" data-action="report-date" value="${escapeHtml(state.reportDate)}"></div>
          <div class="metric"><span>Shitje totale</span><strong>${money(report.total)}</strong></div>
          <div class="metric"><span>Porosi te paguara</span><strong>${report.orderCount}</strong></div>
          <div class="metric"><span>Anulime</span><strong>${report.voidCount}</strong></div>
          <div class="field"><label>Kesh i numeruar</label><input class="input" type="number" step="0.01" data-action="close-cash" value="${escapeHtml(state.closeDay.countedCash)}"></div>
          <div class="field"><label>Shenim mbylljeje</label><textarea class="textarea" data-action="close-note">${escapeHtml(state.closeDay.note)}</textarea></div>
          <button class="primary" data-action="close-day">Mbyll diten</button>
        </div>
      </aside>
      <section class="panel"><div class="panel-header"><div><h2>Raporti</h2><p>Permbledhje per ${escapeHtml(report.date || state.reportDate)}.</p></div></div>
        <div class="panel-body">
          <div class="metrics-row"><div class="metric"><span>Nentotali</span><strong>${money(report.subtotal)}</strong></div><div class="metric"><span>Zbritje</span><strong>${money(report.discounts)}</strong></div><div class="metric"><span>Bakshishe</span><strong>${money(report.tips)}</strong></div></div>
          <h3 class="section-title">Metodat e pageses</h3><div class="report-list">${report.byMethod.map((row) => `<div class="report-row"><span>${escapeHtml(paymentLabels[row.method] || row.method)} (${row.orders})</span><strong>${money(row.total)}</strong></div>`).join("")}</div>
          <h3 class="section-title">Kamarieret</h3><div class="report-list">${report.byWaiter.map((row) => `<div class="report-row"><span>${escapeHtml(row.waiterName)} (${row.orders})</span><strong>${money(row.total)}</strong></div>`).join("")}</div>
          <h3 class="section-title">Porosi te paguara</h3><div class="order-list">${report.orders.map((order) => orderCard(order, "report")).join("") || `<p class="empty">Nuk ka porosi te paguara.</p>`}</div>
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
      <span><strong>${escapeHtml(waiter.name)}</strong><small>${escapeHtml(waiter.username)} - ${waiter.active ? "aktiv" : "i hequr"}</small></span>
      <div class="row-actions">
        <button class="small-action" data-action="edit-waiter" data-id="${waiter.id}">Ndrysho</button>
        <button class="small-action danger" data-action="remove-waiter" data-id="${waiter.id}" ${waiter.active ? "" : "disabled"}>Hiq</button>
      </div>
    </div>
  `,
		)
		.join("");

	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>${state.waiterForm.id ? "Ndrysho kamarierin" : "Shto kamarier"}</h2><p>Krijo hyrje per kamarieret.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Emri</label><input class="input" data-action="waiter-name" value="${escapeHtml(state.waiterForm.name)}" placeholder="Emri i kamarierit"></div>
          <div class="field"><label>Perdoruesi</label><input class="input" data-action="waiter-username" value="${escapeHtml(state.waiterForm.username)}" placeholder="perdoruesi per hyrje"></div>
          <div class="field"><label>Fjalekalimi</label><input class="input" type="password" data-action="waiter-password" value="${escapeHtml(state.waiterForm.password)}" placeholder="${state.waiterForm.id ? "lere bosh per ta mbajtur aktualin" : "minimumi 6 karaktere"}"></div>
          <label class="check"><input type="checkbox" data-action="waiter-active" ${state.waiterForm.active ? "checked" : ""}> Aktiv</label>
          <button class="primary" data-action="save-waiter">${state.waiterForm.id ? "Perditeso kamarierin" : "Shto kamarier"}</button>
          <button class="secondary" data-action="reset-waiter">Pastro</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Llogarite e kamariereve</h2><p>${state.users.filter((user) => user.role === "waiter" && user.active).length} aktiv.</p></div></div><div class="panel-body"><div class="admin-list">${waiterRows || `<p class="empty">Nuk ka ende kamariere.</p>`}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Historiku</h2><p>Ndryshimet e fundit te stafit.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">Nuk ka shenime historiku.</p>`}</div></div></div>
    </section>
  `;
}

function renderAdmin() {
	const rows = state.products
		.map(
			(product) => `
    <div class="admin-row">
      <span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(categoryLabel(product.category))} - ${money(product.price)} - ${product.available ? "ne dispozicion" : "i fshehur"}</small></span>
      <div class="row-actions">
        <button class="small-action" data-action="edit-product" data-id="${product.id}">Ndrysho</button>
        <button class="small-action danger" data-action="delete-product" data-id="${product.id}" ${product.available ? "" : "disabled"}>Fshi</button>
      </div>
    </div>
  `,
		)
		.join("");
	return `
    <section class="admin-grid">
      <div class="panel"><div class="panel-header"><div><h2>Menaxhimi i menuse</h2><p>Shto produkte, ndrysho cmime, fsheh artikuj qe nuk jane ne dispozicion.</p></div></div>
        <div class="panel-body cart-list">
          <div class="field"><label>Emri</label><input class="input" data-action="product-name" value="${escapeHtml(state.productForm.name)}"></div>
          <div class="field"><label>Kategoria</label><select class="select" data-action="product-category">${productCategories.map((category) => `<option value="${escapeHtml(category)}" ${state.productForm.category === category ? "selected" : ""}>${escapeHtml(categoryLabel(category))}</option>`).join("")}</select></div>
          <div class="field-grid"><div class="field"><label>Cmimi</label><input class="input" type="number" step="0.01" data-action="product-price" value="${escapeHtml(state.productForm.price)}"></div><div class="field"><label>Renditja</label><input class="input" type="number" data-action="product-sort" value="${escapeHtml(state.productForm.sort)}"></div></div>
          <label class="check"><input type="checkbox" data-action="product-available" ${state.productForm.available ? "checked" : ""}> Ne dispozicion</label>
          <button class="primary" data-action="save-product">${state.productForm.id ? "Perditeso produktin" : "Shto produkt"}</button>
          <button class="secondary" data-action="reset-product">Pastro</button>
        </div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Produktet</h2><p>${state.products.length} artikuj menuje.</p></div></div><div class="panel-body"><div class="admin-list">${rows}</div></div></div>
      <div class="panel span"><div class="panel-header"><div><h2>Historiku</h2><p>Ndryshimet e fundit operative.</p></div></div><div class="panel-body"><div class="admin-list">${state.audit.map((item) => `<div class="admin-row"><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.userName)} - ${new Date(item.at).toLocaleString()}</small></span></div>`).join("") || `<p class="empty">Nuk ka shenime historiku.</p>`}</div></div></div>
    </section>
  `;
}

function renderShell() {
	const body =
		state.view === "kitchen"
			? renderStation("kitchen")
			: state.view === "reports"
				? renderReports()
				: state.view === "staff"
					? renderStaff()
					: state.view === "admin"
						? renderAdmin()
						: renderWaiter();
	const labels = {
		waiter: "Kamarier",
		kitchen: "Kuzhina",
		reports: "Raporte",
		staff: "Stafi",
		admin: "Menuja",
	};
	return `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand"><div class="brand-mark">RO</div><div><h1>${escapeHtml(appName())}</h1><span>${escapeHtml(state.me.name)} - ${escapeHtml(roleLabel(state.me.role))}</span></div></div>
        <nav class="tabs">${allowedViews()
					.map(
						(view) =>
							`<button class="tab ${state.view === view ? "active" : ""}" data-view="${view}">${labels[view] || view}</button>`,
					)
					.join(
						"",
					)}<button class="tab" data-action="enable-sound">${state.audioReady ? "Njoftimet aktive" : "Aktivizo njoftimet"}</button><button class="tab" data-action="logout">Dil</button></nav>
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
		if (state.view === "admin" || state.view === "staff") await loadAudit();
		render();
		return;
	}
	const action = target.dataset.action;
	if (action === "enable-sound") {
		await enableAlerts();
		playTone("ready");
		vibrate("ready");
		toast("Njoftimet u aktivizuan");
		return;
	}
	if (action === "login") login();
	if (action === "logout") logout(true);
	if (action === "add-product") addProduct(target.dataset.id);
	if (action === "cart-minus") updateCart(target.dataset.id, -1);
	if (action === "cart-plus") updateCart(target.dataset.id, 1);
	if (action === "send-order") sendOrder();
	if (action === "status") setStatus(target.dataset.id, target.dataset.status, target.dataset.station);
	if (action === "paid") payOrder(target.dataset.id);
	if (action === "cancel") cancelOrder(target.dataset.id);
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
	if (action === "product-name") state.productForm.name = t.value;
	if (action === "product-category") state.productForm.category = t.value;
	if (action === "product-price") state.productForm.price = t.value;
	if (action === "product-sort") state.productForm.sort = t.value;
	if (action === "waiter-name") state.waiterForm.name = t.value;
	if (action === "waiter-username") state.waiterForm.username = t.value;
	if (action === "waiter-password") state.waiterForm.password = t.value;
	if (action === "close-cash") state.closeDay.countedCash = t.value;
	if (action === "close-note") state.closeDay.note = t.value;
});

app.addEventListener("change", async (event) => {
	const t = event.target;
	const action = t.dataset.action;
	if (action === "category") {
		state.category = t.value;
		render();
	}
	if (action === "pay-method") state.payment.method = t.value;
	if (action === "product-available") state.productForm.available = t.checked;
	if (action === "product-category") state.productForm.category = t.value;
	if (action === "waiter-active") state.waiterForm.active = t.checked;
	if (action === "report-date") {
		state.reportDate = t.value;
		await loadReport();
		render();
	}
});

async function start() {
	await loadPublicSettings();
	await bootstrap();
}

start();
setInterval(async () => {
	if (!state.me) return;
	await refreshOrders(true);
	if (state.view === "reports") await loadReport();
	render();
}, 4000);
