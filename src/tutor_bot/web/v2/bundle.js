/* СГЕНЕРИРОВАНО tools/build_v2.py — не редактировать руками.
   Источник: web/v2/**. Пересобрать: python3 tools/build_v2.py */
(() => {
  "use strict";
  const __mods = {}, __cache = {};
  const __def = (id, fn) => { __mods[id] = fn; };
  const __req = (id) => {
    if (__cache[id]) return __cache[id];
    const __x = __cache[id] = {};
    __mods[id](__x, __req);
    return __x;
  };
  __def("ui/dom.js", (__x, __req) => {
/* Минимальный помощник построения DOM.
 *
 * Никаких innerHTML со склейкой строк: всё строится узлами, поэтому нет
 * места для инъекции и не нужен escapeHtml в каждом компоненте.
 */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== "list") {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  append(node, children);
  return node;
}

function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Число моноширинным с табличными цифрами — правило цифр из дизайна. */
function num(value, extraClass = "") {
  return el("span", { class: `num ${extraClass}`.trim(), text: String(value) });
}

function clear(node) {
  node.replaceChildren();
  return node;
}

  __x.el = el;
  __x.append = append;
  __x.num = num;
  __x.clear = clear;

  });
  __def("core/router.js", (__x, __req) => {
/* Роутер вкладок.
 *
 * Правило волны: в DOM живёт ТОЛЬКО активная вкладка. В старом мини-аппе все
 * экраны всех ролей отрисовывались сразу и прятались стилями — при сотне
 * учеников это давало заметные тормоза.
 *
 * Экран регистрируется фабрикой, которая возвращает
 * { mount(container), unmount?() }. Роутер гарантирует, что unmount
 * предыдущего экрана вызван до mount следующего.
 */

function createRouter({ container, onChange } = {}) {
  const screens = new Map();
  let current = null;   // { id, instance }

  function register(id, factory) {
    screens.set(id, factory);
    return api;
  }

  function unmountCurrent() {
    if (!current) return;
    try {
      current.instance?.unmount?.();
    } catch (error) {
      console.error(`unmount ${current.id} failed`, error);
    }
    current = null;
    if (container) container.replaceChildren();
  }

  function go(id, params = {}) {
    if (!screens.has(id)) {
      throw new Error(`Неизвестный экран: ${id}`);
    }
    if (current?.id === id && current.instance?.update) {
      current.instance.update(params);
      onChange?.(id, params);
      return;
    }
    unmountCurrent();
    // Чистим контейнер всегда, а не только когда был предыдущий экран:
    // иначе заглушка загрузки остаётся лежать под первым смонтированным.
    if (container) container.replaceChildren();
    const factory = screens.get(id);
    const instance = factory(params) || {};
    if (container) instance.mount?.(container, params);
    current = { id, instance };
    onChange?.(id, params);
  }

  const api = {
    register,
    go,
    destroy: unmountCurrent,
    get active() {
      return current?.id ?? null;
    },
    get registered() {
      return [...screens.keys()];
    },
  };

  return api;
}

  __x.createRouter = createRouter;

  });
  __def("core/state.js", (__x, __req) => {
/* Стор и подписки.
 *
 * Состояние живёт ТОЛЬКО в памяти. localStorage и sessionStorage не
 * используются нигде в v2: источник правды — сервер, а Telegram WebView
 * переживает перезапуски непредсказуемо.
 */

const store = {
  payload: null,      // ответ /api/me целиком
  role: null,         // tutor | student | parent | guest
  activeTab: null,
  selectedStudentId: null,
  loading: false,
  error: null,
};

const listeners = new Set();

/** Текущее состояние. Возвращается копия: мутировать снаружи нельзя. */
function getState() {
  return { ...store };
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  const snapshot = getState();
  for (const listener of [...listeners]) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error("state listener failed", error);
    }
  }
}

/** Точечное обновление. Если ничего не поменялось — подписчики не дёргаются. */
function setState(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (store[key] !== value) {
      store[key] = value;
      changed = true;
    }
  }
  if (changed) emit();
  return getState();
}

function setPayload(payload) {
  return setState({
    payload,
    role: payload?.role ?? null,
    error: null,
  });
}

function reset() {
  Object.assign(store, {
    payload: null,
    role: null,
    activeTab: null,
    selectedStudentId: null,
    loading: false,
    error: null,
  });
  emit();
}

  __x.getState = getState;
  __x.subscribe = subscribe;
  __x.setState = setState;
  __x.setPayload = setPayload;
  __x.reset = reset;

  });
  __def("ui/button.js", (__x, __req) => {
/* Кнопка: 4 типа × 4 состояния.
 * Тип задаётся снаружи — компонент ничего не знает о роли пользователя.
 */
const { el } = __req("ui/dom.js");
const KINDS = new Set(["main", "second", "danger", "inline"]);

function Button({
  label,
  kind = "main",
  state = "normal",      // normal | press | off | load
  loadingLabel,
  type = "button",
  onClick,
  full = false,
} = {}) {
  const variant = KINDS.has(kind) ? kind : "main";
  const disabled = state === "off" || state === "load";
  return el("button", {
    type,
    class: `btn btn--${variant}${state !== "normal" ? ` is-${state}` : ""}${full ? " btn--full" : ""}`,
    disabled,
    "aria-busy": state === "load" ? "true" : null,
    text: state === "load" && loadingLabel ? loadingLabel : label,
    onClick: disabled ? null : onClick,
  });
}

function IconButton({ glyph, label, state = "normal", onClick } = {}) {
  const disabled = state === "off";
  return el("button", {
    type: "button",
    class: `icon-btn${state !== "normal" ? ` is-${state}` : ""}`,
    disabled,
    "aria-label": label,
    onClick: disabled ? null : onClick,
  }, [el("span", { "aria-hidden": "true", text: glyph })]);
}

  __x.Button = Button;
  __x.IconButton = IconButton;

  });
  __def("ui/icons.js", (__x, __req) => {
/* Иконки таббара.
 *
 * Рисуются в языке системы «Журнал / Табло»: только прямые линии и прямые
 * углы, обводка в 1.5 px, без заливок, скруглений и градиентов. Цвет —
 * currentColor, поэтому активное состояние наследует акцент от кнопки.
 *
 * Сетка 20×20, все фигуры выровнены по полупикселю (x.5), чтобы линии
 * ложились на пиксель и не мылились.
 */

const NS = "http://www.w3.org/2000/svg";

function svg(paths) {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", "0 0 20 20");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.5");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("focusable", "false");
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    node.append(path);
  }
  return node;
}

/** Обзор — табло 2×2. */
const overview = () => svg([
  "M2.75 2.75h6v6h-6z",
  "M11.25 2.75h6v6h-6z",
  "M2.75 11.25h6v6h-6z",
  "M11.25 11.25h6v6h-6z",
]);

/** Ученики — строки журнала с засечкой слева. */
const students = () => svg([
  "M2.75 4.75h1.5", "M7.25 4.75h10",
  "M2.75 10h1.5", "M7.25 10h10",
  "M2.75 15.25h1.5", "M7.25 15.25h10",
]);

/** Календарь — сетка месяца с шапкой. */
const calendar = () => svg([
  "M2.75 4.75h14.5v12.5H2.75z",
  "M2.75 8.5h14.5",
  "M6.25 2.75v3", "M13.75 2.75v3",
  "M7.5 11.75h5",
]);

/** ДЗ — лист с полем и строками. */
const homework = () => svg([
  "M4.75 2.75h10.5v14.5H4.75z",
  "M7.75 2.75v14.5",
  "M10.25 6.75h3", "M10.25 10h3", "M10.25 13.25h3",
]);

/** Финансы — столбцы табло. */
const finances = () => svg([
  "M2.75 17.25h14.5",
  "M5.25 13.25v4", "M9.25 8.75v8.5", "M13.25 11v6.25", "M17 5.75v11.5",
]);

/** Прогресс — восходящая шкала с осью. */
const progress = () => svg([
  "M2.75 2.75v14.5h14.5",
  "M5.75 13.5l3.5-3.5 2.5 2.5 4.5-4.5",
]);

const ICONS = { overview, students, calendar, homeworks: homework, finances, progress };

/** Иконка по ключу вкладки. Неизвестный ключ — пустой квадрат-заглушка. */
function tabIcon(key) {
  const make = ICONS[key] || (() => svg(["M2.75 2.75h14.5v14.5H2.75z"]));
  return make();
}

