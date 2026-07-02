const app = document.querySelector("#app");
const path = window.location.pathname;
let token = localStorage.getItem("crm_access") || "";
let currentWorkspace = Number(localStorage.getItem("crm_workspace") || "0");

const ru = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function headers() {
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Ошибка запроса");
  return data;
}

function setAuth(auth) {
  token = auth.access_token;
  localStorage.setItem("crm_access", token);
  if (auth.workspaces?.[0]) {
    currentWorkspace = auth.workspaces[0].id;
    localStorage.setItem("crm_workspace", String(currentWorkspace));
  }
}

function money(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function renderLanding() {
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="brand">CRM Tutor</div>
        <h1>CRM для репетиторов и онлайн-школ</h1>
        <p>Multi-tenant SaaS на crmtutor.ru: отдельные workspace, публичные страницы репетиторов, заявки, расписание, домашние задания, финансы, Telegram и Email OTP. SMS не используется.</p>
        <div class="actions">
          <button class="primary" id="create">Создать кабинет репетитора</button>
          <button class="secondary" id="demo">Открыть демо-кабинет</button>
        </div>
      </div>
    </section>
    <section class="main">
      <div class="grid">
        <div class="card"><strong>Free / Pro / School</strong><p>Тарифы, подписки и лимиты заложены в backend.</p></div>
        <div class="card"><strong>Изоляция данных</strong><p>Все CRM-данные привязаны к workspace_id.</p></div>
        <div class="card"><strong>Публичная запись</strong><p>Страница вида crmtutor.ru/username.</p></div>
        <div class="card"><strong>Mini App ready</strong><p>Единое API для сайта и Telegram Mini App.</p></div>
      </div>
    </section>
  `;
  document.querySelector("#create").onclick = renderRegister;
  document.querySelector("#demo").onclick = async () => {
    const requested = await api("/api/auth/email/request", { method: "POST", body: JSON.stringify({ email: "owner@crmtutor.ru" }) });
    const verified = await api("/api/auth/email/verify", { method: "POST", body: JSON.stringify({ email: "owner@crmtutor.ru", code: requested.dev_code }) });
    setAuth(verified);
    renderDashboard();
  };
}

function renderRegister() {
  app.innerHTML = `
    <div class="main">
      <div class="topbar">
        <div><h1>Создать кабинет репетитора</h1><p>После регистрации будет создан отдельный workspace и публичная страница.</p></div>
        <button class="secondary" id="back">Назад</button>
      </div>
      <form class="form" id="register">
        <input name="email" type="email" placeholder="Email для входа" required />
        <input name="first_name" placeholder="Имя" required />
        <input name="last_name" placeholder="Фамилия" />
        <input name="username" placeholder="username для crmtutor.ru/username" required />
        <input name="photo_url" placeholder="Ссылка на фото" />
        <textarea name="description" placeholder="Описание"></textarea>
        <input name="subjects" placeholder="Предметы через запятую" />
        <input name="directions" placeholder="Направления через запятую: ЕГЭ, ОГЭ, Олимпиады" />
        <input name="hourly_price" type="number" placeholder="Стоимость занятия" />
        <button class="primary">Создать кабинет репетитора</button>
      </form>
      <p id="status"></p>
    </div>
  `;
  document.querySelector("#back").onclick = renderLanding;
  document.querySelector("#register").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.subjects = String(payload.subjects || "").split(",").map((x) => x.trim()).filter(Boolean);
    payload.directions = String(payload.directions || "").split(",").map((x) => x.trim()).filter(Boolean);
    payload.hourly_price = Number(payload.hourly_price || 0);
    try {
      const data = await api("/api/tutors/register", { method: "POST", body: JSON.stringify(payload) });
      setAuth(data.auth);
      document.querySelector("#status").textContent = `Готово: ${data.public_url}`;
      renderDashboard();
    } catch (error) {
      document.querySelector("#status").textContent = error.message;
    }
  };
}

async function renderDashboard() {
  if (!currentWorkspace) return renderLanding();
  const payload = await api(`/api/workspaces/${currentWorkspace}/miniapp`);
  const admin = payload.admin;
  app.innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand">CRM Tutor</div>
        <nav class="nav">
          <button class="active" data-view="overview">Обзор</button>
          <button data-view="students">Ученики</button>
          <button data-view="calendar">Календарь</button>
          <button data-view="homeworks">Домашки</button>
          <button data-view="finances">Финансы</button>
          <button data-view="billing">Тариф</button>
        </nav>
      </aside>
      <section class="main" id="workspace-main"></section>
    </div>
  `;
  renderOverview(admin);
  document.querySelectorAll(".nav button").forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll(".nav button").forEach((item) => item.classList.toggle("active", item === button));
      if (button.dataset.view === "overview") renderOverview(admin);
      if (button.dataset.view === "students") renderStudents(admin);
      if (button.dataset.view === "calendar") renderCalendar(admin.calendar);
      if (button.dataset.view === "homeworks") renderHomeworks(admin);
      if (button.dataset.view === "finances") renderFinances(admin);
      if (button.dataset.view === "billing") renderBilling();
    };
  });
}

