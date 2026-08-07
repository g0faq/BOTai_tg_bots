/* Кабинет ученика и родителя.
 *
 * Те же компоненты, что у репетитора, с другим набором действий. Разница
 * между ролями живёт ТОЛЬКО в переданных actions и флагах доступа —
 * ветвлений `if (role === ...)` внутри разметки нет.
 */

import { el, num } from "../ui/dom.js";
import { ScreenHead, SectionCaption, DayHeader } from "../ui/section.js";
import { StatCell, StatGrid } from "../ui/stat.js";
import { Button } from "../ui/button.js";
import { Segmented } from "../ui/chip.js";
import { StatusPill } from "../ui/status-pill.js";
import { Notch } from "../ui/notch.js";
import { TaskChart, PlanRow, LinkRow } from "../ui/list-items.js";
import { EmptyState } from "../ui/feedback.js";
import { levelTone } from "../core/dict.js";

/* --- Обзор ---------------------------------------------------------------- */

export function ClientOverviewScreen({ student, metrics = [], levels = [], levelsGoal = 27 } = {}) {
  return el("section", { class: "screen screen--client-overview" }, [
    el("div", { class: "client-hero" }, [
      el("span", { class: "client-hero__eyebrow", text: student.eyebrow }),
      el("div", { class: "client-hero__row" }, [
        el("span", { class: "client-hero__main" }, [
          el("h1", { class: "client-hero__name", text: student.name }),
          student.goal ? el("span", { class: "client-hero__goal", text: student.goal }) : null,
        ]),
        el("span", { class: "client-hero__next" }, [
          el("span", { class: "client-hero__cap", text: "ближайшее" }),
          num(student.next, "client-hero__when"),
        ]),
      ]),
    ]),
    StatGrid({
      columns: 2,
      cells: metrics.map((m) => StatCell({ value: m.value, label: m.label, notch: m.notch, tone: m.tone })),
    }),
    SectionCaption({ title: "Статистика подготовки", action: num("0–10") }),
    TaskChart({ levels, goal: levelsGoal, toneOf: levelTone }),
  ]);
}

/* --- Календарь ------------------------------------------------------------ */

