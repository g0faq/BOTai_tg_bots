/* Чип фильтра и сегментированный контрол.
 * Чип 32 px получает вертикальные отбивки по 6 px — сенсорная цель 44 px.
 */
import { el, num } from "./dom.js";

export function Chip({ label, count = null, active = false, onClick } = {}) {
  return el("button", {
    type: "button",
    class: `chip${active ? " is-active" : ""}`,
    "aria-pressed": active ? "true" : "false",
    onClick,
  }, [
    el("span", { text: label }),
    count == null ? null : num(count, "chip__num"),
  ]);
}

export function ChipRow({ items = [], value, onSelect } = {}) {
  return el("div", { class: "chip-row", role: "group" },
    items.map((item) => Chip({
      label: item.label ?? item,
      count: item.count ?? null,
      active: (item.value ?? item.label ?? item) === value,
      onClick: onSelect ? () => onSelect(item.value ?? item.label ?? item) : null,
    })));
}

export function Segmented({ items = [], value, onSelect, label = "" } = {}) {
  return el("div", { class: "segmented", role: "tablist", "aria-label": label || null },
    items.map((item) => {
      const val = item.value ?? item;
      const active = val === value;
      return el("button", {
        type: "button",
        role: "tab",
        class: `segmented__item${active ? " is-active" : ""}`,
        "aria-selected": active ? "true" : "false",
        text: item.label ?? item,
        onClick: onSelect ? () => onSelect(val) : null,
      });
    }));
}
