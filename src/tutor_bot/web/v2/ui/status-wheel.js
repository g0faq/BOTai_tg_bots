/* Барабан статусов: вертикальная прокрутка с центрированием выбранного.
 * Значение всегда строка из базы — подпись берётся из словаря.
 */
import { el } from "./dom.js";

export function StatusWheel({ label, options = [], value, onSelect } = {}) {
  const list = el("div", { class: "wheel__list", role: "listbox", "aria-label": label });
  for (const opt of options) {
    const active = opt.value === value;
    list.append(el("button", {
      type: "button",
      role: "option",
      class: `wheel__item${active ? " is-active" : ""}`,
      "aria-selected": active ? "true" : "false",
      text: opt.short || opt.label,
      onClick: onSelect ? () => onSelect(opt.value) : null,
    }));
  }
  return el("div", { class: "field wheel" }, [
    label ? el("span", { class: "field__label", text: label }) : null,
    el("div", { class: "wheel__box" }, [list]),
  ]);
}
