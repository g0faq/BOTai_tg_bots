const tg = window.Telegram?.WebApp;
const params = new URLSearchParams(window.location.search);

const state = {
  payload: null,
  activeView: "overview",
  selectedStudentId: null,
  editingStudent: false,
  editingSelf: false,
  showCalendarArchive: false,
  filterPayment: "",
  filterHomework: "",
  studentSearch: "",
  studentPrepFilter: "",
  studentSort: "next",
  devUserId: params.get("dev_id") || localStorage.getItem("tgDevUserId") || "",
  slotTarget: null,
  globalHandlersAttached: false,
  publicConfig: null,
  onboardingRole: "",
  onboardingPlan: "",
};

const app = document.querySelector("#app");
const tabbar = document.querySelector("#tabbar");
const refreshButton = document.querySelector("#refresh-button");
const profileButton = document.querySelector("#profile-button");
const screenTitle = document.querySelector("#screen-title");

function syncTelegramViewportState() {
  document.body.classList.toggle("tg-webapp", Boolean(tg));
  document.body.classList.toggle("tg-fullscreen", Boolean(tg?.isFullscreen));
  const safeTop = Number(tg?.safeAreaInset?.top || 0);
  const contentSafeTop = Number(tg?.contentSafeAreaInset?.top || 0);
  document.documentElement.style.setProperty("--tg-safe-area-inset-top", `${safeTop}px`);
  document.documentElement.style.setProperty("--tg-content-safe-area-inset-top", `${contentSafeTop}px`);
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
    tg.setHeaderColor?.("#0b0b0f");
    tg.setBackgroundColor?.("#0b0b0f");
    tg.setBottomBarColor?.("#0b0b0f");
    disableTelegramVerticalSwipes();
    tg.onEvent?.("fullscreenChanged", () => {
      syncTelegramViewportState();
      disableTelegramVerticalSwipes();
      console.log("Telegram fullscreen changed:", tg.isFullscreen);
    });
    tg.onEvent?.("safeAreaChanged", syncTelegramViewportState);
    tg.onEvent?.("contentSafeAreaChanged", syncTelegramViewportState);
    tg.onEvent?.("fullscreenFailed", (event) => {
      syncTelegramViewportState();
      console.log("Telegram fullscreen failed:", event);
    });
    if (typeof tg.requestFullscreen === "function") {
      try {
        tg.requestFullscreen();
      } catch (error) {
        console.log("Telegram fullscreen request error:", error);
      }
    } else {
      console.log("Telegram fullscreen request unavailable");
    }
    syncTelegramViewportState();
  } catch (error) {
    console.log("Telegram WebApp init failed:", error);
  }
}

const tutorTabs = [
  ["overview", "Обзор", "grid"],
  ["students", "Ученики", "users"],
  ["calendar", "Календарь", "calendar"],
  ["homeworks", "Домашки", "book"],
  ["finances", "Финансы", "wallet"],
];

const clientTabs = [
  ["overview", "Обзор", "grid"],
  ["calendar", "Календарь", "calendar"],
  ["homeworks", "Домашки", "book"],
  ["progress", "Прогресс", "chart"],
  ["finances", "Оплаты", "wallet"],
  ["profile", "Профиль", "user"],
];

const lessonStatuses = ["ожидает подтверждения", "запланировано", "проведено", "отменено", "перенесено"];
const paymentStatuses = ["не отмечено", "ученик отметил оплату", "родитель отметил оплату", "подтверждено репетитором", "не оплачено"];
const homeworkStatuses = ["ожидание выполнения", "выполнено", "отменено"];
const prepTypes = ["ЕГЭ", "ОГЭ", "Python", "школьная успеваемость", "другое"];
const subjectOptions = ["Математика", "Информатика", "Физика", "Русский язык", "Английский язык", "Химия", "Биология", "История", "Обществознание"];
const directionOptions = ["ЕГЭ", "ОГЭ", "Олимпиады", "Школьная программа", "ВПР", "ДВИ", "Университетские дисциплины"];
const timezoneSelectOptions = [
  ["Europe/Kaliningrad", "Калининград · UTC+2"],
  ["Europe/Moscow", "Москва · UTC+3"],
  ["Europe/Samara", "Самара · UTC+4"],
  ["Asia/Yekaterinburg", "Екатеринбург · UTC+5"],
  ["Asia/Omsk", "Омск · UTC+6"],
  ["Asia/Krasnoyarsk", "Красноярск · UTC+7"],
  ["Asia/Irkutsk", "Иркутск · UTC+8"],
  ["Asia/Yakutsk", "Якутск · UTC+9"],
  ["Asia/Vladivostok", "Владивосток · UTC+10"],
];
const planOptions = {
  standart: { title: "Standart", price: "3 000 ₽", note: "До 40 учеников, один преподаватель, база для частного репетитора" },
  pro: { title: "Pro", price: "6 000 ₽", note: "До 150 учеников, команда до 5 преподавателей, расширенный запас" },
  school: { title: "School", price: "10 000 ₽", note: "Онлайн-школа, преподаватели, масштаб и white label-подготовка" },
};
const timezoneOptions = Array.from({ length: 12 }, (_, index) => index - 2).map((offset) => `МСК${offset >= 0 ? "+" : ""}${offset}`);
const weekdays = [
  [1, "Понедельник"],
  [2, "Вторник"],
  [3, "Среда"],
  [4, "Четверг"],
  [5, "Пятница"],
  [6, "Суббота"],
  [7, "Воскресенье"],
];

function headers() {
  const result = {};
  const accessToken = localStorage.getItem("crm_access") || "";
  if (accessToken) result.Authorization = `Bearer ${accessToken}`;
  if (tg?.initData) result["X-Telegram-Init-Data"] = tg.initData;
  if (!tg?.initData && state.devUserId) result["X-Dev-Telegram-Id"] = state.devUserId;
  return result;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers(),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.detail || "Ошибка запроса";
    const message = typeof detail === "object" && !Array.isArray(detail)
      ? detail.message || "Ошибка запроса"
      : Array.isArray(detail)
        ? detail.join("\n")
        : detail;
    const error = new Error(message);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return response.json();
}

async function loadPublicConfig() {
  if (state.publicConfig) return state.publicConfig;
  state.publicConfig = await api("/api/config").catch(() => ({
    public_base_url: window.location.origin,
    telegram_bot_username: "crmtutor_bot",
    sms: "disabled",
  }));
  return state.publicConfig;
}

function storeAuth(result, email = "") {
  const auth = result.auth || result;
  if (!auth?.access_token) return;
  localStorage.setItem("crm_access", auth.access_token);
  if (auth.refresh_token) localStorage.setItem("crm_refresh", auth.refresh_token);
  if (email) localStorage.setItem("crm_email", email);
  if (auth.workspaces?.[0]) localStorage.setItem("crm_workspace", String(auth.workspaces[0].id));
}

