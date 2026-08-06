/* Приёмка прохода 3: кабинеты клиента, регистрация, служебное, модалки.
 * Только моковые данные, без обращений к API.
 */

import { el, num } from "./ui/dom.js";
import { Header, TabBar } from "./ui/shell.js";
import { Button, IconButton } from "./ui/button.js";
import { StatusPill } from "./ui/status-pill.js";
import { Segmented } from "./ui/chip.js";
import { Modal } from "./ui/modal.js";
import { MODAL_NAMES, buildModalForm } from "./ui/modal-forms.js";
import { StatusWheel } from "./ui/status-wheel.js";
import { DurationPicker, FreeSlots, ChoiceWithOther } from "./ui/pickers.js";
import { HomeworksScreen } from "./screens/homeworks.js";
import {
  ClientOverviewScreen, ClientCalendarScreen, ClientProgressScreen,
  ClientPaymentsScreen, ClientProfileScreen,
} from "./screens/client.js";
import { RegisterScreen, LoadingScreen, ErrorScreen } from "./screens/service.js";
import * as dict from "./core/dict.js";
import * as fmt from "./core/format.js";

const L = dict.LESSON_STATUS;
const P = dict.PAYMENT_STATUS;
const H = dict.HOMEWORK_STATUS;

const CLIENT_TABS = [
  { value: "overview", label: "Обзор" }, { value: "calendar", label: "Кален." },
  { value: "homeworks", label: "ДЗ" }, { value: "progress", label: "Прогр." },
  { value: "finances", label: "Оплаты" },
];

const LEVELS = [8,7,9,6,5,10,4,3,7,8,6,9,2,5,7,8,10,6,4,3,5,7,8,2,6,9,1];

/* Разница ролей — только в наборе actions и флагах. Данные одни и те же. */
let role = "student";
const isStudent = () => role === "student";

const TASK_NOTES = [
  { number: "№5", percent: "70 %", label: "закрепить", text: "Путает порядок битов при переводе", notch: dict.lessonStatus(L.PENDING) },
  { number: "№16", percent: "40 %", label: "нужно повторить", text: "Рекурсия — разобрать базовый случай", notch: dict.paymentStatus(P.UNPAID) },
  { number: "№24", percent: "90 %", label: "уверенно", text: "Строки, всё стабильно", notch: dict.lessonStatus(L.CONDUCTED) },
];

const PLAN = [
  { id: 1, title: "Закрыть задания 24–27", meta: `до ${fmt.dayMonth("2026-09-01")}`, status: "в процессе", done: false, notch: dict.planStatus(dict.PLAN_STATUS.IN_PROGRESS) },
  { id: 2, title: "Пробник №3", meta: `до ${fmt.dayMonth("2026-08-20")}`, status: "выполнено", done: true, notch: dict.planStatus(dict.PLAN_STATUS.DONE) },
  { id: 3, title: "Повторить системы счисления", meta: "без дедлайна", status: "нужно повторить", done: false, notch: dict.planStatus(dict.PLAN_STATUS.REPEAT) },
];

const HOMEWORKS = [
  { id: 1, title: "Задания 24–27, вариант 12", meta: `до ${fmt.dayMonth("2026-08-08")}`, notch: dict.homeworkStatus(H.WAITING) },
  { id: 2, title: "Рекурсия: разбор базового случая", meta: `просрочено ${fmt.dayMonth("2026-08-03")}`, notch: dict.homeworkStatus(H.OVERDUE) },
  { id: 3, title: "Перевод систем счисления", meta: `сдано ${fmt.dayMonth("2026-08-01")}`, notch: dict.homeworkStatus(H.SUBMITTED) },
  { id: 4, title: "Массивы и циклы", meta: "выполнено", notch: dict.homeworkStatus(H.DONE) },
];

