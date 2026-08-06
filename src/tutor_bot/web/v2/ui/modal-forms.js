/* Каталог модальных форм.
 *
 * Все 17 форм живут в одном контейнере (ui/modal.js): drag-handle,
 * заголовок, ✕, сгруппированные поля, кнопка действия внизу. Поля
 * сгруппированы подзаголовками ровно так, как в спецификации.
 *
 * Формы описаны декларативно, чтобы состав полей можно было сверить с
 * документом глазами, не читая разметку.
 */

import { el } from "./dom.js";
import { Field, Select } from "./field.js";
import { Button } from "./button.js";
import { StatusWheel } from "./status-wheel.js";
import { DurationPicker, FreeSlots, ChoiceWithOther } from "./pickers.js";
import {
  lessonStatusOptions, paymentStatusOptions, planStatusOptions,
  SUBJECTS, PREP_TYPES, KNOWLEDGE_LEVELS,
} from "../core/dict.js";

const TZ = ["МСК-1", "МСК+0", "МСК+1", "МСК+2", "МСК+3", "МСК+4"];

function group(title, fields) {
  return el("fieldset", { class: "form-group" }, [
    title ? el("legend", { class: "form-group__title", text: title }) : null,
    ...fields.filter(Boolean),
  ]);
}

const f = (label, value = "", opts = {}) => Field({ label, value, state: value ? "filled" : "empty", ...opts });
const sel = (label, value, options) => Select({ label, value, options });

