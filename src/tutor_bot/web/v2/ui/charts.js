/* График дохода за 7 дней и круговой индикатор прогресса. */
import { el, num } from "./dom.js";
import { money } from "../core/format.js";

export function IncomeChart({ days = [] } = {}) {
  const max = Math.max(...days.map((d) => Number(d.value) || 0), 1);
  return el("figure", { class: "chart" }, [
    el("div", { class: "chart__plot" }, days.map((d) =>
      el("div", { class: "chart__col", title: `${d.label}: ${money(d.value)}` }, [
        el("span", {
          class: "chart__bar",
          style: { height: `${Math.max(6, (Number(d.value) || 0) / max * 100)}%` },
        }),
        el("span", { class: "num chart__label", text: d.label }),
      ]))),
  ]);
}

/** Кольцо прогресса. Единственное место с radius-full кроме FAB. */
export function ProgressRing({ value = 0, caption = "", size = 72 } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return el("div", { class: "ring", role: "img", "aria-label": `${caption}: ${pct}%` }, [
    el("div", {
      class: "ring__dial",
      style: {
        width: `${size}px`,
        height: `${size}px`,
        background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--border-strong) 0)`,
      },
    }, [
      el("span", { class: "ring__hole" }, [num(`${pct}%`, "ring__value")]),
    ]),
    caption ? el("span", { class: "ring__caption", text: caption }) : null,
  ]);
}
