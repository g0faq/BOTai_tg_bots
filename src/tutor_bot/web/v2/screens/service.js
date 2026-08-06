/* Служебные экраны: регистрация гостя, загрузка, ошибка. */

import { el, num } from "../ui/dom.js";
import { Button } from "../ui/button.js";
import { Field, Select } from "../ui/field.js";
import { Segmented } from "../ui/chip.js";
import { ChoiceWithOther } from "../ui/pickers.js";
import { SUBJECTS, PREP_TYPES } from "../core/dict.js";

const PARENT_RIGHTS = [
  { value: "false", label: "Только статистика и оплата" },
  { value: "true", label: "Может редактировать календарь" },
];

/**
 * Регистрация гостя.
 * Две формы не рядом, а за сегментированным контролом: на 380 px две
 * колонки анкет не помещаются.
 */
export function RegisterScreen({ role = "student", values = {}, actions = {} } = {}) {
  const set = (key) => (v) => actions.setValue?.(key, v);
  const isStudent = role === "student";

  const studentFields = [
    Field({ label: "ФИО", value: values.full_name || "", state: values.full_name ? "filled" : "empty", onInput: set("full_name") }),
    Field({ label: "Класс", value: values.grade || "", onInput: set("grade") }),
    Select({ label: "Часовой пояс", value: values.timezone || "МСК+0", options: ["МСК-1", "МСК+0", "МСК+1", "МСК+2", "МСК+3", "МСК+4"], onChange: set("timezone") }),
    ChoiceWithOther({ label: "Подготовка", options: PREP_TYPES, value: values.prep_type || "ЕГЭ", onChange: set("prep_type") }),
    ChoiceWithOther({ label: "Предмет", options: SUBJECTS, value: values.subject || "Информатика", onChange: set("subject") }),
    Field({ label: "Цель", value: values.goal || "", onInput: set("goal") }),
    Field({ label: "ФИО родителя", value: values.parent_name || "", onInput: set("parent_name") }),
    Field({ label: "Telegram родителя", value: values.parent_telegram || "", onInput: set("parent_telegram") }),
    Select({ label: "Права родителя", value: String(values.parent_can_edit || "false"), options: PARENT_RIGHTS, onChange: set("parent_can_edit") }),
  ];

  const parentFields = [
    Field({ label: "ФИО родителя", value: values.full_name || "", state: values.full_name ? "filled" : "empty", onInput: set("full_name") }),
    Field({ label: "Telegram ребёнка", value: values.child_telegram || "", onInput: set("child_telegram") }),
    Select({ label: "Часовой пояс", value: values.timezone || "МСК+0", options: ["МСК-1", "МСК+0", "МСК+1", "МСК+2", "МСК+3", "МСК+4"], onChange: set("timezone") }),
  ];

  return el("section", { class: "screen screen--register" }, [
    el("div", { class: "register-head" }, [
      el("h1", { class: "register-head__title", text: "Создай кабинет" }),
      el("p", { class: "register-head__lead", text: "Расписание, домашки, прогресс и оплаты откроются сразу после регистрации." }),
    ]),
    el("div", { class: "screen__seg" }, [
      Segmented({
        items: [{ value: "student", label: "Я ученик" }, { value: "parent", label: "Я родитель" }],
        value: role, label: "Кто вы", onSelect: actions.setRole,
      }),
    ]),
    el("div", { class: "screen__pad form-stack" }, [
      ...(isStudent ? studentFields : parentFields),
      isStudent
        ? null
        : el("p", { class: "screen__note", text: "Если ребёнок уже заполнил анкету, кабинет привяжется к ней. Если нет, появится заготовка профиля." }),
      Button({
        kind: "main",
        label: isStudent ? "Создать кабинет ученика" : "Создать кабинет родителя",
        full: true,
        onClick: actions.submit,
      }),
    ]),
    el("p", { class: "screen__note", text: "Таббар появится после регистрации." }),
  ]);
}

/**
 * Загрузка. Спиннер заменён на определённую полосу: она в той же
 * разлиновке и не крутится вечно.
 */
export function LoadingScreen({ title = "Подключаю кабинет…", note = "Первый запуск ссылки в браузере может занять несколько секунд." } = {}) {
  return el("section", { class: "service" }, [
    el("span", { class: "service__mark", "aria-hidden": "true", text: "Б" }),
    el("span", { class: "service__brand" }, ["БОТай ", el("span", { class: "service__brand-accent", text: "CRM" })]),
    el("span", { class: "service__bar", role: "progressbar", "aria-label": title }, [
      el("span", { class: "service__bar-run" }),
    ]),
    el("span", { class: "service__title", text: title }),
    el("p", { class: "service__note", text: note }),
  ]);
}

/**
 * Ошибка. Говорит, что случилось, что делать и что данные целы.
 * Код и время — чтобы пользователь мог переслать их в поддержку.
 */
export function ErrorScreen({
  title = "Кабинет не загрузился",
  description = "Нет связи с сервером. Проверьте интернет и повторите — данные сохранены, ничего не потеряно.",
  code = "",
  actions = {},
} = {}) {
  return el("section", { class: "service service--error" }, [
    el("span", { class: "service__diamond", "aria-hidden": "true" }),
    el("span", { class: "service__title", text: title }),
    el("p", { class: "service__note", text: description }),
    code ? num(code, "service__code") : null,
    actions.retry ? Button({ kind: "main", label: "Повторить", onClick: actions.retry }) : null,
    actions.openBrowser ? Button({ kind: "inline", label: "Открыть браузерную версию", onClick: actions.openBrowser }) : null,
  ]);
}
