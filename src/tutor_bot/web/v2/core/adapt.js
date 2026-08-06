/* Адаптеры: ответ /api/me → view-model экранов.
 *
 * Единственное место, которое знает форму серверного payload. Экраны
 * получают уже готовые подписи и тона, поэтому смена формата на сервере
 * правится здесь, а не в пяти компонентах.
 *
 * Статусы нигде не сравниваются со строками напрямую — только через dict.
 */

import * as dict from "./dict.js";
import * as fmt from "./format.js";

const notchOf = (entry) => ({ tone: entry.tone, mark: entry.mark });

/* --- общее ---------------------------------------------------------------- */

function groupByDay(items, getDate) {
  const map = new Map();
  for (const item of items) {
    const d = fmt.toDate(getDate(item));
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, { key, date: d, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()].sort((a, b) => a.date - b.date);
}

const lessonPrice = (lesson) => Number(lesson.price || lesson.payment_amount || 0);

/* --- ученики -------------------------------------------------------------- */

export function balanceOf(student) {
  const debt = Number(student.debt_amount || 0);
  if (debt > 0) return { text: fmt.moneySigned(-debt), tone: "debt" };
  const hours = Number(student.balance_lessons || 0);
  if (hours > 0) return { text: fmt.hoursSigned(hours), tone: "done" };
  return { text: fmt.money(0), tone: "none" };
}

export function studentMeta(student) {
  return [student.subject, student.preparationType || student.prep_type, student.grade ? `${student.grade} класс` : null]
    .filter(Boolean).join(" · ");
}

function levelsOf(topics = []) {
  const byNumber = new Map();
  for (const t of topics) {
    const n = Number(t.task_number || String(t.title || "").match(/\d+/)?.[0] || 0);
    if (n > 0) byNumber.set(n, Number(t.knowledge_level) || 0);
  }
  return Array.from({ length: 27 }, (_, i) => byNumber.get(i + 1) || 0);
}

function nextLessonFor(studentId, calendar = []) {
  const now = new Date();
  return calendar
    .filter((l) => Number(l.student_id) === Number(studentId))
    .filter((l) => !dict.isCancelledLesson(l.status) && fmt.toDate(l.starts_at) >= now)
    .sort((a, b) => fmt.toDate(a.starts_at) - fmt.toDate(b.starts_at))[0] || null;
}

export function adaptStudents(admin) {
  const topics = admin.topics_by_student || {};
  return (admin.students || []).map((s) => {
    const balance = balanceOf(s);
    const next = nextLessonFor(s.id, admin.calendar);
    return {
      id: s.id,
      name: s.name || s.full_name,
      meta: studentMeta(s),
      balance: balance.text,
      balanceTone: balance.tone,
      next: next ? fmt.relativeDay(next.starts_at) : "",
      notch: notchOf(balance.tone === "debt"
        ? dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)
        : dict.paymentStatus(dict.PAYMENT_STATUS.CONFIRMED)),
      levels: levelsOf(topics[s.id] || topics[String(s.id)]),
    };
  });
}

export function studentChips(admin) {
  const students = admin.students || [];
  const plan = admin.plan_by_student || {};
  const debt = students.filter((s) => Number(s.debt_amount || 0) > 0).length;
  const noPlan = students.filter((s) => !(plan[s.id] || plan[String(s.id)] || []).length).length;
  return [
    { value: "all", label: "Все", count: students.length },
    { value: "active", label: "Активные", count: students.filter((s) => s.status !== "архив").length },
    { value: "debt", label: "Есть долг", count: debt },
    { value: "noplan", label: "Без плана", count: noPlan },
  ];
}