function calendarModel() {
  // Действия строим функциями: DOM-узел существует в одном месте, поэтому
  // общий массив «переезжал» бы из первой строки во вторую.
  const own = () => [
    Button({ kind: "second", label: "Перенести" }),
    Button({ kind: "second", label: "Отметить оплату" }),
  ];
  const parentView = () => [Button({ kind: "second", label: "Отметить оплату" })];
  return {
    period: "3 – 9 августа",
    mode: "week",
    summary: [
      { value: "4", label: "Уроков" }, { value: "2", label: "Проведено" },
      { value: "1", label: "Оплачено" }, { value: "1", label: "Ждут", tone: "debt" },
    ],
    days: [
      { title: "четверг, 6 августа", items: [
        { time: "10:00", duration: "60 мин", name: "Информатика", meta: "ЕГЭ · задание 25",
          lessonStatus: dict.lessonStatus(L.CONDUCTED), paymentStatus: dict.paymentStatus(P.CONFIRMED), actions: [] },
        { time: "15:00", duration: "60 мин", name: "Информатика", meta: "ЕГЭ · динамика",
          lessonStatus: dict.lessonStatus(L.PLANNED), paymentStatus: dict.paymentStatus(P.NOT_MARKED),
          actions: isStudent() ? own() : parentView() },
      ] },
      { title: "суббота, 8 августа", items: [
        { time: "11:00", duration: "90 мин", name: "Информатика", meta: "ЕГЭ · пробник",
          lessonStatus: dict.lessonStatus(L.PENDING), paymentStatus: dict.paymentStatus(P.STUDENT_MARKED),
          actions: isStudent() ? own() : parentView() },
      ] },
    ],
  };
}

/* --- каркас страницы ----------------------------------------------------- */

function phone(label, note, node, activeTab = "overview") {
  return el("article", { class: "kit-demo" }, [
    el("span", { class: "kit-demo__label", text: label }),
    el("div", { class: "phone" }, [
      Header({ subtitle: isStudent() ? "Кабинет ученика" : "Кабинет родителя", actions: [] }),
      el("div", { class: "phone__body" }, [node]),
      TabBar({ items: CLIENT_TABS, value: activeTab, onSelect: () => {} }),
    ]),
    note ? el("p", { class: "kit-demo__note", text: note }) : null,
  ]);
}

function bare(label, note, node) {
  return el("article", { class: "kit-demo" }, [
    el("span", { class: "kit-demo__label", text: label }),
    el("div", { class: "phone" }, [el("div", { class: "phone__body" }, [node])]),
    note ? el("p", { class: "kit-demo__note", text: note }) : null,
  ]);
}

function modalsSection() {
  let current = MODAL_NAMES[0];
  const host = el("div", { class: "modal-catalog" });
  const preview = el("div", { class: "phone" });

  const renderPreview = () => {
    const { body, footer } = buildModalForm(current);
    preview.replaceChildren(el("section", { class: "modal modal--static" }, [
      el("span", { class: "modal__handle", "aria-hidden": "true" }),
      el("div", { class: "modal__head" }, [
        el("h2", { class: "modal__title", text: current }),
        IconButton({ glyph: "✕", label: "Закрыть" }),
      ]),
      el("div", { class: "modal__body" }, body),
      el("div", { class: "modal__footer" }, [footer]),
    ]));
  };

  const renderList = () => {
    host.replaceChildren(...MODAL_NAMES.map((name) =>
      el("button", {
        type: "button",
        class: `modal-catalog__item${name === current ? " is-active" : ""}`,
        text: name,
        onClick: () => { current = name; renderList(); renderPreview(); },
      })));
  };
  renderList();
  renderPreview();

  return el("div", { class: "modal-layout" }, [
    el("div", {}, [
      el("span", { class: "kit-demo__label", text: `${MODAL_NAMES.length} форм в едином контейнере` }),
      host,
    ]),
    el("div", {}, [
      el("span", { class: "kit-demo__label", text: "Предпросмотр" }),
      preview,
      el("p", { class: "kit-demo__note", text: "Единый контейнер: drag-handle, заголовок, ✕, сгруппированные поля, кнопка действия внизу. Живое закрытие свайпом — кнопкой ниже." }),
      Button({ kind: "main", label: "Открыть как настоящую модалку", onClick: () => {
        const { body, footer } = buildModalForm(current);
        Modal({ title: current, body, footer }).open();
      } }),
    ]),
  ]);
}

function controlsSection() {
  return el("div", { class: "kit-grid" }, [
    el("article", { class: "kit-demo" }, [
      el("span", { class: "kit-demo__label", text: "Барабан статусов" }),
      el("div", { class: "kit-demo__stage" }, [
        StatusWheel({ label: "Занятие", options: dict.lessonStatusOptions(), value: L.PLANNED }),
      ]),
    ]),
    el("article", { class: "kit-demo" }, [
      el("span", { class: "kit-demo__label", text: "Выбор длительности" }),
      el("div", { class: "kit-demo__stage" }, [DurationPicker({ value: 60 })]),
    ]),
    el("article", { class: "kit-demo" }, [
      el("span", { class: "kit-demo__label", text: "Свободные окна · чипы по дням" }),
      el("div", { class: "kit-demo__stage" }, [FreeSlots({
        duration: 60,
        days: [
          { title: "четверг, 6 августа", slots: [{ time: "10:00" }, { time: "11:30" }, { time: "16:00" }] },
          { title: "пятница, 7 августа", slots: [{ time: "09:00" }, { time: "18:00" }] },
        ],
      })]),
    ]),
    el("article", { class: "kit-demo" }, [
      el("span", { class: "kit-demo__label", text: "Поле «другое» и часовой пояс" }),
      el("div", { class: "kit-demo__stage kit-col" }, [
        ChoiceWithOther({ label: "Предмет", options: dict.SUBJECTS, value: "Алгоритмика" }),
        ChoiceWithOther({ label: "Вид подготовки", options: dict.PREP_TYPES, value: "ЕГЭ" }),
      ]),
    ]),
  ]);
}

