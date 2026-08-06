/* Засечка статуса в левом жёлобе строки.
 * Статус кодируется цветом + формой + позицией, поэтому читается без цвета.
 * Форму даёт словарь (dict.js), компонент её только рисует.
 */
import { el } from "./dom.js";

export function Notch({ tone = "none", mark = "none", label = "" } = {}) {
  return el("span", {
    class: `notch notch--${tone} notch--${mark}`,
    "aria-hidden": label ? null : "true",
    "aria-label": label || null,
    role: label ? "img" : null,
  });
}
