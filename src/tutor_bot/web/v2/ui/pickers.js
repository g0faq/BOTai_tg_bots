/* Особые контролы: длительность, свободные окна, часовой пояс, поле «другое». */
import { el, num } from "./dom.js";

const DURATIONS = [60, 90, 120];

export function DurationPicker({ value = 60, onSelect, allowCustom = true } = {}) {
  const items = DURATIONS.map((d) => el("button", {
    type: "button",
    class: `seg-pick__item${Number(value) === d ? " is-active" : ""}`,
    "aria-pressed": Number(value) === d ? "true" : "false",
    text: `${d} мин`,
    onClick: onSelect ? () => onSelect(d) : null,
  }));
  if (allowCustom) {
    items.push(el("button", {
      type: "button",
      class: `seg-pick__item${DURATIONS.includes(Number(value)) ? "" : " is-active"}`,
      text: "другое",
      onClick: onSelect ? () => onSelect("custom") : null,
    }));
  }
  return el("div", { class: "field" }, [
    el("span", { class: "field__label", text: "Длительность" }),
    el("div", { class: "seg-pick" }, items),
  ]);
}

/** Свободные окна: чипы, сгруппированные по дням. Горизонт задаёт вызывающий. */
export function FreeSlots({ days = [], duration = 60, onPick, note = "" } = {}) {
  if (!days.length) {
    return el("div", { class: "free-slots" }, [
      el("p", { class: "screen__note", text: "Свободных окон нет. На выбранный горизонт подходящих окон не нашлось." }),
    ]);
  }
  return el("div", { class: "free-slots" }, [
    note ? el("p", { class: "screen__note", text: note }) : null,
    ...days.map((day) => el("div", { class: "free-slots__day" }, [
      el("span", { class: "free-slots__title", text: day.title }),
      el("div", { class: "free-slots__grid" }, day.slots.map((slot) =>
        el("button", {
          type: "button",
          class: "slot-chip",
          onClick: onPick ? () => onPick(slot.value) : null,
        }, [
          num(slot.time, "slot-chip__time"),
          el("span", { class: "slot-chip__dur", text: `${duration} мин` }),
        ]))),
    ])),
  ]);
}

/** Выбор с вариантом «другое»: при выборе раскрывается текстовый ввод. */
export function ChoiceWithOther({ label, options = [], value = "", onChange } = {}) {
  const isOther = value && !options.includes(value);
  const select = el("select", {
    class: "field__input field__input--select",
    onChange: onChange ? (e) => onChange(e.target.value === "другое" ? "" : e.target.value) : null,
  }, [
    ...options.map((o) => el("option", { value: o, selected: o === value, text: o })),
    el("option", { value: "другое", selected: isOther, text: "другое" }),
  ]);
  return el("label", { class: "field" }, [
    el("span", { class: "field__label", text: label }),
    el("span", { class: "field__box" }, [select, el("span", { class: "field__tail", "aria-hidden": "true", text: "▾" })]),
    isOther
      ? el("input", {
          class: "field__box field__input",
          value,
          placeholder: "Свой вариант",
          onInput: onChange ? (e) => onChange(e.target.value) : null,
        })
      : null,
  ]);
}
