/* Приложение v2.
 *
 * Грузит /api/me, выбирает набор экранов по роли и монтирует ровно один
 * активный экран. Все обращения к серверу идут через core/api.js, статусы —
 * через core/dict.js, форма payload известна только core/adapt.js.
 */

import { el } from "./ui/dom.js";
import { createRouter } from "./core/router.js";
import { getState, setState, setPayload } from "./core/state.js";
import { Header, TabBar, Fab } from "./ui/shell.js";
import { Button, IconButton } from "./ui/button.js";
import { Toast } from "./ui/feedback.js";
import * as api from "./core/api.js";
import * as adapt from "./core/adapt.js";
import * as fmt from "./core/format.js";
import * as dict from "./core/dict.js";

import { OverviewScreen } from "./screens/overview.js";
import { CalendarScreen } from "./screens/calendar.js";
import { StudentsScreen } from "./screens/students.js";
import { StudentCardScreen } from "./screens/student-card.js";
import { HomeworksScreen } from "./screens/homeworks.js";
import { FinancesScreen } from "./screens/finances.js";
import { TutorProfileScreen } from "./screens/tutor-profile.js";
import {
  ClientOverviewScreen, ClientCalendarScreen, ClientProgressScreen,
  ClientPaymentsScreen, ClientProfileScreen,
} from "./screens/client.js";
import { RegisterScreen, LoadingScreen, ErrorScreen } from "./screens/service.js";
import { openForm } from "./screens/forms.js";

const TUTOR_TABS = [
  { value: "overview", label: "Обзор" }, { value: "students", label: "Ученики" },
  { value: "calendar", label: "Кален." }, { value: "homeworks", label: "ДЗ" },
  { value: "finances", label: "Фин." },
];

const CLIENT_TABS = [
  { value: "overview", label: "Обзор" }, { value: "calendar", label: "Кален." },
  { value: "homeworks", label: "ДЗ" }, { value: "progress", label: "Прогр." },
  { value: "finances", label: "Оплаты" },
];

/* Локальное состояние вида: фильтры и режимы, которые не живут на сервере. */
const view = {
  studentFilters: { chip: "all", query: "", prep: "", sort: "next" },
  filtersOpen: false,
  homeworkFilter: "all",
  calendarMode: "week",
  calendarArchive: false,
  operationFilter: "",
  operationsOpen: false,
  cardTab: "profile",
  screen: "overview",
};

/* Какую вкладку подсвечивать для экрана. Карточка ученика — часть раздела
 * «Ученики», профиль вкладкой не представлен. */
const TAB_FOR_SCREEN = { "student-card": "students", profile: null };
const tabForScreen = (id) => (id in TAB_FOR_SCREEN ? TAB_FOR_SCREEN[id] : id);

const tg = () => globalThis.Telegram?.WebApp;

function toast(text, tone = "none", action = null) {
  const host = document.getElementById("toast-host");
  if (!host) return;
  const button = action
    ? Button({ kind: "inline", label: action.label, onClick: () => { host.replaceChildren(); action.onClick(); } })
    : null;
  host.replaceChildren(Toast({ text, tone, action: button }));
  // С отменой держим дольше: пользователю нужно успеть передумать.
  setTimeout(() => host.replaceChildren(), action ? 8000 : 4000);
}

/**
 * Закрытие долга свайпом: занятие помечается оплаченным.
 *
 * Свайп легко сделать случайно, а действие финансовое, поэтому рядом с
 * подтверждением всегда живёт отмена — она возвращает прежний статус.
 */
async function closeDebt(lessonId) {
  try {
    // Именно payment_status: роут /confirm подтверждает заявку на занятие,
    // а не оплату, и для прочих статусов молча ничего не делает.
    await api.updateLesson(lessonId, { payment_status: dict.PAYMENT_STATUS.CONFIRMED });
    await reload();
    toast("Долг закрыт", "done", {
      label: "Отменить",
      onClick: () => run("Долг возвращён", () => api.updateLesson(lessonId, {
        payment_status: dict.PAYMENT_STATUS.UNPAID,
      })),
    });
  } catch (error) {
    toast(error?.detail || "Не удалось закрыть долг", "debt");
    await reload();
  }
}

/** Действие с обновлением payload и понятной ошибкой вместо тишины. */
async function run(label, fn) {
  try {
    await fn();
    await reload();
    toast(label, "done");
  } catch (error) {
    toast(error?.detail || error?.message || "Не удалось выполнить", "debt");
  }
}

let router = null;
let shell = null;
let paintTabs = () => {};

/** Единственная точка перехода: меняет экран и сразу обновляет подсветку. */
function goTo(id) {
  view.screen = id;
  router.go(id);
  paintTabs();
}

