/* Рабочие формы: каждая собирает payload по схеме сервера и отправляет его
 * через core/api.js.
 *
 * Формы не знают про экраны: открывает их openForm, а после успеха
 * вызывается переданный onDone, который перезагружает payload.
 */

import { el } from "../ui/dom.js";
import { Modal } from "../ui/modal.js";
import { Field, Select } from "../ui/field.js";
import { Button } from "../ui/button.js";
import { createForm, FormActions } from "../ui/form.js";
import { DurationPicker, FreeSlots } from "../ui/pickers.js";
import * as api from "../core/api.js";
import * as dict from "../core/dict.js";
import * as fmt from "../core/format.js";

const WEEKDAY_OPTIONS = [
  { value: "1", label: "Понедельник" }, { value: "2", label: "Вторник" }, { value: "3", label: "Среда" },
  { value: "4", label: "Четверг" }, { value: "5", label: "Пятница" }, { value: "6", label: "Суббота" },
  { value: "7", label: "Воскресенье" },
];

const TZ = ["МСК-1", "МСК+0", "МСК+1", "МСК+2", "МСК+3", "МСК+4", "МСК+5", "МСК+6", "МСК+7", "МСК+8"];

const group = (title, fields) =>
  el("fieldset", { class: "form-group" }, [
    title ? el("legend", { class: "form-group__title", text: title }) : null,
    ...fields.filter(Boolean),
  ]);

