/* Заголовки и разделители экранов. */
import { el, num } from "./dom.js";

/** Капитель секции со счётчиком и необязательным действием справа. */
export function SectionCaption({ title, count = null, action = null } = {}) {
  return el("div", { class: "caption" }, [
    el("span", { class: "caption__text" }, [
      title,
      count == null ? null : num(count, "caption__count"),
    ]),
    action,
  ]);
}

/** Заголовок дня: название слева, сумма за день справа. */
export function DayHeader({ title, total = "" } = {}) {
  return el("div", { class: "day-head" }, [
    el("span", { class: "day-head__title", text: title }),
    total ? num(total, "day-head__total num--money") : null,
  ]);
}

/** Шапка экрана: крупный заголовок, счётчик, главное действие. */
export function ScreenHead({ title, count = "", primary = null, extra = null } = {}) {
  return el("div", { class: "screen-head" }, [
    el("div", { class: "screen-head__row" }, [
      el("h1", { class: "screen-head__title", text: title }),
      count ? num(count, "screen-head__count") : null,
    ]),
    primary || extra ? el("div", { class: "screen-head__actions" }, [primary, extra]) : null,
  ]);
}

/** Компактная шапка детального экрана: назад, имя, действия. */
export function DetailHeader({ title, onBack, actions = [] } = {}) {
  return el("header", { class: "detail-head" }, [
    el("button", { type: "button", class: "icon-btn", "aria-label": "Назад", onClick: onBack }, [
      el("span", { "aria-hidden": "true", text: "‹" }),
    ]),
    el("span", { class: "detail-head__title", text: title }),
    el("span", { class: "detail-head__actions" }, actions),
  ]);
}

/** Вкладки внутри карточки ученика. */
export function CardTabs({ items = [], value, onSelect } = {}) {
  return el("nav", { class: "card-tabs", role: "tablist" },
    items.map((item) => {
      const val = item.value ?? item;
      const active = val === value;
      return el("button", {
        type: "button",
        role: "tab",
        class: `card-tabs__item${active ? " is-active" : ""}`,
        "aria-selected": active ? "true" : "false",
        text: item.label ?? item,
        onClick: onSelect ? () => onSelect(val) : null,
      });
    }));
}

/**
 * Сворачиваемый раздел: заголовок работает переключателем.
 *
 * Нужен там, где содержимое длинное и по умолчанию мешает — например
 * история операций за всё время.
 */
export function Collapsible({ title, count = null, open = false, onToggle, content = null } = {}) {
  const box = el("section", { class: `collapsible${open ? " is-open" : ""}` });
  box.append(
    el("button", {
      type: "button",
      class: "collapsible__head",
      "aria-expanded": open ? "true" : "false",
      onClick: onToggle,
    }, [
      el("span", { class: "collapsible__title" }, [
        title,
        count == null ? null : num(count, "collapsible__count"),
      ]),
      el("span", { class: "collapsible__chev", "aria-hidden": "true", text: open ? "▴" : "▾" }),
    ]),
  );
  if (open && content) box.append(content);
  return box;
}