/** Контекст, который нужен формам: список учеников и выбранный ученик. */
function formCtx() {
  const p = getState().payload || {};
  return {
    students: p.admin?.students || (p.dashboard?.student ? [p.dashboard.student] : []),
    selectedStudentId: getState().selectedStudentId,
  };
}

const form = (name, params = {}) => openForm(name, { ctx: formCtx(), ...params }, {
  onDone: () => reload().catch(() => toast("Не удалось обновить", "debt")),
});

async function reload() {
  const payload = await api.getMe();
  setPayload(payload);
  render();
}

const findLesson = (admin, id) =>
  [...(admin.calendar || []), ...(admin.calendar_archive || [])].find((l) => Number(l.id) === Number(id));
const topicsFor = (admin, id) =>
  (admin.topics_by_student || {})[id] || (admin.topics_by_student || {})[String(id)] || [];

/* --- сборка экранов ------------------------------------------------------- */

function tutorScreens(admin) {
  return {
    overview: () => ({
      mount: (c) => c.append(OverviewScreen({
        model: adapt.adaptOverview(admin),
        actions: {
          openCalendar: () => goTo("calendar"),
          openLesson: (id) => form("lesson", { lesson: findLesson(admin, id) }),
          addLesson: () => form("lesson"),
          goTo,
        },
      })),
    }),

    students: () => ({
      mount(c) {
        const rows = adapt.adaptStudents(admin);
        c.append(StudentsScreen({
          students: adapt.filterStudents(rows, admin, view.studentFilters),
          total: rows.length,
          chips: adapt.studentChips(admin),
          filters: view.studentFilters,
          filtersOpen: view.filtersOpen,
          actions: {
            toggleFilters: () => { view.filtersOpen = !view.filtersOpen; render(); },
            setChip: (v) => { view.studentFilters.chip = v; render(); },
            setQuery: (v) => { view.studentFilters.query = v; render(); },
            setPrep: (v) => { view.studentFilters.prep = v; render(); },
            setSort: (v) => { view.studentFilters.sort = v; render(); },
            openStudent: (id) => { setState({ selectedStudentId: id }); goTo("student-card"); },
            createStudent: () => form("student"),
          },
        }));
      },
    }),

    "student-card": () => ({
      mount(c) {
        const model = adapt.adaptStudentCard(admin, getState().selectedStudentId);
        if (!model) return goTo("students");
        c.append(StudentCardScreen({
          model, tab: view.cardTab,
          actions: {
            setTab: (v) => { view.cardTab = v; render(); },
            back: () => goTo("students"),
            openLesson: (id) => form("lesson", { lesson: findLesson(admin, id) }),
            openNextLesson: () => {
              const next = (admin.calendar || []).find((l) => Number(l.student_id) === Number(getState().selectedStudentId));
              if (next) form("lesson", { lesson: next });
            },
            edit: () => form("student", { student: (admin.students || []).find((x) => Number(x.id) === Number(getState().selectedStudentId)) }),
            invite: () => form("browserInvite", { studentId: model.student.id }),
            openProgress: () => form("progress", { studentId: model.student.id, topics: topicsFor(admin, model.student.id) }),
            addLesson: () => form("lesson"),
            addHomework: () => form("homework"),
            addPayment: () => form("payment"),
            addNote: () => form("progress", { studentId: model.student.id, topics: topicsFor(admin, model.student.id) }),
            addPlanItem: () => form("planItem", { studentId: model.student.id }),
            cleanupSchedule: () => form("scheduleCleanup", {
              studentId: model.student.id, studentName: model.student.name,
            }),
            togglePlanItem: (id) => {
              const item = model.plan.find((p) => p.id === id);
              return run("План обновлён", () => api.updatePlanItem(model.student.id, id, {
                status: item?.done ? "не начато" : "выполнено",
              }));
            },
          },
        }));
      },
    }),

    calendar: () => ({
      mount: (c) => c.append(CalendarScreen({
        model: adapt.adaptCalendar(admin, { mode: view.calendarMode, archive: view.calendarArchive }),
        mode: view.calendarMode,
        archive: view.calendarArchive,
        actions: {
          setMode: (v) => { view.calendarMode = v; render(); },
          toggleArchive: () => { view.calendarArchive = !view.calendarArchive; render(); },
          openLesson: (id) => form("lesson", { lesson: findLesson(admin, id) }),
          markConducted: (id) => run("Занятие проведено", () => api.updateLesson(id, { status: "проведено" })),
          confirmPayment: (id) => run("Оплата подтверждена", () => api.updateLesson(id, { payment_status: dict.PAYMENT_STATUS.CONFIRMED })),
          deleteClosedSlot: (id) => run("Окно открыто", () => api.deleteClosedSlot(id)),
          addLesson: () => form("lesson"),
          freeSlots: () => form("freeSlots", { onPick: (startsAt) => form("lesson", { lesson: { starts_at: startsAt, duration_minutes: 60 } }) }),
          addRule: () => form("scheduleRule"),
          addClosedSlot: () => form("closedSlot"),
        },
      })),
    }),

    homeworks: () => ({
      mount(c) {
        const archive = view.homeworkFilter === "archive";
        const rows = adapt.adaptHomeworks(
          (archive ? admin.homeworks_archive : admin.homeworks) || [],
        );
        c.append(HomeworksScreen({
          items: adapt.filterHomeworks(rows, view.homeworkFilter),
          total: rows.length,
          archiveNote: archive,
          filter: view.homeworkFilter,
          canCreate: true,
          actions: {
            setFilter: (v) => { view.homeworkFilter = v; render(); },
            createHomework: () => form("homework"),
            openHomework: (id) => form("homework", { homework: (admin.homeworks || []).find((h) => Number(h.id) === Number(id)) }),
          },
        }));
      },
    }),

    finances: () => ({
      mount: (c) => c.append(FinancesScreen({
        ...adapt.adaptFinances(admin, { operationFilter: view.operationFilter }),
        filter: view.operationFilter,
        operationsOpen: view.operationsOpen,
        actions: {
          createPayment: () => form("payment"),
          confirmPayment: (id) => run("Оплата подтверждена", () => api.confirmPayment(id)),
          editAdvance: (id) => form("advance", { advance: (admin.finances?.advances || []).find((a) => Number(a.payment_id) === Number(id)) }),
          setFilter: (v) => { view.operationFilter = v; render(); },
          toggleOperations: () => { view.operationsOpen = !view.operationsOpen; render(); },
          closeDebt,
        },
      })),
    }),

    profile: () => ({
      mount: (c) => c.append(TutorProfileScreen({
        profile: admin.profile || {},
        subjects: admin.profile?.subjects || [],
        prepTypes: admin.profile?.prep_types || [],
        workingDays: admin.profile?.working_days || [1, 2, 3, 4, 5, 6, 7],
        actions: {
          back: () => goTo("overview"),
          invite: () => form("browserInvite", {}),
          save: () => run("Профиль сохранён", () => api.updateTutorProfile({ ...(admin.profile || {}) })),
        },
      })),
    }),
  };
}