export function filterStudents(rows, admin, { chip = "all", query = "", prep = "", sort = "next" } = {}) {
  const source = admin.students || [];
  const byId = new Map(source.map((s) => [s.id, s]));
  const plan = admin.plan_by_student || {};
  let out = rows.filter((r) => {
    const s = byId.get(r.id) || {};
    if (query && !`${r.name} ${r.meta}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (prep && (s.preparationType || s.prep_type) !== prep) return false;
    if (chip === "debt") return Number(s.debt_amount || 0) > 0;
    if (chip === "noplan") return !(plan[s.id] || plan[String(s.id)] || []).length;
    if (chip === "active") return s.status !== "архив";
    return true;
  });
  if (sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (sort === "price") {
    out = [...out].sort((a, b) => Number(byId.get(b.id)?.hourlyRate || 0) - Number(byId.get(a.id)?.hourlyRate || 0));
  }
  return out;
}

/* --- занятия -------------------------------------------------------------- */

export function adaptLessonDays(lessons = [], { withTotals = true } = {}) {
  return groupByDay(lessons, (l) => l.starts_at).map((day) => ({
    title: fmt.dayTitle(day.date),
    total: withTotals ? fmt.money(day.items.reduce((sum, l) => sum + lessonPrice(l), 0)) : "",
    items: day.items.map((l) => ({
      id: l.id,
      time: fmt.time(l.starts_at),
      duration: fmt.minutes(l.duration_minutes),
      topic: l.topic || l.student_name || "Занятие",
      name: l.student_name || "Занятие",
      meta: l.topic || "",
      price: fmt.money(lessonPrice(l)),
      lessonStatus: dict.lessonStatus(l.status),
      paymentStatus: dict.paymentStatus(l.payment_status),
    })),
  }));
}

/* --- домашние задания ----------------------------------------------------- */

const isOverdue = (h) => {
  const d = fmt.toDate(h.deadline);
  return Boolean(d) && d < new Date() && h.status !== dict.HOMEWORK_STATUS.DONE;
};

export function adaptHomeworks(list = [], { withStudent = true } = {}) {
  return list.map((h) => ({
    id: h.id,
    title: h.title || "Домашнее задание",
    meta: [withStudent ? h.student_name : null, h.deadline ? `до ${fmt.dayMonth(h.deadline)}` : null]
      .filter(Boolean).join(" · "),
    notch: notchOf(isOverdue(h)
      ? dict.homeworkStatus(dict.HOMEWORK_STATUS.OVERDUE)
      : dict.homeworkStatus(h.status)),
    files: h.attachments?.length ? `${h.attachments.length} файл.` : "",
    link: h.links?.[0] || "",
    _raw: h,
  }));
}

export function filterHomeworks(rows, filter) {
  // Архив приходит с сервера отдельным списком, поэтому здесь его не
  // фильтруем — экран подставляет нужный источник.
  if (filter === "archive") return rows;
  if (filter === "work") return rows.filter((r) => r._raw.status === dict.HOMEWORK_STATUS.WAITING || r._raw.status === dict.HOMEWORK_STATUS.ASSIGNED);
  if (filter === "done") return rows.filter((r) => r._raw.status === dict.HOMEWORK_STATUS.DONE);
  if (filter === "overdue") return rows.filter((r) => isOverdue(r._raw));
  return rows;
}

/* --- финансы -------------------------------------------------------------- */

export function adaptFinances(admin, { operationFilter = "" } = {}) {
  const f = admin.finances || {};
  const operations = operationFilter
    ? (f.payments || []).filter((p) => (p.payment_label || p.status) === operationFilter)
    : (f.payments || []);
  const debt = Number(f.debt_amount || 0);
  const done = dict.lessonStatus(dict.LESSON_STATUS.CONDUCTED);
  const wait = dict.paymentStatus(dict.PAYMENT_STATUS.STUDENT_MARKED);
  const unpaid = dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID);

  const incomeDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const sum = (f.income_events || f.payments || [])
      .filter((p) => {
        const when = fmt.toDate(p.confirmed_at || p.created_at);
        return when && fmt.daysBetween(when, d) === 0;
      })
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    return { label: fmt.weekdayShort(d), value: sum };
  });

  return {
    kpi: [
      { label: "Сегодня", value: fmt.money(f.today_income || 0), notch: notchOf(done) },
      { label: "Неделя", value: fmt.money(f.week_income || 0), notch: notchOf(done) },
      { label: "Месяц", value: fmt.money(f.month_income || 0), notch: notchOf(done) },
      { label: "Ожидается сегодня", value: fmt.money(f.expected_today_income ?? f.expected_income ?? 0), notch: notchOf(wait) },
      { label: "Ожидается неделя", value: fmt.money(f.expected_week_income ?? f.expected_income ?? 0), notch: notchOf(wait) },
      // Плитка долга при нуле теряет засечку и уходит в приглушённый текст.
      debt > 0
        ? { label: "Долги", value: fmt.money(debt), notch: notchOf(unpaid), tone: "debt" }
        : { label: "Долги", value: fmt.money(0), notch: null },
    ],
    income: incomeDays,
    incomeTotal: fmt.money(incomeDays.reduce((s, d) => s + d.value, 0)),
    advances: (f.advances || []).map((a) => ({
      id: a.payment_id,
      name: a.student_name || "Ученик",
      meta: `Внесён ${fmt.dayMonth(a.confirmed_at || a.created_at)} · ${fmt.hours(a.lessons_count || 0)} · ${fmt.money(a.amount || 0)}`,
      meta2: a.lesson_covered_amount
        ? `Списано: ${fmt.money(a.lesson_covered_amount)}${a.debt_covered_amount ? ` · долг: ${fmt.money(a.debt_covered_amount)}` : ""}`
        : "Не списывались",
      left: `${fmt.hours(a.remaining_lessons || 0)} осталось`,
      notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.CONFIRMED)),
    })),
    operationsCount: operations.length,
    operationDays: groupByDay(operations, (p) => p.confirmed_at || p.created_at).map((day) => ({
      title: fmt.dayTitle(day.date),
      total: fmt.money(day.items.reduce((s, p) => s + Number(p.amount || 0), 0)),
      items: day.items.map((p) => ({
        name: p.student_name || "Оплата",
        meta: `${p.label || "оплата"} · ${fmt.dayMonth(p.confirmed_at || p.created_at)} · ${fmt.money(p.amount || 0)}`,
        notch: notchOf(dict.paymentStatus(p.payment_label || dict.PAYMENT_STATUS.CONFIRMED)),
        tail: p.status || "",
      })),
    })),
    toCheck: (f.pending || []).map((p) => ({
      id: p.id,
      name: p.student_name || "Оплата",
      meta: `${fmt.money(p.amount || p.price || 0)} · ${p.payment_label || p.status || ""}`,
      notch: notchOf(dict.paymentStatus(p.payment_label || dict.PAYMENT_STATUS.STUDENT_MARKED)),
    })),
    unpaid: (f.unpaid_lessons || []).map((l) => ({
      id: l.id,
      name: `${l.student_name || "Занятие"} · ${fmt.dayMonth(l.starts_at)}`,
      meta: `${fmt.money(lessonPrice(l))} · ${dict.paymentStatus(l.payment_status).label}`,
      notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)),
      tail: "",
    })),
  };
}

/* --- обзор репетитора ------------------------------------------------------ */

export function adaptOverview(admin) {
  const s = admin.summary || {};
  const today = (admin.calendar || []).filter((l) => fmt.daysBetween(l.starts_at) === 0);
  const conducted = today.filter((l) => l.status === dict.LESSON_STATUS.CONDUCTED).length;
  const next = s.next_lesson || null;
  return {
    todayCount: today.length,
    conducted,
    expected: fmt.money(s.expected_today_income ?? s.expected_income ?? 0),
    next: next
      ? {
          when: fmt.time(next.starts_at),
          name: next.student_name || "Занятие",
          meta: fmt.minutes(next.duration_minutes),
          notch: notchOf(dict.lessonStatus(next.status)),
        }
      : null,
    stats: [
      { label: "Ожидается оплата", value: fmt.money(s.expected_today_income ?? 0), notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.STUDENT_MARKED)) },
      { label: "Домашки на проверку", value: String((admin.homeworks || []).filter((h) => h.status !== dict.HOMEWORK_STATUS.DONE && h.status !== dict.HOMEWORK_STATUS.CANCELLED).length), notch: notchOf(dict.homeworkStatus(dict.HOMEWORK_STATUS.WAITING)) },
      Number(s.debt_amount || 0) > 0
        ? { label: "Долги", value: fmt.money(s.debt_amount), notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)), tone: "debt" }
        : { label: "Долги", value: fmt.money(0), notch: null },
      { label: "Уроков за неделю", value: String(s.week_lessons || 0), notch: notchOf(dict.lessonStatus(dict.LESSON_STATUS.PLANNED)) },
    ],
    todayLessons: adaptLessonDays(today, { withTotals: false })[0]?.items || [],
    pending: (admin.pending_lessons || []).length,
  };
}

/* --- календарь ------------------------------------------------------------- */

export function adaptCalendar(admin, { mode = "week", archive = false } = {}) {
  const source = archive ? (admin.calendar_archive || []) : (admin.calendar || []);
  const lessons = source.filter((l) => {
    const diff = fmt.daysBetween(l.starts_at);
    if (mode === "day") return diff === 0;
    if (mode === "week") return diff >= 0 && diff < 7;
    return true;
  });
  const active = lessons.filter((l) => !dict.isCancelledLesson(l.status));
  return {
    period: archive ? "Архив занятий" : fmt.dayTitle(new Date()),
    summary: [
      { value: String(active.length), label: "Уроков" },
      { value: fmt.money(active.reduce((s, l) => s + lessonPrice(l), 0)), label: "К получению" },
      { value: String(active.filter((l) => l.status === dict.LESSON_STATUS.CONDUCTED).length), label: "Проведено" },
      { value: String(active.filter((l) => l.payment_status === dict.PAYMENT_STATUS.CONFIRMED).length), label: "Оплачено" },
    ],
    days: adaptLessonDays(lessons),
    closedSlots: (archive ? admin.closed_slots_archive : admin.closed_slots) || [],
  };
}

/* --- карточка ученика ------------------------------------------------------ */

export function adaptStudentCard(admin, studentId) {
  const s = (admin.students || []).find((x) => Number(x.id) === Number(studentId));
  if (!s) return null;
  const topics = (admin.topics_by_student || {})[s.id] || (admin.topics_by_student || {})[String(s.id)] || [];
  const plan = (admin.plan_by_student || {})[s.id] || (admin.plan_by_student || {})[String(s.id)] || [];
  const lessons = [...(admin.calendar || []), ...(admin.calendar_archive || [])]
    .filter((l) => Number(l.student_id) === Number(s.id));
  const next = nextLessonFor(s.id, admin.calendar);
  const stats = s.stats || {};
  const debt = Number(s.debt_amount || 0);

  return {
    student: {
      id: s.id,
      name: s.name || s.full_name,
      initials: fmt.initials(s.name || s.full_name),
      facts: [s.grade ? `${s.grade} класс` : "класс не указан", s.subject || "предмет", s.preparationType || s.prep_type || "подготовка"],
      goal: s.goal ? `Цель: ${s.goal}` : "",
      nextWhen: next ? `${fmt.relativeDay(next.starts_at)} · ${fmt.time(next.starts_at)}` : "нет занятий",
      nextMeta: next ? `${s.subject || ""} · ${fmt.minutes(next.duration_minutes)}`.trim() : "",
      nextPrice: next ? fmt.money(lessonPrice(next)) : "",
      nextNotch: next ? notchOf(dict.lessonStatus(next.status)) : null,
      progressPercent: fmt.percent(s.progress_current, s.progress_goal) ?? 0,
      progressGoal: s.progress_goal || 0,
      conducted: String(stats.conducted ?? 0),
      cancelled: String(stats.cancelled ?? 0),
      mockValue: s.mock_tasks_solved ? `${s.mock_tasks_solved}/${s.mock_tasks_total || 27}` : "—",
      mockLabel: s.mock_score ? `Пробник · ${s.mock_score} б` : "Пробник",
      levels: levelsOf(topics),
      levelsGoal: 27,
    },
    taskNotes: topics
      .filter((t) => String(t.comment || "").trim())
      .map((t) => {
        const level = Number(t.knowledge_level) || 0;
        return {
          number: `№${t.task_number || ""}`,
          percent: `${level * 10} %`,
          label: level <= 5 ? "нужно повторить" : level >= 8 ? "уверенно" : "закрепить",
          text: t.comment,
          notch: notchOf({ tone: dict.levelTone(level), mark: dict.NOTCH.SOLID }),
        };
      }),
    lessonsCount: lessons.length,
    lessonDays: adaptLessonDays(lessons.slice(-24)),
    homeworks: adaptHomeworks((admin.homeworks || []).filter((h) => Number(h.student_id) === Number(s.id)), { withStudent: false }),
    finance: {
      paidShare: Number(s.balance_lessons || 0),
      waitingShare: 0,
      debtShare: debt > 0 ? 1 : 0,
      paidHours: fmt.hours(s.balance_lessons || 0),
      debt: debt > 0 ? fmt.money(debt) : fmt.money(0),
      debtTone: debt > 0 ? "debt" : "none",
    },
    paymentDays: [],
    unpaid: ((admin.finances || {}).unpaid_lessons || [])
      .filter((l) => Number(l.student_id) === Number(s.id))
      .map((l) => ({
        name: `Занятие ${fmt.dayMonth(l.starts_at)}`,
        meta: `${fmt.money(lessonPrice(l))} · ${dict.paymentStatus(l.payment_status).label}`,
        notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)),
      })),
    notes: String(s.comment || "").trim()
      ? [{ title: "Комментарий", text: s.comment, date: "", notch: { tone: "none", mark: dict.NOTCH.NONE } }]
      : [],
    plan: plan.map((p) => ({
      id: p.id,
      title: p.title,
      meta: p.deadline ? `до ${fmt.dayMonth(p.deadline)}` : "без дедлайна",
      status: dict.planStatus(p.status).label,
      done: p.status === dict.PLAN_STATUS.DONE,
      notch: notchOf(dict.planStatus(p.status)),
    })),
    links: [
      { label: "Доска", value: s.board_url || "" },
      { label: "Звонок", value: s.meeting_url || "" },
      { label: "Telegram", value: s.student_telegram || "" },
    ],
  };
}

/* --- кабинет клиента -------------------------------------------------------- */

export function adaptClient(payload) {
  const b = payload.dashboard || {};
  const s = b.student || {};
  const sum = b.summary || {};
  const f = b.finances || {};
  const debt = Number(f.debt_amount || sum.debt_amount || 0);
  const lessons = b.lessons || [];

  return {
    role: payload.role,
    canEdit: payload.role === "student" || Boolean(s.parentCanEdit),
    student: {
      id: s.id,
      eyebrow: [s.preparationType, s.subject].filter(Boolean).join(" · ").toLowerCase(),
      name: s.name || "",
      goal: s.goal ? `Цель: ${s.goal}` : "",
      next: sum.next_lesson ? `${fmt.relativeDay(sum.next_lesson.starts_at)} · ${fmt.time(sum.next_lesson.starts_at)}` : "нет занятий",
    },
    metrics: [
      { label: "Домашки", value: String(sum.open_homework ?? 0), notch: notchOf(dict.homeworkStatus(dict.HOMEWORK_STATUS.WAITING)) },
      debt > 0
        ? { label: "Оплаты", value: fmt.money(debt), notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)), tone: "debt" }
        : { label: "Оплаты", value: fmt.money(0), notch: null },
      { label: "Прогресс", value: sum.progress_percent == null ? "—" : `${sum.progress_percent} %`, notch: notchOf(dict.lessonStatus(dict.LESSON_STATUS.CONDUCTED)) },
      { label: "Занятия", value: String(lessons.length), notch: notchOf(dict.lessonStatus(dict.LESSON_STATUS.PLANNED)) },
    ],
    levels: levelsOf(b.topics),
    progressCurrent: s.progress_current || 0,
    progressGoal: s.progress_goal || 0,
    calendarDays: adaptLessonDays(lessons, { withTotals: false }).map((day) => ({
      title: day.title,
      items: day.items.map((l) => ({ ...l, name: l.name, actions: [] })),
    })),
    calendarSummary: [
      { value: String(lessons.length), label: "Уроков" },
      { value: String(lessons.filter((l) => l.status === dict.LESSON_STATUS.CONDUCTED).length), label: "Проведено" },
      { value: String(lessons.filter((l) => l.payment_status === dict.PAYMENT_STATUS.CONFIRMED).length), label: "Оплачено" },
      { value: String((f.unpaid_lessons || []).length), label: "Ждут", tone: (f.unpaid_lessons || []).length ? "debt" : "none" },
    ],
    homeworks: adaptHomeworks(b.homeworks || [], { withStudent: false }),
    homeworksArchive: adaptHomeworks(b.homeworks_archive || [], { withStudent: false }),
    taskNotes: (b.topics || [])
      .filter((t) => String(t.comment || "").trim())
      .map((t) => {
        const level = Number(t.knowledge_level) || 0;
        return {
          number: `№${t.task_number || ""}`,
          percent: `${level * 10} %`,
          label: level <= 5 ? "нужно повторить" : level >= 8 ? "уверенно" : "закрепить",
          text: t.comment,
          notch: notchOf({ tone: dict.levelTone(level), mark: dict.NOTCH.SOLID }),
        };
      }),
    plan: (b.plan || []).map((p) => ({
      id: p.id,
      title: p.title,
      meta: p.deadline ? `до ${fmt.dayMonth(p.deadline)}` : "без дедлайна",
      status: dict.planStatus(p.status).label,
      done: p.status === dict.PLAN_STATUS.DONE,
      notch: notchOf(dict.planStatus(p.status)),
    })),
    rate: s.hourlyRate ? `${fmt.money(s.hourlyRate)} / час` : "",
    debt: debt > 0
      ? {
          amount: fmt.money(debt),
          meta: `${(f.unpaid_lessons || []).length} занятие не оплачено`,
          notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)),
        }
      : null,
    paymentDays: groupByDay(f.payments || b.payments || [], (p) => p.confirmed_at || p.created_at).map((day) => ({
      title: fmt.dayTitle(day.date),
      total: fmt.money(day.items.reduce((acc, p) => acc + Number(p.amount || 0), 0)),
      items: day.items.map((p) => ({
        name: p.label || "Оплата",
        meta: fmt.money(p.amount || 0),
        notch: notchOf(dict.paymentStatus(p.payment_label || dict.PAYMENT_STATUS.CONFIRMED)),
        status: dict.paymentStatus(p.payment_label || dict.PAYMENT_STATUS.CONFIRMED),
      })),
    })),
    unpaid: (f.unpaid_lessons || []).map((l) => ({
      id: l.id,
      name: `Занятие ${fmt.dayMonth(l.starts_at)}`,
      meta: `${fmt.money(lessonPrice(l))} · ${dict.paymentStatus(l.payment_status).label}`,
      notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)),
    })),
    facts: [
      { label: "Класс", value: s.grade || "не указан" },
      { label: "Часовой пояс", value: s.timezoneLabel || "МСК+0" },
      { label: "Стоимость", value: s.hourlyRate ? `${fmt.money(s.hourlyRate)}/час` : "не указана" },
      { label: "Подготовка", value: [s.preparationType, s.subject].filter(Boolean).join(" · ") || "не указана" },
      { label: "Цель", value: s.goal || "не указана" },
      { label: "Оплачено часов", value: fmt.hours(s.balance_lessons || 0) },
      { label: "Права родителя", value: s.parentCanEdit ? "может редактировать календарь" : "только просмотр и оплата" },
    ],
    links: [
      { label: "Доска", value: s.links?.board || "" },
      { label: "Телемост", value: s.links?.meeting || "" },
      { label: "Telegram", value: s.contacts || "" },
    ],
  };
}
