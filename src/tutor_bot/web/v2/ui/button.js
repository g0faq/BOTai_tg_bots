/* Кнопка: 4 типа × 4 состояния.
 * Тип задаётся снаружи — компонент ничего не знает о роли пользователя.
 */
import { el } from "./dom.js";

const KINDS = new Set(["main", "second", "danger", "inline"]);

export function Button({
  label,
  kind = "main",
  state = "normal",      // normal | press | off | load
  loadingLabel,
  type = "button",
  onClick,
  full = false,
} = {}) {
  const variant = KINDS.has(kind) ? kind : "main";
  const disabled = state === "off" || state === "load";
  return el("button", {
    type,
    class: `btn btn--${variant}${state !== "normal" ? ` is-${state}` : ""}${full ? " btn--full" : ""}`,
    disabled,
    "aria-busy": state === "load" ? "true" : null,
    text: state === "load" && loadingLabel ? loadingLabel : label,
    onClick: disabled ? null : onClick,
  });
}

export function IconButton({ glyph, label, state = "normal", onClick } = {}) {
  const disabled = state === "off";
  return el("button", {
    type: "button",
    class: `icon-btn${state !== "normal" ? ` is-${state}` : ""}`,
    disabled,
    "aria-label": label,
    onClick: disabled ? null : onClick,
  }, [el("span", { "aria-hidden": "true", text: glyph })]);
}
