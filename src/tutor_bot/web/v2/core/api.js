/* Единственное место в проекте, где вызывается fetch.
 *
 * Роуты перечислены по webapp.py один в один; новых не добавляем. Каждый
 * роут — отдельный экспортируемый метод, чтобы экраны не собирали URL
 * строками и опечатка ловилась на этапе импорта.
 *
 * Авторизация: заголовок X-Telegram-Init-Data с initData от Telegram, как в
 * текущем мини-аппе. На localhost допускается X-Dev-Telegram-Id — сервер
 * принимает его только там.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function telegramInitData() {
  return globalThis.Telegram?.WebApp?.initData || "";
}

export class ApiError extends Error {
  constructor(status, detail, payload) {
    super(detail || `Ошибка ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.payload = payload;
  }
}

/** Заголовок для dev-входа. Задаётся только вручную при локальной отладке. */
let devTelegramId = "";
export function setDevTelegramId(value) {
  devTelegramId = value ? String(value) : "";
}

function authHeaders() {
  const headers = {};
  const initData = telegramInitData();
  if (initData) headers["X-Telegram-Init-Data"] = initData;
  if (devTelegramId) headers["X-Dev-Telegram-Id"] = devTelegramId;
  return headers;
}

async function request(path, { method = "GET", body, signal } = {}) {
  const options = {
    method,
    signal,
    credentials: "same-origin",
    headers: { ...authHeaders(), ...(body === undefined ? {} : JSON_HEADERS) },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const response = await fetch(path, options);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? payload.detail : payload;
    throw new ApiError(response.status, typeof detail === "string" ? detail : null, payload);
  }
  return payload;
}

const get = (path, opts) => request(path, { ...opts, method: "GET" });
const post = (path, body, opts) => request(path, { ...opts, method: "POST", body: body ?? {} });
const patch = (path, body, opts) => request(path, { ...opts, method: "PATCH", body: body ?? {} });
const del = (path, opts) => request(path, { ...opts, method: "DELETE" });

const enc = encodeURIComponent;

/* --- Служебные ----------------------------------------------------------- */

export const getHealth = () => get("/healthz");
export const getVersion = () => get("/api/version");
export const getBuild = () => get("/api/build");

/* --- Сессия и профиль ---------------------------------------------------- */

export const getMe = (opts) => get("/api/me", opts);
export const register = (payload) => post("/api/register", payload);
export const updateMyStudent = (payload) => patch("/api/me/student", payload);
export const deleteMyStudent = () => del("/api/me/student");
export const updateMyTimezone = (payload) => patch("/api/me/timezone", payload);

/* --- Расписание и слоты -------------------------------------------------- */

export const getAvailableSlots = ({ durationMinutes = 60, days = 14 } = {}) =>
  get(`/api/available-slots?duration_minutes=${enc(durationMinutes)}&days=${enc(days)}`);

export const book = (payload) => post("/api/book", payload);
export const createScheduleRule = (payload) => post("/api/schedule-rules", payload);

/* --- Занятия · роли ученика и родителя ----------------------------------- */

export const confirmOwnLesson = (lessonId) => post(`/api/lessons/${enc(lessonId)}/confirm`);
export const cancelOwnLesson = (lessonId, payload) => post(`/api/lessons/${enc(lessonId)}/cancel`, payload);
export const moveOwnLesson = (lessonId, payload) => post(`/api/lessons/${enc(lessonId)}/move`, payload);
export const markLessonPaid = (lessonId, payload) => post(`/api/lessons/${enc(lessonId)}/mark-paid`, payload);
export const submitHomework = (homeworkId, payload) => post(`/api/homework/${enc(homeworkId)}/submit`, payload);
export const sendPayment = (payload) => post("/api/payment", payload);

/* --- Прогресс и план ----------------------------------------------------- */

export const updateProgress = (studentId, payload) => patch(`/api/students/${enc(studentId)}/progress`, payload);
export const deleteProgressTopic = (studentId, topicId) => del(`/api/students/${enc(studentId)}/progress/${enc(topicId)}`);
export const deleteProgressNote = (studentId, topicId) => del(`/api/students/${enc(studentId)}/progress/${enc(topicId)}/note`);
export const createPlanItem = (studentId, payload) => post(`/api/students/${enc(studentId)}/plan`, payload);
export const updatePlanItem = (studentId, itemId, payload) => patch(`/api/students/${enc(studentId)}/plan/${enc(itemId)}`, payload);
export const deletePlanItem = (studentId, itemId) => del(`/api/students/${enc(studentId)}/plan/${enc(itemId)}`);

/* --- Репетитор · ученики ------------------------------------------------- */

export const getStudent = (studentId) => get(`/api/admin/students/${enc(studentId)}`);
export const createStudent = (payload) => post("/api/admin/students", payload);
export const updateStudent = (studentId, payload) => patch(`/api/admin/students/${enc(studentId)}`, payload);
export const deleteStudent = (studentId) => del(`/api/admin/students/${enc(studentId)}`);
export const updateTutorProfile = (payload) => patch("/api/admin/profile", payload);

/* --- Репетитор · занятия ------------------------------------------------- */

export const createLesson = (payload) => post("/api/admin/lessons", payload);
export const updateLesson = (lessonId, payload) => patch(`/api/admin/lessons/${enc(lessonId)}`, payload);
export const deleteLesson = (lessonId) => del(`/api/admin/lessons/${enc(lessonId)}`);
export const confirmLesson = (lessonId, payload) => post(`/api/admin/lessons/${enc(lessonId)}/confirm`, payload);
export const rejectLesson = (lessonId, payload) => post(`/api/admin/lessons/${enc(lessonId)}/reject`, payload);

/* --- Репетитор · домашние задания ---------------------------------------- */

export const createHomework = (payload) => post("/api/admin/homework", payload);
export const updateHomework = (homeworkId, payload) => patch(`/api/admin/homework/${enc(homeworkId)}`, payload);
export const deleteHomework = (homeworkId) => del(`/api/admin/homework/${enc(homeworkId)}`);

/* --- Репетитор · деньги -------------------------------------------------- */

export const createPayment = (payload) => post("/api/admin/payments", payload);
export const confirmPayment = (paymentId, payload) => post(`/api/admin/payments/${enc(paymentId)}`, payload);
export const updateAdvance = (paymentId, payload) => patch(`/api/admin/advances/${enc(paymentId)}`, payload);

/* --- Репетитор · нерабочие часы ------------------------------------------ */

export const createClosedSlot = (payload) => post("/api/admin/closed-slots", payload);
export const deleteClosedSlot = (slotId) => del(`/api/admin/closed-slots/${enc(slotId)}`);

/* --- Репетитор · ссылки доступа ------------------------------------------ */

export const createTutorBrowserInvite = (payload) => post("/api/admin/browser-invites", payload);
export const createStudentBrowserInvite = (studentId, payload) =>
  post(`/api/admin/students/${enc(studentId)}/browser-invites`, payload);

/* --- Репетитор · очистка стабильного расписания -------------------------- */

export const previewScheduleCleanup = (studentId) =>
  get(`/api/admin/students/${enc(studentId)}/schedule-cleanup`);
export const runScheduleCleanup = (studentId) =>
  post(`/api/admin/students/${enc(studentId)}/schedule-cleanup`);
