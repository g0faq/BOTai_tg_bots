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
export function getState() {
  return { ...store };
}

export function subscribe(listener) {
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
export function setState(patch) {
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

export function setPayload(payload) {
  return setState({
    payload,
    role: payload?.role ?? null,
    error: null,
  });
}

export function reset() {
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