const TAB_ICON_KEYS = Object.keys(ICONS);

  __x.tabIcon = tabIcon;
  __x.TAB_ICON_KEYS = TAB_ICON_KEYS;

  });
  __def("ui/shell.js", (__x, __req) => {
/* Шапка, таббар, FAB — каркас экрана.
 *
 * Ни один из них не ветвится по роли: список вкладок и список действий FAB
 * приходят параметром. FAB просто не создаётся, если действий не передали.
 */
const { el } = __req("ui/dom.js");
const { IconButton } = __req("ui/button.js");
const { tabIcon } = __req("ui/icons.js");
function Header({ title = "", subtitle = "", actions = [] } = {}) {
  return el("header", { class: "header" }, [
    el("span", { class: "header__mark", "aria-hidden": "true", text: "Б" }),
    el("span", { class: "header__copy" }, [
      el("span", { class: "header__brand" }, [
        "БОТай ",
        el("span", { class: "header__brand-accent", text: "CRM" }),
      ]),
      el("span", { class: "num header__title", text: subtitle || title }),
    ]),
    el("span", { class: "header__actions" }, actions),
  ]);
}

const HeaderIcon = IconButton;

/**
 * Активная вкладка помечена засечкой сверху и акцентным цветом иконки.
 *
 * Подписи заменены иконками одинакового размера: у текстовых подписей
 * ширина разная («Ученики» против «ДЗ»), и при равных колонках зазоры между
 * словами читались как неровные. Иконка 20×20 даёт одинаковый ритм.
 * Название остаётся в aria-label и подсказке — смысл не теряется.
 */
function TabBar({ items = [], value, onSelect } = {}) {
  return el("nav", { class: "tabbar", "aria-label": "Разделы" },
    items.map((item) => {
      const active = item.value === value;
      return el("button", {
        type: "button",
        class: `tabbar__item${active ? " is-active" : ""}`,
        "aria-current": active ? "page" : null,
        "aria-label": item.label,
        title: item.label,
        onClick: onSelect ? () => onSelect(item.value) : null,
      }, [
        el("span", { class: "tabbar__mark", "aria-hidden": "true" }),
        el("span", { class: "tabbar__icon" }, [tabIcon(item.value)]),
      ]);
    }));
}

/** Раскрывает действия вверх списком, а не радиально. */
function Fab({ actions = [], label = "Действия" } = {}) {
  if (!actions.length) return null;
  const menu = el("div", { class: "fab__menu", hidden: true },
    actions.map((a) => el("button", {
      type: "button",
      class: "fab__action",
      text: a.label,
      onClick: () => { menu.hidden = true; a.onClick?.(); },
    })));
  const button = el("button", {
    type: "button",
    class: "fab__button",
    "aria-label": label,
    "aria-expanded": "false",
    text: "+",
    onClick: () => {
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
    },
  });
  return el("div", { class: "fab" }, [menu, button]);
}

  __x.Header = Header;
  __x.HeaderIcon = HeaderIcon;
  __x.TabBar = TabBar;
  __x.Fab = Fab;

  });
  __def("ui/feedback.js", (__x, __req) => {
/* Пустое состояние и тост. */
const { el } = __req("ui/dom.js");
function EmptyState({ title, description = "", action = null } = {}) {
  return el("div", { class: "empty" }, [
    el("span", { class: "empty__mark", "aria-hidden": "true" }),
    el("h3", { class: "empty__title", text: title }),
    description ? el("p", { class: "empty__text", text: description }) : null,
    action,
  ]);
}

function Toast({ text, tone = "none", action = null } = {}) {
  return el("div", {
    class: `toast toast--${tone}`,
    role: "status",
    "aria-live": "polite",
  }, [
    el("span", { class: "toast__text", text }),
    action,
  ]);
}

  __x.EmptyState = EmptyState;
  __x.Toast = Toast;

  });
  __def("ui/section.js", (__x, __req) => {
/* Заголовки и разделители экранов. */
const { el, num } = __req("ui/dom.js");
/** Капитель секции со счётчиком и необязательным действием справа. */
function SectionCaption({ title, count = null, action = null } = {}) {
  return el("div", { class: "caption" }, [
    el("span", { class: "caption__text" }, [
      title,
      count == null ? null : num(count, "caption__count"),
    ]),
    action,
  ]);
}

/** Заголовок дня: название слева, сумма за день справа. */
function DayHeader({ title, total = "" } = {}) {
  return el("div", { class: "day-head" }, [
    el("span", { class: "day-head__title", text: title }),
    total ? num(total, "day-head__total num--money") : null,
  ]);
}

/** Шапка экрана: крупный заголовок, счётчик, главное действие. */
function ScreenHead({ title, count = "", primary = null, extra = null } = {}) {
  return el("div", { class: "screen-head" }, [
    el("div", { class: "screen-head__row" }, [
      el("h1", { class: "screen-head__title", text: title }),
      count ? num(count, "screen-head__count") : null,
    ]),
    primary || extra ? el("div", { class: "screen-head__actions" }, [primary, extra]) : null,
  ]);
}

/** Компактная шапка детального экрана: назад, имя, действия. */
function DetailHeader({ title, onBack, actions = [] } = {}) {
  return el("header", { class: "detail-head" }, [
    el("button", { type: "button", class: "icon-btn", "aria-label": "Назад", onClick: onBack }, [
      el("span", { "aria-hidden": "true", text: "‹" }),
    ]),
    el("span", { class: "detail-head__title", text: title }),
    el("span", { class: "detail-head__actions" }, actions),
  ]);
}

/** Вкладки внутри карточки ученика. */
function CardTabs({ items = [], value, onSelect } = {}) {
  return el("nav", { class: "card-tabs", role: "tablist" },
    items.map((item) => {
      const val = item.value ?? item;
      const active = val === value;
      return el("button", {
        type: "button",
        role: "tab",
        class: `card-tabs__item${active ? " is-active" : ""}`,
        "aria-selected": active ? "true" : "false",
        text: item.label ?? item,
        onClick: onSelect ? () => onSelect(val) : null,
      });
    }));
}

/**
 * Сворачиваемый раздел: заголовок работает переключателем.
 *
 * Нужен там, где содержимое длинное и по умолчанию мешает — например
 * история операций за всё время.
 */
function Collapsible({ title, count = null, open = false, onToggle, content = null } = {}) {
  const box = el("section", { class: `collapsible${open ? " is-open" : ""}` });
  box.append(
    el("button", {
      type: "button",
      class: "collapsible__head",
      "aria-expanded": open ? "true" : "false",
      onClick: onToggle,
    }, [
      el("span", { class: "collapsible__title" }, [
        title,
        count == null ? null : num(count, "collapsible__count"),
      ]),
      el("span", { class: "collapsible__chev", "aria-hidden": "true", text: open ? "▴" : "▾" }),
    ]),
  );
  if (open && content) box.append(content);
  return box;
}

  __x.SectionCaption = SectionCaption;
  __x.DayHeader = DayHeader;
  __x.ScreenHead = ScreenHead;
  __x.DetailHeader = DetailHeader;
  __x.CardTabs = CardTabs;
  __x.Collapsible = Collapsible;

  });
  __def("ui/notch.js", (__x, __req) => {
/* Засечка статуса в левом жёлобе строки.
 * Статус кодируется цветом + формой + позицией, поэтому читается без цвета.
 * Форму даёт словарь (dict.js), компонент её только рисует.
 */
const { el } = __req("ui/dom.js");
function Notch({ tone = "none", mark = "none", label = "" } = {}) {
  return el("span", {
    class: `notch notch--${tone} notch--${mark}`,
    "aria-hidden": label ? null : "true",
    "aria-label": label || null,
    role: label ? "img" : null,
  });
}

  __x.Notch = Notch;

  });
  __def("ui/stat.js", (__x, __req) => {
/* Табло: ячейки KPI, полоса структуры оплат, карточка следующего урока. */
const { el, num } = __req("ui/dom.js");
const { Notch } = __req("ui/notch.js");
/** Ячейка табло: цифра mono крупно, подпись капителью, засечка кодирует смысл. */
function StatCell({ value, label, notch = null, tone = "none" } = {}) {
  return el("div", { class: "stat" }, [
    notch ? Notch(notch) : null,
    num(value, `stat__value stat__value--${tone}`),
    el("span", { class: "stat__label", text: label }),
  ]);
}

function StatGrid({ cells = [], columns = 3 } = {}) {
  return el("div", { class: `stat-grid stat-grid--${columns}` }, cells);
}

/** Структура оплат одной полосой: оплачено / ждёт / долг. */
function FinanceBar({ paid = 0, waiting = 0, debt = 0 } = {}) {
  const total = paid + waiting + debt;
  if (total <= 0) return el("div", { class: "finance-bar finance-bar--empty" });
  return el("div", { class: "finance-bar", role: "img", "aria-label": "Структура оплат" }, [
    paid ? el("span", { class: "finance-bar__part finance-bar__part--done", style: { flex: String(paid) } }) : null,
    waiting ? el("span", { class: "finance-bar__part finance-bar__part--wait", style: { flex: String(waiting) } }) : null,
    debt ? el("span", { class: "finance-bar__part finance-bar__part--debt", style: { flex: String(debt) } }) : null,
  ]);
}

/** Карточка следующего урока. */
function NextLessonCard({ when, meta = "", price = "", notch = null, action = null } = {}) {
  return el("article", { class: "next-lesson" }, [
    notch ? Notch(notch) : null,
    el("span", { class: "next-lesson__main" }, [
      el("span", { class: "next-lesson__cap", text: "Следующий урок" }),
      num(when, "next-lesson__when"),
      meta ? el("span", { class: "next-lesson__meta", text: meta }) : null,
    ]),
    action || (price ? num(price, "next-lesson__price num--money") : null),
  ]);
}

/** Пара «подпись — значение» строкой в 44 px. */
function FactRow({ label, value, tone = "none" } = {}) {
  return el("div", { class: "fact" }, [
    el("span", { class: "fact__label", text: label }),
    num(value, `fact__value fact__value--${tone}`),
  ]);
}

  __x.StatCell = StatCell;
  __x.StatGrid = StatGrid;
  __x.FinanceBar = FinanceBar;
  __x.NextLessonCard = NextLessonCard;
  __x.FactRow = FactRow;

  });
  __def("ui/status-pill.js", (__x, __req) => {
/* Статусная отметка: глиф + подпись.
 * Глиф дублирует цвет формой (● ◐ ◑ ▲ ○) — требование доступности.
 */
const { el } = __req("ui/dom.js");
function StatusPill({ label, tone = "none", glyph = "", short } = {}) {
  return el("span", { class: `pill pill--${tone}`, title: label, "aria-label": label }, [
    glyph ? el("span", { class: "pill__glyph", "aria-hidden": "true", text: glyph }) : null,
    el("span", { class: "pill__label", text: short || label }),
  ]);
}

  __x.StatusPill = StatusPill;

  });
  __def("screens/overview.js", (__x, __req) => {
/* Экран «Обзор» — табло дня.
 *
 * Три блока и ничего лишнего: пульс дня, лента дня с меткой текущего
 * времени и то, что требует ответа. Быстрых действий здесь нет намеренно —
 * тот же набор уже лежит под кнопкой «+», и дублировать его значит
 * занимать первый экран тем, что и так под рукой.
 */
const { el, num, append } = __req("ui/dom.js");
const { SectionCaption } = __req("ui/section.js");
const { StatCell, StatGrid } = __req("ui/stat.js");
const { Notch } = __req("ui/notch.js");
const { StatusPill } = __req("ui/status-pill.js");
const { Button } = __req("ui/button.js");
const { EmptyState } = __req("ui/feedback.js");
/** Пульс дня: единственное крупное число продукта — сумма за день. */
function pulse(model) {
  return el("section", { class: "pulse" }, [
    el("div", { class: "pulse__head" }, [
      el("span", { class: "pulse__cap", text: "Пульс дня" }),
      num(model.dateLabel, "pulse__date"),
    ]),
    el("div", { class: "pulse__row" }, [
      num(model.money, "pulse__sum num--money"),
      num(`${model.conducted} / ${model.total} проведено`, "pulse__done"),
    ]),
    el("div", { class: "pulse__meter" }, [
      el("span", { class: "pulse__track" }, [
        el("i", { class: "pulse__fill", style: { width: `${model.progress}%` } }),
      ]),
      num(model.moneyCaption, "pulse__caption"),
    ]),
    model.cancelledToday
      ? num(`${model.cancelledToday} отменено сегодня`, "pulse__cancelled")
      : null,
  ]);
}

/** Метка текущего времени: время, пульсирующая точка и линия. */
function nowMarker(label) {
  return el("div", { class: "now-line", "aria-label": `Сейчас ${label}` }, [
    num(label, "now-line__time"),
    el("span", { class: "now-line__dot", "aria-hidden": "true" }),
    el("span", { class: "now-line__rule", "aria-hidden": "true" }),
  ]);
}

function ribbonRow(item, actions) {
  return el("article", { class: `ribbon-row${item.isPast ? " is-past" : ""}` }, [
    Notch(item.lessonStatus),
    el("span", { class: "ribbon-row__time" }, [
      num(item.time, "ribbon-row__hh"),
      num(item.duration, "ribbon-row__dur"),
    ]),
    el("button", {
      type: "button",
      class: "ribbon-row__main",
      onClick: actions.openLesson ? () => actions.openLesson(item.id) : null,
    }, [
      el("span", { class: "ribbon-row__name", text: item.name }),
      item.meta ? el("span", { class: "ribbon-row__meta", text: item.meta }) : null,
    ]),
    el("span", { class: "ribbon-row__tail" }, [
      num(item.price, "ribbon-row__price num--money"),
      StatusPill(item.paymentStatus),
    ]),
  ]);
}

function OverviewScreen({ model, actions = {} } = {}) {
  const root = el("section", { class: "screen screen--overview" });

  append(root, [
    pulse(model),
    SectionCaption({
      title: "Лента дня",
      action: Button({ kind: "inline", label: "Весь день", onClick: actions.openCalendar }),
    }),
  ]);

  if (!model.ribbon.length) {
    root.append(EmptyState({
      title: "Сегодня свободно",
      description: "Новые уроки появятся здесь сразу после записи.",
      action: Button({ kind: "second", label: "Добавить урок", onClick: actions.addLesson }),
    }));
  } else {
    const list = el("div", { class: "list ribbon" });
    for (const item of model.ribbon) {
      if (item.showNow) list.append(nowMarker(model.nowLabel));
      list.append(ribbonRow(item, actions));
    }
    // День закончился — метка встаёт в конце, чтобы было видно, что впереди пусто.
    if (!model.ribbon.some((i) => i.showNow)) list.append(nowMarker(model.nowLabel));
    root.append(list);
  }

  if (model.attention.length) {
    root.append(SectionCaption({ title: "Требует ответа" }));
    root.append(el("div", { class: "list" }, model.attention.map((item) =>
      el("button", {
        type: "button",
        class: "attention",
        onClick: actions.goTo ? () => actions.goTo(item.target) : null,
      }, [
        Notch(item.notch),
        el("span", { class: "attention__label", text: item.label }),
        num(String(item.count), "attention__count"),
        el("span", { class: "attention__chev", "aria-hidden": "true", text: "›" }),
      ]))));
  }

  root.append(SectionCaption({ title: "Табло" }));
  root.append(StatGrid({
    columns: 2,
    cells: model.stats.map((s) => StatCell({ value: s.value, label: s.label, tone: s.tone })),
  }));

  return root;
}

  __x.OverviewScreen = OverviewScreen;

  });
  __def("ui/chip.js", (__x, __req) => {
/* Чип фильтра и сегментированный контрол.
 * Чип 32 px получает вертикальные отбивки по 6 px — сенсорная цель 44 px.
 */
const { el, num } = __req("ui/dom.js");
function Chip({ label, count = null, active = false, onClick } = {}) {
  return el("button", {
    type: "button",
    class: `chip${active ? " is-active" : ""}`,
    "aria-pressed": active ? "true" : "false",
    onClick,
  }, [
    el("span", { text: label }),
    count == null ? null : num(count, "chip__num"),
  ]);
}

function ChipRow({ items = [], value, onSelect } = {}) {
  return el("div", { class: "chip-row", role: "group" },
    items.map((item) => Chip({
      label: item.label ?? item,
      count: item.count ?? null,
      active: (item.value ?? item.label ?? item) === value,
      onClick: onSelect ? () => onSelect(item.value ?? item.label ?? item) : null,
    })));
}

function Segmented({ items = [], value, onSelect, label = "" } = {}) {
  return el("div", { class: "segmented", role: "tablist", "aria-label": label || null },
    items.map((item) => {
      const val = item.value ?? item;
      const active = val === value;
      return el("button", {
        type: "button",
        role: "tab",
        class: `segmented__item${active ? " is-active" : ""}`,
        "aria-selected": active ? "true" : "false",
        text: item.label ?? item,
        onClick: onSelect ? () => onSelect(val) : null,
      });
    }));
}

  __x.Chip = Chip;
  __x.ChipRow = ChipRow;
  __x.Segmented = Segmented;

  });
  __def("ui/rows.js", (__x, __req) => {
/* Строки списка: обычная, занятия, операции.
 *
 * Правило композиции: ни одна строка не знает про роль. Кнопки приходят
 * массивом `actions` снаружи — именно ветвление по роли внутри разметки
 * было источником регрессий в старой версии.
 */
const { el, num } = __req("ui/dom.js");
const { Notch } = __req("ui/notch.js");
const { StatusPill } = __req("ui/status-pill.js");
/** Строка списка. Состояния: normal | press | selected | off. */
function Row({ title, meta = "", value = "", state = "normal", notch, actions = [], onClick } = {}) {
  return el(onClick ? "button" : "div", {
    type: onClick ? "button" : null,
    class: `row row--2${state !== "normal" ? ` is-${state}` : ""}`,
    onClick,
  }, [
    notch ? Notch(notch) : null,
    el("span", { class: "row__main" }, [
      el("span", { class: "row__title", text: title }),
      meta ? el("span", { class: "row__meta", text: meta }) : null,
    ]),
    value ? num(value, "row__value num--money") : null,
    actions.length ? el("span", { class: "row__actions" }, actions) : null,
  ]);
}

/**
 * Строка занятия. Плотность: normal | dense.
 *
 * Раскладка по макету: 52 px под время, гибкая середина, прижатый правый
 * столбец. Статус занятия — обычный текст под именем (его уже кодирует
 * засечка), пилюля только у оплаты: две пилюли в строке 64 px не помещаются
 * и ломают ритм разлиновки.
 */
function LessonRow({
  time, name, meta = "", price = "",
  lessonStatus, paymentStatus,
  density = "normal", actions = [], onClick,
} = {}) {
  const caption = [lessonStatus?.label, meta].filter(Boolean).join(" · ");
  return el("article", { class: `lesson${density === "dense" ? " lesson--dense" : ""}` }, [
    lessonStatus ? Notch({ tone: lessonStatus.tone, mark: lessonStatus.mark, label: lessonStatus.label }) : null,
    num(time, "lesson__time"),
    el(onClick ? "button" : "div", {
      type: onClick ? "button" : null,
      class: "lesson__main",
      onClick,
    }, [
      el("span", { class: "lesson__name", text: name }),
      caption ? el("span", { class: "lesson__meta", text: caption }) : null,
    ]),
    el("span", { class: "lesson__tail" }, [
      price ? num(price, "lesson__price num--money") : null,
      paymentStatus ? StatusPill(paymentStatus) : null,
    ]),
    actions.length ? el("span", { class: "lesson__actions" }, actions) : null,
  ]);
}

/** Строка операции. Состояния: normal | loading | error. */
function OperationRow({ name, meta = "", notch, tail, state = "normal" } = {}) {
  return el("article", { class: `op${state !== "normal" ? ` is-${state}` : ""}` }, [
    notch ? Notch(notch) : null,
    el("span", { class: "op__main" }, [
      el("span", { class: "op__name", text: name }),
      meta ? el("span", { class: "op__meta", text: meta }) : null,
    ]),
    tail instanceof Node ? tail : (tail ? el("span", { class: "op__tail", text: tail }) : null),
  ]);
}

  __x.Row = Row;
  __x.LessonRow = LessonRow;
  __x.OperationRow = OperationRow;

  });
  __def("screens/calendar.js", (__x, __req) => {
/* Экран «Календарь» репетитора. */
const { el, num } = __req("ui/dom.js");
const { ScreenHead, SectionCaption, DayHeader } = __req("ui/section.js");
const { StatCell, StatGrid } = __req("ui/stat.js");
const { Segmented } = __req("ui/chip.js");
const { Button, IconButton } = __req("ui/button.js");
const { LessonRow } = __req("ui/rows.js");
const { EmptyState } = __req("ui/feedback.js");
function CalendarScreen({ model, mode = "week", archive = false, actions = {} } = {}) {
  const root = el("section", { class: "screen screen--calendar" });
  root.append(
    ScreenHead({ title: "Календарь", count: model.period }),
    el("div", { class: "screen__seg" }, [
      Segmented({
        items: [{ value: "day", label: "День" }, { value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }],
        value: mode, label: "Режим календаря", onSelect: actions.setMode,
      }),
    ]),
    el("div", { class: "screen__pad calendar-rail" }, [
      Button({ kind: "second", label: "Запись", onClick: actions.addLesson }),
      Button({ kind: "second", label: "Окна", onClick: actions.freeSlots }),
      Button({ kind: "second", label: "Стабильное", onClick: actions.addRule }),
      Button({ kind: "second", label: "Нерабочие", onClick: actions.addClosedSlot }),
      Button({ kind: archive ? "main" : "second", label: archive ? "Ближайшие" : "Архив", onClick: actions.toggleArchive }),
    ]),
    StatGrid({ columns: 4, cells: model.summary.map((s) => StatCell({ value: s.value, label: s.label, tone: s.tone })) }),
  );

  if (!model.days.length) {
    root.append(EmptyState({
      title: archive ? "Архив пуст" : "Календарь пуст",
      description: archive ? "Прошедшие и отменённые занятия появятся здесь." : "Создай занятие кнопкой «Запись» или из карточки ученика.",
    }));
    return root;
  }

  for (const day of model.days) {
    root.append(DayHeader({ title: day.title, total: day.total }));
    root.append(el("div", { class: "list" }, day.items.map((l) => LessonRow({
      time: l.time, name: l.name, price: l.price,
      lessonStatus: l.lessonStatus, paymentStatus: l.paymentStatus,
      actions: [
        IconButton({ glyph: "✓", label: "Отметить проведённым", onClick: actions.markConducted ? () => actions.markConducted(l.id) : null }),
        IconButton({ glyph: "₽", label: "Подтвердить оплату", onClick: actions.confirmPayment ? () => actions.confirmPayment(l.id) : null }),
      ],
      onClick: actions.openLesson ? () => actions.openLesson(l.id) : null,
    }))));
  }

  if (model.closedSlots.length) {
    root.append(SectionCaption({ title: "Нерабочие часы", count: model.closedSlots.length }));
    root.append(el("div", { class: "list" }, model.closedSlots.map((s) =>
      el("article", { class: "op" }, [
        el("span", { class: "op__main" }, [
          el("span", { class: "op__name", text: s.reason || "Нерабочее время" }),
          num(`${s.starts_at || ""}`.slice(11, 16) + "–" + `${s.ends_at || ""}`.slice(11, 16), "op__meta"),
        ]),
        IconButton({ glyph: "✕", label: "Удалить", onClick: actions.deleteClosedSlot ? () => actions.deleteClosedSlot(s.id) : null }),
      ]))));
  }
  return root;
}

  __x.CalendarScreen = CalendarScreen;

  });
  __def("ui/field.js", (__x, __req) => {
/* Поле ввода, селект, переключатель.
 * Состояния поля: пустое, заполнено, фокус, ошибка, выключено, загрузка.
 */
const { el } = __req("ui/dom.js");
function Field({
  label,
  value = "",
  placeholder = "",
  state = "empty",     // empty | filled | error | off | loading
  hint = "",
  tail = "",
  mono = false,
  type = "text",       // text | number | date | datetime-local | time
  name = "",
  step = "",
  onInput,
} = {}) {
  const input = el("input", {
    class: `field__input${mono || type !== "text" ? " num" : ""}`,
    type,
    name: name || null,
    step: step || null,
    value,
    placeholder,
    disabled: state === "off" || state === "loading",
    "aria-invalid": state === "error" ? "true" : null,
    onInput: onInput ? (e) => onInput(e.target.value) : null,
  });
  return el("label", { class: `field field--${state}` }, [
    label ? el("span", { class: "field__label", text: label }) : null,
    el("span", { class: "field__box" }, [
      input,
      tail ? el("span", { class: "field__tail", "aria-hidden": "true", text: tail }) : null,
    ]),
    hint ? el("span", { class: "field__hint", text: hint }) : null,
  ]);
}

function Select({ label, value, options = [], state = "empty", onChange } = {}) {
  const select = el("select", {
    class: "field__input field__input--select",
    disabled: state === "off",
    onChange: onChange ? (e) => onChange(e.target.value) : null,
  }, options.map((opt) => {
    const val = typeof opt === "string" ? opt : opt.value;
    const text = typeof opt === "string" ? opt : (opt.label ?? opt.value);
    return el("option", { value: val, selected: val === value, text });
  }));
  return el("label", { class: `field field--${state}` }, [
    label ? el("span", { class: "field__label", text: label }) : null,
    el("span", { class: "field__box" }, [
      select,
      el("span", { class: "field__tail", "aria-hidden": "true", text: "▾" }),
    ]),
  ]);
}

function Toggle({ label, checked = false, disabled = false, onChange } = {}) {
  const input = el("input", {
    type: "checkbox",
    class: "toggle__input",
    checked,
    disabled,
    onChange: onChange ? (e) => onChange(e.target.checked) : null,
  });
  return el("label", { class: `toggle${disabled ? " is-off" : ""}` }, [
    input,
    el("span", { class: "toggle__track", "aria-hidden": "true" }, [
      el("span", { class: "toggle__thumb" }),
    ]),
    label ? el("span", { class: "toggle__label", text: label }) : null,
  ]);
}

  __x.Field = Field;
  __x.Select = Select;
  __x.Toggle = Toggle;

  });
  __def("core/dict.js", (__x, __req) => {
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
const NOTCH = {
  SOLID: "solid",         // сплошная
  TOP_HALF: "top-half",   // верхняя половина
  BOTTOM_HALF: "bottom-half", // нижняя половина
  DASHED: "dashed",       // пунктир
  DOUBLE: "double",       // двойная тонкая
  NONE: "none",
};

const UNKNOWN = { label: "неизвестно", tone: "none", mark: NOTCH.NONE, glyph: "○" };

/* --- Занятия ------------------------------------------------------------ */

const LESSON_STATUS = {
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

const PAYMENT_STATUS = {
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

const HOMEWORK_STATUS = {
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

const PLAN_STATUS = {
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

const SUBJECTS = [
  "Информатика", "Математика", "Русский язык", "Физика", "Химия",
  "Биология", "Английский язык", "Обществознание", "История", "Литература",
];

const PREP_TYPES = [
  "ЕГЭ", "ОГЭ", "Школьная программа", "ВПР", "ДВИ", "Олимпиады", "Python",
];

const KNOWLEDGE_LEVELS = ["с нуля", "база", "средний", "сильный", "другое"];

/* --- Публичный доступ --------------------------------------------------- */

function look(table, value) {
  if (value == null) return UNKNOWN;
  return table[value] || { ...UNKNOWN, label: String(value) };
}

const lessonStatus = (value) => look(LESSON, value);
const paymentStatus = (value) => look(PAYMENT, value);
const homeworkStatus = (value) => look(HOMEWORK, value);
const planStatus = (value) => look(PLAN, value);

/** Отменено ли занятие — единственное разрешённое место для этой проверки. */
const isCancelledLesson = (value) => CANCELLED_LESSON_STATUSES.has(value);

/** Все значения статуса занятия для селектов и барабана. */
const lessonStatusOptions = () =>
  [
    LESSON_STATUS.PENDING,
    LESSON_STATUS.PLANNED,
    LESSON_STATUS.CONDUCTED,
    LESSON_STATUS.CANCELLED,
    LESSON_STATUS.MOVED,
  ].map((value) => ({ value, ...LESSON[value] }));

const paymentStatusOptions = () =>
  Object.keys(PAYMENT).map((value) => ({ value, ...PAYMENT[value] }));

const planStatusOptions = () =>
  Object.keys(PLAN).map((value) => ({ value, ...PLAN[value] }));

const homeworkStatusOptions = () =>
  Object.keys(HOMEWORK).map((value) => ({ value, ...HOMEWORK[value] }));

/** Уровень знания 0–10 → тон полосы задания. Пороги из дизайна. */
function levelTone(level) {
  const n = Math.max(0, Math.min(10, Number(level) || 0));
  if (n <= 4) return "debt";
  if (n <= 7) return "wait";
  return "done";
}

  __x.NOTCH = NOTCH;
  __x.LESSON_STATUS = LESSON_STATUS;
  __x.PAYMENT_STATUS = PAYMENT_STATUS;
  __x.HOMEWORK_STATUS = HOMEWORK_STATUS;
  __x.PLAN_STATUS = PLAN_STATUS;
  __x.SUBJECTS = SUBJECTS;
  __x.PREP_TYPES = PREP_TYPES;
  __x.KNOWLEDGE_LEVELS = KNOWLEDGE_LEVELS;
  __x.lessonStatus = lessonStatus;
  __x.paymentStatus = paymentStatus;
  __x.homeworkStatus = homeworkStatus;
  __x.planStatus = planStatus;
  __x.isCancelledLesson = isCancelledLesson;
  __x.lessonStatusOptions = lessonStatusOptions;
  __x.paymentStatusOptions = paymentStatusOptions;
  __x.planStatusOptions = planStatusOptions;
  __x.homeworkStatusOptions = homeworkStatusOptions;
  __x.levelTone = levelTone;

  });
  __def("ui/task-band.js", (__x, __req) => {
/* Полоса заданий 1–27: уровень знания 0–10 по каждому заданию.
 * Три размера: full (карточка прогресса), tick (строка ученика), micro.
 * Тон берётся из dict.levelTone — компонент порогов не знает.
 */
const { el } = __req("ui/dom.js");
const { levelTone } = __req("core/dict.js");
function TaskBand({ levels = [], size = "full", goal = 27 } = {}) {
  const items = Array.from({ length: goal }, (_, i) => Number(levels[i]) || 0);
  return el("div", {
    class: `band band--${size}`,
    role: "img",
    "aria-label": `Уровень знаний по ${goal} заданиям от 0 до 10`,
  }, items.map((level, i) => {
    const tone = levelTone(level);
    const bar = el("span", {
      class: `band__bar band__bar--${tone}${level === 0 ? " is-empty" : ""}`,
      style: { height: `${Math.max(4, level * 10)}%` },
    });
    return el("span", {
      class: "band__slot",
      title: `Задание ${i + 1}: ${level}/10`,
    }, [bar]);
  }));
}

/** Ось 10/8/6/4/2/0 слева от полосы. */
function TaskBandAxis() {
  return el("div", { class: "band-axis", "aria-hidden": "true" },
    ["10", "8", "6", "4", "2", "0"].map((v) => el("span", { class: "num band-axis__tick", text: v })));
}

  __x.TaskBand = TaskBand;
  __x.TaskBandAxis = TaskBandAxis;

  });
  __def("core/format.js", (__x, __req) => {
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

function groupDigits(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? "-" : "";
  const whole = Math.abs(Math.round(n)).toString();
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/** «1 500 ₽». Суммы всегда выключены вправо — это делает CSS-класс num--money. */
function money(value) {
  return `${groupDigits(value)}${NNBSP}₽`;
}

/** Со знаком: «+ 6 000 ₽» / «− 1 500 ₽». Минус — типографский. */
function moneySigned(value) {
  const n = Number(value) || 0;
  if (n === 0) return money(0);
  const sign = n > 0 ? "+" : "−";
  return `${sign}${NNBSP}${groupDigits(Math.abs(n))}${NNBSP}₽`;
}

/* --- Часы ---------------------------------------------------------------- */

/** Часы дробные с шагом 0.25: 4 → «4 ч», 1.5 → «1.5 ч», 0.25 → «0.25 ч». */
function hours(value) {
  const raw = Number(value) || 0;
  const snapped = Math.round(raw * 4) / 4;
  const text = Number.isInteger(snapped) ? String(snapped) : String(snapped).replace(/0+$/, "");
  return `${text}${NNBSP}ч`;
}

function hoursSigned(value) {
  const n = Math.round((Number(value) || 0) * 4) / 4;
  if (n === 0) return hours(0);
  const sign = n > 0 ? "+" : "−";
  return `${sign}${NNBSP}${hours(Math.abs(n))}`;
}

function minutes(value) {
  return `${Number(value) || 0}${NNBSP}мин`;
}

/* --- Часовой пояс -------------------------------------------------------- */

/** Смещение в минутах от МСК → «МСК+0», «МСК+2», «МСК-1». */
function mskLabel(offsetMinutesFromMsk) {
  const delta = Math.round((Number(offsetMinutesFromMsk) || 0) / 60);
  return `МСК${delta >= 0 ? "+" : "-"}${Math.abs(delta)}`;
}

/** Нормализует то, что пришло с сервера: «Europe/Moscow» → «МСК+0». */
function timezoneLabel(value) {
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

function toDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (n) => String(n).padStart(2, "0");

/** «09:00» */
function time(value) {
  const d = toDate(value);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "—";
}

/** «04.08» */
function dayMonth(value) {
  const d = toDate(value);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` : "—";
}

/** «6 августа» */
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function dateLong(value) {
  const d = toDate(value);
  return d ? `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}` : "—";
}

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const weekdayShort = (value) => {
  const d = toDate(value);
  return d ? WEEKDAYS_SHORT[d.getDay()] : "—";
};

/** «четверг, 6 августа» — заголовок дня в календаре. */
function dayTitle(value) {
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
function daysBetween(value, from = new Date()) {
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
function relativeDay(value, from = new Date()) {
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
function lessonStamp(lesson, tzLabel = "МСК+0") {
  const d = toDate(lesson?.starts_at);
  if (!d) return "—";
  return `${time(d)} (${dateLong(d)}, ${tzLabel})`;
}

/** Инициалы для аватара: «Михаил Волосов» → «МВ». */
function initials(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

/** Процент 0..100, безопасно. */
function percent(value, goal) {
  const g = Number(goal) || 0;
  if (g <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) / g * 100)));
}

  __x.groupDigits = groupDigits;
  __x.money = money;
  __x.moneySigned = moneySigned;
  __x.hours = hours;
  __x.hoursSigned = hoursSigned;
  __x.minutes = minutes;
  __x.mskLabel = mskLabel;
  __x.timezoneLabel = timezoneLabel;
  __x.toDate = toDate;
  __x.time = time;
  __x.dayMonth = dayMonth;
  __x.dateLong = dateLong;
  __x.weekdayShort = weekdayShort;
  __x.dayTitle = dayTitle;
  __x.daysBetween = daysBetween;
  __x.relativeDay = relativeDay;
  __x.lessonStamp = lessonStamp;
  __x.initials = initials;
  __x.percent = percent;
  __x.NNBSP = NNBSP;
  __x.MSK_OFFSET_MINUTES = MSK_OFFSET_MINUTES;

  });
  __def("ui/student-row.js", (__x, __req) => {
/* Карточка ученика в списке.
 * Полоса заданий даётся в трёх размерах — размер выбирает вызывающий экран,
 * компонент про плотность списка ничего не знает.
 */
const { el, num } = __req("ui/dom.js");
const { Notch } = __req("ui/notch.js");
const { TaskBand } = __req("ui/task-band.js");
const { initials } = __req("core/format.js");
function StudentRow({
  name, meta = "", balance = "", balanceTone = "none",
  next = "", notch, levels = [], bandSize = "tick", onClick,
} = {}) {
  return el(onClick ? "button" : "div", {
    type: onClick ? "button" : null,
    class: "student",
    onClick,
  }, [
    notch ? Notch(notch) : null,
    el("span", { class: "student__avatar", "aria-hidden": "true", text: initials(name) }),
    el("span", { class: "student__main" }, [
      el("span", { class: "student__name", text: name }),
      meta ? el("span", { class: "student__meta", text: meta }) : null,
      levels.length ? TaskBand({ levels, size: bandSize }) : null,
    ]),
    el("span", { class: "student__tail" }, [
      balance ? num(balance, `student__balance student__balance--${balanceTone}`) : null,
      next ? el("span", { class: "student__next", text: next }) : null,
    ]),
    el("span", { class: "student__chevron", "aria-hidden": "true", text: "›" }),
  ]);
}

  __x.StudentRow = StudentRow;

  });
  __def("screens/students.js", (__x, __req) => {
/* Экран «Ученики».
 *
 * Роль не проверяется внутри: действия и признак доступности фильтров
 * приходят в view-model снаружи.
 */
const { el, num, append } = __req("ui/dom.js");
const { ScreenHead } = __req("ui/section.js");
const { Button } = __req("ui/button.js");
const { Field, Select } = __req("ui/field.js");
const { ChipRow } = __req("ui/chip.js");
const { StudentRow } = __req("ui/student-row.js");
const { EmptyState } = __req("ui/feedback.js");
const { PREP_TYPES } = __req("core/dict.js");
const SORTS = [
  { value: "next", label: "Ближайшие" },
  { value: "name", label: "По имени" },
  { value: "price", label: "По стоимости" },
];

function StudentsScreen({
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

function studentsScreenFactory(getModel) {
  return () => ({
    mount(container) {
      container.append(StudentsScreen(getModel()));
    },
  });
}

  __x.StudentsScreen = StudentsScreen;
  __x.studentsScreenFactory = studentsScreenFactory;

  });
  __def("ui/charts.js", (__x, __req) => {
/* График дохода за 7 дней и круговой индикатор прогресса. */
const { el, num } = __req("ui/dom.js");
const { money, groupDigits } = __req("core/format.js");
function IncomeChart({ days = [], showValues = false } = {}) {
  const max = Math.max(...days.map((d) => Number(d.value) || 0), 1);
  return el("figure", { class: "chart" }, [
    el("div", { class: "chart__plot" }, days.map((d) =>
      el("div", { class: "chart__col", title: `${d.label}: ${money(d.value)}` }, [
        showValues ? el("span", { class: "num chart__value", text: groupDigits(d.value) }) : null,
        el("span", {
          class: "chart__bar",
          style: { height: `${Math.max(6, (Number(d.value) || 0) / max * 100)}%` },
        }),
      ]))),
    el("div", { class: "chart__axis" }, days.map((d) =>
      el("span", { class: "num chart__label", text: d.label }))),
  ]);
}

/** Кольцо прогресса. Единственное место с radius-full кроме FAB. */
function ProgressRing({ value = 0, caption = "", size = 72 } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return el("div", { class: "ring", role: "img", "aria-label": `${caption}: ${pct}%` }, [
    el("div", {
      class: "ring__dial",
      style: {
        width: `${size}px`,
        height: `${size}px`,
        background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--border-strong) 0)`,
      },
    }, [
      el("span", { class: "ring__hole" }, [num(`${pct}%`, "ring__value")]),
    ]),
    caption ? el("span", { class: "ring__caption", text: caption }) : null,
  ]);
}

  __x.IncomeChart = IncomeChart;
  __x.ProgressRing = ProgressRing;

  });
  __def("ui/list-items.js", (__x, __req) => {
/* Специализированные строки списков: ДЗ, план, заметка, ссылка, аванс. */
const { el, num } = __req("ui/dom.js");
const { Notch } = __req("ui/notch.js");
function HomeworkRow({ title, meta = "", notch, files = "", link = "", action = null, onClick } = {}) {
  return el("article", { class: "hw" }, [
    notch ? Notch(notch) : null,
    el(onClick ? "button" : "div", { type: onClick ? "button" : null, class: "hw__main", onClick }, [
      el("span", { class: "hw__title", text: title }),
      meta ? el("span", { class: "hw__meta", text: meta }) : null,
      files || link
        ? el("span", { class: "hw__extra" }, [
            files ? num(files, "hw__files") : null,
            link ? el("a", { class: "hw__link", href: link, target: "_blank", rel: "noreferrer", text: "Открыть ссылку" }) : null,
          ])
        : null,
    ]),
    action,
  ]);
}

function PlanRow({ title, meta = "", status = "", done = false, notch, onToggle } = {}) {
  return el("div", { class: `plan${done ? " is-done" : ""}` }, [
    notch ? Notch(notch) : null,
    el("button", {
      type: "button",
      class: `plan__box${done ? " is-checked" : ""}`,
      "aria-pressed": done ? "true" : "false",
      "aria-label": done ? "Снять отметку" : "Отметить выполненным",
      onClick: onToggle,
    }, [el("span", { "aria-hidden": "true", text: done ? "✓" : "" })]),
    el("span", { class: "plan__main" }, [
      el("span", { class: "plan__title", text: title }),
      meta ? num(meta, "plan__meta") : null,
    ]),
    status ? el("span", { class: "plan__status", text: status }) : null,
  ]);
}

function NoteRow({ title, text = "", date = "", notch } = {}) {
  return el("article", { class: "note" }, [
    notch ? Notch(notch) : null,
    el("span", { class: "note__title", text: title }),
    text ? el("p", { class: "note__text", text }) : null,
    date ? num(date, "note__date") : null,
  ]);
}

/** Отсутствующая ссылка остаётся серой строкой: поле есть и его можно заполнить. */
function LinkRow({ label, value = "", href = "" } = {}) {
  const filled = Boolean(value);
  const target = href || (String(value).startsWith("@") ? `https://t.me/${String(value).slice(1)}` : value);
  return el(filled ? "a" : "div", {
    class: `link-row${filled ? "" : " is-empty"}`,
    href: filled ? target : null,
    target: filled ? "_blank" : null,
    rel: filled ? "noreferrer" : null,
  }, [
    el("span", { class: "link-row__label", text: label }),
    el("span", { class: "link-row__value", text: filled ? value : "не указана" }),
    el("span", { class: "link-row__chev", "aria-hidden": "true", text: "›" }),
  ]);
}

function AdvanceRow({ name, meta = "", meta2 = "", left = "", notch, onClick } = {}) {
  return el(onClick ? "button" : "div", {
    type: onClick ? "button" : null,
    class: "advance",
    onClick,
  }, [
    notch ? Notch(notch) : null,
    el("span", { class: "advance__main" }, [
      el("span", { class: "advance__name", text: name }),
      meta ? num(meta, "advance__meta") : null,
      meta2 ? num(meta2, "advance__meta") : null,
    ]),
    left ? num(left, "advance__left") : null,
  ]);
}

/** Полоса заданий с осью и подписями номеров — версия для карточки. */
function TaskChart({ levels = [], goal = 27, toneOf } = {}) {
  const items = Array.from({ length: goal }, (_, i) => Number(levels[i]) || 0);
  return el("div", { class: "task-chart" }, [
    el("div", { class: "task-chart__axis", "aria-hidden": "true" },
      ["10", "8", "6", "4", "2", "0"].map((v) => num(v, "task-chart__tick"))),
    el("div", { class: "task-chart__plot" }, items.map((level, i) =>
      el("span", {
        class: `task-chart__bar task-chart__bar--${toneOf(level)}${level === 0 ? " is-empty" : ""}`,
        style: { height: `${Math.max(4, level * 10)}%` },
        title: `Задание ${i + 1}: ${level}/10`,
      }))),
    el("span", {}),
    el("div", { class: "task-chart__labels", "aria-hidden": "true" },
      items.map((_, i) => num((i + 1) % 2 === 1 ? String(i + 1) : "", "task-chart__label"))),
  ]);
}

  __x.HomeworkRow = HomeworkRow;
  __x.PlanRow = PlanRow;
  __x.NoteRow = NoteRow;
  __x.LinkRow = LinkRow;
  __x.AdvanceRow = AdvanceRow;
  __x.TaskChart = TaskChart;

  });
  __def("screens/student-card.js", (__x, __req) => {
/* Карточка ученика: шесть вкладок из спецификации.
 *
 * Вкладка — это отдельная функция рендера. Активная вкладка монтируется,
 * остальные не строятся вовсе: то же правило, что и у роутера экранов.
 */
const { el, num } = __req("ui/dom.js");
const { DetailHeader, CardTabs, SectionCaption, DayHeader } = __req("ui/section.js");
const { NextLessonCard, StatCell, StatGrid, FinanceBar, FactRow } = __req("ui/stat.js");
const { ProgressRing } = __req("ui/charts.js");
const { Button, IconButton } = __req("ui/button.js");
const { LessonRow } = __req("ui/rows.js");
const { HomeworkRow, PlanRow, NoteRow, LinkRow, TaskChart } = __req("ui/list-items.js");
const { EmptyState } = __req("ui/feedback.js");
const { levelTone } = __req("core/dict.js");
const CARD_TABS = [
  { value: "profile", label: "Профиль" },
  { value: "lessons", label: "Уроки" },
  { value: "homeworks", label: "Домашки" },
  { value: "payments", label: "Оплаты" },
  { value: "notes", label: "Заметки" },
  { value: "files", label: "Файлы" },
];

const QUICK_ACTIONS = [
  ["addLesson", "Добавить урок"],
  ["addHomework", "Добавить ДЗ"],
  ["addPayment", "Добавить оплату"],
  ["addNote", "Добавить заметку"],
];

function hero(student) {
  return el("div", { class: "student-hero" }, [
    el("span", { class: "student-hero__avatar", "aria-hidden": "true", text: student.initials }),
    el("span", { class: "student-hero__main" }, [
      el("span", { class: "student-hero__facts" },
        student.facts.flatMap((f, i) => (i ? [el("span", { class: "student-hero__dot", text: "·" }), f] : [f]))),
      el("h1", { class: "student-hero__name", text: student.name }),
      student.goal ? el("span", { class: "student-hero__goal", text: student.goal }) : null,
    ]),
  ]);
}

function profileTab(model, actions) {
  const s = model.student;
  const box = el("div", {});
  box.append(
    NextLessonCard({ when: s.nextWhen, meta: s.nextMeta, price: s.nextPrice, notch: s.nextNotch }),
    SectionCaption({ title: "Статистика ученика" }),
    el("div", { class: "screen__pad student-progress" }, [
      ProgressRing({ value: s.progressPercent, caption: "", size: 84 }),
      el("span", { class: "student-progress__copy" }, [
        el("span", { class: "student-progress__title", text: "Общий прогресс подготовки" }),
        el("span", { class: "student-progress__goal", text: `Цель: ${s.progressGoal} %` }),
      ]),
    ]),
    StatGrid({
      columns: 3,
      cells: [
        StatCell({ value: s.conducted, label: "Посещено" }),
        StatCell({ value: s.cancelled, label: "Отменено", tone: "debt" }),
        StatCell({ value: s.mockValue, label: s.mockLabel }),
      ],
    }),
    SectionCaption({ title: "Быстрые действия" }),
    el("div", { class: "quick-grid" }, QUICK_ACTIONS.map(([key, label]) =>
      el("button", { type: "button", class: "quick-grid__item", onClick: actions[key] || null }, [
        el("span", { class: "num quick-grid__plus", "aria-hidden": "true", text: "+" }),
        label,
      ]))),
    SectionCaption({
      title: "Прогресс по заданиям ЕГЭ",
      action: Button({ kind: "inline", label: "Подробнее", onClick: actions.openProgress }),
    }),
    TaskChart({ levels: s.levels, goal: s.levelsGoal, toneOf: levelTone }),
  );

  if (actions.cleanupSchedule) {
    box.append(
      SectionCaption({ title: "Стабильное расписание" }),
      el("div", { class: "screen__pad" }, [
        el("p", { class: "screen__note", text: "Удалит правила повторения и отправит будущие неоплаченные занятия в архив. Проведённые, прошедшие и оплаченные останутся на месте." }),
        Button({ kind: "danger", label: "Очистить стабильное расписание", full: true, onClick: actions.cleanupSchedule }),
      ]),
    );
  }

  if (model.taskNotes.length) {
    box.append(SectionCaption({ title: "Заметки по заданиям", count: model.taskNotes.length }));
    box.append(el("div", { class: "list" }, model.taskNotes.map((n) =>
      el("article", { class: "task-note" }, [
        n.notch ? el("span", { class: `notch notch--${n.notch.tone} notch--${n.notch.mark}` }) : null,
        num(n.number, "task-note__num"),
        num(n.percent, "task-note__pct"),
        el("span", { class: "task-note__main" }, [
          el("span", { class: "task-note__label", text: n.label }),
          el("span", { class: "task-note__text", text: n.text }),
        ]),
      ]))));
  }
  return box;
}

function lessonsTab(model, actions) {
  const box = el("div", {});
  const s = model.student;
  box.append(NextLessonCard({
    when: s.nextWhen,
    notch: s.nextNotch,
    action: Button({ kind: "second", label: "Открыть", onClick: actions.openNextLesson }),
  }));
  box.append(SectionCaption({ title: "Последние занятия", count: model.lessonsCount }));
  if (!model.lessonDays.length) {
    box.append(EmptyState({ title: "Уроков пока нет", description: "Здесь появятся прошедшие и запланированные занятия ученика." }));
    return box;
  }
  for (const day of model.lessonDays) {
    box.append(DayHeader({ title: day.title, total: day.total }));
    box.append(el("div", { class: "list" }, day.items.map((l) => LessonRow({
      time: l.time, name: l.topic, price: l.price,
      lessonStatus: l.lessonStatus, paymentStatus: l.paymentStatus,
      onClick: actions.openLesson ? () => actions.openLesson(l.id) : null,
    }))));
  }
  return box;
}

function homeworksTab(model, actions) {
  const box = el("div", {});
  box.append(SectionCaption({
    title: "Домашки",
    count: model.homeworks.length,
    action: Button({ kind: "second", label: "Создать домашку", onClick: actions.addHomework }),
  }));
  box.append(model.homeworks.length
    ? el("div", { class: "list" }, model.homeworks.map((h) => HomeworkRow({
        title: h.title, meta: h.meta, notch: h.notch,
        action: IconButton({ glyph: "⋯", label: "Действия", onClick: actions.openHomework ? () => actions.openHomework(h.id) : null }),
      })))
    : EmptyState({ title: "Домашек пока нет", description: "Здесь будут все домашние задания ученика." }));
  return box;
}

function paymentsTab(model, actions) {
  const box = el("div", {});
  const f = model.finance;
  box.append(SectionCaption({
    title: "Финансы",
    action: Button({ kind: "second", label: "Добавить оплату", onClick: actions.addPayment }),
  }));
  box.append(el("div", { class: "screen__pad" }, [
    FinanceBar({ paid: f.paidShare, waiting: f.waitingShare, debt: f.debtShare }),
    el("div", { class: "fact-list" }, [
      FactRow({ label: "Ученик оплатил", value: f.paidHours }),
      FactRow({ label: "Долги", value: f.debt, tone: f.debtTone }),
    ]),
  ]));
  box.append(SectionCaption({ title: "История оплат" }));
  for (const day of model.paymentDays) {
    box.append(DayHeader({ title: day.title, total: day.total }));
    box.append(el("div", { class: "list" }, day.items.map((o) =>
      el("article", { class: "op" }, [
        o.notch ? el("span", { class: `notch notch--${o.notch.tone} notch--${o.notch.mark}` }) : null,
        el("span", { class: "op__main" }, [
          el("span", { class: "op__name", text: o.name }),
          num(o.meta, "op__meta"),
        ]),
        o.pill,
      ]))));
  }
  box.append(SectionCaption({ title: "Ожидают оплаты", count: model.unpaid.length }));
  box.append(model.unpaid.length
    ? el("div", { class: "list" }, model.unpaid.map((u) =>
        el("article", { class: "op" }, [
          u.notch ? el("span", { class: `notch notch--${u.notch.tone} notch--${u.notch.mark}` }) : null,
          el("span", { class: "op__main" }, [
            el("span", { class: "op__name", text: u.name }),
            num(u.meta, "op__meta"),
          ]),
          Button({ kind: "second", label: "Добавить оплату", onClick: actions.addPayment }),
        ])))
    : EmptyState({ title: "Нет неоплаченных занятий", description: "Проведённые неоплаченные уроки ученика будут видны здесь." }));
  return box;
}

function notesTab(model, actions) {
  const box = el("div", {});
  box.append(SectionCaption({
    title: "Заметки о ученике",
    action: Button({ kind: "second", label: "Добавить", onClick: actions.addNote }),
  }));
  box.append(model.notes.length
    ? el("div", { class: "list" }, model.notes.map((n) => NoteRow({ title: n.title, text: n.text, date: n.date, notch: n.notch })))
    : EmptyState({ title: "Заметок пока нет.", description: "Запишите, что разобрали и что проверить в следующий раз." }));
  box.append(SectionCaption({
    title: "План",
    action: Button({ kind: "second", label: "Пункт", onClick: actions.addPlanItem }),
  }));
  box.append(model.plan.length
    ? el("div", { class: "list" }, model.plan.map((p) => PlanRow({
        title: p.title, meta: p.meta, status: p.status, done: p.done, notch: p.notch,
        onToggle: actions.togglePlanItem ? () => actions.togglePlanItem(p.id) : null,
      })))
    : EmptyState({ title: "План пуст", description: "Добавьте пункт с дедлайном." }));
  return box;
}

function filesTab(model) {
  const box = el("div", {});
  box.append(SectionCaption({ title: "Ссылки" }));
  box.append(el("div", { class: "list" }, model.links.map((l) => LinkRow({ label: l.label, value: l.value }))));
  box.append(el("p", { class: "screen__note", text: "Отсутствующая ссылка остаётся в списке серой строкой — она показывает, что поле есть и его можно заполнить. Telegram-хендл превращается в ссылку t.me автоматически." }));
  return box;
}

const TAB_RENDERERS = {
  profile: profileTab,
  lessons: lessonsTab,
  homeworks: homeworksTab,
  payments: paymentsTab,
  notes: notesTab,
  files: filesTab,
};

function StudentCardScreen({ model, tab = "profile", actions = {} } = {}) {
  const render = TAB_RENDERERS[tab] || profileTab;
  return el("section", { class: "screen screen--student-card" }, [
    DetailHeader({
      title: model.student.name,
      onBack: actions.back,
      actions: [
        IconButton({ glyph: "✎", label: "Редактировать", onClick: actions.edit }),
        IconButton({ glyph: "⧉", label: "Ссылка доступа", onClick: actions.invite }),
      ],
    }),
    hero(model.student),
    CardTabs({ items: CARD_TABS, value: tab, onSelect: actions.setTab }),
    render(model, actions),
  ]);
}

  __x.CARD_TABS = CARD_TABS;
  __x.StudentCardScreen = StudentCardScreen;

  });
  __def("screens/homeworks.js", (__x, __req) => {
/* Экран «Домашние задания».
 *
 * «Просрочено» считается на клиенте: дедлайн в прошлом и статус не
 * «выполнено». Само значение статуса при этом не подменяется — в базу
 * уходит то, что пришло оттуда.
 */
const { el, append } = __req("ui/dom.js");
const { ScreenHead } = __req("ui/section.js");
const { Button, IconButton } = __req("ui/button.js");
const { Segmented } = __req("ui/chip.js");
const { HomeworkRow } = __req("ui/list-items.js");
const { EmptyState } = __req("ui/feedback.js");
const HOMEWORK_FILTERS = [
  { value: "all", label: "Все" },
  { value: "work", label: "В работе" },
  { value: "done", label: "Выполнены" },
  { value: "overdue", label: "Просрочены" },
  { value: "archive", label: "Архив" },
];

function HomeworksScreen({
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

  __x.HOMEWORK_FILTERS = HOMEWORK_FILTERS;
  __x.HomeworksScreen = HomeworksScreen;

  });
  __def("ui/swipe-row.js", (__x, __req) => {
/* Свайп по строке справа налево.
 *
 * Под строкой лежит одно действие. Пороги те же, что у модалки: 110 px
 * либо 48 px при скорости выше 0.55 px/мс — чтобы жест ощущался одинаково
 * во всём продукте.
 *
 * Действие выполняется сразу, но вызывающий обязан дать отмену: свайп
 * легко сделать случайно, а речь о деньгах.
 */
const { el } = __req("ui/dom.js");
const COMMIT = 110;
const FAST = 48;
const VELOCITY = 0.55;

function haptic() {
  globalThis.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("medium");
}

function SwipeRow({ content, actionLabel = "Готово", tone = "debt", onCommit } = {}) {
  const surface = el("div", { class: "swipe__surface" }, [content]);
  const action = el("button", {
    type: "button",
    class: `swipe__action swipe__action--${tone}`,
    text: actionLabel,
    onClick: () => commit(),
  });
  const root = el("div", { class: "swipe" }, [action, surface]);

  let startX = 0, lastX = 0, lastAt = 0, velocity = 0, dragging = false, done = false;

  function reset() {
    dragging = false;
    surface.classList.remove("is-dragging");
    surface.style.removeProperty("--swipe-x");
  }

  function commit() {
    if (done) return;
    done = true;
    haptic();
    surface.style.setProperty("--swipe-x", "-100%");
    root.classList.add("is-committed");
    onCommit?.();
  }

  surface.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || done) return;
    startX = lastX = event.touches[0].clientX;
    lastAt = performance.now();
    velocity = 0;
  }, { passive: true });

  surface.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 1 || done) return;
    const x = event.touches[0].clientX;
    const delta = x - startX;
    const now = performance.now();
    velocity = (lastX - x) / Math.max(now - lastAt, 1);
    lastX = x;
    lastAt = now;
    if (delta > 0 && !dragging) return;      // тянут вправо — не наш жест
    if (!dragging && delta > -8) return;
    dragging = true;
    event.preventDefault();
    surface.classList.add("is-dragging");
    surface.style.setProperty("--swipe-x", `${Math.max(delta, -160)}px`);
  }, { passive: false });

  surface.addEventListener("touchend", () => {
    if (!dragging) return reset();
    const dragX = Math.max(0, startX - lastX);
    if (dragX >= COMMIT || (dragX > FAST && velocity > VELOCITY)) return commit();
    reset();
  }, { passive: true });

  surface.addEventListener("touchcancel", reset, { passive: true });

  return root;
}

  __x.SwipeRow = SwipeRow;

  });
  __def("screens/finances.js", (__x, __req) => {
/* Экран «Финансы».
 *
 * Шесть KPI — ячейки табло 3×2: цифра mono крупно, подпись капителью,
 * засечка кодирует смысл. Плитка долга при нуле теряет засечку и уходит в
 * приглушённый текст.
 */
const { el, num } = __req("ui/dom.js");
const { ScreenHead, SectionCaption, DayHeader, Collapsible } = __req("ui/section.js");
const { StatCell, StatGrid } = __req("ui/stat.js");
const { Button } = __req("ui/button.js");
const { Select } = __req("ui/field.js");
const { IncomeChart } = __req("ui/charts.js");
const { AdvanceRow } = __req("ui/list-items.js");
const { OperationRow } = __req("ui/rows.js");
const { SwipeRow } = __req("ui/swipe-row.js");
const { EmptyState } = __req("ui/feedback.js");
const { paymentStatusOptions } = __req("core/dict.js");
const OPERATION_FILTERS = () => [
  { value: "", label: "Все операции" },
  ...paymentStatusOptions().map((s) => ({ value: s.value, label: s.label })),
  { value: "подтверждено", label: "подтверждено" },
  { value: "ожидает подтверждения", label: "ожидает подтверждения" },
];

function FinancesScreen({
  kpi = [],
  income = [],
  incomeTotal = "",
  advances = [],
  operationDays = [],
  operationsCount = 0,
  operationsOpen = false,
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

  // История по всей базе длинная, поэтому по умолчанию свёрнута.
  const history = el("div", { class: "history" });
  if (operationsOpen) {
    history.append(el("div", { class: "screen__pad" }, [
      Select({ value: filter, options: OPERATION_FILTERS(), onChange: actions.setFilter }),
    ]));
    if (!operationDays.length) {
      history.append(EmptyState({
        title: "Операций нет",
        description: "Подтверждённые и ожидающие оплаты появятся здесь.",
      }));
    }
    for (const day of operationDays) {
      history.append(DayHeader({ title: day.title, total: day.total }));
      history.append(el("div", { class: "list" }, day.items.map((o) => OperationRow({
        name: o.name, meta: o.meta, notch: o.notch, tail: o.tail,
      }))));
    }
  }
  root.append(Collapsible({
    title: "История операций",
    count: operationsCount,
    open: operationsOpen,
    onToggle: actions.toggleOperations,
    content: history,
  }));

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
  if (unpaid.length) {
    root.append(el("p", { class: "screen__note", text: unpaid.some((u) => !u.hasAdvance)
      ? "Проведите по строке справа налево, чтобы закрыть долг. Занятия, покрытые авансом, списываются сами."
      : "Эти занятия покрыты авансом — он спишется сам, вручную отмечать не нужно." }));
  }
  root.append(unpaid.length
    // Свайп закрывает долг сразу, поэтому вызывающий обязан дать отмену.
    // Строки с авансом не свайпаются: там статус ставит не репетитор.
    ? el("div", { class: "list" }, unpaid.map((u) => {
        const row = OperationRow({ name: u.name, meta: u.meta, notch: u.notch, tail: u.tail });
        if (u.hasAdvance) return row;
        return SwipeRow({
          content: row,
          actionLabel: "Закрыть долг",
          onCommit: actions.closeDebt ? () => actions.closeDebt(u.id) : null,
        });
      }))
    : EmptyState({
        title: "Все проведённые занятия оплачены",
        description: "Неоплаченные появятся здесь сразу после того, как вы отметите занятие проведённым.",
      }));

  return root;
}

  __x.FinancesScreen = FinancesScreen;

  });
  __def("screens/tutor-profile.js", (__x, __req) => {
/* Экран «Профиль репетитора».
 *
 * Списки предметов и подготовок — те же справочники, что видят новые ученики
 * в анкете. Редкие варианты добавляются строками в текстовые поля.
 */
const { el } = __req("ui/dom.js");
const { DetailHeader, SectionCaption } = __req("ui/section.js");
const { Button } = __req("ui/button.js");
const { Field } = __req("ui/field.js");
const { SUBJECTS, PREP_TYPES } = __req("core/dict.js");
const WEEKDAYS = [
  [1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [7, "Вс"],
];

function CheckChip({ label, on = false, onToggle } = {}) {
  return el("button", {
    type: "button",
    class: `check-chip${on ? " is-on" : ""}`,
    "aria-pressed": on ? "true" : "false",
    onClick: onToggle,
  }, [
    el("span", { class: "check-chip__box", "aria-hidden": "true", text: on ? "✓" : "" }),
    label,
  ]);
}

function TextArea({ label, value = "", placeholder = "", onInput } = {}) {
  return el("label", { class: "field" }, [
    el("span", { class: "field__label", text: label }),
    el("textarea", {
      class: "field__area",
      value,
      placeholder,
      onInput: onInput ? (e) => onInput(e.target.value) : null,
    }),
  ]);
}

function TutorProfileScreen({
  profile = {},
  subjects = [],
  prepTypes = [],
  workingDays = [1, 2, 3, 4, 5, 6, 7],
  actions = {},
} = {}) {
  const customSubjects = subjects.filter((s) => !SUBJECTS.includes(s));
  const customPrep = prepTypes.filter((p) => !PREP_TYPES.includes(p));

  return el("section", { class: "screen screen--profile" }, [
    DetailHeader({
      title: "Профиль",
      onBack: actions.back,
      actions: [Button({ kind: "second", label: "Ссылка кабинета", onClick: actions.invite })],
    }),
    el("div", { class: "screen__pad form-stack" }, [
      Field({ label: "ФИО", value: profile.full_name || "", state: profile.full_name ? "filled" : "empty", onInput: actions.setName }),
      Field({ label: "Стаж", value: profile.experience || "", mono: true, state: profile.experience ? "filled" : "empty", onInput: actions.setExperience }),
      TextArea({ label: "Описание", value: profile.description || "", onInput: actions.setDescription }),
    ]),

    SectionCaption({ title: "Предметы" }),
    el("div", { class: "screen__pad" }, [
      el("div", { class: "chip-row" }, SUBJECTS.map((s) => CheckChip({
        label: s,
        on: subjects.includes(s),
        onToggle: actions.toggleSubject ? () => actions.toggleSubject(s) : null,
      }))),
      TextArea({
        label: "Другие предметы · каждый с новой строки",
        value: customSubjects.join("\n"),
        onInput: actions.setCustomSubjects,
      }),
    ]),

    SectionCaption({ title: "Подготовки" }),
    el("div", { class: "screen__pad" }, [
      el("div", { class: "chip-row" }, PREP_TYPES.map((p) => CheckChip({
        label: p,
        on: prepTypes.includes(p),
        onToggle: actions.togglePrepType ? () => actions.togglePrepType(p) : null,
      }))),
      TextArea({
        label: "Другие подготовки · каждая с новой строки",
        value: customPrep.join("\n"),
        onInput: actions.setCustomPrepTypes,
      }),
    ]),

    SectionCaption({ title: "Рабочие дни" }),
    el("div", { class: "screen__pad" }, [
      el("div", { class: "weekdays" }, WEEKDAYS.map(([value, label]) =>
        el("button", {
          type: "button",
          class: `weekday${workingDays.includes(value) ? " is-on" : ""}`,
          "aria-pressed": workingDays.includes(value) ? "true" : "false",
          text: label,
          onClick: actions.toggleWorkingDay ? () => actions.toggleWorkingDay(value) : null,
        }))),
      el("p", { class: "screen__note", text: "Эти варианты увидят новые ученики в анкете. Редкие варианты можно добавить строками выше." }),
      Button({ kind: "main", label: "Сохранить профиль", full: true, onClick: actions.save }),
    ]),
  ]);
}

  __x.TutorProfileScreen = TutorProfileScreen;

  });
  __def("screens/client.js", (__x, __req) => {
/* Кабинет ученика и родителя.
 *
 * Те же компоненты, что у репетитора, с другим набором действий. Разница
 * между ролями живёт ТОЛЬКО в переданных actions и флагах доступа —
 * ветвлений `if (role === ...)` внутри разметки нет.
 */
const { el, num } = __req("ui/dom.js");
const { ScreenHead, SectionCaption, DayHeader } = __req("ui/section.js");
const { StatCell, StatGrid } = __req("ui/stat.js");
const { Button } = __req("ui/button.js");
const { Segmented } = __req("ui/chip.js");
const { StatusPill } = __req("ui/status-pill.js");
const { Notch } = __req("ui/notch.js");
const { TaskChart, PlanRow, LinkRow } = __req("ui/list-items.js");
const { EmptyState } = __req("ui/feedback.js");
const { levelTone } = __req("core/dict.js");
/* --- Обзор ---------------------------------------------------------------- */

function ClientOverviewScreen({ student, metrics = [], levels = [], levelsGoal = 27 } = {}) {
  return el("section", { class: "screen screen--client-overview" }, [
    el("div", { class: "client-hero" }, [
      el("span", { class: "client-hero__eyebrow", text: student.eyebrow }),
      el("div", { class: "client-hero__row" }, [
        el("span", { class: "client-hero__main" }, [
          el("h1", { class: "client-hero__name", text: student.name }),
          student.goal ? el("span", { class: "client-hero__goal", text: student.goal }) : null,
        ]),
        el("span", { class: "client-hero__next" }, [
          el("span", { class: "client-hero__cap", text: "ближайшее" }),
          num(student.next, "client-hero__when"),
        ]),
      ]),
    ]),
    StatGrid({
      columns: 2,
      cells: metrics.map((m) => StatCell({ value: m.value, label: m.label, notch: m.notch, tone: m.tone })),
    }),
    SectionCaption({ title: "Статистика подготовки", action: num("0–10") }),
    TaskChart({ levels, goal: levelsGoal, toneOf: levelTone }),
  ]);
}

/* --- Календарь ------------------------------------------------------------ */

function ClientCalendarScreen({
  period = "", mode = "week", summary = [], days = [], actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--client-calendar" });
  root.append(
    ScreenHead({ title: "Календарь", count: period }),
    el("div", { class: "screen__seg" }, [
      Segmented({
        items: [{ value: "day", label: "День" }, { value: "week", label: "Неделя" }, { value: "month", label: "Месяц" }],
        value: mode, label: "Режим календаря", onSelect: actions.setMode,
      }),
    ]),
    StatGrid({ columns: 4, cells: summary.map((s) => StatCell({ value: s.value, label: s.label, tone: s.tone })) }),
  );

  if (!days.length) {
    root.append(EmptyState({ title: "Занятий нет", description: "Записаться можно кнопкой в чате с преподавателем." }));
    return root;
  }

  for (const day of days) {
    root.append(DayHeader({ title: day.title }));
    root.append(el("div", { class: "list" }, day.items.map((l) =>
      el("article", { class: "client-lesson" }, [
        l.lessonStatus ? Notch(l.lessonStatus) : null,
        el("span", { class: "client-lesson__time" }, [
          num(l.time, "client-lesson__hh"),
          num(l.duration, "client-lesson__dur"),
        ]),
        el("span", { class: "client-lesson__main" }, [
          el("span", { class: "client-lesson__name", text: l.name }),
          l.meta ? el("span", { class: "client-lesson__meta", text: l.meta }) : null,
        ]),
        l.paymentStatus ? StatusPill(l.paymentStatus) : null,
        // Набор действий приходит снаружи: у ученика он один, у родителя другой.
        l.actions?.length ? el("span", { class: "client-lesson__actions" }, l.actions) : null,
      ]))));
  }
  return root;
}

/* --- Прогресс ------------------------------------------------------------- */

function ClientProgressScreen({
  current = 0, goal = 0, levels = [], levelsGoal = 27,
  taskNotes = [], plan = [], canEdit = false, actions = {},
} = {}) {
  const root = el("section", { class: "screen screen--client-progress" });
  root.append(ScreenHead({ title: "Прогресс", count: `${current} / ${goal} %` }));

  root.append(el("div", { class: "screen__pad" }, [
    canEdit
      ? el("div", { class: "action-triplet" }, [
          Button({ kind: "second", label: "Изменить", onClick: actions.editProgress }),
          Button({ kind: "second", label: "Заметка", onClick: actions.addNote }),
          Button({ kind: "second", label: "План", onClick: actions.addPlanItem }),
        ])
      : el("p", { class: "readonly-note", text: "Родитель видит прогресс, заметки и план на чтение. Менять уровни может ученик или преподаватель." }),
  ]));

  root.append(TaskChart({ levels, goal: levelsGoal, toneOf: levelTone }));

  root.append(SectionCaption({ title: "Заметки по заданиям", count: taskNotes.length }));
  root.append(el("div", { class: "list" }, taskNotes.map((n) =>
    el("article", { class: "task-note" }, [
      n.notch ? Notch(n.notch) : null,
      num(n.number, "task-note__num"),
      num(n.percent, "task-note__pct"),
      el("span", { class: "task-note__main" }, [
        el("span", { class: "task-note__label", text: n.label }),
        el("span", { class: "task-note__text", text: n.text }),
      ]),
    ]))));

  root.append(SectionCaption({ title: "План" }));
  root.append(plan.length
    ? el("div", { class: "list" }, plan.map((p) => PlanRow({
        title: p.title, meta: p.meta, status: p.status, done: p.done, notch: p.notch,
        onToggle: canEdit && actions.togglePlanItem ? () => actions.togglePlanItem(p.id) : null,
      })))
    : EmptyState({ title: "План пуст", description: "Преподаватель добавит пункты подготовки." }));
  return root;
}

/* --- Оплаты --------------------------------------------------------------- */

function ClientPaymentsScreen({ rate = "", debt = null, days = [], unpaid = [], actions = {} } = {}) {
  const root = el("section", { class: "screen screen--client-payments" });
  root.append(ScreenHead({ title: "Оплаты", count: rate }));

  if (debt) {
    root.append(el("div", { class: "debt-card" }, [
      Notch(debt.notch),
      el("span", { class: "debt-card__cap", text: "Долг" }),
      num(debt.amount, "debt-card__value"),
      el("span", { class: "debt-card__meta", text: debt.meta }),
    ]));
  }

  root.append(SectionCaption({ title: "Список оплат" }));
  for (const day of days) {
    root.append(DayHeader({ title: day.title, total: day.total }));
    root.append(el("div", { class: "list" }, day.items.map((o) =>
      el("article", { class: "op" }, [
        o.notch ? Notch(o.notch) : null,
        el("span", { class: "op__main" }, [
          el("span", { class: "op__name", text: o.name }),
          num(o.meta, "op__meta"),
        ]),
        o.pill,
      ]))));
  }

  root.append(SectionCaption({ title: "Ожидают оплаты", count: unpaid.length }));
  root.append(unpaid.length
    ? el("div", { class: "list" }, unpaid.map((u) =>
        el("article", { class: "op" }, [
          u.notch ? Notch(u.notch) : null,
          el("span", { class: "op__main" }, [
            el("span", { class: "op__name", text: u.name }),
            num(u.meta, "op__meta"),
          ]),
          actions.markPaid ? Button({ kind: "second", label: "Отметить оплату", onClick: () => actions.markPaid(u.id) }) : null,
        ])))
    : EmptyState({ title: "Всё оплачено", description: "Неоплаченные занятия появятся здесь после того, как преподаватель отметит их проведёнными." }));
  return root;
}

/* --- Профиль · просмотр --------------------------------------------------- */

function ClientProfileScreen({ facts = [], links = [], canEdit = false, canDelete = false, actions = {} } = {}) {
  return el("section", { class: "screen screen--client-profile" }, [
    ScreenHead({
      title: "Профиль",
      primary: canEdit ? Button({ kind: "second", label: "Редактировать", full: true, onClick: actions.edit }) : null,
    }),
    el("div", { class: "list" }, facts.map((f) =>
      el("div", { class: "info-row" }, [
        el("span", { class: "info-row__label", text: f.label }),
        el("span", { class: "info-row__value", text: f.value }),
      ]))),
    SectionCaption({ title: "Ссылки" }),
    el("div", { class: "list" }, links.map((l) => LinkRow({ label: l.label, value: l.value }))),
    canDelete
      ? el("div", { class: "screen__pad" }, [Button({ kind: "danger", label: "Удалить профиль", full: true, onClick: actions.remove })])
      : null,
  ]);
}

  __x.ClientOverviewScreen = ClientOverviewScreen;
  __x.ClientCalendarScreen = ClientCalendarScreen;
  __x.ClientProgressScreen = ClientProgressScreen;
  __x.ClientPaymentsScreen = ClientPaymentsScreen;
  __x.ClientProfileScreen = ClientProfileScreen;

  });
  __def("ui/pickers.js", (__x, __req) => {
/* Особые контролы: длительность, свободные окна, часовой пояс, поле «другое». */
const { el, num } = __req("ui/dom.js");
const DURATIONS = [60, 90, 120];

function DurationPicker({ value = 60, onSelect, allowCustom = true } = {}) {
  const items = DURATIONS.map((d) => el("button", {
    type: "button",
    class: `seg-pick__item${Number(value) === d ? " is-active" : ""}`,
    "aria-pressed": Number(value) === d ? "true" : "false",
    text: `${d} мин`,
    onClick: onSelect ? () => onSelect(d) : null,
  }));
  if (allowCustom) {
    items.push(el("button", {
      type: "button",
      class: `seg-pick__item${DURATIONS.includes(Number(value)) ? "" : " is-active"}`,
      text: "другое",
      onClick: onSelect ? () => onSelect("custom") : null,
    }));
  }
  return el("div", { class: "field" }, [
    el("span", { class: "field__label", text: "Длительность" }),
    el("div", { class: "seg-pick" }, items),
  ]);
}

/** Свободные окна: чипы, сгруппированные по дням. Горизонт задаёт вызывающий. */
function FreeSlots({ days = [], duration = 60, onPick, note = "" } = {}) {
  if (!days.length) {
    return el("div", { class: "free-slots" }, [
      el("p", { class: "screen__note", text: "Свободных окон нет. На выбранный горизонт подходящих окон не нашлось." }),
    ]);
  }
  return el("div", { class: "free-slots" }, [
    note ? el("p", { class: "screen__note", text: note }) : null,
    ...days.map((day) => el("div", { class: "free-slots__day" }, [
      el("span", { class: "free-slots__title", text: day.title }),
      el("div", { class: "free-slots__grid" }, day.slots.map((slot) =>
        el("button", {
          type: "button",
          class: "slot-chip",
          onClick: onPick ? () => onPick(slot.value) : null,
        }, [
          num(slot.time, "slot-chip__time"),
          el("span", { class: "slot-chip__dur", text: `${duration} мин` }),
        ]))),
    ])),
  ]);
}

/** Выбор с вариантом «другое»: при выборе раскрывается текстовый ввод. */
function ChoiceWithOther({ label, options = [], value = "", onChange } = {}) {
  const isOther = value && !options.includes(value);
  const select = el("select", {
    class: "field__input field__input--select",
    onChange: onChange ? (e) => onChange(e.target.value === "другое" ? "" : e.target.value) : null,
  }, [
    ...options.map((o) => el("option", { value: o, selected: o === value, text: o })),
    el("option", { value: "другое", selected: isOther, text: "другое" }),
  ]);
  return el("label", { class: "field" }, [
    el("span", { class: "field__label", text: label }),
    el("span", { class: "field__box" }, [select, el("span", { class: "field__tail", "aria-hidden": "true", text: "▾" })]),
    isOther
      ? el("input", {
          class: "field__box field__input",
          value,
          placeholder: "Свой вариант",
          onInput: onChange ? (e) => onChange(e.target.value) : null,
        })
      : null,
  ]);
}

  __x.DurationPicker = DurationPicker;
  __x.FreeSlots = FreeSlots;
  __x.ChoiceWithOther = ChoiceWithOther;

  });
  __def("screens/service.js", (__x, __req) => {
/* Служебные экраны: регистрация гостя, загрузка, ошибка. */
const { el, num } = __req("ui/dom.js");
const { Button } = __req("ui/button.js");
const { Field, Select } = __req("ui/field.js");
const { Segmented } = __req("ui/chip.js");
const { ChoiceWithOther } = __req("ui/pickers.js");
const { SUBJECTS, PREP_TYPES } = __req("core/dict.js");
const PARENT_RIGHTS = [
  { value: "false", label: "Только статистика и оплата" },
  { value: "true", label: "Может редактировать календарь" },
];

/**
 * Регистрация гостя.
 * Две формы не рядом, а за сегментированным контролом: на 380 px две
 * колонки анкет не помещаются.
 */
function RegisterScreen({ role = "student", values = {}, actions = {} } = {}) {
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
function LoadingScreen({ title = "Подключаю кабинет…", note = "Первый запуск ссылки в браузере может занять несколько секунд." } = {}) {
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
function ErrorScreen({
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

  __x.RegisterScreen = RegisterScreen;
  __x.LoadingScreen = LoadingScreen;
  __x.ErrorScreen = ErrorScreen;

  });
  __def("ui/modal.js", (__x, __req) => {
/* Модалка.
 *
 * Закрытие: тапом по фону, кнопкой и свайпом вниз. Пороги свайпа заданы
 * дизайном: 110 px либо 48 px при скорости выше 0.55 px/мс.
 *
 * Скролл фона блокируется с сохранением позиции: body переводится в
 * position:fixed со сдвигом top, при закрытии позиция возвращается. Без
 * этого Telegram WebView отматывает список в начало.
 */
const { el } = __req("ui/dom.js");
const { IconButton } = __req("ui/button.js");
const SWIPE_CLOSE = 110;
const SWIPE_FAST = 48;
const SWIPE_VELOCITY = 0.55;

let savedScrollTop = 0;
let openCount = 0;

function lockScroll() {
  if (openCount++ > 0) return;
  savedScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${savedScrollTop}px`;
  document.body.classList.add("is-modal-open");
}

function unlockScroll() {
  if (--openCount > 0) return;
  openCount = 0;
  document.body.classList.remove("is-modal-open");
  document.body.style.top = "";
  window.scrollTo(0, savedScrollTop);
}

function haptic() {
  globalThis.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
}

function Modal({ title, body, footer = null, onClose } = {}) {
  const sheet = el("section", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title });
  const backdrop = el("div", { class: "modal-backdrop" }, [sheet]);

  let closed = false;
  function close({ animate = true } = {}) {
    if (closed) return;
    closed = true;
    const finish = () => {
      backdrop.remove();
      unlockScroll();
      onClose?.();
    };
    if (!animate) return finish();
    backdrop.classList.add("is-closing");
    setTimeout(finish, 180);
  }

  sheet.append(
    el("span", { class: "modal__handle", "aria-hidden": "true" }),
    el("div", { class: "modal__head" }, [
      el("h2", { class: "modal__title", text: title }),
      IconButton({ glyph: "✕", label: "Закрыть", onClick: () => close() }),
    ]),
    el("div", { class: "modal__body" }, Array.isArray(body) ? body : [body]),
    footer ? el("div", { class: "modal__footer" }, Array.isArray(footer) ? footer : [footer]) : null,
  );

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  document.addEventListener("keydown", function onKey(event) {
    if (event.key !== "Escape") return;
    if (!backdrop.isConnected) return document.removeEventListener("keydown", onKey);
    close();
  });

  // --- свайп вниз ---
  let startY = 0, lastY = 0, lastAt = 0, velocity = 0, dragging = false, canDrag = false;

  const reset = () => {
    dragging = false;
    canDrag = false;
    sheet.classList.remove("is-dragging");
    sheet.style.removeProperty("--drag-y");
  };

  sheet.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    startY = lastY = event.touches[0].clientY;
    lastAt = performance.now();
    velocity = 0;
    // тянуть можно только от ручки или шапки и только с самого верха списка
    canDrag = sheet.scrollTop <= 1 && Boolean(event.target.closest(".modal__handle, .modal__head"));
  }, { passive: true });

  sheet.addEventListener("touchmove", (event) => {
    if (!canDrag || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const delta = y - startY;
    const now = performance.now();
    velocity = (y - lastY) / Math.max(now - lastAt, 1);
    lastY = y;
    lastAt = now;
    if (!dragging && delta <= 8) return;
    if (!dragging && sheet.scrollTop > 1) return reset();
    dragging = true;
    event.preventDefault();
    sheet.classList.add("is-dragging");
    sheet.style.setProperty("--drag-y", `${Math.max(0, delta)}px`);
  }, { passive: false });

  sheet.addEventListener("touchend", () => {
    if (!dragging) return reset();
    const dragY = Math.max(0, lastY - startY);
    if (dragY >= SWIPE_CLOSE || (dragY > SWIPE_FAST && velocity > SWIPE_VELOCITY)) {
      haptic();
      return close();
    }
    reset();
  }, { passive: true });

  sheet.addEventListener("touchcancel", reset, { passive: true });

  return {
    node: backdrop,
    close,
    open(parent = document.body) {
      lockScroll();
      parent.append(backdrop);
      requestAnimationFrame(() => { sheet.scrollTop = 0; });
      return backdrop;
    },
  };
}

  __x.Modal = Modal;

  });
  __def("ui/form.js", (__x, __req) => {
/* Состояние формы: значения, связывание полей и отправка.
 *
 * Форма ничего не знает про API — submit приходит снаружи. Это позволяет
 * держать все обращения к серверу в core/api.js.
 */
const { el } = __req("ui/dom.js");
const { Button } = __req("ui/button.js");
function createForm(initial = {}) {
  const values = { ...initial };
  const errors = {};
  return {
    values,
    get: (name) => values[name],
    set(name, value) { values[name] = value; },
    /** Пропсы для Field/Select: значение + запись обратно. */
    bind(name, { transform } = {}) {
      return {
        value: values[name] ?? "",
        state: errors[name] ? "error" : (values[name] ? "filled" : "empty"),
        hint: errors[name] || "",
        onInput: (v) => { values[name] = transform ? transform(v) : v; },
        onChange: (v) => { values[name] = transform ? transform(v) : v; },
      };
    },
    setError(name, message) { errors[name] = message; },
    clearErrors() { for (const k of Object.keys(errors)) delete errors[k]; },
    /** Только заполненные поля: сервер трактует отсутствие как «не менять». */
    payload(keys) {
      const out = {};
      for (const key of keys ?? Object.keys(values)) {
        const v = values[key];
        if (v === "" || v === undefined || v === null) continue;
        out[key] = v;
      }
      return out;
    },
  };
}

/** Кнопки модалки с индикацией отправки и понятной ошибкой. */
function FormActions({ submitLabel, onSubmit, onCancel } = {}) {
  const error = el("p", { class: "modal-note form-error", hidden: true });
  const submit = Button({ kind: "main", label: submitLabel, full: true });
  const cancel = Button({ kind: "second", label: "Отмена", full: true, onClick: onCancel });

  submit.addEventListener("click", async () => {
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Сохраняю…";
    try {
      await onSubmit();
    } catch (e) {
      error.textContent = e?.detail || e?.message || "Не удалось сохранить";
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = submitLabel;
    }
  });

  return el("div", {}, [error, el("div", { class: "modal-actions" }, [cancel, submit])]);
}

  __x.createForm = createForm;
  __x.FormActions = FormActions;

  });
  __def("core/api.js", (__x, __req) => {
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

/**
 * Достаёт читаемый текст из detail. Сервер отдаёт его тремя способами:
 * строкой, списком конфликтов (409 на занятии) и объектом с описанием
 * занятого слота — «Ошибка 409» пользователю ничего не объясняет.
 */
function readableDetail(payload) {
  const detail = payload && typeof payload === "object" ? payload.detail : payload;
  if (!detail) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const texts = detail.map((d) => (typeof d === "string" ? d : d?.message || d?.msg)).filter(Boolean);
    return texts.length ? texts.join(" ") : null;
  }
  if (typeof detail === "object") {
    if (typeof detail.message === "string") return detail.message;
    if (Array.isArray(detail.conflicts) && detail.conflicts.length) {
      const first = detail.conflicts[0];
      return typeof first === "string" ? first : first?.message || null;
    }
  }
  return null;
}

class ApiError extends Error {
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
function setDevTelegramId(value) {
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
    throw new ApiError(response.status, readableDetail(payload), payload);
  }
  return payload;
}

const get = (path, opts) => request(path, { ...opts, method: "GET" });
const post = (path, body, opts) => request(path, { ...opts, method: "POST", body: body ?? {} });
const patch = (path, body, opts) => request(path, { ...opts, method: "PATCH", body: body ?? {} });
const del = (path, opts) => request(path, { ...opts, method: "DELETE" });

const enc = encodeURIComponent;

/* --- Служебные ----------------------------------------------------------- */

const getHealth = () => get("/healthz");
const getVersion = () => get("/api/version");
const getBuild = () => get("/api/build");

/* --- Сессия и профиль ---------------------------------------------------- */

const getMe = (opts) => get("/api/me", opts);
const register = (payload) => post("/api/register", payload);
const updateMyStudent = (payload) => patch("/api/me/student", payload);
const deleteMyStudent = () => del("/api/me/student");
const updateMyTimezone = (payload) => patch("/api/me/timezone", payload);

/* --- Расписание и слоты -------------------------------------------------- */

const getAvailableSlots = ({ durationMinutes = 60, days = 14 } = {}) =>
  get(`/api/available-slots?duration_minutes=${enc(durationMinutes)}&days=${enc(days)}`);

const book = (payload) => post("/api/book", payload);
const createScheduleRule = (payload) => post("/api/schedule-rules", payload);

/* --- Занятия · роли ученика и родителя ----------------------------------- */

const confirmOwnLesson = (lessonId) => post(`/api/lessons/${enc(lessonId)}/confirm`);
const cancelOwnLesson = (lessonId, payload) => post(`/api/lessons/${enc(lessonId)}/cancel`, payload);
const moveOwnLesson = (lessonId, payload) => post(`/api/lessons/${enc(lessonId)}/move`, payload);
const markLessonPaid = (lessonId, payload) => post(`/api/lessons/${enc(lessonId)}/mark-paid`, payload);
const submitHomework = (homeworkId, payload) => post(`/api/homework/${enc(homeworkId)}/submit`, payload);
const sendPayment = (payload) => post("/api/payment", payload);

/* --- Прогресс и план ----------------------------------------------------- */

const updateProgress = (studentId, payload) => patch(`/api/students/${enc(studentId)}/progress`, payload);
const deleteProgressTopic = (studentId, topicId) => del(`/api/students/${enc(studentId)}/progress/${enc(topicId)}`);
const deleteProgressNote = (studentId, topicId) => del(`/api/students/${enc(studentId)}/progress/${enc(topicId)}/note`);
const createPlanItem = (studentId, payload) => post(`/api/students/${enc(studentId)}/plan`, payload);
const updatePlanItem = (studentId, itemId, payload) => patch(`/api/students/${enc(studentId)}/plan/${enc(itemId)}`, payload);
const deletePlanItem = (studentId, itemId) => del(`/api/students/${enc(studentId)}/plan/${enc(itemId)}`);

/* --- Репетитор · ученики ------------------------------------------------- */

const getStudent = (studentId) => get(`/api/admin/students/${enc(studentId)}`);
const createStudent = (payload) => post("/api/admin/students", payload);
const updateStudent = (studentId, payload) => patch(`/api/admin/students/${enc(studentId)}`, payload);
const deleteStudent = (studentId) => del(`/api/admin/students/${enc(studentId)}`);
const updateTutorProfile = (payload) => patch("/api/admin/profile", payload);

/* --- Репетитор · занятия ------------------------------------------------- */

const createLesson = (payload) => post("/api/admin/lessons", payload);
const updateLesson = (lessonId, payload) => patch(`/api/admin/lessons/${enc(lessonId)}`, payload);
const deleteLesson = (lessonId) => del(`/api/admin/lessons/${enc(lessonId)}`);
const confirmLesson = (lessonId, payload) => post(`/api/admin/lessons/${enc(lessonId)}/confirm`, payload);
const rejectLesson = (lessonId, payload) => post(`/api/admin/lessons/${enc(lessonId)}/reject`, payload);

/* --- Репетитор · домашние задания ---------------------------------------- */

const createHomework = (payload) => post("/api/admin/homework", payload);
const updateHomework = (homeworkId, payload) => patch(`/api/admin/homework/${enc(homeworkId)}`, payload);
const deleteHomework = (homeworkId) => del(`/api/admin/homework/${enc(homeworkId)}`);

/* --- Репетитор · деньги -------------------------------------------------- */

const createPayment = (payload) => post("/api/admin/payments", payload);
const confirmPayment = (paymentId, payload) => post(`/api/admin/payments/${enc(paymentId)}`, payload);
const updateAdvance = (paymentId, payload) => patch(`/api/admin/advances/${enc(paymentId)}`, payload);

/* --- Репетитор · нерабочие часы ------------------------------------------ */

const createClosedSlot = (payload) => post("/api/admin/closed-slots", payload);
const deleteClosedSlot = (slotId) => del(`/api/admin/closed-slots/${enc(slotId)}`);

/* --- Репетитор · ссылки доступа ------------------------------------------ */

const createTutorBrowserInvite = (payload) => post("/api/admin/browser-invites", payload);
const createStudentBrowserInvite = (studentId, payload) =>
  post(`/api/admin/students/${enc(studentId)}/browser-invites`, payload);

/* --- Репетитор · очистка стабильного расписания -------------------------- */

const previewScheduleCleanup = (studentId) =>
  get(`/api/admin/students/${enc(studentId)}/schedule-cleanup`);
const runScheduleCleanup = (studentId) =>
  post(`/api/admin/students/${enc(studentId)}/schedule-cleanup`);

  __x.ApiError = ApiError;
  __x.setDevTelegramId = setDevTelegramId;
  __x.getHealth = getHealth;
  __x.getVersion = getVersion;
  __x.getBuild = getBuild;
  __x.getMe = getMe;
  __x.register = register;
  __x.updateMyStudent = updateMyStudent;
  __x.deleteMyStudent = deleteMyStudent;
  __x.updateMyTimezone = updateMyTimezone;
  __x.getAvailableSlots = getAvailableSlots;
  __x.book = book;
  __x.createScheduleRule = createScheduleRule;
  __x.confirmOwnLesson = confirmOwnLesson;
  __x.cancelOwnLesson = cancelOwnLesson;
  __x.moveOwnLesson = moveOwnLesson;
  __x.markLessonPaid = markLessonPaid;
  __x.submitHomework = submitHomework;
  __x.sendPayment = sendPayment;
  __x.updateProgress = updateProgress;
  __x.deleteProgressTopic = deleteProgressTopic;
  __x.deleteProgressNote = deleteProgressNote;
  __x.createPlanItem = createPlanItem;
  __x.updatePlanItem = updatePlanItem;
  __x.deletePlanItem = deletePlanItem;
  __x.getStudent = getStudent;
  __x.createStudent = createStudent;
  __x.updateStudent = updateStudent;
  __x.deleteStudent = deleteStudent;
  __x.updateTutorProfile = updateTutorProfile;
  __x.createLesson = createLesson;
  __x.updateLesson = updateLesson;
  __x.deleteLesson = deleteLesson;
  __x.confirmLesson = confirmLesson;
  __x.rejectLesson = rejectLesson;
  __x.createHomework = createHomework;
  __x.updateHomework = updateHomework;
  __x.deleteHomework = deleteHomework;
  __x.createPayment = createPayment;
  __x.confirmPayment = confirmPayment;
  __x.updateAdvance = updateAdvance;
  __x.createClosedSlot = createClosedSlot;
  __x.deleteClosedSlot = deleteClosedSlot;
  __x.createTutorBrowserInvite = createTutorBrowserInvite;
  __x.createStudentBrowserInvite = createStudentBrowserInvite;
  __x.previewScheduleCleanup = previewScheduleCleanup;
  __x.runScheduleCleanup = runScheduleCleanup;

  });
  __def("screens/forms.js", (__x, __req) => {
/* Рабочие формы: каждая собирает payload по схеме сервера и отправляет его
 * через core/api.js.
 *
 * Формы не знают про экраны: открывает их openForm, а после успеха
 * вызывается переданный onDone, который перезагружает payload.
 */
const { el } = __req("ui/dom.js");
const { Modal } = __req("ui/modal.js");
const { Field, Select } = __req("ui/field.js");
const { Button } = __req("ui/button.js");
const { createForm, FormActions } = __req("ui/form.js");
const { DurationPicker, FreeSlots } = __req("ui/pickers.js");
const api = __req("core/api.js");
const dict = __req("core/dict.js");
const fmt = __req("core/format.js");
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

function openForm(name, params = {}, { onDone } = {}) {
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

const FORM_NAMES = Object.keys(FORMS);

  __x.openForm = openForm;
  __x.FORM_NAMES = FORM_NAMES;

  });
  __def("core/adapt.js", (__x, __req) => {
/* Адаптеры: ответ /api/me → view-model экранов.
 *
 * Единственное место, которое знает форму серверного payload. Экраны
 * получают уже готовые подписи и тона, поэтому смена формата на сервере
 * правится здесь, а не в пяти компонентах.
 *
 * Статусы нигде не сравниваются со строками напрямую — только через dict.
 */
const dict = __req("core/dict.js");
const fmt = __req("core/format.js");
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

function balanceOf(student) {
  const debt = Number(student.debt_amount || 0);
  if (debt > 0) return { text: fmt.moneySigned(-debt), tone: "debt" };
  const hours = Number(student.balance_lessons || 0);
  if (hours > 0) return { text: fmt.hoursSigned(hours), tone: "done" };
  return { text: fmt.money(0), tone: "none" };
}

function studentMeta(student) {
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

function adaptStudents(admin) {
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

function studentChips(admin) {
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

function filterStudents(rows, admin, { chip = "all", query = "", prep = "", sort = "next" } = {}) {
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

function adaptLessonDays(lessons = [], { withTotals = true } = {}) {
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

function adaptHomeworks(list = [], { withStudent = true } = {}) {
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

function filterHomeworks(rows, filter) {
  // Архив приходит с сервера отдельным списком, поэтому здесь его не
  // фильтруем — экран подставляет нужный источник.
  if (filter === "archive") return rows;
  if (filter === "work") return rows.filter((r) => r._raw.status === dict.HOMEWORK_STATUS.WAITING || r._raw.status === dict.HOMEWORK_STATUS.ASSIGNED);
  if (filter === "done") return rows.filter((r) => r._raw.status === dict.HOMEWORK_STATUS.DONE);
  if (filter === "overdue") return rows.filter((r) => isOverdue(r._raw));
  return rows;
}

/* --- финансы -------------------------------------------------------------- */

function adaptFinances(admin, { operationFilter = "" } = {}) {
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
    // Занятие с непустым авансом ученика закрывать вручную нельзя: аванс
    // списывается сам при статусе «проведено», и ручная отметка
    // рассинхронизирует счёт.
    unpaid: (f.unpaid_lessons || []).map((l) => {
      const student = (admin.students || []).find((s) => Number(s.id) === Number(l.student_id));
      const advanceHours = Number(student?.balance_lessons || 0);
      return {
        id: l.id,
        name: `${l.student_name || "Занятие"} · ${fmt.dayMonth(l.starts_at)}`,
        meta: advanceHours > 0
          ? `${fmt.money(lessonPrice(l))} · аванс ${fmt.hours(advanceHours)} спишется сам`
          : `${fmt.money(lessonPrice(l))} · ${dict.paymentStatus(l.payment_status).label}`,
        notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)),
        tail: "",
        hasAdvance: advanceHours > 0,
      };
    }),
  };
}

/* --- обзор репетитора ------------------------------------------------------ */

function adaptOverview(admin) {
  const sum = admin.summary || {};
  const now = new Date();
  const all = (admin.calendar || []).filter((l) => fmt.daysBetween(l.starts_at) === 0);
  const today = all.filter((l) => !dict.isCancelledLesson(l.status));
  const conducted = today.filter((l) => l.status === dict.LESSON_STATUS.CONDUCTED).length;

  const earned = today
    .filter((l) => l.payment_status === dict.PAYMENT_STATUS.CONFIRMED)
    .reduce((acc, l) => acc + lessonPrice(l), 0);
  const planned = today.reduce((acc, l) => acc + lessonPrice(l), 0);

  // Лента дня: занятия по времени, прошедшие приглушены. Метка «сейчас»
  // встаёт перед первым будущим занятием — это единственная анимация в
  // продукте, поэтому ставится ровно один раз.
  const sorted = [...today].sort((a, b) => fmt.toDate(a.starts_at) - fmt.toDate(b.starts_at));
  let nowPlaced = false;
  const ribbon = sorted.map((l) => {
    const starts = fmt.toDate(l.starts_at);
    const isPast = starts < now;
    const showNow = !isPast && !nowPlaced;
    if (showNow) nowPlaced = true;
    return {
      id: l.id,
      showNow,
      isPast,
      time: fmt.time(starts),
      duration: fmt.minutes(l.duration_minutes),
      name: l.student_name || "Занятие",
      meta: [l.topic, admin.students?.find((s) => s.id === l.student_id)?.subject].filter(Boolean).join(" · "),
      price: fmt.money(lessonPrice(l)),
      lessonStatus: dict.lessonStatus(l.status),
      paymentStatus: dict.paymentStatus(l.payment_status),
    };
  });

  const attention = [
    {
      key: "pending",
      label: "Заявки без ответа",
      count: (admin.pending_lessons || []).length,
      notch: notchOf(dict.lessonStatus(dict.LESSON_STATUS.PENDING)),
      target: "calendar",
    },
    {
      key: "toCheck",
      label: "Оплаты на проверке",
      count: ((admin.finances || {}).pending || []).length,
      notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.STUDENT_MARKED)),
      target: "finances",
    },
    {
      key: "unpaid",
      label: "Ждут оплаты",
      count: ((admin.finances || {}).unpaid_lessons || []).length,
      notch: notchOf(dict.paymentStatus(dict.PAYMENT_STATUS.UNPAID)),
      target: "finances",
    },
    {
      key: "homework",
      label: "Домашки на проверку",
      count: (admin.homeworks || []).filter(
        (h) => h.status !== dict.HOMEWORK_STATUS.DONE && h.status !== dict.HOMEWORK_STATUS.CANCELLED,
      ).length,
      notch: notchOf(dict.homeworkStatus(dict.HOMEWORK_STATUS.WAITING)),
      target: "homeworks",
    },
  ].filter((item) => item.count > 0);

  return {
    dateLabel: `${fmt.weekdayShort(now).toLowerCase()}, ${fmt.dateLong(now)}`,
    nowLabel: fmt.time(now),
    money: fmt.money(planned),
    moneyCaption: earned >= planned && planned > 0 ? "получено" : "к получению",
    progress: planned > 0 ? Math.round(earned / planned * 100) : 0,
    conducted,
    total: today.length,
    cancelledToday: all.length - today.length,
    ribbon,
    attention,
    stats: [
      { label: "Учеников", value: String(sum.students || 0) },
      { label: "Уроков за неделю", value: String(sum.week_lessons || 0) },
      { label: "Доход за месяц", value: fmt.money(sum.month_income || 0) },
      Number(sum.debt_amount || 0) > 0
        ? { label: "Долги", value: fmt.money(sum.debt_amount), tone: "debt" }
        : { label: "Долги", value: fmt.money(0) },
    ],
  };
}

/* --- календарь ------------------------------------------------------------- */

function adaptCalendar(admin, { mode = "week", archive = false } = {}) {
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

function adaptStudentCard(admin, studentId) {
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

function adaptClient(payload) {
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

  __x.balanceOf = balanceOf;
  __x.studentMeta = studentMeta;
  __x.adaptStudents = adaptStudents;
  __x.studentChips = studentChips;
  __x.filterStudents = filterStudents;
  __x.adaptLessonDays = adaptLessonDays;
  __x.adaptHomeworks = adaptHomeworks;
  __x.filterHomeworks = filterHomeworks;
  __x.adaptFinances = adaptFinances;
  __x.adaptOverview = adaptOverview;
  __x.adaptCalendar = adaptCalendar;
  __x.adaptStudentCard = adaptStudentCard;
  __x.adaptClient = adaptClient;

  });
  __def("app.js", (__x, __req) => {
/* Приложение v2.
 *
 * Грузит /api/me, выбирает набор экранов по роли и монтирует ровно один
 * активный экран. Все обращения к серверу идут через core/api.js, статусы —
 * через core/dict.js, форма payload известна только core/adapt.js.
 */
const { el } = __req("ui/dom.js");
const { createRouter } = __req("core/router.js");
const { getState, setState, setPayload } = __req("core/state.js");
const { Header, TabBar, Fab } = __req("ui/shell.js");
const { Button, IconButton } = __req("ui/button.js");
const { Toast } = __req("ui/feedback.js");
const api = __req("core/api.js");
const adapt = __req("core/adapt.js");
const fmt = __req("core/format.js");
const dict = __req("core/dict.js");
const { OverviewScreen } = __req("screens/overview.js");
const { CalendarScreen } = __req("screens/calendar.js");
const { StudentsScreen } = __req("screens/students.js");
const { StudentCardScreen } = __req("screens/student-card.js");
const { HomeworksScreen } = __req("screens/homeworks.js");
const { FinancesScreen } = __req("screens/finances.js");
const { TutorProfileScreen } = __req("screens/tutor-profile.js");
const { ClientOverviewScreen, ClientCalendarScreen, ClientProgressScreen, ClientPaymentsScreen, ClientProfileScreen } = __req("screens/client.js");
const { RegisterScreen, LoadingScreen, ErrorScreen } = __req("screens/service.js");
const { openForm } = __req("screens/forms.js");
const TUTOR_TABS = [
  { value: "overview", label: "Обзор" }, { value: "students", label: "Ученики" },
  { value: "calendar", label: "Кален." }, { value: "homeworks", label: "ДЗ" },
  { value: "finances", label: "Фин." },
];

const CLIENT_TABS = [
  { value: "overview", label: "Обзор" }, { value: "calendar", label: "Кален." },
  { value: "homeworks", label: "ДЗ" }, { value: "progress", label: "Прогр." },
  { value: "finances", label: "Оплаты" },
];

/* Локальное состояние вида: фильтры и режимы, которые не живут на сервере. */
const view = {
  studentFilters: { chip: "all", query: "", prep: "", sort: "next" },
  filtersOpen: false,
  homeworkFilter: "all",
  calendarMode: "week",
  calendarArchive: false,
  operationFilter: "",
  operationsOpen: false,
  cardTab: "profile",
  screen: "overview",
};

/* Какую вкладку подсвечивать для экрана. Карточка ученика — часть раздела
 * «Ученики», профиль вкладкой не представлен. */
const TAB_FOR_SCREEN = { "student-card": "students", profile: null };
const tabForScreen = (id) => (id in TAB_FOR_SCREEN ? TAB_FOR_SCREEN[id] : id);

const tg = () => globalThis.Telegram?.WebApp;

function toast(text, tone = "none", action = null) {
  const host = document.getElementById("toast-host");
  if (!host) return;
  const button = action
    ? Button({ kind: "inline", label: action.label, onClick: () => { host.replaceChildren(); action.onClick(); } })
    : null;
  host.replaceChildren(Toast({ text, tone, action: button }));
  // С отменой держим дольше: пользователю нужно успеть передумать.
  setTimeout(() => host.replaceChildren(), action ? 8000 : 4000);
}

/**
 * Закрытие долга свайпом: занятие помечается оплаченным.
 *
 * Свайп легко сделать случайно, а действие финансовое, поэтому рядом с
 * подтверждением всегда живёт отмена — она возвращает прежний статус.
 */
async function closeDebt(lessonId) {
  try {
    // Именно payment_status: роут /confirm подтверждает заявку на занятие,
    // а не оплату, и для прочих статусов молча ничего не делает.
    await api.updateLesson(lessonId, { payment_status: dict.PAYMENT_STATUS.CONFIRMED });
    await reload();
    toast("Долг закрыт", "done", {
      label: "Отменить",
      onClick: () => run("Долг возвращён", () => api.updateLesson(lessonId, {
        payment_status: dict.PAYMENT_STATUS.UNPAID,
      })),
    });
  } catch (error) {
    toast(error?.detail || "Не удалось закрыть долг", "debt");
    await reload();
  }
}

/** Действие с обновлением payload и понятной ошибкой вместо тишины. */
async function run(label, fn) {
  try {
    await fn();
    await reload();
    toast(label, "done");
  } catch (error) {
    toast(error?.detail || error?.message || "Не удалось выполнить", "debt");
  }
}

let router = null;
let shell = null;
let paintTabs = () => {};

/** Единственная точка перехода: меняет экран и сразу обновляет подсветку. */
function goTo(id) {
  view.screen = id;
  router.go(id);
  paintTabs();
}

/** Контекст, который нужен формам: список учеников и выбранный ученик. */
function formCtx() {
  const p = getState().payload || {};
  return {
    students: p.admin?.students || (p.dashboard?.student ? [p.dashboard.student] : []),
    selectedStudentId: getState().selectedStudentId,
  };
}

const form = (name, params = {}) => openForm(name, { ctx: formCtx(), ...params }, {
  onDone: () => reload().catch(() => toast("Не удалось обновить", "debt")),
});

async function reload() {
  const payload = await api.getMe();
  setPayload(payload);
  render();
}

const findLesson = (admin, id) =>
  [...(admin.calendar || []), ...(admin.calendar_archive || [])].find((l) => Number(l.id) === Number(id));
const topicsFor = (admin, id) =>
  (admin.topics_by_student || {})[id] || (admin.topics_by_student || {})[String(id)] || [];

/* --- сборка экранов ------------------------------------------------------- */

function tutorScreens(admin) {
  return {
    overview: () => ({
      mount: (c) => c.append(OverviewScreen({
        model: adapt.adaptOverview(admin),
        actions: {
          openCalendar: () => goTo("calendar"),
          openLesson: (id) => form("lesson", { lesson: findLesson(admin, id) }),
          addLesson: () => form("lesson"),
          goTo,
        },
      })),
    }),

    students: () => ({
      mount(c) {
        const rows = adapt.adaptStudents(admin);
        c.append(StudentsScreen({
          students: adapt.filterStudents(rows, admin, view.studentFilters),
          total: rows.length,
          chips: adapt.studentChips(admin),
          filters: view.studentFilters,
          filtersOpen: view.filtersOpen,
          actions: {
            toggleFilters: () => { view.filtersOpen = !view.filtersOpen; render(); },
            setChip: (v) => { view.studentFilters.chip = v; render(); },
            setQuery: (v) => { view.studentFilters.query = v; render(); },
            setPrep: (v) => { view.studentFilters.prep = v; render(); },
            setSort: (v) => { view.studentFilters.sort = v; render(); },
            openStudent: (id) => { setState({ selectedStudentId: id }); goTo("student-card"); },
            createStudent: () => form("student"),
          },
        }));
      },
    }),

    "student-card": () => ({
      mount(c) {
        const model = adapt.adaptStudentCard(admin, getState().selectedStudentId);
        if (!model) return goTo("students");
        c.append(StudentCardScreen({
          model, tab: view.cardTab,
          actions: {
            setTab: (v) => { view.cardTab = v; render(); },
            back: () => goTo("students"),
            openLesson: (id) => form("lesson", { lesson: findLesson(admin, id) }),
            openNextLesson: () => {
              const next = (admin.calendar || []).find((l) => Number(l.student_id) === Number(getState().selectedStudentId));
              if (next) form("lesson", { lesson: next });
            },
            edit: () => form("student", { student: (admin.students || []).find((x) => Number(x.id) === Number(getState().selectedStudentId)) }),
            invite: () => form("browserInvite", { studentId: model.student.id }),
            openProgress: () => form("progress", { studentId: model.student.id, topics: topicsFor(admin, model.student.id) }),
            addLesson: () => form("lesson"),
            addHomework: () => form("homework"),
            addPayment: () => form("payment"),
            addNote: () => form("progress", { studentId: model.student.id, topics: topicsFor(admin, model.student.id) }),
            addPlanItem: () => form("planItem", { studentId: model.student.id }),
            cleanupSchedule: () => form("scheduleCleanup", {
              studentId: model.student.id, studentName: model.student.name,
            }),
            togglePlanItem: (id) => {
              const item = model.plan.find((p) => p.id === id);
              return run("План обновлён", () => api.updatePlanItem(model.student.id, id, {
                status: item?.done ? "не начато" : "выполнено",
              }));
            },
          },
        }));
      },
    }),

    calendar: () => ({
      mount: (c) => c.append(CalendarScreen({
        model: adapt.adaptCalendar(admin, { mode: view.calendarMode, archive: view.calendarArchive }),
        mode: view.calendarMode,
        archive: view.calendarArchive,
        actions: {
          setMode: (v) => { view.calendarMode = v; render(); },
          toggleArchive: () => { view.calendarArchive = !view.calendarArchive; render(); },
          openLesson: (id) => form("lesson", { lesson: findLesson(admin, id) }),
          markConducted: (id) => run("Занятие проведено", () => api.updateLesson(id, { status: "проведено" })),
          confirmPayment: (id) => run("Оплата подтверждена", () => api.updateLesson(id, { payment_status: dict.PAYMENT_STATUS.CONFIRMED })),
          deleteClosedSlot: (id) => run("Окно открыто", () => api.deleteClosedSlot(id)),
          addLesson: () => form("lesson"),
          freeSlots: () => form("freeSlots", { onPick: (startsAt) => form("lesson", { lesson: { starts_at: startsAt, duration_minutes: 60 } }) }),
          addRule: () => form("scheduleRule"),
          addClosedSlot: () => form("closedSlot"),
        },
      })),
    }),

    homeworks: () => ({
      mount(c) {
        const archive = view.homeworkFilter === "archive";
        const rows = adapt.adaptHomeworks(
          (archive ? admin.homeworks_archive : admin.homeworks) || [],
        );
        c.append(HomeworksScreen({
          items: adapt.filterHomeworks(rows, view.homeworkFilter),
          total: rows.length,
          archiveNote: archive,
          filter: view.homeworkFilter,
          canCreate: true,
          actions: {
            setFilter: (v) => { view.homeworkFilter = v; render(); },
            createHomework: () => form("homework"),
            openHomework: (id) => form("homework", { homework: (admin.homeworks || []).find((h) => Number(h.id) === Number(id)) }),
          },
        }));
      },
    }),

    finances: () => ({
      mount: (c) => c.append(FinancesScreen({
        ...adapt.adaptFinances(admin, { operationFilter: view.operationFilter }),
        filter: view.operationFilter,
        operationsOpen: view.operationsOpen,
        actions: {
          createPayment: () => form("payment"),
          confirmPayment: (id) => run("Оплата подтверждена", () => api.confirmPayment(id)),
          editAdvance: (id) => form("advance", { advance: (admin.finances?.advances || []).find((a) => Number(a.payment_id) === Number(id)) }),
          setFilter: (v) => { view.operationFilter = v; render(); },
          toggleOperations: () => { view.operationsOpen = !view.operationsOpen; render(); },
          closeDebt,
        },
      })),
    }),

    profile: () => ({
      mount: (c) => c.append(TutorProfileScreen({
        profile: admin.profile || {},
        subjects: admin.profile?.subjects || [],
        prepTypes: admin.profile?.prep_types || [],
        workingDays: admin.profile?.working_days || [1, 2, 3, 4, 5, 6, 7],
        actions: {
          back: () => goTo("overview"),
          invite: () => form("browserInvite", {}),
          save: () => run("Профиль сохранён", () => api.updateTutorProfile({ ...(admin.profile || {}) })),
        },
      })),
    }),
  };
}

function clientScreens(payload) {
  const m = adapt.adaptClient(payload);
  return {
    overview: () => ({
      mount: (c) => c.append(ClientOverviewScreen({
        student: m.student, metrics: m.metrics, levels: m.levels,
      })),
    }),
    calendar: () => ({
      mount: (c) => c.append(ClientCalendarScreen({
        period: "", mode: view.calendarMode, summary: m.calendarSummary, days: m.calendarDays,
        actions: { setMode: (v) => { view.calendarMode = v; render(); } },
      })),
    }),
    homeworks: () => ({
      mount(c) {
        c.append(HomeworksScreen({
          items: adapt.filterHomeworks(
            view.homeworkFilter === "archive" ? m.homeworksArchive : m.homeworks,
            view.homeworkFilter,
          ),
          total: (view.homeworkFilter === "archive" ? m.homeworksArchive : m.homeworks).length,
          archiveNote: view.homeworkFilter === "archive",
          filter: view.homeworkFilter,
          canCreate: false,
          actions: {
            setFilter: (v) => { view.homeworkFilter = v; render(); },
            openHomework: (id) => form("homeworkSubmit", { homework: (payload.dashboard?.homeworks || []).find((h) => Number(h.id) === Number(id)) }),
          },
        }));
      },
    }),
    progress: () => ({
      mount: (c) => c.append(ClientProgressScreen({
        current: m.progressCurrent, goal: m.progressGoal, levels: m.levels,
        taskNotes: m.taskNotes, plan: m.plan, canEdit: m.canEdit,
        actions: {
          togglePlanItem: (id) => {
            const item = m.plan.find((p) => p.id === id);
            return run("План обновлён", () => api.updatePlanItem(m.student.id, id, {
              status: item?.done ? "не начато" : "выполнено",
            }));
          },
          editProgress: () => form("progress", { studentId: m.student.id, topics: payload.dashboard?.topics || [] }),
          addNote: () => form("progress", { studentId: m.student.id, topics: payload.dashboard?.topics || [] }),
          addPlanItem: () => form("planItem", { studentId: model.student.id }),
        },
      })),
    }),
    finances: () => ({
      mount: (c) => c.append(ClientPaymentsScreen({
        rate: m.rate, debt: m.debt, days: m.paymentDays, unpaid: m.unpaid,
        actions: { markPaid: (id) => run("Оплата отмечена", () => api.markLessonPaid(id, {})) },
      })),
    }),
    profile: () => ({
      mount: (c) => c.append(ClientProfileScreen({
        facts: m.facts, links: m.links,
        canEdit: m.canEdit, canDelete: payload.role === "student",
        actions: {
          edit: () => form("student", { student: payload.dashboard?.student }),
          remove: () => run("Профиль удалён", () => api.deleteMyStudent()),
        },
      })),
    }),
  };
}

/* --- рендер --------------------------------------------------------------- */

function render() {
  const state = getState();
  const payload = state.payload;
  if (!payload) return;

  const isTutor = payload.role === "tutor";
  const tabs = isTutor ? TUTOR_TABS : CLIENT_TABS;

  if (payload.role === "guest") {
    shell.body.replaceChildren(RegisterScreen({
      role: view.guestRole || "student",
      values: view.guestValues || {},
      actions: {
        setRole: (v) => { view.guestRole = v; render(); },
        setValue: (k, v) => { view.guestValues = { ...(view.guestValues || {}), [k]: v }; },
        submit: () => run("Кабинет создан", () => api.register({
          role: view.guestRole || "student", ...(view.guestValues || {}),
        })),
      },
    }));
    shell.tabbar.replaceChildren();
    shell.fab.replaceChildren();
    return;
  }

  const screens = isTutor ? tutorScreens(payload.admin || {}) : clientScreens(payload);
  const active = screens[view.screen] ? view.screen : "overview";

  if (!router || router.registered.join() !== Object.keys(screens).join()) {
    router = createRouter({ container: shell.body });
    for (const [id, factory] of Object.entries(screens)) router.register(id, factory);
  } else {
    for (const [id, factory] of Object.entries(screens)) router.register(id, factory);
  }

  shell.header.replaceChildren(Header({
    subtitle: isTutor
      ? `${(payload.admin?.summary?.students) || 0} уч. · ${(payload.admin?.summary?.week_lessons) || 0} уроков`
      : payload.role === "parent" ? "Кабинет родителя" : "Кабинет ученика",
    actions: [
      IconButton({ glyph: "◍", label: "Профиль", onClick: () => goTo("profile") }),
      IconButton({ glyph: "↻", label: "Обновить", onClick: () => reload().catch(() => toast("Не удалось обновить", "debt")) }),
    ],
  }));

  paintTabs = () => shell.tabbar.replaceChildren(TabBar({
    items: tabs,
    value: tabForScreen(view.screen),
    onSelect: goTo,
  }));

  // Fab возвращает null для роли без действий — replaceChildren(null)
  // вставил бы строку "null", поэтому чистим явно.
  shell.fab.replaceChildren();
  const fab = isTutor
    ? Fab({ actions: [
        { label: "Добавить ученика", onClick: () => form("student") },
        { label: "Разовая запись", onClick: () => form("lesson") },
        { label: "Стабильное расписание", onClick: () => form("scheduleRule") },
        { label: "Нерабочие часы", onClick: () => form("closedSlot") },
        { label: "Создать домашку", onClick: () => form("homework") },
        { label: "Добавить оплату", onClick: () => form("payment") },
      ] })
    : null;
  if (fab) shell.fab.append(fab);

  view.screen = active;
  router.go(active);
  paintTabs();
}

/* --- запуск --------------------------------------------------------------- */

async function boot() {
  const root = document.getElementById("root");
  tg()?.ready?.();
  tg()?.expand?.();

  // Локальная отладка: ?dev=<telegram_id>. Сервер принимает этот заголовок
  // только на localhost, поэтому на проде параметр ничего не даёт.
  const dev = new URLSearchParams(location.search).get("dev");
  if (dev) api.setDevTelegramId(dev);

  shell = {
    header: el("div", { id: "header-host" }),
    body: el("main", { class: "app-body", id: "screen" }),
    tabbar: el("div", { id: "tabbar-host" }),
    fab: el("div", { id: "fab-host" }),
    toast: el("div", { class: "toast-host", id: "toast-host" }),
  };
  root.replaceChildren(shell.header, shell.body, shell.fab, shell.tabbar, shell.toast);

  shell.body.append(LoadingScreen());

  try {
    await reload();
  } catch (error) {
    shell.body.replaceChildren(ErrorScreen({
      code: `код ${error?.status || "—"} · ${fmt.dayMonth(new Date())}, ${fmt.time(new Date())}`,
      description: error?.status === 401
        ? "Открой Mini App из Telegram — там авторизация происходит сама."
        : "Нет связи с сервером. Проверьте интернет и повторите — данные сохранены, ничего не потеряно.",
      actions: { retry: () => boot() },
    }));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}



  });
  __req("app.js");
})();
