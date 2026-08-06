/* Приёмка экранов прохода 2. Только моковые данные, без обращений к API. */

import { el, num } from "./ui/dom.js";
import { Header, TabBar, Fab } from "./ui/shell.js";
import { StatusPill } from "./ui/status-pill.js";
import { Button } from "./ui/button.js";
import { StudentsScreen } from "./screens/students.js";
import { StudentCardScreen, CARD_TABS } from "./screens/student-card.js";
import { HomeworksScreen } from "./screens/homeworks.js";
import { FinancesScreen } from "./screens/finances.js";
import { TutorProfileScreen } from "./screens/tutor-profile.js";
import * as dict from "./core/dict.js";
import * as fmt from "./core/format.js";

const L = dict.LESSON_STATUS;
const P = dict.PAYMENT_STATUS;

const TABS = [
  { value: "overview", label: "Обзор" }, { value: "students", label: "Ученики" },
  { value: "calendar", label: "Кален." }, { value: "homeworks", label: "ДЗ" },
  { value: "finances", label: "Фин." },
];

const FAB_ACTIONS = [
  { label: "Добавить ученика" }, { label: "Разовая запись" },
  { label: "Стабильное расписание" }, { label: "Нерабочие часы" },
  { label: "Создать домашку" }, { label: "Добавить оплату" },
];

/* --- моки ---------------------------------------------------------------- */

const LV = {
  mv: [8,7,9,6,5,10,4,3,7,8,6,9,2,5,7,8,10,6,4,3,5,7,8,2,6,9,1],
  nk: [5,6,4,7,3,8,2,5,6,7,4,3,8,5,6,2,7,4,5,6,3,8,5,4,6,7,5],
  ap: [9,8,10,7,9,8,6,9,10,8,7,9,8,10,6,9,8,7,10,9,8,6,9,10,7,8,9],
  sk: [4,3,5,2,6,4,3,5,4,2,6,3,4,5,3,2,4,6,3,5,4,2,5,3,4,6,2],
};

const STUDENTS = [
  { id: 1, name: "Михаил Волосов", meta: "Информатика · ЕГЭ · 11 класс", balance: fmt.hoursSigned(4), balanceTone: "done", next: "завтра", notch: dict.paymentStatus(P.CONFIRMED), levels: LV.mv },
  { id: 2, name: "Назар Кириленко", meta: "Информатика · ОГЭ · 9 класс", balance: fmt.moneySigned(-1500), balanceTone: "debt", next: "через 3 дня", notch: dict.paymentStatus(P.UNPAID), levels: LV.nk },
  { id: 3, name: "Аня Петрова", meta: "Информатика · ЕГЭ · 11 класс", balance: fmt.money(0), balanceTone: "none", next: "сегодня", notch: dict.lessonStatus(L.PLANNED), levels: LV.ap },
  { id: 4, name: "Соня Ким", meta: "Информатика · ВПР · 8 класс", balance: fmt.hoursSigned(2), balanceTone: "none", next: "через неделю", notch: dict.paymentStatus(P.NOT_MARKED), levels: LV.sk },
];

const CHIPS = [
  { value: "Все", label: "Все", count: 12 }, { value: "Активные", label: "Активные", count: 7 },
  { value: "Есть долг", label: "Есть долг", count: 2 }, { value: "Без плана", label: "Без плана", count: 3 },
  { value: "Архив", label: "Архив", count: 5 },
];