function main() {
  return document.querySelector("#workspace-main") || app.querySelector(".main");
}

function renderOverview(admin) {
  const openHomework = admin.homeworks.filter((item) => !["выполнено", "checked", "отменено"].includes(item.status)).length;
  main().innerHTML = `
    <div class="topbar"><h2>Главный экран CRM</h2><button class="primary" id="invite">Пригласить</button></div>
    <div class="grid">
      <div class="card"><div class="metric">${admin.summary.students}</div><div class="muted">учеников</div></div>
      <div class="card"><div class="metric">${admin.summary.week_lessons}</div><div class="muted">занятий за неделю</div></div>
      <div class="card"><div class="metric">${money(admin.summary.expected_week)}</div><div class="muted">ожидается за неделю</div></div>
      <div class="card"><div class="metric">${money(admin.summary.expected_month)}</div><div class="muted">ожидается за месяц</div></div>
    </div>
    <div class="grid">
      <button class="card action-card" data-quick="student"><strong>Добавить ученика</strong><span class="muted">анкета, контакты, ссылки</span></button>
      <button class="card action-card" data-quick="lesson"><strong>Добавить урок</strong><span class="muted">история занятий</span></button>
      <button class="card action-card" data-quick="homework"><strong>Создать ДЗ</strong><span class="muted">текст, файлы, ссылки</span></button>
      <button class="card action-card" data-quick="payment"><strong>Добавить оплату</strong><span class="muted">баланс и журнал</span></button>
    </div>
    <div class="section panel">
      <h2>Требуют внимания</h2>
      <div class="grid">
        <div class="card"><div class="metric">${admin.finances.unpaid_lessons.length}</div><div class="muted">неоплаченных занятий</div></div>
        <div class="card"><div class="metric">${openHomework}</div><div class="muted">открытых домашних заданий</div></div>
        <div class="card"><div class="metric">${admin.pending_lessons.length}</div><div class="muted">заявок на урок</div></div>
        <div class="card"><div class="metric">${admin.finances.pending.length}</div><div class="muted">платежей на проверке</div></div>
      </div>
    </div>
    <div class="section panel">
      <h2>Ближайшие занятия</h2>
      <div class="list">${admin.calendar.slice(0, 8).map((x) => `<div class="row"><span>${ru.format(new Date(x.starts_at))}<br><small class="muted">${x.student_name || ""} · ${x.status}</small></span><strong>${money(x.price)}</strong></div>`).join("") || "<p>Пока нет занятий</p>"}</div>
    </div>
  `;
  document.querySelector("#invite").onclick = async () => {
    const invite = await api(`/api/workspaces/${currentWorkspace}/invites`, { method: "POST", body: JSON.stringify({ role: "student" }) });
    alert(invite.url);
  };
  document.querySelector("[data-quick='student']").onclick = addStudentPrompt;
  document.querySelector("[data-quick='homework']").onclick = () => renderHomeworks(admin);
  document.querySelector("[data-quick='payment']").onclick = () => renderFinances(admin);
  document.querySelector("[data-quick='lesson']").onclick = () => renderCalendar(admin.calendar);
}

function renderStudents(admin) {
  main().innerHTML = `
    <div class="topbar"><h2>Ученики</h2><button class="primary" id="add-student">Добавить</button></div>
    <div class="student-layout">
      <div class="list">${admin.students.map((x) => `<button class="row student-row" data-student="${x.id}"><span><strong>${x.name}</strong><br><small class="muted">${x.grade || "—"} · ${x.preparationType || "подготовка"} · ${x.subject || "предмет"}</small></span><strong>${x.balance_lessons} зан.</strong></button>`).join("") || "<p>Список пуст</p>"}</div>
      <div id="student-detail"></div>
    </div>
  `;
  document.querySelector("#add-student").onclick = addStudentPrompt;
  document.querySelectorAll("[data-student]").forEach((button) => {
    button.onclick = () => renderStudentDetail(Number(button.dataset.student));
  });
}

