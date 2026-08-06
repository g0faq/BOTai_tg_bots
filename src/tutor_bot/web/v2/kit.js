/* Витрина компонентов. Только моковые данные, ни одного обращения к API. */

import { el, num } from "./ui/dom.js";
import { Notch } from "./ui/notch.js";
import { StatusPill } from "./ui/status-pill.js";
import { Button, IconButton } from "./ui/button.js";
import { Field, Select, Toggle } from "./ui/field.js";
import { Chip, ChipRow, Segmented } from "./ui/chip.js";
import { Row, LessonRow, OperationRow } from "./ui/rows.js";
import { StudentRow } from "./ui/student-row.js";
import { TaskBand, TaskBandAxis } from "./ui/task-band.js";
import { IncomeChart, ProgressRing } from "./ui/charts.js";
import { EmptyState, Toast } from "./ui/feedback.js";
import { Header, TabBar, Fab } from "./ui/shell.js";
import { Modal } from "./ui/modal.js";
import * as dict from "./core/dict.js";
import * as fmt from "./core/format.js";

/* --- каркас витрины ------------------------------------------------------ */

function section(id, title, note, blocks) {
  return el("section", { class: "kit-section", id }, [
    el("div", { class: "kit-section__head" }, [
      el("h2", { class: "kit-section__title", text: title }),
      note ? el("p", { class: "kit-section__note", text: note }) : null,
    ]),
    el("div", { class: "kit-grid" }, blocks),
  ]);
}

function demo(label, node, note) {
  return el("article", { class: "kit-demo" }, [
    el("span", { class: "kit-demo__label", text: label }),
    el("div", { class: "kit-demo__stage" }, [node]),
    note ? el("p", { class: "kit-demo__note", text: note }) : null,
  ]);
}

/* --- моки ---------------------------------------------------------------- */

const L = dict.LESSON_STATUS;
const P = dict.PAYMENT_STATUS;

const LEVELS_A = [8,7,9,6,5,10,4,3,7,8,6,9,2,5,7,8,10,6,4,3,5,7,8,2,6,9,1];
const LEVELS_B = [5,6,4,7,3,8,2,5,6,7,4,3,8,5,6,2,7,4,5,6,3,8,5,4,6,7,5];
const LEVELS_C = [9,8,10,7,9,8,6,9,10,8,7,9,8,10,6,9,8,7,10,9,8,6,9,10,7,8,9];

const LESSONS = [
  ["09:00", "Михаил Волосов", L.CONDUCTED, P.CONFIRMED, 900],
  ["11:30", "Назар Кириленко", L.PLANNED, P.NOT_MARKED, 1500],
  ["14:00", "Илья Сафонов", L.PENDING, P.STUDENT_MARKED, 1500],
  ["16:00", "Аня Петрова", L.MOVED, P.NOT_MARKED, 1500],
  ["18:00", "Костя Дёмин", L.CANCELLED, P.UNPAID, 1500],
];

/* --- разделы ------------------------------------------------------------- */