const CARD_MODEL = {
  student: {
    name: "Михаил Волосов", initials: "МВ",
    facts: ["11 класс", "Информатика", "ЕГЭ"],
    goal: "Цель: 85 баллов, ИТМО",
    nextWhen: "завтра · 15:00", nextMeta: `Информатика · ${fmt.minutes(60)}`, nextPrice: fmt.money(1500),
    nextNotch: dict.lessonStatus(L.PLANNED),
    progressPercent: 62, progressGoal: 80,
    conducted: 24, cancelled: 2, mockValue: "21/27", mockLabel: "Пробник · 78 б",
    levels: LV.mv, levelsGoal: 27,
  },
  taskNotes: [
    { number: "№5", percent: "70 %", label: "закрепить", text: "Путает порядок битов при переводе", notch: dict.lessonStatus(L.PENDING) },
    { number: "№16", percent: "40 %", label: "нужно повторить", text: "Рекурсия — разобрать базовый случай", notch: dict.paymentStatus(P.UNPAID) },
    { number: "№24", percent: "90 %", label: "уверенно", text: "Строки, всё стабильно", notch: dict.lessonStatus(L.CONDUCTED) },
  ],
  lessonsCount: 24,
  lessonDays: [
    { title: "четверг, 6 августа", total: fmt.money(2400), items: [
      { id: 1, time: "09:00", topic: "Задание 25 · рекурсия", price: fmt.money(900), lessonStatus: dict.lessonStatus(L.CONDUCTED), paymentStatus: dict.paymentStatus(P.CONFIRMED) },
      { id: 2, time: "15:00", topic: "Динамическое программирование", price: fmt.money(1500), lessonStatus: dict.lessonStatus(L.PLANNED), paymentStatus: dict.paymentStatus(P.NOT_MARKED) },
    ] },
    { title: "вторник, 4 августа", total: fmt.money(1500), items: [
      { id: 3, time: "15:00", topic: "Задание 17 · обработка массивов", price: fmt.money(1500), lessonStatus: dict.lessonStatus(L.CONDUCTED), paymentStatus: dict.paymentStatus(P.STUDENT_MARKED) },
    ] },
  ],
  homeworks: [
    { id: 1, title: "Задания 24–27, вариант 12", meta: `до ${fmt.dayMonth("2026-08-08")} · 4 задачи`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.WAITING) },
    { id: 2, title: "Рекурсия: разбор базового случая", meta: `до ${fmt.dayMonth("2026-08-03")}`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.OVERDUE) },
    { id: 3, title: "Перевод систем счисления", meta: `сдано ${fmt.dayMonth("2026-08-01")}`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.DONE) },
  ],
  finance: {
    paidShare: 6, waitingShare: 2, debtShare: 2,
    paidHours: fmt.hours(6), debt: `${fmt.money(1500)} · 1 урок`, debtTone: "debt",
  },
  paymentDays: [
    { title: "вторник, 4 августа", total: fmt.money(6000), items: [
      { name: "Аванс · 4 ч", meta: fmt.money(6000), notch: dict.paymentStatus(P.CONFIRMED), pill: StatusPill(dict.paymentStatus(P.CONFIRMED)) },
    ] },
    { title: "среда, 29 июля", total: fmt.money(1500), items: [
      { name: "Занятие 29.07", meta: fmt.money(1500), notch: dict.paymentStatus(P.STUDENT_MARKED), pill: StatusPill(dict.paymentStatus(P.STUDENT_MARKED)) },
    ] },
  ],
  unpaid: [
    { name: `Занятие ${fmt.dayMonth("2026-07-29")} · ${fmt.minutes(60)}`, meta: `${fmt.money(1500)} · не оплачено`, notch: dict.paymentStatus(P.UNPAID) },
  ],
  notes: [
    { title: "Задание 25 · рекурсия", text: "Путает базовый случай. Дал три задачи на разбор, проверить на следующем занятии.", date: fmt.dayMonth("2026-08-02"), notch: { tone: "none", mark: dict.NOTCH.NONE } },
  ],
  plan: [
    { id: 1, title: "Закрыть задания 24–27", meta: `до ${fmt.dayMonth("2026-09-01")}`, status: "в процессе", done: false, notch: dict.planStatus(dict.PLAN_STATUS.IN_PROGRESS) },
    { id: 2, title: "Пробник №3", meta: `до ${fmt.dayMonth("2026-08-20")}`, status: "выполнено", done: true, notch: dict.planStatus(dict.PLAN_STATUS.DONE) },
    { id: 3, title: "Повторить системы счисления", meta: "без дедлайна", status: "нужно повторить", done: false, notch: dict.planStatus(dict.PLAN_STATUS.REPEAT) },
  ],
  links: [
    { label: "Доска", value: "https://unidraw.io/app/board/b50c7b30" },
    { label: "Звонок", value: "" },
    { label: "Telegram", value: "@misha" },
  ],
};