async function addStudentPrompt() {
  const target = main();
  target.insertAdjacentHTML("afterbegin", `
    <form class="form inline-create" id="student-create">
      <input name="full_name" placeholder="Имя ученика" required />
      <input name="grade" placeholder="Класс" />
      <input name="subject" placeholder="Предмет" />
      <input name="prep_type" placeholder="Подготовка: ЕГЭ, ОГЭ, Олимпиады" />
      <button class="primary">Добавить ученика</button>
    </form>
  `);
  document.querySelector("#student-create").onsubmit = async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api(`/api/workspaces/${currentWorkspace}/students`, { method: "POST", body: JSON.stringify(payload) });
    renderDashboard();
  };
}

async function renderStudentDetail(studentId) {
  const data = await api(`/api/workspaces/${currentWorkspace}/students/${studentId}`);
  const s = data.student;
  const detail = document.querySelector("#student-detail") || main();
  detail.innerHTML = `
    <section class="card detail-card">
      <div class="topbar">
        <div><h2>${s.name}</h2><p>${s.grade || "—"} · ${s.preparationType || "подготовка"} · ${s.subject || "предмет не указан"}</p></div>
        <button class="secondary" id="save-student">Сохранить</button>
      </div>
      <div class="detail-grid">
        <label>Цель<input id="goal" value="${escapeAttr(s.goal || "")}" /></label>
        <label>Уровень<input id="level" value="${escapeAttr(s.current_level || "")}" /></label>
        <label>Цена 60<input id="price" type="number" value="${Number(s.price_60 || s.lesson_price || 0)}" /></label>
        <label>Баланс занятий<input id="balance" type="number" value="${Number(s.balance_lessons || 0)}" /></label>
        <label>Доска<input id="board" value="${escapeAttr(s.links?.board || "")}" /></label>
        <label>Звонок<input id="meeting" value="${escapeAttr(s.links?.meeting || "")}" /></label>
      </div>
      <label>Заметки<textarea id="comment">${escapeHtml(s.notes || "")}</textarea></label>
      <div class="grid">
        <div class="card"><div class="metric">${data.summary.progress_percent ?? 0}%</div><div class="muted">прогресс</div></div>
        <div class="card"><div class="metric">${data.lessons.length}</div><div class="muted">занятий в истории</div></div>
        <div class="card"><div class="metric">${data.homeworks.length}</div><div class="muted">домашних заданий</div></div>
        <div class="card"><div class="metric">${data.payments.length}</div><div class="muted">оплат</div></div>
      </div>
      <div class="section panel"><h2>Подготовка ЕГЭ/ОГЭ и статистика заданий</h2>${renderTopics(data.topics, studentId)}</div>
      <div class="section panel"><h2>План подготовки</h2>${renderPlan(data.plan, studentId)}</div>
      <div class="section panel"><h2>История занятий</h2><div class="list">${data.lessons.map((x) => `<div class="row"><span>${ru.format(new Date(x.starts_at))}<br><small class="muted">${x.status} · ${x.notes || ""}</small></span><strong>${money(x.price)}</strong></div>`).join("") || "<p>Нет занятий</p>"}</div></div>
      <div class="section panel"><h2>Домашние задания</h2><div class="list">${data.homeworks.map((x) => `<div class="row"><span>${x.title}<br><small class="muted">${x.status} · ${x.teacher_comment || ""}</small></span><strong>${x.deadline ? ru.format(new Date(x.deadline)) : ""}</strong></div>`).join("") || "<p>Нет ДЗ</p>"}</div></div>
      <div class="section panel"><h2>Финансы</h2><div class="list">${data.payments.map((x) => `<div class="row"><span>${x.comment || "Оплата"}<br><small class="muted">${x.status}</small></span><strong>${money(x.amount)} · ${x.lessons_count} зан.</strong></div>`).join("") || "<p>Нет оплат</p>"}</div></div>
    </section>
  `;
  document.querySelector("#save-student").onclick = async () => {
    await api(`/api/workspaces/${currentWorkspace}/students/${studentId}`, {
      method: "PATCH",
      body: JSON.stringify({
        goal: document.querySelector("#goal").value,
        current_level: document.querySelector("#level").value,
        price_60: Number(document.querySelector("#price").value || 0),
        lesson_price: Number(document.querySelector("#price").value || 0),
        balance_lessons: Number(document.querySelector("#balance").value || 0),
        board_url: document.querySelector("#board").value,
        meeting_url: document.querySelector("#meeting").value,
        comment: document.querySelector("#comment").value,
      }),
    });
    renderStudentDetail(studentId);
  };
  document.querySelector("#add-topic")?.addEventListener("click", async () => {
    const task = prompt("Номер задания или тема");
    if (!task) return;
    const level = Number(prompt("Уровень знания 0-10", "7") || 0);
    const isNumber = /^\d+$/.test(task);
    await api(`/api/workspaces/${currentWorkspace}/students/${studentId}/progress`, {
      method: "PATCH",
      body: JSON.stringify(isNumber ? { task_number: Number(task), knowledge_level: level } : { title: task, knowledge_level: level }),
    });
    renderStudentDetail(studentId);
  });
  document.querySelector("#add-plan")?.addEventListener("click", async () => {
    const title = prompt("Пункт плана подготовки");
    if (!title) return;
    await api(`/api/workspaces/${currentWorkspace}/students/${studentId}/plan`, { method: "POST", body: JSON.stringify({ title }) });
    renderStudentDetail(studentId);
  });
}

