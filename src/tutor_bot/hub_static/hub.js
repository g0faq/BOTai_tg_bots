const rawTelegramWebApp = window.Telegram?.WebApp;
const tg = rawTelegramWebApp?.initData ? rawTelegramWebApp : null;

function syncTelegramViewportState() {
  document.body.classList.toggle("tg-webapp", Boolean(tg));
  document.body.classList.toggle("browser-webapp", !tg);
  document.body.classList.toggle("tg-fullscreen", Boolean(tg?.isFullscreen));
  const safeTop = Number(tg?.safeAreaInset?.top || 0);
  const safeBottom = Number(tg?.safeAreaInset?.bottom || 0);
  const contentSafeTop = Number(tg?.contentSafeAreaInset?.top || 0);
  const contentSafeBottom = Number(tg?.contentSafeAreaInset?.bottom || 0);
  document.documentElement.style.setProperty("--tg-safe-area-inset-top", `${safeTop}px`);
  document.documentElement.style.setProperty("--tg-safe-area-inset-bottom", `${safeBottom}px`);
  document.documentElement.style.setProperty("--tg-content-safe-area-inset-top", `${contentSafeTop}px`);
  document.documentElement.style.setProperty("--tg-content-safe-area-inset-bottom", `${contentSafeBottom}px`);
}

function disableTelegramVerticalSwipes() {
  try {
    tg?.disableVerticalSwipes?.();
  } catch (error) {
    console.log("Telegram vertical swipes disable failed:", error);
  }
}

function initTelegramWebApp() {
  if (!tg) {
    syncTelegramViewportState();
    return;
  }
  try {
    syncTelegramViewportState();
    tg.ready?.();
    tg.expand?.();
    tg.requestFullscreen?.();
    tg.setHeaderColor?.("#05070b");
    tg.setBackgroundColor?.("#05070b");
    tg.setBottomBarColor?.("#05070b");
    disableTelegramVerticalSwipes();
    tg.onEvent?.("fullscreenChanged", () => {
      syncTelegramViewportState();
      disableTelegramVerticalSwipes();
    });
    tg.onEvent?.("safeAreaChanged", syncTelegramViewportState);
    tg.onEvent?.("contentSafeAreaChanged", syncTelegramViewportState);
    tg.onEvent?.("fullscreenFailed", syncTelegramViewportState);
    syncTelegramViewportState();
  } catch (error) {
    console.log("Telegram WebApp init failed:", error);
  }
}

const state = { view: "overview", data: null };

function headers() {
  const result = { "Content-Type": "application/json", "X-App-Version": "20260613-hub-v20" };
  if (tg?.initData) result["X-Telegram-Init-Data"] = tg.initData;
  return result;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Ошибка запроса");
  return payload;
}

