/* Иконки таббара.
 *
 * Рисуются в языке системы «Журнал / Табло»: только прямые линии и прямые
 * углы, обводка в 1.5 px, без заливок, скруглений и градиентов. Цвет —
 * currentColor, поэтому активное состояние наследует акцент от кнопки.
 *
 * Сетка 20×20, все фигуры выровнены по полупикселю (x.5), чтобы линии
 * ложились на пиксель и не мылились.
 */

const NS = "http://www.w3.org/2000/svg";

function svg(paths) {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", "0 0 20 20");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.5");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("focusable", "false");
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    node.append(path);
  }
  return node;
}

/** Обзор — табло 2×2. */
const overview = () => svg([
  "M2.75 2.75h6v6h-6z",
  "M11.25 2.75h6v6h-6z",
  "M2.75 11.25h6v6h-6z",
  "M11.25 11.25h6v6h-6z",
]);

/** Ученики — строки журнала с засечкой слева. */
const students = () => svg([
  "M2.75 4.75h1.5", "M7.25 4.75h10",
  "M2.75 10h1.5", "M7.25 10h10",
  "M2.75 15.25h1.5", "M7.25 15.25h10",
]);

/** Календарь — сетка месяца с шапкой. */
const calendar = () => svg([
  "M2.75 4.75h14.5v12.5H2.75z",
  "M2.75 8.5h14.5",
  "M6.25 2.75v3", "M13.75 2.75v3",
  "M7.5 11.75h5",
]);

/** ДЗ — лист с полем и строками. */
const homework = () => svg([
  "M4.75 2.75h10.5v14.5H4.75z",
  "M7.75 2.75v14.5",
  "M10.25 6.75h3", "M10.25 10h3", "M10.25 13.25h3",
]);

/** Финансы — столбцы табло. */
const finances = () => svg([
  "M2.75 17.25h14.5",
  "M5.25 13.25v4", "M9.25 8.75v8.5", "M13.25 11v6.25", "M17 5.75v11.5",
]);

/** Прогресс — восходящая шкала с осью. */
const progress = () => svg([
  "M2.75 2.75v14.5h14.5",
  "M5.75 13.5l3.5-3.5 2.5 2.5 4.5-4.5",
]);

const ICONS = { overview, students, calendar, homeworks: homework, finances, progress };

/** Иконка по ключу вкладки. Неизвестный ключ — пустой квадрат-заглушка. */
export function tabIcon(key) {
  const make = ICONS[key] || (() => svg(["M2.75 2.75h14.5v14.5H2.75z"]));
  return make();
}

export const TAB_ICON_KEYS = Object.keys(ICONS);
