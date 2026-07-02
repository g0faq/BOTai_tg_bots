const rawTelegramWebApp = window.Telegram?.WebApp;
const tg = rawTelegramWebApp?.initData ? rawTelegramWebApp : null;
const APP_VERSION = "20260702-amvera-runtime-v70";
const params = new URLSearchParams(window.location.search);
const clientPathMatch = window.location.pathname.match(/^\/(client-\d+)(?:\/|$)/);
const basePath = clientPathMatch ? `/${clientPathMatch[1]}` : "";

const state = {
  payload: null,
  activeView: "overview",
  selectedStudentId: null,
  studentDetailPayload: null,
  editingStudent: false,
  editingSelf: false,
  showCalendarArchive: false,
  calendarMode: "week",
  calendarFocusDate: "",
  filterPayment: "",
  filterHomework: "",
  studentSearch: "",
  studentPrepFilter: "",
  studentSort: "next",
  studentFiltersOpen: false,
  studentDetailTab: "profile",
  devUserId: params.get("dev_id") || localStorage.getItem("tgDevUserId") || "",
  slotTarget: null,
  viewScrollTops: {},
  scrollRestoreTimers: [],
  hiddenAt: null,
  globalHandlersAttached: false,
  studentDetailScrollResetTimers: [],
  studentDetailBackView: "students",
  studentDetailBackScroll: 0,
  operationsHistoryOpen: false,
};

const app = document.querySelector("#app");
const tabbar = document.querySelector("#tabbar");
const refreshButton = document.querySelector("#refresh-button");
const profileButton = document.querySelector("#profile-button");
const profileActionButton = document.querySelector("#profile-action-button");
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
    tg.requestFullscreen?.();
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
    syncTelegramViewportState();
  } catch (error) {
    console.log("Telegram WebApp init failed:", error);
  }
}

const tutorTabs = [
  ["overview", "Обзор", "grid"],
  ["students", "Ученики", "users"],
  ["calendar", "Кален.", "calendar"],
  ["homeworks", "ДЗ", "book"],
  ["finances", "Фин.", "wallet"],
];

const clientTabs = [
  ["overview", "Обзор", "grid"],
  ["calendar", "Кален.", "calendar"],
  ["homeworks", "ДЗ", "book"],
  ["progress", "Прогр.", "chart"],
  ["finances", "Оплаты", "wallet"],
];

const lessonStatuses = ["ожидает подтверждения", "запланировано", "проведено", "отменено", "перенесено"];
const paymentStatuses = ["не отмечено", "ученик отметил оплату", "родитель отметил оплату", "оплачено", "не оплачено"];
const homeworkStatuses = [["ожидание выполнения", "в работе"], "сдано", "сдано с опозданием", "выполнено", "отменено"];
const defaultSubjects = ["Информатика", "Математика", "Русский язык", "Физика", "Химия", "Биология", "Английский язык", "Обществознание", "История", "Литература"];
const defaultPrepTypes = ["ЕГЭ", "ОГЭ", "Школьная программа", "ВПР", "ДВИ", "Олимпиады", "Python"];
const knowledgeLevels = ["с нуля", "база", "средний", "сильный", "другое"];
const prepTypes = [...defaultPrepTypes, "другое"];
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
  if (url.searchParams.get("app_v") === data.version) return true;
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

function formatHours(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0 ч";
  const rounded = Math.round(numeric * 100) / 100;
  return `${rounded.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ч`;
}

function lessonHours(lesson) {
  return Math.round((Number(lesson?.duration_minutes || 60) / 60) * 100) / 100;
}

function formatDate(value) {
  if (!value) return "нет";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "нет";
  return `${formatDate(value)}, ${formatTime(value)}`;
}

function formatWeekdayDate(value) {
  if (!value) return "нет";
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
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

function teacherProfile() {
  return state.payload?.teacher_profile || state.payload?.admin?.profile || {};
}

function tutorProfileSubjects() {
  return teacherProfile().subjects || [];
}

function tutorPrepTypes() {
  return [...new Set([...(teacherProfile().prep_types || []), ...defaultPrepTypes, "другое"])];
}

function tutorSubjectValues() {
  return [...new Set([...tutorProfileSubjects(), ...defaultSubjects, "другое"])];
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
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date).replace(".", "");
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
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
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
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
  if (value.includes("подтверж") || value.includes("оплачено") || value.includes("выполн") || value.includes("провед") || value.includes("сдано")) return "ok";
  if (value.includes("ожида") || value.includes("отметил") || value.includes("перенес")) return "warn";
  return "muted";
}

function statusTone(value) {
  const tone = statusClass(value);
  if (tone === "ok") return "ok";
  if (tone === "bad") return "bad";
  if (tone === "warn" || tone === "work") return "warn";
  return "muted";
}

function statusLabel(value) {
  if (value === "ожидание выполнения") return "в работе";
  if (value === "подтверждено репетитором") return "оплачено";
  return value || "не задано";
}

function shortStatusLabel(value) {
  const labels = {
    "ожидает подтверждения": "Ожидает",
    "запланировано": "Запланировано",
    "проведено": "Проведено",
    "отменено": "Отменено",
    "перенесено": "Перенос",
    "не отмечено": "Не отмечено",
    "ученик отметил оплату": "Оплатил",
    "родитель отметил оплату": "Оплатил родитель",
    "оплачено": "Оплачено",
    "не оплачено": "Не оплачено",
  };
  return labels[value] || statusLabel(value);
}

function pill(value) {
  return `<span class="status ${statusClass(value)}">${escapeHtml(statusLabel(value))}</span>`;
}