function money(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function formatDate(value) {
  if (!value) return "нет";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "нет";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isTutorView() {
  return state.payload?.role === "tutor";
}

function lessonStart(lesson) {
  if (!lesson) return "";
  return isTutorView()
    ? lesson.teacher_starts_at || lesson.starts_at
    : lesson.student_starts_at || lesson.starts_at;
}

function lessonEnd(lesson) {
  if (!lesson) return "";
  return isTutorView()
    ? lesson.teacher_ends_at || lesson.ends_at
    : lesson.student_ends_at || lesson.ends_at;
}

function slotStart(slot) {
  if (!slot) return "";
  return isTutorView()
    ? slot.teacher_starts_at || slot.starts_at
    : slot.student_starts_at || slot.starts_at;
}

function formatRelativeLesson(value) {
  if (!value) return "нет";
  const date = new Date(value);
  const now = new Date();
  const today = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const prefix = date.toDateString() === today ? "сегодня" : date.toDateString() === tomorrow.toDateString() ? "завтра" : formatDate(value);
  return `${prefix} ${formatTime(value)}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function datePartsInZone(date, timeZone = "Europe/Moscow") {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function isoWeekdayFromYmd(year, month, day) {
  const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function toMoscowDateTimeLocal(value) {
  if (!value) return value;
  const parts = datePartsInZone(new Date(value), "Europe/Moscow");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function nextLocalDateForWeekday(isoWeekday) {
  const date = new Date();
  const current = date.getDay() || 7;
  const delta = (Number(isoWeekday) - current + 7) % 7;
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

function defaultDateTimeLocal(hour = 18) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

function defaultLessonDuration(studentId = null) {
  const student =
    (studentId && state.payload?.admin?.students?.find((item) => item.id === Number(studentId))) ||
    (state.selectedStudentId && state.payload?.admin?.students?.find((item) => item.id === Number(state.selectedStudentId))) ||
    state.payload?.dashboard?.student ||
    state.payload?.admin?.students?.[0];
  return Number(student?.lesson_duration_minutes || 60);
}

function localScheduleSlotToMoscow(slot) {
  const localDate = nextLocalDateForWeekday(slot.weekday);
  const parts = datePartsInZone(new Date(`${localDate}T${slot.lesson_time}`), "Europe/Moscow");
  return {
    weekday: isoWeekdayFromYmd(parts.year, parts.month, parts.day),
    lesson_time: `${parts.hour}:${parts.minute}`,
  };
}

function weekdayTitle(value) {
  const date = new Date(value);
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date).toUpperCase();
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date).toUpperCase();
  return `${weekday}, ${day}`;
}

function haptic() {
  tg?.HapticFeedback?.impactOccurred?.("light");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const iconPaths = {
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V5H6.5A2.5 2.5 0 0 0 4 7.5z"/><path d="M4 7.5v12"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h13"/><path d="M16 12h6v4h-6a2 2 0 0 1 0-4z"/>',
  edit: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 7.5l3 3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  move: '<path d="M5 9h11a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H8M9 5 5 9l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};

function icon(name) {
  return `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24">${iconPaths[name] || iconPaths.grid}</svg>`;
}

function iconLabel(name, label) {
  return `${icon(name)}<span>${escapeHtml(label)}</span>`;
}

function statusClass(value) {
  if (!value) return "muted";
  if (value.includes("подтверж") || value.includes("выполн") || value.includes("провед")) return "ok";
  if (value.includes("ожида") || value.includes("отметил") || value.includes("перенес")) return "warn";
  if (value.includes("не оплач") || value.includes("отмен") || value.includes("исправ")) return "bad";
  return "muted";
}

function pill(value) {
  return `<span class="status ${statusClass(value)}">${escapeHtml(value || "не задано")}</span>`;
}

function emptyState(title, text) {
  return `
    <div class="empty-state">
      <div class="empty-mark"></div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function skeleton() {
  return `
    <section class="skeleton-stack">
      <div class="skeleton hero-skeleton"></div>
      <div class="skeleton-row"><div class="skeleton"></div><div class="skeleton"></div></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
    </section>
  `;
}

function setView(view) {
  state.activeView = view;
  app.querySelectorAll("[data-view]").forEach((node) => {
    node.hidden = node.dataset.view !== view;
  });
  tabbar.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  profileButton?.classList.toggle("active", view === "profile");
  closeFabMenu();
}

function updateProfileButton(payload) {
  if (!profileButton) return;
  profileButton.disabled = true;
  profileButton.title = "BOTай CRM";
  profileButton.setAttribute("aria-label", "BOTай CRM");
  profileButton.textContent = "Б";
}

function renderTabs(tabs) {
  tabbar.replaceChildren();
  for (const [view, label, iconName] of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = view;
    button.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
    button.addEventListener("click", () => {
      haptic();
      setView(view);
    });
    tabbar.append(button);
  }
}

function studentById(id) {
  return state.payload?.admin?.students?.find((student) => student.id === id);
}

function lessonsForStudent(id) {
  const source = state.payload?.admin?.calendar || state.payload?.dashboard?.lessons || [];
  return source.filter((lesson) => lesson.student_id === id);
}

function homeworksForStudent(id) {
  const source = state.payload?.admin?.homeworks || state.payload?.dashboard?.homeworks || [];
  return source.filter((homework) => homework.student_id === id);
}

function topicsForStudent(id) {
  if (state.payload?.admin?.topics_by_student) return state.payload.admin.topics_by_student[id] || [];
  return state.payload?.dashboard?.topics || [];
}

function planForStudent(id) {
  if (state.payload?.admin?.plan_by_student) return state.payload.admin.plan_by_student[id] || [];
  return state.payload?.dashboard?.plan || [];
}

function isSameDay(value, date = new Date()) {
  const item = new Date(value);
  return item.getFullYear() === date.getFullYear() && item.getMonth() === date.getMonth() && item.getDate() === date.getDate();
}

function visibleLessons() {
  return state.payload?.admin?.calendar || [];
}

function nextLessonForStudent(studentId) {
  const now = new Date();
  return visibleLessons()
    .filter((lesson) => lesson.student_id === studentId && !String(lesson.status).includes("отмен") && new Date(lessonStart(lesson)) >= now)
    .sort((a, b) => new Date(lessonStart(a)) - new Date(lessonStart(b)))[0];
}

function studentPaymentState(studentId) {
  const lessons = visibleLessons().filter((lesson) => lesson.student_id === studentId);
  const unpaid = lessons.some((lesson) => lesson.payment_status === "не оплачено" || (lesson.status === "проведено" && lesson.payment_status === "не отмечено"));
  const pending = lessons.some((lesson) => String(lesson.payment_status).includes("отметил"));
  if (unpaid) return ["bad", "долг"];
  if (pending) return ["warn", "проверка"];
  return ["ok", "ок"];
}

function renderOverviewTutor(admin) {
  const next = admin.summary.next_lesson;
  const problems = admin.summary.problem_students || [];
  const todayLessons = (admin.calendar || []).filter((lesson) => isSameDay(lesson.starts_at) && !String(lesson.status).includes("отмен"));
  const cancelledToday = (admin.calendar || []).filter((lesson) => isSameDay(lesson.starts_at) && String(lesson.status).includes("отмен"));
  const expectedTodayIncome = todayLessons.reduce((sum, lesson) => sum + Number(lesson.price || 0), 0);
  const unpaidCount = admin.finances?.unpaid_lessons?.length || 0;
  const openHomework = (admin.homeworks || []).filter((item) => !["выполнено", "отменено"].includes(item.status)).length;
  return `
    <section class="dashboard-top" data-view="overview">
      <button class="top-stat" data-action="go-view" data-view-target="calendar"><span>Уроков</span><strong>${todayLessons.length}</strong></button>
      <button class="top-stat" data-action="go-view" data-view-target="finances"><span>Ожидаемо</span><strong>${money(expectedTodayIncome)}</strong></button>
      <button class="top-stat" data-action="go-view" data-view-target="finances"><span>Получено</span><strong>${money(admin.summary.today_income || 0)}</strong></button>
      <button class="top-stat" data-action="go-view" data-view-target="homeworks"><span>Домашки</span><strong>${openHomework}</strong></button>
      <button class="top-stat wide" data-action="go-view" data-view-target="calendar"><span>Ближайший урок</span><strong>${next ? `${formatTime(lessonStart(next))} · ${escapeHtml(next.student_name)}` : "нет"}</strong></button>
    </section>

    <section class="metric-grid compact kpi-grid" data-view="overview">
      <button class="metric metric-button" data-action="go-view" data-view-target="students"><span>Ученики</span><strong>${admin.summary.students}</strong></button>
      <button class="metric metric-button" data-action="go-view" data-view-target="finances"><span>Не оплачено</span><strong>${unpaidCount}</strong></button>
      <button class="metric metric-button" data-action="go-view" data-view-target="finances"><span>Доход месяца</span><strong>${money(admin.summary.month_income)}</strong></button>
      <button class="metric metric-button" data-action="go-view" data-view-target="calendar"><span>Уроков неделя</span><strong>${admin.summary.week_lessons}</strong></button>
    </section>

    <section class="panel admin-quick-panel" data-view="overview">
      <div class="section-head compact-head"><h2>Быстрые действия</h2><span>на каждый день</span></div>
      <div class="admin-quick-grid">
        <button data-action="quick-lesson">${iconLabel("calendar", "Добавить урок")}</button>
        <button data-action="quick-homework">${iconLabel("book", "Создать домашку")}</button>
        <button data-action="quick-student">${iconLabel("users", "Добавить ученика")}</button>
        <button data-action="quick-payment">${iconLabel("wallet", "Добавить оплату")}</button>
      </div>
    </section>

    ${renderPendingLessons(admin)}

    <section class="panel dense-panel" data-view="overview" id="pending-lessons-panel">
      <div class="section-head compact-head"><h2>Требуют внимания</h2><span>${unpaidCount + openHomework + cancelledToday.length}</span></div>
      <div class="attention-grid">
        <button class="attention-item bad" data-action="go-view" data-view-target="finances"><span>Неоплаченные уроки</span><strong>${unpaidCount}</strong></button>
        <button class="attention-item warn" data-action="go-view" data-view-target="homeworks"><span>Невыполненные ДЗ</span><strong>${openHomework}</strong></button>
        <button class="attention-item muted" data-action="go-view" data-view-target="calendar"><span>Отмены сегодня</span><strong>${cancelledToday.length}</strong></button>
      </div>
    </section>
  `;
}

function renderPendingLessons(admin) {
  const lessons = admin.pending_lessons || [];
  return `
    <section class="panel" data-view="overview">
      <div class="section-head">
        <h2>Ждут подтверждения</h2>
        <span>${lessons.length || "нет заявок"}</span>
      </div>
      ${
        lessons.length
          ? renderCalendarList(lessons, true)
          : emptyState("Новых записей нет", "Когда ученик или родитель запишется на урок, заявка появится здесь.")
      }
    </section>
  `;
}

function renderCompactLessonList(lessons) {
  return `
    <div class="compact-lessons">
      ${lessons
        .map(
          (lesson) => `
            <button class="compact-lesson ${statusClass(lesson.status)}" data-action="edit-lesson" data-id="${lesson.id}">
              <time>${formatTime(lessonStart(lesson))}</time>
              <strong>${escapeHtml(lesson.student_name || "Занятие")}</strong>
              <span>${lesson.duration_minutes} мин · ${money(lesson.price)}</span>
              ${pill(lesson.payment_label || lesson.payment_status)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderStudents(admin) {
  const query = state.studentSearch.trim().toLowerCase();
  let students = admin.students.filter((student) => {
    const text = `${student.name} ${student.grade} ${student.preparationType} ${student.subject}`.toLowerCase();
    const byQuery = !query || text.includes(query);
    const byPrep = !state.studentPrepFilter || student.preparationType === state.studentPrepFilter;
    return byQuery && byPrep;
  });
  students = students.sort((a, b) => {
    if (state.studentSort === "name") return String(a.name).localeCompare(String(b.name), "ru");
    if (state.studentSort === "price") return Number(b.hourlyRate || 0) - Number(a.hourlyRate || 0);
      const nextA = lessonStart(nextLessonForStudent(a.id)) || "9999";
      const nextB = lessonStart(nextLessonForStudent(b.id)) || "9999";
    return String(nextA).localeCompare(String(nextB));
  });
  return `
    <section class="panel" data-view="students">
      <div class="section-head compact-head">
        <h2>Ученики</h2>
        <div class="section-actions">
          <span>${students.length}</span>
          <button class="mini-button" data-action="quick-student">Добавить</button>
        </div>
      </div>
      <section class="crm-toolbar">
        <input data-filter="student-search" placeholder="Найти ученика" value="${escapeHtml(state.studentSearch)}" />
        <select data-filter="student-prep">
          <option value="">Все направления</option>
          ${prepTypes.map((item) => `<option value="${item}" ${state.studentPrepFilter === item ? "selected" : ""}>${item}</option>`).join("")}
        </select>
        <select data-filter="student-sort">
          <option value="next" ${state.studentSort === "next" ? "selected" : ""}>Ближайшие</option>
          <option value="name" ${state.studentSort === "name" ? "selected" : ""}>По имени</option>
          <option value="price" ${state.studentSort === "price" ? "selected" : ""}>По стоимости</option>
        </select>
      </section>
      <div class="student-grid crm-list">
        ${
          students.length
            ? students
                .map(
                  (student) => {
                    const next = nextLessonForStudent(student.id);
                    const [payClass, payText] = studentPaymentState(student.id);
                    return `
                    <button class="student-card compact-student ${student.id === state.selectedStudentId ? "selected" : ""}" data-action="open-student" data-id="${student.id}">
                      <strong>${escapeHtml(student.name)}</strong>
                      <span>${escapeHtml(student.grade || "—")} класс · ${escapeHtml(student.preparationType || "другое")} ${escapeHtml(student.subject || "")}</span>
                      <em>${money(student.hourlyRate)}/час</em>
                      <small>Следующее: ${next ? formatRelativeLesson(lessonStart(next)) : "нет"}</small>
                      <i class="payment-dot ${payClass}">${payText}</i>
                    </button>
                  `;
                  }
                )
                .join("")
            : emptyState("Учеников пока нет", "Добавь первого ученика, чтобы вести расписание, домашки и оплаты.")
        }
      </div>
    </section>
  `;
}

function renderStudentDetailShell(student) {
  const lessons = lessonsForStudent(student.id);
  const homeworks = homeworksForStudent(student.id);
  const topics = topicsForStudent(student.id);
  const plan = planForStudent(student.id);
  const edit = state.editingStudent;
  return `
    <section class="drawer-panel" data-view="student-detail">
      <div class="student-profile-head">
        <div class="avatar">${escapeHtml((student.name || "?").slice(0, 1))}</div>
        <div>
          <p class="eyebrow">карточка ученика</p>
          <h2>${escapeHtml(student.name)}</h2>
          <p>${escapeHtml(student.grade || "—")} класс · ${escapeHtml(student.preparationType || "другое")} ${escapeHtml(student.subject || "")}</p>
        </div>
        <div class="row-actions student-head-actions">
          ${
            edit
              ? `
                <button class="mini-button student-edit-cancel-button" data-action="view-student" data-id="${student.id}">Отмена</button>
                <button class="mini-button student-edit-done-button" type="button" data-action="save-student" data-id="${student.id}">Готово</button>
              `
              : `<button class="mini-button student-edit-button icon-text-button" data-action="edit-student" data-id="${student.id}">${iconLabel("edit", "Редактировать")}</button>`
          }
          <button class="icon-button student-close-button" data-action="close-student" aria-label="Закрыть карточку">${icon("close")}</button>
        </div>
      </div>
      ${edit ? studentEditForm(student) : studentProfileView(student, lessons, homeworks)}
      <div class="detail-section">
        <div class="section-head">
          <h3>Запись и расписание</h3>
          <div class="section-actions">
            <button class="mini-button" data-action="book-student" data-id="${student.id}">Разовая запись</button>
            <button class="mini-button" data-action="stable-student" data-id="${student.id}">Стабильное расписание</button>
          </div>
        </div>
        ${renderCalendarList(lessons.slice(-12), true)}
      </div>
      <div class="detail-section">
        <h3>Домашки</h3>
        ${renderHomeworkList(homeworks.slice(0, 8), true)}
      </div>
      <div class="detail-section">
        <div class="section-head">
          <h3>Статистика подготовки</h3>
          <div class="section-actions">
            <button class="mini-button icon-text-button" data-action="edit-progress" data-id="${student.id}">${iconLabel("chart", "Изменить")}</button>
            <button class="mini-button" data-action="add-progress-note" data-id="${student.id}">Заметка</button>
            <button class="mini-button" data-action="add-plan-item" data-id="${student.id}">План</button>
          </div>
        </div>
        ${renderProgressChart({ student, topics }, student)}
        ${renderProgressTaskList({ student, topics }, student, true)}
        <div class="subsection-head"><h3>План</h3></div>
        ${renderPlanList(plan, student.id, true)}
      </div>
    </section>
  `;
}

function studentProfileView(student, lessons, homeworks) {
  const conducted = lessons.filter((lesson) => lesson.status === "проведено").length;
  const cancelled = lessons.filter((lesson) => String(lesson.status).includes("отмен")).length;
  const doneHomework = homeworks.filter((item) => item.status === "выполнено").length;
  const homeworkPercent = homeworks.length ? Math.round((doneHomework / homeworks.length) * 100) : 0;
  const unpaid = lessons.filter((lesson) => lesson.status === "проведено" && lesson.payment_status !== "подтверждено репетитором");
  return `
    <section class="profile-sections">
      <div class="profile-block">
        <h3>Основное</h3>
        <div class="info-grid compact-info">
          ${infoItem("Часовой пояс", student.timezoneLabel || student.timezone || "МСК+0")}
          ${infoItem("Стоимость", `${money(student.hourlyRate)}/час`)}
          ${infoItem("Длительность", `${student.lesson_duration_minutes || 60} мин`)}
          ${infoItem("Контакты", [student.student_telegram, student.parent_telegram].filter(Boolean).join(" · ") || "не указаны")}
        </div>
      </div>
      <div class="profile-block">
        <h3>Прогресс</h3>
        <div class="mini-metrics">
          ${miniMetric("Посещено", conducted)}
          ${miniMetric("Отмены", cancelled)}
          ${miniMetric("ДЗ", `${homeworkPercent}%`)}
        </div>
      </div>
      <div class="profile-block">
        <h3>Финансы</h3>
        <div class="mini-metrics">
          ${miniMetric("Оплачено", student.balance_lessons || 0)}
          ${miniMetric("Долг", unpaid.length)}
        </div>
      </div>
      <div class="profile-block">
        <h3>Ссылки</h3>
        <div class="link-list">
          ${profileLink("Telegram", student.student_telegram)}
          ${profileLink("Телемост", student.meeting_url)}
          ${profileLink("UniDraw", student.board_url)}
        </div>
      </div>
    </section>
  `;
}

function miniMetric(label, value) {
  return `<article class="mini-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function profileLink(label, value) {
  if (!value) return `<span class="muted-link">${escapeHtml(label)} · нет</span>`;
  const href = String(value).startsWith("@") ? `https://t.me/${String(value).slice(1)}` : value;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function studentReadOnly(student) {
  return `
    <div class="info-grid">
      ${infoItem("Класс", student.grade || "не указан")}
      ${infoItem("Часовой пояс", student.timezoneLabel || student.timezone || "МСК+0")}
      ${infoItem("Стоимость", `${money(student.hourlyRate)}/час`)}
      ${infoItem("Подготовка", `${student.preparationType || "другое"} ${student.subject || ""}`)}
      ${infoItem("Цель", student.goal || "не указана")}
      ${infoItem("Прогресс", `${student.progress_current || 0}/${student.progress_goal || "—"}`)}
      ${infoItem("Оплачено занятий", `${student.balance_lessons || 0}`)}
      ${infoItem("Контакт ученика", student.student_telegram || "не указан")}
      ${infoItem("Родитель", [student.parent_name, student.parent_telegram].filter(Boolean).join(" · ") || "не указан")}
      ${infoItem("Права родителя", student.parent_can_edit || student.parentCanEdit ? "может редактировать календарь" : "только просмотр и оплата")}
      ${infoItem("Ссылки", [student.board_url, student.meeting_url].filter(Boolean).join(" · ") || "нет")}
      ${infoItem("Комментарии", student.comment || "нет")}
    </div>
  `;
}

function studentEditForm(student) {
  return `
    <form class="edit-form" id="student-edit-${student.id}" data-form="student" data-id="${student.id}">
      ${field("full_name", "Имя", student.name)}
      ${field("grade", "Класс", student.grade)}
      ${timezoneField(student.timezoneLabel || student.timezone || "МСК+0")}
      ${field("lesson_price", "Стоимость за 1 час", student.hourlyRate, "number")}
      ${selectField("prep_type", "Вид подготовки", prepTypes, student.preparationType)}
      ${field("subject", "Предмет", student.subject)}
      ${field("goal", "Цель", student.goal)}
      ${field("progress_current", "Прогресс текущий", student.progress_current, "number")}
      ${field("progress_goal", "Прогресс цель", student.progress_goal, "number")}
      ${field("balance_lessons", "Оплачено занятий", student.balance_lessons || 0, "number")}
      ${field("student_telegram", "Контакт ученика", student.student_telegram)}
      ${field("parent_name", "Имя родителя", student.parent_name)}
      ${field("parent_telegram", "Контакт родителя", student.parent_telegram)}
      ${selectField("parent_can_edit", "Права родителя", [["false", "Только просмотр и оплата"], ["true", "Может редактировать календарь"]], String(Boolean(student.parent_can_edit || student.parentCanEdit)))}
      ${field("board_url", "Ссылка на доску", student.board_url)}
      ${field("meeting_url", "Ссылка на звонок", student.meeting_url)}
      ${textareaField("comment", "Комментарии", student.comment)}
      <button class="primary-button student-submit-source" type="submit">Готово</button>
      <button class="danger-button" type="button" data-action="delete-student" data-id="${student.id}" data-name="${escapeHtml(student.name)}">Удалить ученика</button>
    </form>
  `;
}

function studentSelfEditForm(student) {
  return `
    <form class="edit-form" id="self-student-edit-form" data-form="self-student" data-id="${student.id}">
      ${field("full_name", "Имя", student.name)}
      ${field("grade", "Класс", student.grade)}
      ${timezoneField(student.timezoneLabel || student.timezone || "МСК+0")}
      ${selectField("prep_type", "Вид подготовки", prepTypes, student.preparationType)}
      ${field("subject", "Предмет", student.subject)}
      ${field("goal", "Цель", student.goal)}
      ${field("current_level", "Уровень", student.current_level)}
      ${field("student_telegram", "Контакт ученика", student.student_telegram)}
      ${field("parent_name", "Имя родителя", student.parent_name)}
      ${field("parent_telegram", "Контакт родителя", student.parent_telegram)}
      ${field("board_url", "Ссылка на доску", student.board_url)}
      ${field("meeting_url", "Ссылка на звонок", student.meeting_url)}
      ${textareaField("comment", "Комментарии", student.comment)}
      <button class="primary-button student-submit-source" type="submit">Готово</button>
    </form>
  `;
}

function renderStudentProfileTab(student, canEdit = true, role = "student") {
  return `
    <section class="panel" data-view="profile">
      <div class="section-head">
        <h2>Профиль</h2>
        <div class="section-actions">
          ${
            canEdit
              ? state.editingSelf
                ? `<button class="mini-button student-edit-done-button" type="button" data-action="save-self-profile">Готово</button>
                   <button class="mini-button" data-action="view-self-profile">Просмотр</button>`
                : `<button class="mini-button icon-text-button" data-action="edit-self-profile">${iconLabel("edit", "Редактировать")}</button>`
              : ""
          }
        </div>
      </div>
      ${state.editingSelf && canEdit ? studentSelfEditForm(student) : studentReadOnly(student)}
      ${role === "student" ? `<button class="danger-button" type="button" data-action="delete-self-profile">Удалить профиль</button>` : ""}
    </section>
  `;
}

function infoItem(label, value) {
  return `
    <article class="info-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function field(name, label, value = "", type = "text") {
  return `
    <label>
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function textareaField(name, label, value = "") {
  return `
    <label class="full">
      <span>${label}</span>
      <textarea name="${name}" rows="3">${escapeHtml(value ?? "")}</textarea>
    </label>
  `;
}

function selectField(name, label, options, value = "") {
  return `
    <label>
      <span>${label}</span>
      <select name="${name}">
        ${options.map((item) => {
          const optionValue = Array.isArray(item) ? item[0] : item;
          const optionLabel = Array.isArray(item) ? item[1] : item;
          return `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${optionLabel}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function radioButtonsField(name, label, options, value = "") {
  return `
    <fieldset class="button-field full">
      <legend>${escapeHtml(label)}</legend>
      <div class="button-options">
        ${options.map((item, index) => {
          const optionValue = Array.isArray(item) ? item[0] : item;
          const optionLabel = Array.isArray(item) ? item[1] : item;
          const id = `${name}-${index}`;
          return `
            <input id="${id}" name="${name}" type="radio" value="${escapeHtml(optionValue)}" ${optionValue === value ? "checked" : ""} />
            <label for="${id}">${escapeHtml(optionLabel)}</label>
          `;
        }).join("")}
      </div>
    </fieldset>
  `;
}

function checkboxGroup(name, label, options, selected = []) {
  const active = new Set(selected);
  return `
    <fieldset class="choice-field full">
      <legend>${escapeHtml(label)}</legend>
      <div class="choice-grid">
        ${options.map((item) => {
          const optionValue = Array.isArray(item) ? item[0] : item;
          const optionLabel = Array.isArray(item) ? item[1] : item;
          const id = `${name}-${String(optionValue).replace(/[^a-zA-Z0-9а-яА-Я]+/g, "-")}`;
          return `
            <label class="choice-chip" for="${escapeHtml(id)}">
              <input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="checkbox" value="${escapeHtml(optionValue)}" ${active.has(optionValue) ? "checked" : ""} />
              <span>${escapeHtml(optionLabel)}</span>
            </label>
          `;
        }).join("")}
      </div>
    </fieldset>
  `;
}

function timezoneField(value = "МСК+0") {
  return selectField("timezone", "Часовой пояс", timezoneOptions, value || "МСК+0");
}

function examProgressGoal(student) {
  const explicit = Number(student?.defaultProgressGoal || 0);
  if (explicit > 0) return explicit;
  const text = `${student?.preparationType || student?.prep_type || ""} ${student?.subject || ""}`.toLowerCase();
  if (text.includes("огэ") && text.includes("информ")) return 16;
  if (text.includes("огэ") && text.includes("мат")) return 19;
  if (text.includes("егэ") && text.includes("информ")) return 27;
  if (text.includes("егэ") && text.includes("мат")) return 19;
  return 0;
}

function groupLessonsByDay(lessons) {
  const groups = new Map();
  for (const lesson of lessons) {
    const key = String(lessonStart(lesson) || lesson.starts_at || "").slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lesson);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function groupClosedSlotsByDay(slots) {
  const groups = new Map();
  for (const slot of slots) {
    const key = String(slot.starts_at || "").slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderCalendarList(lessons, compact = false) {
  if (!lessons.length) return emptyState("Календарь пуст", "Создай занятие через кнопку + или из карточки ученика.");
  return groupLessonsByDay(lessons)
    .map(
      ([day, items]) => `
        <div class="calendar-day">
          <h3>${weekdayTitle(day)}</h3>
          <div class="timeline-list">
            ${items
              .map(
                (lesson) => `
                  <article class="lesson-row timeline-event ${statusClass(lesson.status)}" data-action="edit-lesson" data-id="${lesson.id}">
                    <time>${formatTime(lessonStart(lesson))}</time>
                    <div>
                      <strong>${escapeHtml(lesson.student_name || "Занятие")}</strong>
                      <p>${lesson.duration_minutes} мин · ${money(lesson.price)} ${compact ? "" : `· ${escapeHtml(lesson.notes || "")}`}</p>
                    </div>
                    <div class="lesson-statuses">
                      ${pill(lesson.status)}
                      ${pill(lesson.payment_label || lesson.payment_status)}
                    </div>
                    <div class="row-actions lesson-menu">${lessonActions(lesson)}</div>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      `
    )
    .join("");
}

function renderClosedSlots(slots) {
  if (!slots.length) return emptyState("Нерабочих часов нет", "Добавь время, когда запись должна быть закрыта.");
  return groupClosedSlotsByDay(slots)
    .map(
      ([day, items]) => `
        <div class="calendar-day">
          <h3>${weekdayTitle(day)}</h3>
          <div class="closed-slot-list">
            ${items
              .map(
                (slot) => `
                  <article class="closed-slot-row">
                    <time>${formatTime(slot.starts_at)}-${formatTime(slot.ends_at)}</time>
                    <div>
                      <strong>${escapeHtml(slot.reason || "Нерабочее время")}</strong>
                      <p>${formatDateTime(slot.starts_at)} - ${formatDateTime(slot.ends_at)}</p>
                    </div>
                    <button class="mini-button micro danger-icon" data-action="delete-closed-slot" data-id="${slot.id}" type="button" aria-label="Удалить">${icon("trash")}</button>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      `
    )
    .join("");
}

function lessonActions(lesson) {
  if (state.payload.role === "tutor") {
    if (lesson.status === "ожидает подтверждения") {
      return `
        <button class="mini-button micro" data-action="confirm-booking" data-id="${lesson.id}">OK</button>
        <button class="mini-button micro" data-action="reject-booking" data-id="${lesson.id}" aria-label="Отклонить">${icon("close")}</button>
        <button class="mini-button micro" data-action="move-admin-lesson" data-id="${lesson.id}" aria-label="Перенести">${icon("move")}</button>
        <button class="mini-button micro danger-icon" data-action="delete-lesson" data-id="${lesson.id}" aria-label="Удалить">${icon("trash")}</button>
      `;
    }
    return `
      <button class="mini-button micro" data-action="move-admin-lesson" data-id="${lesson.id}" aria-label="Перенести">${icon("move")}</button>
      <button class="mini-button micro" data-action="cancel-admin-lesson" data-id="${lesson.id}" aria-label="Отменить">${icon("close")}</button>
      <button class="mini-button micro danger-icon" data-action="delete-lesson" data-id="${lesson.id}" aria-label="Удалить">${icon("trash")}</button>
      <button class="mini-button micro" data-action="edit-lesson" data-id="${lesson.id}" aria-label="Редактировать">${icon("edit")}</button>
    `;
  }
  const canEdit = state.payload.role === "student" || state.payload.dashboard?.student?.parentCanEdit || state.payload.dashboard?.student?.parent_can_edit;
  const canChangeLesson = ["ожидает подтверждения", "запланировано", "перенесено"].includes(lesson.status);
  return `
    <button class="mini-button micro" data-action="mark-paid" data-id="${lesson.id}">₽</button>
    ${canEdit && canChangeLesson ? `<button class="mini-button micro" data-action="move-own-lesson" data-id="${lesson.id}" aria-label="Перенести">${icon("move")}</button>` : ""}
    ${canEdit && canChangeLesson ? `<button class="mini-button micro" data-action="cancel-own-lesson" data-id="${lesson.id}" aria-label="Отменить">${icon("close")}</button>` : ""}
  `;
}

function findLessonById(id) {
  return (
    state.payload.admin?.calendar?.find((item) => item.id === id) ||
    state.payload.admin?.calendar_archive?.find((item) => item.id === id) ||
    state.payload.dashboard?.lessons?.find((item) => item.id === id) ||
    state.payload.dashboard?.lesson_archive?.find((item) => item.id === id)
  );
}

function renderCalendar(adminOrDashboard) {
  const archive = adminOrDashboard.calendar_archive || adminOrDashboard.lesson_archive || [];
  const current = adminOrDashboard.calendar || adminOrDashboard.lessons || [];
  const closedSlots = state.showCalendarArchive ? adminOrDashboard.closed_slots_archive || [] : adminOrDashboard.closed_slots || [];
  const lessons = state.showCalendarArchive ? archive : current;
  const periodLabel = state.showCalendarArchive ? "Архив · последние 14 дней" : "Ближайшие 14 дней";
  return `
    <section class="panel calendar-panel" data-view="calendar">
      <div class="calendar-toolbar">
        <div class="calendar-title-block">
          <h2>Календарь</h2>
          <span>${periodLabel}</span>
        </div>
        <button class="calendar-ghost-action" data-action="toggle-calendar-archive" type="button">
          ${icon("calendar")}<span>${state.showCalendarArchive ? "Ближайшие" : "Архив"}</span>
        </button>
      </div>
      <div class="calendar-action-rail">
        <button class="calendar-action" data-action="quick-lesson" type="button">${iconLabel("plus", "Запись")}</button>
        ${state.payload.role !== "tutor" ? `<button class="calendar-action" data-action="quick-free-slots" type="button">${iconLabel("clock", "Окна")}</button>` : ""}
        <button class="calendar-action" data-action="quick-schedule" type="button">${iconLabel("calendar", "Стабильное")}</button>
        ${state.payload.role === "tutor" ? `<button class="calendar-action" data-action="quick-closed-slot" type="button">${iconLabel("minus", "Нерабочее")}</button>` : ""}
      </div>
      ${renderCalendarList(lessons)}
      ${
        state.payload.role === "tutor"
          ? `
            <section class="closed-slots-panel">
              <div class="section-head compact-head">
                <h2>Нерабочие часы</h2>
                <div class="section-actions">
                  <span>${closedSlots.length}</span>
                  <button class="mini-button" data-action="quick-closed-slot" type="button">Добавить</button>
                </div>
              </div>
              ${renderClosedSlots(closedSlots)}
            </section>
          `
          : ""
      }
    </section>
  `;
}

function renderHomeworkList(homeworks, editable = false) {
  if (!homeworks.length) {
    return emptyState("Домашек нет", "Когда репетитор создаст домашку, она появится здесь.")
  }
  return `
    <div class="stack">
      ${homeworks
        .map(
          (homework) => `
            <article class="homework-row">
              <div>
                <strong>${escapeHtml(homework.title || "Домашнее задание")}</strong>
                <p>${escapeHtml(homework.student_name || "")} · дедлайн: ${formatDate(homework.deadline)}</p>
                <span>${escapeHtml((homework.description || "").slice(0, 110))}</span>
                ${homework.attachments?.length ? `<small>${homework.attachments.length} файл.</small>` : ""}
                ${homework.links?.length ? `<a href="${escapeHtml(homework.links[0])}" target="_blank" rel="noreferrer">Открыть ссылку</a>` : ""}
              </div>
              <div class="row-actions">
                ${pill(homework.status)}
                ${
                  editable
                    ? `<button class="mini-button icon-text-button" data-action="edit-homework" data-id="${homework.id}">${iconLabel("edit", "Править")}</button>
                       <button class="mini-button micro danger-icon" data-action="delete-homework" data-id="${homework.id}" aria-label="Удалить домашку">${icon("trash")}</button>`
                    : `<button class="mini-button" data-action="open-homework" data-id="${homework.id}">Открыть</button>`
                }
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function homeworkDetail(homework) {
  const attachmentList = (homework.attachments || [])
    .map((item, index) => {
      const label = item.startsWith("data:image/") ? `<img class="attachment-preview" src="${escapeHtml(item)}" alt="Фото ${index + 1}" />` : `Файл ${index + 1}`;
      return `<a class="attachment-link" href="${escapeHtml(item)}" target="_blank" rel="noreferrer">${label}</a>`;
    })
    .join("");
  return `
    <div class="homework-detail">
      <h3>${escapeHtml(homework.title || "Домашнее задание")}</h3>
      <p>Дедлайн: ${formatDateTime(homework.deadline)}</p>
      <div class="homework-text">${escapeHtml(homework.description || homework.text || "")}</div>
      ${homework.links?.length ? `<a href="${escapeHtml(homework.links[0])}" target="_blank" rel="noreferrer">Открыть ссылку</a>` : ""}
      ${attachmentList ? `<div class="attachment-grid">${attachmentList}</div>` : ""}
      <form class="edit-form" data-form="homework-submit" data-id="${homework.id}">
        ${textareaField("text", "Решение или ссылка", "")}
        <button class="primary-button" type="submit">Отправить решение</button>
      </form>
    </div>
  `;
}

function renderHomeworks(adminOrDashboard, editable) {
  const homeworks = adminOrDashboard.homeworks || [];
  const filtered = homeworkFiltered(homeworks);
  return `
    <section class="panel" data-view="homeworks">
      <div class="section-head compact-head"><h2>Домашки</h2><span>${filtered.length}/${homeworks.length}</span></div>
      <section class="segmented">
        ${[
          ["", "Все"],
          ["ожидание выполнения", "Выданы"],
          ["выполнено", "Выполнены"],
          ["просрочено", "Просрочены"],
        ].map(([value, label]) => `<button class="${state.filterHomework === value ? "active" : ""}" data-action="set-homework-filter" data-value="${value}">${label}</button>`).join("")}
      </section>
      ${renderHomeworkList(filtered, editable)}
    </section>
  `;
}

function homeworkFiltered(homeworks) {
  if (!state.filterHomework) return homeworks;
  if (state.filterHomework === "просрочено") {
    const now = new Date();
    return homeworks.filter((item) => item.deadline && new Date(item.deadline) < now && item.status !== "выполнено");
  }
  return homeworks.filter((item) => item.status === state.filterHomework);
}

function renderFinances(adminOrDashboard, isTutor) {
  const finances = adminOrDashboard.finances || {
    month_income: 0,
    pending: [],
    unpaid_lessons: (adminOrDashboard.lessons || []).filter((item) => item.payment_status === "не оплачено"),
    payments: adminOrDashboard.payments || [],
  };
  const student = adminOrDashboard.student;
  const payments = finances.payments || [];
  return `
    <section class="panel finance-screen" data-view="finances">
      <div class="section-head compact-head"><h2>${isTutor ? "Финансы" : "Оплаты"}</h2><span>${isTutor ? money(finances.month_income || 0) : money(student?.hourlyRate || 0) + "/ч"}</span></div>
      <section class="finance-kpis">
        <article><span>Сегодня</span><strong>${money(finances.today_income || 0)}</strong></article>
        <article><span>Неделя</span><strong>${money(finances.week_income || 0)}</strong></article>
        <article><span>Месяц</span><strong>${money(finances.month_income || 0)}</strong></article>
        <article><span>Ожидается</span><strong>${money(finances.expected_income || 0)}</strong></article>
      </section>
      ${renderIncomeChart(finances.income_events || payments)}
      <section class="filters">
        <select data-filter="payment">
          <option value="">Все оплаты</option>
          ${paymentStatuses.map((item) => `<option value="${item}" ${state.filterPayment === item ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </section>
      <div class="detail-section">
        <h3>Последние оплаты</h3>
        ${
          payments.length
            ? renderMoneyRows(payments.slice(0, 8), false)
            : emptyState("История пустая", "Подтвержденные и ожидающие оплаты появятся здесь.")
        }
      </div>
      <div class="detail-section">
        <h3>Ожидают оплаты</h3>
        ${
          finances.unpaid_lessons?.length
            ? renderCalendarList(finances.unpaid_lessons, true)
            : emptyState("Нет неоплаченных занятий", "Проведенные неоплаченные уроки будут видны здесь.")
        }
      </div>
      <div class="detail-section">
        <h3>Ожидают проверки</h3>
        ${
          finances.pending?.length
            ? renderMoneyRows(finances.pending, isTutor)
            : emptyState("Нет платежей на проверке", "Когда ученик или родитель отметит оплату, она появится здесь.")
        }
      </div>
    </section>
  `;
}

function renderIncomeChart(payments) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return date;
  });
  const values = days.map((day) =>
    payments
      .filter((payment) => payment.confirmed_at && isSameDay(payment.confirmed_at, day))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  );
  const max = Math.max(...values, 1);
  return `
    <section class="income-chart">
      ${values
        .map(
          (value, index) => `
            <div>
              <span style="height:${Math.max(6, (value / max) * 100)}%"></span>
              <small>${days[index].toLocaleDateString("ru-RU", { weekday: "short" })}</small>
            </div>
          `
        )
        .join("")}
    </section>
  `;
}

function renderMoneyRows(items, isTutor) {
  return `
    <div class="stack">
      ${items
        .map((item) => {
          const isLesson = Boolean(item.starts_at);
          return `
            <article class="finance-row">
              <div>
                <strong>${escapeHtml(item.student_name || "Оплата")}</strong>
                <p>${isLesson ? formatDateTime(lessonStart(item)) : formatDateTime(item.created_at)} · ${money(item.amount || item.price || 0)}</p>
              </div>
              ${pill(item.payment_label || item.status)}
              ${isTutor ? `<button class="mini-button" data-action="${isLesson ? "confirm-lesson" : "confirm-payment"}" data-id="${item.id}">Подтвердить</button>` : ""}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function normalizedProgressTasks(topics, student) {
  const examGoal = examProgressGoal(student);
  const byNumber = new Map();
  const customTopics = [];
  for (const topic of topics || []) {
    const number = Number(topic.task_number || String(topic.title || "").match(/\d+/)?.[0] || 0);
    if (number > 0) byNumber.set(number, topic);
    else customTopics.push(topic);
  }
  if (examGoal <= 0) {
    return customTopics
      .concat([...byNumber.values()])
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ru"))
      .map((topic, index) => ({
        ...topic,
        task_number: topic.task_number || index + 1,
        title: topic.title || `Тема ${index + 1}`,
        knowledge_level: topic.knowledge_level || 0,
        comment: topic.comment || "",
      }));
  }
  return Array.from({ length: examGoal }, (_, index) => {
    const number = index + 1;
    const topic = byNumber.get(number);
    return {
      ...topic,
      task_number: number,
      title: `Задание ${number}`,
      knowledge_level: topic?.knowledge_level || 0,
      comment: topic?.comment || "",
    };
  });
}

function renderProgressChart(bundle, student) {
  const bars = normalizedProgressTasks(bundle.topics || [], student);
  const isCustom = examProgressGoal(student) <= 0;
  if (!bars.length) {
    return emptyState("Статистика пока пустая", "Для ЕГЭ/ОГЭ здесь появится график уровня знаний по заданиям.")
  }
  return `
    <div class="progress-chart-shell" aria-label="Уровень знаний от 0 до 10">
      <div class="progress-axis" aria-hidden="true">
        <div class="progress-axis-scale">
          <span style="top:0%">10</span>
          <span style="top:20%">8</span>
          <span style="top:40%">6</span>
          <span style="top:60%">4</span>
          <span style="top:80%">2</span>
          <span style="top:100%">0</span>
        </div>
      </div>
      <div class="progress-chart ${isCustom ? "custom-progress" : ""}">
        ${bars
          .map(
            (topic) => `
              <div class="bar-wrap" title="${escapeHtml(`${topic.title}: ${topic.knowledge_level || 0}/10`)}">
                <div class="bar" style="height:${Math.max(4, Math.min(10, topic.knowledge_level || 0) * 10)}%"></div>
                <span title="${escapeHtml(topic.title)}">${escapeHtml(isCustom ? topic.title : String(topic.title).replace("Задание ", ""))}</span>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderProgressTaskList(bundle, student, canEdit = false) {
  const tasks = normalizedProgressTasks(bundle.topics || [], student)
    .filter((task) => String(task.comment || "").trim());
  if (!tasks.length) return "";
  const isCustom = examProgressGoal(student) <= 0;
  return `
    <details class="progress-notes">
      <summary>
        <span>Заметки по заданиям</span>
        <strong>${tasks.length}</strong>
      </summary>
      <div class="progress-task-list" aria-label="Комментарии по заданиям">
        ${tasks
          .map((task) => {
            const title = isCustom ? task.title : `№${task.task_number}`;
            const comment = String(task.comment || "").trim();
            return `
              <article class="progress-task-row">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(comment)}</span>
                ${
                  canEdit && task.id
                    ? `<button class="mini-button micro danger-icon" data-action="delete-progress-note" data-id="${task.id}" data-student-id="${student.id}" aria-label="Удалить заметку">${icon("trash")}</button>`
                    : ""
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </details>
  `;
}

function renderPlanList(plan = [], studentId = null, canEdit = false) {
  return `
    <div class="plan-list">
      ${
        plan.length
          ? plan.map((item) => `
              <label class="plan-row">
                <input type="checkbox" data-action="toggle-plan-item" data-student-id="${studentId}" data-id="${item.id}" ${item.status === "выполнено" ? "checked" : ""} ${canEdit ? "" : "disabled"} />
                <span>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${item.deadline ? `до ${formatDate(item.deadline)}` : "без дедлайна"}${item.comment ? ` · ${escapeHtml(item.comment)}` : ""}</small>
                </span>
              </label>
            `).join("")
          : emptyState("План пуст", "Добавь пункт плана с дедлайном.")
      }
    </div>
  `;
}

function progressForm(studentId) {
  const student = state.payload.admin?.students?.find((item) => item.id === studentId) || state.payload.dashboard?.student;
  const options = normalizedProgressTasks(topicsForStudent(studentId), student);
  const isExam = examProgressGoal(student) > 0;
  return `
    <form class="edit-form" data-form="progress-update" data-id="${studentId}">
      ${
        isExam
          ? `<label>
              <span>Задание</span>
              <select name="task_number">
                ${options
                  .map((item) => `<option value="${item.task_number}" data-level="${item.knowledge_level}" data-comment="${escapeHtml(item.comment || "")}">${escapeHtml(item.title)} · сейчас ${item.knowledge_level}/10</option>`)
                  .join("")}
              </select>
            </label>`
          : `<label>
              <span>Название темы</span>
              <input name="title" list="progress-topic-options" placeholder="Например: циклы, списки, лабораторная 1" />
              <datalist id="progress-topic-options">
                ${options.map((item) => `<option value="${escapeHtml(item.title)}"></option>`).join("")}
              </datalist>
            </label>`
      }
      ${progressRuler(options[0]?.knowledge_level || 0)}
      ${textareaField("comment", "Комментарий", options[0]?.comment || "")}
      <button class="primary-button" type="button" data-action="save-progress">Готово</button>
    </form>
  `;
}

function progressRuler(value = 0) {
  const selected = Math.max(0, Math.min(10, Number(value) || 0));
  return `
    <fieldset class="progress-ruler-field full">
      <legend>Новое значение 0–10</legend>
      <div class="progress-ruler" role="radiogroup" aria-label="Новое значение прогресса">
        ${Array.from(
          { length: 11 },
          (_, level) => `
            <label class="progress-ruler-option">
              <input type="radio" name="knowledge_level" value="${level}" ${level === selected ? "checked" : ""} />
              <span>${level}</span>
            </label>
          `
        ).join("")}
      </div>
    </fieldset>
  `;
}

function syncProgressTaskFields(target) {
  if (target.name !== "task_number") return;
  const form = target.closest('[data-form="progress-update"]');
  const level = target.options[target.selectedIndex]?.dataset.level || "0";
  const comment = target.options[target.selectedIndex]?.dataset.comment || "";
  const input = form?.querySelector(`[name="knowledge_level"][value="${level}"]`);
  const textarea = form?.querySelector('[name="comment"]');
  if (input) {
    input.checked = true;
    input.closest(".progress-ruler-option")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
  if (textarea) textarea.value = comment;
}

function progressNoteForm(studentId) {
  const student = state.payload.admin?.students?.find((item) => item.id === studentId) || state.payload.dashboard?.student;
  const options = normalizedProgressTasks(topicsForStudent(studentId), student);
  return `
    <form class="edit-form" data-form="progress-note" data-id="${studentId}">
      <label>
        <span>№ задания</span>
        <select name="task_number">
          <option value="">Тема вручную</option>
          ${options.map((item) => `<option value="${item.task_number || ""}">${escapeHtml(item.title)}</option>`).join("")}
        </select>
      </label>
      ${field("title", "Тема вручную", "")}
      ${textareaField("comment", "Заметка", "")}
      <button class="primary-button" type="submit">Создать заметку</button>
    </form>
  `;
}

function planItemForm(studentId) {
  return `
    <form class="edit-form" data-form="plan-create" data-id="${studentId}">
      ${field("title", "Пункт плана", "")}
      ${field("deadline", "Дедлайн", "", "date")}
      ${textareaField("comment", "Комментарий", "")}
      <button class="primary-button" type="submit">Добавить пункт</button>
    </form>
  `;
}

function onboardingRoleCards() {
  const cards = [
    ["school", "Онлайн-школа", "Команда, преподаватели, масштабирование", "School · 10 000 ₽"],
    ["tutor", "Репетитор", "Личный кабинет, ученики, расписание, оплаты", "Standart / Pro"],
    ["student", "Ученик", "Кабинет, ДЗ, прогресс, занятия", "По username репетитора"],
    ["parent", "Родитель", "Оплаты, расписание, прогресс ребенка", "По username репетитора"],
  ];
  return `
    <section class="marketing-hero">
      <img src="/assets/marketing-hero.png" alt="" />
      <div class="marketing-hero-copy">
        <p class="eyebrow">CRM Tutor SaaS</p>
        <h2>CRM, которая продаёт репетитора как школу</h2>
        <p>Ученики, расписание, ДЗ, прогресс, оплаты, публичная страница и Telegram-связка в одном SaaS-кабинете для репетиторов и онлайн-школ.</p>
        <div class="marketing-actions">
          <button class="primary-button" type="button" data-action="scroll-onboarding">Создать кабинет</button>
          <button class="mini-button" type="button" data-action="scroll-marketing">Посмотреть возможности</button>
        </div>
      </div>
      <div class="hero-proof-strip" aria-label="Ключевые показатели">
        <span><strong>4 роли</strong> школа, репетитор, ученик, родитель</span>
        <span><strong>0 SMS</strong> email + пароль и Telegram</span>
        <span><strong>100k+</strong> архитектура под масштаб</span>
      </div>
    </section>
    <section class="marketing-proof-grid" id="marketing">
      <article><span>01</span><strong>Вся логика Mini App</strong><p>Карточки учеников, ЕГЭ/ОГЭ, планы, ДЗ, оплаты, история занятий и быстрые действия.</p></article>
      <article><span>02</span><strong>Workspace isolation</strong><p>Каждый репетитор или школа видит только своих учеников, финансы и расписание.</p></article>
      <article><span>03</span><strong>Публичная запись</strong><p>Страница репетитора, свободные окна, заявки и попадание заявки прямо в CRM.</p></article>
      <article><span>04</span><strong>Telegram-ready</strong><p>Подключение бота для уведомлений, рассылок, регистрации и напоминаний.</p></article>
    </section>
    <section class="marketing-split">
      <div>
        <p class="eyebrow">Тарифы</p>
        <h2>Сразу как коммерческий SaaS</h2>
        <p>Тариф задаёт лимиты workspace: учеников, преподавателей, файлов и активных занятий. Billing можно подключать без смены архитектуры.</p>
      </div>
      <div class="pricing-row">
        <article><span>Standart</span><strong>3 000 ₽</strong><small>частный репетитор</small></article>
        <article><span>Pro</span><strong>6 000 ₽</strong><small>растущий кабинет</small></article>
        <article><span>School</span><strong>10 000 ₽</strong><small>онлайн-школа</small></article>
      </div>
    </section>
    <section class="register-hero product-hero" id="start">
      <p class="eyebrow">Старт за минуту</p>
      <h2>Кто вы?</h2>
      <p>Выберите сценарий. При регистрации каждый создаёт пароль, Telegram можно подключить после входа.</p>
    </section>
    <section class="role-card-grid">
      ${cards.map(([role, title, text, meta]) => `
        <button class="role-card ${state.onboardingRole === role ? "selected" : ""}" type="button" data-action="onboarding-role" data-role="${role}">
          <span>${escapeHtml(meta)}</span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(text)}</small>
        </button>
      `).join("")}
    </section>
    <section class="panel quick-login-panel">
      <h2>Уже есть кабинет?</h2>
      <form class="edit-form" data-form="email-login">
        ${field("email", "Email", localStorage.getItem("crm_email") || "", "email")}
        ${field("password", "Пароль", "", "password")}
        <button class="primary-button" type="submit">Войти</button>
      </form>
    </section>
  `;
}

function onboardingPlanChoice() {
  return `
    <section class="register-hero product-hero">
      <p class="eyebrow">Тариф репетитора</p>
      <h2>Выберите стартовый план</h2>
      <p>Оплату пока не подключаем: тариф нужен, чтобы сразу задать лимиты и модель подписки.</p>
    </section>
    <section class="plan-card-grid">
      ${["standart", "pro"].map((code) => {
        const plan = planOptions[code];
        return `
          <button class="plan-card" type="button" data-action="onboarding-plan" data-plan="${code}">
            <span>${escapeHtml(plan.title)}</span>
            <strong>${escapeHtml(plan.price)}</strong>
            <small>${escapeHtml(plan.note)}</small>
          </button>
        `;
      }).join("")}
    </section>
    <button class="mini-button onboarding-back" type="button" data-action="onboarding-back">Назад к ролям</button>
  `;
}

function profileBasicsFields({ name = "", email = "", school = false } = {}) {
  return `
    ${field("first_name", school ? "Название школы" : "Имя", name)}
    ${school ? "" : field("last_name", "Фамилия", "")}
    ${field("username", school ? "Username школы для crmtutor.ru/username" : "Username для crmtutor.ru/username", "")}
    ${field("email", "Email для входа и уведомлений", email, "email")}
    ${field("password", "Придумайте пароль", "", "password")}
    ${selectField("timezone", "Часовой пояс", timezoneSelectOptions, "Europe/Moscow")}
  `;
}

function tutorOnboardingForm(payload, role) {
  const name = payload?.registration?.telegram_name || "";
  const email = payload?.registration?.email || localStorage.getItem("crm_email") || "";
  const isSchool = role === "school";
  const planCode = isSchool ? "school" : state.onboardingPlan || "standart";
  return `
    <section class="register-hero product-hero">
      <p class="eyebrow">${isSchool ? "Онлайн-школа" : planOptions[planCode].title}</p>
      <h2>${isSchool ? "Создать кабинет школы" : "Заполнить профиль репетитора"}</h2>
      <p>Большинство полей выбирается списками. Свои направления можно добавить отдельной строкой.</p>
    </section>
    <form class="panel register-card edit-form onboarding-form" data-form="${isSchool ? "create-school" : "create-tutor"}">
      ${profileBasicsFields({ name, email, school: isSchool })}
      ${selectField("experience_years", "Стаж", [[0, "Без стажа / старт"], [1, "1 год"], [2, "2 года"], [3, "3 года"], [5, "5+ лет"], [10, "10+ лет"]], 0)}
      ${checkboxGroup("subjects", "Предметы", subjectOptions, isSchool ? ["Математика", "Информатика"] : ["Информатика"])}
      ${field("custom_subjects", "Другие предметы через запятую", "")}
      ${checkboxGroup("directions", "Направления подготовки", directionOptions, ["ЕГЭ", "ОГЭ"])}
      ${field("custom_directions", "Свое направление через запятую", "")}
      ${selectField("hourly_price", "Стоимость занятия", [[1500, "1 500 ₽"], [2000, "2 000 ₽"], [2500, "2 500 ₽"], [3000, "3 000 ₽"], [4000, "4 000 ₽"], [5000, "5 000 ₽"], [6000, "6 000 ₽+"]], 3000)}
      ${textareaField("description", "Короткое описание профиля", "")}
      <input type="hidden" name="workspace_type" value="${isSchool ? "school" : "tutor"}" />
      <input type="hidden" name="plan_code" value="${planCode}" />
      <button class="primary-button" type="submit">${isSchool ? "Создать школу · 10 000 ₽" : `Создать кабинет · ${planOptions[planCode].price}`}</button>
      <button class="mini-button full" type="button" data-action="${isSchool ? "onboarding-back" : "onboarding-plan-back"}">${isSchool ? "Назад к ролям" : "Назад к тарифам"}</button>
    </form>
  `;
}

function clientOnboardingForm(payload, role) {
  const name = payload.registration?.telegram_name || "";
  const email = payload.registration?.email || localStorage.getItem("crm_email") || "";
  const isParent = role === "parent";
  return `
    <section class="register-hero product-hero">
      <p class="eyebrow">${isParent ? "Родитель" : "Ученик"}</p>
      <h2>${isParent ? "Прикрепиться к репетитору ребенка" : "Прикрепиться к репетитору"}</h2>
      <p>Нужен username репетитора или школы. После отправки заявка появится в CRM конкретного workspace.</p>
    </section>
    <form class="panel register-card edit-form onboarding-form" data-form="${isParent ? "register-parent" : "register-student"}">
        ${field("tutor_username", "Username репетитора или школы", "")}
        ${field("email", "Email для входа", email, "email")}
        ${field("password", "Придумайте пароль", "", "password")}
        ${field("full_name", isParent ? "ФИО родителя" : "ФИО ученика", name)}
        ${isParent ? field("child_name", "ФИО ребенка", "") : ""}
        ${field("grade", isParent ? "Класс ребенка" : "Класс", "")}
        ${selectField("timezone", "Часовой пояс", timezoneSelectOptions, "Europe/Moscow")}
        ${selectField("prep_type", "Подготовка", prepTypes, "ЕГЭ")}
        ${selectField("subject", "Предмет", subjectOptions, "Информатика")}
        ${field("goal", "Цель", "")}
        ${isParent ? field("child_telegram", "Telegram ребенка", "") : field("parent_name", "ФИО родителя", "")}
        ${field("parent_telegram", "Telegram родителя", "")}
        ${isParent ? "" : selectField("parent_can_edit", "Права родителя", [["false", "Только статистика и оплата"], ["true", "Может редактировать календарь"]], "false")}
        <button class="primary-button" type="submit">${isParent ? "Создать кабинет родителя" : "Создать кабинет ученика"}</button>
        <button class="mini-button full" type="button" data-action="onboarding-back">Назад к ролям</button>
    </form>
  `;
}

function renderOnboarding(payload = { registration: {} }) {
  screenTitle.textContent = "Старт";
  updateProfileButton(null);
  if (!state.onboardingRole) app.innerHTML = onboardingRoleCards();
  else if (state.onboardingRole === "tutor" && !state.onboardingPlan) app.innerHTML = onboardingPlanChoice();
  else if (["tutor", "school"].includes(state.onboardingRole)) app.innerHTML = tutorOnboardingForm(payload, state.onboardingRole);
  else app.innerHTML = clientOnboardingForm(payload, state.onboardingRole);
  tabbar.replaceChildren();
  syncTopbarSubmitAction();
  attachHandlers();
}

function renderGuest(payload) {
  renderOnboarding(payload);
}

function renderClient(payload) {
  const bundle = payload.dashboard;
  const student = bundle.student;
  const unpaid = bundle.lessons.filter((item) => item.status === "проведено" && item.payment_status !== "подтверждено репетитором");
  const canEditProgress = payload.role === "student";
  screenTitle.textContent = payload.role === "parent" ? "Кабинет родителя" : "Кабинет ученика";
  app.innerHTML = `
    <section class="hero-crm" data-view="overview">
      <div>
        <p class="eyebrow">${escapeHtml(student.preparationType || "подготовка")}</p>
        <h2>${escapeHtml(student.name)}</h2>
        <p>${escapeHtml(student.goal || "Цель подготовки появится здесь")}</p>
      </div>
      <div class="hero-income">
        <span>ближайшее</span>
        <strong>${formatDateTime(lessonStart(bundle.summary.next_lesson))}</strong>
      </div>
    </section>
    <section class="metric-grid compact" data-view="overview">
      <button class="metric metric-button" data-action="go-view" data-view-target="homeworks"><span>Домашки</span><strong>${bundle.summary.open_homework}</strong></button>
      <button class="metric metric-button" data-action="go-view" data-view-target="finances"><span>Оплаты</span><strong>${unpaid.length}</strong></button>
      <button class="metric metric-button" data-action="go-view" data-view-target="progress"><span>Прогресс</span><strong>${bundle.summary.progress_percent ?? "—"}%</strong></button>
      <button class="metric metric-button" data-action="go-view" data-view-target="calendar"><span>Занятия</span><strong>${bundle.lessons.length}</strong></button>
    </section>
    <section class="panel" data-view="overview">
      <div class="section-head"><h2>Статистика подготовки</h2><span>0-10</span></div>
      ${renderProgressChart(bundle, student)}
    </section>
    ${renderCalendar(bundle)}
    ${renderHomeworks(bundle, false)}
    <section class="panel" data-view="progress">
      <div class="section-head">
        <h2>Прогресс</h2>
        <div class="section-actions">
          <span>${student.progress_current}/${student.progress_goal || "—"}</span>
          ${canEditProgress ? `<button class="mini-button" data-action="edit-progress" data-id="${student.id}">Изменить</button>` : ""}
          ${canEditProgress ? `<button class="mini-button" data-action="add-progress-note" data-id="${student.id}">Заметка</button>` : ""}
          ${canEditProgress ? `<button class="mini-button" data-action="add-plan-item" data-id="${student.id}">План</button>` : ""}
        </div>
      </div>
      ${renderProgressChart(bundle, student)}
      ${renderProgressTaskList(bundle, student, canEditProgress)}
      <div class="subsection-head"><h3>План</h3></div>
      ${renderPlanList(bundle.plan || [], student.id, canEditProgress)}
    </section>
    ${renderStudentProfileTab(student, payload.role === "student" || student.parentCanEdit || student.parent_can_edit, payload.role)}
    ${renderFinances(bundle, false)}
  `;
  renderTabs(clientTabs);
  setView(clientTabs.some(([view]) => view === state.activeView) ? state.activeView : "overview");
  syncTopbarSubmitAction();
}

function renderTutor(payload) {
  const admin = payload.admin;
  const detail = state.selectedStudentId ? studentById(state.selectedStudentId) : null;
  screenTitle.textContent = "BOTай CRM";
  app.innerHTML = `
    ${renderTutorProfilePanel(payload.tutor_profile)}
    ${renderOverviewTutor(admin)}
    ${renderStudents(admin)}
    ${detail ? renderStudentDetailShell(detail) : ""}
    ${renderCalendar(admin)}
    ${renderHomeworks(admin, true)}
    ${renderFinances(admin, true)}
    ${renderFab()}
  `;
  renderTabs(tutorTabs);
  setView(state.activeView === "student-detail" && detail ? "student-detail" : tutorTabs.some(([view]) => view === state.activeView) ? state.activeView : "overview");
  syncTopbarSubmitAction();
}

function renderTutorProfilePanel(profile = {}) {
  if (!profile) return "";
  return `
    <section class="panel tutor-profile-panel" data-view="overview">
      <div class="section-head">
        <div>
          <p class="eyebrow">Публичный профиль</p>
          <h2>${escapeHtml([profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Профиль репетитора")}</h2>
        </div>
        <button class="mini-button icon-text-button" data-action="edit-tutor-profile">${iconLabel("edit", "Редактировать")}</button>
      </div>
      <div class="profile-kpi-grid">
        <span>crmtutor.ru/${escapeHtml(profile.public_slug || "")}</span>
        <span>${escapeHtml(profile.timezone || "Europe/Moscow")}</span>
        <span>${money(profile.hourly_price || 0)}</span>
      </div>
      <p>${escapeHtml(profile.description || "Заполни описание, чтобы ученики понимали формат занятий и подготовки.")}</p>
      <div class="tag-row">
        ${(profile.subjects || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        ${(profile.directions || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </section>
  `;
}

function tutorProfileForm(profile = state.payload?.tutor_profile || {}) {
  return `
    <form class="edit-form" data-form="tutor-profile">
      ${field("first_name", "Имя / название школы", profile.first_name || "")}
      ${field("last_name", "Фамилия", profile.last_name || "")}
      ${field("public_slug", "Username публичной страницы", profile.public_slug || "")}
      ${field("photo_url", "Фото", profile.photo_url || "")}
      ${textareaField("description", "Описание", profile.description || "")}
      ${field("timezone", "Часовой пояс", profile.timezone || "Europe/Moscow")}
      ${field("subjects", "Предметы через запятую", (profile.subjects || []).join(", "))}
      ${field("directions", "Подготовки через запятую", (profile.directions || []).join(", "))}
      ${field("experience_years", "Стаж, лет", profile.experience_years || 0, "number")}
      ${field("hourly_price", "Стоимость занятия", profile.hourly_price || 0, "number")}
      <button class="primary-button" type="submit">Сохранить профиль</button>
    </form>
  `;
}

function renderFab() {
  return `
    <div class="fab-wrap">
      <div class="fab-menu" hidden>
        <button data-action="quick-student">Добавить ученика</button>
        <button data-action="quick-lesson">Разовая запись</button>
        <button data-action="quick-schedule">Стабильное расписание</button>
        <button data-action="quick-closed-slot">Нерабочие часы</button>
        <button data-action="quick-homework">Создать домашку</button>
        <button data-action="quick-payment">Добавить оплату</button>
      </div>
      <button class="fab" data-action="toggle-fab">+</button>
    </div>
  `;
}

function closeFabMenu() {
  document.querySelector(".fab-menu")?.setAttribute("hidden", "");
}

function lockBackgroundScroll() {
  if (document.body.classList.contains("modal-open")) return;
  const scrollTop = currentScrollTop();
  document.body.dataset.modalScrollTop = String(scrollTop);
  document.body.style.top = `-${scrollTop}px`;
  document.body.classList.add("modal-open");
}

function unlockBackgroundScroll() {
  if (!document.body.classList.contains("modal-open")) return;
  const scrollTop = Number(document.body.dataset.modalScrollTop || 0);
  document.body.classList.remove("modal-open");
  document.body.style.top = "";
  delete document.body.dataset.modalScrollTop;
  restoreScrollTop(scrollTop);
}

function closeModal({ animate = false } = {}) {
  const backdrop = document.querySelector(".modal-backdrop");
  if (!backdrop) {
    unlockBackgroundScroll();
    return;
  }
  if (!animate) {
    backdrop.remove();
    unlockBackgroundScroll();
    return;
  }
  backdrop.classList.add("modal-closing");
  window.setTimeout(() => {
    backdrop.remove();
    unlockBackgroundScroll();
  }, 180);
}

function attachModalSwipe(node) {
  const modal = node.querySelector(".modal");
  if (!modal) return;
  let startY = 0;
  let lastY = 0;
  let lastAt = 0;
  let velocity = 0;
  let dragging = false;
  let canDrag = false;

  const reset = () => {
    dragging = false;
    canDrag = false;
    modal.classList.remove("modal-dragging");
    modal.style.removeProperty("--modal-drag-y");
    node.style.removeProperty("--modal-drag-progress");
  };

  modal.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    startY = touch.clientY;
    lastY = startY;
    lastAt = performance.now();
    velocity = 0;
    canDrag = modal.scrollTop <= 1 || Boolean(event.target.closest(".modal-drag-handle, .detail-head"));
  }, { passive: true });

  modal.addEventListener("touchmove", (event) => {
    if (!canDrag || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const deltaY = y - startY;
    const now = performance.now();
    velocity = (y - lastY) / Math.max(now - lastAt, 1);
    lastY = y;
    lastAt = now;
    if (!dragging && deltaY <= 8) return;
    if (!dragging && modal.scrollTop > 1 && !event.target.closest(".modal-drag-handle, .detail-head")) return;
    dragging = true;
    event.preventDefault();
    const dragY = Math.max(0, deltaY);
    modal.classList.add("modal-dragging");
    modal.style.setProperty("--modal-drag-y", `${dragY}px`);
    node.style.setProperty("--modal-drag-progress", String(Math.min(dragY / Math.max(modal.clientHeight, 1), 0.55)));
  }, { passive: false });

  modal.addEventListener("touchend", () => {
    if (!dragging) {
      reset();
      return;
    }
    const dragY = Math.max(0, lastY - startY);
    const shouldClose = dragY >= Math.min(110, modal.clientHeight * 0.18) || (dragY > 48 && velocity > 0.55);
    if (shouldClose) {
      haptic();
      closeModal({ animate: true });
      return;
    }
    reset();
  }, { passive: true });

  modal.addEventListener("touchcancel", reset, { passive: true });
  node.addEventListener("click", (event) => {
    if (event.target === node) closeModal({ animate: true });
  });
}

function openModal(title, body) {
  document.querySelector(".modal-backdrop")?.remove();
  lockBackgroundScroll();
  const node = document.createElement("div");
  node.className = "modal-backdrop";
  node.innerHTML = `
    <section class="modal">
      <div class="modal-drag-handle" aria-hidden="true"></div>
      <div class="detail-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="modal-head-actions">
          <button class="icon-button" data-action="close-modal" type="button" aria-label="Закрыть">${icon("close")}</button>
        </div>
      </div>
      ${body}
    </section>
  `;
  document.body.append(node);
  node.addEventListener("change", (event) => syncProgressTaskFields(event.target));
  attachModalSwipe(node);
}

function enhanceModalActions(node) {
  return node;
}

function syncTopbarSubmitAction() {
  return;
}

async function showFreeSlotsFromForm(form = null, conflictDetail = null) {
  const activeForm = form || document.querySelector(".modal form[data-form='lesson-create'], .modal form[data-form='lesson-move']");
  state.slotTarget = activeForm
    ? {
        formType: activeForm.dataset.form,
        id: activeForm.dataset.id || "",
        studentId: activeForm.querySelector('[name="student_id"]')?.value || state.selectedStudentId || state.payload?.dashboard?.student?.id || "",
      }
    : {
        formType: "lesson-create",
        id: "",
        studentId: state.selectedStudentId || state.payload?.dashboard?.student?.id || "",
      };
  const duration = Number(activeForm?.querySelector('[name="duration_minutes"]')?.value || defaultLessonDuration());
  const suggested = conflictDetail?.suggested_slots;
  const payload = suggested ? { slots: suggested, duration_minutes: duration } : await api(`/api/available-slots?duration_minutes=${duration}&days=14`);
  openModal(
    conflictDetail ? "Время занято" : "Свободные окна",
    freeSlotsView(payload.slots || [], conflictDetail?.conflicts || [], duration)
  );
}

function freeSlotsView(slots, conflicts = [], duration = 60) {
  const grouped = groupLessonsByDay(slots.map((slot, index) => ({ ...slot, id: index, starts_at: slotStart(slot) })));
  return `
    <section class="free-slots-view">
      ${conflicts.length ? `<p class="slot-warning">${escapeHtml(conflicts[0])}</p>` : ""}
      <p class="form-note">Выбери свободное окно. Я подставлю время в форму записи.</p>
      ${
        slots.length
          ? grouped
              .map(
                ([day, items]) => `
                  <div class="slot-day">
                    <h3>${weekdayTitle(day)}</h3>
                    <div class="slot-grid">
                      ${items
                        .map(
                          (slot) => `
                            <button class="slot-chip" data-action="pick-free-slot" data-start="${escapeHtml(slotStart(slot))}" data-duration="${duration}" type="button">
                              <strong>${formatTime(slotStart(slot))}</strong>
                              <span>${duration} мин</span>
                            </button>
                          `
                        )
                        .join("")}
                    </div>
                  </div>
                `
              )
              .join("")
          : emptyState("Свободных окон нет", "На ближайшие 14 дней подходящих окон не нашлось.")
      }
    </section>
  `;
}

function lessonForm(lesson = null, defaults = {}) {
  const students = state.payload.admin?.students || [state.payload.dashboard?.student].filter(Boolean);
  const selectedId = defaults.student_id || state.selectedStudentId || lesson?.student_id || state.payload.dashboard?.student?.id;
  const duration = defaults.duration_minutes || lesson?.duration_minutes || defaultLessonDuration(selectedId);
  const startsAt = defaults.starts_at || (lesson ? lessonStart(lesson) : "") || defaultDateTimeLocal();
  return `
    <form class="edit-form" data-form="${lesson ? "lesson-edit" : "lesson-create"}" data-id="${lesson?.id || ""}">
      ${
        state.payload.role === "tutor"
          ? `<label><span>Ученик</span><select name="student_id" ${lesson ? "disabled" : ""}>${students.map((student) => `<option value="${student.id}" ${selectedId === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>`
          : ""
      }
      ${field("starts_at", "Дата и время", String(startsAt || "").slice(0, 16), "datetime-local")}
      ${field("duration_minutes", "Длительность", duration, "number")}
      ${
        state.payload.role === "tutor"
          ? `${radioButtonsField("status", "Статус занятия", lessonStatuses, lesson?.status || "запланировано")}
             ${radioButtonsField("payment_status", "Статус оплаты", paymentStatuses, lesson?.payment_status || "не отмечено")}
             ${field("payment_amount", "Стоимость", lesson?.price || "", "number")}
             ${textareaField("notes", "Заметки", lesson?.notes || "")}`
          : ""
      }
      ${!lesson ? `<button class="mini-button full" type="button" data-action="show-free-slots">Показать свободные окна</button>` : ""}
      <button class="primary-button" type="submit">Готово</button>
    </form>
  `;
}

function moveLessonForm(lesson) {
  return `
    <form class="edit-form" data-form="lesson-move" data-id="${lesson.id}">
      ${field("starts_at", "Новое время", (lessonStart(lesson) || defaultDateTimeLocal()).slice(0, 16), "datetime-local")}
      ${field("duration_minutes", "Длительность", lesson.duration_minutes || 60, "number")}
      <button class="mini-button full" type="button" data-action="show-free-slots">Показать свободные окна</button>
      <p class="form-note full">После отправки преподаватель подтвердит перенос или отклонит заявку.</p>
      <button class="primary-button" type="submit">Отправить перенос</button>
    </form>
  `;
}

function studentForm() {
  return `
    <form class="edit-form" data-form="student-create">
      ${field("full_name", "Имя", "")}
      ${field("grade", "Класс", "")}
      ${timezoneField("МСК+0")}
      ${field("lesson_price", "Стоимость за 1 час", "", "number")}
      ${selectField("prep_type", "Вид подготовки", prepTypes, "ЕГЭ")}
      ${field("subject", "Предмет", "Информатика")}
      ${field("goal", "Цель", "")}
      ${field("student_telegram", "Контакт ученика", "")}
      ${field("parent_name", "Имя родителя", "")}
      ${field("parent_telegram", "Контакт родителя", "")}
      ${field("board_url", "Ссылка на доску", "")}
      ${field("meeting_url", "Ссылка на звонок", "")}
      ${textareaField("comment", "Комментарии", "")}
      <button class="primary-button" type="submit">Добавить ученика</button>
    </form>
  `;
}

function paymentForm() {
  const students = state.payload.admin?.students || [];
  const selectedId = state.selectedStudentId || students[0]?.id || "";
  return `
    <form class="edit-form" data-form="payment-create">
      <label><span>Ученик</span><select name="student_id">${students.map((student) => `<option value="${student.id}" ${selectedId === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>
      ${field("amount", "Сумма", "", "number")}
      ${field("lessons_count", "Оплачено занятий", 1, "number")}
      ${textareaField("comment", "Комментарий", "")}
      <button class="primary-button" type="submit">Добавить оплату</button>
    </form>
  `;
}

function scheduleRuleForm(studentId = null) {
  const students = state.payload.admin?.students || [];
  const selectedId = studentId || state.selectedStudentId || state.payload.dashboard?.student?.id;
  return `
    <form class="edit-form" data-form="schedule-rule">
      ${
        state.payload.role === "tutor"
          ? `<label><span>Ученик</span><select name="student_id">${students.map((student) => `<option value="${student.id}" ${selectedId === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>`
          : ""
      }
      <div class="schedule-slots full" data-schedule-slots>
        ${scheduleSlotRow(1, "18:00")}
      </div>
      <button class="mini-button full" type="button" data-action="add-schedule-slot">Добавить день и время</button>
      ${field("duration_minutes", "Длительность", 60, "number")}
      ${field("starts_at", "Начать с", new Date().toISOString().slice(0, 10), "date")}
      ${field("ends_at", "Создать до", "", "date")}
      <button class="primary-button" type="submit">Добавить стабильное расписание</button>
    </form>
  `;
}

function scheduleSlotRow(day = 1, lessonTime = "18:00") {
  return `
    <div class="schedule-slot-row">
      <label>
        <span>День</span>
        <select name="slot_weekday">
          ${weekdays.map(([value, label]) => `<option value="${value}" ${value === day ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      ${field("slot_time", "Время", lessonTime, "time")}
      <button class="icon-button" type="button" data-action="remove-schedule-slot" aria-label="Удалить слот">${icon("close")}</button>
    </div>
  `;
}

function closedSlotForm() {
  return `
    <form class="edit-form" data-form="closed-slot">
      ${field("starts_at", "Начало", defaultDateTimeLocal(12), "datetime-local")}
      ${field("ends_at", "Конец", defaultDateTimeLocal(13), "datetime-local")}
      ${textareaField("reason", "Причина", "")}
      <button class="primary-button" type="submit">Закрыть время</button>
    </form>
  `;
}

function homeworkForm(homework = null) {
  const students = state.payload.admin.students || [];
  return `
    <form class="edit-form" data-form="${homework ? "homework-edit" : "homework-create"}" data-id="${homework?.id || ""}">
      <label><span>Ученик</span><select name="student_id" ${homework ? "disabled" : ""}>${students.map((student) => `<option value="${student.id}" ${homework?.student_id === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>
      ${field("title", "Название", homework?.title || "")}
      ${textareaField("text", "Описание", homework?.description || homework?.text || "")}
      ${field("links", "Ссылки через запятую", homework?.links?.join(", ") || "")}
      <label class="full">
        <span>Фото или файлы</span>
        <input name="attachments_file" type="file" multiple />
      </label>
      ${textareaField("attachments", "Ссылки на файлы через запятую", homework?.attachments?.join(", ") || "")}
      <label>
        <span>Дедлайн</span>
        <input name="deadline" type="datetime-local" step="3600" value="${escapeHtml((homework?.deadline || "").slice(0, 16))}" />
      </label>
      ${selectField("status", "Статус", homeworkStatuses, homework?.status || "ожидание выполнения")}
      ${textareaField("teacher_comment", "Комментарий", homework?.teacher_comment || "")}
      <button class="primary-button" type="submit">Готово</button>
    </form>
  `;
}

async function handleFormSubmit(form) {
  const type = form.dataset.form;
  const preserveScroll = ["progress-update", "progress-note", "plan-create"].includes(form.dataset.form);
  const scrollTop = preserveScroll ? currentScrollTop() : 0;
  const data = Object.fromEntries(new FormData(form).entries());
  const formData = new FormData(form);
  for (const key of ["student_id", "duration_minutes", "estimated_minutes", "lesson_price", "payment_amount", "progress_current", "progress_goal", "balance_lessons", "task_number", "knowledge_level", "amount", "lessons_count", "hourly_price", "experience_years"]) {
    if (data[key] !== undefined && data[key] !== "") data[key] = Number(data[key]);
  }
  if (formData.has("subjects")) data.subjects = formData.getAll("subjects").map((item) => String(item).trim()).filter(Boolean);
  else if (data.subjects !== undefined) data.subjects = String(data.subjects).split(",").map((item) => item.trim()).filter(Boolean);
  if (formData.has("directions")) data.directions = formData.getAll("directions").map((item) => String(item).trim()).filter(Boolean);
  else if (data.directions !== undefined) data.directions = String(data.directions).split(",").map((item) => item.trim()).filter(Boolean);
  if (data.custom_subjects) data.subjects = [...(data.subjects || []), ...String(data.custom_subjects).split(",").map((item) => item.trim()).filter(Boolean)];
  if (data.custom_directions) data.directions = [...(data.directions || []), ...String(data.custom_directions).split(",").map((item) => item.trim()).filter(Boolean)];
  delete data.custom_subjects;
  delete data.custom_directions;
  if (data.parent_can_edit !== undefined) data.parent_can_edit = data.parent_can_edit === "true";
  if (form.dataset.form === "schedule-rule") {
    const days = formData.getAll("slot_weekday").map(Number);
    const times = formData.getAll("slot_time");
    data.slots = days
      .map((weekday, index) => ({ weekday, lesson_time: times[index] }))
      .filter((slot) => slot.weekday && slot.lesson_time);
    delete data.slot_weekday;
    delete data.slot_time;
  }
  if (data.links !== undefined) data.links = data.links.split(",").map((item) => item.trim()).filter(Boolean);
  if (data.attachments !== undefined) {
    data.attachments = data.attachments.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const files = form.querySelector('[name="attachments_file"]')?.files || [];
  if (files.length) {
    const encoded = await Promise.all([...files].map(fileToDataUrl));
    data.attachments = [...(data.attachments || []), ...encoded];
  }
  delete data.attachments_file;
  if (data.starts_at === "") delete data.starts_at;
  if (data.ends_at === "") delete data.ends_at;
  if (data.deadline === "") delete data.deadline;
  if (data.email === "" && type !== "email-login") delete data.email;
  if (data.deadline !== undefined && (type === "homework-create" || type === "homework-edit")) {
    data.deadline = `${String(data.deadline).slice(0, 13)}:00`;
  }
  if (data.task_number === "") delete data.task_number;
  if (data.title === "") delete data.title;

  if (type === "email-login") {
    const result = await api("/api/auth/email/login", { method: "POST", body: JSON.stringify(data) });
    storeAuth(result, data.email);
  } else if (type === "create-tutor" || type === "create-school") {
    data.workspace_type = type === "create-school" ? "school" : "tutor";
    const endpoint = localStorage.getItem("crm_access") ? "/api/onboarding/workspace" : "/api/tutors/register";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(data) });
    storeAuth(result, data.email);
  } else if (type === "tutor-profile") {
    await api("/api/tutor/profile", { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "register-student" || type === "register-parent") {
    data.role = type === "register-parent" ? "parent" : "student";
    const endpoint = localStorage.getItem("crm_access") ? "/api/register" : "/api/public/register";
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(data) });
    storeAuth(result, data.email);
  } else if (type === "student") {
    await api(`/api/admin/students/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
    state.editingStudent = false;
  } else if (type === "self-student") {
    await api("/api/me/student", { method: "PATCH", body: JSON.stringify(data) });
    state.editingSelf = false;
  } else if (type === "student-create") {
    await api("/api/admin/students", { method: "POST", body: JSON.stringify(data) });
  } else if (type === "lesson-create") {
    await api(state.payload.role === "tutor" ? "/api/admin/lessons" : "/api/book", { method: "POST", body: JSON.stringify(data) });
  } else if (type === "lesson-edit") {
    await api(`/api/admin/lessons/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "lesson-move") {
    await api(`/api/lessons/${form.dataset.id}/move`, { method: "POST", body: JSON.stringify(data) });
  } else if (type === "homework-create") {
    await api("/api/admin/homework", { method: "POST", body: JSON.stringify(data) });
  } else if (type === "homework-edit") {
    await api(`/api/admin/homework/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "schedule-rule") {
    await api("/api/schedule-rules", { method: "POST", body: JSON.stringify(data) });
  } else if (type === "closed-slot") {
    await api("/api/admin/closed-slots", { method: "POST", body: JSON.stringify(data) });
  } else if (type === "payment-create") {
    await api("/api/admin/payments", { method: "POST", body: JSON.stringify(data) });
  } else if (type === "progress-update") {
    await api(`/api/students/${form.dataset.id}/progress`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "progress-note") {
    await api(`/api/students/${form.dataset.id}/progress`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "plan-create") {
    await api(`/api/students/${form.dataset.id}/plan`, { method: "POST", body: JSON.stringify(data) });
  }
  closeModal();
  await load({ preserveScroll, scrollTopOverride: scrollTop });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function attachHandlers() {
  syncTopbarSubmitAction();
  app.onclick = async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = Number(target.dataset.id || 0);
    haptic();
    if (action === "onboarding-role") {
      state.onboardingRole = target.dataset.role || "";
      state.onboardingPlan = "";
      renderOnboarding(state.payload || { registration: { email: localStorage.getItem("crm_email") || "", telegram_name: "" } });
    } else if (action === "scroll-onboarding") {
      document.querySelector("#start")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "scroll-marketing") {
      document.querySelector("#marketing")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "onboarding-plan") {
      state.onboardingPlan = target.dataset.plan || "standart";
      renderOnboarding(state.payload || { registration: { email: localStorage.getItem("crm_email") || "", telegram_name: "" } });
    } else if (action === "onboarding-plan-back") {
      state.onboardingPlan = "";
      renderOnboarding(state.payload || { registration: { email: localStorage.getItem("crm_email") || "", telegram_name: "" } });
    } else if (action === "onboarding-back") {
      state.onboardingRole = "";
      state.onboardingPlan = "";
      renderOnboarding(state.payload || { registration: { email: localStorage.getItem("crm_email") || "", telegram_name: "" } });
    } else if (action === "open-student") {
      state.selectedStudentId = id;
      state.editingStudent = false;
      state.activeView = "student-detail";
      renderTutor(state.payload);
    } else if (action === "close-student") {
      state.selectedStudentId = null;
      state.editingStudent = false;
      state.activeView = "students";
      renderTutor(state.payload);
    } else if (action === "edit-student") {
      state.editingStudent = true;
      renderTutor(state.payload);
    } else if (action === "view-student") {
      state.editingStudent = false;
      renderTutor(state.payload);
    } else if (action === "save-student") {
      const form = document.querySelector(`#student-edit-${id}`);
      form?.requestSubmit();
    } else if (action === "delete-student") {
      const name = target.dataset.name || "ученика";
      const confirmed = confirm(`Удалить ${name}? Все уроки, домашки, оплаты и привязанные аккаунты этого ученика будут удалены.`);
      if (!confirmed) return;
      await api(`/api/admin/students/${id}`, { method: "DELETE" });
      state.selectedStudentId = null;
      state.editingStudent = false;
      state.activeView = "students";
      await load();
    } else if (action === "toggle-fab") {
      const menu = document.querySelector(".fab-menu");
      menu.toggleAttribute("hidden");
    } else if (action === "go-view") {
      setView(target.dataset.viewTarget);
    } else if (action === "scroll-pending") {
      setView("overview");
      document.querySelector("#pending-lessons-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "set-homework-filter") {
      state.filterHomework = target.dataset.value || "";
      state.payload.role === "tutor" ? renderTutor(state.payload) : renderClient(state.payload);
      attachHandlers();
    } else if (action === "toggle-calendar-archive") {
      state.showCalendarArchive = !state.showCalendarArchive;
      state.payload.role === "tutor" ? renderTutor(state.payload) : renderClient(state.payload);
      attachHandlers();
    } else if (action === "open-self-edit") {
      state.editingSelf = true;
      state.activeView = "profile";
      renderClient(state.payload);
      attachHandlers();
    } else if (action === "edit-self-profile") {
      state.editingSelf = true;
      renderClient(state.payload);
      attachHandlers();
    } else if (action === "view-self-profile") {
      state.editingSelf = false;
      renderClient(state.payload);
      attachHandlers();
    } else if (action === "save-self-profile") {
      document.querySelector("#self-student-edit-form")?.requestSubmit();
    } else if (action === "quick-lesson") {
      openModal("Новое занятие", lessonForm());
    } else if (action === "quick-free-slots") {
      await showFreeSlotsFromForm();
    } else if (action === "quick-homework") {
      openModal("Новая домашка", homeworkForm());
    } else if (action === "quick-student") {
      state.activeView = "students";
      openModal("Новый ученик", studentForm());
    } else if (action === "quick-schedule") {
      openModal("Стабильное расписание", scheduleRuleForm());
    } else if (action === "quick-closed-slot") {
      openModal("Нерабочие часы", closedSlotForm());
    } else if (action === "quick-payment") {
      openModal("Добавить оплату", paymentForm());
    } else if (action === "edit-tutor-profile") {
      openModal("Профиль репетитора", tutorProfileForm());
    } else if (action === "show-free-slots") {
      await showFreeSlotsFromForm(target.closest("form"));
    } else if (action === "pick-free-slot") {
      const startsAt = target.dataset.start || "";
      const duration = Number(target.dataset.duration || defaultLessonDuration());
      const slotTarget = state.slotTarget || {};
      if (slotTarget.formType === "lesson-move") {
        const source =
          state.payload.dashboard?.lessons?.find((item) => String(item.id) === String(slotTarget.id)) ||
          state.payload.admin?.calendar?.find((item) => String(item.id) === String(slotTarget.id));
        openModal("Перенести занятие", moveLessonForm({ ...source, id: slotTarget.id, starts_at: startsAt, duration_minutes: duration }));
      } else {
        openModal("Новое занятие", lessonForm(null, { starts_at: startsAt, duration_minutes: duration, student_id: slotTarget.studentId }));
      }
    } else if (action === "book-student") {
      state.selectedStudentId = id || state.selectedStudentId;
      openModal("Разовая запись", lessonForm());
    } else if (action === "stable-student") {
      openModal("Стабильное расписание", scheduleRuleForm(id || state.selectedStudentId));
    } else if (action === "add-schedule-slot") {
      const slots = target.closest("form")?.querySelector("[data-schedule-slots]");
      slots?.insertAdjacentHTML("beforeend", scheduleSlotRow(1, "18:00"));
    } else if (action === "remove-schedule-slot") {
      const slots = target.closest("[data-schedule-slots]");
      if (slots?.querySelectorAll(".schedule-slot-row").length > 1) target.closest(".schedule-slot-row")?.remove();
    } else if (action === "edit-progress") {
      openModal("Изменить прогресс", progressForm(id || state.selectedStudentId || state.payload.dashboard?.student?.id));
    } else if (action === "add-progress-note") {
      openModal("Новая заметка", progressNoteForm(id || state.selectedStudentId || state.payload.dashboard?.student?.id));
    } else if (action === "add-plan-item") {
      openModal("Пункт плана", planItemForm(id || state.selectedStudentId || state.payload.dashboard?.student?.id));
    } else if (action === "toggle-plan-item") {
      const studentId = Number(target.dataset.studentId || state.selectedStudentId || state.payload.dashboard?.student?.id || 0);
      const checked = target.checked;
      target.disabled = true;
      try {
        const result = await api(`/api/students/${studentId}/plan/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: checked ? "выполнено" : "не начато" }),
        });
        if (state.payload.dashboard?.student?.id === studentId) state.payload.dashboard.plan = result.plan;
        if (state.payload.admin?.plan_by_student) state.payload.admin.plan_by_student[studentId] = result.plan;
      } catch (error) {
        target.checked = !checked;
        alert(error.message);
      } finally {
        target.disabled = false;
      }
    } else if (action === "delete-progress-note") {
      const studentId = Number(target.dataset.studentId || state.selectedStudentId || state.payload.dashboard?.student?.id || 0);
      const scrollTop = currentScrollTop();
      if (confirm("Удалить заметку? Сам столбик прогресса останется.")) {
        await api(`/api/students/${studentId}/progress/${id}/note`, { method: "DELETE" });
        await load({ preserveScroll: true, scrollTopOverride: scrollTop });
      }
    } else if (action === "edit-lesson") {
      const lesson = findLessonById(id);
      openModal("Редактировать занятие", lessonForm(lesson));
    } else if (action === "edit-homework") {
      const homework = state.payload.admin.homeworks.find((item) => item.id === id);
      openModal("Редактировать домашку", homeworkForm(homework));
    } else if (action === "delete-homework") {
      if (confirm("Удалить домашку безвозвратно? Она исчезнет у ученика и родителя вместе со всеми сдачами.")) {
        await api(`/api/admin/homework/${id}`, { method: "DELETE" });
        closeModal();
        await load();
      }
    } else if (action === "open-homework") {
      const homework = state.payload.dashboard.homeworks.find((item) => item.id === id);
      openModal("Домашнее задание", homeworkDetail(homework));
    } else if (action === "confirm-lesson") {
      await api(`/api/admin/lessons/${id}`, { method: "PATCH", body: JSON.stringify({ payment_status: "подтверждено репетитором" }) });
      await load();
    } else if (action === "confirm-payment") {
      await api(`/api/admin/payments/${id}`, { method: "POST", body: JSON.stringify({ action: "confirm" }) });
      await load();
    } else if (action === "confirm-booking") {
      await api(`/api/admin/lessons/${id}/confirm`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } else if (action === "reject-booking") {
      await api(`/api/admin/lessons/${id}/reject`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } else if (action === "move-admin-lesson") {
      const lesson = findLessonById(id);
      openModal("Перенести занятие", moveLessonForm(lesson));
    } else if (action === "cancel-admin-lesson") {
      if (confirm("Отменить занятие? Ученику придет уведомление.")) {
        await api(`/api/lessons/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
        await load();
      }
    } else if (action === "delete-lesson") {
      if (confirm("Удалить занятие безвозвратно? Оно исчезнет из календаря.")) {
        await api(`/api/admin/lessons/${id}`, { method: "DELETE" });
        await load();
      }
    } else if (action === "delete-closed-slot") {
      if (confirm("Удалить нерабочее время?")) {
        await api(`/api/admin/closed-slots/${id}`, { method: "DELETE" });
        await load();
      }
    } else if (action === "mark-paid") {
      await api(`/api/lessons/${id}/mark-paid`, { method: "POST", body: JSON.stringify({}) });
      tg?.showAlert?.("Оплата отмечена. Репетитор проверит ее.");
      await load();
    } else if (action === "move-own-lesson") {
      const lesson = state.payload.dashboard.lessons.find((item) => item.id === id);
      openModal("Перенести занятие", moveLessonForm(lesson));
    } else if (action === "cancel-own-lesson") {
      if (confirm("Отменить занятие? Преподавателю придет уведомление.")) {
        await api(`/api/lessons/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
        await load();
      }
    } else if (action === "delete-self-profile") {
      if (confirm("Удалить профиль? Все занятия, домашки, оплаты и привязки к аккаунту будут удалены.")) {
        await api("/api/me/student", { method: "DELETE" });
        state.activeView = "overview";
        await load();
      }
    } else if (action === "submit-homework") {
      openModal("Сдать домашку", `
        <form class="edit-form" data-form="homework-submit" data-id="${id}">
          ${textareaField("text", "Решение или ссылка", "")}
          <button class="primary-button" type="submit">Отправить</button>
        </form>
      `);
    }
  };

  app.oninput = (event) => {
    const target = event.target;
    if (target.dataset.filter === "student-search") {
      state.studentSearch = target.value;
      renderTutor(state.payload);
      attachHandlers();
      const input = document.querySelector('[data-filter="student-search"]');
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    }
  };

  app.onchange = (event) => {
    const target = event.target;
    if (target.dataset.filter === "payment") state.filterPayment = target.value;
    if (target.dataset.filter === "homework") state.filterHomework = target.value;
    if (target.dataset.filter === "student-prep") state.studentPrepFilter = target.value;
    if (target.dataset.filter === "student-sort") state.studentSort = target.value;
    if (target.dataset.filter) {
      state.payload.role === "tutor" ? renderTutor(state.payload) : renderClient(state.payload);
      attachHandlers();
    }
    syncProgressTaskFields(target);
  };

  if (state.globalHandlersAttached) return;
  state.globalHandlersAttached = true;

  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (target?.closest("#app")) return;
    if (target?.dataset.action === "close-modal") {
      closeModal({ animate: true });
    } else if (target?.dataset.action === "show-free-slots") {
      showFreeSlotsFromForm(target.closest("form")).catch((error) => alert(error.message));
    } else if (target?.dataset.action === "quick-free-slots") {
      showFreeSlotsFromForm().catch((error) => alert(error.message));
    } else if (target?.dataset.action === "pick-free-slot") {
      const startsAt = target.dataset.start || "";
      const duration = Number(target.dataset.duration || defaultLessonDuration());
      const slotTarget = state.slotTarget || {};
      if (slotTarget.formType === "lesson-move") {
        const source =
          state.payload.dashboard?.lessons?.find((item) => String(item.id) === String(slotTarget.id)) ||
          state.payload.admin?.calendar?.find((item) => String(item.id) === String(slotTarget.id));
        openModal("Перенести занятие", moveLessonForm({ ...source, id: slotTarget.id, starts_at: startsAt, duration_minutes: duration }));
      } else {
        openModal("Новое занятие", lessonForm(null, { starts_at: startsAt, duration_minutes: duration, student_id: slotTarget.studentId }));
      }
    } else if (target?.dataset.action === "add-schedule-slot") {
      const slots = target.closest("form")?.querySelector("[data-schedule-slots]");
      slots?.insertAdjacentHTML("beforeend", scheduleSlotRow(1, "18:00"));
    } else if (target?.dataset.action === "remove-schedule-slot") {
      const slots = target.closest("[data-schedule-slots]");
      if (slots?.querySelectorAll(".schedule-slot-row").length > 1) target.closest(".schedule-slot-row")?.remove();
    } else if (target?.dataset.action === "save-progress") {
      const form = target.closest('form[data-form="progress-update"]');
      if (!form || form.dataset.submitting === "true") return;
      target.dataset.defaultText = target.textContent;
      target.textContent = "Сохраняю...";
      target.disabled = true;
      form.requestSubmit();
    }
  });

  document.body.addEventListener("submit", async (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";
    const submitButtons = form.querySelectorAll('[type="submit"]');
    const actionButtons = form.querySelectorAll('[data-action="save-progress"]');
    submitButtons.forEach((button) => {
      button.disabled = true;
    });
    if (form.dataset.form === "homework-submit") {
      try {
        const text = new FormData(form).get("text");
        await api(`/api/homework/${form.dataset.id}/submit`, { method: "POST", body: JSON.stringify({ text }) });
        closeModal();
        await load();
      } catch (error) {
        alert(error.message);
      } finally {
        form.dataset.submitting = "false";
        submitButtons.forEach((button) => {
          button.disabled = false;
        });
      }
      return;
    }
    try {
      await handleFormSubmit(form);
    } catch (error) {
      if (error.status === 409 && error.detail && typeof error.detail === "object") {
        await showFreeSlotsFromForm(form, error.detail);
        return;
      }
      alert(error.message);
    } finally {
      form.dataset.submitting = "false";
      submitButtons.forEach((button) => {
        button.disabled = false;
      });
      actionButtons.forEach((button) => {
        button.disabled = false;
        button.textContent = button.dataset.defaultText || "Готово";
      });
    }
  });
}

async function mountTelegramLoginWidget() {
  const config = await loadPublicConfig();
  const botUsername = config.telegram_bot_username || "crmtutor_bot";
  const holder = document.querySelector("#telegram-login-widget");
  const fallback = document.querySelector("#telegram-open-bot");
  if (fallback) fallback.href = `https://t.me/${encodeURIComponent(botUsername)}`;
  if (!holder) return;
  holder.replaceChildren();
  window.onCrmTutorTelegramAuth = async (user) => {
    try {
      const result = await api("/api/auth/telegram", {
        method: "POST",
        body: JSON.stringify({
          telegram_id: Number(user.id),
          username: user.username || "",
          first_name: user.first_name || "",
          last_name: user.last_name || "",
          photo_url: user.photo_url || "",
        }),
      });
      storeAuth(result);
      await load();
    } catch (error) {
      alert(error.message);
    }
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://telegram.org/js/telegram-widget.js?22";
  script.dataset.telegramLogin = botUsername;
  script.dataset.size = "large";
  script.dataset.radius = "10";
  script.dataset.userpic = "false";
  script.dataset.requestAccess = "write";
  script.dataset.onauth = "onCrmTutorTelegramAuth(user)";
  holder.append(script);
}

async function loginWithTelegramMiniApp() {
  const user = tg?.initDataUnsafe?.user;
  if (!user?.id) return false;
  const result = await api("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify({
      telegram_id: Number(user.id),
      username: user.username || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      photo_url: user.photo_url || "",
    }),
  });
  storeAuth(result);
  return true;
}

async function renderDevLogin() {
  renderOnboarding({ registration: { email: localStorage.getItem("crm_email") || "", telegram_name: "" } });
}

async function renderError(error) {
  if (!tg?.initData && (error.status === 401 || !localStorage.getItem("crm_access"))) {
    localStorage.removeItem("crm_access");
    localStorage.removeItem("crm_refresh");
    localStorage.removeItem("crm_workspace");
    await renderDevLogin();
    return;
  }
  updateProfileButton(null);
  app.innerHTML = `
    <section class="panel error-state">
      <h2>Не получилось открыть кабинет</h2>
      <p>${escapeHtml(error.message)}</p>
      <button class="primary-button" type="button" id="retry-button">Повторить</button>
    </section>
  `;
  tabbar.replaceChildren();
  document.querySelector("#retry-button").addEventListener("click", load);
}

function currentScrollTop() {
  if (document.body.classList.contains("modal-open")) {
    return Number(document.body.dataset.modalScrollTop || 0);
  }
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function restoreScrollTop(scrollTop) {
  requestAnimationFrame(() => {
    window.scrollTo({ top: scrollTop, behavior: "instant" });
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: "instant" }));
  });
}

async function load({ preserveScroll = false, scrollTopOverride = null } = {}) {
  const scrollTop = preserveScroll ? (scrollTopOverride ?? currentScrollTop()) : 0;
  try {
    if (tg?.initData && !localStorage.getItem("crm_access")) {
      await loginWithTelegramMiniApp();
    }
    app.innerHTML = skeleton();
    const payload = await api("/api/me");
    state.payload = payload;
    updateProfileButton(payload);
    if (payload.role === "guest") renderGuest(payload);
    else if (payload.role === "tutor") renderTutor(payload);
    else {
      renderClient(payload);
    }
    attachHandlers();
    if (preserveScroll) restoreScrollTop(scrollTop);
  } catch (error) {
    await renderError(error);
  }
}

refreshButton.addEventListener("click", load);
document.querySelector("#telegram-link-button")?.addEventListener("click", async () => {
  if (!localStorage.getItem("crm_access")) {
    await renderDevLogin();
    return;
  }
  try {
    const result = await api("/api/telegram/link", { method: "POST", body: JSON.stringify({}) });
    openModal(
      "Подключить Telegram",
      `
        <section class="telegram-connect">
          <p>Открой ссылку, чтобы бот связал Telegram с этим аккаунтом. После этого бот сможет отправлять напоминания, ДЗ, оплаты и рассылки.</p>
          <a class="primary-button telegram-link" href="${escapeHtml(result.deep_link)}" target="_blank" rel="noreferrer">Открыть Telegram</a>
          <p class="form-note">Токен: ${escapeHtml(result.token)}</p>
        </section>
      `
    );
  } catch (error) {
    await renderError(error);
  }
});
profileButton?.addEventListener("click", () => {
  if (!state.payload || !["student", "parent"].includes(state.payload.role)) return;
  haptic();
  state.activeView = "profile";
  state.editingSelf = false;
  renderClient(state.payload);
  attachHandlers();
});
initTelegramWebApp();
load();

async function syncDetectedTimezone(payload) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const student = payload.dashboard?.student;
  if (!timezone || !student || student.timezone === timezone) return;
  const key = `timezone:${payload.account.telegram_id}:${timezone}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  await api("/api/me/timezone", { method: "PATCH", body: JSON.stringify({ timezone }) }).catch(() => {});
}
