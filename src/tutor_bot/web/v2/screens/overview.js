/* Экран «Обзор» репетитора — табло дня. */
import { el, num } from "../ui/dom.js";
import { SectionCaption } from "../ui/section.js";
import { StatCell, StatGrid, NextLessonCard } from "../ui/stat.js";
import { Button } from "../ui/button.js";
import { LessonRow } from "../ui/rows.js";
import { EmptyState } from "../ui/feedback.js";

const QUICK = [
  ["addLesson", "Добавить урок"], ["addHomework", "Создать домашку"],
  ["addStudent", "Добавить ученика"], ["addPayment", "Добавить оплату"],
];

export function OverviewScreen({ model, actions = {} } = {}) {
  const root = el("section", { class: "screen screen--overview" });
  const done = model.todayCount ? Math.round(model.conducted / model.todayCount * 100) : 0;

  root.append(el("div", { class: "pulse" }, [
    el("span", { class: "pulse__cap", text: "Пульс дня" }),
    el("div", { class: "pulse__row" }, [
      el("span", { class: "pulse__today", text: "Сегодня" }),
      num(String(model.todayCount), "pulse__count"),
    ]),
    el("span", { class: "pulse__meta" }, [
      num(model.expected, "num--money"),
      ` к получению · ${model.conducted} из ${model.todayCount || 0} проведено`,
    ]),
    el("span", { class: "pulse__bar" }, [el("i", { style: { width: `${done}%` } })]),
  ]));

  root.append(model.next
    ? NextLessonCard({
        when: `${model.next.when} · ${model.next.name}`,
        meta: model.next.meta,
        notch: model.next.notch,
        action: Button({ kind: "second", label: "Провести", onClick: actions.markConducted }),
      })
    : el("div", { class: "screen__pad" }, [
        Button({ kind: "main", label: "Добавить урок", full: true, onClick: actions.addLesson }),
      ]));

  root.append(SectionCaption({ title: "Быстрые действия" }));
  root.append(el("div", { class: "quick-grid" }, QUICK.map(([key, label]) =>
    el("button", { type: "button", class: "quick-grid__item", onClick: actions[key] || null }, [
      el("span", { class: "num quick-grid__plus", "aria-hidden": "true", text: "+" }),
      label,
    ]))));

  root.append(StatGrid({
    columns: 2,
    cells: model.stats.map((s) => StatCell({ value: s.value, label: s.label, notch: s.notch, tone: s.tone })),
  }));

  root.append(SectionCaption({
    title: "Расписание на сегодня",
    action: Button({ kind: "inline", label: "Весь день", onClick: actions.openCalendar }),
  }));
  root.append(model.todayLessons.length
    ? el("div", { class: "list" }, model.todayLessons.map((l) => LessonRow({
        time: l.time, name: l.name, price: l.price,
        lessonStatus: l.lessonStatus, paymentStatus: l.paymentStatus,
        onClick: actions.openLesson ? () => actions.openLesson(l.id) : null,
      })))
    : EmptyState({ title: "Сегодня свободно", description: "Новые уроки появятся здесь сразу после записи." }));
  return root;
}
