/* Словарь статусов.
 *
 * Русские строки ниже — это ЗНАЧЕНИЯ В БАЗЕ, а не подписи. Сравнение и
 * отправка на сервер всегда идут по строке из базы; отображение — всегда
 * через этот модуль. Ни один компонент не сравнивает статус со строкой
 * напрямую: любое такое сравнение — баг.
 *
 * Каждая запись отдаёт {label, tone, mark}:
 *   label — что показать пользователю;
 *   tone  — семантический цвет: done | plan | wait | debt | none;
 *   mark  — форма засечки/глифа, чтобы статус читался без цвета
 *           (дальтонизм, монохромная печать).
 */

/** Формы засечки в левом жёлобе строки. */
export const NOTCH = {
  SOLID: "solid",         // сплошная
  TOP_HALF: "top-half",   // верхняя половина
  BOTTOM_HALF: "bottom-half", // нижняя половина
  DASHED: "dashed",       // пунктир
  DOUBLE: "double",       // двойная тонкая
  NONE: "none",
};

const UNKNOWN = { label: "неизвестно", tone: "none", mark: NOTCH.NONE, glyph: "○" };

/* --- Занятия ------------------------------------------------------------ */

export const LESSON_STATUS = {
  PENDING: "ожидает подтверждения",
  PLANNED: "запланировано",
  CONDUCTED: "проведено",
  MOVED: "перенесено",
  CANCELLED_BY_STUDENT: "отменено учеником",
  CANCELLED_BY_TEACHER: "отменено преподавателем",
  CANCELLED_BY_PARENT: "отменено родителем",
  CANCELLED: "отменено",
};

const LESSON = {
  [LESSON_STATUS.PENDING]: { label: "ожидает подтверждения", short: "ожидает", tone: "wait", mark: NOTCH.DASHED },
  [LESSON_STATUS.PLANNED]: { label: "запланировано", short: "план", tone: "plan", mark: NOTCH.TOP_HALF },
  [LESSON_STATUS.CONDUCTED]: { label: "проведено", short: "проведено", tone: "done", mark: NOTCH.SOLID },
  [LESSON_STATUS.MOVED]: { label: "перенесено", short: "перенос", tone: "plan", mark: NOTCH.BOTTOM_HALF },
  [LESSON_STATUS.CANCELLED]: { label: "отменено", short: "отменено", tone: "debt", mark: NOTCH.DOUBLE },
  [LESSON_STATUS.CANCELLED_BY_STUDENT]: { label: "отменено учеником", short: "отменено", tone: "debt", mark: NOTCH.DOUBLE },
  [LESSON_STATUS.CANCELLED_BY_TEACHER]: { label: "отменено преподавателем", short: "отменено", tone: "debt", mark: NOTCH.DOUBLE },
  [LESSON_STATUS.CANCELLED_BY_PARENT]: { label: "отменено родителем", short: "отменено", tone: "debt", mark: NOTCH.DOUBLE },
};

const CANCELLED_LESSON_STATUSES = new Set([
  LESSON_STATUS.CANCELLED,
  LESSON_STATUS.CANCELLED_BY_STUDENT,
  LESSON_STATUS.CANCELLED_BY_TEACHER,
  LESSON_STATUS.CANCELLED_BY_PARENT,
]);

/* --- Оплата ------------------------------------------------------------- */

export const PAYMENT_STATUS = {
  NOT_MARKED: "не отмечено",
  STUDENT_MARKED: "ученик отметил оплату",
  PARENT_MARKED: "родитель отметил оплату",
  CONFIRMED: "оплачено",
  UNPAID: "не оплачено",
};

const PAYMENT = {
  [PAYMENT_STATUS.NOT_MARKED]: { label: "не отмечено", short: "не отмечено", tone: "none", mark: NOTCH.NONE, glyph: "○" },
  [PAYMENT_STATUS.STUDENT_MARKED]: { label: "ученик отметил оплату", short: "ученик отметил", tone: "wait", mark: NOTCH.DASHED, glyph: "◐" },
  [PAYMENT_STATUS.PARENT_MARKED]: { label: "родитель отметил оплату", short: "родитель отметил", tone: "wait", mark: NOTCH.DASHED, glyph: "◑" },
  [PAYMENT_STATUS.CONFIRMED]: { label: "оплачено", short: "оплачено", tone: "done", mark: NOTCH.SOLID, glyph: "●" },
  [PAYMENT_STATUS.UNPAID]: { label: "не оплачено", short: "долг", tone: "debt", mark: NOTCH.DOUBLE, glyph: "▲" },
};

/* --- Домашние задания --------------------------------------------------- */