export function ClientCalendarScreen({
  period = "", mode = "week", summary = [], days = [], actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--client-calendar" });
  root.append(
    ScreenHead({
      title: "Календарь",
      count: period,
      // Запись живёт и здесь, не только под кнопкой «+»: календарь —
      // то место, где становится видно, что записаться нужно.
      primary: actions.book
        ? Button({ kind: "second", label: "Записаться", onClick: actions.book })
        : null,
    }),
    el("div", { class: "screen__seg" }, [
      Segmented({
        items: [{ value: "day", label: "День" }, { value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }],
        value: mode, label: "Режим календаря", onSelect: actions.setMode,
      }),
    ]),
    StatGrid({ columns: 4, cells: summary.map((s) => StatCell({ value: s.value, label: s.label, tone: s.tone })) }),
  );

  if (!days.length) {
    root.append(EmptyState({
      title: "Занятий нет",
      description: "Выберите свободное окно — заявка уйдёт преподавателю на подтверждение.",
      action: actions.book
        ? Button({ kind: "second", label: "Записаться на занятие", onClick: actions.book })
        : null,
    }));
    return root;
  }

  for (const day of days) {
    root.append(DayHeader({ title: day.title }));
    root.append(el("div", { class: "list" }, day.items.map((l) =>
      el("article", { class: "client-lesson" }, [
        l.lessonStatus ? Notch(l.lessonStatus) : null,
        el("span", { class: "client-lesson__time" }, [
          num(l.time, "client-lesson__hh"),
          num(l.duration, "client-lesson__dur"),
        ]),
        el("span", { class: "client-lesson__main" }, [
          el("span", { class: "client-lesson__name", text: l.name }),
          l.meta ? el("span", { class: "client-lesson__meta", text: l.meta }) : null,
        ]),
        l.paymentStatus ? StatusPill(l.paymentStatus) : null,
        // Набор действий приходит снаружи: у ученика он один, у родителя другой.
        l.actions?.length ? el("span", { class: "client-lesson__actions" }, l.actions) : null,
      ]))));
  }
  return root;
}

/* --- Прогресс ------------------------------------------------------------- */

export function ClientProgressScreen({
  current = 0, goal = 0, levels = [], levelsGoal = 27,
  taskNotes = [], plan = [], canEdit = false, actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--client-progress" });
  root.append(ScreenHead({ title: "Прогресс", count: `${current} / ${goal} %` }));

  root.append(el("div", { class: "screen__pad" }, [
    canEdit
      ? el("div", { class: "action-triplet" }, [
          Button({ kind: "second", label: "Изменить", onClick: actions.editProgress }),
          Button({ kind: "second", label: "Заметка", onClick: actions.addNote }),
          Button({ kind: "second", label: "План", onClick: actions.addPlanItem }),
        ])
      : el("p", { class: "readonly-note", text: "Родитель видит прогресс, заметки и план на чтение. Менять уровни может ученик или преподаватель." }),
  ]));

  root.append(TaskChart({ levels, goal: levelsGoal, toneOf: levelTone }));

  root.append(SectionCaption({ title: "Заметки по заданиям", count: taskNotes.length }));
  root.append(el("div", { class: "list" }, taskNotes.map((n) =>
    el("article", { class: "task-note" }, [
      n.notch ? Notch(n.notch) : null,
      num(n.number, "task-note__num"),
      num(n.percent, "task-note__pct"),
      el("span", { class: "task-note__main" }, [
        el("span", { class: "task-note__label", text: n.label }),
        el("span", { class: "task-note__text", text: n.text }),
      ]),
    ]))));

  root.append(SectionCaption({ title: "План" }));
  root.append(plan.length
    ? el("div", { class: "list" }, plan.map((p) => PlanRow({
        title: p.title, meta: p.meta, status: p.status, done: p.done, notch: p.notch,
        onToggle: canEdit && actions.togglePlanItem ? () => actions.togglePlanItem(p.id) : null,
      })))
    : EmptyState({ title: "План пуст", description: "Преподаватель добавит пункты подготовки." }));
  return root;
}

/* --- Оплаты --------------------------------------------------------------- */

export function ClientPaymentsScreen({ rate = "", debt = null, days = [], unpaid = [], actions = {} } = {}) {
  const root = el("section", { class: "screen screen--client-payments" });
  root.append(ScreenHead({ title: "Оплаты", count: rate }));

  if (debt) {
    root.append(el("div", { class: "debt-card" }, [
      Notch(debt.notch),
      el("span", { class: "debt-card__cap", text: "Долг" }),
      num(debt.amount, "debt-card__value"),
      el("span", { class: "debt-card__meta", text: debt.meta }),
    ]));
  }

  root.append(SectionCaption({ title: "Список оплат" }));
  for (const day of days) {
    root.append(DayHeader({ title: day.title, total: day.total }));
    root.append(el("div", { class: "list" }, day.items.map((o) =>
      el("article", { class: "op" }, [
        o.notch ? Notch(o.notch) : null,
        el("span", { class: "op__main" }, [
          el("span", { class: "op__name", text: o.name }),
          num(o.meta, "op__meta"),
        ]),
        o.pill,
      ]))));
  }

  root.append(SectionCaption({ title: "Ожидают оплаты", count: unpaid.length }));
  root.append(unpaid.length
    ? el("div", { class: "list" }, unpaid.map((u) =>
        el("article", { class: "op" }, [
          u.notch ? Notch(u.notch) : null,
          el("span", { class: "op__main" }, [
            el("span", { class: "op__name", text: u.name }),
            num(u.meta, "op__meta"),
          ]),
          actions.markPaid ? Button({ kind: "second", label: "Отметить оплату", onClick: () => actions.markPaid(u.id) }) : null,
        ])))
    : EmptyState({ title: "Всё оплачено", description: "Неоплаченные занятия появятся здесь после того, как преподаватель отметит их проведёнными." }));
  return root;
}

/* --- Профиль · просмотр --------------------------------------------------- */

export function ClientProfileScreen({ facts = [], links = [], canEdit = false, canDelete = false, actions = {} } = {}) {
  return el("section", { class: "screen screen--client-profile" }, [
    ScreenHead({
      title: "Профиль",
      primary: canEdit ? Button({ kind: "second", label: "Редактировать", full: true, onClick: actions.edit }) : null,
    }),
    el("div", { class: "list" }, facts.map((f) =>
      el("div", { class: "info-row" }, [
        el("span", { class: "info-row__label", text: f.label }),
        el("span", { class: "info-row__value", text: f.value }),
      ]))),
    SectionCaption({ title: "Ссылки" }),
    el("div", { class: "list" }, links.map((l) => LinkRow({ label: l.label, value: l.value }))),
    canDelete
      ? el("div", { class: "screen__pad" }, [Button({ kind: "danger", label: "Удалить профиль", full: true, onClick: actions.remove })])
      : null,
  ]);
}
