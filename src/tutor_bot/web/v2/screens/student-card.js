/* Карточка ученика: шесть вкладок из спецификации.
 *
 * Вкладка — это отдельная функция рендера. Активная вкладка монтируется,
 * остальные не строятся вовсе: то же правило, что и у роутера экранов.
 */

import { el, num } from "../ui/dom.js";
import { DetailHeader, CardTabs, SectionCaption, DayHeader } from "../ui/section.js";
import { NextLessonCard, StatCell, StatGrid, FinanceBar, FactRow } from "../ui/stat.js";
import { ProgressRing } from "../ui/charts.js";
import { Button, IconButton } from "../ui/button.js";
import { LessonRow } from "../ui/rows.js";
import { HomeworkRow, PlanRow, NoteRow, LinkRow, TaskChart } from "../ui/list-items.js";
import { EmptyState } from "../ui/feedback.js";
import { levelTone } from "../core/dict.js";

export const CARD_TABS = [
  { value: "profile", label: "Профиль" },
  { value: "lessons", label: "Уроки" },
  { value: "homeworks", label: "Домашки" },
  { value: "payments", label: "Оплаты" },
  { value: "notes", label: "Заметки" },
  { value: "files", label: "Файлы" },
];

const QUICK_ACTIONS = [
  ["addLesson", "Добавить урок"],
  ["addHomework", "Добавить ДЗ"],
  ["addPayment", "Добавить оплату"],
  ["addNote", "Добавить заметку"],
];

function hero(student) {
  return el("div", { class: "student-hero" }, [
    el("span", { class: "student-hero__avatar", "aria-hidden": "true", text: student.initials }),
    el("span", { class: "student-hero__main" }, [
      el("span", { class: "student-hero__facts" },
        student.facts.flatMap((f, i) => (i ? [el("span", { class: "student-hero__dot", text: "·" }), f] : [f]))),
      el("h1", { class: "student-hero__name", text: student.name }),
      student.goal ? el("span", { class: "student-hero__goal", text: student.goal }) : null,
    ]),
  ]);
}

function profileTab(model, actions) {
  const s = model.student;
  const box = el("div", {});
  box.append(
    NextLessonCard({ when: s.nextWhen, meta: s.nextMeta, price: s.nextPrice, notch: s.nextNotch }),
    SectionCaption({ title: "Статистика ученика" }),
    el("div", { class: "screen__pad student-progress" }, [
      ProgressRing({ value: s.progressPercent, caption: "", size: 84 }),
      el("span", { class: "student-progress__copy" }, [
        el("span", { class: "student-progress__title", text: "Общий прогресс подготовки" }),
        el("span", { class: "student-progress__goal", text: `Цель: ${s.progressGoal} %` }),
      ]),
    ]),
    StatGrid({
      columns: 3,
      cells: [
        StatCell({ value: s.conducted, label: "Посещено" }),
        StatCell({ value: s.cancelled, label: "Отменено", tone: "debt" }),
        StatCell({ value: s.mockValue, label: s.mockLabel }),
      ],
    }),
    SectionCaption({ title: "Быстрые действия" }),
    el("div", { class: "quick-grid" }, QUICK_ACTIONS.map(([key, label]) =>
      el("button", { type: "button", class: "quick-grid__item", onClick: actions[key] || null }, [
        el("span", { class: "num quick-grid__plus", "aria-hidden": "true", text: "+" }),
        label,
      ]))),
    SectionCaption({
      title: "Прогресс по заданиям ЕГЭ",
      action: Button({ kind: "inline", label: "Подробнее", onClick: actions.openProgress }),
    }),
    TaskChart({ levels: s.levels, goal: s.levelsGoal, toneOf: levelTone }),
  );

  if (actions.cleanupSchedule) {
    box.append(
      SectionCaption({ title: "Стабильное расписание" }),
      el("div", { class: "screen__pad" }, [
        el("p", { class: "screen__note", text: "Удалит правила повторения и отправит будущие неоплаченные занятия в архив. Проведённые, прошедшие и оплаченные останутся на месте." }),
        Button({ kind: "danger", label: "Очистить стабильное расписание", full: true, onClick: actions.cleanupSchedule }),
      ]),
    );
  }

  if (model.taskNotes.length) {
    box.append(SectionCaption({ title: "Заметки по заданиям", count: model.taskNotes.length }));
    box.append(el("div", { class: "list" }, model.taskNotes.map((n) =>
      el("article", { class: "task-note" }, [
        n.notch ? el("span", { class: `notch notch--${n.notch.tone} notch--${n.notch.mark}` }) : null,
        num(n.number, "task-note__num"),
        num(n.percent, "task-note__pct"),
        el("span", { class: "task-note__main" }, [
          el("span", { class: "task-note__label", text: n.label }),
          el("span", { class: "task-note__text", text: n.text }),
        ]),
      ]))));
  }
  return box;
}

function lessonsTab(model, actions) {
  const box = el("div", {});
  const s = model.student;
  box.append(NextLessonCard({
    when: s.nextWhen,
    notch: s.nextNotch,
    action: Button({ kind: "second", label: "Открыть", onClick: actions.openNextLesson }),
  }));
  box.append(SectionCaption({ title: "Последние занятия", count: model.lessonsCount }));
  if (!model.lessonDays.length) {
    box.append(EmptyState({ title: "Уроков пока нет", description: "Здесь появятся прошедшие и запланированные занятия ученика." }));
    return box;
  }
  for (const day of model.lessonDays) {
    box.append(DayHeader({ title: day.title, total: day.total }));
    box.append(el("div", { class: "list" }, day.items.map((l) => LessonRow({
      time: l.time, name: l.topic, price: l.price,
      lessonStatus: l.lessonStatus, paymentStatus: l.paymentStatus,
      onClick: actions.openLesson ? () => actions.openLesson(l.id) : null,
    }))));
  }
  return box;
}