/** datetime-local ждёт «YYYY-MM-DDTHH:MM». */
function toLocalInput(value) {
  const d = fmt.toDate(value);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const todayInput = () => toLocalInput(new Date()).slice(0, 10);

function studentOptions(students = []) {
  return students.map((s) => ({ value: String(s.id), label: s.name || s.full_name }));
}

/* ========================================================================= */
/* Определения форм                                                          */
/* ========================================================================= */

const FORMS = {
  /* --- занятия ---------------------------------------------------------- */

  lesson: ({ ctx, lesson }) => {
    const isEdit = Boolean(lesson);
    const form = createForm({
      student_id: String(lesson?.student_id || ctx.selectedStudentId || ctx.students[0]?.id || ""),
      starts_at: toLocalInput(lesson?.starts_at) || toLocalInput(new Date()),
      duration_minutes: lesson?.duration_minutes || 60,
      status: lesson?.status || dict.LESSON_STATUS.PLANNED,
      payment_status: lesson?.payment_status || dict.PAYMENT_STATUS.NOT_MARKED,
      payment_amount: lesson?.price || "",
      notes: lesson?.notes || "",
    });
    const durationHost = el("div", {});
    const renderDuration = () => durationHost.replaceChildren(DurationPicker({
      value: form.get("duration_minutes"),
      allowCustom: false,
      onSelect: (v) => { form.set("duration_minutes", v); renderDuration(); },
    }));
    renderDuration();

    return {
      title: isEdit ? "Редактировать занятие" : "Новое занятие",
      submitLabel: "Готово",
      body: [
        group("Информация об уроке", [
          isEdit ? null : Select({ label: "Ученик", options: studentOptions(ctx.students), ...form.bind("student_id") }),
          Field({ label: "Дата и время", type: "datetime-local", ...form.bind("starts_at") }),
          durationHost,
        ]),
        group("Статусы", [
          Select({ label: "Статус занятия", options: dict.lessonStatusOptions().map((s) => ({ value: s.value, label: s.label })), ...form.bind("status") }),
          Select({ label: "Статус оплаты", options: dict.paymentStatusOptions().map((s) => ({ value: s.value, label: s.label })), ...form.bind("payment_status") }),
        ]),
        group("Финансы", [
          Field({ label: "Стоимость", type: "number", ...form.bind("payment_amount") }),
          Field({ label: "Заметки", ...form.bind("notes") }),
        ]),
      ],
      submit: () => {
        const p = form.payload();
        if (isEdit) {
          return api.updateLesson(lesson.id, {
            starts_at: p.starts_at, duration_minutes: Number(p.duration_minutes),
            status: p.status, payment_status: p.payment_status,
            payment_amount: p.payment_amount === undefined ? undefined : Number(p.payment_amount),
            notes: p.notes ?? "",
          });
        }
        return api.createLesson({
          student_id: Number(p.student_id),
          starts_at: p.starts_at,
          duration_minutes: Number(p.duration_minutes),
          status: p.status,
          payment_status: p.payment_status,
          notes: p.notes ?? "",
        });
      },
    };
  },

  lessonMove: ({ lesson }) => {
    const form = createForm({
      starts_at: toLocalInput(lesson.starts_at),
      duration_minutes: lesson.duration_minutes || 60,
    });
    return {
      title: "Перенести занятие",
      submitLabel: "Отправить перенос",
      note: "После отправки преподаватель подтвердит перенос или отклонит заявку.",
      body: [group("", [
        Field({ label: "Новое время", type: "datetime-local", ...form.bind("starts_at") }),
        Field({ label: "Длительность, мин", type: "number", ...form.bind("duration_minutes") }),
      ])],
      submit: () => api.moveOwnLesson(lesson.id, {
        starts_at: form.get("starts_at"),
        duration_minutes: Number(form.get("duration_minutes")),
      }),
    };
  },

  /* --- ученики ---------------------------------------------------------- */

  student: ({ student }) => {
    const isEdit = Boolean(student);
    const form = createForm({
      full_name: student?.name || student?.full_name || "",
      grade: student?.grade || "",
      timezone: student?.timezoneLabel || "МСК+0",
      prep_type: student?.preparationType || student?.prep_type || "ЕГЭ",
      subject: student?.subject || "Информатика",
      goal: student?.goal || "",
      lesson_price: student?.hourlyRate || student?.lesson_price || "",
      price_90: student?.price_90 || "",
      price_120: student?.price_120 || "",
      student_telegram: student?.student_telegram || "",
      parent_name: student?.parent_name || "",
      parent_telegram: student?.parent_telegram || "",
      board_url: student?.board_url || "",
      meeting_url: student?.meeting_url || "",
      comment: student?.comment || "",
    });
    return {
      title: isEdit ? "Редактирование ученика" : "Новый ученик",
      submitLabel: isEdit ? "Сохранить" : "Добавить ученика",
      body: [
        group("Основное", [
          Field({ label: "Имя", ...form.bind("full_name") }),
          Field({ label: "Класс", ...form.bind("grade") }),
          Select({ label: "Часовой пояс", options: TZ, ...form.bind("timezone") }),
        ]),
        group("Стоимость", [
          Field({ label: "Стоимость за 1 час", type: "number", ...form.bind("lesson_price") }),
          Field({ label: "Цена 1.5 часа", type: "number", ...form.bind("price_90") }),
          Field({ label: "Цена 2 часа", type: "number", ...form.bind("price_120") }),
        ]),
        group("Подготовка", [
          Select({ label: "Вид подготовки", options: dict.PREP_TYPES, ...form.bind("prep_type") }),
          Select({ label: "Предмет", options: dict.SUBJECTS, ...form.bind("subject") }),
          Field({ label: "Цель", ...form.bind("goal") }),
        ]),
        group("Контакты и ссылки", [
          Field({ label: "Контакт ученика", ...form.bind("student_telegram") }),
          Field({ label: "Имя родителя", ...form.bind("parent_name") }),
          Field({ label: "Контакт родителя", ...form.bind("parent_telegram") }),
          Field({ label: "Ссылка на доску", ...form.bind("board_url") }),
          Field({ label: "Ссылка на звонок", ...form.bind("meeting_url") }),
          Field({ label: "Комментарии", ...form.bind("comment") }),
        ]),
      ],
      submit: () => {
        const p = form.payload();
        for (const key of ["lesson_price", "price_90", "price_120"]) {
          if (p[key] !== undefined) p[key] = Number(p[key]);
        }
        if (p.lesson_price !== undefined) p.price_60 = p.lesson_price;
        return isEdit ? api.updateStudent(student.id, p) : api.createStudent(p);
      },
    };
  },

  /* --- домашние задания -------------------------------------------------- */

  homework: ({ ctx, homework }) => {
    const isEdit = Boolean(homework);
    const form = createForm({
      student_id: String(homework?.student_id || ctx.selectedStudentId || ctx.students[0]?.id || ""),
      title: homework?.title || "",
      text: homework?.text || homework?.description || "",
      links: (homework?.links || []).join(", "),
      deadline: toLocalInput(homework?.deadline) || toLocalInput(new Date()),
      status: homework?.status || dict.HOMEWORK_STATUS.WAITING,
      teacher_comment: homework?.teacher_comment || "",
    });
    return {
      title: isEdit ? "Редактировать домашку" : "Новая домашка",
      submitLabel: "Готово",
      body: [
        group("Основное", [
          isEdit ? null : Select({ label: "Ученик", options: studentOptions(ctx.students), ...form.bind("student_id") }),
          Field({ label: "Название", ...form.bind("title") }),
          Field({ label: "Описание", ...form.bind("text") }),
        ]),
        group("Материалы", [Field({ label: "Ссылки через запятую", ...form.bind("links") })]),
        group("Сроки", [Field({ label: "Дедлайн", type: "datetime-local", ...form.bind("deadline") })]),
        group("Статус", [
          Select({ label: "Статус", options: dict.homeworkStatusOptions().map((s) => ({ value: s.value, label: s.label })), ...form.bind("status") }),
          Field({ label: "Комментарий преподавателя", ...form.bind("teacher_comment") }),
        ]),
      ],
      submit: () => {
        const p = form.payload();
        const links = String(p.links || "").split(",").map((s) => s.trim()).filter(Boolean);
        const body = {
          title: p.title || "", text: p.text || "", links,
          deadline: p.deadline, status: p.status, teacher_comment: p.teacher_comment || "",
        };
        return isEdit ? api.updateHomework(homework.id, body) : api.createHomework({ ...body, student_id: Number(p.student_id) });
      },
    };
  },

  homeworkSubmit: ({ homework }) => {
    const form = createForm({ text: "" });
    return {
      title: "Сдать домашку",
      submitLabel: "Отправить решение",
      note: homework.deadline ? `Дедлайн: ${fmt.dateLong(homework.deadline)}` : "",
      body: [group("", [Field({ label: "Решение или ссылка", ...form.bind("text") })])],
      submit: () => api.submitHomework(homework.id, { text: form.get("text") }),
    };
  },

  /* --- расписание -------------------------------------------------------- */

  scheduleRule: ({ ctx }) => {
    const form = createForm({
      student_id: String(ctx.selectedStudentId || ctx.students[0]?.id || ""),
      duration_minutes: 60,
      starts_at: todayInput(),
      ends_at: "",
    });
    // Сервер принимает список пар «день + время» в slots, поэтому за один
    // проход можно завести хоть всю неделю.
    const slots = [{ weekday: "1", lesson_time: "18:00" }];
    const slotsHost = el("div", { class: "slot-rows" });

    const renderSlots = () => {
      slotsHost.replaceChildren(...slots.map((slot, i) =>
        el("div", { class: "slot-row" }, [
          Select({
            label: i === 0 ? "День недели" : "",
            options: WEEKDAY_OPTIONS,
            value: slot.weekday,
            onChange: (v) => { slot.weekday = v; },
          }),
          Field({
            label: i === 0 ? "Время" : "",
            type: "time",
            value: slot.lesson_time,
            state: "filled",
            onInput: (v) => { slot.lesson_time = v; },
          }),
          slots.length > 1
            ? el("button", {
                type: "button", class: "slot-row__remove", "aria-label": "Убрать день",
                text: "✕", onClick: () => { slots.splice(i, 1); renderSlots(); },
              })
            : el("span", {}),
        ])));
    };
    renderSlots();

    return {
      title: "Стабильное расписание",
      submitLabel: "Добавить стабильное расписание",
      body: [
        group("Дни и время", [
          Select({ label: "Ученик", options: studentOptions(ctx.students), ...form.bind("student_id") }),
          slotsHost,
          Button({
            kind: "second", label: "Добавить день и время", full: true,
            onClick: () => { slots.push({ weekday: "1", lesson_time: "18:00" }); renderSlots(); },
          }),
          Field({ label: "Длительность, мин", type: "number", ...form.bind("duration_minutes") }),
        ]),
        group("Период", [
          Field({ label: "Начать с", type: "date", ...form.bind("starts_at") }),
          Field({ label: "Создать до", type: "date", ...form.bind("ends_at") }),
        ]),
      ],
      submit: () => api.createScheduleRule({
        student_id: Number(form.get("student_id")),
        slots: slots.map((x) => ({ weekday: Number(x.weekday), lesson_time: x.lesson_time })),
        duration_minutes: Number(form.get("duration_minutes")),
        starts_at: form.get("starts_at") || undefined,
        ends_at: form.get("ends_at") || undefined,
      }),
    };
  },

  /* Очистка стабильного расписания: сначала предпросмотр с числами, затем
     отмена. Занятия не удаляются, они уезжают в архив календаря. */
  scheduleCleanup: ({ studentId, studentName, onDone }) => {
    const preview = el("div", { class: "cleanup-preview" }, [
      el("p", { class: "modal-note", text: "Считаю…" }),
    ]);
    let plan = null;
    return {
      title: "Очистить стабильное расписание",
      submitLabel: "",
      async load() {
        plan = await api.previewScheduleCleanup(studentId);
        const skipped = (plan.skipped || [])
          .map((s) => el("p", { class: "modal-note", text: `Пропущено ${s.count} — ${s.reason}` }));
        const nothing = !plan.cancel_count && !plan.rules;
        preview.replaceChildren(
          el("p", { class: "modal-note", text: studentName }),
          el("p", { class: "modal-note" }, ["Правил стабильного расписания: ", el("strong", { text: String(plan.rules) })]),
          el("p", { class: "modal-note" }, ["Будет отменено занятий: ", el("strong", { text: String(plan.cancel_count) })]),
          el("p", { class: "modal-note" }, ["Будет пропущено: ", el("strong", { text: String(plan.skipped_total) })]),
          plan.first_date && plan.last_date
            ? el("p", { class: "modal-note", text: `С ${fmt.dateLong(plan.first_date)} по ${fmt.dateLong(plan.last_date)}.` })
            : null,
          ...skipped,
          el("p", { class: "modal-note", text: "Занятия не удаляются — они переедут в архив календаря." }),
          nothing
            ? el("p", { class: "modal-note", text: "Очищать нечего." })
            : Button({
                kind: "danger", full: true, label: `Очистить: отменить ${plan.cancel_count}`,
                onClick: async (event) => {
                  const btn = event.currentTarget;
                  btn.disabled = true;
                  btn.textContent = "Очищаю…";
                  try {
                    const done = await api.runScheduleCleanup(studentId);
                    preview.replaceChildren(
                      el("p", { class: "modal-note", text: `Отменено ${done.cancel_count} занятий, удалено правил: ${done.rules}.` }),
                      el("p", { class: "modal-note", text: "Отменённые занятия доступны в календаре по кнопке «Архив»." }),
                    );
                    await onDone?.();
                  } catch (e) {
                    btn.disabled = false;
                    btn.textContent = `Очистить: отменить ${plan.cancel_count}`;
                    preview.append(el("p", { class: "modal-note form-error", text: e?.detail || "Не удалось очистить" }));
                  }
                },
              }),
        );
      },
      body: [preview],
    };
  },

  closedSlot: () => {
    const form = createForm({
      starts_at: toLocalInput(new Date()),
      ends_at: toLocalInput(new Date(Date.now() + 3600000)),
      reason: "",
    });
    return {
      title: "Нерабочие часы",
      submitLabel: "Закрыть время",
      body: [group("", [
        Field({ label: "Начало", type: "datetime-local", ...form.bind("starts_at") }),
        Field({ label: "Конец", type: "datetime-local", ...form.bind("ends_at") }),
        Field({ label: "Причина", ...form.bind("reason") }),
      ])],
      submit: () => api.createClosedSlot({
        starts_at: form.get("starts_at"), ends_at: form.get("ends_at"), reason: form.get("reason") || "",
      }),
    };
  },

  /* --- деньги ------------------------------------------------------------ */

  payment: ({ ctx }) => {
    const form = createForm({
      student_id: String(ctx.selectedStudentId || ctx.students[0]?.id || ""),
      amount: "", lessons_count: "", comment: "",
    });
    const hint = el("p", { class: "modal-note" });
    const syncHint = () => {
      const s = ctx.students.find((x) => String(x.id) === String(form.get("student_id")));
      const rate = Number(s?.hourlyRate || 0);
      const amount = Number(form.get("amount") || 0);
      hint.textContent = rate
        ? `Считаю автоматически: ${fmt.money(rate)} за час${amount ? ` · ${fmt.hours(amount / rate)}` : ""}`
        : "У ученика не указана цена часа — укажите количество часов вручную.";
    };
    syncHint();
    const amountField = Field({
      label: "Сумма", type: "number",
      ...form.bind("amount"),
      onInput: (v) => { form.set("amount", v); syncHint(); },
    });
    return {
      title: "Добавить оплату",
      submitLabel: "Добавить оплату",
      body: [group("", [
        Select({
          label: "Ученик", options: studentOptions(ctx.students),
          value: form.get("student_id"),
          onChange: (v) => { form.set("student_id", v); syncHint(); },
        }),
        amountField,
        hint,
        Field({ label: "Оплачено часов (необязательно)", type: "number", step: "0.25", ...form.bind("lessons_count") }),
        Field({ label: "Комментарий", ...form.bind("comment") }),
      ])],
      submit: () => {
        const s = ctx.students.find((x) => String(x.id) === String(form.get("student_id")));
        const rate = Number(s?.hourlyRate || 0);
        const amount = Number(form.get("amount") || 0);
        const manual = form.get("lessons_count");
        return api.createPayment({
          student_id: Number(form.get("student_id")),
          amount,
          lessons_count: manual ? Number(manual) : (rate ? Math.round(amount / rate * 4) / 4 : 0),
          comment: form.get("comment") || "",
        });
      },
    };
  },

  advance: ({ advance }) => {
    const form = createForm({
      remaining_lessons: advance.remaining_lessons ?? "",
      lessons_count: advance.lessons_count ?? "",
      amount: advance.amount ?? "",
    });
    return {
      title: "Редактировать аванс",
      submitLabel: "Сохранить",
      body: [group("", [
        Field({ label: "Ученик", value: advance.student_name || "Ученик", state: "off" }),
        Field({ label: "Осталось часов", type: "number", step: "0.25", ...form.bind("remaining_lessons") }),
        Field({ label: "Внесено часов", type: "number", step: "0.25", ...form.bind("lessons_count") }),
        Field({ label: "Сумма", type: "number", ...form.bind("amount") }),
      ])],
      submit: () => api.updateAdvance(advance.payment_id ?? advance.id, {
        remaining_lessons: Number(form.get("remaining_lessons")),
        lessons_count: Number(form.get("lessons_count")),
        amount: Number(form.get("amount")),
      }),
    };
  },

  markPaid: ({ lesson, actor }) => {
    const form = createForm({});
    return {
      title: "Отметить оплату",
      submitLabel: "Отметить оплату",
      note: `Занятие ${fmt.dateLong(lesson.starts_at)} · ${fmt.money(lesson.price || 0)}. Преподаватель подтвердит оплату.`,
      body: [group("", [])],
      submit: () => api.markLessonPaid(lesson.id, { actor }),
      _form: form,
    };
  },

  /* --- прогресс и план ---------------------------------------------------- */

  progress: ({ studentId, topics = [] }) => {
    const form = createForm({ task_number: "1", knowledge_level: "0", comment: "" });
    const syncFrom = (n) => {
      const t = topics.find((x) => String(x.task_number) === String(n));
      form.set("knowledge_level", String(t?.knowledge_level ?? 0));
      form.set("comment", t?.comment || "");
    };
    syncFrom("1");
    const levelField = Field({ label: "Уровень 0–10", type: "number", ...form.bind("knowledge_level") });
    const commentField = Field({ label: "Комментарий", ...form.bind("comment") });
    return {
      title: "Изменить прогресс",
      submitLabel: "Готово",
      body: [group("", [
        Select({
          label: "Задание",
          options: Array.from({ length: 27 }, (_, i) => {
            const t = topics.find((x) => String(x.task_number) === String(i + 1));
            return { value: String(i + 1), label: `Задание ${i + 1} · сейчас ${t?.knowledge_level ?? 0}/10` };
          }),
          value: form.get("task_number"),
          onChange: (v) => {
            form.set("task_number", v);
            syncFrom(v);
            levelField.querySelector("input").value = form.get("knowledge_level");
            commentField.querySelector("input").value = form.get("comment");
          },
        }),
        levelField,
        commentField,
      ])],
      submit: () => api.updateProgress(studentId, {
        task_number: Number(form.get("task_number")),
        knowledge_level: Number(form.get("knowledge_level")),
        comment: form.get("comment") || "",
      }),
    };
  },

  planItem: ({ studentId, item }) => {
    const isEdit = Boolean(item);
    const form = createForm({
      title: item?.title || "",
      deadline: item?.deadline || "",
      comment: item?.comment || "",
      status: item?.status || dict.PLAN_STATUS.NOT_STARTED,
    });
    return {
      title: isEdit ? "Редактировать пункт" : "Пункт плана",
      submitLabel: isEdit ? "Сохранить" : "Добавить пункт",
      body: [group("", [
        Field({ label: "Пункт плана", ...form.bind("title") }),
        Field({ label: "Дедлайн", type: "date", ...form.bind("deadline") }),
        Field({ label: "Комментарий", ...form.bind("comment") }),
        isEdit ? Select({ label: "Статус", options: dict.planStatusOptions().map((s) => ({ value: s.value, label: s.label })), ...form.bind("status") }) : null,
      ])],
      submit: () => {
        const p = form.payload();
        return isEdit ? api.updatePlanItem(studentId, item.id, p) : api.createPlanItem(studentId, p);
      },
    };
  },

  /* --- профиль и доступ ---------------------------------------------------- */

  tutorProfile: ({ profile, subjects, prepTypes, workingDays }) => {
    const form = createForm({
      full_name: profile.full_name || "",
      experience: profile.experience || "",
      description: profile.description || "",
    });
    return {
      title: "Профиль репетитора",
      submitLabel: "Сохранить профиль",
      body: [group("", [
        Field({ label: "ФИО", ...form.bind("full_name") }),
        Field({ label: "Стаж", ...form.bind("experience") }),
        Field({ label: "Описание", ...form.bind("description") }),
      ])],
      submit: () => api.updateTutorProfile({
        ...form.payload(),
        subjects, prep_types: prepTypes, working_days: workingDays,
      }),
    };
  },

  browserInvite: ({ studentId }) => {
    const form = createForm({ role: "student", session_days: "180", invite_days: "3650" });
    const result = el("div", { class: "invite-result", hidden: true });
    return {
      title: studentId ? "Ссылка доступа" : "Ссылка кабинета",
      submitLabel: "Создать ссылку",
      keepOpen: true,
      body: [group("", [
        studentId ? Select({ label: "Кому", options: [
          { value: "student", label: "Ученику" }, { value: "parent", label: "Родителю" },
        ], ...form.bind("role") }) : null,
        Select({ label: "Вход будет работать", options: [
          { value: "180", label: "6 месяцев" }, { value: "365", label: "1 год" }, { value: "30", label: "30 дней" },
        ], ...form.bind("session_days") }),
        Select({ label: "Ссылка активна", options: [
          { value: "3650", label: "Постоянная" }, { value: "365", label: "1 год" },
          { value: "30", label: "30 дней" }, { value: "7", label: "7 дней" }, { value: "1", label: "1 день" },
        ], ...form.bind("invite_days") }),
        result,
      ])],
      submit: async () => {
        const body = {
          role: form.get("role"),
          session_days: Number(form.get("session_days")),
          invite_days: Number(form.get("invite_days")),
        };
        const data = studentId
          ? await api.createStudentBrowserInvite(studentId, body)
          : await api.createTutorBrowserInvite(body);
        const url = (data.urls && data.urls[0]) || data.url || "";
        result.replaceChildren(
          el("textarea", { class: "field__area", readOnly: true, rows: 3, value: url }),
          Button({ kind: "second", label: "Скопировать", full: true, onClick: () => navigator.clipboard?.writeText(url) }),
        );
        result.hidden = false;
      },
    };
  },

  /* --- запись ученика ------------------------------------------------------ */

  /* Заявка на занятие от ученика.
   *
   * Отдельная форма, а не форма занятия репетитора: ученик не выставляет
   * ни статус, ни стоимость — он выбирает время, а решение остаётся за
   * преподавателем. Поэтому и endpoint другой, /api/book, и занятие
   * заводится сразу как заявка.
   *
   * Свободные окна показываются здесь же, а не отдельным шагом: выбрать
   * время вслепую, а потом получить отказ по занятости — худшее, что
   * может предложить эта форма. Ручной ввод при этом оставлен: горизонт
   * окон две недели, а попросить можно и дальше.
   */
  booking: () => {
    const form = createForm({ starts_at: "", duration_minutes: 60 });

    const when = Field({ label: "Дата и время", type: "datetime-local", ...form.bind("starts_at") });
    const whenInput = when.querySelector(".field__input");
    const slotsHost = el("div", { class: "form-slots" });
    const durationHost = el("div", {});

    const pick = (value) => {
      const local = toLocalInput(value);
      form.set("starts_at", local);
      whenInput.value = local;
    };

    async function loadSlots() {
      slotsHost.replaceChildren(el("p", { class: "screen__note", text: "Ищу свободные окна…" }));
      try {
        const data = await api.getAvailableSlots({
          durationMinutes: Number(form.get("duration_minutes")), days: 14,
        });
        const byDay = new Map();
        for (const slot of data.slots || []) {
          const start = slot.starts_at || slot.start || slot;
          const d = fmt.toDate(start);
          if (!d) continue;
          const key = fmt.dayTitle(d);
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key).push({ time: fmt.time(d), value: start });
        }
        slotsHost.replaceChildren(FreeSlots({
          duration: data.duration_minutes || Number(form.get("duration_minutes")),
          days: [...byDay.entries()].map(([title, slots]) => ({ title, slots })),
          onPick: pick,
        }));
      } catch {
        // Окна — подсказка, а не единственный путь: если их не удалось
        // получить, заявку всё равно можно отправить руками.
        slotsHost.replaceChildren(el("p", {
          class: "screen__note",
          text: "Не удалось загрузить свободные окна. Время можно указать вручную.",
        }));
      }
    }

    const renderDuration = () => durationHost.replaceChildren(DurationPicker({
      value: form.get("duration_minutes"),
      allowCustom: false,
      onSelect: (v) => {
        form.set("duration_minutes", v);
        renderDuration();
        // Окна зависят от длительности: на полтора часа их всегда меньше.
        loadSlots();
      },
    }));
    renderDuration();
    loadSlots();

    return {
      title: "Записаться на занятие",
      submitLabel: "Отправить заявку",
      note: "Заявка уйдёт преподавателю: он подтвердит время или предложит другое.",
      body: [
        group("Когда", [durationHost, when]),
        group("Свободные окна на две недели", [slotsHost]),
      ],
      submit: () => {
        if (!form.get("starts_at")) {
          throw new Error("Выберите свободное окно или укажите дату и время");
        }
        return api.book({
          starts_at: form.get("starts_at"),
          duration_minutes: Number(form.get("duration_minutes")),
        });
      },
    };
  },

  /* --- свободные окна ------------------------------------------------------ */

  freeSlots: ({ onPick }) => ({
    title: "Свободные окна",
    submitLabel: "",
    async load(bodyHost) {
      const data = await api.getAvailableSlots({ durationMinutes: 60, days: 14 });
      const byDay = new Map();
      for (const slot of data.slots || []) {
        const start = slot.starts_at || slot.start || slot;
        const d = fmt.toDate(start);
        if (!d) continue;
        const key = fmt.dayTitle(d);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({ time: fmt.time(d), value: start });
      }
      bodyHost.replaceChildren(FreeSlots({
        duration: data.duration_minutes || 60,
        days: [...byDay.entries()].map(([title, slots]) => ({ title, slots })),
        onPick,
      }));
    },
    body: [],
  }),
};

/* ========================================================================= */
/* Открытие                                                                  */
/* ========================================================================= */

export function openForm(name, params = {}, { onDone } = {}) {
  const def = FORMS[name]?.({ ...params, onDone });
  if (!def) return;

  const bodyHost = el("div", { class: "form-body" }, def.body);
  const nodes = [bodyHost];
  if (def.note) nodes.push(el("p", { class: "modal-note", text: def.note }));

  const modal = Modal({ title: def.title, body: nodes });

  if (def.submitLabel) {
    modal.node.querySelector(".modal").append(
      el("div", { class: "modal__footer" }, [FormActions({
        submitLabel: def.submitLabel,
        onCancel: () => modal.close(),
        onSubmit: async () => {
          await def.submit();
          if (!def.keepOpen) modal.close();
          await onDone?.();
        },
      })]),
    );
  }

  modal.open();
  def.load?.(bodyHost).catch(() => {
    bodyHost.replaceChildren(el("p", { class: "modal-note", text: "Не удалось загрузить окна. Повторите позже." }));
  });
  return modal;
}

export const FORM_NAMES = Object.keys(FORMS);
