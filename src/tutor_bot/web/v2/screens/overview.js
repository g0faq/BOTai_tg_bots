/* Экран «Обзор» — табло дня.
 *
 * Три блока и ничего лишнего: пульс дня, лента дня с меткой текущего
 * времени и то, что требует ответа. Быстрых действий здесь нет намеренно —
 * тот же набор уже лежит под кнопкой «+», и дублировать его значит
 * занимать первый экран тем, что и так под рукой.
 */

import { el, num, append } from "../ui/dom.js";
import { SectionCaption } from "../ui/section.js";
import { StatCell, StatGrid } from "../ui/stat.js";
import { Notch } from "../ui/notch.js";
import { StatusPill } from "../ui/status-pill.js";
import { Button } from "../ui/button.js";
import { EmptyState } from "../ui/feedback.js";

/** Пульс дня: единственное крупное число продукта — сумма за день. */
function pulse(model) {
  return el("section", { class: "pulse" }, [
    el("div", { class: "pulse__head" }, [
      el("span", { class: "pulse__cap", text: "Пульс дня" }),
      num(model.dateLabel, "pulse__date"),
    ]),
    el("div", { class: "pulse__row" }, [
      num(model.money, "pulse__sum num--money"),
      num(`${model.conducted} / ${model.total} проведено`, "pulse__done"),
    ]),
    el("div", { class: "pulse__meter" }, [
      el("span", { class: "pulse__track" }, [
        el("i", { class: "pulse__fill", style: { width: `${model.progress}%` } }),
      ]),
      num(model.moneyCaption, "pulse__caption"),
    ]),
    model.cancelledToday
      ? num(`${model.cancelledToday} отменено сегодня`, "pulse__cancelled")
      : null,
  ]);
}

/** Метка текущего времени: время, пульсирующая точка и линия. */
function nowMarker(label) {
  return el("div", { class: "now-line", "aria-label": `Сейчас ${label}` }, [
    num(label, "now-line__time"),
    el("span", { class: "now-line__dot", "aria-hidden": "true" }),
    el("span", { class: "now-line__rule", "aria-hidden": "true" }),
  ]);
}

function ribbonRow(item, actions) {
  return el("article", { class: `ribbon-row${item.isPast ? " is-past" : ""}` }, [
    Notch(item.lessonStatus),
    el("span", { class: "ribbon-row__time" }, [
      num(item.time, "ribbon-row__hh"),
      num(item.duration, "ribbon-row__dur"),
    ]),
    el("button", {
      type: "button",
      class: "ribbon-row__main",
      onClick: actions.openLesson ? () => actions.openLesson(item.id) : null,
    }, [
      el("span", { class: "ribbon-row__name", text: item.name }),
      item.meta ? el("span", { class: "ribbon-row__meta", text: item.meta }) : null,
    ]),
    el("span", { class: "ribbon-row__tail" }, [
      num(item.price, "ribbon-row__price num--money"),
      StatusPill(item.paymentStatus),
    ]),
  ]);
}

export function OverviewScreen({ model, actions = {} } = {}) {
  const root = el("section", { class: "screen screen--overview" });

  append(root, [
    pulse(model),
    SectionCaption({
      title: "Лента дня",
      action: Button({ kind: "inline", label: "Весь день", onClick: actions.openCalendar }),
    }),
  ]);

  if (!model.ribbon.length) {
    root.append(EmptyState({
      title: "Сегодня свободно",
      description: "Новые уроки появятся здесь сразу после записи.",
      action: Button({ kind: "second", label: "Добавить урок", onClick: actions.addLesson }),
    }));
  } else {
    const list = el("div", { class: "list ribbon" });
    for (const item of model.ribbon) {
      if (item.showNow) list.append(nowMarker(model.nowLabel));
      list.append(ribbonRow(item, actions));
    }
    // День закончился — метка встаёт в конце, чтобы было видно, что впереди пусто.
    if (!model.ribbon.some((i) => i.showNow)) list.append(nowMarker(model.nowLabel));
    root.append(list);
  }

  if (model.attention.length) {
    root.append(SectionCaption({ title: "Требует ответа" }));
    root.append(el("div", { class: "list" }, model.attention.map((item) =>
      el("button", {
        type: "button",
        class: "attention",
        onClick: actions.goTo ? () => actions.goTo(item.target) : null,
      }, [
        Notch(item.notch),
        el("span", { class: "attention__label", text: item.label }),
        num(String(item.count), "attention__count"),
        el("span", { class: "attention__chev", "aria-hidden": "true", text: "›" }),
      ]))));
  }

  root.append(SectionCaption({ title: "Табло" }));
  root.append(StatGrid({
    columns: 2,
    cells: model.stats.map((s) => StatCell({ value: s.value, label: s.label, tone: s.tone })),
  }));

  return root;
}