export const HOMEWORK_STATUS = {
  ASSIGNED: "выдано",
  WAITING: "ожидание выполнения",
  SUBMITTED: "сдано",
  SUBMITTED_LATE: "сдано с опозданием",
  DONE: "выполнено",
  CHECKED: "проверено",
  NEEDS_FIX: "нужно исправить",
  OVERDUE: "просрочено",
  CANCELLED: "отменено",
};

const HOMEWORK = {
  [HOMEWORK_STATUS.ASSIGNED]: { label: "выдано", short: "выдано", tone: "plan", mark: NOTCH.TOP_HALF },
  [HOMEWORK_STATUS.WAITING]: { label: "ожидание выполнения", short: "в работе", tone: "plan", mark: NOTCH.TOP_HALF },
  [HOMEWORK_STATUS.SUBMITTED]: { label: "сдано", short: "сдано", tone: "wait", mark: NOTCH.DASHED },
  [HOMEWORK_STATUS.SUBMITTED_LATE]: { label: "сдано с опозданием", short: "сдано позже", tone: "wait", mark: NOTCH.DASHED },
  [HOMEWORK_STATUS.DONE]: { label: "выполнено", short: "выполнено", tone: "done", mark: NOTCH.SOLID },
  [HOMEWORK_STATUS.CHECKED]: { label: "проверено", short: "проверено", tone: "done", mark: NOTCH.SOLID },
  [HOMEWORK_STATUS.NEEDS_FIX]: { label: "нужно исправить", short: "исправить", tone: "debt", mark: NOTCH.DOUBLE },
  [HOMEWORK_STATUS.OVERDUE]: { label: "просрочено", short: "просрочено", tone: "debt", mark: NOTCH.DOUBLE },
  [HOMEWORK_STATUS.CANCELLED]: { label: "отменено", short: "отменено", tone: "debt", mark: NOTCH.DOUBLE },
};

/* --- Пункт плана -------------------------------------------------------- */

export const PLAN_STATUS = {
  NOT_STARTED: "не начато",
  IN_PROGRESS: "в процессе",
  DONE: "выполнено",
  REPEAT: "нужно повторить",
};

const PLAN = {
  [PLAN_STATUS.NOT_STARTED]: { label: "не начато", short: "не начато", tone: "none", mark: NOTCH.NONE },
  [PLAN_STATUS.IN_PROGRESS]: { label: "в процессе", short: "в процессе", tone: "plan", mark: NOTCH.TOP_HALF },
  [PLAN_STATUS.DONE]: { label: "выполнено", short: "выполнено", tone: "done", mark: NOTCH.SOLID },
  [PLAN_STATUS.REPEAT]: { label: "нужно повторить", short: "повторить", tone: "wait", mark: NOTCH.DASHED },
};

/* --- Справочники выбора ------------------------------------------------- */

export const SUBJECTS = [
  "Информатика", "Математика", "Русский язык", "Физика", "Химия",
  "Биология", "Английский язык", "Обществознание", "История", "Литература",
];

export const PREP_TYPES = [
  "ЕГЭ", "ОГЭ", "Школьная программа", "ВПР", "ДВИ", "Олимпиады", "Python",
];

export const KNOWLEDGE_LEVELS = ["с нуля", "база", "средний", "сильный", "другое"];

/* --- Публичный доступ --------------------------------------------------- */

function look(table, value) {
  if (value == null) return UNKNOWN;
  return table[value] || { ...UNKNOWN, label: String(value) };
}

export const lessonStatus = (value) => look(LESSON, value);
export const paymentStatus = (value) => look(PAYMENT, value);
export const homeworkStatus = (value) => look(HOMEWORK, value);
export const planStatus = (value) => look(PLAN, value);

/** Отменено ли занятие — единственное разрешённое место для этой проверки. */
export const isCancelledLesson = (value) => CANCELLED_LESSON_STATUSES.has(value);

/** Все значения статуса занятия для селектов и барабана. */
export const lessonStatusOptions = () =>
  [
    LESSON_STATUS.PENDING,
    LESSON_STATUS.PLANNED,
    LESSON_STATUS.CONDUCTED,
    LESSON_STATUS.CANCELLED,
    LESSON_STATUS.MOVED,
  ].map((value) => ({ value, ...LESSON[value] }));

export const paymentStatusOptions = () =>
  Object.keys(PAYMENT).map((value) => ({ value, ...PAYMENT[value] }));

/** Уровень знания 0–10 → тон полосы задания. Пороги из дизайна. */
export function levelTone(level) {
  const n = Math.max(0, Math.min(10, Number(level) || 0));
  if (n <= 4) return "debt";
  if (n <= 7) return "wait";
  return "done";
}