function clientScreens(payload) {
  const m = adapt.adaptClient(payload);
  return {
    overview: () => ({
      mount: (c) => c.append(ClientOverviewScreen({
        student: m.student, metrics: m.metrics, levels: m.levels,
      })),
    }),
    calendar: () => ({
      mount: (c) => c.append(ClientCalendarScreen({
        period: "", mode: view.calendarMode, summary: m.calendarSummary, days: m.calendarDays,
        actions: { setMode: (v) => { view.calendarMode = v; render(); } },
      })),
    }),
    homeworks: () => ({
      mount(c) {
        c.append(HomeworksScreen({
          items: adapt.filterHomeworks(
            view.homeworkFilter === "archive" ? m.homeworksArchive : m.homeworks,
            view.homeworkFilter,
          ),
          total: (view.homeworkFilter === "archive" ? m.homeworksArchive : m.homeworks).length,
          archiveNote: view.homeworkFilter === "archive",
          filter: view.homeworkFilter,
          canCreate: false,
          actions: {
            setFilter: (v) => { view.homeworkFilter = v; render(); },
            openHomework: (id) => form("homeworkSubmit", { homework: (payload.dashboard?.homeworks || []).find((h) => Number(h.id) === Number(id)) }),
          },
        }));
      },
    }),
    progress: () => ({
      mount: (c) => c.append(ClientProgressScreen({
        current: m.progressCurrent, goal: m.progressGoal, levels: m.levels,
        taskNotes: m.taskNotes, plan: m.plan, canEdit: m.canEdit,
        actions: {
          togglePlanItem: (id) => {
            const item = m.plan.find((p) => p.id === id);
            return run("План обновлён", () => api.updatePlanItem(m.student.id, id, {
              status: item?.done ? "не начато" : "выполнено",
            }));
          },
          editProgress: () => form("progress", { studentId: m.student.id, topics: payload.dashboard?.topics || [] }),
          addNote: () => form("progress", { studentId: m.student.id, topics: payload.dashboard?.topics || [] }),
          addPlanItem: () => form("planItem", { studentId: model.student.id }),
        },
      })),
    }),
    finances: () => ({
      mount: (c) => c.append(ClientPaymentsScreen({
        rate: m.rate, debt: m.debt, days: m.paymentDays, unpaid: m.unpaid,
        actions: { markPaid: (id) => run("Оплата отмечена", () => api.markLessonPaid(id, {})) },
      })),
    }),
    profile: () => ({
      mount: (c) => c.append(ClientProfileScreen({
        facts: m.facts, links: m.links,
        canEdit: m.canEdit, canDelete: payload.role === "student",
        actions: {
          edit: () => form("student", { student: payload.dashboard?.student }),
          remove: () => run("Профиль удалён", () => api.deleteMyStudent()),
        },
      })),
    }),
  };
}