function tokensSection() {
  const swatch = (varName, label, use) =>
    el("div", { class: "kit-token" }, [
      el("span", { class: "kit-token__chip", style: { background: `var(${varName})` } }),
      el("span", { class: "num kit-token__name", text: varName }),
      el("span", { class: "kit-token__use", text: use }),
    ]);

  const surfaces = [
    ["--bg", "фон приложения"], ["--surface", "заголовок дня"], ["--surface-2", "тост, барабан"],
    ["--border-hair", "разделитель"], ["--border", "граница блока"], ["--border-strong", "рамка поля"],
    ["--text", "основной"], ["--text-2", "вторичный"], ["--text-3", "подписи"],
  ].map(([v, u]) => swatch(v, v, u));

  const accents = [
    ["--accent", "единственный акцент"], ["--accent-press", "нажатая главная"],
    ["--state-press", "нажатие строки"], ["--state-off-text", "выключенный текст"],
  ].map(([v, u]) => swatch(v, v, u));

  const semantic = [
    ["--sem-done", "проведено · оплачено", dict.NOTCH.SOLID, "done"],
    ["--sem-plan", "запланировано", dict.NOTCH.TOP_HALF, "plan"],
    ["--sem-plan", "перенесено", dict.NOTCH.BOTTOM_HALF, "plan"],
    ["--sem-wait", "ждёт репетитора", dict.NOTCH.DASHED, "wait"],
    ["--sem-debt", "отменено · не оплачено", dict.NOTCH.DOUBLE, "debt"],
  ].map(([v, u, mark, tone]) =>
    el("div", { class: "kit-token" }, [
      el("span", { class: "kit-token__notch" }, [Notch({ tone, mark })]),
      el("span", { class: "num kit-token__name", text: v }),
      el("span", { class: "kit-token__use", text: u }),
    ]));

  const type = [
    ["28 / mono 500", "сумма дня", "var(--fs-sum)", "var(--font-mono)", 500],
    ["22 / 600", "заголовок экрана", "var(--fs-title)", "var(--font-sans)", 600],
    ["17 / 500", "заголовок модалки", "var(--fs-modal)", "var(--font-sans)", 500],
    ["15 / 400", "имя ученика, кнопка", "var(--fs-body)", "var(--font-sans)", 400],
    ["13 / 400", "мета строки", "var(--fs-meta)", "var(--font-sans)", 400],
    ["11 / 600", "капитель, таббар", "var(--fs-caps)", "var(--font-sans)", 600],
  ].map(([name, role, size, family, weight]) =>
    el("div", { class: "kit-type" }, [
      el("span", { class: "num kit-type__spec", text: name }),
      el("span", {
        class: "kit-type__sample",
        style: { fontSize: size, fontFamily: family, fontWeight: String(weight) },
        text: "Расписание 1 500 ₽",
      }),
      el("span", { class: "kit-type__role", text: role }),
    ]));

  return section("tokens", "01 · Токены", "Значения перенесены из макета дословно. Компоненты ссылаются только на переменные.", [
    demo("Поверхности и текст", el("div", { class: "kit-tokens" }, surfaces)),
    demo("Акцент и состояния", el("div", { class: "kit-tokens" }, accents)),
    demo("Четыре семантических цвета", el("div", { class: "kit-tokens" }, semantic),
      "Цвет + форма + позиция засечки: статус читается при дальтонизме и монохромной печати."),
    demo("Типографика", el("div", { class: "kit-types" }, type),
      "Golos Text вариативный 400..700 + IBM Plex Mono 400/500, локально, кириллица и латиница."),
  ]);
}

function buttonsSection() {
  const row = (kind, label, loadingLabel) =>
    el("div", { class: "kit-row-4" }, [
      Button({ kind, label }),
      Button({ kind, label, state: "press" }),
      Button({ kind, label, state: "off" }),
      Button({ kind, label, state: "load", loadingLabel }),
    ]);

  return section("buttons", "02 · Кнопки", "4 типа × 4 состояния: обычное, нажатое, выключенное, загрузка.", [
    demo("Главная", row("main", "Сохранить", "Сохраняю…")),
    demo("Вторичная", row("second", "Провести", "Провожу…")),
    demo("Разрушающая", row("danger", "Удалить ученика", "Удаляю…")),
    demo("Строчная", el("div", { class: "kit-row-4" }, [
      Button({ kind: "inline", label: "Показать окна" }),
      Button({ kind: "inline", label: "Показать окна", state: "press" }),
      Button({ kind: "inline", label: "Показать окна", state: "off" }),
      Button({ kind: "inline", label: "Загружаю…", state: "load", loadingLabel: "Загружаю…" }),
    ])),
    demo("Иконочная", el("div", { class: "kit-row-inline" }, [
      IconButton({ glyph: "₽", label: "Подтвердить оплату" }),
      IconButton({ glyph: "₽", label: "Подтвердить оплату", state: "press" }),
      IconButton({ glyph: "₽", label: "Подтвердить оплату", state: "off" }),
    ]), "Сенсорная цель 44 px."),
  ]);
}

function fieldsSection() {
  return section("fields", "03 · Поля, селект, переключатель", "Все состояния поля, включая ошибку и загрузку.", [
    demo("Поле · пустое", Field({ label: "Поиск", placeholder: "Найти ученика" })),
    demo("Поле · заполнено и в фокусе", Field({ label: "Поиск", value: "Волосов", state: "filled", tail: "✕" })),
    demo("Поле · ошибка", Field({
      label: "Стоимость за час", value: "0", state: "error", mono: true, tail: "▲",
      hint: "Стоимость не может быть нулевой. Укажите сумму за час.",
    })),
    demo("Поле · выключено", Field({ label: "Оплачено часов", value: "считаю автоматически", state: "off" })),
    demo("Поле · загрузка", Field({ label: "Ученик", state: "loading" })),
    demo("Селект", Select({ label: "Направление", value: "ЕГЭ", options: dict.PREP_TYPES })),
    demo("Переключатель", el("div", { class: "kit-col" }, [
      Toggle({ label: "Родитель может редактировать календарь", checked: true }),
      Toggle({ label: "Только просмотр и оплата", checked: false }),
      Toggle({ label: "Выключен", checked: false, disabled: true }),
    ])),
  ]);
}

