/* Полоса заданий 1–27: уровень знания 0–10 по каждому заданию.
 * Три размера: full (карточка прогресса), tick (строка ученика), micro.
 * Тон берётся из dict.levelTone — компонент порогов не знает.
 */
import { el } from "./dom.js";
import { levelTone } from "../core/dict.js";

export function TaskBand({ levels = [], size = "full", goal = 27 } = {}) {
  const items = Array.from({ length: goal }, (_, i) => Number(levels[i]) || 0);
  return el("div", {
    class: `band band--${size}`,
    role: "img",
    "aria-label": `Уровень знаний по ${goal} заданиям от 0 до 10`,
  }, items.map((level, i) => {
    const tone = levelTone(level);
    const bar = el("span", {
      class: `band__bar band__bar--${tone}${level === 0 ? " is-empty" : ""}`,
      style: { height: `${Math.max(4, level * 10)}%` },
    });
    return el("span", {
      class: "band__slot",
      title: `Задание ${i + 1}: ${level}/10`,
    }, [bar]);
  }));
}

/** Ось 10/8/6/4/2/0 слева от полосы. */
export function TaskBandAxis() {
  return el("div", { class: "band-axis", "aria-hidden": "true" },
    ["10", "8", "6", "4", "2", "0"].map((v) => el("span", { class: "num band-axis__tick", text: v })));
}