/** Определения форм: () => { groups, submit, danger?, note? } */
export const MODAL_FORMS = {
  "Новое занятие": () => ({
    submit: "Готово",
    groups: [
      group("Информация об уроке", [
        sel("Ученик", "Михаил Волосов", ["Михаил Волосов", "Назар Кириленко", "Аня Петрова"]),
        f("Дата и время", "06.08.2026 10:00", { mono: true }),
        DurationPicker({ value: 60 }),
      ]),
      group("Статусы", [
        StatusWheel({ label: "Занятие", options: lessonStatusOptions(), value: "запланировано" }),
        StatusWheel({ label: "Оплата", options: paymentStatusOptions(), value: "не отмечено" }),
      ]),
      group("Финансы", [
        f("Стоимость", "1500", { mono: true }),
        f("Заметки"),
      ]),
    ],
    extra: Button({ kind: "second", label: "Показать свободные окна", full: true }),
  }),

  "Перенести занятие": () => ({
    submit: "Отправить перенос",
    note: "После отправки преподаватель подтвердит перенос или отклонит заявку.",
    groups: [group("", [f("Новое время", "08.08.2026 15:00", { mono: true }), DurationPicker({ value: 60 })])],
    extra: Button({ kind: "second", label: "Показать свободные окна", full: true }),
  }),

  "Свободные окна": () => ({
    submit: "Выбрать",
    groups: [group("Горизонт 14 дней", [FreeSlots({
      duration: 60,
      days: [
        { title: "четверг, 6 августа", slots: [{ time: "10:00" }, { time: "11:30" }, { time: "16:00" }] },
        { title: "пятница, 7 августа", slots: [{ time: "09:00" }, { time: "18:00" }] },
      ],
    })])],
  }),

  "Новый ученик": () => ({
    submit: "Добавить ученика",
    groups: [
      group("Основное", [f("Имя"), f("Класс"), sel("Часовой пояс", "МСК+0", TZ)]),
      group("Стоимость", [
        f("Стоимость за 1 час", "", { mono: true }),
        f("Цена 1 час", "", { mono: true }),
        f("Цена 1.5 часа", "", { mono: true }),
        f("Цена 2 часа", "", { mono: true }),
      ]),
      group("Подготовка", [
        ChoiceWithOther({ label: "Вид подготовки", options: PREP_TYPES, value: "ЕГЭ" }),
        ChoiceWithOther({ label: "Предмет", options: SUBJECTS, value: "Информатика" }),
        f("Цель"),
      ]),
      group("Контакты и ссылки", [
        f("Контакт ученика"), f("Имя родителя"), f("Контакт родителя"),
        f("Ссылка на доску"), f("Ссылка на звонок"), f("Комментарии"),
      ]),
    ],
  }),

  "Редактирование ученика": () => ({
    submit: "Сохранить",
    danger: "Удалить ученика",
    groups: [
      group("Основное", [f("Имя", "Михаил Волосов"), f("Класс", "11"), sel("Часовой пояс", "МСК+0", TZ)]),
      group("Прогресс", [
        f("Прогресс текущий", "62", { mono: true }),
        f("Прогресс цель", "80", { mono: true }),
        f("Оплачено часов", "4", { mono: true }),
      ]),
      group("Доступ", [sel("Права родителя", "false", [
        { value: "false", label: "Только просмотр и оплата" },
        { value: "true", label: "Может редактировать календарь" },
      ])]),
    ],
  }),

  "Новая домашка": () => ({
    submit: "Готово",
    groups: [
      group("Основное", [
        sel("Ученик", "Михаил Волосов", ["Михаил Волосов", "Назар Кириленко"]),
        f("Название"), f("Описание"),
      ]),
      group("Материалы", [f("Ссылки"), f("Ссылки на файлы")]),
      group("Сроки", [f("Дедлайн", "08.08.2026", { mono: true })]),
      group("Статус", [f("Комментарий преподавателя")]),
    ],
  }),

  "Домашнее задание": () => ({
    submit: "Отправить решение",
    note: "Дедлайн: 8 августа, 23:59",
    groups: [group("", [f("Решение или ссылка")])],
  }),

  "Сдать домашку": () => ({
    submit: "Отправить решение",
    groups: [group("", [f("Решение или ссылка")])],
  }),

  "Стабильное расписание": () => ({
    submit: "Добавить стабильное расписание",
    groups: [
      group("Дни и время", [
        sel("Ученик", "Михаил Волосов", ["Михаил Волосов", "Назар Кириленко"]),
        sel("День недели", "Понедельник", ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]),
        f("Время", "18:00", { mono: true }),
        DurationPicker({ value: 60 }),
      ]),
      group("Период", [
        f("Начать с", "06.08.2026", { mono: true }),
        f("Создать до", "31.12.2026", { mono: true }),
      ]),
    ],
  }),

  "Нерабочие часы": () => ({
    submit: "Закрыть время",
    groups: [group("", [
      f("Начало", "06.08.2026 12:00", { mono: true }),
      f("Конец", "06.08.2026 13:00", { mono: true }),
      f("Причина"),
    ])],
  }),

  "Добавить оплату": () => ({
    submit: "Добавить оплату",
    note: "Считаю автоматически: 1 500 ₽ за час.",
    groups: [group("", [
      sel("Ученик", "Михаил Волосов", ["Михаил Волосов", "Назар Кириленко"]),
      f("Сумма", "6000", { mono: true }),
      Field({ label: "Оплачено часов", value: "4", state: "off", mono: true }),
      f("Комментарий"),
    ])],
  }),

  "Редактировать аванс": () => ({
    submit: "Сохранить",
    groups: [group("", [
      Field({ label: "Ученик", value: "Михаил Волосов", state: "off" }),
      f("Осталось часов", "3", { mono: true }),
      f("Внесено часов", "4", { mono: true }),
      f("Сумма", "6000", { mono: true }),
      f("Когда внесён", "04.08.2026", { mono: true }),
    ])],
  }),

  "Изменить прогресс": () => ({
    submit: "Готово",
    groups: [group("", [
      sel("Задание", "5", Array.from({ length: 27 }, (_, i) => String(i + 1))),
      f("Уровень 0–10", "7", { mono: true }),
      ChoiceWithOther({ label: "Уровень знания", options: KNOWLEDGE_LEVELS, value: "средний" }),
      f("Комментарий"),
    ])],
  }),

  "Новая заметка": () => ({
    submit: "Создать заметку",
    groups: [group("", [
      sel("Тема", "Тема вручную", ["Тема вручную", "Задание 5", "Задание 16"]),
      f("Тема вручную"),
      f("Заметка"),
    ])],
  }),

  "Пункт плана": () => ({
    submit: "Добавить пункт",
    groups: [group("", [
      f("Пункт плана"),
      f("Дедлайн", "01.09.2026", { mono: true }),
      f("Комментарий"),
      sel("Статус", "не начато", planStatusOptions().map((s) => ({ value: s.value, label: s.label }))),
    ])],
  }),

  "Последний пробник": () => ({
    submit: "Готово",
    groups: [group("", [
      f("Решено заданий", "21", { mono: true }),
      f("Всего заданий", "27", { mono: true }),
      f("Баллы", "78", { mono: true }),
      f("Дата пробника", "02.08.2026", { mono: true }),
    ])],
  }),

  "Ссылка доступа": () => ({
    submit: "Создать ссылку",
    groups: [group("", [
      sel("Кому", "student", [{ value: "student", label: "Ученику" }, { value: "parent", label: "Родителю" }]),
      sel("Вход будет работать", "180", [
        { value: "180", label: "6 месяцев" }, { value: "365", label: "1 год" }, { value: "30", label: "30 дней" },
      ]),
      sel("Ссылка активна", "3650", [
        { value: "3650", label: "Постоянная" }, { value: "365", label: "1 год" },
        { value: "30", label: "30 дней" }, { value: "7", label: "7 дней" }, { value: "1", label: "1 день" },
      ]),
    ])],
  }),
};

export const MODAL_NAMES = Object.keys(MODAL_FORMS);

/** Собирает тело и футер модалки по определению формы. */
export function buildModalForm(name) {
  const def = (MODAL_FORMS[name] || MODAL_FORMS["Новое занятие"])();
  const body = [
    ...def.groups,
    def.extra || null,
    def.note ? el("p", { class: "modal-note", text: def.note }) : null,
    def.danger ? Button({ kind: "danger", label: def.danger, full: true }) : null,
  ].filter(Boolean);
  const footer = el("div", { class: "modal-actions" }, [
    Button({ kind: "second", label: "Отмена", full: true }),
    Button({ kind: "main", label: def.submit, full: true }),
  ]);
  return { body, footer };
}
