/* Экран «Домашние задания».
 *
 * «Просрочено» считается на клиенте: дедлайн в прошлом и статус не
 * «выполнено». Само значение статуса при этом не подменяется — в базу
 * уходит то, что пришло оттуда.
 */

import { el, append } from "../ui/dom.js";
import { ScreenHead } from "../ui/section.js";
import { Button, IconButton } from "../ui/button.js";
import { Segmented } from "../ui/chip.js";
import { HomeworkRow } from "../ui/list-items.js";
import { EmptyState } from "../ui/feedback.js";

export const HOMEWORK_FILTERS = [
  { value: "all", label: "Все" },
  { value: "work", label: "В работе" },
  { value: "done", label: "Выполнены" },
  { value: "overdue", label: "Просрочены" },
  { value: "archive", label: "Архив" },
];

export function HomeworksScreen({
  items = [],
  total = items.length,
  filter = "all",
  canCreate = false,
  archiveNote = false,
  actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--homeworks" });

  const list = items.length
    ? el("div", { class: "list" }, items.map((h) => HomeworkRow({
        title: h.title,
        meta: h.meta,
        notch: h.notch,
        files: h.files,
        link: h.link,
        action: actions.openHomework
          ? IconButton({ glyph: "⋯", label: "Действия", onClick: () => actions.openHomework(h.id) })
          : null,
        onClick: actions.openHomework ? () => actions.openHomework(h.id) : null,
      })))
    : EmptyState({
        title: archiveNote ? "Архив пуст" : "Здесь пусто",
        description: archiveNote
          ? "Сюда домашки попадают на следующий день после сдачи и хранятся 10 дней."
          : "Создайте домашку — ученик увидит её сразу и сможет прислать решение.",
      });

  append(root, [
    ScreenHead({
      title: "Домашние задания",
      count: `${items.length}/${total}`,
      primary: canCreate
        ? Button({ kind: "main", label: "Создать домашку", full: true, onClick: actions.createHomework })
        : null,
    }),
    archiveNote
      ? el("p", { class: "screen__note", text: "Домашки попадают в архив на следующий день после сдачи и удаляются через 10 дней." })
      : null,
    el("div", { class: "screen__seg" }, [
      Segmented({
        items: HOMEWORK_FILTERS,
        value: filter,
        label: "Фильтр домашних заданий",
        onSelect: actions.setFilter,
      }),
    ]),
    list,
  ]);

  return root;
}