const HOMEWORKS = [
  { id: 1, title: "Задания 24–27, вариант 12", meta: `Михаил Волосов · до ${fmt.dayMonth("2026-08-08")}`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.WAITING), files: "2 файл." },
  { id: 2, title: "Рекурсия: разбор базового случая", meta: `Назар Кириленко · до ${fmt.dayMonth("2026-08-03")}`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.OVERDUE), link: "https://example.org" },
  { id: 3, title: "Перевод систем счисления", meta: `Аня Петрова · сдано ${fmt.dayMonth("2026-08-01")}`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.SUBMITTED) },
  { id: 4, title: "Массивы и циклы", meta: `Соня Ким · выполнено`, notch: dict.homeworkStatus(dict.HOMEWORK_STATUS.DONE) },
];

const KPI = [
  { label: "Сегодня", value: fmt.money(1500), notch: dict.lessonStatus(L.CONDUCTED) },
  { label: "Неделя", value: fmt.money(18900), notch: dict.lessonStatus(L.CONDUCTED) },
  { label: "Месяц", value: fmt.money(54300), notch: dict.lessonStatus(L.CONDUCTED) },
  { label: "Ожидается сегодня", value: fmt.money(1500), notch: dict.paymentStatus(P.STUDENT_MARKED) },
  { label: "Ожидается неделя", value: fmt.money(4500), notch: dict.paymentStatus(P.STUDENT_MARKED) },
  { label: "Долги", value: fmt.money(3000), notch: dict.paymentStatus(P.UNPAID), tone: "debt" },
];

const FIN_MODEL = {
  kpi: KPI,
  income: [["Пн", 2400], ["Вт", 3600], ["Ср", 1500], ["Чт", 4200], ["Пт", 3000], ["Сб", 2700], ["Вс", 1500]]
    .map(([label, value]) => ({ label, value })),
  incomeTotal: fmt.money(18900),
  advances: [
    { id: 1, name: "Михаил Волосов", meta: `Внесен ${fmt.dayMonth("2026-08-04")} · ${fmt.hours(4)} · ${fmt.money(6000)}`, meta2: `Списано: ${fmt.money(1500)} · долг: ${fmt.money(0)}`, left: `${fmt.hours(3)} осталось`, notch: dict.paymentStatus(P.CONFIRMED) },
    { id: 2, name: "Соня Ким", meta: `Внесен ${fmt.dayMonth("2026-07-21")} · ${fmt.hours(2)} · ${fmt.money(2700)}`, meta2: "Не списывались", left: `${fmt.hours(2)} осталось`, notch: dict.paymentStatus(P.CONFIRMED) },
  ],
  operationsCount: 30,
  operationDays: [
    { title: "вторник, 4 августа", total: fmt.money(6000), items: [
      { name: "Михаил Волосов", meta: `аванс · ${fmt.dayMonth("2026-08-04")} · ${fmt.money(6000)}`, notch: dict.paymentStatus(P.CONFIRMED), tail: "подтверждено" },
    ] },
    { title: "среда, 29 июля", total: fmt.money(1500), items: [
      { name: "Назар Кириленко", meta: `занятие · ${fmt.dayMonth("2026-07-29")} · ${fmt.money(1500)}`, notch: dict.paymentStatus(P.STUDENT_MARKED), tail: "ожидает" },
    ] },
  ],
  toCheck: [
    { id: 1, name: "Назар Кириленко", meta: `${fmt.money(1500)} · ученик отметил оплату`, notch: dict.paymentStatus(P.STUDENT_MARKED) },
    { id: 2, name: "Аня Петрова", meta: `${fmt.money(3000)} · родитель отметил оплату`, notch: dict.paymentStatus(P.PARENT_MARKED) },
  ],
  unpaid: [],
};