function renderTopics(topics, studentId) {
  return `<button class="secondary" id="add-topic">Добавить тему</button><div class="list">${topics.map((x) => `<div class="row"><span>${x.title}<br><small class="muted">${x.status} · ${x.comment || ""}</small></span><strong>${x.knowledge_level}/10</strong></div>`).join("") || "<p>Статистика заданий пока пустая</p>"}</div>`;
}

function renderPlan(plan, studentId) {
  return `<button class="secondary" id="add-plan">Добавить пункт</button><div class="list">${plan.map((x) => `<div class="row"><span>${x.title}<br><small class="muted">${x.status} · ${x.comment || ""}</small></span><strong>${x.deadline || ""}</strong></div>`).join("") || "<p>План подготовки пока пуст</p>"}</div>`;
}

function renderCalendar(lessons = []) {
  const times = [];
  for (let h = 8; h <= 22; h += 1) {
    times.push(`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`);
  }
  main().innerHTML = `
    <div class="topbar"><h2>Календарь</h2><span class="muted">Сетка 30 минут</span></div>
    <div class="list">${lessons.slice(0, 12).map((x) => `<div class="row"><span>${ru.format(new Date(x.starts_at))}<br><small class="muted">${x.student_name || ""} · ${x.status}</small></span><strong>${money(x.price)}</strong></div>`).join("")}</div>
    <div class="calendar">
      <div class="time"></div>${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => `<div class="day"><strong>${d}</strong></div>`).join("")}
      ${times.map((time) => `<div class="time">${time}</div>${Array.from({ length: 7 }, (_, i) => `<div class="day ${i === 0 && lessons.some((x) => String(x.starts_at).includes(time)) ? "lesson" : ""}">${i === 0 && lessons.some((x) => String(x.starts_at).includes(time)) ? "Занятие" : ""}</div>`).join("")}`).join("")}
    </div>
  `;
}

function renderHomeworks(admin) {
  main().innerHTML = `
    <div class="topbar"><h2>Домашние задания</h2><button class="primary" id="add-homework">Выдать ДЗ</button></div>
    <div class="list">${admin.homeworks.map((x) => `<div class="row"><span><strong>${x.title}</strong><br><small class="muted">${x.student_name} · ${x.status} · ${x.text}</small></span><strong>${x.deadline ? ru.format(new Date(x.deadline)) : ""}</strong></div>`).join("") || "<p>Домашних заданий пока нет</p>"}</div>
  `;
  document.querySelector("#add-homework").onclick = async () => {
    main().insertAdjacentHTML("afterbegin", `
      <form class="form inline-create" id="homework-create">
        <input name="student_id" type="number" placeholder="ID ученика" required />
        <input name="title" placeholder="Название" />
        <textarea name="text" placeholder="Текст ДЗ" required></textarea>
        <input name="links" placeholder="Ссылки через запятую" />
        <button class="primary">Выдать ДЗ</button>
      </form>
    `);
    document.querySelector("#homework-create").onsubmit = async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      payload.student_id = Number(payload.student_id);
      payload.links = String(payload.links || "").split(",").map((item) => item.trim()).filter(Boolean);
      payload.status = "ожидание выполнения";
      await api(`/api/workspaces/${currentWorkspace}/homeworks`, { method: "POST", body: JSON.stringify(payload) });
      renderDashboard();
    };
  };
}