function filtersSection() {
  const chipItems = [
    { label: "Все", count: 12, value: "all" },
    { label: "Активные", count: 7, value: "active" },
    { label: "Есть долг", count: 2, value: "debt" },
    { label: "Без плана", count: 3, value: "noplan" },
    { label: "Архив", count: 5, value: "archive" },
  ];
  let chipValue = "all";
  const chipHost = el("div", {});
  const renderChips = () => chipHost.replaceChildren(ChipRow({
    items: chipItems, value: chipValue,
    onSelect: (v) => { chipValue = v; renderChips(); },
  }));
  renderChips();

  let segValue = "Неделя";
  const segHost = el("div", {});
  const renderSeg = () => segHost.replaceChildren(Segmented({
    items: ["День", "Неделя", "Месяц"], value: segValue, label: "Режим календаря",
    onSelect: (v) => { segValue = v; renderSeg(); },
  }));
  renderSeg();

  return section("filters", "04 · Чипы, сегментированный контрол, пилюли", "Чипы и сегменты интерактивны — можно кликать.", [
    demo("Чипы фильтра", chipHost, "Чип 32 px + отбивки 6 px = сенсорная цель 44 px."),
    demo("Сегментированный контрол", segHost),
    demo("Пилюли оплаты · все значения", el("div", { class: "kit-row-inline" },
      dict.paymentStatusOptions().map((s) => StatusPill(s))),
      "Глиф дублирует цвет: ● ◐ ◑ ▲ ○"),
    demo("Пилюли занятия · все значения", el("div", { class: "kit-row-inline" },
      dict.lessonStatusOptions().map((s) => StatusPill(s)))),
  ]);
}

function rowsSection() {
  const rowStates = el("div", { class: "kit-list" }, [
    Row({ title: "Информатика · 11 класс", value: fmt.money(1500), state: "normal" }),
    Row({ title: "Информатика · 11 класс", value: fmt.money(1500), state: "press" }),
    Row({ title: "Информатика · 11 класс", value: fmt.money(1500), state: "selected" }),
    Row({ title: "Информатика · 11 класс", value: "—", state: "off" }),
  ]);

  const lessons = el("div", { class: "kit-list" }, LESSONS.map(([time, name, ls, ps, price]) =>
    LessonRow({
      time, name,
      price: fmt.money(price),
      lessonStatus: dict.lessonStatus(ls),
      paymentStatus: dict.paymentStatus(ps),
      // Действия приходят снаружи: строка не знает про роль.
      actions: [IconButton({ glyph: "✓", label: "Провести" }), IconButton({ glyph: "₽", label: "Оплата" })],
    })));

  const dense = el("div", { class: "kit-list" }, LESSONS.slice(0, 3).map(([time, name, ls, ps, price]) =>
    LessonRow({
      time, name, density: "dense",
      price: fmt.money(price),
      lessonStatus: dict.lessonStatus(ls),
      paymentStatus: dict.paymentStatus(ps),
    })));

  const ops = el("div", { class: "kit-list" }, [
    OperationRow({
      name: "Михаил Волосов", meta: `аванс · ${fmt.dayMonth("2026-08-04")} · ${fmt.money(6000)}`,
      notch: dict.paymentStatus(P.CONFIRMED), tail: "подтверждено",
    }),
    OperationRow({
      name: "Назар Кириленко", meta: `занятие · ${fmt.dayMonth("2026-08-05")} · ${fmt.money(1500)}`,
      notch: dict.paymentStatus(P.STUDENT_MARKED),
      tail: Button({ kind: "second", label: "Подтвердить" }),
    }),
    OperationRow({ name: "Загрузка операции", meta: "…", state: "loading" }),
    OperationRow({
      name: "Не удалось подтвердить", meta: "повторите попытку",
      notch: dict.paymentStatus(P.UNPAID), tail: "ошибка", state: "error",
    }),
  ]);

  return section("rows", "05 · Строки", "Строка списка, занятия и операции. Действия передаются параметром, а не собираются внутри.", [
    demo("Строка списка · обычная / нажатая / выбранная / выключенная", rowStates),
    demo("Строка занятия · 5 статусов", lessons),
    demo("Строка занятия · плотная (52 px)", dense),
    demo("Строка операции · обычная / кнопка / загрузка / ошибка", ops),
  ]);
}

