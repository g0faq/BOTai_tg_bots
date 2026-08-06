/* Шапка, таббар, FAB — каркас экрана.
 *
 * Ни один из них не ветвится по роли: список вкладок и список действий FAB
 * приходят параметром. FAB просто не создаётся, если действий не передали.
 */
import { el } from "./dom.js";
import { IconButton } from "./button.js";

export function Header({ title = "", subtitle = "", actions = [] } = {}) {
  return el("header", { class: "header" }, [
    el("span", { class: "header__mark", "aria-hidden": "true", text: "Б" }),
    el("span", { class: "header__copy" }, [
      el("span", { class: "header__brand" }, [
        "БОТай ",
        el("span", { class: "header__brand-accent", text: "CRM" }),
      ]),
      el("span", { class: "num header__title", text: subtitle || title }),
    ]),
    el("span", { class: "header__actions" }, actions),
  ]);
}

export const HeaderIcon = IconButton;

/** Активная вкладка помечена засечкой сверху и «бумажным» текстом. */
export function TabBar({ items = [], value, onSelect } = {}) {
  return el("nav", { class: "tabbar", "aria-label": "Разделы" },
    items.map((item) => {
      const active = item.value === value;
      return el("button", {
        type: "button",
        class: `tabbar__item${active ? " is-active" : ""}`,
        "aria-current": active ? "page" : null,
        onClick: onSelect ? () => onSelect(item.value) : null,
      }, [
        el("span", { class: "tabbar__mark", "aria-hidden": "true" }),
        el("span", { class: "tabbar__label", text: item.label }),
      ]);
    }));
}

/** Раскрывает действия вверх списком, а не радиально. */
export function Fab({ actions = [], label = "Действия" } = {}) {
  if (!actions.length) return null;
  const menu = el("div", { class: "fab__menu", hidden: true },
    actions.map((a) => el("button", {
      type: "button",
      class: "fab__action",
      text: a.label,
      onClick: () => { menu.hidden = true; a.onClick?.(); },
    })));
  const button = el("button", {
    type: "button",
    class: "fab__button",
    "aria-label": label,
    "aria-expanded": "false",
    text: "+",
    onClick: () => {
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
    },
  });
  return el("div", { class: "fab" }, [menu, button]);
}