const RENAMES = [
  ["не отмечено", "оплата не отмечена", "в пилюле одно слово читается как «занятие не отмечено»"],
  ["ожидание выполнения", "в работе", "фильтр на экране ДЗ уже подписан так"],
  ["✓ Проведено", "Отметить проведённым", "кнопка называет действие, а не состояние"],
  ["Отправить решение", "Сдать домашку", "одно действие — одно имя во всём продукте"],
];

/* --- сборка -------------------------------------------------------------- */

function boot() {
  const root = document.getElementById("root");
  const cabinets = el("div", { class: "kit-grid kit-grid--phones" });

  const renderCabinets = () => {
    const cal = calendarModel();
    cabinets.replaceChildren(
      phone("Обзор", "Четыре метрики — те же ячейки табло, что у репетитора. Полоса заданий крупная: для ученика это главный экран прогресса.",
        ClientOverviewScreen({
          student: { eyebrow: "ЕГЭ · информатика", name: "Михаил Волосов", goal: "Цель: 85 баллов, ИТМО", next: "завтра · 15:00" },
          metrics: [
            { value: "2", label: "Домашки", notch: dict.homeworkStatus(H.WAITING) },
            { value: fmt.money(1500), label: "Оплаты", notch: dict.paymentStatus(P.UNPAID), tone: "debt" },
            { value: "62 %", label: "Прогресс", notch: dict.lessonStatus(L.CONDUCTED) },
            { value: "24", label: "Занятия", notch: dict.lessonStatus(L.PLANNED) },
          ],
          levels: LEVELS,
        }), "overview"),

      phone(`Календарь · ${isStudent() ? "ученик" : "родитель"}`,
        isStudent()
          ? "Ученик может перенести занятие и отметить оплату."
          : "Родитель без права правки календаря видит только отметку оплаты.",
        ClientCalendarScreen(cal), "calendar"),

      phone("ДЗ · только чтение и отправка", "Тот же экран, что у репетитора, но без кнопки создания: набор действий приходит параметром.",
        HomeworksScreen({ items: HOMEWORKS, total: HOMEWORKS.length, filter: "all", canCreate: false, actions: {} }), "homeworks"),

      phone("Прогресс", isStudent() ? "Ученик правит уровни, заметки и план." : "Родителю то же самое на чтение.",
        ClientProgressScreen({
          current: 62, goal: 80, levels: LEVELS, taskNotes: TASK_NOTES, plan: PLAN,
          canEdit: isStudent(),
        }), "progress"),

      phone("Оплаты", "Долг вынесен отдельной карточкой с двойной засечкой.",
        ClientPaymentsScreen({
          rate: `${fmt.money(1500)} / час`,
          debt: { amount: fmt.money(1500), meta: "1 занятие не оплачено", notch: dict.paymentStatus(P.UNPAID) },
          days: [
            { title: "вторник, 4 августа", total: fmt.money(6000), items: [
              { name: "Аванс · 4 ч", meta: fmt.money(6000), notch: dict.paymentStatus(P.CONFIRMED), pill: StatusPill(dict.paymentStatus(P.CONFIRMED)) },
            ] },
          ],
          unpaid: [{ id: 1, name: `Занятие ${fmt.dayMonth("2026-07-29")}`, meta: `${fmt.money(1500)} · не оплачено`, notch: dict.paymentStatus(P.UNPAID) }],
          actions: { markPaid: () => {} },
        }), "finances"),

      phone("Профиль · просмотр", "Ученик может удалить свой профиль, родитель — нет.",
        ClientProfileScreen({
          canEdit: true, canDelete: isStudent(),
          facts: [
            { label: "Класс", value: "11" }, { label: "Часовой пояс", value: "МСК+0" },
            { label: "Стоимость", value: `${fmt.money(1500)}/час` }, { label: "Подготовка", value: "ЕГЭ · Информатика" },
            { label: "Цель", value: "85 баллов, ИТМО" }, { label: "Оплачено часов", value: fmt.hours(4) },
            { label: "Права родителя", value: "только просмотр и оплата" },
          ],
          links: [
            { label: "Доска", value: "https://unidraw.io/app/board/b50c7b30" },
            { label: "Телемост", value: "" },
            { label: "Telegram", value: "@misha" },
          ],
        }), "overview"),
    );
  };
  renderCabinets();

  const roleSwitch = el("div", { class: "role-switch" }, [
    Segmented({
      items: [{ value: "student", label: "Ученик" }, { value: "parent", label: "Родитель" }],
      value: role, label: "Роль",
      onSelect: (v) => { role = v; renderCabinets(); roleSwitch.querySelector(".role-switch__note").textContent = noteFor(); },
    }),
    el("span", { class: "role-switch__note", text: "" }),
  ]);
  const noteFor = () => isStudent()
    ? "Ученик правит прогресс и может перенести занятие."
    : "Родитель видит то же самое на чтение и может отметить оплату.";
  roleSwitch.querySelector(".role-switch__note").textContent = noteFor();

  root.replaceChildren(
    el("header", { class: "kit-head" }, [
      el("p", { class: "num kit-head__eyebrow", text: "БОТай CRM · v2 · проход 3" }),
      el("h1", { class: "kit-head__title", text: "Кабинеты, регистрация и модальные окна" }),
      el("p", { class: "kit-head__lead", text: "Экраны клиента — те же компоненты, что у репетитора, с другим набором действий. Переключатель роли меняет только actions, разметка одна." }),
      el("nav", { class: "kit-nav" }, [
        el("a", { class: "kit-nav__link", href: "./kit.html", text: "← Витрина компонентов" }),
        el("a", { class: "kit-nav__link", href: "./screens.html", text: "← Экраны репетитора" }),
      ]),
    ]),

    el("section", { class: "kit-section" }, [
      el("div", { class: "kit-section__head" }, [
        el("h2", { class: "kit-section__title", text: "05 · Кабинет ученика и родителя" }),
      ]),
      roleSwitch,
      cabinets,
    ]),

    el("section", { class: "kit-section" }, [
      el("div", { class: "kit-section__head" }, [
        el("h2", { class: "kit-section__title", text: "06 · Регистрация гостя и служебные экраны" }),
      ]),
      el("div", { class: "kit-grid kit-grid--phones" }, [
        (() => {
          let guestRole = "student";
          const host = el("div", {});
          const r = () => host.replaceChildren(RegisterScreen({
            role: guestRole, values: {}, actions: { setRole: (v) => { guestRole = v; r(); } },
          }));
          r();
          return bare("Регистрация · гость", "Две формы за сегментированным контролом: на 380 px две колонки анкет не помещаются. Переключите «Я родитель» — состав полей меняется.", host);
        })(),
        bare("Загрузка", "Спиннер заменён на определённую полосу — она в той же разлиновке и не крутится вечно.", LoadingScreen()),
        bare("Ошибка", "Говорит, что случилось, что делать и что данные целы. Код и время — чтобы переслать в поддержку.",
          ErrorScreen({ code: "код 503 · 06.08, 13:42", actions: { retry: () => {}, openBrowser: () => {} } })),
      ]),
    ]),

    el("section", { class: "kit-section" }, [
      el("div", { class: "kit-section__head" }, [
        el("h2", { class: "kit-section__title", text: "07 · Модальные окна" }),
      ]),
      modalsSection(),
    ]),

    el("section", { class: "kit-section" }, [
      el("div", { class: "kit-section__head" }, [
        el("h2", { class: "kit-section__title", text: "Особые контролы" }),
      ]),
      controlsSection(),
    ]),

    el("section", { class: "kit-section" }, [
      el("div", { class: "kit-section__head" }, [
        el("h2", { class: "kit-section__title", text: "Предлагаю переименовать" }),
        el("p", { class: "kit-section__note", text: "Значения в БД не тронуты — в макетах везде стоят строки из справочника. Это список к обсуждению, а не изменение." }),
      ]),
      el("div", { class: "kit-fmts" }, RENAMES.map(([from, to, why]) =>
        el("div", { class: "rename" }, [
          num(from, "rename__from"),
          el("span", { class: "rename__to", text: to }),
          el("span", { class: "rename__why", text: why }),
        ]))),
    ]),
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