function studentsSection() {
  const students = el("div", { class: "kit-list" }, [
    StudentRow({
      name: "Михаил Волосов", meta: "Информатика · ЕГЭ · 11 класс",
      balance: fmt.hoursSigned(4), balanceTone: "done", next: fmt.relativeDay(Date.now() + 86400000),
      notch: dict.paymentStatus(P.CONFIRMED), levels: LEVELS_A,
    }),
    StudentRow({
      name: "Назар Кириленко", meta: "Информатика · ОГЭ · 9 класс",
      balance: fmt.moneySigned(-1500), balanceTone: "debt", next: fmt.relativeDay(Date.now() + 3 * 86400000),
      notch: dict.paymentStatus(P.UNPAID), levels: LEVELS_B,
    }),
    StudentRow({
      name: "Аня Петрова", meta: "Информатика · ЕГЭ · 11 класс",
      balance: fmt.money(0), balanceTone: "none", next: fmt.relativeDay(Date.now()),
      notch: dict.lessonStatus(L.PLANNED), levels: LEVELS_C,
    }),
  ]);

  return section("students", "06 · Карточка ученика и полоса заданий", "Полоса 1–27, три размера. Тон столбца: 0–4 долг, 5–7 ожидание, 8–10 готово.", [
    demo("Карточка в списке · полоса tick", students),
    demo("Полоса заданий · full с осью", el("div", { class: "kit-band" }, [
      TaskBandAxis(), TaskBand({ levels: LEVELS_A, size: "full" }),
    ])),
    demo("Полоса заданий · micro", TaskBand({ levels: LEVELS_B, size: "micro" })),
  ]);
}

function chartsSection() {
  const income = [
    ["Пн", 2400], ["Вт", 3600], ["Ср", 1500], ["Чт", 4200], ["Пт", 3000], ["Сб", 2700], ["Вс", 1500],
  ].map(([label, value]) => ({ label, value }));

  return section("charts", "07 · График, кольцо, пустое состояние, тост", null, [
    demo("График дохода · 7 дней", IncomeChart({ days: income })),
    demo("Круговой индикатор", el("div", { class: "kit-row-inline" }, [
      ProgressRing({ value: 72, caption: "Общий прогресс" }),
      ProgressRing({ value: 0, caption: "Нет данных" }),
      ProgressRing({ value: 100, caption: "Цель взята" }),
    ])),
    demo("Пустое состояние", EmptyState({
      title: "Учеников пока нет",
      description: "Добавь первого ученика, чтобы вести расписание, домашки и оплаты.",
      action: Button({ kind: "main", label: "Добавить ученика" }),
    })),
    demo("Тост · четыре тона", el("div", { class: "kit-col" }, [
      Toast({ text: "Занятие проведено", tone: "done" }),
      Toast({ text: "Оплата ждёт подтверждения", tone: "wait" }),
      Toast({ text: "Не удалось сохранить", tone: "debt", action: Button({ kind: "inline", label: "Повторить" }) }),
      Toast({ text: "Черновик сохранён", tone: "none" }),
    ])),
  ]);
}

function shellSection() {
  let tab = "overview";
  const tabs = [
    { value: "overview", label: "Обзор" }, { value: "students", label: "Ученики" },
    { value: "calendar", label: "Кален." }, { value: "homeworks", label: "ДЗ" },
    { value: "finances", label: "Фин." },
  ];
  const tabHost = el("div", { class: "kit-tabbar-stage" });
  const renderTab = () => tabHost.replaceChildren(TabBar({
    items: tabs, value: tab, onSelect: (v) => { tab = v; renderTab(); },
  }));
  renderTab();

  const fabStage = el("div", { class: "kit-fab-stage" }, [
    Fab({
      actions: [
        { label: "Добавить ученика" }, { label: "Разовая запись" },
        { label: "Стабильное расписание" }, { label: "Нерабочие часы" },
        { label: "Создать домашку" }, { label: "Добавить оплату" },
      ],
    }),
  ]);

  const openModal = (title, withFooter) => {
    const modal = Modal({
      title,
      body: [
        Field({ label: "Дата и время", value: "06.08.2026 10:00", state: "filled", mono: true }),
        Select({ label: "Статус занятия", value: L.PLANNED, options: dict.lessonStatusOptions().map((s) => ({ value: s.value, label: s.label })) }),
        Select({ label: "Статус оплаты", value: P.NOT_MARKED, options: dict.paymentStatusOptions().map((s) => ({ value: s.value, label: s.label })) }),
        el("p", { class: "kit-demo__note", text: "Закрывается тапом по фону, кнопкой ✕, клавишей Esc и свайпом вниз: 110 px либо 48 px при скорости выше 0.55." }),
      ],
      footer: withFooter ? [Button({ kind: "main", label: "Готово", full: true }), Button({ kind: "second", label: "Отмена", full: true })] : null,
    });
    modal.open();
  };

  return section("shell", "08 · Шапка, таббар, FAB, модалка", "Каркас не ветвится по роли: вкладки и действия FAB приходят параметром.", [
    demo("Шапка", Header({
      subtitle: "10 уч. · 6 уроков",
      actions: [IconButton({ glyph: "◍", label: "Профиль" }), IconButton({ glyph: "↻", label: "Обновить" })],
    })),
    demo("Таббар · активная вкладка засечкой сверху", tabHost),
    demo("FAB · раскрывает 6 действий вверх списком", fabStage, "Только у репетитора — но решает это вызывающий экран, не компонент."),
    demo("Модалка", el("div", { class: "kit-col" }, [
      Button({ kind: "main", label: "Открыть модалку", onClick: () => openModal("Редактировать занятие", true) }),
      Button({ kind: "second", label: "Открыть без футера", onClick: () => openModal("Свободные окна", false) }),
    ])),
  ]);
}

