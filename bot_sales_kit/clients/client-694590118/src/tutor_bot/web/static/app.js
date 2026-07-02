const rawTelegramWebApp = window.Telegram?.WebApp;
const tg = rawTelegramWebApp?.initData ? rawTelegramWebApp : null;
const APP_VERSION = "20260615-backup-v25";
const params = new URLSearchParams(window.location.search);
const clientPathMatch = window.location.pathname.match(/^\/(client-\d+)(?:\/|$)/);
const basePath = clientPathMatch ? `/${clientPathMatch[1]}` : "";

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
  viewScrollTops: {},
  scrollRestoreTimers: [],
  hiddenAt: null,
  globalHandlersAttached: false,
  studentDetailBackView: "students",
  studentDetailBackScroll: 0,
};

const app = document.querySelector("#app");
const tabbar = document.querySelector("#tabbar");
const refreshButton = document.querySelector("#refresh-button");
const profileButton = document.querySelector("#profile-button");
const screenTitle = document.querySelector("#screen-title");

function syncTelegramViewportState() {
  document.body.classList.toggle("tg-webapp", Boolean(tg));
  document.body.classList.toggle("browser-webapp", !tg);
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
  ["homeworks", "ДЗ", "book"],
  ["finances", "Финансы", "wallet"],
  ["profile", "Профиль", "user"],
];

const clientTabs = [
  ["overview", "Обзор", "grid"],
  ["calendar", "Календарь", "calendar"],
  ["homeworks", "ДЗ", "book"],
  ["progress", "Прогресс", "chart"],
  ["finances", "Оплаты", "wallet"],
  ["profile", "Профиль", "user"],
];

const lessonStatuses = ["ожидает подтверждения", "запланировано", "проведено", "отменено", "перенесено"];
const paymentStatuses = ["не отмечено", "ученик отметил оплату", "родитель отметил оплату", "подтверждено репетитором", "не оплачено"];
const homeworkStatuses = [["ожидание выполнения", "в работе"], "выполнено", "отменено"];
const prepTypes = ["ОГЭ", "ЕГЭ", "Успеваемость", "Другое"];
const subjects = ["Математика", "Физика", "Информатика", "Высшая математика", "Университетская физика"];
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
  const result = { "X-App-Version": APP_VERSION };
  if (tg?.initData) result["X-Telegram-Init-Data"] = tg.initData;
  if (!tg?.initData && state.devUserId) result["X-Dev-Telegram-Id"] = state.devUserId;
  return result;
}

async function ensureFreshAppVersion() {
  const response = await fetch(`${basePath}/api/version?client=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`, {
    cache: "no-store",
    headers: headers(),
  });
  if (!response.ok) return true;
  const data = await response.json().catch(() => ({}));
  if (!data.version || data.version === APP_VERSION) return true;
  const url = new URL(window.location.href);
  url.searchParams.set("app_v", data.version);
  url.searchParams.set("reload", String(Date.now()));
  window.location.replace(url.toString());
  return false;
}

