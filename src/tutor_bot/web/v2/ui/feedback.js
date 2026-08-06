/* Пустое состояние и тост. */
import { el } from "./dom.js";

export function EmptyState({ title, description = "", action = null } = {}) {
  return el("div", { class: "empty" }, [
    el("span", { class: "empty__mark", "aria-hidden": "true" }),
    el("h3", { class: "empty__title", text: title }),
    description ? el("p", { class: "empty__text", text: description }) : null,
    action,
  ]);
}

export function Toast({ text, tone = "none", action = null } = {}) {
  return el("div", {
    class: `toast toast--${tone}`,
    role: "status",
    "aria-live": "polite",
  }, [
    el("span", { class: "toast__text", text }),
    action,
  ]);
}