function homeworksTab(model, actions) {
  const box = el("div", {});
  box.append(SectionCaption({
    title: "Домашки",
    count: model.homeworks.length,
    action: Button({ kind: "second", label: "Создать домашку", onClick: actions.addHomework }),
  }));
  box.append(model.homeworks.length
    ? el("div", { class: "list" }, model.homeworks.map((h) => HomeworkRow({
        title: h.title, meta: h.meta, notch: h.notch,
        action: IconButton({ glyph: "⋯", label: "Действия", onClick: actions.openHomework ? () => actions.openHomework(h.id) : null }),
      })))
    : EmptyState({ title: "Домашек пока нет", description: "Здесь будут все домашние задания ученика." }));
  return box;
}

function paymentsTab(model, actions) {
  const box = el("div", {});
  const f = model.finance;
  box.append(SectionCaption({
    title: "Финансы",
    action: Button({ kind: "second", label: "Добавить оплату", onClick: actions.addPayment }),
  }));
  box.append(el("div", { class: "screen__pad" }, [
    FinanceBar({ paid: f.paidShare, waiting: f.waitingShare, debt: f.debtShare }),
    el("div", { class: "fact-list" }, [
      FactRow({ label: "Ученик оплатил", value: f.paidHours }),
      FactRow({ label: "Долги", value: f.debt, tone: f.debtTone }),
    ]),
  ]));
  box.append(SectionCaption({ title: "История оплат" }));
  for (const day of model.paymentDays) {
    box.append(DayHeader({ title: day.title, total: day.total }));
    box.append(el("div", { class: "list" }, day.items.map((o) =>
      el("article", { class: "op" }, [
        o.notch ? el("span", { class: `notch notch--${o.notch.tone} notch--${o.notch.mark}` }) : null,
        el("span", { class: "op__main" }, [
          el("span", { class: "op__name", text: o.name }),
          num(o.meta, "op__meta"),
        ]),
        o.pill,
      ]))));
  }
  box.append(SectionCaption({ title: "Ожидают оплаты", count: model.unpaid.length }));
  box.append(model.unpaid.length
    ? el("div", { class: "list" }, model.unpaid.map((u) =>
        el("article", { class: "op" }, [
          u.notch ? el("span", { class: `notch notch--${u.notch.tone} notch--${u.notch.mark}` }) : null,
          el("span", { class: "op__main" }, [
            el("span", { class: "op__name", text: u.name }),
            num(u.meta, "op__meta"),
          ]),
          Button({ kind: "second", label: "Добавить оплату", onClick: actions.addPayment }),
        ])))
    : EmptyState({ title: "Нет неоплаченных занятий", description: "Проведённые неоплаченные уроки ученика будут видны здесь." }));
  return box;
}

function notesTab(model, actions) {
  const box = el("div", {});
  box.append(SectionCaption({
    title: "Заметки о ученике",
    action: Button({ kind: "second", label: "Добавить", onClick: actions.addNote }),
  }));
  box.append(model.notes.length
    ? el("div", { class: "list" }, model.notes.map((n) => NoteRow({ title: n.title, text: n.text, date: n.date, notch: n.notch })))
    : EmptyState({ title: "Заметок пока нет.", description: "Запишите, что разобрали и что проверить в следующий раз." }));
  box.append(SectionCaption({
    title: "План",
    action: Button({ kind: "second", label: "Пункт", onClick: actions.addPlanItem }),
  }));
  box.append(model.plan.length
    ? el("div", { class: "list" }, model.plan.map((p) => PlanRow({
        title: p.title, meta: p.meta, status: p.status, done: p.done, notch: p.notch,
        onToggle: actions.togglePlanItem ? () => actions.togglePlanItem(p.id) : null,
      })))
    : EmptyState({ title: "План пуст", description: "Добавьте пункт с дедлайном." }));
  return box;
}

function filesTab(model) {
  const box = el("div", {});
  box.append(SectionCaption({ title: "Ссылки" }));
  box.append(el("div", { class: "list" }, model.links.map((l) => LinkRow({ label: l.label, value: l.value }))));
  box.append(el("p", { class: "screen__note", text: "Отсутствующая ссылка остаётся в списке серой строкой — она показывает, что поле есть и его можно заполнить. Telegram-хендл превращается в ссылку t.me автоматически." }));
  return box;
}

const TAB_RENDERERS = {
  profile: profileTab,
  lessons: lessonsTab,
  homeworks: homeworksTab,
  payments: paymentsTab,
  notes: notesTab,
  files: filesTab,
};

export function StudentCardScreen({ model, tab = "profile", actions = {} } = {}) {
  const render = TAB_RENDERERS[tab] || profileTab;
  return el("section", { class: "screen screen--student-card" }, [
    DetailHeader({
      title: model.student.name,
      onBack: actions.back,
      actions: [
        IconButton({ glyph: "✎", label: "Редактировать", onClick: actions.edit }),
        IconButton({ glyph: "⧉", label: "Ссылка доступа", onClick: actions.invite }),
      ],
    }),
    hero(model.student),
    CardTabs({ items: CARD_TABS, value: tab, onSelect: actions.setTab }),
    render(model, actions),
  ]);
}
