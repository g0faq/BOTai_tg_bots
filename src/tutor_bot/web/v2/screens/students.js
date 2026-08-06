/* Экран «Ученики».
 *
 * Роль не проверяется внутри: действия и признак доступности фильтров
 * приходят в view-model снаружи.
 */

import { el, num, append } from "../ui/dom.js";
import { ScreenHead } from "../ui/section.js";
import { Button } from "../ui/button.js";
import { Field, Select } from "../ui/field.js";
import { ChipRow } from "../ui/chip.js";
import { StudentRow } from "../ui/student-row.js";
import { EmptyState } from "../ui/feedback.js";
import { PREP_TYPES } from "../core/dict.js";

const SORTS = [
  { value: "next", label: "Ближайшие" },
  { value: "name", label: "По имени" },
  { value: "price", label: "По стоимости" },
];

export function StudentsScreen({
  students = [],
  total = students.length,
  chips = [],
  filters = { chip: "Все", query: "", prep: "", sort: "next" },
  filtersOpen = false,
  actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--students" });

  const list = students.length
    ? el("div", { class: "list" }, students.map((s) => StudentRow({
        name: s.name,
        meta: s.meta,
        balance: s.balance,
        balanceTone: s.balanceTone,
        next: s.next,
        notch: s.notch,
        levels: s.levels,
        bandSize: "tick",
        onClick: actions.openStudent ? () => actions.openStudent(s.id) : null,
      })))
    : EmptyState({
        title: "В этом фильтре пусто",
        description: "Сбросьте фильтр или добавьте ученика — он появится здесь сразу.",
      });

  const filterPanel = filtersOpen
    ? el("div", { class: "filter-panel" }, [
        Field({
          placeholder: "Найти ученика",
          value: filters.query,
          state: filters.query ? "filled" : "empty",
          tail: "⌕",
          onInput: actions.setQuery,
        }),
        el("div", { class: "filter-panel__pair" }, [
          Select({
            value: filters.prep,
            options: [{ value: "", label: "Все направления" }, ...PREP_TYPES.map((p) => ({ value: p, label: p }))],
            onChange: actions.setPrep,
          }),
          Select({ value: filters.sort, options: SORTS, onChange: actions.setSort }),
        ]),
        ChipRow({ items: chips, value: filters.chip, onSelect: actions.setChip }),
        el("span", { class: "filter-panel__summary" }, [
          num(`${students.length} из ${total}`),
        ]),
      ])
    : null;

  // append из dom.js отбрасывает null; нативный Element.append вставил бы
  // строку "null" прямо в разметку.
  append(root, [
    ScreenHead({
      title: "Ученики",
      count: `${students.length}/${total}`,
      primary: Button({ kind: "main", label: "Добавить ученика", full: true, onClick: actions.createStudent }),
      extra: Button({
        kind: filtersOpen ? "main" : "second",
        label: "Фильтры",
        onClick: actions.toggleFilters,
      }),
    }),
    filterPanel,
    list,
  ]);

  return root;
}

export function studentsScreenFactory(getModel) {
  return () => ({
    mount(container) {
      container.append(StudentsScreen(getModel()));
    },
  });
}
