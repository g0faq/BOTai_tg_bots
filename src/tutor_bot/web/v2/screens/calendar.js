/* Экран «Календарь» репетитора. */
import { el, num } from "../ui/dom.js";
import { ScreenHead, SectionCaption, DayHeader } from "../ui/section.js";
import { StatCell, StatGrid } from "../ui/stat.js";
import { Segmented } from "../ui/chip.js";
import { Button, IconButton } from "../ui/button.js";
import { LessonRow } from "../ui/rows.js";
import { EmptyState } from "../ui/feedback.js";

export function CalendarScreen({ model, mode = "week", archive = false, actions = {} } = {}) {
  const root = el("section", { class: "screen screen--calendar" });
  root.append(
    ScreenHead({ title: "Календарь", count: model.period }),
    el("div", { class: "screen__seg" }, [
      Segmented({
        items: [{ value: "day", label: "День" }, { value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }],
        value: mode, label: "Режим календаря", onSelect: actions.setMode,
      }),
    ]),
    el("div", { class: "screen__pad calendar-rail" }, [
      Button({ kind: "second", label: "Запись", onClick: actions.addLesson }),
      Button({ kind: "second", label: "Окна", onClick: actions.freeSlots }),
      Button({ kind: "second", label: "Стабильное", onClick: actions.addRule }),
      Button({ kind: "second", label: "Нерабочие", onClick: actions.addClosedSlot }),
      Button({ kind: archive ? "main" : "second", label: archive ? "Ближайшие" : "Архив", onClick: actions.toggleArchive }),
    ]),
    StatGrid({ columns: 4, cells: model.summary.map((s) => StatCell({ value: s.value, label: s.label, tone: s.tone })) }),
  );

  if (!model.days.length) {
    root.append(EmptyState({
      title: archive ? "Архив пуст" : "Календарь пуст",
      description: archive ? "Прошедшие и отменённые занятия появятся здесь." : "Создай занятие кнопкой «Запись» или из карточки ученика.",
    }));
    return root;
  }

  for (const day of model.days) {
    root.append(DayHeader({ title: day.title, total: day.total }));
    root.append(el("div", { class: "list" }, day.items.map((l) => LessonRow({
      time: l.time, name: l.name, price: l.price,
      lessonStatus: l.lessonStatus, paymentStatus: l.paymentStatus,
      actions: [
        IconButton({ glyph: "✓", label: "Отметить проведённым", onClick: actions.markConducted ? () => actions.markConducted(l.id) : null }),
        IconButton({ glyph: "₽", label: "Подтвердить оплату", onClick: actions.confirmPayment ? () => actions.confirmPayment(l.id) : null }),
      ],
      onClick: actions.openLesson ? () => actions.openLesson(l.id) : null,
    }))));
  }

  if (model.closedSlots.length) {
    root.append(SectionCaption({ title: "Нерабочие часы", count: model.closedSlots.length }));
    root.append(el("div", { class: "list" }, model.closedSlots.map((s) =>
      el("article", { class: "op" }, [
        el("span", { class: "op__main" }, [
          el("span", { class: "op__name", text: s.reason || "Нерабочее время" }),
          num(`${s.starts_at || ""}`.slice(11, 16) + "–" + `${s.ends_at || ""}`.slice(11, 16), "op__meta"),
        ]),
        IconButton({ glyph: "✕", label: "Удалить", onClick: actions.deleteClosedSlot ? () => actions.deleteClosedSlot(s.id) : null }),
      ]))));
  }
  return root;
}
