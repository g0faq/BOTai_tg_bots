/* Строки списка: обычная, занятия, операции.
 *
 * Правило композиции: ни одна строка не знает про роль. Кнопки приходят
 * массивом `actions` снаружи — именно ветвление по роли внутри разметки
 * было источником регрессий в старой версии.
 */
import { el, num } from "./dom.js";
import { Notch } from "./notch.js";
import { StatusPill } from "./status-pill.js";

/** Строка списка. Состояния: normal | press | selected | off. */
export function Row({ title, meta = "", value = "", state = "normal", notch, actions = [], onClick } = {}) {
  return el(onClick ? "button" : "div", {
    type: onClick ? "button" : null,
    class: `row row--2${state !== "normal" ? ` is-${state}` : ""}`,
    onClick,
  }, [
    notch ? Notch(notch) : null,
    el("span", { class: "row__main" }, [
      el("span", { class: "row__title", text: title }),
      meta ? el("span", { class: "row__meta", text: meta }) : null,
    ]),
    value ? num(value, "row__value num--money") : null,
    actions.length ? el("span", { class: "row__actions" }, actions) : null,
  ]);
}

/**
 * Строка занятия. Плотность: normal | dense.
 *
 * Раскладка по макету: 52 px под время, гибкая середина, прижатый правый
 * столбец. Статус занятия — обычный текст под именем (его уже кодирует
 * засечка), пилюля только у оплаты: две пилюли в строке 64 px не помещаются
 * и ломают ритм разлиновки.
 */
export function LessonRow({
  time, name, meta = "", price = "",
  lessonStatus, paymentStatus,
  density = "normal", actions = [], onClick,
} = {}) {
  const caption = [lessonStatus?.label, meta].filter(Boolean).join(" · ");
  return el("article", { class: `lesson${density === "dense" ? " lesson--dense" : ""}` }, [
    lessonStatus ? Notch({ tone: lessonStatus.tone, mark: lessonStatus.mark, label: lessonStatus.label }) : null,
    num(time, "lesson__time"),
    el(onClick ? "button" : "div", {
      type: onClick ? "button" : null,
      class: "lesson__main",
      onClick,
    }, [
      el("span", { class: "lesson__name", text: name }),
      caption ? el("span", { class: "lesson__meta", text: caption }) : null,
    ]),
    el("span", { class: "lesson__tail" }, [
      price ? num(price, "lesson__price num--money") : null,
      paymentStatus ? StatusPill(paymentStatus) : null,
    ]),
    actions.length ? el("span", { class: "lesson__actions" }, actions) : null,
  ]);
}

/** Строка операции. Состояния: normal | loading | error. */
export function OperationRow({ name, meta = "", notch, tail, state = "normal" } = {}) {
  return el("article", { class: `op${state !== "normal" ? ` is-${state}` : ""}` }, [
    notch ? Notch(notch) : null,
    el("span", { class: "op__main" }, [
      el("span", { class: "op__name", text: name }),
      meta ? el("span", { class: "op__meta", text: meta }) : null,
    ]),
    tail instanceof Node ? tail : (tail ? el("span", { class: "op__tail", text: tail }) : null),
  ]);
}
