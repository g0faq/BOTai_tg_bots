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
import { IconButton } from "./ui/button.js";
import { Toast } from "./ui/feedback.js";
import * as api from "./core/api.js";
import * as adapt from "./core/adapt.js";
import * as fmt from "./core/format.js";

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
  cardTab: "profile",
};

const tg = () => globalThis.Telegram?.WebApp;

function toast(text, tone = "none") {
  const host = document.getElementById("toast-host");
  if (!host) return;
  host.replaceChildren(Toast({ text, tone }));
  setTimeout(() => host.replaceChildren(), 4000);
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

async function reload() {
  const payload = await api.getMe();
  setPayload(payload);
  render();
}

/* --- сборка экранов ------------------------------------------------------- */

function tutorScreens(admin) {
  return {
    overview: () => ({
      mount: (c) => c.append(OverviewScreen({
        model: adapt.adaptOverview(admin),
        actions: {
          openCalendar: () => router.go("calendar"),
          openLesson: () => toast("Редактирование занятия — в следующей волне"),
          markConducted: () => toast("Отметка проведения — в следующей волне"),
          addLesson: () => toast("Форма занятия — в следующей волне"),
          addHomework: () => toast("Форма домашки — в следующей волне"),
          addStudent: () => toast("Форма ученика — в следующей волне"),
          addPayment: () => toast("Форма оплаты — в следующей волне"),
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
            openStudent: (id) => { setState({ selectedStudentId: id }); router.go("student-card"); },
            createStudent: () => toast("Форма ученика — в следующей волне"),
          },
        }));
      },
    }),

    "student-card": () => ({
      mount(c) {
        const model = adapt.adaptStudentCard(admin, getState().selectedStudentId);
        if (!model) return router.go("students");
        c.append(StudentCardScreen({
          model, tab: view.cardTab,
          actions: {
            setTab: (v) => { view.cardTab = v; render(); },
            back: () => router.go("students"),
            edit: () => toast("Редактирование — в следующей волне"),
            invite: () => run("Ссылка создана", () => api.createStudentBrowserInvite(model.student.id, { role: "student" })),
            openProgress: () => toast("Правка прогресса — в следующей волне"),
            addLesson: () => toast("Форма занятия — в следующей волне"),
            addHomework: () => toast("Форма домашки — в следующей волне"),
            addPayment: () => toast("Форма оплаты — в следующей волне"),
            addNote: () => toast("Форма заметки — в следующей волне"),
            addPlanItem: () => toast("Пункт плана — в следующей волне"),
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
          markConducted: (id) => run("Занятие проведено", () => api.updateLesson(id, { status: "проведено" })),
          confirmPayment: (id) => run("Оплата подтверждена", () => api.confirmLesson(id)),
          deleteClosedSlot: (id) => run("Окно открыто", () => api.deleteClosedSlot(id)),
          addLesson: () => toast("Форма занятия — в следующей волне"),
          freeSlots: () => toast("Свободные окна — в следующей волне"),
          addRule: () => toast("Стабильное расписание — в следующей волне"),
          addClosedSlot: () => toast("Нерабочие часы — в следующей волне"),
        },
      })),
    }),

    homeworks: () => ({
      mount(c) {
        const rows = adapt.adaptHomeworks(admin.homeworks || []);
        c.append(HomeworksScreen({
          items: adapt.filterHomeworks(rows, view.homeworkFilter),
          total: rows.length,
          filter: view.homeworkFilter,
          canCreate: true,
          actions: {
            setFilter: (v) => { view.homeworkFilter = v; render(); },
            createHomework: () => toast("Форма домашки — в следующей волне"),
            openHomework: () => toast("Карточка домашки — в следующей волне"),
          },
        }));
      },
    }),

    finances: () => ({
      mount: (c) => c.append(FinancesScreen({
        ...adapt.adaptFinances(admin),
        actions: {
          createPayment: () => toast("Форма оплаты — в следующей волне"),
          confirmPayment: (id) => run("Оплата подтверждена", () => api.confirmPayment(id)),
          editAdvance: () => toast("Правка аванса — в следующей волне"),
          setFilter: () => toast("Фильтр операций — в следующей волне"),
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
          back: () => router.go("overview"),
          invite: () => run("Ссылка кабинета создана", () => api.createTutorBrowserInvite({})),
          save: () => toast("Сохранение профиля — в следующей волне"),
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
          items: adapt.filterHomeworks(m.homeworks, view.homeworkFilter),
          total: m.homeworks.length,
          filter: view.homeworkFilter,
          canCreate: false,
          actions: {
            setFilter: (v) => { view.homeworkFilter = v; render(); },
            openHomework: () => toast("Сдача домашки — в следующей волне"),
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
          editProgress: () => toast("Правка прогресса — в следующей волне"),
          addNote: () => toast("Заметка — в следующей волне"),
          addPlanItem: () => toast("Пункт плана — в следующей волне"),
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
          edit: () => toast("Редактирование профиля — в следующей волне"),
          remove: () => toast("Удаление профиля — в следующей волне"),
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
  const active = router?.active && screens[router.active] ? router.active : "overview";

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
      IconButton({ glyph: "◍", label: "Профиль", onClick: () => router.go("profile") }),
      IconButton({ glyph: "↻", label: "Обновить", onClick: () => reload().catch(() => toast("Не удалось обновить", "debt")) }),
    ],
  }));

  shell.tabbar.replaceChildren(TabBar({
    items: tabs,
    value: tabs.some((t) => t.value === router.active) ? router.active : active,
    onSelect: (v) => router.go(v),
  }));

  // Fab возвращает null для роли без действий — replaceChildren(null)
  // вставил бы строку "null", поэтому чистим явно.
  shell.fab.replaceChildren();
  const fab = isTutor
    ? Fab({ actions: [
        { label: "Добавить ученика", onClick: () => toast("Форма ученика — в следующей волне") },
        { label: "Разовая запись", onClick: () => toast("Форма занятия — в следующей волне") },
        { label: "Стабильное расписание", onClick: () => toast("Стабильное расписание — в следующей волне") },
        { label: "Нерабочие часы", onClick: () => toast("Нерабочие часы — в следующей волне") },
        { label: "Создать домашку", onClick: () => toast("Форма домашки — в следующей волне") },
        { label: "Добавить оплату", onClick: () => toast("Форма оплаты — в следующей волне") },
      ] })
    : null;
  if (fab) shell.fab.append(fab);

  router.go(active);
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