function money(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function dateShort(value) {
  if (!value) return "не указано";
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(value) {
  return ({ active: "active", paused: "paused", disabled: "disabled", overdue: "overdue", paid: "paid", due_soon: "due soon", unpaid: "unpaid" }[value] || value);
}

function toast(text) {
  const node = document.querySelector("#toast");
  node.textContent = text;
  node.classList.remove("hidden");
  setTimeout(() => node.classList.add("hidden"), 2200);
}

async function load() {
  try {
    const data = await api("/hub/api/overview");
    state.data = data;
    render();
  } catch (error) {
    document.querySelector("#app").innerHTML = `<section class="panel"><h2>Нет доступа</h2><p class="muted">${escapeHtml(error.message)}</p></section>`;
  }
}

function render() {
  document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  if (state.view === "overview") renderOverview();
  if (state.view === "bots") renderBots();
  if (state.view === "billing") renderBilling();
}

function renderOverview() {
  const summary = state.data.summary;
  const metrics = [
    ["Всего ботов", summary.total_bots],
    ["Активных", summary.active_bots],
    ["Отключено", summary.disabled_bots],
    ["Моя выручка", money(summary.expected_revenue)],
    ["Доход репетиторов", money(summary.tutor_income_month)],
    ["Просрочки", summary.overdue_payments],
    ["Ученики", summary.students_count],
    ["Уроки сегодня", summary.lessons_today],
    ["Уроки недели", summary.lessons_week],
  ];
  document.querySelector("#app").innerHTML = `
    <section class="grid">${metrics.map(([label, value]) => `<article class="metric"><span>${label}</span><b>${value}</b></article>`).join("")}</section>
    <section class="panel">
      <div class="panel-head"><h2>Боты</h2><button class="secondary" data-view="bots">Все боты</button></div>
      <div class="bot-list">${state.data.bots.slice(0, 6).map(botCard).join("") || empty("Подключенных ботов пока нет")}</div>
    </section>
  `;
}

function renderBots() {
  document.querySelector("#app").innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Подключенные CRM</h2><button class="primary" data-action="add-bot">Добавить</button></div>
      <div class="bot-list">${state.data.bots.map(botCard).join("") || empty("Подключенных ботов пока нет")}</div>
    </section>
  `;
}

function renderBilling() {
  const bots = state.data.bots;
  document.querySelector("#app").innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>Тарифы и оплаты</h2><span class="muted">${bots.length}</span></div>
      <div class="bot-list">
        ${bots.map((bot) => `
          <article class="bot-card">
            <div>
              <p class="bot-title">${escapeHtml(bot.tutor_name)}</p>
              <p class="bot-sub">@${escapeHtml(bot.bot_username)} · ${escapeHtml(bot.plan_name || "без тарифа")}</p>
            </div>
            <div class="stats-line"><span>${money(bot.plan_price)}</span><span>след. ${dateShort(bot.next_payment_at)}</span></div>
            <div class="bot-actions">
              <span class="status ${bot.payment_status}">${statusLabel(bot.payment_status)}</span>
              <button class="small" data-action="edit-bot" data-id="${bot.id}">Изменить</button>
            </div>
          </article>
        `).join("") || empty("Тарифов пока нет")}
      </div>
    </section>
  `;
}

function botCard(bot) {
  const stats = bot.stats || {};
  return `
    <article class="bot-card">
      <div>
        <p class="bot-title">${escapeHtml(bot.bot_name)} <span class="status ${bot.status}">${statusLabel(bot.status)}</span></p>
        <p class="bot-sub">@${escapeHtml(bot.bot_username)} · ${escapeHtml(bot.tutor_name)}</p>
        <p class="bot-sub">${escapeHtml(bot.plan_name || "без тарифа")} · след. платеж ${dateShort(bot.next_payment_at)}</p>
      </div>
      <div class="stats-line">
        <span>${money(stats.income_month)} мес.</span>
        <span>${stats.students_count || 0} учеников</span>
        <span>${stats.lessons_week || 0} уроков/нед</span>
      </div>
      <div class="bot-actions">
        <button class="small" data-action="bot-detail" data-id="${bot.id}">Статистика</button>
        ${bot.chat_url ? `<a class="small" href="${escapeHtml(bot.chat_url)}" target="_blank" rel="noopener">Чат</a>` : ""}
        <button class="small" data-action="botfather-link" data-id="${bot.id}">BotFather URL</button>
        <button class="small" data-action="set-menu-button" data-id="${bot.id}">Кнопка меню</button>
        <button class="small" data-action="set-status" data-status="active" data-id="${bot.id}">Вкл</button>
        <button class="small danger" data-action="set-status" data-status="disabled" data-id="${bot.id}">Выкл</button>
        <button class="small" data-action="edit-bot" data-id="${bot.id}">Тариф</button>
      </div>
    </article>
  `;
}

function empty(text) {
  return `<div class="metric"><span>${escapeHtml(text)}</span><b>—</b></div>`;
}

function openModal(html) {
  const modal = document.querySelector("#modal");
  modal.innerHTML = `<div class="modal-card">${html}</div>`;
  modal.classList.remove("hidden");
}

function closeModal() {
  document.querySelector("#modal").classList.add("hidden");
}

function addBotModal() {
  openModal(`
    <div class="modal-title"><h2>Добавить CRM-бота</h2><button class="secondary" data-action="close-modal">Закрыть</button></div>
    <form class="form" data-form="add-bot">
      ${field("bot_token", "API token", "", "password", true)}
      ${field("tutor_telegram_username", "Username админа", "", "text", true)}
      ${field("admin_telegram_id", "ID админа", "", "number", true)}
      ${field("tutor_name", "Имя репетитора", "", "text")}
      ${field("plan_name", "Тариф", "Старт", "text")}
      ${field("plan_price", "Цена тарифа", "3000", "number")}
      ${field("next_payment_at", "Следующий платеж", "", "date")}
      <label class="full"><span>Комментарий</span><textarea name="notes"></textarea></label>
      <button class="primary full" type="submit">Создать CRM-бота</button>
    </form>
  `);
}

function editBotModal(bot) {
  openModal(`
    <div class="modal-title"><h2>${escapeHtml(bot.tutor_name)}</h2><button class="secondary" data-action="close-modal">Закрыть</button></div>
    <form class="form" data-form="edit-bot" data-id="${bot.id}">
      ${field("tutor_name", "Имя репетитора", bot.tutor_name)}
      ${field("tutor_telegram_username", "Telegram username", bot.tutor_telegram_username)}
      ${field("plan_name", "Тариф", bot.plan_name)}
      ${field("plan_price", "Цена тарифа", bot.plan_price, "number")}
      ${field("last_payment_at", "Последняя оплата", bot.last_payment_at || "", "date")}
      ${field("next_payment_at", "Следующая оплата", bot.next_payment_at || "", "date")}
      <label><span>Статус оплаты</span><select name="payment_status">${["paid", "due_soon", "overdue", "unpaid"].map((item) => `<option value="${item}" ${bot.payment_status === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select></label>
      <label><span>Доступ</span><select name="status">${["active", "paused", "disabled", "overdue"].map((item) => `<option value="${item}" ${bot.status === item ? "selected" : ""}>${statusLabel(item)}</option>`).join("")}</select></label>
      ${field("database_path", "SQLite база", bot.database_path)}
      ${field("webapp_url", "WebApp URL", bot.webapp_url)}
      <label class="full"><span>Комментарий</span><textarea name="notes">${escapeHtml(bot.notes || "")}</textarea></label>
      <button class="primary full" type="submit">Сохранить с подтверждением</button>
    </form>
  `);
}

function detailModal(bot) {
  const s = bot.stats || {};
  const metrics = [
    ["Сегодня", money(s.income_today)],
    ["Неделя", money(s.income_week)],
    ["Месяц", money(s.income_month)],
    ["Ученики", s.students_count || 0],
    ["Уроки сегодня", s.lessons_today || 0],
    ["Уроки неделя", s.lessons_week || 0],
    ["Ожидается", money(s.expected_payments)],
    ["Долги", money(s.debts_amount)],
    ["Домашки", s.homework_count || 0],
  ];
  openModal(`
    <div class="modal-title"><h2>${escapeHtml(bot.bot_name)}</h2><button class="secondary" data-action="close-modal">Закрыть</button></div>
    <div class="grid">${metrics.map(([label, value]) => `<article class="metric"><span>${label}</span><b>${value}</b></article>`).join("")}</div>
    <div class="panel" style="margin-top:12px">
      <div class="row"><span class="muted">Статус</span><span class="status ${bot.status}">${statusLabel(bot.status)}</span></div>
      <div class="row"><span class="muted">Тариф</span><b>${escapeHtml(bot.plan_name || "без тарифа")} · ${money(bot.plan_price)}</b></div>
      <div class="row"><span class="muted">Следующий платеж</span><b>${dateShort(bot.next_payment_at)}</b></div>
      <div class="row"><span class="muted">Последняя активность</span><b>${dateShort(s.last_activity_at)}</b></div>
    </div>
  `);
}

function linksModal(payload) {
  const urls = payload.urls || [];
  openModal(`
    <div class="modal-title"><h2>${escapeHtml(payload.title || "Ссылка")}</h2><button class="secondary" data-action="close-modal">Закрыть</button></div>
    <div class="panel compact-panel">
      <p class="muted">${escapeHtml(payload.botfather_instruction || "Скопируй URL и вставь его в BotFather.")}</p>
      <label class="full"><span>Рекомендованный URL для BotFather</span><textarea readonly>${escapeHtml(payload.recommended_url || "")}</textarea></label>
      <button class="primary full" data-action="copy" data-value="${escapeHtml(payload.recommended_url || "")}">Скопировать рекомендованный URL</button>
    </div>
    <div class="bot-list links-list">
      ${urls.map((url, index) => `
        <article class="bot-card link-card">
          <div>
            <p class="bot-title">${index === urls.length - 1 ? "Резервный / без VPN" : "Основной"}</p>
            <p class="bot-sub">${escapeHtml(url)}</p>
          </div>
          <div class="bot-actions"><button class="small" data-action="copy" data-value="${escapeHtml(url)}">Копировать</button></div>
        </article>
      `).join("")}
    </div>
  `);
}

function field(name, label, value = "", type = "text", required = false) {
  return `<label><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}></label>`;
}

document.body.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.dataset.view) {
    state.view = target.dataset.view;
    render();
    return;
  }
  if (target.dataset.action === "refresh") {
    await load();
    toast("Обновлено");
  } else if (target.dataset.action === "add-bot") {
    addBotModal();
  } else if (target.dataset.action === "close-modal") {
    closeModal();
  } else if (target.dataset.action === "bot-detail") {
    const payload = await api(`/hub/api/bots/${target.dataset.id}`);
    detailModal(payload.bot);
  } else if (target.dataset.action === "edit-bot") {
    const bot = state.data.bots.find((item) => String(item.id) === String(target.dataset.id));
    if (bot) editBotModal(bot);
  } else if (target.dataset.action === "hub-botfather-link") {
    const payload = await api("/hub/api/hub-links");
    linksModal(payload);
  } else if (target.dataset.action === "botfather-link") {
    const payload = await api(`/hub/api/bots/${target.dataset.id}/botfather-links`);
    linksModal(payload);
  } else if (target.dataset.action === "set-menu-button") {
    await api(`/hub/api/bots/${target.dataset.id}/menu-button`, { method: "POST", body: "{}" });
    toast("Кнопка меню обновлена");
  } else if (target.dataset.action === "set-status") {
    const ok = target.dataset.status === "active" || confirm("Подтвердить изменение доступа?");
    if (!ok) return;
    await api(`/hub/api/bots/${target.dataset.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: target.dataset.status, confirm: true }),
    });
    await load();
    toast("Статус обновлен");
  } else if (target.dataset.action === "browser-link") {
    const payload = await api("/hub/api/browser-invites", { method: "POST", body: "{}" });
    openModal(`
      <div class="modal-title"><h2>Ссылка g0faq Hub</h2><button class="secondary" data-action="close-modal">Закрыть</button></div>
      <label class="full"><span>Постоянная ссылка</span><textarea readonly>${escapeHtml(payload.url)}</textarea></label>
      <button class="primary full" data-action="copy" data-value="${escapeHtml(payload.url)}">Скопировать</button>
    `);
  } else if (target.dataset.action === "copy") {
    await navigator.clipboard?.writeText(target.dataset.value || "");
    toast("Скопировано");
  }
});

document.body.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  for (const key of ["plan_price", "tutor_chat_id", "admin_telegram_id"]) {
    if (data[key] === "") delete data[key];
    else if (data[key] !== undefined) data[key] = Number(data[key]);
  }
  try {
    if (form.dataset.form === "add-bot") {
      await api("/hub/api/bots", { method: "POST", body: JSON.stringify(data) });
      closeModal();
      await load();
      toast("Бот добавлен");
    } else if (form.dataset.form === "edit-bot") {
      data.confirm = true;
      await api(`/hub/api/bots/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
      closeModal();
      await load();
      toast("Сохранено");
    }
  } catch (error) {
    toast(error.message);
  }
});

initTelegramWebApp();
load();
