/* Статусная отметка: глиф + подпись.
 * Глиф дублирует цвет формой (● ◐ ◑ ▲ ○) — требование доступности.
 */
import { el } from "./dom.js";

export function StatusPill({ label, tone = "none", glyph = "", short } = {}) {
  return el("span", { class: `pill pill--${tone}`, title: label, "aria-label": label }, [
    glyph ? el("span", { class: "pill__glyph", "aria-hidden": "true", text: glyph }) : null,
    el("span", { class: "pill__label", text: short || label }),
  ]);
}