function formatSection() {
  const rows = [
    ["money(1500)", fmt.money(1500)],
    ["money(0)", fmt.money(0)],
    ["moneySigned(-1500)", fmt.moneySigned(-1500)],
    ["hours(4)", fmt.hours(4)],
    ["hours(1.5)", fmt.hours(1.5)],
    ["hours(0.25)", fmt.hours(0.25)],
    ["hoursSigned(4)", fmt.hoursSigned(4)],
    ["minutes(90)", fmt.minutes(90)],
    ["timezoneLabel('Europe/Moscow')", fmt.timezoneLabel("Europe/Moscow")],
    ["mskLabel(120)", fmt.mskLabel(120)],
    ["mskLabel(-60)", fmt.mskLabel(-60)],
    ["relativeDay(сегодня)", fmt.relativeDay(Date.now())],
    ["relativeDay(+1 день)", fmt.relativeDay(Date.now() + 86400000)],
    ["relativeDay(+3 дня)", fmt.relativeDay(Date.now() + 3 * 86400000)],
    ["relativeDay(-1 день)", fmt.relativeDay(Date.now() - 86400000)],
    ["dateLong(6 авг)", fmt.dateLong("2026-08-06")],
    ["dayTitle", fmt.dayTitle("2026-08-06")],
    ["initials('Михаил Волосов')", fmt.initials("Михаил Волосов")],
  ].map(([call, result]) =>
    el("div", { class: "kit-fmt" }, [
      el("span", { class: "num kit-fmt__call", text: call }),
      el("span", { class: "num kit-fmt__result", text: result }),
    ]));

  return section("format", "09 · Форматирование", "Форматы продублированы в текстах бота — менять их в одностороннем порядке нельзя.", [
    demo("core/format.js", el("div", { class: "kit-fmts" }, rows)),
  ]);
}

/* --- сборка -------------------------------------------------------------- */

function boot() {
  const root = document.getElementById("root");
  root.replaceChildren(
    el("header", { class: "kit-head" }, [
      el("p", { class: "num kit-head__eyebrow", text: "БОТай CRM · v2 · проход 1" }),
      el("h1", { class: "kit-head__title", text: "Витрина компонентов" }),
      el("p", { class: "kit-head__lead", text: "Разлинованная сетка вместо карточек. Статус — засечка в левом жёлобе: цвет, форма и позиция. Радиусы 2 px, теней нет. Моковые данные, без обращений к API." }),
      el("nav", { class: "kit-nav" }, [
        ["tokens", "Токены"], ["buttons", "Кнопки"], ["fields", "Поля"], ["filters", "Фильтры"],
        ["rows", "Строки"], ["students", "Ученики"], ["charts", "Графики"], ["shell", "Каркас"], ["format", "Форматы"],
      ].map(([id, label]) => el("a", { class: "kit-nav__link", href: `#${id}`, text: label }))
        .concat([el("a", { class: "kit-nav__link", href: "./screens.html", text: "Экраны · проход 2 →" })])),
    ]),
    tokensSection(),
    buttonsSection(),
    fieldsSection(),
    filtersSection(),
    rowsSection(),
    studentsSection(),
    chartsSection(),
    shellSection(),
    formatSection(),
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