function renderFinances(admin) {
  main().innerHTML = `
    <div class="topbar"><h2>Финансы</h2><button class="primary" id="add-payment">Добавить оплату</button></div>
    <div class="grid">
      <div class="card"><div class="metric">${money(admin.finances.expected_week)}</div><div class="muted">ожидается за неделю</div></div>
      <div class="card"><div class="metric">${money(admin.finances.expected_month)}</div><div class="muted">ожидается за месяц</div></div>
      <div class="card"><div class="metric">${money(admin.finances.month_income)}</div><div class="muted">доход месяца</div></div>
      <div class="card"><div class="metric">${admin.finances.unpaid_lessons.length}</div><div class="muted">неоплаченных занятий</div></div>
    </div>
    <div class="section panel"><h2>Журнал операций</h2><div class="list">${admin.finances.payments.map((x) => `<div class="row"><span>${x.student_name}<br><small class="muted">${x.comment || "Оплата"} · ${x.status}</small></span><strong>${money(x.amount)} · ${x.lessons_count} зан.</strong></div>`).join("") || "<p>Операций пока нет</p>"}</div></div>
    <div class="section panel"><h2>Неоплаченные занятия</h2><div class="list">${admin.finances.unpaid_lessons.map((x) => `<div class="row"><span>${x.student_name}<br><small class="muted">${ru.format(new Date(x.starts_at))}</small></span><strong>${money(x.price)}</strong></div>`).join("") || "<p>Долгов нет</p>"}</div></div>
  `;
  document.querySelector("#add-payment").onclick = async () => {
    main().insertAdjacentHTML("afterbegin", `
      <form class="form inline-create" id="payment-create">
        <input name="student_id" type="number" placeholder="ID ученика" required />
        <input name="amount" type="number" placeholder="Сумма" />
        <input name="lessons_count" type="number" placeholder="Количество занятий" />
        <input name="comment" placeholder="Комментарий" />
        <button class="primary">Добавить оплату</button>
      </form>
    `);
    document.querySelector("#payment-create").onsubmit = async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      payload.student_id = Number(payload.student_id);
      payload.amount = Number(payload.amount || 0);
      payload.lessons_count = Number(payload.lessons_count || 0);
      payload.status = "confirmed";
      await api(`/api/workspaces/${currentWorkspace}/payments`, { method: "POST", body: JSON.stringify(payload) });
      renderDashboard();
    };
  };
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

async function renderBilling() {
  const data = await api("/api/plans");
  app.querySelector(".main").innerHTML = `
    <div class="topbar"><h2>Тарифы и подписка</h2><span class="muted">Free / Pro / School</span></div>
    <div class="grid">${data.plans.map((plan) => `<div class="card"><h2>${plan.name}</h2><p>${money(plan.monthly_price)} / месяц</p><p>Ученики: ${plan.limits.students}, преподаватели: ${plan.limits.teachers}</p><button class="secondary" data-plan="${plan.code}">Выбрать</button></div>`).join("")}</div>
  `;
  document.querySelectorAll("[data-plan]").forEach((button) => {
    button.onclick = async () => {
      await api(`/api/workspaces/${currentWorkspace}/billing/plan`, { method: "POST", body: JSON.stringify({ plan_code: button.dataset.plan }) });
      alert("Тариф обновлен");
    };
  });
}

async function renderPublic(username) {
  const data = await api(`/api/public/tutors/${username}`);
  const p = data.profile;
  app.innerHTML = `
    <section class="public">
      <div class="profile">
        <img class="avatar" src="${p.photo_url || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80"}" alt="" />
        <div>
          <h1>${p.first_name} ${p.last_name || ""}</h1>
          <p>${p.description || "Репетитор CRM Tutor"}</p>
          <p><strong>${money(p.hourly_price)}</strong></p>
          <p>${p.subjects.join(", ")}</p>
          <p>${p.directions.join(", ")}</p>
        </div>
      </div>
      <form class="form" id="application">
        <h2>Записаться</h2>
        <input name="student_name" placeholder="Имя ученика" required />
        <input name="contact" placeholder="Telegram или email" required />
        <input name="selected_slot" placeholder="Желаемое время" />
        <textarea name="comment" placeholder="Комментарий"></textarea>
        <button class="primary">Отправить заявку</button>
      </form>
      <p id="status"></p>
    </section>
  `;
  document.querySelector("#application").onsubmit = async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api(`/api/public/tutors/${username}/applications`, { method: "POST", body: JSON.stringify(payload) });
    document.querySelector("#status").textContent = "Заявка отправлена репетитору и появилась в CRM.";
    event.currentTarget.reset();
  };
}

if (path.startsWith("/tutor/")) {
  renderPublic(path.split("/").pop());
} else if (path !== "/" && !path.startsWith("/api") && !path.startsWith("/static")) {
  renderPublic(path.slice(1));
} else if (token && currentWorkspace) {
  renderDashboard().catch(renderLanding);
} else {
  renderLanding();
}
