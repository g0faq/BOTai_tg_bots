/* Форматирование чисел, денег, часов, дат и часовых поясов.
 *
 * Форматы зафиксированы спецификацией интерфейса и продублированы в текстах
 * бота, поэтому менять их нельзя в одностороннем порядке:
 *   деньги          «1 500 ₽»  — узкий неразрывный пробел между разрядами
 *   часы            дробные, шаг 0.25
 *   часовой пояс    «МСК+0», «МСК+2», «МСК-1»
 *   даты в списках  относительные: «сегодня», «завтра», «через 3 дня»
 */

const NNBSP = " "; // narrow no-break space — разделитель разрядов
const MSK_OFFSET_MINUTES = 180; // Europe/Moscow, UTC+3

/* --- Числа и деньги ------------------------------------------------------ */

export function groupDigits(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? "-" : "";
  const whole = Math.abs(Math.round(n)).toString();
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** «1 500 ₽». Суммы всегда выключены вправо — это делает CSS-класс num--money. */
export function money(value) {
  return `${groupDigits(value)}${NNBSP}₽`;
}

/** Со знаком: «+ 6 000 ₽» / «− 1 500 ₽». Минус — типографский. */
export function moneySigned(value) {
  const n = Number(value) || 0;
  if (n === 0) return money(0);
  const sign = n > 0 ? "+" : "−";
  return `${sign}${NNBSP}${groupDigits(Math.abs(n))}${NNBSP}₽`;
}

/* --- Часы ---------------------------------------------------------------- */

/** Часы дробные с шагом 0.25: 4 → «4 ч», 1.5 → «1.5 ч», 0.25 → «0.25 ч». */
export function hours(value) {
  const raw = Number(value) || 0;
  const snapped = Math.round(raw * 4) / 4;
  const text = Number.isInteger(snapped) ? String(snapped) : String(snapped).replace(/0+$/, "");
  return `${text}${NNBSP}ч`;
}

export function hoursSigned(value) {
  const n = Math.round((Number(value) || 0) * 4) / 4;
  if (n === 0) return hours(0);
  const sign = n > 0 ? "+" : "−";
  return `${sign}${NNBSP}${hours(Math.abs(n))}`;
}

export function minutes(value) {
  return `${Number(value) || 0}${NNBSP}мин`;
}

/* --- Часовой пояс -------------------------------------------------------- */

/** Смещение в минутах от МСК → «МСК+0», «МСК+2», «МСК-1». */
export function mskLabel(offsetMinutesFromMsk) {
  const delta = Math.round((Number(offsetMinutesFromMsk) || 0) / 60);
  return `МСК${delta >= 0 ? "+" : "-"}${Math.abs(delta)}`;
}

/** Нормализует то, что пришло с сервера: «Europe/Moscow» → «МСК+0». */
export function timezoneLabel(value) {
  if (!value) return "МСК+0";
  const text = String(value);
  if (/^МСК[+-]\d+$/.test(text)) return text;
  try {
    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: text }));
    const msk = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
    return mskLabel((local - msk) / 60000);
  } catch {
    return text;
  }
}

/* --- Даты и время -------------------------------------------------------- */

export function toDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (n) => String(n).padStart(2, "0");

/** «09:00» */
export function time(value) {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "—";
}

/** «04.08» */
export function dayMonth(value) {
  const d = toDate(value);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` : "—";
}

/** «6 августа» */
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function dateLong(value) {
  const d = toDate(value);
  return d ? `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}` : "—";
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export const weekdayShort = (value) => {
  const d = toDate(value);
  return d ? WEEKDAYS_SHORT[d.getDay()] : "—";
};

/** «четверг, 6 августа» — заголовок дня в календаре. */
export function dayTitle(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${WEEKDAYS[d.getDay()]}, ${dateLong(d)}`;
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Календарных дней между датами, без учёта времени суток. */
export function daysBetween(value, from = new Date()) {
  const a = toDate(value);
  if (!a) return null;
  return Math.round((startOfDay(a) - startOfDay(from)) / 86400000);
}

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

/**
 * Относительная дата для списков: «сегодня», «завтра», «через 3 дня»,
 * «вчера», «3 дня назад». Дальше семи дней — обычная дата.
 */
export function relativeDay(value, from = new Date()) {
  const diff = daysBetween(value, from);
  if (diff === null) return "—";
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  if (diff === 2) return "послезавтра";
  if (diff === -1) return "вчера";
  if (diff > 2 && diff <= 7) return `через ${diff} ${pluralDays(diff)}`;
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} ${pluralDays(Math.abs(diff))} назад`;
  return dayMonth(value);
}

/** «#503 10:00 (3 августа, МСК+0)» — совпадает с форматом строки в боте. */
export function lessonStamp(lesson, tzLabel = "МСК+0") {
  const d = toDate(lesson?.starts_at);
  if (!d) return "—";
  return `${time(d)} (${dateLong(d)}, ${tzLabel})`;
}

/** Инициалы для аватара: «Михаил Волосов» → «МВ». */
export function initials(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

/** Процент 0..100, безопасно. */
export function percent(value, goal) {
  const g = Number(goal) || 0;
  if (g <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) / g * 100)));
}

export { NNBSP, MSK_OFFSET_MINUTES };
