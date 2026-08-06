/* Табло: ячейки KPI, полоса структуры оплат, карточка следующего урока. */
import { el, num } from "./dom.js";
import { Notch } from "./notch.js";

/** Ячейка табло: цифра mono крупно, подпись капителью, засечка кодирует смысл. */
export function StatCell({ value, label, notch = null, tone = "none" } = {}) {
  return el("div", { class: "stat" }, [
    notch ? Notch(notch) : null,
    num(value, `stat__value stat__value--${tone}`),
    el("span", { class: "stat__label", text: label }),
  ]);
}

export function StatGrid({ cells = [], columns = 3 } = {}) {
  return el("div", { class: `stat-grid stat-grid--${columns}` }, cells);
}

/** Структура оплат одной полосой: оплачено / ждёт / долг. */
export function FinanceBar({ paid = 0, waiting = 0, debt = 0 } = {}) {
  const total = paid + waiting + debt;
  if (total <= 0) return el("div", { class: "finance-bar finance-bar--empty" });
  return el("div", { class: "finance-bar", role: "img", "aria-label": "Структура оплат" }, [
    paid ? el("span", { class: "finance-bar__part finance-bar__part--done", style: { flex: String(paid) } }) : null,
    waiting ? el("span", { class: "finance-bar__part finance-bar__part--wait", style: { flex: String(waiting) } }) : null,
    debt ? el("span", { class: "finance-bar__part finance-bar__part--debt", style: { flex: String(debt) } }) : null,
  ]);
}

/** Карточка следующего урока. */
export function NextLessonCard({ when, meta = "", price = "", notch = null, action = null } = {}) {
  return el("article", { class: "next-lesson" }, [
    notch ? Notch(notch) : null,
    el("span", { class: "next-lesson__main" }, [
      el("span", { class: "next-lesson__cap", text: "Следующий урок" }),
      num(when, "next-lesson__when"),
      meta ? el("span", { class: "next-lesson__meta", text: meta }) : null,
    ]),
    action || (price ? num(price, "next-lesson__price num--money") : null),
  ]);
}

/** Пара «подпись — значение» строкой в 44 px. */
export function FactRow({ label, value, tone = "none" } = {}) {
  return el("div", { class: "fact" }, [
    el("span", { class: "fact__label", text: label }),
    num(value, `fact__value fact__value--${tone}`),
  ]);
}