/* --- каркас страницы ----------------------------------------------------- */

function phone(label, note, build) {
  const body = el("div", { class: "phone__body" });
  const shell = el("div", { class: "phone" }, [
    Header({ subtitle: "10 уч. · 6 уроков", actions: [] }),
    body,
    el("div", { class: "phone__fab" }, [Fab({ actions: FAB_ACTIONS })]),
    TabBar({ items: TABS, value: "students", onSelect: () => {} }),
  ]);
  build(body);
  return el("article", { class: "kit-demo" }, [
    el("span", { class: "kit-demo__label", text: label }),
    shell,
    note ? el("p", { class: "kit-demo__note", text: note }) : null,
  ]);
}

function studentsDemo() {
  let filtersOpen = true;
  let chip = "Все";
  const host = el("div", {});
  const render = () => host.replaceChildren(StudentsScreen({
    students: STUDENTS, total: 12, chips: CHIPS, filtersOpen,
    filters: { chip, query: "", prep: "", sort: "next" },
    actions: {
      toggleFilters: () => { filtersOpen = !filtersOpen; render(); },
      setChip: (v) => { chip = v; render(); },
    },
  }));
  render();
  return host;
}

function cardDemo() {
  let tab = "profile";
  const host = el("div", {});
  const render = () => host.replaceChildren(StudentCardScreen({
    model: CARD_MODEL, tab,
    actions: { setTab: (v) => { tab = v; render(); } },
  }));
  render();
  return host;
}

function homeworksDemo() {
  let filter = "all";
  const host = el("div", {});
  const render = () => host.replaceChildren(HomeworksScreen({
    items: HOMEWORKS, total: HOMEWORKS.length, filter, canCreate: true,
    actions: { setFilter: (v) => { filter = v; render(); } },
  }));
  render();
  return host;
}

function boot() {
  const root = document.getElementById("root");
  root.replaceChildren(
    el("header", { class: "kit-head" }, [
      el("p", { class: "num kit-head__eyebrow", text: "БОТай CRM · v2 · проход 2" }),
      el("h1", { class: "kit-head__title", text: "Экраны репетитора" }),
      el("p", { class: "kit-head__lead", text: "Ученики, карточка ученика, домашние задания, финансы и профиль. Та же система: разлинованная сетка, засечка статуса в жёлобе, табличные цифры, ахроматический акцент. Моковые данные, без обращений к API." }),
      el("nav", { class: "kit-nav" }, [
        el("a", { class: "kit-nav__link", href: "./kit.html", text: "← Витрина компонентов" }),
      ]),
    ]),
    el("div", { class: "kit-grid kit-grid--phones" }, [
      phone("Ученики", "Чипы и кнопка «Фильтры» рабочие — нажмите.", (b) => b.append(studentsDemo())),
      phone("Карточка ученика · шесть вкладок", "Вкладки переключаются. Активная монтируется, остальные не строятся.", (b) => b.append(cardDemo())),
      phone("Домашние задания", "Сегментированный фильтр рабочий, счётчик показывает «отфильтровано / всего».", (b) => b.append(homeworksDemo())),
      phone("Финансы", "Шесть KPI — ячейки табло 3×2, засечка кодирует смысл.", (b) => b.append(FinancesScreen(FIN_MODEL))),
      phone("Профиль репетитора", "Чипы предметов и подготовок, рабочие дни.", (b) => b.append(TutorProfileScreen({
        profile: { full_name: "Фёдор Волосов", experience: "6 лет", description: "Готовлю к ЕГЭ и ОГЭ по информатике. Разбираю все 27 заданий, веду прогресс по каждому." },
        subjects: ["Информатика", "Математика", "Алгоритмика"],
        prepTypes: ["ЕГЭ", "ОГЭ", "Python"],
        workingDays: [1, 2, 3, 4, 5, 6],
      }))),
    ]),
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
