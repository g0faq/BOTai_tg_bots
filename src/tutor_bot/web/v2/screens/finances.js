/* Экран «Финансы».
 *
 * Шесть KPI — ячейки табло 3×2: цифра mono крупно, подпись капителью,
 * засечка кодирует смысл. Плитка долга при нуле теряет засечку и уходит в
 * приглушённый текст.
 */

import { el, num } from "../ui/dom.js";
import { ScreenHead, SectionCaption, DayHeader } from "../ui/section.js";
import { StatCell, StatGrid } from "../ui/stat.js";
import { Button } from "../ui/button.js";
import { Select } from "../ui/field.js";
import { IncomeChart } from "../ui/charts.js";
import { AdvanceRow } from "../ui/list-items.js";
import { OperationRow } from "../ui/rows.js";
import { EmptyState } from "../ui/feedback.js";
import { paymentStatusOptions } from "../core/dict.js";

const OPERATION_FILTERS = () => [
  { value: "", label: "Все операции" },
  ...paymentStatusOptions().map((s) => ({ value: s.value, label: s.label })),
  { value: "подтверждено", label: "подтверждено" },
  { value: "ожидает подтверждения", label: "ожидает подтверждения" },
];

export function FinancesScreen({
  kpi = [],
  income = [],
  incomeTotal = "",
  advances = [],
  operationDays = [],
  operationsCount = 0,
  toCheck = [],
  unpaid = [],
  filter = "",
  actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--finances" });

  root.append(
    ScreenHead({
      title: "Финансы",
      primary: Button({ kind: "main", label: "Добавить оплату", full: true, onClick: actions.createPayment }),
    }),
    StatGrid({
      columns: 3,
      cells: kpi.map((k) => StatCell({ value: k.value, label: k.label, notch: k.notch, tone: k.tone })),
    }),
  );

  root.append(
    SectionCaption({ title: "Доход · 7 дней", action: incomeTotal ? num(incomeTotal, "num--money") : null }),
    el("div", { class: "screen__pad" }, [IncomeChart({ days: income, showValues: true })]),
  );

  root.append(SectionCaption({ title: "Авансы", count: advances.length }));
  root.append(advances.length
    ? el("div", { class: "list" }, advances.map((a) => AdvanceRow({
        name: a.name, meta: a.meta, meta2: a.meta2, left: a.left, notch: a.notch,
        onClick: actions.editAdvance ? () => actions.editAdvance(a.id) : null,
      })))
    : EmptyState({
        title: "Авансов нет",
        description: "Ученики с оплаченными занятиями вперёд появятся здесь.",
      }));

  root.append(
    el("div", { class: "screen__pad" }, [
      Select({ value: filter, options: OPERATION_FILTERS(), onChange: actions.setFilter }),
    ]),
    SectionCaption({ title: "История операций", count: operationsCount }),
  );

  for (const day of operationDays) {
    root.append(DayHeader({ title: day.title, total: day.total }));
    root.append(el("div", { class: "list" }, day.items.map((o) => OperationRow({
      name: o.name, meta: o.meta, notch: o.notch, tail: o.tail,
    }))));
  }

  root.append(SectionCaption({ title: "Ожидают проверки", count: toCheck.length }));
  root.append(toCheck.length
    ? el("div", { class: "list" }, toCheck.map((c) => OperationRow({
        name: c.name, meta: c.meta, notch: c.notch,
        tail: Button({ kind: "main", label: "Подтвердить", onClick: actions.confirmPayment ? () => actions.confirmPayment(c.id) : null }),
      })))
    : EmptyState({
        title: "Нет платежей на проверке",
        description: "Когда ученик или родитель отметит оплату, она появится здесь.",
      }));

  root.append(SectionCaption({ title: "Ожидают оплаты", count: unpaid.length }));
  root.append(unpaid.length
    ? el("div", { class: "list" }, unpaid.map((u) => OperationRow({
        name: u.name, meta: u.meta, notch: u.notch, tail: u.tail,
      })))
    : EmptyState({
        title: "Все проведённые занятия оплачены",
        description: "Неоплаченные появятся здесь сразу после того, как вы отметите занятие проведённым.",
      }));

  return root;
}
