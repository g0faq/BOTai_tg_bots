/* Карточка ученика в списке.
 * Полоса заданий даётся в трёх размерах — размер выбирает вызывающий экран,
 * компонент про плотность списка ничего не знает.
 */
import { el, num } from "./dom.js";
import { Notch } from "./notch.js";
import { TaskBand } from "./task-band.js";
import { initials } from "../core/format.js";

export function StudentRow({
  name, meta = "", balance = "", balanceTone = "none",
  next = "", notch, levels = [], bandSize = "tick", onClick,
} = {}) {
  return el(onClick ? "button" : "div", {
    type: onClick ? "button" : null,
    class: "student",
    onClick,
  }, [
    notch ? Notch(notch) : null,
    el("span", { class: "student__avatar", "aria-hidden": "true", text: initials(name) }),
    el("span", { class: "student__main" }, [
      el("span", { class: "student__name", text: name }),
      meta ? el("span", { class: "student__meta", text: meta }) : null,
      levels.length ? TaskBand({ levels, size: bandSize }) : null,
    ]),
    el("span", { class: "student__tail" }, [
      balance ? num(balance, `student__balance student__balance--${balanceTone}`) : null,
      next ? el("span", { class: "student__next", text: next }) : null,
    ]),
    el("span", { class: "student__chevron", "aria-hidden": "true", text: "›" }),
  ]);
}