function compactPill(value) {
  const labels = {
    "ожидает подтверждения": "ожидает",
    "запланировано": "запланировано",
    "проведено": "проведено",
    "отменено": "отменено",
    "перенесено": "перенесено",
    "не отмечено": "не отмечено",
    "оплачено": "оплачено",
    "не оплачено": "не оплачено",
    "подтверждено репетитором": "оплачено",
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
  if (previousView === "finances" && view !== "finances") {
    state.operationsHistoryOpen = false;
    document.querySelectorAll(".operations-history[open]").forEach((node) => {
      node.removeAttribute("open");
    });
  }
  state.activeView = view;
  app.querySelectorAll("[data-view]").forEach((node) => {
    node.hidden = node.dataset.view !== view;
  });
  tabbar.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  profileButton?.classList.toggle("active", view === "profile");
  profileActionButton?.classList.toggle("active", view === "profile");
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
  profileButton.innerHTML = '<img class="botai-logo-img" src="/assets/botai-logo.svg?v=20260702-amvera-runtime-v70" alt="" aria-hidden="true" />';
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
    button.addEventListener("touchend", (event) => {
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
  return state.payload?.admin?.students?.find((student) => Number(student.id) === Number(id));
}

function studentDetailMatches(id) {
  return Number(state.studentDetailPayload?.student?.id || 0) === Number(id);
}

function studentDetailRecord(id) {
  return studentDetailMatches(id) ? state.studentDetailPayload.student : studentById(id);
}

async function loadStudentDetail(studentId, { throwOnError = false } = {}) {
  const numericId = Number(studentId || 0);
  if (!numericId) {
    state.studentDetailPayload = null;
    return null;
  }
  try {
    const payload = await api(`/api/admin/students/${numericId}`);
    if (Number(state.selectedStudentId || 0) === numericId) {
      state.studentDetailPayload = payload;
    }
    return payload;
  } catch (error) {
    if (Number(state.selectedStudentId || 0) === numericId) {
      state.studentDetailPayload = null;
    }
    if (throwOnError) throw error;
    console.error("Student detail load failed:", error);
    return null;
  }
}

function normalizedText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function lessonsForStudent(id) {
  if (studentDetailMatches(id)) {
    const detailLessons = [
      ...(state.studentDetailPayload?.lesson_archive || []),
      ...(state.studentDetailPayload?.lessons || []),
    ];
    const seen = new Set();
    return detailLessons
      .filter((lesson) => Number(lesson.student_id) === Number(id))
      .filter((lesson) => {
        const key = Number(lesson.id || 0);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(lessonStart(a)) - new Date(lessonStart(b)));
  }
  const source = [
    ...(state.payload?.admin?.calendar_archive || []),
    ...(state.payload?.admin?.calendar || []),
    ...(state.payload?.dashboard?.lesson_archive || []),
    ...(state.payload?.dashboard?.lessons || []),
  ];
  const seen = new Set();
  return source
    .filter((lesson) => Number(lesson.student_id) === Number(id))
    .filter((lesson) => {
      const key = Number(lesson.id || 0);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(lessonStart(a)) - new Date(lessonStart(b)));
}

function homeworksForStudent(id) {
  if (studentDetailMatches(id)) {
    return [...(state.studentDetailPayload?.homeworks || [])].sort(
      (a, b) => new Date(b.deadline || b.created_at || 0) - new Date(a.deadline || a.created_at || 0)
    );
  }
  const student = studentById(Number(id)) || state.payload?.dashboard?.student;
  const studentName = normalizedText(student?.name);
  const source = [
    ...(state.payload?.admin?.homeworks || []),
    ...(state.payload?.dashboard?.homeworks || []),
  ];
  const seen = new Set();
  return source.filter((homework) => {
    const byId = Number(homework.student_id) === Number(id);
    const byName = studentName && normalizedText(homework.student_name) === studentName;
    if (!byId && !byName) return false;
    const key = String(homework.id || `${homework.title}:${homework.deadline}:${homework.student_name}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.deadline || b.created_at || 0) - new Date(a.deadline || a.created_at || 0));
}

function topicsForStudent(id) {
  if (studentDetailMatches(id)) return state.studentDetailPayload?.topics || [];
  if (state.payload?.admin?.topics_by_student) return state.payload.admin.topics_by_student[id] || [];
  return state.payload?.dashboard?.topics || [];
}

function planForStudent(id) {
  if (studentDetailMatches(id)) return state.studentDetailPayload?.plan || [];
  if (state.payload?.admin?.plan_by_student) return state.payload.admin.plan_by_student[id] || [];
  return state.payload?.dashboard?.plan || [];
}

function paymentsForStudent(id) {
  if (studentDetailMatches(id)) {
    return [...(state.studentDetailPayload?.finances?.payments || state.studentDetailPayload?.payments || [])];
  }
  const source = [
    ...(state.payload?.admin?.finances?.payments || []),
    ...(state.payload?.dashboard?.finances?.payments || []),
    ...(state.payload?.dashboard?.payments || []),
  ];
  return source.filter((item) => Number(item.student_id) === Number(id));
}

function unpaidLessonsForStudent(id, lessons = []) {
  if (studentDetailMatches(id)) return [...(state.studentDetailPayload?.finances?.unpaid_lessons || [])];
  const financeUnpaid = (state.payload?.admin?.finances?.unpaid_lessons || [])
    .filter((lesson) => Number(lesson.student_id) === Number(id));
  if (financeUnpaid.length) return financeUnpaid;
  return lessons.filter((lesson) => {
    const payment = String(lesson.payment_status || lesson.payment_label || "");
    return lesson.status === "проведено" && (payment.includes("не отмеч") || payment.includes("не оплач"));
  });
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
    .filter((lesson) => Number(lesson.student_id) === Number(studentId) && !String(lesson.status).includes("отмен") && new Date(lessonStart(lesson)) >= now)
    .sort((a, b) => new Date(lessonStart(a)) - new Date(lessonStart(b)))[0];
}

function studentSubjectLine(student) {
  return [student.subject, student.preparationType || student.prep_type].filter(Boolean).join(" · ") || "Индивидуальная подготовка";
}

function studentAgeGrade(student) {
  return [student.age ? `${student.age} лет` : "", student.grade ? `${student.grade} класс` : ""].filter(Boolean).join(" · ") || "профиль ученика";
}

function studentProgressPercent(student) {
  const current = Number(student.progress_current || student.stats?.progress_current || 0);
  const goal = Number(student.progress_goal || student.stats?.progress_goal || 100);
  if (goal > 0 && current > 0) return Math.max(0, Math.min(100, Math.round((current / goal) * 100)));
  const conducted = Number(student.stats?.conducted || 0);
  const homework = Number(student.stats?.homework_percent || 0);
  if (conducted || homework) return Math.max(35, Math.min(96, Math.round((conducted * 2 + homework) / 3)));
  const seed = String(student.name || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return 64 + (seed % 29);
}

function studentGoalPercent(student) {
  const goal = Number(student.progress_goal || student.stats?.progress_goal || 0);
  return goal >= 60 && goal <= 100 ? goal : 90;
}

function studentLastScoreLabel(student) {
  if (Number(student.mock_tasks_solved || 0) || Number(student.mock_tasks_total || 0)) {
    return `${Number(student.mock_tasks_solved || 0)}/${Number(student.mock_tasks_total || 0) || "—"} заданий`;
  }
  const current = Number(student.progress_current || student.stats?.progress_current || 0);
  const goal = Number(student.progress_goal || student.stats?.progress_goal || 0);
  if (current && goal && goal <= 40) return `${current}/${goal} заданий`;
  if (current && goal) return `${current}/${goal}`;
  return "78/100";
}

function studentBalanceText(student) {
  const balance = Number(student.balance_lessons || student.stats?.paid_lessons || 0);
  if (Number(student.debt_amount || student.stats?.unpaid_lessons || 0) > 0) return "есть долг";
  if (balance > 0) return `${formatHours(balance)} осталось`;
  return "баланс не задан";
}

function studentBalanceDisplayText(student) {
  const finance = studentFinanceSummary(student, lessonsForStudent(student.id));
  if (finance.hasAdvance && finance.remainingLessons > 0) return studentBalanceText({ ...student, balance_lessons: finance.remainingLessons, debt_amount: 0 });
  if (finance.debtAmount > 0) return "есть долг";
  return "авансов нет";
}

function studentInitials(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "Б";
}

function avatarMarkup(student, size = "md") {
  const src = studentAvatarSrc(student);
  return `
    <div class="premium-avatar ${size}" aria-hidden="true">
      ${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" />` : `<span>${escapeHtml(studentInitials(student?.name))}</span>`}
      <i></i>
    </div>
  `;
}

function studentAvatarKey(studentId) {
  return `botai_student_avatar_${studentId}`;
}

function studentAvatarSrc(student) {
  if (!student) return "";
  const tgUser = tg?.initDataUnsafe?.user;
  const tgUsername = tgUser?.username ? `@${String(tgUser.username).replace(/^@/, "")}`.toLowerCase() : "";
  const studentContact = String(student.student_telegram || "").toLowerCase();
  const telegramPhoto = tgUser?.photo_url && tgUsername && studentContact === tgUsername ? tgUser.photo_url : "";
  return (
    student.avatar_url ||
    student.photo_url ||
    student.telegram_photo_url ||
    (student.id ? localStorage.getItem(studentAvatarKey(student.id)) : "") ||
    telegramPhoto ||
    ""
  );
}

function circularProgress(percent, label = "") {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="circular-progress" style="--progress:${value * 3.6}deg" aria-label="${escapeHtml(label || `Прогресс ${value}%`)}">
      <strong>${value}<small>%</small></strong>
    </div>
  `;
}

function progressLine(label, value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  return `
    <div class="topic-progress-line">
      <div><span>${escapeHtml(label)}</span><strong>${percent}%</strong></div>
      <i style="--value:${percent}%"></i>
    </div>
  `;
}

function renderTopicProgressPreview(student, topics) {
  if (examProgressGoal(student) <= 0) {
    return `
      <div class="empty-state compact-empty">
        <strong>Экзамен не выбран</strong>
        <p>Выберите экзамен, чтобы CRM считала прогресс по заданиям и темам.</p>
        <button class="mini-button" data-action="edit-student" data-id="${student.id}" type="button">Выбрать экзамен</button>
      </div>
    `;
  }
  const items = normalizedProgressTasks(topics || [], student)
    .filter((topic) => !isProgressNoteOnly(topic))
    .slice(0, 5);
  if (!items.length) return emptyState("Прогресс пока пуст", "После отметок по заданиям здесь появятся темы подготовки.");
  return items
    .map((topic) => {
      const label = topic.title || `Задание ${topic.task_number}`;
      const percent = Math.round(Math.max(0, Math.min(10, Number(topic.knowledge_level) || 0)) * 10);
      return progressLine(label, percent);
    })
    .join("");
}

function lessonSubject(lesson, student = null) {
  return lesson.subject || student?.subject || "Занятие";
}

function premiumStat(label, value, tone = "purple", hint = "", actionView = "") {
  const tag = actionView ? "button" : "article";
  const actionAttrs = actionView ? ` data-action="go-view" data-view-target="${escapeHtml(actionView)}" type="button"` : "";
  return `
    <${tag} class="premium-stat ${tone}"${actionAttrs}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </${tag}>
  `;
}

function studentFinanceSummary(student, lessons = []) {
  const advances = (state.payload?.admin?.finances?.advances || []).filter((item) => Number(item.student_id) === Number(student.id));
  const payments = paymentsForStudent(student.id);
  const hasAdvance = advances.length > 0;
  const paidAmount = advances.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const paidHours = payments
    .filter((item) => ["подтверждено", "оплачено"].includes(String(item.status || item.payment_label || "")) || item.confirmed_at)
    .reduce((sum, item) => sum + Number(item.lessons_count || 0), 0);
  const spentAmount = advances.reduce((sum, item) => sum + Number(item.lesson_covered_amount || 0) + Number(item.debt_covered_amount || 0), 0);
  const remainingLessons = advances.reduce((sum, item) => sum + Number(item.remaining_lessons || 0), 0);
  const unpaidLessons = unpaidLessonsForStudent(student.id, lessons);
  const financePending = (state.payload?.admin?.finances?.pending || [])
    .filter((item) => Number(item.student_id) === Number(student.id));
  const debtAmount = Number(student.debt_amount || 0) || unpaidLessons.reduce((sum, lesson) => sum + Number(lesson.price || 0), 0);
  const debtLessons = unpaidLessons.reduce((sum, lesson) => sum + Number(lesson.duration_minutes || 60) / 60, 0);
  return { hasAdvance, paidAmount, paidHours, spentAmount, remainingLessons, debtAmount, debtLessons, pendingCount: financePending.length, unpaidCount: unpaidLessons.length };
}

function renderStudentFinanceStrip(student, lessons = []) {
  const summary = studentFinanceSummary(student, lessons);
  const paidHours = summary.paidHours || summary.remainingLessons || Number(student.balance_lessons || 0);
  const cards = [
    premiumStat("Оплачено занятий", formatHours(paidHours), "blue", summary.paidAmount ? money(summary.paidAmount) : "по оплатам"),
    premiumStat("Долги", summary.debtAmount > 0 ? money(summary.debtAmount) : "0 ₽", summary.debtAmount > 0 ? "red" : "mint", summary.unpaidCount ? `${summary.unpaidCount} урок.` : "долгов нет"),
    premiumStat("Аванс", summary.remainingLessons > 0 ? formatHours(summary.remainingLessons) : "0 ч", "purple", summary.hasAdvance ? "осталось" : "нет аванса"),
  ];
  return cards.join("");
}

function renderNextStudentLessonCard(student, next, { compact = false } = {}) {
  if (!next) {
    return `
      <article class="premium-card next-student-lesson empty-next-lesson ${compact ? "compact-next" : ""}">
        <span>Следующий урок</span>
        <p>Нет назначенного занятия</p>
        <button class="primary-button" data-action="book-student" data-id="${student.id}" type="button">Добавить урок</button>
      </article>
    `;
  }
  return `
    <article class="premium-card next-student-lesson ${compact ? "compact-next" : ""}">
      <span>Следующий урок</span>
      <p>${formatDate(lessonStart(next))}</p>
      <strong>${formatTime(lessonStart(next))}</strong>
      <em>${next.duration_minutes} мин</em>
      <div>${pill(next.payment_label || next.payment_status || "ожидается оплата")}</div>
      <button class="primary-button" data-action="edit-lesson" data-id="${next.id}" type="button">Открыть урок</button>
      <button class="mini-button" data-action="mark-conducted" data-id="${next.id}" type="button">Провести</button>
    </article>
  `;
}

function studentMockSummary(student) {
  const solved = Number(student.mock_tasks_solved || 0);
  const total = Number(student.mock_tasks_total || 0);
  const score = Number(student.mock_score || 0);
  return {
    solved,
    total,
    score,
    date: student.mock_date || "",
    label: solved || total ? `${solved}/${total || "—"} заданий` : studentLastScoreLabel(student),
    hint: [
      score ? `${score} балл.` : "",
      student.mock_date ? formatDate(student.mock_date) : "",
    ].filter(Boolean).join(" · ") || "нажми, чтобы заполнить",
  };
}

function renderMockTestCard(student) {
  const mock = studentMockSummary(student);
  return `
    <button class="premium-stat mint editable-stat mock-test-card" data-action="edit-mock-test" data-id="${student.id}" type="button">
      <span>Последний пробник</span>
      <strong>${escapeHtml(mock.label)}</strong>
      <small>${escapeHtml(mock.hint)}</small>
    </button>
  `;
}

function attentionItem(title, value, tone, actionView) {
  return `
    <button class="premium-attention ${tone}" data-action="go-view" data-view-target="${actionView}" type="button">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
    </button>
  `;
}

function studentPaymentState(studentOrId) {
  const student = typeof studentOrId === "object" ? studentOrId : (state.payload?.admin?.students || []).find((item) => item.id === studentOrId);
  const studentId = typeof studentOrId === "object" ? studentOrId.id : studentOrId;
  const finance = student ? studentFinanceSummary(student, lessonsForStudent(studentId)) : null;
  if (Number(student?.stats?.unpaid_lessons || 0) > 0 || Number(student?.debt_amount || 0) > 0 || Number(finance?.debtAmount || 0) > 0 || Number(finance?.unpaidCount || 0) > 0) return ["bad", "есть долг"];
  if (Number(finance?.pendingCount || 0) > 0) return ["warn", "проверить оплату"];
  const lessons = visibleLessons().filter((lesson) => Number(lesson.student_id) === Number(studentId));
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
  const pendingPayments = admin.finances?.pending?.length || 0;
  const expectedToday = admin.summary.expected_today_income ?? admin.summary.expected_income ?? 0;
  const conductedToday = todayLessons.filter((lesson) => lesson.status === "проведено").length;
  const plannedToday = Math.max(todayLessons.length, conductedToday, 1);
  const nextStudent = next ? (admin.students || []).find((student) => student.id === next.student_id) : null;
  const todayPreview = todayLessons
    .slice(0, 5)
    .map((lesson) => {
      const student = (admin.students || []).find((item) => item.id === lesson.student_id);
      return `
        <article class="premium-schedule-row ${statusClass(lesson.payment_status)}" data-action="edit-lesson" data-id="${lesson.id}">
          <time>${formatTime(lessonStart(lesson))}</time>
          <div>
            <strong>${escapeHtml(lesson.student_name || student?.name || "Урок")}</strong>
            <span>${escapeHtml(lessonSubject(lesson, student))} · ${lesson.duration_minutes} мин</span>
          </div>
          ${compactPill(lesson.payment_label || lesson.payment_status)}
        </article>
      `;
    })
    .join("");
  return `
    <section class="premium-dashboard" data-view="overview">
      <section class="premium-hero">
        <div class="premium-hero-copy">
          <p class="eyebrow">Пульс дня</p>
          <h2 class="today-lessons-title"><span>Сегодня</span><strong>${todayLessons.length || 0} уроков</strong></h2>
          <p>${money(expectedToday)} к получению · ${conductedToday} из ${plannedToday} проведено</p>
          <div class="pulse-bar" aria-label="Пульс дня"><i style="width:${Math.round((conductedToday / plannedToday) * 100)}%"></i></div>
        </div>
        <article class="premium-next-card">
          <span>Следующий урок</span>
          <strong>${next ? formatTime(lessonStart(next)) : "Свободно"}</strong>
          <h3>${next ? escapeHtml(next.student_name || nextStudent?.name || "Занятие") : "Нет уроков"}</h3>
          <p>${next ? `${escapeHtml(lessonSubject(next, nextStudent))} · ${next.duration_minutes} мин` : "Можно добавить новую запись"}</p>
          <div class="premium-next-actions">
            ${next ? `<button class="primary-button" data-action="edit-lesson" data-id="${next.id}" type="button">Открыть урок</button>
                     <button class="mini-button secondary-action" data-action="mark-conducted" data-id="${next.id}" type="button">Провести</button>` : `<button class="primary-button" data-action="quick-lesson" type="button">Добавить урок</button>`}
          </div>
        </article>
      </section>

      <article class="premium-card admin-quick-panel">
        <div class="section-head compact-head"><h2>Быстрые действия</h2><span>на каждый день</span></div>
        <div class="premium-action-grid">
          <button data-action="quick-lesson">${iconLabel("calendar", "Добавить урок")}</button>
          <button data-action="quick-homework">${iconLabel("book", "Создать домашку")}</button>
          <button data-action="quick-student">${iconLabel("users", "Добавить ученика")}</button>
          <button data-action="quick-payment">${iconLabel("wallet", "Добавить оплату")}</button>
        </div>
      </article>

      <section class="premium-stat-grid">
        ${premiumStat("Ожидается оплата", money(expectedToday), "mint", "", "finances")}
        ${premiumStat("Домашки на проверку", openHomework, "orange", "", "homeworks")}
        ${premiumStat("Долги", money(admin.summary.debt_amount || 0), "red", "", "finances")}
        ${premiumStat("Уроков за неделю", admin.summary.week_lessons || todayLessons.length, "blue", "", "calendar")}
      </section>

      <section class="premium-two-column">
        <article class="premium-card">
          <div class="section-head compact-head">
            <h2>Расписание на сегодня</h2>
            <button class="mini-button" data-action="go-view" data-view-target="calendar" type="button">Весь день</button>
          </div>
          <div class="premium-schedule-list">
            ${todayPreview || emptyState("Сегодня свободно", "Новые уроки появятся здесь сразу после записи.")}
          </div>
        </article>
      </section>

      <section class="premium-attention-grid" id="pending-lessons-panel">
        ${attentionItem("Оплаты не подтверждены", pendingPayments || unpaidCount, "orange", "finances")}
        ${attentionItem("Домашки ждут проверки", openHomework, "mint", "homeworks")}
        ${attentionItem("Отмены сегодня", cancelledToday.length, "red", "calendar")}
      </section>
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
    <section class="premium-screen students-screen" data-view="students">
      <div class="premium-screen-head">
        <div>
          <p class="eyebrow">БОТай CRM</p>
          <h2>Ученики</h2>
          <span>${students.length} из ${admin.students.length} профилей</span>
        </div>
        <button class="primary-button" data-action="quick-student" type="button">Добавить ученика</button>
      </div>
      <button class="student-filter-toggle ${state.studentFiltersOpen ? "active" : ""}" data-action="toggle-student-filters" type="button">
        ${iconLabel("grid", "Фильтры")}
      </button>
      <section class="student-filter-panel ${state.studentFiltersOpen ? "open" : ""}">
        <div class="crm-toolbar premium-toolbar">
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
        </div>
        <div class="premium-chip-row">
          ${["Все", "Активные", "Есть долг", "Без плана", "Архив"].map((label, index) => `<button class="${index === 0 ? "active" : ""}" type="button">${label}</button>`).join("")}
        </div>
      </section>
      <div class="student-grid crm-list premium-student-grid">
        ${
          students.length
            ? students
                .map(
                  (student) => {
                    const next = nextLessonForStudent(student.id);
                    return `
                    <button class="student-card compact-student premium-student-card ${student.id === state.selectedStudentId ? "selected" : ""}" data-action="open-student" data-id="${student.id}">
                      ${avatarMarkup(student, "sm")}
                      <div class="premium-student-main">
                        <strong>${escapeHtml(student.name)}</strong>
                        <span>${escapeHtml(studentSubjectLine(student))}</span>
                        <small>${escapeHtml(studentBalanceDisplayText(student))}${next ? ` · ${formatRelativeLesson(lessonStart(next))}` : ""}</small>
                      </div>
                      <span class="student-card-arrow" aria-hidden="true">›</span>
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
  const payments = paymentsForStudent(student.id);
  const unpaidLessons = unpaidLessonsForStudent(student.id, lessons);
  const topics = topicsForStudent(student.id);
  const plan = planForStudent(student.id);
  const edit = state.editingStudent;
  const next = lessons
    .filter((lesson) => !String(lesson.status).includes("отмен") && new Date(lessonStart(lesson)) >= new Date())
    .sort((a, b) => new Date(lessonStart(a)) - new Date(lessonStart(b)))[0];
  const progress = studentProgressPercent(student);
  const conducted = student.stats?.conducted ?? lessons.filter((lesson) => lesson.status === "проведено").length;
  const note = String(student.comment || "").trim();
  const activeTab = state.studentDetailTab || "profile";
  const tabs = [
    ["profile", "Профиль"],
    ["lessons", "Уроки"],
    ["homeworks", "Домашки"],
    ["payments", "Оплаты"],
    ["notes", "Заметки"],
    ["files", "Файлы"],
  ];
  const tabContent = () => {
    if (edit) return studentEditForm(student);
    if (activeTab === "lessons") {
      const lessonItems = lessons.slice(-24);
      return `
        <section class="student-tab-panel">
          ${renderNextStudentLessonCard(student, next)}
          <article class="premium-card compact-details is-open">
            <div class="section-head"><h3>Уроки ученика</h3><span>${lessons.length}</span></div>
            ${
              lessonItems.length
                ? renderCalendarList(lessonItems, true)
                : emptyState("Уроков пока нет", "Здесь появятся прошедшие и запланированные занятия ученика.")
            }
          </article>
        </section>
      `;
    }
    if (activeTab === "homeworks") {
      return `
        <section class="student-tab-panel">
          <article class="premium-card compact-details is-open">
            <div class="section-head"><h3>Домашки ученика</h3><span>${homeworks.length}</span></div>
            ${
              homeworks.length
                ? renderHomeworkList(homeworks.slice(0, 24), true)
                : emptyState("Домашек пока нет", "Здесь будут все домашние задания ученика.")
            }
          </article>
        </section>
      `;
    }
    if (activeTab === "payments") {
      const summary = studentFinanceSummary(student, lessons);
      return `
        <section class="student-tab-panel">
          <article class="premium-card finance-strip-card">
            <div class="section-head compact-head"><h3>Финансы</h3><button class="mini-button" data-action="quick-payment" type="button">Добавить оплату</button></div>
            <div class="finance-strip">${renderStudentFinanceStrip(student, lessons)}</div>
            <div class="student-finance-note">
              <span>Ученик оплатил: <strong>${formatHours(summary.paidHours || summary.remainingLessons || Number(student.balance_lessons || 0))}</strong></span>
              <span>Долги: <strong>${summary.debtAmount > 0 ? money(summary.debtAmount) : "0 ₽"}</strong>${summary.unpaidCount ? ` · ${summary.unpaidCount} урок.` : ""}</span>
            </div>
          </article>
          <article class="premium-card compact-details is-open">
            <div class="section-head"><h3>История оплат</h3><span>${payments.length}</span></div>
            ${
              payments.length
                ? renderMoneyRowsGrouped(payments.slice(0, 30), false)
                : emptyState("История оплат пустая", "Подтвержденные и отмеченные оплаты ученика появятся здесь.")
            }
          </article>
          <article class="premium-card compact-details is-open">
            <div class="section-head"><h3>Ожидают оплаты</h3><span>${unpaidLessons.length}</span></div>
            ${
              unpaidLessons.length
                ? renderCalendarList(unpaidLessons, true)
                : emptyState("Нет неоплаченных занятий", "Проведенные неоплаченные уроки ученика будут видны здесь.")
            }
          </article>
        </section>
      `;
    }
    if (activeTab === "notes") {
      return `
        <section class="student-tab-panel">
          <article class="premium-card notes-card">
            <div class="section-head compact-head"><h3>Заметки о ученике</h3><button class="mini-button ghost-action" data-action="add-progress-note" data-id="${student.id}">Добавить</button></div>
            <p>${note ? escapeHtml(note) : "Заметок пока нет."}</p>
          </article>
          <article class="premium-card">
            <div class="section-head compact-head"><h3>План</h3><button class="mini-button ghost-action" data-action="add-plan-item" data-id="${student.id}">Пункт</button></div>
            ${renderPlanList(plan, student.id, true)}
          </article>
        </section>
      `;
    }
    if (activeTab === "files") {
      return `
        <section class="student-tab-panel">
          <article class="premium-card">
            <div class="section-head compact-head"><h3>Файлы и ссылки</h3></div>
            <div class="link-list">
              ${profileLink("Доска", student.board_url)}
              ${profileLink("Звонок", student.meeting_url)}
              ${profileLink("Telegram", student.student_telegram)}
            </div>
          </article>
        </section>
      `;
    }
    return `
      <section class="student-profile-dashboard">
        ${renderNextStudentLessonCard(student, next)}

        <article class="premium-card student-stat-card">
          <div class="section-head compact-head"><h3>Статистика ученика</h3><span>${icon("chart")}</span></div>
          <div class="student-stat-layout">
            ${circularProgress(progress, "Общий прогресс подготовки")}
            <div>
              <h3>Общий прогресс подготовки</h3>
              <p>Цель: ${studentGoalPercent(student)}%</p>
            </div>
          </div>
          <div class="student-small-stats">
            ${premiumStat("Посещено", conducted, "blue", "уроков")}
            ${premiumStat("Отменено", lessons.filter((lesson) => String(lesson.status).includes("отмен")).length, "red", "уроков")}
            ${renderMockTestCard(student)}
          </div>
        </article>

        <article class="premium-card student-actions-card">
          <div class="section-head compact-head"><h3>Быстрые действия</h3></div>
          <div class="premium-action-grid">
            <button data-action="book-student" data-id="${student.id}">${iconLabel("calendar", "Добавить урок")}</button>
            <button data-action="quick-homework">${iconLabel("book", "Добавить ДЗ")}</button>
            <button data-action="quick-payment">${iconLabel("wallet", "Добавить оплату")}</button>
            <button data-action="add-progress-note" data-id="${student.id}">${iconLabel("edit", "Добавить заметку")}</button>
          </div>
        </article>

        <article class="premium-card">
          <div class="section-head compact-head"><h3>Прогресс по заданиям ЕГЭ</h3><button class="mini-button" data-action="edit-progress" data-id="${student.id}" type="button">Подробнее</button></div>
          ${renderProgressChart({ topics }, student, false)}
        </article>
      </section>
    `;
  };
  return `
    <section class="drawer-panel premium-student-detail" data-view="student-detail">
      <div class="premium-student-hero">
        <div class="student-hero-facts" aria-label="Информация об ученике">
          <span>${escapeHtml(student.grade ? `${student.grade} класс` : "класс не указан")}</span>
          <span>${escapeHtml(student.subject || "предмет не указан")}</span>
          <span>${escapeHtml(student.preparationType || student.prep_type || "подготовка не указана")}</span>
        </div>
        ${avatarMarkup(student, "lg")}
        <div class="premium-student-title">
          <h2>${escapeHtml(student.name)} <i></i></h2>
          <div class="premium-student-meta">
            <p>${escapeHtml(student.goal || studentAgeGrade(student))}</p>
          </div>
        </div>
        <div class="row-actions student-head-actions">
          ${
            edit
              ? `
                <button class="mini-button student-edit-cancel-button" data-action="view-student" data-id="${student.id}">Отмена</button>
                <button class="mini-button student-edit-done-button" type="button" data-action="save-student" data-id="${student.id}">Готово</button>
              `
              : `<button class="icon-button student-edit-button" data-action="edit-student" data-id="${student.id}" aria-label="Редактировать">${icon("edit")}</button>
                 <button class="icon-button" data-action="browser-invite" data-id="${student.id}" aria-label="Ссылка доступа">${icon("more")}</button>`
          }
        </div>
      </div>

      <nav class="student-detail-tabs" aria-label="Разделы ученика">
        ${tabs.map(([value, label]) => `<button class="${activeTab === value ? "active" : ""}" data-action="set-student-detail-tab" data-tab="${value}" type="button">${label}</button>`).join("")}
      </nav>

      ${tabContent()}
    </section>
  `;
}

function studentProfileView(student, lessons, homeworks) {
  const stats = student.stats || {};
  const conducted = stats.conducted ?? lessons.filter((lesson) => lesson.status === "проведено").length;
  const cancelled = stats.cancelled ?? lessons.filter((lesson) => String(lesson.status).includes("отмен")).length;
  const doneHomework = homeworks.filter((item) => item.status === "выполнено").length;
  const homeworkPercent = stats.homework_percent ?? (homeworks.length ? Math.round((doneHomework / homeworks.length) * 100) : 0);
  const unpaid = lessons.filter((lesson) => lesson.status === "проведено" && !["оплачено", "подтверждено репетитором"].includes(lesson.payment_status));
  const paidLessons = stats.paid_hours ?? (student.balance_lessons || 0);
  const unpaidLessons = stats.unpaid_lessons ?? unpaid.length;
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
          ${miniMetric("Оплачено", formatHours(paidLessons))}
          ${miniMetric("Долг", unpaidLessons)}
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
      ${infoItem("Оплачено часов", formatHours(student.balance_lessons || 0))}
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
      <label class="full avatar-upload-field">
        <span>Аватарка</span>
        <input name="avatar_file" type="file" accept="image/*" />
        <small>Можно загрузить свою. Если у профиля уже есть Telegram-фото, оно подставится автоматически.</small>
      </label>
      ${field("full_name", "Имя", student.name)}
      ${field("grade", "Класс", student.grade)}
      ${timezoneField(student.timezoneLabel || student.timezone || "МСК+0")}
      ${field("lesson_price", "Стоимость за 1 час", student.hourlyRate, "number")}
      ${field("price_60", "Цена 1 час", student.price_60 || student.hourlyRate || 0, "number")}
      ${field("price_90", "Цена 1.5 часа", student.price_90 || 0, "number")}
      ${field("price_120", "Цена 2 часа", student.price_120 || 0, "number")}
      ${choiceWithOtherField("prep_type", "Вид подготовки", tutorPrepTypes(), student.preparationType)}
      ${choiceWithOtherField("subject", "Предмет", tutorSubjectValues(), student.subject)}
      ${field("goal", "Цель", student.goal)}
      ${field("progress_current", "Прогресс текущий", student.progress_current, "number")}
      ${field("progress_goal", "Прогресс цель", student.progress_goal, "number")}
      ${field("balance_lessons", "Оплачено часов", student.balance_lessons || 0, "number")}
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
      <label class="full avatar-upload-field">
        <span>Аватарка</span>
        <input name="avatar_file" type="file" accept="image/*" />
        <small>Можно загрузить свою аватарку для кабинета.</small>
      </label>
      ${field("full_name", "Имя", student.name)}
      ${field("grade", "Класс", student.grade)}
      ${timezoneField(student.timezoneLabel || student.timezone || "МСК+0")}
      ${choiceWithOtherField("prep_type", "Вид подготовки", tutorPrepTypes(), student.preparationType)}
      ${choiceWithOtherField("subject", "Предмет", tutorSubjectValues(), student.subject)}
      ${field("goal", "Цель", student.goal)}
      ${choiceWithOtherField("current_level", "Уровень", knowledgeLevels, student.current_level)}
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

function field(name, label, value = "", type = "text", placeholder = "") {
  const stepAttr = type === "datetime-local" || type === "time" ? ' step="900"' : type === "number" ? ' step="any"' : "";
  const langAttr = type === "datetime-local" || type === "date" || type === "time" ? ' lang="ru-RU"' : "";
  const placeholderAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : "";
  return `
    <label>
      <span>${label}</span>
      <input name="${name}" type="${type}"${stepAttr}${langAttr}${placeholderAttr} value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function textareaField(name, label, value = "", placeholder = "") {
  const placeholderAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : "";
  return `
    <label class="full">
      <span>${label}</span>
      <textarea name="${name}" rows="3"${placeholderAttr}>${escapeHtml(value ?? "")}</textarea>
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

function wheelSelectField(name, label, options, value = "") {
  const cycles = 5;
  const middleCycle = Math.floor(cycles / 2);
  const repeatedOptions = Array.from({ length: cycles }, (_, cycle) =>
    options.map((item, index) => ({ item, cycle, index }))
  ).flat();
  return `
    <div class="status-wheel-field" data-status-wheel="${name}">
      <span>${escapeHtml(label)}</span>
      <input type="hidden" name="${name}" value="${escapeHtml(value)}" />
      <div class="status-wheel-select" role="listbox" aria-label="${escapeHtml(label)}">
        ${repeatedOptions.map(({ item, cycle, index }) => {
          const optionValue = Array.isArray(item) ? item[0] : item;
          const optionLabel = Array.isArray(item) ? item[1] : item;
          const selected = optionValue === value && cycle === middleCycle;
          return `
            <button
              class="status-wheel-option ${selected ? "selected" : ""} tone-${statusTone(optionValue)}"
              type="button"
              role="option"
              aria-selected="${selected ? "true" : "false"}"
              data-status-option="${escapeHtml(optionValue)}"
              data-status-cycle="${cycle}"
              data-status-index="${index}"
            >
              <span>${escapeHtml(optionLabel)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function durationChoiceField(value = 60) {
  const numeric = Number(value || 60);
  const presets = [
    [60, "1ч"],
    [90, "1.5ч"],
    [120, "2ч"],
  ];
  const isPreset = presets.some(([minutes]) => minutes === numeric);
  return `
    <fieldset class="button-field duration-choice-field full">
      <legend>Длительность</legend>
      <input name="duration_minutes" type="hidden" value="${escapeHtml(numeric)}" />
      <div class="button-options duration-options">
        ${presets.map(([minutes, label]) => `<button class="${numeric === minutes ? "active" : ""}" data-action="set-duration" data-duration="${minutes}" type="button">${label}</button>`).join("")}
        <button class="${isPreset ? "" : "active"}" data-action="set-duration-custom" type="button" data-duration-custom-label>${isPreset ? "..." : `${numeric} мин`}</button>
      </div>
    </fieldset>
  `;
}

function studentHourlyRate(studentId) {
  const student = (state.payload?.admin?.students || []).find((item) => String(item.id) === String(studentId));
  return Number(student?.price_60 || student?.hourlyRate || student?.lesson_price || 0);
}

function syncPaymentHours(form) {
  if (!form || form.dataset.form !== "payment-create") return;
  const amountInput = form.querySelector('input[name="amount"]');
  const hoursInput = form.querySelector('input[name="lessons_count"]');
  const studentInput = form.querySelector('[name="student_id"]');
  const amount = Number(amountInput?.value || 0);
  const hourlyRate = studentHourlyRate(studentInput?.value);
  const hours = amount > 0 && hourlyRate > 0 ? Math.round((amount / hourlyRate) * 100) / 100 : 0;
  if (hoursInput) hoursInput.value = hours ? String(hours) : "";
  const note = form.querySelector("[data-payment-hours-note]");
  if (note) {
    note.textContent = hourlyRate > 0
      ? `Считаю автоматически: ${money(hourlyRate)} за час.`
      : "У ученика не указана цена часа.";
  }
}

function syncDurationChoice(form, minutes) {
  const value = Math.max(1, Math.round(Number(minutes) || 60));
  const input = form?.querySelector('input[name="duration_minutes"]');
  if (!input) return;
  input.value = String(value);
  const buttons = form.querySelectorAll("[data-action='set-duration']");
  buttons.forEach((button) => button.classList.toggle("active", Number(button.dataset.duration) === value));
  const custom = form.querySelector("[data-duration-custom-label]");
  const isPreset = [...buttons].some((button) => Number(button.dataset.duration) === value);
  if (custom) {
    custom.classList.toggle("active", !isPreset);
    custom.textContent = isPreset ? "..." : `${value} мин`;
  }
}

function temporalInputDate(input) {
  if (!input?.value) return null;
  if (input.type === "time") {
    const [hours, minutes] = input.value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }
  const date = new Date(input.value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function temporalInputValue(input, date) {
  const pad = (value) => String(value).padStart(2, "0");
  if (input.type === "time") {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (input.type === "date") return date.toISOString().slice(0, 10);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function syncTimeRangeInputs(form, changedInput = null) {
  const start = form?.querySelector('[name="starts_at"]');
  const end = form?.querySelector('[name="ends_at"]');
  if (!start || !end || !start.value) return;
  const startDate = temporalInputDate(start);
  const endDate = temporalInputDate(end);
  if (!startDate) return;
  if (changedInput === start && (start.type === "datetime-local" || start.type === "time")) {
    const nextEnd = new Date(startDate.getTime() + 60 * 60 * 1000);
    end.value = temporalInputValue(end, nextEnd);
    return;
  }
  if (!end.value && (start.type === "datetime-local" || start.type === "time")) {
    const nextEnd = new Date(startDate.getTime() + 60 * 60 * 1000);
    end.value = temporalInputValue(end, nextEnd);
    return;
  }
  if (endDate && endDate < startDate) {
    const startValue = start.value;
    start.value = end.value;
    end.value = startValue;
  }
}

function choiceWithOtherField(name, label, options, value = "") {
  const normalized = options.filter((item, index, list) => list.indexOf(item) === index);
  const known = normalized.includes(value);
  const selected = known ? value : "другое";
  return `
    ${radioButtonsField(name, label, normalized, selected)}
    <label class="full other-choice ${selected === "другое" ? "" : "is-hidden"}" data-other-for="${name}">
      <span>Другой вариант</span>
      <input name="${name}_custom" value="${known ? "" : escapeHtml(value || "")}" placeholder="Например: русский язык" />
    </label>
  `;
}

function checkboxGroupField(name, label, options, selected = []) {
  const selectedSet = new Set(selected || []);
  return `
    <fieldset class="button-field full">
      <legend>${escapeHtml(label)}</legend>
      <div class="button-options multi-options">
        ${options.map((item, index) => {
          const id = `${name}-${index}`;
          return `
            <input id="${id}" name="${name}" type="checkbox" value="${escapeHtml(item)}" ${selectedSet.has(item) ? "checked" : ""} />
            <label for="${id}">${escapeHtml(item)}</label>
          `;
        }).join("")}
      </div>
    </fieldset>
  `;
}

function weekdayButtonsField(name, label, selected = []) {
  const selectedSet = new Set((selected || []).map(Number));
  return `
    <fieldset class="button-field full weekday-button-field">
      <legend>${escapeHtml(label)}</legend>
      <div class="button-options multi-options weekday-options">
        ${weekdays.map(([value, fullLabel]) => {
          const id = `${name}-${value}`;
          const shortLabel = fullLabel.slice(0, 2);
          return `
            <input id="${id}" name="${name}" type="checkbox" value="${value}" ${selectedSet.has(Number(value)) ? "checked" : ""} />
            <label for="${id}" title="${escapeHtml(fullLabel)}">${escapeHtml(shortLabel)}</label>
          `;
        }).join("")}
      </div>
    </fieldset>
  `;
}

function syncOtherChoice(target) {
  if (!target?.name || !target.matches?.('input[type="radio"]')) return;
  const other = target.closest("form")?.querySelector(`[data-other-for="${target.name}"]`);
  if (other) other.classList.toggle("is-hidden", target.value !== "другое");
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

function expectedIncomeForDay(items) {
  return items
    .filter((lesson) => state.payload?.role === "tutor" && !String(lesson.status || "").includes("отмен"))
    .reduce((sum, lesson) => sum + Number(lesson.price || 0), 0);
}

function financeGroupKey(item) {
  const value = item.confirmed_at || item.created_at || item.starts_at || "";
  return String(value).slice(0, 10);
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
          <h3 class="calendar-day-title"><span>${weekdayTitle(day)}</span>${state.payload?.role === "tutor" ? `<strong>${money(expectedIncomeForDay(items))}</strong>` : ""}</h3>
          <div class="timeline-list">
            ${items
              .map(
                (lesson) => `
                  <article class="lesson-row timeline-event ${statusClass(lesson.status)}" data-scroll-anchor="lesson-${lesson.id}">
                    <time>${formatTime(lessonStart(lesson))}</time>
                    <div class="lesson-main" data-action="edit-lesson" data-id="${lesson.id}">
                      <strong class="lesson-student-name">${escapeHtml(lesson.student_name || "Занятие")}</strong>
                      <p class="lesson-meta"><span>${lesson.duration_minutes} мин</span><span class="lesson-price">${money(lesson.price)}</span>${compact || !lesson.notes ? "" : `<span>${escapeHtml(lesson.notes)}</span>`}</p>
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

function calendarModeLabel(mode = state.calendarMode) {
  if (mode === "day") return state.calendarFocusDate ? formatDate(state.calendarFocusDate) : "Сегодня";
  if (mode === "month") return "Текущий месяц";
  return "";
}

function lessonsForCalendarMode(lessons) {
  const mode = state.calendarMode || "week";
  const focus = state.calendarFocusDate ? new Date(state.calendarFocusDate) : new Date();
  if (mode === "day") return lessons.filter((lesson) => isSameDay(lessonStart(lesson), focus));
  if (mode === "month") {
    const today = new Date();
    return lessons.filter((lesson) => {
      const date = new Date(lessonStart(lesson));
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    });
  }
  return lessons;
}

function renderMonthOverview(lessons) {
  if (state.calendarMode !== "month") return "";
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const counts = new Map();
  for (const lesson of lessons) {
    const date = new Date(lessonStart(lesson));
    if (date.getFullYear() === year && date.getMonth() === month) {
      const day = date.getDate();
      counts.set(day, (counts.get(day) || 0) + 1);
    }
  }
  const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  return `
    <section class="calendar-month-overview" aria-label="Обзор месяца">
      ${weekdayLabels.map((label) => `<span class="calendar-month-weekday">${label}</span>`).join("")}
      ${Array.from({ length: firstDayOffset }, () => `<span class="calendar-month-empty" aria-hidden="true"></span>`).join("")}
      ${Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const count = counts.get(day) || 0;
        const active = isSameDay(new Date(year, month, day), now);
        const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        return `<button class="${count ? "has-lessons" : ""} ${active ? "active" : ""}" data-action="set-calendar-day" data-date="${dateKey}" type="button"><b>${day}</b>${count ? `<em>${count}</em>` : ""}</button>`;
      }).join("")}
    </section>
  `;
}

function renderCalendarSummary(lessons) {
  const activeLessons = lessons.filter((lesson) => !String(lesson.status || "").includes("отмен"));
  const expected = expectedIncomeForDay(activeLessons);
  const conducted = activeLessons.filter((lesson) => lesson.status === "проведено").length;
  const unpaid = activeLessons.filter((lesson) => {
    const payment = String(lesson.payment_status || lesson.payment_label || "");
    return payment.includes("не отмеч") || payment.includes("не оплач") || payment.includes("ожида");
  }).length;
  const paid = activeLessons.filter((lesson) => {
    const payment = String(lesson.payment_status || lesson.payment_label || "");
    return (payment.includes("оплач") || payment.includes("подтвержден")) && !payment.includes("не оплач");
  }).length;
  return `
    <section class="calendar-mode-summary" aria-label="Сводка календаря">
      <article><span>Уроков</span><strong>${activeLessons.length}</strong></article>
      ${state.payload?.role === "tutor" ? `<article><span>К получению</span><strong>${money(expected)}</strong></article>` : ""}
      <article><span>Проведено</span><strong>${conducted}</strong></article>
      <article><span>Оплаты</span><strong>${paid}/${Math.max(activeLessons.length, paid)}</strong></article>
      <article class="${unpaid ? "warn" : "ok"}"><span>Ждут</span><strong>${unpaid}</strong></article>
    </section>
  `;
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
        <button class="mini-button micro lesson-pay-button" data-action="confirm-lesson" data-id="${lesson.id}" aria-label="Подтвердить оплату">₽</button>
      `;
    }
    return `
      <button class="mini-button micro" data-action="mark-conducted" data-id="${lesson.id}" aria-label="Проведено">${icon("check")}</button>
      <button class="mini-button micro lesson-pay-button" data-action="confirm-lesson" data-id="${lesson.id}" aria-label="Подтвердить оплату">₽</button>
    `;
  }
  const canEdit = state.payload.role === "student" || state.payload.dashboard?.student?.parentCanEdit || state.payload.dashboard?.student?.parent_can_edit;
  const canChangeLesson = ["ожидает подтверждения", "запланировано", "перенесено"].includes(lesson.status);
  return `
    <button class="mini-button micro" data-action="mark-paid" data-id="${lesson.id}">₽</button>
    ${canEdit && canChangeLesson ? `<button class="mini-button micro" data-action="move-own-lesson" data-id="${lesson.id}" aria-label="Действия">${icon("more")}</button>` : ""}
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
  const sourceLessons = state.showCalendarArchive ? archive : current;
  const lessons = lessonsForCalendarMode(sourceLessons);
  const periodLabel = state.showCalendarArchive ? "Архив занятий" : calendarModeLabel();
  return `
    <section class="premium-screen calendar-panel" data-view="calendar">
      <div class="premium-screen-head calendar-head-row">
        <div class="calendar-title-block">
          <div class="calendar-title-row">
            <h2>Календарь</h2>
            <div class="premium-chip-row calendar-modes">
              ${[["day", "День"], ["week", "Неделя"], ["month", "Месяц"]].map(([mode, label]) => `<button class="${state.calendarMode === mode ? "active" : ""}" data-action="set-calendar-mode" data-mode="${mode}" type="button">${label}</button>`).join("")}
            </div>
          </div>
          ${periodLabel ? `<span>${periodLabel}</span>` : ""}
        </div>
        <div class="calendar-head-controls">
          <button class="calendar-ghost-action" type="button">${icon("calendar")}<span>Фильтр</span></button>
        </div>
      </div>
      <div class="calendar-action-rail calendar-action-rail-compact calendar-top-actions">
        <button class="calendar-action" data-action="quick-lesson" type="button">${iconLabel("plus", "Запись")}</button>
        <button class="calendar-action" data-action="quick-free-slots" type="button">${iconLabel("clock", "Окна")}</button>
        <button class="calendar-action" data-action="quick-schedule" type="button">${iconLabel("calendar", "Стабильное")}</button>
        ${state.payload.role === "tutor" ? `<button class="calendar-action" data-action="quick-closed-slot" type="button">${iconLabel("minus", "Нерабочие")}</button>` : ""}
        <button class="calendar-action" data-action="toggle-calendar-archive" type="button">${iconLabel("book", state.showCalendarArchive ? "Ближайшие" : "Архив")}</button>
      </div>
      <div class="calendar-workspace">
        <section class="premium-card calendar-main-column">
          ${renderCalendarSummary(lessons)}
          ${renderMonthOverview(sourceLessons)}
          ${renderCalendarList(lessons)}
        </section>
        <aside class="premium-card calendar-filter-card">
          <h3>Фильтры</h3>
          <label><span>Период</span><select><option>Эта неделя</option><option>Сегодня</option><option>Этот месяц</option></select></label>
          <label><span>Статус оплаты</span><select><option>Все статусы</option><option>Оплачено</option><option>Ожидается</option><option>Долг</option></select></label>
          <button class="mini-button" data-action="toggle-calendar-archive" type="button">${state.showCalendarArchive ? "Показать ближайшие" : "Показать архив"}</button>
          <button class="mini-button" type="button">Применить</button>
        </aside>
      </div>
      ${
        state.payload.role === "tutor"
          ? `
            <section class="closed-slots-panel premium-card">
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
            <article class="homework-row homework-tone-${statusTone(homework.status)} ${statusClass(homework.status)}" ${editable ? `data-action="edit-homework" data-id="${homework.id}"` : `data-action="open-homework" data-id="${homework.id}"`}>
              <div class="homework-main">
                <strong>${escapeHtml(homework.title || "Домашнее задание")}</strong>
                <p>${escapeHtml(homework.student_name || "")} · ${formatDate(homework.deadline)}${homework.description ? ` · ${escapeHtml((homework.description || "").slice(0, 70))}` : ""}</p>
                ${homework.attachments?.length ? `<small>${homework.attachments.length} файл.</small>` : ""}
                ${homework.links?.length ? `<a href="${escapeHtml(homework.links[0])}" target="_blank" rel="noreferrer">Открыть ссылку</a>` : ""}
              </div>
              <div class="row-actions">
                ${
                  editable
                    ? `<button class="mini-button micro homework-more-button" data-action="edit-homework" data-id="${homework.id}" aria-label="Действия">${icon("more")}</button>`
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
  const homeworkFilterClass = (value) => {
    if (value === "ожидание выполнения") return "homework-filter-chip--work";
    if (value === "выполнено") return "homework-filter-chip--done";
    if (value === "просрочено") return "homework-filter-chip--overdue";
    return "homework-filter-chip--all";
  };
  return `
    <section class="premium-screen" data-view="homeworks">
      <div class="premium-screen-head">
        <div><p class="eyebrow">задачи и проверка</p><h2>Домашние задания</h2><span>${filtered.length}/${homeworks.length}</span></div>
        ${editable ? `<button class="primary-button" data-action="quick-homework" type="button">Создать домашку</button>` : ""}
      </div>
      <section class="segmented homework-segmented">
        ${[
          ["", "Все"],
          ["ожидание выполнения", "В работе"],
          ["выполнено", "Выполнены"],
          ["просрочено", "Просрочены"],
        ].map(([value, label]) => `<button class="homework-filter-chip ${homeworkFilterClass(value)} ${state.filterHomework === value ? "active" : ""}" data-action="set-homework-filter" data-value="${value}">${label}</button>`).join("")}
      </section>
      <div class="premium-card">${renderHomeworkList(filtered, editable)}</div>
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
  const payments = (finances.payments || []).filter((item) => !state.filterPayment || item.status === state.filterPayment || item.payment_label === state.filterPayment);
  return `
    <section class="premium-screen finance-screen" data-view="finances">
      <div class="premium-screen-head">
        <div><p class="eyebrow">деньги и авансы</p><h2>${isTutor ? "Финансы" : "Оплаты"}</h2><span>${isTutor ? money(finances.month_income || 0) : money(student?.hourlyRate || 0) + "/ч"}</span></div>
        ${isTutor ? `<button class="primary-button" data-action="quick-payment" type="button">Добавить оплату</button>` : ""}
      </div>
      ${isTutor ? `<section class="finance-kpis">
        <article><span>Сегодня</span><strong>${money(finances.today_income || 0)}</strong></article>
        <article><span>Неделя</span><strong>${money(finances.week_income || 0)}</strong></article>
        <article><span>Месяц</span><strong>${money(finances.month_income || 0)}</strong></article>
        <article><span>Ожидается сегодня</span><strong>${money(finances.expected_today_income ?? finances.expected_income ?? 0)}</strong></article>
        <article><span>Ожидается неделя</span><strong>${money(finances.expected_week_income ?? finances.expected_income ?? 0)}</strong></article>
        <article class="${Number(finances.debt_amount || 0) > 0 ? "has-debt" : "clear-debt"}"><span>Долги</span><strong>${money(finances.debt_amount || 0)}</strong></article>
      </section>` : ""}
      ${!isTutor && finances.debt_amount ? `<section class="finance-kpis"><article><span>Долг</span><strong>${money(finances.debt_amount)}</strong></article></section>` : ""}
      ${isTutor ? renderIncomeChart(finances.income_events || payments) : ""}
      ${isTutor ? renderAdvances(finances.advances || []) : ""}
      ${isTutor ? `<section class="filters">
          <select data-filter="payment">
            <option value="">Все операции</option>
            ${[...paymentStatuses, "подтверждено", "ожидает подтверждения"].map((item) => `<option value="${item}" ${state.filterPayment === item ? "selected" : ""}>${item}</option>`).join("")}
          </select>
        </section>` : ""}
      <div class="detail-section">
        ${isTutor ? `<details class="operations-history" ${state.operationsHistoryOpen ? "open" : ""}>
          <summary><span>История операций</span><strong>${payments.length}</strong></summary>
          ${
            payments.length
              ? renderMoneyRowsGrouped(payments, false)
              : emptyState("История пустая", "Подтвержденные и ожидающие оплаты появятся здесь.")
          }
        </details>` : `<h3>Список оплат</h3>
        ${
          payments.length
            ? renderMoneyRowsGrouped(payments.slice(0, 30), false)
            : emptyState("История пустая", "Подтвержденные и ожидающие оплаты появятся здесь.")
        }`}
      </div>
      <div class="detail-section">
        <h3>Ожидают оплаты</h3>
        ${
          finances.unpaid_lessons?.length
            ? renderCalendarList(finances.unpaid_lessons, true)
            : emptyState("Нет неоплаченных занятий", "Проведенные неоплаченные уроки будут видны здесь.")
        }
      </div>
      ${isTutor ? `<div class="detail-section">
        <h3>Ожидают проверки</h3>
        ${
          finances.pending?.length
            ? renderMoneyRows(finances.pending, isTutor)
            : emptyState("Нет платежей на проверке", "Когда ученик или родитель отметит оплату, она появится здесь.")
        }
      </div>` : ""}
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
                        <p>Внесен ${formatDateTime(item.confirmed_at || item.created_at)} · ${formatHours(item.lessons_count || 0)} ${item.amount ? `· ${money(item.amount)}` : ""}</p>
                        <p>${item.lesson_covered_amount ? `Списано: ${money(item.lesson_covered_amount)}` : "Не списывались"}${item.debt_covered_amount ? ` · долг: ${money(item.debt_covered_amount)}` : ""}</p>
                      </div>
                      <span class="status ok">${formatHours(item.remaining_lessons || 0)} осталось</span>
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
      ${field("remaining_lessons", "Осталось часов", item.remaining_lessons || 0, "number")}
      ${field("lessons_count", "Внесено часов", item.lessons_count || 0, "number")}
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
          const when = isLesson ? formatDateTime(lessonStart(item)) : formatDateTime(item.confirmed_at || item.created_at);
          const amount = money(item.amount || item.price || 0);
          return `
            <article class="finance-row">
              <div class="finance-row-main">
                <strong>${escapeHtml(item.student_name || "Оплата")}</strong>
                <p><span>${escapeHtml(item.label || (isLesson ? "Занятие" : "Оплата"))}</span><span>${when}</span><span>${amount}</span></p>
              </div>
              <div class="finance-row-actions">
                ${pill(item.payment_label || item.status)}
                ${isTutor ? `<button class="mini-button" data-action="${isLesson ? "confirm-lesson" : "confirm-payment"}" data-id="${item.id}">Подтвердить</button>` : ""}
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMoneyRowsGrouped(items, isTutor) {
  const groups = new Map();
  for (const item of items) {
    const key = financeGroupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(
      ([day, dayItems]) => `
        <div class="finance-day">
          <h3 class="calendar-day-title"><span>${formatWeekdayDate(day)}</span><strong>${money(dayItems.reduce((sum, item) => sum + Number(item.amount || item.price || 0), 0))}</strong></h3>
          ${renderMoneyRows(dayItems, isTutor)}
        </div>
      `
    )
    .join("");
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
            (topic) => {
              const level = Math.max(0, Math.min(10, Number(topic.knowledge_level) || 0));
              const tone = level <= 4 ? "low" : level >= 8 ? "high" : "mid";
              return `
              <div class="bar-wrap" title="${escapeHtml(`${topic.title}: ${topic.knowledge_level || 0}/10`)}">
                <div class="bar ${tone}" style="--bar-opacity:${Math.max(0.4, Math.min(1, level / 10)).toFixed(2)}; height:${Math.max(4, level * 10)}%"></div>
                ${canEdit && isCustom && topic.id ? `<button class="bar-delete-button" data-action="delete-progress-topic" data-id="${topic.id}" data-student-id="${student.id}" type="button" aria-label="Удалить ${escapeHtml(topic.title)}">${icon("trash")}</button>` : ""}
                <span title="${escapeHtml(topic.title)}">${escapeHtml(isCustom ? topic.title : String(topic.title).replace("Задание ", ""))}</span>
              </div>
            `;
            }
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
            const level = Math.max(0, Math.min(10, Number(task.knowledge_level) || 0));
            const levelLabel = level <= 5 ? "нужно повторить" : level >= 8 ? "уверенно" : "закрепить";
            return `
              <article class="progress-task-row">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(`${level * 10}% · ${levelLabel}${comment ? ` · ${comment}` : ""}`)}</span>
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
              <div class="plan-row">
                <input type="checkbox" data-action="toggle-plan-item" data-student-id="${studentId}" data-id="${item.id}" ${item.status === "выполнено" ? "checked" : ""} ${canEdit ? "" : "disabled"} />
                <span>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${item.deadline ? `до ${formatDate(item.deadline)}` : "без дедлайна"}${item.comment ? ` · ${escapeHtml(item.comment)}` : ""}</small>
                </span>
                ${canEdit ? `<div class="plan-actions">
                  <button class="mini-button micro" data-action="edit-plan-item" data-student-id="${studentId}" data-id="${item.id}" type="button" aria-label="Редактировать">${icon("edit")}</button>
                  <button class="mini-button micro danger-icon" data-action="delete-plan-item" data-student-id="${studentId}" data-id="${item.id}" type="button" aria-label="Удалить">${icon("trash")}</button>
                </div>` : ""}
              </div>
            `).join("")
          : `<div class="empty-state plan-empty">
              <div class="empty-mark">${icon("calendar")}</div>
              <h3>План пуст</h3>
              <p>Добавь пункт с дедлайном</p>
              ${canEdit && studentId ? `<button class="mini-button primary-soft-action" data-action="add-plan-item" data-id="${studentId}" type="button">Добавить пункт</button>` : ""}
            </div>`
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
        <span>Задание</span>
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

function planItemForm(studentId, item = null) {
  return `
    <form class="edit-form" data-form="${item ? "plan-edit" : "plan-create"}" data-id="${studentId}" data-item-id="${item?.id || ""}">
      ${field("title", "Пункт плана", item?.title || "")}
      ${field("deadline", "Дедлайн", item?.deadline || "", "date")}
      ${textareaField("comment", "Комментарий", item?.comment || "")}
      ${item ? selectField("status", "Статус", ["не начато", "в процессе", "выполнено", "нужно повторить"], item.status || "не начато") : ""}
      <button class="primary-button" type="submit">${item ? "Сохранить" : "Добавить пункт"}</button>
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
        ${choiceWithOtherField("prep_type", "Подготовка", tutorPrepTypes(), "ЕГЭ")}
        ${choiceWithOtherField("subject", "Предмет", tutorSubjectValues(), "Информатика")}
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
  const unpaid = (bundle.finances?.unpaid_lessons || bundle.lessons.filter((item) => item.status === "проведено" && item.payment_status !== "оплачено"));
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
          ${canEditProgress ? `<button class="mini-button primary-soft-action" data-action="edit-progress" data-id="${student.id}">Изменить</button>` : ""}
          ${canEditProgress ? `<button class="mini-button ghost-action" data-action="add-progress-note" data-id="${student.id}">Заметка</button>` : ""}
          ${canEditProgress ? `<button class="mini-button ghost-action" data-action="add-plan-item" data-id="${student.id}">План</button>` : ""}
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
  setView(state.activeView === "profile" || clientTabs.some(([view]) => view === state.activeView) ? state.activeView : "overview");
  syncTopbarSubmitAction();
}

function renderTutor(payload) {
  const admin = payload.admin;
  const detail = state.selectedStudentId ? studentDetailRecord(state.selectedStudentId) : null;
  screenTitle.textContent = `${admin.summary.students} уч. • ${admin.summary.week_lessons} уроков`;
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
  setView(
    state.activeView === "student-detail" && detail
      ? "student-detail"
      : state.activeView === "profile" || tutorTabs.some(([view]) => view === state.activeView)
        ? state.activeView
        : "overview"
  );
  syncTopbarSubmitAction();
}

function renderTutorProfile(admin) {
  const profile = admin.profile || {};
  const subjects = profile.subjects || [];
  const profilePrepTypes = profile.prep_types || [];
  const workingDays = profile.working_days || [1, 2, 3, 4, 5, 6, 7];
  const customSubjects = subjects.filter((item) => !defaultSubjects.includes(item));
  const customPrepTypes = profilePrepTypes.filter((item) => !defaultPrepTypes.includes(item));
  return `
    <section class="panel" data-view="profile">
      <div class="section-head compact-head">
        <h2>Профиль репетитора</h2>
        <div class="section-actions">
          <button class="mini-button" type="button" data-action="tutor-browser-invite">Ссылка кабинета</button>
          <span>${subjects.length + profilePrepTypes.length}</span>
        </div>
      </div>
      <form class="edit-form" data-form="tutor-profile">
        ${field("full_name", "ФИО", profile.full_name || "")}
        ${field("experience", "Стаж", profile.experience || "")}
        ${textareaField("description", "Описание", profile.description || "")}
        ${checkboxGroupField("subjects", "Предметы", defaultSubjects, subjects)}
        ${textareaField("subjects_custom", "Другие предметы, каждый с новой строки", customSubjects.join("\n"))}
        ${checkboxGroupField("prep_types", "Подготовки", defaultPrepTypes, profilePrepTypes)}
        ${textareaField("prep_types_custom", "Другие подготовки, каждая с новой строки", customPrepTypes.join("\n"))}
        ${weekdayButtonsField("working_days", "Рабочие дни", workingDays)}
        <p class="form-note full">Эти варианты увидят новые ученики в анкете. Редкие варианты можно добавить строками выше.</p>
        <button class="primary-button" type="submit">Сохранить профиль</button>
      </form>
    </section>
  `;
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
  state.viewScrollTops[state.activeView] = scrollTop;
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
    canDrag = modal.scrollTop <= 1 && Boolean(event.target.closest(".modal-drag-handle, .detail-head"));
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
    if (!dragging && modal.scrollTop > 1) {
      reset();
      return;
    }
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

function syncUploadFileList(input) {
  if (input?.name !== "attachments_file") return;
  const list = input.closest(".custom-upload-field")?.querySelector("[data-upload-file-list]");
  if (!list) return;
  const files = [...(input.files || [])];
  list.textContent = files.length ? files.map((file) => file.name).join(", ") : "Файлы не выбраны";
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
  const modal = node.querySelector(".modal");
  requestAnimationFrame(() => {
    if (modal) modal.scrollTop = 0;
  });
  node.addEventListener("click", (event) => {
    const statusOption = event.target.closest("[data-status-option]");
    if (!statusOption) return;
    event.preventDefault();
    haptic();
    syncStatusWheelSelection(statusOption, { scroll: true, behavior: "smooth" });
  });
  node.addEventListener("change", (event) => syncProgressTaskFields(event.target));
  node.addEventListener("change", (event) => syncOtherChoice(event.target));
  node.addEventListener("change", (event) => syncUploadFileList(event.target));
  attachModalSwipe(node);
  attachStatusWheelScroll(node);
  centerStatusWheels(node);
  requestAnimationFrame(() => {
    if (modal) modal.scrollTop = 0;
  });
  syncPaymentHours(node.querySelector('form[data-form="payment-create"]'));
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
  const lessonStatusChoices = lessonStatuses.map((item) => [item, shortStatusLabel(item)]);
  const paymentStatusChoices = paymentStatuses.map((item) => [item, shortStatusLabel(item)]);
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
        ${durationChoiceField(duration)}
      </fieldset>
      ${
        state.payload.role === "tutor"
          ? `<fieldset class="form-section status-wheel-section">
               <legend>Статусы</legend>
               <div class="status-wheel-grid">
                 ${wheelSelectField("status", "Занятие", lessonStatusChoices, lesson?.status || "запланировано")}
                 ${wheelSelectField("payment_status", "Оплата", paymentStatusChoices, lesson?.payment_status || "не отмечено")}
               </div>
             </fieldset>
             <fieldset class="form-section">
               <legend>Финансы</legend>
               ${field("payment_amount", "Стоимость", lesson?.price || "", "number", "Например, 1500")}
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
      ${durationChoiceField(lesson.duration_minutes || 60)}
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
      ${choiceWithOtherField("prep_type", "Вид подготовки", tutorPrepTypes(), "ЕГЭ")}
      ${choiceWithOtherField("subject", "Предмет", tutorSubjectValues(), "Информатика")}
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
  const selectedRate = studentHourlyRate(selectedId);
  return `
    <form class="edit-form" data-form="payment-create">
      <label><span>Ученик</span><select name="student_id">${students.map((student) => `<option value="${student.id}" ${selectedId === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>
      ${field("amount", "Сумма", "", "number", "Например, 5000")}
      <label>
        <span>Оплачено часов</span>
        <input name="lessons_count" type="number" step="0.25" value="" readonly />
      </label>
      <p class="form-note full" data-payment-hours-note>${selectedRate ? `Считаю автоматически: ${money(selectedRate)} за час.` : "У ученика не указана цена часа."}</p>
      ${textareaField("comment", "Комментарий", "", "Например: перевод СБП, июнь")}
      <button class="primary-button" type="submit">Добавить оплату</button>
    </form>
  `;
}

function mockTestForm(student) {
  const total = Number(student.mock_tasks_total || student.progress_goal || student.defaultProgressGoal || 27);
  return `
    <form class="edit-form" data-form="mock-test" data-id="${student.id}">
      ${field("mock_tasks_solved", "Решено заданий", student.mock_tasks_solved || "", "number", "Например, 12")}
      ${field("mock_tasks_total", "Всего заданий", total || "", "number", "Например, 27")}
      ${field("mock_score", "Баллы", student.mock_score || "", "number", "Например, 78")}
      <label>
        <span>Дата пробника</span>
        <input name="mock_date" type="date" value="${escapeHtml(student.mock_date || "")}" />
      </label>
      <button class="primary-button" type="submit">Готово</button>
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

function browserInviteRowMeta(url, index, title) {
  if (url.includes("trycloudflare.com")) {
    return {
      label: `${title} через VPN`,
      button: "Скопировать ссылку через VPN",
    };
  }
  if (index === 0) {
    return {
      label: title,
      button: "Скопировать ссылку",
    };
  }
  if (url.includes("sslip.io")) {
    return {
      label: "Прямая запасная ссылка",
      button: "Скопировать прямую ссылку",
    };
  }
  if (url.includes(":8443")) {
    return {
      label: "Запасная ссылка 8443",
      button: "Скопировать ссылку 8443",
    };
  }
  return {
    label: `Запасная ссылка ${index + 1}`,
    button: `Скопировать запасную ${index + 1}`,
  };
}

function renderBrowserInviteResult(payload, title, note) {
  const urls = Array.isArray(payload.urls) && payload.urls.length ? payload.urls : [payload.url];
  const visibleUrls = urls.slice(0, 1);
  const rows = visibleUrls.map((url, index) => {
    const meta = browserInviteRowMeta(url, index, title);
    return `
    <label class="full">
      <span>${meta.label}</span>
      <textarea readonly rows="3">${escapeHtml(url)}</textarea>
    </label>
    <button class="mini-button full" type="button" data-action="copy-browser-invite" data-url="${escapeHtml(url)}">${meta.button}</button>
  `;
  }).join("");
  return `
    ${rows}
    <p class="form-note full">Открывай первую ссылку. Если включен VPN, используй ссылку с пометкой «через VPN».</p>
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
      <fieldset class="form-section">
        <legend>Основное</legend>
        <label><span>Ученик</span><select name="student_id" ${homework ? "disabled" : ""}>${students.map((student) => `<option value="${student.id}" ${homework?.student_id === student.id ? "selected" : ""}>${escapeHtml(student.name)}</option>`).join("")}</select></label>
        ${field("title", "Название", homework?.title || "")}
        ${textareaField("text", "Описание", homework?.description || homework?.text || "")}
      </fieldset>
      <fieldset class="form-section">
        <legend>Материалы</legend>
        ${field("links", "Ссылки", homework?.links?.join(", ") || "", "text", "Вставь одну или несколько ссылок")}
        <label class="full custom-upload-field">
          <span>Файлы</span>
          <input name="attachments_file" type="file" multiple />
          <span class="upload-control">${icon("book")}<b>Прикрепить файлы</b></span>
          <small class="upload-file-list" data-upload-file-list>Файлы не выбраны</small>
        </label>
        ${textareaField("attachments", "Ссылки на файлы", homework?.attachments?.join(", ") || "", "Вставь ссылки на файлы, если они уже загружены")}
      </fieldset>
      <fieldset class="form-section">
        <legend>Сроки</legend>
        <label>
          <span>Дедлайн</span>
          <input name="deadline" type="datetime-local" step="3600" value="${escapeHtml((homework?.deadline || "").slice(0, 16))}" />
        </label>
      </fieldset>
      <fieldset class="form-section">
        <legend>Статус</legend>
        ${radioButtonsField("status", "Статус", homeworkStatuses, homework?.status || "ожидание выполнения")}
        ${textareaField("teacher_comment", "Комментарий", homework?.teacher_comment || "")}
      </fieldset>
      <button class="primary-button" type="submit">Готово</button>
      ${homework ? `<button class="danger-button full homework-delete-modal-button" type="button" data-action="delete-homework" data-id="${homework.id}">Удалить домашку</button>` : ""}
    </form>
  `;
}

async function handleFormSubmit(form) {
  const type = form.dataset.form;
  const preserveScroll = true;
  const scrollTop = currentScrollTop();
  syncTimeRangeInputs(form);
  syncPaymentHours(form);
  const data = Object.fromEntries(new FormData(form).entries());
  const formData = new FormData(form);
  for (const key of ["subject", "prep_type", "current_level"]) {
    if (data[key] === "другое") {
      const custom = String(data[`${key}_custom`] || "").trim();
      if (custom) data[key] = custom;
    }
    delete data[`${key}_custom`];
  }
  for (const key of ["student_id", "duration_minutes", "estimated_minutes", "lesson_price", "price_60", "price_90", "price_120", "payment_amount", "progress_current", "progress_goal", "mock_tasks_solved", "mock_tasks_total", "mock_score", "balance_lessons", "remaining_lessons", "task_number", "knowledge_level", "amount", "lessons_count"]) {
    if (data[key] !== undefined && data[key] !== "") data[key] = Number(data[key]);
    else if (data[key] === "") delete data[key];
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
  const avatarFiles = form.querySelector('[name="avatar_file"]')?.files || [];
  if ((type === "student" || type === "self-student") && avatarFiles.length && form.dataset.id) {
    localStorage.setItem(studentAvatarKey(form.dataset.id), await fileToDataUrl(avatarFiles[0]));
  }
  delete data.avatar_file;
  if (data.starts_at === "") delete data.starts_at;
  if (data.ends_at === "") delete data.ends_at;
  if (data.deadline === "") delete data.deadline;
  if (data.mock_date === "") delete data.mock_date;
  else if (type === "homework-create" || type === "homework-edit") data.deadline = `${String(data.deadline).slice(0, 13)}:00`;
  if (data.task_number === "") delete data.task_number;
  if (data.title === "") delete data.title;
  if (type === "tutor-profile") {
    const customSubjects = String(data.subjects_custom || "").split("\n").map((item) => item.trim()).filter(Boolean);
    const customPrepTypes = String(data.prep_types_custom || "").split("\n").map((item) => item.trim()).filter(Boolean);
    data.subjects = [...formData.getAll("subjects"), ...customSubjects];
    data.prep_types = [...formData.getAll("prep_types"), ...customPrepTypes];
    data.working_days = formData.getAll("working_days").map(Number).filter((day) => day >= 1 && day <= 7);
    delete data.subjects_custom;
    delete data.prep_types_custom;
  }

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
    state.operationsHistoryOpen = true;
    state.activeView = "finances";
  } else if (type === "advance-edit") {
    await api(`/api/admin/advances/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
    state.operationsHistoryOpen = true;
    state.activeView = "finances";
  } else if (type === "mock-test") {
    await api(`/api/admin/students/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "progress-update") {
    await api(`/api/students/${form.dataset.id}/progress`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "progress-note") {
    await api(`/api/students/${form.dataset.id}/progress`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "plan-create") {
    await api(`/api/students/${form.dataset.id}/plan`, { method: "POST", body: JSON.stringify(data) });
  } else if (type === "plan-edit") {
    await api(`/api/students/${form.dataset.id}/plan/${form.dataset.itemId}`, { method: "PATCH", body: JSON.stringify(data) });
  } else if (type === "tutor-profile") {
    await api("/api/admin/profile", { method: "PATCH", body: JSON.stringify(data) });
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

function syncStatusWheelSelection(option, { scroll = false, behavior = "auto" } = {}) {
  const field = option.closest(".status-wheel-field");
  if (!field) return;
  const input = field.querySelector('input[type="hidden"]');
  input.value = option.dataset.statusOption || "";
  field.querySelectorAll(".status-wheel-option").forEach((node) => {
    const selected = node === option;
    node.classList.toggle("selected", selected);
    node.setAttribute("aria-selected", selected ? "true" : "false");
  });
  if (scroll) {
    scrollStatusWheelToOption(option.closest(".status-wheel-select"), option, behavior);
  }
}

function scrollStatusWheelToOption(wheel, option, behavior = "auto") {
  if (!wheel || !option) return;
  const targetTop = option.offsetTop - (wheel.clientHeight - option.offsetHeight) / 2;
  wheel.scrollTo({ top: Math.max(0, targetTop), behavior });
}

function statusWheelMiddleOption(wheel, value) {
  const matches = Array.from(wheel.querySelectorAll(".status-wheel-option"))
    .filter((option) => String(option.dataset.statusOption || "") === String(value || ""));
  if (!matches.length) return null;
  return matches[Math.floor(matches.length / 2)] || matches[0];
}

function statusWheelCenteredOption(wheel) {
  const options = Array.from(wheel.querySelectorAll(".status-wheel-option"));
  if (!options.length) return null;
  const wheelRect = wheel.getBoundingClientRect();
  const centerY = wheelRect.top + wheelRect.height / 2;
  return options.reduce((closest, option) => {
    const rect = option.getBoundingClientRect();
    const distance = Math.abs(rect.top + rect.height / 2 - centerY);
    if (!closest || distance < closest.distance) return { option, distance };
    return closest;
  }, null)?.option || null;
}

function syncStatusWheelFromScroll(wheel, { settle = false } = {}) {
  const option = statusWheelCenteredOption(wheel);
  if (!option) return;
  syncStatusWheelSelection(option, { scroll: settle, behavior: "smooth" });
  if (settle) {
    const middle = statusWheelMiddleOption(wheel, option.dataset.statusOption || "");
    const cycle = Number(option.dataset.statusCycle || 0);
    const maxCycle = Math.max(...Array.from(wheel.querySelectorAll(".status-wheel-option")).map((node) => Number(node.dataset.statusCycle || 0)));
    if (middle && (cycle <= 1 || cycle >= maxCycle - 1)) {
      requestAnimationFrame(() => scrollStatusWheelToOption(wheel, middle, "auto"));
    }
  }
}

function attachStatusWheelScroll(root = document) {
  root.querySelectorAll(".status-wheel-select").forEach((wheel) => {
    if (wheel.dataset.scrollSelectAttached === "1") return;
    wheel.dataset.scrollSelectAttached = "1";
    let frame = 0;
    let settleTimer = 0;
    wheel.addEventListener("scroll", () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          syncStatusWheelFromScroll(wheel);
        });
      }
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        syncStatusWheelFromScroll(wheel, { settle: true });
      }, 90);
    }, { passive: true });
  });
}

function centerStatusWheels(root = document) {
  root.querySelectorAll(".status-wheel-option.selected").forEach((option) => {
    requestAnimationFrame(() => scrollStatusWheelToOption(option.closest(".status-wheel-select"), option, "auto"));
  });
}

function attachHandlers() {
  syncTopbarSubmitAction();
  attachStatusWheelScroll();
  centerStatusWheels();
  app.onclick = async (event) => {
    if (event.target.closest("a")) return;
    const statusOption = event.target.closest("[data-status-option]");
    if (statusOption) {
      event.preventDefault();
      haptic();
      syncStatusWheelSelection(statusOption, { scroll: true, behavior: "smooth" });
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = Number(target.dataset.id || 0);
    const actionScrollTop = currentScrollTop();
    const actionScrollAnchor = captureScrollAnchor(target);
    haptic();
    if (action === "open-student") {
      event.preventDefault();
      app.style.visibility = "hidden";
      target.blur?.();
      if (state.activeView !== "student-detail") {
        state.studentDetailBackView = state.activeView || "students";
        state.studentDetailBackScroll = currentScrollTop();
      }
      restoreScrollTop(0);
      state.selectedStudentId = id;
      state.studentDetailPayload = null;
      state.editingStudent = false;
      state.studentDetailTab = "profile";
      state.activeView = "student-detail";
      await loadStudentDetail(id);
      renderTutor(state.payload);
      app.style.visibility = "";
      focusStudentDetailTop();
    } else if (action === "close-student") {
      cancelStudentDetailScrollReset();
      const backView = state.studentDetailBackView || "students";
      const backScroll = state.studentDetailBackScroll || 0;
      state.selectedStudentId = null;
      state.studentDetailPayload = null;
      state.editingStudent = false;
      state.studentDetailTab = "profile";
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
      state.studentDetailPayload = null;
      state.editingStudent = false;
      state.activeView = "students";
      await load();
    } else if (action === "toggle-fab") {
      const menu = document.querySelector(".fab-menu");
      menu.toggleAttribute("hidden");
    } else if (action === "go-view") {
      activateViewFromControl(target.dataset.viewTarget);
    } else if (action === "toggle-student-filters") {
      state.studentFiltersOpen = !state.studentFiltersOpen;
      renderCurrentPayloadPreservingScroll();
    } else if (action === "set-student-detail-tab") {
      state.studentDetailTab = target.dataset.tab || "profile";
      renderCurrentPayloadPreservingScroll();
    } else if (action === "scroll-pending") {
      activateViewFromControl("overview");
      document.querySelector("#pending-lessons-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "set-homework-filter") {
      state.filterHomework = target.dataset.value || "";
      renderCurrentPayloadPreservingScroll();
    } else if (action === "toggle-calendar-archive") {
      state.showCalendarArchive = !state.showCalendarArchive;
      renderCurrentPayloadPreservingScroll();
    } else if (action === "set-calendar-mode") {
      state.calendarMode = target.dataset.mode || "week";
      if (state.calendarMode !== "day") state.calendarFocusDate = "";
      renderCurrentPayloadPreservingScroll();
    } else if (action === "set-calendar-day") {
      state.calendarFocusDate = target.dataset.date || "";
      state.calendarMode = "day";
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
      if (state.activeView === "finances" || state.studentDetailTab === "payments") state.operationsHistoryOpen = true;
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
    } else if (action === "edit-mock-test") {
      const student = studentDetailRecord(id || state.selectedStudentId) || state.payload.dashboard?.student;
      if (student) openModal("Последний пробник", mockTestForm(student));
    } else if (action === "add-progress-note") {
      openModal("Новая заметка", progressNoteForm(id || state.selectedStudentId || state.payload.dashboard?.student?.id));
    } else if (action === "add-plan-item") {
      openModal("Пункт плана", planItemForm(id || state.selectedStudentId || state.payload.dashboard?.student?.id));
    } else if (action === "edit-plan-item") {
      const studentId = Number(target.dataset.studentId || state.selectedStudentId || state.payload.dashboard?.student?.id || 0);
      const item = (state.payload.dashboard?.plan || state.payload.admin?.plan_by_student?.[studentId] || []).find((entry) => entry.id === id);
      openModal("Редактировать пункт", planItemForm(studentId, item));
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
    } else if (action === "delete-plan-item") {
      const studentId = Number(target.dataset.studentId || state.selectedStudentId || state.payload.dashboard?.student?.id || 0);
      const scrollTop = currentScrollTop();
      if (confirm("Удалить пункт плана?")) {
        await api(`/api/students/${studentId}/plan/${id}`, { method: "DELETE" });
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
      state.activeView = "finances";
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
    syncOtherChoice(target);
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

  for (const eventName of ["touchstart", "pointerdown", "wheel", "keydown"]) {
    window.addEventListener(eventName, cancelStudentDetailScrollReset, { passive: true, capture: true });
  }
  document.body.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (target?.closest("#app")) return;
    if (target?.dataset.action === "set-duration") {
      syncDurationChoice(target.closest("form"), target.dataset.duration);
    } else if (target?.dataset.action === "set-duration-custom") {
      const form = target.closest("form");
      const current = form?.querySelector('input[name="duration_minutes"]')?.value || "60";
      const value = prompt("Длительность в минутах", current);
      if (value !== null) syncDurationChoice(form, value);
    } else if (target?.dataset.action === "close-modal") {
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
          "Если основной адрес не открывается через VPN, создай ссылку заново после включения tunnel-адреса."
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
          "Если основной адрес не открывается через VPN, создай ссылку заново после включения tunnel-адреса."
        );
      } catch (error) {
        result.innerHTML = `<p class="form-note full">${escapeHtml(error.message)}</p>`;
      } finally {
        target.disabled = false;
        target.textContent = target.dataset.defaultText || "Создать ссылку";
      }
    }
  });

  document.body.addEventListener("input", (event) => {
    const target = event.target;
    if (!target?.closest?.(".modal")) return;
    if (target.name === "starts_at" || target.name === "ends_at") syncTimeRangeInputs(target.closest("form"), target);
    if (target.name === "amount" && target.closest('form[data-form="payment-create"]')) syncPaymentHours(target.closest("form"));
  });

  document.body.addEventListener("change", (event) => {
    const target = event.target;
    if (!target?.closest?.(".modal")) return;
    if (target.name === "starts_at" || target.name === "ends_at") syncTimeRangeInputs(target.closest("form"), target);
    if ((target.name === "amount" || target.name === "student_id") && target.closest('form[data-form="payment-create"]')) syncPaymentHours(target.closest("form"));
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
      <section class="panel error-state miniapp-hint">
        <div class="hint-mark">Б</div>
        <p class="eyebrow">BOTай CRM</p>
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
    <section class="panel error-state miniapp-hint">
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

function cancelStudentDetailScrollReset() {
  for (const timer of state.studentDetailScrollResetTimers) {
    clearTimeout(timer);
  }
  state.studentDetailScrollResetTimers = [];
}

function resetViewScrollTop(anchor = null) {
  cancelStudentDetailScrollReset();
  restoreScrollTop(0);
  anchor?.scrollIntoView({ behavior: "auto", block: "start" });
  restoreScrollTop(0);
  state.studentDetailScrollResetTimers = [];
}

function focusStudentDetailTop() {
  resetViewScrollTop(document.querySelector('[data-view="student-detail"]'));
}

async function load({ preserveScroll = true, scrollTopOverride = null, scrollAnchor = null } = {}) {
  const scrollTop = preserveScroll ? (scrollTopOverride ?? currentScrollTop()) : 0;
  try {
    app.innerHTML = skeleton();
    const payload = await api("/api/me");
    if (payload.role === "tutor") {
      const selectedId = Number(state.selectedStudentId || 0);
      const selectedStudentExists = selectedId
        ? (payload.admin?.students || []).some((student) => Number(student.id) === selectedId)
        : false;
      if (selectedId && selectedStudentExists) {
        await loadStudentDetail(selectedId);
      } else {
        if (selectedId && !selectedStudentExists && state.activeView === "student-detail") {
          state.activeView = state.studentDetailBackView || "students";
        }
        if (!selectedStudentExists) state.selectedStudentId = null;
        state.studentDetailPayload = null;
      }
    } else {
      state.selectedStudentId = null;
      state.studentDetailPayload = null;
    }
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

function openProfileView() {
  if (!state.payload || !["tutor", "student", "parent"].includes(state.payload.role)) return;
  haptic();
  state.viewScrollTops[state.activeView] = currentScrollTop();
  state.activeView = "profile";
  state.editingSelf = false;
  if (state.payload.role === "tutor") renderTutor(state.payload);
  else renderClient(state.payload);
  attachHandlers();
  restoreScrollTop(0);
}

refreshButton.addEventListener("click", load);
profileActionButton?.addEventListener("click", openProfileView);
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
