/* Экран «Профиль репетитора».
 *
 * Списки предметов и подготовок — те же справочники, что видят новые ученики
 * в анкете. Редкие варианты добавляются строками в текстовые поля.
 */

import { el } from "../ui/dom.js";
import { DetailHeader, SectionCaption } from "../ui/section.js";
import { Button } from "../ui/button.js";
import { Field } from "../ui/field.js";
import { SUBJECTS, PREP_TYPES } from "../core/dict.js";

const WEEKDAYS = [
  [1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [7, "Вс"],
];

function CheckChip({ label, on = false, onToggle } = {}) {
  return el("button", {
    type: "button",
    class: `check-chip${on ? " is-on" : ""}`,
    "aria-pressed": on ? "true" : "false",
    onClick: onToggle,
  }, [
    el("span", { class: "check-chip__box", "aria-hidden": "true", text: on ? "✓" : "" }),
    label,
  ]);
}

function TextArea({ label, value = "", placeholder = "", onInput } = {}) {
  return el("label", { class: "field" }, [
    el("span", { class: "field__label", text: label }),
    el("textarea", {
      class: "field__area",
      value,
      placeholder,
      onInput: onInput ? (e) => onInput(e.target.value) : null,
    }),
  ]);
}

export function TutorProfileScreen({
  profile = {},
  subjects = [],
  prepTypes = [],
  workingDays = [1, 2, 3, 4, 5, 6, 7],
  actions = {},
} = {}) {
  const customSubjects = subjects.filter((s) => !SUBJECTS.includes(s));
  const customPrep = prepTypes.filter((p) => !PREP_TYPES.includes(p));

  return el("section", { class: "screen screen--profile" }, [
    DetailHeader({
      title: "Профиль",
      onBack: actions.back,
      actions: [Button({ kind: "second", label: "Ссылка кабинета", onClick: actions.invite })],
    }),
    el("div", { class: "screen__pad form-stack" }, [
      Field({ label: "ФИО", value: profile.full_name || "", state: profile.full_name ? "filled" : "empty", onInput: actions.setName }),
      Field({ label: "Стаж", value: profile.experience || "", mono: true, state: profile.experience ? "filled" : "empty", onInput: actions.setExperience }),
      TextArea({ label: "Описание", value: profile.description || "", onInput: actions.setDescription }),
    ]),

    SectionCaption({ title: "Предметы" }),
    el("div", { class: "screen__pad" }, [
      el("div", { class: "chip-row" }, SUBJECTS.map((s) => CheckChip({
        label: s,
        on: subjects.includes(s),
        onToggle: actions.toggleSubject ? () => actions.toggleSubject(s) : null,
      }))),
      TextArea({
        label: "Другие предметы · каждый с новой строки",
        value: customSubjects.join("\n"),
        onInput: actions.setCustomSubjects,
      }),
    ]),

    SectionCaption({ title: "Подготовки" }),
    el("div", { class: "screen__pad" }, [
      el("div", { class: "chip-row" }, PREP_TYPES.map((p) => CheckChip({
        label: p,
        on: prepTypes.includes(p),
        onToggle: actions.togglePrepType ? () => actions.togglePrepType(p) : null,
      }))),
      TextArea({
        label: "Другие подготовки · каждая с новой строки",
        value: customPrep.join("\n"),
        onInput: actions.setCustomPrepTypes,
      }),
    ]),

    SectionCaption({ title: "Рабочие дни" }),
    el("div", { class: "screen__pad" }, [
      el("div", { class: "weekdays" }, WEEKDAYS.map(([value, label]) =>
        el("button", {
          type: "button",
          class: `weekday${workingDays.includes(value) ? " is-on" : ""}`,
          "aria-pressed": workingDays.includes(value) ? "true" : "false",
          text: label,
          onClick: actions.toggleWorkingDay ? () => actions.toggleWorkingDay(value) : null,
        }))),
      el("p", { class: "screen__note", text: "Эти варианты увидят новые ученики в анкете. Редкие варианты можно добавить строками выше." }),
      Button({ kind: "main", label: "Сохранить профиль", full: true, onClick: actions.save }),
    ]),
  ]);
}