async function api(path, options = {}) {
  const response = await fetch(`${basePath}${path}`, {
    ...options,
    cache: "no-store",
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
  if (value.includes("ожидание выполнения") || value.includes("в работе")) return "work";
  if (value.includes("не оплач") || value.includes("отмен") || value.includes("исправ")) return "bad";
  if (value.includes("подтверж") || value.includes("оплачено") || value.includes("выполн") || value.includes("провед")) return "ok";
  if (value.includes("ожида") || value.includes("отметил") || value.includes("перенес")) return "warn";
  return "muted";
}

function statusLabel(value) {
  if (value === "ожидание выполнения") return "в работе";
  return value || "не задано";
}

function pill(value) {
  return `<span class="status ${statusClass(value)}">${escapeHtml(statusLabel(value))}</span>`;
}

function compactPill(value) {
  const labels = {
    "ожидает подтверждения": "ожид.",
    "запланировано": "план",
    "проведено": "провед.",
    "отменено": "отмен.",
    "перенесено": "перен.",
    "не отмечено": "не отмеч.",
    "оплачено": "оплач.",
    "не оплачено": "долг",
    "подтверждено репетитором": "оплач.",
    "ученик отметил оплату": "проверка",
    "родитель отметил оплату": "проверка",
  };
  return `<span class="status ${statusClass(value)}">${escapeHtml(labels[value] || value || "—")}</span>`;
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

function setView(view, { resetScroll = true } = {}) {
  const previousView = state.activeView;
  if (previousView && previousView !== view) state.viewScrollTops[previousView] = currentScrollTop();
  state.activeView = view;
  app.querySelectorAll("[data-view]").forEach((node) => {
    node.hidden = node.dataset.view !== view;
  });
  tabbar.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  profileButton?.classList.toggle("active", view === "profile");
  closeFabMenu();
  if (resetScroll && previousView !== view) {
    state.viewScrollTops[view] = 0;
    restoreScrollTop(0);
  }
}

function updateProfileButton(payload) {
  if (!profileButton) return;
  profileButton.disabled = true;
  profileButton.title = "BOTай CRM";
  profileButton.setAttribute("aria-label", "BOTай CRM");
  profileButton.innerHTML = '<span class="botai-logo-mark" aria-hidden="true">Б</span>';
}

function renderTabs(tabs) {
  tabbar.replaceChildren();
  for (const [view, label, iconName] of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.view = view;
    button.innerHTML = `${icon(iconName)}<span>${escapeHtml(label)}</span>`;
    button.addEventListener("touchstart", (event) => {
      activateViewFromControl(view, event);
    }, { passive: false });
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      brakeMomentumScroll();
    });
    button.addEventListener("click", () => {
      if (state.activeView !== view) activateViewFromControl(view);
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

function studentPaymentState(studentOrId) {
  const student = typeof studentOrId === "object" ? studentOrId : (state.payload?.admin?.students || []).find((item) => item.id === studentOrId);
  const studentId = typeof studentOrId === "object" ? studentOrId.id : studentOrId;
  if (Number(student?.stats?.unpaid_lessons || 0) > 0 || Number(student?.debt_amount || 0) > 0) return ["bad", "долг"];
  const lessons = visibleLessons().filter((lesson) => lesson.student_id === studentId);
  const unpaid = lessons.some((lesson) => lesson.payment_status === "не оплачено" || (lesson.status === "проведено" && lesson.payment_status === "не отмечено"));
  const pending = lessons.some((lesson) => String(lesson.payment_status).includes("отметил"));
  if (unpaid) return ["bad", "долг"];
  if (pending) return ["warn", "проверка"];
  return ["ok", "ок"];
}

function renderOverviewTutor(admin) {
  const next = admin.summary.next_lesson;
  const todayLessons = (admin.calendar || []).filter((lesson) => isSameDay(lesson.starts_at) && !String(lesson.status).includes("отмен"));
  const cancelledToday = (admin.calendar || []).filter((lesson) => isSameDay(lesson.starts_at) && String(lesson.status).includes("отмен"));
  const unpaidCount = admin.finances?.unpaid_lessons?.length || 0;
  const openHomework = (admin.homeworks || []).filter((item) => !["выполнено", "отменено"].includes(item.status)).length;
  return `
    <section class="overview-v3" data-view="overview">
      <div class="today-split-grid">
        <button class="today-card today-card-compact" data-action="go-view" data-view-target="calendar" type="button">
          <span>Сегодня</span>
          <strong>${todayLessons.length} уроков</strong>
        </button>
        <button class="today-card today-card-compact" data-action="go-view" data-view-target="finances" type="button">
          <span>Сегодня</span>
          <strong>${money(admin.summary.today_income || 0)}</strong>
        </button>
      </div>

      <div class="overview-mini-grid">
        <button class="metric metric-button" data-action="go-view" data-view-target="finances" type="button"><span>Ожидается</span><strong>${money(admin.summary.expected_income || 0)}</strong></button>
        <button class="metric metric-button debt-metric" data-action="go-view" data-view-target="finances" type="button"><span>Долги</span><strong>${money(admin.summary.debt_amount || admin.summary.expected_income || 0)}</strong></button>
        <button class="metric metric-button" data-action="go-view" data-view-target="homeworks" type="button"><span>Домашки</span><strong>${openHomework}</strong></button>
      </div>

      <section class="next-lesson-card next-lesson-compact">
        <span>Следующий урок</span>
        <strong>${next ? formatTime(lessonStart(next)) : "Нет"}</strong>
        <h2>${next ? escapeHtml(next.student_name || "Занятие") : "Свободное окно"}</h2>
        <p>${next ? `${next.duration_minutes} мин · ${money(next.price)}` : "На сегодня больше ничего"}</p>
        ${next ? `<button class="mini-button" data-action="edit-lesson" data-id="${next.id}" type="button">Открыть</button>` : `<button class="mini-button" data-action="quick-lesson" type="button">Добавить</button>`}
      </section>
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
                    const [payClass, payText] = studentPaymentState(student);
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
              : `<button class="mini-button" data-action="browser-invite" data-id="${student.id}">Ссылка доступа</button>
                 <button class="mini-button student-edit-button icon-text-button" data-action="edit-student" data-id="${student.id}">${iconLabel("edit", "Редактировать")}</button>`
          }
          <button class="icon-button student-close-button" data-action="close-student" aria-label="Закрыть карточку">${icon("close")}</button>
        </div>
      </div>
      ${edit ? studentEditForm(student) : studentProfileView(student, lessons, homeworks)}
      <div class="detail-section student-lessons-section">
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
        ${renderProgressChart({ student, topics }, student, true)}
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
      ${infoItem("1.5 часа", `${money(student.price_90 || 0)}`)}
      ${infoItem("2 часа", `${money(student.price_120 || 0)}`)}
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
      ${field("price_60", "Цена 1 час", student.price_60 || student.hourlyRate || 0, "number")}
      ${field("price_90", "Цена 1.5 часа", student.price_90 || 0, "number")}
      ${field("price_120", "Цена 2 часа", student.price_120 || 0, "number")}
      ${selectField("prep_type", "Вид подготовки", prepTypes, student.preparationType)}
      ${selectField("subject", "Предмет", subjects, student.subject || "Математика")}
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
      ${selectField("subject", "Предмет", subjects, student.subject || "Математика")}
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
  const stepAttr = type === "datetime-local" || type === "time" ? ' step="900"' : "";
  return `
    <label>
      <span>${label}</span>
      <input name="${name}" type="${type}"${stepAttr} value="${escapeHtml(value ?? "")}" />
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
                  <article class="lesson-row timeline-event ${statusClass(lesson.status)}" data-scroll-anchor="lesson-${lesson.id}">
                    <time>${formatTime(lessonStart(lesson))}</time>
                    <div class="lesson-main" data-action="edit-lesson" data-id="${lesson.id}">
                      <strong>${escapeHtml(lesson.student_name || "Занятие")}</strong>
                      <p>${lesson.duration_minutes} мин · ${money(lesson.price)} ${compact ? "" : `· ${escapeHtml(lesson.notes || "")}`}</p>
                      <div class="lesson-statuses">
                        ${compactPill(lesson.status)}
                        ${compactPill(lesson.payment_label || lesson.payment_status)}
                      </div>
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
        <button class="mini-button micro" data-action="confirm-booking" data-id="${lesson.id}" aria-label="Подтвердить">${icon("check")}</button>
        <button class="mini-button micro payment-icon" data-action="confirm-lesson" data-id="${lesson.id}" aria-label="Оплата прошла">₽</button>
        <button class="mini-button micro danger-icon lesson-delete-action" data-action="delete-lesson" data-id="${lesson.id}" aria-label="Удалить">${icon("trash")}</button>
      `;
    }
    return `
      <button class="mini-button micro" data-action="mark-conducted" data-id="${lesson.id}" aria-label="Проведено">${icon("check")}</button>
      <button class="mini-button micro payment-icon" data-action="confirm-lesson" data-id="${lesson.id}" aria-label="Оплата прошла">₽</button>
      <button class="mini-button micro danger-icon lesson-delete-action" data-action="delete-lesson" data-id="${lesson.id}" aria-label="Удалить">${icon("trash")}</button>
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
        <button class="calendar-action" data-action="quick-free-slots" type="button">${iconLabel("clock", "Окна")}</button>
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
            <article class="homework-row" ${editable ? `data-action="edit-homework" data-id="${homework.id}"` : `data-action="open-homework" data-id="${homework.id}"`}>
              <div class="homework-main">
                <strong>${escapeHtml(homework.title || "Домашнее задание")}</strong>
                <p>${escapeHtml(homework.student_name || "")} · ${formatDate(homework.deadline)}${homework.description ? ` · ${escapeHtml((homework.description || "").slice(0, 70))}` : ""}</p>
                ${homework.attachments?.length ? `<small>${homework.attachments.length} файл.</small>` : ""}
                ${homework.links?.length ? `<a href="${escapeHtml(homework.links[0])}" target="_blank" rel="noreferrer">Открыть ссылку</a>` : ""}
              </div>
              <div class="row-actions">
                ${pill(homework.status)}
                ${
                  editable
                    ? `<button class="mini-button micro danger-icon" data-action="delete-homework" data-id="${homework.id}" aria-label="Удалить домашку">${icon("trash")}</button>`
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
          ["ожидание выполнения", "В работе"],
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
        <article><span>Долги</span><strong>${money(finances.debt_amount || finances.expected_income || 0)}</strong></article>
      </section>
      ${renderIncomeChart(finances.income_events || payments)}
      ${isTutor ? renderAdvances(finances.advances || []) : ""}
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

function renderAdvances(items) {
  return `
    <div class="detail-section advance-section">
      <h3>Авансы</h3>
      ${
        items.length
          ? `<div class="stack">
              ${items
                .map(
                  (item) => `
                    <button class="finance-row advance-row" data-action="edit-advance" data-id="${item.payment_id || ""}" type="button" ${item.payment_id ? "" : "disabled"}>
                      <div>
                        <strong>${escapeHtml(item.student_name || "Ученик")}</strong>
                        <p>Внесен ${formatDateTime(item.confirmed_at || item.created_at)} · ${item.lessons_count || 0} зан. ${item.amount ? `· ${money(item.amount)}` : ""}</p>
                        <p>${item.lesson_covered_amount ? `Списано: ${money(item.lesson_covered_amount)}` : "Не списывались"}${item.debt_covered_amount ? ` · долг: ${money(item.debt_covered_amount)}` : ""}</p>
                      </div>
                      <span class="status ok">${item.remaining_lessons || 0} осталось</span>
                    </button>
                  `
                )
                .join("")}
            </div>`
          : emptyState("Авансов нет", "Ученики с оплаченными занятиями вперед появятся здесь.")
      }
    </div>
  `;
}

function findAdvanceById(id) {
  return (state.payload?.admin?.finances?.advances || []).find((item) => String(item.payment_id) === String(id));
}

function advanceForm(item) {
  return `
    <form class="edit-form" data-form="advance-edit" data-id="${item.payment_id}">
      <label class="full">
        <span>Ученик</span>
        <input value="${escapeHtml(item.student_name || "Ученик")}" disabled />
      </label>
      ${field("remaining_lessons", "Осталось сейчас", item.remaining_lessons || 0, "number")}
      ${field("lessons_count", "Внесено занятий", item.lessons_count || 0, "number")}
      ${field("amount", "Сумма", item.amount || 0, "number")}
      <label>
        <span>Когда внесен</span>
        <input name="confirmed_at" type="datetime-local" value="${escapeHtml(String(item.confirmed_at || item.created_at || "").slice(0, 16))}" />
      </label>
      <button class="primary-button" type="submit">Сохранить</button>
    </form>
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
      .filter((topic) => !isProgressNoteOnly(topic))
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

function isProgressNoteOnly(topic) {
  return !Number(topic?.knowledge_level || 0) && Boolean(String(topic?.comment || "").trim());
}

function customProgressTopics(topics, student) {
  if (examProgressGoal(student) > 0) return [];
  return (topics || [])
    .filter((topic) => topic?.id && !isProgressNoteOnly(topic))
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ru"));
}

function renderProgressChart(bundle, student, canEdit = false) {
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
      <div class="progress-chart ${isCustom ? "custom-progress" : ""} ${canEdit && isCustom ? "deletable-progress" : ""}">
        ${bars
          .map(
            (topic) => `
              <div class="bar-wrap" title="${escapeHtml(`${topic.title}: ${topic.knowledge_level || 0}/10`)}">
                <div class="bar" style="--bar-opacity:${Math.max(0.4, Math.min(1, (topic.knowledge_level || 0) / 10)).toFixed(2)}; height:${Math.max(4, Math.min(10, topic.knowledge_level || 0) * 10)}%"></div>
                ${canEdit && isCustom && topic.id ? `<button class="bar-delete-button" data-action="delete-progress-topic" data-id="${topic.id}" data-student-id="${student.id}" type="button" aria-label="Удалить ${escapeHtml(topic.title)}">${icon("trash")}</button>` : ""}
                <span title="${escapeHtml(topic.title)}">${escapeHtml(isCustom ? topic.title : String(topic.title).replace("Задание ", ""))}</span>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
    ${canEdit ? renderProgressTopicActions(bundle, student) : ""}
  `;
}

function renderProgressTopicActions(bundle, student) {
  return "";
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

function renderGuest(payload) {
  screenTitle.textContent = "Регистрация";
  const name = payload.registration?.telegram_name || "";
  app.innerHTML = `
    <section class="register-hero" data-view="overview">
      <p class="eyebrow">BOTай CRM</p>
      <h2>Создай кабинет</h2>
      <p>Расписание, домашки, прогресс и оплаты откроются сразу после регистрации.</p>
    </section>
    <section class="register-grid" data-view="overview">
      <form class="panel register-card edit-form" data-form="register-student">
        <h2 class="full">Я ученик</h2>
        ${field("full_name", "ФИО", name)}
        ${field("grade", "Класс", "")}
        ${timezoneField("МСК+0")}
        ${selectField("prep_type", "Подготовка", prepTypes, "ЕГЭ")}
        ${selectField("subject", "Предмет", subjects, "Математика")}
        ${field("goal", "Цель", "")}
        ${field("parent_name", "ФИО родителя", "")}
        ${field("parent_telegram", "Telegram родителя", "")}
        ${selectField("parent_can_edit", "Права родителя", [["false", "Только статистика и оплата"], ["true", "Может редактировать календарь"]], "false")}
        <button class="primary-button" type="submit">Создать кабинет ученика</button>
      </form>
      <form class="panel register-card edit-form" data-form="register-parent">
        <h2 class="full">Я родитель</h2>
        ${field("full_name", "ФИО родителя", name)}
        ${field("child_telegram", "Telegram ребенка", "")}
        ${timezoneField("МСК+0")}
        <p class="form-note full">Если ребенок уже заполнил анкету, кабинет привяжется к ней. Если нет, появится заготовка профиля.</p>
        <button class="primary-button" type="submit">Создать кабинет родителя</button>
      </form>
    </section>
  `;
  tabbar.replaceChildren();
  syncTopbarSubmitAction();
}

function renderClient(payload) {
  const bundle = payload.dashboard;
  const student = bundle.student;
  const unpaid = bundle.lessons.filter((item) => item.status === "проведено" && !["оплачено", "подтверждено репетитором"].includes(item.payment_status));
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
      ${renderProgressChart(bundle, student, canEditProgress)}
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
      ${renderProgressChart(bundle, student, canEditProgress)}
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

function renderTeacherProfile(profile = {}) {
  if (!profile) return "";
  const subjects = profile.subjects || [];
  const prepTypes = profile.prep_types || [];
  return `
    <section class="panel" data-view="profile">
      <div class="section-head compact-head">
        <h2>Репетитор</h2>
        ${profile.telegram_url ? `<a class="mini-button" href="${escapeHtml(profile.telegram_url)}" target="_blank" rel="noreferrer">Telegram</a>` : ""}
      </div>
      <div class="profile-sections">
        <div class="profile-block">
          <h3>${escapeHtml(profile.full_name || "Преподаватель")}</h3>
          <div class="info-grid compact-info">
            ${infoItem("Стаж", profile.experience || "не указан")}
            ${infoItem("Предметы", subjects.join(", ") || "не указаны")}
            ${infoItem("Подготовки", prepTypes.join(", ") || "не указаны")}
          </div>
        </div>
        <div class="profile-block">
          <h3>Описание</h3>
          <p>${escapeHtml(profile.description || "Описание появится здесь.")}</p>
        </div>
      </div>
    </section>
  `;
}

function renderTutor(payload) {
  const admin = payload.admin;
  const detail = state.selectedStudentId ? studentById(state.selectedStudentId) : null;
  screenTitle.textContent = `${admin.summary.students} учеников • ${admin.summary.week_lessons} уроков на неделе`;
  app.innerHTML = `
    ${renderOverviewTutor(admin)}
    ${renderStudents(admin)}
    ${detail ? renderStudentDetailShell(detail) : ""}
    ${renderCalendar(admin)}
    ${renderHomeworks(admin, true)}
    ${renderFinances(admin, true)}
    ${renderTutorProfile(admin)}
    ${renderFab()}
  `;
  renderTabs(tutorTabs);
  setView(state.activeView === "student-detail" && detail ? "student-detail" : tutorTabs.some(([view]) => view === state.activeView) ? state.activeView : "overview");
  syncTopbarSubmitAction();
}

function renderTutorProfile(admin) {
  const profile = admin.profile || {};
  return `
    <section class="panel" data-view="profile">
      <div class="section-head compact-head">
        <h2>Профиль репетитора</h2>
        <button class="mini-button" type="button" data-action="tutor-browser-invite">Ссылка кабинета</button>
      </div>
      <div class="profile-sections">
        <div class="profile-block">
          <h3>${escapeHtml(profile.full_name || "Репетитор")}</h3>
          <div class="info-grid compact-info">
            ${infoItem("Предметы", (profile.subjects || []).join(", ") || "не указаны")}
            ${infoItem("Подготовки", (profile.prep_types || []).join(", ") || "не указаны")}
          </div>
        </div>
      </div>
    </section>
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
      <fieldset class="form-section">
        <legend>Информация об уроке</legend>
        ${
          state.payload.role === "tutor"
            ? `<label><span>Ученик</span><select name="student_id" ${lesson ? "disabled" : ""}>${students.map((student) => `<option value="${student.id}" ${selectedId === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>`
            : ""
        }
        ${field("starts_at", "Дата и время", String(startsAt || "").slice(0, 16), "datetime-local")}
        ${field("duration_minutes", "Длительность", duration, "number")}
      </fieldset>
      ${
        state.payload.role === "tutor"
          ? `<fieldset class="form-section">
               <legend>Статус урока</legend>
               ${radioButtonsField("status", "Статус занятия", lessonStatuses, lesson?.status || "запланировано")}
             </fieldset>
             <fieldset class="form-section">
               <legend>Статус оплаты</legend>
               ${radioButtonsField("payment_status", "Статус оплаты", paymentStatuses, lesson?.payment_status || "не отмечено")}
             </fieldset>
             <fieldset class="form-section">
               <legend>Финансы</legend>
               ${field("payment_amount", "Стоимость", lesson?.price || "", "number")}
               ${textareaField("notes", "Заметки", lesson?.notes || "")}
             </fieldset>`
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
      ${field("price_60", "Цена 1 час", "", "number")}
      ${field("price_90", "Цена 1.5 часа", "", "number")}
      ${field("price_120", "Цена 2 часа", "", "number")}
      ${selectField("prep_type", "Вид подготовки", prepTypes, "ЕГЭ")}
      ${selectField("subject", "Предмет", subjects, "Математика")}
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

function browserInviteForm(studentId) {
  return `
    <form class="edit-form" data-form="browser-invite" data-id="${studentId}">
      <label>
        <span>Кому</span>
        <select name="role">
          <option value="student">Ученику</option>
          <option value="parent">Родителю</option>
        </select>
      </label>
      <label>
        <span>Вход будет работать</span>
        <select name="session_days">
          <option value="180">6 месяцев</option>
          <option value="365">1 год</option>
          <option value="30">30 дней</option>
        </select>
      </label>
      <label>
        <span>Ссылка активна</span>
        <select name="invite_days">
          <option value="3650">Постоянная</option>
          <option value="365">1 год</option>
          <option value="30">30 дней</option>
          <option value="7">7 дней</option>
          <option value="1">1 день</option>
        </select>
      </label>
      <button class="primary-button" type="button" data-action="create-browser-invite">Создать ссылку</button>
      <div class="full browser-invite-result" data-browser-invite-result></div>
    </form>
  `;
}

function tutorBrowserInviteForm() {
  return `
    <form class="edit-form" data-form="tutor-browser-invite">
      <label>
        <span>Вход будет работать</span>
        <select name="session_days">
          <option value="180">6 месяцев</option>
          <option value="365">1 год</option>
          <option value="30">30 дней</option>
        </select>
      </label>
      <label>
        <span>Ссылка активна</span>
        <select name="invite_days">
          <option value="3650">Постоянная</option>
          <option value="365">1 год</option>
          <option value="30">30 дней</option>
          <option value="7">7 дней</option>
          <option value="1">1 день</option>
        </select>
      </label>
      <button class="primary-button" type="button" data-action="create-tutor-browser-invite">Создать ссылку</button>
      <div class="full browser-invite-result" data-browser-invite-result></div>
    </form>
  `;
}

function renderBrowserInviteResult(payload, title, note) {
  const urls = Array.isArray(payload.urls) && payload.urls.length ? payload.urls : [payload.url];
  const rows = urls.map((url, index) => `
    <label class="full">
      <span>${index === 0 ? title : `Запасная ссылка ${index + 1}`}</span>
      <textarea readonly rows="3">${escapeHtml(url)}</textarea>
    </label>
    <button class="mini-button full" type="button" data-action="copy-browser-invite" data-url="${escapeHtml(url)}">${index === 0 ? "Скопировать" : `Скопировать запасную ${index + 1}`}</button>
  `).join("");
  return `
    ${rows}
    <p class="form-note full">${escapeHtml(note)}</p>
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
  const preserveScroll = true;
  const scrollTop = currentScrollTop();
  const data = Object.fromEntries(new FormData(form).entries());
  const formData = new FormData(form);
  for (const key of ["student_id", "duration_minutes", "estimated_minutes", "lesson_price", "price_60", "price_90", "price_120", "payment_amount", "progress_current", "progress_goal", "balance_lessons", "remaining_lessons", "task_number", "knowledge_level", "amount", "lessons_count"]) {
    if (data[key] !== undefined && data[key] !== "") data[key] = Number(data[key]);
  }
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
  else if (type === "homework-create" || type === "homework-edit") data.deadline = `${String(data.deadline).slice(0, 13)}:00`;
  if (data.task_number === "") delete data.task_number;
  if (data.title === "") delete data.title;

  if (type === "register-student" || type === "register-parent") {
    data.role = type === "register-parent" ? "parent" : "student";
    await api("/api/register", { method: "POST", body: JSON.stringify(data) });
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
  } else if (type === "advance-edit") {
    await api(`/api/admin/advances/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
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

async function reloadPreservingScroll(scrollTop = currentScrollTop(), scrollAnchor = null) {
  await load({ preserveScroll: true, scrollTopOverride: scrollTop, scrollAnchor });
}

function attachHandlers() {
  syncTopbarSubmitAction();
  app.onclick = async (event) => {
    if (event.target.closest("a")) return;
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = Number(target.dataset.id || 0);
    const actionScrollTop = currentScrollTop();
    const actionScrollAnchor = captureScrollAnchor(target);
    haptic();
    if (action === "open-student") {
      if (state.activeView !== "student-detail") {
        state.studentDetailBackView = state.activeView || "students";
        state.studentDetailBackScroll = currentScrollTop();
      }
      state.selectedStudentId = id;
      state.editingStudent = false;
      state.activeView = "student-detail";
      renderTutor(state.payload);
    } else if (action === "close-student") {
      const backView = state.studentDetailBackView || "students";
      const backScroll = state.studentDetailBackScroll || 0;
      state.selectedStudentId = null;
      state.editingStudent = false;
      state.activeView = backView;
      renderTutor(state.payload);
      restoreScrollTop(backScroll);
    } else if (action === "edit-student") {
      state.editingStudent = true;
      renderCurrentPayloadPreservingScroll();
    } else if (action === "view-student") {
      state.editingStudent = false;
      renderCurrentPayloadPreservingScroll();
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
      activateViewFromControl(target.dataset.viewTarget);
    } else if (action === "scroll-pending") {
      activateViewFromControl("overview");
      document.querySelector("#pending-lessons-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "set-homework-filter") {
      state.filterHomework = target.dataset.value || "";
      renderCurrentPayloadPreservingScroll();
    } else if (action === "toggle-calendar-archive") {
      state.showCalendarArchive = !state.showCalendarArchive;
      renderCurrentPayloadPreservingScroll();
    } else if (action === "open-self-edit") {
      state.editingSelf = true;
      state.activeView = "profile";
      renderClient(state.payload);
      attachHandlers();
    } else if (action === "edit-self-profile") {
      state.editingSelf = true;
      renderCurrentPayloadPreservingScroll();
    } else if (action === "view-self-profile") {
      state.editingSelf = false;
      renderCurrentPayloadPreservingScroll();
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
    } else if (action === "browser-invite") {
      openModal("Ссылка доступа", browserInviteForm(id || state.selectedStudentId));
    } else if (action === "tutor-browser-invite") {
      openModal("Ссылка кабинета", tutorBrowserInviteForm());
    } else if (action === "edit-advance") {
      const advance = findAdvanceById(id);
      if (advance) openModal("Редактировать аванс", advanceForm(advance));
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
    } else if (action === "delete-progress-topic") {
      const studentId = Number(target.dataset.studentId || state.selectedStudentId || state.payload.dashboard?.student?.id || 0);
      const scrollTop = currentScrollTop();
      if (confirm("Удалить тему прогресса?")) {
        await api(`/api/students/${studentId}/progress/${id}`, { method: "DELETE" });
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
      await api(`/api/admin/lessons/${id}`, { method: "PATCH", body: JSON.stringify({ payment_status: "оплачено" }) });
      await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
    } else if (action === "mark-conducted") {
      await api(`/api/admin/lessons/${id}`, { method: "PATCH", body: JSON.stringify({ status: "проведено" }) });
      await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
    } else if (action === "confirm-payment") {
      await api(`/api/admin/payments/${id}`, { method: "POST", body: JSON.stringify({ action: "confirm" }) });
      await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
    } else if (action === "confirm-booking") {
      await api(`/api/admin/lessons/${id}/confirm`, { method: "POST", body: JSON.stringify({}) });
      await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
    } else if (action === "reject-booking") {
      await api(`/api/admin/lessons/${id}/reject`, { method: "POST", body: JSON.stringify({}) });
      await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
    } else if (action === "move-admin-lesson") {
      const lesson = findLessonById(id);
      openModal("Перенести занятие", moveLessonForm(lesson));
    } else if (action === "cancel-admin-lesson") {
      if (confirm("Отменить занятие? Ученику придет уведомление.")) {
        await api(`/api/lessons/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
        await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
      }
    } else if (action === "delete-lesson") {
      if (confirm("Удалить занятие безвозвратно? Оно исчезнет из календаря.")) {
        await api(`/api/admin/lessons/${id}`, { method: "DELETE" });
        await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
      }
    } else if (action === "delete-closed-slot") {
      if (confirm("Удалить нерабочее время?")) {
        await api(`/api/admin/closed-slots/${id}`, { method: "DELETE" });
        await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
      }
    } else if (action === "mark-paid") {
      await api(`/api/lessons/${id}/mark-paid`, { method: "POST", body: JSON.stringify({}) });
      tg?.showAlert?.("Оплата отмечена. Репетитор проверит ее.");
      await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
    } else if (action === "move-own-lesson") {
      const lesson = state.payload.dashboard.lessons.find((item) => item.id === id);
      openModal("Перенести занятие", moveLessonForm(lesson));
    } else if (action === "cancel-own-lesson") {
      if (confirm("Отменить занятие? Преподавателю придет уведомление.")) {
        await api(`/api/lessons/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
        await reloadPreservingScroll(actionScrollTop, actionScrollAnchor);
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
      renderCurrentPayloadPreservingScroll();
    }
    syncProgressTaskFields(target);
  };

  if (state.globalHandlersAttached) return;
  state.globalHandlersAttached = true;
  document.body.addEventListener("click", async (event) => {
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
    } else if (target?.dataset.action === "create-browser-invite") {
      const form = target.closest('form[data-form="browser-invite"]');
      const result = form?.querySelector("[data-browser-invite-result]");
      if (!form || !result) return;
      target.disabled = true;
      target.dataset.defaultText = target.textContent;
      target.textContent = "Создаю...";
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.invite_days = Number(data.invite_days || 3650);
        data.session_days = Number(data.session_days || 180);
        const payload = await api(`/api/admin/students/${form.dataset.id}/browser-invites`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        result.innerHTML = renderBrowserInviteResult(
          payload,
          "Постоянная ссылка",
          "Эту ссылку можно открывать несколько раз. Если у человека не открывается с VPN, отправь запасную ссылку."
        );
      } catch (error) {
        result.innerHTML = `<p class="form-note full">${escapeHtml(error.message)}</p>`;
      } finally {
        target.disabled = false;
        target.textContent = target.dataset.defaultText || "Создать ссылку";
      }
    } else if (target?.dataset.action === "copy-browser-invite") {
      const url = target.dataset.url || "";
      navigator.clipboard?.writeText(url);
      target.textContent = "Скопировано";
      setTimeout(() => {
        target.textContent = "Скопировать";
      }, 1200);
    } else if (target?.dataset.action === "create-tutor-browser-invite") {
      const form = target.closest('form[data-form="tutor-browser-invite"]');
      const result = form?.querySelector("[data-browser-invite-result]");
      if (!form || !result) return;
      target.disabled = true;
      target.dataset.defaultText = target.textContent;
      target.textContent = "Создаю...";
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.invite_days = Number(data.invite_days || 3650);
        data.session_days = Number(data.session_days || 180);
        const payload = await api("/api/admin/browser-invites", {
          method: "POST",
          body: JSON.stringify(data),
        });
        result.innerHTML = renderBrowserInviteResult(
          payload,
          "Постоянная ссылка кабинета",
          "Эту ссылку можно открывать несколько раз. Храни ее как доступ к кабинету."
        );
      } catch (error) {
        result.innerHTML = `<p class="form-note full">${escapeHtml(error.message)}</p>`;
      } finally {
        target.disabled = false;
        target.textContent = target.dataset.defaultText || "Создать ссылку";
      }
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

function renderDevLogin() {
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (!isLocalHost) {
    screenTitle.textContent = "Личный кабинет";
    updateProfileButton(null);
    app.innerHTML = `
      <section class="panel error-state">
        <h2>Нужна ссылка доступа</h2>
        <p>Открой одноразовую ссылку от преподавателя. После первого входа кабинет будет работать в этом браузере.</p>
      </section>
    `;
    tabbar.replaceChildren();
    return;
  }
  screenTitle.textContent = "Локальный вход";
  updateProfileButton(null);
  app.innerHTML = `
    <section class="panel auth-panel">
      <h2>Локальная проверка</h2>
      <p>В Telegram авторизация не нужна: Mini App сам получает пользователя. Локально введи Telegram ID из базы.</p>
      <form class="edit-form" id="dev-form">
        ${field("telegram_id", "Telegram ID", state.devUserId)}
        <button class="primary-button" type="submit">Войти</button>
      </form>
    </section>
  `;
  tabbar.replaceChildren();
  document.querySelector("#dev-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.devUserId = String(new FormData(event.currentTarget).get("telegram_id") || "").trim();
    localStorage.setItem("tgDevUserId", state.devUserId);
    await load();
  });
}

function renderError(error) {
  if (!tg?.initData && !state.devUserId) {
    renderDevLogin();
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
  return Math.max(
    window.scrollY || 0,
    document.scrollingElement?.scrollTop || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0
  );
}

function syncBrowserScrollShade() {
  document.body.classList.remove("browser-scrolled");
}

function setScrollTop(scrollTop) {
  window.scrollTo({ top: scrollTop, behavior: "auto" });
  for (const node of [
    document.scrollingElement,
    document.documentElement,
    document.body,
  ]) {
    if (!node) continue;
    node.scrollTop = scrollTop;
    node.scrollTo?.({ top: scrollTop, behavior: "auto" });
  }
}

function cancelScrollRestore() {
  for (const timer of state.scrollRestoreTimers) clearTimeout(timer);
  state.scrollRestoreTimers = [];
}

function restoreScrollTop(scrollTop) {
  cancelScrollRestore();
  const apply = () => setScrollTop(scrollTop);
  apply();
  requestAnimationFrame(() => {
    apply();
    state.scrollRestoreTimers = [setTimeout(apply, 64)];
  });
}

function resetScrollForAppEntry() {
  state.viewScrollTops[state.activeView] = 0;
  restoreScrollTop(0);
}

function brakeMomentumScroll() {
  cancelScrollRestore();
  setScrollTop(currentScrollTop());
  document.activeElement?.blur?.();
}

function activateViewFromControl(view, event = null) {
  if (event?.cancelable) event.preventDefault();
  if (state.activeView === view) {
    brakeMomentumScroll();
    return;
  }
  brakeMomentumScroll();
  haptic();
  setView(view, { resetScroll: true });
}

function captureScrollAnchor(source) {
  const node = source?.closest?.("[data-scroll-anchor]");
  if (!node?.dataset.scrollAnchor) return null;
  return {
    key: node.dataset.scrollAnchor,
    top: node.getBoundingClientRect().top,
  };
}

function restoreScrollAnchor(anchor, fallbackScrollTop = currentScrollTop()) {
  if (!anchor?.key) {
    restoreScrollTop(fallbackScrollTop);
    return;
  }
  const selector = `[data-scroll-anchor="${anchor.key}"]`;
  const apply = () => {
    const node = document.querySelector(selector);
    if (!node) {
      setScrollTop(fallbackScrollTop);
      return;
    }
    const delta = node.getBoundingClientRect().top - anchor.top;
    setScrollTop(Math.max(0, currentScrollTop() + delta));
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    state.scrollRestoreTimers = [setTimeout(apply, 64)];
  });
}

function renderCurrentPayloadPreservingScroll() {
  const scrollTop = currentScrollTop();
  state.payload.role === "tutor" ? renderTutor(state.payload) : renderClient(state.payload);
  attachHandlers();
  restoreScrollTop(scrollTop);
}

async function load({ preserveScroll = true, scrollTopOverride = null, scrollAnchor = null } = {}) {
  const scrollTop = preserveScroll ? (scrollTopOverride ?? currentScrollTop()) : 0;
  try {
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
    if (preserveScroll) {
      if (scrollAnchor) restoreScrollAnchor(scrollAnchor, scrollTop);
      else restoreScrollTop(scrollTop);
    } else {
      restoreScrollTop(0);
    }
  } catch (error) {
    renderError(error);
  }
}

refreshButton.addEventListener("click", load);
profileButton?.addEventListener("click", () => {
  if (!state.payload || !["student", "parent"].includes(state.payload.role)) return;
  haptic();
  state.viewScrollTops[state.activeView] = currentScrollTop();
  state.activeView = "profile";
  state.editingSelf = false;
  renderClient(state.payload);
  attachHandlers();
  restoreScrollTop(0);
});
initTelegramWebApp();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    state.hiddenAt = Date.now();
    return;
  }
  if (state.hiddenAt && Date.now() - state.hiddenAt > 500) {
    resetScrollForAppEntry();
  }
  state.hiddenAt = null;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) resetScrollForAppEntry();
});
ensureFreshAppVersion()
  .then((fresh) => {
    if (fresh) load({ preserveScroll: false });
  })
  .catch(() => load({ preserveScroll: false }));

async function syncDetectedTimezone(payload) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const student = payload.dashboard?.student;
  if (!timezone || !student || student.timezone === timezone) return;
  const key = `timezone:${payload.account.telegram_id}:${timezone}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  await api("/api/me/timezone", { method: "PATCH", body: JSON.stringify({ timezone }) }).catch(() => {});
}
