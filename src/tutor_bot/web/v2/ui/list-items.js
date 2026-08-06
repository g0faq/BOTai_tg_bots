/* Специализированные строки списков: ДЗ, план, заметка, ссылка, аванс. */
import { el, num } from "./dom.js";
import { Notch } from "./notch.js";

export function HomeworkRow({ title, meta = "", notch, files = "", link = "", action = null, onClick } = {}) {
  return el("article", { class: "hw" }, [
    notch ? Notch(notch) : null,
    el(onClick ? "button" : "div", { type: onClick ? "button" : null, class: "hw__main", onClick }, [
      el("span", { class: "hw__title", text: title }),
      meta ? el("span", { class: "hw__meta", text: meta }) : null,
      files || link
        ? el("span", { class: "hw__extra" }, [
            files ? num(files, "hw__files") : null,
            link ? el("a", { class: "hw__link", href: link, target: "_blank", rel: "noreferrer", text: "Открыть ссылку" }) : null,
          ])
        : null,
    ]),
    action,
  ]);
}

export function PlanRow({ title, meta = "", status = "", done = false, notch, onToggle } = {}) {
  return el("div", { class: `plan${done ? " is-done" : ""}` }, [
    notch ? Notch(notch) : null,
    el("button", {
      type: "button",
      class: `plan__box${done ? " is-checked" : ""}`,
      "aria-pressed": done ? "true" : "false",
      "aria-label": done ? "Снять отметку" : "Отметить выполненным",
      onClick: onToggle,
    }, [el("span", { "aria-hidden": "true", text: done ? "✓" : "" })]),
    el("span", { class: "plan__main" }, [
      el("span", { class: "plan__title", text: title }),
      meta ? num(meta, "plan__meta") : null,
    ]),
    status ? el("span", { class: "plan__status", text: status }) : null,
  ]);
}

export function NoteRow({ title, text = "", date = "", notch } = {}) {
  return el("article", { class: "note" }, [
    notch ? Notch(notch) : null,
    el("span", { class: "note__title", text: title }),
    text ? el("p", { class: "note__text", text }) : null,
    date ? num(date, "note__date") : null,
  ]);
}

/** Отсутствующая ссылка остаётся серой строкой: поле есть и его можно заполнить. */
export function LinkRow({ label, value = "", href = "" } = {}) {
  const filled = Boolean(value);
  const target = href || (String(value).startsWith("@") ? `https://t.me/${String(value).slice(1)}` : value);
  return el(filled ? "a" : "div", {
    class: `link-row${filled ? "" : " is-empty"}`,
    href: filled ? target : null,
    target: filled ? "_blank" : null,
    rel: filled ? "noreferrer" : null,
  }, [
    el("span", { class: "link-row__label", text: label }),
    el("span", { class: "link-row__value", text: filled ? value : "не указана" }),
    el("span", { class: "link-row__chev", "aria-hidden": "true", text: "›" }),
  ]);
}

export function AdvanceRow({ name, meta = "", meta2 = "", left = "", notch, onClick } = {}) {
  return el(onClick ? "button" : "div", {
    type: onClick ? "button" : null,
    class: "advance",
    onClick,
  }, [
    notch ? Notch(notch) : null,
    el("span", { class: "advance__main" }, [
      el("span", { class: "advance__name", text: name }),
      meta ? num(meta, "advance__meta") : null,
      meta2 ? num(meta2, "advance__meta") : null,
    ]),
    left ? num(left, "advance__left") : null,
  ]);
}

/** Полоса заданий с осью и подписями номеров — версия для карточки. */
export function TaskChart({ levels = [], goal = 27, toneOf } = {}) {
  const items = Array.from({ length: goal }, (_, i) => Number(levels[i]) || 0);
  return el("div", { class: "task-chart" }, [
    el("div", { class: "task-chart__axis", "aria-hidden": "true" },
      ["10", "8", "6", "4", "2", "0"].map((v) => num(v, "task-chart__tick"))),
    el("div", { class: "task-chart__plot" }, items.map((level, i) =>
      el("span", {
        class: `task-chart__bar task-chart__bar--${toneOf(level)}${level === 0 ? " is-empty" : ""}`,
        style: { height: `${Math.max(4, level * 10)}%` },
        title: `Задание ${i + 1}: ${level}/10`,
      }))),
    el("span", {}),
    el("div", { class: "task-chart__labels", "aria-hidden": "true" },
      items.map((_, i) => num((i + 1) % 2 === 1 ? String(i + 1) : "", "task-chart__label"))),
  ]);
}
