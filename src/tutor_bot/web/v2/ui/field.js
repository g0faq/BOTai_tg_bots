/* Поле ввода, селект, переключатель.
 * Состояния поля: пустое, заполнено, фокус, ошибка, выключено, загрузка.
 */
import { el } from "./dom.js";

export function Field({
  label,
  value = "",
  placeholder = "",
  state = "empty",     // empty | filled | error | off | loading
  hint = "",
  tail = "",
  mono = false,
  onInput,
} = {}) {
  const input = el("input", {
    class: `field__input${mono ? " num" : ""}`,
    value,
    placeholder,
    disabled: state === "off" || state === "loading",
    "aria-invalid": state === "error" ? "true" : null,
    onInput: onInput ? (e) => onInput(e.target.value) : null,
  });
  return el("label", { class: `field field--${state}` }, [
    label ? el("span", { class: "field__label", text: label }) : null,
    el("span", { class: "field__box" }, [
      input,
      tail ? el("span", { class: "field__tail", "aria-hidden": "true", text: tail }) : null,
    ]),
    hint ? el("span", { class: "field__hint", text: hint }) : null,
  ]);
}

export function Select({ label, value, options = [], state = "empty", onChange } = {}) {
  const select = el("select", {
    class: "field__input field__input--select",
    disabled: state === "off",
    onChange: onChange ? (e) => onChange(e.target.value) : null,
  }, options.map((opt) => {
    const val = typeof opt === "string" ? opt : opt.value;
    const text = typeof opt === "string" ? opt : (opt.label ?? opt.value);
    return el("option", { value: val, selected: val === value, text });
  }));
  return el("label", { class: `field field--${state}` }, [
    label ? el("span", { class: "field__label", text: label }) : null,
    el("span", { class: "field__box" }, [
      select,
      el("span", { class: "field__tail", "aria-hidden": "true", text: "▾" }),
    ]),
  ]);
}

export function Toggle({ label, checked = false, disabled = false, onChange } = {}) {
  const input = el("input", {
    type: "checkbox",
    class: "toggle__input",
    checked,
    disabled,
    onChange: onChange ? (e) => onChange(e.target.checked) : null,
  });
  return el("label", { class: `toggle${disabled ? " is-off" : ""}` }, [
    input,
    el("span", { class: "toggle__track", "aria-hidden": "true" }, [
      el("span", { class: "toggle__thumb" }),
    ]),
    label ? el("span", { class: "toggle__label", text: label }) : null,
  ]);
}