/* --- рендер --------------------------------------------------------------- */

function render() {
  const state = getState();
  const payload = state.payload;
  if (!payload) return;

  const isTutor = payload.role === "tutor";
  const tabs = isTutor ? TUTOR_TABS : CLIENT_TABS;

  if (payload.role === "guest") {
    shell.body.replaceChildren(RegisterScreen({
      role: view.guestRole || "student",
      values: view.guestValues || {},
      actions: {
        setRole: (v) => { view.guestRole = v; render(); },
        setValue: (k, v) => { view.guestValues = { ...(view.guestValues || {}), [k]: v }; },
        submit: () => run("Кабинет создан", () => api.register({
          role: view.guestRole || "student", ...(view.guestValues || {}),
        })),
      },
    }));
    shell.tabbar.replaceChildren();
    shell.fab.replaceChildren();
    return;
  }

  const screens = isTutor ? tutorScreens(payload.admin || {}) : clientScreens(payload);
  const active = screens[view.screen] ? view.screen : "overview";

  if (!router || router.registered.join() !== Object.keys(screens).join()) {
    router = createRouter({ container: shell.body });
    for (const [id, factory] of Object.entries(screens)) router.register(id, factory);
  } else {
    for (const [id, factory] of Object.entries(screens)) router.register(id, factory);
  }

  shell.header.replaceChildren(Header({
    subtitle: isTutor
      ? `${(payload.admin?.summary?.students) || 0} уч. · ${(payload.admin?.summary?.week_lessons) || 0} уроков`
      : payload.role === "parent" ? "Кабинет родителя" : "Кабинет ученика",
    actions: [
      IconButton({ glyph: "◍", label: "Профиль", onClick: () => goTo("profile") }),
      IconButton({ glyph: "↻", label: "Обновить", onClick: () => reload().catch(() => toast("Не удалось обновить", "debt")) }),
    ],
  }));

  paintTabs = () => shell.tabbar.replaceChildren(TabBar({
    items: tabs,
    value: tabForScreen(view.screen),
    onSelect: goTo,
  }));

  // Fab возвращает null для роли без действий — replaceChildren(null)
  // вставил бы строку "null", поэтому чистим явно.
  shell.fab.replaceChildren();
  const fab = isTutor
    ? Fab({ actions: [
        { label: "Добавить ученика", onClick: () => form("student") },
        { label: "Разовая запись", onClick: () => form("lesson") },
        { label: "Стабильное расписание", onClick: () => form("scheduleRule") },
        { label: "Нерабочие часы", onClick: () => form("closedSlot") },
        { label: "Создать домашку", onClick: () => form("homework") },
        { label: "Добавить оплату", onClick: () => form("payment") },
      ] })
    : null;
  if (fab) shell.fab.append(fab);

  view.screen = active;
  router.go(active);
  paintTabs();
}

/* --- запуск --------------------------------------------------------------- */

async function boot() {
  const root = document.getElementById("root");
  tg()?.ready?.();
  tg()?.expand?.();

  // Локальная отладка: ?dev=<telegram_id>. Сервер принимает этот заголовок
  // только на localhost, поэтому на проде параметр ничего не даёт.
  const dev = new URLSearchParams(location.search).get("dev");
  if (dev) api.setDevTelegramId(dev);

  shell = {
    header: el("div", { id: "header-host" }),
    body: el("main", { class: "app-body", id: "screen" }),
    tabbar: el("div", { id: "tabbar-host" }),
    fab: el("div", { id: "fab-host" }),
    toast: el("div", { class: "toast-host", id: "toast-host" }),
  };
  root.replaceChildren(shell.header, shell.body, shell.fab, shell.tabbar, shell.toast);

  shell.body.append(LoadingScreen());

  try {
    await reload();
  } catch (error) {
    shell.body.replaceChildren(ErrorScreen({
      code: `код ${error?.status || "—"} · ${fmt.dayMonth(new Date())}, ${fmt.time(new Date())}`,
      description: error?.status === 401
        ? "Открой Mini App из Telegram — там авторизация происходит сама."
        : "Нет связи с сервером. Проверьте интернет и повторите — данные сохранены, ничего не потеряно.",
      actions: { retry: () => boot() },
    }));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
